-- BIN-586: Manuell deposit/withdraw-kø.
--
-- Port fra legacy `transactionController.acceptDepositRequest` og
-- `WithdrawController.acceptWithdrawRequest`. Dekker kontant-innskudd
-- (ved hall-kasse) og uttak over terskelverdi som må godkjennes av agent
-- eller admin før midler krediteres/debiteres.
--
-- `app_deposit_requests` og `app_withdraw_requests` har identisk struktur
-- for enkelhets skyld — eneste forskjellen er semantisk (credit vs debit).
--
-- Up migration

-- BIN-657: id declared as TEXT (not UUID) to keep id-type consistent with
-- the rest of the schema (app_halls.id, app_users.id, hall_game_schedules.id
-- all TEXT). Future FKs pointing to this table's id will be TEXT — avoids
-- the cross-type FK rejection that hit BIN-657 in the first place. Code
-- generates ids via `randomUUID()` which TEXT accepts.
CREATE TABLE IF NOT EXISTS app_deposit_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  wallet_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  hall_id TEXT NULL REFERENCES app_halls(id) ON DELETE SET NULL,
  submitted_by TEXT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  rejection_reason TEXT NULL,
  accepted_by TEXT NULL,
  accepted_at TIMESTAMPTZ NULL,
  rejected_by TEXT NULL,
  rejected_at TIMESTAMPTZ NULL,
  wallet_transaction_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_withdraw_requests (
  -- BIN-657: TEXT for same reason as app_deposit_requests.id above.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  wallet_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  hall_id TEXT NULL REFERENCES app_halls(id) ON DELETE SET NULL,
  submitted_by TEXT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  rejection_reason TEXT NULL,
  accepted_by TEXT NULL,
  accepted_at TIMESTAMPTZ NULL,
  rejected_by TEXT NULL,
  rejected_at TIMESTAMPTZ NULL,
  wallet_transaction_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_deposit_requests_status_created_at
  ON app_deposit_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_deposit_requests_user_id
  ON app_deposit_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_deposit_requests_hall_id
  ON app_deposit_requests (hall_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_status_created_at
  ON app_withdraw_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_user_id
  ON app_withdraw_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_hall_id
  ON app_withdraw_requests (hall_id, created_at DESC);

COMMENT ON TABLE app_deposit_requests IS
  'BIN-586: Kø for manuelt innskudd (kontant i hall). Port fra legacy transactionController.';
COMMENT ON TABLE app_withdraw_requests IS
  'BIN-586: Kø for manuelt uttak over terskel. Port fra legacy WithdrawController.';
