import type { CaseFacts, EmailDraft } from "@riko/shared";

/**
 * Corporate filler that reads as a template rather than a person. Each hit is a
 * small penalty - one is forgivable, a pile of them is the robotic voice we are
 * trying to avoid.
 */
const FILLER = [
  "we are writing to inform you",
  "we regret to inform",
  "please be advised",
  "at your earliest convenience",
  "we value your business",
  "do not hesitate",
  "kindly note",
  "this is to notify",
  "dear valued customer",
];

/** Words that make a billing notice feel like a threat rather than a nudge. */
const PRESSURE = ["immediately", "urgent", "failure to", "suspended", "terminated", "must be paid"];

const IDEAL_WORDS_MIN = 55;
const IDEAL_WORDS_MAX = 110;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Ranks drafts that have already passed validation. Validation answers "is this
 * safe to send"; this answers "which safe draft is most likely to work". Scored
 * 0-100 so a threshold reads naturally at the call site.
 */
export function scoreDraft(draft: EmailDraft, facts: CaseFacts): number {
  let score = 60;
  const body = draft.bodyText.toLowerCase();
  const subject = draft.subject.toLowerCase();

  for (const phrase of FILLER) {
    if (body.includes(phrase) || subject.includes(phrase)) score -= 8;
  }
  for (const word of PRESSURE) {
    if (body.includes(word) || subject.includes(word)) score -= 6;
  }

  // Naming the concrete reason ("expired card") beats a generic "payment issue".
  const reasonWords = facts.failureCategory.split("_").filter((w) => w.length > 3);
  if (reasonWords.some((w) => body.includes(w))) score += 10;

  // A subject that carries information outperforms "Payment failed".
  if (draft.subject.length >= 25 && draft.subject.length <= 60) score += 8;

  // Short and scannable, not a wall of text.
  const words = wordCount(draft.bodyText);
  if (words >= IDEAL_WORDS_MIN && words <= IDEAL_WORDS_MAX) score += 12;

  // Exactly one payment link keeps the call to action unambiguous.
  const ctaCount = draft.bodyText.split(facts.updatePaymentMethodUrl).length - 1;
  if (ctaCount === 1) score += 10;
  else if (ctaCount > 1) score -= 5;

  // Addressing the person by name reads as written-for-you.
  if (draft.bodyText.includes(facts.customerName)) score += 5;

  // Reassurance that nothing is lost yet is the single most recovery-relevant beat.
  if (/nothing has been|no action needed if|already (sorted|paid|updated)|picks up where/.test(body)) score += 8;

  return Math.max(0, Math.min(100, score));
}
