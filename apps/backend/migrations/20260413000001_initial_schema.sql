-- Initial schema for Spillorama bingo system.
-- Extracted from in-code CREATE TABLE IF NOT EXISTS statements across:
--   PlatformService, PostgresWalletAdapter, PostgresResponsibleGamingStore,
--   PostgresBingoSystemAdapter, SwedbankPayService.
--
-- Running this migration on an already-initialised database is safe:
-- every CREATE / CREATE INDEX uses IF NOT EXISTS.

-- Up Migration

-- ── Wallet ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id           TEXT PRIMARY KEY,
  balance      NUMERIC(20, 6) NOT NULL DEFAULT 0,
  is_system    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id               TEXT PRIMARY KEY,
  operation_id     TEXT NOT NULL,
  account_id       TEXT NOT NULL REFERENCES wallet_accounts(id),
  transaction_type TEXT NOT NULL,
  amount           NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
  reason           TEXT NOT NULL,
  related_account_id TEXT NULL,
  idempotency_key  TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency_key
  ON wallet_transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_entries (
  id             BIGSERIAL PRIMARY KEY,
  operation_id   TEXT NOT NULL,
  account_id     TEXT NOT NULL REFERENCES wallet_accounts(id),
  side           TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount         NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
  transaction_id TEXT NULL REFERENCES wallet_transactions(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_account_created
  ON wallet_transactions (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_entries_account_created
  ON wallet_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_entries_operation
  ON wallet_entries (operation_id);

-- System accounts (house + external cash) — safe to insert multiple times
INSERT INTO wallet_accounts (id, balance, is_system)
  VALUES ('__house__', 0, true), ('__external_cash__', 0, true)
  ON CONFLICT (id) DO NOTHING;

-- ── Platform ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  display_name    TEXT NOT NULL,
  surname         TEXT NULL,
  password_hash   TEXT NOT NULL,
  wallet_id       TEXT UNIQUE NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER')),
  kyc_status      TEXT NOT NULL DEFAULT 'UNVERIFIED',
  birth_date      DATE NULL,
  kyc_verified_at TIMESTAMPTZ NULL,
  kyc_provider_ref TEXT NULL,
  phone           TEXT NULL,
  compliance_data JSONB NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_users(id),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_token_hash
  ON app_sessions (token_hash);

CREATE TABLE IF NOT EXISTS app_games (
  slug          TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  route         TEXT NOT NULL,
  is_enabled    BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_game_settings_change_log (
  id                    TEXT PRIMARY KEY,
  game_slug             TEXT NOT NULL REFERENCES app_games(slug) ON DELETE CASCADE,
  changed_by_user_id    TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  changed_by_display_name TEXT NOT NULL,
  changed_by_role       TEXT NOT NULL,
  source                TEXT NOT NULL,
  effective_from        TIMESTAMPTZ NULL,
  payload_summary       TEXT NOT NULL,
  payload_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_game_settings_change_log_created_at
  ON app_game_settings_change_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_game_settings_change_log_game_slug_created_at
  ON app_game_settings_change_log (game_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS app_halls (
  id                  TEXT PRIMARY KEY,
  slug                TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  region              TEXT NOT NULL DEFAULT 'NO',
  address             TEXT NOT NULL DEFAULT '',
  organization_number TEXT NULL,
  settlement_account  TEXT NULL,
  invoice_method      TEXT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_terminals (
  id            TEXT PRIMARY KEY,
  hall_id       TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  terminal_code TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_seen_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hall_id, terminal_code)
);

CREATE INDEX IF NOT EXISTS idx_app_terminals_hall_id
  ON app_terminals (hall_id);

CREATE TABLE IF NOT EXISTS app_hall_registrations (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  wallet_id            TEXT NOT NULL,
  hall_id              TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  status               TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'INACTIVE', 'BLOCKED')),
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at         TIMESTAMPTZ NULL,
  activated_by_user_id TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, hall_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_hall_registrations_user_id_hall_id_key
  ON app_hall_registrations (user_id, hall_id);
CREATE INDEX IF NOT EXISTS idx_rg_hall_registrations_status_requested_at
  ON app_hall_registrations (status, requested_at);
CREATE INDEX IF NOT EXISTS idx_rg_hall_registrations_wallet_hall_status
  ON app_hall_registrations (wallet_id, hall_id, status);

CREATE TABLE IF NOT EXISTS app_hall_game_config (
  hall_id              TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  game_slug            TEXT NOT NULL REFERENCES app_games(slug) ON DELETE CASCADE,
  is_enabled           BOOLEAN NOT NULL DEFAULT true,
  max_tickets_per_player INTEGER NOT NULL DEFAULT 30
    CHECK (max_tickets_per_player >= 1 AND max_tickets_per_player <= 30),
  min_round_interval_ms  INTEGER NOT NULL DEFAULT 30000
    CHECK (min_round_interval_ms >= 30000),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hall_id, game_slug)
);

CREATE INDEX IF NOT EXISTS idx_app_hall_game_config_game_slug
  ON app_hall_game_config (game_slug);

-- ── Spilleplan (§ 64) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hall_game_schedules (
  id               TEXT PRIMARY KEY,
  hall_id          TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  game_type        TEXT NOT NULL DEFAULT 'standard',
  display_name     TEXT NOT NULL,
  day_of_week      INTEGER CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  start_time       TIME NOT NULL,
  prize_description TEXT NOT NULL DEFAULT '',
  max_tickets      INTEGER NOT NULL DEFAULT 30 CHECK (max_tickets >= 1 AND max_tickets <= 30),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hall_schedule_log (
  id               TEXT PRIMARY KEY,
  hall_id          TEXT NOT NULL,
  schedule_slot_id TEXT REFERENCES hall_game_schedules(id) ON DELETE SET NULL,
  game_session_id  TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  player_count     INTEGER,
  total_payout     NUMERIC,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hall_game_schedules_hall_id
  ON hall_game_schedules (hall_id, is_active, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS idx_hall_schedule_log_hall_id
  ON hall_schedule_log (hall_id, started_at DESC);

-- Seed default games (idempotent)
INSERT INTO app_games (slug, title, description, route, is_enabled, sort_order, settings_json)
VALUES
  ('bingo',        'Bingo',        '75-kulsbingo med flere spillvarianter',   '/bingo',        true, 1, '{"gameNumber":1,"clientEngine":"web"}'::jsonb),
  ('rocket',       'Rocket',       'Tallspill med 3x3 brett og Lucky Number', '/rocket',       true, 2, '{"gameNumber":2}'::jsonb),
  ('monsterbingo', 'Mønsterbingo', 'Bingo med mønstergevinster',              '/monsterbingo', true, 3, '{"gameNumber":3}'::jsonb),
  -- temabingo (game 4): deaktivert per BIN-496. Beholdes i seed for historisk
  -- kontinuitet; is_enabled=false gjør at den ikke vises i lobby. Se også
  -- migration 20260417120000_deactivate_game4_temabingo.sql for eksisterende DB.
  ('temabingo',    'Temabingo',    'Bingo med temaer og multiplikator (utgått, BIN-496)', '/temabingo', false, 4, '{"gameNumber":4,"deprecated":true}'::jsonb),
  ('spillorama',   'Spillorama',   'Spillorama-bingo med bonusspill',         '/spillorama',   true, 5, '{"gameNumber":5}'::jsonb),
  ('candy',        'Candy Mania',  'Candy-spillet',                           '/candy',        true, 6, '{"gameNumber":6}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ── Bingo game checkpointing ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_sessions (
  game_id    TEXT PRIMARY KEY,
  room_code  TEXT NOT NULL,
  hall_id    TEXT NULL,
  status     TEXT NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_status
  ON game_sessions (status);

CREATE TABLE IF NOT EXISTS game_checkpoints (
  id              BIGSERIAL PRIMARY KEY,
  game_id         TEXT NOT NULL,
  room_code       TEXT NOT NULL,
  hall_id         TEXT NULL,
  reason          TEXT NOT NULL,
  claim_id        TEXT NULL,
  payout_amount   NUMERIC(20, 6) NULL,
  transaction_ids JSONB NULL,
  snapshot        JSONB NULL,
  players         JSONB NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_checkpoints_game_id
  ON game_checkpoints (game_id);
CREATE INDEX IF NOT EXISTS idx_game_checkpoints_room_code
  ON game_checkpoints (room_code);

-- ── Responsible gaming ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_rg_personal_loss_limits (
  wallet_id     TEXT NOT NULL,
  hall_id       TEXT NOT NULL,
  daily_limit   NUMERIC(12, 2) NOT NULL,
  monthly_limit NUMERIC(12, 2) NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_id, hall_id)
);

CREATE TABLE IF NOT EXISTS app_rg_pending_loss_limit_changes (
  wallet_id                TEXT NOT NULL,
  hall_id                  TEXT NOT NULL,
  daily_pending_value      NUMERIC(12, 2) NULL,
  daily_effective_from_ms  BIGINT NULL,
  monthly_pending_value    NUMERIC(12, 2) NULL,
  monthly_effective_from_ms BIGINT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_id, hall_id)
);

CREATE TABLE IF NOT EXISTS app_rg_restrictions (
  wallet_id                  TEXT PRIMARY KEY,
  timed_pause_until          TIMESTAMPTZ NULL,
  timed_pause_set_at         TIMESTAMPTZ NULL,
  self_excluded_at           TIMESTAMPTZ NULL,
  self_exclusion_minimum_until TIMESTAMPTZ NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_rg_play_states (
  wallet_id              TEXT PRIMARY KEY,
  accumulated_ms         BIGINT NOT NULL DEFAULT 0,
  active_from_ms         BIGINT NULL,
  pause_until_ms         BIGINT NULL,
  last_mandatory_break_json JSONB NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_rg_loss_entries (
  id            BIGSERIAL PRIMARY KEY,
  wallet_id     TEXT NOT NULL,
  hall_id       TEXT NOT NULL,
  entry_type    TEXT NOT NULL,
  amount        NUMERIC(12, 2) NOT NULL,
  created_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_loss_entries_scope
  ON app_rg_loss_entries (wallet_id, hall_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS app_rg_prize_policies (
  id                   TEXT PRIMARY KEY,
  game_type            TEXT NOT NULL,
  hall_id              TEXT NOT NULL,
  link_id              TEXT NOT NULL,
  effective_from_ms    BIGINT NOT NULL,
  single_prize_cap     NUMERIC(12, 2) NOT NULL,
  daily_extra_prize_cap NUMERIC(12, 2) NOT NULL,
  created_at_ms        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_prize_policies_scope
  ON app_rg_prize_policies (game_type, hall_id, link_id, effective_from_ms DESC);

CREATE TABLE IF NOT EXISTS app_rg_extra_prize_entries (
  id            BIGSERIAL PRIMARY KEY,
  hall_id       TEXT NOT NULL,
  link_id       TEXT NOT NULL,
  amount        NUMERIC(12, 2) NOT NULL,
  created_at_ms BIGINT NOT NULL,
  policy_id     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_extra_prizes_scope
  ON app_rg_extra_prize_entries (hall_id, link_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS app_rg_payout_audit (
  id                TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL,
  claim_id          TEXT NULL,
  game_id           TEXT NULL,
  room_code         TEXT NULL,
  hall_id           TEXT NOT NULL,
  policy_version    TEXT NULL,
  amount            NUMERIC(12, 2) NOT NULL,
  currency          TEXT NOT NULL,
  wallet_id         TEXT NOT NULL,
  player_id         TEXT NULL,
  source_account_id TEXT NULL,
  tx_ids_json       JSONB NOT NULL,
  kind              TEXT NOT NULL,
  chain_index       INTEGER NOT NULL,
  previous_hash     TEXT NOT NULL,
  event_hash        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_rg_compliance_ledger (
  id                TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL,
  created_at_ms     BIGINT NOT NULL,
  hall_id           TEXT NOT NULL,
  game_type         TEXT NOT NULL,
  channel           TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  amount            NUMERIC(12, 2) NOT NULL,
  currency          TEXT NOT NULL,
  room_code         TEXT NULL,
  game_id           TEXT NULL,
  claim_id          TEXT NULL,
  player_id         TEXT NULL,
  wallet_id         TEXT NULL,
  source_account_id TEXT NULL,
  target_account_id TEXT NULL,
  policy_version    TEXT NULL,
  batch_id          TEXT NULL,
  metadata_json     JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_ledger_wallet_date
  ON app_rg_compliance_ledger (wallet_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_rg_ledger_hall_date
  ON app_rg_compliance_ledger (hall_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS app_rg_daily_reports (
  date_key     TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  report_json  JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS app_rg_overskudd_batches (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  date              TEXT NOT NULL,
  hall_id           TEXT NULL,
  game_type         TEXT NULL,
  channel           TEXT NULL,
  required_minimum  REAL NOT NULL,
  distributed_amount REAL NOT NULL,
  transfers_json    TEXT NOT NULL,
  allocations_json  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_overskudd_batches_date
  ON app_rg_overskudd_batches (date DESC);

CREATE TABLE IF NOT EXISTS app_rg_hall_organizations (
  id                      TEXT PRIMARY KEY,
  hall_id                 TEXT NOT NULL,
  organization_id         TEXT NOT NULL,
  organization_name       TEXT NOT NULL,
  organization_account_id TEXT NOT NULL,
  share_percent           REAL NOT NULL,
  game_type               TEXT NULL,
  channel                 TEXT NULL,
  is_active               INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_hall_organizations_hall
  ON app_rg_hall_organizations (hall_id);

-- ── Payments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swedbank_payment_intents (
  id                        TEXT PRIMARY KEY,
  provider                  TEXT NOT NULL,
  user_id                   TEXT NOT NULL,
  wallet_id                 TEXT NOT NULL,
  order_reference           TEXT UNIQUE NOT NULL,
  payee_reference           TEXT UNIQUE NOT NULL,
  swedbank_payment_order_id TEXT UNIQUE NOT NULL,
  amount_minor              BIGINT NOT NULL,
  amount_major              NUMERIC(18, 2) NOT NULL,
  currency                  TEXT NOT NULL,
  status                    TEXT NOT NULL,
  checkout_redirect_url     TEXT NULL,
  checkout_view_url         TEXT NULL,
  credited_transaction_id   TEXT NULL,
  credited_at               TIMESTAMPTZ NULL,
  last_error                TEXT NULL,
  raw_create_response       JSONB NULL,
  raw_latest_status         JSONB NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swedbank_payment_intents_user
  ON swedbank_payment_intents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swedbank_payment_intents_wallet
  ON swedbank_payment_intents (wallet_id, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS swedbank_payment_intents;

DROP INDEX IF EXISTS idx_rg_hall_organizations_hall;
DROP TABLE IF EXISTS app_rg_hall_organizations;
DROP TABLE IF EXISTS app_rg_overskudd_batches;
DROP TABLE IF EXISTS app_rg_daily_reports;
DROP INDEX IF EXISTS idx_rg_ledger_hall_date;
DROP INDEX IF EXISTS idx_rg_ledger_wallet_date;
DROP TABLE IF EXISTS app_rg_compliance_ledger;
DROP TABLE IF EXISTS app_rg_payout_audit;
DROP INDEX IF EXISTS idx_rg_extra_prizes_scope;
DROP TABLE IF EXISTS app_rg_extra_prize_entries;
DROP INDEX IF EXISTS idx_rg_prize_policies_scope;
DROP TABLE IF EXISTS app_rg_prize_policies;
DROP INDEX IF EXISTS idx_rg_loss_entries_scope;
DROP TABLE IF EXISTS app_rg_loss_entries;
DROP TABLE IF EXISTS app_rg_play_states;
DROP TABLE IF EXISTS app_rg_restrictions;
DROP TABLE IF EXISTS app_rg_pending_loss_limit_changes;
DROP TABLE IF EXISTS app_rg_personal_loss_limits;

DROP INDEX IF EXISTS idx_game_checkpoints_room_code;
DROP INDEX IF EXISTS idx_game_checkpoints_game_id;
DROP TABLE IF EXISTS game_checkpoints;
DROP INDEX IF EXISTS idx_game_sessions_status;
DROP TABLE IF EXISTS game_sessions;

DROP INDEX IF EXISTS idx_hall_schedule_log_hall_id;
DROP INDEX IF EXISTS idx_hall_game_schedules_hall_id;
DROP TABLE IF EXISTS hall_schedule_log;
DROP TABLE IF EXISTS hall_game_schedules;
DROP INDEX IF EXISTS idx_app_hall_game_config_game_slug;
DROP TABLE IF EXISTS app_hall_game_config;
DROP INDEX IF EXISTS idx_rg_hall_registrations_wallet_hall_status;
DROP INDEX IF EXISTS idx_rg_hall_registrations_status_requested_at;
DROP INDEX IF EXISTS app_hall_registrations_user_id_hall_id_key;
DROP TABLE IF EXISTS app_hall_registrations;
DROP INDEX IF EXISTS idx_app_terminals_hall_id;
DROP TABLE IF EXISTS app_terminals;
DROP TABLE IF EXISTS app_halls;
DROP INDEX IF EXISTS idx_app_game_settings_change_log_game_slug_created_at;
DROP INDEX IF EXISTS idx_app_game_settings_change_log_created_at;
DROP TABLE IF EXISTS app_game_settings_change_log;
DROP TABLE IF EXISTS app_games;
DROP INDEX IF EXISTS idx_app_sessions_token_hash;
DROP TABLE IF EXISTS app_sessions;
DROP TABLE IF EXISTS app_users;

DROP INDEX IF EXISTS idx_wallet_entries_operation;
DROP INDEX IF EXISTS idx_wallet_entries_account_created;
DROP INDEX IF EXISTS idx_wallet_transactions_account_created;
DROP TABLE IF EXISTS wallet_entries;
DROP INDEX IF EXISTS idx_wallet_transactions_idempotency_key;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS wallet_accounts;
