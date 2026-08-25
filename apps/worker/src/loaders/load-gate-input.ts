import { eq, and, desc, gte, isNotNull, sql } from "drizzle-orm";
import { db, cases, customers, connections, senderIdentities, exposures, payments, outreach } from "@riko/db";
import type { GateCaseInput } from "@riko/core";
import { localHourFor, startOfLocalDay } from "../lib/local-day.js";

export async function loadGateInput(caseId: string): Promise<GateCaseInput> {
  const [caseRow] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!caseRow) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, caseRow.customerId)).limit(1);
  const [exposure] = await db.select().from(exposures).where(eq(exposures.id, caseRow.exposureId)).limit(1);
  if (!customer || !exposure) {
    throw new Error(`Missing customer or exposure for case: ${caseId}`);
  }

  const [payment] = exposure.paymentId
    ? await db.select().from(payments).where(eq(payments.id, exposure.paymentId)).limit(1)
    : [];

  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.tenantId, caseRow.tenantId))
    .limit(1);
  const senderReady = Boolean(sender?.smtpHost && sender.smtpUser && sender.smtpPasswordEncrypted);

  const [lastOutreach] = await db
    .select()
    .from(outreach)
    .where(eq(outreach.caseId, caseId))
    .orderBy(desc(outreach.sentAt))
    .limit(1);

  const startOfDay = startOfLocalDay(new Date());
  const sentToday = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreach)
    .where(
      and(
        eq(outreach.tenantId, caseRow.tenantId),
        isNotNull(outreach.sentAt),
        gte(outreach.sentAt, startOfDay),
      ),
    );

  const dailyCap = sender?.dailySendCap ?? 500;
  const ageFrom = exposure.kind === "overdue_receivable" && exposure.dueAt
    ? exposure.dueAt
    : exposure.occurredAt;
  const paymentAgeDays = (Date.now() - ageFrom.getTime()) / (1000 * 60 * 60 * 24);
  const hoursSinceLastOutreach = lastOutreach?.sentAt
    ? (Date.now() - lastOutreach.sentAt.getTime()) / (1000 * 60 * 60)
    : null;

  return {
    exposureKind: exposure.kind,
    customerSuppressed: Boolean(customer.suppressedAt),
    localHour: localHourFor(customer.timezone),
    customerHasDeliverableEmail: Boolean(customer.emailEncrypted),
    customerUnsubscribed: Boolean(customer.unsubscribedAt),
    customerHasBounced: Boolean(customer.bouncedAt),
    tenantHasVerifiedSender: senderReady,
    attemptCount: caseRow.attemptCount,
    hoursSinceLastOutreach,
    failureCategory: payment?.failureCategory ?? "unknown",
    failureRecoverable: payment ? payment.failureRecoverable : true,
    paymentAgeDays,
    tenantPaused: sender?.outreachPaused ?? false,
    tenantWithinDailySendCap: (sentToday[0]?.count ?? 0) < dailyCap,
  };
}
