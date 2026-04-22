import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import {
  apiSuccess,
  apiFailure,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveInteger,
} from "../util/httpHelpers.js";
import type { AdminSubRouterDeps } from "./adminShared.js";

export function createAdminComplianceRouter(deps: AdminSubRouterDeps): express.Router {
  const {
    engine,
    emitWalletRoomUpdates,
    usePostgresBingoAdapter,
    localBingoAdapter,
    helpers,
  } = deps;
  const { auditAdmin, requireAdminPermissionUser } = helpers;
  const router = express.Router();

  // ── Wallet compliance (admin) ─────────────────────────────────────────────

  router.get("/api/admin/wallets/:walletId/compliance", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_READ");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const compliance = engine.getPlayerCompliance(walletId, hallId || undefined);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/wallets/:walletId/loss-limits", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      const dailyLossLimit = parseOptionalNonNegativeNumber(req.body?.dailyLossLimit, "dailyLossLimit");
      const monthlyLossLimit = parseOptionalNonNegativeNumber(req.body?.monthlyLossLimit, "monthlyLossLimit");
      if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
        throw new DomainError("INVALID_INPUT", "dailyLossLimit eller monthlyLossLimit må oppgis.");
      }
      const compliance = await engine.setPlayerLossLimits({
        walletId,
        hallId,
        daily: dailyLossLimit,
        monthly: monthlyLossLimit
      });
      auditAdmin(req, adminUser, "wallet.loss_limits.update", "wallet", walletId, {
        hallId,
        dailyLossLimit: dailyLossLimit ?? null,
        monthlyLossLimit: monthlyLossLimit ?? null,
      });
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/wallets/:walletId/timed-pause", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
      const compliance = await engine.setTimedPause({
        walletId,
        durationMinutes: durationMinutes ?? 15
      });
      auditAdmin(req, adminUser, "wallet.timed_pause.set", "wallet", walletId, {
        durationMinutes: durationMinutes ?? 15,
      });
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/wallets/:walletId/timed-pause", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const compliance = await engine.clearTimedPause(walletId);
      auditAdmin(req, adminUser, "wallet.timed_pause.clear", "wallet", walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const compliance = await engine.setSelfExclusion(walletId);
      auditAdmin(req, adminUser, "wallet.self_exclusion.set", "wallet", walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const compliance = await engine.clearSelfExclusion(walletId);
      auditAdmin(req, adminUser, "wallet.self_exclusion.clear", "wallet", walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Compliance ────────────────────────────────────────────────────────────

  router.get("/api/admin/compliance/extra-draw-denials", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "EXTRA_DRAW_DENIALS_READ");
      const limit = parseLimit(req.query.limit, 100);
      apiSuccess(res, engine.listExtraDrawDenials(limit));
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Prize policy ──────────────────────────────────────────────────────────

  router.get("/api/admin/prize-policy/active", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PRIZE_POLICY_READ");
      const hallId = mustBeNonEmptyString(req.query.hallId, "hallId");
      const linkId = typeof req.query.linkId === "string" ? req.query.linkId.trim() : undefined;
      const at = typeof req.query.at === "string" ? req.query.at.trim() : undefined;
      const policy = engine.getActivePrizePolicy({
        hallId,
        linkId,
        gameType: "DATABINGO",
        at
      });
      apiSuccess(res, policy);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.put("/api/admin/prize-policy", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "PRIZE_POLICY_WRITE");
      const hallId = typeof req.body?.hallId === "string" ? req.body.hallId : undefined;
      const linkId = typeof req.body?.linkId === "string" ? req.body.linkId : undefined;
      const policy = await engine.upsertPrizePolicy({
        gameType: "DATABINGO",
        hallId,
        linkId,
        effectiveFrom: mustBeNonEmptyString(req.body?.effectiveFrom, "effectiveFrom"),
        singlePrizeCap:
          req.body?.singlePrizeCap === undefined
            ? undefined
            : parseOptionalNonNegativeNumber(req.body?.singlePrizeCap, "singlePrizeCap"),
        dailyExtraPrizeCap:
          req.body?.dailyExtraPrizeCap === undefined
            ? undefined
            : parseOptionalNonNegativeNumber(req.body?.dailyExtraPrizeCap, "dailyExtraPrizeCap")
      });
      auditAdmin(req, adminUser, "prize_policy.update", "prize_policy", linkId ?? hallId ?? "global", {
        hallId: hallId ?? null,
        linkId: linkId ?? null,
        effectiveFrom: req.body?.effectiveFrom,
        fields: Object.keys(req.body ?? {}),
      });
      apiSuccess(res, policy);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/wallets/:walletId/extra-prize", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "EXTRA_PRIZE_AWARD");
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      const amount = mustBePositiveAmount(req.body?.amount);
      const linkId = typeof req.body?.linkId === "string" ? req.body.linkId : undefined;
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const result = await engine.awardExtraPrize({
        walletId,
        hallId,
        linkId,
        amount,
        reason
      });
      await emitWalletRoomUpdates([walletId]);
      auditAdmin(req, adminUser, "wallet.extra_prize.award", "wallet", walletId, {
        hallId,
        amount,
        linkId: linkId ?? null,
        reason: reason ?? null,
      });
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Payout audit ──────────────────────────────────────────────────────────

  router.get("/api/admin/payout-audit", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "PAYOUT_AUDIT_READ");
      const limit = parseLimit(req.query.limit, 100);
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const gameId = typeof req.query.gameId === "string" ? req.query.gameId.trim() : undefined;
      const walletId = typeof req.query.walletId === "string" ? req.query.walletId.trim() : undefined;
      const events = engine.listPayoutAuditTrail({
        limit,
        hallId,
        gameId,
        walletId
      });
      apiSuccess(res, events);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // BIN-173: Game replay endpoint — returns full checkpoint timeline for a game
  router.get("/api/admin/games/:gameId/replay", async (req, res) => {
    try {
      await requireAdminPermissionUser(req, "ADMIN_PANEL_ACCESS");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");

      if (!usePostgresBingoAdapter || !localBingoAdapter) {
        apiFailure(res, new DomainError("NOT_CONFIGURED", "Game checkpointing er ikke aktivert."));
        return;
      }

      const adapter = localBingoAdapter as { getGameSession: (id: string) => Promise<unknown>; getGameTimeline: (id: string) => Promise<unknown> };
      const session = await adapter.getGameSession(gameId);
      if (!session) {
        apiFailure(res, new DomainError("GAME_NOT_FOUND", `Spill ${gameId} finnes ikke.`));
        return;
      }

      const timeline = await adapter.getGameTimeline(gameId);
      apiSuccess(res, { session, timeline });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
