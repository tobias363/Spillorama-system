-- Scheduler-config-kobling: admin-UI (GameManagement.config_json.spill1) →
-- scheduled-games-runtime.
--
-- Spec: docs/architecture/spill1-variantconfig-admin-coupling.md (scheduler-
-- fiks, avsnitt "Scope utsatt"). Kobler admin-UI-konfig til scheduled_games-
-- path slik at spawned Game 1-instanser ser per-farge premie-matriser
-- (Option X) i stedet for hardkodede defaults.
--
-- Formål: separat kolonne for GameManagement.config.spill1-snapshot —
-- holdt adskilt fra `ticket_config_json` (schedule.subGame.ticketTypesData)
-- og `jackpot_config_json` (schedule.subGame.jackpotData) slik at vi ikke
-- kolliderer med eksisterende scheduler-kontrakt. Scheduler-ticken
-- populerer denne kolonnen ved spawn ved å lese
-- `app_daily_schedules.game_management_id → app_game_management.config_json`.
--
-- Designvalg:
--   * NULLABLE: historiske scheduled_games + daily_schedules uten
--     game_management_id → NULL → Game1PayoutService faller tilbake til
--     default-patterns (bakoverkompat).
--   * JSONB (ikke TEXT): matcher resten av schedulertabellens JSON-kolonner
--     + GameManagement.config_json.
--   * Ingen backfill: forward-only (BIN-661). Eksisterende rader beholder
--     NULL → default-oppførsel.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS game_config_json JSONB NULL;

COMMENT ON COLUMN app_game1_scheduled_games.game_config_json IS
  'Scheduler-config-kobling: snapshot av GameManagement.config_json (typisk {spill1: {...}}) kopiert inn ved spawn. NULL → Game1PayoutService faller tilbake til DEFAULT_NORSK_BINGO_CONFIG.patterns.';
