-- BIN-583 B3.8: logg av manuelle regnskaps-justeringer per hall.
--
-- Port of legacy `hallController.saveHallReportData`. Admin kan legge til
-- manuelle justeringer på hall-account-rapporten (f.eks. korrigeringer
-- for skadet betaling, refunderinger utenfor systemet, bank-overføringer).
-- Alle rader er immutable audit-spor — ingen UPDATE/DELETE.
--
-- Positive amounts = credit (penger inn til hall-konto)
-- Negative amounts = debit (penger ut fra hall-konto)
--
-- Up

CREATE TABLE IF NOT EXISTS app_hall_manual_adjustments (
  id           TEXT PRIMARY KEY,
  hall_id      TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN (
                  'BANK_DEPOSIT','BANK_WITHDRAWAL','CORRECTION','REFUND','OTHER'
                )),
  business_date DATE NOT NULL,
  note         TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hall_manual_adjustments_hall_date
  ON app_hall_manual_adjustments (hall_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_hall_manual_adjustments_created
  ON app_hall_manual_adjustments (created_at DESC);

-- Down
-- DROP TABLE IF EXISTS app_hall_manual_adjustments;
