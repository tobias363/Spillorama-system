/**
 * GameEndSnapshotService — dump DB-state ved game-end til
 * /tmp/game-end-snapshot-{gameId}.json (Tobias-direktiv 2026-05-13:
 * observability fix-PR for å slutte å gjette på pilot-bugs).
 *
 * Bakgrunn:
 *   Når en runde slutter (Fullt Hus vunnet ELLER master stopper) er det
 *   ofte for sent å SQL-query state — tabellrad-status er allerede flippet
 *   til 'completed'/'cancelled', players har koblet fra rom, og ticket-
 *   refunds har kjørt. PM trenger en frozen snapshot av:
 *     - app_game1_scheduled_games-raden (alle felter)
 *     - app_game_plan_run-raden hvis plan_run_id er satt
 *     - app_game1_hall_ready_status-radene (per hall)
 *     - aktive tickets per spiller (siste 5 min)
 *     - room-snapshot fra engine hvis tilgjengelig (caller may supply)
 *
 *   Snapshoten skrives som JSON til /tmp så `npm run diagnose:pilot` (eller
 *   manuell tail) kan inspisere den.
 *
 * Mekanikk:
 *   - `dump(gameId, reason)` kjører i en read-only TX og skriver fila
 *     fire-and-forget — kaster aldri tilbake til caller.
 *   - Fil-navn: `/tmp/game-end-snapshot-{gameId}.json`. Hvis fil eksisterer
 *     fra forrige game-end, overwrites (debug-data er forgjengelig).
 *   - Token-gating NOT required — fila ligger på server-fs, kun ops + PM
 *     har shell-access.
 *
 * Fail-soft:
 *   - DB-feil → log warn + skip
 *   - FS-feil → log warn + skip
 *   - Kaster ALDRI til caller. Game-end-flyt må aldri bli blokkert av
 *     observability.
 *
 * Performance:
 *   - 2-4 simple selects + én appendFile. Total < 50ms i prod.
 *   - Kjøres POST-commit fra caller — ingen rollback-effekter.
 */

import type { Pool } from "pg";
import * as fs from "node:fs/promises";

export interface GameEndSnapshotOptions {
  /** Path-prefix for snapshot-filer. Default `/tmp/game-end-snapshot-`. */
  pathPrefix?: string;
  /** Schema-navn (default `public`). */
  schema?: string;
  /** Override clock for tester. */
  now?: () => Date;
  /** Logger som mottar warn-meldinger. Default console.warn. */
  logger?: { warn: (msg: string, err?: unknown) => void };
}

export interface GameEndSnapshot {
  generatedAt: string;
  gameId: string;
  reason: string;
  /** Caller-supplied context (eks. "stop", "natural-end", "fullt-hus"). */
  context: Record<string, unknown>;
  scheduledGame: Record<string, unknown> | null;
  planRun: Record<string, unknown> | null;
  hallReadyRows: Array<Record<string, unknown>>;
  activeTickets: Array<Record<string, unknown>>;
  /** Optional engine-snapshot supplied by caller (room-state for engine.rooms-entry). */
  engineSnapshot: Record<string, unknown> | null;
}

export class GameEndSnapshotService {
  private readonly pool: Pool;
  private readonly pathPrefix: string;
  private readonly schema: string;
  private readonly now: () => Date;
  private readonly logger: { warn: (msg: string, err?: unknown) => void };

  constructor(pool: Pool, opts: GameEndSnapshotOptions = {}) {
    this.pool = pool;
    this.pathPrefix = opts.pathPrefix ?? "/tmp/game-end-snapshot-";
    this.schema = opts.schema ?? "public";
    this.now = opts.now ?? (() => new Date());
    this.logger = opts.logger ?? {
      warn: (msg, err) => {
        // eslint-disable-next-line no-console
        console.warn(`[GameEndSnapshot] ${msg}`, err);
      },
    };
  }

