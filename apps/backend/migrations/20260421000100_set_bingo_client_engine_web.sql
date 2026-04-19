-- BIN: Shell-routing fix for Game 1 (bingo) — flip clientEngine to "web".
--
-- Background:
--   `apps/backend/public/web/lobby.js` (~line 291-305) uses
--   `shouldUseWebClient(game)` to decide whether to load the new PixiJS
--   web client or fall back to the Unity WebGL build. That check only
--   returns true when `game.settings.clientEngine === 'web'`.
--
--   On staging the bingo row in `app_games` has `settings_json`
--   = `{"gameNumber": 1}` — no `clientEngine` field — so the shell falls
--   through to Unity. Unity WebGL isn't deployed, so the loader hits a
--   404 → HTML fallback → `Uncaught SyntaxError: Unexpected token '<'`,
--   and the lobby loads forever.
--
--   The `?webClient=bingo` URL override was verified to start the new
--   PixiJS client correctly, confirming the web client itself is fine;
--   only the data flag is missing.
--
-- Scope:
--   Only bingo (slug='bingo'). Rocket (Game 2) and Mønsterbingo (Game 3)
--   are NOT flipped yet — they still need parity-audits before their
--   web clients are ready. This migration is intentionally narrow.
--
-- Idempotent: `jsonb_set(..., true)` inserts the key if missing and
-- overwrites if present, and running this twice leaves the same value.
--
-- Rollback (manual):
--   UPDATE app_games
--   SET settings_json = settings_json - 'clientEngine'
--   WHERE slug = 'bingo';

BEGIN;

UPDATE app_games
SET settings_json = jsonb_set(settings_json, '{clientEngine}', '"web"'::jsonb, true),
    updated_at = now()
WHERE slug = 'bingo';

COMMIT;
