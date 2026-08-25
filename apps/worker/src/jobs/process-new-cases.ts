import { and, eq, isNull, lte, or } from "drizzle-orm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { db, cases, customers, senderIdentities, appendCaseEvent, agentActions } from "@riko/db";
import { evaluateGates, applyTransition, routeIntervention, type GateCaseInput } from "@riko/core";
import { reasonPaymentCase, type ReasonPaymentCaseInput } from "@riko/agent";
import type { RouteCaseInput } from "../loaders/load-route-input.js";
import { loadReasonCaseInput as defaultLoadReasonCaseInput } from "../loaders/load-reason-case-input.js";
import { llmRateLimiter } from "../lib/rate-limiter.js";
import { alert, log } from "../lib/logger.js";
import { nextContactWindowOpen } from "../lib/local-day.js";

export interface ProcessNewCasesDeps {
  loadGateInput: (caseId: string) => Promise<GateCaseInput>;
  loadRouteInput: (caseId: string) => Promise<RouteCaseInput>;
  loadReasonCaseInput?: (caseId: string, now?: Date) => Promise<ReasonPaymentCaseInput>;
  now?: Date;
}

const BATCH_LIMIT = 200;
const DEFER_MINUTES = 60;

const TRANSIENT_GATE_REASONS = new Set(["outside_contact_window", "tenant_paused_or_capped", "cooldown_not_elapsed"]);

const nim = createOpenAICompatible({
  name: "nvidia-nim",
  baseURL: process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY ?? "",
});
const MODEL = process.env.NVIDIA_NIM_MODEL ?? "meta/llama-3.1-8b-instruct";
const model = nim.chatModel(MODEL);

async function alertWebhookFor(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ url: senderIdentities.alertWebhookUrl })
    .from(senderIdentities)
    .where(eq(senderIdentities.tenantId, tenantId))
    .limit(1);
  return row?.url ?? null;
}

async function nextWindowOpenForCustomer(customerId: string): Promise<Date> {
  const [row] = await db
    .select({ timezone: customers.timezone })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return nextContactWindowOpen(row?.timezone ?? null);
}

