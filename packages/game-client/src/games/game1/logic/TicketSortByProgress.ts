/**
 * TicketSortByProgress — Spill 1 visning av bonger sortert etter
 * "nærmest å fullføre nåværende fase".
 *
 * Tobias 2026-04-26: i Spill 1 vises bongene i server-rekkefølge. Spillere
 * synes det er vanskelig å se hvilke bonger som er nærmest å vinne. Denne
 * helperen sorterer bongene klient-side slik at den med færrest manglende
 * markeringer for nåværende fase vises først, deretter 2., 3., 4. osv.
 *
 * Backend-rekkefølgen er uendret — dette er ren UI-affordance. Sortering
 * skjer per `setTickets`-kall og bruker `Spill1Phase` + `PHASE_MASKS` fra
 * shared-types så klassifiseringen er identisk med backend.
 *
 * ── Closeness-score ───────────────────────────────────────────────────────
 *
 *   Per fase, beregn minimum-bits-mangler over kandidat-maskene:
 *     - Fase 1 (1 rad/kol):   minimum over 10 kandidater
 *     - Fase 2 (2 rader):     minimum over 10 kandidater
 *     - Fase 3 (3 rader):     minimum over 10 kandidater
 *     - Fase 4 (4 rader):     minimum over  5 kandidater
 *     - Fullt Hus (25 celler): 25 − popcount(ticketMask)
 *
 *   Lavere score = nærmere fullføring → vises tidligere i lista.
 *
 * ── Stabilitet ────────────────────────────────────────────────────────────
 *
 *   Stabil sortering: ties brytes på (a) original-indeks, så bonger med
 *   identisk score beholder relativ server-rekkefølge, og deretter (b)
 *   ticket.id leksikografisk for full deterministisk bestiling i tester.
 */

import type { PatternDefinition, Ticket } from "@spillorama/shared-types/game";
import {
  Spill1Phase,
  buildTicketMaskFromGrid5x5,
  classifyPhaseFromPatternName,
  popCount25,
  remainingBitsForPhase,
} from "@spillorama/shared-types/spill1-patterns";

/** Phase-koden brukt av `sortTicketsByProgress`. 1..4 = N rader, 5 = Fullt Hus. */
export type SortPhase = 1 | 2 | 3 | 4 | 5;

/**
 * Konverter SortPhase (1..5) til delt `Spill1Phase`-enum.
 * Returnerer null for ugyldige verdier (defensivt — type-systemet hindrer
 * det normalt).
 */
function toSpill1Phase(phase: SortPhase): Spill1Phase | null {
  switch (phase) {
    case 1: return Spill1Phase.Phase1;
    case 2: return Spill1Phase.Phase2;
    case 3: return Spill1Phase.Phase3;
    case 4: return Spill1Phase.Phase4;
    case 5: return Spill1Phase.FullHouse;
    default: return null;
  }
}

/**
 * Map fra delt `Spill1Phase`-enum til SortPhase (1..5).
 * Brukes av `sortPhaseFromActivePattern` til å derivere fasen fra et aktivt
 * pattern-objekt (server-autoritativt navn).
 */
function fromSpill1Phase(phase: Spill1Phase): SortPhase {
  switch (phase) {
    case Spill1Phase.Phase1: return 1;
    case Spill1Phase.Phase2: return 2;
    case Spill1Phase.Phase3: return 3;
    case Spill1Phase.Phase4: return 4;
    case Spill1Phase.FullHouse: return 5;
  }
}

/**
 * Avled SortPhase (1..5) fra et aktivt `PatternDefinition`-navn.
 * Returnerer `null` hvis pattern-navnet ikke matcher en kjent Spill 1-fase
 * (Spill 3 jubilee-mønstre, ukjente custom-navn, etc.) — caller bør droppe
 * sortering i den tilstanden og bruke server-rekkefølge.
 */
export function sortPhaseFromActivePattern(
  pattern: PatternDefinition | null | undefined,
): SortPhase | null {
  if (!pattern) return null;
  const sp = classifyPhaseFromPatternName(pattern.name);
  return sp === null ? null : fromSpill1Phase(sp);
}

/**
 * Closeness-score for én ticket. Lavere = nærmere fullføring.
 *
 * - Fase 1..4: minimum-bits-mangler over relevante kandidat-masker
 *   (rad/kol-kombinasjoner) gitt nåværende ticket-maske.
 * - Fullt Hus: 25 − popcount(ticketMask). Tilsvarer total-celler-mangler.
 *
 * Free center (rad 2 / kol 2) inkluderes alltid via
 * `buildTicketMaskFromGrid5x5` — celle-verdi 0 telles som "alltid markert".
 *
 * Returnerer `Number.POSITIVE_INFINITY` for grids som ikke er 5×5 (ingen
 * kjent klassifisering, så bongen sorteres bakerst — defensiv fallback,
 * normalt inntreffer ikke i Spill 1).
 */
export function closenessScore(
  ticket: Ticket,
  drawnNumbers: ReadonlySet<number>,
  phase: SortPhase,
): number {
  const grid = ticket.grid;
  const ticketMask = buildTicketMaskFromGrid5x5(grid, drawnNumbers);
  if (ticketMask === null) {
    // Ikke 5×5 (Databingo60 e.l.) — vi har ingen Spill 1-klassifisering.
    return Number.POSITIVE_INFINITY;
  }

  if (phase === 5) {
    // Fullt Hus: 25 − antall markerte celler.
    return 25 - popCount25(ticketMask);
  }

  const sp = toSpill1Phase(phase);
  if (sp === null) return Number.POSITIVE_INFINITY;
  return remainingBitsForPhase(sp, ticketMask);
}

/**
 * Sorter bonger etter "nærmest å fullføre fasen".
 *
 * - Stabil: bonger med identisk score beholder relativ server-rekkefølge.
 * - Deterministisk: ties brytes deretter på `ticket.id` leksikografisk.
 * - Tom drawn-set: alle bonger har lik score → original-rekkefølge bevart.
 *
 * Mutasjonsfri: returnerer en ny array. Caller kan sammenligne lengde-
 * uavhengig identity for å bestemme om DOM-reorder er nødvendig.
 */
export function sortTicketsByProgress(
  tickets: ReadonlyArray<Ticket>,
  drawnNumbers: ReadonlySet<number>,
  currentPhase: SortPhase,
): Ticket[] {
  // Lag indekserte par (originalIndex, score, ticket) før sortering — vi
  // trenger original-indeks for stabil tie-break.
  const decorated = tickets.map((ticket, index) => ({
    ticket,
    index,
    score: closenessScore(ticket, drawnNumbers, currentPhase),
  }));

  decorated.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    // Tie-break 1: original-indeks (stabilitet).
    if (a.index !== b.index) return a.index - b.index;
    // Tie-break 2: ticket.id leksikografisk (deterministisk fallback).
    const aId = a.ticket.id ?? "";
    const bId = b.ticket.id ?? "";
    if (aId !== bId) return aId < bId ? -1 : 1;
    return 0;
  });

  return decorated.map((d) => d.ticket);
}
