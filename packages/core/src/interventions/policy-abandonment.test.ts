import { describe, expect, it } from "vitest";
import { routeIntervention, ABANDONMENT_FLOOR_MINOR, type InterventionInput } from "./route.js";

const NOW = new Date("2026-08-15T10:00:00Z");

function input(overrides: Partial<InterventionInput> = {}): InterventionInput {
  return {
    exposureKind: "checkout_abandonment",
    failureCategory: "unknown",
    failureSource: "unknown",
    failureCode: null,
    amountMinor: 149900,
    providerRetryAt: null,
    occurredAt: new Date("2026-08-15T09:00:00Z"),
    dueAt: null,
    attemptCount: 0,
    priorExposures: 0,
    now: NOW,
    humanReviewMinor: 5_000_000,
    humanApproved: false,
    ...overrides,
  };
}

describe("routeIntervention: checkout abandonment", () => {
  it("emails a resume link for a first abandonment", () => {
    const result = routeIntervention(input());
    expect(result.kind).toBe("outreach_email");
    expect(result.rung).toBe("resume_checkout");
  });

  it("does not chase a cart worth less than the attention", () => {
    const result = routeIntervention(input({ amountMinor: ABANDONMENT_FLOOR_MINOR - 1 }));
    expect(result.kind).toBe("stop_never_contact");
    expect(result.reason).toBe("below_contact_floor");
  });

  it("reads repeated abandonment as a price objection, not friction", () => {
    const result = routeIntervention(input({ priorExposures: 2 }));
    expect(result.kind).toBe("escalate_human");
    expect(result.reason).toBe("repeat_abandoner_price_objection");
  });

  it("sends a high-value cart to a person first", () => {
    expect(routeIntervention(input({ amountMinor: 6_000_000 })).kind).toBe("escalate_human");
  });

  it("never diagnoses an abandoned cart as a card fault", () => {
    // The payment policy would escalate on failureCategory "unknown"; the
    // abandonment policy must not, because there is no failure to diagnose.
    expect(routeIntervention(input()).kind).not.toBe("escalate_human");
  });
});
