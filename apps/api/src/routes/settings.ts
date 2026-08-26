import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, withTenant, senderIdentities, agentSettings } from "@riko/db";
import { encryptSecret, validateBrandTemplate } from "@riko/core";
import {
  senderIdentityUpsertSchema,
  outreachSettingsPatchSchema,
  agentSettingsInputSchema,
  agentSettingsSchema,
  resolveAgentSettings,
} from "@riko/shared";
import { requireTenant } from "../middleware/require-tenant.js";

export const settingsRouter = Router();

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return key;
}

settingsRouter.get("/settings/agent", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;

  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(agentSettings).where(eq(agentSettings.tenantId, tenantId)).limit(1),
  );

  const patch = agentSettingsSchema.parse(row?.config ?? {});
  res.json({ agentSettings: resolveAgentSettings(patch) });
});

settingsRouter.put("/settings/agent", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const body = agentSettingsInputSchema.parse(req.body);

  const values = { tenantId, config: body, updatedAt: new Date() };
  await withTenant(db, tenantId, (tx) =>
    tx.insert(agentSettings).values(values).onConflictDoUpdate({ target: agentSettings.tenantId, set: values }),
  );

  res.json({ ok: true });
});

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
      phone: identity.phone,
      replyTo: identity.replyTo,
      smtpHost: identity.smtpHost,
      smtpPort: identity.smtpPort,
      smtpSecure: identity.smtpSecure,
      smtpUser: identity.smtpUser,
      smtpPasswordSet: Boolean(identity.smtpPasswordEncrypted),
      brandTemplateHtml: identity.brandTemplateHtml,
      addressLine: identity.addressLine,
      alertWebhookUrl: identity.alertWebhookUrl,
      outreachPaused: identity.outreachPaused,
      dailySendCap: identity.dailySendCap,
    },
  });
});

settingsRouter.patch("/settings/outreach", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const body = outreachSettingsPatchSchema.parse(req.body);

  const [existing] = await withTenant(db, tenantId, (tx) =>
    tx.select({ id: senderIdentities.id }).from(senderIdentities).where(eq(senderIdentities.tenantId, tenantId)).limit(1),
  );

  if (!existing) {
    res.status(409).json({ error: "configure_sending_first" });
    return;
  }

  await withTenant(db, tenantId, (tx) =>
    tx
      .update(senderIdentities)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(senderIdentities.tenantId, tenantId)),
  );

  res.json({ ok: true });
});

settingsRouter.put("/settings/sender-identity", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const body = senderIdentityUpsertSchema.parse(req.body);

  const [existing] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(senderIdentities).where(eq(senderIdentities.tenantId, tenantId)).limit(1),
  );

  const wantsSmtp = body.smtpHost !== undefined || body.smtpUser !== undefined || body.smtpPassword !== undefined;
  if (wantsSmtp && (!body.smtpHost || !body.smtpUser || (!body.smtpPassword && !existing?.smtpPasswordEncrypted))) {
    res.status(400).json({ error: "SMTP host, username, and password are required to configure sending" });
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
    : (existing?.smtpPasswordEncrypted ?? null);

  const values = {
    tenantId,
    fromName: body.fromName,
    fromEmail: body.fromEmail,
    phone: body.phone || null,
    replyTo: body.replyTo || null,
    smtpHost: body.smtpHost ?? existing?.smtpHost ?? null,
    smtpPort: body.smtpPort ?? existing?.smtpPort ?? null,
    smtpSecure: body.smtpSecure ?? existing?.smtpSecure ?? false,
    smtpUser: body.smtpUser ?? existing?.smtpUser ?? null,
    smtpPasswordEncrypted,
    brandTemplateHtml: body.brandTemplateHtml || null,
    addressLine: body.addressLine || null,
    alertWebhookUrl: body.alertWebhookUrl || null,
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
