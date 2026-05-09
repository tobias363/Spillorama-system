-- F-NEW-3 fix (2026-05-09): Add pause_reason column to app_game1_scheduled_games.
--
-- Background:
-- GameLobbyAggregator.queryScheduledGameByPlanRun and
-- queryActiveScheduledGameForHall both SELECT pause_reason
-- (apps/backend/src/game/GameLobbyAggregator.ts:586,611). The catch-block
-- on lines 593-601/621-628 returns null silently when Postgres responds
-- with error code 42703 (column does not exist). That null propagates as
-- a falsy primary-row, which the aggregator interprets as BRIDGE_FAILED
-- and surfaces as a blocking inconsistency-warning. The MasterActionService
-- pre-validation (apps/backend/src/game/MasterActionService.ts) rejects
-- every master-action with LOBBY_INCONSISTENT — i.e. ALL master start /
-- pause / resume / stop / advance / jackpot calls fail.
--
-- The query was added without a corresponding migration. The
-- ScheduledGameRow interface (line 174-187) already declares
-- pause_reason: string | null, and the row-mapping at line 955 passes the
-- value through to pauseReason in the wire-shape. This migration finally
-- creates the column so the SELECT succeeds and the silent fallback never
-- triggers.
--
-- Forward-only (BIN-661 convention): no Down section. Idempotent
-- (ADD COLUMN IF NOT EXISTS) so re-running on dev DBs that may already
-- have the column manually added is safe.
--
-- Up migration

ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS pause_reason TEXT NULL;

COMMENT ON COLUMN app_game1_scheduled_games.pause_reason IS
  '2026-05-09 (F-NEW-3): optional reason text set when status flips to "paused" by master action. Read by GameLobbyAggregator.queryScheduledGameByPlanRun / queryActiveScheduledGameForHall.';
