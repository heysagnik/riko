import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, withTenant, connections } from "@riko/db";
import { encryptSecret, decryptSecret } from "@riko/core";
import { razorpayConnectionCreateSchema } from "@riko/shared";
import { requireTenant } from "../middleware/require-tenant.js";

export const connectionsRouter = Router();

function requireEncryptionKey(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return key;
}

connectionsRouter.get("/connections", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.select().from(connections).where(eq(connections.tenantId, tenantId)),
  );
  res.json({ connections: rows });
});

connectionsRouter.post("/connections/razorpay", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const body = razorpayConnectionCreateSchema.parse(req.body);
  const key = requireEncryptionKey();

  const values = {
    tenantId,
    providerId: "razorpay" as const,
    providerAccountId: body.keyId,
    accessTokenEncrypted: encryptSecret(body.keySecret, key),
    refreshTokenEncrypted: null,
    scopes: [],
    status: "active" as const,
    webhookSecretEncrypted: encryptSecret(body.webhookSecret, key),
  };

  const [inserted] = await withTenant(db, tenantId, (tx) => tx.insert(connections).values(values).returning());

  res.status(201).json({
    connection: {
      id: inserted!.id,
      providerId: inserted!.providerId,
      providerAccountId: inserted!.providerAccountId,
      status: inserted!.status,
    },
  });
});

connectionsRouter.get("/connections/:connectionId/webhook-secret", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const connectionId = req.params.connectionId;
  if (!connectionId) {
    res.status(400).json({ error: "Missing connectionId" });
    return;
  }
  const key = requireEncryptionKey();

  const [connection] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ webhookSecretEncrypted: connections.webhookSecretEncrypted })
      .from(connections)
      .where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)))
      .limit(1),
  );

  if (!connection) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  res.json({ webhookSecret: decryptSecret(connection.webhookSecretEncrypted, key) });
});

connectionsRouter.delete("/connections/:connectionId", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;
  const connectionId = req.params.connectionId;
  if (!connectionId) {
    res.status(400).json({ error: "Missing connectionId" });
    return;
  }
  await withTenant(db, tenantId, (tx) =>
    tx.delete(connections).where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId))),
  );
  res.status(204).send();
});
