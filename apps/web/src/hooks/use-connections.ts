import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface Connection {
  id: string;
  providerId: string;
  providerAccountId?: string;
  status: string;
  connectedAt: string;
}

async function fetchConnections(): Promise<{ connections: Connection[] }> {
  const response = await fetch("/api/connections");
  if (!response.ok) {
    throw new Error(`Failed to load connections: ${response.status}`);
  }
  return response.json();
}

export function useConnections() {
  return useQuery({ queryKey: ["connections"], queryFn: fetchConnections });
}

export interface StripeConnectionInput {
  apiKey: string;
  webhookSecret: string;
}

export function useConnectStripe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StripeConnectionInput) => {
      const response = await fetch("/api/connections/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to connect Stripe: ${response.status}`);
      }
      return response.json() as Promise<{ connection: Connection }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export interface RazorpayConnectionInput {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export function useConnectRazorpay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RazorpayConnectionInput) => {
      const response = await fetch("/api/connections/razorpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to connect Razorpay: ${response.status}`);
      }
      return response.json() as Promise<{ connection: Connection }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}
