import { pgTable, text, timestamp, uuid, pgEnum, jsonb, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";

export const providerIdEnum = pgEnum("provider_id", ["razorpay"]);
export const connectionStatusEnum = pgEnum("connection_status", ["active", "expired", "error"]);

export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  providerId: providerIdEnum("provider_id").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  status: connectionStatusEnum("status").notNull().default("active"),
  webhookSecretEncrypted: text("webhook_secret_encrypted").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const senderIdentities = pgTable(
  "sender_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name").notNull(),
    replyTo: text("reply_to"),
    domainVerified: boolean("domain_verified").notNull().default(false),
    providerDomainId: text("provider_domain_id"),
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port"),
    smtpSecure: boolean("smtp_secure").notNull().default(false),
    smtpUser: text("smtp_user"),
    smtpPasswordEncrypted: text("smtp_password_encrypted"),
    brandTemplateHtml: text("brand_template_html"),
    addressLine: text("address_line"),
    outreachPaused: boolean("outreach_paused").notNull().default(false),
    dailySendCap: integer("daily_send_cap").notNull().default(500),
    alertWebhookUrl: text("alert_webhook_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sender_identities_tenant_uidx").on(table.tenantId)],
);
