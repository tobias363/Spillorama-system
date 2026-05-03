-- HV2-A / BIR-036: Daglig kontant-utbetaling-cap per hall (50 000 kr/dag).
--
-- Spec (Tobias 2026-04-30, eier-avklart):
--   * Bank-overføring (Withdraw in Bank → XML-pipeline): INGEN grense
--   * Kontant (Withdraw in Hall, destination_type='hall'): 50 000 kr/dag/hall
--
-- Bakgrunn:
--   Pengespillforskriften krever at vi kan dokumentere kontant-håndtering
--   per hall per dag. En hard 50 000 kr-cap forhindrer både uautorisert
--   kontant-utbetaling (intern svindel) og overskridelse av forsvarlig
--   håndteringsbeløp i fysiske haller.
--
--   Bank-overføringer går via XML-pipeline til regnskap og er ikke
--   begrenset av denne cap-en.
--
-- Design:
--   * En rad per (hall_id, business_date). PRIMARY KEY garanterer
--     atomisk single-row update via INSERT ... ON CONFLICT.
--   * `business_date` = Oslo-tz dato (samme convention som
--     `app_game1_jackpot_state.last_accumulation_date` etter LOW-2-fix
--     2026-04-26 — DST-safe på Norge-midnatt).
--   * Tabellen er ledger-aktig: vi øker `total_amount_cents` og `count`
--     atomically per godkjent kontant-uttak. Den er IKKE source of truth
--     for selve uttakene (det er `app_withdraw_requests`); den er en
--     materialisert daily-counter for cap-sjekk.
--   * Reset av cap = ny dato → ny rad. Eksisterende rader blir liggende
--     for audit-formål (kan slettes senere via egen retention-job).
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up migration

CREATE TABLE IF NOT EXISTS app_hall_cash_withdrawals_daily (
  hall_id            TEXT      NOT NULL,
  business_date      DATE      NOT NULL,
  total_amount_cents BIGINT    NOT NULL DEFAULT 0
                                CHECK (total_amount_cents >= 0),
  count              INTEGER   NOT NULL DEFAULT 0
                                CHECK (count >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hall_id, business_date)
);

COMMENT ON TABLE  app_hall_cash_withdrawals_daily IS
  'HV2-A / BIR-036: Daglig kontant-utbetaling-akkumulator per hall. Cap = 50 000 kr/dag. Bank-overføringer er ikke inkludert. business_date = Oslo-tz.';
COMMENT ON COLUMN app_hall_cash_withdrawals_daily.hall_id IS
  'FK app_halls.id (men ikke FK-constraint — tabellen skal overleve hall-rensk for audit).';
COMMENT ON COLUMN app_hall_cash_withdrawals_daily.business_date IS
  'Forretningsdato i Europe/Oslo. Cap-grensen nullstilles på Norge-midnatt.';
COMMENT ON COLUMN app_hall_cash_withdrawals_daily.total_amount_cents IS
  'Akkumulert kontant-utbetaling i øre for hall_id på business_date. Cap = 5_000_000 (50 000 kr).';
COMMENT ON COLUMN app_hall_cash_withdrawals_daily.count IS
  'Antall kontant-utbetalinger akkumulert i bucketen — for audit/reporting.';
