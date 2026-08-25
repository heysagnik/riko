export type ExposureKind = "payment_failure" | "checkout_abandonment" | "overdue_receivable";

export type CaseState =
  | "NEW"
  | "SKIPPED"
  | "DRAFTING"
  | "SENDING"
  | "WAITING"
  | "PROMISED"
  | "RECOVERED"
  | "ESCALATED"
  | "LOST";

export type CaseClosedReason =
  | "no_deliverable_email"
  | "unsubscribed_or_bounced"
  | "no_verified_sender"
  | "attempts_exhausted"
  | "cooldown_not_elapsed"
  | "not_recoverable"
  | "payment_too_old"
  | "tenant_paused_or_capped"
  | "hard_bounce"
  | "customer_unsubscribed"
  | "customer_reply"
  | "validation_failed_3x"
  | "payment_succeeded";

export type CaseActor = "system" | "agent" | "merchant";

export interface CaseEvent {
  id: string;
  tenantId: string;
  caseId: string;
  fromState: CaseState | null;
  toState: CaseState;
  reason: string | null;
  actor: CaseActor;
  createdAt: Date;
}
