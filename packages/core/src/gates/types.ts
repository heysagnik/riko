import type { ExposureKind, FailureCategory } from "@riko/shared";

export interface GateCaseInput {
  exposureKind: ExposureKind;
  customerHasDeliverableEmail: boolean;
  customerUnsubscribed: boolean;
  customerHasBounced: boolean;
  /** DND, open dispute, distress, or anything else a person flagged. */
  customerSuppressed: boolean;
  /** Hour of day where the customer is, 0-23. */
  localHour: number;
  tenantHasVerifiedSender: boolean;
  attemptCount: number;
  hoursSinceLastOutreach: number | null;
  failureCategory: FailureCategory;
  failureRecoverable: boolean;
  /** Age of the exposure, not of the case. */
  paymentAgeDays: number;
  tenantPaused: boolean;
  tenantWithinDailySendCap: boolean;
}

export type GateFailureReason =
  | "no_deliverable_email"
  | "unsubscribed_or_bounced"
  | "no_verified_sender"
  | "attempts_exhausted"
  | "cooldown_not_elapsed"
  | "not_recoverable"
  | "payment_too_old"
  | "customer_suppressed"
  | "outside_contact_window"
  | "tenant_paused_or_capped";

export interface GateResult {
  eligible: boolean;
  reason: GateFailureReason | null;
}

export interface PolicyLimit {
  id: string;
  label: string;
  value: string;
  group: "budget" | "temporal" | "compliance";
}
