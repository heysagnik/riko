import type { Intervention, InterventionInput } from "./types.js";

export const ABANDONMENT_FLOOR_MINOR = 20_000;

export const ABANDONMENT_SWEEP_MINUTES = 30;

const REPEAT_THRESHOLD = 2;

export function routeAbandonment(input: InterventionInput): Intervention {
  if (input.amountMinor < ABANDONMENT_FLOOR_MINOR) {
    return { kind: "stop_never_contact", reason: "below_contact_floor", waitUntil: null };
  }

  if (!input.humanApproved && input.amountMinor >= input.humanReviewMinor) {
    return { kind: "escalate_human", reason: "above_human_review_threshold", waitUntil: null };
  }

  if (input.priorExposures >= REPEAT_THRESHOLD) {
    return { kind: "escalate_human", reason: "repeat_abandoner_price_objection", waitUntil: null };
  }

  return {
    kind: "outreach_email",
    reason: "checkout_incomplete",
    waitUntil: null,
    rung: "resume_checkout",
  };
}
