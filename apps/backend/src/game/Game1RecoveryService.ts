/**
 * GAME1_SCHEDULE PR 5: schedule-level crash recovery for Game 1.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.8.
 *
 * Hvorfor en EGEN recovery-service ved siden av BIN-245 sin
 * engine-recovery?
 *
 *   - BIN-245 (i index.ts-boot) håndterer engine-state: den finner
 *     `game_sessions` med `status='RUNNING'` og hydrerer BingoEngine-rom
 *     fra siste checkpoint-snapshot. Dette er RUNTIME-state (balls,
 *     marks, winners).
 *   - Denne servicen håndterer SCHEDULE-state: rader i
 *     `app_game1_scheduled_games` som var `running` eller `paused` da
 *     serveren krasjet. Schedule-state er separat fra engine-state
 *     (samme game kan leve i begge tabeller, koblet på room_code i
 *     framtidig PR 4).
 *
 * Regler for recovery-pass ved boot:
 *
 *   1. Rader med `status='running'` der `scheduled_end_time` er
 *      passert med mer enn `maxRunningWindowMs` (default 2 timer): →
 *      `status='cancelled'`, `actual_end_time=NOW()`,
 *      `stop_reason='crash_recovery_cancelled'`. Audit-event med
 *      action='stop' og metadata `{reason: 'crash_recovery_cancelled',
 *      priorStatus, autoCancelledAt}`.
 *
 *   2. Rader med `status='paused'` der `scheduled_end_time` er
 *      passert tilsvarende: samme cancel-behandling.
 *
 *   3. Øvrige rader (`running`/`paused` fortsatt innenfor vinduet):
 *      røres IKKE. Engine-recovery (BIN-245) eller master-konsoll
 *      håndterer dem videre. Vi logger hvor mange slike som ble
 *      identifisert så operatør kan reagere.
 *
 * Designvalg:
 *
 *   - Bruker samme `stop` action som master-stop (ikke ny
 *     audit-action) — unngår behov for forward-migration av
 *     CHECK-constraint, og rapporter som filtrerer på action='stop'
 *     fanger opp krasj-kansellering med metadata.
 *   - Fire-and-forget: feil på en enkelt rad skal ikke stoppe
 *     gjennomgangen av resten. Vi logger hver feil og returnerer
 *     summary.
 *   - Room_code-avhengighet UNNGÅS i denne PR-en (PR 4 lander det).
 *     Recovery-servicen opererer kun på schedule-tabellene.
 *
 * Tester: se `Game1RecoveryService.test.ts`.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-recovery-service" });

export interface Game1RecoveryServiceOptions {
  pool: Pool;
  schema?: string;
  /**
   * Hvor lenge etter `scheduled_end_time` en `running`/`paused` rad skal
   * tåles før den auto-kanselleres. Default 2 timer (per spec §3.8).
   */
  maxRunningWindowMs?: number;
}

export interface RecoveryRunResult {
  /** Totalt antall rader inspisert (running + paused). */
  inspected: number;
  /** Rader auto-kansellert pga. overtid (scheduled_end_time + window). */
  cancelled: number;
  /** Rader som fortsatt er running/paused innenfor vinduet — rørt IKKE. */
  preserved: number;
  /** Feil oppstod for disse game-id-ene. */
  failures: Array<{ gameId: string; error: string }>;
  /** Rad-detaljer for audit — brukes i tester. */
  cancelledGameIds: string[];
  preservedGameIds: string[];
}

interface ScheduledGameRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string;
  scheduled_end_time: Date | string;
}

const DEFAULT_MAX_RUNNING_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h

