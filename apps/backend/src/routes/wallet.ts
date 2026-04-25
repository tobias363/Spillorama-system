import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { SwedbankPayService } from "../payments/SwedbankPayService.js";
import type { VerifyTokenService } from "../auth/VerifyTokenService.js";
import { requireVerifyToken } from "../middleware/verifyToken.js";
import { buildPlayerReport, resolvePlayerReportRange, type PlayerReportPeriod } from "../spillevett/playerReport.js";
import { emailPlayerReport, generatePlayerReportPdf } from "../spillevett/reportExport.js";
import type { RoomSnapshot } from "../game/types.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  parseLimit,
  parseOptionalNonNegativeAmount,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveInteger,
  parsePlayerReportPeriod,
} from "../util/httpHelpers.js";

export interface WalletRouterDeps {
  platformService: PlatformService;
  engine: BingoEngine;
  walletAdapter: WalletAdapter;
  swedbankPayService: SwedbankPayService;
  emitWalletRoomUpdates: (walletIds: string[]) => Promise<void>;
  /**
   * GAP #35: når satt, krever sensitive endpoints (self-exclusion, og
   * loss-limit-senking) et gyldig verify-token i `X-Verify-Token`-headeren.
   * Når undefined hopper vi over verify-gating — for enkle integrasjons-
   * tester og for å unngå hard runtime-avhengighet. Prod wirer alltid.
   */
  verifyTokenService?: VerifyTokenService;
}

