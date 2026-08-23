import { createHmac, timingSafeEqual } from "node:crypto";
import type { FailureCategory, FailureSource } from "@riko/shared";
import type {
  AuthorizeInput,
  PaymentProvider,
  ProviderEvent,
  ProviderTokens,
  NormalizedEvent,
  WebhookHeaders,
} from "./types.js";

const FAILURE_REASON_TO_CATEGORY: Record<string, FailureCategory> = {
  insufficient_funds: "insufficient_funds",
  expired_card: "expired_card",
  authentication_failed: "authentication_required",
  payment_authentication_failed: "authentication_required",
  payment_declined: "bank_decline",
  card_declined: "bank_decline",
  issuer_unavailable: "network_error",
  gateway_error: "network_error",
  gateway_timeout: "network_error",
  server_error: "network_error",
  network_error: "network_error",
  invalid_number: "invalid_instrument",
  invalid_expiry_month: "invalid_instrument",
  invalid_expiry_year: "invalid_instrument",
  invalid_cvv: "invalid_instrument",
  card_not_supported: "invalid_instrument",
  payment_method_not_supported: "invalid_instrument",
  international_transaction_not_allowed: "bank_decline",
  payment_frequency_limit_exceeded: "bank_decline",
  card_limit_exceeded: "insufficient_funds",
};

const SOURCE_MAP: Record<string, FailureSource> = {
  customer: "customer",
  issuer: "issuer",
  bank: "bank",
  gateway: "gateway",
  network: "network",
  business: "business",
  internal: "internal",
};

function categorize(reason: string | null, description: string | null): FailureCategory {
  if (reason && FAILURE_REASON_TO_CATEGORY[reason]) {
    return FAILURE_REASON_TO_CATEGORY[reason]!;
  }

  const text = (description ?? "").toLowerCase();
  if (text.includes("insufficient")) return "insufficient_funds";
  if (text.includes("expired")) return "expired_card";
  if (text.includes("authenticat") || text.includes("3ds") || text.includes("otp")) {
    return "authentication_required";
  }
  if (text.includes("timeout") || text.includes("unavailable")) return "network_error";
  if (text.includes("declin")) return "bank_decline";
  return "unknown";
}

function toSource(errorSource: string | null): FailureSource {
  if (!errorSource) return "unknown";
  return SOURCE_MAP[errorSource.toLowerCase()] ?? "unknown";
}

interface RazorpayPaymentEntity {
  id: string;
  amount: number;
  currency: string;
  email: string | null;
  contact: string | null;
  error_code: string | null;
  error_reason: string | null;
  error_description?: string | null;
  error_source?: string | null;
  error_step?: string | null;
  created_at: number;
  card?: { name: string | null } | null;
  notes?: Record<string, string> | null;
  invoice_id?: string | null;
  order_id?: string | null;
}

interface RazorpayOrderEntity {
  id: string;
  amount: number;
  amount_paid?: number | null;
  currency: string;
  status?: string | null;
  receipt?: string | null;
  notes?: Record<string, string> | null;
  created_at: number;
}

interface RazorpayInvoiceEntity {
  id: string;
  amount: number;
  amount_paid?: number | null;
  currency: string;
  status?: string | null;
  order_id?: string | null;
  customer_id?: string | null;
  customer_details?: { name?: string | null; email?: string | null; contact?: string | null } | null;
  expire_by?: number | null;
  issued_at?: number | null;
  notes?: Record<string, string> | null;
  created_at: number;
}

interface RazorpaySubscriptionEntity {
  id: string;
  customer_id: string | null;
  current_end: number | null;
  charge_at?: number | null;
  status?: string | null;
  notes?: Record<string, string> | null;
}

interface RazorpayCustomerEntity {
  id: string;
  name?: string | null;
  email?: string | null;
  contact?: string | null;
}

