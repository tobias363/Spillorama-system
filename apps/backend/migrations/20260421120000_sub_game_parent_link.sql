-- BIN-615 / PR-C1: Sub-game parent→child link for Game 2 (Rocket/Tallspill) and Game 3 (Mønsterbingo).
--
-- Legacy reference: Game/Common/Controllers/GameController.js:334-521 (createChildGame).
-- Each parent schedule spawns N children with gameNumber = "CH_<seq>_<ts>_<G2|G3>".
-- Per-sub-game config (ticketPrice, luckyNumberPrize, patterns, jackPotNumber) lives in variant_config JSONB.
--
-- Flat self-referencing structure matches legacy semantics (parentGameId + subGames[]) but keeps
-- the existing single-table query path intact — parent rows have parent_schedule_id IS NULL.

-- BIN-657: parent_schedule_id declared as TEXT (not UUID) to match the
-- self-referenced hall_game_schedules.id which is TEXT PRIMARY KEY in the
-- initial schema (20260413000001_initial_schema.sql:189). Cross-type FKs
-- are rejected by Postgres.
ALTER TABLE hall_game_schedules
  ADD COLUMN parent_schedule_id TEXT REFERENCES hall_game_schedules(id) ON DELETE CASCADE,
  ADD COLUMN sub_game_sequence INTEGER,
  ADD COLUMN sub_game_number TEXT;

CREATE INDEX idx_hall_game_schedules_parent
  ON hall_game_schedules(parent_schedule_id)
  WHERE parent_schedule_id IS NOT NULL;

COMMENT ON COLUMN hall_game_schedules.parent_schedule_id IS
  'BIN-615: Self-reference to parent schedule row. NULL for parent rows. Set on child rows spawned by SubGameManager.';
COMMENT ON COLUMN hall_game_schedules.sub_game_sequence IS
  'BIN-615: 1-based sequence index of this child within its parent (i+1 in legacy createChildGame loop).';
COMMENT ON COLUMN hall_game_schedules.sub_game_number IS
  'BIN-615: Legacy-compatible gameNumber "CH_<seq>_<ts>_<G2|G3>".';