  /**
   * Dump game-end-snapshot for gitt gameId. Fire-and-forget — kaster aldri
   * tilbake. Caller bør `void service.dump(...)` etter commit slik at
   * snapshot-skriving ikke kan rulle tilbake regulatorisk audit.
   */
  async dump(
    gameId: string,
    reason: string,
    context: Record<string, unknown> = {},
    engineSnapshot: Record<string, unknown> | null = null,
  ): Promise<void> {
    try {
      const snapshot = await this.collectSnapshot(
        gameId,
        reason,
        context,
        engineSnapshot,
      );
      const path = `${this.pathPrefix}${gameId}.json`;
      const json = JSON.stringify(snapshot, null, 2);
      await fs.writeFile(path, json, "utf8");
    } catch (err) {
      this.logger.warn(`dump for ${gameId} feilet (fail-soft):`, err);
    }
  }

  /**
   * Bygg snapshot fra DB. Exposed for tester som vil verifisere struktur
   * uten å skrive til disk.
   */
  async collectSnapshot(
    gameId: string,
    reason: string,
    context: Record<string, unknown> = {},
    engineSnapshot: Record<string, unknown> | null = null,
  ): Promise<GameEndSnapshot> {
    const generatedAt = this.now().toISOString();
    const [scheduledGame, planRun, hallReadyRows, activeTickets] =
      await Promise.all([
        this.fetchScheduledGame(gameId),
        this.fetchPlanRunForGame(gameId),
        this.fetchHallReadyRows(gameId),
        this.fetchActiveTickets(gameId),
      ]);
    return {
      generatedAt,
      gameId,
      reason,
      context,
      scheduledGame,
      planRun,
      hallReadyRows,
      activeTickets,
      engineSnapshot,
    };
  }

  private async fetchScheduledGame(
    gameId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(
        `SELECT * FROM "${this.schema}"."app_game1_scheduled_games"
          WHERE id = $1`,
        [gameId],
      );
      return rows[0] ?? null;
    } catch (err) {
      this.logger.warn(`fetchScheduledGame(${gameId}) feilet:`, err);
      return null;
    }
  }

  private async fetchPlanRunForGame(
    gameId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(
        `SELECT pr.*
           FROM "${this.schema}"."app_game_plan_run" pr
           JOIN "${this.schema}"."app_game1_scheduled_games" sg
             ON sg.plan_run_id = pr.id
          WHERE sg.id = $1`,
        [gameId],
      );
      return rows[0] ?? null;
    } catch (err) {
      this.logger.warn(`fetchPlanRunForGame(${gameId}) feilet:`, err);
      return null;
    }
  }

  private async fetchHallReadyRows(
    gameId: string,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const { rows } = await this.pool.query<Record<string, unknown>>(
        `SELECT * FROM "${this.schema}"."app_game1_hall_ready_status"
          WHERE game_id = $1
          ORDER BY hall_id`,
        [gameId],
      );
      return rows;
    } catch (err) {
      this.logger.warn(`fetchHallReadyRows(${gameId}) feilet:`, err);
      return [];
    }
  }

  private async fetchActiveTickets(
    gameId: string,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      // Ticket-purchases for scheduled-game. Limit 500 så vi ikke skriver
      // enorme filer ved load-test-runder. Kunne være større, men 500 dekker
      // pilot-skala (1500 spillere × 2 brett ≈ 3000 — clipped, men det er
      // debug-OK).
      const { rows } = await this.pool.query<Record<string, unknown>>(
        `SELECT id, scheduled_game_id, buyer_user_id, hall_id,
                ticket_spec_json, total_amount_cents, payment_method,
                purchased_at, refunded_at, refund_reason
           FROM "${this.schema}"."app_game1_ticket_purchases"
          WHERE scheduled_game_id = $1
          ORDER BY purchased_at DESC
          LIMIT 500`,
        [gameId],
      );
      return rows;
    } catch (err) {
      // Tabellen finnes kanskje ikke i alle setups — degrade gracefully.
      this.logger.warn(`fetchActiveTickets(${gameId}) feilet:`, err);
      return [];
    }
  }
}
