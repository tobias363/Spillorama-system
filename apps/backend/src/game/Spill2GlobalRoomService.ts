/**
 * Spill 2 (rocket / Tallspill) global-room bridge per Tobias-direktiv
 * 2026-05-08 (parallel til Spill 3 — #1006).
 *
 * Tar `Spill2Config` (admin-konfigurert global singleton) og mapper det inn i
 * eksisterende `GameVariantConfig`-struktur slik at Game2Engine + Perpetual-
 * RoundService kan kjøre uten store endringer i hot-pathen.
 *
 * **Hva denne tjenesten gjør:**
 *   - Bygger `GameVariantConfig` med 3×3-ticket-shape, 21-ball drawbag,
 *     `patternEvalMode: "auto-claim-on-draw"` (Game2Engine-pathen).
 *   - Setter `jackpotNumberTable` til admin-konfigurert mapping
 *     (Game2Engine bruker dette via `computeJackpotList` + `resolveJackpotPrize`).
 *   - Setter `luckyNumberPrize` (når enabled) — engine sjekker
 *     `lastBall === luckyNumber` ved seier.
 *   - Setter `minTicketsBeforeCountdown` så PerpetualRoundService respekterer
 *     auto-start-threshold før første runde og mellom påfølgende runder.
 *   - Setter `roundPauseMs` + `ballIntervalMs` til admin-konfigurerte verdier.
 *
 * **Hva denne tjenesten IKKE gjør (kjent gjenstående arbeid — TODO):**
 *
 *   1. **Lucky-number-randomisering**: legacy game2.js:1628-1712 setter
 *      luckyNumber per runde via random-pick. Admin kan ikke konfigurere
 *      EN spesifikk lucky-number; de skrur bare på/av tilleggspremien.
 *      Engine-side trenger fortsatt å pick'e lucky-number ved round-start.
 *      For pilot lar vi engine beholde sin eksisterende lucky-pick-logikk
 *      og bruker `luckyNumberPrize` fra config bare som beløpet.
 *
 *   2. **Åpningstid-gating i room-spawn**: dette ligger på engine/cron-laget
 *      som sjekker `isWithinOpeningHours(config)` før det spawner ny runde.
 *      Bridge-en eksponerer ikke åpningstidene direkte i variantConfig;
 *      caller (PerpetualRoundService eller Game2AutoDrawTickService) må
 *      lese fra `Spill2ConfigService.getActive()` separat før spawn-call.
 *
 *   3. **Migration av eksisterende GameManagement.config.spill2-overrides**:
 *      Dagens flyt leser `roundPauseMs`/`ballIntervalMs`/`jackpotNumberTable`
 *      fra `app_game_managements.config_json.spill2`. Med denne PR-en
 *      eksisterer to konfig-kilder side om side — `roomState.ts` må
 *      prioritere `Spill2Config.getActive()` over GameManagement-config
 *      for `rocket`-rom (samme mønster som Spill 3 i #1006).
 *
 *      Fall-through-rekkefølge for rocket-rom etter denne PR-en:
 *        a) Spill2Config (global singleton)              ← ny primærkilde
 *        b) GameManagement.config.spill2 (per item)     ← legacy fallback
 *        c) DEFAULT_GAME2_CONFIG                          ← hard fallback
 *
 * Mønster: speiler `Spill3GlobalRoomService` 1:1 (samme bridge-pattern,
 * samme ticket-type-konvensjon, samme klamping av pace-fields).
 */

import type { GameVariantConfig } from "./variantConfig.js";
import type { Spill2Config, Spill2JackpotTable } from "./Spill2ConfigService.js";

/**
 * Klamp roundPauseMs til engine-godkjente grenser (1000-300000).
 */
function clampRoundPause(pauseMs: number): number {
  const ROUND_PAUSE_MIN_FOR_ENGINE = 1000;
  const ROUND_PAUSE_MAX_FOR_ENGINE = 300_000;
  if (pauseMs < ROUND_PAUSE_MIN_FOR_ENGINE) return ROUND_PAUSE_MIN_FOR_ENGINE;
  if (pauseMs > ROUND_PAUSE_MAX_FOR_ENGINE) return ROUND_PAUSE_MAX_FOR_ENGINE;
  return Math.floor(pauseMs);
}

function clampBallInterval(intervalMs: number): number {
  const BALL_INTERVAL_MIN_FOR_ENGINE = 1000;
  const BALL_INTERVAL_MAX_FOR_ENGINE = 10_000;
  if (intervalMs < BALL_INTERVAL_MIN_FOR_ENGINE) return BALL_INTERVAL_MIN_FOR_ENGINE;
  if (intervalMs > BALL_INTERVAL_MAX_FOR_ENGINE) return BALL_INTERVAL_MAX_FOR_ENGINE;
  return Math.floor(intervalMs);
}

/**
 * Bygg `GameVariantConfig` fra `Spill2Config`.
 *
 * Output-shape:
 *   - ticketTypes: enkelt "Standard"-type, type="game2-3x3", priceMultiplier=1
 *     (alle bonger like; legacy Spill 2 har ikke fargevarianter)
 *   - patterns: tom liste — Game2Engine bruker auto-claim-on-draw + 9/9
 *     full-3×3-deteksjon i stedet for pattern-matching.
 *   - patternEvalMode: "auto-claim-on-draw"
 *   - maxBallValue/drawBagSize: 21
 *   - jackpotNumberTable: kopiert fra config (engine leser via
 *     computeJackpotList ved hver draw, resolveJackpotPrize ved seier)
 *   - luckyNumberPrize: prize_cents → kr (engine bruker kr-verdier)
 *   - minTicketsBeforeCountdown: fra config
 *   - roundPauseMs / ballIntervalMs: clamped til engine-grenser
 */
export function buildVariantConfigFromSpill2Config(
  config: Spill2Config,
): GameVariantConfig {
  // luckyNumberPrize forventes i kr av engine (legacy-konvensjon).
  // Vi konverterer fra øre → kr. Når lucky er deaktivert returnerer vi
  // 0 (engine treats 0 som "ingen bonus").
  const luckyKr =
    config.luckyNumberEnabled && config.luckyNumberPrizeCents !== null
      ? Math.floor(config.luckyNumberPrizeCents / 100)
      : 0;

  return {
    ticketTypes: [
      {
        name: "Standard",
        type: "game2-3x3",
        priceMultiplier: 1,
        ticketCount: 1,
      },
    ],
    patterns: [],
    maxBallValue: 21,
    drawBagSize: 21,
    patternEvalMode: "auto-claim-on-draw",
    // Klon jackpot-tabellen så engine ikke kan mutere config-objektet.
    jackpotNumberTable: cloneJackpotTable(config.jackpotNumberTable),
    luckyNumberPrize: luckyKr,
    minTicketsBeforeCountdown: config.minTicketsToStart,
    roundPauseMs: clampRoundPause(config.roundPauseMs),
    ballIntervalMs: clampBallInterval(config.ballIntervalMs),
  };
}

/**
 * Shallow-clone av jackpot-tabellen så caller ikke kan mutere config-state.
 * Hver entry er {price: number, isCash: boolean} — verdier er primitive
 * og trenger ikke deep-clone.
 */
function cloneJackpotTable(table: Spill2JackpotTable): Spill2JackpotTable {
  return {
    "9": { ...table["9"] },
    "10": { ...table["10"] },
    "11": { ...table["11"] },
    "12": { ...table["12"] },
    "13": { ...table["13"] },
    "1421": { ...table["1421"] },
  };
}
