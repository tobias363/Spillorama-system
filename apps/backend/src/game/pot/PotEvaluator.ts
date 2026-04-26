/**
 * Spor 4: Pot-evaluator — konsolidert helper for draw-engine.
 *
 * PR-C2 (2026-04-22):
 *   Tidligere levde pot-evaluering i to parallelle stier:
 *     - T3 PotEvaluator.evaluateSinglePot (generisk, switcher på potType)
 *     - T2 Game1DrawEngineService.evaluateAccumulatingJackpotPots
 *       (jackpott-spesifikk, hardkodet `potKey="jackpott"`)
 *   PR-C2 konsoliderer begge til én evaluator med potType-switch. Per-potType-
 *   subtilitet (idempotency-key-format, audit-action, lazy daily-boost, fail-
 *   policy) beholdes uendret — ingen funksjonell regresjon.
 *
 * Kjøres av `Game1DrawEngineService.evaluateAndPayoutPhase` etter at Fullt Hus
 * (phase 5) er vunnet og hovedpremie + fixed jackpot (T1) er utbetalt.
 * Itererer alle aktive pot-er for hallen og evaluerer win-regelen per pot:
 *
 *   - `pot_type = 'innsatsen'` (T3): target-amount + threshold-window.
 *     Pot utløses kun når `currentAmount >= targetAmountCents` OG
 *     drawSequence er innenfor [drawThresholdLower, winRule.drawThreshold].
 *     Utenfor vinduet eller under target → pot ruller over til neste spill.
 *     **Fail-policy: rethrow** (credit-feil ruller tilbake draw-transaksjonen).
 *     **Idempotency-key: `g1-pot-{potId}-{scheduledGameId}`**.
 *
 *   - `pot_type = 'jackpott'` (T2): progressive_threshold-vindu (50/55/56/57
 *     draw-ladder + lazy daily-boost pr hall). Pot utløses når drawSequence
 *     er i ladder-vinduet (evaluert av Game1PotService.tryWin via
 *     `evaluateDrawSequenceAgainstRule`). Ved utløsning krediteres FØRSTE
 *     vinner i hall (BINGO-claim-orden). Etterfølgende vinnere i samme hall
 *     får POT_EMPTY fra tryWin.
 *     **Fail-policy: swallow** (credit-feil loggres ERROR, draw fortsetter —
 *     fase-payout for andre vinnere annulleres ikke). Mismatch mellom pot-
 *     events og wallet_transactions er synlig for admin og må fikses manuelt.
 *     **Idempotency-key: `g1-jackpot-{hallId}-{scheduledGameId}`**.
 *
 *   - `pot_type = 'generic'` (T1): standard `tryWin`-sjekk — winRule sjekkes
 *     inne i Game1PotService (phase + draw-threshold + color).
 *     **Fail-policy: rethrow** (samme som innsatsen).
 *     **Idempotency-key: `g1-pot-{potId}-{scheduledGameId}`**.
 *
 * Design-prinsipper (matcher resten av Spor 4):
 *   - Fail-closed for innsatsen/generic: pot-payout-feil ruller tilbake hele
 *     draw-transaksjonen. Caller (draw-engine) håndterer rollback via sin
 *     PoolClient.
 *   - Fail-open for jackpott: beholder T2-semantikk — ikke tilbakerull fordi
 *     det ville annullere fase-payout for andre vinnere.
 *   - Idempotency-keys forhindrer dobbel credit ved retry.
 *   - Én vinner per pot (PM-vedtak: ingen split for pot — firstWinner per
 *     hall tar alt).
 *   - Lazy daily-boost for jackpott: `ensureDailyAccumulatedForHall` kalles
 *     FØR `tryWin` slik at dagens boost er applisert før saldo leses.
 *   - Audit-log via `app_game1_pot_events` (T1-eksisterende) + en separat
 *     audit-entry via AuditLogService:
 *       - innsatsen → `game1.innsatsen_won`
 *       - jackpott  → `game1.jackpot_won` (engelsk, single 't' — beholdt
 *         fra T2 for audit-log-kompatibilitet)
 *       - generic   → `game1.pot_won`
 *
 * Utenfor scope (holdes i draw-engine):
 *   - Pattern-match (vinnere er allerede bestemt av caller).
 *   - Fixed-jackpot-per-farge (T1 Game1JackpotService, uavhengig av akkumulerende pot).
 *
 * Spec-referanse:
 *   docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md §Innsatsen + §Jackpott
 */

