import type { Database } from "@riko/db";
import { webhookEvents, customers, payments, exposures, cases, failureCodeMap, appendCaseEvent } from "@riko/db";
import type { PaymentProvider, ProviderEvent, NormalizedEvent } from "@riko/core";
import { applyTransition, encryptSecret, fetchRazorpaySubscriptionAmount } from "@riko/core";
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
  keyId?: string;
  keySecret?: string;
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
  const values = {
    tenantId,
    providerId: event.providerId,
    providerCustomerId: event.providerCustomerId,
    emailEncrypted: encryptSecret(event.providerCustomerEmail ?? event.providerCustomerId, encryptionKey),
    phoneEncrypted: event.providerCustomerContact
      ? encryptSecret(event.providerCustomerContact, encryptionKey)
      : null,
    name: event.providerCustomerName,
    locale: null,
    timezone: event.providerCustomerTimezone,
  };

  const [inserted] = await db.insert(customers).values(values).onConflictDoNothing().returning({ id: customers.id });
  if (inserted) return inserted.id;

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

  if (!existing) throw new Error(`Customer insert conflicted but row is missing: ${event.providerCustomerId}`);
  return existing.id;
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

const SUBSCRIPTION_CATEGORY: Record<string, NormalizedEvent["failureCategory"]> = {
  subscription_retry_pending: "bank_decline",
  subscription_halted: "invalid_instrument",
};

/**
 * Subscription risk is money that will be attempted again (or has stopped being
 * attempted). One exposure per subscription, refreshed by every event; the
 * router sequences outreach around the provider's own retry clock.
 */
async function recordSubscriptionExposure(
  db: Database,
  tenantId: string,
  connectionId: string,
  event: NormalizedEvent,
  encryptionKey: string,
): Promise<string> {
  const customerId = await upsertCustomer(db, tenantId, event, encryptionKey);
  const category = SUBSCRIPTION_CATEGORY[event.kind] ?? "unknown";

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
      providerRetryAt: event.providerRetryAt,
      failureCategory: category,
      occurredAt: event.occurredAt,
      raw: event.raw as object,
    })
    .onConflictDoUpdate({
      target: [exposures.tenantId, exposures.kind, exposures.sourceRef],
      set: { providerRetryAt: event.providerRetryAt, resolvedAt: null },
    })
    .returning({ id: exposures.id });

  const exposureId = exposureRow!.id;

  const [openCase] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.exposureId, exposureId), inArray(cases.state, [...OPEN_STATES])))
    .limit(1);

  if (openCase) return openCase.id;

  const [caseRow] = await db
    .insert(cases)
    .values({ tenantId, exposureId, customerId, state: "NEW", arm: assignArm() })
    .returning({ id: cases.id });

  await appendCaseEvent(db, {
    tenantId,
    caseId: caseRow!.id,
    fromState: null,
    toState: "NEW",
    reason:
      event.kind === "subscription_retry_pending"
        ? `subscription_retry_scheduled:${event.providerRetryAt?.toISOString() ?? "unknown"}`
        : "subscription_halted_needs_mandate_fix",
    actor: "system",
  });

  return caseRow!.id;
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

  if (event.kind === "subscription_retry_pending" || event.kind === "subscription_halted") {
    return recordSubscriptionExposure(db, tenantId, connectionId, event, encryptionKey);
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

    const claimed = await db
      .update(cases)
      .set({
        state: result.toState,
        closedAt: new Date(),
        closedReason: result.reason,
        recoveredAmountMinor: event.amountMinor,
      })
      .where(and(eq(cases.id, openCase.id), eq(cases.state, openCase.state)))
      .returning({ id: cases.id });

    if (claimed.length === 0) return null;

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

/**
 * Subscription webhooks carry no amount; the router's review threshold, the
 * payment link we later build, and the metrics all need one. Resolve it from
 * the provider while the connection credentials are at hand.
 */
async function withSubscriptionAmount(
  db: Database,
  provider: PaymentProvider,
  event: ProviderEvent,
  candidate: WebhookConnectionCandidate,
): Promise<NormalizedEvent | null> {
  const normalizedEvent = provider.normalize(event);
  if (!normalizedEvent) return null;

  if (
    (normalizedEvent.kind === "subscription_retry_pending" || normalizedEvent.kind === "subscription_halted") &&
    normalizedEvent.amountMinor === 0 &&
    candidate.keyId &&
    candidate.keySecret
  ) {
    const amount = await fetchRazorpaySubscriptionAmount(candidate.keyId, candidate.keySecret, normalizedEvent.providerPaymentId);
    if (amount !== null) {
      return { ...normalizedEvent, amountMinor: amount };
    }
  }

  return normalizedEvent;
}

export async function handleProviderWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult> {
  const { db, provider, rawBody, headers, candidates, encryptionKey } = input;

  if (candidates.length === 0) {
    throw new Error(`No active ${provider.id} connections to verify against`);
  }

  const { event, candidate } = verifyAgainstCandidates(provider, rawBody, headers, candidates);
  const { tenantId, connectionId } = candidate;

  const [existing] = await db
    .select({ id: webhookEvents.id, status: webhookEvents.status })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.providerId, provider.id), eq(webhookEvents.providerEventId, event.id)))
    .limit(1);

  const alreadyRecorded = Boolean(existing);
  if (existing && existing.status !== "failed") {
    return { status: "duplicate" };
  }

  if (!alreadyRecorded) {
    const inserted = await db
      .insert(webhookEvents)
      .values({
        providerId: provider.id,
        providerEventId: event.id,
        status: "received",
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });

    if (inserted.length === 0) return { status: "duplicate" };
  }

  const normalized = await withSubscriptionAmount(db, provider, event, candidate);

  try {
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
  } catch (error) {
    await db
      .update(webhookEvents)
      .set({ status: "failed" })
      .where(and(eq(webhookEvents.providerId, provider.id), eq(webhookEvents.providerEventId, event.id)));
    throw error;
  }
}
