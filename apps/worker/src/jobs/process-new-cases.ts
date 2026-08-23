import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, cases, appendCaseEvent } from "@riko/db";
import { evaluateGates, applyTransition, routeIntervention, type GateCaseInput } from "@riko/core";
import type { RouteCaseInput } from "../loaders/load-route-input.js";

export interface ProcessNewCasesDeps {
  loadGateInput: (caseId: string) => Promise<GateCaseInput>;
  loadRouteInput: (caseId: string) => Promise<RouteCaseInput>;
  now?: Date;
}

export async function processNewCases({ loadGateInput, loadRouteInput, now: nowOverride }: ProcessNewCasesDeps): Promise<void> {
  const now = nowOverride ?? new Date();

  const dueCases = await db
    .select()
    .from(cases)
    .where(and(eq(cases.state, "NEW"), or(isNull(cases.nextActionAt), lte(cases.nextActionAt, now))));

  for (const caseRow of dueCases) {
    const routeInput = await loadRouteInput(caseRow.id);
    const intervention = routeIntervention({ ...routeInput, now });

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

    if (intervention.kind === "stop_never_contact" || intervention.kind === "escalate_human") {
      const toState = intervention.kind === "stop_never_contact" ? "SKIPPED" : "ESCALATED";
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

    const gateInput = await loadGateInput(caseRow.id);
    const gateResult = evaluateGates(gateInput);

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
