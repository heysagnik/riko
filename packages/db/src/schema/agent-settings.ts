import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";

export const agentSettings = pgTable("agent_settings", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
