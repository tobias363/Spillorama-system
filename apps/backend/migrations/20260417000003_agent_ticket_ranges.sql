-- Blokk 1.10 — Papir-bong: agent range registration.
--
-- Port av legacy `registeredTickets`-modellen (`physicalTicketsController.js:2385-2405`).
-- En "range" er settet av papir-bong-serials som én agent har plukket ut fra
-- inventaret for salg den aktive dagen/vakten. Hvilke serials en range
-- inneholder avhenger av farge:
--   - large / traffic-light: 300 påfølgende serials (initialId..initialId+299)
--   - small:                 100 serials, hver 5. serial (initialId, +5, +10, ..., +495)
--
-- Den eksplisitte `serials` JSONB-arrayen gjør det billig å spørre "hvilke
-- bonger har denne agenten?" uten å re-utlede økt-regelen, og lar oss bruke
-- PG-operatoren `?|` for overlapp-deteksjon ved nye registreringer.
--
-- `closed_at` settes i Blokk 1.11 når vakten er ferdig / rangen overleveres.
-- Åpne ranges (closed_at IS NULL) er det som må sammenlignes ved overlapp-
-- sjekk — historikk beholdes for reguleringsrapporter (Blokk 1.13).
--
-- Konvensjoner (matcher 20260417000002_static_tickets.sql): TEXT PK,
-- `app_` prefiks, CREATE TABLE IF NOT EXISTS, TIMESTAMPTZ NOT NULL DEFAULT now(),
-- CHECK for enums.

-- Up Migration

-- ── Agent ticket ranges ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_agent_ticket_ranges (
  id                   TEXT PRIMARY KEY,
  agent_id             TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id              TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  ticket_color         TEXT NOT NULL
                         CHECK (ticket_color IN ('small', 'large', 'traffic-light')),
  initial_serial       TEXT NOT NULL,
  final_serial         TEXT NOT NULL,
  serials              JSONB NOT NULL,
  next_available_index INTEGER NOT NULL DEFAULT 0
                         CHECK (next_available_index >= 0),
  registered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ NULL
);

COMMENT ON TABLE  app_agent_ticket_ranges                      IS 'Papir-bong-rekke registrert av én agent for én vakt. Én rad = ett sett med serials som er "plukket ut" av inventaret og klar for salg.';
COMMENT ON COLUMN app_agent_ticket_ranges.agent_id             IS 'Innlogget bruker (rolle HALL_OPERATOR / ADMIN) som registrerte rekken. Hall-scope valideres i Blokk 1.12a.';
COMMENT ON COLUMN app_agent_ticket_ranges.ticket_color         IS 'Fargekode: small (100 serials × 5 steg), large (300 påfølgende), traffic-light (300 påfølgende).';
COMMENT ON COLUMN app_agent_ticket_ranges.initial_serial       IS 'Første serial i rekken (TEXT-format for å matche app_static_tickets.ticket_serial).';
COMMENT ON COLUMN app_agent_ticket_ranges.final_serial         IS 'Siste serial i rekken. For small = initial + 495, for large/traffic-light = initial + 299.';
COMMENT ON COLUMN app_agent_ticket_ranges.serials              IS 'Hele listen av serials i rekken, JSONB-array av TEXT. Brukes for rask overlapp-deteksjon (PG ?|-operator) og for salg-flyt i Blokk 1.11.';
COMMENT ON COLUMN app_agent_ticket_ranges.next_available_index IS 'Peker inn i `serials`-arrayen. 0 = alt usolgt. Blokk 1.11 inkrementerer ved hver salg.';
COMMENT ON COLUMN app_agent_ticket_ranges.closed_at            IS 'Timestamp når vakten er ferdig / rangen er overlevert. NULL = åpen rekke som skal inkluderes i overlapp-sjekk.';

-- Finn åpne ranges for (hall, color) — hot path for overlapp-deteksjon og
-- for "hvilke serials har agentene denne hallen i dag?".
CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_hall_color_open
  ON app_agent_ticket_ranges (hall_id, ticket_color)
  WHERE closed_at IS NULL;

-- Agent-scoped listing (Blokk 1.11 UI).
CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_agent_open
  ON app_agent_ticket_ranges (agent_id, hall_id)
  WHERE closed_at IS NULL;

-- JSONB GIN-indeks: raske `serials ?| $2::text[]` spørringer for overlapp-sjekk.
CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_serials_gin
  ON app_agent_ticket_ranges USING GIN (serials);

-- Down Migration

DROP INDEX IF EXISTS idx_app_agent_ticket_ranges_serials_gin;
DROP INDEX IF EXISTS idx_app_agent_ticket_ranges_agent_open;
DROP INDEX IF EXISTS idx_app_agent_ticket_ranges_hall_color_open;
DROP TABLE IF EXISTS app_agent_ticket_ranges;
