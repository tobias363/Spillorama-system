/**
 * Spill 3 (monsterbingo) global-room bridge per Tobias-direktiv 2026-05-08.
 *
 * Tar `Spill3Config` (admin-konfigurert global singleton) og mapper det inn i
 * eksisterende `GameVariantConfig`-struktur slik at Game3Engine + Perpetual-
 * RoundService kan kjøre uten store endringer i hot-pathen.
 *
 * **Hva denne tjenesten gjør:**
 *   - Bygger 5 patterns (Row 1-4 + Full House) basert på prize-mode:
 *     - "fixed"      → patterns med `winningType: "fixed"` + `prize1` (kr-beløp)
 *     - "percentage" → patterns med `winningType: "percent"` + `prizePercent`
 *   - Setter `minTicketsBeforeCountdown` så PerpetualRoundService respekterer
 *     auto-start-threshold før første runde og mellom påfølgende runder.
 *   - Setter `roundPauseMs` til pauseBetweenRowsMs (gjenbrukt felt) så at
 *     pausen mellom runder = pausen mellom rader (siden runde-end direkte
 *     leder til neste rundes start i perpetual-loopen).
 *   - Bruker single ticket-type "Standard" (already i DEFAULT_GAME3_CONFIG).
 *
 * **Hva denne tjenesten IKKE gjør (kjent gjenstående arbeid):**
 *
 *   1. **Sequential row-with-pause-mekanikk**: Spec'en sier "Rad 1 → 3s pause →
 *      Rad 2 → 3s pause → ...". Dagens Game3Engine evaluerer alle aktive
 *      patterns konkurrent (i parallel), ikke sekvensielt med pauser. Engine-
 *      siden trenger en utvidelse som:
 *        a) Kun aktiverer ÉN pattern-fase om gangen.
 *        b) Etter at pattern-fasen er vunnet (eller automatisk avansert),
 *           pauser engine i `pauseBetweenRowsMs` ms før neste pattern aktiveres.
 *        c) Round ender ved Full House ELLER når 75 baller er trukket.
 *
 *      For pilot kan dette tas i en oppfølgings-PR som utvider PatternCycler
 *      til å ha en "phaseDelayMs"-mekanikk og en "pendingPhaseTransition"-
 *      state. Denne tjenesten preparer config-shape-en korrekt nå slik at
 *      engine-utvidelsen blir rett-frem.
 *
 *   2. **Round-omsetning-snapshot for percentage-mode**: For percentage-modus
 *      må engine ha en "totalTicketSalesCents"-snapshot ved round-start (ikke
 *      ved hver pattern-vinst — det ville endre poten dynamisk). Denne
 *      tjenesten forutsetter at `prizePool` settes ved round-start til
 *      `totalSoldCents` slik at `prizePercent`-payouts kan beregnes som
 *      `prizePool × pct / 100`.
 *
 *   3. **Engine-side end-condition**: Spec'en sier "First Full House ELLER
 *      75 balls". Dagens engine ender på "G3_FULL_HOUSE" (alle patterns
 *      resolved ELLER explicit Full House). Med 5 patterns hvor pattern 5
 *      er Full House (claim-type=BINGO, dekker alle 25 celler), vil
 *      `explicit Full House` triggere round-end korrekt — men 75-ball-
 *      fallback må sjekkes (DRAW_BAG_EMPTY vs MAX_DRAWS_REACHED).
 *
 *   4. **Migration av eksisterende data**: Dagens DEFAULT_GAME3_CONFIG har
 *      4 designs-patterns (Topp+midt, Kryss, etc.). Etter denne PR-en bytter
 *      Spill 3 til 5 standard Row 1-4 + Full House-patterns. Eksisterende
 *      pågående runder bør få lov til å fullføre med gammel config (engine
 *      snapshotter ved round-start).
 *
 * Mønster: følger samme bridge-pattern som GamePlanEngineBridge for Spill 1.
 */

