import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";
import { providerIdEnum } from "./connections.js";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    providerId: providerIdEnum("provider_id").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    emailEncrypted: text("email_encrypted").notNull(),
    phoneEncrypted: text("phone_encrypted"),
    name: text("name"),
    locale: text("locale"),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    // Distinct from unsubscribe: a person decided we must not contact this
    // customer, for a reason the customer never asked us to record.
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    suppressionReason: text("suppression_reason"),
    timezone: text("timezone"),
  },
  (table) => [
    uniqueIndex("customers_tenant_provider_uidx").on(
      table.tenantId,
      table.providerId,
      table.providerCustomerId,
    ),
  ],
);
