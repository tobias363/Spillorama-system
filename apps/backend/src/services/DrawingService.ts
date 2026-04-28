/**
 * Unified pipeline refactor — Fase 2.
 *
 * Sentral pure-service for "trekk neste ball gitt nåværende state". Erstatter
 * den ad-hoc draw-logikken som er duplisert i `BingoEngine._drawNextNumberLocked`
 * (apps/backend/src/game/BingoEngine.ts:1690+) og `Game1DrawEngineService.drawNext`
 * (apps/backend/src/game/Game1DrawEngineService.ts:983+).
 *
 * **Scope:**
 *
 *   1. Validate: spill må være `RUNNING`, current draws < `maxDraws`,
 *      bag må ikke være tom.
 *   2. Compute: hent neste ball fra `drawBag[drawsCompleted]` (deterministisk
 *      lookup i den shuffled bag).
 *   3. Return: `{ nextBall, drawSequenceNumber, isLastDraw }`.
 *
 * **Out of scope (handled av andre faser):**
 *
 *   - Pattern-evaluering etter draw → Fase 3 (PatternEvalService).
 *   - Wallet-payout → Fase 1 (PayoutService — eksisterer allerede).
 *   - Compliance ledger writes → caller-ansvar.
 *   - Audit log writes → caller-ansvar.
 *   - Socket broadcasts → caller-ansvar.
 *   - DB-persistens → caller-ansvar.
 *   - Mini-game-trigger → caller-ansvar.
 *   - Auto-pause-at-phase-won → caller-ansvar.
 *
 * **Determinisme:**
 *
 *   For en gitt input-state (drawBag + drawsCompleted + status + maxDraws)
 *   gir tjenesten ALLTID samme output. Selve "randomness"-beslutningen om
 *   hvilken ball som kommer ut neste gang skjedde da `drawBag` ble shuffled
 *   ved game-start (via `buildDrawBag()`). Service-en er en deterministisk
 *   funksjon `(state) → result`.
 *
 *   Dette betyr at vi ikke trenger en `RngPort` for Fase 2 — bag-en ER kilden
 *   til randomness, og den er allerede forutbestemt. Hvis vi senere vil
 *   abstrahere bag-shuffle (for at GameOrchestrator-tester skal være
 *   deterministiske end-to-end), legger vi til en `RngPort` i en senere fase.
 *
 * **Ingen porter trengs i Fase 2:**
 *
 *   Fordi tjenesten er pure (ingen IO, ingen klokke, ingen DB), trenger den
 *   verken `WalletPort`, `CompliancePort`, `AuditPort`, `ClockPort` eller
 *   en ny `RngPort`. Den opererer kun på data som passes inn.
 *
 *   Game1DrawEngineService og BingoEngine kan i Fase 4 (GameOrchestrator)
 *   hente sin DB-state, konstruere en `DrawingGameState`, kalle
 *   `drawingService.drawNext(state)`, og applye resultatet til DB. Ingen
 *   adapter-bridges nødvendig.
 *
 * **Atomicity:**
 *
 *   Service-en endrer ingen ekstern state — caller er ansvarlig for å
 *   wrappe sin DB-mutation (UPDATE drawn_balls, INSERT into draws-tabell)
 *   i en transaksjon. DrawingService kaster en `DrawingError` ved invariant-
 *   brudd; caller forventes å rolle tilbake tx hvis dette skjer.
 *
 * **Idempotency:**
 *
 *   Pure-funksjons-natur gjør at `drawNext(state)` med samme input alltid
 *   gir samme output. Caller's idempotency er sikret ved at de øker
 *   `drawsCompleted` i sin egen state etter hvert kall; gjentatte kall
 *   med samme `drawsCompleted` gir samme ball uten å mutere noe.
 */

