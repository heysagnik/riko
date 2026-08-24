import { APICallError, UnsupportedFunctionalityError, generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import type { CaseFacts, EmailDraft } from "@riko/shared";
import { buildSystemPrompt } from "./prompts/system.js";
import { escapeForTag } from "./prompt-safety.js";
import { BODY_WORD_MAX, BODY_WORD_MIN, SUBJECT_MAX_LENGTH, formatDraftAmount } from "./validate/rules.js";

const structuredOutputSupport = new Map<string, boolean>();

const draftSchema = z.object({
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string(),
});

/**
 * One worked example does more for tone than any amount of instruction: it shows
 * the specific-reason opening, the single call to action, and the absence of
 * corporate filler that the rules can only describe.
 */
const RUNG_EXEMPLAR: Record<string, string> = {
  instrument_fix: `Subject: Your card ending 4242 was declined
Body: Hi Sam, the card we have on file for your Acme subscription expired, so this month's INR 2400.00 payment did not go through. Nothing has been cancelled - updating your card takes about a minute and everything picks up where it left off. Update your payment method: https://example.com/pay/xyz. If you have already sorted this out, you can ignore this email. Unsubscribe: https://example.com/unsub/xyz`,

  resume_checkout: `Subject: Your Acme order is still waiting
Body: Hi Sam, you left an order with us for INR 2400.00 and it is still saved. If you would like to finish it, everything is where you left it and it only takes a moment. Complete your order: https://example.com/pay/xyz. If you have changed your mind that is completely fine, and no further action is needed. Unsubscribe: https://example.com/unsub/xyz`,

  reminder: `Subject: Invoice for INR 2400.00 is now due
Body: Hi Sam, a quick note that your Acme invoice for INR 2400.00 passed its due date yesterday. These things slip through easily, so this is just a nudge in case it went unnoticed. You can settle it here: https://example.com/pay/xyz. If payment is already on its way, please ignore this. Unsubscribe: https://example.com/unsub/xyz`,

  firm: `Subject: Invoice for INR 2400.00 remains unpaid
Body: Hi Sam, your Acme invoice for INR 2400.00 is now eight days past its due date and we have not yet received payment. Could you either settle it here: https://example.com/pay/xyz, or reply with the date you expect to pay. If something is holding this up, let us know and we will work with you. Unsubscribe: https://example.com/unsub/xyz`,

  formal: `Subject: Overdue invoice for INR 2400.00 requires attention
Body: Hi Sam, this concerns your Acme invoice for INR 2400.00, which fell due on 1 August and remains unpaid after two previous requests. We are asking that you either make payment here: https://example.com/pay/xyz, or contact us directly to arrange settlement. Please treat this as a matter requiring your attention. Unsubscribe: https://example.com/unsub/xyz`,
};

const RUNG_EXEMPLAR_HINGLISH: Record<string, string> = {
  instrument_fix: `Subject: Aapka card ending 4242 decline ho gaya
Body: Hi Sam, is mahine INR 2400.00 ka payment nahi hua kyunki card on file expire ho gaya hai. Kuch cancel nahi hua - card update karne mein bas ek minute lagta hai aur sab wahi se chalu hota hai. Update your payment method: https://example.com/pay/xyz. Agar aap already kar chuke hain, is email ko ignore karein. Unsubscribe: https://example.com/unsub/xyz`,

  resume_checkout: `Subject: Aapka Acme order abhi bhi saved hai
Body: Hi Sam, aapne INR 2400.00 ka order shuru kiya tha aur wo abhi bhi saved hai. Complete karna ho to sab wahi ka wahi hai, bas ek moment lagta hai. Complete your order: https://example.com/pay/xyz. Agar mann badal gaya hai to bilkul theek baat hai. Unsubscribe: https://example.com/unsub/xyz`,

  reminder: `Subject: INR 2400.00 wali invoice ab due hai
Body: Hi Sam, chhoti si baat - aapki Acme invoice INR 2400.00 kal due date paar kar gayi hai. Aksar ye bhool jaane se hota hai, to bas ek nudge. Settle it here: https://example.com/pay/xyz. Payment already ho rahi hai to ise ignore karein. Unsubscribe: https://example.com/unsub/xyz`,

  firm: `Subject: INR 2400.00 ki invoice abhi tak unpaid hai
Body: Hi Sam, aapki Acme invoice INR 2400.00 aath din se overdue hai aur payment nahi mili. Kripya settle it here: https://example.com/pay/xyz, ya reply mein wo date bata dein jis tak payment ho jayegi. Koi dikkat hai to humein batayein. Unsubscribe: https://example.com/unsub/xyz`,

  formal: `Subject: Overdue invoice INR 2400.00 - turant dhyan dein
Body: Hi Sam, yeh aapki Acme invoice INR 2400.00 ke sambandh mein hai, jo 1 August se due hai aur do pichhli requests ke baad bhi unpaid hai. Hum request karte hain ki make the payment here: https://example.com/pay/xyz, ya seedha contact karein settlement ke liye. Ise gambhirta se lein. Unsubscribe: https://example.com/unsub/xyz`,
};

function exemplarFor(facts: CaseFacts): string {
  if (facts.language === "hinglish") {
    const sample =
      RUNG_EXEMPLAR_HINGLISH[facts.rung ?? "instrument_fix"] ?? RUNG_EXEMPLAR_HINGLISH.instrument_fix!;
    return `Example of the tone and shape wanted (different case, do not copy its details):\n\n${sample}`;
  }

  const sample = RUNG_EXEMPLAR[facts.rung ?? "instrument_fix"] ?? RUNG_EXEMPLAR.instrument_fix!;
  return `Example of the tone and shape wanted (different case, do not copy its details):\n\n${sample}`;
}

const DRAFT_SCHEMA_HINT = `Respond with only JSON matching: { "subject": string, "bodyText": string, "bodyHtml": string }. No markdown fences, no commentary.`;

/**
 * The fact set alone does not tell the model how the validator will judge it -
 * notably that `amountMinor` must appear as a major-unit, two-decimal string.
 * Spelling the checks out from the validator's own constants keeps the prompt
 * and the rules from drifting apart.
 */
function buildRequirements(facts: CaseFacts): string {
  return [
    `Hard requirements (the draft is rejected if any is unmet):`,
    `- bodyText and bodyHtml must both contain this exact amount string: ${formatDraftAmount(facts.amountMinor)}`,
    `  (write it as ${facts.currency.toUpperCase()} ${formatDraftAmount(facts.amountMinor)}; do not reformat, round, or add thousands separators)`,
    `- bodyText and bodyHtml must both contain the customer name exactly: ${facts.customerName}`,
    `- The only URLs allowed anywhere are these two, character for character:`,
    `    ${facts.updatePaymentMethodUrl}`,
    `    ${facts.unsubscribeUrl}`,
    `  Invent no other links, and do not append text inside a link.`,
    `- bodyText and bodyHtml must both contain the unsubscribe URL above.`,
    `- bodyText must be between ${BODY_WORD_MIN} and ${BODY_WORD_MAX} words. Aim for about ${Math.round((BODY_WORD_MIN + BODY_WORD_MAX) / 4)}.`,
    `- subject must be under ${SUBJECT_MAX_LENGTH} characters.`,
  ].join("\n");
}

export interface DraftEmailInput {
  facts: CaseFacts;
  validationErrors?: string[];
  /**
   * Sampling temperature. The validator is a hard gate on anything unsafe, so
   * candidate generation can afford variety; retries after a failure drop it.
   */
  temperature?: number;
}

export interface DraftEmailResult {
  draft: EmailDraft;
  model: string;
  latencyMs: number;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced?.[1] ?? trimmed;
}

/**
 * Reasoning-style models routinely emit a preamble ("We need to...") or a
 * trailing note around the JSON object. Scan for the first balanced object
 * instead of demanding the whole response parse, tracking string state so a
 * brace inside email copy does not end the scan early.
 */
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

// Only a genuine "this model/provider cannot do schema-constrained output"
// error should permanently disable it. A rate limit, timeout, or transient
// server error says nothing about capability and must not poison every draft
// for the rest of the worker's life.
function isSchemaUnsupportedError(error: unknown): boolean {
  if (UnsupportedFunctionalityError.isInstance(error)) return true;
  if (APICallError.isInstance(error) && error.statusCode === 400 && !error.isRetryable) return true;
  return false;
}

function parseDraft(text: string): EmailDraft {
  const parsed: unknown = JSON.parse(extractJsonObject(stripCodeFence(text)));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("subject" in parsed) ||
    !("bodyText" in parsed) ||
    !("bodyHtml" in parsed)
  ) {
    throw new Error("Model response did not match the expected draft shape");
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.subject !== "string" ||
    typeof candidate.bodyText !== "string" ||
    typeof candidate.bodyHtml !== "string"
  ) {
    throw new Error("Model response fields must be strings");
  }
  return { subject: candidate.subject, bodyText: candidate.bodyText, bodyHtml: candidate.bodyHtml };
}

