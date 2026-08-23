import type { Database } from "@riko/db";
import { webhookEvents, customers, payments, exposures, cases, failureCodeMap, appendCaseEvent } from "@riko/db";
import type { PaymentProvider, ProviderEvent, NormalizedEvent } from "@riko/core";
import { applyTransition, encryptSecret } from "@riko/core";
import { eq, and, desc, inArray } from "drizzle-orm";
import { randomInt } from "node:crypto";

const HOLDOUT_PERCENT = Number(process.env.HOLDOUT_PERCENT ?? 5);

function assignArm(): "treatment" | "holdout" {
  return randomInt(100) < HOLDOUT_PERCENT ? "holdout" : "treatment";
}

export interface WebhookConnectionCandidate {
  connectionId: string;
  tenantId: string;
  secret: string;
}

export interface HandleWebhookInput {
  db: Database;
  provider: PaymentProvider;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  candidates: WebhookConnectionCandidate[];
  encryptionKey: string;
}

export type HandleWebhookResult =
  | { status: "processed"; caseId: string | null }
  | { status: "duplicate" }
  | { status: "ignored" };

function verifyAgainstCandidates(
  provider: PaymentProvider,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  candidates: WebhookConnectionCandidate[],
): { event: ProviderEvent; candidate: WebhookConnectionCandidate } {
  for (const candidate of candidates) {
    try {
      const event = provider.verifyWebhook(rawBody, headers, candidate.secret);
      return { event, candidate };
    } catch {
      continue;
    }
  }
  throw new Error(`Webhook signature did not match any active ${provider.id} connection`);
}

const RECOVERABLE_CATEGORIES = new Set<NormalizedEvent["failureCategory"]>([
  "network_error",
  "insufficient_funds",
  "bank_decline",
  "expired_card",
  "authentication_required",
  "invalid_instrument",
]);

async function lookupFailureCategory(
  db: Database,
  event: NormalizedEvent,
): Promise<{ failureCategory: NormalizedEvent["failureCategory"]; recoverable: boolean }> {
  if (!event.failureCode) {
    return { failureCategory: event.failureCategory ?? "unknown", recoverable: false };
  }
  const [entry] = await db
    .select()
    .from(failureCodeMap)
    .where(and(eq(failureCodeMap.providerId, event.providerId), eq(failureCodeMap.providerCode, event.failureCode)))
    .limit(1);

  const adapterCategory = event.failureCategory ?? "unknown";

  // A mapped "unknown" records that the code itself carries no diagnosis, so it
  // must not outrank what the adapter inferred from the failure description.
  // Razorpay's generic `payment_failed` is exactly this case.
  if (entry && !(entry.failureCategory === "unknown" && adapterCategory !== "unknown")) {
    return { failureCategory: entry.failureCategory, recoverable: entry.recoverable };
  }

  return { failureCategory: adapterCategory, recoverable: RECOVERABLE_CATEGORIES.has(adapterCategory) };
}

async function upsertCustomer(
  db: Database,
  tenantId: string,
  event: NormalizedEvent,
  encryptionKey: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, tenantId),
        eq(customers.providerId, event.providerId),
        eq(customers.providerCustomerId, event.providerCustomerId),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const [inserted] = await db
    .insert(customers)
    .values({
      tenantId,
      providerId: event.providerId,
      providerCustomerId: event.providerCustomerId,
      emailEncrypted: encryptSecret(event.providerCustomerEmail ?? event.providerCustomerId, encryptionKey),
      phoneEncrypted: event.providerCustomerContact
        ? encryptSecret(event.providerCustomerContact, encryptionKey)
        : null,
      name: event.providerCustomerName,
      locale: null,
    })
    .returning({ id: customers.id });

  return inserted!.id;
}

const OPEN_STATES = ["NEW", "DRAFTING", "SENDING", "WAITING", "PROMISED"] as const;

