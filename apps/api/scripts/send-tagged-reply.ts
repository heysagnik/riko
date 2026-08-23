import { desc, eq } from "drizzle-orm";
import { db, cases } from "@riko/db";
import { taggedReplyTo } from "@riko/core";

// Replays what the Cloudflare Email Worker posts: no threading headers at all,
// only the plus-tagged recipient, which is the harder routing case.

const API = process.env.API_BASE_URL || "http://localhost:4000";
const secret = process.env.INBOUND_MAIL_SECRET;
if (!secret) throw new Error("Missing INBOUND_MAIL_SECRET");

const replyText = process.argv[2] ?? "Thanks for the nudge - I will pay this on Friday.";

const [target] = await db
  .select({ id: cases.id })
  .from(cases)
  .where(eq(cases.state, "WAITING"))
  .orderBy(desc(cases.openedAt))
  .limit(1);

if (!target) throw new Error("No WAITING case to reply to");

const to = taggedReplyTo("billing@riko.example", target.id);
console.log(`Case ${target.id}\nTo:   ${to}\nText: ${replyText}\n`);

const res = await fetch(`${API}/inbound/mail`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-riko-inbound-secret": secret },
  body: JSON.stringify({
    from: "customer@example.com",
    to,
    subject: "Re: your payment",
    text: replyText,
    headers: {},
    inReplyTo: null,
    references: null,
  }),
});

console.log(res.status, JSON.stringify(await res.json()));
process.exit(0);
