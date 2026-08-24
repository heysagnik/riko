import { generateText, type LanguageModel, type ProviderMetadata } from "ai";
import { z } from "zod";
import { isFraudSignal, describePolicyLimits } from "@riko/core";
import { formatDraftAmount } from "./validate/rules.js";
import { formatIstNow } from "./prompt-context.js";

export const PAYMENT_CASE_DECISIONS = ["contact", "wait", "escalate", "stop"] as const;
export type PaymentCaseDecision = (typeof PAYMENT_CASE_DECISIONS)[number];

export const PAYMENT_CASE_RUNGS = ["instrument_fix", "resume_checkout", "reminder", "firm", "formal"] as const;
export type PaymentCaseRung = (typeof PAYMENT_CASE_RUNGS)[number];

export interface ReasonPaymentCaseInput {
  caseId: string;
  merchantName: string;
  customerName: string;
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  failureDescription: string | null;
  /** The deterministic categorizer's best guess, given only as context - the model is not bound by it. */
  failureCategoryHint: string;
  attemptCount: number;
  priorExposures: number;
  hoursSinceFailure: number;
  providerRetryAt: string | null;
  updatePaymentMethodUrl: string;
  unsubscribeUrl: string;
  /** Anything else known about the case - prior notes, support tickets, past replies. */
  additionalContext: string | null;
  /** Defaults to the actual current time. Override only for tests/backfills. */
  now?: Date;
}

export interface ReasonPaymentCaseResult {
  decision: PaymentCaseDecision;
  confidence: number;
  rationale: string;
  rung: PaymentCaseRung | null;
  waitHours: number | null;
}

const resultSchema = z.object({
  decision: z.enum(PAYMENT_CASE_DECISIONS),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  rung: z.enum(PAYMENT_CASE_RUNGS).nullable(),
  waitHours: z.number().nullable(),
});

