/**
 * GAME1 Lucky Number Bonus Service — P0 pilot-gap (K1-C).
 *
 * Legacy-mekanikk (legacy/unity-backend/Game/Game1/Controllers/GameProcess.js:
 * 420-429):
 *
 *   if ((lastBall == +winner.luckyNumber) && wonPattern == "Full House") {
 *     let luckyNumberPrize = Math.round(room.luckyNumberPrize);
 *     luckyNumberBonusWinners.push({ ...winnerObj,
 *       wonAmount: +parseFloat(luckyNumberPrize).toFixed(2),
 *       lineTypeDisplay: "Lucky Number Bonus",
 *       bonusType: "Lucky Number Bonus",
 *       isWonLuckyNumberBonus: true });
 *   }
 *
 * Regler (verifisert mot legacy):
 *   1) Kun Fullt Hus (fase 5). Linje-vinn (fase 1..4) gir ALDRI bonus.
 *   2) `lastBall === winner.luckyNumber` — ballen som utløste Fullt Hus må
 *      være spillerens valgte lykketall.
 *   3) Bonus-beløp er fast (config), utbetales i tillegg til ordinær
 *      Full-House-premie. Ikke split — hver kvalifisert vinner får
 *      FULL bonus (legacy var per-ticket; modern code er per-winner-
 *      assignment-eier siden luckyNumber lagres per (room, player)).
 *   4) Kun spillere som faktisk vant Full House. Ikke-vinnere med matching
 *      lucky får ingenting (legacy iterasjon skjer kun over `winners`-
 *      listen).
 *   5) `luckyNumber === null/undefined` eller `bonusConfig.enabled === false`
 *      eller `amountCents <= 0` → ingen bonus (fail-closed).
 *
 * Legacy utbetales til `winnings`-konto (legacy `purchasedSlug: "realMoney"`
 * + `transactionSlug: "luckyNumberPrizeGame1"` mapper til winnings-sida).
 *
 * Pure service — ingen DB, ingen I/O. Kan brukes inne i drawNext-
 * transaksjonen uten bekymring for side-effekter. Følger samme mønster
 * som `Game1JackpotService`.
 */

import { TOTAL_PHASES } from "./Game1PatternEvaluator.js";

/**
 * Konfig for en sub-game's lucky-number-bonus. Satt per sub-game i schedule-
 * config (admin-web `SubGamesListEditor.ts` — samme mønster som
 * `jackpotDraw`/`jackpotPrize`). 0-amount eller `enabled=false` = bonus av.
 */
export interface Game1LuckyBonusConfig {
  /** Bonus-beløp i øre (per kvalifisert vinner). 0/mangler = bonus av. */
  amountCents: number;
  /** Eksplisitt på/av-flag. false overstyrer selv om amountCents > 0. */
  enabled: boolean;
}

export interface Game1LuckyBonusEvaluationInput {
  /** Vinner-identifikator (for logging / idempotency). */
  winnerId: string;
  /**
   * Spillerens valgte lykketall (1..60 i Spill 1). null/undefined = spiller
   * har ikke valgt lucky → ingen bonus.
   */
  luckyNumber: number | null | undefined;
  /**
   * Ballen som utløste Fullt Hus. Må være === luckyNumber for bonus.
   * I praksis `lastBall` fra drawNext, overført via engine → service.
   */
  fullHouseTriggerBall: number;
  /**
   * Fasen som ble vunnet. Bonus gis KUN ved fase 5 (Fullt Hus). Alle andre
   * faser returnerer `triggered=false` uansett andre vilkår.
   */
  phase: number;
  /** Bonus-config fra sub-game. */
  bonusConfig: Game1LuckyBonusConfig;
}

export interface Game1LuckyBonusEvaluationResult {
  /** true hvis bonus utløses. */
  triggered: boolean;
  /** Bonus-beløp i øre (0 hvis ikke trigget). */
  bonusCents: number;
}

