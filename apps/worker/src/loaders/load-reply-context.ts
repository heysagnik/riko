import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, cases, customers, exposures, organization, outreach, senderIdentities } from "@riko/db";
import { decryptSecret, taggedReplyTo } from "@riko/core";

const DEFAULT_TIMEZONE = process.env.DEFAULT_CUSTOMER_TIMEZONE ?? "Asia/Kolkata";

function localHourFor(timezone: string | null): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone ?? DEFAULT_TIMEZONE,
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );
  } catch {
    return new Date().getHours();
  }
}

const INBOUND_REPLY_BASE = process.env.INBOUND_REPLY_BASE ?? null;
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://app.example.com";

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  return key;
}

export async function loadReplyContext(caseId: string) {
  const [caseRow] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!caseRow) throw new Error("Case not found");

  const [customer] = await db.select().from(customers).where(eq(customers.id, caseRow.customerId)).limit(1);
  if (!customer) throw new Error("Missing customer");

  const [exposure] = await db.select().from(exposures).where(eq(exposures.id, caseRow.exposureId)).limit(1);
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.tenantId, caseRow.tenantId))
    .limit(1);
  if (!sender) throw new Error("No sender identity");

  const [tenant] = await db.select().from(organization).where(eq(organization.id, caseRow.tenantId)).limit(1);

  const amountMinor = exposure?.amountMinor ?? 0;
  const currency = (exposure?.currency ?? "inr").toUpperCase();

  const replyToBase = sender.replyTo ?? INBOUND_REPLY_BASE;

  const smtp =
    sender.smtpHost && sender.smtpPort && sender.smtpUser && sender.smtpPasswordEncrypted
      ? {
          host: sender.smtpHost,
          port: sender.smtpPort,
          secure: sender.smtpSecure,
          user: sender.smtpUser,
          password: decryptSecret(sender.smtpPasswordEncrypted, requireEncryptionKey()),
        }
      : null;

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [sentToday] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreach)
    .where(
      and(eq(outreach.tenantId, caseRow.tenantId), isNotNull(outreach.sentAt), gte(outreach.sentAt, since)),
    );

  return {
    customerName: customer.name ?? "there",
    localHour: localHourFor(customer.timezone),
    customerSuppressed: Boolean(customer.suppressedAt || customer.unsubscribedAt || customer.bouncedAt),
    tenantPaused: sender.outreachPaused,
    withinDailyCap: (sentToday?.count ?? 0) < sender.dailySendCap,
    amountLabel: `${currency} ${(amountMinor / 100).toFixed(2)}`,
    merchantName: tenant?.name ?? sender.fromName,
    paymentUrl: `${APP_BASE_URL}/pay/${caseId}`,
    toEmail: decryptSecret(customer.emailEncrypted, requireEncryptionKey()),
    fromEmail: sender.fromEmail,
    fromName: sender.fromName,
    replyTo: replyToBase ? taggedReplyTo(replyToBase, caseId) : null,
    subject: `Re: your payment to ${tenant?.name ?? sender.fromName}`,
    smtp,
  };
}
