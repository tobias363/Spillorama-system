-- GAME1_SCHEDULE PR 4b: app_game1_ticket_assignments — én rad per fysisk-
-- digital billett assignet til spilleren ved start av scheduled_game.
--
-- Spec: GAME1_SCHEDULE PR 4b (draw-engine core, Alt 3 parallell draw-strøm).
--
-- Formål: grid-tall genereres ved game-start (ikke ved purchase — det er
-- legacy semantikk). Én rad per enkeltbillett som kjøpes gjennom en
-- purchase-spec; sequence_in_purchase nummererer billettene innenfor
-- samme purchase (1-indexed) for audit og for ticket-rendering.
--
-- Designvalg:
--   * scheduled_game_id FK → app_game1_scheduled_games(id) ON DELETE RESTRICT:
--     assignments skal bevares selv om planen endres (audit + payout).
--   * purchase_id FK → app_game1_ticket_purchases(id) ON DELETE RESTRICT:
--     kobling tilbake til purchase som genererte billetten.
--   * buyer_user_id / hall_id denormalisert for enkle queries uten JOIN.
--   * ticket_color TEXT: farge fra ticket_spec ("yellow", "white", "purple",
--     "red", "green", "orange", "elvis1"-"elvis5"). Brukes av UI-rendering.
--   * ticket_size TEXT CHECK IN ('small','large'): LEGACY PRISKATEGORI.
--     Påvirker kun pris-oppslag og UI-rendering — IKKE grid-format. Alle Spill
--     1-bretter er 5x5 (25 celler). Tobias' PM-avklaring 2026-04-21:
--     "5x5 er det eneste riktige formatet for Spill 1".
--   * grid_numbers_json JSONB: flat row-major array av 25 celler (5x5). Index
--     12 (row 2, col 2) = 0 (free centre, alltid markert). Øvrige celler er
--     tall fra 1..maxBallValue, fordelt proporsjonalt per kolonne (f.eks.
--     maxBallValue=75 → col 0=1..15, col 1=16..30, col 2=31..45, col 3=46..60,
--     col 4=61..75). `null` tillatt for padding hvis en kolonne ikke har nok
--     tall (sjelden — kun ved svært lav maxBallValue).
--   * markings_json JSONB: { "marked": [bool × 25] } matchende grid. Index 12
--     er alltid true (free centre). Oppdateres av drawNext() når trukket kule
--     matcher en ikke-0-celle.
--   * sequence_in_purchase INT: 1-indexed rekkefølge innenfor purchase.
--     UNIQUE(purchase_id, sequence_in_purchase) hindrer dobbel-generering.
--
-- Indexer:
--   * (scheduled_game_id): draw-engine enumererer alle assignments når kule
--     trekkes for å oppdatere markings.
--   * (buyer_user_id, scheduled_game_id): "mine brett" i spiller-UI.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_ticket_assignments (
  id                    TEXT PRIMARY KEY,
  scheduled_game_id     TEXT NOT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  purchase_id           TEXT NOT NULL
                          REFERENCES app_game1_ticket_purchases(id) ON DELETE RESTRICT,
  buyer_user_id         TEXT NOT NULL
                          REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id               TEXT NOT NULL
                          REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Farge fra ticket_spec: "yellow" | "white" | "purple" | "red" | "green" |
  -- "orange" | "elvis1"-"elvis5".
  ticket_color          TEXT NOT NULL,
  ticket_size           TEXT NOT NULL
                          CHECK (ticket_size IN ('small','large')),
  -- Grid-tallene: 5x5 flat row-major array (25 celler). Index 12 = 0
  -- (free centre, alltid markert). ticket_size er LEGACY PRISKATEGORI og
  -- påvirker IKKE grid-format (Tobias' spec 2026-04-21).
  grid_numbers_json     JSONB NOT NULL,
  -- Rekkefølge-nummer innenfor samme purchase (1-indexed) for audit.
  sequence_in_purchase  INTEGER NOT NULL CHECK (sequence_in_purchase >= 1),
  -- Marking: hvilke grid-celler er markert (dekket av trukket kule).
  -- Format: { "marked": [bool, bool, ...] } matchende grid_numbers_json.length.
  markings_json         JSONB NOT NULL DEFAULT '{"marked":[]}'::jsonb,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, sequence_in_purchase)
);

CREATE INDEX IF NOT EXISTS idx_game1_assignments_scheduled_game
  ON app_game1_ticket_assignments(scheduled_game_id);

CREATE INDEX IF NOT EXISTS idx_game1_assignments_buyer
  ON app_game1_ticket_assignments(buyer_user_id, scheduled_game_id);

COMMENT ON TABLE app_game1_ticket_assignments IS
  'GAME1_SCHEDULE PR4b: én rad per fysisk-digital billett for Game 1 scheduled_game. Grid-tall genereres ved startGame() i Game1DrawEngineService.';

COMMENT ON COLUMN app_game1_ticket_assignments.grid_numbers_json IS
  'GAME1_SCHEDULE PR4b/4c: flat row-major 5x5 (25 celler). Index 12 = 0 (free centre, alltid markert). Tall 1..maxBallValue fordelt proporsjonalt per kolonne (f.eks. maxBallValue=75 → col 0=1..15, col 4=61..75).';

COMMENT ON COLUMN app_game1_ticket_assignments.markings_json IS
  'GAME1_SCHEDULE PR4b/4c: { "marked": [bool × 25] }. Index 12 (free centre) alltid true. Oppdateres av drawNext() når trukket kule matcher grid-celle.';
