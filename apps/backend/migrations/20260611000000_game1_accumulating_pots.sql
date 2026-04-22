-- PR-T1 Spor 4 (Pot-service-framework): akkumulerende pot-er for Spill 1.
--
-- Bakgrunn:
--   Spor 4-rammen dekker pot-er som lever MELLOM spill (f.eks. "Jackpott" og
--   "Innsatsen") — de bygger seg opp over tid (daglig boost + andel av
--   billettsalg) og utbetales når en gyldig vinn-betingelse inntreffer. Dette
--   er distinkt fra Game1JackpotService (som håndterer per-spill fixed-amount
--   Fullt Hus-jackpot per farge) — de to tjenestene skal leve i parallell.
--
-- Design:
--   * `app_game1_accumulating_pots` holder nåværende pot-tilstand per
--     (hall_id, pot_key). `pot_key` er en fri tekst som identifiserer pot-
--     typen ("jackpott", "innsatsen", ...). Én rad per aktiv pot.
--   * `current_amount_cents` er pot-balanse i øre. Resettes til seed ved
--     utløsning, boost/sales-akkumulering legger til.
--   * `config_json` holder per-pot regler (seed, daily boost, per-salg-andel,
--     vinn-regler, draw-threshold) som JSONB slik at admin-UI kan utvide
--     uten migrasjoner.
--   * `app_game1_pot_events` er append-only audit-log: hver akkumulering,
--     hver vinn, hver reset og hver konfigurasjonsendring registreres med
--     delta og ny balanse. Brukes for rapportering og regulatorisk
--     sporbarhet (pengespillforskriften § 11).
--
-- Konvensjoner (matcher øvrige app_* tabeller):
--   * TEXT PRIMARY KEY (ikke UUID-type); UUID-strenger genereres i service via
--     randomUUID() og skrives som tekst.
--   * TIMESTAMPTZ NOT NULL DEFAULT now() på lifecycle-timestamps.
--   * ON DELETE RESTRICT på hall_id, scheduled_game_id (for å bevare
--     audit-trail selv om hall/spill senere slettes softly).
--   * CREATE TABLE IF NOT EXISTS for re-run-trygghet.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_game1_accumulating_pots (
  id                    TEXT PRIMARY KEY,
  hall_id               TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- pot_key: fri tekst, f.eks. "jackpott" | "innsatsen". Kombinert med
  -- hall_id må være unik — hver hall kan ha én pot per key.
  pot_key               TEXT NOT NULL,
  -- Menneskelig navn vist i admin-UI. Ikke unik.
  display_name          TEXT NOT NULL,
  -- Nåværende pot-saldo i øre. Etter reset = seed_amount_cents (fra config).
  current_amount_cents  BIGINT NOT NULL DEFAULT 0,
  -- Pot-konfigurasjon:
  --   {
  --     seedAmountCents:       int,           // reset-sokkel
  --     dailyBoostCents:       int,           // daglig auto-påfyll (0 = av)
  --     salePercentBps:        int,           // basispoeng av billett-salg (0..10000)
  --     maxAmountCents:        int | null,    // cap (null = ingen)
  --     winRule: {
  --       kind: "phase_at_or_before_draw",   // kun variant støttet i T1
  --       phase: int,                         // 1..5
  --       drawThreshold: int                  // vunnet PÅ eller FØR denne draw-sekvensen
  --     },
  --     ticketColors: string[]               // tillatt ticket-color (tom = alle)
  --   }
  config_json           JSONB NOT NULL,
  -- Sist gang daglig boost ble applisert (UTC-dato som tekst "YYYY-MM-DD" slik
  -- at idempotens-sjekken ikke avhenger av timezone). NULL = aldri.
  last_daily_boost_date TEXT NULL,
  -- Sist gang pot ble resatt (etter win eller admin-override). NULL = aldri.
  last_reset_at         TIMESTAMPTZ NULL,
  last_reset_reason     TEXT NULL,
  -- Lifecycle.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT t1_unique_hall_pot_key UNIQUE (hall_id, pot_key)
);

COMMENT ON TABLE  app_game1_accumulating_pots IS 'PR-T1: Akkumulerende pot-er (Jackpott, Innsatsen) som lever mellom Spill 1-økter.';

