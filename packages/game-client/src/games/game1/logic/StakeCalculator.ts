/**
 * StakeCalculator — Game 1 innsats (stake) beregning
 *
 * Server-autoritativ: backend beregner innsats og sender `playerStakes` i
 * room:update. Klienten viser dette beløpet direkte uten egen beregning.
 *
 * Fallback: Hvis backend ikke sender `myStake` (f.eks. under utrulling eller
 * gammel backend-versjon), brukes klient-side beregning basert på tickets
 * og armeringsstatus. Denne fallbacken kan fjernes når migreringen er fullført.
 *
 * Bakgrunn:
 *   Backend genererer alltid `preRoundTickets` for ALLE spillere som ikke
 *   deltar i den aktive runden (også uarmede spectators). Disse "display-tickets"
 *   brukes bare for å vise brettene på skjermen, og er IKKE et signal på at
 *   spilleren har kjøpt. `isArmed` (fra `armedPlayerIds` i room:update) er
 *   den eneste pålitelige indikatoren på et eksplisitt kjøp.
 *
 * Regler (brukes av både server og fallback):
 *   1. Aktiv runde + egne tickets → deltaker, vis faktisk innsats
 *   2. Aktiv runde, ingen tickets → spectator, vis ingenting ("—")
 *   3. Mellom runder + armet      → har kjøpt til neste runde, vis innsats
 *   4. Mellom runder + ikke armet → vis ingenting ("—")
 */

import type { Ticket } from "@spillorama/shared-types/game";
import type { GameState } from "../../../bridge/GameBridge.js";

// ── Typer ────────────────────────────────────────────────────────────────────

export interface StakeInput {
  /** Server-authoritative stake. Preferred when available. */
  myStake?: number;
  // Fallback fields (used when myStake is undefined)
  gameStatus: GameState["gameStatus"];
  myTickets: Ticket[];
  preRoundTickets: Ticket[];
  isArmed: boolean;
  ticketTypes: GameState["ticketTypes"];
  entryFee: number;
}

// ── Beregning ─────────────────────────────────────────────────────────────────

/**
 * Returnerer total innsats i kroner — KUN aktiv-rundens innsats.
 * 0 betyr "vis ingenting" (vises som "—" i LeftInfoPanel).
 *
 * Round-state-isolation (Tobias 2026-04-25):
 *   Innsats-feltet skal aldri inkludere pre-round / forhåndskjøp-bonger
 *   for fremtidige runder. Backend skiller dette via `playerStakes`
 *   (aktiv-runde) og `playerPendingStakes` (neste runde). Klienten
 *   trustar `myStake` blindt under RUNNING — server returnerer 0 for
 *   spectator selv om de har armet for neste runde.
 *
 * Strategi:
 *   1. Hvis `myStake` er definert (server-autoritativ): bruk direkte.
 *   2. Ellers: beregn fra tickets (fallback under utrulling).
 */
export function calculateStake(input: StakeInput): number {
  const serverStake = input.myStake;
  const hasServerStake = serverStake !== undefined && serverStake !== null;

  // ── RUNNING: server-autoritativ uansett verdi ──
  // Under en aktiv runde reflekterer backend kun gameTickets-innsats
  // (round-state-isolation). Pre-round-arms for neste runde holdes utenfor
  // og leveres separat via myPendingStake. 0 = spectator = vis "—".
  if (input.gameStatus === "RUNNING" && hasServerStake) {
    return serverStake;
  }

  // ── Ikke-RUNNING: server-autoritativ KUN når > 0 ──
  //
  // BIN-686 fix-up: backend sender `playerStakes` som 0 under WAITING
  // selv når spilleren har armet pre-round-bonger. Hvis server stake > 0
  // mellom runder stoler vi — det betyr backend har eksplisitt registrert
  // armed-state. Hvis 0, må vi falle tilbake til ticket-beregning så Innsats
  // oppdaterer seg straks bruker klikker Kjøp (race-vindu før neste
  // room:update lander).
  if (hasServerStake && serverStake > 0) {
    return serverStake;
  }

  // ── Fallback: klient-beregning fra tickets ──
  const tickets = resolveTickets(input);
  if (tickets.length === 0) return 0;
  return tickets.reduce((sum, t) => sum + priceFor(t, input), 0);
}

/**
 * Velger hvilke tickets som skal brukes som grunnlag for innsatsberegning.
 * Returnerer tom liste hvis spilleren ikke skal vise innsats.
 *
 * Round-state-isolation: under RUNNING brukes KUN myTickets (live-brett).
 * Pre-round-bonger (forhåndskjøp for neste runde) telles aldri i Innsats —
 * de er separat commitment som telles i myPendingStake.
 */
function resolveTickets(input: StakeInput): Ticket[] {
  const { gameStatus, myTickets, preRoundTickets, isArmed } = input;

  // Regel 1 & 2: Under en aktiv runde er myTickets kilden til sannhet.
  // Pre-round preRoundTickets ignoreres her — de er for neste runde.
  if (gameStatus === "RUNNING") {
    return myTickets; // Kan være tom (spectator) → returnerer 0
  }

  // Regel 3 & 4: Mellom runder — kun vis innsats hvis spilleren aktivt har armet.
  // preRoundTickets alene er ikke nok (backend genererer dem for alle).
  if (isArmed) {
    return preRoundTickets;
  }

  return [];
}

/**
 * Prisen for én ticket basert på type og entryFee.
 * Ukjente typer bruker priceMultiplier 1 (én gang entryFee).
 */
function priceFor(ticket: Ticket, input: StakeInput): number {
  const ticketType = input.ticketTypes.find(tt => tt.type === ticket.type);
  const multiplier = ticketType?.priceMultiplier ?? 1;
  return Math.round(input.entryFee * multiplier);
}

/**
 * Hjelper som trekker ut StakeInput direkte fra GameState.
 */
export function stakeFromState(state: GameState): number {
  return calculateStake({
    myStake: state.myStake,
    gameStatus: state.gameStatus,
    myTickets: state.myTickets,
    preRoundTickets: state.preRoundTickets,
    isArmed: state.isArmed,
    ticketTypes: state.ticketTypes,
    entryFee: state.entryFee,
  });
}
