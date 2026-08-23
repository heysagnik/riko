import { Router } from "express";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  withTenant,
  cases,
  customers,
  payments,
  exposures,
  outreach,
  caseMessages,
  senderIdentities,
  appendCaseEvent,
} from "@riko/db";
import { decryptSecret } from "@riko/core";
import { getTransporterForSmtpConfig } from "@riko/worker/mailer";
import { requireTenant } from "../middleware/require-tenant.js";

export const escalationsRouter = Router();

const resolveSchema = z.object({
  action: z.enum(["approve_send", "close_unrecoverable", "return_to_queue"]),
  note: z.string().max(1000).optional(),
});

const caseIdSchema = z.object({ caseId: z.string().uuid() });

const HANDOFF_ELIGIBLE_STATES = ["NEW", "DRAFTING", "SENDING", "WAITING", "PROMISED"] as const;

const replySchema = z.object({
  body: z.string().min(1).max(20_000),
  subject: z.string().max(500).optional(),
});

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return key;
}

escalationsRouter.get("/escalations", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;

  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: cases.id,
        state: cases.state,
        openedAt: cases.openedAt,
        closedReason: cases.closedReason,
        attemptCount: cases.attemptCount,
        intervention: cases.intervention,
        interventionReason: cases.interventionReason,
        customerName: customers.name,
        amountMinor: exposures.amountMinor,
        currency: exposures.currency,
        failureCategory: payments.failureCategory,
        failureCode: payments.failureCode,
      })
      .from(cases)
      .innerJoin(customers, eq(customers.id, cases.customerId))
      .innerJoin(exposures, eq(exposures.id, cases.exposureId))
      .leftJoin(payments, eq(payments.id, exposures.paymentId))
      .where(and(eq(cases.tenantId, tenantId), eq(cases.state, "ESCALATED"), ne(cases.arm, "holdout")))
      .orderBy(desc(exposures.amountMinor)),
  );

  const totalMinor = rows.reduce((sum, r) => sum + r.amountMinor, 0);
  res.json({ escalations: rows, totalMinor, currency: rows[0]?.currency ?? "inr" });
});

escalationsRouter.post("/escalations/:caseId/resolve", requireTenant, async (req, res) => {
  const { caseId } = caseIdSchema.parse(req.params);
  const body = resolveSchema.parse(req.body);
  const tenantId = req.tenant!.tenantId;

  const result = await withTenant(db, tenantId, async (tx) => {
    const [caseRow] = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId), eq(cases.state, "ESCALATED")))
      .limit(1);

    if (!caseRow) return { ok: false as const, reason: "not_escalated" };

    if (body.action === "approve_send") {
      const [pending] = await tx
        .select({ id: outreach.id })
        .from(outreach)
        .where(eq(outreach.caseId, caseId))
        .orderBy(desc(outreach.id))
        .limit(1);

      if (!pending) return { ok: false as const, reason: "no_draft_to_send" };

      await tx.update(cases).set({ state: "SENDING", closedAt: null, closedReason: null }).where(eq(cases.id, caseId));
      await appendCaseEvent(tx, {
        tenantId,
        caseId,
        fromState: "ESCALATED",
        toState: "SENDING",
        reason: body.note ? `approved_by_merchant: ${body.note}` : "approved_by_merchant",
        actor: "merchant",
      });
      return { ok: true as const, state: "SENDING" };
    }

    if (body.action === "close_unrecoverable") {
      await tx
        .update(cases)
        .set({ state: "LOST", closedAt: new Date(), closedReason: "closed_by_merchant" })
        .where(eq(cases.id, caseId));
      await appendCaseEvent(tx, {
        tenantId,
        caseId,
        fromState: "ESCALATED",
        toState: "LOST",
        reason: body.note ? `closed_by_merchant: ${body.note}` : "closed_by_merchant",
        actor: "merchant",
      });
      return { ok: true as const, state: "LOST" };
    }

    await tx
      .update(cases)
      .set({ state: "NEW", closedAt: null, closedReason: null, nextActionAt: null, humanReviewedAt: new Date() })
      .where(eq(cases.id, caseId));
    await appendCaseEvent(tx, {
      tenantId,
      caseId,
      fromState: "ESCALATED",
      toState: "NEW",
      reason: body.note ? `returned_by_merchant: ${body.note}` : "returned_by_merchant",
      actor: "merchant",
    });
    return { ok: true as const, state: "NEW" };
  });

  if (!result.ok) {
    res.status(409).json({ error: result.reason });
    return;
  }
  res.json(result);
});

