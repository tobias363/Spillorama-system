-- BIN-625: Schedule (gjenbrukbar spill-mal / sub-game-bundle).
--
-- Legacy-opphav:
--   legacy/unity-backend/App/Models/schedule.js                (Mongo-schema)
--   legacy/unity-backend/App/Controllers/scheduleController.js
--     - getSchedules                (ca. linje 209)
--     - createSchedule / createSchedulePostData  (ca. linje 288/401)
--     - editSchedule  / editSchedulePostData     (ca. linje 520/625)
--     - deleteSchedule                           (ca. linje 730)
--   legacy/unity-backend/App/Services/scheduleServices.js
--     - insertSchedulesData / getSchedulesByData / updateSchedulesData /
--       deleteSchedule
--
-- Distinksjon Schedule vs DailySchedule (BIN-626):
--   * Schedule (denne tabellen) = mal / oppskrift for ett spill eller en
--     sub-game-bundle. Inneholder ticket-farger, priser, jackpot-data,
--     elvis-data, timing (minseconds/maxseconds) osv. Én rad kan gjenbrukes
--     på tvers av mange dager og haller. `schedule_type = Auto | Manual`
--     styrer om subgames har faste start/end-tider (Auto) eller skal
--     kjøres med `manual_start_time/manual_end_time` (Manual).
--   * DailySchedule (BIN-626, `app_daily_schedules`) = kalender-rad som
--     sier «dette spillet kjører i hall X på dato Y klokken Z». Henter
--     typisk konfig fra en Schedule-mal.
--
-- Legacy-felter vi kanoniserer:
--   - `creater_id`           → created_by (FK app_users)
--   - `is_admin_schedule`    → bool (admin-opprettet vs agent-opprettet)
--   - `schedule_name`        → TEXT NOT NULL
--   - `schedule_type`        → TEXT ('Auto'|'Manual')
--   - `schedule_number`      → TEXT UNIQUE (auto-gen av service: 'SID_' + tid)
--   - `lucky_number_prize`   → BIGINT (øre)
--   - `status`               → TEXT ('active'|'inactive')
--     Legacy har bare 'active'; 'inactive' er vårt soft-delete-flag, samme
--     mønster som GameManagement/DailySchedule.
--   - `sub_games_json`       → JSONB — rik array av subgame-config. Feltene
--     (ticketTypesData, jackpotData, elvisData, minseconds, maxseconds,
--     notificationStartTime m.fl.) er fri-form fordi normalisering er
--     scope for BIN-621 (SubGame) og senere engine-bridge. Admin-UI leser
--     samme shape som legacy Mongo.
--   - `manual_start_time`/`manual_end_time` → "HH:MM" eller tom (Manual-type)
--
-- Soft-delete: `deleted_at` + status='inactive'. Hard-delete støttes bare
-- når ingen DailySchedule eksplisitt refererer malen (cross-ref løses i
-- service-laget; FK er valgfritt linket via legacy sub_games_json-ids, ikke
-- en hard referanse på mal-ID).
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_schedules (
  id                   TEXT PRIMARY KEY,
  schedule_name        TEXT NOT NULL,
  -- Legacy auto-genererert nummer, typisk 'SID_YYYYMMDD_HHMMSS'. Unik så
  -- admin-UI kan slå opp via nummer-feltet (legacy getSchedules-søk).
  schedule_number      TEXT NOT NULL UNIQUE,
  schedule_type        TEXT NOT NULL DEFAULT 'Manual'
    CHECK (schedule_type IN ('Auto','Manual')),
  lucky_number_prize   BIGINT NOT NULL DEFAULT 0 CHECK (lucky_number_prize >= 0),
  status               TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  is_admin_schedule    BOOLEAN NOT NULL DEFAULT true,
  -- Manual-type bruker disse direkte; Auto-type får dem avledet fra
  -- første/siste subgame. Service normaliserer begge veier så wire-shape
  -- er stabil.
  manual_start_time    TEXT NOT NULL DEFAULT ''
    CHECK (manual_start_time = '' OR manual_start_time ~ '^[0-9]{2}:[0-9]{2}$'),
  manual_end_time      TEXT NOT NULL DEFAULT ''
    CHECK (manual_end_time = '' OR manual_end_time ~ '^[0-9]{2}:[0-9]{2}$'),
  -- Fri-form subgame-bundle. Én eller flere objekter av form:
  --   { name, custom_game_name, start_time, end_time,
  --     notificationStartTime, minseconds, maxseconds, seconds,
  --     ticketTypesData: { ticketType[], ticketPrice[], ticketPrize[], options[] },
  --     jackpotData: { jackpotPrize, jackpotDraw },
  --     elvisData:   { replaceTicketPrice } }
  -- Service parser defensivt; ukjente felter bevares via "extra"-object.
  sub_games_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by           TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ NULL
);

-- Søk/sortering: list-endepunktet sorterer på created_at DESC. Soft-delete-
-- filter håndheves partially.
CREATE INDEX IF NOT EXISTS idx_app_schedules_created_at
  ON app_schedules(created_at DESC)
  WHERE deleted_at IS NULL;

-- Type-filter (Auto/Manual) brukt av admin-UI list-filter.
CREATE INDEX IF NOT EXISTS idx_app_schedules_type
  ON app_schedules(schedule_type)
  WHERE deleted_at IS NULL;

-- Owner-filter (AGENT-rolle ser egne + admin-opprettede).
CREATE INDEX IF NOT EXISTS idx_app_schedules_created_by
  ON app_schedules(created_by)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE app_schedules IS
  'BIN-625: gjenbrukbar spill-mal / sub-game-bundle. DISTINCT FRA app_daily_schedules (BIN-626) som er kalender-rader; en Schedule er malen, en DailySchedule er en instans.';

COMMENT ON COLUMN app_schedules.schedule_number IS
  'BIN-625: auto-generert ID (legacy SID_YYYYMMDD_HHMMSS). Unique — brukes til oppslag i admin-UI.';

COMMENT ON COLUMN app_schedules.schedule_type IS
  'BIN-625: Auto = subgames har faste start/end-tider; Manual = bruk manual_start_time/manual_end_time.';

COMMENT ON COLUMN app_schedules.sub_games_json IS
  'BIN-625: fri-form subgame-bundle. Se legacy scheduleController.createSchedulePostData for feltene. Normalisering planlagt i BIN-621 SubGame-katalogen.';
