export type ProviderId = "razorpay";

export type FailureCategory =
  | "insufficient_funds"
  | "expired_card"
  | "authentication_required"
  | "bank_decline"
  | "network_error"
  | "invalid_instrument"
  | "unknown";

export type FailureSource =
  | "customer"
  | "issuer"
  | "bank"
  | "gateway"
  | "network"
  | "business"
  | "internal"
  | "unknown";

export type NormalizedEventKind =
  | "payment_failed"
  | "payment_succeeded"
  | "subscription_ended"
  | "subscription_retry_pending"
  | "subscription_halted"

  | "order_created"

  | "invoice_issued";

export interface NormalizedEvent {
  providerId: ProviderId;
  providerAccountId: string;
  kind: NormalizedEventKind;
  providerPaymentId: string;

  providerCorrelationId: string | null;

  caseIdHint: string | null;
  providerCustomerId: string;
  providerCustomerEmail: string | null;
  providerCustomerContact: string | null;
  providerCustomerName: string | null;
  providerCustomerTimezone: string | null;
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  failureCategory: FailureCategory;
  failureSource: FailureSource;
  providerRetryAt: Date | null;

  dueAt: Date | null;
  occurredAt: Date;
  raw: unknown;
}

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface WebhookHeaders {
  [key: string]: string | string[] | undefined;
}

export interface ProviderEvent {
  id: string;
  type: string;
  raw: unknown;
}
