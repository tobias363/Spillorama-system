/**
 * GAME1_SCHEDULE PR 4a: public-facing router for ticket-purchase-foundation.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §4a.
 *
 * Endepunkter:
 *   POST /api/game1/purchase
 *     Auth: PLAYER-JWT (digital_wallet) eller AGENT-JWT (cash_agent | card_agent)
 *     Body:
 *       { scheduledGameId, buyerUserId, hallId, ticketSpec,
 *         paymentMethod, idempotencyKey }
 *       ticketSpec = Array<{ color, size, count, priceCentsEach }>
 *     Permission: GAME1_PURCHASE_WRITE
 *     Hall-scope: AGENT må tilhøre hallId (via user.hallId match).
 *     PLAYER må kjøpe på egne vegne (buyerUserId === user.id).
 *     Returns: 200 { purchaseId, totalAmountCents, alreadyExisted }
 *     Errors (HTTP 400):
 *       PURCHASE_CLOSED_FOR_GAME — status ≠ 'purchase_open'
 *       PURCHASE_CLOSED_FOR_HALL — bingovert har trykket klar
 *       INVALID_TICKET_SPEC      — farge/pris/størrelse feil
 *       MISSING_AGENT            — agent-betaling uten agent-identitet
 *       INSUFFICIENT_FUNDS       — wallet-debit feilet
 *
 *   POST /api/game1/purchase/:purchaseId/refund
 *     Auth: ADMIN-JWT
 *     Body: { reason }
 *     Permission: GAME1_PURCHASE_WRITE (ADMIN-delmengde)
 *     Returns: 200 { ok: true }
 *     Errors: PURCHASE_NOT_FOUND | CANNOT_REFUND_COMPLETED_GAME | REFUND_FAILED
 *
 *   GET /api/game1/purchase/game/:scheduledGameId
 *     Auth: GAME1_PURCHASE_READ (alle admin-roller + AGENT).
 *     AGENT/HALL_OPERATOR scopes til egen hall (filter i service-respons).
 *     Returns: 200 { purchases: [...] }
 *
 * AuditLog:
 *   Servicen skriver audit (game1_purchase.create + .refund). Routen logger
 *   IKKE parallell audit for å unngå duplikater.
 *
 * Socket-events:
 *   Ingen i PR 4a. PR 4b legger til ticket-count-broadcasts.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type {
  Game1PaymentMethod,
  Game1TicketPurchaseService,
  Game1TicketSpecEntry,
  Game1TicketSize,
} from "../game/Game1TicketPurchaseService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "game1-purchase-router" });

export interface Game1PurchaseRouterDeps {
  platformService: PlatformService;
  purchaseService: Game1TicketPurchaseService;
}

export function createGame1PurchaseRouter(
  deps: Game1PurchaseRouterDeps
): express.Router {
  const { platformService, purchaseService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  // ── POST /api/game1/purchase ─────────────────────────────────────────────

  router.post("/api/game1/purchase", async (req, res) => {
    try {
      const actor = await requirePermission(req, "GAME1_PURCHASE_WRITE");
      if (!isRecordObject(req.body)) {
        throw new DomainError(
          "INVALID_INPUT",
          "Payload må være et objekt."
        );
      }

      const scheduledGameId = mustBeNonEmptyString(
        req.body.scheduledGameId,
        "scheduledGameId"
      );
      const buyerUserId = mustBeNonEmptyString(
        req.body.buyerUserId,
        "buyerUserId"
      );
      const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");
      const paymentMethod = parsePaymentMethod(req.body.paymentMethod);
      const idempotencyKey = mustBeNonEmptyString(
        req.body.idempotencyKey,
        "idempotencyKey"
      );
      const ticketSpec = parseTicketSpec(req.body.ticketSpec);

      // Actor-scope:
      // PLAYER: må kjøpe på eget navn og bruke digital_wallet.
      // AGENT : må bruke cash_agent eller card_agent, og hallId må matche
      //         user.hallId (agentens shift-hall).
      // ADMIN : alt tillatt (support-ops / dev-tests).
      if (actor.role === "PLAYER") {
        if (paymentMethod !== "digital_wallet") {
          throw new DomainError(
            "FORBIDDEN",
            "Spillere kan kun kjøpe med digital_wallet."
          );
        }
        if (buyerUserId !== actor.id) {
          throw new DomainError(
            "FORBIDDEN",
            "Spiller kan kun kjøpe på egne vegne."
          );
        }
      } else if (actor.role === "AGENT") {
        if (
          paymentMethod !== "cash_agent" &&
          paymentMethod !== "card_agent"
        ) {
          throw new DomainError(
            "FORBIDDEN",
            "Agenter kan kun kjøpe med cash_agent eller card_agent."
          );
        }
        if (!actor.hallId || actor.hallId !== hallId) {
          throw new DomainError(
            "FORBIDDEN",
            "Agent kan kun selge billetter i egen hall."
          );
        }
      }

      const result = await purchaseService.purchase({
        scheduledGameId,
        buyerUserId,
        hallId,
        ticketSpec,
        paymentMethod,
        agentUserId:
          paymentMethod === "cash_agent" || paymentMethod === "card_agent"
            ? actor.id
            : undefined,
        idempotencyKey,
      });

      apiSuccess(res, {
        purchaseId: result.purchaseId,
        totalAmountCents: result.totalAmountCents,
        alreadyExisted: result.alreadyExisted,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/game1/purchase/:purchaseId/refund ──────────────────────────

  router.post(
    "/api/game1/purchase/:purchaseId/refund",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME1_PURCHASE_WRITE");
        if (actor.role !== "ADMIN") {
          throw new DomainError(
            "FORBIDDEN",
            "Kun ADMIN kan refundere purchase."
          );
        }
        const purchaseId = mustBeNonEmptyString(
          req.params.purchaseId,
          "purchaseId"
        );
        if (!isRecordObject(req.body)) {
          throw new DomainError(
            "INVALID_INPUT",
            "Payload må være et objekt."
          );
        }
        const reason = mustBeNonEmptyString(req.body.reason, "reason");

        await purchaseService.refundPurchase({
          purchaseId,
          reason,
          refundedByUserId: actor.id,
          refundedByActorType: "ADMIN",
        });

        apiSuccess(res, { ok: true });
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  // ── GET /api/game1/purchase/game/:scheduledGameId ────────────────────────

  router.get(
    "/api/game1/purchase/game/:scheduledGameId",
    async (req, res) => {
      try {
        const actor = await requirePermission(req, "GAME1_PURCHASE_READ");
        const scheduledGameId = mustBeNonEmptyString(
          req.params.scheduledGameId,
          "scheduledGameId"
        );

        const purchases = await purchaseService.listPurchasesForGame(
          scheduledGameId
        );

        // Hall-scope: AGENT/HALL_OPERATOR ser kun egen hall.
        const filtered =
          actor.role === "ADMIN" || actor.role === "SUPPORT"
            ? purchases
            : purchases.filter((p) => p.hallId === actor.hallId);

        apiSuccess(res, {
          scheduledGameId,
          purchases: filtered.map((p) => ({
            id: p.id,
            buyerUserId: p.buyerUserId,
            hallId: p.hallId,
            totalAmountCents: p.totalAmountCents,
            paymentMethod: p.paymentMethod,
            ticketSpec: p.ticketSpec,
            purchasedAt: p.purchasedAt,
            refundedAt: p.refundedAt,
            refundReason: p.refundReason,
          })),
        });
      } catch (error) {
        apiFailure(res, error);
      }
    }
  );

  return router;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

function parsePaymentMethod(raw: unknown): Game1PaymentMethod {
  if (
    raw === "digital_wallet" ||
    raw === "cash_agent" ||
    raw === "card_agent"
  ) {
    return raw;
  }
  throw new DomainError(
    "INVALID_INPUT",
    "paymentMethod må være digital_wallet, cash_agent eller card_agent."
  );
}

function parseTicketSpec(raw: unknown): Game1TicketSpecEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DomainError(
      "INVALID_TICKET_SPEC",
      "ticketSpec må være et ikke-tomt array."
    );
  }
  const out: Game1TicketSpecEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "ticketSpec-entry må være objekt."
      );
    }
    const e = entry as Record<string, unknown>;
    const color = typeof e.color === "string" ? e.color.trim() : "";
    if (!color) {
      throw new DomainError("INVALID_TICKET_SPEC", "color er påkrevd.");
    }
    const sizeRaw = typeof e.size === "string" ? e.size.toLowerCase() : "";
    const size: Game1TicketSize | null =
      sizeRaw === "small" || sizeRaw === "large" ? sizeRaw : null;
    if (!size) {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "size må være 'small' eller 'large'."
      );
    }
    const countRaw = e.count;
    const count = typeof countRaw === "number" ? countRaw : Number(countRaw);
    if (!Number.isInteger(count) || count < 1) {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "count må være positivt heltall."
      );
    }
    const priceRaw = e.priceCentsEach;
    const priceCentsEach =
      typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
    if (
      !Number.isInteger(priceCentsEach) ||
      priceCentsEach < 0
    ) {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "priceCentsEach må være ikke-negativt heltall."
      );
    }
    out.push({ color, size, count, priceCentsEach });
  }
  return out;
}

// exported for logger usage in dev
export const __forTesting = { logger };
