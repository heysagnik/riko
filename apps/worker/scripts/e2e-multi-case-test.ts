import { db, connections, customers, payments, cases, outreach, senderIdentities } from "@riko/db";
import { encryptSecret } from "@riko/core";
import { eq } from "drizzle-orm";
import { processSendingCases } from "../src/jobs/process-sending-cases.js";
import { loadPendingOutreach } from "../src/loaders/load-pending-outreach.js";

const TO_EMAIL = process.argv[2] || "sahoosagnik1@gmail.com";
const key = process.env.APP_ENCRYPTION_KEY!;

const SCENARIOS = [
  {
    label: "insufficient funds, first attempt",
    failureCategory: "insufficient_funds" as const,
    amountMinor: 4999,
    subject: "We couldn't process your recent payment",
    body: "Hi,\n\nWe had trouble processing your recent payment due to insufficient funds. Please update your billing details to avoid any interruption.\n\nThanks,\nThe Team",
  },
  {
    label: "expired card",
    failureCategory: "expired_card" as const,
    amountMinor: 2500,
    subject: "Your card on file has expired",
    body: "Hi,\n\nThe card we have on file for your subscription has expired. Please add a new payment method to keep your account active.\n\nThanks,\nThe Team",
  },
  {
    label: "authentication required",
    failureCategory: "authentication_required" as const,
    amountMinor: 9999,
    subject: "Action needed: confirm your payment",
    body: "Hi,\n\nYour bank requires additional authentication to complete your recent payment. Please follow up to confirm and avoid service interruption.\n\nThanks,\nThe Team",
  },
];

async function main() {
  const [sender] = await db.select().from(senderIdentities).limit(1);
  if (!sender) throw new Error("No sender identity configured");
  const tenantId = sender.tenantId;

  console.log("Using tenant:", tenantId, "from:", sender.fromEmail);

  const [connection] = await db
    .insert(connections)
    .values({
      tenantId,
      providerId: "stripe",
      providerAccountId: "e2e-multi-account",
      accessTokenEncrypted: encryptSecret("e2e-fake-token", key),
      webhookSecretEncrypted: encryptSecret("e2e-fake-secret", key),
    })
    .returning();

  const [customer] = await db
    .insert(customers)
    .values({
      tenantId,
      providerId: "stripe",
      providerCustomerId: "e2e-multi-customer",
      emailEncrypted: encryptSecret(TO_EMAIL, key),
      name: "E2E Multi-Case Customer",
    })
    .returning();

  console.log("Created customer", customer.id, "for", TO_EMAIL);

  const createdCaseIds: string[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n--- Seeding case: ${scenario.label} ---`);

    const [payment] = await db
      .insert(payments)
      .values({
        tenantId,
        connectionId: connection.id,
        providerPaymentId: `e2e-multi-payment-${scenario.failureCategory}`,
        customerId: customer.id,
        amountMinor: scenario.amountMinor,
        currency: "usd",
        status: "failed",
        failureCategory: scenario.failureCategory,
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
      subject: scenario.subject,
      body: scenario.body,
    });

    createdCaseIds.push(caseRow.id);
    console.log("Seeded case", caseRow.id);
  }

  console.log("\nRunning processSendingCases for all SENDING cases...");
  await processSendingCases(loadPendingOutreach);

  console.log("\n--- Results ---");
  for (const caseId of createdCaseIds) {
    const [updatedCase] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    const [updatedOutreach] = await db.select().from(outreach).where(eq(outreach.caseId, caseId)).limit(1);
    console.log(
      `Case ${caseId}: state=${updatedCase.state}, sentAt=${updatedOutreach.sentAt}, providerMessageId=${updatedOutreach.providerMessageId}`,
    );
    if (!updatedOutreach.sentAt) {
      throw new Error(`Case ${caseId} was not sent`);
    }
  }

  console.log("\nAll test cases sent successfully. Data left in DB (not deleted) as requested.");
  console.log("Customer ID:", customer.id, "Connection ID:", connection.id);
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E multi-case test FAILED:", err);
  process.exit(1);
});
