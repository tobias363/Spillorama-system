/**
 * Unified pipeline refactor — Fase 3.
 *
 * Sentral pure-service for "etter en draw, evaluér hvilke patterns som er
 * klare til å auto-claim". Erstatter den ad-hoc fase-eval-logikken som
 * lever i `BingoEnginePatternEval.evaluateActivePhase` /
 * `evaluateConcurrentPatterns` (apps/backend/src/game/BingoEnginePatternEval.ts:169+)
 * og er duplisert via SQL i `Game1DrawEngineService.evaluatePhase`
 * (apps/backend/src/game/Game1DrawEngineService.ts:1200+).
 *
 * **Scope:**
 *
 *   1. Validate: spill må være `RUNNING`. Ellers returneres tom resultat.
 *   2. Decide: gitt drawn-set + tickets + marks + phase-config, hvilke
 *      vinner-sets eksisterer for ikke-vunne patterns?
 *   3. Recursive phase progression (sequential mode): hvis fase N akkurat
 *      ble vunnet av nåværende draw-state, og fase N+1 også er allerede
 *      claimable i nøyaktig samme draw-state, fortsett rekursivt til
 *      første ikke-claimable fase.
 *   4. Return: liste av `newClaims` (én rad per (player, pattern) som vinner),
 *      liste av `phasesAdvanced` (oppsummerer vinner-grupper per fase),
 *      `allCardsClosed`-flagg (true når BINGO/Fullt Hus / siste pattern
 *      er vunnet).
 *
 * **Out of scope (handled av andre faser eller caller):**
 *
 *   - Selve trekningen av neste ball → Fase 2 (DrawingService).
 *   - Prize-beregning (percent / fixed / multiplier-chain / column-specific
 *     / ball-value-multiplier) → caller's eksisterende prize-resolver.
 *     PatternEvalService bestemmer KUN hvem som vinner, ikke hvor mye.
 *   - Wallet-payout etter pattern-win → Fase 1 (PayoutService).
 *   - Compliance ledger writes → caller's ansvar.
 *   - Audit log writes → caller's ansvar.
 *   - Socket broadcasts → caller's ansvar.
 *   - Auto-pause-after-phase-won (Tobias-direktiv 2026-04-27) → caller's
 *     ansvar (Spill 1-spesifikk side-effekt; PatternEvalService rapporterer
 *     at fasen ble vunnet, caller bestemmer hva som skjer videre).
 *   - End-of-round når Fullt Hus vinnes → caller setter `game.status = "ENDED"`.
 *   - Demo Hall test-mode bypass → caller leser `allCardsClosed` og bestemmer
 *     selv om runden skal avsluttes.
 *
 * **To evaluerings-modus** (matcher prod-koden):
 *
 *   - `sequential` (BIN-694, Spill 1 standard): patterns er ordnet i `order`,
 *     bare den første ikke-vunne fasen evalueres per kall. Hvis den vinnes
 *     OG nestefasen også er allerede claimable i nøyaktig samme draw-state,
 *     advance rekursivt. (Dette er sjelden — typisk samme ball som fullfører
 *     2 rader samtidig.)
 *
 *   - `concurrent` (PR-P5 Extra-variant): ALLE ikke-vunne patterns evalueres
 *     parallelt. Én ticket kan oppfylle flere patterns og få "vinner"-status
 *     på alle. Ingen rekursjon — alle blir prosessert i ett kall.
 *
 * **Determinisme:**
 *
 *   For en gitt input-state gir tjenesten ALLTID samme output:
 *   - Vinner-IDer sorteres lex-orden (matchende
 *     `BingoEnginePatternEval.sortWinnerIdsDeterministic`).
 *   - Per-color-grupper sorteres lex på color-key (matchende prod-flowen
 *     som ble lagt til som K1-fix per casino-research §6 "KRITISK 4").
 *   - Pattern-rekkefølge: bevart fra `state.patterns` (caller's
 *     ansvars-rekkefølge — typisk `order ASC`).
 *
 * **Ingen porter trengs i Fase 3:**
 *
 *   Fordi tjenesten er pure (ingen IO, ingen klokke, ingen DB), trenger den
 *   verken `WalletPort`, `CompliancePort`, `AuditPort`, `ClockPort` eller
 *   en ny `RngPort`. Den opererer kun på data som passes inn.
 *
 *   Caller (Game1DrawEngineService / BingoEngine) vil i Fase 4 (GameOrchestrator)
 *   hente sin DB-state, konstruere en `PatternEvalState`, kalle
 *   `patternEvalService.evaluateAfterDraw(state)`, og applye resultatet til
 *   PayoutService + DB. Ingen adapter-bridges nødvendig.
 *
 * **Atomicity:**
 *
 *   Service-en endrer ingen ekstern state — caller er ansvarlig for å
 *   wrappe sin DB-mutation (UPDATE patternResults, INSERT phase_winners,
 *   wallet credits via PayoutService) i en transaksjon. PatternEvalService
 *   kaster ingen feil for state-baserte beslutninger; bare for strukturelt
 *   ugyldig input via `PatternEvalError`.
 *
 * **Idempotency:**
 *
 *   Pure-funksjons-natur gjør at `evaluateAfterDraw(state)` med samme input
 *   alltid gir samme output. Caller's idempotency er sikret ved at de
 *   markerer `patternResults[i].isWon = true` etter å ha applyert vinnerne;
 *   gjentatte kall med oppdatert state skipper allerede-vunne patterns.
 *
 * **Hvordan recursive phase progression virker:**
 *
 *   Sequential mode itererer gjennom patterns i rekkefølge. Hvis fase N
 *   identifiseres med vinnere, registreres det som en `PhaseAdvance`. Så
 *   simulerer service-en at fase N er "vunnet" (ved å skippe den ved neste
 *   iterasjon) og evaluerer fase N+1 i samme draw-state. Dette gjentas til
 *   en fase ikke har vinnere ELLER vi har gått igjennom alle patterns.
 *   `allCardsClosed = true` returneres hvis siste BINGO-pattern ble vunnet
 *   (eller siste pattern overall hvis ingen BINGO finnes).
 */