COMMENT ON COLUMN app_game1_accumulating_pots.pot_key               IS 'PR-T1: fri-tekst-identifikator per pot-type per hall, f.eks. "jackpott".';
COMMENT ON COLUMN app_game1_accumulating_pots.display_name          IS 'PR-T1: menneskelig navn vist i admin-UI og eventuelt spiller-UI.';
COMMENT ON COLUMN app_game1_accumulating_pots.current_amount_cents  IS 'PR-T1: nåværende pot-saldo i øre. Økes av accumulateDaily/accumulateFromSale, resettes av tryWin/resetPot.';
COMMENT ON COLUMN app_game1_accumulating_pots.config_json           IS 'PR-T1: pot-regler (seed, daily-boost, sale-andel, win-rule, ticketColors) — se migration-header for skjema.';
COMMENT ON COLUMN app_game1_accumulating_pots.last_daily_boost_date IS 'PR-T1: UTC-dato (YYYY-MM-DD) siste daglige boost ble applisert. Brukes for idempotens.';
COMMENT ON COLUMN app_game1_accumulating_pots.last_reset_at         IS 'PR-T1: tidspunkt for siste reset (win eller admin-override).';
COMMENT ON COLUMN app_game1_accumulating_pots.last_reset_reason     IS 'PR-T1: fri-tekst begrunnelse for siste reset.';

-- Audit-log (append-only). Skal aldri UPDATE-es.
CREATE TABLE IF NOT EXISTS app_game1_pot_events (
  id                   TEXT PRIMARY KEY,
  pot_id               TEXT NOT NULL REFERENCES app_game1_accumulating_pots(id) ON DELETE RESTRICT,
  hall_id              TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Hvilken type endring. T1-kjente verdier:
  --   "init"      — pot opprettet
  --   "daily"     — daglig boost applisert
  --   "sale"      — andel av billett-salg akkumulert
  --   "win"       — pot utbetalt + reset
  --   "reset"     — admin-reset uten win
  --   "config"    — kun config_json endret (delta=0)
  event_kind           TEXT NOT NULL,
  -- Endring i øre (positiv for akkumulering, negativ for win/reset). 0 for "config".
  delta_cents          BIGINT NOT NULL,
  -- Saldo ETTER denne hendelsen. Redundant med kjede av delta_cents, men
  -- gjør rapport-queryer enormt mye enklere.
  balance_after_cents  BIGINT NOT NULL,
  -- Valgfri referanse til scheduled-game som utløste hendelsen (sale/win).
  scheduled_game_id    TEXT NULL REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Valgfri ticket-purchase-id (for "sale" — hvilket kjøp utløste andelen).
  ticket_purchase_id   TEXT NULL,
  -- Valgfri vinner-user-id (for "win").
  winner_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  -- Valgfri ticket-color (for "win" — hvilken farge vant).
  winner_ticket_color  TEXT NULL,
  -- Fri-tekst ekstra context (f.eks. "rtp_cap_reached", "manual_admin_reset").
  reason               TEXT NULL,
  -- Snapshot av config_json ved tidspunkt for hendelsen. Brukes for å
  -- reprodusere win-beregning selv om admin senere endrer config.
  config_snapshot_json JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_game1_pot_events IS 'PR-T1: Append-only audit-log for alle pot-endringer (init/daily/sale/win/reset/config).';

COMMENT ON COLUMN app_game1_pot_events.event_kind           IS 'PR-T1: hendelsestype — "init" | "daily" | "sale" | "win" | "reset" | "config".';
COMMENT ON COLUMN app_game1_pot_events.delta_cents          IS 'PR-T1: endring i øre (positiv for akkumulering, negativ for win/reset, 0 for config).';
COMMENT ON COLUMN app_game1_pot_events.balance_after_cents  IS 'PR-T1: pot-saldo ETTER denne hendelsen — redundant men gir raske rapport-queryer.';
COMMENT ON COLUMN app_game1_pot_events.scheduled_game_id    IS 'PR-T1: hvilken Spill 1-økt utløste hendelsen (sale/win). NULL for daily/config/init/manual reset.';
COMMENT ON COLUMN app_game1_pot_events.ticket_purchase_id   IS 'PR-T1: hvilket billett-kjøp utløste andel-akkumulering (sale). NULL for andre event_kinds.';
COMMENT ON COLUMN app_game1_pot_events.winner_user_id       IS 'PR-T1: vinner (win). NULL for andre event_kinds.';
COMMENT ON COLUMN app_game1_pot_events.winner_ticket_color  IS 'PR-T1: vinner ticket-color (win). NULL for andre event_kinds.';
COMMENT ON COLUMN app_game1_pot_events.config_snapshot_json IS 'PR-T1: snapshot av config_json på hendelses-tidspunktet — beviser hvilke regler vinn ble beregnet mot.';

-- Hot query: "hvilke pot-er for denne hallen?"
CREATE INDEX IF NOT EXISTS idx_t1_pots_hall
  ON app_game1_accumulating_pots (hall_id);

-- Hot query: "alle events for denne pot-en (admin audit-vis)".
CREATE INDEX IF NOT EXISTS idx_t1_pot_events_pot
  ON app_game1_pot_events (pot_id, created_at DESC);

-- Hot query: "win-events i tidsintervall for rapport".
CREATE INDEX IF NOT EXISTS idx_t1_pot_events_win
  ON app_game1_pot_events (created_at DESC)
  WHERE event_kind = 'win';
