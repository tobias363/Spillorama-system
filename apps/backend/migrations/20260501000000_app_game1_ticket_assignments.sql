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
--   * ticket_size TEXT CHECK IN ('small','large'): small = 3x3 (9 tall),
--     large = 3x9 (27 tall, 3 per kolonne i 1..9, 10..19, …, 80..90 —
--     cap'et til maxBallValue).
--   * grid_numbers_json JSONB: flat array row-major.
--     - small: 9 unike tall fra 1..maxBallValue.
--     - large: 27 elementer; `null` for tomme celler (f.eks. col 6-8 ved
--       maxBallValue=60).
--   * markings_json JSONB: { "marked": [bool, ...] } matchende
--     grid_numbers_json.length. Oppdateres av drawNext() hver gang en ny
--     kule matcher en celle.
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
  -- Grid-tallene (small = 3x3 = 9 tall, large = 3x9 = 27 tall). Flat array,
  -- row-major. For large med maxBallValue=60 vil høyere kolonner inneholde
  -- null for tomme celler.
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
  'GAME1_SCHEDULE PR4b: flat row-major array. small=9 tall (3x3), large=27 (3x9 med null for tomme celler).';

COMMENT ON COLUMN app_game1_ticket_assignments.markings_json IS
  'GAME1_SCHEDULE PR4b: { "marked": [bool, ...] }. Oppdateres av drawNext() når trukket kule matcher grid-celle.';
