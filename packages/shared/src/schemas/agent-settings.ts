import { z } from "zod";

export const agentLanguagePreference = z.enum(["customer_choice", "english", "hinglish"]);
export const agentTone = z.enum(["friendly", "neutral", "formal"]);
export const agentPersistence = z.enum(["gentle", "balanced", "firm"]);

export const agentSettingsInputSchema = z.object({
  maxAttempts: z.coerce.number().int().min(1).max(6),
  cooldownHours: z.coerce.number().int().min(1).max(168),
  contactWindowStartHour: z.coerce.number().int().min(0).max(23),
  contactWindowEndHour: z.coerce.number().int().min(1).max(24),
  firstEmailWithinWindow: z.boolean(),
  maxAgeDaysPaymentFailure: z.coerce.number().int().min(1).max(90),
  maxAgeDaysCheckoutAbandonment: z.coerce.number().int().min(1).max(60),
  maxAgeDaysOverdueReceivable: z.coerce.number().int().min(1).max(120),
  minAmountMinor: z.coerce.number().int().min(0).max(100_000_00),
  highValueThresholdMinor: z.coerce.number().int().min(0).max(10_000_000_00),
  holdoutPercent: z.coerce.number().int().min(0).max(50),
  defaultLanguage: agentLanguagePreference,
  tone: agentTone,
  persistence: agentPersistence,
  additionalInstructions: z.string().max(2000),
});

export const agentSettingsSchema = agentSettingsInputSchema.partial();

export type AgentSettingsInput = z.infer<typeof agentSettingsInputSchema>;
export type AgentSettingsPatch = z.infer<typeof agentSettingsSchema>;
export type AgentLanguagePreference = z.infer<typeof agentLanguagePreference>;
export type AgentTone = z.infer<typeof agentTone>;
export type AgentPersistence = z.infer<typeof agentPersistence>;

export const AGENT_SETTINGS_DEFAULTS: AgentSettingsInput = {
  maxAttempts: 3,
  cooldownHours: 48,
  contactWindowStartHour: 7,
  contactWindowEndHour: 23,
  firstEmailWithinWindow: false,
  maxAgeDaysPaymentFailure: 21,
  maxAgeDaysCheckoutAbandonment: 7,
  maxAgeDaysOverdueReceivable: 30,
  minAmountMinor: 0,
  highValueThresholdMinor: 2_500_00,
  holdoutPercent: 5,
  defaultLanguage: "customer_choice",
  tone: "friendly",
  persistence: "balanced",
  additionalInstructions: "",
};

export function resolveAgentSettings(patch: AgentSettingsPatch | null | undefined): AgentSettingsInput {
  const resolved: Record<string, unknown> = { ...AGENT_SETTINGS_DEFAULTS };
  if (patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        resolved[key] = value;
      }
    }
  }
  return resolved as AgentSettingsInput;
}
