-- BIN-624: SavedGame CRUD (admin-templates — gjenbrukbare spill-oppsett).
--
-- SavedGame = navngitt template som admin lagrer slik at et komplett
-- GameManagement-oppsett (ticket-farger, priser, patterns, subgames, days,
-- seconds, betMultiplier, halls, prize-tiers, ...) kan brukes som grunnlag
-- for et nytt spill via "load-to-game"-flyten. Legacy `savedGame` Mongo-
-- kolleksjonen (se legacy/unity-backend/App/Models/savedGame.js) samlet
-- ~50 felter i samme dokument. I første versjon bevarer vi hele legacy-
-- payloaden som `config_json` — normalisering er ikke nødvendig siden
-- SavedGame aldri kjøres som spill; den kopieres inn i et GameManagement-
-- oppsett (BIN-622) som har egne kolonner for de aktive feltene.
--
-- Legacy-opphav:
--   legacy/unity-backend/App/Controllers/GameController.js (ingen egen
--     savedGameController — savedGame-endpoints lå i GameController):
--     - savedGameList              → liste-side
--     - savedGameDetailList        → type-scoped detalj
--     - getSavedGameDetailList     → DataTable API
--     - addSavedGameManagement     → POST (oppretter en SavedGame basert
--                                    på gameAdd-formen)
--     - savedGameManagementEdit    → PATCH
--     - (delete)                   → soft-delete via status/flag
--     - isSavedGame=true i createGameManagement → load-to-game-semantikk
--       (oppretter et nytt Game basert på savedGame.extra)
--   legacy/unity-backend/App/Services/GameService.js:
--     - insertSavedGameData / getSavedGame / getByIdSavedGames
--     - updateSaveGameData / getSingleSavedGameData
--     - getSelectedSavedGameCount
--
-- Felt-mapping (legacy → Postgres):
--   - `gameTypeId` (legacy `gameType` slug + `gameTypeId` _id) →
--     `game_type_id` (slug-referent, stabilt id matches app_game_types.type_slug).
--   - `gameName`  → `name`
--   - `gameNumber` → bevart i `config_json.gameNumber` (auto-generert i legacy).
--   - Alle runtime-felter (history, withdrawNumberList, currentPatternList,
--     players, winners, purchasedTickets, socketId, timerStart) utelates —
--     SavedGame er template, ikke session.
--   - Alle template-felter (ticketPrice, luckyNumberPrize, seconds,
--     betMultiplier, patternNamePrice, betAmount, subGames, groupHalls,
--     halls, days, trafficLightExtraOptions, isMasterGame, mainGameName,
--     otherData, ...) bevares i `config_json`.
--   - `isAdminSave` → `is_admin_save` BOOLEAN (legacy filter-flag for
--     DataTable-queries).
--   - `status` → `status` (active|inactive). Legacy hadde tre states
--     (active/running/finish) men template-rader er aldri running/finish.
--
-- Delete-policy:
--   - Soft-delete default (sett deleted_at + status='inactive').
--   - Hard-delete er alltid tillatt (ingen andre tabeller refererer
--     SavedGame — load-to-game kopierer config_json, etterlater ingen FK).
--
-- Up

CREATE TABLE IF NOT EXISTS app_saved_games (
  id                  TEXT PRIMARY KEY,
  -- Referent til app_game_types.type_slug (f.eks. "game_1"). Vi bruker TEXT
  -- (ikke FK) av samme grunn som SubGame — legacy bruker slug-strenger.
  game_type_id        TEXT NOT NULL,
  -- Display-navn på SavedGame-malen (unik per gameType, soft-delete-aware).
  name                TEXT NOT NULL,
  -- Legacy `isAdminSave`-flag (true hvis ADMIN opprettet; styrer om HALL_OPERATOR
  -- kan se malen i lister). Fallback-default true matcher legacy-schema.
  is_admin_save       BOOLEAN NOT NULL DEFAULT true,
  -- Komplett legacy-payload (alle template-felter). Wire-formatet eksponerer
  -- dette som `config` (Record<string, unknown>) — service normaliserer ikke
  -- i v1 siden SavedGame er ren template-kopi for GameManagement.
  config_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
  created_by          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

-- Unikt navn per gameType — partial index så soft-slettede rader frigjør
-- navnet. Legacy hadde ingen unique-constraint, men admin-UI krever
-- duplikat-sjekk (checkForGameName-mønsteret fra BIN-621 SubGame).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_saved_games_name_per_type
  ON app_saved_games(game_type_id, name)
  WHERE deleted_at IS NULL;

-- Filter-indekser for liste-views (per-gameType + status).
CREATE INDEX IF NOT EXISTS idx_app_saved_games_game_type
  ON app_saved_games(game_type_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_saved_games_status
  ON app_saved_games(status)
  WHERE deleted_at IS NULL;

-- Filter-indeks for "mine lagrede spill" (createrId-lookup fra legacy).
CREATE INDEX IF NOT EXISTS idx_app_saved_games_created_by
  ON app_saved_games(created_by)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE app_saved_games IS
  'BIN-624: admin-konfigurerte SavedGame-templates (gjenbrukbare GameManagement-oppsett). Erstatter legacy Mongo-kolleksjonen savedGame. Brukes av load-to-game-flyten for å seed'' et nytt GameManagement-oppsett fra en lagret mal.';

COMMENT ON COLUMN app_saved_games.game_type_id IS
  'BIN-624: referent til app_game_types.type_slug (stabil slug). Service-laget håndhever lookup; ingen DB-level FK siden type_slug ikke har PK-garanti på tvers av soft-slettede GameType-rader.';

COMMENT ON COLUMN app_saved_games.config_json IS
  'BIN-624: komplett template-payload (alle legacy savedGame-felter unntatt runtime-state). Kopieres til app_game_management.config_json av load-to-game-flyten.';

COMMENT ON COLUMN app_saved_games.is_admin_save IS
  'BIN-624: legacy isAdminSave-flag. True = ADMIN opprettet (synlig for alle); false = agent/operator (kun synlig for creator + ADMIN i liste-queries).';
