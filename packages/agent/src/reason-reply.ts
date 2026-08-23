import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

export const REPLY_INTENTS = [
  "promise_to_pay",
  "already_paid",
  "question",
  "needs_more_time",
  "payment_problem",
  "dispute",
  "unsubscribe",
  "hostile",
  "other",
] as const;

export type ReplyIntent = (typeof REPLY_INTENTS)[number];

// Intents where a human must see the case regardless of what the agent replies.
const ESCALATING_INTENTS = new Set<ReplyIntent>(["dispute", "hostile", "already_paid"]);

// Intents where sending anything back is wrong: they asked us to stop.
const SILENT_INTENTS = new Set<ReplyIntent>(["unsubscribe"]);

export interface ReplyReasoning {
  intent: ReplyIntent;
  confidence: number;
  rationale: string;
  replyText: string | null;
  needsHuman: boolean;
}

const reasoningSchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  replyText: z.string().nullable(),
});

const SYSTEM_PROMPT = `You are handling an email conversation with a customer about a failed or overdue payment, on behalf of a merchant in India.

You are given the full conversation so far. Read it before replying: never repeat
a question already answered, never contradict something you said earlier, and
refer to what the customer already told you where it is relevant.

Classify the customer's latest reply into exactly one intent:
- promise_to_pay: they commit to paying, with or without a date
- already_paid: they say they have already paid
- question: they ask something answerable from the facts you were given
- needs_more_time: they ask to delay, or say they cannot pay right now
- payment_problem: the payment link or method failed for them
- dispute: they deny owing it, or mention a chargeback, refund or error
- unsubscribe: they ask to stop being contacted
- hostile: abusive, threatening, or demanding legal contact
- other: anything else

Always write a replyText EXCEPT when intent is "unsubscribe" - then set it null.
Even for a dispute or a hostile message, reply: acknowledge, say a person will
review it, and stop there. A person is separately alerted.

Every reply must follow these rules without exception:
- Under 90 words. Plain sentences. Open with "Hi <name>," and nothing else.
- State only facts you were given. Never invent an amount, date, policy, or link.
- Never offer a discount, waiver, settlement, refund, or any change to the amount.
- Never threaten consequences, legal action, collections, or credit reporting.
- Never accept blame, agree the charge is wrong, or confirm a refund.
- Never promise that a specific person will call or act by a specific time.
- Currency is INR. Write amounts exactly as given to you.
- Include the payment link exactly as given, when one is provided and relevant.

Intent-specific guidance:
- promise_to_pay: thank them, confirm the date back to them, include the link.
- already_paid: thank them, say it is being checked, do not confirm or deny receipt.
- question: answer only from the facts. If you cannot, say a person will follow up.
- needs_more_time: acknowledge, ask when they can pay. Do not grant or refuse.
- payment_problem: apologise briefly, re-share the link, ask what they saw.
- dispute: acknowledge, say a person will review. Argue nothing.
- hostile: stay calm and brief, say a person will take over. Never respond in kind.

Set confidence below 0.6 when the reply is ambiguous or mixes intents.

Respond with only JSON matching:
{ "intent": string, "confidence": number, "rationale": string, "replyText": string|null }
No markdown fences, no commentary.`;

export interface ConversationTurn {
  role: "customer" | "agent";
  text: string;
}

export interface ReasonReplyInput {
  customerName: string;
  customerMessage: string;
  amountLabel: string;
  merchantName: string;
  paymentUrl: string;
  history?: ConversationTurn[];
}

function extractJsonObject(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced?.[1] ?? text.trim();
  const start = body.indexOf("{");
  if (start === -1) return body;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i += 1) {
    const char = body[i]!;
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
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start);
}

export async function reasonReply(
  model: LanguageModel,
  input: ReasonReplyInput,
): Promise<ReplyReasoning> {
  const history = (input.history ?? [])
    .map((turn) => `${turn.role === "customer" ? "Customer" : "You"}: ${turn.text}`)
    .join("\n\n");

  const prompt = [
    `Merchant: ${input.merchantName}`,
    `Customer name: ${input.customerName}`,
    `Amount owed: ${input.amountLabel}`,
    `Payment link: ${input.paymentUrl}`,
    history ? `Conversation so far:\n${history}` : "This is the first reply in the thread.",
    `Customer's latest reply:\n${input.customerMessage}`,
  ].join("\n\n");

  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 512,
    temperature: 0.3,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(30_000),
  });

  if (!text) throw new Error("Model returned no content for reply reasoning");

  const parsed = reasoningSchema.parse(JSON.parse(extractJsonObject(text)));

  // The prompt asks for these, but a model is not a guarantee.
  const replyText = SILENT_INTENTS.has(parsed.intent) ? null : parsed.replyText;
  const needsHuman = ESCALATING_INTENTS.has(parsed.intent) || parsed.confidence < 0.6;

  return { intent: parsed.intent, confidence: parsed.confidence, rationale: parsed.rationale, replyText, needsHuman };
}
