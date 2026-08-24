import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { reasonPaymentCase, reasonReply, draftEmail, runDraftLoop, scoreDraft } from "../src/index.js";
import type { CaseFacts } from "@riko/shared";

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
  throw new Error("NVIDIA_API_KEY environment variable is required");
}
const baseURL = process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const MODEL_ID = process.env.NVIDIA_NIM_MODEL ?? "meta/llama-3.1-8b-instruct";

const nim = createOpenAICompatible({
  name: "nvidia-nim",
  baseURL,
  apiKey,
});
const model = nim.chatModel(MODEL_ID);

async function runTests() {
  console.log("=================================================");
  console.log(`Testing Agent with: ${MODEL_ID}`);
  console.log("=================================================\n");

  // 1. Test reasonPaymentCase
  console.log("[1/3] Testing reasonPaymentCase...");
  const t0 = Date.now();
  const caseResult = await reasonPaymentCase(model, {
    caseId: "case_llama_test",
    merchantName: "Acme Retail",
    customerName: "Priya Sharma",
    amountMinor: 150000,
    currency: "inr",
    failureCode: "insufficient_funds",
    failureDescription: "Customer bank account has insufficient balance.",
    failureCategoryHint: "insufficient_funds",
    attemptCount: 0,
    priorExposures: 0,
    hoursSinceFailure: 2,
    providerRetryAt: null,
    updatePaymentMethodUrl: "https://riko.example/pay/test1",
    unsubscribeUrl: "https://riko.example/unsub/test1",
    additionalContext: null,
  });
  console.log(`  -> Latency: ${Date.now() - t0}ms`);
  console.log("  -> Decision:", caseResult.decision);
  console.log("  -> Rung:", caseResult.rung);
  console.log("  -> Confidence:", caseResult.confidence);
  console.log("  -> Rationale:", caseResult.rationale);

  // 2. Test reasonReply
  console.log("\n[2/3] Testing reasonReply...");
  const t1 = Date.now();
  const replyResult = await reasonReply(model, {
    customerName: "Priya Sharma",
    customerMessage: "I was traveling and could not complete it. I will pay tomorrow morning.",
    amountLabel: "INR 1,500.00",
    merchantName: "Acme Retail",
    paymentUrl: "https://riko.example/pay/test1",
  });
  console.log(`  -> Latency: ${Date.now() - t1}ms`);
  console.log("  -> Intent:", replyResult.intent);
  console.log("  -> Confidence:", replyResult.confidence);
  console.log("  -> Needs Human:", replyResult.needsHuman);
  console.log("  -> Reply Text:\n", replyResult.replyText);

  // 3. Test runDraftLoop
  console.log("\n[3/3] Testing runDraftLoop...");
  const facts: CaseFacts = {
    caseId: "case_llama_draft",
    exposureKind: "payment_failure",
    rung: "instrument_fix",
    daysOverdue: null,
    amountMinor: 150000,
    currency: "inr",
    failureCategory: "insufficient_funds",
    customerName: "Priya Sharma",
    attemptNumber: 1,
    priorSubjects: [],
    merchantName: "Acme Retail",
    updatePaymentMethodUrl: "https://riko.example/pay/test1",
    unsubscribeUrl: "https://riko.example/unsub/test1",
  };

  const t2 = Date.now();
  const draftOutcome = await runDraftLoop(model, MODEL_ID, "case_llama_draft", facts, async (entry) => {
    console.log(`  [Action logged] tool: ${entry.tool} | model: ${entry.model} | latency: ${entry.latencyMs}ms`);
  });
  console.log(`  -> Total Draft Loop Time: ${Date.now() - t2}ms`);
  console.log("  -> Status:", draftOutcome.status);

  if (draftOutcome.status === "valid") {
    console.log("  -> Subject:", draftOutcome.draft.subject);
    console.log("  -> Body Text:\n", draftOutcome.draft.bodyText);
    const score = scoreDraft(draftOutcome.draft, facts);
    console.log("  -> Score:", score);
  } else {
    console.log("  -> Escalation Failures:", draftOutcome.lastFailures);
  }

  console.log("\n=================================================");
  console.log("All tests completed successfully!");
  console.log("=================================================");
}

runTests().catch(console.error);
