import { describe, expect, it } from "vitest";
import { detectEscalationSignals } from "./escalation-signals.js";

describe("detectEscalationSignals", () => {
  it("returns no signals for an ordinary reply", () => {
    expect(detectEscalationSignals("Sure, I can pay by Friday, thanks.")).toEqual([]);
  });

  it("flags legal language", () => {
    const signals = detectEscalationSignals("If this continues I will speak to my lawyer.");
    expect(signals.map((s) => s.rule)).toContain("legal_language");
  });

  it("flags dispute language", () => {
    const signals = detectEscalationSignals("This is fraud, I never authorized this charge.");
    expect(signals.map((s) => s.rule)).toContain("dispute_language");
  });

  it("flags distress language", () => {
    const signals = detectEscalationSignals("Please stop contacting me, this is harassment.");
    expect(signals.map((s) => s.rule)).toContain("distress_language");
  });

  it("is case-insensitive", () => {
    const signals = detectEscalationSignals("I WILL SUE if this happens again.");
    expect(signals.map((s) => s.rule)).toContain("legal_language");
  });
});