/**
 * Pure service som evaluerer Lucky Number Bonus per vinnende brett ved
 * Fullt Hus.
 */
export class Game1LuckyBonusService {
  /**
   * Evaluer om en Fullt-Hus-vinner utløser Lucky Number Bonus. Alle
   * fail-closed-sjekker skjer her — caller kan stole på resultatet og bare
   * sjekke `triggered`.
   */
  evaluate(
    input: Game1LuckyBonusEvaluationInput
  ): Game1LuckyBonusEvaluationResult {
    // Regel 1: kun Fullt Hus.
    if (input.phase !== TOTAL_PHASES) {
      return { triggered: false, bonusCents: 0 };
    }

    // Regel 5a: bonus må være eksplisitt enabled.
    if (!input.bonusConfig || input.bonusConfig.enabled !== true) {
      return { triggered: false, bonusCents: 0 };
    }

    // Regel 5b: bonus-beløp må være positivt heltall.
    const amount = Math.floor(input.bonusConfig.amountCents ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { triggered: false, bonusCents: 0 };
    }

    // Regel 5c: spiller må ha valgt et lykketall.
    if (
      input.luckyNumber === null ||
      input.luckyNumber === undefined ||
      !Number.isInteger(input.luckyNumber)
    ) {
      return { triggered: false, bonusCents: 0 };
    }

    // Regel 5d: fullHouseTriggerBall må være et gyldig heltall (fail-closed
    // mot NaN / strings som ikke ble koercet).
    if (!Number.isInteger(input.fullHouseTriggerBall)) {
      return { triggered: false, bonusCents: 0 };
    }

    // Regel 2: lastBall === luckyNumber (den utløsende ballen).
    if (input.fullHouseTriggerBall !== input.luckyNumber) {
      return { triggered: false, bonusCents: 0 };
    }

    return { triggered: true, bonusCents: amount };
  }
}

/**
 * Legg merke til at denne typen er duplisert i flere retninger:
 *   - `apps/admin-web/src/pages/games/schedules/SubGamesListEditor.ts`
 *     eksponerer feltet i UI-nivå via `luckyBonusAmount` + `luckyBonusEnabled`.
 *   - Her tolker vi det som sub-game.jackpotData-siblings siden PR #432's
 *     `jackpotDraw`/`jackpotPrize` brukte samme mønster (strukturerte felter
 *     på slot.jackpotData).
 *
 * Parse-funksjonen nedenfor hentes fra `jackpotData` eller `extra`-objekt.
 * Null returneres hvis config er fraværende/ugyldig — caller skal behandle
 * null som "bonus av".
 */
export function resolveLuckyBonusConfig(
  ticketConfigJson: unknown
): Game1LuckyBonusConfig | null {
  if (!ticketConfigJson || typeof ticketConfigJson !== "object") return null;
  const obj = ticketConfigJson as Record<string, unknown>;

  // Primær lookup: sub-game.luckyBonus (strukturert felt, samme mønster som
  // jackpot-routingen). Bygges av admin-web SubGamesListEditor og persisted
  // i ticket_config_json ved game-spawn.
  const luckyBonus = (obj.luckyBonus as Record<string, unknown> | undefined) ?? null;
  if (luckyBonus && typeof luckyBonus === "object") {
    const amountRaw = luckyBonus.amountCents;
    const enabledRaw = luckyBonus.enabled;
    const amountCents =
      typeof amountRaw === "number" && Number.isFinite(amountRaw)
        ? Math.floor(amountRaw)
        : 0;
    const enabled = enabledRaw === true;
    if (amountCents > 0 && enabled) {
      return { amountCents, enabled: true };
    }
    // Eksplisitt disabled eller 0-beløp — returner disabled-config.
    if (luckyBonus.enabled !== undefined || luckyBonus.amountCents !== undefined) {
      return { amountCents, enabled: false };
    }
  }

  return null;
}
