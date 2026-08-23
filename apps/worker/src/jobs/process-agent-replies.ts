import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { db, cases, caseMessages, promises, appendCaseEvent } from "@riko/db";
import { applyTransition, isWithinContactWindow, extractPromise, MIN_PROMISE_CONFIDENCE } from "@riko/core";
import { reasonReply, validateReply, type ConversationTurn } from "@riko/agent";
import { getTransporterForSmtpConfig } from "../lib/mailer.js";
import type { SendableOutreach } from "./process-sending-cases.js";

const nim = createOpenAICompatible({
  name: "nvidia-nim",
  baseURL: process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY ?? "",
});
const model = nim.chatModel(process.env.NVIDIA_NIM_MODEL ?? "meta/llama-3.1-8b-instruct");

// A customer who keeps writing should reach a person, not an endless bot.
const MAX_AGENT_REPLIES = Number(process.env.MAX_AGENT_REPLIES ?? 5);

const ANSWERABLE_STATES = ["WAITING", "PROMISED"] as const;

function quoteLines(body: string): string {
  return body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildQuotedBody(
  replyText: string,
  thread: { direction: string; body: string; createdAt: Date }[],
  customerName: string,
  merchantName: string,
): string {
  const quoted = thread
    .slice()
    .reverse()
    .map((turn) => {
      const who = turn.direction === "inbound" ? customerName : merchantName;
      const when = turn.createdAt.toUTCString();
      return `On ${when}, ${who} wrote:\n${quoteLines(turn.body)}`;
    })
    .join("\n\n");

  return quoted ? `${replyText}\n\n${quoted}` : replyText;
}

export interface AgentReplyDeps {
  loadPendingOutreach: (caseId: string) => Promise<SendableOutreach>;
  loadReplyContext: (caseId: string) => Promise<{
    customerName: string;
    localHour: number;
    customerSuppressed: boolean;
    tenantPaused: boolean;
    withinDailyCap: boolean;
    amountLabel: string;
    merchantName: string;
    paymentUrl: string;
    toEmail: string;
    fromEmail: string;
    fromName: string;
    replyTo: string | null;
    subject: string;
    smtp: Parameters<typeof getTransporterForSmtpConfig>[0] | null;
  }>;
}

export async function processAgentReplies({ loadReplyContext }: AgentReplyDeps): Promise<void> {
  const pending = await db
    .select({ id: cases.id, tenantId: cases.tenantId, state: cases.state, replyCount: cases.agentReplyCount })
    .from(cases)
    .where(
      and(
        inArray(cases.state, [...ANSWERABLE_STATES]),
        sql`exists (
          select 1 from case_messages m
          where m.case_id = ${cases.id} and m.direction = 'inbound'
          and m.seq = (select max(seq) from case_messages where case_id = ${cases.id})
        )`,
      ),
    );

  for (const caseRow of pending) {
    try {
      const thread = await db
        .select()
        .from(caseMessages)
        .where(eq(caseMessages.caseId, caseRow.id))
        .orderBy(asc(caseMessages.seq));

      const latest = thread[thread.length - 1];
      if (!latest || latest.direction !== "inbound") continue;

      if (caseRow.replyCount >= MAX_AGENT_REPLIES) {
        await escalate(caseRow, "agent_reply_limit_reached");
        continue;
      }

      const ctx = await loadReplyContext(caseRow.id);
      if (!ctx.smtp) continue;

      // A reply is still outbound contact, so it answers to the same policy
      // the ladder does; without this the agent would write at 3am, past the
      // daily cap, or after the circuit breaker paused the tenant.
      if (ctx.customerSuppressed) continue;
      if (ctx.tenantPaused || !ctx.withinDailyCap) continue;
      if (!isWithinContactWindow(ctx.localHour)) continue;

      const history: ConversationTurn[] = thread.slice(0, -1).map((m) => ({
        role: m.direction === "inbound" ? "customer" : "agent",
        text: m.body,
      }));

      const reasoning = await reasonReply(model, {
        customerName: ctx.customerName,
        customerMessage: latest.body,
        amountLabel: ctx.amountLabel,
        merchantName: ctx.merchantName,
        paymentUrl: ctx.paymentUrl,
        history,
      });

      await db
        .update(caseMessages)
        .set({ intent: reasoning.intent, confidence: reasoning.confidence, rationale: reasoning.rationale })
        .where(eq(caseMessages.id, latest.id));

      if (!reasoning.replyText) {
        if (reasoning.needsHuman) await escalate(caseRow, `agent_deferred:${reasoning.intent}`);
        continue;
      }

      const validation = validateReply(reasoning.replyText, [ctx.paymentUrl]);
      if (!validation.valid) {
        await escalate(caseRow, `agent_reply_rejected:${validation.failures[0]?.rule ?? "unknown"}`);
        continue;
      }

      const subject = latest.subject?.trim()
        ? /^re:/i.test(latest.subject.trim())
          ? latest.subject.trim()
          : `Re: ${latest.subject.trim()}`
        : ctx.subject;

      const references = thread
        .map((m) => m.providerMessageId)
        .filter((id): id is string => Boolean(id));

      const info = await getTransporterForSmtpConfig(ctx.smtp).sendMail({
        from: `${ctx.fromName} <${ctx.fromEmail}>`,
        replyTo: ctx.replyTo ?? undefined,
        to: ctx.toEmail,
        subject,
        text: buildQuotedBody(reasoning.replyText, thread, ctx.customerName, ctx.merchantName),
        ...(latest.providerMessageId ? { inReplyTo: latest.providerMessageId } : {}),
        ...(references.length > 0 ? { references } : {}),
      });

      const nextSeq = (latest.seq ?? 0) + 1;

      const spoken = reasoning.intent === "promise_to_pay" ? extractPromise(latest.body) : null;
      const promise = spoken && spoken.confidence >= MIN_PROMISE_CONFIDENCE ? spoken : null;

      await db.transaction(async (tx) => {
        await tx.insert(caseMessages).values({
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          direction: "outbound",
          body: reasoning.replyText!,
          subject,
          providerMessageId: info.messageId,
          seq: nextSeq,
        });

        const transition = applyTransition(
          caseRow.state,
          promise ? { type: "promise_captured" } : { type: "agent_answered" },
        );

        await tx
          .update(cases)
          .set({
            agentReplyCount: caseRow.replyCount + 1,
            state: transition.toState,
            ...(promise ? { nextActionAt: promise.promisedFor } : {}),
          })
          .where(eq(cases.id, caseRow.id));

        if (promise) {
          await tx.insert(promises).values({
            tenantId: caseRow.tenantId,
            caseId: caseRow.id,
            promisedFor: promise.promisedFor,
            amountMinor: promise.amountMinor,
            confidence: promise.confidence,
            sourceText: promise.sourceText,
          });
        }

        await appendCaseEvent(tx, {
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          fromState: caseRow.state,
          toState: transition.toState,
          reason: promise ? "promise_to_pay" : `agent_replied:${reasoning.intent}`,
          actor: "agent",
        });
      });

      if (reasoning.needsHuman) await escalate(caseRow, `agent_replied_needs_review:${reasoning.intent}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`processAgentReplies: case ${caseRow.id} failed: ${message}\n`);
    }
  }
}

async function escalate(
  caseRow: { id: string; tenantId: string; state: "WAITING" | "PROMISED" | (string & {}) },
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(cases)
      .set({ state: "ESCALATED", closedAt: new Date(), closedReason: reason })
      .where(and(eq(cases.id, caseRow.id), inArray(cases.state, [...ANSWERABLE_STATES])))
      .returning({ id: cases.id });

    if (claimed.length === 0) return;

    await appendCaseEvent(tx, {
      tenantId: caseRow.tenantId,
      caseId: caseRow.id,
      fromState: caseRow.state as "WAITING" | "PROMISED",
      toState: "ESCALATED",
      reason,
      actor: "agent",
    });
  });
}