// Customer alone misattributes when several cases are open, so prefer the case
// id we stamped on the pay link, then invoice/order id, then an unambiguous
// amount match, then most recent.
async function findRecoveredCase(
  db: Database,
  tenantId: string,
  customerId: string,
  event: NormalizedEvent,
) {
  const rows = await db
    .select({
      case: cases,
      exposureId: exposures.id,
      sourceRef: exposures.sourceRef,
      correlationId: payments.providerCorrelationId,
      amountMinor: exposures.amountMinor,
    })
    .from(cases)
    .innerJoin(exposures, eq(exposures.id, cases.exposureId))
    .leftJoin(payments, eq(payments.id, exposures.paymentId))
    .where(
      and(
        eq(cases.tenantId, tenantId),
        eq(cases.customerId, customerId),
        inArray(cases.state, [...OPEN_STATES, "SKIPPED"]),
      ),
    )
    .orderBy(desc(cases.openedAt));

  if (rows.length === 0) return null;

  // Suppressed cases are searchable for holdout recovery, but rank last.
  const open = [
    ...rows.filter((r) => r.case.state !== "SKIPPED"),
    ...rows.filter((r) => r.case.state === "SKIPPED"),
  ];

  if (event.caseIdHint) {
    const hinted = open.find((row) => row.case.id === event.caseIdHint);
    if (hinted) return hinted;
  }

  if (event.providerCorrelationId) {
    const exact = open.find(
      (row) =>
        row.correlationId === event.providerCorrelationId || row.sourceRef === event.providerCorrelationId,
    );
    if (exact) return exact;
  }

  const sameAmount = open.filter((row) => row.amountMinor === event.amountMinor);
  if (sameAmount.length === 1) return sameAmount[0]!;

  return open[0]!;
}

const EXPOSURE_KIND_FOR_EVENT = {
  order_created: "checkout_abandonment",
  invoice_issued: "overdue_receivable",
} as const;

/**
 * Records money that is only *potentially* at risk. No case opens here: an order
 * is not abandoned until checkout stops, and an invoice is not overdue until it
 * passes its terms. The sweeper decides that later.
 */
async function recordPendingExposure(
  db: Database,
  tenantId: string,
  connectionId: string,
  event: NormalizedEvent & { kind: "order_created" | "invoice_issued" },
  encryptionKey: string,
): Promise<null> {
  const customerId = await upsertCustomer(db, tenantId, event, encryptionKey);

  await db
    .insert(exposures)
    .values({
      tenantId,
      connectionId,
      customerId,
      kind: EXPOSURE_KIND_FOR_EVENT[event.kind],
      amountMinor: event.amountMinor,
      currency: event.currency,
      sourceRef: event.providerPaymentId,
      dueAt: event.dueAt,
      occurredAt: event.occurredAt,
      raw: event.raw as object,
    })
    .onConflictDoNothing();

  return null;
}

