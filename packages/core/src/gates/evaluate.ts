import type { ExposureKind } from "@riko/shared";
import type { GateCaseInput, GateResult, PolicyLimit } from "./types.js";

export const MAX_ATTEMPTS = 3;
const COOLDOWN_HOURS = 48;

const MAX_AGE_DAYS: Record<ExposureKind, number> = {
  payment_failure: 21,
  checkout_abandonment: 7,
  overdue_receivable: 30,
};

export const CONTACT_WINDOW_START_HOUR = 7;
export const CONTACT_WINDOW_END_HOUR = 23;

export function isWithinContactWindow(localHour: number): boolean {
  return localHour >= CONTACT_WINDOW_START_HOUR && localHour < CONTACT_WINDOW_END_HOUR;
}

export function evaluateGates(input: GateCaseInput): GateResult {
  if (!input.customerHasDeliverableEmail) {
    return { eligible: false, reason: "no_deliverable_email" };
  }
  if (input.customerUnsubscribed || input.customerHasBounced) {
    return { eligible: false, reason: "unsubscribed_or_bounced" };
  }
  if (input.customerSuppressed) {
    return { eligible: false, reason: "customer_suppressed" };
  }
  if (!input.tenantHasVerifiedSender) {
    return { eligible: false, reason: "no_verified_sender" };
  }
  if (input.attemptCount >= MAX_ATTEMPTS) {
    return { eligible: false, reason: "attempts_exhausted" };
  }
  if (input.hoursSinceLastOutreach !== null && input.hoursSinceLastOutreach < COOLDOWN_HOURS) {
    return { eligible: false, reason: "cooldown_not_elapsed" };
  }
  if (!input.failureRecoverable) {
    return { eligible: false, reason: "not_recoverable" };
  }
  if (input.paymentAgeDays > MAX_AGE_DAYS[input.exposureKind]) {
    return { eligible: false, reason: "payment_too_old" };
  }
  if (input.attemptCount > 0 && !isWithinContactWindow(input.localHour)) {
    return { eligible: false, reason: "outside_contact_window" };
  }
  if (input.tenantPaused || !input.tenantWithinDailySendCap) {
    return { eligible: false, reason: "tenant_paused_or_capped" };
  }
  return { eligible: true, reason: null };
}


export function describePolicyLimits(): PolicyLimit[] {
  return [
    { id: "max_attempts", label: "Emails per case", value: String(MAX_ATTEMPTS), group: "budget" },
    { id: "cooldown", label: "Minimum gap between emails", value: `${COOLDOWN_HOURS}h`, group: "budget" },
    {
      id: "contact_window",
      label: "Contact window for follow-ups",
      value: `${CONTACT_WINDOW_START_HOUR}:00–${CONTACT_WINDOW_END_HOUR}:00 local; first email any time`,
      group: "compliance",
    },
    { id: "incentives", label: "Discounts or credits offered", value: "Never", group: "compliance" },
    {
      id: "age_payment",
      label: "Stop chasing a failed payment after",
      value: `${MAX_AGE_DAYS.payment_failure} days`,
      group: "temporal",
    },
    {
      id: "age_abandonment",
      label: "Stop chasing an abandoned cart after",
      value: `${MAX_AGE_DAYS.checkout_abandonment} days`,
      group: "temporal",
    },
    {
      id: "age_receivable",
      label: "Hand an unpaid invoice to a person after",
      value: `${MAX_AGE_DAYS.overdue_receivable} days`,
      group: "temporal",
    },
  ];
}
