import { db, cases, outreach, caseEvents } from "@riko/db";
import { asc, eq } from "drizzle-orm";

const caseId = process.argv[2];

const [c] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
if (!c) {
  console.log("case not found");
  process.exit(0);
}
console.log("state:", c.state, "| attempts:", c.attemptCount, "| intervention:", c.intervention, "|", c.interventionReason);
console.log("nextActionAt:", c.nextActionAt, "closedReason:", c.closedReason);

console.log("\n--- events ---");
for (const e of await db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId)).orderBy(asc(caseEvents.createdAt))) {
  console.log(`${e.createdAt.toISOString()}  ${e.fromState ?? "-"} -> ${e.toState}  [${e.actor}]  ${e.reason ?? ""}`);
}

console.log("\n--- outreach ---");
for (const o of await db.select().from(outreach).where(eq(outreach.caseId, caseId))) {
  console.log("subject:", o.subject);
  console.log("sentAt:", o.sentAt, "messageId:", o.providerMessageId);
  console.log("body:\n" + o.body);
}
process.exit(0);
