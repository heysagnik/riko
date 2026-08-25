import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { reasonPaymentCase, type ReasonPaymentCaseInput } from "./reason-payment-case.js";

const input: ReasonPaymentCaseInput = {
  caseId: "case_1",
  merchantName: "Acme Retail",
  customerName: "Priya Sharma",
  amountMinor: 50_00,
  currency: "inr",
  failureCode: "insufficient_funds",
  failureDescription: "The customer does not have sufficient funds.",
  failureCategoryHint: "insufficient_funds",
  failureSourceHint: "issuer",
  attemptCount: 0,
  priorExposures: 0,
  hoursSinceFailure: 2,
  providerRetryAt: null,
  updatePaymentMethodUrl: "https://riko.example/pay/abc",
  unsubscribeUrl: "https://riko.example/unsub/abc",
  additionalContext: null,
};

function modelReturning(text: string) {
  const result: LanguageModelV3GenerateResult = {
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    content: [{ type: "text", text }],
    warnings: [],
  };
  return new MockLanguageModelV3({ doGenerate: async () => result });
}

const VALID_JSON = `{"decision":"contact","confidence":0.8,"rationale":"Customer can retry.","rung":"instrument_fix","waitHours":null}`;

describe("reasonPaymentCase", () => {
  it("parses a clean JSON response", async () => {
    const result = await reasonPaymentCase(modelReturning(VALID_JSON), input);
    expect(result.decision).toBe("contact");
    expect(result.rung).toBe("instrument_fix");
    expect(result.confidence).toBe(0.8);
  });

  it("parses JSON that follows an unrequested reasoning preamble", async () => {
    const withPreamble = `Here's a thinking process:\n\n1. **Analyze the case:** the card had no funds.\n2. **Decide:** contact.\n\n${VALID_JSON}`;
    const result = await reasonPaymentCase(modelReturning(withPreamble), input);
    expect(result.decision).toBe("contact");
    expect(result.rationale).toBe("Customer can retry.");
  });

  it("parses JSON wrapped in a markdown code fence", async () => {
    const result = await reasonPaymentCase(modelReturning("```json\n" + VALID_JSON + "\n```"), input);
    expect(result.decision).toBe("contact");
  });

  it("drops a rung the model attached to a non-contact decision", async () => {
    const escalate = `{"decision":"escalate","confidence":0.7,"rationale":"Merchant fault.","rung":"firm","waitHours":12}`;
    const result = await reasonPaymentCase(modelReturning(escalate), input);
    expect(result.decision).toBe("escalate");
    expect(result.rung).toBeNull();
    expect(result.waitHours).toBeNull();
  });

  it("forces contact on a business-source fault even when the model escalates", async () => {
    const escalate = `{"decision":"escalate","confidence":0.8,"rationale":"Unknown code, needs a human.","rung":null,"waitHours":null}`;
    const result = await reasonPaymentCase(modelReturning(escalate), { ...input, failureSourceHint: "business" });
    expect(result.decision).toBe("contact");
    expect(result.rung).toBe("instrument_fix");
    expect(result.rationale).toContain("Deterministic override");
  });

  it("downgrades a model stop on a benign code to contact", async () => {
    const paranoid = `{"decision":"stop","confidence":0.9,"rationale":"Expired card means compromised instrument.","rung":null,"waitHours":null}`;
    const result = await reasonPaymentCase(modelReturning(paranoid), {
      ...input,
      failureCode: "payment_expired_card",
      failureDescription: "Your card has expired.",
      failureSourceHint: "customer",
    });
    expect(result.decision).toBe("contact");
    expect(result.rung).toBe("instrument_fix");
    expect(result.rationale).toContain("not a compromise signal");
  });

  it("keeps a model stop when the description alleges fraud on an unmapped code", async () => {
    const fraudStop = `{"decision":"stop","confidence":0.8,"rationale":"Description says stolen card.","rung":null,"waitHours":null}`;
    const result = await reasonPaymentCase(modelReturning(fraudStop), {
      ...input,
      failureCode: "some_new_code",
      failureDescription: "Customer reported the card as stolen.",
      failureSourceHint: "issuer",
    });
    expect(result.decision).toBe("stop");
  });

  it("still stops on fraud even from a business source", async () => {
    const contact = `{"decision":"contact","confidence":0.9,"rationale":"Customer can retry.","rung":"instrument_fix","waitHours":null}`;
    const result = await reasonPaymentCase(modelReturning(contact), {
      ...input,
      failureCode: "stolen_card",
      failureSourceHint: "business",
    });
    expect(result.decision).toBe("stop");
  });

  it("keeps waitHours only for a wait decision", async () => {
    const wait = `{"decision":"wait","confidence":0.7,"rationale":"Provider retrying.","rung":null,"waitHours":24}`;
    const result = await reasonPaymentCase(modelReturning(wait), input);
    expect(result.waitHours).toBe(24);
  });

  it("throws when the model never emits JSON", async () => {
    await expect(reasonPaymentCase(modelReturning("Here's a thinking process: ..."), input)).rejects.toThrow(
      /did not return JSON/,
    );
  });

  it("rejects a decision outside the allowed set", async () => {
    const bogus = `{"decision":"refund","confidence":0.9,"rationale":"x","rung":null,"waitHours":null}`;
    await expect(reasonPaymentCase(modelReturning(bogus), input)).rejects.toThrow();
  });
});
