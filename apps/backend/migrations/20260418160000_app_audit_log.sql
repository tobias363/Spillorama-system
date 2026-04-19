-- BIN-588: centralised compliance audit log.
--
-- Replaces the scattered console.log / ad-hoc table writes in the legacy
-- backend's controllers. Every admin action, deposit/withdraw, auth event,
-- and role change gets an immutable row here so compliance can reconstruct
-- "who did what, when, and why".
--
-- Shape is intentionally generic: actor_* identifies the caller, action
-- is a stable verb (e.g. "user.role.change"), resource_* names the
-- affected entity, and details carries the JSON payload (always redacted
-- of PII before insert — see AuditLogService). Wide enough to absorb
-- every future audit-worthy event without another schema change.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      TEXT NULL,
  actor_type    TEXT NOT NULL CHECK (actor_type IN (
                  'USER', 'ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER',
                  'SYSTEM', 'EXTERNAL'
                )),
  action        TEXT NOT NULL,
  resource      TEXT NOT NULL,
  resource_id   TEXT NULL,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address    TEXT NULL,
  user_agent    TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_audit_log_created_at
  ON app_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_audit_log_actor_created
  ON app_audit_log (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_audit_log_resource_created
  ON app_audit_log (resource, resource_id, created_at DESC)
  WHERE resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_audit_log_action_created
  ON app_audit_log (action, created_at DESC);

COMMENT ON TABLE app_audit_log IS
  'BIN-588: centralised compliance audit trail. Immutable — never updated or deleted.';
COMMENT ON COLUMN app_audit_log.action IS
  'Stable verb in dotted notation, e.g. "user.role.change", "deposit.complete", "auth.login".';
COMMENT ON COLUMN app_audit_log.details IS
  'Structured context for the event. Must be PII-redacted before insert.';
