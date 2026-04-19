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
