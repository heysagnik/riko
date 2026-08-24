import { Router } from "express";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, cases, caseEvents, agentActions, caseMessages, customers, payments, exposures, outreach, verifyChainRows } from "@riko/db";
import { caseListQuerySchema, caseIdParamSchema, resolveCaseStates, CASE_STATE_GROUPS } from "@riko/shared";
import { requireTenant } from "../middleware/require-tenant.js";

export const casesRouter = Router();

casesRouter.get("/cases", requireTenant, async (req, res) => {
  const query = caseListQuerySchema.parse(req.query);
  const tenantId = req.tenant!.tenantId;

  const states = resolveCaseStates(query.state);
  const filters = [eq(cases.tenantId, tenantId)];
  if (states) filters.push(inArray(cases.state, [...states]));
  if (query.from) filters.push(gte(cases.openedAt, new Date(query.from)));
  if (query.to) filters.push(lt(cases.openedAt, new Date(query.to)));
  const scope = and(...filters);

  const [rows, totalRow, byState] = await Promise.all([
    db
      .select({
        id: cases.id,
        state: cases.state,
        attemptCount: cases.attemptCount,
        openedAt: cases.openedAt,
        closedReason: cases.closedReason,
        recoveredAmountMinor: cases.recoveredAmountMinor,
        intervention: cases.intervention,
        interventionReason: cases.interventionReason,
        arm: cases.arm,
        customerName: customers.name,
        amountMinor: exposures.amountMinor,
        currency: exposures.currency,
        failureCategory: payments.failureCategory,
        failureSource: payments.failureSource,
      })
      .from(cases)
      .innerJoin(customers, eq(customers.id, cases.customerId))
      .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId))
      .where(scope)
      .orderBy(desc(cases.openedAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(cases).where(scope),
    db
      .select({ state: cases.state, n: sql<number>`count(*)::int` })
      .from(cases)
      .where(eq(cases.tenantId, tenantId))
      .groupBy(cases.state),
  ]);

  const total = totalRow[0]?.n ?? 0;
  const stateCounts = Object.fromEntries(byState.map((r) => [r.state, r.n]));
  const counts: Record<string, number> = {
    ALL: byState.reduce((sum, r) => sum + r.n, 0),
    ...stateCounts,
  };
  for (const [group, members] of Object.entries(CASE_STATE_GROUPS)) {
    counts[group] = members.reduce((sum, s) => sum + (stateCounts[s] ?? 0), 0);
  }

  res.json({ cases: rows, total, counts, offset: query.offset, limit: query.limit });
});

casesRouter.get("/cases/:caseId", requireTenant, async (req, res) => {
  const params = caseIdParamSchema.parse(req.params);
  const tenantId = req.tenant!.tenantId;

  const [main] = await db
    .select({
      case: cases,
      customer: customers,
      exposure: exposures,
      payment: payments,
    })
    .from(cases)
    .leftJoin(customers, eq(customers.id, cases.customerId))
    .leftJoin(exposures, eq(exposures.id, cases.exposureId))
    .leftJoin(payments, eq(payments.id, exposures.paymentId))
    .where(and(eq(cases.id, params.caseId), eq(cases.tenantId, tenantId)))
    .limit(1);

  if (!main || !main.customer || !main.exposure) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const { case: caseRow, customer, exposure, payment } = main;

  const [events, actions, messages, outreachRows] = await Promise.all([
    db
      .select()
      .from(caseEvents)
      .where(and(eq(caseEvents.caseId, params.caseId), eq(caseEvents.tenantId, tenantId)))
      .orderBy(caseEvents.seq),
    db
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.caseId, params.caseId), eq(agentActions.tenantId, tenantId)))
      .orderBy(agentActions.createdAt),
    db
      .select()
      .from(caseMessages)
      .where(and(eq(caseMessages.caseId, params.caseId), eq(caseMessages.tenantId, tenantId)))
      .orderBy(caseMessages.seq),
    db
      .select()
      .from(outreach)
      .where(and(eq(outreach.caseId, params.caseId), eq(outreach.tenantId, tenantId)))
      .orderBy(outreach.createdAt),
  ]);

  const chain = verifyChainRows(params.caseId, events);

  res.json({
    case: caseRow,
    events,
    actions,
    messages,
    scheduledDraft: outreachRows.find((o) => !o.sentAt) ?? null,
    customer,
    exposure,
    payment: payment ?? null,
    chain: {
      valid: chain.chainValid,
      eventCount: chain.eventCount,
      unhashedCount: chain.unhashedCount,
      brokenAtSeq: chain.brokenAtSeq,
    },
  });
});
