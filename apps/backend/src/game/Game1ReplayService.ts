/**
 * LOW-1: Game 1 replay-service.
 *
 * Formål: rekonstruere en fullstendig, ordnet event-strøm for et avsluttet
 * Game 1 scheduled_game slik at en auditor (eller intern compliance-team)
 * kan svare på spørsmål som "hvorfor tapte spiller X?" eller "hvilken kule
 * utløste fasen?". Audit-tabellene finnes allerede (`app_game1_master_audit`,
 * `app_game1_draws`, `app_game1_phase_winners`, `app_game1_ticket_purchases`,
 * `app_game1_ticket_assignments`, `app_game1_mini_game_results`,
 * `wallet_transactions`), men de er fragmenterte og krever join-arbeid for
 * å bygge en tidslinje. Denne servicen gjør det join-arbeidet ett sted og
 * eksponerer en felles event-shape via {@link Game1ReplayService.getReplay}.
 *
 * PII-redaction:
 * - E-post er masket på lokal-del → `f***@domene.no`.
 * - Display-name er masket → `Fornavn E***` (første bokstav i etternavn).
 * - WalletId er masket → `wal_***xyz9` (siste 4 tegn).
 * - userId/walletId/assignmentId er IKKE masket (regulatorisk: nødvendig for
 *   reproduserbar bevisførsel — auditor må kunne korrelere mot ledger).
 *
 * RBAC: GAME1_GAME_READ + PLAYER_KYC_READ håndheves i route-laget
 * ({@link createAdminGameReplayRouter}).
 *
 * Wallet-mapping:
 * - Hver purchase-rad har `idempotency_key` som matcher
 *   `wallet_transactions.idempotency_key` for digital-wallet kjøp. Vi joiner
 *   på den nøkkelen så hvert "tickets_purchased"-event kan peke til
 *   wallet-tx-IDen som debiterte spilleren.
 * - Phase-winner-radene har `wallet_transaction_id` direkte, så payout-events
 *   kan slå opp credit-transaksjonen.
 *
 * Forward-only: tabellene er append-only (RESTRICT FK), så replay-resultatet
 * er stabilt og reproduserbart. Hvis en rad mangler (f.eks. spillet ble
 * cancelled før draws), returnerer servicen tom array for den event-typen.
 */

import type { Pool } from "pg";

/**
 * Felles event-shape. Hver event har en stabil `type`-discriminator,
 * `timestamp` (ISO-8601), `actor` (hvem utløste eventen — userId, role,
 * eller "system" for scheduler-tick / draw-engine), og en redacted `data`
 * payload. Klienter typer på `type` for å render forskjellige views.
 */
export type Game1ReplayEventType =
  | "room_created"
  | "player_joined"
  | "tickets_purchased"
  | "game_started"
  | "draw"
  | "phase_won"
  | "mini_game_triggered"
  | "mini_game_completed"
  | "payout"
  | "game_paused"
  | "game_resumed"
  | "game_stopped"
  | "hall_excluded"
  | "hall_included"
  | "game_ended";

export interface Game1ReplayActor {
  /** "user" = navngitt actor, "system" = scheduler/draw-engine. */
  kind: "user" | "system";
  /** UserId hvis kind=user, ellers null. Aldri redacted (regulatorisk). */
  userId: string | null;
  /** Rolle ved event-tidspunkt (best-effort fra audit-rad). */
  role: string | null;
  /** Hall actor jobbet fra (master-actions). Null for spiller-events. */
  hallId: string | null;
}

export interface Game1ReplayEvent {
  /** Stabil sortable index (ms-timestamp + sub-sequence for stabilitet). */
  sequence: number;
  type: Game1ReplayEventType;
  /** ISO-8601 UTC. */
  timestamp: string;
  actor: Game1ReplayActor;
  /** Event-spesifikk payload. PII redacted før returnering. */
  data: Record<string, unknown>;
}

