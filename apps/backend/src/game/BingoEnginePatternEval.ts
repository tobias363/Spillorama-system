/**
 * BingoEnginePatternEval — pattern + phase evaluation helpers.
 *
 * Ekstrahert fra `BingoEngine.ts` i refactor/s1-bingo-engine-split
 * (Forslag A) for å redusere LOC uten å endre offentlig API eller
 * subklasse-inheritance.
 *
 * **Scope:**
 *   - `evaluateActivePhase` (sekvensiell BIN-694-flyt: 1 Rad → 2 Rader → Fullt Hus)
 *   - `evaluateConcurrentPatterns` (PR-P5-flyt: alle customPatterns parallelt)
 *   - `computeCustomPatternPrize` (beregn premie for én custom pattern)
 *   - `detectPhaseWinners` (flat- eller per-farge-gruppering av vinnere)
 *   - `meetsPhaseRequirement` (per-ticket fase-sjekk)
 *
 * **Payout beholdes i engine:** `payoutPhaseWinner` er for tett koblet til
 * `prizePolicy` + `payoutAudit` + `ledger` + `compliance` + wallet-transfer
 * til at en ren ekstraksjon lønner seg. Derfor sendes den inn som callback
 * (`payoutPhaseWinner`) i `EvaluatePhaseCallbacks`.
 *
 * **Kontrakt:**
 *   - Ren pure-funksjon-modul. Mottar alt den trenger via `callbacks`-
 *     objekt (narrow port) og direkte parametere.
 *   - Ingen global state. `evaluateActivePhase` er rekursiv via sitt eget
 *     parameter-oppsett (recursion til neste fase matches BIN-694-spec).
 *   - Byte-identisk flytting — idempotency-keys, log-meldinger,
 *     side-effekt-rekkefølge alle bevart.
 *
 * **Regulatorisk:** premie-beregning (fixed / percent / multiplier-chain /
 * column-specific / ball-value-multiplier) er uendret. split-rounding
 * audit-hook kalles med samme payload.
 */

