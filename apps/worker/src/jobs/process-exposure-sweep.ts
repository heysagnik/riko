import { and, eq, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db, cases, exposures, payments, appendCaseEvent } from "@riko/db";
import { ABANDONMENT_SWEEP_MINUTES } from "@riko/core";
import { log } from "../lib/logger.js";

const HOLDOUT_PERCENT = Number(process.env.HOLDOUT_PERCENT ?? 5);

function assignArm(): "treatment" | "holdout" {
  return randomInt(100) < HOLDOUT_PERCENT ? "holdout" : "treatment";
}

export async function processExposureSweep(now: Date = new Date()): Promise<number> {
  const abandonedBefore = new Date(now.getTime() - ABANDONMENT_SWEEP_MINUTES * 60 * 1000);

  const due = await db
    .select({
      id: exposures.id,
      tenantId: exposures.tenantId,
      customerId: exposures.customerId,
      kind: exposures.kind,
      sourceRef: exposures.sourceRef,
    })
    .from(exposures)
    .where(
      and(
        inArray(exposures.kind, ["checkout_abandonment", "overdue_receivable"]),
        isNull(exposures.resolvedAt),
        or(
          and(eq(exposures.kind, "checkout_abandonment"), lte(exposures.occurredAt, abandonedBefore)),
          and(eq(exposures.kind, "overdue_receivable"), lte(exposures.dueAt, now)),
        ),
        notExists(
          db.select({ one: sql`1` }).from(cases).where(eq(cases.exposureId, exposures.id)),
        ),
      ),
    )
    .limit(200);

  let opened = 0;

  for (const exposure of due) {
    if (exposure.kind === "checkout_abandonment") {
      const [failed] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, exposure.tenantId),
            eq(payments.providerCorrelationId, exposure.sourceRef),
          ),
        )
        .limit(1);

      if (failed) {
        await db
          .update(exposures)
          .set({ resolvedAt: new Date() })
          .where(eq(exposures.id, exposure.id));
        continue;
      }
    }

    try {
      await db.transaction(async (tx) => {
        const [caseRow] = await tx
          .insert(cases)
          .values({
            tenantId: exposure.tenantId,
            exposureId: exposure.id,
            customerId: exposure.customerId,
            state: "NEW",
            arm: assignArm(),
          })
          .returning({ id: cases.id });

        await appendCaseEvent(tx, {
          tenantId: exposure.tenantId,
          caseId: caseRow!.id,
          fromState: null,
          toState: "NEW",
          reason:
            exposure.kind === "checkout_abandonment"
              ? "checkout_abandoned"
              : "receivable_past_due",
          actor: "system",
        });
      });
      opened += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("exposure_case_open_failed", { exposureId: exposure.id, error: message });
    }
  }

  return opened;
}
