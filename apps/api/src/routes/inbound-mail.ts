import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, cases, customers, outreach, promises, caseMessages, appendCaseEvent } from "@riko/db";
import {
  applyTransition,
  classifyInbound,
  extractMessageIds,
  caseIdFromRecipient,
  extractPromise,
  stripQuotedContent,
  safeEqual,
  MIN_PROMISE_CONFIDENCE,
} from "@riko/core";

export const inboundMailRouter = Router();

const inboundSchema = z.object({
  from: z.string().min(1),
  to: z.string().nullish(),
  cc: z.string().nullish(),
  subject: z.string().default(""),
  text: z.string().default(""),
  headers: z.record(z.string(), z.string()).optional(),
  inReplyTo: z.string().nullish(),
  references: z.string().nullish(),
});

const OPEN_STATES = ["NEW", "DRAFTING", "SENDING", "WAITING", "PROMISED"] as const;
// A handed-off case is terminal for the state machine, but a person is still
// reading the thread - their incoming replies must still land somewhere.
const RECORDABLE_STATES = [...OPEN_STATES, "ESCALATED"] as const;

function requireInboundSecret(header: string | undefined): boolean {
  const expected = process.env.INBOUND_MAIL_SECRET;
  if (!expected || !header) return false;
  return safeEqual(header, expected);
}

