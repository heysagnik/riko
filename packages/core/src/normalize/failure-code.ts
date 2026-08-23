import type { FailureCategory, ProviderId } from "@riko/shared";

export interface FailureCodeMapEntry {
  providerId: ProviderId;
  providerCode: string;
  failureCategory: FailureCategory;
  recoverable: boolean;
}

export function lookupFailureCategory(
  entries: readonly FailureCodeMapEntry[],
  providerId: ProviderId,
  providerCode: string | null,
): { failureCategory: FailureCategory; recoverable: boolean } {
  if (!providerCode) {
    return { failureCategory: "unknown", recoverable: false };
  }
  const entry = entries.find((e) => e.providerId === providerId && e.providerCode === providerCode);
  if (!entry) {
    return { failureCategory: "unknown", recoverable: false };
  }
  return { failureCategory: entry.failureCategory, recoverable: entry.recoverable };
}
