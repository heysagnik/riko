export interface ReplyValidationFailure {
  rule: string;
  detail: string;
}

export interface ReplyValidationResult {
  valid: boolean;
  failures: ReplyValidationFailure[];
}

export const REPLY_WORD_MAX = 120;

// Concessions the agent has no authority to make, and threats it must never issue.
const FORBIDDEN_PHRASES: { rule: string; patterns: RegExp[] }[] = [
  {
    rule: "no_concession",
    patterns: [
      /\bdiscount\b/i,
      /\bwaive[dr]?\b/i,
      /\bwrite[- ]off\b/i,
      /\bsettle(ment)? for\b/i,
      /\brefund(ed|ing)?\b/i,
      /\bcredit note\b/i,
      /\breduce[d]? (the )?amount\b/i,
      /\bfree of charge\b/i,
    ],
  },
  {
    rule: "no_threat",
    patterns: [
      /\blegal action\b/i,
      /\bcollections? agency\b/i,
      /\bcredit (score|bureau|report)/i,
      /\bcourt\b/i,
      /\bprosecut/i,
      /\bpenalt(y|ies)\b/i,
    ],
  },
  {
    rule: "no_liability_admission",
    patterns: [/\bour (mistake|error|fault)\b/i, /\bwe were wrong\b/i, /\byou (do not|don't) owe\b/i],
  },
];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateReply(replyText: string, allowedUrls: string[]): ReplyValidationResult {
  const failures: ReplyValidationFailure[] = [];

  for (const group of FORBIDDEN_PHRASES) {
    for (const pattern of group.patterns) {
      if (pattern.test(replyText)) {
        failures.push({ rule: group.rule, detail: `Reply matched forbidden pattern ${pattern}` });
        break;
      }
    }
  }

  const words = wordCount(replyText);
  if (words > REPLY_WORD_MAX) {
    failures.push({ rule: "reply_length", detail: `Reply is ${words} words, over ${REPLY_WORD_MAX}` });
  }

  const allowed = new Set(allowedUrls);
  for (const url of replyText.match(/https?:\/\/[^\s<>")]+/g) ?? []) {
    if (!allowed.has(url)) {
      failures.push({ rule: "url_allowlist", detail: `Unexpected URL in reply: ${url}` });
    }
  }

  return { valid: failures.length === 0, failures };
}
