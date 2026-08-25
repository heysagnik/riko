import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, cases, customers, appendCaseEvent } from "@riko/db";

export const publicUnsubscribeRouter = Router();

const paramsSchema = z.object({ customerId: z.string().uuid() });

const OPEN_STATES = ["NEW", "DRAFTING", "SENDING", "WAITING", "PROMISED"] as const;

publicUnsubscribeRouter.post("/public/unsubscribe/:customerId", async (req, res) => {
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_link" });
    return;
  }

  const [customer] = await db
    .select({ id: customers.id, tenantId: customers.tenantId, unsubscribedAt: customers.unsubscribedAt })
    .from(customers)
    .where(eq(customers.id, parsed.data.customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "unknown_link" });
    return;
  }

  if (customer.unsubscribedAt) {
    res.json({ ok: true, alreadyUnsubscribed: true });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(customers).set({ unsubscribedAt: new Date() }).where(eq(customers.id, customer.id));

    const open = await tx
      .select({ id: cases.id, state: cases.state })
      .from(cases)
      .where(and(eq(cases.customerId, customer.id), inArray(cases.state, [...OPEN_STATES])));

    if (open.length === 0) return;

    await tx
      .update(cases)
      .set({ state: "SKIPPED", closedAt: new Date(), closedReason: "customer_unsubscribed" })
      .where(inArray(cases.id, open.map((c) => c.id)));

    for (const c of open) {
      await appendCaseEvent(tx, {
        tenantId: customer.tenantId,
        caseId: c.id,
        fromState: c.state,
        toState: "SKIPPED",
        reason: "customer_unsubscribed",
        actor: "system",
      });
    }
  });

  res.json({ ok: true, alreadyUnsubscribed: false });
});