import {
  classifyPhaseFromPatternName,
  ticketMaskMeetsPhase,
} from "@spillorama/shared-types/spill1-patterns";
import {
  buildTicketMask as patternMatcherBuildTicketMask,
  matchesPattern as patternMatcherMatches,
} from "../game/PatternMatcher.js";
import {
  buildTicketMask5x5,
  countCompleteColumns,
  countCompleteRows,
  hasFullBingo,
} from "../game/ticket.js";
import type {
  ClaimType,
  PatternDefinition,
  PatternResult,
  Ticket,
} from "../game/types.js";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Lifecycle-status for et bingospill — minimalt sett (matcher
 * `DrawingGameStatus` i Fase 2 DrawingService for konsistens).
 *
 * Caller mapper sin egen interne status (e.g. `RoomState.currentGame.status`)
 * til en av disse. For PatternEvalService trenger vi bare:
 *   - `RUNNING`: aktiv evaluering
 *   - `NOT_RUNNING`: returner tom resultat (ingen vinnere mulig)
 */
export type PatternEvalGameStatus = "RUNNING" | "NOT_RUNNING";

/**
 * Evaluerings-modus for service-en.
 *
 * - `sequential`: standard Spill 1-flyt (`evaluateActivePhase`). Patterns
 *   evalueres i `order`-rekkefølge; bare neste ikke-vunne fase evalueres
 *   per kall, med rekursjon hvis samme draw oppfyller flere faser.
 *
 * - `concurrent`: TV Extra / custom-pattern-flyt (`evaluateConcurrentPatterns`).
 *   Alle ikke-vunne patterns evalueres parallelt. Én vinner kan vinne flere
 *   patterns på samme draw og få oppført alle som claims.
 */
export type PatternEvalMode = "sequential" | "concurrent";

/**
 * Sentinel-key for flat-path (ingen per-color-matrise) i `winnerGroups`.
 * Re-export av `BingoEnginePatternEval.FLAT_GROUP_KEY` for kompatibilitet
 * med evt. caller-kode som matcher på denne nøkkelen.
 */
export const FLAT_GROUP_KEY = "__flat__";

/**
 * Sentinel-key for brett uten `ticket.color` satt — bruker `__default__`-
 * matrisen i per-color path. Re-export av
 * `BingoEnginePatternEval.UNCOLORED_KEY`.
 */
export const UNCOLORED_KEY = "__uncolored__";

/**
 * Lett-vekt per-farge-matrise. PatternEvalService er pure og laster ikke
 * `GameVariantConfig` direkte — caller projiserer sin matrise ned til denne
 * shape-en. Hvis udefinert kjører service-en flat-path.
 *
 * Mapping: `colorKey → resolved-pattern-array sortert i samme order som
 * top-level `state.patterns`. Lengden MÅ matche `state.patterns.length`.
 *
 * Caller kan bygge denne fra `variantConfig.patternsByColor` via
 * `resolvePatternsForColor()` — service-en mottar bare det ferdige
 * lookup-resultatet.
 */
export interface PerColorMatrix {
  /**
   * Map color-key → resolved patterns sortert i samme rekkefølge som
   * `state.patterns`. `__default__` er fallback for ukjente farger.
   *
   * For hver entry: `patterns[phaseIndex]` er fargens versjon av top-level
   * `state.patterns[phaseIndex]`. Patterns trenger IKKE være identiske —
   * de kan ha ulike prize-config (per-farge prize-matrise). PatternEvalService
   * bryr seg ikke om prize-feltene; bare om `name`, `claimType` og
   * pattern-identitet.
   */
  readonly patternsByColor: ReadonlyMap<string, readonly PatternDefinition[]>;
}