// A person takes the case off Riko's queue so they can write to the customer
// directly. No canned action fits every situation, so this exists alongside
// the resolve actions above rather than replacing them.
escalationsRouter.post("/cases/:caseId/hand-off", requireTenant, async (req, res) => {
  const { caseId } = caseIdSchema.parse(req.params);
  const tenantId = req.tenant!.tenantId;

  const result = await withTenant(db, tenantId, async (tx) => {
    const [caseRow] = await tx
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.id, caseId),
          eq(cases.tenantId, tenantId),
          inArray(cases.state, [...HANDOFF_ELIGIBLE_STATES]),
        ),
      )
      .limit(1);

    if (!caseRow) return { ok: false as const, reason: "not_handoffable" };

    await tx
      .update(cases)
      .set({ state: "ESCALATED", closedAt: null, closedReason: null, humanReviewedAt: new Date() })
      .where(eq(cases.id, caseId));

    await appendCaseEvent(tx, {
      tenantId,
      caseId,
      fromState: caseRow.state,
      toState: "ESCALATED",
      reason: "handed_off_by_merchant",
      actor: "merchant",
    });

    return { ok: true as const, state: "ESCALATED" };
  });

  if (!result.ok) {
    res.status(409).json({ error: result.reason });
    return;
  }
  res.json(result);
});

// Only once a case has been handed off: the person composes the message
// themselves and Riko just delivers it, same as any other outbound turn.
escalationsRouter.post("/cases/:caseId/reply", requireTenant, async (req, res) => {
  const { caseId } = caseIdSchema.parse(req.params);
  const body = replySchema.parse(req.body);
  const tenantId = req.tenant!.tenantId;
  const key = requireEncryptionKey();

  const [caseRow] = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.tenantId, tenantId), eq(cases.state, "ESCALATED")))
      .limit(1),
  );

  if (!caseRow) {
    res.status(409).json({ error: "not_escalated" });
    return;
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, caseRow.customerId)).limit(1);
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.tenantId, tenantId))
    .limit(1);

  if (!customer || !sender?.smtpHost || !sender.smtpPort || !sender.smtpUser || !sender.smtpPasswordEncrypted) {
    res.status(409).json({ error: "sender_not_configured" });
    return;
  }

  const [lastMessage] = await db
    .select()
    .from(caseMessages)
    .where(eq(caseMessages.caseId, caseId))
    .orderBy(desc(caseMessages.seq))
    .limit(1);

  const subject = body.subject?.trim() || (lastMessage?.subject ? `Re: ${lastMessage.subject}` : "Re: your payment");

  const info = await getTransporterForSmtpConfig({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    user: sender.smtpUser,
    password: decryptSecret(sender.smtpPasswordEncrypted, key),
  }).sendMail({
    from: `${sender.fromName} <${sender.fromEmail}>`,
    replyTo: sender.replyTo ?? undefined,
    to: decryptSecret(customer.emailEncrypted, key),
    subject,
    text: body.body,
    ...(lastMessage?.providerMessageId ? { inReplyTo: lastMessage.providerMessageId } : {}),
  });

  const nextSeq = (lastMessage?.seq ?? -1) + 1;

  await db.transaction(async (tx) => {
    await tx.insert(caseMessages).values({
      tenantId,
      caseId,
      direction: "outbound",
      body: body.body,
      subject,
      providerMessageId: info.messageId,
      seq: nextSeq,
    });

    await appendCaseEvent(tx, {
      tenantId,
      caseId,
      fromState: "ESCALATED",
      toState: "ESCALATED",
      reason: "merchant_replied",
      actor: "merchant",
    });
  });

  res.status(201).json({ ok: true });
});
