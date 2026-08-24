import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface OutreachSettingsPatch {
  outreachPaused?: boolean;
  dailySendCap?: number;
  addressLine?: string;
}

async function patchOutreachSettings(input: OutreachSettingsPatch): Promise<{ ok: true }> {
  const response = await fetch("/api/settings/outreach", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to save: ${response.status}`);
  }
  return response.json();
}

export function useSaveOutreachSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchOutreachSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "sender-identity"] });
      queryClient.invalidateQueries({ queryKey: ["policy"] });
    },
  });
}
