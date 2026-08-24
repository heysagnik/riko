// Shadow-mode benchmark: for every sampled payment failure reason, run the
// LLM reasoning agent (reasonPaymentCase) and the deterministic router
// (routePaymentFailure) side by side and score how often they agree, which
// direction they disagree in, and whether the agent's own output would have
// survived the production validator. Nothing here drives real actions: this
// is how we decide whether the agent is trustworthy enough to expand its
// role, per the "deterministic stays the backbone, score the agent first"
// plan.
//
// Requires NVIDIA_API_KEY (provider "nvidia", the default) or ZAI_API_KEY
// (provider "zai"). Run with:
//   npx tsx --env-file=../../.env apps/worker/scripts/benchmark-agent-vs-deterministic.ts [--provider nvidia|zai] [--sample N] [--rpm N] [--json]
//
// --sample N spreads N cases evenly across both documented sections rather
// than taking the first N (which would be all "bad_request"). Synthetic
// fraud-signal codes are always appended: none of the documented reasons trip
// isFraudSignal(), so without them the fraud-rail metric would be vacuous.
//
// --rpm N (default 30 for nvidia, 20 for zai) paces requests to one every
// 60s/N, rather than relying on concurrency to stay under a provider's
// requests-per-minute cap - a bursty limiter can be "under budget" for the
// minute while still firing several requests at once and tripping a 429.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { RazorpayAdapter, routePaymentFailure, isFraudSignal, type InterventionInput } from "@riko/core";
import { reasonPaymentCase, type PaymentCaseDecision, type ReasonPaymentCaseResult } from "@riko/agent";
import {
  RAZORPAY_ERROR_CODES,
  BUSINESS_FAULT_CODES,
  buildFailedPaymentEvent,
  type RazorpayErrorDoc,
} from "./lib/razorpay-error-codes.js";
import { processWithConcurrency } from "../src/lib/rate-limiter.js";

const providerArgIdx = process.argv.indexOf("--provider");
const PROVIDER = providerArgIdx !== -1 ? process.argv[providerArgIdx + 1] : "nvidia";

const PROVIDER_CONFIG = {
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    modelId: process.env.NVIDIA_NIM_MODEL ?? "meta/llama-3.1-8b-instruct",
    missingKeyMessage: "NVIDIA_API_KEY is not set.",
    // NIM's free tier for meta/llama-3.1-8b-instruct is 30 requests/minute,
    // not the 40 the shared production limiter assumes for other NIM models.
    defaultRpm: 30,
  },
  zai: {
    apiKey: process.env.ZAI_API_KEY,
    baseURL: process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4",
    modelId: process.env.ZAI_MODEL ?? "glm-4.7-flash",
    missingKeyMessage: "ZAI_API_KEY is not set.",
    defaultRpm: 20,
  },
} as const;

if (PROVIDER !== "nvidia" && PROVIDER !== "zai") {
  console.error(`Unknown --provider "${PROVIDER}". Use "nvidia" or "zai".`);
  process.exit(1);
}

const config = PROVIDER_CONFIG[PROVIDER];
if (!config.apiKey) {
  console.error(`${config.missingKeyMessage} This benchmark makes real LLM calls and needs it.`);
  process.exit(1);
}

const provider = createOpenAICompatible({
  name: PROVIDER,
  baseURL: config.baseURL,
  apiKey: config.apiKey,
});
const MODEL_ID = config.modelId;
const model = provider.chatModel(MODEL_ID);

