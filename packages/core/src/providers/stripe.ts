import Stripe from "stripe";
import type { FailureCategory, FailureSource } from "@riko/shared";
import type { AuthorizeInput, PaymentProvider, ProviderEvent, ProviderTokens, NormalizedEvent, WebhookHeaders } from "./types.js";

const FAILURE_CODE_TO_CATEGORY: Record<string, FailureCategory> = {
  insufficient_funds: "insufficient_funds",
  card_declined: "bank_decline",
  expired_card: "expired_card",
  authentication_required: "authentication_required",
  processing_error: "network_error",
  incorrect_number: "invalid_instrument",
  invalid_expiry_month: "invalid_instrument",
  invalid_expiry_year: "invalid_instrument",
  invalid_cvc: "invalid_instrument",
};

function categorize(code: string | null): FailureCategory {
  if (!code) return "unknown";
  return FAILURE_CODE_TO_CATEGORY[code] ?? "unknown";
}


const CATEGORY_TO_SOURCE: Record<FailureCategory, FailureSource> = {
  insufficient_funds: "customer",
  expired_card: "customer",
  invalid_instrument: "customer",
  authentication_required: "customer",
  bank_decline: "issuer",
  network_error: "gateway",
  unknown: "unknown",
};

export interface StripeAdapterConfig {
  clientId: string;
  clientSecret: string;
  apiKey: string;
}

export class StripeAdapter implements PaymentProvider {
  readonly id = "stripe" as const;
  private readonly client: Stripe;

  constructor(private readonly config: StripeAdapterConfig) {
    this.client = new Stripe(config.apiKey, { apiVersion: "2025-02-24.acacia" });
  }

  buildAuthorizeUrl(input: AuthorizeInput): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      scope: "read_only",
      redirect_uri: input.redirectUri,
      state: input.state,
    });
    return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    const response = await this.client.oauth.token({
      grant_type: "authorization_code",
      code,
    });
    return {
      accessToken: response.access_token ?? "",
      refreshToken: response.refresh_token ?? null,
      expiresAt: null,
      scopes: response.scope ? [response.scope] : [],
    };
  }

  async refreshTokens(refreshToken: string): Promise<ProviderTokens> {
    const response = await this.client.oauth.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return {
      accessToken: response.access_token ?? "",
      refreshToken: response.refresh_token ?? refreshToken,
      expiresAt: null,
      scopes: response.scope ? [response.scope] : [],
    };
  }

  async verifyApiKey(): Promise<string> {
    const account = await this.client.accounts.retrieve();
    return account.id;
  }

  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): ProviderEvent {
    const signature = headers["stripe-signature"];
    if (typeof signature !== "string") {
      throw new Error("Missing stripe-signature header");
    }
    const event = this.client.webhooks.constructEvent(rawBody, signature, secret);
    return { id: event.id, type: event.type, raw: event };
  }

  normalize(event: ProviderEvent): NormalizedEvent | null {
    const stripeEvent = event.raw as Stripe.Event;

    if (stripeEvent.type === "invoice.payment_failed") {
      const invoice = stripeEvent.data.object as Stripe.Invoice;
      const charge = invoice.charge as Stripe.Charge | null;
      const failureCode = charge?.failure_code ?? null;
      return {
        providerId: "stripe",
        providerAccountId: stripeEvent.account ?? "",
        kind: "payment_failed",
        providerPaymentId: invoice.id,
        providerCorrelationId: invoice.id ?? null,
        caseIdHint: (invoice.metadata?.case_id as string | undefined) ?? null,
        providerCustomerId: typeof invoice.customer === "string" ? invoice.customer : "",
        providerCustomerEmail: invoice.customer_email,
        providerCustomerName: invoice.customer_name,
        amountMinor: invoice.amount_due,
        currency: invoice.currency,
        failureCode,
        failureCategory: categorize(failureCode),
        failureSource: CATEGORY_TO_SOURCE[categorize(failureCode)],
        providerRetryAt:
          typeof invoice.next_payment_attempt === "number"
            ? new Date(invoice.next_payment_attempt * 1000)
            : null,
        dueAt: typeof invoice.due_date === "number" ? new Date(invoice.due_date * 1000) : null,
        occurredAt: new Date(stripeEvent.created * 1000),
        raw: stripeEvent,
      };
    }

    if (stripeEvent.type === "invoice.payment_succeeded") {
      const invoice = stripeEvent.data.object as Stripe.Invoice;
      return {
        providerId: "stripe",
        providerAccountId: stripeEvent.account ?? "",
        kind: "payment_succeeded",
        providerPaymentId: invoice.id,
        providerCorrelationId: invoice.id ?? null,
        caseIdHint: (invoice.metadata?.case_id as string | undefined) ?? null,
        providerCustomerId: typeof invoice.customer === "string" ? invoice.customer : "",
        providerCustomerEmail: invoice.customer_email,
        providerCustomerName: invoice.customer_name,
        amountMinor: invoice.amount_paid,
        currency: invoice.currency,
        failureCode: null,
        failureCategory: "unknown",
        failureSource: "unknown",
        providerRetryAt: null,
        dueAt: null,
        occurredAt: new Date(stripeEvent.created * 1000),
        raw: stripeEvent,
      };
    }

    if (stripeEvent.type === "customer.subscription.deleted") {
      const subscription = stripeEvent.data.object as Stripe.Subscription;
      return {
        providerId: "stripe",
        providerAccountId: stripeEvent.account ?? "",
        kind: "subscription_ended",
        providerPaymentId: subscription.id,
        providerCorrelationId: subscription.id,
        caseIdHint: (subscription.metadata?.case_id as string | undefined) ?? null,
        providerCustomerId: typeof subscription.customer === "string" ? subscription.customer : "",
        providerCustomerEmail: null,
        providerCustomerName: null,
        amountMinor: 0,
        currency: subscription.currency ?? "usd",
        failureCode: null,
        failureCategory: "unknown",
        failureSource: "unknown",
        providerRetryAt: null,
        dueAt: null,
        occurredAt: new Date(stripeEvent.created * 1000),
        raw: stripeEvent,
      };
    }

    return null;
  }
}
