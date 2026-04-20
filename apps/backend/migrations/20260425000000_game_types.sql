-- BIN-620: GameType CRUD (admin-katalog av spill-typer).
--
-- GameType = topp-nivå katalog av spill-varianter som backend + admin-UI
-- + dashboard viser i dropdowns. Legacy Mongo-schema `gameType` (se
-- legacy/unity-backend/App/Models/gameType.js) hadde felt:
--   {name, type, pattern, photo, row, columns, totalNoTickets,
--    userMaxTickets, pickLuckyNumber, rangeMin, rangeMax, ...}
--
-- Vi normaliserer til `app_game_types` med egne kolonner for de feltene
-- som admin-UI/backend-engine bruker aktivt, resten i `extra_json` som
-- fri-form fallback. Discriminator `type_slug` (f.eks. "game_1") er
-- stabil referent-id som app_game_management.game_type_id + app_patterns
-- .game_type_id + app_sub_games.game_type_id peker til.
--
-- Legacy-opphav:
--   legacy/unity-backend/App/Controllers/GameTypeController.js
--     - gameTypeView               → liste-side
--     - getGameType                → DataTable API
--     - addGameType / postAddGameType → POST
--     - editGameType / postEditGameType → PATCH
--     - getGameTypeDelete          → DELETE
--     - viewGameType               → detalj-side
--
-- Legacy slug-konvensjoner bevart: "game_1"..."game_5" (Game 4 er
-- DEPRECATED BIN-496 men bevart historisk; admin-UI filtrerer via
-- GAME_TYPE_HIDDEN_FROM_DROPDOWN-sett). Nye slugs kan legges til via
-- admin-CRUD.
--
-- Delete-policy (matches service-laget):
--   - Soft-delete default (sett deleted_at + status='inactive').
--   - Hard-delete blokkeres hvis GameType er referert fra:
--       - `app_game_management.game_type_id` (aktive spill-oppsett)
--       - `app_patterns.game_type_id` (mønster-katalog)
--       - `app_sub_games.game_type_id` (sub-game-katalog, BIN-621)
--
-- Up

CREATE TABLE IF NOT EXISTS app_game_types (
  id                  TEXT PRIMARY KEY,
  -- Stabil slug-id som andre tabeller peker til (f.eks. "game_1", "bingo").
  -- Admin-UI og backend bruker denne som kanonisk referent.
  type_slug           TEXT NOT NULL,
  name                TEXT NOT NULL,
  -- Photo-referanse (legacy static-path under /profile/bingo/).
  photo               TEXT NOT NULL DEFAULT '',
  -- Støtter mønsterbingo (Game 1 + Game 3). Styrer admin-UI dropdowns.
  pattern             BOOLEAN NOT NULL DEFAULT false,
  -- Ticket-grid (legacy lagret som string, vi bruker integer).
  grid_rows           INTEGER NOT NULL DEFAULT 5 CHECK (grid_rows > 0),
  grid_columns        INTEGER NOT NULL DEFAULT 5 CHECK (grid_columns > 0),
  -- Billett-ranger (legacy rangeMin/rangeMax som strings).
  range_min           INTEGER NULL,
  range_max           INTEGER NULL,
  -- Maks antall billetter totalt i et spill (legacy totalNoTickets).
  total_no_tickets    INTEGER NULL CHECK (total_no_tickets IS NULL OR total_no_tickets > 0),
  -- Maks antall billetter per bruker (legacy userMaxTickets).
  user_max_tickets    INTEGER NULL CHECK (user_max_tickets IS NULL OR user_max_tickets > 0),
  -- Lucky-number-picker (legacy pickLuckyNumber array).
  lucky_numbers_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
  -- Fri-form fallback for legacy-felter som ikke har egen kolonne.
  extra_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL,
  CHECK (range_min IS NULL OR range_max IS NULL OR range_max >= range_min)
);

-- Unikt type_slug — partial index slik at soft-slettede rader ikke
-- okkuperer slug. Admin-CRUD bruker denne for duplikat-sjekk.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_game_types_type_slug
  ON app_game_types(type_slug)
  WHERE deleted_at IS NULL;

-- Unikt navn — partial index, samme prinsipp.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_game_types_name
  ON app_game_types(name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_game_types_status
  ON app_game_types(status)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE app_game_types IS
  'BIN-620: admin-konfigurerte spill-typer (topp-nivå katalog). Erstatter legacy Mongo-schema gameType. type_slug er stabil referent fra app_game_management, app_patterns, app_sub_games.';

COMMENT ON COLUMN app_game_types.type_slug IS
  'BIN-620: stabil slug-id ("game_1", "bingo", osv.). Kanonisk referent fra andre tabeller. Game 4 er DEPRECATED (BIN-496) men bevart historisk.';

COMMENT ON COLUMN app_game_types.extra_json IS
  'BIN-620: fri-form fallback for legacy-felter (noRange, numberRange, subGameId-array, o.l.).';
