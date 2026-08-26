import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface SenderIdentity {
  fromName: string;
  fromEmail: string;
  phone: string | null;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPasswordSet: boolean;
  brandTemplateHtml: string | null;
  addressLine: string | null;
  alertWebhookUrl: string | null;
  outreachPaused: boolean;
  dailySendCap: number;
}

export interface SenderIdentityInput {
  fromName: string;
  fromEmail: string;
  phone?: string | undefined;
  replyTo?: string | undefined;
  smtpHost?: string | undefined;
  smtpPort?: number | undefined;
  smtpSecure?: boolean | undefined;
  smtpUser?: string | undefined;
  smtpPassword?: string | undefined;
  brandTemplateHtml?: string | undefined;
  addressLine?: string | undefined;
  alertWebhookUrl?: string | undefined;
}

async function fetchSenderIdentity(): Promise<{ senderIdentity: SenderIdentity | null }> {
  const response = await fetch("/api/settings/sender-identity");
  if (!response.ok) {
    throw new Error(`Failed to load sender identity: ${response.status}`);
  }
  return response.json();
}

export function useSenderIdentity() {
  return useQuery({ queryKey: ["settings", "sender-identity"], queryFn: fetchSenderIdentity });
}

export function useSaveSenderIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SenderIdentityInput) => {
      const response = await fetch("/api/settings/sender-identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to save sender identity: ${response.status}`);
      }
      return response.json() as Promise<{ ok: true }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "sender-identity"] });
    },
  });
}
