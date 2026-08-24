import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db, cases, exposures, payments } from "@riko/db";
import type { InterventionInput } from "@riko/core";
import type { FailureSource } from "@riko/shared";

export type RouteCaseInput = Omit<InterventionInput, "now">;

const HUMAN_REVIEW_MINOR = Number(process.env.HUMAN_REVIEW_MINOR ?? 25_000_00);
const REPEAT_WINDOW_DAYS = 30;

export async function loadRouteInput(caseId: string): Promise<RouteCaseInput> {
  const [row] = await db
    .select({
      attemptCount: cases.attemptCount,
      humanReviewedAt: cases.humanReviewedAt,
      customerId: cases.customerId,
      exposureId: exposures.id,
      exposureKind: exposures.kind,
      amountMinor: exposures.amountMinor,
      occurredAt: exposures.occurredAt,
      dueAt: exposures.dueAt,
      exposureRetryAt: exposures.providerRetryAt,
      exposureCategory: exposures.failureCategory,
      failureCategory: payments.failureCategory,
      failureSource: payments.failureSource,
      failureCode: payments.failureCode,
      paymentRetryAt: payments.providerRetryAt,
    })
    .from(cases)
    .innerJoin(exposures, eq(exposures.id, cases.exposureId))
    .leftJoin(payments, eq(payments.id, exposures.paymentId))
    .where(eq(cases.id, caseId))
    .limit(1);

  if (!row) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [prior] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(exposures)
    .where(
      and(
        eq(exposures.customerId, row.customerId),
        eq(exposures.kind, row.exposureKind),
        ne(exposures.id, row.exposureId),
        gte(exposures.occurredAt, since),
      ),
    );

  return {
    exposureKind: row.exposureKind,
    failureCategory: row.failureCategory ?? row.exposureCategory ?? "unknown",
    failureSource: (row.failureSource as FailureSource | null) ?? "unknown",
    failureCode: row.failureCode,
    amountMinor: row.amountMinor,
    providerRetryAt: row.paymentRetryAt ?? row.exposureRetryAt,
    occurredAt: row.occurredAt,
    dueAt: row.dueAt,
    attemptCount: row.attemptCount,
    priorExposures: prior?.n ?? 0,
    humanReviewMinor: HUMAN_REVIEW_MINOR,
    humanApproved: Boolean(row.humanReviewedAt),
  };
}
