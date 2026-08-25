import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { UnsupportedFunctionalityError } from "ai";
import { draftEmail } from "./draft-email.js";
import type { CaseFacts } from "@riko/shared";

const facts: CaseFacts = {
  caseId: "case_1",
  exposureKind: "payment_failure",
  rung: "instrument_fix",
  language: "english",
  daysOverdue: null,
  amountMinor: 2400_00,
  currency: "inr",
  failureCategory: "insufficient_funds",
  customerName: "Rahul Verma",
  attemptNumber: 1,
  priorSubjects: [],
  merchantName: "Acme Store",
  updatePaymentMethodUrl: "https://pay.example.com/update/xyz",
  unsubscribeUrl: "https://pay.example.com/unsub/xyz",
};

const VALID_DRAFT = {
  subject: "Your payment of INR 2400.00 did not go through",
  bodyText:
    "Hi Rahul Verma, your payment of 2400.00 to Acme Store was declined due to insufficient funds. " +
    "Please update your payment method here: https://pay.example.com/update/xyz. Unsubscribe: https://pay.example.com/unsub/xyz",
  bodyHtml:
    "<p>Hi Rahul Verma, your payment of 2400.00 was declined.</p>" +
    "<a href='https://pay.example.com/update/xyz'>Update</a><a href='https://pay.example.com/unsub/xyz'>Unsubscribe</a>",
};

function mockModel(text: string, throws?: Error) {
  const result: LanguageModelV3GenerateResult = {
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    content: [{ type: "text", text }],
    warnings: [],
  };
  return new MockLanguageModelV3({
    doGenerate: async () => {
      if (throws) throw throws;
      return result;
    },
  });
}

describe("draftEmail", () => {
  it("generates a draft using structured output or fallback", async () => {
    const model = mockModel(JSON.stringify(VALID_DRAFT));
    const result = await draftEmail(model, "test-model-1", { facts });

    expect(result.draft.subject).toBe(VALID_DRAFT.subject);
    expect(result.draft.bodyText).toBe(VALID_DRAFT.bodyText);
    expect(result.model).toBe("test-model-1");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("extracts JSON draft when wrapped in thinking process / markdown fence", async () => {
    const raw = `Thought process: writing email.\n\`\`\`json\n${JSON.stringify(VALID_DRAFT)}\n\`\`\``;
    const model = mockModel(raw);

    const fallbackModel = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new UnsupportedFunctionalityError({ functionality: "structuredOutput" });
      },
    });

    await draftEmail(fallbackModel, "unsupported-model-id", { facts }).catch(() => {});

    const result = await draftEmail(model, "unsupported-model-id", { facts });
    expect(result.draft.subject).toBe(VALID_DRAFT.subject);
  });

  it("throws when response lacks required draft fields", async () => {
    const invalidJson = JSON.stringify({ subject: "Only subject" });
    const model = mockModel(invalidJson);

    await draftEmail(
      new MockLanguageModelV3({
        doGenerate: async () => {
          throw new UnsupportedFunctionalityError({ functionality: "structuredOutput" });
        },
      }),
      "broken-model-id",
      { facts },
    ).catch(() => {});

    await expect(draftEmail(model, "broken-model-id", { facts })).rejects.toThrow();
  });
});
