/**
 * BIN-583 B3.2: agent-transaksjons-endepunkter.
 *
 *   POST   /api/agent/players/lookup                       — søk spiller i hall
 *   GET    /api/agent/players/:id/balance                  — wallet-balance
 *   POST   /api/agent/players/:id/cash-in                  — add money (legacy)
 *   POST   /api/agent/players/:id/cash-out                 — withdraw (legacy)
 *   POST   /api/agent/transactions/add-money-user          — WF 17.7 add money
 *   POST   /api/agent/transactions/withdraw-user           — WF 17.8 withdraw
 *   GET    /api/agent/transactions/search-users?q=         — WF 17.7/17.8 autocomplete
 *   POST   /api/agent/tickets/register                     — digital ticket (stub)
 *   GET    /api/agent/physical/inventory                   — unsold tickets i hall
 *   POST   /api/agent/physical/sell                        — POS-salg
 *   POST   /api/agent/physical/sell/cancel                 — counter-tx (10-min-vindu)
 *   GET    /api/agent/transactions/today                   — nåværende shift
 *   GET    /api/agent/transactions                         — paginert historikk
 *   GET    /api/agent/transactions/:id                     — detail
 *
 * RBAC:
 *   - AGENT_CASH_WRITE for cash-in/out (inkl. add-money-user, withdraw-user)
 *   - AGENT_TICKET_WRITE for register / sell / cancel
 *   - AGENT_TX_READ for lookup / balance / inventory / list / detail /
 *     search-users
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentTransactionService } from "../agent/AgentTransactionService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-transactions-router" });

export interface AgentTransactionsRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentTransactionService: AgentTransactionService;
  auditLogService: AuditLogService;
}

function clientIp(req: express.Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: express.Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.trim() ? ua : null;
}

function parseOffset(value: unknown): number {
  if (typeof value !== "string") return 0;
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

function parsePaymentMethod(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "paymentMethod er påkrevd.");
  }
  const upper = value.toUpperCase();
  if (!allowed.includes(upper)) {
    throw new DomainError("INVALID_INPUT", `paymentMethod må være en av: ${allowed.join(", ")}.`);
  }
  return upper;
}

/**
 * Wireframe 17.7/17.8 bruker TitleCase ("Cash"/"Card") i payment-type-
 * dropdown — normaliserer derfor case-insensitivt men returnerer canonical
 * TitleCase for å matche DTOen i service-laget og admin-web-modalen.
 */
function parsePaymentType(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "paymentType er påkrevd.");
  }
  const lower = value.toLowerCase();
  for (const candidate of allowed) {
    if (candidate.toLowerCase() === lower) return candidate;
  }
  throw new DomainError("INVALID_INPUT", `paymentType må være en av: ${allowed.join(", ")}.`);
}

