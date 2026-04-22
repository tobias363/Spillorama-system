// PR-B3 (BIN-613) — admin physical-ticket API wrappers.
// Thin wrappers around `apps/backend/src/routes/adminPhysicalTickets.ts`
// (BIN-587 B4a). All endpoints require PHYSICAL_TICKET_WRITE permission
// and are hall-scoped per BIN-591 (HALL_OPERATOR sees only own hall).

import { apiRequest } from "./client.js";

export type PhysicalBatchStatus = "DRAFT" | "ACTIVE" | "CLOSED";

export interface PhysicalTicketBatch {
  id: string;
  hallId: string;
  batchName: string;
  rangeStart: number;
  rangeEnd: number;
  defaultPriceCents: number;
  gameSlug: string | null;
  assignedGameId: string | null;
  status: PhysicalBatchStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListBatchesResponse {
  batches: PhysicalTicketBatch[];
  count: number;
}

export interface CreateBatchRequest {
  hallId: string;
  batchName: string;
  rangeStart: number;
  rangeEnd: number;
  defaultPriceCents: number;
  gameSlug?: string | null;
  assignedGameId?: string | null;
}

export interface UpdateBatchRequest {
  batchName?: string;
  defaultPriceCents?: number;
  gameSlug?: string | null;
  assignedGameId?: string | null;
  status?: PhysicalBatchStatus;
}

export interface GenerateResult {
  batchId: string;
  generated: number;
  firstUniqueId: string;
  lastUniqueId: string;
}

export interface LastRegisteredIdResponse {
  hallId: string;
  lastUniqueId: string | null;
  lastBatchId: string | null;
}

export interface TransferHallRequest {
  toHallId: string;
  reason: string;
}

export interface BatchTransfer {
  id: string;
  batchId: string;
  fromHallId: string;
  toHallId: string;
  reason: string;
  transferredBy: string;
  transferredAt: string;
  ticketCountAtTransfer: number;
}

export function listBatches(params: { hallId?: string; status?: PhysicalBatchStatus; limit?: number } = {}): Promise<ListBatchesResponse> {
  const q = new URLSearchParams();
  if (params.hallId) q.set("hallId", params.hallId);
  if (params.status) q.set("status", params.status);
  if (params.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiRequest<ListBatchesResponse>(
    `/api/admin/physical-tickets/batches${qs ? `?${qs}` : ""}`,
    { auth: true }
  );
}

export function createBatch(body: CreateBatchRequest): Promise<PhysicalTicketBatch> {
  return apiRequest<PhysicalTicketBatch>("/api/admin/physical-tickets/batches", {
    method: "POST",
    body,
    auth: true,
  });
}

export function getBatch(id: string): Promise<PhysicalTicketBatch> {
  return apiRequest<PhysicalTicketBatch>(
    `/api/admin/physical-tickets/batches/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export function updateBatch(id: string, body: UpdateBatchRequest): Promise<PhysicalTicketBatch> {
  return apiRequest<PhysicalTicketBatch>(
    `/api/admin/physical-tickets/batches/${encodeURIComponent(id)}`,
    { method: "PUT", body, auth: true }
  );
}

export function deleteBatch(id: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(
    `/api/admin/physical-tickets/batches/${encodeURIComponent(id)}`,
    { method: "DELETE", auth: true }
  );
}

export function generateTickets(id: string): Promise<GenerateResult> {
  return apiRequest<GenerateResult>(
    `/api/admin/physical-tickets/batches/${encodeURIComponent(id)}/generate`,
    { method: "POST", auth: true }
  );
}

export function lastRegisteredId(hallId: string): Promise<LastRegisteredIdResponse> {
  const q = new URLSearchParams({ hallId });
  return apiRequest<LastRegisteredIdResponse>(
    `/api/admin/physical-tickets/last-registered-id?${q.toString()}`,
    { auth: true }
  );
}

export function transferBatchToHall(id: string, body: TransferHallRequest): Promise<BatchTransfer> {
  return apiRequest<BatchTransfer>(
    `/api/admin/physical-tickets/batches/${encodeURIComponent(id)}/transfer-hall`,
    { method: "POST", body, auth: true }
  );
}

export interface ListTransfersResponse {
  batchId: string;
  transfers: BatchTransfer[];
  count: number;
}

export function listTransfers(id: string): Promise<ListTransfersResponse> {
  return apiRequest<ListTransfersResponse>(
    `/api/admin/physical-tickets/batches/${encodeURIComponent(id)}/transfers`,
    { auth: true }
  );
}

export interface AssignGameRequest {
  gameId: string;
}

export function assignBatchToGame(id: string, body: AssignGameRequest): Promise<PhysicalTicketBatch> {
  return apiRequest<PhysicalTicketBatch>(
    `/api/admin/physical-tickets/batches/${encodeURIComponent(id)}/assign-game`,
    { method: "POST", body, auth: true }
  );
}

// ── PT1: fysisk-bong CSV-import (app_static_tickets) ────────────────────────

export interface StaticTicketImportRequest {
  hallId: string;
  csvContent: string;
}

export interface StaticTicketImportResult {
  hallId: string;
  inserted: number;
  skipped: number;
  totalRows: number;
}

/**
 * Laster opp fysisk-bong CSV for valgt hall. CSV-innhold sendes som JSON-
 * streng (ikke multipart) — admin-UI leser filen via FileReader.readAsText()
 * og POSTer resultatet. Server har 15mb body-limit for denne endpointen.
 *
 * Atomisk: hvis én rad feiler valideringen, rulles hele importen tilbake
 * (all-or-nothing). Eksisterende rader (samme hall/serial/color) hoppes
 * over (idempotent).
 */
export function importStaticTicketsCsv(
  body: StaticTicketImportRequest
): Promise<StaticTicketImportResult> {
  return apiRequest<StaticTicketImportResult>(
    "/api/admin/physical-tickets/static/import",
    { method: "POST", body, auth: true }
  );
}

// ── BIN-587 B4b: unique-id lookup + list ────────────────────────────────────

export type PhysicalTicketStatus = "UNSOLD" | "SOLD" | "VOIDED";

export type PhysicalTicketPattern =
  | "row_1"
  | "row_2"
  | "row_3"
  | "row_4"
  | "full_house";

export interface PhysicalTicket {
  id: string;
  batchId: string;
  uniqueId: string;
  hallId: string;
  status: PhysicalTicketStatus;
  priceCents: number | null;
  assignedGameId: string | null;
  soldAt: string | null;
  soldBy: string | null;
  buyerUserId: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedReason: string | null;
  createdAt: string;
  updatedAt: string;
  numbersJson: number[] | null;
  patternWon: PhysicalTicketPattern | null;
  wonAmountCents: number | null;
  evaluatedAt: string | null;
  isWinningDistributed: boolean;
  winningDistributedAt: string | null;
}

export interface CheckUniqueIdResponse {
  exists: boolean;
  sellable: boolean;
  ticket: PhysicalTicket | null;
}

export function checkUniqueId(uniqueId: string): Promise<CheckUniqueIdResponse> {
  return apiRequest<CheckUniqueIdResponse>("/api/admin/unique-ids/check", {
    method: "POST",
    body: { uniqueId },
    auth: true,
  });
}

export function getUniqueId(uniqueId: string): Promise<PhysicalTicket> {
  return apiRequest<PhysicalTicket>(
    `/api/admin/unique-ids/${encodeURIComponent(uniqueId)}`,
    { auth: true }
  );
}

export interface ListUniqueIdsResponse {
  tickets: PhysicalTicket[];
  count: number;
}

export function listUniqueIds(
  params: { hallId?: string; status?: PhysicalTicketStatus; limit?: number } = {}
): Promise<ListUniqueIdsResponse> {
  const q = new URLSearchParams();
  if (params.hallId) q.set("hallId", params.hallId);
  if (params.status) q.set("status", params.status);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiRequest<ListUniqueIdsResponse>(
    `/api/admin/unique-ids${qs ? `?${qs}` : ""}`,
    { auth: true }
  );
}

export interface UniqueIdTransactionEvent {
  at: string;
  event: string;
  actor: string | null;
  details: Record<string, unknown>;
}

export interface UniqueIdTransactionsResponse {
  uniqueId: string;
  currentStatus: PhysicalTicketStatus;
  events: UniqueIdTransactionEvent[];
}

export function getUniqueIdTransactions(uniqueId: string): Promise<UniqueIdTransactionsResponse> {
  return apiRequest<UniqueIdTransactionsResponse>(
    `/api/admin/unique-ids/${encodeURIComponent(uniqueId)}/transactions`,
    { auth: true }
  );
}

// ── BIN-640: single-ticket cashout ──────────────────────────────────────────

export interface CashoutRequest {
  payoutCents: number;
  notes?: string | null;
}

export interface PhysicalTicketCashout {
  id: string;
  ticketUniqueId: string;
  hallId: string;
  gameId: string | null;
  payoutCents: number;
  paidBy: string;
  paidAt: string;
  notes: string | null;
  otherData: Record<string, unknown>;
}

export interface CashoutResult {
  cashout: PhysicalTicketCashout;
  ticket: PhysicalTicket;
}

export function cashoutTicket(uniqueId: string, body: CashoutRequest): Promise<CashoutResult> {
  return apiRequest<CashoutResult>(
    `/api/admin/physical-tickets/${encodeURIComponent(uniqueId)}/cashout`,
    { method: "POST", body, auth: true }
  );
}

export interface GetCashoutResponse {
  uniqueId: string;
  status: PhysicalTicketStatus;
  cashedOut: boolean;
  cashout: PhysicalTicketCashout | null;
}

export function getCashout(uniqueId: string): Promise<GetCashoutResponse> {
  return apiRequest<GetCashoutResponse>(
    `/api/admin/physical-tickets/${encodeURIComponent(uniqueId)}/cashout`,
    { auth: true }
  );
}

// ── BIN-641: check-bingo ────────────────────────────────────────────────────

export interface CheckBingoRequest {
  gameId: string;
  numbers: number[];
}

export interface CheckBingoResponse {
  uniqueId: string;
  gameId: string;
  gameStatus: string;
  hasWon: boolean;
  winningPattern: PhysicalTicketPattern | null;
  matchedNumbers: number[];
  drawnNumbersCount: number;
  payoutEligible: boolean;
  alreadyEvaluated: boolean;
  evaluatedAt: string | null;
  wonAmountCents: number | null;
  isWinningDistributed: boolean;
}

export function checkBingo(uniqueId: string, body: CheckBingoRequest): Promise<CheckBingoResponse> {
  return apiRequest<CheckBingoResponse>(
    `/api/admin/physical-tickets/${encodeURIComponent(uniqueId)}/check-bingo`,
    { method: "POST", body, auth: true }
  );
}

// ── BIN-639: reward-all (bulk payout) ───────────────────────────────────────

export interface RewardAllRewardEntry {
  uniqueId: string;
  amountCents: number;
}

export interface RewardAllRequest {
  gameId: string;
  rewards: RewardAllRewardEntry[];
}

export type RewardAllDetailStatus =
  | "rewarded"
  | "skipped_already_distributed"
  | "skipped_not_stamped"
  | "skipped_not_won"
  | "skipped_wrong_game"
  | "ticket_not_found"
  | "invalid_amount";

export interface RewardAllDetail {
  uniqueId: string;
  status: RewardAllDetailStatus;
  amountCents?: number;
  cashoutId?: string;
  hallId?: string;
  message?: string;
}

export interface RewardAllResponse {
  rewardedCount: number;
  totalPayoutCents: number;
  skippedCount: number;
  details: RewardAllDetail[];
}

export function rewardAll(body: RewardAllRequest): Promise<RewardAllResponse> {
  return apiRequest<RewardAllResponse>(
    "/api/admin/physical-tickets/reward-all",
    { method: "POST", body, auth: true }
  );
}

// ── BIN-638: games in hall aggregate ────────────────────────────────────────

export interface PhysicalTicketGameInHallRow {
  gameId: string | null;
  name: string | null;
  status: "ACTIVE" | "INACTIVE" | null;
  sold: number;
  pendingCashoutCount: number;
  ticketsInPlay: number;
  cashedOut: number;
  totalRevenueCents: number;
}

export interface PhysicalTicketsGamesInHallTotals {
  sold: number;
  pendingCashoutCount: number;
  ticketsInPlay: number;
  cashedOut: number;
  totalRevenueCents: number;
  rowCount: number;
}

export interface PhysicalTicketsGamesInHallResponse {
  generatedAt: string;
  hallId: string;
  from: string | null;
  to: string | null;
  rows: PhysicalTicketGameInHallRow[];
  totals: PhysicalTicketsGamesInHallTotals;
}

export function listGamesInHall(
  params: { hallId: string; from?: string; to?: string; limit?: number }
): Promise<PhysicalTicketsGamesInHallResponse> {
  const q = new URLSearchParams();
  q.set("hallId", params.hallId);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  return apiRequest<PhysicalTicketsGamesInHallResponse>(
    `/api/admin/physical-tickets/games/in-hall?${q.toString()}`,
    { auth: true }
  );
}

// ── Helper: list sold tickets for a game (existing route, used by PayoutTicketsPage) ──
export interface ListSoldForGameResponse {
  tickets: PhysicalTicket[];
  count: number;
}

export function listSoldTicketsForGame(
  gameId: string,
  params: { hallId?: string; limit?: number } = {}
): Promise<ListSoldForGameResponse> {
  const q = new URLSearchParams();
  if (params.hallId) q.set("hallId", params.hallId);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiRequest<ListSoldForGameResponse>(
    `/api/admin/physical-tickets/games/${encodeURIComponent(gameId)}/sold${qs ? `?${qs}` : ""}`,
    { auth: true }
  );
}

// ── PT2/PT3/PT5 — agent-range-registrering + batch-salg + handover/extend ───

export type StaticTicketColor = "small" | "large" | "traffic-light";

export interface AgentTicketRangeRow {
  id: string;
  agentId: string;
  hallId: string;
  ticketColor: StaticTicketColor;
  initialSerial: string;
  finalSerial: string;
  serials: string[];
  currentTopSerial: string | null;
  nextAvailableIndex: number;
  registeredAt: string;
  closedAt: string | null;
  handoverFromRangeId: string | null;
  handedOffToRangeId: string | null;
}

export interface RegisterRangeRequest {
  agentId: string;
  hallId: string;
  ticketColor: StaticTicketColor;
  firstScannedSerial: string;
  count: number;
}

export interface RegisterRangeResult {
  rangeId: string;
  initialTopSerial: string;
  finalSerial: string;
  reservedCount: number;
}

export function registerAgentTicketRange(
  body: RegisterRangeRequest
): Promise<RegisterRangeResult> {
  return apiRequest<RegisterRangeResult>(
    "/api/admin/physical-tickets/ranges/register",
    { method: "POST", body, auth: true }
  );
}

export interface CloseRangeResult {
  rangeId: string;
  closedAt: string;
}

export function closeAgentTicketRange(rangeId: string): Promise<CloseRangeResult> {
  return apiRequest<CloseRangeResult>(
    `/api/admin/physical-tickets/ranges/${encodeURIComponent(rangeId)}/close`,
    { method: "POST", body: {}, auth: true }
  );
}

export interface ListRangesResponse {
  ranges: AgentTicketRangeRow[];
}

export function listAgentTicketRanges(
  params: { agentId?: string; hallId?: string } = {}
): Promise<ListRangesResponse> {
  const q = new URLSearchParams();
  if (params.agentId) q.set("agentId", params.agentId);
  if (params.hallId) q.set("hallId", params.hallId);
  const qs = q.toString();
  return apiRequest<ListRangesResponse>(
    `/api/admin/physical-tickets/ranges${qs ? `?${qs}` : ""}`,
    { auth: true }
  );
}

export interface RecordBatchSaleRequest {
  newTopSerial: string;
  scheduledGameId?: string;
}

export interface RecordBatchSaleResult {
  rangeId: string;
  soldSerials: string[];
  soldCount: number;
  scheduledGameId: string;
  gameStartTime: string;
  newTopSerial: string;
  previousTopSerial: string;
}

export function recordBatchSale(
  rangeId: string,
  body: RecordBatchSaleRequest
): Promise<RecordBatchSaleResult> {
  return apiRequest<RecordBatchSaleResult>(
    `/api/admin/physical-tickets/ranges/${encodeURIComponent(rangeId)}/record-batch-sale`,
    { method: "POST", body, auth: true }
  );
}

export interface HandoverRangeRequest {
  toUserId: string;
}

export interface HandoverRangeResult {
  newRangeId: string;
  fromRangeId: string;
  unsoldCount: number;
  soldPendingCount: number;
  handoverAt: string;
  fromUserId: string;
  toUserId: string;
  hallId: string;
  ticketColor: StaticTicketColor;
  newInitialSerial: string;
  newFinalSerial: string;
}

export function handoverAgentTicketRange(
  rangeId: string,
  body: HandoverRangeRequest
): Promise<HandoverRangeResult> {
  return apiRequest<HandoverRangeResult>(
    `/api/admin/physical-tickets/ranges/${encodeURIComponent(rangeId)}/handover`,
    { method: "POST", body, auth: true }
  );
}

export interface ExtendRangeRequest {
  additionalCount: number;
}

export interface ExtendRangeResult {
  rangeId: string;
  addedCount: number;
  newFinalSerial: string;
  newTopOfAddedSerial: string;
  newSerials: string[];
  totalSerialsAfter: number;
}

export function extendAgentTicketRange(
  rangeId: string,
  body: ExtendRangeRequest
): Promise<ExtendRangeResult> {
  return apiRequest<ExtendRangeResult>(
    `/api/admin/physical-tickets/ranges/${encodeURIComponent(rangeId)}/extend`,
    { method: "POST", body, auth: true }
  );
}

// ── PT4 — pending-payouts (vinn-verifisering + utbetaling) ──────────────────

export type PendingPayoutPattern = "row_1" | "row_2" | "row_3" | "row_4" | "full_house";

export interface PhysicalTicketPendingPayoutRow {
  id: string;
  ticketId: string;
  hallId: string;
  scheduledGameId: string;
  patternPhase: PendingPayoutPattern;
  expectedPayoutCents: number;
  responsibleUserId: string;
  color: string;
  detectedAt: string;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  paidOutAt: string | null;
  paidOutByUserId: string | null;
  adminApprovalRequired: boolean;
  adminApprovedAt: string | null;
  adminApprovedByUserId: string | null;
  rejectedAt: string | null;
  rejectedByUserId: string | null;
  rejectedReason: string | null;
}

export interface ListPendingPayoutsResponse {
  pending: PhysicalTicketPendingPayoutRow[];
}

export function listPendingPayouts(
  params: { gameId?: string; userId?: string } = {}
): Promise<ListPendingPayoutsResponse> {
  const q = new URLSearchParams();
  if (params.gameId) q.set("gameId", params.gameId);
  if (params.userId) q.set("userId", params.userId);
  const qs = q.toString();
  return apiRequest<ListPendingPayoutsResponse>(
    `/api/admin/physical-ticket-payouts/pending${qs ? `?${qs}` : ""}`,
    { auth: true }
  );
}

export interface VerifyWinRequest {
  scannedTicketId: string;
}

export interface VerifyWinResult {
  ticketId: string;
  pattern: PendingPayoutPattern;
  color: string;
  expectedPayoutCents: number;
  needsAdminApproval: boolean;
}

export function verifyPendingPayout(
  pendingPayoutId: string,
  body: VerifyWinRequest
): Promise<VerifyWinResult> {
  return apiRequest<VerifyWinResult>(
    `/api/admin/physical-ticket-payouts/${encodeURIComponent(pendingPayoutId)}/verify`,
    { method: "POST", body, auth: true }
  );
}

export function adminApprovePendingPayout(
  pendingPayoutId: string
): Promise<PhysicalTicketPendingPayoutRow> {
  return apiRequest<PhysicalTicketPendingPayoutRow>(
    `/api/admin/physical-ticket-payouts/${encodeURIComponent(pendingPayoutId)}/admin-approve`,
    { method: "POST", body: {}, auth: true }
  );
}

export interface ConfirmPayoutResult {
  ticketId: string;
  paidOutAmountCents: number;
}

export function confirmPendingPayout(
  pendingPayoutId: string
): Promise<ConfirmPayoutResult> {
  return apiRequest<ConfirmPayoutResult>(
    `/api/admin/physical-ticket-payouts/${encodeURIComponent(pendingPayoutId)}/confirm-payout`,
    { method: "POST", body: {}, auth: true }
  );
}

export interface RejectPayoutRequest {
  reason: string;
}

export function rejectPendingPayout(
  pendingPayoutId: string,
  body: RejectPayoutRequest
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(
    `/api/admin/physical-ticket-payouts/${encodeURIComponent(pendingPayoutId)}/reject`,
    { method: "POST", body, auth: true }
  );
}
