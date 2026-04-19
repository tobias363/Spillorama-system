-- BIN-583 B3.1: agent shifts — one row per agent's work-session in a hall.
--
-- Ports legacy `agentShift` collection 1:1 including cash-settlement
-- columns so we avoid schema-churn in B3.2/B3.3. Only lifecycle
-- endpoints (start/end/get-current/history) ship in B3.1; cash-columns
-- populated by B3.2 (cash-in/out, ticket-sales) and B3.3 (close-day
-- settlement) are defaulted to 0 / '{}' until then.
--
-- Invariants:
--   - Max one active shift per user at a time (partial unique-index).
--   - started_at defaults to now(); ended_at NULL while is_active.
--   - (hall_id, user_id) composite must be in app_agent_halls before start.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_agent_shifts (
  id                            TEXT PRIMARY KEY,
  user_id                       TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id                       TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  started_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                      TIMESTAMPTZ NULL,
  is_active                     BOOLEAN NOT NULL DEFAULT true,
  is_logged_out                 BOOLEAN NOT NULL DEFAULT false,
  is_daily_balance_transferred  BOOLEAN NOT NULL DEFAULT false,

  -- cash-settlement columns are populated in B3.2/B3.3; default 0/'{}' in B3.1
  daily_balance                 NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_daily_balance_in        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_cash_in                 NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_cash_out                NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_card_in                 NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_card_out                NUMERIC(14, 2) NOT NULL DEFAULT 0,
  selling_by_customer_number    INTEGER NOT NULL DEFAULT 0,
  hall_cash_balance             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  hall_dropsafe_balance         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  daily_difference              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  control_daily_balance         JSONB NOT NULL DEFAULT '{}'::jsonb,
  settlement                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_settlement           JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- En agent kan maks ha én aktiv shift om gangen.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_app_agent_shifts_active_per_user
  ON app_agent_shifts(user_id) WHERE is_active;

-- Rapport-lookup: hvilke agenter er aktive i en hall akkurat nå.
CREATE INDEX IF NOT EXISTS idx_app_agent_shifts_hall_active
  ON app_agent_shifts(hall_id, is_active) WHERE is_active;

-- Historisk oppslag per agent (shift-history UI).
CREATE INDEX IF NOT EXISTS idx_app_agent_shifts_user_started
  ON app_agent_shifts(user_id, started_at DESC);

-- Historisk oppslag per hall (settlement-rapport, audit).
CREATE INDEX IF NOT EXISTS idx_app_agent_shifts_hall_started
  ON app_agent_shifts(hall_id, started_at DESC);

COMMENT ON TABLE app_agent_shifts IS
  'BIN-583: agent work-session. 1:1 port of legacy agentShift. Cash-settlement columns filled by B3.2/B3.3.';
COMMENT ON COLUMN app_agent_shifts.is_active IS
  'true while shift runs. Flipped to false on shift/end. Partial unique-index prevents concurrent active shifts per user.';
COMMENT ON COLUMN app_agent_shifts.control_daily_balance IS
  'JSONB: { dailyBalance, hallCashBalance, dailyBalanceDiff, hallCashBalanceDiff } — written by B3.3 control-daily-balance flow.';
COMMENT ON COLUMN app_agent_shifts.settlement IS
  'JSONB: settlement snapshot written on close-day (B3.3).';
COMMENT ON COLUMN app_agent_shifts.previous_settlement IS
  'JSONB: prior settlement carried forward for audit/drift detection (B3.3).';
