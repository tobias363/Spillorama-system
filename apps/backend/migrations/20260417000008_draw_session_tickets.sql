-- Blokk 3.2 — Digital draw-session tickets (player-owned, persisted).
--
-- Papir-bong har sin egen inventar-tabell (`app_static_tickets`) + range-
-- tilknytning via `app_agent_ticket_ranges`. Digitale bonger trenger et
-- parallelt, men enklere, lager: en rad per bong kjøpt fra web/app,
-- bundet til `(draw_session_id, hall_id, user_id)`.
--
-- Hvorfor egen tabell (og ikke bare ledger-metadata eller in-memory)?
--   1. Spilleren må kunne refreshe og få tilbake sine bonger.
--   2. Blokk 3.3 trenger server-side tickets for å auto-matche mot draws.
--   3. Blokk 3.4 claim-validering krever server-side sannhet + (sessionId, hallId)-binding.
--   4. § 71 krever bong-sporbarhet; ledger refererer denne tabellen via id.
--
-- Konvensjoner: TEXT PK, `app_` prefiks, CREATE TABLE IF NOT EXISTS,
-- TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK for enums.

-- Up Migration

-- ── Digital draw-session tickets ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_draw_session_tickets (
  id                  TEXT PRIMARY KEY,
  draw_session_id     TEXT NOT NULL REFERENCES app_draw_sessions(id) ON DELETE RESTRICT,
  hall_id             TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  user_id             TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  purchase_channel    TEXT NOT NULL DEFAULT 'digital'
                        CHECK (purchase_channel IN ('digital', 'physical')),
  grid_json           JSONB NOT NULL,
  price_paid_nok      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_paid_nok >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (draw_session_id, hall_id)
    REFERENCES app_draw_session_halls(draw_session_id, hall_id) ON DELETE RESTRICT
);

COMMENT ON TABLE  app_draw_session_tickets                   IS 'Blokk 3.2 — digital bong kjøpt av spiller i en draw-session. Bundet til (session, hall, user) slik at claim-validering i Blokk 3.4 kan sjekke sessionId-matching.';
COMMENT ON COLUMN app_draw_session_tickets.id                IS 'tkt_<uuid>. Refereres av regulatoriske ledger-rader (ticket_ref) og av Blokk 3.4 claims.';
COMMENT ON COLUMN app_draw_session_tickets.grid_json         IS 'number[][] — 5×5 for 75-ball (game_1), 3×5 for 60-ball (game_2/5). Immutable etter kjøp.';
COMMENT ON COLUMN app_draw_session_tickets.price_paid_nok    IS 'Pris betalt per bong i NOK (fra ruleset_json.pricePerTicket ved kjøpstidspunkt).';
COMMENT ON COLUMN app_draw_session_tickets.purchase_channel  IS 'Blokk 3.2 bruker kun "digital". "physical" reservert for eventuell senere migrering av papir-inventar.';

-- Player's own tickets for a session (hot path for refresh + Blokk 3.3 match).
CREATE INDEX IF NOT EXISTS idx_app_draw_session_tickets_user_session
  ON app_draw_session_tickets (user_id, draw_session_id, created_at);

-- All tickets for a session (audit + Blokk 3.4 claim lookup).
CREATE INDEX IF NOT EXISTS idx_app_draw_session_tickets_session
  ON app_draw_session_tickets (draw_session_id);

-- Down Migration

DROP INDEX IF EXISTS idx_app_draw_session_tickets_session;
DROP INDEX IF EXISTS idx_app_draw_session_tickets_user_session;
DROP TABLE IF EXISTS app_draw_session_tickets;
