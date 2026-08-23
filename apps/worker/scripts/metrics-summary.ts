import { db, cases, payments } from "@riko/db";
import { eq } from "drizzle-orm";

const rows = await db
  .select({ c: cases, p: payments })
  .from(cases)
  .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId));

const inr = (minor: number) => `INR ${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const recovered = rows.filter((r) => r.c.state === "RECOVERED");
const contacted = rows.filter((r) => r.c.attemptCount > 0 || ["SENDING", "WAITING"].includes(r.c.state));
const contactedIds = new Set(contacted.map((r) => r.c.id));
const attributed = recovered.filter((r) => contactedIds.has(r.c.id));
const selfHealed = recovered.filter((r) => !contactedIds.has(r.c.id));

const contactable = rows.filter((r) => r.c.intervention === "outreach_email");
const treatment = contactable.filter((r) => r.c.arm !== "holdout");
const holdout = contactable.filter((r) => r.c.arm === "holdout");
const rate = (set: typeof rows) =>
  set.length === 0 ? null : set.filter((r) => r.c.state === "RECOVERED").length / set.length;

const sum = (set: typeof rows, pick: (r: (typeof rows)[number]) => number | null) =>
  set.reduce((a, r) => a + (pick(r) ?? 0), 0);

console.log("total cases        ", rows.length);
console.log("at risk            ", inr(sum(rows, (r) => r.p.amountMinor)));
console.log("");
console.log("recovered          ", recovered.length, inr(sum(recovered, (r) => r.c.recoveredAmountMinor ?? r.p.amountMinor)));
console.log("  attributed to us ", attributed.length, inr(sum(attributed, (r) => r.c.recoveredAmountMinor ?? r.p.amountMinor)));
console.log("  self-healed      ", selfHealed.length, inr(sum(selfHealed, (r) => r.c.recoveredAmountMinor ?? r.p.amountMinor)));
console.log("");
console.log("contacted          ", contacted.length);
console.log("suppressed         ", rows.length - contacted.length);
console.log("");

const t = rate(treatment);
const h = rate(holdout);
console.log("treatment          ", treatment.length, "cases, rate", t === null ? "-" : (t * 100).toFixed(1) + "%");
console.log("holdout            ", holdout.length, "cases, rate", h === null ? "-" : (h * 100).toFixed(1) + "%");
console.log("incremental lift   ", t !== null && h !== null ? ((t - h) * 100).toFixed(1) + " pts" : "-");
console.log("");

const tally = (set: typeof rows, pick: (r: (typeof rows)[number]) => string | null) => {
  const m = new Map<string, number>();
  for (const r of set) m.set(pick(r) ?? "unspecified", (m.get(pick(r) ?? "unspecified") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log("interventions      ", tally(rows, (r) => r.c.intervention));
console.log("states             ", tally(rows, (r) => r.c.state));
console.log("suppression reasons", tally(rows.filter((r) => !contactedIds.has(r.c.id)), (r) => r.c.interventionReason ?? r.c.closedReason));
process.exit(0);
