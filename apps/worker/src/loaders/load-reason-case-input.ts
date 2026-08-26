import { and, eq, gte, ne, sql, desc } from "drizzle-orm";
import { db, cases, customers, exposures, payments, organization, caseEvents } from "@riko/db";
import type { ReasonPaymentCaseInput } from "@riko/agent";
import { loadAgentSettings } from "./load-agent-settings.js";

const REPEAT_WINDOW_DAYS = 30;

export async function loadReasonCaseInput(caseId: string, now: Date = new Date()): Promise<ReasonPaymentCaseInput> {
  const [row] = await db
    .select({
      id: cases.id,
      attemptCount: cases.attemptCount,
      customerId: cases.customerId,
      tenantId: cases.tenantId,
      exposureId: exposures.id,
      exposureKind: exposures.kind,
      amountMinor: exposures.amountMinor,
      currency: exposures.currency,
      occurredAt: exposures.occurredAt,
      exposureRetryAt: exposures.providerRetryAt,
      exposureCategory: exposures.failureCategory,
      failureCategory: payments.failureCategory,
      failureSource: payments.failureSource,
      failureCode: payments.failureCode,
      raw: payments.raw,
      paymentRetryAt: payments.providerRetryAt,
      customerName: customers.name,
      tenantName: organization.name,
    })
    .from(cases)
    .innerJoin(exposures, eq(exposures.id, cases.exposureId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(organization, eq(organization.id, cases.tenantId))
    .leftJoin(payments, eq(payments.id, exposures.paymentId))
    .where(eq(cases.id, caseId))
    .limit(1);

  if (!row) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
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

  const events = await db
    .select({ reason: caseEvents.reason })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId))
    .orderBy(desc(caseEvents.createdAt))
    .limit(5);

  const recentNotes = events
    .map((e) => e.reason)
    .filter(Boolean)
    .join("; ");

  const rawObj = row.raw && typeof row.raw === "object" ? (row.raw as Record<string, unknown>) : null;
  const failureDescription =
    typeof rawObj?.error_description === "string"
      ? rawObj.error_description
      : typeof rawObj?.message === "string"
        ? rawObj.message
        : null;

  const baseUrl = process.env.APP_BASE_URL ?? "https://app.example.com";
  const hoursSinceFailure = Math.max(0, (now.getTime() - row.occurredAt.getTime()) / (60 * 60 * 1000));
  const providerRetry = row.paymentRetryAt ?? row.exposureRetryAt;
  const settings = await loadAgentSettings(row.tenantId);

  return {
    caseId,
    merchantName: row.tenantName,
    customerName: row.customerName ?? "Customer",
    amountMinor: row.amountMinor,
    currency: row.currency,
    failureCode: row.failureCode,
    failureDescription,
    failureCategoryHint: row.failureCategory ?? row.exposureCategory ?? "unknown",
    failureSourceHint: row.failureSource ?? "unknown",
    attemptCount: row.attemptCount,
    priorExposures: prior?.n ?? 0,
    hoursSinceFailure,
    providerRetryAt: providerRetry ? providerRetry.toISOString() : null,
    updatePaymentMethodUrl: `${baseUrl}/pay/${caseId}`,
    unsubscribeUrl: `${baseUrl}/unsubscribe/${row.customerId}`,
    additionalContext: recentNotes || null,
    merchantGuidance: settings.additionalInstructions || null,
    tone: settings.tone,
    highValue: settings.highValueThresholdMinor > 0 && row.amountMinor >= settings.highValueThresholdMinor,
    now,
  };
}