export async function processNewCases({
  loadGateInput,
  loadRouteInput,
  loadReasonCaseInput = defaultLoadReasonCaseInput,
  now: nowOverride,
}: ProcessNewCasesDeps): Promise<void> {
  const now = nowOverride ?? new Date();

  const dueCases = await db
    .select()
    .from(cases)
    .where(and(eq(cases.state, "NEW"), or(isNull(cases.nextActionAt), lte(cases.nextActionAt, now))))
    .limit(BATCH_LIMIT);

  for (const caseRow of dueCases) {
    const routeInput = await loadRouteInput(caseRow.id);
    let intervention = routeIntervention({ ...routeInput, now });

    if (caseRow.arm === "holdout") {
      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(cases)
          .set({
            state: "SKIPPED",
            closedAt: new Date(),
            closedReason: "holdout_control_group",
            intervention: intervention.kind,
            interventionReason: intervention.reason,
          })
          .where(and(eq(cases.id, caseRow.id), eq(cases.state, caseRow.state)))
          .returning({ id: cases.id });

        if (claimed.length === 0) return;

        await appendCaseEvent(tx, {
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          fromState: caseRow.state,
          toState: "SKIPPED",
          reason: "holdout_control_group",
          actor: "system",
        });
      });
      continue;
    }

    if (intervention.kind === "stop_never_contact" || intervention.kind === "escalate_human") {
      const toState = intervention.kind === "stop_never_contact" ? "SKIPPED" : "ESCALATED";

      if (toState === "ESCALATED") {
        alert(
          "case_escalated_to_human",
          {
            caseId: caseRow.id,
            tenantId: caseRow.tenantId,
            reason: intervention.reason,
          },
          await alertWebhookFor(caseRow.tenantId),
        );
      }
      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(cases)
          .set({
            state: toState,
            closedAt: new Date(),
            closedReason: intervention.reason,
            intervention: intervention.kind,
            interventionReason: intervention.reason,
          })
          .where(and(eq(cases.id, caseRow.id), eq(cases.state, caseRow.state)))
          .returning({ id: cases.id });

        if (claimed.length === 0) return;

        await appendCaseEvent(tx, {
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          fromState: caseRow.state,
          toState,
          reason: intervention.reason,
          actor: "system",
        });
      });
      continue;
    }

    if (intervention.kind === "wait_until" || intervention.kind === "no_action_provider_retrying") {
      const waitUntil = intervention.waitUntil ?? new Date(now.getTime() + 6 * 60 * 60 * 1000);
      const claimed = await db
        .update(cases)
        .set({
          nextActionAt: waitUntil,
          intervention: intervention.kind,
          interventionReason: intervention.reason,
        })
        .where(and(eq(cases.id, caseRow.id), eq(cases.state, caseRow.state), or(isNull(cases.nextActionAt), lte(cases.nextActionAt, now))))
        .returning({ id: cases.id });

      if (claimed.length === 0) continue;

      await appendCaseEvent(db, {
        tenantId: caseRow.tenantId,
        caseId: caseRow.id,
        fromState: "NEW",
        toState: "NEW",
        reason: `${intervention.kind}:${intervention.reason}`,
        actor: "system",
      });
      continue;
    }

    if (intervention.kind === "outreach_email" && routeInput.exposureKind === "payment_failure") {
      try {
        const reasonInput = await loadReasonCaseInput(caseRow.id, now);
        await llmRateLimiter.acquire();
        const startMs = Date.now();
        const reasoning = await reasonPaymentCase(model, reasonInput);
        const latencyMs = Date.now() - startMs;

        await db.insert(agentActions).values({
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          tool: "reason_payment_case",
          input: reasonInput as unknown as Record<string, unknown>,
          output: reasoning as unknown as Record<string, unknown>,
          model: MODEL,
          latencyMs,
        });

        if (reasoning.decision === "stop") {
          await db.transaction(async (tx) => {
            const claimed = await tx
              .update(cases)
              .set({
                state: "SKIPPED",
                closedAt: new Date(),
                closedReason: `agent_stopped:${reasoning.rationale}`,
                intervention: "stop_never_contact",
                interventionReason: reasoning.rationale,
              })
              .where(and(eq(cases.id, caseRow.id), eq(cases.state, caseRow.state)))
              .returning({ id: cases.id });

            if (claimed.length === 0) return;

            await appendCaseEvent(tx, {
              tenantId: caseRow.tenantId,
              caseId: caseRow.id,
              fromState: caseRow.state,
              toState: "SKIPPED",
              reason: `agent_stopped:${reasoning.rationale}`,
              actor: "agent",
            });
          });
          continue;
        }

        if (reasoning.decision === "escalate") {
          alert(
            "case_escalated_to_human",
            {
              caseId: caseRow.id,
              tenantId: caseRow.tenantId,
              reason: reasoning.rationale,
            },
            await alertWebhookFor(caseRow.tenantId),
          );

          await db.transaction(async (tx) => {
            const claimed = await tx
              .update(cases)
              .set({
                state: "ESCALATED",
                closedAt: new Date(),
                closedReason: `agent_escalated:${reasoning.rationale}`,
                intervention: "escalate_human",
                interventionReason: reasoning.rationale,
              })
              .where(and(eq(cases.id, caseRow.id), eq(cases.state, caseRow.state)))
              .returning({ id: cases.id });

            if (claimed.length === 0) return;

            await appendCaseEvent(tx, {
              tenantId: caseRow.tenantId,
              caseId: caseRow.id,
              fromState: caseRow.state,
              toState: "ESCALATED",
              reason: `agent_escalated:${reasoning.rationale}`,
              actor: "agent",
            });
          });
          continue;
        }

        if (reasoning.decision === "wait") {
          const waitHours = reasoning.waitHours ?? 6;
          const waitUntil = new Date(now.getTime() + waitHours * 60 * 60 * 1000);
          const claimed = await db
            .update(cases)
            .set({
              nextActionAt: waitUntil,
              intervention: "wait_until",
              interventionReason: reasoning.rationale,
            })
            .where(and(eq(cases.id, caseRow.id), eq(cases.state, caseRow.state), or(isNull(cases.nextActionAt), lte(cases.nextActionAt, now))))
            .returning({ id: cases.id });

          if (claimed.length === 0) continue;

          await appendCaseEvent(db, {
            tenantId: caseRow.tenantId,
            caseId: caseRow.id,
            fromState: "NEW",
            toState: "NEW",
            reason: `agent_wait:${reasoning.rationale}`,
            actor: "agent",
          });
          continue;
        }

        if (reasoning.decision === "contact") {
          intervention = {
            kind: "outreach_email",
            reason: reasoning.rationale,
            waitUntil: null,
            rung: reasoning.rung ?? intervention.rung ?? "instrument_fix",
          };
        }
      } catch (error) {
        log.error("reason_payment_case_failed_fallback_deterministic", {
          caseId: caseRow.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const gateInput = await loadGateInput(caseRow.id);
    const gateResult = evaluateGates(gateInput);

    if (!gateResult.eligible && TRANSIENT_GATE_REASONS.has(gateResult.reason ?? "")) {
      const retryAt =
        gateResult.reason === "outside_contact_window"
          ? await nextWindowOpenForCustomer(caseRow.customerId)
          : new Date(now.getTime() + DEFER_MINUTES * 60 * 1000);
      const claimed = await db
        .update(cases)
        .set({ nextActionAt: retryAt })
        .where(and(eq(cases.id, caseRow.id), eq(cases.state, "NEW"), or(isNull(cases.nextActionAt), lte(cases.nextActionAt, now))))
        .returning({ id: cases.id });

      if (claimed.length === 0) continue;

      await appendCaseEvent(db, {
        tenantId: caseRow.tenantId,
        caseId: caseRow.id,
        fromState: "NEW",
        toState: "NEW",
        reason: `deferred:${gateResult.reason}`,
        actor: "system",
      });
      continue;
    }

    const trigger = gateResult.eligible
      ? ({ type: "gates_passed" } as const)
      : ({ type: "gates_failed", reason: gateResult.reason ?? "unknown" } as const);

    const transition = applyTransition(caseRow.state, trigger);

    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(cases)
        .set({
          state: transition.toState,
          closedAt: transition.toState === "SKIPPED" ? new Date() : null,
          closedReason: transition.reason,
          intervention: intervention.kind,
          interventionReason: intervention.reason,
          rung: intervention.rung ?? null,
        })
        .where(and(eq(cases.id, caseRow.id), eq(cases.state, caseRow.state)))
        .returning({ id: cases.id });

      if (claimed.length === 0) return;

      await appendCaseEvent(tx, {
        tenantId: caseRow.tenantId,
        caseId: caseRow.id,
        fromState: caseRow.state,
        toState: transition.toState,
        reason: transition.reason,
        actor: "system",
      });
    });
  }
}

