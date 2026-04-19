-- Blokk 1.8 — Ticket binding to draw_session (schema + back-compat).
--
-- Bonger er in-memory + serialisert i `game_checkpoints.snapshot` (JSON), så
-- det finnes ingen egen `tickets`-tabell å kolonnere. Bindingen
-- (drawSessionId, hallId, purchaseChannel) er stemplet på hver `Ticket` ved
-- kjøp (BingoEngine.startGame) og reiser med snapshotet gjennom hele livsløpet.
--
-- Denne migrasjonen legger kun til `draw_session_id` på `game_sessions` slik
-- at regulatoriske spørringer kan joine games mot `app_draw_sessions` uten å
-- lese snapshot-JSON. Kolonnen settes på BUY_IN-checkpointet (se
-- PostgresBingoSystemAdapter.onCheckpoint). PostgresBingoSystemAdapter kaller
-- `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
-- selv ved oppstart, så denne migrasjonen er primært dokumentasjon av
-- skjema-endringen for produksjon.
--
-- Naming-konvensjon: filprefiks følger timestamp, ingen `app_`-prefiks fordi
-- `game_sessions` eier sitt eget navnerom (legacy, fra BIN-159).

-- Up Migration

-- ── Draw-session-binding på game_sessions ──────────────────────────────────

ALTER TABLE IF EXISTS game_sessions
  ADD COLUMN IF NOT EXISTS draw_session_id TEXT;

COMMENT ON COLUMN game_sessions.draw_session_id IS
  'Blokk 1.8 — ID for felles trekning ved multi-hall-rom. NULL for enkelt-hall-rom.';

-- Partial index: bare games som faktisk tilhører en draw_session trenger lookup.
CREATE INDEX IF NOT EXISTS idx_game_sessions_draw_session_id
  ON game_sessions (draw_session_id)
  WHERE draw_session_id IS NOT NULL;

-- Down Migration

-- Ingen datadød — dropping index + column er trygt.
DROP INDEX IF EXISTS idx_game_sessions_draw_session_id;
ALTER TABLE IF EXISTS game_sessions DROP COLUMN IF EXISTS draw_session_id;
