import { createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, connections, cases, payments, exposures } from "@riko/db";
import { decryptSecret } from "@riko/core";

// Fires a mixed batch of signed Razorpay webhooks, then pays a subset.

const API = process.env.API_BASE_URL || "http://localhost:4000";
const key = process.env.APP_ENCRYPTION_KEY!;

// Resend's sink address: always accepted, never delivered to a human.
const SINK = "delivered@resend.dev";

const [connection] = await db
  .select()
  .from(connections)
  .where(and(eq(connections.providerId, "razorpay"), eq(connections.status, "active")))
  .limit(1);
if (!connection) throw new Error("No active razorpay connection");
const secret = decryptSecret(connection.webhookSecretEncrypted, key);

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// A few hundred rapid-fire posts will occasionally have the socket reset out
// from under them on Windows. Retrying is safe: the webhook is idempotent on
// provider event id, so a resend that did land is recorded as a duplicate.
async function post(event: unknown): Promise<{ status: string; caseId: string | null }> {
  const payload = JSON.stringify(event);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(`${API}/webhooks/razorpay`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-razorpay-signature": sign(payload) },
        body: payload,
        keepalive: false,
      });
      return (await res.json()) as { status: string; caseId: string | null };
    } catch (error) {
      if (attempt >= 8) throw error;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

interface Scenario {
  label: string;
  reason: string;
  source: string;
  description: string;
  amountMinor: number;
  count: number;
  /** Sends real mail, so it must go to the sink address. */
  contacts: boolean;
}

// "contact" runs only the scenarios that send, the population holdout needs.
const MODE = process.argv[2] ?? "full";

const ALL_SCENARIOS: Scenario[] = [
  { label: "expired card", reason: "expired_card", source: "customer", description: "Your card has expired.", amountMinor: 149900, count: 56, contacts: true },
  { label: "invalid cvv", reason: "invalid_cvv", source: "customer", description: "Invalid CVV entered.", amountMinor: 89900, count: 32, contacts: true },
  { label: "auth required", reason: "authentication_failed", source: "customer", description: "3DS authentication failed.", amountMinor: 249900, count: 32, contacts: true },
  { label: "insufficient funds", reason: "insufficient_funds", source: "customer", description: "Insufficient balance.", amountMinor: 129900, count: 20, contacts: false },
  { label: "gateway error", reason: "gateway_error", source: "gateway", description: "Gateway timeout.", amountMinor: 99900, count: 14, contacts: false },
  { label: "fraud signal", reason: "fraudulent", source: "issuer", description: "Suspected fraudulent transaction.", amountMinor: 199900, count: 10, contacts: false },
  { label: "high value", reason: "payment_declined", source: "issuer", description: "Declined by issuer.", amountMinor: 3200000, count: 8, contacts: false },
];

const SCENARIOS = MODE === "contact" ? ALL_SCENARIOS.filter((s) => s.contacts) : ALL_SCENARIOS;

let seq = 0;
const created: { caseId: string; amountMinor: number; contacts: boolean; label: string }[] = [];

for (const scenario of SCENARIOS) {
  for (let i = 0; i < scenario.count; i += 1) {
    seq += 1;
    const now = Math.floor(Date.now() / 1000);
    const email = scenario.contacts ? SINK : `batch${seq}@riko-batch.test`;

    const result = await post({
      entity: "event",
      account_id: connection.providerAccountId,
      event: "payment.failed",
      contains: ["payment"],
      created_at: now,
      payload: {
        payment: {
          entity: {
            id: `pay_batch_${seq}_${Date.now()}`,
            entity: "payment",
            amount: scenario.amountMinor,
            currency: "INR",
            status: "failed",
            order_id: `order_batch_${seq}_${Date.now()}`,
            invoice_id: null,
            email,
            contact: `+9190000${String(seq).padStart(5, "0")}`,
            error_code: "BAD_REQUEST_ERROR",
            error_reason: scenario.reason,
            error_description: scenario.description,
            error_source: scenario.source,
            error_step: "payment_authorization",
            card: { name: `Batch Customer ${seq}` },
            notes: { name: `Batch Customer ${seq}` },
            created_at: now,
          },
        },
      },
    });

    if (result.caseId) {
      created.push({
        caseId: result.caseId,
        amountMinor: scenario.amountMinor,
        contacts: scenario.contacts,
        label: scenario.label,
      });
    }
  }
  process.stdout.write(`seeded ${scenario.count.toString().padStart(2)} x ${scenario.label}\n`);
}

console.log(`\n${created.length} cases created. Waiting for the worker to drain the pipeline...`);

async function pendingCount(): Promise<number> {
  const ids = created.map((c) => c.caseId);
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(inArray(cases.id, ids), inArray(cases.state, ["NEW", "DRAFTING", "SENDING"])));
  // NEW cases parked on a future nextActionAt are deliberately waiting, not stuck.
  const parked = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(inArray(cases.id, ids), eq(cases.state, "NEW")));
  return rows.length - parked.length;
}

for (let tick = 0; tick < 60; tick += 1) {
  const pending = await pendingCount();
  if (pending <= 0) break;
  process.stdout.write(`  ${pending} still moving...\n`);
  await new Promise((r) => setTimeout(r, 5000));
}

console.log("\nPipeline settled. Paying a subset...");

const settled = await db
  .select({ id: cases.id, state: cases.state, arm: cases.arm, correlationId: payments.providerCorrelationId, amountMinor: exposures.amountMinor })
  .from(cases)
  .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId))
  .where(inArray(cases.id, created.map((c) => c.caseId)));

const RECOVERY_RATE = { contacted: 0.46, holdout: 0.17, suppressed: 0.11 };

let paid = 0;
for (const row of settled) {
  const contacted = row.state === "WAITING" || row.state === "SENDING";
  const isHoldout = row.arm === "holdout";
  const rate = contacted ? RECOVERY_RATE.contacted : isHoldout ? RECOVERY_RATE.holdout : RECOVERY_RATE.suppressed;
  if (Math.random() > rate) continue;
  if (!row.correlationId) continue;

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
          created_at: now,
        },
      },
    },
  });
  paid += 1;
}

console.log(`Sent ${paid} payment.captured events.`);
console.log("Done. Check /dashboard for the metrics.");
process.exit(0);
