// PR-A4a (BIN-645) — admin-reports API wrappers.
//
// Thin, typed wrappers around the 10 report endpoints that already exist in
// backend. All endpoints return ApiResponse<T> via `apiRequest`, which unwraps
// `{ ok, data }` for us and throws `ApiError` on non-2xx.
//
// Backend references:
//   - apps/backend/src/routes/admin.ts: range, games, revenue, halls/:id/summary,
//     games/:gameSlug/drill-down, games/:gameSlug/sessions,
//     dashboard/game-history, dashboard/top-players, dashboard/time-series
//   - apps/backend/src/routes/adminHallReports.ts: reports/halls/:id/daily,
//     reports/halls/:id/monthly, reports/halls/:id/account-balance,
//     reports/halls/:id/manual-entries, reports/halls/:id/account/manual-entry
//
// Cursor-paging strategy: backend currently returns full ranges in single calls
// (no cursor field). DataTable.cursorPaging wraps the whole response as a single
// "page" and returns nextCursor=null. Large responses (>10k rows) warn via
// DataTable.csvExport.maxRows. Streaming-CSV endpoint is deferred to BIN-652.

import { apiRequest } from "./client.js";
import type {
  GameReportResponse,
  HallAccountRow,
  HallAccountBalanceDto,
  ManualAdjustmentEntryDto,
  RevenueSummaryResponse,
  SessionsResponse,
  PayoutPlayerRow,
  PayoutTicketRow,
  ReportGameSlug,
} from "../../../../packages/shared-types/src/reports.js";

// ── 1. /api/admin/reports/revenue ───────────────────────────────────────────

export interface RevenueQuery {
  startDate: string;
  endDate: string;
  hallId?: string;
  gameType?: "MAIN_GAME" | "DATABINGO";
  channel?: "HALL" | "INTERNET";
}

export async function getRevenueSummary(q: RevenueQuery): Promise<RevenueSummaryResponse> {
  const qs = buildQs(q);
  return apiRequest<RevenueSummaryResponse>(`/api/admin/reports/revenue?${qs}`, { auth: true });
}

// ── 2. /api/admin/reports/range ─────────────────────────────────────────────

export interface RangeQuery extends RevenueQuery {}

export interface RangeReportRow {
  date: string;
  hallId: string;
  gameType: string;
  channel: string;
  grossTurnover: number;
  prizesPaid: number;
  net: number;
  stakeCount: number;
  prizeCount: number;
  extraPrizeCount: number;
}

export interface RangeReportResponse {
  startDate: string;
  endDate: string;
  generatedAt: string;
  days: Array<{
    date: string;
    rows: RangeReportRow[];
    totals: {
      grossTurnover: number;
      prizesPaid: number;
      net: number;
      stakeCount: number;
      prizeCount: number;
    };
  }>;
  totals: {
    grossTurnover: number;
    prizesPaid: number;
    net: number;
    stakeCount: number;
    prizeCount: number;
  };
}

export async function getRangeReport(q: RangeQuery): Promise<RangeReportResponse> {
  const qs = buildQs(q);
  return apiRequest<RangeReportResponse>(`/api/admin/reports/range?${qs}`, { auth: true });
}

// ── 3. /api/admin/reports/games ─────────────────────────────────────────────

export async function getGamesReport(q: { startDate: string; endDate: string; hallId?: string }):
  Promise<GameReportResponse> {
  const qs = buildQs(q);
  return apiRequest<GameReportResponse>(`/api/admin/reports/games?${qs}`, { auth: true });
}

// ── 4. /api/admin/reports/games/:gameSlug/drill-down ────────────────────────

export interface GameDrillDownQuery {
  gameSlug: ReportGameSlug;
  startDate: string;
  endDate: string;
  hallId?: string;
}

export async function getGameDrillDown(q: GameDrillDownQuery): Promise<GameReportResponse> {
  const qs = buildQs({ startDate: q.startDate, endDate: q.endDate, hallId: q.hallId });
  return apiRequest<GameReportResponse>(
    `/api/admin/reports/games/${encodeURIComponent(q.gameSlug)}/drill-down?${qs}`,
    { auth: true }
  );
}

// ── 5. /api/admin/reports/games/:gameSlug/sessions ──────────────────────────

export interface GameSessionsQuery {
  gameSlug: ReportGameSlug;
  startDate: string;
  endDate: string;
  hallId?: string;
  limit?: number;
}

export async function getGameSessions(q: GameSessionsQuery): Promise<SessionsResponse> {
  const qs = buildQs({
    startDate: q.startDate,
    endDate: q.endDate,
    hallId: q.hallId,
    limit: q.limit,
  });
  return apiRequest<SessionsResponse>(
    `/api/admin/reports/games/${encodeURIComponent(q.gameSlug)}/sessions?${qs}`,
    { auth: true }
  );
}

// ── 6. /api/admin/reports/halls/:hallId/summary ─────────────────────────────

export async function getHallSummary(q: { hallId: string; startDate: string; endDate: string }):
  Promise<RangeReportResponse> {
  const qs = buildQs({ startDate: q.startDate, endDate: q.endDate });
  return apiRequest<RangeReportResponse>(
    `/api/admin/reports/halls/${encodeURIComponent(q.hallId)}/summary?${qs}`,
    { auth: true }
  );
}

// ── 7. /api/admin/reports/halls/:hallId/daily ───────────────────────────────

export interface DailyHallQuery {
  hallId: string;
  dateFrom: string;
  dateTo: string;
  gameType?: string;
}

export interface DailyHallReportResponse {
  hallId: string;
  dateFrom: string;
  dateTo: string;
  gameType: string | null;
  rows: HallAccountRow[];
  count: number;
}

