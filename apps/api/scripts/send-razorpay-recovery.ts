import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, connections, cases, payments, exposures, customers } from "@riko/db";
import { decryptSecret } from "@riko/core";

// Sends a signed payment.captured for the order behind an existing case, the
// way Razorpay would when the customer finally pays.

const caseId = process.argv[2];
if (!caseId) throw new Error("usage: send-razorpay-recovery.ts <caseId>");

const API = process.env.API_BASE_URL || "http://localhost:4000";
const key = process.env.APP_ENCRYPTION_KEY!;

const [row] = await db
  .select({ payment: payments, customer: customers })
  .from(cases)
  .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId))
  .innerJoin(customers, eq(customers.id, cases.customerId))
  .where(eq(cases.id, caseId))
  .limit(1);

if (!row) throw new Error(`case not found: ${caseId}`);

const [connection] = await db
  .select()
  .from(connections)
  .where(and(eq(connections.providerId, "razorpay"), eq(connections.status, "active")))
  .limit(1);

if (!connection) throw new Error("No active razorpay connection");

const secret = decryptSecret(connection.webhookSecretEncrypted, key);
const email = decryptSecret(row.customer.emailEncrypted, key);
const now = Math.floor(Date.now() / 1000);

console.log("Recovering case", caseId);
console.log("  order (correlation):", row.payment.providerCorrelationId);
console.log("  amount:", row.payment.amountMinor, row.payment.currency);

const event = {
  entity: "event",
  account_id: connection.providerAccountId,
  event: "payment.captured",
  contains: ["payment"],
  created_at: now,
  payload: {
    payment: {
      entity: {
        id: `pay_riko_ok_${Date.now()}`,
        entity: "payment",
        amount: row.payment.amountMinor,
        currency: row.payment.currency.toUpperCase(),
        status: "captured",
        // Same order as the failure: this is what ties the recovery to the case.
        order_id: row.payment.providerCorrelationId,
        invoice_id: null,
        email,
        contact: "+919000000000",
        error_code: null,
        error_reason: null,
        error_description: null,
        error_source: null,
        card: { name: row.customer.name },
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
