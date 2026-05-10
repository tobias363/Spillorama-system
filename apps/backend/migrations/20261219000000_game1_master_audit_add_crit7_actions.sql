-- Pilot-blokker fix 2026-05-10: utvid `app_game1_master_audit.action`-whitelist
-- med CRIT-7 actions som koden allerede prøver å logge.
--
-- Bakgrunn:
-- ---------
-- `Game1MasterControlService.MasterAuditAction`-type (apps/backend/src/game/
-- Game1MasterControlService.ts:59-87) inkluderer disse to actions som ble
-- innført under SPILL1_CASINO_GRADE_REVIEW_2026-04-26 (CRIT-7):
--
--   * 'start_game_with_unready_override' — master-override-flow når haller
--     ikke er ready
--   * 'start_engine_failed_rollback' — kompenserende rollback når
--     drawEngine.startGame feiler etter at master-control har committet
--     status='running'
--
-- Begge ble lagt til i koden, men CHECK-constraint på `app_game1_master_audit.
-- action` ble aldri oppdatert tilsvarende. Konsekvens:
--
--   * Master-start kan kaste ENGINE_FAILED hvis engine-startup feiler →
--     `start_engine_failed_rollback`-INSERT feiler på CHECK-constraint →
--     master-control kan ikke skrive sin egen rollback-audit.
--   * Override-pathen feiler tilsvarende.
--
-- Oppdaget av test-engineer-agent under Spor 2B (pilot-flow-e2e.sh)
-- 2026-05-10 (BIN-816 R12 + agent-execution-log).
--
-- Pilot-impact: master-start kan feile silent hvis engine ikke kan startes,
-- og rollback-auditen som skulle dokumentere feilen blir aldri skrevet
-- (CHECK-constraint-violation).
--
-- Migration:
-- ----------
-- DROP eksisterende CHECK-constraint og RE-CREATE med utvidet liste.
-- Forward-only per ADR-0014 + ADR-0010 (idempotent migrations).
-- Ingen data endres — kun constraint-definisjon.
--
-- Forbehold: hvis det allerede er rader med `action` utenfor opprinnelig
-- liste (f.eks. fra dev-stack med eldre constraint-versjon), vil de
-- fortsatt være gyldige under ny constraint siden vi UTVIDER tillatt-listen.
-- Vi snurer ALDRI noe til snevrere.

-- ── Up ────────────────────────────────────────────────────────────────────

ALTER TABLE app_game1_master_audit
  DROP CONSTRAINT IF EXISTS app_game1_master_audit_action_check;

ALTER TABLE app_game1_master_audit
  ADD CONSTRAINT app_game1_master_audit_action_check
    CHECK (action IN (
      -- Opprinnelig whitelist (PR 3, migration 20260428000200):
      'start',
      'pause',
      'resume',
      'stop',
      'exclude_hall',
      'include_hall',
      'timeout_detected',
      -- Task 1.6 (migration 20260727000001) — runtime master-overføring:
      'transfer_request',
      'transfer_approved',
      'transfer_rejected',
      'transfer_expired',
      -- CRIT-7 (denne migration, 2026-05-10) — manglende fra start:
      'start_game_with_unready_override',
      'start_engine_failed_rollback'
    ));

COMMENT ON COLUMN app_game1_master_audit.action IS
  '2026-05-10: utvidet whitelist med CRIT-7 actions (start_game_with_unready_override, start_engine_failed_rollback) som ble innført i kode SPILL1_CASINO_GRADE_REVIEW_2026-04-26 men aldri reflektert i CHECK-constraint. Tidligere whitelists: PR 3 (start/pause/resume/stop/exclude_hall/include_hall/timeout_detected), Task 1.6 (transfer_*).';