import type { ResolvedDrawBagConfig } from "../game/DrawBagStrategy.js";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Lifecycle-status for et bingospill — speilkopiert fra de relevante
 * verdiene som finnes i `BingoEngine` (`game.status: "WAITING" | "RUNNING"
 * | "ENDED"`) og `Game1DrawEngineService` (`scheduled_game.status:
 * "scheduled" | "running" | "completed" | "cancelled"`).
 *
 * For DrawingService trenger vi bare et minimalt sett:
 *   - `RUNNING`: spill er aktivt, draws er tillatt
 *   - `ANY ANNET`: draws er IKKE tillatt
 *
 * Caller mapper sin egen interne status til en av disse to ved å sette
 * `state.status: "RUNNING"` eller `"NOT_RUNNING"`. Vi bruker eksplisitte
 * literals i stedet for boolean for at audit-traces skal være selv-
 * dokumenterende ("game was in WAITING state, draw rejected").
 */
export type DrawingGameStatus = "RUNNING" | "NOT_RUNNING";

/**
 * Minimal state-snapshot som `drawNext()` trenger for å fatte beslutningen.
 *
 * **Ikke et database-snapshot** — caller projiserer sin DB-state ned til
 * dette feltsettet. Caller er ansvarlig for å laste state under en
 * `SELECT ... FOR UPDATE` hvis konkurrente draws kan skje.
 *
 * `drawBag` skal være den fulle, pre-shuffled sekvensen (genere via
 * `buildDrawBag()` ved game-start). `drawsCompleted` er antall ball som
 * allerede er trukket — neste ball er `drawBag[drawsCompleted]`.
 *
 * `maxDraws` setter en cap på antall draws (typisk 75 for 1..75-bag, 60
 * for 1..60-bag, eller en operatør-overstyring per scheduled_game).
 *
 * `ballRange` brukes kun for invariant-validering (Property 4 i invariant-
 * tester) — ingen forretningslogikk avhenger av denne.
 */
export interface DrawingGameState {
  /**
   * Stable game-identifier for feilmeldinger og audit. Brukes ikke i
   * forretningslogikk — kun for diagnostikk.
   */
  gameId: string;

  /** Lifecycle-status. Draws kun tillatt når `RUNNING`. */
  status: DrawingGameStatus;

  /**
   * Pre-shuffled bag av ball-verdier. Lengden bestemmer hvor mange unike
   * baller som kan trekkes; rekkefølgen bestemmer trekk-sekvensen. ALLE
   * verdier MÅ være i `[1, ballRange]`-intervallet og MÅ være unike.
   *
   * Caller produserer typisk denne via `buildDrawBag(resolveDrawBagConfig(...))`
   * fra `apps/backend/src/game/DrawBagStrategy.ts`.
   */
  drawBag: readonly number[];

  /**
   * Hvor mange baller som allerede er trukket. Neste trekk vil være
   * `drawBag[drawsCompleted]`. Etter draw skal caller incrementere denne
   * til `drawsCompleted + 1` i sin egen state.
   *
   * MUST være `0 ≤ drawsCompleted ≤ drawBag.length`.
   */
  drawsCompleted: number;

  /**
   * Maksimum antall draws tillatt for runden (operatør-overstyring per
   * scheduled_game eller default fra DrawBagStrategy). Når draws når
   * denne grensen er runden over.
   *
   * MUST være `1 ≤ maxDraws ≤ drawBag.length`.
   */
  maxDraws: number;

  /**
   * Inklusive øvre grense for ball-verdier (typisk 60 eller 75). Brukes
   * kun for invariant-validering — `drawBag` er sannhets-kilden for hvilken
   * ball som faktisk trekkes.
   */
  ballRange: number;
}

/**
 * Resultat av `drawNext()`. Pure data — caller er ansvarlig for å
 * persistere endringen og broadcaste til klienter.
 */
export interface DrawingResult {
  /**
   * Ball-verdien som ble trukket (typisk 1..75 eller 1..60). Garantert å
   * være innenfor `[1, ballRange]` og unik for runden (sjekket i invariant-
   * test).
   */
  nextBall: number;

  /**
   * Sekvens-nummer for dette draw-et (1-indexed). Første draw → 1, andre
   * draw → 2, osv. Matches `drawsCompleted + 1` etter at `drawNext()`
   * returnerte.
   *
   * Caller bør bruke denne verdien som `draw_sequence` i sin INSERT-rad
   * (matcher `Game1DrawEngineService.drawNext` linje 1087).
   */
  drawSequenceNumber: number;

