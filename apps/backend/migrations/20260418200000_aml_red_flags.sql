-- BIN-587 B3-aml: AML red-flag rules + red-flag instances.
--
--   1. app_aml_rules — terskel-baserte regler som kan trigge red-flags.
--      Manuell flagging er også tillatt (rule_slug = "manual"). Rule-
--      engine som cron-job kommer som follow-up under BIN-582.
--
--   2. app_aml_red_flags — instans-tabell. rule_slug er tekstkopi (ikke
--      FK) slik at flag-historikk bevares selv om en regel slettes
--      eller inaktiveres. opened_by kan være null for automatiske
--      flagginger; reviewed_by settes først ved review.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_aml_rules (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT UNIQUE NOT NULL,
  label                  TEXT NOT NULL,
  severity               TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  threshold_amount_cents BIGINT NULL,
  window_days            INTEGER NULL,
  description            TEXT NULL,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_aml_red_flags (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  rule_slug       TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'REVIEWED', 'DISMISSED', 'ESCALATED')),
  reason          TEXT NOT NULL,
  transaction_id  TEXT NULL,
  details         JSONB NULL,
  opened_by       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_by     TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ NULL,
  review_outcome  TEXT NULL CHECK (review_outcome IN ('REVIEWED', 'DISMISSED', 'ESCALATED')),
  review_note     TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_aml_red_flags_user
  ON app_aml_red_flags(user_id);

CREATE INDEX IF NOT EXISTS idx_app_aml_red_flags_status_open
  ON app_aml_red_flags(status, created_at DESC) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_app_aml_red_flags_severity_status
  ON app_aml_red_flags(severity, status, created_at DESC);

COMMENT ON TABLE app_aml_rules IS
  'BIN-587 B3-aml: konfigurerbare AML-regler (terskel-baserte). Manuell flagging bruker rule_slug = "manual".';
COMMENT ON TABLE app_aml_red_flags IS
  'BIN-587 B3-aml: instans-tabell for AML red-flags. rule_slug er tekstkopi (ikke FK) så historikken bevares hvis regel slettes.';
