import { and, eq } from "drizzle-orm";
import { db, cases, connections, customers, exposures, organization } from "@riko/db";
import { createRazorpayPaymentLink, decryptSecret } from "@riko/core";

const LINK_TTL_MS = 30 * 60 * 1000;
const THROTTLE_RETRY_MS = 3000;
const cache = new Map<string, { url: string; expires: number }>();

function isThrottled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("(429)") || /try after sometime/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getCachedPayLink(caseId: string): string | null {
  const cached = cache.get(caseId);
  if (cached && cached.expires > Date.now()) return cached.url;
  return null;
}

function encryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  return key;
}

export async function getOrCreateRazorpayPayLink(caseId: string): Promise<string | null> {
  const cached = cache.get(caseId);
  if (cached && cached.expires > Date.now()) return cached.url;

  try {
    const [caseRow] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!caseRow) return null;

    const [exposure] = await db.select().from(exposures).where(eq(exposures.id, caseRow.exposureId)).limit(1);
    const [customer] = await db.select().from(customers).where(eq(customers.id, caseRow.customerId)).limit(1);
    const [tenant] = await db.select().from(organization).where(eq(organization.id, caseRow.tenantId)).limit(1);
    if (!exposure || !customer) return null;

    const [connection] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.id, exposure.connectionId), eq(connections.status, "active")))
      .limit(1);
    if (!connection || connection.providerId !== "razorpay") return null;

    const key = encryptionKey();
    const params = {
      keyId: connection.providerAccountId,
      keySecret: decryptSecret(connection.accessTokenEncrypted, key),
      amountMinor: exposure.amountMinor,
      currency: exposure.currency,
      description: `${tenant?.name ?? "Payment"} — ${exposure.currency.toUpperCase()} ${(exposure.amountMinor / 100).toFixed(2)}`,
      customerName: customer.name,
      customerEmail: decryptSecret(customer.emailEncrypted, key),
      customerContact: customer.phoneEncrypted ? decryptSecret(customer.phoneEncrypted, key) : null,
      notes: { case_id: caseRow.id, tenant_id: caseRow.tenantId },
    };

    let link: Awaited<ReturnType<typeof createRazorpayPaymentLink>>;
    try {
      link = await createRazorpayPaymentLink(params);
    } catch (error) {
      if (!isThrottled(error)) throw error;
      await sleep(THROTTLE_RETRY_MS);
      link = await createRazorpayPaymentLink(params);
    }

    cache.set(caseId, { url: link.shortUrl, expires: Date.now() + LINK_TTL_MS });
    return link.shortUrl;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isThrottled(error)) {
      process.stdout.write(`pay-link: throttled for case ${caseId}, falling back to lazy link\n`);
    } else {
      process.stderr.write(`pay-link: failed for case ${caseId}: ${detail}\n`);
    }
    return null;
  }
}