export function createWalletRouter(deps: WalletRouterDeps): express.Router {
  const {
    platformService,
    engine,
    walletAdapter,
    swedbankPayService,
    emitWalletRoomUpdates,
    verifyTokenService,
  } = deps;

  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  // GAP #35: factory som lager pre-action verify-middleware. Returnerer en
  // no-op middleware når verifyTokenService ikke er wired (typisk i enkle
  // unit-tester). Prod-deploy skal alltid wire verifyTokenService.
  function maybeRequireVerify(): express.RequestHandler {
    if (!verifyTokenService) {
      return (_req, _res, next) => next();
    }
    return requireVerifyToken({
      verifyTokenService,
      getAuthenticatedUserId: async (req) => {
        const user = await getAuthenticatedUser(req);
        return user.id;
      },
    });
  }

  async function buildAuthenticatedPlayerReport(input: {
    walletId: string;
    hallId?: string;
    period: PlayerReportPeriod;
    offset?: number;
    now?: Date;
  }): Promise<ReturnType<typeof buildPlayerReport>> {
    const halls = await platformService.listHalls({ includeInactive: false });
    const normalizedHallId = input.hallId?.trim() || undefined;
    if (normalizedHallId && !halls.some((hall) => hall.id === normalizedHallId)) {
      throw new DomainError("HALL_NOT_FOUND", "Valgt hall finnes ikke.");
    }

    const range = resolvePlayerReportRange(input.period, input.now ?? new Date(), input.offset ?? 0);
    const entries = engine.listComplianceLedgerEntries({
      limit: 10_000,
      dateFrom: range.from,
      dateTo: range.to,
      hallId: normalizedHallId,
      walletId: input.walletId
    });

    return buildPlayerReport({
      entries,
      halls,
      range,
      hallId: normalizedHallId
    });
  }

  // ── Wallet me ─────────────────────────────────────────────────────────────

  router.get("/api/wallet/me", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const account = await walletAdapter.getAccount(user.walletId);
      const transactions = await walletAdapter.listTransactions(user.walletId, 20);
      apiSuccess(res, { account, transactions });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/wallet/me/compliance", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const compliance = engine.getPlayerCompliance(user.walletId, hallId || undefined);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Spillevett reports ────────────────────────────────────────────────────

  router.get("/api/spillevett/report", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const period = parsePlayerReportPeriod(req.query.period, "month");
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const rawOffset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;
      const offset = isNaN(rawOffset) ? 0 : rawOffset;
      const report = await buildAuthenticatedPlayerReport({
        walletId: user.walletId,
        hallId,
        period,
        offset
      });
      apiSuccess(res, report);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/spillevett/report/export", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const period = parsePlayerReportPeriod(req.body?.period, "last365");
      const hallId = typeof req.body?.hallId === "string" ? req.body.hallId.trim() : undefined;
      const delivery =
        typeof req.body?.delivery === "string" && req.body.delivery.trim().toLowerCase() === "email"
          ? "email"
          : "download";
      const report = await buildAuthenticatedPlayerReport({
        walletId: user.walletId,
        hallId,
        period
      });
      const pdf = await generatePlayerReportPdf({
        report,
        playerName: user.displayName,
        playerEmail: user.email
      });

      if (delivery === "email") {
        const recipientEmail =
          typeof req.body?.email === "string" && req.body.email.trim().length > 0
            ? req.body.email.trim()
            : user.email;
        const result = await emailPlayerReport({
          report,
          playerName: user.displayName,
          playerEmail: user.email,
          recipientEmail,
          pdf
        });
        apiSuccess(res, {
          delivery: "email",
          recipientEmail: result.recipientEmail,
          period: report.range.period,
          generatedAt: report.generatedAt
        });
        return;
      }

      const filenameBase = report.hallId ? `spillregnskap-${report.hallId}` : "spillregnskap";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}-${report.range.period}.pdf"`);
      res.status(200).send(pdf);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Responsible gaming (self-service) ────────────────────────────────────

  router.post("/api/wallet/me/timed-pause", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
      const compliance = await engine.setTimedPause({
        walletId: user.walletId,
        durationMinutes: durationMinutes ?? 15
      });
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/wallet/me/timed-pause", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const compliance = await engine.clearTimedPause(user.walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // GAP #35: self-exclusion er en sensitiv handling (1-års-binding etter
  // legacy-paritet). Pre-action verify-token kreves når wired.
  router.post("/api/wallet/me/self-exclusion", maybeRequireVerify(), async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const compliance = await engine.setSelfExclusion(user.walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/wallet/me/self-exclusion", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const compliance = await engine.clearSelfExclusion(user.walletId);
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  /**
   * GAP #35: senking av loss-limits krever verify-token. Økning aktiveres
   * dag/måneds-grensen senere (ComplianceManager.setPlayerLossLimits) og er
   * ikke "umiddelbart sensitiv", men senking aktiveres med en gang og
   * påvirker spillerens evne til å spille — derfor pre-action-verify.
   *
   * Vi kjører verify-middleware kun når en faktisk senking detekteres mot
   * gjeldende state. Nyhetsverdi: sammenligner ny verdi mot getEffective-
   * LossLimits for hallId i ComplianceManager-snapshot. Hvis verifyTokenService
   * ikke er wired hopper vi over verify-gate (fail-open mot legacy-paritet
   * for manglende konfig — prod skal alltid wire).
   */
  router.put("/api/wallet/me/loss-limits", async (req, res, next) => {
    // Pre-handler: oppdag senking. Vi MÅ lese current state før middleware
    // konsumerer verify-tokenet, ellers vil et "raise"-kall feilaktig brenne
    // brukerens token. Derfor: hvis ingen senking → skip verify; hvis senking
    // → kall middleware manuelt og deretter handler.
    if (!verifyTokenService) {
      // Ingen verify-gate konfigurert; fall direkte til handler.
      next();
      return;
    }
    try {
      const user = await getAuthenticatedUser(req);
      const hallIdRaw =
        typeof req.body?.hallId === "string" ? req.body.hallId.trim() : "";
      if (!hallIdRaw) {
        // Validering vil feile i handleren; ikke krev verify her.
        next();
        return;
      }
      const dailyLossLimit = parseOptionalNonNegativeNumber(
        req.body?.dailyLossLimit,
        "dailyLossLimit"
      );
      const monthlyLossLimit = parseOptionalNonNegativeNumber(
        req.body?.monthlyLossLimit,
        "monthlyLossLimit"
      );
      const current = engine.getPlayerCompliance(user.walletId, hallIdRaw);
      const currentDaily = current.personalLossLimits?.daily;
      const currentMonthly = current.personalLossLimits?.monthly;
      const isLoweringDaily =
        dailyLossLimit !== undefined &&
        currentDaily !== undefined &&
        dailyLossLimit < currentDaily;
      const isLoweringMonthly =
        monthlyLossLimit !== undefined &&
        currentMonthly !== undefined &&
        monthlyLossLimit < currentMonthly;
      if (!isLoweringDaily && !isLoweringMonthly) {
        next();
        return;
      }
      // Senking detektert → krev verify-token.
      const middleware = requireVerifyToken({
        verifyTokenService,
        getAuthenticatedUserId: async () => user.id,
      });
      middleware(req, res, next);
    } catch (err) {
      apiFailure(res, err);
    }
  }, async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
      const dailyLossLimit = parseOptionalNonNegativeNumber(req.body?.dailyLossLimit, "dailyLossLimit");
      const monthlyLossLimit = parseOptionalNonNegativeNumber(req.body?.monthlyLossLimit, "monthlyLossLimit");
      if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
        throw new DomainError("INVALID_INPUT", "dailyLossLimit eller monthlyLossLimit må oppgis.");
      }
      const compliance = await engine.setPlayerLossLimits({
        walletId: user.walletId,
        hallId,
        daily: dailyLossLimit,
        monthly: monthlyLossLimit
      });
      apiSuccess(res, compliance);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/wallet/me/topup", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const amount = mustBePositiveAmount(req.body?.amount);
      const provider =
        typeof req.body?.provider === "string" && req.body.provider.trim()
          ? req.body.provider.trim().toLowerCase()
          : "manual";
      if (provider === "swedbank") {
        throw new DomainError(
          "SWEDBANK_FLOW_REQUIRED",
          "Bruk /api/payments/swedbank/topup-intent for Swedbank-betaling."
        );
      }
      const tx = await walletAdapter.topUp(
        user.walletId,
        amount,
        provider === "swedbank_simulated"
          ? "Swedbank top-up (simulated)"
          : "Manual top-up"
      );
      await emitWalletRoomUpdates([user.walletId]);
      apiSuccess(res, {
        provider,
        transaction: tx
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Admin wallet CRUD ─────────────────────────────────────────────────────

  router.get("/api/wallets", async (_req, res) => {
    try {
      const accounts = await walletAdapter.listAccounts();
      apiSuccess(res, accounts);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/wallets/:walletId", async (req, res) => {
    try {
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const account = await walletAdapter.getAccount(walletId);
      const transactions = await walletAdapter.listTransactions(walletId, 20);
      apiSuccess(res, { account, transactions });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/wallets", async (req, res) => {
    try {
      const walletId = typeof req.body?.walletId === "string" ? req.body.walletId.trim() : undefined;
      const initialBalance = parseOptionalNonNegativeAmount(req.body?.initialBalance, 1000);
      const account = await walletAdapter.createAccount({
        accountId: walletId || undefined,
        initialBalance,
        allowExisting: false
      });
      apiSuccess(res, account);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/wallets/:walletId/transactions", async (req, res) => {
    try {
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const limit = parseLimit(req.query.limit, 100);
      const transactions = await walletAdapter.listTransactions(walletId, limit);
      apiSuccess(res, transactions);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/wallets/:walletId/topup", async (req, res) => {
    try {
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const amount = mustBePositiveAmount(req.body?.amount);
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "Manual top-up";
      const tx = await walletAdapter.topUp(walletId, amount, reason);
      await emitWalletRoomUpdates([walletId]);
      apiSuccess(res, tx);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/wallets/:walletId/withdraw", async (req, res) => {
    try {
      const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
      const amount = mustBePositiveAmount(req.body?.amount);
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "Manual withdrawal";
      const tx = await walletAdapter.withdraw(walletId, amount, reason);
      await emitWalletRoomUpdates([walletId]);
      apiSuccess(res, tx);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/wallets/transfer", async (req, res) => {
    try {
      const fromWalletId = mustBeNonEmptyString(req.body?.fromWalletId, "fromWalletId");
      const toWalletId = mustBeNonEmptyString(req.body?.toWalletId, "toWalletId");
      const amount = mustBePositiveAmount(req.body?.amount);
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "Wallet transfer";
      // PR-W3 regulatorisk gate: denne generiske transfer-endepunktet (ikke
      // admin, men brukt via UI/API) skal ALDRI kunne lande beløp på
      // winnings-siden. Eneste lovlige kilde for targetSide='winnings' er
      // game-engine (BingoEngine/Game2/Game3 payout-path), som ikke går
      // gjennom HTTP-routeren. Vi leser IKKE targetSide fra body i det hele
      // tatt — hard-lock til default (deposit). Eksplisitt 403 hvis noen
      // sender det, for å matche W2 admin-credit-gate.
      if (req.body?.targetSide === "winnings") {
        res.status(403).json({
          ok: false,
          error: {
            code: "ADMIN_WINNINGS_TRANSFER_FORBIDDEN",
            message:
              "Transfer til winnings-siden er kun tillatt fra game-engine (pengespillforskriften §11). Bruk default (deposit) eller fjern targetSide-feltet.",
          },
        });
        return;
      }
      const transfer = await walletAdapter.transfer(fromWalletId, toWalletId, amount, reason);
      await emitWalletRoomUpdates([fromWalletId, toWalletId]);
      apiSuccess(res, transfer);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