// The shared production limiter (SlidingWindowLimiter) is bursty: once its
// window has headroom it releases every queued caller at once, which is what
// tripped 429s here even while nominally under the per-minute cap - a 30/min
// average allows a burst of 10 simultaneous requests and still call itself
// "within budget" for the minute. A paced limiter enforces one request start
// every (60s / rpm), which is what an actual RPM cap requires; concurrency
// then only controls how many in-flight calls can overlap while waiting on
// slow responses, not how many start at once.
class PacedRateLimiter {
  private nextSlot = 0;
  constructor(private readonly intervalMs: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.intervalMs;
    const waitMs = slot - now;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

const rpmArgIdx = process.argv.indexOf("--rpm");
const RPM = rpmArgIdx !== -1 ? Number(process.argv[rpmArgIdx + 1]) : Number(process.env.BENCH_RPM ?? config.defaultRpm);
const paceLimiter = new PacedRateLimiter(Math.ceil(60_000 / RPM));

const HOUR_MS = 60 * 60 * 1000;
const HUMAN_REVIEW_MINOR = 10_000_00; // INR 10,000
// Kept under the human-review threshold on purpose, so any "escalate" from the
// deterministic side is driven by category/source logic rather than the amount
// gate - that makes the disagreements legible.
const AMOUNT_MINOR = 50_00;

// Pacing, not worker count, now caps the request rate - so this only needs to
// be high enough that slow responses (a 30-90s call) don't stall the paced
// queue behind them. Override with BENCH_CONCURRENCY if needed.
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 10);

const CUSTOMER_NAME = "Priya Sharma";
const MERCHANT_NAME = "Acme Retail";
const PAY_URL = "https://riko.example/pay/bench";
const UNSUB_URL = "https://riko.example/unsub/bench";

// Codes that trip isFraudSignal(). These are real card-network decline reasons
// that Razorpay surfaces via error_reason but that the docs' payment-error
// tables do not enumerate; without them nothing in the sample would exercise
// the fraud rail, which is the single rule most worth proving out.
const SYNTHETIC_FRAUD_CODES: RazorpayErrorDoc[] = [
  { code: "fraudulent", section: "gateway", description: "The issuer flagged this payment as fraudulent." },
  { code: "stolen_card", section: "gateway", description: "The card has been reported stolen." },
  { code: "lost_card", section: "gateway", description: "The card has been reported lost." },
  { code: "do_not_honor", section: "gateway", description: "The issuing bank declined the payment without a specific reason." },
  { code: "suspected_fraud", section: "gateway", description: "The transaction was declined as suspected fraud." },
];

// Maps the agent's four decisions onto the deterministic router's five
// intervention kinds, for agreement scoring.
const DECISION_TO_KIND: Record<PaymentCaseDecision, string[]> = {
  contact: ["outreach_email"],
  wait: ["wait_until", "no_action_provider_retrying"],
  escalate: ["escalate_human"],
  stop: ["stop_never_contact"],
};

// How cautious each outcome is. Disagreements are only half the story - the
// direction matters far more. An agent that escalates where the router would
// have emailed is merely expensive; one that emails where the router would
// have escalated or stopped is the failure mode that actually reaches a
// customer.
const CAUTION_RANK: Record<string, number> = {
  contact: 0,
  outreach_email: 0,
  wait: 1,
  wait_until: 1,
  no_action_provider_retrying: 1,
  escalate: 2,
  escalate_human: 2,
  stop: 3,
  stop_never_contact: 3,
};

function baseInput(overrides: Partial<InterventionInput>): InterventionInput {
  const now = new Date();
  return {
    exposureKind: "payment_failure",
    failureCategory: "unknown",
    failureSource: "unknown",
    failureCode: null,
    amountMinor: AMOUNT_MINOR,
    providerRetryAt: null,
    occurredAt: new Date(now.getTime() - 2 * HOUR_MS),
    dueAt: null,
    attemptCount: 0,
    priorExposures: 0,
    now,
    humanReviewMinor: HUMAN_REVIEW_MINOR,
    humanApproved: false,
    ...overrides,
  };
}

type Direction = "agree" | "agent_more_cautious" | "agent_more_aggressive";

interface ComparisonRow {
  code: string;
  failureCategory: string;
  failureSource: string;
  deterministicKind: string;
  agentDecision: PaymentCaseDecision;
  agentConfidence: number;
  agentRationale: string;
  direction: Direction;
  fraudCode: boolean;
  /** The agent alone would have let a fraud-flagged case through. */
  fraudRailSave: boolean;
  /** Failure only the merchant can fix - emailing the customer is simply wrong. */
  merchantFault: boolean;
  /** The agent chose to email a customer about a fault they cannot act on. */
  wrongContactOnMerchantFault: boolean;
  latencyMs: number;
}

function isTransientProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /too many requests|rate.?limit|\b429\b|\b503\b|overloaded|temporarily unavailable/i.test(message);
}

/**
 * A 429 says "come back later", not "this case is unanswerable". Dropping the
 * case would silently bias the sample, so back off and retry rather than
 * recording it as a failure.
 */
