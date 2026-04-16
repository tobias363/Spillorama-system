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
 * Returnerer total innsats i kroner.
 * 0 betyr "vis ingenting" (vises som "—" i LeftInfoPanel).
 *
 * Strategi:
 *   1. Hvis `myStake` er definert (server-autoritativ): bruk direkte.
 *   2. Ellers: beregn fra tickets (fallback under utrulling).
 */
export function calculateStake(input: StakeInput): number {
  // ── Server-autoritativ ──
  if (input.myStake !== undefined && input.myStake !== null) {
    return input.myStake;
  }

  // ── Fallback: klient-beregning ──
  const tickets = resolveTickets(input);
  if (tickets.length === 0) return 0;
  return tickets.reduce((sum, t) => sum + priceFor(t, input), 0);
}

/**
 * Velger hvilke tickets som skal brukes som grunnlag for innsatsberegning.
 * Returnerer tom liste hvis spilleren ikke skal vise innsats.
 */
function resolveTickets(input: StakeInput): Ticket[] {
  const { gameStatus, myTickets, preRoundTickets, isArmed } = input;

  // Regel 1 & 2: Under en aktiv runde er myTickets kilden til sannhet.
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
