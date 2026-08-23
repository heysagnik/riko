export interface PromiseCandidate {
  /** When the customer said they would pay. */
  promisedFor: Date;
  amountMinor: number | null;
  confidence: number;
  sourceText: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Below this we ask a person rather than trusting the reading. */
export const MIN_PROMISE_CONFIDENCE = 0.6;

/** A promise further out than this is a brush-off, not a commitment. */
export const MAX_PROMISE_HORIZON_DAYS = 60;

const INTENT_PHRASES = [
  "will pay",
  "i'll pay",
  "ill pay",
  "we'll pay",
  "we will pay",
  "can pay",
  "shall pay",
  "will settle",
  "will clear",
  "will transfer",
  "will send",
  "will make the payment",
  "payment will be made",
  "paying",
  "process the payment",
  "release the payment",
  "raise the payment",
];

const NEGATORS = ["cannot pay", "can't pay", "cant pay", "won't pay", "will not pay", "unable to pay", "refuse"];

const DISPUTE_PHRASES = [
  "dispute",
  "already paid",
  "did not order",
  "didn't order",
  "cancel my",
  "wrong amount",
  "incorrect invoice",
  "not our invoice",
];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function atNoon(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(12, 0, 0, 0);
  return copy;
}

interface DateHit {
  date: Date;
  /** How literally the text named the date, rather than implying it. */
  precision: number;
}

function findDate(text: string, now: Date): DateHit | null {
  // Hour-scale commitments are the fastest promises there are; without these
  // "I'll pay in an hour" reads as no promise at all and the case stalls.
  const inHours = text.match(/\bin (?:an?|\d{1,2})\s*(?:hr|hrs|hour|hours)\b/);
  if (inHours) {
    const digits = inHours[0].match(/\d{1,2}/);
    const n = digits ? Number(digits[0]) : 1;
    return { date: new Date(now.getTime() + n * 60 * 60 * 1000), precision: 0.9 };
  }
  if (/\b(?:right now|straight away|immediately|just now)\b/.test(text)) {
    return { date: new Date(now.getTime() + 60 * 60 * 1000), precision: 0.85 };
  }
  if (/\b(?:tonight|this evening|later today)\b/.test(text)) {
    return { date: new Date(now.getTime() + 6 * 60 * 60 * 1000), precision: 0.85 };
  }

  if (/\btoday\b/.test(text)) return { date: atNoon(now), precision: 0.9 };
  if (/\btomorrow\b/.test(text)) return { date: atNoon(new Date(now.getTime() + DAY_MS)), precision: 0.9 };

  const inDays = text.match(/\bin (\d{1,2}) (day|days|week|weeks)\b/);
  if (inDays) {
    const n = Number(inDays[1]);
    const mult = inDays[2]!.startsWith("week") ? 7 : 1;
    return { date: atNoon(new Date(now.getTime() + n * mult * DAY_MS)), precision: 0.85 };
  }

  // "by the 15th", "on 15th", "before 3rd"
  const dayOfMonth = text.match(/\b(?:by|on|before|around)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    if (day >= 1 && day <= 31) {
      const candidate = new Date(now);
      candidate.setUTCDate(day);
      if (candidate.getTime() < now.getTime()) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
      return { date: atNoon(candidate), precision: 0.85 };
    }
  }

  // "15 March", "March 15"
  for (const [index, month] of MONTHS.entries()) {
    const pattern = new RegExp(`\\b(?:(\\d{1,2})\\s+${month}|${month}\\s+(\\d{1,2}))`, "i");
    const hit = text.match(pattern);
    if (hit) {
      const day = Number(hit[1] ?? hit[2]);
      const candidate = new Date(now);
      candidate.setUTCMonth(index, day);
      if (candidate.getTime() < now.getTime()) candidate.setUTCFullYear(candidate.getUTCFullYear() + 1);
      return { date: atNoon(candidate), precision: 0.9 };
    }
  }

  for (const [index, weekday] of WEEKDAYS.entries()) {
    if (new RegExp(`\\b(?:next |this |by |on )?${weekday}\\b`).test(text)) {
      const delta = (index - now.getUTCDay() + 7) % 7 || 7;
      return { date: atNoon(new Date(now.getTime() + delta * DAY_MS)), precision: 0.75 };
    }
  }

  if (/\bnext week\b/.test(text)) {
    return { date: atNoon(new Date(now.getTime() + 7 * DAY_MS)), precision: 0.6 };
  }
  if (/\bend of (?:the )?month\b/.test(text)) {
    const candidate = new Date(now);
    candidate.setUTCMonth(candidate.getUTCMonth() + 1, 0);
    return { date: atNoon(candidate), precision: 0.7 };
  }
  if (/\bnext month\b/.test(text)) {
    const candidate = new Date(now);
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
    return { date: atNoon(candidate), precision: 0.55 };
  }

  return null;
}

function findAmountMinor(text: string): number | null {
  const hit = text.match(/(?:inr|rs\.?|₹|\$|usd)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!hit) return null;
  const value = Number(hit[1]!.replaceAll(",", ""));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

// Deliberately conservative: a missed promise costs one delayed follow-up, but a
// hallucinated one silently stops a live recovery. Ambiguity scores low and ends
// up in front of a person instead.
export function extractPromise(replyText: string, now: Date = new Date()): PromiseCandidate | null {
  const text = replyText.toLowerCase();

  if (NEGATORS.some((phrase) => text.includes(phrase))) return null;
  if (DISPUTE_PHRASES.some((phrase) => text.includes(phrase))) return null;

  const intent = INTENT_PHRASES.find((phrase) => text.includes(phrase));
  if (!intent) return null;

  const hit = findDate(text, now);
  if (!hit) return null;

  const horizonDays = (hit.date.getTime() - now.getTime()) / DAY_MS;
  if (horizonDays < -1 || horizonDays > MAX_PROMISE_HORIZON_DAYS) return null;

  // A named date the customer volunteered is worth more than one we inferred
  // from "next month", and a stated amount corroborates the whole reading.
  const amountMinor = findAmountMinor(replyText);
  const confidence = Math.min(0.95, hit.precision + (amountMinor === null ? 0 : 0.05));

  return {
    promisedFor: hit.date,
    amountMinor,
    confidence,
    sourceText: replyText.slice(0, 1000),
  };
}
