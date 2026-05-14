/**
 * Round-replay-builder — bygg event-tidsserie for én scheduled-game-runde.
 *
 * Tobias-direktiv 2026-05-14: "For hver runde må PM ofte verifisere: 'Ble
 * auto-multiplikator anvendt riktig på utbetalinger?' Eller: 'Hvorfor
 * finishet plan-run uten å advance?' Dette krever queries over flere
 * tabeller for å reprodusere tidsserien."
 *
 * Service-en henter rå rader fra følgende kilder og fletter dem til én
 * sortert tidslinje:
 *
 *   - app_game1_scheduled_games           (metadata + status-overganger)
 *   - app_game1_ticket_purchases          (purchase-events)
 *   - app_game1_draws                     (ball-trekk per draw_sequence)
 *   - app_game1_phase_winners             (per-vinner-payout)
 *   - app_game1_master_audit              (start/pause/resume/stop/exclude)
 *   - app_compliance_outbox               (ledger-event-status)
 *   - app_rg_compliance_ledger            (faktiske §71-events)
 *   - app_game_plan_run                   (plan-run-state)
 *   - app_game_catalog                    (catalog-entry for expected-prize-calc)
 *
 * Ingen muterende operasjoner — service-en er pure read.
 *
 * Fail-soft: hvis én av kildene kaster, embeddes feilen i payloaden men
 * service kaster aldri. Caller får alltid en respons, og kan se i `errors`-
 * felter hvilke kilder feilet.
 *
 * Performance: 8 parallelle SELECTs. Total ~20-80ms mot lokal Postgres for
 * en typisk Spill 1-runde (47 draws, 5 vinnere). Ikke ment for høy-frekvens
 * polling — tenk debug-tool, ikke runtime-feature.
 */

import type { Pool } from "pg";
import {
  calculateActualPrize,
  CHEAPEST_TICKET_PRICE_CENTS,
} from "../game/GameCatalogService.js";
import type {
  GameCatalogEntry,
  PrizeMultiplierMode,
  TicketColor,
} from "../game/gameCatalog.types.js";
import { detectRoundReplayAnomalies } from "./roundReplayAnomalyDetector.js";

// ────────────────────────────────────────────────────────────────────────
// Public types — wire-shape
// ────────────────────────────────────────────────────────────────────────

export type ReplayEventType =
  | "scheduled_game_created"
  | "ticket_purchase"
  | "master_action"
  | "draw"
  | "phase_winner"
  | "compliance_ledger"
  | "scheduled_game_completed";

export interface ReplayTimelineEvent {
  /** ISO-timestamp med millisekund-presisjon (sortert ASC). */
  ts: string;
  /** UNIX ms for stabil sort selv ved kollisjoner. */
  tsMs: number;
  type: ReplayEventType;
  data: Record<string, unknown>;
}

export interface ReplayMetadata {
  scheduledGameId: string;
  planRunId: string | null;
  planRunStatus: string | null;
  hallId: string;
  catalogSlug: string | null;
  catalogDisplayName: string | null;
  position: number | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  actualStartTime: string | null;
  actualEndTime: string | null;
  status: string;
  totalDraws: number;
  groupHallId: string;
  /** Snapshot av ticket_config_json fra scheduled-game-rad. */
  ticketConfig: unknown;
  /** Snapshot av jackpot_config_json fra scheduled-game-rad. */
  jackpotConfig: unknown;
}

export interface ReplaySummary {
  purchases: {
    totalCount: number;
    totalCents: number;
    refundedCount: number;
    /** Mapping fra (color × size) → samlet count. Eks. "yellow:small" → 4. */
    byColorSize: Record<string, number>;
  };
  draws: {
    total: number;
    uniqueBalls: number;
    firstDrawAt: string | null;
    lastDrawAt: string | null;
  };
  winners: Array<{
    phase: number;
    ticketColor: string;
    prizeKr: number;
    prizeCents: number;
    expectedCents: number | null;
    expectedKr: number | null;
    match: boolean;
    winnerBrettCount: number;
    drawSequenceAtWin: number;
    winnerUserId: string;
  }>;
  compliance: {
    ledgerEntries: number;
    outboxPending: number;
    outboxProcessed: number;
    outboxDeadLetter: number;
    auditEvents: number;
  };
}

