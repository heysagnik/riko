import { Router } from "express";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, withTenant, cases, payments, exposures, customers, outreach } from "@riko/db";
import { metricsQuerySchema } from "@riko/shared";
import { requireTenant } from "../middleware/require-tenant.js";

export const metricsRouter = Router();

const CONTACTED_STATES = new Set(["SENDING", "WAITING"]);

const MIN_ARM_SIZE = 30;

const COST_PER_SEND_MINOR = Number(process.env.COST_PER_SEND_MINOR ?? 0);

metricsRouter.get("/metrics", requireTenant, async (req, res) => {
  const query = metricsQuerySchema.parse(req.query);
  const tenantId = req.tenant!.tenantId;
  const since = new Date(Date.now() - query.windowDays * 24 * 60 * 60 * 1000);

  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: cases.id,
        state: cases.state,
        arm: cases.arm,
        attemptCount: cases.attemptCount,
        intervention: cases.intervention,
        interventionReason: cases.interventionReason,
        closedReason: cases.closedReason,
        recoveredAmountMinor: cases.recoveredAmountMinor,
        amountMinor: exposures.amountMinor,
        currency: exposures.currency,
        failureCategory: payments.failureCategory,
      })
      .from(cases)
      .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId))
      .where(and(eq(cases.tenantId, tenantId), gte(cases.openedAt, since))),
  );

  const [harm] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        unsubscribed: sql<number>`count(*) filter (where ${customers.unsubscribedAt} is not null)::int`,
        bounced: sql<number>`count(*) filter (where ${customers.bouncedAt} is not null)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(customers)
      .where(eq(customers.tenantId, tenantId)),
  );

  const [sends] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(outreach)
      .where(and(eq(outreach.tenantId, tenantId), isNotNull(outreach.sentAt))),
  );

  const recovered = rows.filter((r) => r.state === "RECOVERED");
  const eligible = rows.filter((r) => r.state !== "SKIPPED");

  const contacted = rows.filter((r) => r.attemptCount > 0 || CONTACTED_STATES.has(r.state));
  const contactedIds = new Set(contacted.map((r) => r.id));

  const attributed = recovered.filter((r) => contactedIds.has(r.id));
  const selfHealed = recovered.filter((r) => !contactedIds.has(r.id));

  const contactable = rows.filter((r) => r.intervention === "outreach_email");
  const treatment = contactable.filter((r) => r.arm !== "holdout");
  const holdout = contactable.filter((r) => r.arm === "holdout");
  const rate = (set: typeof rows) =>
    set.length === 0 ? null : set.filter((r) => r.state === "RECOVERED").length / set.length;

  const sum = (set: typeof rows, pick: (r: (typeof rows)[number]) => number | null) =>
    set.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

  const tally = <T extends string>(set: typeof rows, pick: (r: (typeof rows)[number]) => T | null) => {
    const counts = new Map<string, { count: number; amountMinor: number }>();
    for (const r of set) {
      const key = pick(r) ?? "unspecified";
      const entry = counts.get(key) ?? { count: 0, amountMinor: 0 };
      entry.count += 1;
      entry.amountMinor += r.amountMinor;
      counts.set(key, entry);
    }
    return [...counts.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count);
  };

  const suppressed = rows.filter((r) => !contactedIds.has(r.id) && r.state !== "RECOVERED");
  const treatmentRate = rate(treatment);
  const holdoutRate = rate(holdout);

  const sendCount = sends?.n ?? 0;
  const costMinor = sendCount * COST_PER_SEND_MINOR;
  const recoveredMinor = sum(recovered, (r) => r.recoveredAmountMinor);
  const attributedMinor = sum(attributed, (r) => r.recoveredAmountMinor);
  const contactedCustomers = harm?.total ?? 0;

  res.json({
    windowDays: query.windowDays,
    currency: rows[0]?.currency ?? "inr",

    totalCases: rows.length,
    atRiskMinor: sum(rows, (r) => r.amountMinor),

    recoveredCount: recovered.length,
    recoveredAmountMinor: recoveredMinor,
    recoveryRate: eligible.length > 0 ? recovered.length / eligible.length : 0,

    attributedCount: attributed.length,
    attributedAmountMinor: attributedMinor,
    selfHealedCount: selfHealed.length,
    selfHealedAmountMinor: sum(selfHealed, (r) => r.recoveredAmountMinor),

    contactedCount: contacted.length,
    suppressedCount: suppressed.length,
    suppressedAmountMinor: sum(suppressed, (r) => r.amountMinor),

    lift: {
      treatmentRate,
      holdoutRate,
      treatmentCount: treatment.length,
      holdoutCount: holdout.length,
      incrementalPoints:
        treatmentRate !== null && holdoutRate !== null ? (treatmentRate - holdoutRate) * 100 : null,
      minArmSize: MIN_ARM_SIZE,
      significant: treatment.length >= MIN_ARM_SIZE && holdout.length >= MIN_ARM_SIZE,
    },

    economics: {
      sendCount,
      costPerSendMinor: COST_PER_SEND_MINOR,
      costMinor,
      netRecoveredMinor: recoveredMinor - costMinor,
      netAttributedMinor: attributedMinor - costMinor,
      costPerRecoveredMinor: attributed.length > 0 ? costMinor / attributed.length : 0,
      incentiveSpendMinor: 0,
    },

    harm: {
      customerCount: contactedCustomers,
      unsubscribedCount: harm?.unsubscribed ?? 0,
      bouncedCount: harm?.bounced ?? 0,
      unsubscribeRate: contactedCustomers > 0 ? (harm?.unsubscribed ?? 0) / contactedCustomers : 0,
      bounceRate: contactedCustomers > 0 ? (harm?.bounced ?? 0) / contactedCustomers : 0,
    },

    interventions: tally(rows, (r) => r.intervention),
    suppressionReasons: tally(suppressed, (r) => r.interventionReason ?? r.closedReason),
    failureCategories: tally(rows, (r) => r.failureCategory),

    exceptions: rows
      .filter((r) => r.state === "SKIPPED" || r.state === "LOST" || r.state === "ESCALATED")
      .map((r) => ({
        caseId: r.id,
        state: r.state,
        reason: r.closedReason,
        amountMinor: r.amountMinor,
        failureCategory: r.failureCategory,
      })),
  });
});