import type { PoolClient } from "pg";
import type { WalletAdapter } from "../../adapters/WalletAdapter.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";
import type { Game1PotService, PotRow, TryWinResult } from "./Game1PotService.js";
import type { PotDailyAccumulationTickService } from "./PotDailyAccumulationTickService.js";
import {
  NoopComplianceLedgerPort,
  type ComplianceLedgerPort,
} from "../../adapters/ComplianceLedgerPort.js";
import {
  NoopPrizePolicyPort,
  type PrizePolicyPort,
} from "../../adapters/PrizePolicyPort.js";
import { ledgerGameTypeForSlug } from "../ledgerGameTypeForSlug.js";
import { IdempotencyKeys } from "../idempotency.js";
import { logger as rootLogger } from "../../util/logger.js";

const log = rootLogger.child({ module: "game1-pot-evaluator" });

/** Minimal vinner-shape — matcher `Game1WinningAssignment` i draw-engine. */
export interface PotEvaluatorWinner {
  assignmentId: string;
  walletId: string;
  userId: string;
  hallId: string;
  ticketColor: string;
}

export interface EvaluateAccumulatingPotsInput {
  client: PoolClient;
  potService: Game1PotService;
  walletAdapter: WalletAdapter;
  hallId: string;
  scheduledGameId: string;
  drawSequenceAtWin: number;
  /**
   * Første vinner i vinner-listen (for denne hall-en). Får hele potten
   * (ingen split for pot per PM-vedtak). Draw-engine sorterer vinner-
   * rekkefølge deterministisk via INSERT-rekkefølge i purchases → samme
   * rekkefølge ved retry.
   *
   * For multi-hall-scenarioer skal caller iterere unike halls og kalle
   * `evaluateAccumulatingPots` én gang per hall med riktig firstWinner.
   */
  firstWinner: PotEvaluatorWinner;
  /**
   * Agent IJ2 — ordinær premie (i øre) som firstWinner får fra fase-
   * utbetalingen (per-winner split av fase-premien + ev. fixed jackpot).
   * Brukes KUN for pot-er med `config.capType === "total"` for å trimme
   * pot-payout slik at total (ordinær + pot) ikke overstiger
   * `config.maxAmountCents`.
   *
   * Default 0: bakoverkompatibel med eksisterende callere som ikke
   * tracker ordinær premie. Pot-er uten capType='total' påvirkes ikke.
   */
  ordinaryWinCents?: number;
  audit: AuditLogService;
  /**
   * PR-C2: valgfri tick-service for daglig pot-boost. Når satt, vil jackpott-
   * stien (potType='jackpott') kalle `ensureDailyAccumulatedForHall(hallId)`
   * FØR `tryWin` slik at dagens boost er applisert før pot-saldo leses. Feil
   * i boost-hook svelges (fail-closed per PR-T2-kontrakt) og blokkerer ikke
   * evaluering.
   *
   * Innsatsen og generic bruker IKKE lazy-boost — de akkumulerer kun via
   * salgs-andel (PotSalesHookPort), ikke daglig.
   */
  potDailyTickService?: PotDailyAccumulationTickService;
  /**
   * K2-A CRIT-2: ComplianceLedger-port for å skrive EXTRA_PRIZE-entry per
   * pot-utbetaling. §71 daily-rapporter må reflektere alle pot-payouts
   * (Innsatsen + Jackpott + generic). Default no-op = ingen ledger-skriv
   * (bakoverkompat for tester).
   *
   * Soft-fail: ledger-skrivefeil svelges. For jackpott matcher dette
   * eksisterende fail-policy (T2-kontrakten); for innsatsen/generic er
   * pot allerede committed via tryWin og credit har idempotency-key, så
   * ledger-feil er audit-issue, ikke regulatorisk pengeflyt-issue.
   */
  complianceLedgerPort?: ComplianceLedgerPort;
  /**
   * K2-A CRIT-3: PrizePolicy-port for single-prize-cap (2500 kr per
   * pengespillforskriften §11). MÅ kalles før wallet-credit slik at pot-
   * payout aldri overstiger lovlig maks-premie. Spesielt viktig for
   * Jackpott som kan akkumulere til 30 000 kr (`JACKPOT_DEFAULT_MAX_CAP_CENTS`).
   * Default no-op = ingen cap (bakoverkompat for tester) — produksjon skal
   * ALLTID wire `engine.getPrizePolicyPort()`.
   */
  prizePolicyPort?: PrizePolicyPort;
}

