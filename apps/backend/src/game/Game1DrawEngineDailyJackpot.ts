/**
 * MASTER_PLAN_SPILL1_PILOT_2026-04-24 §2.3 — DrawEngine-hook for daglig
 * akkumulert Jackpott (Appendix B.9).
 *
 * Når kalles dette?
 *   Etter at Game1DrawEngineService.payoutPhase har utbetalt Fullt Hus
 *   (phase === 5) sin ordinære gevinst + per-farge jackpot, kjøres denne
 *   hooken én gang per Fullt Hus-event. Hooken er separat fra:
 *
 *     - `Game1JackpotService` (per-farge fixed-amount jackpot)
 *     - `Game1PotService` (Innsatsen + akkumulerende pot per hall)
 *
 *   Den daglig-akkumulerende potten er en ENESTE pott per hall-gruppe som
 *   vokser +4000 kr/dag opp til 30 000 kr cap. Når en spiller vinner Fullt
 *   Hus PÅ eller FØR `drawThresholds[0]` (default 50), tømmes potten og
 *   resettes til seed (2000 kr).
 *
 * Awards-pathen:
 *   1. Resolve `hall_group_id` fra scheduled-game.
 *   2. Atomisk award via `Game1JackpotStateService.awardJackpot` (debit +
 *      reset + audit-rad i app_game1_jackpot_awards).
 *   3. Distribuer awarded-amount likt mellom Fullt Hus-vinnerne via
 *      WalletAdapter.credit(to: "winnings"). Idempotent via per-(award,
 *      winner)-nøkkel.
 *
 * Fail-closed semantikk:
 *   - Mangler service eller wallet → no-op (bakoverkompat).
 *   - Award-call kaster → propager (drawNext-transaksjon ruller tilbake).
 *   - Wallet-credit kaster ETTER award-debit → vi har en partial-failure-
 *     situasjon: state er debitert, men én eller flere wallet-credits
 *     mangler. Service-laget logger feilen og kaster videre slik at draw-
 *     transaksjonen ruller tilbake. ROLLBACK på app_game1_jackpot_awards-
 *     INSERT er IKKE mulig fordi den var commit-et i sin egen
 *     pool.connect()-transaksjon. Operatør får varsel via audit-log og må
 *     manuelt re-trigger payout (idempotent på service-nivå returnerer
 *     samme awardedAmount, og credit-keys er idempotente).
 *
 *     Pragmatisk valg: pilot-scope er én hall, lite trafikk. Full atomicitet
 *     mellom award-debit og N wallet-credits krever distribuert transaksjon
 *     (eller å persiste credits inne i awardJackpot-transaksjonen). Det
 *     utsettes til post-pilot-PR.
 */

import type { PoolClient } from "pg";
import type {
  AwardJackpotResult,
  Game1JackpotStateService,
} from "./Game1JackpotStateService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-daily-jackpot" });

export interface DailyJackpotWinner {
  /** assignment-id fra app_game1_ticket_assignments. */
  assignmentId: string;
  /** wallet-id til eieren. */
  walletId: string;
  /** bruker-id (audit). */
  userId: string;
  /** hall-id (audit). */
  hallId: string;
}

export interface RunDailyJackpotEvaluationInput {
  /** Postgres-client fra ytre transaksjon — brukes til å lese hall_group_id og scheduled-game-state. */
  client: PoolClient;
  /** Schema-prefiks ("public" eller annet). */
  schema: string;
  /** State-service (kjører sin egen pool-tilkobling for atomic award). */
  jackpotStateService: Game1JackpotStateService;
  /** Wallet for credit til vinner. */
  walletAdapter: WalletAdapter;
  /** Audit-tjeneste for fire-and-forget logg. */
  audit: AuditLogService;
  /** Spillet som ble vunnet. */
  scheduledGameId: string;
  /** Draw-sekvens (1-indexed) som utløste Fullt Hus. */
  drawSequenceAtWin: number;
  /** Vinnere som faktisk fikk Fullt Hus utbetalt i denne fasen. */
  winners: DailyJackpotWinner[];
}

