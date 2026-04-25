/**
 * BIN-586: Routes for manuell deposit/withdraw-kø.
 *
 * Admin-endepunkter (for hall-operator og admin):
 *   GET  /api/admin/payments/requests?type=deposit|withdraw&status=pending&hallId=...
 *   POST /api/admin/payments/requests/:id/accept   { type: "deposit"|"withdraw" }
 *   POST /api/admin/payments/requests/:id/reject   { type, reason }
 *
 * Spiller-endepunkter:
 *   POST /api/payments/deposit-request   { amountCents, hallId? }
 *   POST /api/payments/withdraw-request  { amountCents, hallId? }
 *
 * Wallet-operasjonen skjer først når admin godkjenner. Opprettelse alene
 * rører ikke wallet.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type {
  PaymentRequest,
  PaymentRequestService,
  PaymentRequestKind,
  PaymentRequestStatus,
  PaymentRequestDestinationType,
} from "../payments/PaymentRequestService.js";
import {
  ADMIN_ACCESS_POLICY as _ADMIN_ACCESS_POLICY,
  assertAdminPermission,
  assertUserHallScope,
  resolveHallScopeFilter,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import { exportCsv, type CsvColumn } from "../util/csvExport.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";

// Silence unused import warning — ADMIN_ACCESS_POLICY is re-exported for
// parity with other routers but not used directly here.
void _ADMIN_ACCESS_POLICY;

export interface PaymentRequestsRouterDeps {
  platformService: PlatformService;
  paymentRequestService: PaymentRequestService;
  emitWalletRoomUpdates: (walletIds: string[]) => Promise<void>;
}

function parseKind(value: unknown, fieldName = "type"): PaymentRequestKind {
  const raw = mustBeNonEmptyString(value, fieldName).toLowerCase();
  if (raw !== "deposit" && raw !== "withdraw") {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være 'deposit' eller 'withdraw'.`
    );
  }
  return raw;
}

function parseStatus(value: unknown): PaymentRequestStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "PENDING" || normalized === "ACCEPTED" || normalized === "REJECTED") {
    return normalized;
  }
  // Lowercase alias (legacy): pending → PENDING.
  const upper = normalized as PaymentRequestStatus;
  if (["PENDING", "ACCEPTED", "REJECTED"].includes(upper)) {
    return upper;
  }
  throw new DomainError(
    "INVALID_INPUT",
    "status må være PENDING, ACCEPTED eller REJECTED."
  );
}

/**
 * BIN-646 (PR-B4): parse CSV-liste av statuser (f.eks. "ACCEPTED,REJECTED"
 * for historikk-visning). Returnerer unik liste eller undefined hvis tom.
 */
function parseStatuses(value: unknown): PaymentRequestStatus[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "statuses må være en streng (CSV).");
  }
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  const parsed: PaymentRequestStatus[] = [];
  for (const part of parts) {
    const s = parseStatus(part);
    if (s && !parsed.includes(s)) parsed.push(s);
  }
  return parsed.length ? parsed : undefined;
}

function parseDestinationType(
  value: unknown
): PaymentRequestDestinationType | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      "destinationType må være 'bank' eller 'hall'."
    );
  }
  const raw = value.trim().toLowerCase();
  if (raw === "bank" || raw === "hall") return raw;
  throw new DomainError(
    "INVALID_INPUT",
    "destinationType må være 'bank' eller 'hall'."
  );
}

function parsePositiveAmountCents(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    throw new DomainError("INVALID_INPUT", "amountCents må være et positivt heltall.");
  }
  return num;
}

function parseOptionalHallId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "hallId må være en streng.");
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function parseRejectionReason(value: unknown): string {
  const reason = mustBeNonEmptyString(value, "reason");
  if (reason.length > 500) {
    throw new DomainError(
      "INVALID_INPUT",
      "reason er for lang (maks 500 tegn)."
    );
  }
  return reason;
}

/**
 * GAP #10/#12: parse ISO-date-streng for `fromDate` / `toDate`-filter.
 * Aksepterer både `YYYY-MM-DD` og full ISO-8601 timestamp.
 */
function parseOptionalIsoDate(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være en ISO-8601 dato eller datotid.`
    );
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Tillat YYYY-MM-DD som shorthand → tolkes som UTC midnatt.
  const dateOnlyRe = /^\d{4}-\d{2}-\d{2}$/;
  const candidate = dateOnlyRe.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${fieldName} må være en ISO-8601 dato eller datotid.`
    );
  }
  return new Date(parsed).toISOString();
}

/**
 * GAP #10/#12: parse withdraw `type`-query.
 *   - "hall" / "bank" → filtrer på destination_type
 *   - "all" / undefined → ingen filter (begge)
 */
