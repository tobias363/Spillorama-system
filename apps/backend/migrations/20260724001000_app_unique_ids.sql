-- Wireframe gaps #8/#10/#11 (2026-04-24): Agent Unique ID cards.
--
-- Port of legacy V1.0 "Unique ID"-flow (wireframes 17.9/17.10/17.11/17.26/
-- 17.27/17.28). A Unique ID is a play-card that belongs to the HALL (not
-- a player): the agent creates it at the counter, the customer pays cash/
-- card, the card's balance can be topped up ("Add Money") or withdrawn
-- (cash only), and its lifecycle tracks re-prints + re-generates.
--
-- PM-locked rule (Q4): Add Money AKKUMULERES — 200 kr added to a card
-- with 170 kr becomes 370 kr. Balance is NEVER overwritten.
--
-- ───────── Schema ─────────
-- `app_unique_ids` — one row per issued card.
--   id                 TEXT PRIMARY KEY  — the printed card number (string)
--   hall_id            FK app_halls       — which hall issued the card
--   balance_cents      NUMERIC(14, 2)     — current balance (accumulates)
--   purchase_date      TIMESTAMPTZ        — when the card was created
--   expiry_date        TIMESTAMPTZ        — purchase + hours_validity
--   hours_validity     INTEGER            — min 24
--   payment_type       TEXT               — CASH | CARD (at create-time)
--   created_by_agent_id  FK app_users     — the agent that created it
--   printed_at         TIMESTAMPTZ        — first PRINT (on create)
--   reprinted_count    INTEGER            — # times re-printed
--   last_reprinted_at  TIMESTAMPTZ
--   last_reprinted_by  FK app_users
--   status             TEXT               — ACTIVE | WITHDRAWN | REGENERATED | EXPIRED
--   regenerated_from_id TEXT              — if this card replaces an older one
--   created_at/updated_at
--
-- `app_unique_id_transactions` — audit trail of CREATE/ADD_MONEY/WITHDRAW/
--   REGENERATE events. Append-only — balance mutations go through this log.
--
-- Up migration.

CREATE TABLE IF NOT EXISTS app_unique_ids (
  id                    TEXT PRIMARY KEY,
  hall_id               TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  balance_cents         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  purchase_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expiry_date           TIMESTAMPTZ NOT NULL,
  hours_validity        INTEGER NOT NULL CHECK (hours_validity >= 24),
  payment_type          TEXT NOT NULL CHECK (payment_type IN ('CASH', 'CARD')),
  created_by_agent_id   TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  printed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  reprinted_count       INTEGER NOT NULL DEFAULT 0 CHECK (reprinted_count >= 0),
  last_reprinted_at     TIMESTAMPTZ NULL,
  last_reprinted_by     TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
                          status IN ('ACTIVE', 'WITHDRAWN', 'REGENERATED', 'EXPIRED')
                        ),
  regenerated_from_id   TEXT NULL REFERENCES app_unique_ids(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_unique_ids_hall_created
  ON app_unique_ids(hall_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_unique_ids_agent
  ON app_unique_ids(created_by_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_unique_ids_status
  ON app_unique_ids(status, expiry_date);

CREATE TABLE IF NOT EXISTS app_unique_id_transactions (
  id                    TEXT PRIMARY KEY,
  unique_id             TEXT NOT NULL REFERENCES app_unique_ids(id) ON DELETE CASCADE,
  action_type           TEXT NOT NULL CHECK (action_type IN (
                          'CREATE', 'ADD_MONEY', 'WITHDRAW', 'REPRINT', 'REGENERATE'
                        )),
  amount_cents          NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  previous_balance      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  new_balance           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_type          TEXT NULL CHECK (payment_type IS NULL OR payment_type IN ('CASH', 'CARD')),
  agent_user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  game_type             TEXT NULL,
  reason                TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_unique_id_tx_card
  ON app_unique_id_transactions(unique_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_unique_id_tx_agent
  ON app_unique_id_transactions(agent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_unique_id_tx_type
  ON app_unique_id_transactions(action_type, created_at DESC);

COMMENT ON TABLE app_unique_ids IS
  'Agent-facing Unique ID cards (V1.0 wireframes 17.9-17.28). Balance accumulates via Add Money; withdraw is cash-only.';
COMMENT ON COLUMN app_unique_ids.status IS
  'ACTIVE=usable, WITHDRAWN=balance zeroed via withdraw, REGENERATED=replaced by new id, EXPIRED=past expiry_date.';
COMMENT ON COLUMN app_unique_ids.regenerated_from_id IS
  'If this card replaces a previous one (Re-Generate flow), points back to the source row for audit continuity.';
COMMENT ON TABLE app_unique_id_transactions IS
  'Append-only audit + transaction log for Unique ID cards. All balance mutations recorded here.';
