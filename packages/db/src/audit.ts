import { createHash } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { caseEvents } from "./schema/cases.js";

type CaseEventRow = typeof caseEvents.$inferSelect;
type CaseEventInsert = typeof caseEvents.$inferInsert;

/** Accepts either the pool-backed client or an open transaction. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Predecessor of a case's first event, so every chain starts from a fixed point. */
export const GENESIS_HASH = "0".repeat(64);

export interface HashableCaseEvent {
  prevHash: string;
  caseId: string;
  fromState: CaseEventRow["fromState"];
  toState: CaseEventRow["toState"];
  reason: string | null;
  actor: CaseEventRow["actor"];
  createdAt: Date;
}

export function computeEventHash(event: HashableCaseEvent): string {
  const canonical = JSON.stringify([
    event.prevHash,
    event.caseId,
    event.fromState ?? "",
    event.toState,
    event.reason ?? "",
    event.actor,
    event.createdAt.toISOString(),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type AppendCaseEventInput = Omit<
  CaseEventInsert,
  "id" | "seq" | "createdAt" | "prevHash" | "hash"
>;

// Concurrent appends are serialised by the case row lock the caller already
// holds from the compare-and-set that performed the transition.
export async function appendCaseEvent(
  tx: DbExecutor,
  input: AppendCaseEventInput,
): Promise<{ hash: string; prevHash: string }> {
  const [previous] = await tx
    .select({ hash: caseEvents.hash })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, input.caseId))
    .orderBy(desc(caseEvents.seq))
    .limit(1);

  const prevHash = previous?.hash ?? GENESIS_HASH;
  const createdAt = new Date();
  const actor = input.actor ?? "system";
  const reason = input.reason ?? null;

  const hash = computeEventHash({
    prevHash,
    caseId: input.caseId,
    fromState: input.fromState ?? null,
    toState: input.toState,
    reason,
    actor,
    createdAt,
  });

  await tx.insert(caseEvents).values({ ...input, actor, reason, createdAt, prevHash, hash });

  return { hash, prevHash };
}

export interface ChainEntry {
  seq: number;
  fromState: CaseEventRow["fromState"];
  toState: CaseEventRow["toState"];
  reason: string | null;
  actor: CaseEventRow["actor"];
  createdAt: Date;
  prevHash: string | null;
  hash: string | null;
  valid: boolean;
}

export interface ChainVerification {
  caseId: string;
  chainValid: boolean;
  eventCount: number;
  /** Written before hashing existed, so unverifiable either way. */
  unhashedCount: number;
  brokenAtSeq: number | null;
  events: ChainEntry[];
}

export async function verifyCaseChain(tx: DbExecutor, caseId: string): Promise<ChainVerification> {
  const rows = await tx
    .select()
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId))
    .orderBy(asc(caseEvents.seq));

  return verifyChainRows(caseId, rows);
}

export function verifyChainRows(caseId: string, rows: CaseEventRow[]): ChainVerification {
  const entries: ChainEntry[] = [];
  let expectedPrev = GENESIS_HASH;
  let brokenAtSeq: number | null = null;
  let unhashedCount = 0;

  for (const row of rows) {
    if (!row.hash) {
      unhashedCount += 1;
      entries.push({ ...row, valid: false });
      continue;
    }

    const recomputed = computeEventHash({
      prevHash: row.prevHash ?? GENESIS_HASH,
      caseId: row.caseId,
      fromState: row.fromState,
      toState: row.toState,
      reason: row.reason,
      actor: row.actor,
      createdAt: row.createdAt,
    });

    const linked = row.prevHash === expectedPrev;
    const intact = recomputed === row.hash;
    const valid = linked && intact;
    if (!valid && brokenAtSeq === null) brokenAtSeq = row.seq;

    entries.push({ ...row, valid });
    expectedPrev = row.hash;
  }

  return {
    caseId,
    chainValid: brokenAtSeq === null && unhashedCount === 0,
    eventCount: rows.length,
    unhashedCount,
    brokenAtSeq,
    events: entries,
  };
}
