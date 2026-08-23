import { describe, expect, it } from "vitest";
import { applyTransition } from "./state-machine.js";

describe("applyTransition", () => {
  it("moves NEW to DRAFTING on gates_passed", () => {
    expect(applyTransition("NEW", { type: "gates_passed" })).toEqual({ toState: "DRAFTING", reason: null });
  });

  it("moves NEW to SKIPPED with reason on gates_failed", () => {
    expect(applyTransition("NEW", { type: "gates_failed", reason: "payment_too_old" })).toEqual({
      toState: "SKIPPED",
      reason: "payment_too_old",
    });
  });

  it("moves WAITING to RECOVERED on payment_succeeded", () => {
    expect(applyTransition("WAITING", { type: "payment_succeeded" })).toEqual({
      toState: "RECOVERED",
      reason: "payment_succeeded",
    });
  });

  it.each(["NEW", "DRAFTING", "SENDING", "WAITING"] as const)(
    "recovers from %s on payment_succeeded",
    (from) => {
      expect(applyTransition(from, { type: "payment_succeeded" })).toEqual({
        toState: "RECOVERED",
        reason: "payment_succeeded",
      });
    },
  );

  it("throws on invalid transition", () => {
    expect(() => applyTransition("RECOVERED", { type: "sent" })).toThrow();
  });
});
