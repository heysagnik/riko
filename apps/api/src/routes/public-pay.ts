import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, cases, customers, exposures, connections, organization } from "@riko/db";
import { createRazorpayPaymentLink, decryptSecret } from "@riko/core";

export const publicPayRouter = Router();

const paramsSchema = z.object({ caseId: z.string().uuid() });

const OPEN_STATES = ["NEW", "DRAFTING", "SENDING", "WAITING", "PROMISED"] as const;

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return key;
}

function formatAmount(amountMinor: number, currency: string): string {
  return `${currency.toUpperCase()} ${(amountMinor / 100).toFixed(2)}`;
}

interface PayLinkOk {
  ok: true;
  payUrl: string;
  merchantName: string;
  amount: string;
}

interface PayLinkErr {
  ok: false;
  status: number;
  error: string;
}

/**
 * Resolves the emailed /pay/:caseId link to a Razorpay-hosted payment page.
 * The caseId is the capability token, so errors stay terse and leak nothing.
 */
async function resolvePayLink(rawCaseId: unknown): Promise<PayLinkOk | PayLinkErr> {
  const parsed = paramsSchema.safeParse({ caseId: rawCaseId });
  if (!parsed.success) {
    return { ok: false, status: 400, error: "invalid_link" };
  }

  const [caseRow] = await db.select().from(cases).where(eq(cases.id, parsed.data.caseId)).limit(1);
  if (!caseRow) {
    return { ok: false, status: 404, error: "unknown_link" };
  }

  if (!(OPEN_STATES as readonly string[]).includes(caseRow.state)) {
    return { ok: false, status: 410, error: "case_closed" };
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, caseRow.customerId)).limit(1);
  const [exposure] = await db.select().from(exposures).where(eq(exposures.id, caseRow.exposureId)).limit(1);
  const [tenant] = await db.select().from(organization).where(eq(organization.id, caseRow.tenantId)).limit(1);

  if (!customer || !exposure) {
    return { ok: false, status: 404, error: "unknown_link" };
  }

  if (customer.unsubscribedAt) {
    return { ok: false, status: 410, error: "case_closed" };
  }

  const [connection] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, exposure.connectionId), eq(connections.status, "active")))
    .limit(1);

  if (!connection || connection.providerId !== "razorpay") {
    return { ok: false, status: 409, error: "provider_unavailable" };
  }

  const key = requireEncryptionKey();
  const merchantName = tenant?.name ?? "the business";
  const amount = formatAmount(exposure.amountMinor, exposure.currency);

  try {
    const link = await createRazorpayPaymentLink({
      keyId: connection.providerAccountId,
      keySecret: decryptSecret(connection.accessTokenEncrypted, key),
      amountMinor: exposure.amountMinor,
      currency: exposure.currency,
      description: `${merchantName} — ${amount}`,
      customerName: customer.name,
      customerEmail: decryptSecret(customer.emailEncrypted, key),
      customerContact: null,
      notes: { case_id: caseRow.id, tenant_id: caseRow.tenantId },
    });

    return { ok: true, payUrl: link.shortUrl, merchantName, amount };
  } catch (error) {
    process.stderr.write(
      `public-pay: failed to create link for case ${caseRow.id}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return { ok: false, status: 502, error: "provider_unavailable" };
  }
}

publicPayRouter.get("/public/pay/:caseId", async (req, res) => {
  const result = await resolvePayLink(req.params.caseId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ payUrl: result.payUrl, merchantName: result.merchantName, amount: result.amount });
});

// For clients that follow the link without running our JavaScript.
publicPayRouter.get("/public/pay/:caseId/redirect", async (req, res) => {
  const result = await resolvePayLink(req.params.caseId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.redirect(302, result.payUrl);
});