interface RazorpayWebhookPayload {
  entity: "event";
  account_id: string | null;
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    order?: { entity: RazorpayOrderEntity };
    invoice?: { entity: RazorpayInvoiceEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
    customer?: { entity: RazorpayCustomerEntity };
  };
  created_at: number;
}

function customerNameFromPayment(
  payment: RazorpayPaymentEntity,
  payload: RazorpayWebhookPayload,
): string | null {
  return (
    payment.card?.name ??
    payment.notes?.name ??
    payment.notes?.customer_name ??
    payload.payload.customer?.entity.name ??
    null
  );
}

function secondsToDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" && seconds > 0 ? new Date(seconds * 1000) : null;
}

export class RazorpayAdapter implements PaymentProvider {
  readonly id = "razorpay" as const;

  buildAuthorizeUrl(_input: AuthorizeInput): string {
    throw new Error(
      "Razorpay OAuth requires Technology Partner approval, which this deployment does not have; connect with a direct API key instead",
    );
  }

  async exchangeCode(_code: string): Promise<ProviderTokens> {
    throw new Error(
      "Razorpay OAuth requires Technology Partner approval, which this deployment does not have; connect with a direct API key instead",
    );
  }

  async refreshTokens(_refreshToken: string): Promise<ProviderTokens> {
    throw new Error(
      "Razorpay OAuth requires Technology Partner approval, which this deployment does not have; connect with a direct API key instead",
    );
  }

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): ProviderEvent {
    const signature = headers["x-razorpay-signature"];
    if (typeof signature !== "string") {
      throw new Error("Missing x-razorpay-signature header");
    }

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(signature, "hex");
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
      throw new Error("Invalid Razorpay webhook signature");
    }

    const parsed = JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookPayload;
    const entityId =
      parsed.payload.payment?.entity.id ??
      parsed.payload.invoice?.entity.id ??
      parsed.payload.order?.entity.id ??
      parsed.payload.subscription?.entity.id ??
      "unknown";
    const id = `${parsed.event}:${entityId}:${parsed.created_at}`;

    return { id, type: parsed.event, raw: parsed };
  }

  normalize(event: ProviderEvent): NormalizedEvent | null {
    const parsed = event.raw as RazorpayWebhookPayload;
    const accountId = parsed.account_id ?? "";
    const payment = parsed.payload.payment?.entity;
    const order = parsed.payload.order?.entity;
    const invoice = parsed.payload.invoice?.entity;
    const subscription = parsed.payload.subscription?.entity;

    if (payment) {
      const base = {
        providerId: "razorpay" as const,
        providerAccountId: accountId,
        providerPaymentId: payment.id,
        providerCorrelationId: payment.invoice_id ?? payment.order_id ?? null,
        caseIdHint: payment.notes?.case_id ?? null,
        providerCustomerId: payment.email ?? payment.contact ?? payment.id,
        providerCustomerEmail: payment.email,
        providerCustomerContact: payment.contact ?? null,
        providerCustomerName: customerNameFromPayment(payment, parsed),
        amountMinor: payment.amount,
        currency: payment.currency.toLowerCase(),
        occurredAt: new Date(payment.created_at * 1000),
        raw: parsed,
      };

      if (parsed.event === "payment.failed") {
        const failureCode = payment.error_reason ?? payment.error_code;
        return {
          ...base,
          kind: "payment_failed",
          failureCode,
          failureCategory: categorize(payment.error_reason ?? null, payment.error_description ?? null),
          failureSource: toSource(payment.error_source ?? null),
          providerRetryAt: null,
          dueAt: null,
        };
      }

      if (parsed.event === "payment.captured" || parsed.event === "order.paid") {
        return {
          ...base,
          kind: "payment_succeeded",
          failureCode: null,
          failureCategory: "unknown",
          failureSource: "unknown",
          providerRetryAt: null,
          dueAt: null,
        };
      }
    }

    // An order carries no customer contact of its own; abandonment is only
    // actionable when checkout collected one into notes.
    if (order && parsed.event === "order.created") {
      const email = order.notes?.email ?? order.notes?.customer_email ?? null;
      const contact = order.notes?.contact ?? order.notes?.phone ?? null;
      if (!email && !contact) return null;

      return {
        providerId: "razorpay",
        providerAccountId: accountId,
        kind: "order_created",
        providerPaymentId: order.id,
        providerCorrelationId: order.id,
        caseIdHint: order.notes?.case_id ?? null,
        providerCustomerId: email ?? contact ?? order.id,
        providerCustomerEmail: email,
        providerCustomerContact: contact,
        providerCustomerName: order.notes?.name ?? order.notes?.customer_name ?? null,
        amountMinor: order.amount,
        currency: order.currency.toLowerCase(),
        failureCode: null,
        failureCategory: "unknown",
        failureSource: "unknown",
        providerRetryAt: null,
        dueAt: null,
        occurredAt: new Date(order.created_at * 1000),
        raw: parsed,
      };
    }

    if (invoice) {
      const email = invoice.customer_details?.email ?? invoice.notes?.email ?? null;
      const contact = invoice.customer_details?.contact ?? null;

      const base = {
        providerId: "razorpay" as const,
        providerAccountId: accountId,
        providerPaymentId: invoice.id,
        providerCorrelationId: invoice.order_id ?? invoice.id,
        caseIdHint: invoice.notes?.case_id ?? null,
        providerCustomerId: invoice.customer_id ?? email ?? contact ?? invoice.id,
        providerCustomerEmail: email,
        providerCustomerContact: contact,
        providerCustomerName: invoice.customer_details?.name ?? null,
        amountMinor: invoice.amount,
        currency: invoice.currency.toLowerCase(),
        failureCode: null,
        failureCategory: "unknown" as const,
        failureSource: "unknown" as FailureSource,
        providerRetryAt: null,
        dueAt: null,
        occurredAt: new Date((invoice.issued_at ?? invoice.created_at) * 1000),
        raw: parsed,
      };

      if (parsed.event === "invoice.issued") {
        return { ...base, kind: "invoice_issued", dueAt: secondsToDate(invoice.expire_by) };
      }

      if (parsed.event === "invoice.paid") {
        return { ...base, kind: "payment_succeeded", dueAt: null };
      }
    }

    if (subscription) {
      const base = {
        providerId: "razorpay" as const,
        providerAccountId: accountId,
        providerPaymentId: subscription.id,
        providerCorrelationId: subscription.id,
        caseIdHint: subscription.notes?.case_id ?? null,
        providerCustomerId: subscription.customer_id ?? subscription.id,
        providerCustomerEmail: parsed.payload.customer?.entity.email ?? null,
        providerCustomerContact: null,
        providerCustomerName: parsed.payload.customer?.entity.name ?? null,
        amountMinor: 0,
        currency: "inr",
        failureCode: null,
        failureSource: "unknown" as FailureSource,
        occurredAt: new Date(parsed.created_at * 1000),
        raw: parsed,
      };

      if (parsed.event === "subscription.pending") {
        return {
          ...base,
          kind: "subscription_retry_pending",
          failureCategory: "unknown",
          providerRetryAt: secondsToDate(subscription.charge_at),
          dueAt: null,
        };
      }

      if (parsed.event === "subscription.halted") {
        return {
          ...base,
          kind: "subscription_halted",
          failureCategory: "unknown",
          providerRetryAt: null,
          dueAt: null,
        };
      }

      if (parsed.event === "subscription.charged") {
        return {
          ...base,
          kind: "payment_succeeded",
          failureCategory: "unknown",
          providerRetryAt: null,
          dueAt: null,
        };
      }

      if (parsed.event === "subscription.cancelled" || parsed.event === "subscription.completed") {
        return {
          ...base,
          kind: "subscription_ended",
          failureCategory: "unknown",
          providerRetryAt: null,
          dueAt: null,
        };
      }
    }

    return null;
  }
}