  /**
   * `true` hvis dette draw-et nådde `maxDraws`. Caller bruker dette til å
   * markere runden som ferdig (UPDATE scheduled_game.status='completed' eller
   * BingoEngine sin `game.status = "ENDED"`).
   *
   * Bemerk: et draw KAN være siste draw selv om en BINGO-vinner finnes
   * tidligere i denne fasen — det er caller's ansvar å koordinere med
   * PatternEvalService (Fase 3) for "hvem vant".
   */
  isLastDraw: boolean;
}

/**
 * Strukturert feilkode for invariant-brudd.
 *
 * Ett enum (string-literal type) per kjent feil-type. Caller mapper disse
 * til HTTP-status / socket-error-payload — vi holder service-en agnostisk
 * mot transport-laget.
 */
export type DrawingErrorCode =
  | "GAME_NOT_RUNNING"
  | "DRAW_BAG_EXHAUSTED"
  | "MAX_DRAWS_REACHED"
  | "INVALID_STATE";

/**
 * Strukturert domain-feil. Speilkopierer mønsteret fra `DomainError` i
 * `apps/backend/src/game/BingoEngine.ts:184` men er DrawingService-lokal
 * for at service-en skal være self-contained og uavhengig av BingoEngine.
 *
 * Caller forventes å fange denne og enten:
 *   - mappe til HTTP 400/409 + `{ code, message }`-payload, eller
 *   - rolle tilbake en åpen DB-tx hvis service-en ble kalt midt i en
 *     transaksjons-flyt.
 */
