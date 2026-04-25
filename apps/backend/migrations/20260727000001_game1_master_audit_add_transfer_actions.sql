-- Task 1.6: utvid `app_game1_master_audit.action`-whitelist med transfer-actions.
--
-- Game1TransferHallService skriver audit med action ∈ {
--   'transfer_request',
--   'transfer_approved',
--   'transfer_rejected',
--   'transfer_expired'
-- }.
--
-- Den eksisterende CHECK-constraint (fra migration
-- 20260428000200_game1_master_audit.sql) whitelist-er kun master-control-
-- actions (start/pause/resume/stop/exclude_hall/include_hall/
-- timeout_detected). Vi må drope og re-opprette constrainten med utvidet
-- liste.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

ALTER TABLE app_game1_master_audit
  DROP CONSTRAINT IF EXISTS app_game1_master_audit_action_check;

ALTER TABLE app_game1_master_audit
  ADD CONSTRAINT app_game1_master_audit_action_check
    CHECK (action IN (
      'start',
      'pause',
      'resume',
      'stop',
      'exclude_hall',
      'include_hall',
      'timeout_detected',
      'transfer_request',
      'transfer_approved',
      'transfer_rejected',
      'transfer_expired'
    ));

COMMENT ON COLUMN app_game1_master_audit.action IS
  'Task 1.6: utvidet whitelist med transfer_request/approved/rejected/expired for runtime master-overføring. Opprinnelig whitelist (PR 3): start, pause, resume, stop, exclude_hall, include_hall, timeout_detected.';
