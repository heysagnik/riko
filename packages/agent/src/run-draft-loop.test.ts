import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { runDraftLoop } from "./run-draft-loop.js";
import type { CaseFacts, EmailDraft } from "@riko/shared";
import type { LogActionInput } from "./tools/log-action.js";

const facts: CaseFacts = {
  caseId: "case_101",
  exposureKind: "payment_failure",
  rung: "instrument_fix",
  language: "english",
  daysOverdue: null,
  amountMinor: 5000,
  currency: "usd",
  failureCategory: "insufficient_funds",
  customerName: "Alex Rivera",
  attemptNumber: 1,
  priorSubjects: [],
  merchantName: "Acme Inc",
  updatePaymentMethodUrl: "https://pay.example.com/update/abc",
  unsubscribeUrl: "https://pay.example.com/unsub/abc",
};

function makeValidDraft(scoreHigh = true): EmailDraft {
  const base =
    `Hi Alex Rivera, your recent payment of 50.00 to Acme Inc did not go through because of insufficient funds. ` +
    `Nothing has been cancelled. Please update your payment method here: https://pay.example.com/update/abc. ` +
    `If you have already sorted this out, you can safely ignore this email. ` +
    `To stop receiving these notices, unsubscribe here: https://pay.example.com/unsub/abc. ` +
    `Thank you for being a customer.`;

  return {
    subject: scoreHigh ? "Action needed: update payment method for Acme" : "Notice",
    bodyText: base,
    bodyHtml: `<p>${base}</p>`,
  };
}

function makeInvalidDraft(): EmailDraft {
  // Invalid: missing customer name and amount
  return {
    subject: "Payment failed",
    bodyText: "Your payment failed. Update: https://pay.example.com/update/abc https://pay.example.com/unsub/abc",
    bodyHtml: "<p>Your payment failed.</p>",
  };
}

function createSequentialModel(draftsOrErrors: (EmailDraft | Error)[]) {
  let callIndex = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const item = draftsOrErrors[callIndex++] ?? draftsOrErrors[draftsOrErrors.length - 1]!;
      if (item instanceof Error) throw item;
      const result: LanguageModelV3GenerateResult = {
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        content: [{ type: "text", text: JSON.stringify(item) }],
        warnings: [],
      };
      return result;
    },
  });
}

describe("runDraftLoop", () => {
  it("returns immediately on attempt 1 when draft is valid and scores >= 80", async () => {
    const logs: LogActionInput[] = [];
    const highDraft = makeValidDraft(true);
    const model = createSequentialModel([highDraft]);

    const outcome = await runDraftLoop(model, "test-model", "case_101", facts, async (entry) => {
      logs.push(entry);
    });

    expect(outcome.status).toBe("valid");
    if (outcome.status === "valid") {
      expect(outcome.draft.subject).toBe(highDraft.subject);
    }
    // 2 logs: 1 draft_email + 1 validate_draft
    expect(logs.length).toBe(2);
    expect(logs[0]!.tool).toBe("draft_email");
    expect(logs[1]!.tool).toBe("validate_draft");
  });

  it("recovers on attempt 2 when attempt 1 fails validation", async () => {
    const logs: LogActionInput[] = [];
    const invalid = makeInvalidDraft();
    const valid = makeValidDraft(true);
    const model = createSequentialModel([invalid, valid]);

    const outcome = await runDraftLoop(model, "test-model", "case_101", facts, async (entry) => {
      logs.push(entry);
    });

    expect(outcome.status).toBe("valid");
    if (outcome.status === "valid") {
      expect(outcome.draft.subject).toBe(valid.subject);
    }
    // Attempt 1: draft + validate (failed) -> Attempt 2: draft + validate (success >= 80) = 4 logs
    expect(logs.length).toBe(4);
  });

  it("recovers when attempt 1 throws a generation exception", async () => {
    const logs: LogActionInput[] = [];
    const valid = makeValidDraft(true);
    let calls = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1;
        // Fail both generateObject and generateText on attempt 1
        if (calls <= 2) {
          throw new Error("Provider timeout 504");
        }
        const result: LanguageModelV3GenerateResult = {
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 10, text: 10, reasoning: undefined },
          },
          content: [{ type: "text", text: JSON.stringify(valid) }],
          warnings: [],
        };
        return result;
      },
    });

    const outcome = await runDraftLoop(model, "test-model-err", "case_101", facts, async (entry) => {
      logs.push(entry);
    });

    expect(outcome.status).toBe("valid");
    expect(logs.some((l) => l.tool === "draft_email" && typeof (l.output as any)?.error === "string" && (l.output as any).error.includes("504"))).toBe(true);
  });

  it("escalates when all 3 attempts fail validation", async () => {
    const logs: LogActionInput[] = [];
    const invalid = makeInvalidDraft();
    const model = createSequentialModel([invalid, invalid, invalid]);

    const outcome = await runDraftLoop(model, "test-model", "case_101", facts, async (entry) => {
      logs.push(entry);
    });

    expect(outcome.status).toBe("escalated");
    if (outcome.status === "escalated") {
      expect(outcome.lastFailures.length).toBeGreaterThan(0);
      expect(outcome.lastFailures.some((f) => f.includes("customer_name_present") || f.includes("amount_present"))).toBe(true);
    }
    // 3 attempts * (1 draft + 1 validate) = 6 logs
    expect(logs.length).toBe(6);
  });
});
