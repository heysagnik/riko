// Qualitative reasoning assessment: unlike benchmark-agent-vs-deterministic.ts
// (which sweeps every official Razorpay failure code through the same thin
// scenario), this hand-crafts realistic multi-signal cases - repeat attempts,
// support notes, conflicting signals, edge amounts, elapsed time - the kind of
// thing a lookup table cannot represent but a real case has. Each scenario
// carries an expected decision and the reasoning a human analyst would use to
// get there, so a mismatch is a genuine finding, not just a disagreement with
// a deterministic router that has no opinion of its own.
//
// Run with: npx tsx --env-file=../../.env apps/worker/scripts/assess-agent-scenarios.ts

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { reasonPaymentCase, type PaymentCaseDecision, type ReasonPaymentCaseInput } from "@riko/agent";

if (!process.env.NVIDIA_API_KEY) {
  console.error("NVIDIA_API_KEY is not set. This assessment makes real LLM calls and needs it.");
  process.exit(1);
}

const nim = createOpenAICompatible({
  name: "nvidia",
  baseURL: process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});
const MODEL_ID = process.env.NVIDIA_NIM_MODEL ?? "meta/llama-3.1-8b-instruct";
const model = nim.chatModel(MODEL_ID);

const PAY_URL = "https://riko.example/pay/case";
const UNSUB_URL = "https://riko.example/unsub/case";

interface Scenario {
  id: string;
  title: string;
  why: string;
  input: ReasonPaymentCaseInput;
  acceptableDecisions: PaymentCaseDecision[];
}

