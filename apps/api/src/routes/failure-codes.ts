import { Router } from "express";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, connections, failureCodeMap, payments, withTenant } from "@riko/db";
import { requireTenant } from "../middleware/require-tenant.js";

export const failureCodesRouter = Router();

failureCodesRouter.get("/failure-codes/unmapped", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;

  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        providerId: connections.providerId,
        failureCode: payments.failureCode,
        failureCategory: payments.failureCategory,
        failureRecoverable: payments.failureRecoverable,
        mapped: sql<boolean>`${failureCodeMap.providerCode} is not null`,
        occurrences: sql<number>`count(*)::int`,
        amountMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
        lastSeen: sql<Date>`max(${payments.occurredAt})`,
      })
      .from(payments)
      .innerJoin(connections, eq(connections.id, payments.connectionId))
      .leftJoin(
        failureCodeMap,
        and(
          sql`${failureCodeMap.providerId}::text = ${connections.providerId}::text`,
          sql`${failureCodeMap.providerCode}::text = ${payments.failureCode}::text`,
        ),
      )
      .where(and(eq(payments.tenantId, tenantId), isNotNull(payments.failureCode)))
      .groupBy(
        connections.providerId,
        payments.failureCode,
        payments.failureCategory,
        payments.failureRecoverable,
        failureCodeMap.providerCode,
      )
      .orderBy(sql`count(*) desc`)
      .limit(200),
  );

  res.json({ unmapped: rows });
});
