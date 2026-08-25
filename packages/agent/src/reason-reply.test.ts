import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { reasonReply, type ReasonReplyInput } from "./reason-reply.js";

const input: ReasonReplyInput = {
  customerName: "Priya Sharma",
  customerMessage: "I already paid this yesterday through UPI.",
  amountLabel: "INR 2,400.00",
  merchantName: "Acme Retail",
  paymentUrl: "https://riko.example/pay/abc",
  history: [
    { role: "agent", text: "Hi Priya, your payment of INR 2,400.00 is due." },
    { role: "customer", text: "Can I get some details?" },
  ],
};

function mockModel(text: string) {
  const result: LanguageModelV3GenerateResult = {
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    },
    content: [{ type: "text", text }],
    warnings: [],
  };
  return new MockLanguageModelV3({ doGenerate: async () => result });
}

describe("reasonReply", () => {
  it("classifies promise_to_pay and allows replyText without forcing human escalation", async () => {
    const json = JSON.stringify({
      intent: "promise_to_pay",
      confidence: 0.95,
      rationale: "Customer stated they will pay tomorrow.",
      replyText: "Hi Priya, thank you for confirming. You can complete payment here: https://riko.example/pay/abc",
    });

    const model = mockModel(json);
    const result = await reasonReply(model, input);

    expect(result.intent).toBe("promise_to_pay");
    expect(result.confidence).toBe(0.95);
    expect(result.replyText).toContain("https://riko.example/pay/abc");
    expect(result.needsHuman).toBe(false);
  });

  it("keeps already_paid with the agent - webhooks verify the payment, not a human", async () => {
    const json = JSON.stringify({
      intent: "already_paid",
      confidence: 0.9,
      rationale: "Customer claims previous payment.",
      replyText: "Hi Priya, thank you. We are checking our records.",
    });

    const result = await reasonReply(mockModel(json), input);
    expect(result.intent).toBe("already_paid");
    expect(result.needsHuman).toBe(false);
    expect(result.replyText).toBeTruthy();
  });

  it("keeps hostile-but-resolving replies with the agent", async () => {
    const json = JSON.stringify({
      intent: "hostile",
      confidence: 0.9,
      rationale: "Customer is rude but the bill still stands.",
      replyText: "Hi Priya, totally understand the frustration. The quickest fix is right here: https://riko.example/pay/abc",
    });

    const result = await reasonReply(mockModel(json), input);
    expect(result.intent).toBe("hostile");
    expect(result.needsHuman).toBe(false);
  });

  it("flags dispute as an escalating intent requiring human review", async () => {
    const json = JSON.stringify({
      intent: "dispute",
      confidence: 0.85,
      rationale: "Customer denies ordering.",
      replyText: "Hi Priya, thank you for letting us know. A member of our team will review this.",
    });

    const result = await reasonReply(mockModel(json), input);
    expect(result.intent).toBe("dispute");
    expect(result.needsHuman).toBe(true);
  });

  it("suppresses replyText for unsubscribe intent", async () => {
    const json = JSON.stringify({
      intent: "unsubscribe",
      confidence: 0.98,
      rationale: "Customer requested to stop emails.",
      replyText: "Hi Priya, you have been unsubscribed.",
    });

    const result = await reasonReply(mockModel(json), input);
    expect(result.intent).toBe("unsubscribe");
    expect(result.replyText).toBeNull();
    expect(result.needsHuman).toBe(false);
  });

  it("forces needsHuman when model confidence is below 0.6", async () => {
    const json = JSON.stringify({
      intent: "question",
      confidence: 0.45,
      rationale: "Unclear intent in customer response.",
      replyText: "Hi Priya, could you clarify your question?",
    });

    const result = await reasonReply(mockModel(json), input);
    expect(result.intent).toBe("question");
    expect(result.confidence).toBe(0.45);
    expect(result.needsHuman).toBe(true);
  });

  it("scans past markdown code fences and preamble reasoning", async () => {
    const json = JSON.stringify({
      intent: "needs_more_time",
      confidence: 0.88,
      rationale: "Customer asked for an extension.",
      replyText: "Hi Priya, when do you anticipate completing the payment?",
    });
    const wrapped = `Thinking process:\n1. The user asks for time.\n\`\`\`json\n${json}\n\`\`\``;

    const result = await reasonReply(mockModel(wrapped), input);
    expect(result.intent).toBe("needs_more_time");
    expect(result.confidence).toBe(0.88);
  });

  it("throws when model returns invalid json or empty output", async () => {
    await expect(reasonReply(mockModel(""), input)).rejects.toThrow(/no content/);
    await expect(reasonReply(mockModel("invalid non-json"), input)).rejects.toThrow();
  });
});
