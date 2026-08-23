import { db, cases, outreach, customers, payments, connections, caseEvents, agentActions, webhookEvents } from "@riko/db";
import { inArray, like } from "drizzle-orm";

// Wipe every case and everything hanging off it, plus the synthetic e2e-* rows
// created by earlier seeded tests. Sender identity and real provider
// connections are left alone.
await db.delete(agentActions);
await db.delete(caseEvents);
await db.delete(outreach);
await db.delete(cases);
await db.delete(payments);
await db.delete(webhookEvents);

const testCustomers = await db
  .select({ id: customers.id })
  .from(customers)
  .where(like(customers.providerCustomerId, "e2e-%"));
if (testCustomers.length > 0) {
  await db.delete(customers).where(inArray(customers.id, testCustomers.map((c) => c.id)));
}

const testConnections = await db
  .select({ id: connections.id })
  .from(connections)
  .where(like(connections.providerAccountId, "e2e-%"));
if (testConnections.length > 0) {
  await db.delete(connections).where(inArray(connections.id, testConnections.map((c) => c.id)));
}

console.log("Deleted all cases, case events, outreach, agent actions, payments, webhook events.");
console.log("Deleted test customers:", testCustomers.length, "test connections:", testConnections.length);
process.exit(0);
