-- BIN-672: Persist gameSlug on game_sessions so checkpoint-recovery knows
-- which ticket format to use.
--
-- Background: preRound display-tickets rendered as 3×5 Databingo60 instead
-- of 5×5 Bingo75 because the `game_sessions` row stored for a running game
-- had no `game_slug` column. When the backend crash-recovered a room, it
-- could not determine the correct gameSlug and fell back to the 3×5 format
-- (see BIN-671 stop-gap in PR #246 that hardcoded "bingo" as a temporary
-- workaround).
--
-- With `game_slug` persisted here, `findIncompleteGames` can return it and
-- `restoreRoomFromSnapshot` can pass it through to `RoomState.gameSlug` —
-- making the ticket-format decision deterministic across restarts.
--
-- DEFAULT 'bingo' because every row currently in game_sessions is a Bingo
-- round (Game 2/3/5 are not yet running). NOT NULL enforces that new rows
-- must explicitly set the slug. Harmless on any environment — no column
-- drops, no data loss.
--
-- Up migration
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS game_slug TEXT NOT NULL DEFAULT 'bingo';

CREATE INDEX IF NOT EXISTS idx_game_sessions_game_slug
  ON game_sessions(game_slug);

COMMENT ON COLUMN game_sessions.game_slug IS
  'BIN-672: game slug (e.g. "bingo", "game_2") driving ticket-format + draw-bag selection. Populated on INSERT by PostgresBingoSystemAdapter.insertGameSession; read on crash-recovery by findIncompleteGames.';