export class Game1RecoveryService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly maxRunningWindowMs: number;

  constructor(options: Game1RecoveryServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    const window = options.maxRunningWindowMs ?? DEFAULT_MAX_RUNNING_WINDOW_MS;
    if (!Number.isFinite(window) || window <= 0) {
      throw new DomainError(
        "INVALID_CONFIG",
        "maxRunningWindowMs må være > 0."
      );
    }
    this.maxRunningWindowMs = Math.floor(window);
  }

  /** @internal test helper. */
  static forTesting(
    pool: Pool,
    opts?: { schema?: string; maxRunningWindowMs?: number }
  ): Game1RecoveryService {
    return new Game1RecoveryService({ pool, ...(opts ?? {}) });
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private hallReadyTable(): string {
    return `"${this.schema}"."app_game1_hall_ready_status"`;
  }

  private masterAuditTable(): string {
    return `"${this.schema}"."app_game1_master_audit"`;
  }

  /**
   * Kalles én gang fra boot-sekvensen (index.ts) etter at persistens er
   * hydrert. Scan gjennom `running`/`paused` schedule-rader og cancel de
   * som har overskredet vinduet.
   */
  async runRecoveryPass(nowMs: number = Date.now()): Promise<RecoveryRunResult> {
    const result: RecoveryRunResult = {
      inspected: 0,
      cancelled: 0,
      preserved: 0,
      failures: [],
      cancelledGameIds: [],
      preservedGameIds: [],
    };

    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, status, master_hall_id, group_hall_id, scheduled_end_time
         FROM ${this.scheduledGamesTable()}
        WHERE status IN ('running', 'paused')
        ORDER BY scheduled_end_time ASC`
    );
    result.inspected = rows.length;

    const cutoffMs = nowMs - this.maxRunningWindowMs;

    for (const row of rows) {
      const endedAtMs = this.rowEndTimeMs(row.scheduled_end_time);
      const isOverdue = Number.isFinite(endedAtMs) && endedAtMs < cutoffMs;

      if (!isOverdue) {
        result.preserved += 1;
        result.preservedGameIds.push(row.id);
        continue;
      }

      try {
        const cancelled = await this.cancelOverdueGame(row, nowMs);
        if (cancelled) {
          result.cancelled += 1;
          result.cancelledGameIds.push(row.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(
          { gameId: row.id, err },
          "[game1-recovery] failed to cancel overdue game"
        );
        result.failures.push({ gameId: row.id, error: msg });
      }
    }

    log.info(
      {
        inspected: result.inspected,
        cancelled: result.cancelled,
        preserved: result.preserved,
        failureCount: result.failures.length,
      },
      "[game1-recovery] pass complete"
    );

    return result;
  }

  private rowEndTimeMs(value: Date | string): number {
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  /**
   * Kansellerer én overdue rad + skriver `stop`-audit med
   * `crash_recovery_cancelled`-metadata. Kjører i en transaksjon så
   * UPDATE + audit-INSERT er atomisk.
   */
  private async cancelOverdueGame(
    row: ScheduledGameRow,
    nowMs: number
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: updated } = await client.query<{ id: string; status: string }>(
        `UPDATE ${this.scheduledGamesTable()}
            SET status          = 'cancelled',
                stopped_by_user_id = 'SYSTEM',
                stop_reason        = 'crash_recovery_cancelled',
                actual_end_time    = now(),
                updated_at         = now()
          WHERE id = $1
            AND status IN ('running', 'paused')
          RETURNING id, status`,
        [row.id]
      );

      if (updated.length === 0) {
        // En annen prosess kan ha flyttet raden mellom SELECT og UPDATE.
        // Rull tilbake og skipp uten å kaste.
        await client.query("ROLLBACK");
        return false;
      }

      const hallsSnapshot = await this.snapshotReadyRows(client, row.id);
      await this.writeAudit(client, {
        gameId: row.id,
        groupHallId: row.group_hall_id,
        actorHallId: row.master_hall_id,
        hallsSnapshot,
        metadata: {
          reason: "crash_recovery_cancelled",
          priorStatus: row.status,
          scheduledEndTime: this.rowEndTimeIso(row.scheduled_end_time),
          autoCancelledAtMs: nowMs,
          autoCancelledAt: new Date(nowMs).toISOString(),
        },
      });

      await client.query("COMMIT");

      log.warn(
        { gameId: row.id, priorStatus: row.status },
        "[game1-recovery] auto-cancelled overdue scheduled game"
      );
      return true;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* swallow — original error is more interesting */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private rowEndTimeIso(value: Date | string): string {
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  private async snapshotReadyRows(
    client: PoolClient,
    gameId: string
  ): Promise<Record<string, { isReady: boolean; excluded: boolean }>> {
    const { rows } = await client.query<{
      hall_id: string;
      is_ready: boolean;
      excluded_from_game: boolean;
    }>(
      `SELECT hall_id, is_ready, excluded_from_game
         FROM ${this.hallReadyTable()}
        WHERE game_id = $1`,
      [gameId]
    );
    const snap: Record<string, { isReady: boolean; excluded: boolean }> = {};
    for (const r of rows) {
      snap[r.hall_id] = {
        isReady: Boolean(r.is_ready),
        excluded: Boolean(r.excluded_from_game),
      };
    }
    return snap;
  }

  private async writeAudit(
    client: PoolClient,
    input: {
      gameId: string;
      groupHallId: string;
      actorHallId: string;
      hallsSnapshot: Record<string, { isReady: boolean; excluded: boolean }>;
      metadata: Record<string, unknown>;
    }
  ): Promise<string> {
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO ${this.masterAuditTable()}
         (id, game_id, action, actor_user_id, actor_hall_id, group_hall_id,
          halls_ready_snapshot, metadata_json)
       VALUES ($1, $2, 'stop', 'SYSTEM', $3, $4, $5::jsonb, $6::jsonb)`,
      [
        auditId,
        input.gameId,
        input.actorHallId,
        input.groupHallId,
        JSON.stringify(input.hallsSnapshot),
        JSON.stringify(input.metadata),
      ]
    );
    return auditId;
  }
}
