-- Blokk 1.9 — Papir-bong: static_tickets inventar.
--
-- Port av legacy `staticTickets`-modellen til PG. Forhåndstrykket papir-bong
-- har en pre-generert bingo-matrise + stabil serial/farge kombinasjon. Hver
-- hall importerer sitt eget inventar via
-- `scripts/import-static-tickets.ts`.
--
-- Asymmetri vs. digitale bonger: papir-bong har fysisk serial + pre-trykt
-- matrise, så den ER en rad. Digitale bonger (Blokk 1.8) lever i-memory i
-- `GameState.tickets` og serialiseres i `game_checkpoints.snapshot`-JSON.
-- Se MULTI_HALL_REBUILD_PLAN § "Designnote — digital vs. papir-bong" for
-- begrunnelsen.
--
-- Konvensjoner (matcher 20260416000001_multi_hall_linked_draws.sql):
--   TEXT PRIMARY KEY, `app_` prefiks, CREATE TABLE IF NOT EXISTS,
--   TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK for enums.

-- Up Migration

-- ── Static ticket inventory ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_static_tickets (
  id               TEXT PRIMARY KEY,
  hall_id          TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  ticket_serial    TEXT NOT NULL,
  ticket_color     TEXT NOT NULL
                     CHECK (ticket_color IN ('small', 'large', 'traffic-light')),
  ticket_type      TEXT NOT NULL,
  card_matrix      JSONB NOT NULL,
  is_purchased     BOOLEAN NOT NULL DEFAULT false,
  purchased_at     TIMESTAMPTZ NULL,
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_static_tickets                 IS 'Pre-trykt papir-bong inventar per hall. Én rad = én fysisk bong med unik (hall_id, serial, color) kombinasjon.';
COMMENT ON COLUMN app_static_tickets.ticket_serial   IS 'Legacy-kompatibelt numerisk serial ("1", "100", "500") — unikt i kombinasjon med (hall_id, color).';
COMMENT ON COLUMN app_static_tickets.ticket_color    IS 'Fargekode: small (gul), large (blå), traffic-light (rød/gul/grønn). Styrer inkrement-regel i Blokk 1.10.';
COMMENT ON COLUMN app_static_tickets.ticket_type     IS 'Variant-type ("small", "large", "elvis", "traffic-red", ...). Valgt av spill-motor ved claim-validering.';
COMMENT ON COLUMN app_static_tickets.card_matrix     IS 'Pre-generert bingo-kort (3×5 eller 5×5). Lagret som JSONB for å matche Ticket.grid-format uten transformasjon ved lookup.';
COMMENT ON COLUMN app_static_tickets.is_purchased    IS 'true når en agent har scannet bongen som solgt i Blokk 1.11.';
COMMENT ON COLUMN app_static_tickets.purchased_at    IS 'Timestamp når bongen ble markert som solgt. NULL når is_purchased=false.';

-- Unique — forhindrer dobbelt-import av samme bong.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_static_tickets_hall_serial_color
  ON app_static_tickets (hall_id, ticket_serial, ticket_color);

-- Covering index for inventar-spørringen "hvor mange usolgte bonger finnes for (hall, farge)?".
CREATE INDEX IF NOT EXISTS idx_app_static_tickets_hall_color_unpurchased
  ON app_static_tickets (hall_id, ticket_color)
  WHERE is_purchased = false;