export interface PotEvaluationResult {
  potKey: string;
  potId: string;
  potType: string;
  triggered: boolean;
  /**
   * Beløp kreditert til vinner (i øre). For `capType='total'` kan dette
   * være mindre enn pot-saldoen fordi (ordinær + pot) er trimmet ned til
   * `maxAmountCents`. For `capType='pot-balance'` (default) = full pot-saldo.
   */
  amountCents: number;
  /**
   * Agent IJ2 — pot-saldo som ble konsumert fra pot_events (før trim).
   * Lik `amountCents` for `capType='pot-balance'`, kan være større enn
   * `amountCents` for `capType='total'` når total-cap har trimmet payout.
   * Differansen (`potAmountGrossCents - amountCents`) går til huset.
   */
  potAmountGrossCents: number;
  /**
   * Agent IJ2 — beløp som huset beholder når pot ble trimmet av total-cap.
   * Alltid 0 for `capType='pot-balance'`. For `capType='total'` =
   * `potAmountGrossCents - amountCents`.
   */
  houseRetainedCents: number;
  reasonCode: string | null;
  walletTxId: string | null;
}

/**
 * Evaluér alle aktive pot-er for hallen og utbetale de som har matchende
 * regel. Kjøres INNE i draw-transaksjonen — innsatsen/generic-pot-feil ruller
 * tilbake hele draw-en (fail-closed). Jackpott-feil svelges (T2-kontrakt).
 *
 * @returns Liste av resultater per pot (triggered + evt. beløp eller avvisnings-kode).
 */
export async function evaluateAccumulatingPots(
  input: EvaluateAccumulatingPotsInput
): Promise<PotEvaluationResult[]> {
  const pots = await input.potService.listPotsForHall(input.hallId);
  if (pots.length === 0) {
    return [];
  }

  const ordinaryWinCents = Math.max(0, input.ordinaryWinCents ?? 0);

  const results: PotEvaluationResult[] = [];
  for (const pot of pots) {
    const potType = pot.config.potType ?? "generic";
    try {
      const res = await evaluateSinglePot({
        pot,
        potType,
        ordinaryWinCents,
        ...input,
        // K2-A: thread CRIT-2 ledger-port + CRIT-3 prize-policy-port.
        complianceLedgerPort: input.complianceLedgerPort,
        prizePolicyPort: input.prizePolicyPort,
      });
      results.push(res);
    } catch (err) {
      // Rethrow for fail-closed potTypes (innsatsen/generic) slik at draw-
      // transaksjonen ruller tilbake. Jackpott har egen swallow-policy inne
      // i evaluateSinglePot — disse kaster IKKE hit.
      log.error(
        {
          err,
          potId: pot.id,
          potKey: pot.potKey,
          potType,
          hallId: input.hallId,
          scheduledGameId: input.scheduledGameId,
          drawSequenceAtWin: input.drawSequenceAtWin,
        },
        "[PR-T3] pot-evaluering kastet — hele draw ruller tilbake"
      );
      throw err;
    }
  }

  return results;
}

/**
 * PR-C2: fail-policy per potType. Jackpott beholder T2's swallow-semantikk
 * (ikke tilbakerull draw ved pot-feil), innsatsen/generic bruker T3's rethrow
 * (draw ruller tilbake).
 */
function failPolicyFor(potType: string): "rethrow" | "swallow" {
  return potType === "jackpott" ? "swallow" : "rethrow";
}

/**
 * Idempotency-key-format per potType. Konsoliderer T2 + T3 uten å endre format:
 *   - jackpott: `g1-jackpot-{hallId}-{scheduledGameId}` (en pot per hall —
 *     potId ikke nødvendig, hallId er tilstrekkelig unik).
 *   - innsatsen/generic: `g1-pot-{potId}-{scheduledGameId}` (generelt format,
 *     støtter flere pot-er per hall).
 */
