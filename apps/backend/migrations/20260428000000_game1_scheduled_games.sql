-- GAME1_SCHEDULE PR 1: app_game1_scheduled_games (game-instanser spawned fra daily_schedules).
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.1
--
-- Formål: én rad per spawned Game 1-instans. Scheduler-ticken (15s) gjør
-- forward-spawn 24t frem fra daily_schedules × schedule-mal × subGames × weekdays.
-- Tabellen er kilden til sannhet for kommende, pågående og avsluttede
-- Game 1-instanser. Runtime-state (balls, winners, purchases) holdes
-- fremdeles i BingoEngine + game_sessions; denne tabellen holder
-- plan-snapshot + state-maskin (scheduled → purchase_open → ready_to_start →
-- running → paused → completed | cancelled).
--
-- Designvalg:
--   * `schedule_id` REFERENCES app_schedules(id): snapshot av schedule-mal
--     som ble brukt da raden ble spawned. Nødvendig for audit og for å
--     reproducer oppstart-config selv om malen senere endres.
--   * `daily_schedule_id` REFERENCES app_daily_schedules(id): link tilbake
--     til plan-instansen som trigget spawn.
--   * `sub_game_index` INT + `sub_game_name` TEXT: index i schedule.subGames[]
--     + denormalisert navn for rapporter.
--   * `notification_start_seconds` INTEGER: **normalisert fra "5m"/"60s"** —
--     lagret som sekunder, ikke string. Spec-avgjørelse: bedre typesikkerhet
--     enn rå string, forenkler countdown-logikk senere.
--   * `ticket_config_json` + `jackpot_config_json` (JSONB): snapshot av
--     schedule.subGame.ticketTypesData og jackpotData. Snapshot-pattern
--     beskytter mot mal-endringer midt i plan-perioden.
--   * `game_mode` TEXT: 'Auto' eller 'Manual' — arvet fra schedule.scheduleType.
--   * `master_hall_id` + `group_hall_id`: fra daily_schedule.hallIds. Master-hall
--     er bindet til daily_schedule (legacy pattern).
--   * `participating_halls_json` JSONB: array av hall-IDer. Snapshot av
--     daily_schedule.hallIds.hallIds + hall-group-members på spawn-tidspunkt.
--   * `status` TEXT: state-maskin med CHECK constraint. Initial: 'scheduled'.
--   * `actual_start_time` / `actual_end_time`: faktiske klokkeslett
--     (master-trykk + engine-finish). NULL frem til de skjer.
--   * `started_by_user_id` / `stopped_by_user_id`: audit. Ikke FK fordi
--     user-sletting ikke skal fjerne historikk.
--   * `excluded_hall_ids_json`: haller master har ekskludert (tekniske
--     problemer). Tom ved spawn.
--   * `stop_reason`: 'master_stop' | 'end_of_day_unreached' | …
--
-- Indexer:
--   * (status, scheduled_start_time): scheduler-tick-query "kommende
--     aktiviteter" og "utløpte scheduled"-queries.
--   * (group_hall_id, scheduled_day): admin-UI dagsoversikt per link.
--
-- UNIQUE-constraint: (daily_schedule_id, scheduled_day, sub_game_index)
--   hindrer dobbel-spawn når scheduler kjører raskt eller crash-resumes.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_scheduled_games (
  id                        TEXT PRIMARY KEY,
  daily_schedule_id         TEXT NOT NULL
                              REFERENCES app_daily_schedules(id) ON DELETE CASCADE,
  schedule_id               TEXT NOT NULL
                              REFERENCES app_schedules(id) ON DELETE RESTRICT,
  -- Index i schedule.subGames[] (0-basert) + denormalisert navn.
  sub_game_index            INTEGER NOT NULL CHECK (sub_game_index >= 0),
  sub_game_name             TEXT NOT NULL,
  custom_game_name          TEXT NULL,
  -- Datoen raden gjelder (DATE, ikke timestamp — 24t-vinduet avgjøres av
  -- scheduled_start_time/scheduled_end_time).
  scheduled_day             DATE NOT NULL,
  scheduled_start_time      TIMESTAMPTZ NOT NULL,
  scheduled_end_time        TIMESTAMPTZ NOT NULL,
  -- Normalisert til sekunder (INT). Legacy "5m"/"60s" konverteres i service.
  notification_start_seconds INTEGER NOT NULL
                              CHECK (notification_start_seconds >= 0),
  -- Snapshot av schedule.subGame.ticketTypesData (farger, priser, prizes).
  ticket_config_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Snapshot av schedule.subGame.jackpotData (white/yellow/purple + draw).
  jackpot_config_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 'Auto' = tick-based progression; 'Manual' = master trykker start.
  game_mode                 TEXT NOT NULL CHECK (game_mode IN ('Auto','Manual')),
  -- Master-hall: linkens master (bingovert-rollen aktiveres der).
  master_hall_id            TEXT NOT NULL
                              REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Hall-gruppe som raden hører til (link-ID).
  group_hall_id             TEXT NOT NULL
                              REFERENCES app_hall_groups(id) ON DELETE RESTRICT,
  -- Snapshot av deltagende haller. Array av hall-IDer.
  participating_halls_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- State-maskin: scheduled → purchase_open → ready_to_start → running
  --               → paused → completed | cancelled.
  status                    TEXT NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN (
                                'scheduled',
                                'purchase_open',
                                'ready_to_start',
                                'running',
                                'paused',
                                'completed',
                                'cancelled'
                              )),
  actual_start_time         TIMESTAMPTZ NULL,
  actual_end_time           TIMESTAMPTZ NULL,
  started_by_user_id        TEXT NULL,
  -- Haller master har ekskludert etter ready-tick (tekniske feil).
  excluded_hall_ids_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  stopped_by_user_id        TEXT NULL,
  stop_reason               TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Forhindre dobbel-spawn når scheduler kjører raskt eller ved crash-resume.
  CONSTRAINT uq_game1_sched_daily_day_sub UNIQUE
    (daily_schedule_id, scheduled_day, sub_game_index)
);