export interface RunDailyJackpotEvaluationResult {
  /** True når evaluering trigget en award. */
  awarded: boolean;
  /** Award-rad-id i app_game1_jackpot_awards (tom hvis ikke trigget). */
  awardId: string;
  /** Beløp som ble distribuert (sum av credits til alle vinnere). */
  totalAwardedCents: number;
  /** Hall-gruppe som potten tilhørte (null hvis spillet ikke har gruppe). */
  hallGroupId: string | null;
  /** Grunn til at award ikke ble trigget (audit). */
  skipReason?:
    | "NO_HALL_GROUP"
    | "ABOVE_THRESHOLD"
    | "ZERO_BALANCE"
    | "NO_WINNERS"
    | "STATE_MISSING";
}

/**
 * Hovedfunksjon. Kalles fra Game1DrawEngineService.payoutPhase når
 * `currentPhase === TOTAL_PHASES (5)` og `winners.length > 0`.
 */
export async function runDailyJackpotEvaluation(
  input: RunDailyJackpotEvaluationInput
): Promise<RunDailyJackpotEvaluationResult> {
  const empty: RunDailyJackpotEvaluationResult = {
    awarded: false,
    awardId: "",
    totalAwardedCents: 0,
    hallGroupId: null,
  };

  if (input.winners.length === 0) {
    return { ...empty, skipReason: "NO_WINNERS" };
  }

  // 1) Resolve hall_group_id fra scheduled_game (samme transaksjon).
  const groupRow = await input.client.query<{ group_hall_id: string | null }>(
    `SELECT group_hall_id FROM "${input.schema}"."app_game1_scheduled_games" WHERE id = $1`,
    [input.scheduledGameId]
  );
  const hallGroupId = groupRow.rows[0]?.group_hall_id ?? null;
  if (!hallGroupId) {
    return { ...empty, skipReason: "NO_HALL_GROUP" };
  }

  // 2) Hent state for å sjekke threshold.
  const state = await input.jackpotStateService.getStateForGroup(hallGroupId);
  if (state.currentAmountCents <= 0) {
    return { ...empty, hallGroupId, skipReason: "ZERO_BALANCE" };
  }

  // Pilot-modell (Master-plan §2.3): bruk drawThresholds[0] som "trigger
  // hvis vinning kom på/innen denne sekvensen". Multi-threshold-progresjon
  // (50→55→56→57) er P1 og krever per-sub-game tilstand — ikke implementert
  // her. For pilot er det ett spill per dag som har sjanse til jackpot, med
  // standard threshold 50.
  const triggerThreshold = state.drawThresholds[0];
  if (typeof triggerThreshold !== "number" || triggerThreshold <= 0) {
    log.warn(
      { hallGroupId, drawThresholds: state.drawThresholds },
      "[MASTER_PLAN §2.3] ugyldig drawThresholds — hopper over award"
    );
    return { ...empty, hallGroupId, skipReason: "STATE_MISSING" };
  }
  if (input.drawSequenceAtWin > triggerThreshold) {
    return { ...empty, hallGroupId, skipReason: "ABOVE_THRESHOLD" };
  }

  // 3) Atomic debit-and-reset.
  const idempotencyKey = `g1-jackpot-${input.scheduledGameId}-${input.drawSequenceAtWin}`;
  let award: AwardJackpotResult;
  try {
    award = await input.jackpotStateService.awardJackpot({
      hallGroupId,
      idempotencyKey,
      reason: "FULL_HOUSE_WITHIN_THRESHOLD",
      scheduledGameId: input.scheduledGameId,
      drawSequenceAtWin: input.drawSequenceAtWin,
    });
  } catch (err) {
    log.error(
      { err, hallGroupId, idempotencyKey, scheduledGameId: input.scheduledGameId },
      "[MASTER_PLAN §2.3] awardJackpot kastet — ruller tilbake draw-transaksjon"
    );
    throw err;
  }

  if (award.noopZeroBalance) {
    return { ...empty, hallGroupId, skipReason: "ZERO_BALANCE" };
  }
  if (award.awardedAmountCents <= 0) {
    return { ...empty, hallGroupId, skipReason: "ZERO_BALANCE" };
  }

  // 4) Split likt mellom vinnere. Floor-rounding; rest beholdes på huset.
  //    Vi krediterer via wallet-adapter med per-vinner idempotency-key
  //    `g1-jackpot-credit-{awardId}-{winnerAssignmentId}` slik at retry
  //    av draw-transaksjonen ikke dobbel-krediterer.
  const winnerCount = input.winners.length;
  const perWinnerCents = Math.floor(award.awardedAmountCents / winnerCount);
  const houseRetainedCents = award.awardedAmountCents - perWinnerCents * winnerCount;

  if (perWinnerCents <= 0) {
    // Edge-case: mer enn awardedAmountCents winners (n>award). Logges men
    // vi har allerede debitert state — flag til ops-team.
    log.warn(
      {
        hallGroupId,
        awardId: award.awardId,
        awardedAmountCents: award.awardedAmountCents,
        winnerCount,
      },
      "[MASTER_PLAN §2.3] perWinnerCents=0 — for mange vinnere for award; ingen credit"
    );
    return {
      awarded: true,
      awardId: award.awardId,
      totalAwardedCents: 0,
      hallGroupId,
    };
  }

  let totalCreditedCents = 0;
  for (const winner of input.winners) {
    const creditKey = `g1-jackpot-credit-${award.awardId}-${winner.assignmentId}`;
    try {
      await input.walletAdapter.credit(
        winner.walletId,
        perWinnerCents / 100,
        `Spill 1 Daglig Jackpott — spill ${input.scheduledGameId}`,
        {
          idempotencyKey: creditKey,
          to: "winnings",
        }
      );
      totalCreditedCents += perWinnerCents;
    } catch (err) {
      // Wallet-feil: state er allerede debitert (den lever i sin egen
      // committed transaksjon). Vi propagerer videre slik at draw-
      // transaksjonen ruller tilbake — men state-debit ruller IKKE
      // tilbake. Operatør må bruke admin-tooling for å rebalansere.
      // Pragmatisk pilot-akseptert avvik (se fil-docstring).
      log.error(
        {
          err,
          hallGroupId,
          awardId: award.awardId,
          winnerAssignmentId: winner.assignmentId,
          perWinnerCents,
        },
        "[MASTER_PLAN §2.3] wallet.credit feilet etter award-debit — partial failure"
      );
      throw err;
    }
  }

  // 5) Audit (fire-and-forget).
  input.audit
    .record({
      actorId: null,
      actorType: "SYSTEM",
      action: "game1_jackpot.auto_award",
      resource: "game1_scheduled_game",
      resourceId: input.scheduledGameId,
      details: {
        hallGroupId,
        awardId: award.awardId,
        awardedAmountCents: award.awardedAmountCents,
        previousAmountCents: award.previousAmountCents,
        newAmountCents: award.newAmountCents,
        idempotent: award.idempotent,
        winnerCount,
        perWinnerCents,
        houseRetainedCents,
        drawSequenceAtWin: input.drawSequenceAtWin,
        triggerThreshold,
      },
    })
    .catch((err) => {
      log.warn(
        { err, awardId: award.awardId, scheduledGameId: input.scheduledGameId },
        "[MASTER_PLAN §2.3] audit append failed"
      );
    });

  log.info(
    {
      hallGroupId,
      awardId: award.awardId,
      awardedAmountCents: award.awardedAmountCents,
      winnerCount,
      perWinnerCents,
      idempotent: award.idempotent,
      scheduledGameId: input.scheduledGameId,
      drawSequenceAtWin: input.drawSequenceAtWin,
    },
    "[MASTER_PLAN §2.3] daily-jackpot awarded"
  );

  return {
    awarded: true,
    awardId: award.awardId,
    totalAwardedCents: totalCreditedCents,
    hallGroupId,
  };
}
