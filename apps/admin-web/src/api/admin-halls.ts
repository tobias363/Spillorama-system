// PR-A5 (BIN-663) — admin-halls API-wrappers.
//
// Dekker hall CRUD + permissions-introspeksjon. Backend-endpoints ligger
// i apps/backend/src/routes/admin.ts:
//   GET    /api/admin/halls                 (HALL_READ)
//   POST   /api/admin/halls                 (HALL_WRITE)
//   PUT    /api/admin/halls/:hallId         (HALL_WRITE)
//
// Legacy hadde hard delete + bulk-player-move; ny backend gjør soft
// disable via `isActive=false`. UI-siden (HallListPage) eksponerer
// toggle + info-tekst om at spiller-migrering må gjøres manuelt
// (PM-beslutning i PR-A5-plan §7.2 #3).
//
// GroupHall: full backend-gap — ingen CRUD-endpoints. Plassholder-sider
// i apps/admin-web/src/pages/groupHall/ (PR-A5-plan §2.2 G1, Linear BIN-665).

import { apiRequest } from "./client.js";

// ── Kjerne-typer (speiler backend PlatformService HallDefinition) ────────────

// Kun "web" er gyldig. Beholdt som type-alias så HallFormPage-dropdownen
// fortsatt type-sjekker; dropdownen viser bare én valgbar verdi.
export type HallClientVariant = "web";

export interface AdminHall {
  id: string;
  slug: string;
  name: string;
  region: string;
  address: string;
  organizationNumber?: string;
  settlementAccount?: string;
  invoiceMethod?: string;
  isActive: boolean;
  clientVariant: HallClientVariant;
  tvUrl?: string;
  /** Legacy Hall Number (101, 102, …). Null = ikke satt. */
  hallNumber?: number | null;
  /** Cash-balanse hallen disponerer (Available Balance). Default 0. */
  cashBalance?: number;
  /**
   * TV Screen public display token — auto-generert backend-side, unik per hall.
   * Brukes i TV-URL som bingoverten åpner på hall-skjermen:
   *   /admin/#/tv/<hallId>/<tvToken>
   * Optional for bakoverkompatibilitet med eldre test-fixtures; alltid satt av backend.
   */
  tvToken?: string;
  /**
   * TV-kiosk voice-pack valgt for denne hallen (wireframe PDF 14).
   * Default 'voice1' backend-side; optional i typen for bakoverkompat
   * med eldre fixtures som ikke setter feltet.
   */
  tvVoiceSelection?: "voice1" | "voice2" | "voice3";
  createdAt: string;
  updatedAt: string;
}

// ── Liste ────────────────────────────────────────────────────────────────────

export interface ListHallsParams {
  includeInactive?: boolean;
}

/**
 * Liste haller. Backend returnerer direkte array (ikke envelope),
 * men dashboard.ts-wrapper viser at noen instanser pakker inn `{ halls }`
 * — normaliser her for å være defensive.
 */
export async function listHalls(params: ListHallsParams = {}): Promise<AdminHall[]> {
  const qs = new URLSearchParams();
  if (params.includeInactive) qs.set("includeInactive", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const raw = await apiRequest<AdminHall[] | { halls: AdminHall[] }>(
    `/api/admin/halls${suffix}`,
    { auth: true }
  );
  if (Array.isArray(raw)) return raw;
  return raw.halls ?? [];
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateHallInput {
  slug: string;
  name: string;
  region?: string;
  address?: string;
  organizationNumber?: string;
  settlementAccount?: string;
  invoiceMethod?: string;
  isActive?: boolean;
  hallNumber?: number | null;
}

export function createHall(input: CreateHallInput): Promise<AdminHall> {
  return apiRequest<AdminHall>("/api/admin/halls", {
    method: "POST",
    body: input,
    auth: true,
  });
}

export interface UpdateHallInput {
  slug?: string;
  name?: string;
  region?: string;
  address?: string;
  organizationNumber?: string;
  settlementAccount?: string;
  invoiceMethod?: string;
  isActive?: boolean;
  clientVariant?: HallClientVariant;
  hallNumber?: number | null;
}

// ── Add Money / balanse-transaksjoner ────────────────────────────────────────

export interface AddMoneyInput {
  amount: number;
  reason?: string;
}

export interface HallBalanceTransaction {
  id: string;
  hallId: string;
  agentUserId: string | null;
  shiftId: string | null;
  settlementId: string | null;
  txType: "DAILY_BALANCE_TRANSFER" | "DROP_SAFE_MOVE" | "SHIFT_DIFFERENCE" | "MANUAL_ADJUSTMENT";
  direction: "CREDIT" | "DEBIT";
  amount: number;
  previousBalance: number;
  afterBalance: number;
  notes: string | null;
  otherData: Record<string, unknown>;
  createdAt: string;
}

export interface AddMoneyResult {
  hallId: string;
  amount: number;
  previousBalance: number;
  balanceAfter: number;
  transaction: HallBalanceTransaction;
}

export function addMoneyToHall(hallId: string, input: AddMoneyInput): Promise<AddMoneyResult> {
  return apiRequest<AddMoneyResult>(`/api/admin/halls/${encodeURIComponent(hallId)}/add-money`, {
    method: "POST",
    body: input,
    auth: true,
  });
}

export interface HallBalanceTransactionsResult {
  hallId: string;
  cashBalance: number;
  dropsafeBalance: number;
  transactions: HallBalanceTransaction[];
}

export function listHallBalanceTransactions(
  hallId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<HallBalanceTransactionsResult> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<HallBalanceTransactionsResult>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/balance-transactions${suffix}`,
    { auth: true },
  );
}

export function updateHall(id: string, patch: UpdateHallInput): Promise<AdminHall> {
  return apiRequest<AdminHall>(`/api/admin/halls/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: patch,
    auth: true,
  });
}

/**
 * Toggle hall enabled/disabled (soft disable — BIN-663 PR-A5-plan §7.2 #3).
 *
 * Legacy støttet "slett hall" med modal for bulk-spiller-migrering; ny
 * backend har kun `isActive`-flagg. UI viser infotekst om at admin må
 * flytte spillere manuelt før deaktivering (Linear-gap: BIN-A5-HM).
 */
export function setHallActive(id: string, isActive: boolean): Promise<AdminHall> {
  return updateHall(id, { isActive });
}

// ── TV-kiosk voice-pack (wireframe PDF 14) ─────────────────────────────────
//
// Hver hall kan velge én av 3 voice-packs for ball-utrop på TV-skjermen.
// Backend audit-logger hver endring + broadcaster `tv:voice-changed` til
// hall:<id>:display-rommet så aktive TV-klienter kan reloade pack uten
// manuell refresh.

export type HallTvVoice = "voice1" | "voice2" | "voice3";
export const HALL_TV_VOICES: readonly HallTvVoice[] = ["voice1", "voice2", "voice3"] as const;

export interface HallVoiceResult {
  hallId: string;
  voice: HallTvVoice;
}

export function getHallVoice(hallId: string): Promise<HallVoiceResult> {
  return apiRequest<HallVoiceResult>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/voice`,
    { auth: true },
  );
}

export function setHallVoice(hallId: string, voice: HallTvVoice): Promise<HallVoiceResult> {
  return apiRequest<HallVoiceResult>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/voice`,
    {
      method: "PUT",
      body: { voice },
      auth: true,
    },
  );
}
