import { asc, isNull, sql } from "drizzle-orm";
import { db, caseEvents, computeEventHash, GENESIS_HASH } from "../src/index.js";

// Links events written before hashing existed, so verification covers all history.

const [{ pending }] = await db
  .select({ pending: sql<number>`count(*)::int` })
  .from(caseEvents)
  .where(isNull(caseEvents.hash));

if (pending === 0) {
  console.log("Nothing to backfill: every case event is already chained.");
  process.exit(0);
}

console.log(`${pending} unchained events found. Rebuilding chains...`);

const rows = await db.select().from(caseEvents).orderBy(asc(caseEvents.caseId), asc(caseEvents.seq));

const tips = new Map<string, string>();
let written = 0;

for (const row of rows) {
  const prevHash = tips.get(row.caseId) ?? GENESIS_HASH;
  const hash = computeEventHash({
    prevHash,
    caseId: row.caseId,
    fromState: row.fromState,
    toState: row.toState,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.createdAt,
  });

  if (row.hash !== hash || row.prevHash !== prevHash) {
    await db
      .update(caseEvents)
      .set({ prevHash, hash })
      .where(sql`${caseEvents.id} = ${row.id}`);
    written += 1;
  }

  tips.set(row.caseId, hash);
}

console.log(`Chained ${written} events across ${tips.size} cases.`);
process.exit(0);
