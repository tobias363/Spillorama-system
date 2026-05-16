/**
 * BUG-A (audit:db 2026-05-14): integration-test for
 * GamePlanRunCleanupService.reconcileNaturalEndStuckRuns mot ekte Postgres.
 *
 * Skip-graceful: hopper hvis WALLET_PG_TEST_CONNECTION_STRING ikke satt.
 *
 * Strategi:
 *   1. Opprett temp-schema med plan-run + scheduled-games tabellene.
 *   2. Seed et stuck-scenario: plan-run=running + siste plan-posisjon har
 *      completed scheduled-game med actual_end_time > 30s siden.
 *   3. Kjør reconcileNaturalEndStuckRuns().
 *   4. Verifiser at plan-run.status = 'finished' i DB.
 *   5. Verifiser at audit-event ble skrevet i app_audit_log.
 *   6. Cleanup: DROP SCHEMA.
 *
 * Dette dekker at SQL-en faktisk fungerer mot ekte PG-CTE-semantics — i
 * tillegg til pool-stub-baserte unit-tester som dekker WHERE-filter-
 * semantikk.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { GamePlanRunCleanupService } from "../game/GamePlanRunCleanupService.js";
import {
  AuditLogService,
  PostgresAuditLogStore,
} from "../compliance/AuditLogService.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `plan_run_reconcile_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function setupSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);

  // app_game_plan_run — match migrations/20261210000000_app_game_plan_run.sql.
  await pool.query(`
    CREATE TABLE "${schema}"."app_game_plan_run" (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      hall_id TEXT NOT NULL,
      business_date DATE NOT NULL,
      current_position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle','running','paused','finished')),
      jackpot_overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NULL,
      finished_at TIMESTAMPTZ NULL,
      master_user_id TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE "${schema}"."app_game_plan_item" (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 1)
    )
  `);

  // app_game1_scheduled_games — match migrations/20260428000000.
  await pool.query(`
    CREATE TABLE "${schema}"."app_game1_scheduled_games" (
      id TEXT PRIMARY KEY,
      plan_run_id TEXT NULL,
      plan_position INTEGER NULL CHECK (plan_position IS NULL OR plan_position >= 1),
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN (
          'scheduled','purchase_open','ready_to_start',
          'running','paused','completed','cancelled'
        )),
      actual_end_time TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // app_audit_log — match audit-store schema.
  await pool.query(`
    CREATE TABLE "${schema}"."app_audit_log" (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT,
      actor_type TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE INDEX "ix_${schema}_audit_resource" ON "${schema}"."app_audit_log" (resource, resource_id)`,
  );
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

test(
  "integration: stuck plan-run + completed sched > 30s → reconcile flippes til finished + audit-event persistert",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      // Seed plan-run running + completed scheduled-game 5 min siden.
      const planRunId = "00c204b8-4b98-462e-9c8e-a6e510e51111";
      const schedId = "d518cc1f-827e-4473-839c-b59f055d2222";
      const oldEnd = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await pool.query(
        `
        INSERT INTO "${schema}"."app_game_plan_item" (id, plan_id, position)
        VALUES ('item-1', $1, 1)
        `,
        ["plan-1"],
      );
      await pool.query(
        `
        INSERT INTO "${schema}"."app_game_plan_run"
          (id, plan_id, hall_id, business_date, current_position, status,
           started_at, master_user_id)
        VALUES ($1, $2, $3, CURRENT_DATE, 1, 'running', now(), 'master-1')
        `,
        [planRunId, "plan-1", "hall-1"],
      );
      await pool.query(
        `
        INSERT INTO "${schema}"."app_game1_scheduled_games"
          (id, plan_run_id, plan_position, status, actual_end_time)
        VALUES ($1, $2, 1, 'completed', $3)
        `,
        [schedId, planRunId, oldEnd],
      );

      const auditStore = new PostgresAuditLogStore({ pool, schema });
      const auditLog = new AuditLogService(auditStore);
      const svc = new GamePlanRunCleanupService({
        pool,
        schema,
        auditLogService: auditLog,
      });

      const result = await svc.reconcileNaturalEndStuckRuns();

      assert.equal(result.cleanedCount, 1);
      assert.equal(result.closedRuns[0]?.id, planRunId);
      assert.equal(result.closedRuns[0]?.scheduledGameId, schedId);

      // Verifiser at plan-run faktisk er flippet til 'finished' i DB.
      const row = await pool.query(
        `SELECT status, finished_at FROM "${schema}"."app_game_plan_run" WHERE id = $1`,
        [planRunId],
      );
      assert.equal(row.rows[0]?.status, "finished");
      assert.ok(row.rows[0]?.finished_at !== null);

      // Verifiser audit-event ble persistert. (audit er fire-and-forget,
      // drain mikrotask-køen først.)
      await new Promise((r) => setImmediate(r));
      const auditRows = await pool.query(
        `SELECT action, resource_id, details FROM "${schema}"."app_audit_log" WHERE resource = 'game_plan_run' AND resource_id = $1`,
        [planRunId],
      );
      assert.equal(auditRows.rows.length, 1);
      assert.equal(
        auditRows.rows[0]?.action,
        "plan_run.reconcile_natural_end",
      );
      const details = auditRows.rows[0]?.details as Record<string, unknown>;
      assert.equal(details.reason, "no_master_advance_after_natural_end");
      assert.equal(details.scheduledGameId, schedId);

      // Re-kjøring må være idempotent (plan-run er nå finished, ingen
      // flere oppdateringer).
      const second = await svc.reconcileNaturalEndStuckRuns();
      assert.equal(second.cleanedCount, 0);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "integration: cancelled scheduled-game blokkerer reconcile (ikke natural-end)",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      const planRunId = "11111111-1111-1111-1111-111111111111";
      const schedId = "22222222-2222-2222-2222-222222222222";
      const oldEnd = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await pool.query(
        `
        INSERT INTO "${schema}"."app_game_plan_item" (id, plan_id, position)
        VALUES ('item-cancelled', $1, 1)
        `,
        ["plan-1"],
      );
      await pool.query(
        `
        INSERT INTO "${schema}"."app_game_plan_run"
          (id, plan_id, hall_id, business_date, current_position, status)
        VALUES ($1, $2, $3, CURRENT_DATE, 1, 'running')
        `,
        [planRunId, "plan-1", "hall-1"],
      );
      await pool.query(
        `
        INSERT INTO "${schema}"."app_game1_scheduled_games"
          (id, plan_run_id, plan_position, status, actual_end_time)
        VALUES ($1, $2, 1, 'cancelled', $3)
        `,
        [schedId, planRunId, oldEnd],
      );

      const svc = new GamePlanRunCleanupService({ pool, schema });
      const result = await svc.reconcileNaturalEndStuckRuns();

      assert.equal(
        result.cleanedCount,
        0,
        "cancelled scheduled-game skal IKKE trigge natural-end-reconcile",
      );

      // Plan-run forblir running (uendret).
      const row = await pool.query(
        `SELECT status FROM "${schema}"."app_game_plan_run" WHERE id = $1`,
        [planRunId],
      );
      assert.equal(row.rows[0]?.status, "running");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);
