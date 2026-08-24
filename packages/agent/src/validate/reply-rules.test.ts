import { describe, expect, it } from "vitest";
import { validateReply } from "./reply-rules.js";

const LINK = "https://riko.sagnik.fun/pay/abc";

describe("validateReply", () => {
  it("accepts a plain reply using only the allowed link", () => {
    const result = validateReply(`Hi Sagnik, thanks for letting us know. You can pay here: ${LINK}`, [LINK]);
    expect(result.valid).toBe(true);
  });

  it("rejects an offer of a discount", () => {
    const result = validateReply("Hi Sagnik, we can offer a 10% discount this once.", [LINK]);
    expect(result.valid).toBe(false);
    expect(result.failures.map((f) => f.rule)).toContain("no_concession");
  });

  it("rejects a threat of legal action", () => {
    const result = validateReply("Hi Sagnik, we will begin legal action next week.", [LINK]);
    expect(result.failures.map((f) => f.rule)).toContain("no_threat");
  });

  it("rejects admitting the charge was wrong", () => {
    const result = validateReply("Hi Sagnik, that was our mistake.", [LINK]);
    expect(result.failures.map((f) => f.rule)).toContain("no_liability_admission");
  });

  it("accepts an allowed link followed by sentence punctuation", () => {
    const result = validateReply(`Hi Sagnik, you can pay here: ${LINK}.`, [LINK]);
    expect(result.valid).toBe(true);
  });

  it("rejects a link that was not provided", () => {
    const result = validateReply("Hi Sagnik, pay at https://evil.example/pay", [LINK]);
    expect(result.failures.map((f) => f.rule)).toContain("url_allowlist");
  });

  it("rejects an over-long reply", () => {
    const result = validateReply(`Hi Sagnik, ${"word ".repeat(200)}`, [LINK]);
    expect(result.failures.map((f) => f.rule)).toContain("reply_length");
  });

  it("accepts the allowed amount written with different separators or precision", () => {
    const result = validateReply(
      "Hi Sagnik, the ₹2,400 due is shown in your dashboard. You can pay here: https://riko.sagnik.fun/pay/abc",
      [LINK],
      ["2400.00"],
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an amount that was not given", () => {
    const result = validateReply(
      "Hi Sagnik, the INR 4800.00 total is due. You can pay here: https://riko.sagnik.fun/pay/abc",
      [LINK],
      ["2400.00"],
    );
    expect(result.failures.map((f) => f.rule)).toContain("amount_consistency");
  });
});