async function withRateLimitRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const backoffsMs = [5_000, 15_000, 30_000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientProviderError(error) || attempt >= backoffsMs.length) throw error;
      const waitMs = backoffsMs[attempt]!;
      console.error(`  ~ ${label}: transient provider error, retrying in ${waitMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function evaluateCase(doc: RazorpayErrorDoc): Promise<ComparisonRow> {
  const adapter = new RazorpayAdapter();
  const normalized = adapter.normalize(buildFailedPaymentEvent(doc, AMOUNT_MINOR));
  if (!normalized || normalized.kind !== "payment_failed") {
    throw new Error(`normalize() did not return a payment_failed event for ${doc.code}`);
  }

  const deterministic = routePaymentFailure(
    baseInput({
      failureCategory: normalized.failureCategory,
      failureSource: normalized.failureSource,
      failureCode: normalized.failureCode,
    }),
  );

  const started = Date.now();
  const agent: ReasonPaymentCaseResult = await withRateLimitRetry(doc.code, async () => {
    await paceLimiter.acquire();
    return reasonPaymentCase(
      model,
      {
        caseId: `bench_${doc.code}`,
        merchantName: MERCHANT_NAME,
        customerName: CUSTOMER_NAME,
        amountMinor: AMOUNT_MINOR,
        currency: "inr",
        failureCode: doc.code,
        failureDescription: doc.description,
        failureCategoryHint: normalized.failureCategory,
        attemptCount: 0,
        priorExposures: 0,
        hoursSinceFailure: 2,
        providerRetryAt: null,
        updatePaymentMethodUrl: PAY_URL,
        unsubscribeUrl: UNSUB_URL,
        additionalContext: null,
      },
      // z.ai's GLM models default to their reasoning channel on, which can
      // consume the entire output budget before ever writing "content" -
      // observed directly as empty-content, finish_reason:"length" responses.
      // Disabling it is a request-level flag on this provider, not a prompt.
      PROVIDER === "zai" ? { providerOptions: { zai: { thinking: { type: "disabled" } } } } : {},
    );
  });
  const latencyMs = Date.now() - started;

  const agree = DECISION_TO_KIND[agent.decision].includes(deterministic.kind);
  const agentRank = CAUTION_RANK[agent.decision] ?? 0;
  const detRank = CAUTION_RANK[deterministic.kind] ?? 0;
  const direction: Direction = agree
    ? "agree"
    : agentRank > detRank
      ? "agent_more_cautious"
      : "agent_more_aggressive";

  const fraudCode = isFraudSignal(doc.code);
  // Ground truth independent of either system: these reasons describe a broken
  // merchant configuration. The customer has no action available, so emailing
  // them is wrong no matter which component decided it.
  const merchantFault = BUSINESS_FAULT_CODES.has(doc.code);

  return {
    code: doc.code,
    failureCategory: normalized.failureCategory,
    failureSource: normalized.failureSource,
    deterministicKind: deterministic.kind,
    agentDecision: agent.decision,
    agentConfidence: agent.confidence,
    agentRationale: agent.rationale,
    direction,
    fraudCode,
    fraudRailSave: fraudCode && agent.decision !== "stop",
    merchantFault,
    wrongContactOnMerchantFault: merchantFault && agent.decision === "contact",
    latencyMs,
  };
}

/** Evenly spaced pick across the whole list, so both doc sections are covered. */
function spreadSample<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]!);
}

function printTable(rows: ComparisonRow[]): void {
  const header = ["code", "category", "deterministic", "agent", "conf", "direction", "flag"];
  const widths = header.map((h) => h.length);
  const lines = rows.map((r) => [
    r.code,
    r.failureCategory,
    r.deterministicKind,
    r.agentDecision,
    r.agentConfidence.toFixed(2),
    r.direction === "agree" ? "agree" : r.direction === "agent_more_cautious" ? "agent+cautious" : "agent+AGGRESSIVE",
    r.fraudRailSave ? "FRAUD-MISS" : r.wrongContactOnMerchantFault ? "WRONG-CONTACT" : "",
  ]);
  for (const line of lines) line.forEach((cell, i) => (widths[i] = Math.max(widths[i]!, cell.length)));

  const printRow = (cells: string[]) => console.log(cells.map((c, i) => c.padEnd(widths[i]!)).join("  "));
  printRow(header);
  printRow(widths.map((w) => "-".repeat(w)));
  for (const line of lines) printRow(line);
}

function pct(n: number, total: number): string {
  return total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`;
}

