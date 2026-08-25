import type { FailureSource } from "@riko/shared";
import { HOUR_MS, type Intervention, type InterventionInput } from "./types.js";

const PROVIDER_RETRY_LEAD_HOURS = 18;
const SOFT_DECLINE_WAIT_HOURS = 24;

const FRAUD_CODES = [
  "fraudulent",
  "do_not_honor",
  "do_not_honour",
  "stolen_card",
  "lost_card",
  "pickup_card",
  "restricted_card",
  "security_violation",
  "suspected_fraud",
];

const TRANSIENT_SOURCES: FailureSource[] = ["gateway", "network", "internal"];

export function isFraudSignal(failureCode: string | null): boolean {
  if (!failureCode) return false;
  const code = failureCode.toLowerCase();
  return FRAUD_CODES.some((f) => code.includes(f));
}

export function nextSalaryWindow(from: Date): Date {
  const candidate = new Date(from);
  candidate.setUTCHours(4, 0, 0, 0);

  const day = candidate.getUTCDate();
  if (day < 2) {
    candidate.setUTCDate(2);
    return candidate > from ? candidate : new Date(candidate.getTime() + 24 * HOUR_MS);
  }

  candidate.setUTCMonth(candidate.getUTCMonth() + 1, 2);
  return candidate;
}

export function routePaymentFailure(input: InterventionInput): Intervention {
  if (isFraudSignal(input.failureCode)) {
    return { kind: "stop_never_contact", reason: "fraud_signal", waitUntil: null };
  }

  if (!input.humanApproved) {
    if (input.failureSource === "business") {
      return { kind: "escalate_human", reason: "merchant_configuration_fault", waitUntil: null };
    }

    if (input.amountMinor >= input.humanReviewMinor) {
      return { kind: "escalate_human", reason: "above_human_review_threshold", waitUntil: null };
    }
  }

  if (
    input.failureCategory !== "unknown" &&
    (input.failureCategory === "network_error" || TRANSIENT_SOURCES.includes(input.failureSource))
  ) {
    return {
      kind: "no_action_provider_retrying",
      reason: "transient_fault_card_is_healthy",
      waitUntil: input.providerRetryAt,
    };
  }

  if (input.providerRetryAt) {
    const hoursUntilRetry = (input.providerRetryAt.getTime() - input.now.getTime()) / HOUR_MS;
    if (hoursUntilRetry > PROVIDER_RETRY_LEAD_HOURS) {
      return {
        kind: "wait_until",
        reason: "hold_until_shortly_before_provider_retry",
        waitUntil: new Date(input.providerRetryAt.getTime() - PROVIDER_RETRY_LEAD_HOURS * HOUR_MS),
      };
    }
    if (hoursUntilRetry >= -PROVIDER_RETRY_LEAD_HOURS) {
      return {
        kind: "outreach_email",
        reason: "contact_before_provider_retry",
        waitUntil: null,
        rung: "instrument_fix",
      };
    }
  }

  if (input.failureCategory === "insufficient_funds") {
    const salaryWindow = nextSalaryWindow(input.now);
    if (salaryWindow.getTime() - input.now.getTime() > 0) {
      return { kind: "wait_until", reason: "await_salary_window", waitUntil: salaryWindow };
    }
  }

  if (input.failureCategory === "bank_decline" && input.attemptCount === 0) {
    const hoursSinceFailure = (input.now.getTime() - input.occurredAt.getTime()) / HOUR_MS;
    if (hoursSinceFailure < SOFT_DECLINE_WAIT_HOURS) {
      return {
        kind: "wait_until",
        reason: "soft_decline_may_clear",
        waitUntil: new Date(input.occurredAt.getTime() + SOFT_DECLINE_WAIT_HOURS * HOUR_MS),
      };
    }
  }

  if (input.failureCategory === "unknown" && !input.humanApproved) {
    return { kind: "escalate_human", reason: "unmapped_failure_code", waitUntil: null };
  }

  return {
    kind: "outreach_email",
    reason: `customer_action_required:${input.failureCategory}`,
    waitUntil: null,
    rung: "instrument_fix",
  };
}
