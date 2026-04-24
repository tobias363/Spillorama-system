-- BIN-GAP#4 (wireframe 17.15 / 15.2) — Register Sold Tickets scanner med
-- carry-forward per spill + ticket-type.
--
-- Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.2 Register Sold Tickets"
--       docs/architecture/WIREFRAME_CATALOG.md § "15.10 Register More Tickets Modal"
--
-- Formål:
--   En agent registrerer per Game 1-instans hvor mange bonger som ble solgt
--   av hver ticket-type (Small Yellow, Small White, Large Yellow, Large White,
--   Small Purple, Large Purple). Per (game, hall, type) finnes én rad som
--   holder:
--     - initial_id: laveste ID i denne batch (carry-forward fra forrige spill,
--       eller fra hall-inventoriets startpunkt for første spill).
--     - final_id: høyeste ID scannet av agenten etter salg (usolgte bonger
--       begynner her i neste runde).
--     - sold_count: antall solgte bonger = final_id - initial_id (enkelt
--       numerisk område, ikke skip-step).
--     - round_number: rekkefølge av rundene i samme hall + type (1-basert).
--     - carried_from_game_id: forrige spill i samme hall + type (carry-forward
--       audit-trail). NULL ved første runde.
--
-- Designvalg:
--   * Separat fra `app_agent_ticket_ranges` fordi dette er et enklere model:
--     én rad per (game, hall, ticket_type) med numerisk initial/final, ikke
--     en JSONB-array av serials. PT2-flyten er barcode-first; 15.2-flyten er
--     counter-first. Begge eksisterer samtidig fordi de representerer ulike
--     salgs-scenarier.
--   * `ticket_type` er TEXT med CHECK — matcher wireframe-katalogens 6 typer.
--   * `sold_count` persisteres (ikke bare beregnet) for rapport-ytelse og
--     for å kunne overstyre ved spesielle scenarier (f.eks. ugyldig bong i
--     intervallet som må trekkes ut).
--   * UNIQUE (game_id, hall_id, ticket_type) — én rad per tuple. Insert eller
--     update er triggered av recordFinalIds-servicen.
--   * `carried_from_game_id` er self-referencing audit-link, ON DELETE SET NULL
--     for å beholde carry-forward-spor når game_id slettes.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up

CREATE TABLE IF NOT EXISTS app_ticket_ranges_per_game (
  id                    TEXT PRIMARY KEY,
  game_id               TEXT NOT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE CASCADE,
  hall_id               TEXT NOT NULL
                          REFERENCES app_halls(id) ON DELETE RESTRICT,
  ticket_type           TEXT NOT NULL
                          CHECK (ticket_type IN (
                            'small_yellow',
                            'small_white',
                            'large_yellow',
                            'large_white',
                            'small_purple',
                            'large_purple'
                          )),
  initial_id            INTEGER NOT NULL CHECK (initial_id >= 0),
  final_id              INTEGER NULL CHECK (final_id IS NULL OR final_id >= initial_id),
  sold_count            INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  round_number          INTEGER NOT NULL DEFAULT 1 CHECK (round_number >= 1),
  carried_from_game_id  TEXT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE SET NULL,
  recorded_by_user_id   TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  recorded_at           TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_ticket_ranges_per_game IS 'Register Sold Tickets-flyt (wireframe 15.2): per-game per-hall per-ticket-type range med initial_id (carry-forward) + final_id (scannet etter salg).';
COMMENT ON COLUMN app_ticket_ranges_per_game.ticket_type          IS 'En av 6 typer: small_yellow, small_white, large_yellow, large_white, small_purple, large_purple.';
COMMENT ON COLUMN app_ticket_ranges_per_game.initial_id           IS 'Laveste ID i range (inklusiv). Carry-forward: nye rader arver verdien fra forrige rundes final_id for samme (hall, type).';
COMMENT ON COLUMN app_ticket_ranges_per_game.final_id             IS 'Høyeste ID scannet (inklusiv). NULL = ennå ikke registrert (pre-salg). Brukes også som initial_id for neste runde.';
COMMENT ON COLUMN app_ticket_ranges_per_game.sold_count           IS 'Persistert final_id - initial_id + 1 (hvis final_id IS NOT NULL). 0 før registrering.';
COMMENT ON COLUMN app_ticket_ranges_per_game.round_number         IS '1-basert rekkefølge for samme (hall, type). 1 = første runde fra hall-startpunkt.';
COMMENT ON COLUMN app_ticket_ranges_per_game.carried_from_game_id IS 'Audit-trail for carry-forward: forrige game_id i samme (hall, type). NULL for første runde.';

-- UNIQUE: én rad per (game, hall, type) tuple.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_ranges_per_game_unique
  ON app_ticket_ranges_per_game (game_id, hall_id, ticket_type);

-- Carry-forward-oppslag: "finn forrige runde for (hall, type)". Sortert på
-- round_number DESC for raskeste LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_ticket_ranges_per_game_hall_type_round
  ON app_ticket_ranges_per_game (hall_id, ticket_type, round_number DESC);

-- Rapport/summary-oppslag per game.
CREATE INDEX IF NOT EXISTS idx_ticket_ranges_per_game_game
  ON app_ticket_ranges_per_game (game_id);