async function applyNormalizedEvent(
  db: Database,
  tenantId: string,
  connectionId: string,
  event: NormalizedEvent,
  encryptionKey: string,
): Promise<string | null> {
  if (event.kind === "order_created" || event.kind === "invoice_issued") {
    return recordPendingExposure(
      db,
      tenantId,
      connectionId,
      event as NormalizedEvent & { kind: "order_created" | "invoice_issued" },
      encryptionKey,
    );
  }

  const customerId = await upsertCustomer(db, tenantId, event, encryptionKey);
  const { failureCategory, recoverable } = await lookupFailureCategory(db, event);

  const paymentStatus =
    event.kind === "payment_failed" ? "failed" : event.kind === "payment_succeeded" ? "succeeded" : "subscription_ended";

  const [paymentRow] = await db
    .insert(payments)
    .values({
      tenantId,
      connectionId,
      providerPaymentId: event.providerPaymentId,
      providerCorrelationId: event.providerCorrelationId,
      customerId,
      amountMinor: event.amountMinor,
      currency: event.currency,
      status: paymentStatus,
      failureCode: event.failureCode,
      failureCategory,
      failureRecoverable: recoverable,
      failureSource: event.failureSource,
      providerRetryAt: event.providerRetryAt,
      isRecurring: true,
      occurredAt: event.occurredAt,
      raw: event.raw as object,
    })
    .returning({ id: payments.id });

  const paymentId = paymentRow!.id;

  if (event.kind === "payment_failed") {
    const [exposureRow] = await db
      .insert(exposures)
      .values({
        tenantId,
        connectionId,
        customerId,
        kind: "payment_failure",
        amountMinor: event.amountMinor,
        currency: event.currency,
        sourceRef: event.providerPaymentId,
        paymentId,
        occurredAt: event.occurredAt,
      })
      .returning({ id: exposures.id });

    const [caseRow] = await db
      .insert(cases)
      .values({ tenantId, exposureId: exposureRow!.id, customerId, state: "NEW", arm: assignArm() })
      .returning({ id: cases.id });

    await appendCaseEvent(db, {
      tenantId,
      caseId: caseRow!.id,
      fromState: null,
      toState: "NEW",
      reason: recoverable ? `payment_failed:${failureCategory}` : `payment_failed_not_recoverable:${failureCategory}`,
      actor: "system",
    });

    return caseRow!.id;
  }

  if (event.kind === "payment_succeeded") {
    // Close the pending exposure even when no case exists yet, or the sweeper
    // will later open one against an order that has already been paid.
    const refs = [event.providerCorrelationId, event.providerPaymentId].filter(
      (ref): ref is string => Boolean(ref),
    );
    if (refs.length > 0) {
      await db
        .update(exposures)
        .set({ resolvedAt: new Date() })
        .where(and(eq(exposures.tenantId, tenantId), inArray(exposures.sourceRef, refs)));
    }

    const match = await findRecoveredCase(db, tenantId, customerId, event);
    if (!match) return null;

    const openCase = match.case;
    const result = applyTransition(openCase.state, { type: "payment_succeeded" });

    await db
      .update(cases)
      .set({
        state: result.toState,
        closedAt: new Date(),
        closedReason: result.reason,
        recoveredAmountMinor: event.amountMinor,
      })
      .where(eq(cases.id, openCase.id));

    await db.update(exposures).set({ resolvedAt: new Date() }).where(eq(exposures.id, match.exposureId));

    await appendCaseEvent(db, {
      tenantId,
      caseId: openCase.id,
      fromState: openCase.state,
      toState: result.toState,
      reason: result.reason,
      actor: "system",
    });

    return openCase.id;
  }

  return null;
}

export async function handleProviderWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult> {
  const { db, provider, rawBody, headers, candidates, encryptionKey } = input;

  if (candidates.length === 0) {
    throw new Error(`No active ${provider.id} connections to verify against`);
  }

  const { event, candidate } = verifyAgainstCandidates(provider, rawBody, headers, candidates);
  const { tenantId, connectionId } = candidate;

  const existing = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.providerId, provider.id), eq(webhookEvents.providerEventId, event.id)))
    .limit(1);

  if (existing.length > 0) {
    return { status: "duplicate" };
  }

  await db.insert(webhookEvents).values({
    providerId: provider.id,
    providerEventId: event.id,
    status: "received",
  });

  const normalized = provider.normalize(event);
  if (!normalized) {
    await db
      .update(webhookEvents)
      .set({ status: "ignored", processedAt: new Date() })
      .where(and(eq(webhookEvents.providerId, provider.id), eq(webhookEvents.providerEventId, event.id)));
    return { status: "ignored" };
  }

  const caseId = await applyNormalizedEvent(db, tenantId, connectionId, normalized, encryptionKey);

  await db
    .update(webhookEvents)
    .set({ status: "processed", processedAt: new Date() })
    .where(and(eq(webhookEvents.providerId, provider.id), eq(webhookEvents.providerEventId, event.id)));

  return { status: "processed", caseId };
}
