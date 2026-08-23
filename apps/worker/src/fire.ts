import { createHmac } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, connections } from "@riko/db";
import { decryptSecret } from "@riko/core";
const [c] = await db.select().from(connections).where(and(eq(connections.providerId,"razorpay"), eq(connections.status,"active"))).limit(1);
const secret = decryptSecret(c!.webhookSecretEncrypted, process.env.APP_ENCRYPTION_KEY!);
const now = Math.floor(Date.now()/1000);
const ev = { entity:"event", account_id:"acc", event:"payment.failed", created_at:now, payload:{ payment:{ entity:{
  id:`pay_prev_${now}`, amount:249900, currency:"INR", email:"sahoosagnik1@gmail.com", contact:"+919000000000",
  error_code:"BAD_REQUEST_ERROR", error_reason:"payment_expired_card",
  error_description:"Your card has expired. Please use a different card.",
  error_source:"customer", error_step:"authorization", created_at:now,
  card:{name:"Sagnik Sahoo"}, notes:{plan:"Pro annual"}, order_id:`order_prev_${now}` }}}};
const raw = JSON.stringify(ev);
const sig = createHmac("sha256", secret).update(raw).digest("hex");
const r = await fetch("http://localhost:4000/webhooks/razorpay", { method:"POST", headers:{"content-type":"application/json","x-razorpay-signature":sig}, body: raw });
console.log(r.status, await r.text());
process.exit(0);
