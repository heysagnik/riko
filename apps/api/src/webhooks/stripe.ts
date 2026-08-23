import { Router } from "express";
import express from "express";
import { eq, and } from "drizzle-orm";
import { StripeAdapter, decryptSecret } from "@riko/core";
import { db, connections } from "@riko/db";
import { handleProviderWebhook } from "./handle-provider-webhook.js";

export const stripeWebhookRouter = Router();

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return key;
}

stripeWebhookRouter.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const provider = new StripeAdapter({ clientId: "", clientSecret: "", apiKey: "" });

  try {
    const encryptionKey = requireEncryptionKey();

    const activeConnections = await db
      .select()
      .from(connections)
      .where(and(eq(connections.providerId, "stripe"), eq(connections.status, "active")));

    const candidates = activeConnections.map((connection) => ({
      connectionId: connection.id,
      tenantId: connection.tenantId,
      secret: decryptSecret(connection.webhookSecretEncrypted, encryptionKey),
    }));

    const result = await handleProviderWebhook({
      db,
      provider,
      rawBody: req.body as Buffer,
      headers: req.headers,
      candidates,
      encryptionKey,
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid webhook" });
  }
});
