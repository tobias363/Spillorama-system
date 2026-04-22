// ── BIN-628: admin track-spending aggregate (regulatorisk P2) ───────────────
// Norwegian pengespillforskriften §11 forebyggende tiltak. Aggregerer spend
// på tvers av haller/periode for compliance-oversikt. Fail-closed — 503 når
// data ikke er ferskt. Per-hall limits returneres slik at admin kan vurdere
// om hallens Spillvett-tak er i nærheten av å bli nådd.
//
// Viktige memo-krav:
//   - Per-hall daily/monthly limits (Norway: hall-basert)
//   - Ingen "mandatorisk pause" — voluntary + self-exclusion 1yr
//   - Fire-and-forget audit via AuditLogService (samme mønster som AML/security)
//
// Re-bruker per-spiller-aggregat fra apps/backend/src/spillevett/playerReport.ts.

import { z } from "zod";
import { IsoDateString } from "./_shared.js";

/** Per-hall spillvett-tak (regulatoriske + per-hall overrides når de finnes). */
export const TrackSpendingHallLimitsSchema = z.object({
  hallId: z.string().min(1),
  hallName: z.string(),
  /** Dagsgrense (NOK). 0 = uendelig. */
  dailyLimit: z.number().nonnegative(),
  /** Månedsgrense (NOK). 0 = uendelig. */
  monthlyLimit: z.number().nonnegative(),
  /**
   * Kilde: "regulatory" = system-wide default fra BingoEngine,
   *        "hall_override" = eksplisitt konfigurert for denne hallen.
   * Frontend bruker verdien til å merke rader der hallen har egen policy.
   */
  source: z.enum(["regulatory", "hall_override"]),
});
export type TrackSpendingHallLimits = z.infer<typeof TrackSpendingHallLimitsSchema>;

/** Aggregat per (hall, periode). */
export const TrackSpendingAggregateRowSchema = z.object({
  hallId: z.string().min(1),
  hallName: z.string(),
  /** Perioden raden dekker. Brukes for periode-sammendrag / cursor-paginering. */
  periodStart: IsoDateString,
  periodEnd: IsoDateString,
  /** Total stake (NOK) summert på tvers av spillere i perioden. */
  totalStake: z.number().nonnegative(),
  /** Total prize (NOK) summert på tvers av spillere i perioden. */
  totalPrize: z.number().nonnegative(),
  /** Netto (stake − prize). Kan være negativt (spillere vant mer enn de satset). */
  netSpend: z.number(),
  /** Antall unike spillere (walletId) med stake-aktivitet i perioden. */
  uniquePlayerCount: z.number().int().nonnegative(),
  /** Gjennomsnittlig netSpend per unike spiller. 0 hvis 0 spillere. */
  averageSpendPerPlayer: z.number(),
  /** Antall stake-events i perioden. */
  stakeEventCount: z.number().int().nonnegative(),
  /** Hallens Spillvett-limits så admin kan sammenligne aggregat mot tak. */
  limits: TrackSpendingHallLimitsSchema,
});
export type TrackSpendingAggregateRow = z.infer<typeof TrackSpendingAggregateRowSchema>;

export const TrackSpendingAggregateResponseSchema = z.object({
  generatedAt: IsoDateString,
  from: IsoDateString,
  to: IsoDateString,
  hallId: z.string().min(1).nullable(),
  /** Én rad per hall (filtered by hallId query) × aggregert periode. */
  rows: z.array(TrackSpendingAggregateRowSchema),
  /** Totalaggregat på tvers av alle hallene i responsen. */
  totals: z.object({
    totalStake: z.number().nonnegative(),
    totalPrize: z.number().nonnegative(),
    netSpend: z.number(),
    uniquePlayerCount: z.number().int().nonnegative(),
    stakeEventCount: z.number().int().nonnegative(),
  }),
  /** Opaque cursor for neste side — null når ingen flere rader. */
  nextCursor: z.string().nullable(),
  /**
   * Data-friskhet. Regulatorisk: dersom staleMs > maxAllowedStaleMs, skal
   * endepunktet returnere 503 (ikke tom data) — men vi eksporterer dette
   * feltet også på success-responser så UI kan vise "oppdatert kl. HH:MM".
   */
  dataFreshness: z.object({
    computedAt: IsoDateString,
    staleMs: z.number().int().nonnegative(),
    maxAllowedStaleMs: z.number().int().nonnegative(),
  }),
});
export type TrackSpendingAggregateResponse = z.infer<typeof TrackSpendingAggregateResponseSchema>;

/** Enkelt-transaksjon (stake/prize-event) i detalj-listen. */
export const TrackSpendingTransactionSchema = z.object({
  id: z.string().min(1),
  createdAt: IsoDateString,
  hallId: z.string().min(1),
  hallName: z.string(),
  playerId: z.string().nullable(),
  walletId: z.string().nullable(),
  gameType: z.enum(["MAIN_GAME", "DATABINGO"]),
  channel: z.enum(["HALL", "INTERNET"]),
  eventType: z.enum(["STAKE", "PRIZE", "EXTRA_PRIZE"]),
  amount: z.number(),
  currency: z.literal("NOK"),
  roomCode: z.string().optional(),
  gameId: z.string().optional(),
});
export type TrackSpendingTransaction = z.infer<typeof TrackSpendingTransactionSchema>;

export const TrackSpendingTransactionsResponseSchema = z.object({
  generatedAt: IsoDateString,
  from: IsoDateString,
  to: IsoDateString,
  hallId: z.string().min(1).nullable(),
  playerId: z.string().min(1).nullable(),
  transactions: z.array(TrackSpendingTransactionSchema),
  nextCursor: z.string().nullable(),
  dataFreshness: z.object({
    computedAt: IsoDateString,
    staleMs: z.number().int().nonnegative(),
    maxAllowedStaleMs: z.number().int().nonnegative(),
  }),
});
export type TrackSpendingTransactionsResponse = z.infer<typeof TrackSpendingTransactionsResponseSchema>;

/**
 * Fail-closed 503-respons. Regulatorisk: admin MÅ se tydelig feilmelding,
 * ikke tom data. Returneres med HTTP 503 når:
 *   - DB-query feiler
 *   - Data er stale (staleMs > maxAllowedStaleMs)
 *   - Hall-limits-oppslag feiler (kan ikke vise aggregat uten limits)
 */
export const TrackSpendingFailClosedResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "TRACK_SPENDING_STALE_DATA",
      "TRACK_SPENDING_DB_ERROR",
      "TRACK_SPENDING_LIMITS_UNAVAILABLE",
    ]),
    message: z.string().min(1),
    /** Viser admin hvor gammelt data er når koden er STALE_DATA. */
    staleMs: z.number().int().nonnegative().optional(),
    maxAllowedStaleMs: z.number().int().nonnegative().optional(),
  }),
});
export type TrackSpendingFailClosedResponse = z.infer<typeof TrackSpendingFailClosedResponseSchema>;