export class DrawingError extends Error {
  public readonly code: DrawingErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: DrawingErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DrawingError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * Pure draw-service. Ingen state, ingen porter, ingen IO. Hver instans er
 * trygg å dele mellom requests/threads.
 *
 * Bruk:
 * ```ts
 * const service = new DrawingService();
 * const state: DrawingGameState = {
 *   gameId: "game-1",
 *   status: "RUNNING",
 *   drawBag: [42, 17, 3, 88, ...],
 *   drawsCompleted: 5,
 *   maxDraws: 75,
 *   ballRange: 75,
 * };
 * const result = service.drawNext(state);
 * // → { nextBall: 42, drawSequenceNumber: 6, isLastDraw: false }
 * ```
 *
 * **Fase 4 wire-up:**
 * `Game1DrawEngineService.drawNext` vil i Fase 4 erstatte sin inline
 * draw-logikk (linjene 1078-1086) med:
 * ```ts
 * const drawingState: DrawingGameState = {
 *   gameId: scheduledGameId,
 *   status: game.status === "running" ? "RUNNING" : "NOT_RUNNING",
 *   drawBag: parseDrawBag(state.draw_bag_json),
 *   drawsCompleted: state.draws_completed,
 *   maxDraws: this.resolveMaxDraws(game.ticket_config_json),
 *   ballRange: 75, // eller resolvDrawBagConfig().maxBallValue
 * };
 * const drawing = drawingService.drawNext(drawingState);
 * // INSERT draws-rad med drawing.nextBall + drawing.drawSequenceNumber
 * // ... osv.
 * ```
 */
export class DrawingService {
  /**
   * Trekk neste ball gitt nåværende state. Pure — muterer ingenting,
   * leser ingenting fra IO.
   *
   * Throws `DrawingError` ved invariant-brudd (state ugyldig, spill ikke
   * RUNNING, bag tom, maxDraws nådd).
   */
  drawNext(state: DrawingGameState): DrawingResult {
    validateState(state);

    if (state.status !== "RUNNING") {
      throw new DrawingError(
        "GAME_NOT_RUNNING",
        `Kan ikke trekke kule når status er '${state.status}'.`,
        { gameId: state.gameId, status: state.status },
      );
    }

    if (state.drawsCompleted >= state.maxDraws) {
      throw new DrawingError(
        "MAX_DRAWS_REACHED",
        `Maks antall trekk (${state.maxDraws}) er nådd.`,
        {
          gameId: state.gameId,
          drawsCompleted: state.drawsCompleted,
          maxDraws: state.maxDraws,
        },
      );
    }

    if (state.drawsCompleted >= state.drawBag.length) {
      throw new DrawingError(
        "DRAW_BAG_EXHAUSTED",
        `Alle kuler i draw-bag er trukket (lengde ${state.drawBag.length}).`,
        {
          gameId: state.gameId,
          drawsCompleted: state.drawsCompleted,
          drawBagLength: state.drawBag.length,
        },
      );
    }

    const nextBall = state.drawBag[state.drawsCompleted]!;
    const drawSequenceNumber = state.drawsCompleted + 1;
    const isLastDraw = drawSequenceNumber >= state.maxDraws;

    return {
      nextBall,
      drawSequenceNumber,
      isLastDraw,
    };
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Verifiser strukturell integritet av input-state. Kaster `INVALID_STATE`
 * ved noe rart, ellers er state OK for `drawNext`-business-logic.
 *
 * Note: vi sjekker IKKE at `drawBag` har unike verdier her — det er en
 * invariant for buildDrawBag, ikke for DrawingService. Property-test
 * (uniqueBallsInvariant) verifiserer det indirekte ved å iterere drawNext
 * gjennom hele bag og sjekke at output-sekvensen er unik.
 */
function validateState(state: DrawingGameState): void {
  if (!state.gameId?.trim()) {
    throw new DrawingError("INVALID_STATE", "gameId er påkrevd.");
  }
  if (state.status !== "RUNNING" && state.status !== "NOT_RUNNING") {
    throw new DrawingError(
      "INVALID_STATE",
      `status må være 'RUNNING' eller 'NOT_RUNNING', fikk '${state.status}'.`,
      { gameId: state.gameId, status: state.status },
    );
  }
  if (!Array.isArray(state.drawBag)) {
    throw new DrawingError(
      "INVALID_STATE",
      "drawBag må være et array.",
      { gameId: state.gameId },
    );
  }
  if (
    !Number.isInteger(state.drawsCompleted) ||
    state.drawsCompleted < 0
  ) {
    throw new DrawingError(
      "INVALID_STATE",
      `drawsCompleted må være ikke-negativt heltall, fikk ${state.drawsCompleted}.`,
      { gameId: state.gameId, drawsCompleted: state.drawsCompleted },
    );
  }
  if (state.drawsCompleted > state.drawBag.length) {
    throw new DrawingError(
      "INVALID_STATE",
      `drawsCompleted (${state.drawsCompleted}) > drawBag.length (${state.drawBag.length}).`,
      {
        gameId: state.gameId,
        drawsCompleted: state.drawsCompleted,
        drawBagLength: state.drawBag.length,
      },
    );
  }
  if (!Number.isInteger(state.maxDraws) || state.maxDraws < 1) {
    throw new DrawingError(
      "INVALID_STATE",
      `maxDraws må være positivt heltall, fikk ${state.maxDraws}.`,
      { gameId: state.gameId, maxDraws: state.maxDraws },
    );
  }
  if (state.maxDraws > state.drawBag.length) {
    throw new DrawingError(
      "INVALID_STATE",
      `maxDraws (${state.maxDraws}) > drawBag.length (${state.drawBag.length}). Caller må reduseres maxDraws ved game-start.`,
      {
        gameId: state.gameId,
        maxDraws: state.maxDraws,
        drawBagLength: state.drawBag.length,
      },
    );
  }
  if (!Number.isInteger(state.ballRange) || state.ballRange < 1) {
    throw new DrawingError(
      "INVALID_STATE",
      `ballRange må være positivt heltall, fikk ${state.ballRange}.`,
      { gameId: state.gameId, ballRange: state.ballRange },
    );
  }
}

// ── Re-exports for caller convenience ────────────────────────────────────────

/**
 * Re-eksport av `ResolvedDrawBagConfig` slik at caller-kode som konstruerer
 * `DrawingGameState` kan importere alt fra ett sted. Caller-mønster:
 *
 * ```ts
 * import {
 *   DrawingService,
 *   type DrawingGameState,
 *   type ResolvedDrawBagConfig,
 * } from "../services/DrawingService.js";
 * ```
 */
export type { ResolvedDrawBagConfig };
