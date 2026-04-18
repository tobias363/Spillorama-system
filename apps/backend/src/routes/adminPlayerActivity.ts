/**
 * BIN-587 B5-rest: admin-view av spillers aktivitet.
 *
 * Endepunkter:
 *   GET /api/admin/players/:id/transactions  — wallet-transaksjoner
 *   GET /api/admin/players/:id/game-history  — ledger-entries (stakes/prizes)
 *
 * Begge er read-only; ingen audit-logging. Hall-scope for HALL_OPERATOR:
 * siden spillere ikke har hall-tilhørighet per tx, gir vi ADMIN/SUPPORT
 * tilgang men krever at HALL_OPERATOR spesifiserer hall-filter som
 * matcher egen hall.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import {
  assertAdminPermission,
  resolveHallScopeFilter,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  parseLimit,
} from "../util/httpHelpers.js";

export interface AdminPlayerActivityRouterDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  engine: BingoEngine;
}

export function createAdminPlayerActivityRouter(deps: AdminPlayerActivityRouterDeps): express.Router {
  const { platformService, walletAdapter, engine } = deps;
  const router = express.Router();

  async function requirePermission(req: express.Request, permission: AdminPermission): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  // GET /api/admin/players/:id/transactions?limit
  // Returnerer wallet-tx-historikk. Read-only; ingen audit.
  router.get("/api/admin/players/:id/transactions", async (req, res) => {
    try {
      await requirePermission(req, "PLAYER_KYC_READ");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const target = await platformService.getUserById(userId);
      if (target.role !== "PLAYER") {
        throw new DomainError("INVALID_INPUT", "Endepunktet er kun for spillere.");
      }
      const limit = parseLimit(req.query.limit, 100);
      const transactions = await walletAdapter.listTransactions(target.walletId, limit);
      apiSuccess(res, {
        userId: target.id,
        walletId: target.walletId,
        transactions,
        count: transactions.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GET /api/admin/players/:id/game-history?dateFrom&dateTo&hallId&limit
  // Ledger-entries (STAKE/PRIZE) filtrert på walletId for spilleren.
  router.get("/api/admin/players/:id/game-history", async (req, res) => {
    try {
      const actor = await requirePermission(req, "PLAYER_KYC_READ");
      const userId = mustBeNonEmptyString(req.params.id, "id");
      const target = await platformService.getUserById(userId);
      if (target.role !== "PLAYER") {
        throw new DomainError("INVALID_INPUT", "Endepunktet er kun for spillere.");
      }
      const hallIdInput =
        typeof req.query.hallId === "string" ? req.query.hallId.trim() || undefined : undefined;
      const hallId = resolveHallScopeFilter(actor, hallIdInput);
      const dateFrom =
        typeof req.query.dateFrom === "string" && req.query.dateFrom.trim()
          ? req.query.dateFrom.trim()
          : undefined;
      const dateTo =
        typeof req.query.dateTo === "string" && req.query.dateTo.trim()
          ? req.query.dateTo.trim()
          : undefined;
      const limit = parseLimit(req.query.limit, 200);
      const entries = engine.listComplianceLedgerEntries({
        walletId: target.walletId,
        hallId,
        dateFrom,
        dateTo,
        limit,
      });
      apiSuccess(res, {
        userId: target.id,
        walletId: target.walletId,
        entries,
        count: entries.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
