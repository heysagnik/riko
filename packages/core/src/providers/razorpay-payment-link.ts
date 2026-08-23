const RAZORPAY_API = "https://api.razorpay.com/v1";

export interface RazorpayPaymentLinkInput {
  keyId: string;
  keySecret: string;
  amountMinor: number;
  currency: string;
  description: string;
  customerName: string | null;
  customerEmail: string;
  customerContact: string | null;
  notes: Record<string, string>;
}

export interface RazorpayPaymentLink {
  id: string;
  shortUrl: string;
}

/**
 * Creates a Razorpay-hosted payment link, keeping card data out of this app.
 * Razorpay's own notifications stay off so we don't double-contact the customer.
 */
export async function createRazorpayPaymentLink(
  input: RazorpayPaymentLinkInput,
): Promise<RazorpayPaymentLink> {
  const auth = Buffer.from(`${input.keyId}:${input.keySecret}`).toString("base64");

  const response = await fetch(`${RAZORPAY_API}/payment_links`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency.toUpperCase(),
      accept_partial: false,
      description: input.description,
      customer: {
        name: input.customerName ?? undefined,
        email: input.customerEmail,
        contact: input.customerContact ?? undefined,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: input.notes,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Razorpay payment link creation failed (${response.status}): ${detail}`);
  }

  const body = (await response.json()) as { id?: string; short_url?: string };
  if (!body.id || !body.short_url) {
    throw new Error("Razorpay payment link response missing id or short_url");
  }

  return { id: body.id, shortUrl: body.short_url };
}
