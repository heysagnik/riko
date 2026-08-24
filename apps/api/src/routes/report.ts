import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, withTenant, cases, customers, exposures, payments, outreach } from "@riko/db";
import { requireTenant } from "../middleware/require-tenant.js";
import { z } from "zod";

export const reportRouter = Router();

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
  format: z.enum(["json", "csv"]).default("json"),
});

const CONTACTED_STATES = new Set(["SENDING", "WAITING", "PROMISED"]);

interface ReportRow {
  caseId: string;
  state: string;
  arm: string;
  intervention: string | null;
  interventionReason: string | null;
  closedReason: string | null;
  amountMinor: number;
  currency: string;
  recoveredAmountMinor: number | null;
  failureCategory: string | null;
  attemptCount: number;
  customerName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  sentCount: number;
  clicked: boolean;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: ReportRow[]): string {
  const header = [
    "case_id",
    "state",
    "arm",
    "intervention",
    "intervention_reason",
    "closed_reason",
    "amount_minor",
    "currency",
    "recovered_amount_minor",
    "failure_category",
    "attempts",
    "customer_name",
    "opened_at",
    "closed_at",
    "emails_sent",
    "link_clicked",
  ];
  const lines = rows.map((r) =>
    [
      r.caseId,
      r.state,
      r.arm,
      r.intervention,
      r.interventionReason,
      r.closedReason,
      r.amountMinor,
      r.currency,
      r.recoveredAmountMinor,
      r.failureCategory,
      r.attemptCount,
      r.customerName,
      r.openedAt.toISOString(),
      r.closedAt?.toISOString() ?? "",
      r.sentCount,
      r.clicked,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

reportRouter.get("/report", requireTenant, async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const { windowDays, format } = parsed.data;
  const tenantId = req.tenant!.tenantId;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await withTenant(db, tenantId, (tx) => tx
    .select({
      caseId: cases.id,
      state: cases.state,
      arm: cases.arm,
      intervention: cases.intervention,
      interventionReason: cases.interventionReason,
      closedReason: cases.closedReason,
      amountMinor: exposures.amountMinor,
      currency: exposures.currency,
      recoveredAmountMinor: cases.recoveredAmountMinor,
      failureCategory: payments.failureCategory,
      attemptCount: cases.attemptCount,
      customerName: customers.name,
      openedAt: cases.openedAt,
      closedAt: cases.closedAt,
      sentCount: sql<number>`(select count(*)::int from ${outreach} o where o.case_id = ${cases.id} and o.sent_at is not null)`,
      clicked: sql<boolean>`exists (select 1 from ${outreach} o where o.case_id = ${cases.id} and o.clicked_at is not null)`,
    })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(exposures, eq(exposures.id, cases.exposureId))
    .leftJoin(payments, eq(payments.id, exposures.paymentId))
    .where(and(eq(cases.tenantId, tenantId), gte(cases.openedAt, since)))
    .orderBy(desc(cases.openedAt)));

  const typedRows: ReportRow[] = rows.map((r) => ({ ...r }));

  if (format === "csv") {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="riko-recovery-report-${windowDays}d-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(toCsv(typedRows));
    return;
  }

  const contacted = (r: ReportRow) => r.attemptCount > 0 || CONTACTED_STATES.has(r.state);
  const contactable = typedRows.filter((r) => r.intervention === "outreach_email");
  const treatment = contactable.filter((r) => r.arm !== "holdout");
  const holdout = contactable.filter((r) => r.arm === "holdout");

  const rate = (set: ReportRow[]) =>
    set.length === 0 ? null : set.filter((r) => r.state === "RECOVERED").length / set.length;

  const recovered = typedRows.filter((r) => r.state === "RECOVERED");
  const attributed = recovered.filter((r) => contacted(r));
  const selfHealed = recovered.filter((r) => !contacted(r));

  res.json({
    windowDays,
    generatedAt: new Date().toISOString(),
    totals: {
      cases: typedRows.length,
      atRiskMinor: typedRows.reduce((sum, r) => sum + r.amountMinor, 0),
      recoveredCount: recovered.length,
      recoveredAmountMinor: recovered.reduce((sum, r) => sum + (r.recoveredAmountMinor ?? 0), 0),
      attributedCount: attributed.length,
      attributedAmountMinor: attributed.reduce((sum, r) => sum + (r.recoveredAmountMinor ?? 0), 0),
      selfHealedCount: selfHealed.length,
      emailsSent: typedRows.reduce((sum, r) => sum + r.sentCount, 0),
    },
    lift: {
      treatmentRate: rate(treatment),
      holdoutRate: rate(holdout),
      treatmentCount: treatment.length,
      holdoutCount: holdout.length,
      incrementalPoints:
        rate(treatment) !== null && rate(holdout) !== null ? ((rate(treatment) as number) - (rate(holdout) as number)) * 100 : null,
      significant: treatment.length >= 30 && holdout.length >= 30,
    },
    exceptions: typedRows
      .filter((r) => ["SKIPPED", "LOST", "ESCALATED"].includes(r.state))
      .map((r) => ({ caseId: r.caseId, state: r.state, reason: r.closedReason ?? r.interventionReason, amountMinor: r.amountMinor })),
    cases: typedRows,
  });
});