-- Tick-query: "hvilke rader skal bytte status nå?" filtrerer på status +
-- scheduled_start_time. Trunk composite-indeks dekker begge søk-mønstre.
CREATE INDEX IF NOT EXISTS idx_game1_sched_status_start
  ON app_game1_scheduled_games(status, scheduled_start_time);

-- Dagsoversikt per link (admin-UI + bingovert-UI).
CREATE INDEX IF NOT EXISTS idx_game1_sched_group_day
  ON app_game1_scheduled_games(group_hall_id, scheduled_day);

COMMENT ON TABLE app_game1_scheduled_games IS
  'GAME1_SCHEDULE PR1: én rad per spawned Game 1-instans. Scheduler-ticken spawner 24t frem fra app_daily_schedules. Kilden til sannhet for kommende/pågående spill.';

COMMENT ON COLUMN app_game1_scheduled_games.notification_start_seconds IS
  'GAME1_SCHEDULE PR1: notifikasjonsstart i sekunder (normalisert fra legacy "5m"/"60s"-strenger i schedule.subGame.notificationStartTime).';

COMMENT ON COLUMN app_game1_scheduled_games.ticket_config_json IS
  'GAME1_SCHEDULE PR1: snapshot av schedule.subGame.ticketTypesData på spawn-tidspunkt — ticket-farger, priser, prizes. Snapshot beskytter mot mal-endringer.';

COMMENT ON COLUMN app_game1_scheduled_games.jackpot_config_json IS
  'GAME1_SCHEDULE PR1: snapshot av schedule.subGame.jackpotData — { jackpotPrize: { white, yellow, purple }, jackpotDraw }.';

COMMENT ON COLUMN app_game1_scheduled_games.status IS
  'GAME1_SCHEDULE PR1: state-maskin scheduled → purchase_open → ready_to_start → running → paused → completed | cancelled.';
