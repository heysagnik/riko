import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface Escalation {
  id: string;
  state: string;
  openedAt: string;
  closedReason: string | null;
  attemptCount: number;
  intervention: string | null;
  interventionReason: string | null;
  customerName: string | null;
  amountMinor: number;
  currency: string;
  failureCategory: string;
  failureCode: string | null;
}

export type ResolveAction = "approve_send" | "close_unrecoverable" | "return_to_queue";

async function fetchEscalations(): Promise<{ escalations: Escalation[]; totalMinor: number; currency: string }> {
  const response = await fetch("/api/escalations");
  if (!response.ok) {
    throw new Error(`Failed to load escalations: ${response.status}`);
  }
  return response.json();
}

export function useEscalations() {
  return useQuery({ queryKey: ["escalations"], queryFn: fetchEscalations });
}

export function useResolveEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, action }: { caseId: string; action: ResolveAction }) => {
      const response = await fetch(`/api/escalations/${caseId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to resolve: ${response.status}`);
      }
      return response.json() as Promise<{ ok: true; state: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["metrics"] });
    },
  });
}

export function useHandOffCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (caseId: string) => {
      const response = await fetch(`/api/cases/${caseId}/hand-off`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to hand off: ${response.status}`);
      }
      return response.json() as Promise<{ ok: true; state: string }>;
    },
    onSuccess: (_data, caseId) => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

export function useReplyToCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, body, subject }: { caseId: string; body: string; subject?: string }) => {
      const response = await fetch(`/api/cases/${caseId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, subject }),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? `Failed to send reply: ${response.status}`);
      }
      return response.json() as Promise<{ ok: true }>;
    },
    onSuccess: (_data, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
    },
  });
}
