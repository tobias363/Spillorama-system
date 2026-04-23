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
}

export interface PotEvaluationResult {
  potKey: string;
  potId: string;
  potType: string;
  triggered: boolean;
  amountCents: number;
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

  const results: PotEvaluationResult[] = [];
  for (const pot of pots) {
    const potType = pot.config.potType ?? "generic";
    try {
      const res = await evaluateSinglePot({
        pot,
        potType,
        ...input,
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
  audit: AuditLogService;
  potDailyTickService?: PotDailyAccumulationTickService;
}): Promise<PotEvaluationResult> {
  const { pot, potType, firstWinner } = params;
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
      reasonCode: winResult.reasonCode,
      walletTxId: null,
    };
  }

  // Pot utløst — krediter vinner. Idempotency-key per pot + spill
  // forhindrer dobbel credit ved retry.
  const amountKr = winResult.amountCents / 100;
  const idempotencyKey = idempotencyKeyFor(potType, pot, params.scheduledGameId);
  const description = creditDescriptionFor(potType, pot);

  let walletTxId: string | null = null;
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
          amountCents: winResult.amountCents,
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
          amountCents: winResult.amountCents,
          winnerWalletId: firstWinner.walletId,
          idempotencyKey,
        },
        "[PR-T3] wallet.credit feilet for pot — draw ruller tilbake"
      );
      throw err;
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
  const auditDetails = isJackpott
    ? {
        hallId: pot.hallId,
        scheduledGameId: params.scheduledGameId,
        winnerUserId: firstWinner.userId,
        assignmentId: firstWinner.assignmentId,
        amountCents: winResult.amountCents,
        drawSequenceAtWin: params.drawSequenceAtWin,
        potKey: pot.potKey,
      }
    : {
        potKey: pot.potKey,
        potType,
        hallId: pot.hallId,
        scheduledGameId: params.scheduledGameId,
        drawSequenceAtWin: params.drawSequenceAtWin,
        amountCents: winResult.amountCents,
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

  log.info(
    {
      potId: pot.id,
      potKey: pot.potKey,
      potType,
      amountCents: winResult.amountCents,
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
    amountCents: winResult.amountCents,
    reasonCode: null,
    walletTxId,
  };
}