import { logger as rootLogger } from "../util/logger.js";
import type { LoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import type { SplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";
import {
  classifyPhaseFromPatternName,
  ticketMaskMeetsPhase,
} from "@spillorama/shared-types/spill1-patterns";
import {
  buildTicketMask as patternMatcherBuildTicketMask,
  matchesPattern as patternMatcherMatches,
} from "./PatternMatcher.js";
import {
  buildTicketMask5x5,
  countCompleteColumns,
  countCompleteRows,
  hasFullBingo,
} from "./ticket.js";
import { resolvePatternsForColor } from "./spill1VariantMapper.js";
import type { GameVariantConfig, PatternConfig } from "./variantConfig.js";
import type {
  ClaimType,
  GameState,
  PatternDefinition,
  RoomState,
  Ticket,
} from "./types.js";
import { DomainError, ballToColumn } from "./BingoEngine.js";

const logger = rootLogger.child({ module: "engine.patternEval" });

/** PR B: Sentinel-nøkkel for flat-path vinner-gruppen (én gruppe, ingen farge-skille). */
export const FLAT_GROUP_KEY = "__flat__";
/** PR B: Sentinel-nøkkel for brett uten ticket.color satt — bruker __default__-matrise. */
export const UNCOLORED_KEY = "__uncolored__";

/**
 * Callbacks som pattern-eval trenger for side-effekter (payout, recovery,
 * lifecycle-avslutning). Disse forblir på `BingoEngine` siden de er tett
 * koblet til private state (rooms, compliance, ledger).
 */
export interface EvaluatePhaseCallbacks {
  readonly splitRoundingAudit: SplitRoundingAuditPort;
  readonly loyaltyHook: LoyaltyPointsHookPort;
  /** Henter variantConfig for rommet — vi tar bort direkte Map-tilgang. */
  getVariantConfig(roomCode: string): GameVariantConfig | undefined;
  /** Pay out en enkelt fase-vinner. Private helper på engine. */
  payoutPhaseWinner(
    room: RoomState,
    game: GameState,
    playerId: string,
    pattern: PatternDefinition,
    patternResult: {
      patternId: string;
      patternName: string;
      claimType: ClaimType;
      isWon: boolean;
    },
    prizePerWinner: number,
  ): Promise<void>;
  /** Avslutt play-sessions (compliance). Private helper på engine. */
  finishPlaySessionsForGame(
    room: RoomState,
    game: GameState,
    endedAtMs: number,
  ): Promise<void>;
  /** Skriv GAME_END-checkpoint. protected helper på engine. */
  writeGameEndCheckpoint(room: RoomState, game: GameState): Promise<void>;
}

/**
 * BIN-694: Evaluér om aktiv fase er vunnet etter siste ball. Kalles
 * automatisk fra `drawNextNumber` når `patternEvalMode ===
 * "auto-claim-on-draw"`.
 *
 * Fase-modell (prosjektleder-spec 2026-04-20):
 *   1. "1 Rad"     → ≥1 hel linje (av 12 mulige per brett)
 *   2. "2 Rader"   → ≥2 hele linjer
 *   3. "Fullt Hus" → alle 25 felt merket
 *
 * Multi-winner-split: flere spillere som oppfyller samme fase på
 * samme ball deler premien likt (per spiller, ikke per brett — så en
 * spiller med 3 vinnende brett regnes som ÉN vinner i splittingen).
 *
 * Etter at fasen er vunnet fortsetter metoden rekursivt for å dekke
 * det sjeldne scenariet der samme ball fullfører to faser (f.eks.
 * spilleren fikk både 1. og 2. linje på samme ball).
 *
 * Runden avsluttes kun når Fullt Hus-fasen er vunnet (eller via
 * MAX_DRAWS_REACHED / DRAW_BAG_EMPTY i drawNextNumber).
 */
export async function evaluateActivePhase(
  callbacks: EvaluatePhaseCallbacks,
  room: RoomState,
  game: GameState,
): Promise<void> {
  if (!game.patternResults || game.status !== "RUNNING") return;

  // PR-P5 (Extra-variant): custom concurrent patterns har egen evaluator.
  // Hvis variantConfig.customPatterns er satt og ikke-tom, delegeres til
  // parallell-evaluator. Validator i startGame avviser kombinasjon med
  // patternsByColor (CUSTOM_AND_STANDARD_EXCLUSIVE), så her kan vi stole
  // på at én mode gjelder av gangen.
  const variantConfigForCustomCheck = callbacks.getVariantConfig(room.code);
  const hasCustomPatterns =
    Array.isArray(variantConfigForCustomCheck?.customPatterns) &&
    variantConfigForCustomCheck!.customPatterns!.length > 0;
  if (hasCustomPatterns) {
    await evaluateConcurrentPatterns(callbacks, room, game);
    return;
  }

  // Find next unwon phase in `order` (patternResults preserves config order).
  const activeResult = game.patternResults.find((r) => !r.isWon);
  if (!activeResult) return;

  const activePattern = game.patterns?.find((p) => p.id === activeResult.patternId);
  if (!activePattern) return;

  // BIN-694: Auto-claim bruker `game.drawnNumbers` som vinner-grunnlag,
  // IKKE `game.marks` — marks er for klient-side UI (manuell merking
  // via socket `ticket:mark`), men server-side evaluation skal være
  // basert på hva som faktisk er trukket. Dette gjør også at spillere
  // som ikke aktivt trykker "merk" fortsatt kan vinne.
  const drawnSet = new Set(game.drawnNumbers);

  // PR B (variantConfig-admin-kobling): per-farge-matrise.
  // Hvis `variantConfig.patternsByColor` er satt, kjøres per-farge-pathen
  // der hver farge har egen premie-matrise og multi-winner-split skjer
  // innen én farges vinnere (PM-vedtak "Option X"). Ellers faller vi
  // tilbake til dagens flat-path.
  const variantConfig = callbacks.getVariantConfig(room.code);
  const hasPerColorMatrix = Boolean(variantConfig?.patternsByColor);

  // Fase-index = posisjon i canonical pattern-array (mapperen garanterer
  // samme rekkefølge på tvers av farger, så index identifiserer fasen).
  const phaseIndex = game.patterns ? game.patterns.indexOf(activePattern) : 0;

  // Detect winners. For flat-path: uniqueset per player. For per-color:
  // Map<color, Set<playerId>> — en spiller kan vinne i flere farger hvis
  // de har brett i flere farger som alle oppfyller fasen.
  const winnerGroups = detectPhaseWinners(
    game, drawnSet, activePattern, variantConfig, hasPerColorMatrix, phaseIndex, room.code,
  );

  if (winnerGroups.totalUniqueWinners === 0) return;

  // Pay out per color-group. For flat-path, the groups map has a single
  // entry under `FLAT_GROUP_KEY`. For per-color, multiple entries.
  let firstPayoutAmount = 0;
  let firstWinnerId = "";
  const allWinnerIds: string[] = [];

  // BIN-687 / PR-P2: cache for multiplier-chain phase-1 base price per
  // color. Computed on-demand when first phase > 1 pattern is payouts.
  // Key = groupKey (FLAT_GROUP_KEY for flat-path, color-name for per-color).
  // Value = phase-1 base prize in kr AFTER minPrize-floor applied — so
  // multiplier-chain-phase-N cascade bygger på gulv-justert base (samsvar
  // med papir-regelen: "Rad 2 min 50 kr" gjelder også når fase 1 ble
  // gulv-justert).
  const phase1BaseCache = new Map<string, number>();
  const computePhase1Base = (
    groupKey: string,
    patterns: readonly PatternConfig[] | null,
  ): number => {
    const cached = phase1BaseCache.get(groupKey);
    if (cached !== undefined) return cached;
    // Flat-path (patterns=null): bruk game.patterns[0] som fase-1-kilde.
    // Per-color: bruk patterns[0] fra fargens matrise.
    const phase1 = patterns
      ? patterns[0]
      : (game.patterns?.[0] ?? null);
    if (!phase1) {
      phase1BaseCache.set(groupKey, 0);
      return 0;
    }
    const rawPhase1 = Math.floor(
      game.prizePool * (phase1.prizePercent ?? 0) / 100,
    );
    const base = Math.max(rawPhase1, phase1.minPrize ?? 0);
    phase1BaseCache.set(groupKey, base);
    return base;
  };

  for (const [groupKey, group] of winnerGroups.byColor) {
    const winnerIds = [...group.playerIds];
    if (winnerIds.length === 0) continue;

    // Resolve prize for this color. flat-path bruker activePattern direkte.
    const prizeSource: {
      winningType?:
        | "percent"
        | "fixed"
        | "multiplier-chain"
        | "column-specific"
        | "ball-value-multiplier";
      prize1?: number;
      prizePercent: number;
      name: string;
      phase1Multiplier?: number;
      minPrize?: number;
      columnPrizesNok?: { B: number; I: number; N: number; G: number; O: number };
      claimType?: "LINE" | "BINGO";
      baseFullHousePrizeNok?: number;
      ballValueMultiplier?: number;
    } =
      hasPerColorMatrix && group.patternForColor
        ? group.patternForColor
        : activePattern;

    // BIN-687 / PR-P2: resolve color-specific phase-1 base for
    // multiplier-chain lookups. For flat-path, patterns=null → cache
    // uses game.patterns[0]; for per-color, patterns from
    // resolvePatternsForColor for denne fargen.
    const colorPatternsForPhase1 = hasPerColorMatrix
      ? resolvePatternsForColor(
          callbacks.getVariantConfig(room.code)!,
          groupKey === FLAT_GROUP_KEY ? "" : groupKey,
        )
      : null;

    let totalPhasePrize: number;
    if (prizeSource.winningType === "fixed") {
      totalPhasePrize = Math.max(0, prizeSource.prize1 ?? 0);
    } else if (prizeSource.winningType === "multiplier-chain") {
      // Fase 1 identifiseres ved fravær av phase1Multiplier-felt (undefined).
      // I så fall bruker vi percent + gulv. For fase N > 1: phase1Base ×
      // multiplier med egen gulv. Admin-valideringen i Spill1Config avviser
      // phase1Multiplier === 0 så engine slipper å håndtere edge-casen.
      const isPhase1 = prizeSource.phase1Multiplier === undefined;
      const basePrize = isPhase1
        ? Math.floor(game.prizePool * (prizeSource.prizePercent ?? 0) / 100)
        : Math.floor(
            computePhase1Base(groupKey, colorPatternsForPhase1) *
              prizeSource.phase1Multiplier!,
          );
      totalPhasePrize = Math.max(basePrize, prizeSource.minPrize ?? 0);
    } else if (prizeSource.winningType === "column-specific") {
      // PR-P3 (Super-NILS): Fullt-Hus-premie avgjøres av kolonne (B/I/N/G/O)
      // for siste trukne ball — dvs. ballen som fullførte bingoen. Admin-
      // valideringen avviser column-specific på ikke-full-house-patterns,
      // men engine dobbeltsjekker for defense-in-depth.
      if (prizeSource.claimType !== "BINGO" && activePattern.claimType !== "BINGO") {
        throw new DomainError(
          "COLUMN_PRIZE_INVALID_PATTERN",
          "column-specific winning type kan kun brukes på Fullt Hus-patterns.",
        );
      }
      if (!prizeSource.columnPrizesNok) {
        throw new DomainError(
          "COLUMN_PRIZE_MISSING",
          "columnPrizesNok mangler for column-specific-pattern.",
        );
      }
      const lastBall = game.drawnNumbers[game.drawnNumbers.length - 1];
      const col = ballToColumn(lastBall);
      if (!col) {
        throw new DomainError(
          "COLUMN_PRIZE_MISSING",
          `Siste ball ${lastBall} mapper ikke til B/I/N/G/O (krever 75-ball).`,
        );
      }
      const prizeForCol = prizeSource.columnPrizesNok[col];
      if (typeof prizeForCol !== "number" || !Number.isFinite(prizeForCol)) {
        throw new DomainError(
          "COLUMN_PRIZE_MISSING",
          `columnPrizesNok.${col} mangler eller er ikke et tall.`,
        );
      }
      totalPhasePrize = Math.max(0, prizeForCol);
    } else if (prizeSource.winningType === "ball-value-multiplier") {
      // PR-P4 (Ball × 10): Fullt-Hus-premie = base + lastBall × multiplier.
      // Bruker rå ball-verdi (ikke kolonne-mapping som P3). Admin-validator
      // avviser på ikke-full-house-pattern; engine dobbeltsjekker for
      // defense-in-depth og fail-closed ved manglende felt.
      if (
        prizeSource.claimType !== "BINGO" &&
        activePattern.claimType !== "BINGO"
      ) {
        throw new DomainError(
          "BALL_VALUE_INVALID_PATTERN",
          "ball-value-multiplier kan kun brukes på Fullt Hus-patterns.",
        );
      }
      const base = prizeSource.baseFullHousePrizeNok;
      const mult = prizeSource.ballValueMultiplier;
      if (
        typeof base !== "number" ||
        !Number.isFinite(base) ||
        base < 0 ||
        typeof mult !== "number" ||
        !Number.isFinite(mult) ||
        mult <= 0
      ) {
        throw new DomainError(
          "BALL_VALUE_FIELDS_MISSING",
          "ball-value-multiplier krever baseFullHousePrizeNok ≥ 0 og ballValueMultiplier > 0.",
        );
      }
      const lastBall = game.drawnNumbers[game.drawnNumbers.length - 1];
      if (
        typeof lastBall !== "number" ||
        !Number.isFinite(lastBall) ||
        lastBall < 1
      ) {
        throw new DomainError(
          "BALL_VALUE_FIELDS_MISSING",
          "Ingen gyldig siste-ball tilgjengelig for ball-value-beregning.",
        );
      }
      totalPhasePrize = Math.max(0, base + lastBall * mult);
    } else {
      totalPhasePrize = Math.floor(
        game.prizePool * (prizeSource.prizePercent ?? 0) / 100,
      );
    }
    // Floor division — any remainder stays with the house (house-rounding).
    const prizePerWinner = Math.floor(totalPhasePrize / winnerIds.length);

    // GAME1_SCHEDULE PR 5 (§3.7): audit rest-øre som huset beholder
    // per farge-gruppe. Formel: totalPhasePrize - winnerCount × prizePerWinner.
    const houseRetainedRest = totalPhasePrize - (winnerIds.length * prizePerWinner);
    if (houseRetainedRest > 0) {
      try {
        await callbacks.splitRoundingAudit.onSplitRoundingHouseRetained({
          amount: houseRetainedRest,
          winnerCount: winnerIds.length,
          totalPhasePrize,
          prizePerWinner,
          patternName: prizeSource.name,
          roomCode: room.code,
          gameId: game.id,
          hallId: room.hallId,
        });
      } catch (err) {
        logger.warn(
          { err, gameId: game.id, roomCode: room.code, amount: houseRetainedRest, color: groupKey },
          "split-rounding audit hook failed — engine fortsetter uansett",
        );
      }
    }

    // Build a per-color PatternDefinition so payoutPhaseWinner can
    // reference the correct pattern.name + winningType + prize1 for
    // audit/ledger purposes. Uses activePattern.id so patternResults
    // stays addressable by its original patternId.
    const colorPattern: PatternDefinition = hasPerColorMatrix && group.patternForColor
      ? {
          ...activePattern,
          name: group.patternForColor.name,
          claimType: group.patternForColor.claimType,
          prizePercent: group.patternForColor.prizePercent,
          ...(typeof group.patternForColor.prize1 === "number" ? { prize1: group.patternForColor.prize1 } : {}),
          ...(group.patternForColor.winningType ? { winningType: group.patternForColor.winningType } : {}),
        }
      : activePattern;

    // Pay out each winner before marking the phase won — so a wallet
    // failure for one winner doesn't leave the phase half-committed.
    for (const playerId of winnerIds) {
      await callbacks.payoutPhaseWinner(
        room, game, playerId, colorPattern, activeResult, prizePerWinner,
      );
    }

    // GAME1_SCHEDULE PR 5: Loyalty game.win hook per vinner (fire-and-forget).
    if (prizePerWinner > 0) {
      for (const playerId of winnerIds) {
        try {
          await callbacks.loyaltyHook.onLoyaltyEvent({
            kind: "game.win",
            userId: playerId,
            amount: prizePerWinner,
            patternName: colorPattern.name,
            roomCode: room.code,
            gameId: game.id,
            hallId: room.hallId,
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, playerId },
            "loyalty game.win hook failed — engine fortsetter uansett",
          );
        }
      }
    }

    // Track first payout for backward-compat patternResult fields.
    if (firstWinnerId === "" && winnerIds.length > 0) {
      firstWinnerId = winnerIds[0]!;
      firstPayoutAmount = prizePerWinner;
    }
    // Aggregate winners — deduplicate hvis samme spiller vant i flere farger.
    for (const pid of winnerIds) {
      if (!allWinnerIds.includes(pid)) allWinnerIds.push(pid);
    }
  }

  // Mark phase as won. For multi-winner the `winnerId` is set to the
  // first winner (backward compat with single-winner test assertions);
  // the full list lives in `winnerIds` (BIN-696) + per-winner
  // ClaimRecords on game.claims.
  activeResult.isWon = true;
  activeResult.wonAtDraw = game.drawnNumbers.length;
  activeResult.winnerId = firstWinnerId;
  activeResult.winnerIds = [...allWinnerIds];
  activeResult.payoutAmount = firstPayoutAmount;

  // End round when Fullt Hus is won.
  if (activePattern.claimType === "BINGO") {
    const endedAtMs = Date.now();
    game.status = "ENDED";
    game.bingoWinnerId = firstWinnerId;
    game.endedAt = new Date(endedAtMs).toISOString();
    game.endedReason = "BINGO_CLAIMED";
    await callbacks.finishPlaySessionsForGame(room, game, endedAtMs);
    await callbacks.writeGameEndCheckpoint(room, game);
    return;
  }

  // Phase 1 → mark lineWinnerId for backward-compat with existing readers.
  if (activePattern.claimType === "LINE" && !game.lineWinnerId) {
    game.lineWinnerId = firstWinnerId;
  }

  // Rare: same ball won two phases simultaneously — recurse.
  await evaluateActivePhase(callbacks, room, game);
}

/**
 * PR-P5 (Extra-variant): concurrent pattern-evaluator.
 *
 * Semantikken er fundamentalt annerledes enn `evaluateActivePhase`:
 *   - Sekvensiell flyt: første unwon pattern per draw; neste trinn
 *     aktiveres når forrige er vunnet.
 *   - Concurrent flyt: ALLE unwon customPatterns evalueres parallelt
 *     per draw. Ett bong kan samtidig oppfylle flere patterns og
 *     få betalt på alle.
 *
 * Payout-rekkefølge matcher `customPatterns.config`-rekkefølge slik at
 * `pattern:won`-events emittes stabilt (Agent 4-kontrakten bevares —
 * én event per vunnet pattern, sekvensielt innenfor draw).
 *
 * Idempotency: hvert pattern har egen `patternResults[i].isWon`-flag.
 * Allerede-vunne patterns hoppes over ved re-evaluering. Payout er
 * dermed idempotent mot samme draw (eksisterende pattern-level guard).
 *
 * Game avsluttes kun når ALLE customPatterns er vunnet (alle
 * `isWon === true`), ELLER når full-house-pattern (mask === 0x1FFFFFF)
 * vinnes.
 */
export async function evaluateConcurrentPatterns(
  callbacks: EvaluatePhaseCallbacks,
  room: RoomState,
  game: GameState,
): Promise<void> {
  if (!game.patternResults || game.status !== "RUNNING") return;
  const drawnSet = new Set(game.drawnNumbers);

  // Iterer alle unwon patterns i config-rekkefølge.
  for (const result of game.patternResults) {
    if (result.isWon) continue;
    const pattern = game.patterns?.find((p) => p.id === result.patternId);
    if (!pattern || !pattern.mask) continue;

    // Finn vinnere for DENNE patternen. Concurrent semantikk:
    // flat-path (uten per-farge-matrise — som er garantert fravær siden
    // startGame-validator avviser kombinasjon). Én spiller = én vinner-slot
    // per pattern (uavhengig av antall bong).
    const winnerIds: string[] = [];
    const uniqueWinners = new Set<string>();
    const patternMask = pattern.mask;
    if (typeof patternMask !== "number") continue;
    for (const [playerId, tickets] of game.tickets) {
      if (uniqueWinners.has(playerId)) continue;
      const playerMarksAll = game.marks.get(playerId);
      for (let ticketIdx = 0; ticketIdx < tickets.length; ticketIdx += 1) {
        const ticket = tickets[ticketIdx];
        const playerMarks = playerMarksAll?.[ticketIdx];
        const marksSet: Set<number> =
          playerMarks && playerMarks.size > 0
            ? playerMarks
            : drawnSet;
        const ticketMask = patternMatcherBuildTicketMask(ticket, marksSet);
        if (patternMatcherMatches(ticketMask, patternMask)) {
          uniqueWinners.add(playerId);
          winnerIds.push(playerId);
          break;
        }
      }
    }

    if (winnerIds.length === 0) continue;

    // Beregn payout per pattern. Gjenbruker eksisterende winning-types
    // (fixed/percent/multiplier-chain/column-specific/ball-value-multiplier)
    // via samme utregning som evaluateActivePhase. Custom patterns har
    // ikke per-farge-matrise i P5 (mutually exclusive), så flat-path.
    const lastBall = game.drawnNumbers[game.drawnNumbers.length - 1];
    const totalPhasePrize = computeCustomPatternPrize(
      pattern,
      game.prizePool,
      lastBall,
    );
    const prizePerWinner = Math.floor(totalPhasePrize / winnerIds.length);

    const houseRetainedRest = totalPhasePrize - (winnerIds.length * prizePerWinner);
    if (houseRetainedRest > 0) {
      try {
        await callbacks.splitRoundingAudit.onSplitRoundingHouseRetained({
          amount: houseRetainedRest,
          winnerCount: winnerIds.length,
          totalPhasePrize,
          prizePerWinner,
          patternName: pattern.name,
          roomCode: room.code,
          gameId: game.id,
          hallId: room.hallId,
        });
      } catch (err) {
        logger.warn(
          { err, gameId: game.id, roomCode: room.code, amount: houseRetainedRest },
          "split-rounding audit hook failed — engine fortsetter uansett",
        );
      }
    }

    // Payout per vinner. Idempotency: payoutPhaseWinner har allerede
    // duplicate-guard via patternResult.isWon + claim-id sammensetning.
    // PR-P5 idempotency-key: custom-pattern-{gameId}-{patternId}-{playerId}
    // inngår i claim.id via patternId-del av ledger-key.
    for (const playerId of winnerIds) {
      await callbacks.payoutPhaseWinner(
        room, game, playerId, pattern, result, prizePerWinner,
      );
    }

    // Mark pattern som vunnet + broadcast-kompatibelt snapshot.
    result.isWon = true;
    result.winnerIds = [...winnerIds];
    result.winnerId = winnerIds[0];
    result.winnerCount = winnerIds.length;
    result.wonAtDraw = game.drawnNumbers.length;
    result.payoutAmount = prizePerWinner;
  }

  // Spillet avsluttes når alle customPatterns er vunnet. Full-house-
  // pattern (mask === 0x1FFFFFF) kan også trigge tidlig avslutning, men
  // scope-bekreftelsen sa "alle unwon = ferdig" — enkleste semantikken.
  const allDone = game.patternResults.every((r) => r.isWon);
  if (allDone) {
    const endedAtMs = Date.now();
    game.status = "ENDED";
    game.endedAt = new Date(endedAtMs).toISOString();
    game.endedReason = "BINGO_CLAIMED";
    await callbacks.finishPlaySessionsForGame(room, game, endedAtMs);
    await callbacks.writeGameEndCheckpoint(room, game);
  }
}

/**
 * PR-P5: compute prize for custom pattern. Gjenbruker winning-type-
 * logikken fra evaluateActivePhase i forenklet flat-path form (ingen
 * per-farge-matrise for custom).
 */
export function computeCustomPatternPrize(
  pattern: PatternDefinition,
  prizePool: number,
  lastBall: number | undefined,
): number {
  if (pattern.winningType === "fixed") {
    return Math.max(0, pattern.prize1 ?? 0);
  }
  if (pattern.winningType === "column-specific") {
    if (!pattern.columnPrizesNok || typeof lastBall !== "number") {
      throw new DomainError(
        "COLUMN_PRIZE_MISSING",
        "columnPrizesNok mangler eller lastBall udefinert.",
      );
    }
    const col = ballToColumn(lastBall);
    if (!col) throw new DomainError("COLUMN_PRIZE_MISSING", `Ball ${lastBall} utenfor B/I/N/G/O.`);
    return Math.max(0, pattern.columnPrizesNok[col]);
  }
  if (pattern.winningType === "ball-value-multiplier") {
    const base = pattern.baseFullHousePrizeNok;
    const mult = pattern.ballValueMultiplier;
    if (
      typeof base !== "number" || base < 0 ||
      typeof mult !== "number" || mult <= 0 ||
      typeof lastBall !== "number"
    ) {
      throw new DomainError(
        "BALL_VALUE_FIELDS_MISSING",
        "base/multiplier/lastBall mangler for ball-value.",
      );
    }
    return Math.max(0, base + lastBall * mult);
  }
  // multiplier-chain i concurrent-path er ikke meningsfylt (fase-1-basis
  // er en sekvens-konsept). Fall tilbake til percent-beregning.
  return Math.floor(prizePool * (pattern.prizePercent ?? 0) / 100);
}

/**
 * PR B: Detekter fase-vinnere, gruppert per farge når
 * `patternsByColor` er satt. Flat-path returnerer én gruppe under
 * nøkkelen `FLAT_GROUP_KEY`.
 *
 * Per-farge-semantikk (PM-vedtak "Option X"):
 *   - En (spiller, farge)-kombinasjon er en unik winner-slot.
 *   - En spiller med brett i flere farger, der flere farger oppfyller
 *     fasen, vinner i hver farge — får betalt én gang per farge.
 *   - Multi-winner-split skjer innen én farges vinnere.
 *
 * Flat-path-semantikk (uendret fra før):
 *   - En spiller vinner fasen én gang uansett antall brett.
 *   - Alle vinnere deler én pott likt.
 */
export function detectPhaseWinners(
  game: GameState,
  drawnSet: Set<number>,
  activePattern: PatternDefinition,
  variantConfig: GameVariantConfig | undefined,
  hasPerColorMatrix: boolean,
  phaseIndex: number,
  roomCode: string,
): {
  totalUniqueWinners: number;
  byColor: Map<string, { playerIds: Set<string>; patternForColor: PatternConfig | null }>;
} {
  const byColor = new Map<
    string,
    { playerIds: Set<string>; patternForColor: PatternConfig | null }
  >();
  const uniquePlayers = new Set<string>();

  if (!hasPerColorMatrix || !variantConfig) {
    // Flat-path: én gruppe, uniqueset per player (ignorér farge).
    const flatIds = new Set<string>();
    for (const [playerId, tickets] of game.tickets) {
      for (let i = 0; i < tickets.length; i += 1) {
        if (meetsPhaseRequirement(activePattern, tickets[i], drawnSet)) {
          flatIds.add(playerId);
          break;
        }
      }
    }
    if (flatIds.size > 0) {
      byColor.set(FLAT_GROUP_KEY, { playerIds: flatIds, patternForColor: null });
    }
    return { totalUniqueWinners: flatIds.size, byColor };
  }

  // Per-color path: iterate alle brett, grupper per (farge, spiller).
  for (const [playerId, tickets] of game.tickets) {
    for (const ticket of tickets) {
      if (!meetsPhaseRequirement(activePattern, ticket, drawnSet)) continue;
      const colorKey = ticket.color ?? UNCOLORED_KEY;
      let group = byColor.get(colorKey);
      if (!group) {
        // Resolve matrise for denne fargen. Warning når __default__ slår
        // inn for en farge som finnes i ticketTypes (konfig-gap).
        const patterns = resolvePatternsForColor(variantConfig, ticket.color, (missingColor) => {
          logger.warn(
            { color: missingColor, roomCode, gameId: game.id },
            "patternsByColor missing entry for ticket color — using __default__ matrix",
          );
        });
        const patternForColor = patterns[phaseIndex] ?? null;
        group = { playerIds: new Set(), patternForColor };
        byColor.set(colorKey, group);
      }
      group.playerIds.add(playerId);
      uniquePlayers.add(playerId);
    }
  }

  return { totalUniqueWinners: uniquePlayers.size, byColor };
}

/**
 * BIN-694: Evaluér om et brett oppfyller aktiv fase sitt krav.
 *
 * Fase-modell (norsk 75-ball, avklart 2026-04-24):
 *   - "1 Rad" (fase 1): ≥1 horisontal rad ELLER ≥1 vertikal kolonne
 *   - "2 Rader" (fase 2): ≥2 hele horisontale rader
 *   - "3 Rader" (fase 3): ≥3 hele horisontale rader
 *   - "4 Rader" (fase 4): ≥4 hele horisontale rader
 *   - "Fullt Hus" (fase 5): alle 25 felt merket
 *
 * Klassifisering og kandidat-masker ligger i
 * `@spillorama/shared-types/spill1-patterns` og deles med klient
 * `PatternMasks.ts` (samme kilde = ingen drift-risiko).
 *
 * Ukjente pattern-navn (jubilee "Stjerne", Spill 3 "Bilde"/"Ramme",
 * Databingo60 line-pattern) faller tilbake til `claimType`-basert
 * sjekk: LINE = ≥1 linje, BINGO = fullt hus.
 */
export function meetsPhaseRequirement(
  pattern: PatternDefinition,
  ticket: Ticket,
  drawnSet: Set<number>,
): boolean {
  if (pattern.claimType === "BINGO") {
    return hasFullBingo(ticket, drawnSet);
  }
  const phase = classifyPhaseFromPatternName(pattern.name);
  if (phase === null) {
    return (
      countCompleteRows(ticket, drawnSet) >= 1 ||
      countCompleteColumns(ticket, drawnSet) >= 1
    );
  }
  const ticketMask = buildTicketMask5x5(ticket, drawnSet);
  if (ticketMask === null) {
    return (
      countCompleteRows(ticket, drawnSet) >= 1 ||
      countCompleteColumns(ticket, drawnSet) >= 1
    );
  }
  return ticketMaskMeetsPhase(ticketMask, phase);
}
