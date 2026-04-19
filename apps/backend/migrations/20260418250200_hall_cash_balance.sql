-- BIN-583 B3.3: hall-running-totals for cash + drop-safe.
--
-- Settlement-flyten transfererer dailyBalance fra agent-shift til
-- hall-cash-balance ved close-day. Drop-safe-moves justerer separat
-- balance. Begge muteres atomisk i samme transaction som settlement-
-- raden + hall-cash-tx-raden.
--
-- Default 0 — hall starter uten kontanter; balance bygges opp av
-- daily settlements.
--
-- Up migration

ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS dropsafe_balance NUMERIC(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN app_halls.cash_balance IS
  'BIN-583 B3.3: running total av kontanter i hallens safe. Muteres av settlement + drop-safe-moves.';
COMMENT ON COLUMN app_halls.dropsafe_balance IS
  'BIN-583 B3.3: running total i hallens drop-safe (avsondret kontant). Tømmes via bank-uthenting (egen flyt).';
