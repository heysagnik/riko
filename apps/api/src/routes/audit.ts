import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, withTenant, cases, caseEvents, agentActions, customers, payments, exposures, verifyChainRows } from "@riko/db";
import { caseIdParamSchema } from "@riko/shared";
import { requireTenant } from "../middleware/require-tenant.js";

export const auditRouter = Router();

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}

/** Full replayable history for one case, with its hash chain verified. */
auditRouter.get("/cases/:caseId/audit", requireTenant, async (req, res) => {
  const params = caseIdParamSchema.parse(req.params);
  const tenantId = req.tenant!.tenantId;

  const result = await withTenant(db, tenantId, async (tx) => {
    const [caseRow] = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.id, params.caseId), eq(cases.tenantId, tenantId)))
      .limit(1);

    if (!caseRow) return null;

    const [events, actions, [exposure]] = await Promise.all([
      tx.select().from(caseEvents).where(eq(caseEvents.caseId, params.caseId)).orderBy(asc(caseEvents.seq)),
      tx.select().from(agentActions).where(eq(agentActions.caseId, params.caseId)).orderBy(asc(agentActions.createdAt)),
      tx.select().from(exposures).where(eq(exposures.id, caseRow.exposureId)).limit(1),
    ]);

    const [payment] = exposure?.paymentId
      ? await tx.select().from(payments).where(eq(payments.id, exposure.paymentId)).limit(1)
      : [];

    return { caseRow, exposure, payment, chain: verifyChainRows(params.caseId, events), actions };
  });

  if (!result) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  res.setHeader("content-disposition", `attachment; filename="riko-audit-${params.caseId}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    case: {
      id: result.caseRow.id,
      state: result.caseRow.state,
      arm: result.caseRow.arm,
      attemptCount: result.caseRow.attemptCount,
      intervention: result.caseRow.intervention,
      interventionReason: result.caseRow.interventionReason,
      openedAt: result.caseRow.openedAt,
      closedAt: result.caseRow.closedAt,
      closedReason: result.caseRow.closedReason,
      exposureKind: result.exposure?.kind ?? null,
      rung: result.caseRow.rung,
      amountMinor: result.exposure?.amountMinor ?? null,
      currency: result.exposure?.currency ?? null,
      dueAt: result.exposure?.dueAt ?? null,
      failureCategory: result.payment?.failureCategory ?? null,
      failureCode: result.payment?.failureCode ?? null,
      recoveredAmountMinor: result.caseRow.recoveredAmountMinor,
    },
    chain: {
      valid: result.chain.chainValid,
      eventCount: result.chain.eventCount,
      unhashedCount: result.chain.unhashedCount,
      brokenAtSeq: result.chain.brokenAtSeq,
      events: result.chain.events,
    },
    agentActions: result.actions,
  });
});

/** One row per transition across every case, for offline review. */
auditRouter.get("/audit/export.csv", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;

  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        caseId: caseEvents.caseId,
        seq: caseEvents.seq,
        createdAt: caseEvents.createdAt,
        fromState: caseEvents.fromState,
        toState: caseEvents.toState,
        reason: caseEvents.reason,
        actor: caseEvents.actor,
        hash: caseEvents.hash,
        prevHash: caseEvents.prevHash,
        arm: cases.arm,
        intervention: cases.intervention,
        customerName: customers.name,
        amountMinor: exposures.amountMinor,
        currency: exposures.currency,
        failureCategory: payments.failureCategory,
      })
      .from(caseEvents)
      .innerJoin(cases, eq(cases.id, caseEvents.caseId))
      .innerJoin(customers, eq(customers.id, cases.customerId))
      .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId))
      .where(eq(caseEvents.tenantId, tenantId))
      .orderBy(asc(caseEvents.caseId), asc(caseEvents.seq)),
  );

  const csv = toCsv(
    [
      "case_id", "seq", "occurred_at", "from_state", "to_state", "reason", "actor",
      "arm", "intervention", "customer", "amount_minor", "currency", "failure_category",
      "prev_hash", "hash",
    ],
    rows.map((r) => [
      r.caseId, r.seq, r.createdAt, r.fromState, r.toState, r.reason, r.actor,
      r.arm, r.intervention, r.customerName, r.amountMinor, r.currency, r.failureCategory,
      r.prevHash, r.hash,
    ]),
  );

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", 'attachment; filename="riko-audit-export.csv"');
  res.send(csv);
});
