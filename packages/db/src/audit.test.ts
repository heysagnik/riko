import { describe, expect, it } from "vitest";
import { computeEventHash, verifyChainRows, GENESIS_HASH } from "./audit.js";
import { caseEvents } from "./schema/cases.js";

type Row = typeof caseEvents.$inferSelect;

const CASE_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "tenant_1";

interface Step {
  fromState: Row["fromState"];
  toState: Row["toState"];
  reason: string | null;
}

function buildChain(steps: Step[]): Row[] {
  let prevHash = GENESIS_HASH;
  return steps.map((step, index) => {
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index));
    const hash = computeEventHash({
      prevHash,
      caseId: CASE_ID,
      fromState: step.fromState,
      toState: step.toState,
      reason: step.reason,
      actor: "system",
      createdAt,
    });
    const row: Row = {
      id: `event-${index}`,
      seq: index + 1,
      tenantId: TENANT_ID,
      caseId: CASE_ID,
      fromState: step.fromState,
      toState: step.toState,
      reason: step.reason,
      actor: "system",
      createdAt,
      prevHash,
      hash,
    };
    prevHash = hash;
    return row;
  });
}

const HAPPY_PATH: Step[] = [
  { fromState: null, toState: "NEW", reason: "payment_failed:expired_card" },
  { fromState: "NEW", toState: "DRAFTING", reason: null },
  { fromState: "DRAFTING", toState: "SENDING", reason: null },
  { fromState: "SENDING", toState: "WAITING", reason: null },
  { fromState: "WAITING", toState: "RECOVERED", reason: "payment_succeeded" },
];

describe("computeEventHash", () => {
  it("is deterministic for identical input", () => {
    const input = {
      prevHash: GENESIS_HASH,
      caseId: CASE_ID,
      fromState: null,
      toState: "NEW" as const,
      reason: "payment_failed",
      actor: "system" as const,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    expect(computeEventHash(input)).toBe(computeEventHash(input));
  });

  it("changes when any field changes", () => {
    const base = {
      prevHash: GENESIS_HASH,
      caseId: CASE_ID,
      fromState: null,
      toState: "NEW" as const,
      reason: "payment_failed",
      actor: "system" as const,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    const baseline = computeEventHash(base);
    expect(computeEventHash({ ...base, reason: "payment_failed " })).not.toBe(baseline);
    expect(computeEventHash({ ...base, actor: "merchant" })).not.toBe(baseline);
    expect(computeEventHash({ ...base, toState: "SKIPPED" })).not.toBe(baseline);
    expect(computeEventHash({ ...base, prevHash: "a".repeat(64) })).not.toBe(baseline);
  });
});

describe("verifyChainRows", () => {
  it("accepts an untampered chain", () => {
    const result = verifyChainRows(CASE_ID, buildChain(HAPPY_PATH));
    expect(result.chainValid).toBe(true);
    expect(result.brokenAtSeq).toBeNull();
    expect(result.eventCount).toBe(5);
    expect(result.events.every((e) => e.valid)).toBe(true);
  });

  it("accepts an empty history", () => {
    const result = verifyChainRows(CASE_ID, []);
    expect(result.chainValid).toBe(true);
    expect(result.eventCount).toBe(0);
  });

  it("detects an edited reason", () => {
    const rows = buildChain(HAPPY_PATH);
    rows[4]!.reason = "payment_succeeded_manually_marked";
    const result = verifyChainRows(CASE_ID, rows);
    expect(result.chainValid).toBe(false);
    expect(result.brokenAtSeq).toBe(5);
  });

  it("detects an outcome rewritten from LOST to RECOVERED", () => {
    const rows = buildChain([
      ...HAPPY_PATH.slice(0, 4),
      { fromState: "WAITING", toState: "LOST", reason: "attempts_exhausted" },
    ]);
    rows[4]!.toState = "RECOVERED";
    expect(verifyChainRows(CASE_ID, rows).chainValid).toBe(false);
  });

  it("detects a deleted middle event", () => {
    const rows = buildChain(HAPPY_PATH);
    rows.splice(2, 1);
    const result = verifyChainRows(CASE_ID, rows);
    expect(result.chainValid).toBe(false);
    expect(result.brokenAtSeq).toBe(4);
  });

  it("detects an inserted event that was never appended", () => {
    const rows = buildChain(HAPPY_PATH);
    const forged: Row = { ...rows[1]!, id: "forged", seq: 99 };
    rows.splice(2, 0, forged);
    expect(verifyChainRows(CASE_ID, rows).chainValid).toBe(false);
  });

  it("flags legacy events written before hashing existed", () => {
    const rows = buildChain(HAPPY_PATH);
    rows[0]!.hash = null;
    rows[0]!.prevHash = null;
    const result = verifyChainRows(CASE_ID, rows);
    expect(result.chainValid).toBe(false);
    expect(result.unhashedCount).toBe(1);
  });
});
