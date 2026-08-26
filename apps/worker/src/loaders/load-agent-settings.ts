import { eq } from "drizzle-orm";
import { db, agentSettings } from "@riko/db";
import { agentSettingsSchema, resolveAgentSettings, type AgentSettingsInput } from "@riko/shared";

export async function loadAgentSettings(tenantId: string): Promise<AgentSettingsInput> {
  const [row] = await db
    .select({ config: agentSettings.config })
    .from(agentSettings)
    .where(eq(agentSettings.tenantId, tenantId))
    .limit(1);
  return resolveAgentSettings(agentSettingsSchema.parse(row?.config ?? {}));
}
