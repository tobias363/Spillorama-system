// REQ-143: API-wrapper for aggregert group-of-hall hall-account-rapport.
//
// Speiler apps/backend/src/routes/adminGroupHallReports.ts:
//   GET /api/admin/reports/groups
//   GET /api/admin/reports/groups/:groupId/daily
//   GET /api/admin/reports/groups/:groupId/monthly
//   GET /api/admin/reports/groups/:groupId/account-balance
//
// Brukes av HallAccountListPage for å la multi-hall-operatorer velge en
// Group of Hall i dropdown og se aggregat over alle medlemshaller.

import { apiRequest } from "./client.js";

export type HallGroupStatus = "active" | "inactive";

export interface GroupSummary {
  id: string;
  name: string;
  status: HallGroupStatus;
  memberCount: number;
  hallIds: string[];
}

export interface GroupListResponse {
  groups: GroupSummary[];
  count: number;
}

export interface DailyGroupReportRow {
  date: string;
  gameType: string | null;
  ticketsSoldCents: number;
  winningsPaidCents: number;
  netRevenueCents: number;
  cashInCents: number;
  cashOutCents: number;
  cardInCents: number;
  cardOutCents: number;
  contributingHallCount: number;
}

export interface DailyGroupReportResponse {
  groupId: string;
  groupName: string;
  hallIds: string[];
  dateFrom: string;
  dateTo: string;
  gameType: string | null;
  rows: DailyGroupReportRow[];
  count: number;
}

export interface MonthlyGroupReportResponse {
  groupId: string;
  groupName: string;
  hallIds: string[];
  month: string;
  ticketsSoldCents: number;
  winningsPaidCents: number;
  netRevenueCents: number;
  cashInCents: number;
  cashOutCents: number;
  cardInCents: number;
  cardOutCents: number;
  manualAdjustmentCents: number;
  contributingHallCount: number;
}

export interface GroupAccountBalanceResponse {
  groupId: string;
  groupName: string;
  hallIds: string[];
  hallCashBalance: number;
  dropsafeBalance: number;
  periodTotalCashInCents: number;
  periodTotalCashOutCents: number;
  periodTotalCardInCents: number;
  periodTotalCardOutCents: number;
  periodSellingByCustomerNumberCents: number;
  periodManualAdjustmentCents: number;
  periodNetCashFlowCents: number;
}

export interface DailyGroupQuery {
  groupId: string;
  dateFrom: string;
  dateTo: string;
  gameType?: string;
}

export interface MonthlyGroupQuery {
  groupId: string;
  year: number;
  month: number;
}

export interface GroupAccountBalanceQuery {
  groupId: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildGroupQs(q: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

/**
 * List grupper synlige for innlogget bruker. ADMIN/SUPPORT ser alle;
 * HALL_OPERATOR ser kun grupper hvor egen hall er medlem (server-scopet).
 */
export async function listReportGroups(): Promise<GroupListResponse> {
  return apiRequest<GroupListResponse>("/api/admin/reports/groups", { auth: true });
}

export async function getGroupDailyReport(
  q: DailyGroupQuery,
): Promise<DailyGroupReportResponse> {
  const qs = buildGroupQs({ dateFrom: q.dateFrom, dateTo: q.dateTo, gameType: q.gameType });
  return apiRequest<DailyGroupReportResponse>(
    `/api/admin/reports/groups/${encodeURIComponent(q.groupId)}/daily?${qs}`,
    { auth: true },
  );
}

export async function getGroupMonthlyReport(
  q: MonthlyGroupQuery,
): Promise<MonthlyGroupReportResponse> {
  const qs = buildGroupQs({ year: q.year, month: q.month });
  return apiRequest<MonthlyGroupReportResponse>(
    `/api/admin/reports/groups/${encodeURIComponent(q.groupId)}/monthly?${qs}`,
    { auth: true },
  );
}

export async function getGroupAccountBalance(
  q: GroupAccountBalanceQuery,
): Promise<GroupAccountBalanceResponse> {
  const qs = buildGroupQs({ dateFrom: q.dateFrom, dateTo: q.dateTo });
  const path = qs
    ? `/api/admin/reports/groups/${encodeURIComponent(q.groupId)}/account-balance?${qs}`
    : `/api/admin/reports/groups/${encodeURIComponent(q.groupId)}/account-balance`;
  return apiRequest<GroupAccountBalanceResponse>(path, { auth: true });
}