/**
 * Minimal state-snapshot som `evaluateAfterDraw()` trenger.
 *
 * **Ikke et database-snapshot** — caller projiserer sin DB- eller in-memory-
 * state ned til dette feltsettet. Caller er ansvarlig for å laste state
 * konsistent (e.g. under en `SELECT ... FOR UPDATE` hvis konkurrente draws
 * kan skje).
 */
export interface PatternEvalState {
  /**
   * Stable game-identifier for feilmeldinger og audit. Brukes ikke i
   * forretningslogikk — kun for diagnostikk.
   */
  gameId: string;

  /** Lifecycle-status. Eval kun aktiv når `RUNNING`. */
  status: PatternEvalGameStatus;

  /** Evalueringsmodus — `sequential` for Spill 1, `concurrent` for TV Extra. */
  mode: PatternEvalMode;

  /**
   * Numre som hittil er trukket i denne runden. Brukes til å bygge
   * "drawnSet" som er sannhets-kilden for hvilke celler som er merket
   * (per BIN-694: server-side eval bruker drawnNumbers, IKKE klient-marks).
   */
  drawnNumbers: readonly number[];

  /**
   * Map: playerId → tickets[]. Hvert ticket har et 3×5 eller 5×5 grid.
   * Tom map → ingen vinnere mulig (returneres tom resultat).
   */
  tickets: ReadonlyMap<string, readonly Ticket[]>;

  /**
   * Map: playerId → ticketIdx → marks-set. Brukes KUN av concurrent-mode
   * (PR-P5 — for klient-merket evaluering). Sequential-mode bruker
   * `drawnNumbers` direkte og ignorerer denne. Mangler en entry → bruker
   * `drawnSet` som fallback (matcher prod-flowen).
   *
   * Optional fordi sequential-mode ikke trenger den; concurrent kan også
   * fall back til drawnSet hvis marks ikke er populated.
   */
  marks?: ReadonlyMap<string, readonly ReadonlySet<number>[]>;

  /**
   * Patterns sortert i ønsket rekkefølge (typisk `order ASC`).
   * - `sequential` mode: første ikke-vunne pattern evalueres først.
   * - `concurrent` mode: alle ikke-vunne patterns evalueres parallelt
   *   i samme rekkefølge (for stabil event-rekkefølge).
   *
   * Tom array → returner tom resultat.
   */
  patterns: readonly PatternDefinition[];

  /**
   * Pattern-result-state per pattern. `isWon` = true → pattern hoppes over.
   * Lengden bør matche `patterns.length` og være indeksert per
   * `patterns[i].id` (caller bygger denne fra DB / in-memory snapshot).
   *
   * Service-en muterer IKKE denne — den leses kun for å hoppe over
   * allerede-vunne patterns. Caller oppdaterer sin egen state etter å ha
   * applyert vinnerne.
   */
  patternResults: readonly PatternResult[];

  /**
   * Optional per-color-matrise (PR B / Spill 1-variant). Hvis undefined
   * → flat-path. Hvis satt → per-color-path der hver (color, player)-kombo
   * er en unik vinner-slot.
   *
   * Service-en gjør ingen prize-beregning — den rapporterer bare hvem
   * som vinner per color-gruppe. Caller bruker `winnerGroups[colorKey]`
   * for å vite hvilken pattern-config (med prize-felt) som gjelder.
   */
  perColorMatrix?: PerColorMatrix;
}

/**
 * Én individuell claim-rad: spilleren X har vunnet pattern Y i color-gruppe Z.
 *
 * For sequential-mode er det typisk én PhaseAdvance per kall, men hvis
 * recursive phase progression slår inn kan det bli flere. For concurrent-
 * mode er det én PhaseAdvance per ikke-vunnet pattern som har vinnere.
 */
export interface NewClaim {
  /** Vinnerens spiller-id. */
  playerId: string;
  /** patternId fra `state.patterns[i].id` — caller mapper til DB-rad. */
  patternId: string;
  /** Pattern-navn for audit / broadcast. */
  patternName: string;
  /** LINE eller BINGO. */
  claimType: ClaimType;
  /**
   * Color-gruppe-key — `FLAT_GROUP_KEY` for flat-path, eller color-navn
   * (e.g. "Yellow") for per-color path. Brukes av caller til å gruppere
   * claims når flere vinnere finnes i samme draw.
   */
  colorGroupKey: string;
  /**
   * Resolved pattern-definition for vinnerens color-gruppe. For flat-path
   * er dette samme som top-level pattern; for per-color kan det være en
   * variant med ulik prize-config.
   *
   * Caller bruker dette objektet til å resolve prize via egen prize-resolver
   * (PatternEvalService gjør INGEN prize-beregning).
   */
  resolvedPattern: PatternDefinition;
}

