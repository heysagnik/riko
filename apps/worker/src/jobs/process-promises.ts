import { and, eq, lte } from "drizzle-orm";
import { db, cases, promises, appendCaseEvent } from "@riko/db";
import { applyTransition } from "@riko/core";

const HOUR_MS = 60 * 60 * 1000;

/** Silence after a broken promise, before the ladder is allowed to resume. */
const COOLING_OFF_HOURS = 72;

/**
 * Judges promises that have come due. A kept promise closes itself through the
 * payment webhook, so anything still open past its date was broken.
 */
export async function processPromises(now: Date = new Date()): Promise<{ broken: number }> {
  const overdue = await db
    .select({
      id: promises.id,
      tenantId: promises.tenantId,
      caseId: promises.caseId,
      promisedFor: promises.promisedFor,
      state: cases.state,
      attemptCount: cases.attemptCount,
    })
    .from(promises)
    .innerJoin(cases, eq(cases.id, promises.caseId))
    .where(and(eq(promises.state, "open"), lte(promises.promisedFor, now)))
    .limit(200);

  let broken = 0;

  for (const row of overdue) {
    if (row.state === "RECOVERED") {
      await db
        .update(promises)
        .set({ state: "kept", resolvedAt: now })
        .where(eq(promises.id, row.id));
      continue;
    }

    if (row.state !== "PROMISED") {
      await db
        .update(promises)
        .set({ state: "cancelled", resolvedAt: now })
        .where(eq(promises.id, row.id));
      continue;
    }

    const transition = applyTransition("PROMISED", { type: "promise_broken" });

    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(cases)
        .set({
          state: transition.toState,
          closedReason: transition.reason,
          nextActionAt: new Date(now.getTime() + COOLING_OFF_HOURS * HOUR_MS),
        })
        .where(and(eq(cases.id, row.caseId), eq(cases.state, "PROMISED")))
        .returning({ id: cases.id });

      if (claimed.length === 0) return;

      await tx.update(promises).set({ state: "broken", resolvedAt: now }).where(eq(promises.id, row.id));

      await appendCaseEvent(tx, {
        tenantId: row.tenantId,
        caseId: row.caseId,
        fromState: "PROMISED",
        toState: transition.toState,
        reason: transition.reason,
        actor: "system",
      });
    });

    broken += 1;
  }

  return { broken };
}
