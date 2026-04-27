/**
 * GAP #16 (BACKEND_1TO1_GAP_AUDIT_2026-04-24): manual winning admin override.
 *
 * Endpoint:
 *   POST /api/admin/games/:gameId/manual-winning
 *
 * Body:
 *   {
 *     playerId: string,        // user-id (vinneren)
 *     hallId: string,          // hallen som "eier" prize-konteksten (regulatorisk hall-binding)
 *     amount: number,          // utbetalingsbeløp i kroner
 *     reason: string,          // begrunnelse (revisjons-spor, min 10 tegn)
 *     ticketId?: string,       // referanse til ticket hvis manual-winning gjelder en spesifikk billett
 *   }
 *
 * Use case:
 *   Admin må manuelt registrere en gevinst som ikke ble registrert via
 *   ordinær spill-flow — typisk når et fysisk bingo-kort vinner offline,
 *   eller en regelfortolkning gir spilleren rett til etterhåndsutbetaling.
 *
 * Regulatorisk gate (KRITISK — pengespillforskriften §11):
 *   ADMIN_WINNINGS_CREDIT_FORBIDDEN — admin kan ALDRI direktekreditere til
 *   spillerens winnings-balance via `adminWallet.credit`. Manual winning må
 *   gå via en LEGITIM payout-mekanisme (samme prinsipp som
 *   `Game1PayoutService.payoutPhase`):
 *
 *     1) Penger transfereres fra hallens house-account til spillerens
 *        winnings-side via `WalletAdapter.transfer({ targetSide: "winnings" })`
 *        — ikke direkte admin-credit.
 *     2) En EXTRA_PRIZE-entry skrives til ComplianceLedger med korrekt
 *        hallId-binding (regulatorisk-presis §71-rapport).
 *     3) Daglig prize-cap + single-prize-cap håndheves av PrizePolicy.
 *
 *   Vi gjenbruker `BingoEngine.awardExtraPrize` som allerede implementerer
 *   alle disse stegene atomisk. Den er gated av `EXTRA_PRIZE_AWARD`
 *   (ADMIN-only) — som matcher kravet i denne oppgaven om strict admin-only.
 *
 * Tilgang: EXTRA_PRIZE_AWARD (ADMIN-only). HALL_OPERATOR + SUPPORT er
 * eksplisitt utelatt — manual winning er sentralt admin-ansvar med direkte
 * regulatorisk-konsekvens.
 *
 * Audit:
 *   - awardExtraPrize logger payout-audit-event (kind=EXTRA_PRIZE) automatisk.
 *   - Vi legger PÅ et ekstra audit-log-event ("admin.game.manual_winning")
 *     med gameId + ticketId + reason for full revisjons-sporbarhet.
 *
 * Legacy reference:
 *   `legacy/unity-backend/App/Controllers/scheduleController.js:4651-4964`
 *   (`addWinningManual`). Legacy var fokusert på fysisk-billett-cashout via
 *   agent-saldo med direkte ticket-mutering. Ny stack abstrakter prize-engine
 *   under `awardExtraPrize`; ticket-paritet kommer evt. som separat feature
 *   hvis pilot-hall trenger det.
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
  mustBePositiveAmount,
  isRecordObject,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-game-oversight" });

/** Minimum begrunnelses-lengde — matcher KYC_REJECT_REASON_MIN_LENGTH-mønsteret. */
export const MANUAL_WINNING_REASON_MIN_LENGTH = 10;
/** Maks-lengde på reason — beskytter audit-log-databasen. */
const MANUAL_WINNING_REASON_MAX_LENGTH = 500;

export interface AdminGameOversightRouterDeps {
  platformService: PlatformService;
  /** Engine for `awardExtraPrize` (legitim payout-flow). */
  engine: BingoEngine;
  /** AuditLog for ekstra "admin.game.manual_winning"-rad. */
  auditLogService: AuditLogService;
  /** Notifiser web-shell om saldo-endring (socket-fanout). */
  emitWalletRoomUpdates?: (walletIds: string[]) => Promise<void>;
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

function parseReason(raw: unknown): string {
  const s = mustBeNonEmptyString(raw, "reason");
  if (s.length < MANUAL_WINNING_REASON_MIN_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `reason må være minst ${MANUAL_WINNING_REASON_MIN_LENGTH} tegn (revisjons-krav).`
    );
  }
  if (s.length > MANUAL_WINNING_REASON_MAX_LENGTH) {
    throw new DomainError(
      "INVALID_INPUT",
      `reason er for lang (maks ${MANUAL_WINNING_REASON_MAX_LENGTH} tegn).`
    );
  }
  return s;
}

