import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface AgentSettings {
  maxAttempts: number;
  cooldownHours: number;
  contactWindowStartHour: number;
  contactWindowEndHour: number;
  firstEmailWithinWindow: boolean;
  maxAgeDaysPaymentFailure: number;
  maxAgeDaysCheckoutAbandonment: number;
  maxAgeDaysOverdueReceivable: number;
  minAmountMinor: number;
  highValueThresholdMinor: number;
  holdoutPercent: number;
  defaultLanguage: "customer_choice" | "english" | "hinglish";
  tone: "friendly" | "neutral" | "formal";
  persistence: "gentle" | "balanced" | "firm";
  additionalInstructions: string;
}

async function fetchAgentSettings(): Promise<{ agentSettings: AgentSettings }> {
  const response = await fetch("/api/settings/agent");
  if (!response.ok) {
    throw new Error(`Failed to load agent settings: ${response.status}`);
  }
  return response.json();
}

export function useAgentSettings() {
  return useQuery({ queryKey: ["settings", "agent"], queryFn: fetchAgentSettings });
}

export function useSaveAgentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AgentSettings) => {
      const response = await fetch("/api/settings/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error((body as { error?: string } | null)?.error ?? `Failed to save agent settings: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "agent"] });
      void queryClient.invalidateQueries({ queryKey: ["policy"] });
    },
  });
}
