/**
 * Game3PhaseStateMachine — sequential phase-with-pause state machine for
 * Spill 3 (monsterbingo) per Tobias-direktiv 2026-05-08.
 *
 * **Hva denne modulen gjør:**
 *
 * Spill 3 har 5 faser: Rad 1, Rad 2, Rad 3, Rad 4, Fullt Hus. Etter at en
 * fase er vunnet, pauser engine i `pauseBetweenRowsMs` ms før neste fase
 * aktiveres. Round ender ved Fullt Hus eller når 75 baller er trukket.
 *
 * Eksisterende `PatternCycler` evaluerer alle aktive patterns konkurrent
 * (parallel). Denne tilstandsmaskinen wrapper cycler-logikken slik at
 * KUN én fase er aktiv om gangen, og innfører eksplisitt pause-tilstand
 * mellom fase-overgangene.
 *
 * **Tilstandsmaskin (5 faser, 0-indeksert):**
 *
 * ```
 *   Phase 0 (Rad 1) ─[winners]→ pause ─[3000ms]→ Phase 1 (Rad 2) ─...
 *   Phase 4 (Fullt Hus) ─[winners]→ ROUND_OVER
 *   Any phase + 75 balls drawn ─→ ROUND_OVER
 * ```
 *
 * Tilstandene er serialiserbare slik at engine kan persiste dem til DB
 * mellom server-restarter (recovery).
 *
 * **Pot-deling (flat):** Alle vinnere på samme fase deler poten likt med
 * `Math.floor(potCents / winnerCount)`. Eventuell øre-rest beholdes av
 * husaccount (caller har ansvar for å skrive denne til ledger).
 *
 * **Out-of-scope (følger i egen PR ved behov):**
 *   - Persistens til DB (caller er ansvarlig — se `getPhaseState` /
 *     `persistPhaseState`-kommentarer).
 *   - Engine-integrasjon (subscriber av `evaluatePhaseAndPay`).
 *   - Wallet-payout (denne modulen returnerer kun payout-instruksjoner;
 *     caller kjører wallet-transfers).
 *
 * Mønster: speil av Spill1-fase-state-pattern (`Game1HallReadyService`
 * sin ready-state-machine), bare med pause-mekanikk i tillegg.
 */

import type { PatternMask } from "@spillorama/shared-types";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Spill 3-fase-indeks (0-indeksert). Phase 4 = Fullt Hus (terminal-fase
 * som ender runden ved vinn).
 */
export type Game3PhaseIndex = 0 | 1 | 2 | 3 | 4;

/**
 * Faste fase-navn. Eksportert som verdi (ikke kun type) slik at engine
 * og UI bruker samme strenger.
 */
export const GAME3_PHASE_NAMES = [
  "Rad 1",
  "Rad 2",
  "Rad 3",
  "Rad 4",
  "Fullt Hus",
] as const;

/**
 * Antall faser (5 faste). Eksportert som konstant for å unngå "magic
 * numbers" i caller-kode.
 */
export const GAME3_PHASE_COUNT = 5;

/**
 * Per-room serialiserbar fase-tilstand. Caller skal persiste denne
 * (typisk i `app_spill3_phase_state`-tabell eller i room-state JSONB).
 */
export interface Game3PhaseState {
  /** Aktiv fase-indeks (0-4). Fase 4 (Fullt Hus) er terminal. */
  currentPhaseIndex: Game3PhaseIndex;
  /**
   * Når != null, er engine i pause-tilstand frem til denne timestampen.
   * `evaluatePhaseAndPay` returnerer `{ paused: true }` hvis kalt før
   * `now >= pausedUntilMs`. `drawNext` bør tilsvarende skippe trekk.
   */
  pausedUntilMs: number | null;
  /**
   * Liste over fase-indekser som allerede er vunnet i denne runden.
   * Brukes for audit/recovery + for å verifisere at pot-allokering ikke
   * dobbel-utbetales ved server-restart midt i fase-overgang.
   */
  phasesWon: Game3PhaseIndex[];
  /**
   * Round-status. `"ACTIVE"` = pågående; `"ENDED"` = ferdig (Fullt Hus
   * vunnet eller 75 baller trukket uten Fullt Hus). Engine sjekker
   * dette feltet før `drawNext`/`evaluate`.
   */
  status: "ACTIVE" | "ENDED";
  /** End-grunn når status==="ENDED". Brukes av audit-log + perpetual-loop. */
  endedReason: "FULL_HOUSE" | "DRAW_BAG_EMPTY" | null;
}

