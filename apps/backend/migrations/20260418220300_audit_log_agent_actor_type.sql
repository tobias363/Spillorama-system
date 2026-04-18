-- BIN-583 B3.1: add 'AGENT' to app_audit_log.actor_type CHECK.
--
-- BIN-588 introduced AuditLogService with actor_type CHECK covering
-- USER, ADMIN, HALL_OPERATOR, SUPPORT, PLAYER, SYSTEM, EXTERNAL.
-- B3.1 agent-auth + shift-lifecycle events need a dedicated AGENT
-- actor type to distinguish operator-floor actions from admin-CRUD
-- actions (which stay as ADMIN/HALL_OPERATOR).
--
-- One-line ALTER — less scope-vekst than spreading TODO-comments +
-- coordinating with compliance owner on a follow-up PR.
--
-- Up

ALTER TABLE app_audit_log
  DROP CONSTRAINT IF EXISTS app_audit_log_actor_type_check;

ALTER TABLE app_audit_log
  ADD CONSTRAINT app_audit_log_actor_type_check
  CHECK (actor_type IN (
    'USER', 'ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER',
    'SYSTEM', 'EXTERNAL', 'AGENT'
  ));

COMMENT ON CONSTRAINT app_audit_log_actor_type_check ON app_audit_log IS
  'BIN-583: includes AGENT for operator-floor actions (shift/cash/ticket ops).';