export async function getHallDailyReport(q: DailyHallQuery): Promise<DailyHallReportResponse> {
  const qs = buildQs({ dateFrom: q.dateFrom, dateTo: q.dateTo, gameType: q.gameType });
  return apiRequest<DailyHallReportResponse>(
    `/api/admin/reports/halls/${encodeURIComponent(q.hallId)}/daily?${qs}`,
    { auth: true }
  );
}

// ── 8. /api/admin/reports/halls/:hallId/monthly ─────────────────────────────

export async function getHallMonthlyReport(q: { hallId: string; year: number; month: number }):
  Promise<unknown> {
  const qs = buildQs({ year: q.year, month: q.month });
  return apiRequest<unknown>(
    `/api/admin/reports/halls/${encodeURIComponent(q.hallId)}/monthly?${qs}`,
    { auth: true }
  );
}

// ── 8b. /api/admin/reports/halls/:hallId/account-balance ────────────────────
// PR-A4b (BIN-659) — used by hallAccountReport detail page.

export interface AccountBalanceQuery {
  hallId: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function getHallAccountBalance(q: AccountBalanceQuery): Promise<HallAccountBalanceDto> {
  const qs = buildQs({ dateFrom: q.dateFrom, dateTo: q.dateTo });
  const path = qs
    ? `/api/admin/reports/halls/${encodeURIComponent(q.hallId)}/account-balance?${qs}`
    : `/api/admin/reports/halls/${encodeURIComponent(q.hallId)}/account-balance`;
  return apiRequest<HallAccountBalanceDto>(path, { auth: true });
}

// ── 8c. /api/admin/reports/halls/:hallId/manual-entries ─────────────────────

export interface ManualEntriesQuery {
  hallId: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface ManualEntriesResponse {
  hallId: string;
  rows: ManualAdjustmentEntryDto[];
  count: number;
}

export async function getHallManualEntries(q: ManualEntriesQuery): Promise<ManualEntriesResponse> {
  const qs = buildQs({ dateFrom: q.dateFrom, dateTo: q.dateTo, limit: q.limit });
  const path = qs
    ? `/api/admin/reports/halls/${encodeURIComponent(q.hallId)}/manual-entries?${qs}`
    : `/api/admin/reports/halls/${encodeURIComponent(q.hallId)}/manual-entries`;
  return apiRequest<ManualEntriesResponse>(path, { auth: true });
}

// ── 9. /api/admin/dashboard/game-history ────────────────────────────────────

export interface GameHistoryQuery {
  startDate: string;
  endDate: string;
  gameType?: "MAIN_GAME" | "DATABINGO";
  hallId?: string;
  limit?: number;
}

export async function getGameHistory(q: GameHistoryQuery): Promise<SessionsResponse> {
  const qs = buildQs(q);
  return apiRequest<SessionsResponse>(`/api/admin/dashboard/game-history?${qs}`, { auth: true });
}

// ── 10. /api/admin/payouts/by-player/:userId ────────────────────────────────

export interface PayoutsByPlayerQuery {
  userId: string;
  startDate?: string;
  endDate?: string;
}

export async function getPayoutsByPlayer(q: PayoutsByPlayerQuery): Promise<{ rows: PayoutPlayerRow[] }> {
  const qs = buildQs({ startDate: q.startDate, endDate: q.endDate });
  return apiRequest<{ rows: PayoutPlayerRow[] }>(
    `/api/admin/payouts/by-player/${encodeURIComponent(q.userId)}${qs ? `?${qs}` : ""}`,
    { auth: true }
  );
}

// ── 10b. /api/admin/payouts/by-game/:gameId/tickets ─────────────────────────

export async function getPayoutsByGameTickets(q: { gameId: string }):
  Promise<{ rows: PayoutTicketRow[] }> {
  return apiRequest<{ rows: PayoutTicketRow[] }>(
    `/api/admin/payouts/by-game/${encodeURIComponent(q.gameId)}/tickets`,
    { auth: true }
  );
}

// ── 11. /api/admin/reports/game1 — Report Management Game 1 ─────────────────
// BIN-BOT-01: sub-game-aggregert OMS/UTD/Payout%/RES med filtre.
// Per legacy wireframe WF_B_Spillorama Admin V1.0.pdf p.29 + bot-filter
// per SpilloramaBotReport_V1.0_31.01.2024.pdf.

export interface Game1ManagementReportQuery {
  from?: string;
  to?: string;
  groupOfHallId?: string;
  hallId?: string;
  type?: "player" | "bot";
  q?: string;
}

export interface Game1ManagementReportRow {
  subGameId: string;
  subGameNumber: string | null;
  childGameId: string;
  parentScheduleId: string;
  hallId: string;
  hallName: string;
  groupOfHallId: string | null;
  groupOfHallName: string | null;
  startedAt: string | null;
  oms: number;
  utd: number;
  payoutPct: number;
  res: number;
}

export interface Game1ManagementReportTotals {
  oms: number;
  utd: number;
  payoutPct: number;
  res: number;
}

export interface Game1ManagementReportResponse {
  from: string;
  to: string;
  generatedAt: string;
  type: "player" | "bot";
  rows: Game1ManagementReportRow[];
  totals: Game1ManagementReportTotals;
}

export async function getGame1ManagementReport(
  q: Game1ManagementReportQuery,
): Promise<Game1ManagementReportResponse> {
  const qs = buildQs(q);
  const path = qs ? `/api/admin/reports/game1?${qs}` : "/api/admin/reports/game1";
  return apiRequest<Game1ManagementReportResponse>(path, { auth: true });
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
