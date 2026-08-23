import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, withTenant, senderIdentities } from "@riko/db";
import { encryptSecret, validateBrandTemplate } from "@riko/core";
import { senderIdentityUpsertSchema } from "@riko/shared";
import { requireTenant } from "../middleware/require-tenant.js";

export const settingsRouter = Router();

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return key;
}

settingsRouter.get("/settings/sender-identity", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;

  const [identity] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(senderIdentities).where(eq(senderIdentities.tenantId, tenantId)).limit(1),
  );

  if (!identity) {
    res.json({ senderIdentity: null });
    return;
  }

  res.json({
    senderIdentity: {
      fromName: identity.fromName,
      fromEmail: identity.fromEmail,
      replyTo: identity.replyTo,
      smtpHost: identity.smtpHost,
      smtpPort: identity.smtpPort,
      smtpSecure: identity.smtpSecure,
      smtpUser: identity.smtpUser,
      smtpPasswordSet: Boolean(identity.smtpPasswordEncrypted),
      brandTemplateHtml: identity.brandTemplateHtml,
    },
  });
});

settingsRouter.put("/settings/sender-identity", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const body = senderIdentityUpsertSchema.parse(req.body);

  const [existing] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(senderIdentities).where(eq(senderIdentities.tenantId, tenantId)).limit(1),
  );

  if (!body.smtpPassword && !existing?.smtpPasswordEncrypted) {
    res.status(400).json({ error: "smtpPassword is required the first time you configure sending" });
    return;
  }

  if (body.brandTemplateHtml) {
    const templateCheck = validateBrandTemplate(body.brandTemplateHtml);
    if (!templateCheck.valid) {
      res.status(400).json({ error: templateCheck.errors.join(" ") });
      return;
    }
  }

  const smtpPasswordEncrypted = body.smtpPassword
    ? encryptSecret(body.smtpPassword, requireEncryptionKey())
    : existing!.smtpPasswordEncrypted;

  const values = {
    tenantId,
    fromName: body.fromName,
    fromEmail: body.fromEmail,
    replyTo: body.replyTo || null,
    smtpHost: body.smtpHost,
    smtpPort: body.smtpPort,
    smtpSecure: body.smtpSecure,
    smtpUser: body.smtpUser,
    smtpPasswordEncrypted,
    brandTemplateHtml: body.brandTemplateHtml || null,
    updatedAt: new Date(),
  };

  await withTenant(db, tenantId, (tx) =>
    tx
      .insert(senderIdentities)
      .values(values)
      .onConflictDoUpdate({ target: senderIdentities.tenantId, set: values }),
  );

  res.json({ ok: true });
});
