export interface EscalationSignal {
  rule: string;
  detail: string;
}

// Small classification models are prone to overconfidence: they can assign a
// high confidence score to an intent that ignores language a human reviewer
// would flag immediately. These patterns scan the customer's raw message
// directly, independent of what the model decided, so a mis-classified
// dispute or threat cannot slip through on self-reported confidence alone.
const ESCALATION_PATTERNS: { rule: string; patterns: RegExp[] }[] = [
  {
    rule: "legal_language",
    patterns: [
      /\blawyer\b/i,
      /\battorney\b/i,
      /\bsue\b/i,
      /\bsuing\b/i,
      /\bcourt\b/i,
      /\bconsumer forum\b/i,
      /\bconsumer court\b/i,
      /\bncdrc\b/i,
      /\bregulator\b/i,
      /\bpolice\b/i,
      /\blegal action\b/i,
      // Indian-specific regulatory and law-enforcement escalation paths a
      // merchant collections agent has no authority to argue against.
      /\brbi\b/i,
      /\breserve bank\b/i,
      /\bombudsman\b/i,
      /\bcyber cell\b/i,
      /\bcybercrime\b/i,
      /\bfir\b/i,
      /\bfiled? a complaint\b/i,
    ],
  },
  {
    rule: "dispute_language",
    patterns: [
      /\bchargeback\b/i,
      /\bnever (ordered|received|authorized|authorised)\b/i,
      /\bfraud(ulent)?\b/i,
      /\bunauthori[sz]ed\b/i,
      /\bscam\b/i,
      /\bidentity theft\b/i,
      // Hinglish/vernacular equivalents seen in Indian customer replies.
      /\bdhokha\b/i,
      /\bfraud (kiya|kar liya)\b/i,
      /\bgalat (paisa|amount) kaat/i,
    ],
  },
  {
    rule: "distress_language",
    patterns: [/\bharass(ed|ment|ing)?\b/i, /\bstop (contacting|calling|emailing) me\b/i, /\bhospital(ized|ised)?\b/i],
  },
];

export function detectEscalationSignals(customerMessage: string): EscalationSignal[] {
  const signals: EscalationSignal[] = [];

  for (const group of ESCALATION_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(customerMessage)) {
        signals.push({ rule: group.rule, detail: `Customer message matched ${pattern}` });
        break;
      }
    }
  }

  return signals;
}