import type { GameVariantConfig, PatternConfig } from "./variantConfig.js";
import type { Spill3Config } from "./Spill3ConfigService.js";

/** 5 fase-navn brukt i wire-protokollen og UI. */
export const SPILL3_PHASE_NAMES = ["1 Rad", "2 Rader", "3 Rader", "4 Rader", "Fullt Hus"] as const;

/**
 * Bygg `GameVariantConfig` fra `Spill3Config`.
 *
 * Output-shape:
 *   - ticketTypes: enkelt "Standard"-type, priceMultiplier=1
 *   - patterns: 5 sekvensielle patterns (Row 1-4 + Full House)
 *   - patternEvalMode: "auto-claim-on-draw"
 *   - autoClaimPhaseMode: true (same som Spill 1's 5-fase) — engine evaluerer
 *     én fase om gangen via `evaluateActivePhase`-pathen, IKKE
 *     concurrent-evaluering som dagens DEFAULT_GAME3_CONFIG bruker.
 *   - maxBallValue/drawBagSize: 75
 *   - minTicketsBeforeCountdown: fra config
 *   - roundPauseMs: bruker pauseBetweenRowsMs (delt verdi for runde-pause
 *     og fase-pause — Spill 3 har samme oppførsel mellom rad-faser og
 *     mellom runder per Tobias-direktiv)
 *
 * **Premie-beregning per fase:**
 *
 * - **fixed-mode**: hver pattern får `winningType: "fixed"` + `prize1 = X`
 *   (i kr) der X er den admin-konfigurerte verdien. Engine sin
 *   `evaluateActivePhase`-path leser `prize1` direkte.
 *
 * - **percentage-mode**: hver pattern får `winningType: "percent"` +
 *   `prizePercent = pct` (0-100). Engine multipliserer med rundens
 *   `prizePool` ved payout.
 *
 *   For at percentage-mode skal beregne riktig premie må `prizePool` ved
 *   round-start settes til `totalTicketSalesCents` (omsetning for runden).
 *   Dette skjer naturlig i BingoEngine.startGame når `entryFee × ticketCount`
 *   summer = total-sold. For globalt rom med X bonger × ticketPriceCents
 *   blir `prizePool` korrekt før første pattern evalueres.
 */
export function buildVariantConfigFromSpill3Config(
  config: Spill3Config,
): GameVariantConfig {
  const patterns: PatternConfig[] = [];

  for (let i = 0; i < 5; i++) {
    const isFullHouse = i === 4;
    const name = SPILL3_PHASE_NAMES[i] ?? `Phase ${i + 1}`;
    const claimType: PatternConfig["claimType"] = isFullHouse ? "BINGO" : "LINE";
    const design = isFullHouse ? 0 : i + 1;  // 1-4 for rader, 0 for full house

    if (config.prizeMode === "fixed") {
      // Fixed-mode: bruk prize1 (kr-beløp). Engine evaluerer dette via
      // `winningType: "fixed"` -path som bypasser pool-skalering.
      const fixedAmount = pickFixedAmount(config, i);
      // Konverter cents → kr (engine `prize1` er i kr per legacy-konvensjon).
      const prize1Kr = Math.floor(fixedAmount / 100);
      patterns.push({
        name,
        claimType,
        prizePercent: 0,
        winningType: "fixed",
        prize1: prize1Kr,
        design,
      });
    } else {
      // Percentage-mode: prizePercent leses av engine og multipliseres med
      // game.prizePool ved payout. Engine: `prizePool × pct / 100`.
      const pct = pickPercentage(config, i);
      patterns.push({
        name,
        claimType,
        prizePercent: pct,
        winningType: "percent",
        design,
      });
    }
  }

  // Spec: "Tobias-direktiv 2026-05-08 — 5 kr per bong, ÉN type bong"
  const ticketPriceMultiplier = 1;  // 1 unit av entryFee per ticket

  return {
    ticketTypes: [
      {
        name: "Standard",
        type: "monsterbingo-5x5",
        priceMultiplier: ticketPriceMultiplier,
        ticketCount: 1,
      },
    ],
    patterns,
    maxBallValue: 75,
    drawBagSize: 75,
    patternEvalMode: "auto-claim-on-draw",
    autoClaimPhaseMode: true,
    // Tobias-direktiv 2026-05-08: minTicketsBeforeCountdown driver auto-
    // start. PerpetualRoundService leser dette feltet for både første
    // runde-spawn og mellom-runde-countdown.
    minTicketsBeforeCountdown: config.minTicketsToStart,
    // pauseBetweenRowsMs gjenbrukes som roundPauseMs siden globalt rom
    // har konsekvent pause mellom faser og mellom runder per spec.
    roundPauseMs: clampRoundPause(config.pauseBetweenRowsMs),
  };
}

