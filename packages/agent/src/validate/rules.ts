import type { CaseFacts, EmailDraft, ValidationFailure, ValidationResult } from "@riko/shared";

const BLOCKLIST = [
  "discount",
  "refund",
  "credit",
  "extension",
  "extend",
  "deadline",
  "% off",
  "coupon",
  "waive",
];

/**
 * Language each rung is not allowed to reach for. The policy engine decides how
 * hard we are entitled to push; this stops the model deciding otherwise.
 */
const RUNG_FORBIDDEN: Record<string, string[]> = {
  // Nothing failed and nothing is owed, so debt language is simply wrong.
  resume_checkout: [
    "failed", "declined", "unsuccessful", "did not go through", "overdue",
    "past due", "outstanding", "owe", "unpaid", "arrears",
  ],
  reminder: [
    "immediately", "urgent", "final notice", "suspend", "terminate", "legal",
    "collection agency", "collections", "penalty", "late fee", "credit report",
  ],
  firm: [
    "legal", "lawyer", "solicitor", "court", "collection agency", "collections",
    "credit report", "penalty", "late fee", "suspend", "terminate", "final notice",
  ],
  // Even a formal notice stops short of threatening consequences.
  formal: [
    "legal action", "lawyer", "solicitor", "court", "sue", "collection agency",
    "collections", "credit report", "credit bureau", "penalty", "late fee",
    "suspend", "terminate",
  ],
};

export const BODY_WORD_MIN = 40;
export const BODY_WORD_MAX = 160;
export const SUBJECT_MAX_LENGTH = 78;

/**
 * The canonical rendering of a case amount. Exported so the drafting prompt and
 * the validator can never disagree about what string the body must contain.
 */
export function formatDraftAmount(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractUrls(text: string): string[] {
  // Trailing sentence punctuation is not part of the URL. Without stripping it,
  // a correctly written "... visit https://x/y." fails the allowlist check.
  return (text.match(/https?:\/\/[^\s"'<>]+/g) ?? []).map((url) => url.replace(/[.,;:!?)\]]+$/, ""));
}

export function validateDraft(draft: EmailDraft, facts: CaseFacts): ValidationResult {
  const failures: ValidationFailure[] = [];
  const haystack = `${draft.subject} ${draft.bodyText}`.toLowerCase();

  const formattedAmount = formatDraftAmount(facts.amountMinor);
  if (!draft.bodyText.includes(formattedAmount) && !draft.bodyHtml.includes(formattedAmount)) {
    failures.push({ rule: "amount_present", detail: `Expected amount ${formattedAmount} in draft body` });
  }

  if (!draft.bodyText.includes(facts.customerName) && !draft.bodyHtml.includes(facts.customerName)) {
    failures.push({ rule: "customer_name_present", detail: "Customer name missing from draft body" });
  }

  for (const term of BLOCKLIST) {
    if (haystack.includes(term)) {
      failures.push({ rule: "blocklist", detail: `Draft contains blocked term: "${term}"` });
    }
  }

  const rung = facts.rung ?? "instrument_fix";
  for (const term of RUNG_FORBIDDEN[rung] ?? []) {
    if (haystack.includes(term)) {
      failures.push({
        rule: "rung_tone",
        detail: `A "${rung}" message may not use "${term}"`,
      });
    }
  }

  const allowedUrls = new Set([facts.updatePaymentMethodUrl, facts.unsubscribeUrl]);
  const bodyUrls = [...extractUrls(draft.bodyText), ...extractUrls(draft.bodyHtml)];
  for (const url of bodyUrls) {
    if (!allowedUrls.has(url)) {
      failures.push({ rule: "url_allowlist", detail: `Unexpected URL in draft: ${url}` });
    }
  }

  if (draft.subject.length >= SUBJECT_MAX_LENGTH) {
    failures.push({ rule: "subject_length", detail: `Subject must be under ${SUBJECT_MAX_LENGTH} characters` });
  }

  const words = wordCount(draft.bodyText);
  if (words < BODY_WORD_MIN || words > BODY_WORD_MAX) {
    failures.push({
      rule: "body_length",
      detail: `Body word count ${words} outside [${BODY_WORD_MIN}, ${BODY_WORD_MAX}]`,
    });
  }

  if (!draft.bodyText.includes(facts.unsubscribeUrl) || !draft.bodyHtml.includes(facts.unsubscribeUrl)) {
    failures.push({ rule: "unsubscribe_present", detail: "Unsubscribe link missing from one or both variants" });
  }

  return { valid: failures.length === 0, failures };
}
