-- BIN-621: SubGame CRUD (admin-katalog av gjenbrukbare pattern-bundles).
--
-- SubGame = en navngitt mal som bundler et sett mønster-referanser +
-- ticket-farge-liste, som DailySchedule (BIN-626) binder inn i
-- `subgames_json` for å kjøre en preconfigured kombinasjon. En SubGame er
-- ikke i seg selv et kjørbart spill; det er admin-katalog-entiteten som
-- gir DailySchedule-oppsett rask tilgang til gjentagelige pattern-oppsett.
--
-- Legacy Mongo-schema `subGame1` (se legacy/unity-backend/App/Models/subGame1.js
-- og legacy/unity-backend/App/Controllers/subGameController.js) hadde feltene:
--   {subGameId, gameName, patternRow: [{_id,name,patternId,patternType,...}],
--    allPatternRowId, status, ticketColor: [{name, type}], gameType}
--
-- Vi normaliserer slik at:
--   - `game_type_id` peker til app_game_types.type_slug (stabil referent).
--   - `pattern_rows_json` bevarer legacy patternRow-strukturen som JSON
--     (kan normaliseres senere hvis det blir behov). Service-laget
--     eksponerer et forenklet {patternId, name}-format på wire.
--   - `ticket_colors_json` bevarer farge-liste (legacy var array av
--     {name, type}-objekter; wire-formatet er string[] — type-feltet er en
--     deriverbar slug som service kan rekonstruere ved behov).
--   - `sub_game_number` bevarer legacy auto-increment ("SG_<timestamp>").
--
-- Legacy-opphav (controllers + services):
--   legacy/unity-backend/App/Controllers/subGameController.js
--     - subGame1 / subGame1List         → liste-side + DataTable
--     - addSubGame / addSubGamePostData → POST
--     - editSubGame / editSubGamePostData → PATCH
--     - getSubGameDelete                → DELETE
--     - viewSubGame                     → detalj-side
--     - checkForGameName                → duplikat-sjekk
--
-- Delete-policy (matches service-laget):
--   - Soft-delete default (sett deleted_at + status='inactive').
--   - Hard-delete blokkeres hvis SubGame er referert fra:
--       - `app_daily_schedules.subgames_json` (JSON array av subGame-ids)
--       - `app_game_management.config_json` (potensielt via subGameId-
--         array — bevart fra legacy).
--     Ved soft-delete bevares historiske schedule-referanser intakt.
--
-- Up

CREATE TABLE IF NOT EXISTS app_sub_games (
  id                  TEXT PRIMARY KEY,
  -- Referent til app_game_types.type_slug (stabil slug-id). Vi bruker TEXT
  -- (ikke FK) for å speile legacy-designet hvor game_type lagres som slug-
  -- streng ("game_1", "bingo"). Referent-integritet håndheves i service-
  -- laget (lookup via GameTypeService.getBySlug før insert/update).
  game_type_id        TEXT NOT NULL,
  -- Display-navn på game-type ("Game1", "Game3") — ikke unik, kun label.
  -- Legacy subGame.gameName-feltet.
  game_name           TEXT NOT NULL,
  -- Visnings-navn på SubGame-malen (unikt per gameType).
  name                TEXT NOT NULL,
  -- Legacy auto-increment ("SG_<timestamp>") — bevart for bakover-
  -- kompatibilitet med daily_schedules.subgames_json som kan referere
  -- både nye UUID-ids og gamle SG_-strenger.
  sub_game_number     TEXT NOT NULL,
  -- Legacy patternRow — array av {_id, name, patternId, patternType, ...}.
  -- Vi bevarer som JSON inntil service-laget normaliserer til egen tabell.
  -- Wire-formatet er forenklet til {patternId, name}[]; de øvrige legacy-
  -- feltene (patternType, isWoF, ...) bevares i JSON for read-back.
  pattern_rows_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Legacy ticketColor — array av {name, type}. Wire-formatet er string[]
  -- (kun navn); type deriveres (lower-camel-case av navn) av service.
  ticket_colors_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
  -- Fri-form fallback for legacy-felter som ikke har egen kolonne
  -- (f.eks. creationDateTime, allPatternRowId, eller fremtidige felt).
  extra_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

-- Unikt navn per gameType — partial index slik at soft-slettede rader ikke
-- okkuperer navnet og slik at duplikater innenfor samme gameType blokkeres
-- (matches legacy checkForGameName-logikken, som sjekket globalt, men vi
-- strammer til per-gameType for å unngå kollisjon mellom Game1/Game3-maler).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_sub_games_name_per_type
  ON app_sub_games(game_type_id, name)
  WHERE deleted_at IS NULL;

-- Unikt sub_game_number — partial index (legacy-format bevares per row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_sub_games_sub_game_number
  ON app_sub_games(sub_game_number)
  WHERE deleted_at IS NULL;

-- Filter-indekser for liste-views (status-filter + per-gameType).
CREATE INDEX IF NOT EXISTS idx_app_sub_games_game_type
  ON app_sub_games(game_type_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_sub_games_status
  ON app_sub_games(status)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE app_sub_games IS
  'BIN-621: admin-konfigurerte SubGame-maler (navngitte bundles av pattern-ids + ticket-farger). Erstatter legacy Mongo-schema subGame1. Referenced by app_daily_schedules.subgames_json.';

COMMENT ON COLUMN app_sub_games.game_type_id IS
  'BIN-621: referent til app_game_types.type_slug (stabil slug). Service-laget håndhever lookup; ingen DB-level FK siden type_slug ikke har PK-garanti på tvers av soft-slettede rader.';

COMMENT ON COLUMN app_sub_games.pattern_rows_json IS
  'BIN-621: legacy patternRow-array (bevart som JSON). Wire-format er forenklet til {patternId, name}[]; øvrige legacy-felter bevares for read-back.';

COMMENT ON COLUMN app_sub_games.ticket_colors_json IS
  'BIN-621: ticket-farge-liste. Lagret som JSON-array for enkel utveksling med legacy-schedule-snippets.';

COMMENT ON COLUMN app_sub_games.sub_game_number IS
  'BIN-621: legacy-format (SG_<timestamp>). Bevart for daily_schedules.subgames_json bakover-kompatibilitet.';