function parseWithdrawTypeFilter(
  value: unknown
): PaymentRequestDestinationType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "type må være 'hall', 'bank' eller 'all'.");
  }
  const raw = value.trim().toLowerCase();
  if (raw === "all") return undefined;
  if (raw === "bank" || raw === "hall") return raw;
  throw new DomainError("INVALID_INPUT", "type må være 'hall', 'bank' eller 'all'.");
}

/**
 * GAP #10: deposit-history støtter `?type=...` for senere kilde-skille
 * (Pay-in-Hall vs Vipps vs Card). I første versjon behandler vi alle
 * `app_deposit_requests`-rader som «cash-in-hall» (det er det som finnes
 * i tabellen i dag); en eksplisitt `type=hall` matcher derfor alle og
 * `type=vipps`/`type=card` returnerer tom liste. Dette holder API-en
 * stabil for fremtidige source-utvidelser uten å bryte klientene.
 */
function parseDepositTypeFilter(value: unknown): "hall" | "vipps" | "card" | "all" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError(
      "INVALID_INPUT",
      "type må være 'hall', 'vipps', 'card' eller 'all'."
    );
  }
  const raw = value.trim().toLowerCase();
  if (raw === "all" || raw === "hall" || raw === "vipps" || raw === "card") {
    return raw === "all" ? undefined : raw;
  }
  throw new DomainError(
    "INVALID_INPUT",
    "type må være 'hall', 'vipps', 'card' eller 'all'."
  );
}

function parseStatusList(value: unknown): PaymentRequestStatus[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng (CSV).");
  }
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  const out: PaymentRequestStatus[] = [];
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === "PENDING" || upper === "ACCEPTED" || upper === "REJECTED") {
      if (!out.includes(upper)) out.push(upper);
    } else {
      throw new DomainError(
        "INVALID_INPUT",
        "status må være PENDING, ACCEPTED eller REJECTED (CSV)."
      );
    }
  }
  return out;
}

function parseHistoryLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "limit må være et positivt heltall.");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new DomainError("INVALID_INPUT", "limit må være et positivt heltall.");
  }
  return Math.min(500, parsed);
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "cursor må være en streng.");
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function parseOptionalUserId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "playerId må være en streng.");
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Default CSV-eksport-tak: høyere enn paginerings-limit, men ikke ubegrenset. */
const CSV_EXPORT_LIMIT = 5000;

const HISTORY_CSV_COLUMNS: CsvColumn<PaymentRequest>[] = [
  { header: "id", accessor: (r) => r.id },
  { header: "kind", accessor: (r) => r.kind },
  { header: "status", accessor: (r) => r.status },
  { header: "userId", accessor: (r) => r.userId },
  { header: "walletId", accessor: (r) => r.walletId },
  { header: "amountCents", accessor: (r) => r.amountCents },
  { header: "hallId", accessor: (r) => r.hallId ?? "" },
  { header: "destinationType", accessor: (r) => r.destinationType ?? "" },
  { header: "submittedBy", accessor: (r) => r.submittedBy ?? "" },
  { header: "acceptedBy", accessor: (r) => r.acceptedBy ?? "" },
  { header: "acceptedAt", accessor: (r) => r.acceptedAt ?? "" },
  { header: "rejectedBy", accessor: (r) => r.rejectedBy ?? "" },
  { header: "rejectedAt", accessor: (r) => r.rejectedAt ?? "" },
  { header: "rejectionReason", accessor: (r) => r.rejectionReason ?? "" },
  { header: "walletTransactionId", accessor: (r) => r.walletTransactionId ?? "" },
  { header: "createdAt", accessor: (r) => r.createdAt },
  { header: "updatedAt", accessor: (r) => r.updatedAt },
];

function parseFormat(value: unknown): "json" | "csv" {
  if (value === undefined || value === null || value === "") return "json";
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "format må være 'json' eller 'csv'.");
  }
  const raw = value.trim().toLowerCase();
  if (raw === "json" || raw === "csv") return raw;
  throw new DomainError("INVALID_INPUT", "format må være 'json' eller 'csv'.");
}