inboundMailRouter.post("/inbound/mail", async (req, res) => {
  if (!requireInboundSecret(req.header("x-riko-inbound-secret") ?? undefined)) {
    res.status(401).json({ error: "unauthorised" });
    return;
  }

  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  // Clients quote the original below a reply, and every outbound email ends in
  // an unsubscribe footer - classifying the raw body reads that footer as the
  // customer's own words.
  const message = { ...parsed.data, text: stripQuotedContent(parsed.data.text) };
  const classification = classifyInbound(message);
  const messageIds = extractMessageIds(message);

  const taggedCaseId = caseIdFromRecipient([message.to, message.cc, message.headers?.["delivered-to"]]);

  // The In-Reply-To/References chain can point at the very first ladder email
  // (logged in `outreach`) or at a later merchant/agent turn (logged only in
  // `caseMessages`) - a customer replying to either must still resolve.
  async function matchByMessageId(): Promise<{ caseId: string } | undefined> {
    if (messageIds.length === 0) return undefined;
    const [fromOutreach] = await db
      .select({ caseId: outreach.caseId })
      .from(outreach)
      .where(inArray(outreach.providerMessageId, messageIds))
      .limit(1);
    if (fromOutreach) return fromOutreach;
    const [fromMessages] = await db
      .select({ caseId: caseMessages.caseId })
      .from(caseMessages)
      .where(inArray(caseMessages.providerMessageId, messageIds))
      .limit(1);
    return fromMessages;
  }

  const match = taggedCaseId ? { caseId: taggedCaseId } : await matchByMessageId();

  if (!match) {
    res.json({
      status: "ignored",
      reason: messageIds.length === 0 ? "no_message_reference" : "no_matching_outreach",
      classification: classification.kind,
    });
    return;
  }

  // An out-of-office is not a human deciding anything. Escalating on it would
  // put noise in front of a person and stop a recovery that is still viable.
  if (classification.kind === "auto_reply" || classification.kind === "soft_bounce") {
    res.json({ status: "noted", caseId: match.caseId, classification: classification.kind });
    return;
  }

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, match.caseId), inArray(cases.state, [...RECORDABLE_STATES])))
    .limit(1);

  if (!caseRow) {
    res.json({ status: "ignored", reason: "case_not_open", classification: classification.kind });
    return;
  }

  // Already with a person - just log what the customer said instead of running
  // it through the (open-state-only) transition logic below.
  if (caseRow.state === "ESCALATED") {
    if (classification.kind === "hard_bounce") {
      await db.update(customers).set({ bouncedAt: new Date() }).where(eq(customers.id, caseRow.customerId));
    }
    if (classification.kind === "unsubscribe_request") {
      await db.update(customers).set({ unsubscribedAt: new Date() }).where(eq(customers.id, caseRow.customerId));
    }

    const [seqRow] = await db
      .select({ maxSeq: sql<number>`coalesce(max(${caseMessages.seq}), -1)::int` })
      .from(caseMessages)
      .where(eq(caseMessages.caseId, caseRow.id));
    const maxSeq = seqRow?.maxSeq ?? -1;

    await db.insert(caseMessages).values({
      tenantId: caseRow.tenantId,
      caseId: caseRow.id,
      direction: "inbound",
      body: message.text,
      subject: message.subject,
      providerMessageId: message.headers?.["message-id"] ?? null,
      seq: maxSeq + 1,
    });

    res.json({ status: "recorded_while_escalated", caseId: caseRow.id, classification: classification.kind });
    return;
  }

  // A reply that names a date and a commitment is answerable by the system; one
  // that does not is a conversation, and belongs with a person.
  const promise =
    classification.kind === "reply" && caseRow.state === "WAITING"
      ? extractPromise(message.text)
      : null;
  const usablePromise = promise && promise.confidence >= MIN_PROMISE_CONFIDENCE ? promise : null;

  // Answered by the agent on the next worker tick.
  if (classification.kind === "reply" && !usablePromise) {
    const [seqRow] = await db
      .select({ maxSeq: sql<number>`coalesce(max(${caseMessages.seq}), -1)::int` })
      .from(caseMessages)
      .where(eq(caseMessages.caseId, caseRow.id));
    const maxSeq = seqRow?.maxSeq ?? -1;

    await db.insert(caseMessages).values({
      tenantId: caseRow.tenantId,
      caseId: caseRow.id,
      direction: "inbound",
      body: message.text,
      subject: message.subject,
      providerMessageId: message.headers?.["message-id"] ?? null,
      seq: maxSeq + 1,
    });

    await db.update(cases).set({ awaitingAgentReply: true }).where(eq(cases.id, caseRow.id));

    res.json({ status: "queued_for_agent", caseId: caseRow.id, classification: classification.kind });
    return;
  }

  // Suppression is customer-wide and must never fail on a state that lacks the
  // transition (NEW/DRAFTING/SENDING): mark the person, close every open case
  // they have, and acknowledge — regardless of where this one case stood.
  if (classification.kind === "hard_bounce" || classification.kind === "unsubscribe_request") {
    const isBounce = classification.kind === "hard_bounce";
    const flag = isBounce ? { bouncedAt: new Date() } : { unsubscribedAt: new Date() };
    const reason = isBounce ? "hard_bounce" : "customer_unsubscribed";

    await db.transaction(async (tx) => {
      await tx.update(customers).set(flag).where(eq(customers.id, caseRow.customerId));

      const open = await tx
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.customerId, caseRow.customerId), inArray(cases.state, [...OPEN_STATES])));

      for (const row of open) {
        await tx
          .update(cases)
          .set({ state: "SKIPPED", closedAt: new Date(), closedReason: reason, awaitingAgentReply: false })
          .where(and(eq(cases.id, row.id), inArray(cases.state, [...OPEN_STATES])));
        await appendCaseEvent(tx, {
          tenantId: caseRow.tenantId,
          caseId: row.id,
          fromState: null,
          toState: "SKIPPED",
          reason,
          actor: "system",
        });
      }
    });

    res.json({ status: "applied", caseId: caseRow.id, classification: classification.kind });
    return;
  }

  const trigger =
    usablePromise
      ? ({ type: "promise_captured" } as const)
      : ({ type: "customer_replied" } as const);

  const transition = applyTransition(caseRow.state, trigger);

  await db.transaction(async (tx) => {
    await tx
      .update(cases)
      .set({
        state: transition.toState,
        closedAt: transition.toState === "SKIPPED" || transition.toState === "ESCALATED" ? new Date() : null,
        closedReason: transition.reason,
        // Hold the ladder until the promised date, then judge it.
        nextActionAt: usablePromise ? usablePromise.promisedFor : undefined,
      })
      .where(eq(cases.id, caseRow.id));

    if (usablePromise) {
      await tx.insert(promises).values({
        tenantId: caseRow.tenantId,
        caseId: caseRow.id,
        promisedFor: usablePromise.promisedFor,
        amountMinor: usablePromise.amountMinor,
        confidence: usablePromise.confidence,
        sourceText: usablePromise.sourceText,
      });
    }

    await appendCaseEvent(tx, {
      tenantId: caseRow.tenantId,
      caseId: caseRow.id,
      fromState: caseRow.state,
      toState: transition.toState,
      reason: transition.reason ?? classification.reason,
      actor: "system",
    });
  });

  res.json({
    status: "applied",
    caseId: caseRow.id,
    classification: classification.kind,
    toState: transition.toState,
  });
});
