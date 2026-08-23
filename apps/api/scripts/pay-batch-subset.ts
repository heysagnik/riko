import { createHmac } from "node:crypto";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, connections, cases, payments, exposures } from "@riko/db";
import { decryptSecret } from "@riko/core";

// Pays a realistic subset of already-seeded cases. Split out from run-batch so a
// settled batch can be scored without seeding a second one.

const API = process.env.API_BASE_URL || "http://localhost:4000";
const key = process.env.APP_ENCRYPTION_KEY!;
const SINK = "delivered@resend.dev";

const SINCE_MINUTES = Number(process.argv[2] ?? 90);

const [connection] = await db
  .select()
  .from(connections)
  .where(and(eq(connections.providerId, "razorpay"), eq(connections.status, "active")))
  .limit(1);
if (!connection) throw new Error("No active razorpay connection");
const secret = decryptSecret(connection.webhookSecretEncrypted, key);

async function post(event: unknown): Promise<void> {
  const payload = JSON.stringify(event);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fetch(`${API}/webhooks/razorpay`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", secret).update(payload).digest("hex") },
        body: payload,
      });
      return;
    } catch (error) {
      if (attempt >= 8) throw error;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

const since = new Date(Date.now() - SINCE_MINUTES * 60 * 1000);

const settled = await db
  .select({
    id: cases.id,
    state: cases.state,
    arm: cases.arm,
    intervention: cases.intervention,
    correlationId: payments.providerCorrelationId,
    amountMinor: exposures.amountMinor,
  })
  .from(cases)
  .innerJoin(exposures, eq(exposures.id, cases.exposureId))
  .innerJoin(payments, eq(payments.id, exposures.paymentId))
  .where(
    and(
      gte(cases.openedAt, since),
      eq(exposures.kind, "payment_failure"),
      isNotNull(payments.providerCorrelationId),
      inArray(cases.state, ["NEW", "DRAFTING", "SENDING", "WAITING", "SKIPPED", "ESCALATED"]),
    ),
  );

// Contact lifts recovery, but people pay on their own too. The holdout rate has
// to be a real baseline or the lift figure measures nothing.
const RECOVERY_RATE = { contacted: 0.46, holdout: 0.17, suppressed: 0.11 };

let paid = 0;
for (const row of settled) {
  const contacted = row.state === "WAITING" || row.state === "SENDING";
  const rate = contacted
    ? RECOVERY_RATE.contacted
    : row.arm === "holdout"
      ? RECOVERY_RATE.holdout
      : RECOVERY_RATE.suppressed;
  if (Math.random() > rate) continue;

  const now = Math.floor(Date.now() / 1000);
  await post({
    entity: "event",
    account_id: connection.providerAccountId,
    event: "payment.captured",
    contains: ["payment"],
    created_at: now,
    payload: {
      payment: {
        entity: {
          id: `pay_ok_${row.id.slice(0, 8)}_${Date.now()}`,
          entity: "payment",
          amount: row.amountMinor,
          currency: "INR",
          status: "captured",
          order_id: row.correlationId,
          invoice_id: null,
          email: SINK,
          contact: "+919000000000",
          error_code: null,
          error_reason: null,
          error_description: null,
          error_source: null,
          card: { name: "Batch Customer" },
          notes: { case_id: row.id },
          created_at: now,
        },
      },
    },
  });
  paid += 1;
}

console.log(`Considered ${settled.length} cases, sent ${paid} payment.captured events.`);
process.exit(0);
