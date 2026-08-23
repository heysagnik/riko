import type {
  ProviderId,
  ProviderTokens,
  ProviderEvent,
  NormalizedEvent,
  WebhookHeaders,
} from "@riko/shared";

export interface AuthorizeInput {
  redirectUri: string;
  state: string;
}

export interface PaymentProvider {
  readonly id: ProviderId;
  buildAuthorizeUrl(input: AuthorizeInput): string;
  exchangeCode(code: string): Promise<ProviderTokens>;
  refreshTokens(refreshToken: string): Promise<ProviderTokens>;
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): ProviderEvent;
  normalize(event: ProviderEvent): NormalizedEvent | null;
}

export type { ProviderId, ProviderTokens, ProviderEvent, NormalizedEvent, WebhookHeaders };
