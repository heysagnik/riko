import { z } from "zod";

export const stripeWebhookHeadersSchema = z.object({
  "stripe-signature": z.string().min(1),
});

export const providerIdSchema = z.enum(["stripe", "razorpay"]);

export const razorpayWebhookHeadersSchema = z.object({
  "x-razorpay-signature": z.string().min(1),
});

export const razorpayConnectionCreateSchema = z.object({
  keyId: z.string().min(1).max(255),
  keySecret: z.string().min(1).max(500),
  webhookSecret: z.string().min(1).max(500),
});

export const stripeConnectionCreateSchema = z.object({
  apiKey: z.string().min(1).max(500),
  webhookSecret: z.string().min(1).max(500),
});