/**
 * Hent fast premie i øre for en gitt fase-indeks (0=Rad 1, ..., 4=Fullt Hus).
 * Returnerer 0 hvis konfig er null (caller skal ha validert med
 * assertConfigConsistency før dette).
 */
function pickFixedAmount(config: Spill3Config, phaseIdx: number): number {
  switch (phaseIdx) {
    case 0: return config.prizeRad1Cents ?? 0;
    case 1: return config.prizeRad2Cents ?? 0;
    case 2: return config.prizeRad3Cents ?? 0;
    case 3: return config.prizeRad4Cents ?? 0;
    case 4: return config.prizeFullHouseCents ?? 0;
    default: return 0;
  }
}

/**
 * Hent prosent for en gitt fase-indeks. Returnerer 0 hvis konfig er null.
 */
function pickPercentage(config: Spill3Config, phaseIdx: number): number {
  switch (phaseIdx) {
    case 0: return config.prizeRad1Pct ?? 0;
    case 1: return config.prizeRad2Pct ?? 0;
    case 2: return config.prizeRad3Pct ?? 0;
    case 3: return config.prizeRad4Pct ?? 0;
    case 4: return config.prizeFullHousePct ?? 0;
    default: return 0;
  }
}

/**
 * Klamp roundPauseMs til engine-godkjente grenser (1000-300000).
 * Pause-spec er 0-60000 (per migration), men `resolveRoundPauseMs` har
 * MIN=1000. Hvis admin har satt 0 (umiddelbar) bruker vi 1000ms som lavest
 * mulig — det er liten praktisk forskjell og tillater at engine ikke
 * faller tilbake til env-default.
 */
function clampRoundPause(pauseMs: number): number {
  const ROUND_PAUSE_MIN_FOR_ENGINE = 1000;
  const ROUND_PAUSE_MAX_FOR_ENGINE = 300_000;
  if (pauseMs < ROUND_PAUSE_MIN_FOR_ENGINE) return ROUND_PAUSE_MIN_FOR_ENGINE;
  if (pauseMs > ROUND_PAUSE_MAX_FOR_ENGINE) return ROUND_PAUSE_MAX_FOR_ENGINE;
  return Math.floor(pauseMs);
}

/**
 * Beregn forventet utbetaling for en gitt fase ved en gitt totalSold.
 *
 * For percentage-mode: returnerer `totalSoldCents × pct / 100`.
 * For fixed-mode: returnerer `prize_radN_cents` (uavhengig av totalSold).
 *
 * Brukes av admin-UI for å vise "ved X solgte bonger blir Rad 1 = Y kr".
 */
export function calculatePhasePrizeCents(
  config: Spill3Config,
  phaseIdx: number,
  totalSoldCents: number,
): number {
  if (config.prizeMode === "fixed") {
    return pickFixedAmount(config, phaseIdx);
  }
  const pct = pickPercentage(config, phaseIdx);
  return Math.floor((totalSoldCents * pct) / 100);
}