/**
 * Oppsummering av én pattern-fase som ble vunnet i denne evalueringen.
 *
 * Inneholder alle vinnerne (deduplikert) + per-color gruppering. Service-en
 * fyller dette så caller kan:
 *   - Sende én `pattern:won`-event per phase advance (broadcasts).
 *   - Oppdatere `patternResults[i].isWon = true`, `winnerIds = [...]`.
 *   - Gi til PayoutService for prize-utbetaling.
 */
export interface PhaseAdvance {
  patternId: string;
  patternName: string;
  claimType: ClaimType;
  /**
   * Index i `state.patterns` array (= phaseIndex i prod-flowen). Brukes for
   * å mappe per-color-matrisen riktig.
   */
  patternIndex: number;
  /**
   * Alle unike vinnere på tvers av color-grupper. Sortert lex-orden på
   * playerId (deterministisk). Brukes som primær vinner-liste til broadcasts.
   *
   * Multi-color-vinnere: en spiller med brett i 2 farger som begge vinner
   * vises kun ÉN gang her, men ÉN gang per color i `winnerGroups`. Dette
   * matcher prod-semantikken i `evaluateActivePhase` linje 482-485.
   */
  winnerIds: readonly string[];
  /**
   * Per-color vinner-grupper. Map: colorKey → group-detaljer.
   *
   * For flat-path: én entry under `FLAT_GROUP_KEY`. For per-color: én entry
   * per color som har minst én vinner. Color-keys er sortert lex-orden i
   * iterasjons-rekkefølge (Map preserverer insertion-order; service-en
   * inserter i sortert orden).
   */
  winnerGroups: ReadonlyMap<
    string,
    {
      readonly winnerIds: readonly string[];
      readonly resolvedPattern: PatternDefinition;
    }
  >;
}

/**
 * Resultat av `evaluateAfterDraw()`. Pure data — caller er ansvarlig for å
 * persistere endringer (markere `patternResults[i].isWon`, oppdatere
 * `winnerIds`-listen osv.) og side-effekter (payout, broadcasts, audit).
 */
export interface PatternEvalResult {
  /**
   * Alle individuelle claims i denne evalueringen. Én rad per
   * (playerId, patternId, colorGroupKey)-trippel.
   *
   * Sortert: pattern-rekkefølge (matchende `state.patterns`) først, så
   * color-key lex-orden, så playerId lex-orden.
   */
  newClaims: readonly NewClaim[];

  /**
   * Faser som har avansert (vunnet) i denne evalueringen. Lengden:
   *   - sequential mode uten recursion: 0 eller 1
   *   - sequential mode med recursion: 1..N hvis flere faser vunnet samme draw
   *   - concurrent mode: 0..M hvor M = antall ikke-vunne patterns med vinnere
   */
  phasesAdvanced: readonly PhaseAdvance[];

  /**
   * `true` hvis spillet skal regnes som ferdig:
   *
   *   - sequential mode: BINGO/Fullt-Hus-pattern (claimType=`BINGO`) ble
   *     vunnet i denne evalueringen.
   *   - concurrent mode: ALLE patterns har `isWon=true` etter denne
   *     evalueringen.
   *
   * Caller bruker dette flagget til å sette `game.status = "ENDED"`,
   * skrive checkpoint, etc. Service-en muterer ingenting selv.
   *
   * NB: false hvis ingen progresjon skjedde (e.g. ingen vinnere ennå)
   * uavhengig av om allerede-vunne patterns inkluderer BINGO. Hvis caller
   * trenger å vite "er BINGO allerede vunnet i state.patternResults",
   * må de sjekke det selv.
   */
  allCardsClosed: boolean;
}

/**
 * Strukturert feilkode for invariant-brudd. Speilkopierer mønsteret fra
 * `DrawingError` i Fase 2.
 */
export type PatternEvalErrorCode =
  | "INVALID_STATE"
  | "PATTERN_RESULTS_MISMATCH";

