import { and, eq, isNull, lt, or } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db, cases, outreach, appendCaseEvent } from "@riko/db";
import { applyTransition } from "@riko/core";
import { getTransporterForSmtpConfig, type SmtpConfig } from "../lib/mailer.js";
import { log } from "../lib/logger.js";

const SEND_CLAIM_TTL_MS = 5 * 60 * 1000;

export interface SendableOutreach {
  outreachId: string;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  addressLine: string | null;
  unsubscribeUrl: string;
  smtp: SmtpConfig | null;
}

export async function processSendingCases(
  loadPendingOutreach: (caseId: string) => Promise<SendableOutreach>,
): Promise<void> {
  const sendingCases = await db
    .select()
    .from(cases)
    .where(eq(cases.state, "SENDING"))
    .limit(200);

  for (const caseRow of sendingCases) {
    try {
      const pending = await loadPendingOutreach(caseRow.id);

      if (!pending.smtp) {
        log.error("send_skipped_no_smtp", { caseId: caseRow.id, tenantId: caseRow.tenantId });
        continue;
      }

      const claimed = await db
        .update(cases)
        .set({ nextActionAt: new Date(Date.now() + SEND_CLAIM_TTL_MS) })
        .where(
          and(
            eq(cases.id, caseRow.id),
            eq(cases.state, "SENDING"),
            or(isNull(cases.nextActionAt), lt(cases.nextActionAt, new Date())),
          ),
        )
        .returning({ id: cases.id });
      if (claimed.length === 0) continue;

      const transporter = getTransporterForSmtpConfig(pending.smtp);

      const info = await transporter.sendMail({
        from: `${pending.fromName} <${pending.fromEmail}>`,
        replyTo: pending.replyTo ?? undefined,
        to: pending.toEmail,
        subject: pending.subject,
        text: pending.bodyText,
        html: pending.bodyHtml,
        headers: {
          "List-Unsubscribe": `<${pending.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        log.info("smtp_preview_url", { caseId: caseRow.id, previewUrl });
      }

      const transition = applyTransition(caseRow.state, { type: "sent" });

      await db.transaction(async (tx) => {
        await tx
          .update(outreach)
          .set({ sentAt: new Date(), providerMessageId: info.messageId })
          .where(eq(outreach.id, pending.outreachId));

        const claimed = await tx
          .update(cases)
          .set({
            state: transition.toState,
            attemptCount: caseRow.attemptCount + 1,
            nextActionAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          })
          .where(and(eq(cases.id, caseRow.id), eq(cases.state, "SENDING")))
          .returning({ id: cases.id });

        if (claimed.length === 0) return;

        await appendCaseEvent(tx, {
          tenantId: caseRow.tenantId,
          caseId: caseRow.id,
          fromState: caseRow.state,
          toState: transition.toState,
          reason: transition.reason,
          actor: "system",
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/No pending outreach|Case not found|Missing customer/.test(message)) continue;
      log.error("send_failed_retry_next_tick", { caseId: caseRow.id, error: message });
    }
  }
}
