-- BIN-583 B3.2: agent-transaction log — port of legacy agentTransaction.
--
-- One row per agent-initiated money-op (cash-in/out, ticket sale,
-- ticket registration, cancel-counter). Writes are append-only;
-- corrections come via counter-transactions (same pattern as
-- wallet_transactions). Original rows are never mutated.
--
-- Columns mirror legacy agentTransaction, modernised:
--   - amounts in NUMERIC(14,2) (same as wallet_accounts)
--   - payment_method enum instead of free-text "paymentBy"
--   - typeOfTransaction → action_type enum
--   - category (debit/credit) → wallet_direction enum
--   - wallet_tx_id FK til wallet_transactions(id) for traceability
--   - shift_id FK til app_agent_shifts(id) for per-shift rapportering
--   - related_tx_id for counter-transactions (cancel sale → refund)
--
-- Cancel-pattern: for å avbryte en ticket-sale oppretter B3.2 en
-- counter-row med action_type='TICKET_CANCEL', motsatt wallet_direction,
-- og related_tx_id pekende på original-raden. Original-raden muteres
-- aldri. B4a's app_physical_tickets.status forblir 'SOLD' (fysisk
-- billett ble overlevert — cancel er kun en regnskaps-korreksjon).
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_agent_transactions (
  id                  TEXT PRIMARY KEY,
  shift_id            TEXT NOT NULL REFERENCES app_agent_shifts(id) ON DELETE RESTRICT,
  agent_user_id       TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  player_user_id      TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id             TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  action_type         TEXT NOT NULL CHECK (action_type IN (
                        'CASH_IN', 'CASH_OUT',
                        'TICKET_SALE', 'TICKET_REGISTER', 'TICKET_CANCEL',
                        'FEE', 'OTHER'
                      )),
  wallet_direction    TEXT NOT NULL CHECK (wallet_direction IN ('CREDIT', 'DEBIT')),
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'WALLET')),
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  previous_balance    NUMERIC(14, 2) NOT NULL,
  after_balance       NUMERIC(14, 2) NOT NULL,
  wallet_tx_id        TEXT NULL,
  ticket_unique_id    TEXT NULL,
  external_reference  TEXT NULL,
  notes               TEXT NULL,
  other_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_tx_id       TEXT NULL REFERENCES app_agent_transactions(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_agent_tx_shift
  ON app_agent_transactions(shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_agent_tx_agent
  ON app_agent_transactions(agent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_agent_tx_player
  ON app_agent_transactions(player_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_agent_tx_hall_created
  ON app_agent_transactions(hall_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_agent_tx_shift_action
  ON app_agent_transactions(shift_id, action_type, payment_method);
CREATE INDEX IF NOT EXISTS idx_app_agent_tx_related
  ON app_agent_transactions(related_tx_id)
  WHERE related_tx_id IS NOT NULL;
-- For idempotens-oppslag: samme physical-ticket kan ikke selges to ganger
-- innen samme shift. Partial unique-index på ticket_unique_id + SALE-action.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_app_agent_tx_sale_per_ticket
  ON app_agent_transactions(ticket_unique_id)
  WHERE action_type = 'TICKET_SALE' AND ticket_unique_id IS NOT NULL;

COMMENT ON TABLE app_agent_transactions IS
  'BIN-583 B3.2: append-only log av agent-initierte transaksjoner. Port av legacy agentTransaction.';
COMMENT ON COLUMN app_agent_transactions.wallet_tx_id IS
  'Wallet-transaction-ID (wallet_transactions.id) hvis wallet-op utført. NULL for rene kontant-rader uten wallet-effekt.';
COMMENT ON COLUMN app_agent_transactions.related_tx_id IS
  'Hvis dette er en kansellering, peker på opprinnelig tx. Original-raden muteres ikke (append-only).';
COMMENT ON COLUMN app_agent_transactions.ticket_unique_id IS
  'For TICKET_SALE/TICKET_CANCEL: peker på app_physical_tickets.unique_id. NULL for cash-ops.';