/**
 * Initial tilstand for en ny runde. Caller bruker denne ved round-start.
 */
export function createInitialPhaseState(): Game3PhaseState {
  return {
    currentPhaseIndex: 0,
    pausedUntilMs: null,
    phasesWon: [],
    status: "ACTIVE",
    endedReason: null,
  };
}

/**
 * Vinner-instruksjon returnert av `evaluatePhaseAndPay`. Caller (engine)
 * skal kjøre wallet-transfer per `WinnerPayoutInstruction` og skrive
 * ledger-entry for `houseRetainedCents`.
 */
export interface WinnerPayoutInstruction {
  /** Spiller-id som vinner i denne fasen. */
  playerId: string;
  /** Ticket-id som matchet pattern-maskene (for audit). */
  ticketId: string;
  /** Beløp i øre som skal krediteres spillerens wallet. */
  payoutCents: number;
}

/**
 * Resultat av `evaluatePhaseAndPay` — én av tre disjunkte cases.
 *
 * - `{ kind: "PAUSED" }` — engine er i pause; ingen evaluering kjørt.
 * - `{ kind: "NO_WINNERS" }` — fase er aktiv men ingen tickets matcher.
 * - `{ kind: "WINNERS", ... }` — fase ble vunnet; caller utbetaler og
 *   sjekker om runden skal ende.
 */
export type EvaluatePhaseResult =
  | { kind: "PAUSED"; resumesAtMs: number }
  | { kind: "NO_WINNERS"; phaseIndex: Game3PhaseIndex }
  | {
      kind: "WINNERS";
      phaseIndex: Game3PhaseIndex;
      payouts: WinnerPayoutInstruction[];
      /** Pot-rest etter flat split (Math.floor). Caller skriver til hus-account. */
      houseRetainedCents: number;
      /**
       * Ny tilstand etter evaluering. Hvis `state.status === "ENDED"`,
       * caller skal end runden. Ellers er state.pausedUntilMs satt til
       * `now + pauseBetweenRowsMs` og `currentPhaseIndex` advanced.
       */
      newState: Game3PhaseState;
    };

/**
 * Per-ticket pattern-match-info. Caller bygger denne fra spillet
 * (tickets + drawnSet) og passer den inn i `evaluatePhaseAndPay`.
 */
export interface TicketMatch {
  playerId: string;
  ticketId: string;
  /** 25-bit mask av celler som er markert (drawn) på denne ticketen. */
  ticketMask: PatternMask;
}

/**
 * Pattern-mask for en gitt fase. Caller (Spill3GlobalRoomService eller
 * engine) bygger denne fra konfig (Row 1-4 + Full House masks).
 */
export interface PhaseMask {
  /** Fase-indeks 0-4. */
  index: Game3PhaseIndex;
  /**
   * Én eller flere 25-bit masks. Pattern matcher hvis ANY mask har alle
   * bits satt i `ticketMask` (subset-match: `(ticketMask & mask) === mask`).
   */
  masks: readonly PatternMask[];
}

// ── Pure phase logic ────────────────────────────────────────────────────────

/**
 * Sjekk om en ticket matcher noen av maskene for en gitt fase.
 * Returnerer true hvis `(ticketMask & mask) === mask` for minst én mask.
 *
 * Match-semantikken er IDENTISK med eksisterende `matchesAny` i
 * PatternMatcher.ts — duplisert her for å unngå krysset import-graf
 * og holde modulen selv-stendig.
 */