export type ReplayAnomalyType =
  | "payout_mismatch"
  | "missing_advance"
  | "stuck_plan_run"
  | "double_stake"
  | "preparing_room_hang";

export interface ReplayAnomaly {
  type: ReplayAnomalyType;
  /** Lett-leselig beskrivelse for PM/audit. */
  description: string;
  /** Detalj-payload for programmatic-bruk + display. */
  details: Record<string, unknown>;
  /** Severity-hint: "info" (forventet edge-case), "warn" (avvik), "critical" (compliance-feil). */
  severity: "info" | "warn" | "critical";
}

export interface RoundReplay {
  scheduledGameId: string;
  metadata: ReplayMetadata;
  timeline: ReplayTimelineEvent[];
  summary: ReplaySummary;
  anomalies: ReplayAnomaly[];
  /** Per-kilde feilmeldinger (fail-soft). Tom hvis alt gikk fint. */
  errors: Record<string, string>;
  generatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// DB-row-typer (interne)
// ────────────────────────────────────────────────────────────────────────

interface ScheduledGameRow {
  id: string;
  daily_schedule_id: string;
  schedule_id: string;
  sub_game_index: number;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_day: Date | string;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
  ticket_config_json: unknown;
  jackpot_config_json: unknown;
  game_mode: string;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  status: string;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
  started_by_user_id: string | null;
  stopped_by_user_id: string | null;
  stop_reason: string | null;
  catalog_entry_id: string | null;
  plan_run_id: string | null;
  plan_position: number | null;
  room_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PlanRunRow {
  id: string;
  plan_id: string;
  hall_id: string;
  business_date: Date | string;
  current_position: number;
  status: string;
  jackpot_overrides_json: unknown;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  master_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CatalogRow {
  id: string;
  slug: string;
  display_name: string;
  rules: unknown;
  ticket_colors: unknown;
  ticket_prices_cents: unknown;
  prizes_cents: unknown;
  prize_multiplier_mode: string;
  bonus_game_slug: string | null;
  bonus_game_enabled: boolean;
  requires_jackpot_setup: boolean;
  is_active: boolean;
  sort_order: number;
}

interface TicketPurchaseRow {
  id: string;
  scheduled_game_id: string;
  buyer_user_id: string;
  hall_id: string;
  ticket_spec_json: unknown;
  total_amount_cents: number | string;
  payment_method: string;
  agent_user_id: string | null;
  purchased_at: Date | string;
  refunded_at: Date | string | null;
  refund_reason: string | null;
}

interface DrawRow {
  id: string;
  scheduled_game_id: string;
  draw_sequence: number;
  ball_value: number;
  drawn_at: Date | string;
  current_phase_at_draw: number | null;
}

interface PhaseWinnerRow {
  id: string;
  scheduled_game_id: string;
  assignment_id: string;
  winner_user_id: string;
  hall_id: string;
  phase: number;
  draw_sequence_at_win: number;
  prize_amount_cents: number;
  total_phase_prize_cents: number;
  winner_brett_count: number;
  ticket_color: string;
  wallet_transaction_id: string | null;
  loyalty_points_awarded: number | null;
  jackpot_amount_cents: number | null;
  created_at: Date | string;
}

interface MasterAuditRow {
  id: string;
  game_id: string;
  action: string;
  actor_user_id: string;
  actor_hall_id: string;
  group_hall_id: string;
  halls_ready_snapshot: unknown;
  metadata_json: unknown;
  created_at: Date | string;
}

interface ComplianceLedgerRow {
  id: string;
  created_at: Date | string;
  created_at_ms: number | string;
  hall_id: string;
  game_type: string;
  channel: string;
  event_type: string;
  amount: string | number;
  currency: string;
  game_id: string | null;
  claim_id: string | null;
  player_id: string | null;
  wallet_id: string | null;
}

interface ComplianceOutboxStatusRow {
  status: string;
  cnt: number | string;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toIsoOrThrow(value: Date | string | null | undefined): string {
  const iso = toIso(value);
  if (!iso) {
    throw new Error("Forventet timestamp men fikk null/undefined");
  }
  return iso;
}

function toIsoMs(value: Date | string | null | undefined): {
  iso: string;
  ms: number;
} | null {
  if (!value) return null;
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
  }
  return { iso: date.toISOString(), ms: date.getTime() };
}

function errorMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function parseJsonField<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

/**
 * Hent expected prize-cents fra catalog-entry for gitt fase + ticket-color.
 *
 * Returnerer null hvis catalog mangler, mode er ukjent eller priser ikke
 * kan beregnes. Kjernen som driver `payout_mismatch`-anomalien.
 */
function expectedPrizeCents(opts: {
  catalog: GameCatalogEntry | null;
  phase: number;
  ticketColor: string;
}): number | null {
  const { catalog, phase, ticketColor } = opts;
  if (!catalog) return null;
  // Map phase 1..5 til prizes-key.
  const prizes = catalog.prizesCents;
  if (!prizes) return null;
  // Phase 1..4 = rad1..rad4. Phase 5 = bingo (Fullt Hus).
  let basePrizeCents: number | undefined;
  if (phase === 1) basePrizeCents = prizes.rad1;
  else if (phase === 2) basePrizeCents = prizes.rad2;
  else if (phase === 3) basePrizeCents = prizes.rad3;
  else if (phase === 4) basePrizeCents = prizes.rad4;
  else if (phase === 5) {
    // Fullt Hus.
    if (catalog.prizeMultiplierMode === "explicit_per_color") {
      // Per-farge oppslag.
      const colorKey = ticketColor.toLowerCase() as TicketColor;
      basePrizeCents = prizes.bingo?.[colorKey];
      if (typeof basePrizeCents !== "number") return null;
      return basePrizeCents; // ingen multiplikator i explicit-mode.
    }
    basePrizeCents = prizes.bingoBase;
  }
  if (typeof basePrizeCents !== "number" || basePrizeCents < 0) return null;
  // Hent ticket-pris for fargen.
  const colorKey = ticketColor.toLowerCase() as TicketColor;
  const ticketPriceCents =
    catalog.ticketPricesCents?.[colorKey] ?? CHEAPEST_TICKET_PRICE_CENTS;
  return calculateActualPrize(catalog, basePrizeCents, ticketPriceCents);
}

function rowToCatalogEntry(row: CatalogRow): GameCatalogEntry {
  const rules =
    (parseJsonField<Record<string, unknown>>(row.rules) ?? {}) as Record<
      string,
      unknown
    >;
  const ticketColors =
    (parseJsonField<TicketColor[]>(row.ticket_colors) ?? []) as TicketColor[];
  const ticketPricesCents =
    (parseJsonField<Partial<Record<TicketColor, number>>>(
      row.ticket_prices_cents,
    ) ?? {}) as Partial<Record<TicketColor, number>>;
  const prizesCents = (parseJsonField<{
    rad1: number;
    rad2: number;
    rad3: number;
    rad4: number;
    bingoBase?: number;
    bingo: Partial<Record<TicketColor, number>>;
  }>(row.prizes_cents) ?? {
    rad1: 0,
    rad2: 0,
    rad3: 0,
    rad4: 0,
    bingo: {},
  });
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: null,
    rules,
    ticketColors,
    ticketPricesCents,
    prizesCents,
    prizeMultiplierMode: row.prize_multiplier_mode as PrizeMultiplierMode,
    bonusGameSlug: row.bonus_game_slug as GameCatalogEntry["bonusGameSlug"],
    bonusGameEnabled: row.bonus_game_enabled,
    requiresJackpotSetup: row.requires_jackpot_setup,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: "",
    updatedAt: "",
    createdByUserId: null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────────────────

export interface RoundReplayBuilderOptions {
  /** Override clock for tester. */
  now?: () => Date;
  /** Schema-navn. Default `public`. */
  schema?: string;
  /** Anomaly detector-callback. Default `detectRoundReplayAnomalies`. */
  detectAnomalies?: (replay: RoundReplay) => ReplayAnomaly[];
}

export class RoundReplayBuilder {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly now: () => Date;
  private readonly detectAnomalies: (replay: RoundReplay) => ReplayAnomaly[];

  constructor(pool: Pool, opts: RoundReplayBuilderOptions = {}) {
    this.pool = pool;
    this.schema = opts.schema ?? "public";
    if (!/^[a-z_][a-z0-9_]*$/.test(this.schema)) {
      throw new Error(`Invalid schema name: ${this.schema}`);
    }
    this.now = opts.now ?? (() => new Date());
    this.detectAnomalies =
      opts.detectAnomalies ?? ((replay: RoundReplay) => detectRoundReplayAnomalies(replay));
  }

  /**
   * Bygg komplett replay for gitt scheduledGameId.
   *
   * Kaster `Error("SCHEDULED_GAME_NOT_FOUND")` hvis raden ikke finnes —
   * caller (route) skal mappe til 404. Alle andre feil rapporteres i
   * `errors`-feltet og kjøringen fortsetter med best-effort-data.
   */
  async build(scheduledGameId: string): Promise<RoundReplay> {
    const generatedAt = this.now().toISOString();
    const errors: Record<string, string> = {};

    // 1. Hent scheduled-game-rad. Kaster NOT_FOUND hvis null.
    const scheduledGame = await this.fetchScheduledGame(scheduledGameId);
    if (!scheduledGame) {
      const err = new Error("SCHEDULED_GAME_NOT_FOUND");
      (err as Error & { code?: string }).code = "SCHEDULED_GAME_NOT_FOUND";
      throw err;
    }

    // 2-9. Parallell fetch av alt annet.
    const [
      planRun,
      catalogEntry,
      purchases,
      draws,
      winners,
      masterAudit,
      ledgerEntries,
      outboxStatus,
    ] = await Promise.all([
      this.safeFetch("planRun", () =>
        this.fetchPlanRun(scheduledGame.plan_run_id),
      ).then((res) => {
        if (res.error) errors.planRun = res.error;
        return res.data;
      }),
      this.safeFetch("catalog", () =>
        this.fetchCatalog(scheduledGame.catalog_entry_id),
      ).then((res) => {
        if (res.error) errors.catalog = res.error;
        return res.data;
      }),
      this.safeFetch("purchases", () => this.fetchPurchases(scheduledGameId)).then(
        (res) => {
          if (res.error) errors.purchases = res.error;
          return res.data ?? [];
        },
      ),
      this.safeFetch("draws", () => this.fetchDraws(scheduledGameId)).then((res) => {
        if (res.error) errors.draws = res.error;
        return res.data ?? [];
      }),
      this.safeFetch("winners", () => this.fetchWinners(scheduledGameId)).then(
        (res) => {
          if (res.error) errors.winners = res.error;
          return res.data ?? [];
        },
      ),
      this.safeFetch("masterAudit", () =>
        this.fetchMasterAudit(scheduledGameId),
      ).then((res) => {
        if (res.error) errors.masterAudit = res.error;
        return res.data ?? [];
      }),
      this.safeFetch("complianceLedger", () =>
        this.fetchComplianceLedger(scheduledGameId),
      ).then((res) => {
        if (res.error) errors.complianceLedger = res.error;
        return res.data ?? [];
      }),
      this.safeFetch("complianceOutbox", () =>
        this.fetchComplianceOutboxStatus(scheduledGameId),
      ).then((res) => {
        if (res.error) errors.complianceOutbox = res.error;
        return res.data ?? { pending: 0, processed: 0, dead_letter: 0 };
      }),
    ]);

    const metadata: ReplayMetadata = {
      scheduledGameId: scheduledGame.id,
      planRunId: scheduledGame.plan_run_id,
      planRunStatus: planRun?.status ?? null,
      hallId: scheduledGame.master_hall_id,
      catalogSlug: catalogEntry?.slug ?? null,
      catalogDisplayName: catalogEntry?.displayName ?? null,
      position: scheduledGame.plan_position,
      scheduledStartTime: toIso(scheduledGame.scheduled_start_time),
      scheduledEndTime: toIso(scheduledGame.scheduled_end_time),
      actualStartTime: toIso(scheduledGame.actual_start_time),
      actualEndTime: toIso(scheduledGame.actual_end_time),
      status: scheduledGame.status,
      totalDraws: draws.length,
      groupHallId: scheduledGame.group_hall_id,
      ticketConfig: parseJsonField(scheduledGame.ticket_config_json) ?? {},
      jackpotConfig: parseJsonField(scheduledGame.jackpot_config_json) ?? {},
    };

    const timeline = this.buildTimeline({
      scheduledGame,
      planRun,
      purchases,
      draws,
      winners,
      masterAudit,
      ledgerEntries,
    });

    const summary = this.buildSummary({
      purchases,
      draws,
      winners,
      ledgerEntries,
      outboxStatus,
      masterAudit,
      catalog: catalogEntry,
    });

    // Bygg en preliminær replay slik at detektor kan inspisere alt.
    const replay: RoundReplay = {
      scheduledGameId: scheduledGame.id,
      metadata,
      timeline,
      summary,
      anomalies: [],
      errors,
      generatedAt,
    };

    // Detektor får full replay (inkl. metadata + timeline) som input slik
    // at den kan korrelere events. Detektoren er stateless og kaster ikke.
    try {
      replay.anomalies = this.detectAnomalies(replay);
    } catch (err) {
      errors.anomalyDetector = errorMsg(err);
      replay.anomalies = [];
    }

    return replay;
  }

  private buildTimeline(input: {
    scheduledGame: ScheduledGameRow;
    planRun: PlanRunRow | null;
    purchases: TicketPurchaseRow[];
    draws: DrawRow[];
    winners: PhaseWinnerRow[];
    masterAudit: MasterAuditRow[];
    ledgerEntries: ComplianceLedgerRow[];
  }): ReplayTimelineEvent[] {
    const events: ReplayTimelineEvent[] = [];

    // scheduled_game_created event (created_at).
    {
      const ts = toIsoMs(input.scheduledGame.created_at);
      if (ts) {
        events.push({
          ts: ts.iso,
          tsMs: ts.ms,
          type: "scheduled_game_created",
          data: {
            scheduledGameId: input.scheduledGame.id,
            planRunId: input.scheduledGame.plan_run_id,
            catalogEntryId: input.scheduledGame.catalog_entry_id,
            position: input.scheduledGame.plan_position,
            status: input.scheduledGame.status,
          },
        });
      }
    }

    // ticket_purchase per purchase-rad.
    for (const p of input.purchases) {
      const ts = toIsoMs(p.purchased_at);
      if (!ts) continue;
      const totalCents =
        typeof p.total_amount_cents === "string"
          ? Number.parseInt(p.total_amount_cents, 10)
          : p.total_amount_cents;
      events.push({
        ts: ts.iso,
        tsMs: ts.ms,
        type: "ticket_purchase",
        data: {
          purchaseId: p.id,
          buyerUserId: p.buyer_user_id,
          hallId: p.hall_id,
          totalKr: Number.isFinite(totalCents) ? totalCents / 100 : null,
          totalCents,
          paymentMethod: p.payment_method,
          agentUserId: p.agent_user_id,
          ticketSpec: parseJsonField(p.ticket_spec_json),
          refundedAt: toIso(p.refunded_at),
          refundReason: p.refund_reason,
        },
      });
    }

    // master_action per audit-rad.
    for (const a of input.masterAudit) {
      const ts = toIsoMs(a.created_at);
      if (!ts) continue;
      events.push({
        ts: ts.iso,
        tsMs: ts.ms,
        type: "master_action",
        data: {
          auditId: a.id,
          action: a.action,
          actorUserId: a.actor_user_id,
          actorHallId: a.actor_hall_id,
          metadata: parseJsonField(a.metadata_json),
        },
      });
    }

    // draw per ball-trekk.
    for (const d of input.draws) {
      const ts = toIsoMs(d.drawn_at);
      if (!ts) continue;
      events.push({
        ts: ts.iso,
        tsMs: ts.ms,
        type: "draw",
        data: {
          drawIndex: d.draw_sequence,
          ball: d.ball_value,
          phase: d.current_phase_at_draw,
        },
      });
    }

    // phase_winner per vinner-rad.
    for (const w of input.winners) {
      const ts = toIsoMs(w.created_at);
      if (!ts) continue;
      events.push({
        ts: ts.iso,
        tsMs: ts.ms,
        type: "phase_winner",
        data: {
          winnerId: w.id,
          phase: w.phase,
          ticketColor: w.ticket_color,
          prizeKr: w.prize_amount_cents / 100,
          prizeCents: w.prize_amount_cents,
          totalPhasePrizeCents: w.total_phase_prize_cents,
          winnerBrettCount: w.winner_brett_count,
          drawSequenceAtWin: w.draw_sequence_at_win,
          winnerUserId: w.winner_user_id,
          hallId: w.hall_id,
          walletTransactionId: w.wallet_transaction_id,
          jackpotAmountCents: w.jackpot_amount_cents,
        },
      });
    }

    // compliance_ledger per §71-event.
    for (const l of input.ledgerEntries) {
      const ts = toIsoMs(l.created_at);
      if (!ts) continue;
      events.push({
        ts: ts.iso,
        tsMs: ts.ms,
        type: "compliance_ledger",
        data: {
          ledgerId: l.id,
          eventType: l.event_type,
          amount: typeof l.amount === "string" ? Number(l.amount) : l.amount,
          currency: l.currency,
          gameType: l.game_type,
          channel: l.channel,
          hallId: l.hall_id,
          playerId: l.player_id,
          walletId: l.wallet_id,
          claimId: l.claim_id,
        },
      });
    }

    // scheduled_game_completed (actual_end_time hvis satt).
    {
      const endTs = toIsoMs(input.scheduledGame.actual_end_time);
      if (endTs) {
        events.push({
          ts: endTs.iso,
          tsMs: endTs.ms,
          type: "scheduled_game_completed",
          data: {
            scheduledGameId: input.scheduledGame.id,
            status: input.scheduledGame.status,
            stopReason: input.scheduledGame.stop_reason,
            stoppedByUserId: input.scheduledGame.stopped_by_user_id,
            planRunStatusAtEnd: input.planRun?.status ?? null,
          },
        });
      }
    }

    // Sort kronologisk. Stable sort på tsMs, så identiske timestamps
    // beholder insertion-order (som er typen-prioritet i vår enumeration).
    events.sort((a, b) => a.tsMs - b.tsMs);
    return events;
  }

  private buildSummary(input: {
    purchases: TicketPurchaseRow[];
    draws: DrawRow[];
    winners: PhaseWinnerRow[];
    ledgerEntries: ComplianceLedgerRow[];
    outboxStatus: { pending: number; processed: number; dead_letter: number };
    masterAudit: MasterAuditRow[];
    catalog: GameCatalogEntry | null;
  }): ReplaySummary {
    // Purchases.
    const byColorSize: Record<string, number> = {};
    let refundedCount = 0;
    let totalCents = 0;
    for (const p of input.purchases) {
      const amount =
        typeof p.total_amount_cents === "string"
          ? Number.parseInt(p.total_amount_cents, 10)
          : p.total_amount_cents;
      if (Number.isFinite(amount)) totalCents += amount;
      if (p.refunded_at) refundedCount += 1;
      const spec = parseJsonField<
        Array<{ color: string; size: string; count: number }>
      >(p.ticket_spec_json);
      if (Array.isArray(spec)) {
        for (const item of spec) {
          if (!item || typeof item !== "object") continue;
          const key = `${item.color}:${item.size}`;
          const cnt =
            typeof item.count === "number" && Number.isFinite(item.count)
              ? item.count
              : 0;
          byColorSize[key] = (byColorSize[key] ?? 0) + cnt;
        }
      }
    }

    // Draws.
    const uniqueBalls = new Set<number>();
    let firstDrawAt: { iso: string; ms: number } | null = null;
    let lastDrawAt: { iso: string; ms: number } | null = null;
    for (const d of input.draws) {
      uniqueBalls.add(d.ball_value);
      const ts = toIsoMs(d.drawn_at);
      if (!ts) continue;
      if (firstDrawAt === null || ts.ms < firstDrawAt.ms) firstDrawAt = ts;
      if (lastDrawAt === null || ts.ms > lastDrawAt.ms) lastDrawAt = ts;
    }

    // Winners — med expected-prize-sammenligning.
    const winners = input.winners.map((w) => {
      const expectedCents = expectedPrizeCents({
        catalog: input.catalog,
        phase: w.phase,
        ticketColor: w.ticket_color,
      });
      // Pot-deling: hvis flere vinnere i samme fase med samme color/size,
      // skal det totale pot deles flat med floor-rounding. Vi sammenligner
      // mot per-brett-andel som er forventet.
      const expectedShareCents =
        expectedCents !== null && w.winner_brett_count > 0
          ? Math.floor(expectedCents / w.winner_brett_count)
          : expectedCents;
      const match =
        expectedShareCents !== null ? w.prize_amount_cents === expectedShareCents : true;
      return {
        phase: w.phase,
        ticketColor: w.ticket_color,
        prizeKr: w.prize_amount_cents / 100,
        prizeCents: w.prize_amount_cents,
        expectedCents: expectedShareCents,
        expectedKr:
          expectedShareCents !== null ? expectedShareCents / 100 : null,
        match,
        winnerBrettCount: w.winner_brett_count,
        drawSequenceAtWin: w.draw_sequence_at_win,
        winnerUserId: w.winner_user_id,
      };
    });

    return {
      purchases: {
        totalCount: input.purchases.length,
        totalCents,
        refundedCount,
        byColorSize,
      },
      draws: {
        total: input.draws.length,
        uniqueBalls: uniqueBalls.size,
        firstDrawAt: firstDrawAt?.iso ?? null,
        lastDrawAt: lastDrawAt?.iso ?? null,
      },
      winners,
      compliance: {
        ledgerEntries: input.ledgerEntries.length,
        outboxPending: input.outboxStatus.pending,
        outboxProcessed: input.outboxStatus.processed,
        outboxDeadLetter: input.outboxStatus.dead_letter,
        auditEvents: input.masterAudit.length,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // DB queries (fail-soft wrappers)
  // ────────────────────────────────────────────────────────────────────

  private async safeFetch<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<{ data: T | null; error: string | null }> {
    try {
      const data = await fn();
      return { data, error: null };
    } catch (err) {
      return { data: null, error: `${label}: ${errorMsg(err)}` };
    }
  }

  private async fetchScheduledGame(
    scheduledGameId: string,
  ): Promise<ScheduledGameRow | null> {
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT * FROM "${this.schema}"."app_game1_scheduled_games"
        WHERE id = $1
        LIMIT 1`,
      [scheduledGameId],
    );
    return rows[0] ?? null;
  }

  private async fetchPlanRun(
    planRunId: string | null,
  ): Promise<PlanRunRow | null> {
    if (!planRunId) return null;
    const { rows } = await this.pool.query<PlanRunRow>(
      `SELECT * FROM "${this.schema}"."app_game_plan_run"
        WHERE id = $1
        LIMIT 1`,
      [planRunId],
    );
    return rows[0] ?? null;
  }

  private async fetchCatalog(
    catalogEntryId: string | null,
  ): Promise<GameCatalogEntry | null> {
    if (!catalogEntryId) return null;
    const { rows } = await this.pool.query<CatalogRow>(
      `SELECT id, slug, display_name, rules, ticket_colors,
              ticket_prices_cents, prizes_cents, prize_multiplier_mode,
              bonus_game_slug, bonus_game_enabled, requires_jackpot_setup,
              is_active, sort_order
         FROM "${this.schema}"."app_game_catalog"
        WHERE id = $1
        LIMIT 1`,
      [catalogEntryId],
    );
    const row = rows[0];
    if (!row) return null;
    return rowToCatalogEntry(row);
  }

  private async fetchPurchases(
    scheduledGameId: string,
  ): Promise<TicketPurchaseRow[]> {
    const { rows } = await this.pool.query<TicketPurchaseRow>(
      `SELECT id, scheduled_game_id, buyer_user_id, hall_id,
              ticket_spec_json, total_amount_cents, payment_method,
              agent_user_id, purchased_at, refunded_at, refund_reason
         FROM "${this.schema}"."app_game1_ticket_purchases"
        WHERE scheduled_game_id = $1
        ORDER BY purchased_at ASC`,
      [scheduledGameId],
    );
    return rows;
  }

  private async fetchDraws(scheduledGameId: string): Promise<DrawRow[]> {
    const { rows } = await this.pool.query<DrawRow>(
      `SELECT id, scheduled_game_id, draw_sequence, ball_value,
              drawn_at, current_phase_at_draw
         FROM "${this.schema}"."app_game1_draws"
        WHERE scheduled_game_id = $1
        ORDER BY draw_sequence ASC`,
      [scheduledGameId],
    );
    return rows;
  }

  private async fetchWinners(scheduledGameId: string): Promise<PhaseWinnerRow[]> {
    const { rows } = await this.pool.query<PhaseWinnerRow>(
      `SELECT id, scheduled_game_id, assignment_id, winner_user_id,
              hall_id, phase, draw_sequence_at_win, prize_amount_cents,
              total_phase_prize_cents, winner_brett_count, ticket_color,
              wallet_transaction_id, loyalty_points_awarded,
              jackpot_amount_cents, created_at
         FROM "${this.schema}"."app_game1_phase_winners"
        WHERE scheduled_game_id = $1
        ORDER BY created_at ASC, phase ASC`,
      [scheduledGameId],
    );
    return rows;
  }

  private async fetchMasterAudit(
    scheduledGameId: string,
  ): Promise<MasterAuditRow[]> {
    const { rows } = await this.pool.query<MasterAuditRow>(
      `SELECT id, game_id, action, actor_user_id, actor_hall_id,
              group_hall_id, halls_ready_snapshot, metadata_json,
              created_at
         FROM "${this.schema}"."app_game1_master_audit"
        WHERE game_id = $1
        ORDER BY created_at ASC`,
      [scheduledGameId],
    );
    return rows;
  }

  private async fetchComplianceLedger(
    scheduledGameId: string,
  ): Promise<ComplianceLedgerRow[]> {
    const { rows } = await this.pool.query<ComplianceLedgerRow>(
      `SELECT id, created_at, created_at_ms, hall_id, game_type, channel,
              event_type, amount, currency, game_id, claim_id, player_id,
              wallet_id
         FROM "${this.schema}"."app_rg_compliance_ledger"
        WHERE game_id = $1
        ORDER BY created_at_ms ASC`,
      [scheduledGameId],
    );
    return rows;
  }

  private async fetchComplianceOutboxStatus(
    scheduledGameId: string,
  ): Promise<{ pending: number; processed: number; dead_letter: number }> {
    // Outbox-rader har ikke game_id som kolonne — vi joiner via JSONB
    // payload->>'gameId'. Det er en sjeldnere query (kun debug) så vi
    // tolererer index-mangelen.
    const { rows } = await this.pool.query<ComplianceOutboxStatusRow>(
      `SELECT status, COUNT(*)::int AS cnt
         FROM "${this.schema}"."app_compliance_outbox"
        WHERE payload->>'gameId' = $1
        GROUP BY status`,
      [scheduledGameId],
    );
    const out = { pending: 0, processed: 0, dead_letter: 0 };
    for (const r of rows) {
      const cnt = typeof r.cnt === "string" ? Number.parseInt(r.cnt, 10) : r.cnt;
      if (r.status === "pending") out.pending = cnt;
      else if (r.status === "processed") out.processed = cnt;
      else if (r.status === "dead_letter") out.dead_letter = cnt;
    }
    return out;
  }
}
