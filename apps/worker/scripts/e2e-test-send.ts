import { db, connections, customers, payments, cases, outreach, senderIdentities } from "@riko/db";
import { encryptSecret } from "@riko/core";
import { eq } from "drizzle-orm";
import { processSendingCases } from "../src/jobs/process-sending-cases.js";
import { loadPendingOutreach } from "../src/loaders/load-pending-outreach.js";

const TO_EMAIL = process.argv[2] || "sahoosagnik1@gmail.com";
const key = process.env.APP_ENCRYPTION_KEY!;

async function main() {
  const [sender] = await db.select().from(senderIdentities).limit(1);
  if (!sender) throw new Error("No sender identity configured");
  const tenantId = sender.tenantId;

  console.log("Using tenant:", tenantId, "from:", sender.fromEmail);

  const [connection] = await db
    .insert(connections)
    .values({
      tenantId,
      providerId: "razorpay",
      providerAccountId: "e2e-test-account",
      accessTokenEncrypted: encryptSecret("e2e-fake-token", key),
      webhookSecretEncrypted: encryptSecret("e2e-fake-secret", key),
    })
    .returning();

  const [customer] = await db
    .insert(customers)
    .values({
      tenantId,
      providerId: "razorpay",
      providerCustomerId: "e2e-test-customer",
      emailEncrypted: encryptSecret(TO_EMAIL, key),
      name: "E2E Test Customer",
    })
    .returning();

  const [payment] = await db
    .insert(payments)
    .values({
      tenantId,
      connectionId: connection.id,
      providerPaymentId: "e2e-test-payment",
      customerId: customer.id,
      amountMinor: 4999,
      currency: "usd",
      status: "failed",
      failureCategory: "insufficient_funds",
      isRecurring: true,
      occurredAt: new Date(),
    })
    .returning();

  const [caseRow] = await db
    .insert(cases)
    .values({
      tenantId,
      paymentId: payment.id,
      customerId: customer.id,
      state: "SENDING",
    })
    .returning();

  await db.insert(outreach).values({
    tenantId,
    caseId: caseRow.id,
    channel: "email",
    subject: "We couldn't process your recent payment",
    body: "Hi,\n\nWe had trouble processing your recent payment. Please update your billing details to avoid any interruption.\n\nThanks,\nThe Team",
  });

  console.log("Seeded case", caseRow.id, "in SENDING state. Running processSendingCases...");

  await processSendingCases(loadPendingOutreach);

  const [updatedCase] = await db.select().from(cases).where(eq(cases.id, caseRow.id)).limit(1);
  const [updatedOutreach] = await db.select().from(outreach).where(eq(outreach.caseId, caseRow.id)).limit(1);

  console.log("Case state after run:", updatedCase.state);
  console.log("Outreach sentAt:", updatedOutreach.sentAt, "providerMessageId:", updatedOutreach.providerMessageId);

  if (!updatedOutreach.sentAt) {
    throw new Error("Outreach was not marked sent — pipeline did not complete");
  }

  console.log("Cleaning up test data...");
  await db.delete(outreach).where(eq(outreach.caseId, caseRow.id));
  await db.delete(cases).where(eq(cases.id, caseRow.id));
  await db.delete(payments).where(eq(payments.id, payment.id));
  await db.delete(customers).where(eq(customers.id, customer.id));
  await db.delete(connections).where(eq(connections.id, connection.id));

  console.log("E2E test PASSED: full case -> outreach -> SMTP send pipeline works.");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E test FAILED:", err);
  process.exit(1);
});
