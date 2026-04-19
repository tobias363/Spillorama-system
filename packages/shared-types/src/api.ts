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

export type UserRole = "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER";
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