const SCENARIOS: Scenario[] = [
  {
    id: "s1_plain_instrument_fix",
    title: "Ordinary first-time card decline",
    why: "Textbook customer-actionable failure, first attempt, no red flags. Should contact.",
    acceptableDecisions: ["contact"],
    input: {
      caseId: "s1",
      merchantName: "Acme Retail",
      customerName: "Rahul Verma",
      amountMinor: 149900,
      currency: "inr",
      failureCode: "insufficient_funds",
      failureDescription: "The customer's bank account did not have enough funds to complete the transaction.",
      failureCategoryHint: "insufficient_funds",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 3,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: null,
    },
  },
  {
    id: "s2_lost_card_disguised",
    title: "Lost card, described only as a generic decline",
    why: "The failure code itself says lost_card even though the description reads like an ordinary decline. Tests whether the model keys off the code, not just surface wording, and applies the new stop-on-compromised-instrument rule.",
    acceptableDecisions: ["stop"],
    input: {
      caseId: "s2",
      merchantName: "Acme Retail",
      customerName: "Priya Sharma",
      amountMinor: 50000,
      currency: "inr",
      failureCode: "lost_card",
      failureDescription: "The payment could not be completed with this card.",
      failureCategoryHint: "unknown",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 1,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: null,
    },
  },
  {
    id: "s3_merchant_config_fault",
    title: "Merchant forgot to enable a payment method",
    why: "invalid_currency: nothing the customer did wrong, nothing they can fix. Should escalate, not contact.",
    acceptableDecisions: ["escalate"],
    input: {
      caseId: "s3",
      merchantName: "Acme Retail",
      customerName: "Amit Kumar",
      amountMinor: 250000,
      currency: "inr",
      failureCode: "invalid_currency",
      failureDescription: "The currency passed is not supported or is invalid.",
      failureCategoryHint: "unknown",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 0.5,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: null,
    },
  },
  {
    id: "s4_transient_gateway_blip",
    title: "Gateway technical error, minutes old, provider already scheduled a retry",
    why: "Nothing wrong with the customer's instrument, provider is handling it. Emailing now would be premature and would contradict the provider's own retry. Should wait.",
    acceptableDecisions: ["wait"],
    input: {
      caseId: "s4",
      merchantName: "Acme Retail",
      customerName: "Sara Khan",
      amountMinor: 89000,
      currency: "inr",
      failureCode: "gateway_technical_error",
      failureDescription: "Technical error occurred at the gateway.",
      failureCategoryHint: "unknown",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 0.1,
      providerRetryAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: null,
    },
  },
  {
    id: "s5_repeat_failure_escalation",
    title: "Same instrument-fixable failure, but the fourth attempt in a week",
    why: "insufficient_funds alone would say contact, but 4 attempts and 2 prior exposures is a pattern a first-attempt read misses - a human analyst would want a second look rather than a fifth automated nudge.",
    acceptableDecisions: ["escalate", "wait"],
    input: {
      caseId: "s5",
      merchantName: "Acme Retail",
      customerName: "Vikram Singh",
      amountMinor: 320000,
      currency: "inr",
      failureCode: "insufficient_funds",
      failureDescription: "The customer's bank account did not have enough funds to complete the transaction.",
      failureCategoryHint: "insufficient_funds",
      attemptCount: 4,
      priorExposures: 2,
      hoursSinceFailure: 6,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: "Prior emails sent on attempts 1-3 all went unanswered. No replies from the customer on any of them.",
    },
  },
  {
    id: "s6_support_note_hardship",
    title: "Additional context reveals the customer is disputing the charge, not just failing to pay",
    why: "The failure code alone (payment_declined) looks like an ordinary decline, but additionalContext says the customer called claiming they never authorized this. That is dispute/fraud territory a human must see, regardless of what the code says.",
    acceptableDecisions: ["escalate", "stop"],
    input: {
      caseId: "s6",
      merchantName: "Acme Retail",
      customerName: "Neha Joshi",
      amountMinor: 175000,
      currency: "inr",
      failureCode: "payment_declined",
      failureDescription: "The payment has been declined.",
      failureCategoryHint: "bank_decline",
      attemptCount: 1,
      priorExposures: 0,
      hoursSinceFailure: 4,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: "Customer support note (yesterday): customer called saying they never authorized this transaction and want it investigated.",
    },
  },
  {
    id: "s7_near_threshold_unknown_code",
    title: "Large amount, unrecognized failure code, no other signal",
    why: "amount alone (well under the human-review threshold in this harness) shouldn't force escalation by itself, but an unmapped code with no other information is genuinely ambiguous - escalation is the honest answer, not a guess dressed up as a decision.",
    acceptableDecisions: ["escalate"],
    input: {
      caseId: "s7",
      merchantName: "Acme Retail",
      customerName: "Karan Mehta",
      amountMinor: 890000,
      currency: "inr",
      failureCode: "deemed_transaction",
      failureDescription: "The transaction is deemed and cannot be processed.",
      failureCategoryHint: "unknown",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 1,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: null,
    },
  },
  {
    id: "s8_resume_checkout_not_a_failure",
    title: "Order abandoned mid-checkout, nothing actually failed",
    why: "failureCode is null/none - this is a save-the-cart nudge, not a payment failure at all. Should contact with resume_checkout tone, never debt language, since nothing is owed yet.",
    acceptableDecisions: ["contact"],
    input: {
      caseId: "s8",
      merchantName: "Acme Retail",
      customerName: "Divya Rao",
      amountMinor: 60000,
      currency: "inr",
      failureCode: null,
      failureDescription: null,
      failureCategoryHint: "unknown",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 2,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: "Customer reached checkout, an order was created, but no payment attempt was ever made - they simply left.",
    },
  },
  {
    id: "s9_stolen_card_explicit",
    title: "Card explicitly reported stolen",
    why: "Unambiguous compromised-instrument case, the clearest possible test of the new prompt rule.",
    acceptableDecisions: ["stop"],
    input: {
      caseId: "s9",
      merchantName: "Acme Retail",
      customerName: "Arjun Nair",
      amountMinor: 45000,
      currency: "inr",
      failureCode: "stolen_card",
      failureDescription: "The card has been reported stolen.",
      failureCategoryHint: "unknown",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 0.3,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: null,
    },
  },
  {
    id: "s10_do_not_honor_first_attempt",
    title: "Generic 'do not honor' bank decline, no other context",
    why: "The exact code that missed in earlier benchmark runs. do_not_honor is a bare refusal with no stated reason, which is precisely why it must not be waved through as a routine instrument fix.",
    acceptableDecisions: ["stop", "escalate"],
    input: {
      caseId: "s10",
      merchantName: "Acme Retail",
      customerName: "Meera Iyer",
      amountMinor: 220000,
      currency: "inr",
      failureCode: "do_not_honor",
      failureDescription: "The issuing bank declined the payment without a specific reason.",
      failureCategoryHint: "unknown",
      attemptCount: 0,
      priorExposures: 0,
      hoursSinceFailure: 2,
      providerRetryAt: null,
      updatePaymentMethodUrl: PAY_URL,
      unsubscribeUrl: UNSUB_URL,
      additionalContext: null,
    },
  },
];

async function main() {
  console.error(`Running ${SCENARIOS.length} hand-crafted scenarios against ${MODEL_ID}...\n`);

  let pass = 0;
  const results: { scenario: Scenario; decision: PaymentCaseDecision; confidence: number; rationale: string; ok: boolean }[] = [];

  for (const scenario of SCENARIOS) {
    try {
      const result = await reasonPaymentCase(model, scenario.input);
      const ok = scenario.acceptableDecisions.includes(result.decision);
      if (ok) pass += 1;
      results.push({ scenario, decision: result.decision, confidence: result.confidence, rationale: result.rationale, ok });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ scenario, decision: "escalate", confidence: 0, rationale: `CALL FAILED: ${message.slice(0, 150)}`, ok: false });
    }
  }

  for (const r of results) {
    const verdict = r.ok ? "PASS" : "FAIL";
    console.log(`[${verdict}] ${r.scenario.id} - ${r.scenario.title}`);
    console.log(`  expected: ${r.scenario.acceptableDecisions.join(" or ")}   got: ${r.decision} (conf ${r.confidence.toFixed(2)})`);
    console.log(`  why this case: ${r.scenario.why}`);
    console.log(`  agent's rationale: ${r.rationale}`);
    console.log("");
  }

  console.log(`=== ${pass}/${SCENARIOS.length} scenarios matched an acceptable decision ===`);
}

await main();
