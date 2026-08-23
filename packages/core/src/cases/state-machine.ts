import type { CaseState } from "@riko/shared";

export type CaseTrigger =
  | { type: "gates_passed" }
  | { type: "gates_failed"; reason: string }
  | { type: "draft_valid" }
  | { type: "draft_invalid_exhausted" }
  | { type: "sent" }
  | { type: "payment_succeeded" }
  | { type: "customer_replied" }
  | { type: "promise_captured" }
  | { type: "promise_broken" }
  | { type: "customer_unsubscribed" }
  | { type: "hard_bounced" }
  | { type: "cooldown_elapsed_retry" }
  | { type: "cooldown_elapsed_exhausted" };

export interface TransitionResult {
  toState: CaseState;
  reason: string | null;
}

const INVALID_TRANSITION = Symbol("invalid");

function transition(from: CaseState, trigger: CaseTrigger): TransitionResult | typeof INVALID_TRANSITION {
  switch (from) {
    // Payment can land mid-pipeline, so recovery wins from every open state.
    case "NEW":
      if (trigger.type === "payment_succeeded") return { toState: "RECOVERED", reason: "payment_succeeded" };
      if (trigger.type === "gates_passed") return { toState: "DRAFTING", reason: null };
      if (trigger.type === "gates_failed") return { toState: "SKIPPED", reason: trigger.reason };
      return INVALID_TRANSITION;

    case "DRAFTING":
      if (trigger.type === "payment_succeeded") return { toState: "RECOVERED", reason: "payment_succeeded" };
      if (trigger.type === "draft_valid") return { toState: "SENDING", reason: null };
      if (trigger.type === "draft_invalid_exhausted") {
        return { toState: "ESCALATED", reason: "validation_failed_3x" };
      }
      return INVALID_TRANSITION;

    case "SENDING":
      if (trigger.type === "payment_succeeded") return { toState: "RECOVERED", reason: "payment_succeeded" };
      if (trigger.type === "sent") return { toState: "WAITING", reason: null };
      return INVALID_TRANSITION;

    case "WAITING":
      if (trigger.type === "payment_succeeded") return { toState: "RECOVERED", reason: "payment_succeeded" };
      if (trigger.type === "promise_captured") return { toState: "PROMISED", reason: "promise_to_pay" };
      if (trigger.type === "customer_replied") return { toState: "ESCALATED", reason: "customer_reply" };
      if (trigger.type === "customer_unsubscribed") {
        return { toState: "SKIPPED", reason: "customer_unsubscribed" };
      }
      if (trigger.type === "hard_bounced") return { toState: "SKIPPED", reason: "hard_bounce" };
      if (trigger.type === "cooldown_elapsed_retry") return { toState: "DRAFTING", reason: null };
      if (trigger.type === "cooldown_elapsed_exhausted") {
        return { toState: "LOST", reason: "attempts_exhausted" };
      }
      return INVALID_TRANSITION;

    // A promise pauses the ladder. Only payment, a broken promise, or the
    // customer withdrawing consent moves the case on from here.
    case "PROMISED":
      if (trigger.type === "payment_succeeded") return { toState: "RECOVERED", reason: "promise_kept" };
      if (trigger.type === "promise_broken") return { toState: "WAITING", reason: "promise_broken" };
      // Writing again after promising means something changed. A person reads it.
      if (trigger.type === "customer_replied" || trigger.type === "promise_captured") {
        return { toState: "ESCALATED", reason: "reply_after_promise" };
      }
      if (trigger.type === "customer_unsubscribed") {
        return { toState: "SKIPPED", reason: "customer_unsubscribed" };
      }
      if (trigger.type === "hard_bounced") return { toState: "SKIPPED", reason: "hard_bounce" };
      if (trigger.type === "cooldown_elapsed_exhausted") {
        return { toState: "LOST", reason: "attempts_exhausted" };
      }
      return INVALID_TRANSITION;

    // Suppressed cases still get paid; the holdout arm's rate depends on it.
    case "SKIPPED":
      if (trigger.type === "payment_succeeded") {
        return { toState: "RECOVERED", reason: "payment_succeeded" };
      }
      return INVALID_TRANSITION;

    default:
      return INVALID_TRANSITION;
  }
}

export function applyTransition(from: CaseState, trigger: CaseTrigger): TransitionResult {
  const result = transition(from, trigger);
  if (result === INVALID_TRANSITION) {
    throw new Error(`Invalid transition: ${from} + ${trigger.type}`);
  }
  return result;
}

export function isTerminal(state: CaseState): boolean {
  return state === "SKIPPED" || state === "LOST" || state === "ESCALATED" || state === "RECOVERED";
}
