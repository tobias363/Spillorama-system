-- BIN-496 (cleanup-bølge F, 2026-05-05): Game 4 (temabingo) deprecation cleanup.
--
-- Tobias-direktiv 2026-05-05: "alt som har med spill 4 og gjøre kan slettes".
-- Game 4 / themebingo / temabingo har vært deprecated siden 2026-04-17 (BIN-496)
-- og har aldri hatt klient-implementasjon i ny stack. Denne migrasjonen
-- fjerner siste rester fra DB-en.
--
-- Tidligere migrasjoner:
--   - 20260413000001_initial_schema.sql:230 — seed-rad opprettet temabingo
--   - 20260417120000_deactivate_game4_temabingo.sql — satt is_enabled=false
--
-- Effekt:
--   - DELETE FROM app_games WHERE slug = 'temabingo'
--   - PlatformService.ts seed-listen er også oppdatert til å ikke inkludere
--     temabingo, så fresh DBs vil aldri se denne raden igjen.
--   - Eventuelle FK-referanser fra app_rooms / hall_game_schedules /
--     andre tabeller mot 'temabingo'-slug bevares som historiske rader
--     (slug er en string, ikke en FK), men siden ingen kode lenger ruter
--     trafikk til temabingo, vil disse forbli inaktive.
--
-- Rollback (manuell): re-insert via PlatformService.ts seed-list eller
-- direkte SQL:
--   INSERT INTO app_games (slug, title, description, route, is_enabled,
--                          sort_order, settings_json)
--   VALUES ('temabingo', 'Temabingo',
--           'Bingo med temaer og multiplikator (utgått, BIN-496)',
--           '/temabingo', false, 4,
--           '{"gameNumber":4,"deprecated":true}'::jsonb);

BEGIN;

DELETE FROM app_games
WHERE slug = 'temabingo';

COMMIT;
