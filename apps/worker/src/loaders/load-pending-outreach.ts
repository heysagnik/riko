import { and, desc, eq, isNull } from "drizzle-orm";
import { db, outreach, cases, customers, organization, senderIdentities } from "@riko/db";
import { decryptSecret, renderBrandTemplate, taggedReplyTo } from "@riko/core";
import { getOrCreateRazorpayPayLink } from "../lib/pay-link.js";
import type { SendableOutreach } from "../jobs/process-sending-cases.js";

const INBOUND_REPLY_BASE = process.env.INBOUND_REPLY_BASE ?? null;
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://app.example.com";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const URL_PATTERN = /https?:\/\/\S+/g;
const LABEL_PATTERN = /([A-Za-z][\w '-]{2,60}):\s*$/;

function normalizePaymentCta(label: string): string {
  const l = label.trim().toLowerCase();
  if (l === "update your payment method" || l === "update payment method" || l === "update payment") {
    return "Update payment details";
  }
  return label;
}

function renderButton(label: string, url: string): string {
  const displayLabel = normalizePaymentCta(label);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">` +
    `<tr><td class="riko-btn" style="background:#111111;">` +
    `<a href="${escapeHtml(url)}" class="riko-btn-label" style="display:inline-block;padding:11px 18px;font-size:14px;font-weight:500;` +
    `color:#ffffff;text-decoration:none;font-family:inherit;">${escapeHtml(displayLabel)}</a>` +
    `</td></tr></table>`
  );
}

function renderFooterLink(label: string, url: string): string {
  return (
    `<p style="margin:20px 0 0;font-size:12px;">` +
    `<a href="${escapeHtml(url)}" class="riko-unsub" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(label)}</a>` +
    `</p>`
  );
}

function renderParagraph(paragraph: string): string[] {
  const matches = [...paragraph.matchAll(URL_PATTERN)];
  if (matches.length === 0) {
    const text = paragraph.trim();
    return text ? [`<p style="margin:0 0 14px;">${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`] : [];
  }

  const blocks: string[] = [];
  let cursor = 0;
  let inline = "";

  const flushInline = () => {
    if (inline.trim().length > 0) {
      blocks.push(`<p style="margin:0 0 14px;">${inline.trim()}</p>`);
    }
    inline = "";
  };

  for (const match of matches) {
    const rawUrl = match[0];
    const url = rawUrl.replace(/[).,!?]+$/, "");
    const trailingPunctuation = rawUrl.slice(url.length);
    const idx = match.index ?? 0;
    const before = paragraph.slice(cursor, idx);
    const labelMatch = before.match(LABEL_PATTERN);

    if (labelMatch && labelMatch[1]) {
      const label = labelMatch[1].trim();
      const precedingText = before.slice(0, labelMatch.index).trim();
      if (precedingText) {
        inline += `${escapeHtml(precedingText)} `;
      }
      flushInline();
      blocks.push(/^unsubscribe$/i.test(label) ? renderFooterLink(label, url) : renderButton(label, url));
    } else {
      inline += `${escapeHtml(before)}<a href="${escapeHtml(url)}" class="riko-link" style="color:#2563eb;">${escapeHtml(url)}</a>`;
    }

    cursor = idx + url.length + trailingPunctuation.length;
  }

  inline += escapeHtml(paragraph.slice(cursor)).replace(/\n/g, "<br/>");
  flushInline();
  return blocks;
}

function toParagraphHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .flatMap((para) => renderParagraph(para.trim()))
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

  const replyToBase = sender.replyTo ?? INBOUND_REPLY_BASE;

  const rendered = renderBrandTemplate(sender.brandTemplateHtml, {
    content: toParagraphHtml(pending.body),
    merchantName: tenant?.name ?? sender.fromName,
  });
  const pixel = `<img src="${APP_BASE_URL}/t/open/${pending.id}" width="1" height="1" alt="" style="display:none;">`;
  const bodyHtml = /<\/body>/i.test(rendered)
    ? rendered.replace(/<\/body>/i, `${pixel}</body>`)
    : `${rendered}${pixel}`;
  const unsubscribeUrl = `${APP_BASE_URL}/unsubscribe/${customer.id}`;

  await getOrCreateRazorpayPayLink(caseId);

  const addressFooterText = sender.addressLine ? `\n\n${sender.fromName}\n${sender.addressLine}` : "";
  const addressFooterHtml = sender.addressLine
    ? `<p class="riko-address" style="margin:20px 0 0;text-align:center;font-size:12px;color:#8b94a3;">${escapeHtml(sender.addressLine)}</p>`
    : "";

  return {
    outreachId: pending.id,
    fromEmail: sender.fromEmail,
    fromName: sender.fromName,
    replyTo: replyToBase ? taggedReplyTo(replyToBase, caseId) : null,
    toEmail: decryptSecret(customer.emailEncrypted, requireEncryptionKey()),
    subject: pending.subject,
    bodyText: `${pending.body}${addressFooterText}`,
    bodyHtml: `${bodyHtml}${addressFooterHtml}`,
    addressLine: sender.addressLine,
    unsubscribeUrl,
    smtp,
  };
}
