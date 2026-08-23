import { and, desc, eq, isNull } from "drizzle-orm";
import { db, outreach, cases, customers, organization, senderIdentities } from "@riko/db";
import { decryptSecret, renderBrandTemplate, taggedReplyTo } from "@riko/core";
import type { SendableOutreach } from "../jobs/process-sending-cases.js";

const INBOUND_REPLY_BASE = process.env.INBOUND_REPLY_BASE ?? null;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toParagraphHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .filter((para) => para.trim().length > 0)
    .map((para) => `<p style="margin:0 0 14px;">${escapeHtml(para.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return key;
}

export async function loadPendingOutreach(caseId: string): Promise<SendableOutreach> {
  const [pending] = await db
    .select()
    .from(outreach)
    .where(and(eq(outreach.caseId, caseId), isNull(outreach.sentAt)))
    .orderBy(desc(outreach.id))
    .limit(1);

  if (!pending) {
    throw new Error(`No pending outreach for case: ${caseId}`);
  }

  const [caseRow] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!caseRow) {
    throw new Error(`Case not found: ${caseId}`);
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, caseRow.customerId)).limit(1);
  const [tenant] = await db.select().from(organization).where(eq(organization.id, caseRow.tenantId)).limit(1);
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.tenantId, caseRow.tenantId))
    .limit(1);

  if (!customer || !sender) {
    throw new Error(`Missing customer or sender identity for case: ${caseId}`);
  }

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

  // Replies land on shared infrastructure, not the merchant's domain: the
  // case-id tag already identifies the tenant, so one inbox serves everyone.
  // A tenant-set reply_to still wins, but it must be a domain we receive on.
  const replyToBase = sender.replyTo ?? INBOUND_REPLY_BASE;

  return {
    outreachId: pending.id,
    fromEmail: sender.fromEmail,
    fromName: sender.fromName,
    replyTo: replyToBase ? taggedReplyTo(replyToBase, caseId) : null,
    toEmail: decryptSecret(customer.emailEncrypted, requireEncryptionKey()),
    subject: pending.subject,
    bodyText: pending.body,
    bodyHtml: renderBrandTemplate(sender.brandTemplateHtml, {
      content: toParagraphHtml(pending.body),
      merchantName: tenant?.name ?? sender.fromName,
    }),
    smtp,
  };
}