function idempotencyKeyFor(
  potType: string,
  pot: PotRow,
  scheduledGameId: string
): string {
  if (potType === "jackpott") {
    return IdempotencyKeys.game1Jackpot({
      hallId: pot.hallId,
      scheduledGameId,
    });
  }
  return IdempotencyKeys.game1Pot({
    potId: pot.id,
    scheduledGameId,
  });
}

/** Menneskelesbar credit-beskrivelse per potType. */
function creditDescriptionFor(potType: string, pot: PotRow): string {
  if (potType === "innsatsen") {
    return `Spill 1 Innsatsen — pot ${pot.displayName}`;
  }
  if (potType === "jackpott") {
    return `Spill 1 Jackpott — pot ${pot.displayName}`;
  }
  return `Spill 1 pot — ${pot.displayName}`;
}

/**
 * Audit-action-navn per potType. Jackpott beholder T2-navnet
 * "game1.jackpot_won" (engelsk, single 't') for audit-log-kompatibilitet —
 * endring til "game1.jackpott_won" ville bryte compliance-rapporter som
 * allerede filtrerer på det eksisterende navnet.
 */
function auditActionFor(potType: string): string {
  if (potType === "innsatsen") return "game1.innsatsen_won";
  if (potType === "jackpott") return "game1.jackpot_won";
  return "game1.pot_won";
}

/**
 * Evaluér én pot og utfør ev. payout. Eksportert fra PR-C2 slik at draw-
 * engine kan kalle den isolert per pot hvis ønsket (nåværende caller bruker
 * `evaluateAccumulatingPots` som iterator).
 *
 * Agent IJ2: tar nå `ordinaryWinCents` for pot-er med `capType='total'`.
 * Default 0 = bakoverkompat for pot-er med `capType='pot-balance'` (ingen
 * trim).
 */
