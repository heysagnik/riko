import { db, cases, outreach, caseEvents, customers } from "@riko/db";
import { desc, isNotNull } from "drizzle-orm";

console.log("--- outreach: reply/bounce markers ---");
for (const o of await db.select().from(outreach).orderBy(desc(outreach.sentAt))) {
  console.log(
    `case=${o.caseId.slice(0, 8)} msgId=${o.providerMessageId} sentAt=${o.sentAt?.toISOString() ?? "-"}`,
  );
  console.log(
    `   repliedAt=${o.repliedAt ?? "-"} openedAt=${o.openedAt ?? "-"} bouncedAt=${o.bouncedAt ?? "-"} clickedAt=${o.clickedAt ?? "-"}`,
  );
}

console.log("\n--- case states ---");
for (const c of await db.select().from(cases)) {
  console.log(`${c.id.slice(0, 8)} ${c.state} closedReason=${c.closedReason ?? "-"}`);
}

console.log("\n--- any events from a customer reply? ---");
const replyish = await db.select().from(caseEvents);
const hits = replyish.filter((e) =>
  /repl|escalat|bounce|unsub/i.test(`${e.reason ?? ""} ${e.toState}`),
);
if (hits.length === 0) {
  console.log("none");
} else {
  for (const e of hits) {
    console.log(`${e.createdAt.toISOString()} ${e.fromState} -> ${e.toState} ${e.reason ?? ""}`);
  }
}

console.log("\n--- customers with bounce/unsub set ---");
for (const c of await db.select().from(customers).where(isNotNull(customers.bouncedAt))) {
  console.log("bounced:", c.providerCustomerId, c.bouncedAt);
}
process.exit(0);
