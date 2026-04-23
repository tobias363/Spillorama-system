// Agent-portal Check-for-Bingo + Physical Cashout.
//
// Thin wrappers around `apps/backend/src/routes/agentBingo.ts`. Alle
// endepunkter krever AGENT med aktiv shift, HALL_OPERATOR med tildelt hall,
// eller ADMIN. Hall-scope håndheves av backend.

import { apiRequest } from "./client.js";
import type {
  PhysicalTicket,
  PhysicalTicketPattern,
  RewardAllDetail,
} from "./admin-physical-tickets.js";

export interface AgentCheckBingoRequest {
  uniqueId: string;
  gameId: string;
  numbers: number[];
}

export interface AgentCheckBingoResponse {
  uniqueId: string;
  gameId: string;
  gameStatus: string;
  hasWon: boolean;
  /** Høyeste mønster billetten dekker (null hvis ingen match). */
  winningPattern: PhysicalTicketPattern | null;
  /** Alle mønstre billetten dekker — brukes til "Winning Patterns"-liste i UI. */
  winningPatterns: PhysicalTicketPattern[];
  /** Index-posisjoner i 5×5-grid (0..24) som er trekt eller free. */
  matchedCellIndexes: number[];
  drawnNumbersCount: number;
  payoutEligible: boolean;
  alreadyEvaluated: boolean;
  evaluatedAt: string | null;
  wonAmountCents: number | null;
  isWinningDistributed: boolean;
}

/** POST /api/agent/bingo/check */
export function agentCheckBingo(body: AgentCheckBingoRequest): Promise<AgentCheckBingoResponse> {
  return apiRequest<AgentCheckBingoResponse>("/api/agent/bingo/check", {
    method: "POST",
    body,
    auth: true,
  });
}

export interface AgentPendingResponse {
  gameId: string;
  pending: PhysicalTicket[];
  rewarded: PhysicalTicket[];
  pendingCount: number;
  rewardedCount: number;
}

/** GET /api/agent/physical/pending?gameId= */
export function agentListPending(gameId: string): Promise<AgentPendingResponse> {
  const q = new URLSearchParams({ gameId });
  return apiRequest<AgentPendingResponse>(
    `/api/agent/physical/pending?${q.toString()}`,
    { auth: true },
  );
}

export interface AgentRewardEntry {
  uniqueId: string;
  amountCents: number;
}

export interface AgentRewardAllRequest {
  gameId: string;
  rewards: AgentRewardEntry[];
}

export interface AgentRewardAllResponse {
  rewardedCount: number;
  totalPayoutCents: number;
  skippedCount: number;
  details: RewardAllDetail[];
}

/** POST /api/agent/physical/reward-all */
export function agentRewardAll(body: AgentRewardAllRequest): Promise<AgentRewardAllResponse> {
  return apiRequest<AgentRewardAllResponse>("/api/agent/physical/reward-all", {
    method: "POST",
    body,
    auth: true,
  });
}

export interface AgentPerTicketRewardRequest {
  gameId: string;
  amountCents: number;
}

export interface AgentPerTicketRewardResponse {
  uniqueId: string;
  status: string;
  amountCents: number;
  cashoutId: string | null;
  hallId: string | null;
  message: string | null;
}

/** POST /api/agent/physical/:uniqueId/reward */
export function agentRewardTicket(
  uniqueId: string,
  body: AgentPerTicketRewardRequest,
): Promise<AgentPerTicketRewardResponse> {
  return apiRequest<AgentPerTicketRewardResponse>(
    `/api/agent/physical/${encodeURIComponent(uniqueId)}/reward`,
    { method: "POST", body, auth: true },
  );
}
