-- BIN-583 B3.4: machine-tickets — port av legacy slotmachine.
--
-- Felles tabell for Metronia (B3.4) og OK Bingo (B3.5). machine_name
-- diskriminerer. OK-Bingo-spesifikt felt room_id holdes som kolonne;
-- andre machine-spesifikke felter via other_data JSONB.
--
-- unique_transaction er idempotency-nøkkel sendt til ekstern API
-- (Metronia transaction-felt). UNIQUE forhindrer dobbel-create mot
-- ekstern maskin.
--
-- Up

CREATE TABLE IF NOT EXISTS app_machine_tickets (
  id                    TEXT PRIMARY KEY,
  machine_name          TEXT NOT NULL CHECK (machine_name IN ('METRONIA', 'OK_BINGO')),
  ticket_number         TEXT NOT NULL,
  external_ticket_id    TEXT NOT NULL,
  hall_id               TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  shift_id              TEXT NULL REFERENCES app_agent_shifts(id) ON DELETE SET NULL,
  agent_user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  player_user_id        TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  room_id               TEXT NULL,
  initial_amount_cents  BIGINT NOT NULL CHECK (initial_amount_cents >= 0),
  total_topup_cents     BIGINT NOT NULL DEFAULT 0,
  current_balance_cents BIGINT NOT NULL DEFAULT 0,
  payout_cents          BIGINT NULL,
  is_closed             BOOLEAN NOT NULL DEFAULT false,
  closed_at             TIMESTAMPTZ NULL,
  closed_by_user_id     TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  void_at               TIMESTAMPTZ NULL,
  void_by_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  void_reason           TEXT NULL,
  unique_transaction    TEXT NOT NULL UNIQUE,
  other_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (machine_name, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_app_machine_tickets_hall_machine
  ON app_machine_tickets(hall_id, machine_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_machine_tickets_player
  ON app_machine_tickets(player_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_machine_tickets_shift
  ON app_machine_tickets(shift_id, created_at DESC)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_machine_tickets_open
  ON app_machine_tickets(machine_name, hall_id)
  WHERE is_closed = false;

COMMENT ON TABLE app_machine_tickets IS
  'BIN-583 B3.4/B3.5: ticket-rader for eksterne maskin-integrasjoner (Metronia, OK Bingo).';
COMMENT ON COLUMN app_machine_tickets.unique_transaction IS
  'Idempotency-nøkkel sendt til ekstern API (Metronia transaction-felt). UNIQUE forhindrer dobbel-create.';
COMMENT ON COLUMN app_machine_tickets.payout_cents IS
  'Beløp utbetalt ved close (current_balance ved close-tidspunktet). NULL for åpne tickets.';
