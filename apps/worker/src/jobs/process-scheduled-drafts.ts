import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { db, cases, agentActions, outreach, appendCaseEvent } from "@riko/db";
import { runDraftLoop } from "@riko/agent";
import type { CaseFacts } from "@riko/shared";
import { llmRateLimiter } from "../lib/rate-limiter.js";
import { log } from "../lib/logger.js";

const nim = createOpenAICompatible({
  name: "nvidia-nim",
  baseURL: process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY ?? "",
});
const MODEL = process.env.NVIDIA_NIM_MODEL ?? "meta/llama-3.1-8b-instruct";
const model = nim.chatModel(MODEL);

const MIN_LEAD_MS = 15 * 60 * 1000;
const MAX_LEAD_MS = 48 * 60 * 60 * 1000;

export async function processScheduledDrafts(
  loadFacts: (caseId: string) => Promise<CaseFacts>,
): Promise<void> {
  const now = new Date();

  const waiting = await db
    .select({ id: cases.id, tenantId: cases.tenantId, nextActionAt: cases.nextActionAt })
    .from(cases)
    .where(
      and(
        eq(cases.state, "NEW"),
        gt(cases.nextActionAt, new Date(now.getTime() + MIN_LEAD_MS)),
        sql`not exists (
          select 1 from outreach o where o.case_id = ${cases.id} and o.sent_at is null
        )`,
      ),
    );

  for (const caseRow of waiting) {
    const scheduledFor = caseRow.nextActionAt;
    if (!scheduledFor) continue;
    if (scheduledFor.getTime() - now.getTime() > MAX_LEAD_MS) continue;

    try {
      const facts = await loadFacts(caseRow.id);

      await llmRateLimiter.acquire();
      const outcome = await runDraftLoop(model, MODEL, caseRow.id, facts, async (entry) => {
        await db.insert(agentActions).values({
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          tool: entry.tool,
          input: entry.input,
          output: entry.output,
          model: entry.model,
          latencyMs: entry.latencyMs,
        });
      });

      if (outcome.status !== "valid") continue;

      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: outreach.id })
          .from(outreach)
          .where(and(eq(outreach.caseId, caseRow.id), isNull(outreach.sentAt)))
          .limit(1);
        if (existing) return;

        await tx.insert(outreach).values({
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          subject: outcome.draft.subject,
          body: outcome.draft.bodyText,
          scheduledFor,
        });

        await appendCaseEvent(tx, {
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          fromState: "NEW",
          toState: "NEW",
          reason: "draft_scheduled",
          actor: "agent",
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("scheduled_draft_failed", { caseId: caseRow.id, error: message });
    }
  }
}
