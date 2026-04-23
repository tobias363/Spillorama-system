/**
 * GAME1_SCHEDULE PR 4c Bolk 2: Game1PayoutService.
 *
 * Håndterer utbetaling til fase-vinnere i Spill 1 scheduled-games:
 *
 *   1) Split-rounding: totalPrize/numWinners + rest til hus (audit-logges).
 *   2) Per vinner: wallet.credit + phase_winners-rad + audit.
 *   3) Loyalty-hook fire-and-forget.
 *   4) Hele operasjonen er atomisk: én wallet-credit-feil → TransaksjonError
 *      slik at Game1DrawEngineService kan rollbacke hele drawNext().
 *
 * Scope-avgrensning:
 *   - Tar emot ALLE vinnere for en fase på én gang (utløst fra
 *     Game1DrawEngineService.drawNext etter pattern-evaluering).
 *   - Bruker ticket-color-basert jackpot-oppslag for Fullt Hus. Jackpot-
 *     service i Bolk 3 gir `jackpotAmountCents` inn som parameter — payout-
 *     servicen bare lagrer det.
 *   - Ingen egne DB-transaksjoner — callers PoolClient brukes for at
 *     hele drawNext-transaksjonen skal kunne rollbacke ved feil.
 *
 * Referanse:
 *   - `BingoEngine.payoutPhaseWinner` (apps/backend/src/game/BingoEngine.ts
 *     :1183-1280) for pattern å følge.
 *   - `.claude/legacy-ref/Game1/Controllers/GameProcess.js:5715-5911`
 *     (processWinners / processMultiWinnings / distributeMultiWinnings).
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type {
  LoyaltyPointsHookPort,
  LoyaltyGameWinHook,
} from "../adapters/LoyaltyPointsHookPort.js";
import { NoopLoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import type {
  SplitRoundingAuditPort,
  SplitRoundingHouseRetainedEvent,
} from "../adapters/SplitRoundingAuditPort.js";
import { NoopSplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import { DomainError } from "./BingoEngine.js";
import { IdempotencyKeys } from "./idempotency.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-payout-service" });

// ── Public types ────────────────────────────────────────────────────────────

export interface Game1WinningAssignment {
  /** assignment-id fra app_game1_ticket_assignments. */
  assignmentId: string;
  /** wallet-id til eieren av brettet. Må matche wallet-adapter.credit. */
  walletId: string;
  /** bruker-id (ikke wallet-id) for audit + phase_winners.winner_user_id. */
  userId: string;
  /** hall-id for audit/rapport. */
  hallId: string;
  /** Ticket-farge (for jackpot-oppslag og audit). */
  ticketColor: string;
}

export interface Game1PhasePayoutInput {
  scheduledGameId: string;
  phase: number; // 1..5
  /** Draw-sekvens som utløste winnen (= state.draws_completed etter current draw). */
  drawSequenceAtWin: number;
  /** Room-code (for audit — kan være tom for scheduled-games-context). */
  roomCode: string;
  /** Totalpott i øre for hele fasen (før split). */
  totalPhasePrizeCents: number;
  /** Alle brett som har vunnet fasen (kan være 1..N). */
  winners: Game1WinningAssignment[];
  /**
   * Ekstra jackpot-utbetaling pr vinner-brett i øre (kun Fullt Hus; 0 ellers).
   * Game1JackpotService (Bolk 3) beregner dette.
   */
  jackpotAmountCentsPerWinner?: number;
  /** Fase-navn for audit ("1 Rad", "Fullt Hus", …). */
  phaseName: string;
}

export interface Game1PhasePayoutResult {
  phase: number;
  totalWinners: number;
  /** Per-vinner utbetalt i øre (split-resultat, floor). */
  prizePerWinnerCents: number;
  /** House-retained rest i øre (totalPhasePrize - totalWinners × prizePerWinner). */
  houseRetainedCents: number;
  /** Per-vinner detaljer (inkl. wallet-tx-ID). */
  winnerRecords: Array<{
    assignmentId: string;
    userId: string;
    prizeCents: number;
    jackpotCents: number;
    walletTransactionId: string | null;
    phaseWinnerId: string;
  }>;
}

