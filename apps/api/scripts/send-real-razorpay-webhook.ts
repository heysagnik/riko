import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, connections } from "@riko/db";
import { decryptSecret } from "@riko/core";

// Drives the genuine ingestion path: builds a Razorpay payment.failed event,
// signs it with the tenant's real connected webhook secret, and POSTs it to the
// running API exactly as Razorpay would.

const CUSTOMER_EMAIL = process.argv[2] || "sahoosagnik1@gmail.com";
const AMOUNT_MINOR = Number(process.argv[3] ?? 149900);
const API = process.env.API_BASE_URL || "http://localhost:4000";
const key = process.env.APP_ENCRYPTION_KEY!;

const [connection] = await db
  .select()
  .from(connections)
  .where(and(eq(connections.providerId, "razorpay"), eq(connections.status, "active")))
  .limit(1);

if (!connection) throw new Error("No active razorpay connection");

const secret = decryptSecret(connection.webhookSecretEncrypted, key);
console.log("Signing with real webhook secret of connection", connection.providerAccountId);

const now = Math.floor(Date.now() / 1000);

const event = {
  entity: "event",
  account_id: connection.providerAccountId,
  event: "payment.failed",
  contains: ["payment"],
  created_at: now,
  payload: {
    payment: {
      entity: {
        id: `pay_riko_real_${Date.now()}`,
        entity: "payment",
        amount: AMOUNT_MINOR,
        currency: "INR",
        status: "failed",
        order_id: `order_riko_real_${Date.now()}`,
        invoice_id: null,
        email: CUSTOMER_EMAIL,
        contact: "+919000000000",
        // expired_card -> category expired_card, source customer.
        // No provider retry, well under the human-review threshold, so the
        // router sends this straight to outreach_email.
        error_code: "BAD_REQUEST_ERROR",
        error_reason: "expired_card",
        error_description: "Your card has expired. Please use a different card.",
        error_source: "customer",
        error_step: "payment_authorization",
        card: { name: "Sagnik Sahoo" },
        notes: { name: "Sagnik Sahoo" },
        created_at: now,
      },
    },
  },
};

const payload = JSON.stringify(event);
const signature = createHmac("sha256", secret).update(payload).digest("hex");

const res = await fetch(`${API}/webhooks/razorpay`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-razorpay-signature": signature },
  body: payload,
});

console.log("HTTP", res.status, await res.text());
process.exit(0);