export interface Game1ReplayMeta {
  scheduledGameId: string;
  status: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  actualStartTime: string | null;
  actualEndTime: string | null;
  masterHallId: string;
  groupHallId: string;
  participatingHallIds: string[];
  excludedHallIds: string[];
  subGameName: string;
  customGameName: string | null;
  startedByUserId: string | null;
  stoppedByUserId: string | null;
  stopReason: string | null;
  /** Antall events i strømmen (etter PII-redaction). */
  eventCount: number;
  /** Genererings-tidspunkt (ISO-8601). */
  generatedAt: string;
}

export interface Game1ReplayResult {
  meta: Game1ReplayMeta;
  events: Game1ReplayEvent[];
}

/**
 * Mask en e-postadresse til `f***@domene.no`.
 * Bevarer domenet for kontekst, men skjuler lokal-delen utover første tegn.
 */
export function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 1) return `***@${domain}`;
  return `${local.charAt(0)}***@${domain}`;
}

/**
 * Mask et display-name til `Fornavn E***`.
 * Bevarer fornavnet (typisk ikke unikt), masker etternavnet utover initial.
 */
export function redactDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    const p = parts[0]!;
    if (p.length <= 1) return "***";
    return `${p.charAt(0)}***`;
  }
  const first = parts[0]!;
  const lastInitial = parts[parts.length - 1]!.charAt(0);
  return `${first} ${lastInitial}***`;
}

/**
 * Mask en walletId til `wal_***xyz9` — beholder siste 4 tegn for korrelering.
 * WalletId er ikke direkte PII, men maskes likevel som defense-in-depth.
 */
export function redactWalletId(walletId: string | null | undefined): string | null {
  if (!walletId) return null;
  if (walletId.length <= 4) return "***";
  return `wal_***${walletId.slice(-4)}`;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  actual_start_time: string | null;
  actual_end_time: string | null;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  excluded_hall_ids_json: unknown;
  sub_game_name: string;
  custom_game_name: string | null;
  started_by_user_id: string | null;
  stopped_by_user_id: string | null;
  stop_reason: string | null;
  created_at: string;
}

interface MasterAuditRow {
  id: string;
  action: string;
  actor_user_id: string;
  actor_hall_id: string;
  metadata_json: unknown;
  halls_ready_snapshot: unknown;
  created_at: string;
}

interface PurchaseRow {
  id: string;
  buyer_user_id: string;
  buyer_email: string | null;
  buyer_display_name: string | null;
  buyer_wallet_id: string | null;
  hall_id: string;
  ticket_spec_json: unknown;
  total_amount_cents: string | number;
  payment_method: string;
  agent_user_id: string | null;
  idempotency_key: string;
  purchased_at: string;
  refunded_at: string | null;
  refund_reason: string | null;
  refund_transaction_id: string | null;
  wallet_transaction_id: string | null;
}

interface DrawRow {
  id: string;
  draw_sequence: number;
  ball_value: number;
  current_phase_at_draw: number | null;
  drawn_at: string;
}

interface PhaseWinnerRow {
  id: string;
  assignment_id: string;
  winner_user_id: string;
  winner_email: string | null;
  winner_display_name: string | null;
  winner_wallet_id: string | null;
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
  created_at: string;
}

interface MiniGameRow {
  id: string;
  mini_game_type: string;
  winner_user_id: string;
  winner_email: string | null;
  winner_display_name: string | null;
  config_snapshot_json: unknown;
  choice_json: unknown;
  result_json: unknown;
  payout_cents: number;
  triggered_at: string;
  completed_at: string | null;
}