export interface Game1PayoutServiceOptions {
  walletAdapter: WalletAdapter;
  auditLogService: AuditLogService;
  schema?: string;
  loyaltyHook?: LoyaltyPointsHookPort;
  splitRoundingAudit?: SplitRoundingAuditPort;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class Game1PayoutService {
  private readonly wallet: WalletAdapter;
  private readonly audit: AuditLogService;
  private readonly schema: string;
  private readonly loyaltyHook: LoyaltyPointsHookPort;
  private readonly splitRoundingAudit: SplitRoundingAuditPort;

  constructor(options: Game1PayoutServiceOptions) {
    this.wallet = options.walletAdapter;
    this.audit = options.auditLogService;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    this.loyaltyHook = options.loyaltyHook ?? new NoopLoyaltyPointsHookPort();
    this.splitRoundingAudit =
      options.splitRoundingAudit ?? new NoopSplitRoundingAuditPort();
  }

  /**
   * Utbetal til alle vinnere i en fase. Kalles innenfor en eksisterende
   * transaksjon (callers PoolClient) slik at en wallet-credit-feil
   * rollbacker hele drawNext() inklusiv draws-INSERT og markings.
   *
   * @throws DomainError("PAYOUT_WALLET_CREDIT_FAILED") hvis én wallet-credit
   *   feiler. Caller MÅ rullbake transaksjonen.
   */
  async payoutPhase(
    client: PoolClient,
    input: Game1PhasePayoutInput
  ): Promise<Game1PhasePayoutResult> {
    if (input.winners.length === 0) {
      throw new DomainError(
        "PAYOUT_NO_WINNERS",
        "payoutPhase kalt uten vinnere."
      );
    }
    if (
      !Number.isInteger(input.phase) ||
      input.phase < 1 ||
      input.phase > 5
    ) {
      throw new DomainError(
        "PAYOUT_INVALID_PHASE",
        `Ugyldig fase: ${input.phase} (må være 1..5).`
      );
    }
    if (
      !Number.isFinite(input.totalPhasePrizeCents) ||
      input.totalPhasePrizeCents < 0
    ) {
      throw new DomainError(
        "PAYOUT_INVALID_PRIZE",
        "totalPhasePrizeCents må være ikke-negativ."
      );
    }
    const jackpotPerWinner = Math.max(0, input.jackpotAmountCentsPerWinner ?? 0);

    // Split-rounding: floor-division. Rest til huset.
    const winnerCount = input.winners.length;
    const prizePerWinnerCents = Math.floor(
      input.totalPhasePrizeCents / winnerCount
    );
    const houseRetainedCents =
      input.totalPhasePrizeCents - winnerCount * prizePerWinnerCents;

    // Fire split-rounding audit (fire-and-forget).
    if (houseRetainedCents > 0) {
      const splitEvent: SplitRoundingHouseRetainedEvent = {
        amount: centsToKroner(houseRetainedCents),
        winnerCount,
        totalPhasePrize: centsToKroner(input.totalPhasePrizeCents),
        prizePerWinner: centsToKroner(prizePerWinnerCents),
        patternName: input.phaseName,
        roomCode: input.roomCode,
        gameId: input.scheduledGameId,
        hallId: input.winners[0]!.hallId,
      };
      this.splitRoundingAudit
        .onSplitRoundingHouseRetained(splitEvent)
        .catch((err) => {
          log.warn(
            { err, event: splitEvent },
            "[GAME1_PR4c] split-rounding audit hook failed"
          );
        });
    }

    // Utbetal til hver vinner sekvensielt. Hvis én feiler → throw; caller
    // ruller tilbake hele transaksjonen.
    const winnerRecords: Game1PhasePayoutResult["winnerRecords"] = [];

    for (const winner of input.winners) {
      const totalCreditCents = prizePerWinnerCents + jackpotPerWinner;
      let walletTxId: string | null = null;

      if (totalCreditCents > 0) {
        try {
          // PR-W2 wallet-split: payout er gevinst fra spill → krediter til
          // winnings-siden (ikke deposit). Game-engine er eneste lovlige
          // kilde for `to: "winnings"` per pengespillforskriften §11 —
          // admin-routes har eget forbud mot denne verdien (se adminWallet.ts).
          const tx = await this.wallet.credit(
            winner.walletId,
            centsToKroner(totalCreditCents),
            `Spill 1 ${input.phaseName} — spill ${input.scheduledGameId}`,
            {
              idempotencyKey: IdempotencyKeys.game1Phase({
                scheduledGameId: input.scheduledGameId,
                phase: input.phase,
                assignmentId: winner.assignmentId,
              }),
              to: "winnings",
            }
          );
          walletTxId = tx.id;
        } catch (err) {
          // Wallet-feil: rapporter som DomainError slik at caller ruller tilbake.
          log.error(
            {
              err,
              scheduledGameId: input.scheduledGameId,
              phase: input.phase,
              assignmentId: winner.assignmentId,
              walletId: winner.walletId,
              amount: totalCreditCents,
            },
            "[GAME1_PR4c] wallet.credit feil — hele draw-transaksjon rulles tilbake"
          );
          if (err instanceof WalletError) {
            throw new DomainError(
              "PAYOUT_WALLET_CREDIT_FAILED",
              `Wallet-credit feilet for vinner ${winner.assignmentId}: ${err.message} (code=${err.code})`
            );
          }
          throw new DomainError(
            "PAYOUT_WALLET_CREDIT_FAILED",
            `Wallet-credit feilet for vinner ${winner.assignmentId}: ${(err as Error).message ?? "ukjent"}`
          );
        }
      }

      // Persistér phase-winner-rad.
      const phaseWinnerId = `g1pw-${randomUUID()}`;
      await client.query(
        `INSERT INTO ${this.phaseWinnersTable()}
           (id, scheduled_game_id, assignment_id, winner_user_id, hall_id,
            phase, draw_sequence_at_win, prize_amount_cents,
            total_phase_prize_cents, winner_brett_count, ticket_color,
            wallet_transaction_id, jackpot_amount_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (scheduled_game_id, phase, assignment_id) DO NOTHING`,
        [
          phaseWinnerId,
          input.scheduledGameId,
          winner.assignmentId,
          winner.userId,
          winner.hallId,
          input.phase,
          input.drawSequenceAtWin,
          prizePerWinnerCents,
          input.totalPhasePrizeCents,
          winnerCount,
          winner.ticketColor,
          walletTxId,
          jackpotPerWinner > 0 ? jackpotPerWinner : null,
        ]
      );

      // Loyalty-hook (fire-and-forget).
      if (prizePerWinnerCents > 0) {
        const event: LoyaltyGameWinHook = {
          kind: "game.win",
          userId: winner.userId,
          amount: centsToKroner(prizePerWinnerCents),
          patternName: input.phaseName,
          roomCode: input.roomCode,
          gameId: input.scheduledGameId,
          hallId: winner.hallId,
        };
        this.loyaltyHook.onLoyaltyEvent(event).catch((err) => {
          log.warn(
            {
              err,
              scheduledGameId: input.scheduledGameId,
              userId: winner.userId,
            },
            "[GAME1_PR4c] loyalty hook failed — payout continues"
          );
        });
      }

      // Audit (fire-and-forget).
      this.fireAudit({
        actorId: winner.userId,
        action: "game1_payout.phase_winner",
        resourceId: input.scheduledGameId,
        details: {
          phase: input.phase,
          phaseName: input.phaseName,
          assignmentId: winner.assignmentId,
          prizeCents: prizePerWinnerCents,
          jackpotCents: jackpotPerWinner,
          totalPhasePrizeCents: input.totalPhasePrizeCents,
          winnerCount,
          drawSequenceAtWin: input.drawSequenceAtWin,
          walletTransactionId: walletTxId,
          ticketColor: winner.ticketColor,
        },
      });

      winnerRecords.push({
        assignmentId: winner.assignmentId,
        userId: winner.userId,
        prizeCents: prizePerWinnerCents,
        jackpotCents: jackpotPerWinner,
        walletTransactionId: walletTxId,
        phaseWinnerId,
      });
    }

    log.info(
      {
        scheduledGameId: input.scheduledGameId,
        phase: input.phase,
        winnerCount,
        prizePerWinnerCents,
        houseRetainedCents,
        jackpotPerWinner,
      },
      "[GAME1_PR4c] phase payout completed"
    );

    return {
      phase: input.phase,
      totalWinners: winnerCount,
      prizePerWinnerCents,
      houseRetainedCents,
      winnerRecords,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private phaseWinnersTable(): string {
    return `"${this.schema}"."app_game1_phase_winners"`;
  }

  private fireAudit(event: {
    actorId: string | null;
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): void {
    this.audit
      .record({
        actorId: event.actorId,
        actorType: event.actorId === null ? "SYSTEM" : "USER",
        action: event.action,
        resource: "game1_scheduled_game",
        resourceId: event.resourceId,
        details: event.details,
      })
      .catch((err) => {
        log.warn(
          { err, action: event.action, resourceId: event.resourceId },
          "[GAME1_PR4c] audit append failed"
        );
      });
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Convert øre to kroner (kroner-baserte wallet + loyalty-hook). */
function centsToKroner(cents: number): number {
  return cents / 100;
}
