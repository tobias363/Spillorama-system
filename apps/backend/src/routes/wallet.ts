import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { WalletAccount, WalletAdapter } from "../adapters/WalletAdapter.js";
import type { SwedbankPayService } from "../payments/SwedbankPayService.js";
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
}

export function createWalletRouter(deps: WalletRouterDeps): express.Router {
  const {
    platformService,
    engine,
    walletAdapter,
    swedbankPayService,
    emitWalletRoomUpdates,
  } = deps;

  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
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
      const augmented = await augmentAccountWithReservations(walletAdapter, account);
      const transactions = await walletAdapter.listTransactions(user.walletId, 20);
      apiSuccess(res, { account: augmented, transactions });
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

  router.post("/api/wallet/me/self-exclusion", async (req, res) => {
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

  router.put("/api/wallet/me/loss-limits", async (req, res) => {
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
      const augmented = await augmentAccountWithReservations(walletAdapter, account);
      const transactions = await walletAdapter.listTransactions(walletId, 20);
      apiSuccess(res, { account: augmented, transactions });
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

/**
 * Wire-shape returnert av `GET /api/wallet/me` og `GET /api/wallets/:walletId`.
 *
 * Utvidelse av `WalletAccount` med reservasjons-aggregering — eksponerer hvor
 * mye av deposit-/winnings-saldoen som er "låst" av aktive pre-round-bong-
 * reservasjoner (BIN-693), så UI kan vise *tilgjengelig* saldo i header-chip
 * fremfor brutto-saldo som ble forvirrende etter PR #495 round-state-isolation.
 *
 * Felt-semantikk:
 * - `reserved*`           — sum av reservasjons-beløp som vil trekke fra hver side.
 *                          Beregnet med samme winnings-first-policy som `transfer()`
 *                          benytter ved commit, så split matcher faktisk debit.
 * - `available*`          — `*Balance - reserved*`, klemmet til ikke-negativ.
 * - `availableBalance`    — total tilgjengelig saldo (= `availableDeposit + availableWinnings`).
 *
 * Brutto-feltene (`balance`, `depositBalance`, `winningsBalance`) er uendret —
 * "Lommebok"-detalj-siden viser fortsatt total inkl. reservasjoner som riktig
 * regnskaps-info; det er kun header-chip-en som skal vise *tilgjengelig*.
 */
export interface WalletAccountWithReservations extends WalletAccount {
  /** Sum av aktive reservasjoner som vil trekke fra deposit-siden ved commit. */
  reservedDeposit: number;
  /** Sum av aktive reservasjoner som vil trekke fra winnings-siden ved commit. */
  reservedWinnings: number;
  /** depositBalance - reservedDeposit, klemmet til ikke-negativ. */
  availableDeposit: number;
  /** winningsBalance - reservedWinnings, klemmet til ikke-negativ. */
  availableWinnings: number;
  /** availableDeposit + availableWinnings. */
  availableBalance: number;
}

/**
 * Aggreger aktive reservasjoner og bygg ut wallet-account med
 * available-/reserved-felt for UI-visning.
 *
 * Vi simulerer winnings-first-policy fra `splitDebit()` for å forutse hvilken
 * side reservasjonen kommer til å trekke fra ved commit:
 *
 *   reservedFromWinnings = min(winningsBalance, totalReserved)
 *   reservedFromDeposit  = totalReserved - reservedFromWinnings
 *
 * Dette matcher `WalletAdapter.transfer()` sin avsender-side oppførsel — så
 * UI viser samme split som faktisk debit gjør ved commit.
 *
 * Adaptere uten reservasjons-støtte (HttpWalletAdapter, eldre adapter-versjoner)
 * får 0 i alle reservasjons-felt — `available*` blir lik `*Balance` og
 * oppførselen er bakover-kompatibel.
 */
async function augmentAccountWithReservations(
  walletAdapter: WalletAdapter,
  account: WalletAccount
): Promise<WalletAccountWithReservations> {
  let totalReserved = 0;
  if (typeof walletAdapter.listActiveReservations === "function") {
    try {
      const reservations = await walletAdapter.listActiveReservations(account.id);
      for (const r of reservations) {
        totalReserved += r.amount;
      }
    } catch {
      // Adaptere som ikke støtter reservasjoner kaster — fall tilbake til 0.
      totalReserved = 0;
    }
  }

  // Winnings-first: matcher splitDebit() i InMemoryWalletAdapter.
  const reservedFromWinnings = Math.min(account.winningsBalance, totalReserved);
  const reservedFromDeposit = totalReserved - reservedFromWinnings;

  const availableDeposit = Math.max(0, account.depositBalance - reservedFromDeposit);
  const availableWinnings = Math.max(0, account.winningsBalance - reservedFromWinnings);
  const availableBalance = availableDeposit + availableWinnings;

  return {
    ...account,
    reservedDeposit: reservedFromDeposit,
    reservedWinnings: reservedFromWinnings,
    availableDeposit,
    availableWinnings,
    availableBalance,
  };
}
