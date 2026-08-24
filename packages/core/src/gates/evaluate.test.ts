import { describe, expect, it } from "vitest";
import { evaluateGates, describePolicyLimits, isWithinContactWindow } from "./evaluate.js";
import type { GateCaseInput } from "./types.js";

const baseInput: GateCaseInput = {
  exposureKind: "payment_failure",
  customerSuppressed: false,
  localHour: 11,
  customerHasDeliverableEmail: true,
  customerUnsubscribed: false,
  customerHasBounced: false,
  tenantHasVerifiedSender: true,
  attemptCount: 0,
  hoursSinceLastOutreach: null,
  failureCategory: "insufficient_funds",
  failureRecoverable: true,
  paymentAgeDays: 1,
  tenantPaused: false,
  tenantWithinDailySendCap: true,
};

describe("evaluateGates", () => {
  it("passes a clean case", () => {
    expect(evaluateGates(baseInput)).toEqual({ eligible: true, reason: null });
  });

  it("blocks on undeliverable email", () => {
    const result = evaluateGates({ ...baseInput, customerHasDeliverableEmail: false });
    expect(result).toEqual({ eligible: false, reason: "no_deliverable_email" });
  });

  it("blocks after 3 attempts", () => {
    const result = evaluateGates({ ...baseInput, attemptCount: 3 });
    expect(result).toEqual({ eligible: false, reason: "attempts_exhausted" });
  });

  it("blocks within cooldown window", () => {
    const result = evaluateGates({ ...baseInput, hoursSinceLastOutreach: 10 });
    expect(result).toEqual({ eligible: false, reason: "cooldown_not_elapsed" });
  });

  it("blocks payments older than 21 days", () => {
    const result = evaluateGates({ ...baseInput, paymentAgeDays: 22 });
    expect(result).toEqual({ eligible: false, reason: "payment_too_old" });
  });

  it("keeps chasing an invoice at 22 days, which is not old for a receivable", () => {
    const result = evaluateGates({
      ...baseInput,
      exposureKind: "overdue_receivable",
      paymentAgeDays: 22,
    });
    expect(result.eligible).toBe(true);
  });

  it("gives up on an abandoned cart after a week", () => {
    const result = evaluateGates({
      ...baseInput,
      exposureKind: "checkout_abandonment",
      paymentAgeDays: 8,
    });
    expect(result).toEqual({ eligible: false, reason: "payment_too_old" });
  });

  it("blocks a suppressed customer even though they never unsubscribed", () => {
    const result = evaluateGates({ ...baseInput, customerSuppressed: true });
    expect(result).toEqual({ eligible: false, reason: "customer_suppressed" });
  });

  it("sends the first email at any hour", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(evaluateGates({ ...baseInput, localHour: hour }).eligible).toBe(true);
    }
  });

  it("holds follow-ups to the daytime window", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const result = evaluateGates({ ...baseInput, attemptCount: 1, localHour: hour });
      expect(result.eligible).toBe(hour >= 7 && hour < 23);
      if (!result.eligible) expect(result.reason).toBe("outside_contact_window");
    }
  });

  it("bounds the window at 7:00 inclusive and 23:00 exclusive", () => {
    expect(isWithinContactWindow(6)).toBe(false);
    expect(isWithinContactWindow(7)).toBe(true);
    expect(isWithinContactWindow(22)).toBe(true);
    expect(isWithinContactWindow(23)).toBe(false);
  });
});

describe("describePolicyLimits", () => {
  it("names every bound the agent runs under", () => {
    const limits = describePolicyLimits();
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every((l) => l.label && l.value)).toBe(true);
    expect(limits.map((l) => l.id)).toContain("contact_window");
  });
});