export async function evaluateSinglePot(params: {
  pot: PotRow;
  potType: string;
  client: PoolClient;
  potService: Game1PotService;
  walletAdapter: WalletAdapter;
  hallId: string;
  scheduledGameId: string;
  drawSequenceAtWin: number;
  firstWinner: PotEvaluatorWinner;
  /**
   * Agent IJ2 — ordinær premie (øre) for firstWinner. Kun brukt når
   * `pot.config.capType === "total"` for total-cap-trimming. Default 0.
   */
  ordinaryWinCents?: number;
  audit: AuditLogService;
  potDailyTickService?: PotDailyAccumulationTickService;
  /** K2-A CRIT-2: ledger-port for EXTRA_PRIZE-entry per pot-payout. */
  complianceLedgerPort?: ComplianceLedgerPort;
  /** K2-A CRIT-3: prize-policy-port for single-prize-cap (2500 kr). */
  prizePolicyPort?: PrizePolicyPort;
}): Promise<PotEvaluationResult> {
  const { pot, potType, firstWinner } = params;
  const ordinaryWinCents = Math.max(0, params.ordinaryWinCents ?? 0);
  const failPolicy = failPolicyFor(potType);

  // Phase 5 = Fullt Hus. Alle akkumulerende pot-er i T1-T3-scope binder seg
  // til Fullt Hus — pot.config.winRule.phase må matche.
  const phase = pot.config.winRule.phase;

  // PR-C2: lazy daily-boost for jackpott (T2-semantikk). Bevisst KUN for
  // jackpott — innsatsen/generic akkumulerer via PotSalesHookPort, ikke daglig.
  // Feil svelges (boost er opportunistisk, ikke regulatorisk kritisk).
  if (potType === "jackpott" && params.potDailyTickService) {
    try {
      await params.potDailyTickService.ensureDailyAccumulatedForHall(
        pot.hallId
      );
    } catch (err) {
      log.warn(
        { err, hallId: pot.hallId, scheduledGameId: params.scheduledGameId },
        "[PR-T2] ensureDailyAccumulatedForHall feilet — fortsetter"
      );
    }
  }

  // tryWin gjør all validering (phase, draw-window, target-amount, color).
  // Den commiterer sin egen transaksjon på pot-tabellen (BEGIN/COMMIT
  // internt). walletAdapter.credit kjøres UTENFOR pot-transaksjonen men
  // innenfor draw-transaksjonen (params.client). Rekkefølge:
  //   1) tryWin → evaluate regel + reserve payout (reset pot til seed)
  //   2) walletAdapter.credit → krediterer vinner til winnings-side
  //   3) audit-log → compliance-synlighet
  // Hvis credit (2) feiler for innsatsen/generic → draw-transaksjonen ruller
  // tilbake (rethrow). For jackpott → feil svelges og pot-reset står (krever
  // manuell admin-refund via pot_events → wallet_transactions-diff).
  let winResult: TryWinResult;
  try {
    winResult = await params.potService.tryWin({
      hallId: pot.hallId,
      potKey: pot.potKey,
      phase,
      drawSequenceAtWin: params.drawSequenceAtWin,
      ticketColor: firstWinner.ticketColor,
      winnerUserId: firstWinner.userId,
      scheduledGameId: params.scheduledGameId,
    });
  } catch (err) {
    if (failPolicy === "swallow") {
      // PR-T2-kontrakt: jackpott-feil tilbakeruller ikke draw-en — andre
      // vinnere (fase-payout) skal ikke annulleres pga pot-feil.
      log.error(
        {
          err,
          potId: pot.id,
          potKey: pot.potKey,
          potType,
          hallId: pot.hallId,
          scheduledGameId: params.scheduledGameId,
          drawSequenceAtWin: params.drawSequenceAtWin,
        },
        "[PR-T2] Jackpott-evaluering krasjet for hall — fortsetter med neste"
      );
      return {
        potKey: pot.potKey,
        potId: pot.id,
        potType,
        triggered: false,
        amountCents: 0,
        potAmountGrossCents: 0,
        houseRetainedCents: 0,
        reasonCode: "EVALUATION_ERROR",
        walletTxId: null,
      };
    }
    // Rethrow for innsatsen/generic.
    log.error(
      { err, potId: pot.id, potKey: pot.potKey },
      "[PR-T3] potService.tryWin kastet"
    );
    throw err;
  }

  if (!winResult.triggered) {
    // Pot venter (under target, utenfor vindu, el. annen avvisningskode).
    log.debug(
      {
        potId: pot.id,
        potKey: pot.potKey,
        potType,
        reasonCode: winResult.reasonCode,
        drawSequenceAtWin: params.drawSequenceAtWin,
      },
      "[PR-T3] pot ikke utløst — ruller over til neste spill"
    );
    return {
      potKey: pot.potKey,
      potId: pot.id,
      potType,
      triggered: false,
      amountCents: 0,
      potAmountGrossCents: 0,
      houseRetainedCents: 0,
      reasonCode: winResult.reasonCode,
      walletTxId: null,
    };
  }

  // Agent IJ2 — legacy total-cap: ordinær + pot ≤ maxAmountCents.
  //
  //   Pot er allerede decrementert (reset til seed) av tryWin. Vi trimmer
  //   KUN det som faktisk krediteres vinners wallet — excess beholdes av
  //   huset (matcher legacy-semantikk: pot-pool emptes uansett, player får
  //   capped sum).
  //
  //   For `capType='pot-balance'` (default): ingen trim, payout = full pot.
  const potGrossCents = winResult.amountCents;
  const capType = pot.config.capType ?? "pot-balance";
  let payoutCents = potGrossCents;
  let houseRetainedCents = 0;
  if (
    capType === "total" &&
    pot.config.maxAmountCents !== null &&
    pot.config.maxAmountCents !== undefined
  ) {
    const totalBeforeCap = ordinaryWinCents + potGrossCents;
    const cappedTotal = Math.min(totalBeforeCap, pot.config.maxAmountCents);
    // Pot-andel av capped total. Hvis ordinær alene allerede overstiger
    // cap → pot-payout = 0 (player får KUN ordinær, cap håndheves oppstrøms
    // i ordinær-payout-stien hvis nødvendig).
    payoutCents = Math.max(0, cappedTotal - ordinaryWinCents);
    houseRetainedCents = potGrossCents - payoutCents;
    if (houseRetainedCents > 0) {
      log.info(
        {
          potId: pot.id,
          potKey: pot.potKey,
          potType,
          capType,
          potGrossCents,
          ordinaryWinCents,
          maxAmountCents: pot.config.maxAmountCents,
          payoutCents,
          houseRetainedCents,
        },
        "[IJ2] total-cap trimmet pot-payout — excess beholdes av huset"
      );
    }
  }

  // K2-A CRIT-3: håndhev pengespillforskriften §11 single-prize-cap (2500 kr).
  // Spesielt viktig for Jackpott som kan akkumulere til 30 000 kr — uten cap
  // ville hele beløpet utbetales (ulovlig). Cap legges PÅ TOPP av Agent IJ2
  // total-cap-en: hvis IJ2 allerede trimmet til 1500 kr beholdes det; hvis
  // IJ2 ga 5000 kr så cap'er §11 til 2500. Differansen audit-logges.
  const prizePolicyPort = params.prizePolicyPort;
  let policyId: string | null = null;
  if (prizePolicyPort && payoutCents > 0) {
    const capResult = prizePolicyPort.applySinglePrizeCap({
      hallId: pot.hallId,
      amount: payoutCents / 100, // port forventer kroner
    });
    const cappedPayoutCents = Math.floor(capResult.cappedAmount * 100);
    policyId = capResult.policyId;
    if (capResult.wasCapped && cappedPayoutCents < payoutCents) {
      const additionalHouseRetained = payoutCents - cappedPayoutCents;
      houseRetainedCents += additionalHouseRetained;
      log.info(
        {
          potId: pot.id,
          potKey: pot.potKey,
          potType,
          potGrossCents,
          payoutBeforeCriticalCap: payoutCents,
          payoutAfterCriticalCap: cappedPayoutCents,
          additionalHouseRetained,
          totalHouseRetained: houseRetainedCents,
          policyId,
        },
        "[K2-A CRIT-3] pot single-prize-cap (2500) trimmet payout — excess beholdes av huset"
      );
      payoutCents = cappedPayoutCents;
    }
  }

  // Pot utløst — krediter vinner. Idempotency-key per pot + spill
  // forhindrer dobbel credit ved retry.
  const amountKr = payoutCents / 100;
  const idempotencyKey = idempotencyKeyFor(potType, pot, params.scheduledGameId);
  const description = creditDescriptionFor(potType, pot);

  let walletTxId: string | null = null;
  // Agent IJ2: hopp over wallet-credit hvis total-cap trimmet pot-payout
  // til 0. Pot er fortsatt decrementet (reset til seed) av tryWin og full
  // excess beholdes av huset. Ingen wallet-credit trengs for 0-beløp
  // (wallet-adapter vil trolig avvise 0-credit uansett).
  if (payoutCents > 0) {
    try {
      const tx = await params.walletAdapter.credit(
        firstWinner.walletId,
        amountKr,
        description,
        {
          idempotencyKey,
          to: "winnings",
        }
      );
      walletTxId = tx.id;
    } catch (err) {
      if (failPolicy === "swallow") {
        // PR-T2-kontrakt: pot er allerede decremented via tryWin-commit. Ved
        // credit-feil er det en mismatch mellom pot_events ("win"-rad) og
        // wallet_transactions (ingen credit-rad). Admin må manuell-refund.
        log.error(
          {
            err,
            hallId: pot.hallId,
            scheduledGameId: params.scheduledGameId,
            winnerUserId: firstWinner.userId,
            walletId: firstWinner.walletId,
            amountCents: payoutCents,
            eventId: winResult.eventId,
          },
          "[PR-T2] Jackpott-credit FEILET etter pot-utløsning — krever manuell admin-refund"
        );
        // Returner triggered=true for observability, men walletTxId=null viser
        // at credit feilet.
        // Fortsett med audit-log under (samme som T2).
      } else {
        // Innsatsen/generic: rethrow → draw ruller tilbake.
        log.error(
          {
            err,
            potId: pot.id,
            potKey: pot.potKey,
            potType,
            amountCents: payoutCents,
            winnerWalletId: firstWinner.walletId,
            idempotencyKey,
          },
          "[PR-T3] wallet.credit feilet for pot — draw ruller tilbake"
        );
        throw err;
      }
    }
  }

  // Audit-log for compliance-synlighet. Fire-and-forget (AuditLogService
  // håndterer intern fail-safe).
  const auditAction = auditActionFor(potType);
  // Jackpott beholder T2's audit-shape (resource='game1_pot',
  // resourceId=eventId). Innsatsen/generic bruker T3's shape
  // (resource='game1_accumulating_pot', resourceId=pot.id).
  const isJackpott = potType === "jackpott";
  const auditResource = isJackpott ? "game1_pot" : "game1_accumulating_pot";
  const auditResourceId = isJackpott ? winResult.eventId : pot.id;
  // Agent IJ2: `amountCents` i audit = faktisk utbetalt til wallet (trimmet
  // ved capType='total'). Legg til `potGrossCents` + `houseRetainedCents`
  // for sporbarhet når pot-saldo og utbetaling divergerer.
  const auditDetails = isJackpott
    ? {
        hallId: pot.hallId,
        scheduledGameId: params.scheduledGameId,
        winnerUserId: firstWinner.userId,
        assignmentId: firstWinner.assignmentId,
        amountCents: payoutCents,
        potGrossCents,
        houseRetainedCents,
        drawSequenceAtWin: params.drawSequenceAtWin,
        potKey: pot.potKey,
      }
    : {
        potKey: pot.potKey,
        potType,
        hallId: pot.hallId,
        scheduledGameId: params.scheduledGameId,
        drawSequenceAtWin: params.drawSequenceAtWin,
        amountCents: payoutCents,
        potGrossCents,
        houseRetainedCents,
        ordinaryWinCents,
        capType,
        winnerUserId: firstWinner.userId,
        winnerWalletId: firstWinner.walletId,
        ticketColor: firstWinner.ticketColor,
        walletTxId,
        idempotencyKey,
        eventId: winResult.eventId,
      };

  params.audit
    .record({
      actorId: null,
      actorType: "SYSTEM",
      action: auditAction,
      resource: auditResource,
      resourceId: auditResourceId,
      details: auditDetails,
    })
    .catch((err) => {
      log.warn(
        { err, potId: pot.id, action: auditAction },
        "[PR-T3] audit.record feilet — pot-payout står, ignorert"
      );
    });

  // K2-A CRIT-2: skriv EXTRA_PRIZE-entry til ComplianceLedger §71. Soft-fail
  // (matcher eksisterende fail-policy for jackpott — pot er allerede committed
  // via tryWin, credit har idempotency-key, ledger-entry kan re-kjøres
  // manuelt). Bruk capped beløp slik at §71-rapport reflekterer faktisk
  // utbetalt sum. Hopper over hvis payoutCents=0 (ingen faktisk utbetaling).
  const ledgerPort = params.complianceLedgerPort;
  if (ledgerPort && payoutCents > 0) {
    try {
      await ledgerPort.recordComplianceLedgerEvent({
        hallId: pot.hallId,
        // Spill 1 (hovedspill) — pot-evaluator er Spill-1-spesifikk.
        gameType: ledgerGameTypeForSlug("bingo"),
        channel: "INTERNET",
        eventType: "EXTRA_PRIZE",
        amount: payoutCents / 100, // ledger-amount er kroner
        gameId: params.scheduledGameId,
        claimId: winResult.eventId ?? pot.id, // pot.id som fallback hvis ingen event-id
        playerId: firstWinner.userId,
        walletId: firstWinner.walletId,
        policyVersion: policyId ?? undefined,
        metadata: {
          reason: "GAME1_POT_PAYOUT",
          potType,
          potKey: pot.potKey,
          potId: pot.id,
          potGrossCents,
          payoutCents,
          houseRetainedCents,
          ordinaryWinCents,
          drawSequenceAtWin: params.drawSequenceAtWin,
          ticketColor: firstWinner.ticketColor,
        },
      });
    } catch (err) {
      log.warn(
        {
          err,
          potId: pot.id,
          potKey: pot.potKey,
          potType,
          hallId: pot.hallId,
          payoutCents,
        },
        "[K2-A CRIT-2] complianceLedger.recordComplianceLedgerEvent EXTRA_PRIZE feilet — pot-payout står, ledger-entry kan re-kjøres manuelt"
      );
    }
  }

  log.info(
    {
      potId: pot.id,
      potKey: pot.potKey,
      potType,
      capType,
      amountCents: payoutCents,
      potGrossCents,
      houseRetainedCents,
      ordinaryWinCents,
      winnerUserId: firstWinner.userId,
      scheduledGameId: params.scheduledGameId,
      drawSequenceAtWin: params.drawSequenceAtWin,
      walletTxId,
    },
    "[PR-T3] pot utløst og utbetalt"
  );

  return {
    potKey: pot.potKey,
    potId: pot.id,
    potType,
    triggered: true,
    amountCents: payoutCents,
    potAmountGrossCents: potGrossCents,
    houseRetainedCents,
    reasonCode: null,
    walletTxId,
  };
}
