import type { ProviderId } from "@riko/shared";
import type { PaymentProvider } from "./types.js";

const registry = new Map<ProviderId, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: ProviderId): PaymentProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new Error(`No provider registered for id: ${id}`);
  }
  return provider;
}
