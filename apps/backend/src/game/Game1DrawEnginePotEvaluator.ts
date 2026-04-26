/**
 * Game1DrawEnginePotEvaluator — C2 pot-evaluator-wiring.
 *
 * Ekstrahert fra `Game1DrawEngineService.ts` i refactor/s4-draw-engine-split
 * (Forslag A).
 *
 * **Scope:**
 *   - `runAccumulatingPotEvaluation` (multi-hall-iterasjon + per-hall
 *     kall til konsolidert `evaluateAccumulatingPots`-helper)
 *
 * **Kontrakt:**
 *   - Ren pure-funksjon-modul. Mottar alt den trenger via parametere.
 *   - Byte-identisk flytting — fail-closed-kontrakt og
 *     firstWinnerPerHall-beregning bevart.
 *
 * **Regulatorisk:** pot-evaluering kjøres INNE i draw-transaksjonen
 * (samme `PoolClient` som er sendt inn). `innsatsen`/`generic`-feil
 * kaster ut slik at draw-en ruller tilbake (fail-closed). `jackpott`-
 * feil har egen swallow-policy inne i `evaluateAccumulatingPots` og
 * når ikke opp hit.
 */

import type { PoolClient } from "pg";
import type { AuditLogService } from "../compliance/AuditLogService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { Game1WinningAssignment } from "./Game1PayoutService.js";
import type { Game1PotService } from "./pot/Game1PotService.js";
import type { PotDailyAccumulationTickService } from "./pot/PotDailyAccumulationTickService.js";
import { evaluateAccumulatingPots } from "./pot/PotEvaluator.js";
import type { ComplianceLedgerPort } from "../adapters/ComplianceLedgerPort.js";
import type { PrizePolicyPort } from "../adapters/PrizePolicyPort.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-draw-engine-pot-evaluator" });

// ── Public API ───────────────────────────────────────────────────────────────

export interface RunAccumulatingPotEvaluationParams {
  client: PoolClient;
  potService: Game1PotService;
  walletAdapter: WalletAdapter;
  audit: AuditLogService;
  potDailyTickService: PotDailyAccumulationTickService | null;
  scheduledGameId: string;
  drawSequenceAtWin: number;
  winners: ReadonlyArray<Game1WinningAssignment & { userId: string }>;
  /**
   * Agent IJ2 — ordinær premie per hall (øre) for firstWinner-of-hall.
   * Trengs for pot-er med `capType='total'` (Innsatsen legacy-paritet).
   * Hvis ikke satt → 0 brukes (bakoverkompat; pot-er med capType=pot-balance
   * påvirkes ikke).
   *
   * Nøkkel = hallId, verdi = ordinær prize (phase-split + ev. fixed jackpot)
   * som tilfaller firstWinner i den hall-en. Draw-engine må beregne dette med
   * samme split-logikk som `Game1PayoutService.payoutPhase` for å matche
   * wallet-credit-beløpet som faktisk er utbetalt til firstWinner.
   */
  ordinaryWinCentsByHall?: ReadonlyMap<string, number>;
  /** K2-A CRIT-2: ledger-port for EXTRA_PRIZE-entries per pot-payout. */
  complianceLedgerPort?: ComplianceLedgerPort;
  /** K2-A CRIT-3: prize-policy-port for single-prize-cap (2500 kr). */
  prizePolicyPort?: PrizePolicyPort;
}

/**
 * Agent IJ2 — beregn ordinær premie (i øre) for hver hall's firstWinner.
 * Bruker samme split-logikk som `Game1PayoutService.payoutPhase` for å
 * matche wallet-credit-beløpet som utbetales til firstWinner før pot-
 * evaluering. Pot-er med `capType='total'` bruker dette for å trimme
 * pot-payout slik at ordinær + pot ≤ maxAmountCents.
 *
 * `ordinaryWinCents` for firstWinner(hall) =
 *   prizePerWinner(hall-group) + jackpotPerWinner(hall-group)
 *
 * Hvor `hall-group` er samme gruppering som caller bruker til payoutPhase:
 *   - per-color-path: gruppe = ticketColor → totalPhasePrizeCents(color) /
 *     groupWinners.length + jackpotAmountCents(color)
 *   - flat-path: alle winners deler én pott → totalPhasePrizeCents /
 *     winners.length + per-winner jackpot (firstWinner's farge)
 *
 * Returnerer en Map keyed på hallId. Halls uten vinner får ikke en entry.
 *
 * Fail-safe: hvis variantConfig / jackpot-oppslag kaster → fall tilbake til
 * 0 for den hallen (pot-evaluator bruker 0 = ingen trim, som er
 * sikreste fallback hvis cap-info er ufullstendig).
 */
