import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaseDetail } from "./use-case-detail.js";

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
    onMutate: async ({ caseId, action }) => {
      await queryClient.cancelQueries({ queryKey: ["cases", caseId] });
      const previousCaseDetail = queryClient.getQueryData<CaseDetail>(["cases", caseId]);

      if (previousCaseDetail) {
        const now = new Date().toISOString();
        const nextState = action === "approve_send" ? "SENDING" : action === "close_unrecoverable" ? "LOST" : "NEW";
        const reason = action === "approve_send" ? "approved_by_merchant" : action === "close_unrecoverable" ? "closed_by_merchant" : "returned_by_merchant";

        queryClient.setQueryData<CaseDetail>(["cases", caseId], {
          ...previousCaseDetail,
          case: {
            ...previousCaseDetail.case,
            state: nextState,
            closedAt: nextState === "LOST" ? now : null,
            closedReason: nextState === "LOST" ? reason : null,
          },
          events: [
            ...previousCaseDetail.events,
            {
              id: `temp-${Date.now()}`,
              fromState: previousCaseDetail.case.state,
              toState: nextState,
              reason,
              actor: "merchant",
              createdAt: now,
            },
          ],
        });
      }

      return { previousCaseDetail };
    },
    onError: (_err, { caseId }, context) => {
      if (context?.previousCaseDetail) {
        queryClient.setQueryData(["cases", caseId], context.previousCaseDetail);
      }
    },
    onSettled: (_data, _error, { caseId }) => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
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
    onMutate: async (caseId: string) => {
      await queryClient.cancelQueries({ queryKey: ["cases", caseId] });
      const previousCaseDetail = queryClient.getQueryData<CaseDetail>(["cases", caseId]);

      if (previousCaseDetail) {
        const now = new Date().toISOString();
        queryClient.setQueryData<CaseDetail>(["cases", caseId], {
          ...previousCaseDetail,
          case: {
            ...previousCaseDetail.case,
            state: "ESCALATED",
            closedAt: null,
            closedReason: null,
          },
          events: [
            ...previousCaseDetail.events,
            {
              id: `temp-${Date.now()}`,
              fromState: previousCaseDetail.case.state,
              toState: "ESCALATED",
              reason: "handed_off_by_merchant",
              actor: "merchant",
              createdAt: now,
            },
          ],
        });
      }

      return { previousCaseDetail };
    },
    onError: (_err, caseId, context) => {
      if (context?.previousCaseDetail) {
        queryClient.setQueryData(["cases", caseId], context.previousCaseDetail);
      }
    },
    onSettled: (_data, _error, caseId) => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useCloseCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (caseId: string) => {
      const response = await fetch(`/api/cases/${caseId}/close`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to close case: ${response.status}`);
      }
      return response.json() as Promise<{ ok: true; state: string }>;
    },
    onMutate: async (caseId: string) => {
      await queryClient.cancelQueries({ queryKey: ["cases", caseId] });
      const previousCaseDetail = queryClient.getQueryData<CaseDetail>(["cases", caseId]);

      if (previousCaseDetail) {
        const now = new Date().toISOString();
        queryClient.setQueryData<CaseDetail>(["cases", caseId], {
          ...previousCaseDetail,
          case: {
            ...previousCaseDetail.case,
            state: "LOST",
            closedAt: now,
            closedReason: "closed_by_merchant",
          },
          events: [
            ...previousCaseDetail.events,
            {
              id: `temp-${Date.now()}`,
              fromState: previousCaseDetail.case.state,
              toState: "LOST",
              reason: "closed_by_merchant",
              actor: "merchant",
              createdAt: now,
            },
          ],
        });
      }

      return { previousCaseDetail };
    },
    onError: (_err, caseId, context) => {
      if (context?.previousCaseDetail) {
        queryClient.setQueryData(["cases", caseId], context.previousCaseDetail);
      }
    },
    onSettled: (_data, _error, caseId) => {
      queryClient.invalidateQueries({ queryKey: ["cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["metrics"] });
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
