-- PT1: Utvidelser av `app_static_tickets` for fysisk-bong pilot.
--
-- Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
--
-- Bakgrunn:
--   `app_static_tickets` (migrasjon 20260417000002) holder papirbong-inventaret
--   per hall. PT-serien legger nå på range-basert batch-salg ported fra legacy:
--   agenten reserverer en rekke bonger i en range (PT2), selger fritt i hallen,
--   og registrerer batch-salg ved retur (PT3). Vinn-flyt og utbetaling skjer
--   gjennom `sold_to_scheduled_game_id` + `paid_out_*` (PT4).
--
--   PT1 legger til fundamentet — kolonner + indekser — uten å endre eksisterende
--   rader. Selve flyt-logikken implementeres i PT2-PT6.
--
-- Designvalg:
--   * NULLABLE-kolonner: eksisterende rader beholder sine verdier. Ingen
--     backfill; forward-only (BIN-661).
--   * Fremmednøkler med `ON DELETE SET NULL` der det er naturlig (bruker
--     slettes men historikk beholdes). `sold_to_scheduled_game_id` og
--     `*_range_id` får `ON DELETE SET NULL` for å holde historikken
--     konsistent — vi vil ikke miste papirbong-salg fordi et planlagt
--     spill eller en range ble slettet.
--   * Partial-indeks for hot queries (PT4 vinn-broadcast + PT5 handover).
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

ALTER TABLE app_static_tickets
  ADD COLUMN IF NOT EXISTS sold_by_user_id           TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_from_range_id        TEXT NULL REFERENCES app_agent_ticket_ranges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_to_scheduled_game_id TEXT NULL REFERENCES app_game1_scheduled_games(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_by_range_id      TEXT NULL REFERENCES app_agent_ticket_ranges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_out_at               TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paid_out_amount_cents     INTEGER NULL,
  ADD COLUMN IF NOT EXISTS paid_out_by_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN app_static_tickets.sold_by_user_id            IS 'PT3: bingoverten som gjennomførte batch-salget (audit). Settes samtidig med is_purchased=true.';
COMMENT ON COLUMN app_static_tickets.sold_from_range_id         IS 'PT3: range-ID bongen ble solgt fra. Brukes av PT5-handover for å finne uutbetalte vinn fra avtroppende vakt.';
COMMENT ON COLUMN app_static_tickets.responsible_user_id        IS 'PT4/PT5: nåværende ansvarlig bingovert. Lik sold_by_user_id inntil handover (PT5), deretter satt til overtagende bingovert.';
COMMENT ON COLUMN app_static_tickets.sold_to_scheduled_game_id  IS 'PT3/PT4: planlagt Game 1-spill bongen er solgt inn til. Danner grunnlag for pattern-evaluering i PT4 vinn-flyt.';
COMMENT ON COLUMN app_static_tickets.reserved_by_range_id       IS 'PT2: range som har reservert bongen (før salg). NULL etter PT3-salg (flyttet til sold_from_range_id) eller før PT2-reservasjon.';
COMMENT ON COLUMN app_static_tickets.paid_out_at                IS 'PT4: tidspunkt for utbetaling til spiller. NULL = ikke utbetalt. Settes sammen med paid_out_amount_cents + paid_out_by_user_id.';
COMMENT ON COLUMN app_static_tickets.paid_out_amount_cents      IS 'PT4: utbetalt beløp i øre. NULL før utbetaling.';
COMMENT ON COLUMN app_static_tickets.paid_out_by_user_id        IS 'PT4: bingoverten som gjennomførte utbetalingen. NULL før utbetaling.';

-- Partial-indeks: PT4 vinn-broadcast + pattern-evaluering for aktive fysiske
-- bonger i et planlagt spill ("hvilke uutbetalte bonger tilhører dette spillet?").
-- Ikke alle rader har sold_to_scheduled_game_id + is_purchased=true, så
-- partial-indeks er billigere enn full.
CREATE INDEX IF NOT EXISTS idx_static_tickets_scheduled_game_purchased
  ON app_static_tickets (sold_to_scheduled_game_id)
  WHERE is_purchased = true AND paid_out_at IS NULL;

-- Partial-indeks: PT5 handover + PT6 rapport ("hvilke uutbetalte bonger har
-- denne bingoverten ansvar for?"). Brukes når Kari går av og Per tar over,
-- eller når admin-dashboard viser utestående.
CREATE INDEX IF NOT EXISTS idx_static_tickets_responsible
  ON app_static_tickets (responsible_user_id)
  WHERE paid_out_at IS NULL;