export class PatternEvalError extends Error {
  public readonly code: PatternEvalErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: PatternEvalErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PatternEvalError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Deterministisk lex-sort av playerIds. Eksportert separat så
 * `patternEvalInvariant.test.ts` kan importere pure-funksjonen og bekrefte
 * sorterings-property direkte.
 *
 * Speilkopi av `BingoEnginePatternEval.sortWinnerIdsDeterministic` per K1-fix
 * (casino-research §6 "KRITISK 4"): vinner-rekkefølge må være stabil på
 * tvers av Map/Set-insertion-order og crash-recovery rebuild.
 */
export function sortWinnerIdsDeterministic(playerIds: Iterable<string>): string[] {
  return [...playerIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Deterministisk lex-sort av color-keys. Brukes til å iterere over
 * `byColor`-grupper i konsistent rekkefølge. `FLAT_GROUP_KEY` sorteres
 * leksikografisk som vanlig string (i praksis: alene fordi flat-path har
 * kun én entry).
 */
function sortColorKeysDeterministic(keys: Iterable<string>): string[] {
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * Pure pattern-eval-service. Ingen state, ingen porter, ingen IO. Hver
 * instans er trygg å dele mellom requests/threads.
 *
 * Bruk:
 * ```ts
 * const service = new PatternEvalService();
 * const state: PatternEvalState = {
 *   gameId: "game-1",
 *   status: "RUNNING",
 *   mode: "sequential",
 *   drawnNumbers: [1, 7, 12, 23, 34, 45],
 *   tickets: ticketsMap,
 *   patterns: [phase1Pattern, phase2Pattern, fullHousePattern],
 *   patternResults: currentResults,
 * };
 * const result = service.evaluateAfterDraw(state);
 * for (const advance of result.phasesAdvanced) {
 *   // payout via PayoutService.payoutPhase(...)
 *   // broadcast pattern:won
 *   // mark patternResults[i].isWon = true
 * }
 * if (result.allCardsClosed) {
 *   // game.status = "ENDED"
 * }
 * ```
 *
 * **Fase 4 wire-up:**
 * `Game1DrawEngineService.evaluatePhase` vil i Fase 4 erstatte sin SQL-
 * baserte fase-eval-logikk (linjene 1200-1500) med en
 * `PatternEvalService.evaluateAfterDraw(...)`-call etterfulgt av
 * PayoutService-call. Adapter-mapping: SQL-rad-resultater → in-memory
 * `tickets` og `patternResults` projeksjoner.
 *
 * `BingoEngine.drawNextNumber` vil tilsvarende erstatte sitt
 * `evaluateActivePhase(callbacks, room, game)`-kall.
 */
export class PatternEvalService {
  /**
   * Evaluér state etter en draw. Returner alle nye claims + phase advances
   * + closed-flagg.
   *
   * Pure — muterer ingenting, leser ingenting fra IO. Throws
   * `PatternEvalError` ved invariant-brudd (state strukturelt ugyldig).
   */
  evaluateAfterDraw(state: PatternEvalState): PatternEvalResult {
    validateState(state);

    // Tom-resultat-stier (status, ingen patterns, ingen tickets, eller
    // alle patterns allerede vunnet) — ingen claims, ingen advance.
    if (state.status !== "RUNNING") {
      return EMPTY_RESULT;
    }
    if (state.patterns.length === 0) {
      return EMPTY_RESULT;
    }
    if (state.tickets.size === 0) {
      return EMPTY_RESULT;
    }
    if (state.patternResults.every((r) => r.isWon)) {
      // Alle vunnet allerede → spillet er ferdig (caller bør allerede ha
      // satt allCardsClosed sist, men returner true her for konsistens).
      return { ...EMPTY_RESULT, allCardsClosed: true };
    }

    if (state.mode === "concurrent") {
      return this.evaluateConcurrent(state);
    }
    return this.evaluateSequentialWithRecursion(state);
  }

  // ── Sequential mode (Spill 1 standard) ────────────────────────────────────

  /**
   * Sequential mode med recursive phase progression.
   *
   * Algoritme:
   *   1. Bygg `wonPatternIds` set fra `state.patternResults`.
   *   2. Iterer pattern-array i rekkefølge.
   *   3. For hver ikke-vunne pattern: evaluér vinnere mot drawnSet.
   *      - Ingen vinnere → returner (ingen videre advance i samme draw).
   *      - Vinnere → registrer PhaseAdvance + NewClaims, legg patternId i
   *        `wonPatternIds`, fortsett til neste pattern.
   *   4. Stop når en pattern uten vinnere treffes ELLER vi har gått igjennom
   *      alle patterns.
   *
   * Recursion-detection: hvis fase N akkurat ble vunnet OG fase N+1 også
   * er allerede oppfylt i nøyaktig samme draw-state (samme `drawnSet`),
   * advance til fase N+1 i samme kall. Dette håndterer det sjeldne
   * scenariet der én ball fullfører flere faser samtidig (e.g. samme ball
   * gir både rad 1 og rad 2 på samme brett).
   */
  private evaluateSequentialWithRecursion(state: PatternEvalState): PatternEvalResult {
    const drawnSet = new Set(state.drawnNumbers);
    const phasesAdvanced: PhaseAdvance[] = [];
    const newClaims: NewClaim[] = [];

    // Lokal kopi av won-state — vi muterer denne for å simulere recursion
    // uten å mutere caller's input.
    const localWonIds = new Set<string>(
      state.patternResults.filter((r) => r.isWon).map((r) => r.patternId),
    );

    let fullHouseWon = false;

    for (let phaseIndex = 0; phaseIndex < state.patterns.length; phaseIndex++) {
      const pattern = state.patterns[phaseIndex]!;
      if (localWonIds.has(pattern.id)) {
        // Allerede vunnet (eller markert som vunnet i denne iterasjonen) →
        // hopp over.
        continue;
      }

      const phaseResult = this.detectPhaseWinners(state, drawnSet, pattern, phaseIndex);

      if (phaseResult.totalUniqueWinners === 0) {
        // Ingen vinnere på denne fasen → ingen videre advance mulig (fase
        // N+1 forutsetter at fase N er vunnet).
        break;
      }

      // Bygg PhaseAdvance + NewClaims for denne fasen.
      const advance = this.buildPhaseAdvance(pattern, phaseIndex, phaseResult);
      phasesAdvanced.push(advance);
      for (const claim of this.buildClaimsFromPhase(advance)) {
        newClaims.push(claim);
      }

      // Marker som vunnet i lokal state så neste iterasjon kan rekursivt
      // evaluere fase N+1.
      localWonIds.add(pattern.id);

      // Spor BINGO-vinning for `allCardsClosed`-flag.
      if (pattern.claimType === "BINGO") {
        fullHouseWon = true;
        // BINGO-pattern avslutter spillet — ingen flere faser å evaluere.
        break;
      }
    }

    return {
      newClaims,
      phasesAdvanced,
      allCardsClosed: fullHouseWon,
    };
  }

  // ── Concurrent mode (TV Extra / custom patterns) ─────────────────────────

  /**
   * Concurrent mode: alle ikke-vunne patterns evalueres parallelt.
   *
   * Algoritme:
   *   1. Bygg `drawnSet` fra `state.drawnNumbers`.
   *   2. For hver ikke-vunne pattern (i config-rekkefølge):
   *      - Finn vinnere (uniqueset per player).
   *      - Hvis vinnere finnes → registrer PhaseAdvance + NewClaims.
   *   3. `allCardsClosed = true` hvis ALLE patterns er vunnet etter denne
   *      evalueringen (dvs. vunnet før + vunnet nå = alle).
   *
   * Concurrent har ingen recursion — alle patterns prosesseres i én iterasjon.
   * Concurrent støtter ikke per-color-matrise (mutually exclusive per
   * `Spill1Config`-validator).
   */
  private evaluateConcurrent(state: PatternEvalState): PatternEvalResult {
    const drawnSet = new Set(state.drawnNumbers);
    const phasesAdvanced: PhaseAdvance[] = [];
    const newClaims: NewClaim[] = [];

    // Lokal won-state for å beregne `allCardsClosed`.
    const localWonIds = new Set<string>(
      state.patternResults.filter((r) => r.isWon).map((r) => r.patternId),
    );

    for (let i = 0; i < state.patterns.length; i++) {
      const pattern = state.patterns[i]!;
      if (localWonIds.has(pattern.id)) continue;
      // Concurrent krever at pattern.mask er definert (custom pattern).
      // Hvis mask mangler hopper vi over — caller har laget feil shape.
      if (typeof pattern.mask !== "number") continue;

      const winners = this.detectConcurrentWinners(state, drawnSet, pattern);
      if (winners.length === 0) continue;

      // Bygg flat-path PhaseAdvance (concurrent støtter ikke per-color).
      const groupMap = new Map<
        string,
        { readonly winnerIds: readonly string[]; readonly resolvedPattern: PatternDefinition }
      >();
      groupMap.set(FLAT_GROUP_KEY, {
        winnerIds: winners,
        resolvedPattern: pattern,
      });
      const advance: PhaseAdvance = {
        patternId: pattern.id,
        patternName: pattern.name,
        claimType: pattern.claimType,
        patternIndex: i,
        winnerIds: winners,
        winnerGroups: groupMap,
      };
      phasesAdvanced.push(advance);
      for (const claim of this.buildClaimsFromPhase(advance)) {
        newClaims.push(claim);
      }
      localWonIds.add(pattern.id);
    }

    const allCardsClosed = state.patterns.every((p) => localWonIds.has(p.id));
    return { newClaims, phasesAdvanced, allCardsClosed };
  }

  /**
   * Concurrent mode pattern-matcher: for hver ticket sjekk om dens 25-bit
   * mask matcher pattern.mask. Bruker per-ticket marks-set hvis tilgjengelig
   * (klient-merket evaluering — matcher PR-P5 Extra-variant), ellers
   * drawnSet.
   *
   * Returner sortert array av unique playerId-er (deterministisk).
   */
  private detectConcurrentWinners(
    state: PatternEvalState,
    drawnSet: Set<number>,
    pattern: PatternDefinition,
  ): string[] {
    const patternMask = pattern.mask!;
    const uniqueWinners = new Set<string>();

    for (const [playerId, tickets] of state.tickets) {
      if (uniqueWinners.has(playerId)) continue;
      const playerMarksAll = state.marks?.get(playerId);
      for (let ticketIdx = 0; ticketIdx < tickets.length; ticketIdx += 1) {
        const ticket = tickets[ticketIdx]!;
        const playerMarks = playerMarksAll?.[ticketIdx];
        const marksSet: Set<number> =
          playerMarks && playerMarks.size > 0
            ? new Set(playerMarks)
            : drawnSet;
        const ticketMask = patternMatcherBuildTicketMask(ticket, marksSet);
        if (patternMatcherMatches(ticketMask, patternMask)) {
          uniqueWinners.add(playerId);
          break;
        }
      }
    }

    return sortWinnerIdsDeterministic(uniqueWinners);
  }

  // ── Sequential helpers ────────────────────────────────────────────────────

  /**
   * Detekter vinnere for én sekvensiell pattern. Returner per-color-grupper
   * + total unique-winner-count.
   *
   * Speilkopierer `BingoEnginePatternEval.detectPhaseWinners` i ren form
   * (uten roomCode-warning-callback). PerColorMatrix-mapping skjer her.
   */
  private detectPhaseWinners(
    state: PatternEvalState,
    drawnSet: Set<number>,
    pattern: PatternDefinition,
    phaseIndex: number,
  ): {
    totalUniqueWinners: number;
    byColor: Map<string, { playerIds: Set<string>; resolvedPattern: PatternDefinition }>;
  } {
    const byColor = new Map<
      string,
      { playerIds: Set<string>; resolvedPattern: PatternDefinition }
    >();
    const uniquePlayers = new Set<string>();

    if (!state.perColorMatrix) {
      // Flat-path: én gruppe, uniqueset per player (ignorér farge).
      const flatIds = new Set<string>();
      for (const [playerId, tickets] of state.tickets) {
        for (let i = 0; i < tickets.length; i++) {
          if (meetsPhaseRequirement(pattern, tickets[i]!, drawnSet)) {
            flatIds.add(playerId);
            break;
          }
        }
      }
      if (flatIds.size > 0) {
        byColor.set(FLAT_GROUP_KEY, {
          playerIds: flatIds,
          resolvedPattern: pattern,
        });
      }
      return { totalUniqueWinners: flatIds.size, byColor };
    }

    // Per-color path: iterér alle brett, grupper per (color, player).
    const matrix = state.perColorMatrix.patternsByColor;
    for (const [playerId, tickets] of state.tickets) {
      for (const ticket of tickets) {
        if (!meetsPhaseRequirement(pattern, ticket, drawnSet)) continue;
        const colorKey = ticket.color ?? UNCOLORED_KEY;
        let group = byColor.get(colorKey);
        if (!group) {
          // Resolve matrise for denne fargen. Default-fallback hvis fargen
          // ikke har egen entry.
          const colorPatterns = matrix.get(colorKey) ?? matrix.get("__default__");
          const resolvedPattern = colorPatterns?.[phaseIndex] ?? pattern;
          group = { playerIds: new Set(), resolvedPattern };
          byColor.set(colorKey, group);
        }
        group.playerIds.add(playerId);
        uniquePlayers.add(playerId);
      }
    }

    return { totalUniqueWinners: uniquePlayers.size, byColor };
  }

  /**
   * Bygg ferdig PhaseAdvance fra detect-resultat. Sorterer alt
   * deterministisk.
   */
  private buildPhaseAdvance(
    pattern: PatternDefinition,
    phaseIndex: number,
    phaseResult: {
      totalUniqueWinners: number;
      byColor: Map<string, { playerIds: Set<string>; resolvedPattern: PatternDefinition }>;
    },
  ): PhaseAdvance {
    const sortedColorKeys = sortColorKeysDeterministic(phaseResult.byColor.keys());

    // Bygg sortert winnerGroups-Map.
    const winnerGroups = new Map<
      string,
      { readonly winnerIds: readonly string[]; readonly resolvedPattern: PatternDefinition }
    >();
    const allWinnerIdsSet = new Set<string>();
    for (const colorKey of sortedColorKeys) {
      const group = phaseResult.byColor.get(colorKey)!;
      const sortedWinners = sortWinnerIdsDeterministic(group.playerIds);
      winnerGroups.set(colorKey, {
        winnerIds: sortedWinners,
        resolvedPattern: group.resolvedPattern,
      });
      for (const id of sortedWinners) allWinnerIdsSet.add(id);
    }
    const dedupedWinnerIds = sortWinnerIdsDeterministic(allWinnerIdsSet);

    return {
      patternId: pattern.id,
      patternName: pattern.name,
      claimType: pattern.claimType,
      patternIndex: phaseIndex,
      winnerIds: dedupedWinnerIds,
      winnerGroups,
    };
  }

  /**
   * Eksplodér PhaseAdvance til flat liste av NewClaim-rader. Én rad per
   * (player, colorGroup). En spiller med brett i flere farger vises én
   * gang per farge (matcher prod-semantikken).
   */
  private buildClaimsFromPhase(advance: PhaseAdvance): NewClaim[] {
    const claims: NewClaim[] = [];
    for (const [colorKey, group] of advance.winnerGroups) {
      for (const playerId of group.winnerIds) {
        claims.push({
          playerId,
          patternId: advance.patternId,
          patternName: advance.patternName,
          claimType: advance.claimType,
          colorGroupKey: colorKey,
          resolvedPattern: group.resolvedPattern,
        });
      }
    }
    return claims;
  }
}

// ── Per-ticket phase-evaluation helpers ─────────────────────────────────────

/**
 * Speilkopi av `BingoEnginePatternEval.meetsPhaseRequirement`.
 *
 * Eksportert separat så property-tester kan importere pure-funksjonen og
 * verifisere fase-regler direkte uten å konstruere full `PatternEvalState`.
 *
 * Fase-modell (norsk 75-ball):
 *   - "1 Rad" (fase 1): ≥1 horisontal rad ELLER ≥1 vertikal kolonne
 *   - "2 Rader" (fase 2): ≥2 hele horisontale rader
 *   - "3 Rader" (fase 3): ≥3 hele horisontale rader
 *   - "4 Rader" (fase 4): ≥4 hele horisontale rader
 *   - "Fullt Hus" (fase 5): alle 25 felt merket
 *
 * Klassifisering via `classifyPhaseFromPatternName` i shared-types.
 * Ukjente pattern-navn faller tilbake til `claimType`-basert sjekk.
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

// ── Validation ──────────────────────────────────────────────────────────────

const EMPTY_RESULT: PatternEvalResult = Object.freeze({
  newClaims: [],
  phasesAdvanced: [],
  allCardsClosed: false,
});

function validateState(state: PatternEvalState): void {
  if (!state.gameId?.trim()) {
    throw new PatternEvalError("INVALID_STATE", "gameId er påkrevd.");
  }
  if (state.status !== "RUNNING" && state.status !== "NOT_RUNNING") {
    throw new PatternEvalError(
      "INVALID_STATE",
      `status må være 'RUNNING' eller 'NOT_RUNNING', fikk '${state.status}'.`,
      { gameId: state.gameId, status: state.status },
    );
  }
  if (state.mode !== "sequential" && state.mode !== "concurrent") {
    throw new PatternEvalError(
      "INVALID_STATE",
      `mode må være 'sequential' eller 'concurrent', fikk '${state.mode}'.`,
      { gameId: state.gameId, mode: state.mode },
    );
  }
  if (!Array.isArray(state.drawnNumbers)) {
    throw new PatternEvalError(
      "INVALID_STATE",
      "drawnNumbers må være et array.",
      { gameId: state.gameId },
    );
  }
  if (!(state.tickets instanceof Map)) {
    throw new PatternEvalError(
      "INVALID_STATE",
      "tickets må være en Map<playerId, Ticket[]>.",
      { gameId: state.gameId },
    );
  }
  if (!Array.isArray(state.patterns)) {
    throw new PatternEvalError(
      "INVALID_STATE",
      "patterns må være et array.",
      { gameId: state.gameId },
    );
  }
  if (!Array.isArray(state.patternResults)) {
    throw new PatternEvalError(
      "INVALID_STATE",
      "patternResults må være et array.",
      { gameId: state.gameId },
    );
  }

  // patternResults skal mappe 1:1 til patterns (samme lengde + matchende IDer).
  // Dette er en strukturell invariant — caller har ansvar for å bygge state
  // konsistent. Vi gjør en mild sjekk som fanger åpenbare feil.
  if (state.patterns.length > 0 && state.patternResults.length !== state.patterns.length) {
    throw new PatternEvalError(
      "PATTERN_RESULTS_MISMATCH",
      `patternResults.length (${state.patternResults.length}) må matche patterns.length (${state.patterns.length}).`,
      {
        gameId: state.gameId,
        patternsLen: state.patterns.length,
        resultsLen: state.patternResults.length,
      },
    );
  }
  // Sjekk at hvert patternResult har en matchende pattern.id (set-membership).
  if (state.patterns.length > 0) {
    const patternIds = new Set(state.patterns.map((p) => p.id));
    for (const r of state.patternResults) {
      if (!patternIds.has(r.patternId)) {
        throw new PatternEvalError(
          "PATTERN_RESULTS_MISMATCH",
          `patternResults inneholder patternId='${r.patternId}' som ikke finnes i patterns.`,
          {
            gameId: state.gameId,
            unknownPatternId: r.patternId,
            knownPatternIds: [...patternIds],
          },
        );
      }
    }
  }
}
