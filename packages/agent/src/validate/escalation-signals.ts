export interface EscalationSignal {
  rule: string;
  detail: string;
}

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
