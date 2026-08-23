import { describe, expect, it } from "vitest";
import { stripQuotedContent } from "./strip-quote.js";

describe("stripQuotedContent", () => {
  it("drops a Gmail-style quoted original below the reply", () => {
    const text = [
      "Thanks - I'll pay this on Friday.",
      "",
      "On Sun, Aug 23, 2026 at 3:00 PM ABC Merchant <billing@sagnik.fun> wrote:",
      "> Hi Sagnik, your payment failed.",
      "> Unsubscribe: https://riko.sagnik.fun/unsub/xyz",
    ].join("\n");

    expect(stripQuotedContent(text)).toBe("Thanks - I'll pay this on Friday.");
  });

  it("drops Outlook-style From/Sent headers", () => {
    const text = [
      "Can I get a few more days?",
      "",
      "From: ABC Merchant",
      "Sent: Sunday, August 23, 2026",
      "Unsubscribe: https://riko.sagnik.fun/unsub/xyz",
    ].join("\n");

    expect(stripQuotedContent(text)).toBe("Can I get a few more days?");
  });

  it("drops plain '>' prefixed quote lines with no header", () => {
    const text = ["What is this charge for?", "> original text here", "> Unsubscribe: https://x/y"].join("\n");
    expect(stripQuotedContent(text)).toBe("What is this charge for?");
  });

  it("leaves an unquoted reply untouched", () => {
    expect(stripQuotedContent("I will pay on Monday.")).toBe("I will pay on Monday.");
  });
});
