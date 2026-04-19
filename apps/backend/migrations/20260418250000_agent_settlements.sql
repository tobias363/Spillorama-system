-- BIN-583 B3.3: agent daily-cash-settlement record.
--
-- 1:1 med app_agent_shifts — hver shift får maksimalt én settlement.
-- Når raden opprettes settes også app_agent_shifts.settled_at + transaksjons-
-- freeze trer i kraft (håndhevet i AgentTransactionService).
--
-- Core cash-count-felter er dedikerte kolonner for rapport-effektivitet;
-- machine-specific revenue (Metronia, OK Bingo, NorskTipping, Rikstoto,
-- Franco, Otium, Rekvisita, SellProduct, Bilag, Bank, Annet) lagres i
-- other_data JSONB — populated av B3.4/B3.5 når de porteres.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_agent_settlements (
  id                              TEXT PRIMARY KEY,
  shift_id                        TEXT NOT NULL UNIQUE
                                    REFERENCES app_agent_shifts(id) ON DELETE RESTRICT,
  agent_user_id                   TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id                         TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  business_date                   DATE NOT NULL,

  -- Cash-count (core):
  daily_balance_at_start          NUMERIC(14, 2) NOT NULL DEFAULT 0,
  daily_balance_at_end            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  reported_cash_count             NUMERIC(14, 2) NOT NULL,
  daily_balance_difference        NUMERIC(14, 2) NOT NULL DEFAULT 0,

  -- Drop-safe:
  settlement_to_drop_safe         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  withdraw_from_total_balance     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_drop_safe                 NUMERIC(14, 2) NOT NULL DEFAULT 0,

  -- Shift-level totals (pre-fylt fra aggregert tx-sum ved close-day):
  shift_cash_in_total             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  shift_cash_out_total            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  shift_card_in_total             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  shift_card_out_total            NUMERIC(14, 2) NOT NULL DEFAULT 0,

  -- Metadata:
  settlement_note                 TEXT NULL,
  closed_by_user_id               TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  is_forced                       BOOLEAN NOT NULL DEFAULT false,
  edited_by_user_id               TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  edited_at                       TIMESTAMPTZ NULL,
  edit_reason                     TEXT NULL,

  -- Machine-specific revenue (B3.4/B3.5) + bill-image-refs:
  other_data                      JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_agent_settlements_hall_date
  ON app_agent_settlements(hall_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_app_agent_settlements_agent_date
  ON app_agent_settlements(agent_user_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_app_agent_settlements_business_date
  ON app_agent_settlements(business_date DESC);

COMMENT ON TABLE app_agent_settlements IS
  'BIN-583 B3.3: daglig kasse-oppgjør — 1:1 med app_agent_shifts.';
COMMENT ON COLUMN app_agent_settlements.reported_cash_count IS
  'Kontant-telling oppgitt av agent ved close-day. Sammenlignes mot daily_balance_at_end for diff.';
COMMENT ON COLUMN app_agent_settlements.daily_balance_difference IS
  'reported_cash_count - daily_balance_at_end. Positiv = for mye kontanter; negativ = underskudd.';
COMMENT ON COLUMN app_agent_settlements.is_forced IS
  'true når ADMIN har force-close-et utover diff-threshold. Audit-logget separat.';
COMMENT ON COLUMN app_agent_settlements.other_data IS
  'Machine-revenue (Metronia B3.4, OK Bingo B3.5, etc) + bill-image-refs. Utvides per PR.';
