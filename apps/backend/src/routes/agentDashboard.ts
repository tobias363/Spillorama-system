/**
 * Agent dashboard + player-list + player-export.
 *
 * Endpoints (AGENT-rolle):
 *   GET /api/agent/dashboard                 — aggregat: current shift, cash-totals, counts
 *   GET /api/agent/players                   — liste spillere i agentens nåværende hall
 *   GET /api/agent/players/:id/export.csv    — CSV-eksport for én spiller (regulatorisk)
 *
 * Erstatter legacy-kontrollerens dashboard-flate (AgentController.playerProfileExport
 * og getAllPlayers). Legacy returnerte dashboards-side-rendering via EJS; dette API-et
 * leverer rent JSON som admin-UI-shell kan rendre.
 *
 * Auth-flyt: samme AGENT_TX_READ-permission som `agentTransactions.ts` bruker for
 * lookup/balance — AGENT kan kun se data for egen shift + egen hall. ADMIN +
 * HALL_OPERATOR + SUPPORT har samme tilgang via AdminAccessPolicy, men disse rollene
 * bruker `/api/admin/players` for bredere tilgang. Her vi avviser ADMIN med
 * FORBIDDEN slik at flaten står som agent-spesifikk (unngår at admin ved et uhell
 * bruker agent-endepunktene).
 *
 * Audit: player-export logges (inneholder PII); dashboard/list er ikke-destructive read.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import type { AgentService } from "../agent/AgentService.js";
import type { AgentShiftService } from "../agent/AgentShiftService.js";
import type { AgentTransactionStore } from "../agent/AgentTransactionStore.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
} from "../util/httpHelpers.js";
import { exportCsv, type CsvColumn } from "../util/csvExport.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-dashboard-router" });

export interface AgentDashboardRouterDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  agentTransactionStore: AgentTransactionStore;
  auditLogService: AuditLogService;
}

interface DashboardResponse {
  agent: {
    userId: string;
    email: string;
    displayName: string;
  };
  shift: {
    id: string;
    hallId: string;
    startedAt: string;
    endedAt: string | null;
    dailyBalance: number;
    totalCashIn: number;
    totalCashOut: number;
    totalCardIn: number;
    totalCardOut: number;
    sellingByCustomerNumber: number;
    hallCashBalance: number;
    settledAt: string | null;
  } | null;
  counts: {
    transactionsToday: number;
    playersInHall: number | null;
    activeShiftsInHall: number | null;
  };
  recentTransactions: Array<{
    id: string;
    actionType: string;
    amount: number;
    paymentMethod: string;
    createdAt: string;
  }>;
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

export function createAgentDashboardRouter(deps: AgentDashboardRouterDeps): express.Router {
  const {
    platformService,
    agentService,
    agentShiftService,
    agentTransactionStore,
    auditLogService,
  } = deps;
  const router = express.Router();

  async function requireAgentPermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<{ userId: string; role: UserRole; email: string; displayName: string }> {
    const token = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(token);
    assertAdminPermission(user.role, permission);
    if (user.role !== "AGENT") {
      throw new DomainError(
        "FORBIDDEN",
        "Agent-dashboard-endepunktene er kun tilgjengelig for AGENT-rollen."
      );
    }
    await agentService.requireActiveAgent(user.id);
    return {
      userId: user.id,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
    };
  }

  // ── GET /api/agent/dashboard ────────────────────────────────────────────
  router.get("/api/agent/dashboard", async (req, res) => {
    try {
      const actor = await requireAgentPermission(req, "AGENT_TX_READ");
      const shift = await agentShiftService.getCurrentShift(actor.userId);

      let transactionsToday = 0;
      let recentTransactions: Array<{
        id: string;
        actionType: string;
        amount: number;
        paymentMethod: string;
        createdAt: string;
      }> = [];
      let playersInHall: number | null = null;
      let activeShiftsInHall: number | null = null;

      if (shift) {
        const txs = await agentTransactionStore.list({
          shiftId: shift.id,
          limit: 1000,
        });
        transactionsToday = txs.length;
        recentTransactions = txs.slice(0, 10).map((t) => ({
          id: t.id,
          actionType: t.actionType,
          amount: t.amount,
          paymentMethod: t.paymentMethod,
          createdAt: t.createdAt,
        }));

        try {
          const activeShifts = await agentShiftService.listActiveInHall(shift.hallId);
          activeShiftsInHall = activeShifts.length;
        } catch {
          // Ikke-kritisk — la være null hvis hall-query feiler.
        }

        try {
          const players = await platformService.listPlayersForExport({
            hallId: shift.hallId,
            limit: 5000,
          });
          playersInHall = players.length;
        } catch {
          // Ikke-kritisk.
        }
      }

      const response: DashboardResponse = {
        agent: {
          userId: actor.userId,
          email: actor.email,
          displayName: actor.displayName,
        },
        shift: shift
          ? {
              id: shift.id,
              hallId: shift.hallId,
              startedAt: shift.startedAt,
              endedAt: shift.endedAt,
              dailyBalance: shift.dailyBalance,
              totalCashIn: shift.totalCashIn,
              totalCashOut: shift.totalCashOut,
              totalCardIn: shift.totalCardIn,
              totalCardOut: shift.totalCardOut,
              sellingByCustomerNumber: shift.sellingByCustomerNumber,
              hallCashBalance: shift.hallCashBalance,
              settledAt: shift.settledAt,
            }
          : null,
        counts: {
          transactionsToday,
          playersInHall,
          activeShiftsInHall,
        },
        recentTransactions,
      };
      apiSuccess(res, response);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/players ──────────────────────────────────────────────
  //
  // Lister spillere i agentens nåværende hall (via shift). ADMIN kan ikke
  // bruke dette endepunktet (bruker /api/admin/players). Krever aktiv shift
  // slik at vi vet hvilken hall agenten opererer i — ellers NO_ACTIVE_SHIFT.
  router.get("/api/agent/players", async (req, res) => {
    try {
      const actor = await requireAgentPermission(req, "AGENT_TX_READ");
      const shift = await agentShiftService.getCurrentShift(actor.userId);
      if (!shift) {
        throw new DomainError(
          "NO_ACTIVE_SHIFT",
          "Du må åpne en shift før du kan se spiller-listen."
        );
      }
      const limit = parseLimit(req.query?.limit, 100);

      // Hvis klient sender en fritekst-query så bruker vi searchPlayersInHall,
      // ellers bruker vi listPlayersForExport for full liste i hallen.
      const queryRaw = typeof req.query?.query === "string" ? req.query.query.trim() : "";
      let players;
      if (queryRaw.length >= 2) {
        players = await platformService.searchPlayersInHall({
          query: queryRaw,
          hallId: shift.hallId,
          limit,
        });
      } else {
        players = await platformService.listPlayersForExport({
          hallId: shift.hallId,
          limit,
        });
      }

      apiSuccess(res, {
        hallId: shift.hallId,
        players: players.map((p) => ({
          id: p.id,
          email: p.email,
          displayName: p.displayName,
          surname: p.surname ?? null,
          phone: p.phone ?? null,
          kycStatus: p.kycStatus,
          createdAt: p.createdAt,
        })),
        count: players.length,
        limit,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── GET /api/agent/players/:id/export.csv ───────────────────────────────
  //
  // CSV-eksport for én spiller — matcher legacy `playerProfileExport`. Inneholder
  // grunndata + transaksjons-aggregater for agentens nåværende shift (mer data
  // krever hall-report via admin-flyt). Spilleren må være ACTIVE i agentens hall.
  router.get("/api/agent/players/:id/export.csv", async (req, res) => {
    try {
      const actor = await requireAgentPermission(req, "AGENT_TX_READ");
      const shift = await agentShiftService.getCurrentShift(actor.userId);
      if (!shift) {
        throw new DomainError(
          "NO_ACTIVE_SHIFT",
          "Du må åpne en shift før du kan eksportere spillerdata."
        );
      }
      const playerId = mustBeNonEmptyString(req.params.id, "id");

      // Verifiser at spilleren er i agentens hall (fail-closed).
      const inHall = await platformService.isPlayerActiveInHall(playerId, shift.hallId);
      if (!inHall) {
        throw new DomainError(
          "PLAYER_NOT_AT_HALL",
          "Spilleren er ikke aktiv i agentens hall."
        );
      }

      const player = await platformService.getUserById(playerId);
      const txs = await agentTransactionStore.list({
        shiftId: shift.id,
        playerUserId: playerId,
        limit: 500,
      });

      // Aggregater for CSV-header-summary.
      let totalCashIn = 0;
      let totalCashOut = 0;
      let ticketSaleCount = 0;
      for (const tx of txs) {
        if (tx.actionType === "CASH_IN") totalCashIn += tx.amount;
        if (tx.actionType === "CASH_OUT") totalCashOut += tx.amount;
        if (tx.actionType === "TICKET_SALE") ticketSaleCount += 1;
      }

      type Row = {
        id: string;
        actionType: string;
        paymentMethod: string;
        amount: number;
        previousBalance: number;
        afterBalance: number;
        createdAt: string;
      };
      const columns: CsvColumn<Row>[] = [
        { header: "transactionId", accessor: (r) => r.id },
        { header: "actionType", accessor: (r) => r.actionType },
        { header: "paymentMethod", accessor: (r) => r.paymentMethod },
        { header: "amount", accessor: (r) => r.amount },
        { header: "previousBalance", accessor: (r) => r.previousBalance },
        { header: "afterBalance", accessor: (r) => r.afterBalance },
        { header: "createdAt", accessor: (r) => r.createdAt },
      ];

      // Header-seksjonen er ren metadata i CSV-format (én "summary"-seksjon
      // før transaksjons-tabellen). Vi legger summary-linjer på toppen og
      // deretter tom rad før transaksjons-headerne — matcher legacy som
      // fikk `fields.concat(properData)` med et newline mellom.
      const summaryColumns: CsvColumn<{ key: string; value: string | number }>[] = [
        { header: "field", accessor: (r) => r.key },
        { header: "value", accessor: (r) => r.value },
      ];
      const summaryRows: Array<{ key: string; value: string | number }> = [
        { key: "playerId", value: player.id },
        { key: "displayName", value: player.displayName },
        { key: "email", value: player.email },
        { key: "phone", value: player.phone ?? "" },
        { key: "kycStatus", value: player.kycStatus },
        { key: "exportedByAgentId", value: actor.userId },
        { key: "exportedAt", value: new Date().toISOString() },
        { key: "shiftId", value: shift.id },
        { key: "hallId", value: shift.hallId },
        { key: "transactionCount", value: txs.length },
        { key: "totalCashIn", value: totalCashIn },
        { key: "totalCashOut", value: totalCashOut },
        { key: "ticketSaleCount", value: ticketSaleCount },
      ];

      const summaryCsv = exportCsv(summaryRows, summaryColumns, { bom: true });
      const txCsv = exportCsv(txs, columns);
      const body = `${summaryCsv}\r\n${txCsv}`;

      // Audit-logg PII-eksporten — regulatorisk krav.
      void auditLogService.record({
        actorId: actor.userId,
        actorType: "AGENT",
        action: "agent.player.export",
        resource: "user",
        resourceId: playerId,
        details: {
          hallId: shift.hallId,
          shiftId: shift.id,
          transactionCount: txs.length,
        },
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
      });

      const safeName = (player.displayName || "player")
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .slice(0, 40);
      const filename = `agent-player-${safeName}-${playerId.slice(0, 8)}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(body);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  logger.info("agent-dashboard-router initialised (3 endpoints)");
  return router;
}
