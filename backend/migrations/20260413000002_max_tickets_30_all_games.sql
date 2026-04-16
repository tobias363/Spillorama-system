-- Migration: Extend max_tickets_per_player from 5 → 30 for all game slugs
-- Background: Spill 1 (bingo) was patched directly in the DB. This migration
-- aligns the constraint and data for all games (incl. monsterbingo) and
-- codifies the fix properly so it survives a redeploy.

BEGIN;

-- 1. Replace the old CHECK constraint (≤ 5) with ≤ 30
ALTER TABLE app_hall_game_config
  DROP CONSTRAINT IF EXISTS app_hall_game_config_max_tickets_per_player_check;

ALTER TABLE app_hall_game_config
  ADD CONSTRAINT app_hall_game_config_max_tickets_per_player_check
  CHECK (max_tickets_per_player >= 1 AND max_tickets_per_player <= 30);

-- 2. Set all games to 30 (bingo already done directly; this is idempotent)
UPDATE app_hall_game_config
  SET max_tickets_per_player = 30
  WHERE max_tickets_per_player < 30;

COMMIT;