export function ticketMatchesPhase(
  ticketMask: PatternMask,
  phaseMask: PhaseMask,
): boolean {
  for (const mask of phaseMask.masks) {
    if ((ticketMask & mask) === mask) return true;
  }
  return false;
}

/**
 * Finn alle tickets som matcher en gitt fase. Brukes av engine for å
 * bygge `winners`-lista som passes inn i `evaluatePhaseAndPay`.
 *
 * Returnerer tom array hvis ingen tickets matcher.
 */
export function findPhaseWinners(
  tickets: readonly TicketMatch[],
  phaseMask: PhaseMask,
): TicketMatch[] {
  return tickets.filter((t) => ticketMatchesPhase(t.ticketMask, phaseMask));
}

/**
 * Kjernen i state-maskinen: evaluer aktiv fase, pay ut til vinnere,
 * advance state.
 *
 * **Algoritme:**
 *
 * 1. Hvis state.status === "ENDED" → return NO_WINNERS (no-op for
 *    safety; caller bør ikke kalle på ENDED-state).
 * 2. Hvis state.pausedUntilMs && now < state.pausedUntilMs → return
 *    PAUSED med `resumesAtMs`.
 * 3. Finn vinnere for nåværende fase. Hvis ingen → return NO_WINNERS.
 * 4. Beregn pot-deling:
 *    - sharePerWinner = Math.floor(potCents / winners.length)
 *    - houseRetained = potCents - sharePerWinner * winners.length
 * 5. Bygg `WinnerPayoutInstruction[]`.
 * 6. Advance state:
 *    - phasesWon += currentPhaseIndex
 *    - Hvis currentPhaseIndex === 4 (Fullt Hus) → status="ENDED",
 *      endedReason="FULL_HOUSE"
 *    - Ellers → pausedUntilMs = now + pauseBetweenRowsMs;
 *      currentPhaseIndex++
 * 7. Return WINNERS med ny state.
 *
 * **Pure function:** state inn → state ut. Caller persister.
 */
export interface EvaluatePhaseInput {
  state: Game3PhaseState;
  phaseMasks: readonly PhaseMask[];
  tickets: readonly TicketMatch[];
  /** Pot for nåværende fase i øre. */
  potCents: number;
  /** Pause i ms mellom rader (typisk 3000). */
  pauseBetweenRowsMs: number;
  /** Wall-clock i ms (Date.now()). */
  now: number;
}

export function evaluatePhaseAndPay(
  input: EvaluatePhaseInput,
): EvaluatePhaseResult {
  const { state, phaseMasks, tickets, potCents, pauseBetweenRowsMs, now } = input;

  // Defensive: terminal-state — engine skal ikke kalle på ENDED.
  if (state.status === "ENDED") {
    return { kind: "NO_WINNERS", phaseIndex: state.currentPhaseIndex };
  }

  // Pause-sjekk: engine skipper evaluering frem til pausen er over.
  if (state.pausedUntilMs !== null && now < state.pausedUntilMs) {
    return { kind: "PAUSED", resumesAtMs: state.pausedUntilMs };
  }

  // Finn pattern-mask for aktiv fase.
  const activeMask = phaseMasks.find((m) => m.index === state.currentPhaseIndex);
  if (!activeMask) {
    // Caller har gitt incomplete phaseMasks — defensiv no-winners.
    return { kind: "NO_WINNERS", phaseIndex: state.currentPhaseIndex };
  }

  // Finn vinnere for aktiv fase.
  const winners = findPhaseWinners(tickets, activeMask);
  if (winners.length === 0) {
    return { kind: "NO_WINNERS", phaseIndex: state.currentPhaseIndex };
  }

  // Pot-deling flat. Math.floor → eventuell øre-rest beholdes av hus.
  const sharePerWinner =
    potCents > 0 ? Math.floor(potCents / winners.length) : 0;
  const houseRetainedCents = potCents - sharePerWinner * winners.length;

  // Bygg payout-instruksjoner. Caller kjører wallet-transfer per entry.
  const payouts: WinnerPayoutInstruction[] = winners.map((w) => ({
    playerId: w.playerId,
    ticketId: w.ticketId,
    payoutCents: sharePerWinner,
  }));

  // Advance state.
  const wonPhaseIdx = state.currentPhaseIndex;
  const isFullHouse = wonPhaseIdx === 4;

  let newState: Game3PhaseState;
  if (isFullHouse) {
    // Terminal fase: round ender umiddelbart. Ingen pause før neste
    // fase fordi det ikke finnes en neste fase.
    newState = {
      currentPhaseIndex: wonPhaseIdx,
      pausedUntilMs: null,
      phasesWon: [...state.phasesWon, wonPhaseIdx],
      status: "ENDED",
      endedReason: "FULL_HOUSE",
    };
  } else {
    // Ikke-terminal fase: scheduler pause før neste fase.
    const nextPhaseIdx = (wonPhaseIdx + 1) as Game3PhaseIndex;
    newState = {
      currentPhaseIndex: nextPhaseIdx,
      pausedUntilMs: now + pauseBetweenRowsMs,
      phasesWon: [...state.phasesWon, wonPhaseIdx],
      status: "ACTIVE",
      endedReason: null,
    };
  }

  return {
    kind: "WINNERS",
    phaseIndex: wonPhaseIdx,
    payouts,
    houseRetainedCents,
    newState,
  };
}

