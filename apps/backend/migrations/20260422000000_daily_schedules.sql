-- BIN-626: DailySchedule (daglig spill-plan per hall).
--
-- Legacy-opphav:
--   legacy/unity-backend/App/Models/dailySchedule.js      (Mongo-schema)
--   legacy/unity-backend/App/Controllers/scheduleController.js
--     - createDailySchedulePostData  (ca. linje 1318)
--     - editDailySchedulePostData    (ca. linje 2217)
--     - viewDailySchedule            (ca. linje 2289)
--     - deleteDailySchedule          (ca. linje 2394)
--   legacy/unity-backend/App/Services/scheduleServices.js
--     - getDailySchedulesByData / insertDailySchedulesData / …
--
-- Ett DailySchedule representerer én plan-rad som forteller hvilke spill
-- (GameManagement-rader, se BIN-622) som skal kjøres i en bestemt hall
-- på en gitt dag/uke, og eventuelt spesialdag (`special_game = true`).
-- Feltene som holder sub-game-komposisjon (rekkefølge, pris per slot,
-- prize-pool per slot) er mer dynamiske enn skjemaet vårt tåler i
-- første omgang — de lagres i `subgames_json` (array av objekter).
-- Når BIN-621/627 (SubGame/Pattern CRUD) lander, normaliseres subgames
-- ut i egen tabell. Denne JSON-en er derfor eksplisitt "fri-form" i første
-- versjon, og normalisering er tracked som follow-up.
--
-- Key felter:
--   - `game_management_id`: FK til app_game_management (BIN-622). Nullable
--     fordi legacy hadde dager uten assosiert GameManagement (f.eks.
--     stop_game = true som bare blokkerer salg).
--   - `hall_id`: FK til app_halls. Nullable fordi legacy støtter
--     "master-hall" + "group-halls" der flere haller kjører samme plan.
--     Når hall_id er NULL ligger den faktiske hall-listen i
--     `hall_ids_json` (TEXT[]-representasjon i JSON).
--   - `week_days`: bitmask mon=1..sun=64 (matcher admin-web
--     apps/admin-web/src/pages/games/dailySchedules/DailyScheduleState.ts).
--   - `start_time`/`end_time`: "HH:MM"-streng. Legacy bruker strenger,
--     ikke timestamps, siden planene er relative til hallens åpningstid.
--   - `status`: 'active' | 'running' | 'finish' | 'inactive'. Legacy hadde
--     bare de tre første; vi legger til 'inactive' for soft-delete-flyt
--     (samme pattern som GameManagement).
--   - `stop_game`: blokkerer at salg/kjøring faktisk skjer denne dagen.
--   - `special_game`: special-schedule (helligdager, events).
--   - `is_saved_game` / `is_admin_saved_game`: legacy-flags for lagrede
--     mal-planer som kan gjenbrukes.
--
-- Soft-delete: `deleted_at` + status = 'inactive'. Hard-delete kun når
-- planen aldri har vært kjørt (`status IN ('active','inactive')` og
-- innsatsen er 0). Samme mønster som BIN-622.
--
-- Up

CREATE TABLE IF NOT EXISTS app_daily_schedules (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  -- FK til GameManagement (BIN-622). Nullable: en plan-rad kan ha
  -- stop_game=true uten assosiert GameManagement.
  game_management_id  TEXT NULL REFERENCES app_game_management(id) ON DELETE SET NULL,
  -- FK til app_halls. Nullable når hall-listen ligger i hall_ids_json
  -- (multi-hall-plan).
  hall_id             TEXT NULL REFERENCES app_halls(id) ON DELETE SET NULL,
  -- Legacy: halls + groupHalls + allHallsId + masterHall. Vi lagrer som
  -- JSON-objekt med {masterHallId, hallIds, groupHallIds} så admin-UI
  -- kan rebuilde multi-hall-oppsettet. Når app-domain stabiliserer seg
  -- normaliseres dette til egen tabell (follow-up).
  hall_ids_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Weekday bitmask: mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64.
  week_days           INTEGER NOT NULL DEFAULT 0 CHECK (week_days >= 0 AND week_days <= 127),
  -- Én-dag-variant (legacy "day"-feltet) når week_days ikke brukes.
  day                 TEXT NULL
    CHECK (day IS NULL OR day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  start_date          TIMESTAMPTZ NOT NULL,
  end_date            TIMESTAMPTZ NULL,
  start_time          TEXT NOT NULL DEFAULT '' CHECK (start_time = '' OR start_time ~ '^[0-9]{2}:[0-9]{2}$'),
  end_time            TEXT NOT NULL DEFAULT '' CHECK (end_time = '' OR end_time ~ '^[0-9]{2}:[0-9]{2}$'),
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','running','finish','inactive')),
  stop_game           BOOLEAN NOT NULL DEFAULT false,
  special_game        BOOLEAN NOT NULL DEFAULT false,
  is_saved_game       BOOLEAN NOT NULL DEFAULT false,
  is_admin_saved_game BOOLEAN NOT NULL DEFAULT false,
  -- Innsatsenes totale salg (legacy "innsatsenSales"). Øre.
  innsatsen_sales     BIGINT NOT NULL DEFAULT 0 CHECK (innsatsen_sales >= 0),
  -- Fri-form subgame-komposisjon: array av {subGameId, index, ticketPrice,
  -- prizePool, patternId, status, …}. Ved normalisering (BIN-621/627)
  -- flyttes hver rad ut i app_daily_schedule_subgames.
  subgames_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Legacy "otherData" for lukke-dager / custom-state. Fri-form.
  other_data_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_app_daily_schedules_game_management
  ON app_daily_schedules(game_management_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_daily_schedules_hall
  ON app_daily_schedules(hall_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_daily_schedules_status
  ON app_daily_schedules(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_daily_schedules_week_days
  ON app_daily_schedules(week_days)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_daily_schedules_start_date
  ON app_daily_schedules(start_date DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE app_daily_schedules IS
  'BIN-626: daglig spill-plan per hall. Kobler GameManagement (BIN-622) til hall + tidspunkt. Sub-game-komposisjon i subgames_json inntil BIN-621/627 normaliserer.';

COMMENT ON COLUMN app_daily_schedules.week_days IS
  'BIN-626: weekday bitmask (mon=1..sun=64). 0 = bruk "day"-feltet eller kun-dato.';

COMMENT ON COLUMN app_daily_schedules.subgames_json IS
  'BIN-626: fri-form subgame-komposisjon. Normaliseres ut når BIN-621/627 lander.';

COMMENT ON COLUMN app_daily_schedules.hall_ids_json IS
  'BIN-626: multi-hall-plan-config. {masterHallId, hallIds[], groupHallIds[]}. Tom når hall_id er satt (single-hall-plan).';
