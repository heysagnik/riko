import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface SenderIdentity {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPasswordSet: boolean;
  brandTemplateHtml: string | null;
}

export interface SenderIdentityInput {
  fromName: string;
  fromEmail: string;
  replyTo?: string | undefined;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword?: string | undefined;
  brandTemplateHtml?: string | undefined;
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
