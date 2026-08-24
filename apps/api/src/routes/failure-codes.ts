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
        occurrences: sql<number>`count(*)::int`,
        amountMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
        lastSeen: sql<Date>`max(${payments.occurredAt})`,
      })
      .from(payments)
      .innerJoin(connections, eq(connections.id, payments.connectionId))
      .leftJoin(
        failureCodeMap,
        and(eq(failureCodeMap.providerId, connections.providerId), eq(failureCodeMap.providerCode, payments.failureCode)),
      )
      .where(
        and(
          eq(payments.tenantId, tenantId),
          isNotNull(payments.failureCode),
          sql`${failureCodeMap.providerCode} is null`,
        ),
      )
      .groupBy(connections.providerId, payments.failureCode)
      .orderBy(sql`count(*) desc`)
      .limit(50),
  );

  res.json({ unmapped: rows });
});
