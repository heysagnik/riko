import type { ExposureKind, FailureCategory, FailureSource } from "@riko/shared";

export type InterventionKind =
  | "no_action_provider_retrying"
  | "wait_until"
  | "outreach_email"
  | "escalate_human"
  | "stop_never_contact";

export interface Intervention {
  kind: InterventionKind;
  reason: string;
  waitUntil: Date | null;
  rung?: string;
}

export interface InterventionInput {
  exposureKind: ExposureKind;
  failureCategory: FailureCategory;
  failureSource: FailureSource;
  failureCode: string | null;
  amountMinor: number;
  providerRetryAt: Date | null;
  occurredAt: Date;
  dueAt: Date | null;
  attemptCount: number;
  priorExposures: number;
  now: Date;
  humanReviewMinor: number;
  humanApproved: boolean;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