export function createAgentTransactionsRouter(deps: AgentTransactionsRouterDeps): express.Router {
  const { platformService, agentService, agentTransactionService, auditLogService } = deps;
  const router = express.Router();

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<{ userId: string; role: UserRole }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    // For AGENT-rollen: sjekk også at kontoen er aktiv.
    if (user.role === "AGENT") {
      await agentService.requireActiveAgent(user.id);
    }
    return { userId: user.id, role: user.role };
  }

  // ── POST /api/agent/players/lookup ──────────────────────────────────────
  router.post("/api/agent/players/lookup", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TX_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Lookup-endepunktet kan kun brukes av AGENT.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const query = mustBeNonEmptyString(body.query, "query");
      const players = await agentTransactionService.lookupPlayers(actor.userId, query);
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.player.lookup",
        resource: "user",
        resourceId: null,
        details: { query, resultCount: players.length },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, { players });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/players/:id/balance ──────────────────────────────────
  router.get("/api/agent/players/:id/balance", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TX_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Balance-lookup kan kun brukes av AGENT.");
      }
      const playerId = mustBeNonEmptyString(req.params.id, "id");
      const snapshot = await agentTransactionService.getPlayerBalance(actor.userId, playerId);
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/players/:id/cash-in ─────────────────────────────────
  router.post("/api/agent/players/:id/cash-in", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_CASH_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Cash-in kan kun utføres av AGENT.");
      }
      const playerId = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const amount = mustBePositiveAmount(body.amount, "amount");
      const paymentMethod = parsePaymentMethod(body.paymentMethod, ["CASH", "CARD"]);
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const tx = await agentTransactionService.cashIn({
        agentUserId: actor.userId,
        playerUserId: playerId,
        amount,
        paymentMethod: paymentMethod as "CASH" | "CARD",
        notes: typeof body.notes === "string" ? body.notes : undefined,
        externalReference: typeof body.externalReference === "string" ? body.externalReference : undefined,
        clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.cash.in",
        resource: "transaction",
        resourceId: tx.id,
        details: { playerId, amount, paymentMethod, hallId: tx.hallId, shiftId: tx.shiftId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, tx);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/players/:id/cash-out ────────────────────────────────
  router.post("/api/agent/players/:id/cash-out", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_CASH_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Cash-out kan kun utføres av AGENT.");
      }
      const playerId = mustBeNonEmptyString(req.params.id, "id");
      const body = isRecordObject(req.body) ? req.body : {};
      const amount = mustBePositiveAmount(body.amount, "amount");
      const paymentMethod = parsePaymentMethod(body.paymentMethod, ["CASH", "CARD"]);
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const tx = await agentTransactionService.cashOut({
        agentUserId: actor.userId,
        playerUserId: playerId,
        amount,
        paymentMethod: paymentMethod as "CASH" | "CARD",
        notes: typeof body.notes === "string" ? body.notes : undefined,
        externalReference: typeof body.externalReference === "string" ? body.externalReference : undefined,
        clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.cash.out",
        resource: "transaction",
        resourceId: tx.id,
        details: { playerId, amount, paymentMethod, hallId: tx.hallId, shiftId: tx.shiftId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, tx);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Wireframe 17.7 + 17.8: agent add-money / withdraw — registered user ─
  //
  // Forskjellen fra /api/agent/players/:id/cash-(in|out):
  //   - Target-user MÅ være PLAYER (service-guard kaster TARGET_NOT_PLAYER).
  //   - Beløp > 10 000 NOK får egen `agent.aml.high_value`-audit-entry.
  //   - Withdraw > 10 000 NOK krever `requireConfirm=true` på kallet.
  //   - Search-endepunktet gir PLAYER-autocomplete + wallet-saldo til
  //     `WithdrawRegisteredUserModal`.

  // ── POST /api/agent/transactions/add-money-user ─────────────────────────
  router.post("/api/agent/transactions/add-money-user", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_CASH_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Add-money-user kun for AGENT.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const targetUserId = mustBeNonEmptyString(body.targetUserId, "targetUserId");
      const amount = mustBePositiveAmount(body.amount, "amount");
      const paymentType = parsePaymentType(body.paymentType, ["Cash", "Card"]);
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const result = await agentTransactionService.addMoneyToUser({
        agentUserId: actor.userId,
        targetUserId,
        amount,
        paymentType: paymentType as "Cash" | "Card",
        notes: typeof body.notes === "string" ? body.notes : undefined,
        clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.cash_in_user",
        resource: "transaction",
        resourceId: result.transaction.id,
        details: {
          targetUserId,
          amount,
          paymentType,
          hallId: result.transaction.hallId,
          shiftId: result.transaction.shiftId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      if (result.amlFlagged) {
        void auditLogService.record({
          actorId: actor.userId,
          actorType: "AGENT",
          action: "agent.aml.high_value",
          resource: "transaction",
          resourceId: result.transaction.id,
          details: {
            flow: "add-money-user",
            amount,
            threshold: 10_000,
            targetUserId,
            hallId: result.transaction.hallId,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      }
      apiSuccess(res, { transaction: result.transaction, amlFlagged: result.amlFlagged });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/transactions/withdraw-user ──────────────────────────
  router.post("/api/agent/transactions/withdraw-user", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_CASH_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Withdraw-user kun for AGENT.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const targetUserId = mustBeNonEmptyString(body.targetUserId, "targetUserId");
      const amount = mustBePositiveAmount(body.amount, "amount");
      // Wireframe-spec: kun Cash på agent-uttak — bank-flow går via egen
      // amountwithdraw-route. Vi godtar "Cash" case-insensitivt.
      const paymentType = parsePaymentType(body.paymentType, ["Cash"]);
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const requireConfirm = body.requireConfirm === true;
      const result = await agentTransactionService.withdrawFromUser({
        agentUserId: actor.userId,
        targetUserId,
        amount,
        paymentType: paymentType as "Cash",
        notes: typeof body.notes === "string" ? body.notes : undefined,
        clientRequestId,
        requireConfirm,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.cash_out_user",
        resource: "transaction",
        resourceId: result.transaction.id,
        details: {
          targetUserId,
          amount,
          paymentType,
          hallId: result.transaction.hallId,
          shiftId: result.transaction.shiftId,
          requireConfirm,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      if (result.amlFlagged) {
        void auditLogService.record({
          actorId: actor.userId,
          actorType: "AGENT",
          action: "agent.aml.high_value",
          resource: "transaction",
          resourceId: result.transaction.id,
          details: {
            flow: "withdraw-user",
            amount,
            threshold: 10_000,
            targetUserId,
            hallId: result.transaction.hallId,
            confirmedByAgent: true,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        });
      }
      apiSuccess(res, { transaction: result.transaction, amlFlagged: result.amlFlagged });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/transactions/search-users?q=<prefix> ─────────────────
  router.get("/api/agent/transactions/search-users", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TX_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "User-search kun for AGENT.");
      }
      const q = typeof req.query?.q === "string" ? req.query.q : "";
      const users = await agentTransactionService.searchUsers(actor.userId, q);
      apiSuccess(res, { users, query: q });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/tickets/register ────────────────────────────────────
  router.post("/api/agent/tickets/register", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Digital ticket register kun for AGENT.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const playerUserId = mustBeNonEmptyString(body.playerUserId, "playerUserId");
      const gameId = mustBeNonEmptyString(body.gameId, "gameId");
      const ticketCount = typeof body.ticketCount === "number" ? body.ticketCount : 0;
      const pricePerTicketCents = typeof body.pricePerTicketCents === "number" ? body.pricePerTicketCents : 0;
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const tx = await agentTransactionService.registerDigitalTicket({
        agentUserId: actor.userId,
        playerUserId,
        gameId,
        ticketCount,
        pricePerTicketCents,
        clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.ticket.register",
        resource: "transaction",
        resourceId: tx.id,
        details: { playerUserId, gameId, ticketCount, hallId: tx.hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, tx);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/physical/inventory ───────────────────────────────────
  router.get("/api/agent/physical/inventory", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TX_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Inventory kun tilgjengelig for AGENT.");
      }
      const limit = parseLimit(req.query?.limit, 100);
      const offset = parseOffset(req.query?.offset);
      const tickets = await agentTransactionService.listPhysicalInventory(actor.userId, { limit, offset });
      apiSuccess(res, { tickets, limit, offset });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/physical/sell ───────────────────────────────────────
  router.post("/api/agent/physical/sell", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TICKET_WRITE");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Physical sell kun for AGENT.");
      }
      const body = isRecordObject(req.body) ? req.body : {};
      const playerUserId = mustBeNonEmptyString(body.playerUserId, "playerUserId");
      const ticketUniqueId = mustBeNonEmptyString(body.ticketUniqueId, "ticketUniqueId");
      const paymentMethod = parsePaymentMethod(body.paymentMethod, ["CASH", "CARD", "WALLET"]);
      const clientRequestId = mustBeNonEmptyString(body.clientRequestId, "clientRequestId");
      const tx = await agentTransactionService.sellPhysicalTicket({
        agentUserId: actor.userId,
        playerUserId,
        ticketUniqueId,
        paymentMethod: paymentMethod as "CASH" | "CARD" | "WALLET",
        clientRequestId,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.ticket.physical.sell",
        resource: "transaction",
        resourceId: tx.id,
        details: { playerUserId, ticketUniqueId, paymentMethod, amount: tx.amount, hallId: tx.hallId },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, tx);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── POST /api/agent/physical/sell/cancel ────────────────────────────────
  router.post("/api/agent/physical/sell/cancel", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TICKET_WRITE");
      const body = isRecordObject(req.body) ? req.body : {};
      const originalTxId = mustBeNonEmptyString(body.originalTxId, "originalTxId");
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      const cancel = await agentTransactionService.cancelPhysicalSale({
        agentUserId: actor.userId,
        agentRole: actor.role,
        originalTxId,
        reason,
      });
      void auditLogService.record({
        actorId: actor.userId,
        actorType: actor.role === "ADMIN" ? "ADMIN" : "AGENT",
        action: "agent.ticket.physical.cancel",
        resource: "transaction",
        resourceId: cancel.id,
        details: {
          relatedTxId: originalTxId,
          forceAdmin: actor.role === "ADMIN",
          reason,
          hallId: cancel.hallId,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });
      apiSuccess(res, cancel);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/transactions/today ───────────────────────────────────
  router.get("/api/agent/transactions/today", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TX_READ");
      if (actor.role !== "AGENT") {
        throw new DomainError("FORBIDDEN", "Today-log kun for AGENT — admin bruker /transactions.");
      }
      const limit = parseLimit(req.query?.limit, 100);
      const offset = parseOffset(req.query?.offset);
      const transactions = await agentTransactionService.listTransactionsForCurrentShift(actor.userId, {
        limit,
        offset,
      });
      apiSuccess(res, { transactions, limit, offset });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/transactions ─────────────────────────────────────────
  router.get("/api/agent/transactions", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TX_READ");
      const limit = parseLimit(req.query?.limit, 100);
      const offset = parseOffset(req.query?.offset);
      const filter: Parameters<AgentTransactionService["listTransactions"]>[0] = { limit, offset };
      // AGENT kan kun se egen logg.
      if (actor.role === "AGENT") {
        filter.agentUserId = actor.userId;
      } else {
        if (typeof req.query?.agentUserId === "string") filter.agentUserId = req.query.agentUserId;
        if (typeof req.query?.playerUserId === "string") filter.playerUserId = req.query.playerUserId;
        if (typeof req.query?.shiftId === "string") filter.shiftId = req.query.shiftId;
      }
      if (typeof req.query?.actionType === "string") {
        filter.actionType = req.query.actionType as Parameters<AgentTransactionService["listTransactions"]>[0]["actionType"];
      }
      const transactions = await agentTransactionService.listTransactions(filter);
      apiSuccess(res, { transactions, limit, offset });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/transactions/:id ─────────────────────────────────────
  router.get("/api/agent/transactions/:id", async (req, res) => {
    try {
      const actor = await requirePermission(req, "AGENT_TX_READ");
      const txId = mustBeNonEmptyString(req.params.id, "id");
      const tx = await agentTransactionService.getTransaction(txId);
      // AGENT kan kun se egne transaksjoner.
      if (actor.role === "AGENT" && tx.agentUserId !== actor.userId) {
        throw new DomainError("FORBIDDEN", "Du har ikke tilgang til denne transaksjonen.");
      }
      apiSuccess(res, tx);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("agent-transactions-router initialised (14 endpoints)");
  return router;
}