export function createAdminGameOversightRouter(
  deps: AdminGameOversightRouterDeps
): express.Router {
  const {
    platformService,
    engine,
    auditLogService,
    emitWalletRoomUpdates,
  } = deps;
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

  /**
   * POST /api/admin/games/:gameId/manual-winning
   *
   * Strict ADMIN-only (EXTRA_PRIZE_AWARD). Body validert per kontrakt
   * over. Returnerer 200 med awardExtraPrize-resultatet (inneholder
   * remainingDailyExtraPrizeLimit som UI kan bruke til å vise
   * compliance-headroom).
   *
   * Feilkoder:
   *   - UNAUTHORIZED / FORBIDDEN: rolle-gate.
   *   - INVALID_INPUT: validering (gameId, playerId, hallId, amount, reason).
   *   - PRIZE_POLICY_VIOLATION: amount overstiger singlePrizeCap.
   *   - EXTRA_PRIZE_DAILY_LIMIT_EXCEEDED: dailyExtraPrizeCap overskredet.
   *   - NOT_FOUND: ukjent playerId.
   */
  router.post("/api/admin/games/:gameId/manual-winning", async (req, res) => {
    try {
      const actor = await requirePermission(req, "EXTRA_PRIZE_AWARD");
      const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");
      if (!isRecordObject(req.body)) {
        throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
      }
      const playerId = mustBeNonEmptyString(req.body.playerId, "playerId");
      const hallId = mustBeNonEmptyString(req.body.hallId, "hallId");
      const amount = mustBePositiveAmount(req.body.amount);
      const reason = parseReason(req.body.reason);
      const ticketId =
        typeof req.body.ticketId === "string" && req.body.ticketId.trim()
          ? req.body.ticketId.trim()
          : null;

      // Slå opp spiller for å få walletId. Fail-closed hvis ukjent eller
      // ikke en player-rolle (f.eks. en admin-bruker kan ikke "vinne").
      const target = await platformService.getUserById(playerId);
      if (target.role !== "PLAYER") {
        throw new DomainError(
          "INVALID_INPUT",
          "Manual winning kan kun krediteres til en spiller-konto."
        );
      }

      // KRITISK: kall awardExtraPrize — IKKE direkte wallet.credit.
      // awardExtraPrize ruter pengene via wallet.transfer({ targetSide:
      // "winnings" }) gjennom prize-engine, og skriver EXTRA_PRIZE-entry
      // til ComplianceLedger atomisk. Dette er den eneste lovlige veien
      // for at "ekstra premie" kan lande på winnings-siden uten å bryte
      // ADMIN_WINNINGS_CREDIT_FORBIDDEN-regelen.
      //
      // linkId = gameId — knytter prize-policy-scope til denne game-konteksten.
      const result = await engine.awardExtraPrize({
        walletId: target.walletId,
        hallId,
        linkId: gameId,
        amount,
        reason,
      });

      if (emitWalletRoomUpdates) {
        await emitWalletRoomUpdates([target.walletId]).catch((err) => {
          logger.warn(
            { err, walletId: target.walletId },
            "[GAP #16] emitWalletRoomUpdates failed — continuing"
          );
        });
      }

      // Ekstra audit-log-rad: awardExtraPrize logger payout-audit-event
      // automatisk, men vi vil ha en SEPARAT rad i app_audit_log med
      // explisitt action-navn slik at "manual winning"-saker er trivielle
      // å filtrere fra kompliance-rapporter.
      auditLogService
        .record({
          actorId: actor.id,
          actorType: "ADMIN",
          action: "admin.game.manual_winning",
          resource: "game",
          resourceId: gameId,
          details: {
            gameId,
            playerId,
            walletId: target.walletId,
            hallId,
            amount,
            reason,
            ticketId,
            policyId: result.policyId,
            remainingDailyExtraPrizeLimit:
              result.remainingDailyExtraPrizeLimit,
          },
          ipAddress: clientIp(req),
          userAgent: userAgent(req),
        })
        .catch((err) => {
          logger.warn(
            { err, gameId, playerId, hallId, amount },
            "[GAP #16] audit-log append failed (non-blocking)"
          );
        });

      apiSuccess(res, {
        gameId,
        playerId: target.id,
        walletId: target.walletId,
        hallId,
        amount: result.amount,
        ticketId,
        policyId: result.policyId,
        remainingDailyExtraPrizeLimit: result.remainingDailyExtraPrizeLimit,
        reason,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
