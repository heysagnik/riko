import { describe, expect, it } from "vitest";
import { routeIntervention, nextSalaryWindow, type InterventionInput } from "./route.js";

const NOW = new Date("2026-08-15T10:00:00Z");

function input(overrides: Partial<InterventionInput> = {}): InterventionInput {
  return {
    exposureKind: "payment_failure",
    dueAt: null,
    priorExposures: 0,
    failureCategory: "expired_card",
    failureSource: "customer",
    failureCode: "expired_card",
    amountMinor: 249900,
    providerRetryAt: null,
    occurredAt: new Date("2026-08-15T09:00:00Z"),
    attemptCount: 0,
    now: NOW,
    humanReviewMinor: 5000000,
    humanApproved: false,
    ...overrides,
  };
}

describe("routeIntervention", () => {
  it("emails when only the cardholder can fix it", () => {
    expect(routeIntervention(input()).kind).toBe("outreach_email");
  });

  it("never contacts on a fraud signal", () => {
    const result = routeIntervention(input({ failureCode: "fraudulent_do_not_honor" }));
    expect(result.kind).toBe("stop_never_contact");
    expect(result.reason).toBe("fraud_signal");
  });

  it("stays silent for transient gateway faults", () => {
    const result = routeIntervention(
      input({ failureCategory: "network_error", failureSource: "gateway", failureCode: "gateway_error" }),
    );
    expect(result.kind).toBe("no_action_provider_retrying");
  });

  it("treats a network-sourced failure as transient even when miscategorised", () => {
    const result = routeIntervention(
      input({ failureCategory: "bank_decline", failureSource: "network", failureCode: "server_error" }),
    );
    expect(result.kind).toBe("no_action_provider_retrying");
  });

  it("holds outreach until shortly before a distant provider retry", () => {
    const retryAt = new Date(NOW.getTime() + 72 * 60 * 60 * 1000);
    const result = routeIntervention(input({ providerRetryAt: retryAt }));
    expect(result.kind).toBe("wait_until");
    expect(result.waitUntil).toEqual(new Date(retryAt.getTime() - 18 * 60 * 60 * 1000));
  });

  it("emails immediately when the provider retry is imminent", () => {
    const retryAt = new Date(NOW.getTime() + 4 * 60 * 60 * 1000);
    expect(routeIntervention(input({ providerRetryAt: retryAt })).kind).toBe("outreach_email");
  });

  it("waits for the salary window on insufficient funds", () => {
    const result = routeIntervention(
      input({ failureCategory: "insufficient_funds", failureCode: "insufficient_funds" }),
    );
    expect(result.kind).toBe("wait_until");
    expect(result.reason).toBe("await_salary_window");
  });

  it("lets a soft decline settle before contacting", () => {
    const result = routeIntervention(
      input({ failureCategory: "bank_decline", failureSource: "issuer", failureCode: "payment_declined" }),
    );
    expect(result.kind).toBe("wait_until");
    expect(result.reason).toBe("soft_decline_may_clear");
  });

  it("contacts a soft decline once it has had time to settle", () => {
    const result = routeIntervention(
      input({
        failureCategory: "bank_decline",
        failureSource: "issuer",
        failureCode: "payment_declined",
        occurredAt: new Date(NOW.getTime() - 30 * 60 * 60 * 1000),
      }),
    );
    expect(result.kind).toBe("outreach_email");
  });

  it("escalates above the human review threshold", () => {
    const result = routeIntervention(input({ amountMinor: 9000000, humanReviewMinor: 5000000 }));
    expect(result.kind).toBe("escalate_human");
    expect(result.reason).toBe("above_human_review_threshold");
  });

  it("escalates rather than guessing at an unmapped code", () => {
    const result = routeIntervention(
      input({ failureCategory: "unknown", failureSource: "unknown", failureCode: "weird_new_code" }),
    );
    expect(result.kind).toBe("escalate_human");
    expect(result.reason).toBe("unmapped_failure_code");
  });

  it("escalates a merchant configuration fault instead of emailing the customer", () => {
    const result = routeIntervention(input({ failureSource: "business" }));
    expect(result.kind).toBe("escalate_human");
  });
});

describe("human review override", () => {
  it("stops re-escalating a high-value case once a person has approved it", () => {
    const escalated = routeIntervention(input({ amountMinor: 9000000, humanReviewMinor: 5000000 }));
    expect(escalated.kind).toBe("escalate_human");

    const approved = routeIntervention(
      input({ amountMinor: 9000000, humanReviewMinor: 5000000, humanApproved: true }),
    );
    expect(approved.kind).toBe("outreach_email");
  });

  it("proceeds on an unmapped code once a person has approved it", () => {
    const approved = routeIntervention(
      input({ failureCategory: "unknown", failureSource: "unknown", failureCode: "odd", humanApproved: true }),
    );
    expect(approved.kind).toBe("outreach_email");
  });

  it("proceeds on a merchant configuration fault once approved", () => {
    const approved = routeIntervention(input({ failureSource: "business", humanApproved: true }));
    expect(approved.kind).toBe("outreach_email");
  });

  it("never lets approval override a fraud signal", () => {
    const approved = routeIntervention(input({ failureCode: "fraudulent_do_not_honor", humanApproved: true }));
    expect(approved.kind).toBe("stop_never_contact");
  });

  it("still respects timing rules after approval", () => {
    const approved = routeIntervention(
      input({
        failureCategory: "insufficient_funds",
        failureCode: "insufficient_funds",
        amountMinor: 9000000,
        humanApproved: true,
      }),
    );
    expect(approved.kind).toBe("wait_until");
  });
});

describe("nextSalaryWindow", () => {
  it("targets the 2nd of next month from mid-month", () => {
    const result = nextSalaryWindow(new Date("2026-08-15T10:00:00Z"));
    expect(result.getUTCMonth()).toBe(8);
    expect(result.getUTCDate()).toBe(2);
  });

  it("targets the 2nd of this month when still on the 1st", () => {
    const result = nextSalaryWindow(new Date("2026-08-01T10:00:00Z"));
    expect(result.getUTCMonth()).toBe(7);
    expect(result.getUTCDate()).toBe(2);
  });
});