/**
 * Sjekk om engine skal skippe drawNext basert på state.
 *
 * - Returns `{ skip: true, reason: "PAUSED" }` hvis i pause-vindu.
 * - Returns `{ skip: true, reason: "ENDED" }` hvis runden er ferdig.
 * - Returns `{ skip: false }` ellers — engine kan trekke.
 */
export type ShouldDrawResult =
  | { skip: false }
  | { skip: true; reason: "PAUSED"; resumesAtMs: number }
  | { skip: true; reason: "ENDED" };

export function shouldDrawNext(
  state: Game3PhaseState,
  now: number,
): ShouldDrawResult {
  if (state.status === "ENDED") {
    return { skip: true, reason: "ENDED" };
  }
  if (state.pausedUntilMs !== null && now < state.pausedUntilMs) {
    return { skip: true, reason: "PAUSED", resumesAtMs: state.pausedUntilMs };
  }
  return { skip: false };
}

/**
 * Marker runden som ferdig pga 75 baller trukket uten Fullt Hus.
 * Engine kaller denne når `drawnNumbers.length >= 75` og state.status
 * fortsatt er "ACTIVE".
 */
export function markDrawBagEmpty(state: Game3PhaseState): Game3PhaseState {
  if (state.status === "ENDED") return state;
  return {
    ...state,
    status: "ENDED",
    endedReason: "DRAW_BAG_EMPTY",
    pausedUntilMs: null,
  };
}

// ── Auto-start helper ───────────────────────────────────────────────────────

/**
 * Avgjør om en WAITING-runde skal auto-startes basert på antall solgte
 * bonger vs threshold. Pure function — caller henter konfig + room-state
 * og passer dem inn.
 *
 * Returnerer `true` iff:
 *   - room.status === "WAITING"
 *   - ticketsSold >= minTicketsToStart
 *
 * Caller (Spill3GlobalRoomService.maybeStartRound) bruker dette resultatet
 * til å trigger BingoEngine.startGame.
 */
export interface AutoStartInput {
  roomStatus: "WAITING" | "RUNNING" | "ENDED" | "OPEN" | "PLAYING";
  ticketsSold: number;
  minTicketsToStart: number;
}

export function shouldAutoStartRound(input: AutoStartInput): boolean {
  if (input.roomStatus !== "WAITING") return false;
  if (input.minTicketsToStart <= 0) {
    // Threshold = 0 betyr "ingen gating" — start så snart minst én ticket er solgt.
    return input.ticketsSold > 0;
  }
  return input.ticketsSold >= input.minTicketsToStart;
}
