import { apiRequest } from "./client.js";

export type PaymentKind = "deposit" | "withdraw";
export type PaymentStatus = "pending" | "accepted" | "rejected" | "cancelled";

export interface PaymentRequest {
  id: string;
  kind: PaymentKind;
  status: PaymentStatus;
  userId: string;
  username?: string;
  email?: string;
  hallId?: string;
  hallName?: string;
  agentName?: string;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt?: string;
}

interface ListResponse {
  requests: PaymentRequest[];
}

export async function listPendingRequests(opts: {
  kind?: PaymentKind;
  hallId?: string;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<PaymentRequest[]> {
  const params = new URLSearchParams();
  params.set("status", "pending");
  if (opts.kind) params.set("type", opts.kind);
  if (opts.hallId) params.set("hallId", opts.hallId);
  if (opts.limit) params.set("limit", String(opts.limit));
  const data = await apiRequest<ListResponse>(
    `/api/admin/payments/requests?${params.toString()}`,
    { auth: true, ...(opts.signal ? { signal: opts.signal } : {}) }
  );
  return data.requests;
}

export async function countPending(opts: { kind?: PaymentKind; hallId?: string } = {}): Promise<number> {
  const rows = await listPendingRequests({ ...opts, limit: 500 });
  return rows.length;
}
