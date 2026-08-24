import { eq } from "drizzle-orm";
import { db, cases, customers, exposures, payments, organization, outreach } from "@riko/db";
import type { CaseFacts } from "@riko/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadCaseFacts(caseId: string): Promise<CaseFacts> {
  const [caseRow] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!caseRow) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, caseRow.customerId)).limit(1);
  const [exposure] = await db.select().from(exposures).where(eq(exposures.id, caseRow.exposureId)).limit(1);
  const [tenant] = await db.select().from(organization).where(eq(organization.id, caseRow.tenantId)).limit(1);
  const priorOutreach = await db.select().from(outreach).where(eq(outreach.caseId, caseId));

  if (!customer || !exposure || !tenant) {
    throw new Error(`Missing facts for case: ${caseId}`);
  }

  const [payment] = exposure.paymentId
    ? await db.select().from(payments).where(eq(payments.id, exposure.paymentId)).limit(1)
    : [];

  const baseUrl = process.env.APP_BASE_URL ?? "https://app.example.com";
  const daysOverdue = exposure.dueAt
    ? Math.max(0, Math.floor((Date.now() - exposure.dueAt.getTime()) / DAY_MS))
    : null;

  return {
    caseId,
    exposureKind: exposure.kind,
    rung: caseRow.rung,
    language: customer.locale === "hinglish" || customer.locale?.startsWith("hi") ? "hinglish" : "english",
    amountMinor: exposure.amountMinor,
    currency: exposure.currency,
    failureCategory: payment?.failureCategory ?? "unknown",
    customerName: customer.name ?? "there",
    attemptNumber: caseRow.attemptCount + 1,
    priorSubjects: priorOutreach.map((o) => o.subject),
    merchantName: tenant.name,
    daysOverdue,
    updatePaymentMethodUrl: `${baseUrl}/pay/${caseId}`,
    unsubscribeUrl: `${baseUrl}/unsubscribe/${customer.id}`,
  };
}
