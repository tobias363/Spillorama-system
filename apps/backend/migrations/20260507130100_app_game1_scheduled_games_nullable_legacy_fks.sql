-- Fase 4 (2026-05-07): Spilleplan-redesign — gjør legacy FK-er nullable
-- så GamePlanEngineBridge kan opprette scheduled-game-rader fra plan-run
-- uten å ha en daily_schedule + schedule_id.
--
-- Bakgrunn:
-- I Fase 4 introduseres GamePlanEngineBridge som spawn-er en
-- `app_game1_scheduled_games`-rad i farten basert på plan_run + catalog_entry
-- + jackpot-override. Bridgen har INGEN daily_schedule eller schedule-mal —
-- raden representerer en runtime-instans av et katalog-spill, ikke en
-- legacy-mal-instans. For at bridgen skal kunne kjøre uten å lyve om FK-er
-- (eller opprette synthetiske dummy-mal-rader), må vi gjøre `daily_schedule_id`
-- og `schedule_id` NULLABLE.
--
-- Det er trygt fordi:
--   * Eksisterende rader (alle med begge FK-er satt) er uberørt.
--   * Game1ScheduleTickService.spawnUpcomingGame1Games fortsetter å sette
--     begge FK-ene — bare bridgen utelater dem.
--   * Når `catalog_entry_id` ER satt (fra Fase 4-bridge) ELLER
--     `daily_schedule_id` ER satt (legacy-spawn), har vi alltid nok data
--     til å reprodusere konfigurasjonen — service-laget validerer dette
--     ved les.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

ALTER TABLE app_game1_scheduled_games
  ALTER COLUMN daily_schedule_id DROP NOT NULL;

ALTER TABLE app_game1_scheduled_games
  ALTER COLUMN schedule_id DROP NOT NULL;

COMMENT ON COLUMN app_game1_scheduled_games.daily_schedule_id IS
  'GAME1_SCHEDULE PR1: link til app_daily_schedules. Fase 4 (2026-05-07): NULLABLE — GamePlanEngineBridge spawner rader uten daily_schedule når catalog-modellen brukes.';

COMMENT ON COLUMN app_game1_scheduled_games.schedule_id IS
  'GAME1_SCHEDULE PR1: link til app_schedules-mal. Fase 4 (2026-05-07): NULLABLE — GamePlanEngineBridge spawner rader uten schedule-mal når catalog-modellen brukes.';

-- UNIQUE-constraint (daily_schedule_id, scheduled_day, sub_game_index)
-- fra original migrasjon: dette er en composite UNIQUE som tolererer NULL i
-- ett av feltene fordi NULL != NULL i SQL-standarden — så bridgen kan trygt
-- spawne rader med daily_schedule_id=NULL uten konflikt med legacy-rader
-- på samme dag. (Verifikasjon: testet med pg ≥ 9.0 default behavior.)