export function computeOrdinaryWinCentsByHallPerColor(args: {
  winners: ReadonlyArray<Game1WinningAssignment & { userId: string }>;
  phase: number;
  drawSequenceAtWin: number;
  potCents: number;
  /** Patterns pr engine-color-navn; samme kilde som `payoutPerColorGroups`. */
  patternsForColor: (color: string) => {
    totalPhasePrizeCents: number;
  } | null;
  /** Jackpot pr ticketColor; tom hvis ingen jackpot eller ikke Fullt Hus. */
  jackpotForColor: (color: string) => number;
}): Map<string, number> {
  const { winners } = args;
  if (winners.length === 0) return new Map();

  // Gruppe-key for split = ticketColor (matcher payoutPerColorGroups).
  const groupSizeByColor = new Map<string, number>();
  for (const w of winners) {
    groupSizeByColor.set(
      w.ticketColor,
      (groupSizeByColor.get(w.ticketColor) ?? 0) + 1
    );
  }

  // firstWinner per hall — array-orden (matcher PotEvaluator).
  const firstWinnerPerHall = new Map<
    string,
    Game1WinningAssignment & { userId: string }
  >();
  for (const w of winners) {
    if (!firstWinnerPerHall.has(w.hallId)) {
      firstWinnerPerHall.set(w.hallId, w);
    }
  }

  const result = new Map<string, number>();
  for (const [hallId, firstWinner] of firstWinnerPerHall) {
    const color = firstWinner.ticketColor;
    const groupSize = groupSizeByColor.get(color) ?? 1;
    let ordinary = 0;
    try {
      const patterns = args.patternsForColor(color);
      if (patterns) {
        // Floor-split (matcher Game1PayoutService.payoutPhase).
        const perWinner = Math.floor(patterns.totalPhasePrizeCents / groupSize);
        ordinary += Math.max(0, perWinner);
      }
      ordinary += Math.max(0, args.jackpotForColor(color));
    } catch {
      // Fail-safe: 0 = bakoverkompat (pot-evaluator bruker som ingen trim).
      ordinary = 0;
    }
    result.set(hallId, ordinary);
  }
  return result;
}

/**
 * Agent IJ2 — flat-path-variant: alle winners deler én pott uansett farge.
 * firstWinner's ordinær premie = floor(totalPhasePrize / winners.length) +
 * firstWinner's per-farge-jackpot.
 */
export function computeOrdinaryWinCentsByHallFlat(args: {
  winners: ReadonlyArray<Game1WinningAssignment & { userId: string }>;
  totalPhasePrizeCents: number;
  /** Jackpot pr ticketColor — 0 hvis ikke Fullt Hus. */
  jackpotForColor: (color: string) => number;
}): Map<string, number> {
  const { winners, totalPhasePrizeCents } = args;
  if (winners.length === 0) return new Map();
  const perWinner = Math.floor(totalPhasePrizeCents / winners.length);

  const firstWinnerPerHall = new Map<
    string,
    Game1WinningAssignment & { userId: string }
  >();
  for (const w of winners) {
    if (!firstWinnerPerHall.has(w.hallId)) {
      firstWinnerPerHall.set(w.hallId, w);
    }
  }

  const result = new Map<string, number>();
  for (const [hallId, firstWinner] of firstWinnerPerHall) {
    let ordinary = Math.max(0, perWinner);
    try {
      ordinary += Math.max(0, args.jackpotForColor(firstWinner.ticketColor));
    } catch {
      // Fail-safe: uten jackpot-data, bruk kun ordinær split.
    }
    result.set(hallId, ordinary);
  }
  return result;
}

/**
 * PR-C2 Spor 4: evaluér akkumulerende pot-er (Innsatsen + Jackpott) via
 * konsolidert PotEvaluator. Kjøres kun når Fullt Hus er vunnet —
 * callern må gjøre `currentPhase === TOTAL_PHASES`-sjekken før denne
 * funksjonen kalles.
 *
 * PotEvaluator itererer pot-er per hall og switcher på `config.potType`:
 *   - innsatsen → fail-closed (credit-feil ruller tilbake draw)
 *   - jackpott  → fail-open (credit-feil loggres, draw fortsetter —
 *     bevart T2-semantikk; fase-payout for andre vinnere skal ikke
 *     annulleres pga pot-feil)
 *   - generic   → fail-closed (samme som innsatsen)
 *
 * Multi-hall-støtte (arvet fra T2): iterer unike halls blant vinnere og
 * kall evaluator én gang per hall med firstWinner fra den hall-en.
 * BINGO-claim-orden = array-orden fra assignments-SELECT.
 */
export async function runAccumulatingPotEvaluation(
  params: RunAccumulatingPotEvaluationParams
): Promise<void> {
  const {
    client,
    potService,
    walletAdapter,
    audit,
    potDailyTickService,
    scheduledGameId,
    drawSequenceAtWin,
    winners,
  } = params;

  if (winners.length === 0) return;

  const firstWinnerPerHall = new Map<
    string,
    Game1WinningAssignment & { userId: string }
  >();
  for (const w of winners) {
    if (!firstWinnerPerHall.has(w.hallId)) {
      firstWinnerPerHall.set(w.hallId, w);
    }
  }

  for (const [hallId, firstWinner] of firstWinnerPerHall) {
    const ordinaryWinCents =
      params.ordinaryWinCentsByHall?.get(hallId) ?? 0;
    try {
      await evaluateAccumulatingPots({
        client,
        potService,
        walletAdapter,
        hallId,
        scheduledGameId,
        drawSequenceAtWin,
        firstWinner,
        ordinaryWinCents,
        audit,
        potDailyTickService: potDailyTickService ?? undefined,
        // K2-A CRIT-2 / CRIT-3: thread compliance + prize-policy ports.
        complianceLedgerPort: params.complianceLedgerPort,
        prizePolicyPort: params.prizePolicyPort,
      });
    } catch (err) {
      // Pot-evaluerings-feil for innsatsen/generic er regulatorisk
      // kritisk — rull hele draw-en tilbake slik at en half-credit-
      // tilstand aldri blir persistert. Jackpott-feil har egen swallow-
      // policy inne i evaluator og kaster IKKE hit.
      log.error(
        { err, scheduledGameId, drawSequenceAtWin, hallId },
        "[PR-C2] evaluateAccumulatingPots kastet — draw-transaksjon ruller tilbake"
      );
      throw err;
    }
  }
}