// This prompt intentionally tells the model about the hard rails it does not
// control. A model that does not know a fraud stop or a compliance gate exists
// downstream might reason itself into a decision that looks locally sensible
// but gets silently overridden - worse for debugging than a model that knows
// its "contact" recommendation on a fraud-flagged case will never actually send.
const SYSTEM_PROMPT = `detailed thinking off

You are reviewing one payment-failure case for a merchant in India and deciding
what should happen next, the way an experienced collections analyst would: read
the facts and use judgment rather than following a lookup table.

You decide only. If you decide to contact the customer, a separate drafting step
writes the actual email - do not write one here.

You are a reasoning layer, not the final authority. Deterministic code still
enforces, after your decision, rules you cannot override:
- Fraud-flagged cases are always stopped and never contacted, regardless of your decision.
- Cases above a per-tenant amount threshold always go to a human, regardless of your decision.
- Suppressed customers, paused tenants, and outside-contact-window cases never get an email sent, regardless of your decision.

Decide one of:
- "contact": email the customer now, because there is something they can actually
  do about this failure. Choose a rung.
- "wait": nothing should happen yet (e.g. the provider is already retrying, the
  failure looks transient, or the customer likely needs more time). Give waitHours.
- "escalate": a human must look at this before any contact (e.g. the reason is
  ambiguous, it looks like a merchant-side configuration fault the customer
  cannot fix, or repeat-failure signals warrant a second look).
- "stop": this looks like fraud, or further contact is clearly wrong. Explain why.

Always choose "stop", never "contact", when the failure code or description
says the instrument itself was reported compromised - lost, stolen, fraudulent,
flagged as fraud/suspected fraud, restricted, blocked for security, or a bank
declining with no reason given ("do not honor" / "do not honour"). This is true
even though the customer could technically fix it by adding a new card: the
point is not whether they can act, it is that continuing to email someone about
a card that was reported lost or stolen is itself the wrong move, and doing so
is worse than an unnecessary escalation. Do not reason "this is customer-
actionable, so contact is fine" for these - actionable and safe are different
questions, and this failure mode fails the second one. A plain decline for
insufficient funds, an expired card, or a wrong CVV/OTP is not this case and
should be handled normally.

If and only if you choose "contact", pick the rung (tone) the email should use:
- instrument_fix: the card/UPI/bank instrument failed for something the customer can fix (expired card, wrong OTP, insufficient funds). Friendly, no blame.
- resume_checkout: nothing failed or is owed; a save-the-cart nudge. No debt language.
- reminder: first gentle nudge about money owed. Never urgent or threatening.
- firm: repeated non-payment, still respectful. No legal or collections language.
- formal: multiple past attempts. States the matter plainly, still no threats.

Key judgment call: if the failure is something only the merchant can fix
(misconfigured account, disabled payment method, invalid order/amount, currency
or integration errors), contacting the customer is wrong - they cannot act on it.
Prefer "escalate" for those.

"wait" is a narrow call, not a default for "I don't know what this is." Only
choose "wait" when there is a concrete reason to expect this resolves on its
own without anyone acting: the provider gave a specific retry time, or the
failure code/description itself names a transient technical condition (gateway
error, network error, timeout, temporarily unavailable). An unrecognized or
unmapped failure code with no retry time and no such wording is not evidence of
"transient" - it is evidence you do not know what happened, and not knowing
is exactly when a human should look, so choose "escalate" instead. Do not treat
"the classifier's category is unknown" as itself a reason to wait.

If failureCode is null and additionalContext says no payment was actually
attempted (an abandoned or unfinished checkout), this is not a failure at all -
there is nothing to wait out. Choose "contact" with rung "resume_checkout".

Set confidence below 0.6 when the right call is genuinely unclear to you.

Do not show a thinking process, step-by-step breakdown, or any analysis before
your answer. Your entire response must be exactly one JSON object and nothing
else - no preamble, no markdown fences, no commentary, no text after it either.
Put your reasoning inside the "rationale" field, in two sentences at most.

Respond with only JSON matching:
{ "decision": string, "confidence": number, "rationale": string, "rung": string|null, "waitHours": number|null }`;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced?.[1] ?? trimmed;
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * Handed to the model as reference, not instruction - it explains what
 * attemptCount/priorExposures actually mean operationally (e.g. "3 emails is
 * the cap, so attemptCount: 3 is exhausted, not merely high") without ceding
 * the enforcement itself, which stays in evaluateGates() downstream.
 */
function formatPolicyContext(): string {
  const limits = describePolicyLimits();
  return limits.map((l) => `- ${l.label}: ${l.value}`).join("\n");
}

function buildPrompt(input: ReasonPaymentCaseInput): string {
  return [
    `Current date and time: ${formatIstNow(input.now ?? new Date())}`,
    `Case ID: ${input.caseId}`,
    `Merchant: ${input.merchantName}`,
    `Customer name: ${input.customerName}`,
    `Amount owed: ${input.currency.toUpperCase()} ${formatDraftAmount(input.amountMinor)}`,
    `Failure code from the payment provider: ${input.failureCode ?? "none given"}`,
    `Failure description from the payment provider: ${input.failureDescription ?? "none given"}`,
    `A deterministic classifier's best-guess category for this code (context only, not authoritative): ${input.failureCategoryHint}`,
    `Attempts so far this case: ${input.attemptCount}`,
    `Other exposures from this same customer recently: ${input.priorExposures}`,
    `Hours since the failure occurred: ${input.hoursSinceFailure.toFixed(1)}`,
    `Provider's own next retry time, if any: ${input.providerRetryAt ?? "none scheduled"}`,
    `Update-payment-method link (only allowed link besides unsubscribe): ${input.updatePaymentMethodUrl}`,
    `Unsubscribe link: ${input.unsubscribeUrl}`,
    input.additionalContext ? `Additional context:\n${input.additionalContext}` : "No additional context.",
    `\nOperating policy, enforced by code after your decision - use it to judge whether attemptCount/priorExposures/age are already at or past a limit, not just "high":`,
    formatPolicyContext(),
  ].join("\n");
}

// The model's judgment on the single highest-stakes decision (never contact a
// compromised instrument) is not trusted alone: isFraudSignal() is the same
// deterministic code-list the production router enforces after this call, so
// running it here too means a model that answers anything but "stop" on a
// known-fraud code gets corrected before its result ever leaves this
// function, not just after the fact when it's harder to see why.
function applyDeterministicOverrides(
  result: ReasonPaymentCaseResult,
  input: ReasonPaymentCaseInput,
): ReasonPaymentCaseResult {
  if (result.decision !== "stop" && isFraudSignal(input.failureCode)) {
    return {
      decision: "stop",
      confidence: 1,
      rationale: `Deterministic override: failure code "${input.failureCode}" is a known compromised-instrument/fraud signal. Model had proposed "${result.decision}": ${result.rationale}`,
      rung: null,
      waitHours: null,
    };
  }
  return result;
}

function toResult(parsed: z.infer<typeof resultSchema>): ReasonPaymentCaseResult {
  return {
    decision: parsed.decision,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    rung: parsed.decision === "contact" ? parsed.rung : null,
    waitHours: parsed.decision === "wait" ? parsed.waitHours : null,
  };
}

export interface ReasonPaymentCaseOptions {
  /**
   * Passed straight through to the AI SDK's generateText call. Use this to
   * disable a provider's reasoning/thinking channel where supported (e.g.
   * `{ zai: { thinking: { type: "disabled" } } }`) - some providers spend the
   * entire output budget narrating reasoning before ever answering, which
   * needs disabling at the request level, not by asking nicely in the prompt.
   */
  providerOptions?: ProviderMetadata;
}

// Transport-level maxRetries doesn't cover a response that arrives but fails
// our schema check; re-prompt with the validation error instead.
const MAX_PARSE_ATTEMPTS = 2;

export async function reasonPaymentCase(
  model: LanguageModel,
  input: ReasonPaymentCaseInput,
  options: ReasonPaymentCaseOptions = {},
): Promise<ReasonPaymentCaseResult> {
  const basePrompt = buildPrompt(input);
  let prompt = basePrompt;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt += 1) {
    // This provider's JSON response-format mode is unsupported by the model in
    // use here, and the model does not reliably honour "respond with only JSON" -
    // it narrates an unrequested "thinking process" first regardless.
    // extractJsonObject() below scans past that preamble for the first balanced
    // object, the same approach reasonReply() uses successfully in production.
    // Keeping the answer itself small (a decision, not an email) is what makes
    // that survivable: a long preamble plus a long answer overruns the token
    // budget and truncates mid-JSON.
    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 3000,
      temperature: 0.15,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(120_000),
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
    });

    try {
      if (!text) throw new Error("Model returned no content for payment case reasoning");

      const jsonText = extractJsonObject(stripCodeFence(text));
      if (!jsonText.trim().startsWith("{")) {
        throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
      }

      return applyDeterministicOverrides(toResult(resultSchema.parse(JSON.parse(jsonText))), input);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_PARSE_ATTEMPTS) break;
      prompt = `${basePrompt}\n\nYour previous response was invalid: ${lastError}\nRespond again with exactly one JSON object matching the schema, decision must be one of "contact", "wait", "escalate", or "stop".`;
    }
  }

  throw new Error(`Model did not return a valid payment case decision after ${MAX_PARSE_ATTEMPTS} attempts: ${lastError}`);
}
