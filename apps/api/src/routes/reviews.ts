import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, withTenant, cases, customers, exposures, outreach } from "@riko/db";
import { requireTenant } from "../middleware/require-tenant.js";

export const reviewsRouter = Router();

const REVIEW_LIST_LIMIT = 100;

reviewsRouter.get("/reviews", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;

  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        outreachId: outreach.id,
        caseId: cases.id,
        subject: outreach.subject,
        body: outreach.body,
        sentAt: outreach.sentAt,
        openedAt: outreach.openedAt,
        clickedAt: outreach.clickedAt,
        customerName: customers.name,
        amountMinor: exposures.amountMinor,
        currency: exposures.currency,
      })
      .from(outreach)
      .innerJoin(cases, eq(cases.id, outreach.caseId))
      .innerJoin(customers, eq(customers.id, cases.customerId))
      .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .where(and(eq(outreach.tenantId, tenantId), eq(outreach.reviewSampled, true)))
      .orderBy(desc(outreach.createdAt))
      .limit(REVIEW_LIST_LIMIT),
  );

  res.json({ reviews: rows });
});
