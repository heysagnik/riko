import PostalMime, { type Address } from "postal-mime";

export interface Env {
  RIKO_INBOUND_URL: string;
  RIKO_INBOUND_SECRET: string;
  /** Address that receives anything Riko could not route. Optional. */
  FORWARD_UNMATCHED_TO?: string;
}

interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

// Anything larger is a newsletter or an attachment dump, not a customer reply.
const MAX_BYTES = 1_000_000;

function joinAddresses(list: Address[] | undefined): string | null {
  if (!list || list.length === 0) return null;
  return list.map((entry) => entry.address ?? "").filter(Boolean).join(", ") || null;
}

export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    if (message.rawSize > MAX_BYTES) {
      message.setReject("Message too large");
      return;
    }

    const parsed = await PostalMime.parse(message.raw);

    // The envelope recipient is what carries the plus-tag. Headers can be
    // rewritten by forwarding; the envelope cannot.
    const to = [message.to, joinAddresses(parsed.to)].filter(Boolean).join(", ");

    const headers: Record<string, string> = {};
    for (const [key, value] of message.headers) {
      headers[key.toLowerCase()] = value;
    }

    const body = {
      from: parsed.from?.address ?? message.from,
      to,
      cc: joinAddresses(parsed.cc),
      subject: parsed.subject ?? "",
      text: parsed.text ?? stripHtml(parsed.html ?? ""),
      headers,
      inReplyTo: parsed.inReplyTo ?? headers["in-reply-to"] ?? null,
      references: parsed.references ?? headers["references"] ?? null,
    };

    const response = await fetch(env.RIKO_INBOUND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-riko-inbound-secret": env.RIKO_INBOUND_SECRET,
      },
      body: JSON.stringify(body),
    });

    // A 5xx means Riko is down, not that the mail is bad. Rejecting would tell
    // the sender their reply bounced; failing here makes the sender retry later.
    if (response.status >= 500) {
      throw new Error(`Riko inbound returned ${response.status}`);
    }

    // A 4xx (usually a secret mismatch) is silent otherwise: the function
    // returns normally and the tail log reads "Ok" exactly like a real
    // success, hiding a misconfiguration behind what looks like delivery.
    if (response.status >= 400) {
      const text = await response.text().catch(() => "");
      console.error(`Riko inbound rejected the message: ${response.status} ${text}`);
      return;
    }

    const result = (await response.json().catch(() => null)) as { status?: string } | null;

    if (result?.status === "ignored" && env.FORWARD_UNMATCHED_TO) {
      await message.forward(env.FORWARD_UNMATCHED_TO);
    }
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
