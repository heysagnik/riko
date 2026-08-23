import { db, cases, outreach, customers, payments, connections, caseEvents, agentActions, webhookEvents, senderIdentities } from "@riko/db";
import { sql } from "drizzle-orm";

const tables = { cases, outreach, customers, payments, connections, caseEvents, agentActions, webhookEvents, senderIdentities };

for (const [name, table] of Object.entries(tables)) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table as never);
  console.log(name.padEnd(18), row.n);
}

console.log("\n--- cases ---");
for (const c of await db.select().from(cases)) {
  console.log(c.id, c.state, "attempts=" + c.attemptCount, "customer=" + c.customerId);
}

console.log("\n--- customers ---");
for (const c of await db.select().from(customers)) {
  console.log(c.id, c.providerCustomerId, c.name, "unsub=" + c.unsubscribedAt, "bounced=" + c.bouncedAt);
}

console.log("\n--- connections ---");
for (const c of await db.select().from(connections)) {
  console.log(c.id, c.providerId, c.providerAccountId, c.status);
}
process.exit(0);