export function createPaymentRequestsRouter(
  deps: PaymentRequestsRouterDeps
): express.Router {
  const { platformService, paymentRequestService, emitWalletRoomUpdates } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  async function requireAdminPermissionUser(
    req: express.Request,
    permission: AdminPermission,
    message?: string
  ): Promise<PublicAppUser> {
    const user = await getAuthenticatedUser(req);
    assertAdminPermission(user.role, permission, message);
    return user;
  }

  function extractTypeFromBody(body: unknown): PaymentRequestKind {
    if (!isRecordObject(body)) {
      throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
    }
    return parseKind(body.type);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  router.get("/api/admin/payments/requests", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "PAYMENT_REQUEST_READ");
      const typeRaw = typeof req.query.type === "string" ? req.query.type : undefined;
      const kind = typeRaw ? parseKind(typeRaw, "type") : undefined;
      // BIN-646 (PR-B4): støtt både `status` (single) og `statuses` (CSV).
      const statuses = parseStatuses(req.query.statuses);
      const status = parseStatus(req.query.status);
      const destinationType = parseDestinationType(req.query.destinationType);
      const hallIdRaw = typeof req.query.hallId === "string" ? req.query.hallId.trim() : "";
      const hallIdInput = hallIdRaw.length ? hallIdRaw : undefined;
      // BIN-591: HALL_OPERATOR tvinges til sin egen hall
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const limitRaw =
        typeof req.query.limit === "string" && req.query.limit.trim()
          ? Number(req.query.limit)
          : undefined;
      const limit =
        limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.floor(limitRaw)
          : undefined;
      const requests = await paymentRequestService.listPending({
        kind,
        status,
        statuses,
        destinationType,
        hallId,
        limit,
      });
      apiSuccess(res, { requests });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/payments/requests/:id/accept", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "PAYMENT_REQUEST_WRITE");
      const requestId = mustBeNonEmptyString(req.params.id, "id");
      const kind = extractTypeFromBody(req.body);

      // BIN-591: sjekk at HALL_OPERATOR eier forespørselens hall
      const existing = await paymentRequestService.getRequest(kind, requestId);
      if (existing.hallId) {
        assertUserHallScope(adminUser, existing.hallId);
      } else if (adminUser.role === "HALL_OPERATOR") {
        // Uten hall_id på requesten kan vi ikke hall-scope-sjekke — fail closed
        throw new DomainError(
          "FORBIDDEN",
          "Forespørselen er ikke bundet til en hall — kan ikke godkjennes av hall-operator."
        );
      }

      const result =
        kind === "deposit"
          ? await paymentRequestService.acceptDeposit({
              requestId,
              acceptedBy: adminUser.id,
            })
          : await paymentRequestService.acceptWithdraw({
              requestId,
              acceptedBy: adminUser.id,
            });

      await emitWalletRoomUpdates([result.walletId]);
      apiSuccess(res, { request: result });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/payments/requests/:id/reject", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "PAYMENT_REQUEST_WRITE");
      const requestId = mustBeNonEmptyString(req.params.id, "id");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const kind = parseKind(req.body.type);
      const reason = parseRejectionReason(req.body.reason);

      // BIN-591: samme hall-scope-sjekk som accept
      const existing = await paymentRequestService.getRequest(kind, requestId);
      if (existing.hallId) {
        assertUserHallScope(adminUser, existing.hallId);
      } else if (adminUser.role === "HALL_OPERATOR") {
        throw new DomainError(
          "FORBIDDEN",
          "Forespørselen er ikke bundet til en hall — kan ikke avvises av hall-operator."
        );
      }

      const result =
        kind === "deposit"
          ? await paymentRequestService.rejectDeposit({
              requestId,
              rejectedBy: adminUser.id,
              reason,
            })
          : await paymentRequestService.rejectWithdraw({
              requestId,
              rejectedBy: adminUser.id,
              reason,
            });

      apiSuccess(res, { request: result });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Admin history (GAP #10 + #12) ─────────────────────────────────────────
  //
  // GAP #10 (BACKEND_1TO1_GAP_AUDIT_2026-04-24 §1.5): admin deposit history
  // erstatter legacy `GET /deposit/history` + `/deposit/history/get`.
  //
  // GAP #12 (samme audit §1.5): admin withdraw history erstatter legacy
  // `GET /withdraw/history/hall` + `/withdraw/history/bank` + `*/get` —
  // konsolidert til ett endepunkt med `?type=hall|bank|all`.
  //
  // RBAC:
  //   - PAYMENT_REQUEST_READ (ADMIN, HALL_OPERATOR, SUPPORT)
  //   - HALL_OPERATOR auto-tvinges til egen hall via resolveHallScopeFilter.
  //
  // Pagination:
  //   - cursor-basert via base64url("{createdAtIso}|{id}") for stabilt
  //     resultat selv ved samtidige INSERTs.
  //
  // CSV-eksport: `?format=csv` returnerer text/csv (UTF-8 BOM + CRLF) for
  // Excel-NO-kompatibilitet. CSV-versjonen pagineres ikke — den henter
  // opp til CSV_EXPORT_LIMIT rader (5000) for at admin skal slippe å
  // klikke neste-side gjentatte ganger.

  router.get("/api/admin/deposits/history", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "PAYMENT_REQUEST_READ");
      const format = parseFormat(req.query.format);
      const fromDate = parseOptionalIsoDate(req.query.fromDate, "fromDate");
      const toDate = parseOptionalIsoDate(req.query.toDate, "toDate");
      const hallIdRaw = typeof req.query.hallId === "string" ? req.query.hallId.trim() : "";
      const hallIdInput = hallIdRaw.length ? hallIdRaw : undefined;
      // BIN-591: HALL_OPERATOR tvinges til sin egen hall.
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const statuses = parseStatusList(req.query.status);
      const playerId = parseOptionalUserId(req.query.playerId);
      // GAP #10: `type` er forberedelse for fremtidige innskudds-kilder.
      const depositType = parseDepositTypeFilter(req.query.type);
      const limit = parseHistoryLimit(req.query.limit);
      const cursor = parseOptionalCursor(req.query.cursor);

      // I dag er alle deposit-requests cash-i-hall. Vipps/Card har egne
      // routes (payments.ts) og treffer ikke denne tabellen — så for
      // `type=vipps` eller `type=card` returnerer vi en tom liste.
      if (depositType === "vipps" || depositType === "card") {
        if (format === "csv") {
          const csv = exportCsv([], HISTORY_CSV_COLUMNS, { bom: true });
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="deposit-history-${new Date().toISOString().slice(0, 10)}.csv"`
          );
          res.status(200).send(csv);
          return;
        }
        apiSuccess(res, { items: [], nextCursor: null });
        return;
      }

      if (format === "csv") {
        const result = await paymentRequestService.listHistory({
          kind: "deposit",
          statuses,
          hallId,
          userId: playerId,
          createdFrom: fromDate,
          createdTo: toDate,
          limit: CSV_EXPORT_LIMIT,
        });
        const csv = exportCsv(result.items, HISTORY_CSV_COLUMNS, { bom: true });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="deposit-history-${new Date().toISOString().slice(0, 10)}.csv"`
        );
        res.status(200).send(csv);
        return;
      }

      const result = await paymentRequestService.listHistory({
        kind: "deposit",
        statuses,
        hallId,
        userId: playerId,
        createdFrom: fromDate,
        createdTo: toDate,
        limit,
        cursor,
      });
      apiSuccess(res, { items: result.items, nextCursor: result.nextCursor });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/withdrawals/history", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "PAYMENT_REQUEST_READ");
      const format = parseFormat(req.query.format);
      const fromDate = parseOptionalIsoDate(req.query.fromDate, "fromDate");
      const toDate = parseOptionalIsoDate(req.query.toDate, "toDate");
      const hallIdRaw = typeof req.query.hallId === "string" ? req.query.hallId.trim() : "";
      const hallIdInput = hallIdRaw.length ? hallIdRaw : undefined;
      const hallId = resolveHallScopeFilter(adminUser, hallIdInput);
      const statuses = parseStatusList(req.query.status);
      const playerId = parseOptionalUserId(req.query.playerId);
      // GAP #12: `type=hall|bank|all` skiller hall-utbetaling fra bank-uttak.
      const destinationType = parseWithdrawTypeFilter(req.query.type);
      const limit = parseHistoryLimit(req.query.limit);
      const cursor = parseOptionalCursor(req.query.cursor);

      if (format === "csv") {
        const result = await paymentRequestService.listHistory({
          kind: "withdraw",
          statuses,
          hallId,
          userId: playerId,
          createdFrom: fromDate,
          createdTo: toDate,
          destinationType,
          limit: CSV_EXPORT_LIMIT,
        });
        const csv = exportCsv(result.items, HISTORY_CSV_COLUMNS, { bom: true });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="withdraw-history-${new Date().toISOString().slice(0, 10)}.csv"`
        );
        res.status(200).send(csv);
        return;
      }

      const result = await paymentRequestService.listHistory({
        kind: "withdraw",
        statuses,
        hallId,
        userId: playerId,
        createdFrom: fromDate,
        createdTo: toDate,
        destinationType,
        limit,
        cursor,
      });
      apiSuccess(res, { items: result.items, nextCursor: result.nextCursor });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Player ────────────────────────────────────────────────────────────────

  router.post("/api/payments/deposit-request", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const amountCents = parsePositiveAmountCents(req.body.amountCents);
      const hallId = parseOptionalHallId(req.body.hallId);
      const request = await paymentRequestService.createDepositRequest({
        userId: user.id,
        walletId: user.walletId,
        amountCents,
        hallId,
        submittedBy: user.id,
      });
      apiSuccess(res, { request });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/payments/withdraw-request", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const amountCents = parsePositiveAmountCents(req.body.amountCents);
      const hallId = parseOptionalHallId(req.body.hallId);
      // BIN-646 (PR-B4): bank/hall-valg på uttaksforespørsel.
      const destinationType = parseDestinationType(req.body.destinationType);
      const request = await paymentRequestService.createWithdrawRequest({
        userId: user.id,
        walletId: user.walletId,
        amountCents,
        hallId,
        submittedBy: user.id,
        destinationType,
      });
      apiSuccess(res, { request });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
