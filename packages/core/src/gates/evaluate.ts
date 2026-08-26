import type { AgentSettingsInput, ExposureKind } from "@riko/shared";
import type { GateCaseInput, GateLimits, GateResult, PolicyLimit } from "./types.js";

export const MAX_ATTEMPTS = 3;
const COOLDOWN_HOURS = 48;

const MAX_AGE_DAYS: Record<ExposureKind, number> = {
  payment_failure: 21,
  checkout_abandonment: 7,
  overdue_receivable: 30,
};

export const CONTACT_WINDOW_START_HOUR = 7;
export const CONTACT_WINDOW_END_HOUR = 23;

export const DEFAULT_GATE_LIMITS: GateLimits = {
  maxAttempts: MAX_ATTEMPTS,
  cooldownHours: COOLDOWN_HOURS,
  contactWindowStartHour: CONTACT_WINDOW_START_HOUR,
  contactWindowEndHour: CONTACT_WINDOW_END_HOUR,
  firstEmailWithinWindow: false,
  maxAgeDays: MAX_AGE_DAYS,
  minAmountMinor: 0,
};

export function isWithinContactWindow(
  localHour: number,
  startHour = CONTACT_WINDOW_START_HOUR,
  endHour = CONTACT_WINDOW_END_HOUR,
): boolean {
  return localHour >= startHour && localHour < endHour;
}

export function evaluateGates(input: GateCaseInput): GateResult {
  const limits = input.limits ?? DEFAULT_GATE_LIMITS;

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
  if (input.attemptCount >= limits.maxAttempts) {
    return { eligible: false, reason: "attempts_exhausted" };
  }
  if (input.hoursSinceLastOutreach !== null && input.hoursSinceLastOutreach < limits.cooldownHours) {
    return { eligible: false, reason: "cooldown_not_elapsed" };
  }
  if (!input.failureRecoverable) {
    return { eligible: false, reason: "not_recoverable" };
  }
  if (limits.minAmountMinor > 0 && (input.amountMinor ?? 0) < limits.minAmountMinor) {
    return { eligible: false, reason: "below_min_amount" };
  }
  if (input.paymentAgeDays > limits.maxAgeDays[input.exposureKind]) {
    return { eligible: false, reason: "payment_too_old" };
  }
  if ((limits.firstEmailWithinWindow || input.attemptCount > 0) && !isWithinContactWindow(
    input.localHour,
    limits.contactWindowStartHour,
    limits.contactWindowEndHour,
  )) {
    return { eligible: false, reason: "outside_contact_window" };
  }
  if (input.tenantPaused || !input.tenantWithinDailySendCap) {
    return { eligible: false, reason: "tenant_paused_or_capped" };
  }
  return { eligible: true, reason: null };
}

export function gateLimitsFromAgentSettings(settings: AgentSettingsInput): GateLimits {
  return {
    maxAttempts: settings.maxAttempts,
    cooldownHours: settings.cooldownHours,
    contactWindowStartHour: settings.contactWindowStartHour,
    contactWindowEndHour: settings.contactWindowEndHour,
    firstEmailWithinWindow: settings.firstEmailWithinWindow,
    maxAgeDays: {
      payment_failure: settings.maxAgeDaysPaymentFailure,
      checkout_abandonment: settings.maxAgeDaysCheckoutAbandonment,
      overdue_receivable: settings.maxAgeDaysOverdueReceivable,
    },
    minAmountMinor: settings.minAmountMinor,
  };
}

export function describePolicyLimits(limits: GateLimits = DEFAULT_GATE_LIMITS): PolicyLimit[] {
  const windowLabel = limits.firstEmailWithinWindow
    ? `${limits.contactWindowStartHour}:00–${limits.contactWindowEndHour}:00 local, every email`
    : `${limits.contactWindowStartHour}:00–${limits.contactWindowEndHour}:00 local; first email any time`;
  return [
    { id: "max_attempts", label: "Emails per case", value: String(limits.maxAttempts), group: "budget" },
    { id: "cooldown", label: "Minimum gap between emails", value: `${limits.cooldownHours}h`, group: "budget" },
    ...(limits.minAmountMinor > 0
      ? [
          {
            id: "min_amount",
            label: "Skip cases below",
            value: `₹${(limits.minAmountMinor / 100).toFixed(0)}`,
            group: "budget" as const,
          },
        ]
      : []),
    {
      id: "contact_window",
      label: "Contact window",
      value: windowLabel,
      group: "compliance",
    },
    { id: "incentives", label: "Discounts or credits offered", value: "Never", group: "compliance" },
    {
      id: "age_payment",
      label: "Stop chasing a failed payment after",
      value: `${limits.maxAgeDays.payment_failure} days`,
      group: "temporal",
    },
    {
      id: "age_abandonment",
      label: "Stop chasing an abandoned cart after",
      value: `${limits.maxAgeDays.checkout_abandonment} days`,
      group: "temporal",
    },
    {
      id: "age_receivable",
      label: "Hand an unpaid invoice to a person after",
      value: `${limits.maxAgeDays.overdue_receivable} days`,
      group: "temporal",
    },
  ];
}
