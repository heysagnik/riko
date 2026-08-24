// Benchmarks the deterministic policy layer (RazorpayAdapter.normalize +
// routePaymentFailure) against every payment failure reason documented on
// Razorpay's "List of Errors" page, split into the "Bad Request Errors" and
// "Gateway Errors" tables. This exercises the real production normalize/route
// code paths - no mocking - so it surfaces categorization gaps (reasons that
// fall through to "unknown" and therefore auto-escalate to a human) the same
// way a newly observed webhook would.
//
// Run with: npx tsx apps/worker/scripts/benchmark-razorpay-failures.ts
// Optional: --json to print machine-readable output instead of a table.

import { RazorpayAdapter, routePaymentFailure } from "@riko/core";
import type { InterventionInput } from "@riko/core";
import { RAZORPAY_ERROR_CODES, buildFailedPaymentEvent, type DocSection } from "./lib/razorpay-error-codes.js";

interface BenchmarkRow {
  code: string;
  section: DocSection;
  failureCategory: string;
  failureSource: string;
  belowThreshold: { kind: string; reason: string; rung?: string };
  aboveThreshold: { kind: string; reason: string; rung?: string };
}

const HOUR_MS = 60 * 60 * 1000;
const HUMAN_REVIEW_MINOR = 10_000_00; // INR 10,000

function baseInput(overrides: Partial<InterventionInput>): InterventionInput {
  const now = new Date();
  return {
    exposureKind: "payment_failure",
    failureCategory: "unknown",
    failureSource: "unknown",
    failureCode: null,
    amountMinor: 50_00,
    providerRetryAt: null,
    occurredAt: new Date(now.getTime() - 2 * HOUR_MS),
    dueAt: null,
    attemptCount: 0,
    priorExposures: 0,
    now,
    humanReviewMinor: HUMAN_REVIEW_MINOR,
    humanApproved: false,
    ...overrides,
  };
}

function summarize(intervention: ReturnType<typeof routePaymentFailure>) {
  return { kind: intervention.kind, reason: intervention.reason, rung: intervention.rung };
}

function runBenchmark(): BenchmarkRow[] {
  const adapter = new RazorpayAdapter();

  return RAZORPAY_ERROR_CODES.map((doc) => {
    const belowAmount = 50_00; // INR 500 - under the human-review threshold
    const aboveAmount = 20_000_00; // INR 20,000 - over the human-review threshold

    const normalizedBelow = adapter.normalize(buildFailedPaymentEvent(doc, belowAmount));
    if (!normalizedBelow || normalizedBelow.kind !== "payment_failed") {
      throw new Error(`normalize() did not return a payment_failed event for ${doc.code}`);
    }

    const belowIntervention = routePaymentFailure(
      baseInput({
        failureCategory: normalizedBelow.failureCategory,
        failureSource: normalizedBelow.failureSource,
        failureCode: normalizedBelow.failureCode,
        amountMinor: belowAmount,
      }),
    );

    const aboveIntervention = routePaymentFailure(
      baseInput({
        failureCategory: normalizedBelow.failureCategory,
        failureSource: normalizedBelow.failureSource,
        failureCode: normalizedBelow.failureCode,
        amountMinor: aboveAmount,
      }),
    );

    return {
      code: doc.code,
      section: doc.section,
      failureCategory: normalizedBelow.failureCategory,
      failureSource: normalizedBelow.failureSource,
      belowThreshold: summarize(belowIntervention),
      aboveThreshold: summarize(aboveIntervention),
    };
  });
}

function printTable(rows: BenchmarkRow[]): void {
  const header = ["code", "section", "category", "source", "action (₹500)", "action (₹20,000)"];
  const widths = header.map((h) => h.length);
  const lines = rows.map((r) => [
    r.code,
    r.section,
    r.failureCategory,
    r.failureSource,
    r.belowThreshold.kind,
    r.aboveThreshold.kind,
  ]);
  for (const line of lines) line.forEach((cell, i) => (widths[i] = Math.max(widths[i]!, cell.length)));

  const printRow = (cells: string[]) => console.log(cells.map((c, i) => c.padEnd(widths[i]!)).join("  "));
  printRow(header);
  printRow(widths.map((w) => "-".repeat(w)));
  for (const line of lines) printRow(line);
}

function printSummary(rows: BenchmarkRow[]): void {
  const total = rows.length;
  const unknown = rows.filter((r) => r.failureCategory === "unknown");
  const fraudStopped = rows.filter((r) => r.belowThreshold.kind === "stop_never_contact");
  const escalated = rows.filter((r) => r.belowThreshold.kind === "escalate_human");
  const outreach = rows.filter((r) => r.belowThreshold.kind === "outreach_email");
  const waited = rows.filter((r) => r.belowThreshold.kind.startsWith("wait") || r.belowThreshold.kind === "no_action_provider_retrying");

  const escalationFlips = rows.filter((r) => r.belowThreshold.kind !== "escalate_human" && r.aboveThreshold.kind === "escalate_human");

  console.log("\n=== Summary ===");
  console.log(`total official failure reasons benchmarked: ${total}`);
  console.log(`  unmapped -> failureCategory "unknown"     : ${unknown.length} (${((unknown.length / total) * 100).toFixed(1)}%)`);
  console.log(`  auto-escalated to human (₹500 case)       : ${escalated.length}`);
  console.log(`  stopped as fraud signal                   : ${fraudStopped.length}`);
  console.log(`  sent automated outreach                   : ${outreach.length}`);
  console.log(`  held / waiting on provider retry           : ${waited.length}`);
  console.log(`  escalate only above human-review threshold: ${escalationFlips.length}`);

  if (unknown.length > 0) {
    console.log("\nUnmapped reasons (categorize() falls through to \"unknown\" -> always escalates):");
    for (const r of unknown) console.log(`  - ${r.code}`);
  }
}

const rows = runBenchmark();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  printTable(rows);
  printSummary(rows);
}
