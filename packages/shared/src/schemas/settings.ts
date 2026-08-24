import { z } from "zod";

export const senderIdentityUpsertSchema = z.object({
  fromName: z.string().min(1).max(200),
  fromEmail: z.string().email(),
  replyTo: z.string().email().optional().or(z.literal("")),
  smtpHost: z.string().min(1).max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().min(1).max(255),
  smtpPassword: z.string().min(1).max(500).optional(),
  brandTemplateHtml: z.string().max(50000).optional().or(z.literal("")),
  addressLine: z.string().max(300).optional().or(z.literal("")),
  alertWebhookUrl: z.string().url().max(500).optional().or(z.literal("")),
});

export const outreachSettingsPatchSchema = z
  .object({
    outreachPaused: z.boolean().optional(),
    dailySendCap: z.coerce.number().int().min(1).max(10_000).optional(),
    addressLine: z.string().max(300).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

