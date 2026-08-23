export type InboundKind = "hard_bounce" | "soft_bounce" | "auto_reply" | "unsubscribe_request" | "reply";

export interface InboundMessage {
  from: string;
  subject: string;
  text: string;
  headers?: Record<string, string> | undefined;
  inReplyTo?: string | null | undefined;
  references?: string | null | undefined;
}

export interface InboundClassification {
  kind: InboundKind;
  reason: string;
}

const DAEMON_SENDERS = [
  "mailer-daemon",
  "postmaster",
  "no-reply@",
  "noreply@",
  "bounce",
  "bounces@",
];

const BOUNCE_SUBJECTS = [
  "delivery status notification",
  "undeliverable",
  "returned mail",
  "mail delivery failed",
  "delivery has failed",
  "failure notice",
  "message not delivered",
];

const HARD_BOUNCE_PHRASES = [
  "550",
  "5.1.1",
  "5.1.10",
  "user unknown",
  "no such user",
  "does not exist",
  "address rejected",
  "recipient not found",
  "mailbox unavailable",
  "invalid recipient",
];

const SOFT_BOUNCE_PHRASES = [
  "452",
  "4.2.2",
  "mailbox full",
  "over quota",
  "temporarily unavailable",
  "try again later",
  "greylisted",
];

const AUTO_REPLY_SUBJECTS = [
  "out of office",
  "automatic reply",
  "auto-reply",
  "autoreply",
  "away from my",
  "on vacation",
  "on leave",
];

const UNSUBSCRIBE_PHRASES = [
  "unsubscribe",
  "stop emailing",
  "stop contacting",
  "remove me",
  "take me off",
  "do not contact",
  "don't contact",
];

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (headers[key] ?? "").toLowerCase() : "";
}

export function classifyInbound(message: InboundMessage): InboundClassification {
  const from = message.from.toLowerCase();
  const subject = message.subject.toLowerCase();
  const text = message.text.toLowerCase();
  const contentType = headerValue(message.headers, "content-type");
  const autoSubmitted = headerValue(message.headers, "auto-submitted");

  const looksLikeDaemon =
    DAEMON_SENDERS.some((s) => from.includes(s)) ||
    BOUNCE_SUBJECTS.some((s) => subject.includes(s)) ||
    contentType.includes("multipart/report") ||
    contentType.includes("delivery-status");

  if (looksLikeDaemon) {
    if (SOFT_BOUNCE_PHRASES.some((p) => text.includes(p))) {
      return { kind: "soft_bounce", reason: "temporary_delivery_failure" };
    }
    if (HARD_BOUNCE_PHRASES.some((p) => text.includes(p))) {
      return { kind: "hard_bounce", reason: "recipient_address_rejected" };
    }
    return { kind: "hard_bounce", reason: "delivery_failed" };
  }

  if (
    autoSubmitted.includes("auto-replied") ||
    autoSubmitted.includes("auto-generated") ||
    headerValue(message.headers, "x-autoreply") !== "" ||
    headerValue(message.headers, "x-autorespond") !== "" ||
    AUTO_REPLY_SUBJECTS.some((s) => subject.includes(s))
  ) {
    return { kind: "auto_reply", reason: "out_of_office" };
  }

  if (UNSUBSCRIBE_PHRASES.some((p) => text.includes(p) || subject.includes(p))) {
    return { kind: "unsubscribe_request", reason: "customer_asked_to_stop" };
  }

  return { kind: "reply", reason: "customer_reply" };
}

export function extractMessageIds(message: InboundMessage): string[] {
  const raw = [message.inReplyTo ?? "", message.references ?? ""].join(" ");
  const matches = raw.match(/<[^>\s]+>/g) ?? [];
  return [...new Set(matches)];
}
