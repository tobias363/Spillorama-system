// ── REST API response types ─────────────────────────────────────────────────

/** Standard response wrapper for all Spillorama REST endpoints. */
export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string };
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiError;

// ── User & Auth ─────────────────────────────────────────────────────────────

export type UserRole = "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
export type KycStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface PublicAppUser {
  id: string;
  email: string;
  displayName: string;
  surname?: string;
  phone?: string;
  walletId: string;
  role: UserRole;
  kycStatus: KycStatus;
  birthDate?: string;
  kycVerifiedAt?: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  accessToken: string;
  expiresAt: string;
  user: PublicAppUser;
}

// ── Games & Halls ───────────────────────────────────────────────────────────

export interface GameDefinition {
  slug: string;
  name: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface GameStatusInfo {
  status: "OPEN" | "STARTING" | "CLOSED";
  nextRoundAt: string | null;
}

// ── Spill 1 lobby (2026-05-08, Tobias-direktiv) ────────────────────────────
// GET /api/games/spill1/lobby?hallId=X. Public endpoint som rapporterer om
// rommet er åpent (innenfor plan.startTime-endTime), neste planlagte spill,
// og engine-status hvis runden er spawnet. Klient bruker `overallStatus`
// til å bestemme UI-state.

/**
 * Aggregert status for hele lobby-vinduet:
 *   - `closed` → "Stengt"-melding (ingen plan eller utenfor åpningstid)
 *   - `idle` → "Venter på neste runde — bonger ikke i salg ennå"
 *   - `purchase_open` → "Kjøp bonger"-knapp aktiv
 *   - `ready_to_start` → "Spillet starter snart"
 *   - `running` → bytt til runde-modus i samme rom
 *   - `paused` → "Pauset"
 *   - `finished` → "Spilleplanen er ferdig for dagen"
 */
export type Spill1LobbyOverallStatus =
  | "closed"
  | "idle"
  | "purchase_open"
  | "ready_to_start"
  | "running"
  | "paused"
  | "finished";

export interface Spill1LobbyNextGame {
  itemId: string;
  position: number;
  catalogSlug: string;
  catalogDisplayName: string;
  status: Spill1LobbyOverallStatus;
  scheduledGameId: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  actualStartTime: string | null;
}

export interface Spill1LobbyState {
  hallId: string;
  /** ISO-dato (Oslo-tz). */
  businessDate: string;
  isOpen: boolean;
  /** "HH:MM" eller null hvis ingen plan dekker dagen. */
  openingTimeStart: string | null;
  /** "HH:MM" eller null. */
  openingTimeEnd: string | null;
  planId: string | null;
  planName: string | null;
  runId: string | null;
  runStatus: "idle" | "running" | "paused" | "finished" | null;
  overallStatus: Spill1LobbyOverallStatus;
  nextScheduledGame: Spill1LobbyNextGame | null;
  /** 1-basert posisjon i planen. 0 hvis ingen run eller plan ferdig. */
  currentRunPosition: number;
  /** Antall items i planen. 0 hvis ingen plan. */
  totalPositions: number;
}

export interface HallDefinition {
  id: string;
  name: string;
  organizationName?: string;
  settlementName?: string;
}

// ── Wallet & Compliance ─────────────────────────────────────────────────────

export interface WalletAccount {
  id: string;
  balance: number;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description?: string;
  createdAt: string;
}

export interface PlayerComplianceSnapshot {
  dailyLossLimit?: number;
  monthlyLossLimit?: number;
  timedPauseUntil?: string;
  selfExcludedUntil?: string;
  dailyLoss: number;
  monthlyLoss: number;
}

// ── Payment requests (deposit/withdraw queue) ──────────────────────────────
// BIN-646 (PR-B4): typekontrakter for /api/admin/payments/requests*.

export type PaymentRequestKind = "deposit" | "withdraw";
export type PaymentRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED";
/** BIN-646: bank = overføring til kontonummer, hall = kontant i hall. */
export type PaymentRequestDestinationType = "bank" | "hall";

export interface PaymentRequest {
  id: string;
  kind: PaymentRequestKind;
  userId: string;
  walletId: string;
  amountCents: number;
  hallId: string | null;
  submittedBy: string | null;
  status: PaymentRequestStatus;
  rejectionReason: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  walletTransactionId: string | null;
  /** Kun relevant for kind=withdraw. null for deposit eller legacy-rows. */
  destinationType: PaymentRequestDestinationType | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListPaymentRequestsResponse {
  requests: PaymentRequest[];
}

export interface AcceptPaymentRequestBody {
  type: PaymentRequestKind;
  /**
   * BIN-653: foreslått felt for Cash/Card ved deposit-accept. Backend
   * aksepterer ikke feltet ennå (ignoreres), men frontend kan sende det for
   * forward-kompatibilitet.
   */
  paymentType?: "cash" | "card";
}

export interface RejectPaymentRequestBody {
  type: PaymentRequestKind;
  reason: string;
}

// ── System info (BIN-678) ──────────────────────────────────────────────────
// GET /api/admin/system/info — runtime-diagnostikk for ops-konsoll.

export interface SystemInfoSnapshot {
  version: string;
  buildSha: string;
  buildTime: string;
  nodeVersion: string;
  env: string;
  uptime: number;
  features: Record<string, boolean>;
}

// ── Transactions log (BIN-655) ─────────────────────────────────────────────
// GET /api/admin/transactions — aggregert read-only transaksjonslogg
// (wallet + agent + payment-requests).

export type AdminTransactionSource =
  | "wallet"
  | "agent"
  | "deposit_request"
  | "withdraw_request";

export interface AdminTransactionRow {
  id: string;
  source: AdminTransactionSource;
  type: string;
  amountCents: number;
  timestamp: string;
  userId: string | null;
  hallId: string | null;
  description: string;
}

export interface AdminTransactionsListResponse {
  items: AdminTransactionRow[];
  nextCursor: string | null;
}

// ── Audit log (BIN-655 alt) ────────────────────────────────────────────────
// GET /api/admin/audit-log — cursor-paginert read-only audit-liste.

export interface AdminAuditLogEvent {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AdminAuditLogListResponse {
  items: AdminAuditLogEvent[];
  nextCursor: string | null;
}
