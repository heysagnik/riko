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

function requireInboundSecret(header: string | undefined): boolean {
  const expected = process.env.INBOUND_MAIL_SECRET;
  if (!expected) return false;
  return header === expected;
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

  const match = taggedCaseId
    ? { caseId: taggedCaseId }
    : messageIds.length > 0
      ? (
          await db
            .select({ caseId: outreach.caseId })
            .from(outreach)
            .where(inArray(outreach.providerMessageId, messageIds))
            .limit(1)
        )[0]
      : undefined;

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
    .where(and(eq(cases.id, match.caseId), inArray(cases.state, [...OPEN_STATES])))
    .limit(1);

  if (!caseRow) {
    res.json({ status: "ignored", reason: "case_not_open", classification: classification.kind });
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

  const trigger =
    classification.kind === "hard_bounce"
      ? ({ type: "hard_bounced" } as const)
      : classification.kind === "unsubscribe_request"
        ? ({ type: "customer_unsubscribed" } as const)
        : usablePromise
          ? ({ type: "promise_captured" } as const)
          : ({ type: "customer_replied" } as const);

  const transition = applyTransition(caseRow.state, trigger);

  await db.transaction(async (tx) => {
    if (classification.kind === "hard_bounce") {
      await tx.update(customers).set({ bouncedAt: new Date() }).where(eq(customers.id, caseRow.customerId));
    }
    if (classification.kind === "unsubscribe_request") {
      await tx.update(customers).set({ unsubscribedAt: new Date() }).where(eq(customers.id, caseRow.customerId));
    }

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
