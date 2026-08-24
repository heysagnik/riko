import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, cases, customers, appendCaseEvent } from "@riko/db";
import { applyTransition, isWithinContactWindow, MAX_ATTEMPTS } from "@riko/core";
import { localHourFor, nextContactWindowOpen } from "../lib/local-day.js";

const BATCH_LIMIT = 200;

export async function processWaitingCases(now: Date = new Date()): Promise<void> {
  const due = await db
    .select({
      id: cases.id,
      tenantId: cases.tenantId,
      attemptCount: cases.attemptCount,
      nextActionAt: cases.nextActionAt,
      timezone: customers.timezone,
    })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .where(
      and(
        eq(cases.state, "WAITING"),
        eq(cases.awaitingAgentReply, false),
        or(isNull(cases.nextActionAt), lte(cases.nextActionAt, now)),
      ),
    )
    .limit(BATCH_LIMIT);

  for (const caseRow of due) {
    if (!isWithinContactWindow(localHourFor(caseRow.timezone))) {
      const retryAt = nextContactWindowOpen(caseRow.timezone);
      const deferred = await db
        .update(cases)
        .set({ nextActionAt: retryAt })
        .where(
          and(
            eq(cases.id, caseRow.id),
            eq(cases.state, "WAITING"),
            or(isNull(cases.nextActionAt), lte(cases.nextActionAt, now)),
          ),
        )
        .returning({ id: cases.id });

      if (deferred.length === 0) continue;

      await appendCaseEvent(db, {
        tenantId: caseRow.tenantId,
        caseId: caseRow.id,
        fromState: "WAITING",
        toState: "WAITING",
        reason: "deferred:outside_contact_window",
        actor: "system",
      });
      continue;
    }

    const exhausted = caseRow.attemptCount >= MAX_ATTEMPTS;
    const transition = applyTransition("WAITING", {
      type: exhausted ? "cooldown_elapsed_exhausted" : "cooldown_elapsed_retry",
    });

    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(cases)
        .set({
          state: transition.toState,
          closedAt: transition.toState === "LOST" ? new Date() : null,
          closedReason: transition.reason,
          nextActionAt: null,
        })
        .where(and(eq(cases.id, caseRow.id), eq(cases.state, "WAITING"), eq(cases.awaitingAgentReply, false)))
        .returning({ id: cases.id });

      if (claimed.length === 0) return;

      await appendCaseEvent(tx, {
        tenantId: caseRow.tenantId,
        caseId: caseRow.id,
        fromState: "WAITING",
        toState: transition.toState,
        reason: transition.reason,
        actor: "system",
      });
    });
  }
}