export class Game1ReplayService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(opts: { pool: Pool; schema?: string }) {
    this.pool = opts.pool;
    this.schema = opts.schema ?? "public";
  }

  /**
   * Hovedinngang: bygg ordnet event-strøm for et scheduled_game.
   *
   * Throws `GAME_NOT_FOUND` hvis spillet ikke eksisterer. Caller-laget
   * (route) konverterer til 404.
   */
  async getReplay(scheduledGameId: string): Promise<Game1ReplayResult> {
    const game = await this.loadGame(scheduledGameId);
    if (!game) {
      const err = new Error(`Game not found: ${scheduledGameId}`);
      (err as Error & { code?: string }).code = "GAME_NOT_FOUND";
      throw err;
    }

    const [audit, purchases, draws, winners, miniGames] = await Promise.all([
      this.loadAudit(scheduledGameId),
      this.loadPurchases(scheduledGameId),
      this.loadDraws(scheduledGameId),
      this.loadPhaseWinners(scheduledGameId),
      this.loadMiniGames(scheduledGameId),
    ]);

    const events: Game1ReplayEvent[] = [];

    // 1. room_created — synthetic event basert på scheduled_games.created_at
    //    (bruker scheduled_start_time som proxy hvis created_at mangler).
    events.push({
      sequence: this.toSeq(game.created_at, 0),
      type: "room_created",
      timestamp: this.toIso(game.created_at),
      actor: { kind: "system", userId: null, role: null, hallId: null },
      data: {
        scheduledGameId: game.id,
        masterHallId: game.master_hall_id,
        groupHallId: game.group_hall_id,
        participatingHallIds: this.parseStringArray(game.participating_halls_json),
        subGameName: game.sub_game_name,
        customGameName: game.custom_game_name,
        scheduledStartTime: this.toIso(game.scheduled_start_time),
        scheduledEndTime: this.toIso(game.scheduled_end_time),
      },
    });

    // 2. player_joined / tickets_purchased — én "tickets_purchased" per
    //    purchase-rad. Et "player_joined"-event genereres for første kjøp
    //    per spiller. Player-joins er ikke separat audited i schema, så vi
    //    deriver fra purchases (det er den eneste pålitelige join-signaturen).
    const seenPlayers = new Set<string>();
    for (const p of purchases) {
      if (!seenPlayers.has(p.buyer_user_id)) {
        seenPlayers.add(p.buyer_user_id);
        events.push({
          sequence: this.toSeq(p.purchased_at, 1),
          type: "player_joined",
          timestamp: this.toIso(p.purchased_at),
          actor: {
            kind: "user",
            userId: p.buyer_user_id,
            role: "PLAYER",
            hallId: p.hall_id,
          },
          data: {
            userId: p.buyer_user_id,
            email: redactEmail(p.buyer_email),
            displayName: redactDisplayName(p.buyer_display_name),
            walletIdMasked: redactWalletId(p.buyer_wallet_id),
            hallId: p.hall_id,
          },
        });
      }
      events.push({
        sequence: this.toSeq(p.purchased_at, 2),
        type: "tickets_purchased",
        timestamp: this.toIso(p.purchased_at),
        actor: {
          kind: "user",
          userId: p.buyer_user_id,
          role: "PLAYER",
          hallId: p.hall_id,
        },
        data: {
          purchaseId: p.id,
          userId: p.buyer_user_id,
          email: redactEmail(p.buyer_email),
          displayName: redactDisplayName(p.buyer_display_name),
          hallId: p.hall_id,
          ticketSpec: this.parseJson(p.ticket_spec_json),
          totalAmountCents: Number(p.total_amount_cents),
          paymentMethod: p.payment_method,
          agentUserId: p.agent_user_id,
          idempotencyKey: p.idempotency_key,
          walletTransactionId: p.wallet_transaction_id,
          refunded: p.refunded_at !== null,
          refundedAt: p.refunded_at ? this.toIso(p.refunded_at) : null,
          refundReason: p.refund_reason,
          refundTransactionId: p.refund_transaction_id,
        },
      });
    }

    // 3. master-audit-events: start/pause/resume/stop/exclude_hall/include_hall.
    //    Mappes til typed events for klient-rendering.
    for (const a of audit) {
      const type = this.mapAuditAction(a.action);
      if (!type) continue;
      events.push({
        sequence: this.toSeq(a.created_at, 3),
        type,
        timestamp: this.toIso(a.created_at),
        actor: {
          kind: a.actor_user_id === "SYSTEM" ? "system" : "user",
          userId: a.actor_user_id === "SYSTEM" ? null : a.actor_user_id,
          role: null, // role er ikke persistert i master_audit; klient kan slå opp
          hallId: a.actor_hall_id,
        },
        data: {
          auditId: a.id,
          action: a.action,
          metadata: this.parseJson(a.metadata_json),
          hallsReadySnapshot: this.parseJson(a.halls_ready_snapshot),
        },
      });
    }

    // 4. draws — én event per kule trukket.
    for (const d of draws) {
      events.push({
        sequence: this.toSeq(d.drawn_at, 4),
        type: "draw",
        timestamp: this.toIso(d.drawn_at),
        actor: { kind: "system", userId: null, role: null, hallId: null },
        data: {
          drawId: d.id,
          sequence: d.draw_sequence,
          ballValue: d.ball_value,
          currentPhaseAtDraw: d.current_phase_at_draw,
        },
      });
    }

    // 5. phase_won + payout — én pair per vinner. Phase-won er audit-eventet,
    //    payout er den knyttede wallet-credit-tx-IDen (hvis ikke null).
    for (const w of winners) {
      events.push({
        sequence: this.toSeq(w.created_at, 5),
        type: "phase_won",
        timestamp: this.toIso(w.created_at),
        actor: {
          kind: "user",
          userId: w.winner_user_id,
          role: "PLAYER",
          hallId: w.hall_id,
        },
        data: {
          winnerId: w.id,
          assignmentId: w.assignment_id,
          winnerUserId: w.winner_user_id,
          winnerEmail: redactEmail(w.winner_email),
          winnerDisplayName: redactDisplayName(w.winner_display_name),
          winnerWalletIdMasked: redactWalletId(w.winner_wallet_id),
          hallId: w.hall_id,
          phase: w.phase,
          phaseLabel: this.phaseLabel(w.phase),
          drawSequenceAtWin: w.draw_sequence_at_win,
          ticketColor: w.ticket_color,
          totalPhasePrizeCents: w.total_phase_prize_cents,
          winnerBrettCount: w.winner_brett_count,
          jackpotAmountCents: w.jackpot_amount_cents,
        },
      });
      // Payout-event: én per vinner-rad med payout > 0 ELLER hvis tx-id finnes.
      if (w.prize_amount_cents > 0 || w.wallet_transaction_id) {
        events.push({
          sequence: this.toSeq(w.created_at, 6),
          type: "payout",
          timestamp: this.toIso(w.created_at),
          actor: { kind: "system", userId: null, role: null, hallId: null },
          data: {
            winnerId: w.id,
            winnerUserId: w.winner_user_id,
            assignmentId: w.assignment_id,
            phase: w.phase,
            prizeAmountCents: w.prize_amount_cents,
            walletTransactionId: w.wallet_transaction_id,
            loyaltyPointsAwarded: w.loyalty_points_awarded,
          },
        });
      }
    }

    // 6. mini_game_triggered + mini_game_completed.
    for (const m of miniGames) {
      events.push({
        sequence: this.toSeq(m.triggered_at, 7),
        type: "mini_game_triggered",
        timestamp: this.toIso(m.triggered_at),
        actor: {
          kind: "user",
          userId: m.winner_user_id,
          role: "PLAYER",
          hallId: null,
        },
        data: {
          miniGameId: m.id,
          miniGameType: m.mini_game_type,
          winnerUserId: m.winner_user_id,
          winnerEmail: redactEmail(m.winner_email),
          winnerDisplayName: redactDisplayName(m.winner_display_name),
          configSnapshot: this.parseJson(m.config_snapshot_json),
        },
      });
      if (m.completed_at) {
        events.push({
          sequence: this.toSeq(m.completed_at, 8),
          type: "mini_game_completed",
          timestamp: this.toIso(m.completed_at),
          actor: {
            kind: "user",
            userId: m.winner_user_id,
            role: "PLAYER",
            hallId: null,
          },
          data: {
            miniGameId: m.id,
            miniGameType: m.mini_game_type,
            winnerUserId: m.winner_user_id,
            choice: this.parseJson(m.choice_json),
            result: this.parseJson(m.result_json),
            payoutCents: m.payout_cents,
          },
        });
      }
    }

    // 7. game_ended — synthetic event hvis actual_end_time er satt.
    if (game.actual_end_time) {
      events.push({
        sequence: this.toSeq(game.actual_end_time, 9),
        type: "game_ended",
        timestamp: this.toIso(game.actual_end_time),
        actor: {
          kind: game.stopped_by_user_id ? "user" : "system",
          userId: game.stopped_by_user_id,
          role: null,
          hallId: null,
        },
        data: {
          status: game.status,
          stopReason: game.stop_reason,
        },
      });
    }

    // Sorter stabilt på (sequence ASC). Sub-sequence-felter sikrer at
    // events med samme tidspunkt bevarer logisk rekkefølge (purchase før
    // join før draw osv.).
    events.sort((a, b) => a.sequence - b.sequence);

    const meta: Game1ReplayMeta = {
      scheduledGameId: game.id,
      status: game.status,
      scheduledStartTime: this.toIso(game.scheduled_start_time),
      scheduledEndTime: this.toIso(game.scheduled_end_time),
      actualStartTime: game.actual_start_time ? this.toIso(game.actual_start_time) : null,
      actualEndTime: game.actual_end_time ? this.toIso(game.actual_end_time) : null,
      masterHallId: game.master_hall_id,
      groupHallId: game.group_hall_id,
      participatingHallIds: this.parseStringArray(game.participating_halls_json),
      excludedHallIds: this.parseStringArray(game.excluded_hall_ids_json),
      subGameName: game.sub_game_name,
      customGameName: game.custom_game_name,
      startedByUserId: game.started_by_user_id,
      stoppedByUserId: game.stopped_by_user_id,
      stopReason: game.stop_reason,
      eventCount: events.length,
      generatedAt: new Date().toISOString(),
    };

    return { meta, events };
  }

  // ── Loaders ────────────────────────────────────────────────────────────

  private async loadGame(id: string): Promise<ScheduledGameRow | null> {
    const sql = `
      SELECT
        id, status, scheduled_start_time, scheduled_end_time,
        actual_start_time, actual_end_time,
        master_hall_id, group_hall_id,
        participating_halls_json, excluded_hall_ids_json,
        sub_game_name, custom_game_name,
        started_by_user_id, stopped_by_user_id, stop_reason,
        created_at
      FROM "${this.schema}"."app_game1_scheduled_games"
      WHERE id = $1
      LIMIT 1`;
    const result = await this.pool.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return result.rows[0] as ScheduledGameRow;
  }

  private async loadAudit(scheduledGameId: string): Promise<MasterAuditRow[]> {
    const sql = `
      SELECT id, action, actor_user_id, actor_hall_id,
             metadata_json, halls_ready_snapshot, created_at
      FROM "${this.schema}"."app_game1_master_audit"
      WHERE game_id = $1
      ORDER BY created_at ASC, id ASC`;
    const result = await this.pool.query(sql, [scheduledGameId]);
    return result.rows as MasterAuditRow[];
  }

  private async loadPurchases(scheduledGameId: string): Promise<PurchaseRow[]> {
    // Join purchase → users for redacted display info, og →
    // wallet_transactions for å koble idempotency_key til wallet-tx-ID.
    const sql = `
      SELECT
        p.id, p.buyer_user_id,
        u.email AS buyer_email,
        u.display_name AS buyer_display_name,
        u.wallet_id AS buyer_wallet_id,
        p.hall_id, p.ticket_spec_json,
        p.total_amount_cents, p.payment_method,
        p.agent_user_id, p.idempotency_key, p.purchased_at,
        p.refunded_at, p.refund_reason, p.refund_transaction_id,
        wt.id AS wallet_transaction_id
      FROM "${this.schema}"."app_game1_ticket_purchases" p
      LEFT JOIN "${this.schema}"."app_users" u
        ON u.id = p.buyer_user_id
      LEFT JOIN "${this.schema}"."wallet_transactions" wt
        ON wt.idempotency_key = p.idempotency_key
      WHERE p.scheduled_game_id = $1
      ORDER BY p.purchased_at ASC, p.id ASC`;
    const result = await this.pool.query(sql, [scheduledGameId]);
    return result.rows as PurchaseRow[];
  }

  private async loadDraws(scheduledGameId: string): Promise<DrawRow[]> {
    const sql = `
      SELECT id, draw_sequence, ball_value, current_phase_at_draw, drawn_at
      FROM "${this.schema}"."app_game1_draws"
      WHERE scheduled_game_id = $1
      ORDER BY draw_sequence ASC`;
    const result = await this.pool.query(sql, [scheduledGameId]);
    return result.rows as DrawRow[];
  }

  private async loadPhaseWinners(scheduledGameId: string): Promise<PhaseWinnerRow[]> {
    const sql = `
      SELECT
        w.id, w.assignment_id, w.winner_user_id,
        u.email AS winner_email,
        u.display_name AS winner_display_name,
        u.wallet_id AS winner_wallet_id,
        w.hall_id, w.phase, w.draw_sequence_at_win,
        w.prize_amount_cents, w.total_phase_prize_cents,
        w.winner_brett_count, w.ticket_color,
        w.wallet_transaction_id, w.loyalty_points_awarded,
        w.jackpot_amount_cents, w.created_at
      FROM "${this.schema}"."app_game1_phase_winners" w
      LEFT JOIN "${this.schema}"."app_users" u
        ON u.id = w.winner_user_id
      WHERE w.scheduled_game_id = $1
      ORDER BY w.created_at ASC, w.id ASC`;
    const result = await this.pool.query(sql, [scheduledGameId]);
    return result.rows as PhaseWinnerRow[];
  }

  private async loadMiniGames(scheduledGameId: string): Promise<MiniGameRow[]> {
    const sql = `
      SELECT
        m.id, m.mini_game_type, m.winner_user_id,
        u.email AS winner_email,
        u.display_name AS winner_display_name,
        m.config_snapshot_json, m.choice_json, m.result_json,
        m.payout_cents, m.triggered_at, m.completed_at
      FROM "${this.schema}"."app_game1_mini_game_results" m
      LEFT JOIN "${this.schema}"."app_users" u
        ON u.id = m.winner_user_id
      WHERE m.scheduled_game_id = $1
      ORDER BY m.triggered_at ASC, m.id ASC`;
    const result = await this.pool.query(sql, [scheduledGameId]);
    return result.rows as MiniGameRow[];
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Bygg sortbar sequence-key fra timestamp + sub-sequence (0..9).
   *
   * Sub-sequence sikrer stabil rekkefølge når flere events deler ms-stempel:
   *   0 = room_created
   *   1 = player_joined
   *   2 = tickets_purchased
   *   3 = master_audit (start/pause/resume/stop/exclude/include)
   *   4 = draw
   *   5 = phase_won
   *   6 = payout
   *   7 = mini_game_triggered
   *   8 = mini_game_completed
   *   9 = game_ended
   */
  private toSeq(timestamp: string | Date, subSeq: number): number {
    const ts = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
    return ts * 100 + subSeq;
  }

  private toIso(timestamp: string | Date): string {
    if (timestamp instanceof Date) return timestamp.toISOString();
    return new Date(timestamp).toISOString();
  }

  private parseJson(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return value;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  private parseStringArray(value: unknown): string[] {
    const parsed = this.parseJson(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
    return [];
  }

  private mapAuditAction(action: string): Game1ReplayEventType | null {
    switch (action) {
      case "start":
        return "game_started";
      case "pause":
        return "game_paused";
      case "resume":
        return "game_resumed";
      case "stop":
        return "game_stopped";
      case "exclude_hall":
        return "hall_excluded";
      case "include_hall":
        return "hall_included";
      case "timeout_detected":
        return "game_stopped";
      default:
        return null;
    }
  }

  private phaseLabel(phase: number): string {
    switch (phase) {
      case 1:
        return "1 Rad";
      case 2:
        return "2 Rader";
      case 3:
        return "3 Rader";
      case 4:
        return "4 Rader";
      case 5:
        return "Fullt Hus";
      default:
        return `Fase ${phase}`;
    }
  }
}
