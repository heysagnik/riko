import type { ExposureKind } from "@riko/shared";
import type { GateCaseInput, GateResult, PolicyLimit } from "./types.js";

const MAX_ATTEMPTS = 3;
const COOLDOWN_HOURS = 48;

// A failed card goes stale quickly; an unpaid invoice is still collectable at
// 30 days, which is exactly when the ladder hands it to a person.
const MAX_AGE_DAYS: Record<ExposureKind, number> = {
  payment_failure: 21,
  checkout_abandonment: 7,
  overdue_receivable: 30,
};

// RBI's recovery-agent conduct norms bound contact to daytime hours. Email is
// not a phone call, but holding to the same window costs nothing and keeps one
// standard across every channel we might add.
export const CONTACT_WINDOW_START_HOUR = Number(process.env.CONTACT_WINDOW_START_HOUR ?? 8);
export const CONTACT_WINDOW_END_HOUR = Number(process.env.CONTACT_WINDOW_END_HOUR ?? 19);

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
  if (!isWithinContactWindow(input.localHour)) {
    return { eligible: false, reason: "outside_contact_window" };
  }
  if (input.tenantPaused || !input.tenantWithinDailySendCap) {
    return { eligible: false, reason: "tenant_paused_or_capped" };
  }
  return { eligible: true, reason: null };
}

/** Every bound the agent operates under, for the policy page to render. */
export function describePolicyLimits(): PolicyLimit[] {
  return [
    { id: "max_attempts", label: "Emails per case", value: String(MAX_ATTEMPTS), group: "budget" },
    { id: "cooldown", label: "Minimum gap between emails", value: `${COOLDOWN_HOURS}h`, group: "budget" },
    {
      id: "contact_window",
      label: "Contact window",
      value: `${CONTACT_WINDOW_START_HOUR}:00–${CONTACT_WINDOW_END_HOUR}:00 local`,
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
