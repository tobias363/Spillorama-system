-- BIN-763: Nightly wallet reconciliation alerts.
--
-- Industri-standard mønster (Pragmatic Play / Evolution): nightly cron
-- sammenligner `wallet_accounts.deposit_balance/winnings_balance` mot
-- `SUM(wallet_entries.amount)` per konto + side, beregnet via double-entry-
-- modellen (CREDIT minus DEBIT). Avvik > 0.01 NOK persisteres her for manuell
-- håndtering av ADMIN.
--
-- Read-only mot wallet — vi skriver ALDRI tilbake til wallet_accounts ved
-- divergens. ADMIN må undersøke og resolve manuelt med audit-trail.
--
-- (Originalt timestamp 20260428000000 i task-spec kolliderte med
-- 20260428000000_game1_scheduled_games.sql; flyttet til 20260826000000
-- som er etter siste eksisterende migrasjon.)
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS wallet_reconciliation_alerts (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_side TEXT NOT NULL CHECK (account_side IN ('deposit', 'winnings')),
  expected_balance NUMERIC(20, 4) NOT NULL,
  actual_balance NUMERIC(20, 4) NOT NULL,
  divergence NUMERIC(20, 4) NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by TEXT NULL,
  resolution_note TEXT NULL
);

-- Hovedindex for unresolved-listing (admin-dashboard) — partial index
-- over kun åpne alerts holder størrelsen lav på sikt.
CREATE INDEX IF NOT EXISTS idx_wallet_reconciliation_alerts_unresolved
  ON wallet_reconciliation_alerts (detected_at DESC)
  WHERE resolved_at IS NULL;

-- Per-konto-historikk-lookup (ved investigering: "har denne walleten
-- divergert tidligere?").
CREATE INDEX IF NOT EXISTS idx_wallet_reconciliation_alerts_account
  ON wallet_reconciliation_alerts (account_id, account_side, detected_at DESC);

-- Idempotens-index: forhindrer duplikat åpne alerts for samme konto+side.
-- Dekkes også av kode-laget (ON CONFLICT DO NOTHING), men en partial
-- unique index gir DB-nivå garanti.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_reconciliation_alerts_open_per_account
  ON wallet_reconciliation_alerts (account_id, account_side)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE wallet_reconciliation_alerts IS
  'BIN-763: Nightly wallet reconciliation divergenser. Read-only på wallet — ADMIN må resolve manuelt med audit-trail.';
COMMENT ON COLUMN wallet_reconciliation_alerts.expected_balance IS
  'Forventet saldo basert på SUM(wallet_entries.amount) per konto + side (CREDIT minus DEBIT).';
COMMENT ON COLUMN wallet_reconciliation_alerts.actual_balance IS
  'Faktisk saldo lest fra wallet_accounts.deposit_balance / winnings_balance.';
COMMENT ON COLUMN wallet_reconciliation_alerts.divergence IS
  'actual_balance - expected_balance. Positiv = wallet har mer enn ledger sier; negativ = mindre.';
