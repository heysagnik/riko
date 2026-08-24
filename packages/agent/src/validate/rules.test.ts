import { describe, expect, it } from "vitest";
import { validateDraft } from "./rules.js";
import type { CaseFacts, EmailDraft } from "@riko/shared";

const facts: CaseFacts = {
  caseId: "case_1",
  exposureKind: "payment_failure",
  rung: "instrument_fix",
  language: "english",
  daysOverdue: null,
  amountMinor: 4999,
  currency: "usd",
  failureCategory: "insufficient_funds",
  customerName: "Alex Rivera",
  attemptNumber: 1,
  priorSubjects: [],
  merchantName: "Acme Inc",
  updatePaymentMethodUrl: "https://pay.example.com/update/abc",
  unsubscribeUrl: "https://pay.example.com/unsub/abc",
};

function validDraft(): EmailDraft {
  const body =
    `Hi Alex Rivera, your recent payment of 49.99 to Acme Inc did not go through. ` +
    `Please update your payment method to keep your subscription active. We will retry automatically. ` +
    `If you believe this is a mistake, no action is needed and we will try again soon. Thank you for being a customer.`;
  return {
    subject: "Action needed: update your payment method",
    bodyText: `${body} https://pay.example.com/update/abc https://pay.example.com/unsub/abc`,
    bodyHtml: `<p>${body}</p><a href="https://pay.example.com/update/abc">Update</a><a href="https://pay.example.com/unsub/abc">Unsubscribe</a>`,
  };
}

describe("validateDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(validateDraft(validDraft(), facts).valid).toBe(true);
  });

  it("rejects blocklisted language", () => {
    const draft = validDraft();
    draft.bodyText += " We can offer you a discount.";
    const result = validateDraft(draft, facts);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.rule === "blocklist")).toBe(true);
  });

  it("rejects unexpected URLs", () => {
    const draft = validDraft();
    draft.bodyText += " https://evil.example.com/phish";
    const result = validateDraft(draft, facts);
    expect(result.failures.some((f) => f.rule === "url_allowlist")).toBe(true);
  });

  it("rejects missing amount", () => {
    const draft = validDraft();
    draft.bodyText = draft.bodyText.replace("49.99", "");
    draft.bodyHtml = draft.bodyHtml.replace("49.99", "");
    const result = validateDraft(draft, facts);
    expect(result.failures.some((f) => f.rule === "amount_present")).toBe(true);
  });
});

describe("validateDraft: rung tone ladder", () => {
  function at(rung: string): CaseFacts {
    return { ...facts, rung, exposureKind: rung === "resume_checkout" ? "checkout_abandonment" : "overdue_receivable" };
  }

  function withBody(text: string): EmailDraft {
    const draft = validDraft();
    draft.bodyText += ` ${text}`;
    return draft;
  }

  it("will not tell an abandoned-cart customer their payment failed", () => {
    const result = validateDraft(withBody("Your payment failed."), at("resume_checkout"));
    expect(result.failures.some((f) => f.rule === "rung_tone")).toBe(true);
  });

  it("will not let a first reminder threaten suspension", () => {
    const result = validateDraft(withBody("We may suspend your account."), at("reminder"));
    expect(result.failures.some((f) => f.rule === "rung_tone")).toBe(true);
  });

  it("will not let a firm notice mention collections", () => {
    const result = validateDraft(withBody("This goes to collections next."), at("firm"));
    expect(result.failures.some((f) => f.rule === "rung_tone")).toBe(true);
  });

  it("will not let even a formal notice threaten legal action", () => {
    const result = validateDraft(withBody("We will commence legal action."), at("formal"));
    expect(result.failures.some((f) => f.rule === "rung_tone")).toBe(true);
  });

  it("allows firm language at the rung that earned it", () => {
    const draft = withBody("This invoice remains unpaid and is now past due.");
    expect(validateDraft(draft, at("firm")).failures.some((f) => f.rule === "rung_tone")).toBe(false);
  });

  it("rejects that same firm language one rung too early", () => {
    const draft = withBody("This invoice remains unpaid and is now past due.");
    expect(validateDraft(draft, at("resume_checkout")).failures.some((f) => f.rule === "rung_tone")).toBe(true);
  });
});
