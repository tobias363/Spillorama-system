// PR-A4b (BIN-659) + K1 — admin-settlement API wrappers.
//
// Thin, typed wrappers around the 4 agent-settlement admin endpoints:
//   - GET  /api/admin/shifts/settlements                 (list + filters)
//   - GET  /api/admin/shifts/:shiftId/settlement         (view one)
//   - PUT  /api/admin/shifts/:shiftId/settlement         (admin edit, K1: +breakdown/bilag)
//   - POST /api/agent/settlements/:settlementId/receipt  (K1: upload bilag)
// PDF is fetched directly via `window.open()` — see buildSettlementPdfUrl()
// for the URL helper used by SettlementPage.
//
// Backend references:
//   apps/backend/src/routes/agentSettlement.ts:239 (list), :261 (get),
//   :279 (pdf), :314 (edit), POST /receipt (K1)
//   apps/backend/src/agent/AgentSettlementStore.ts:11 (AgentSettlement type)
//   apps/backend/src/agent/MachineBreakdownTypes.ts (K1: wire shapes)

import { apiRequest } from "./client.js";

// ── K1: machine-breakdown wire shapes (mirror backend/agent/MachineBreakdownTypes.ts) ──

export type MachineRowKey =
  | "metronia"
  | "ok_bingo"
  | "franco"
  | "otium"
  | "norsk_tipping_dag"
  | "norsk_tipping_totall"
  | "rikstoto_dag"
  | "rikstoto_totall"
  | "rekvisita"
  | "servering"
  | "bilag"
  | "bank"
  | "gevinst_overfoering_bank"
  | "annet";

export const MACHINE_ROW_KEYS: readonly MachineRowKey[] = [
  "metronia", "ok_bingo", "franco", "otium",
  "norsk_tipping_dag", "norsk_tipping_totall",
  "rikstoto_dag", "rikstoto_totall",
  "rekvisita", "servering", "bilag", "bank",
  "gevinst_overfoering_bank", "annet",
] as const;

export interface MachineRow {
  in_cents: number;
  out_cents: number;
}

export interface MachineBreakdown {
  rows: Partial<Record<MachineRowKey, MachineRow>>;
  ending_opptall_kassie_cents: number;
  innskudd_drop_safe_cents: number;
  difference_in_shifts_cents: number;
}

export interface BilagReceipt {
  mime: "application/pdf" | "image/jpeg" | "image/png";
  filename: string;
  dataUrl: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByUserId: string;
}

export const MAX_BILAG_BYTES = 10 * 1024 * 1024;

// ── Settlement wire-shape (mirrors backend/agent/AgentSettlementStore) ──────

export interface AdminSettlement {
  id: string;
  shiftId: string;
  agentUserId: string;
  hallId: string;
  businessDate: string;
  dailyBalanceAtStart: number;
  dailyBalanceAtEnd: number;
  reportedCashCount: number;
  dailyBalanceDifference: number;
  settlementToDropSafe: number;
  withdrawFromTotalBalance: number;
  totalDropSafe: number;
  shiftCashInTotal: number;
  shiftCashOutTotal: number;
  shiftCardInTotal: number;
  shiftCardOutTotal: number;
  settlementNote: string | null;
  closedByUserId: string;
  isForced: boolean;
  editedByUserId: string | null;
  editedAt: string | null;
  editReason: string | null;
  otherData: Record<string, unknown>;
  machineBreakdown: MachineBreakdown;
  bilagReceipt: BilagReceipt | null;
  createdAt: string;
  updatedAt: string;
}

// ── GET /api/admin/shifts/settlements ───────────────────────────────────────

export interface ListSettlementsQuery {
  hallId?: string;
  agentUserId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface ListSettlementsResponse {
  settlements: AdminSettlement[];
  limit: number;
  offset: number;
}

export async function listSettlements(q: ListSettlementsQuery = {}): Promise<ListSettlementsResponse> {
  const qs = buildQs(q);
  const path = qs ? `/api/admin/shifts/settlements?${qs}` : "/api/admin/shifts/settlements";
  return apiRequest<ListSettlementsResponse>(path, { auth: true });
}

// ── GET /api/admin/shifts/:shiftId/settlement ───────────────────────────────

export async function getSettlement(shiftId: string): Promise<AdminSettlement> {
  return apiRequest<AdminSettlement>(
    `/api/admin/shifts/${encodeURIComponent(shiftId)}/settlement`,
    { auth: true }
  );
}

// ── PUT /api/admin/shifts/:shiftId/settlement ───────────────────────────────

export interface EditSettlementBody {
  reason: string;
  reportedCashCount?: number;
  settlementToDropSafe?: number;
  withdrawFromTotalBalance?: number;
  totalDropSafe?: number;
  settlementNote?: string | null;
  otherData?: Record<string, unknown>;
  /** K1: admin kan oppdatere 15-rad breakdown. */
  machineBreakdown?: MachineBreakdown;
  /** K1: null = nullstill bilag. */
  bilagReceipt?: BilagReceipt | null;
}

export async function editSettlement(shiftId: string, body: EditSettlementBody): Promise<AdminSettlement> {
  return apiRequest<AdminSettlement>(
    `/api/admin/shifts/${encodeURIComponent(shiftId)}/settlement`,
    { auth: true, method: "PUT", body }
  );
}

// ── K1: POST /api/agent/settlements/:settlementId/receipt ──────────────────

export async function uploadBilagReceipt(
  settlementId: string,
  receipt: BilagReceipt,
  reason?: string
): Promise<AdminSettlement> {
  return apiRequest<AdminSettlement>(
    `/api/agent/settlements/${encodeURIComponent(settlementId)}/receipt`,
    { auth: true, method: "POST", body: { receipt, reason } }
  );
}

// ── PDF URL helper ──────────────────────────────────────────────────────────
// Settlement PDF is delivered as a direct stream via
// `/api/admin/shifts/:shiftId/settlement.pdf`. Use window.open() on this URL;
// the browser handles the download dialog.

export function buildSettlementPdfUrl(shiftId: string): string {
  return `/api/admin/shifts/${encodeURIComponent(shiftId)}/settlement.pdf`;
}

// ── Bilag-receipt URL helper (Wireframe Gap #2) ─────────────────────────────
// Bilag downloadet som binær-stream (mime speiler opplastet fil).
// Backend: apps/backend/src/routes/agentSettlement.ts
//   GET /api/admin/shifts/:shiftId/settlement/receipt

export function buildSettlementReceiptUrl(shiftId: string): string {
  return `/api/admin/shifts/${encodeURIComponent(shiftId)}/settlement/receipt`;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function buildQs(obj: object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    qs.set(k, String(v));
  }
  return qs.toString();
}