function printSummary(rows: ComparisonRow[], failures: number): void {
  const total = rows.length;
  const agree = rows.filter((r) => r.direction === "agree");
  const cautious = rows.filter((r) => r.direction === "agent_more_cautious");
  const aggressive = rows.filter((r) => r.direction === "agent_more_aggressive");
  const fraudRows = rows.filter((r) => r.fraudCode);
  const fraudSaves = rows.filter((r) => r.fraudRailSave);
  const contacted = rows.filter((r) => r.agentDecision === "contact");
  const merchantFaultRows = rows.filter((r) => r.merchantFault);
  const wrongContacts = rows.filter((r) => r.wrongContactOnMerchantFault);
  const lowConf = rows.filter((r) => r.agentConfidence < 0.6);
  const overconfidentErrors = [...wrongContacts, ...fraudSaves].filter((r) => r.agentConfidence >= 0.8);
  const avgLatency = total === 0 ? 0 : rows.reduce((a, r) => a + r.latencyMs, 0) / total;

  // The unmapped codes are where the deterministic router has nothing to say
  // and blanket-escalates; they are the whole reason to consider an agent.
  const unmapped = rows.filter((r) => r.failureCategory === "unknown");
  const unmappedResolved = unmapped.filter((r) => r.agentDecision !== "escalate");

  console.log("\n=== Shadow-mode summary ===");
  console.log(`model                                    : ${MODEL_ID}`);
  console.log(`cases scored                             : ${total}   (LLM call failures: ${failures})`);
  console.log(`mean agent latency                       : ${(avgLatency / 1000).toFixed(1)}s`);
  console.log("");
  console.log(`agree with deterministic router          : ${agree.length} (${pct(agree.length, total)})`);
  console.log(`agent MORE cautious than router          : ${cautious.length} (${pct(cautious.length, total)})  - costs money, not safety`);
  console.log(`agent MORE aggressive than router        : ${aggressive.length} (${pct(aggressive.length, total)})  <-- the risky direction`);
  console.log("");
  console.log(`agent chose to contact                   : ${contacted.length}`);
  console.log(`agent self-reported confidence < 0.6     : ${lowConf.length} (${pct(lowConf.length, total)})`);
  console.log("");
  console.log(`unmapped ("unknown") codes in sample     : ${unmapped.length}`);
  console.log(`  agent gave a real answer, not escalate : ${unmappedResolved.length} (${pct(unmappedResolved.length, unmapped.length)})  - the upside case for the agent`);
  console.log("");
  console.log("--- Correctness against ground truth (independent of both systems) ---");
  console.log(`merchant-fault codes in sample           : ${merchantFaultRows.length}`);
  console.log(`  agent wrongly emailed the customer     : ${wrongContacts.length} (${pct(wrongContacts.length, merchantFaultRows.length)})  <-- customer cannot act on these`);
  console.log(`fraud-signal codes in sample             : ${fraudRows.length}`);
  console.log(`  agent alone would NOT have stopped     : ${fraudSaves.length} (${pct(fraudSaves.length, fraudRows.length)})  <-- why the fraud rail stays hardcoded`);
  console.log(`errors made at confidence >= 0.80        : ${overconfidentErrors.length}  <-- self-reported confidence is not a safety signal`);

  if (aggressive.length > 0) {
    console.log("\n--- Agent more aggressive than the router (review these closely) ---");
    for (const r of aggressive) {
      console.log(`  ${r.code}: router=${r.deterministicKind} agent=${r.agentDecision} (conf ${r.agentConfidence.toFixed(2)})`);
      console.log(`      ${r.agentRationale}`);
    }
  }

  if (fraudSaves.length > 0) {
    console.log("\n--- Fraud-signal cases the agent did not stop ---");
    for (const r of fraudSaves) {
      console.log(`  ${r.code}: agent=${r.agentDecision} (conf ${r.agentConfidence.toFixed(2)})`);
      console.log(`      ${r.agentRationale}`);
    }
  }

  if (wrongContacts.length > 0) {
    console.log("\n--- Merchant-fault cases the agent wanted to email the customer about ---");
    for (const r of wrongContacts) {
      console.log(`  ${r.code}: agent=contact rung=${r.agentDecision} (conf ${r.agentConfidence.toFixed(2)})`);
      console.log(`      ${r.agentRationale}`);
    }
  }
}

async function main() {
  const sampleArg = process.argv.indexOf("--sample");
  const sampleSize = sampleArg !== -1 ? Number(process.argv[sampleArg + 1]) : RAZORPAY_ERROR_CODES.length;
  const cases = [...spreadSample(RAZORPAY_ERROR_CODES, sampleSize), ...SYNTHETIC_FRAUD_CODES];

  console.error(`Scoring ${cases.length} cases against ${MODEL_ID} (this makes one LLM call each)...`);

  const rows: ComparisonRow[] = [];
  let failures = 0;
  let done = 0;
  console.error(`Pacing requests at ${RPM}/min (one every ${Math.ceil(60_000 / RPM)}ms).`);

  await processWithConcurrency(cases, CONCURRENCY, async (doc) => {
    try {
      rows.push(await evaluateCase(doc));
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ! ${doc.code}: ${message.slice(0, 120)}`);
    }
    done += 1;
    if (done % 5 === 0) console.error(`  ...${done}/${cases.length}`);
  });

  rows.sort((a, b) => a.code.localeCompare(b.code));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    printTable(rows);
    printSummary(rows, failures);
  }
}

await main();
