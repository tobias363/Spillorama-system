-- BIN-665: HallGroup CRUD (admin-katalog av hall-grupper).
--
-- GroupHall = en navngitt gruppering av haller som Game 2 + Game 3 bruker
-- for cross-hall-spill (samme draw-stream mot flere fysiske haller). Legacy
-- Mongo-schemaet `GroupHall` hadde `halls: [{id, name, status}]` embedded
-- array — vi normaliserer det til en egen `app_hall_group_members`-tabell
-- slik at FK til `app_halls` kan håndheves.
--
-- Legacy-opphav:
--   legacy/unity-backend/App/Controllers/groupHallController.js
--     - groupHallView              → liste-side
--     - getGroupHall                → DataTable API
--     - addGroupHall / addGroupHallPostData → POST
--     - editGroupHall / editGroupHallPostData → PATCH
--     - getGroupHallDelete          → DELETE (sjekket aktive/upcoming games)
--     - getAvailableGroupHalls      → filtrert liste per gameType+tidsrom
--
-- Legacy-felt bevart: `legacy_group_hall_id` (GH_<timestamp>-formatet) og
-- `tv_id` (TV-skjerm-ID) — sistnevnte brukes av hall-TV-endpoint, se BIN-617.
--
-- Delete-policy (matches service-laget):
--   - Soft-delete default (sett deleted_at).
--   - Hard-delete blokkeres hvis gruppen er referert fra:
--       - `app_daily_schedules.groupHallIds` (JSON array)
--       - `app_game_management.config_json` (potensielt)
--   - Med soft-delete: medlemsskap bevares (arkiv-sporbarhet) men gruppen
--     er usynlig i default-list og får status 'inactive'.
--
-- Up

CREATE TABLE IF NOT EXISTS app_hall_groups (
  id                  TEXT PRIMARY KEY,
  -- Legacy-format (f.eks. "GH_20220919_032458") — bevart for bakover-
  -- kompatibilitet med daily_schedules.groupHallIds som kan referere
  -- både ny UUID-id og gamle GH_ -id-strenger.
  legacy_group_hall_id TEXT NULL,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
  -- TV-skjerm-ID (numerisk) — brukes av hall-TV-streaming, se BIN-617.
  tv_id               INTEGER NULL,
  -- Produkter knyttet til gruppen (legacy GroupHall.products-array av
  -- product-ids). Bevart som JSON inntil BIN-620 normaliserer produkter.
  products_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Fri-form fallback for legacy-felter som ikke har egen kolonne.
  extra_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_app_hall_groups_status
  ON app_hall_groups(status)
  WHERE deleted_at IS NULL;

-- Unikt navn — partial index slik at soft-slettede grupper ikke okkuperer
-- navnet. Legacy-koden sjekket duplikat-navn før insert, så dette er trygt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_hall_groups_name
  ON app_hall_groups(name)
  WHERE deleted_at IS NULL;

-- Unikt legacy-id hvis satt — for re-importerte rader.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_hall_groups_legacy_id
  ON app_hall_groups(legacy_group_hall_id)
  WHERE legacy_group_hall_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE app_hall_groups IS
  'BIN-665: admin-konfigurerte hall-grupper (cross-hall spill). Erstatter legacy Mongo-schema GroupHall.';

COMMENT ON COLUMN app_hall_groups.legacy_group_hall_id IS
  'BIN-665: legacy-format (GH_<timestamp>). Bevart for daily_schedules.groupHallIds bakover-kompatibilitet.';

COMMENT ON COLUMN app_hall_groups.tv_id IS
  'BIN-665: TV-skjerm-ID (numerisk) — brukes av hall-TV-streaming. Legacy goh.tvId.';

-- Member-tabell: many-to-many mellom hall_groups og halls. FK til app_halls
-- håndheves — sletting av en hall setter ON DELETE CASCADE for å rydde opp
-- gruppe-medlemskapet automatisk. (Hall-delete er sjelden og blokkeres når
-- det er aktive shifts/tickets — se BIN-663 hall-service.)

CREATE TABLE IF NOT EXISTS app_hall_group_members (
  group_id            TEXT NOT NULL REFERENCES app_hall_groups(id) ON DELETE CASCADE,
  hall_id             TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, hall_id)
);

CREATE INDEX IF NOT EXISTS idx_app_hall_group_members_hall
  ON app_hall_group_members(hall_id);

CREATE INDEX IF NOT EXISTS idx_app_hall_group_members_group
  ON app_hall_group_members(group_id);

COMMENT ON TABLE app_hall_group_members IS
  'BIN-665: many-to-many mellom hall_groups og halls. FK til app_halls. Legacy GroupHall.halls array normalisert.';
