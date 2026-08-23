import { describe, expect, it } from "vitest";
import { routeIntervention, rungForDaysOverdue, type InterventionInput } from "./route.js";

const NOW = new Date("2026-08-15T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function dueDaysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function input(overrides: Partial<InterventionInput> = {}): InterventionInput {
  return {
    exposureKind: "overdue_receivable",
    failureCategory: "unknown",
    failureSource: "unknown",
    failureCode: null,
    amountMinor: 450000,
    providerRetryAt: null,
    occurredAt: dueDaysAgo(35),
    dueAt: dueDaysAgo(3),
    attemptCount: 0,
    priorExposures: 0,
    now: NOW,
    humanReviewMinor: 5_000_000,
    humanApproved: false,
    ...overrides,
  };
}

describe("rungForDaysOverdue", () => {
  it("climbs one rung at a time", () => {
    expect(rungForDaysOverdue(0)).toBeNull();
    expect(rungForDaysOverdue(1)).toBe("reminder");
    expect(rungForDaysOverdue(6)).toBe("reminder");
    expect(rungForDaysOverdue(7)).toBe("firm");
    expect(rungForDaysOverdue(20)).toBe("firm");
    expect(rungForDaysOverdue(21)).toBe("formal");
  });
});

describe("routeIntervention: overdue receivable", () => {
  it("stays quiet inside payment terms", () => {
    const result = routeIntervention(input({ dueAt: new Date(NOW.getTime() + 2 * DAY) }));
    expect(result.kind).toBe("wait_until");
    expect(result.reason).toBe("within_payment_terms");
  });

  it("opens with a reminder, not a demand", () => {
    const result = routeIntervention(input({ dueAt: dueDaysAgo(2) }));
    expect(result.kind).toBe("outreach_email");
    expect(result.rung).toBe("reminder");
  });

  it("firms up after a week", () => {
    expect(routeIntervention(input({ dueAt: dueDaysAgo(9) })).rung).toBe("firm");
  });

  it("turns formal at three weeks", () => {
    expect(routeIntervention(input({ dueAt: dueDaysAgo(22) })).rung).toBe("formal");
  });

  it("hands over to a person rather than escalating tone further", () => {
    const result = routeIntervention(input({ dueAt: dueDaysAgo(31) }));
    expect(result.kind).toBe("escalate_human");
    expect(result.reason).toBe("aged_past_collections_handover");
  });

  it("sends a large invoice to a person before any email", () => {
    expect(routeIntervention(input({ amountMinor: 6_000_000 })).kind).toBe("escalate_human");
  });
});