export async function draftEmail(
  model: LanguageModel,
  modelId: string,
  { facts, validationErrors, temperature = 0.7 }: DraftEmailInput,
): Promise<DraftEmailResult> {
  const started = Date.now();

  const userContent = [
    `<fact_set>\n${escapeForTag(JSON.stringify(facts))}\n</fact_set>`,
    exemplarFor(facts),
    buildRequirements(facts),
    DRAFT_SCHEMA_HINT,
    ...(validationErrors && validationErrors.length > 0
      ? [`The previous draft failed validation for these reasons, fix them: ${JSON.stringify(validationErrors)}`]
      : []),
  ].join("\n\n");

  const shared = {
    model,
    maxOutputTokens: 1024,
    temperature,
    system: buildSystemPrompt(facts),
    prompt: userContent,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(30_000),
  } as const;

  // Schema-constrained decoding removes the whole class of malformed-JSON
  // failures where the provider supports it; not every NIM model does, so a
  // plain text call with tolerant parsing stays as the fallback. The probe is
  // cached per model so an unsupporting model costs one failed call, not one
  // per draft.
  if (structuredOutputSupport.get(modelId) !== false) {
    try {
      const { object } = await generateObject({ ...shared, schema: draftSchema });
      structuredOutputSupport.set(modelId, true);
      return { draft: object, model: modelId, latencyMs: Date.now() - started };
    } catch (error) {
      if (isSchemaUnsupportedError(error)) {
        structuredOutputSupport.set(modelId, false);
      }
      // Otherwise fall through to the plain-text path for this call only,
      // leaving the cache untouched so the next draft still tries structured
      // output.
    }
  }

  const { text } = await generateText(shared);

  if (!text) {
    throw new Error("Model response contained no content");
  }

  return {
    draft: parseDraft(text),
    model: modelId,
    latencyMs: Date.now() - started,
  };
}
