-- Tobias-direktiv 2026-05-12: default mellom hver Spill 1-trekning skal være
-- 4 sekunder (var 5). Backfill eksisterende katalog-rader + aktive
-- scheduled-games slik at endringen tar effekt umiddelbart uten å vente
-- på re-seed.
--
-- Påvirker:
--   - app_game_catalog.rules (JSONB): timing.seconds = 4 for alle Spill 1-
--     rader hvor seconds er 5 (standard / Trafikklys / Oddsen — alle med
--     samme tempo per direktiv).
--   - app_game1_scheduled_games.ticket_config_json: spill1.timing.seconds
--     OG timing.seconds → 4 (begge shape-er for sikkerhets skyld).
--
-- Idempotent via WHERE-filter på eksakt verdi `= 5`. Re-kjøring etter at
-- noen senere setter `seconds = 7` rør IKKE den manuelle endringen.
-- Forward-only per ADR-0014.
--
-- Up

-- 1) Catalog-rader: oppdater rules.timing.seconds 5 → 4
UPDATE app_game_catalog
   SET rules_json = jsonb_set(
                      rules_json,
                      '{timing,seconds}',
                      '4'::jsonb,
                      false
                    ),
       updated_at = now()
 WHERE rules_json->'timing'->>'seconds' = '5';

-- 2) Aktive scheduled-games: spill1.timing.seconds 5 → 4
UPDATE app_game1_scheduled_games
   SET ticket_config_json = jsonb_set(
                              ticket_config_json,
                              '{spill1,timing,seconds}',
                              '4'::jsonb,
                              false
                            ),
       updated_at = now()
 WHERE ticket_config_json->'spill1'->'timing'->>'seconds' = '5';

-- 3) Aktive scheduled-games med "generisk nested" shape: timing.seconds 5 → 4
UPDATE app_game1_scheduled_games
   SET ticket_config_json = jsonb_set(
                              ticket_config_json,
                              '{timing,seconds}',
                              '4'::jsonb,
                              false
                            ),
       updated_at = now()
 WHERE ticket_config_json->'timing'->>'seconds' = '5'
   AND ticket_config_json->'spill1' IS NULL;

-- 4) Aktive scheduled-games med top-level seconds 5 → 4
UPDATE app_game1_scheduled_games
   SET ticket_config_json = jsonb_set(
                              ticket_config_json,
                              '{seconds}',
                              '4'::jsonb,
                              false
                            ),
       updated_at = now()
 WHERE ticket_config_json->>'seconds' = '5';
