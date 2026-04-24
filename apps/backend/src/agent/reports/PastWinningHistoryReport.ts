/**
 * BIN-17.32: "Past Game Winning History" (Agent-view).
 *
 * Legacy reference:
 *   - `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` §17.32
 *
 * Kolonner per wireframe:
 *   Date/Time | Ticket ID | Ticket Type | Ticket Color | Ticket Price | Winning Pattern
 *
 * Kilde:
 *   - `app_static_tickets` (StaticTicketService) for rader der `paid_out_at`
 *     er satt — det vil si billetter som er utbetalt (vinnere). ticketType +
 *     ticketColor er allerede normalisert der (legacy CSV-import).
 *   - Winning-mønster hentes fra den tilknyttede physical-ticket-raden
 *     (`app_physical_tickets.pattern_won`) via `sold_to_scheduled_game_id`
 *     når StaticTicketService ikke har feltet selv. Hvis mønster ikke finnes
 *     returneres `null` (vises som "—" i UI).
 *
 * Dette er rent aggregerings-/rapporterings-modul — ingen DB I/O. Callsite
 * (routes/agentReportsPastWinning.ts) gjør DB-oppslag og feeder resultatene
 * hit. Mirror of BIN-BOT-01 Game1ManagementReport-patternet for testbarhet.
 */

export interface PastWinningHistoryInput {
  /** Alle utbetalte tickets i perioden (paidOutAt != null), post-RBAC-filter. */
  tickets: PastWinningSourceTicket[];
  /** ISO-vindu (inclusive). */
  from: string;
  to: string;
  /** Fritekst-søk mot ticketId (ticketSerial / uniqueId). */
  ticketId?: string;
  /** Pagination. */
  offset?: number;
  limit?: number;
}

export interface PastWinningSourceTicket {
  /** Unik ID eller serial — vises som "Ticket ID" i rapporten. */
  ticketId: string;
  /** Variant-navn (f.eks. "small_yellow", "elvis_1"). Raw fra CSV. */
  ticketType: string;
  /** Farge-familie ("small" | "large" | "traffic-light"). */
  ticketColor: string;
  /** Pris i øre. */
  priceCents: number | null;
  /** Utbetalingsdato — brukes som "Date/Time" i rapporten. */
  paidOutAt: string;
  /** Vinnende mønster (f.eks. "row_1", "full_house"). Kan være null hvis ikke stemplet. */
  winningPattern: string | null;
  /** Hall-id for RBAC-audit / debug. */
  hallId: string;
}

export interface PastWinningHistoryRow {
  dateTime: string;
  ticketId: string;
  ticketType: string;
  ticketColor: string;
  priceCents: number | null;
  winningPattern: string | null;
}

export interface PastWinningHistoryResult {
  from: string;
  to: string;
  generatedAt: string;
  rows: PastWinningHistoryRow[];
  /** Totalt antall matches før paginering (for UI-pagineringskontroll). */
  total: number;
  offset: number;
  limit: number;
}

function assertIsoWindow(from: string, to: string): { fromMs: number; toMs: number } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs)) {
    throw new Error(`[past-winning] Ugyldig 'from': ${from}`);
  }
  if (!Number.isFinite(toMs)) {
    throw new Error(`[past-winning] Ugyldig 'to': ${to}`);
  }
  if (fromMs > toMs) {
    throw new Error(`[past-winning] 'from' må være <= 'to' (${from} > ${to}).`);
  }
  return { fromMs, toMs };
}

/**
 * Bygg "Past Game Winning History"-resultat fra utbetalte tickets.
 *
 * Filtre:
 *   - paidOutAt må være innenfor [from, to].
 *   - ticketId-søk matcher substring (case-insensitive).
 *
 * Sortering: `paidOutAt` descending (nyeste først) — matcher legacy hvor nyeste
 * vinnere vises øverst.
 *
 * Paginering: offset + limit (default 0 / 100, maks limit 500).
 */
export function buildPastWinningHistory(
  input: PastWinningHistoryInput
): PastWinningHistoryResult {
  const { fromMs, toMs } = assertIsoWindow(input.from, input.to);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const needle = input.ticketId?.trim().toLowerCase();

  const filtered = input.tickets.filter((t) => {
    const paidMs = Date.parse(t.paidOutAt);
    if (!Number.isFinite(paidMs)) return false;
    if (paidMs < fromMs || paidMs > toMs) return false;
    if (needle && !t.ticketId.toLowerCase().includes(needle)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const aMs = Date.parse(a.paidOutAt);
    const bMs = Date.parse(b.paidOutAt);
    if (aMs !== bMs) return bMs - aMs;
    return a.ticketId.localeCompare(b.ticketId);
  });

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  const rows: PastWinningHistoryRow[] = page.map((t) => ({
    dateTime: t.paidOutAt,
    ticketId: t.ticketId,
    ticketType: t.ticketType,
    ticketColor: t.ticketColor,
    priceCents: t.priceCents,
    winningPattern: t.winningPattern,
  }));

  return {
    from: input.from,
    to: input.to,
    generatedAt: new Date().toISOString(),
    rows,
    total,
    offset,
    limit,
  };
}
