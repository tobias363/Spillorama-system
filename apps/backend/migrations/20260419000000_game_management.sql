-- BIN-622: Game Management (admin-katalog av spill-varianter).
--
-- GameManagement (GM) = en spill-konfigurasjon knyttet til en GameType.
-- Legacy-opphav: legacy/unity-backend/App/Controllers/GameController.js
-- + legacy/unity-backend/App/Views/GameManagement/*.
--
-- Hver rad i app_game_management representerer ett spill-oppsett som kan
-- startes/repeteres. Felter som ticket-gen-options, prize-struktur,
-- lucky-numbers og pattern-valg holdes i `config_json` for å unngå å
-- låse skjemaet før GameType/SubGame/Pattern CRUD (BIN-620/621/627)
-- lander. De kolumnene vi *har* egne felter for, er de admin-UI viser
-- i lista (GameManagementRow i apps/admin-web/.../GameManagementState.ts).
--
-- Soft-delete: en rad merkes med deleted_at når den skal fjernes og
-- hall-historikk fortsatt trenger å peke på den. Hard-delete er også
-- støttet (service velger basert på om det finnes lenker fra andre
-- tabeller — i første omgang er alt soft-delete).
--
-- Up

CREATE TABLE IF NOT EXISTS app_game_management (
  id               TEXT PRIMARY KEY,
  -- GameType er ikke egen tabell ennå (BIN-620). Vi lagrer FK som
  -- tekst-identifikator (slug eller ObjectId-string fra legacy).
  game_type_id     TEXT NOT NULL,
  -- Valgfri FK til parent-game (legacy hadde en childId for sub-games).
  parent_id        TEXT NULL,
  name             TEXT NOT NULL,
  -- Stor billett = 5x5 klassisk, liten = 3x5 databingo-60 (legacy).
  ticket_type      TEXT NULL CHECK (ticket_type IS NULL OR ticket_type IN ('Large', 'Small')),
  -- Pris lagres i øre/cents for å matche resten av systemet.
  ticket_price     BIGINT NOT NULL DEFAULT 0 CHECK (ticket_price >= 0),
  start_date       TIMESTAMPTZ NOT NULL,
  end_date         TIMESTAMPTZ NULL,
  -- Legacy-statuser: active (planlagt), running (live), closed (ferdig),
  -- inactive (deaktivert/utkast). Pattern-match mot admin-UI-typer.
  status           TEXT NOT NULL DEFAULT 'inactive'
                     CHECK (status IN ('active', 'running', 'closed', 'inactive')),
  total_sold       BIGINT NOT NULL DEFAULT 0 CHECK (total_sold >= 0),
  total_earning    BIGINT NOT NULL DEFAULT 0 CHECK (total_earning >= 0),
  -- Alt som ikke har egen kolonne: prize_tiers, hall_group_visibility,
  -- sub_game_composition, ticket_color_list, pattern_selection, osv.
  config_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Hvis denne raden er laget via repeat-flyt, peker vi tilbake.
  repeated_from_id TEXT NULL REFERENCES app_game_management(id) ON DELETE SET NULL,
  created_by       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ NULL,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_app_game_management_type
  ON app_game_management(game_type_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_game_management_status
  ON app_game_management(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_game_management_repeated_from
  ON app_game_management(repeated_from_id)
  WHERE repeated_from_id IS NOT NULL;

COMMENT ON TABLE app_game_management IS
  'BIN-622: admin-konfigurerte spill-varianter (GameManagement). Erstatter legacy Mongo-schema Game + GameType + SubGame-joins med én tabell + config_json.';

COMMENT ON COLUMN app_game_management.config_json IS
  'BIN-622: fri-form konfig (prize tiers, hall-group visibility, sub-game composition, ticket colors, pattern selection). Skjema strammes inn når BIN-620/621/627 lander.';

COMMENT ON COLUMN app_game_management.repeated_from_id IS
  'BIN-622: hvis satt, denne raden er laget via POST /:id/repeat fra kildespill.';
