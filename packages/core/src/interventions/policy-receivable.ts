import { DAY_MS, type Intervention, type InterventionInput } from "./types.js";

export type ReceivableRung = "reminder" | "firm" | "formal";

interface Rung {
  id: ReceivableRung;
  /** Days past the due date at which this rung becomes the right tone. */
  fromDaysOverdue: number;
}

// Escalation is earned by time, not impatience. The validator enforces each
// rung's tone, so the agent cannot skip ahead to a formal notice.
export const RECEIVABLE_RUNGS: Rung[] = [
  { id: "reminder", fromDaysOverdue: 1 },
  { id: "firm", fromDaysOverdue: 7 },
  { id: "formal", fromDaysOverdue: 21 },
];

const HANDOVER_DAYS = 30;

export function rungForDaysOverdue(days: number): ReceivableRung | null {
  let current: ReceivableRung | null = null;
  for (const rung of RECEIVABLE_RUNGS) {
    if (days >= rung.fromDaysOverdue) current = rung.id;
  }
  return current;
}

export function routeReceivable(input: InterventionInput): Intervention {
  const dueAt = input.dueAt ?? input.occurredAt;
  const daysOverdue = (input.now.getTime() - dueAt.getTime()) / DAY_MS;

  if (daysOverdue < 1) {
    return {
      kind: "wait_until",
      reason: "within_payment_terms",
      waitUntil: new Date(dueAt.getTime() + DAY_MS),
    };
  }

  if (daysOverdue >= HANDOVER_DAYS) {
    return { kind: "escalate_human", reason: "aged_past_collections_handover", waitUntil: null };
  }

  if (!input.humanApproved && input.amountMinor >= input.humanReviewMinor) {
    return { kind: "escalate_human", reason: "above_human_review_threshold", waitUntil: null };
  }

  const rung = rungForDaysOverdue(daysOverdue);
  if (!rung) {
    return {
      kind: "wait_until",
      reason: "within_payment_terms",
      waitUntil: new Date(dueAt.getTime() + DAY_MS),
    };
  }

  return {
    kind: "outreach_email",
    reason: `overdue_${Math.floor(daysOverdue)}d`,
    waitUntil: null,
    rung,
  };
}
