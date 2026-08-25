import type { CaseFacts, EmailDraft } from "@riko/shared";

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

const PRESSURE = ["immediately", "urgent", "failure to", "suspended", "terminated", "must be paid"];

const IDEAL_WORDS_MIN = 55;
const IDEAL_WORDS_MAX = 110;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

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

  const reasonWords = facts.failureCategory.split("_").filter((w) => w.length > 3);
  if (reasonWords.some((w) => body.includes(w))) score += 10;

  if (draft.subject.length >= 25 && draft.subject.length <= 60) score += 8;

  const words = wordCount(draft.bodyText);
  if (words >= IDEAL_WORDS_MIN && words <= IDEAL_WORDS_MAX) score += 12;

  const ctaCount = draft.bodyText.split(facts.updatePaymentMethodUrl).length - 1;
  if (ctaCount === 1) score += 10;
  else if (ctaCount > 1) score -= 5;

  if (draft.bodyText.includes(facts.customerName)) score += 5;

  if (/nothing has been|no action needed if|already (sorted|paid|updated)|picks up where/.test(body)) score += 8;

  return Math.max(0, Math.min(100, score));
}
