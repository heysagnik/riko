import { describe, expect, it } from "vitest";
import { scoreDraft } from "./score.js";
import type { CaseFacts, EmailDraft } from "@riko/shared";

const baseFacts: CaseFacts = {
  caseId: "case_1",
  exposureKind: "payment_failure",
  rung: "instrument_fix",
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

// Generates a 70-word body meeting ideal word count (55-110 words)
function idealBody(customerName: string, payUrl: string, unsubUrl: string): string {
  return (
    `Hi ${customerName}, your recent subscription payment of 49.99 for Acme Inc did not go through ` +
    `because of insufficient funds in your account. Nothing has been cancelled and your service remains active. ` +
    `You can quickly update your payment details here: ${payUrl}. ` +
    `Once completed, everything picks up where you left off. If you have already sorted this out, ` +
    `please disregard this note. To stop emails: ${unsubUrl}. Thank you for your continued business.`
  );
}

describe("scoreDraft", () => {
  it("scores high for an ideal, reassuring, and personalized draft", () => {
    const draft: EmailDraft = {
      subject: "Update your payment method for Acme", // 36 chars (in 25-60 range)
      bodyText: idealBody(baseFacts.customerName, baseFacts.updatePaymentMethodUrl, baseFacts.unsubscribeUrl),
      bodyHtml: "<p>html version</p>",
    };

    const score = scoreDraft(draft, baseFacts);
    // Base 60 + reason(10) + subject(8) + wordCount(12) + cta(10) + name(5) + reassurance(8) = 113 -> clamped to 100
    expect(score).toBe(100);
  });

  it("penalizes corporate filler phrases", () => {
    const cleanDraft: EmailDraft = {
      subject: "Update payment method", // 21 chars (< 25)
      bodyText: `Hi Alex, please update here: ${baseFacts.updatePaymentMethodUrl} ${baseFacts.unsubscribeUrl}`,
      bodyHtml: "",
    };
    const fillerDraft: EmailDraft = {
      subject: "We are writing to inform you",
      bodyText: `Dear valued customer, kindly note you must update: ${baseFacts.updatePaymentMethodUrl} ${baseFacts.unsubscribeUrl}`,
      bodyHtml: "",
    };

    const cleanScore = scoreDraft(cleanDraft, baseFacts);
    const fillerScore = scoreDraft(fillerDraft, baseFacts);
    expect(fillerScore).toBeLessThan(cleanScore);
  });

  it("penalizes pressure and urgency words", () => {
    const normalDraft: EmailDraft = {
      subject: "Action needed on payment",
      bodyText: `Hi Alex, payment did not go through: ${baseFacts.updatePaymentMethodUrl}`,
      bodyHtml: "",
    };
    const pressureDraft: EmailDraft = {
      subject: "URGENT: Action needed",
      bodyText: `Hi Alex, you must pay immediately or service will be suspended: ${baseFacts.updatePaymentMethodUrl}`,
      bodyHtml: "",
    };

    expect(scoreDraft(pressureDraft, baseFacts)).toBeLessThan(scoreDraft(normalDraft, baseFacts));
  });

  it("penalizes multiple CTA link occurrences vs single CTA", () => {
    const singleCtaDraft: EmailDraft = {
      subject: "Update needed",
      bodyText: `Hi Alex, pay here: ${baseFacts.updatePaymentMethodUrl}`,
      bodyHtml: "",
    };
    const multiCtaDraft: EmailDraft = {
      subject: "Update needed",
      bodyText: `Hi Alex, pay here: ${baseFacts.updatePaymentMethodUrl} or retry at ${baseFacts.updatePaymentMethodUrl}`,
      bodyHtml: "",
    };

    const singleScore = scoreDraft(singleCtaDraft, baseFacts);
    const multiScore = scoreDraft(multiCtaDraft, baseFacts);
    expect(singleScore - multiScore).toBe(15); // +10 for single, -5 for multi = 15 point diff
  });

  it("rewards naming the concrete failure reason", () => {
    const genericDraft: EmailDraft = {
      subject: "Payment issue",
      bodyText: `Hi Alex, an error occurred with payment: ${baseFacts.updatePaymentMethodUrl}`,
      bodyHtml: "",
    };
    const specificDraft: EmailDraft = {
      subject: "Payment issue",
      bodyText: `Hi Alex, the payment failed due to insufficient funds: ${baseFacts.updatePaymentMethodUrl}`,
      bodyHtml: "",
    };

    expect(scoreDraft(specificDraft, baseFacts)).toBe(scoreDraft(genericDraft, baseFacts) + 10);
  });

  it("clamps score between 0 and 100", () => {
    const awfulDraft: EmailDraft = {
      subject: "urgent: we regret to inform you immediately",
      bodyText:
        "we are writing to inform you that please be advised at your earliest convenience we value your business " +
        "do not hesitate kindly note this is to notify dear valued customer that you must pay immediately urgent " +
        "failure to pay means account is suspended and terminated and must be paid.",
      bodyHtml: "",
    };
    expect(scoreDraft(awfulDraft, baseFacts)).toBe(0);
  });
});
