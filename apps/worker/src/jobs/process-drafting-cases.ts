import { and, eq, isNull } from "drizzle-orm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { db, cases, agentActions, outreach, appendCaseEvent } from "@riko/db";
import { applyTransition } from "@riko/core";

const DRAFT_FRESH_MS = 12 * 60 * 60 * 1000;
import { runDraftLoop } from "@riko/agent";
import type { CaseFacts } from "@riko/shared";

const nim = createOpenAICompatible({
  name: "nvidia-nim",
  baseURL: process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY ?? "",
});
const MODEL = process.env.NVIDIA_NIM_MODEL ?? "meta/llama-3.1-8b-instruct";
const model = nim.chatModel(MODEL);

export async function processDraftingCases(loadFacts: (caseId: string) => Promise<CaseFacts>): Promise<void> {
  const draftingCases = await db.select().from(cases).where(eq(cases.state, "DRAFTING"));

  for (const caseRow of draftingCases) {
    try {
      const [stillDrafting] = await db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, caseRow.id), eq(cases.state, "DRAFTING")))
        .limit(1);
      if (!stillDrafting) continue;

      const [pending] = await db
        .select({ id: outreach.id, createdAt: outreach.createdAt })
        .from(outreach)
        .where(and(eq(outreach.caseId, caseRow.id), isNull(outreach.sentAt)))
        .limit(1);

      if (pending) {
        const fresh = Date.now() - pending.createdAt.getTime() < DRAFT_FRESH_MS;
        if (fresh) {
          const transition = applyTransition(caseRow.state, { type: "draft_valid" });
          await db.transaction(async (tx) => {
            const claimed = await tx
              .update(cases)
              .set({ state: transition.toState, closedAt: null, closedReason: transition.reason })
              .where(and(eq(cases.id, caseRow.id), eq(cases.state, "DRAFTING")))
              .returning({ id: cases.id });
            if (claimed.length === 0) return;
            await tx.update(outreach).set({ scheduledFor: null }).where(eq(outreach.id, pending.id));
            await appendCaseEvent(tx, {
              tenantId: caseRow.tenantId,
              caseId: caseRow.id,
              fromState: caseRow.state,
              toState: transition.toState,
              reason: "scheduled_draft_used",
              actor: "agent",
            });
          });
          continue;
        }
        await db.delete(outreach).where(eq(outreach.id, pending.id));
      }

      const facts = await loadFacts(caseRow.id);

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

      const trigger =
        outcome.status === "valid"
          ? ({ type: "draft_valid" } as const)
          : ({ type: "draft_invalid_exhausted" } as const);

      const transition = applyTransition(caseRow.state, trigger);

      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(cases)
          .set({
            state: transition.toState,
            closedAt: transition.toState === "ESCALATED" ? new Date() : null,
            closedReason: transition.reason,
          })
          .where(and(eq(cases.id, caseRow.id), eq(cases.state, "DRAFTING")))
          .returning({ id: cases.id });

        if (claimed.length === 0) return;

        await appendCaseEvent(tx, {
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          fromState: caseRow.state,
          toState: transition.toState,
          reason: transition.reason,
          actor: "agent",
        });

        if (outcome.status === "valid") {
          await tx.insert(outreach).values({
            tenantId: caseRow.tenantId,
            caseId: caseRow.id,
            subject: outcome.draft.subject,
            body: outcome.draft.bodyText,
          });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Case not found|Missing facts/.test(message)) continue;
      process.stderr.write(`processDraftingCases: case ${caseRow.id} failed, will retry next tick: ${message}\n`);
    }
  }
}
