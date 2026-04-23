-- Agent Role Management (Admin CR 21.02.2024 side 5 + Agent V1.0 permissions).
--
-- Bakgrunn:
--   Legacy Admin har per-agent permission-matrix som styrer hvilke admin-
--   moduler en agent har tilgang til. Wireframe-spec (2024-02-21) definerer
--   15 moduler * 4-5 actions (Create/Edit/View/Delete + Block/Unblock for
--   Player Management).
--
-- Design:
--   * `app_agent_permissions` holder én rad per (agent_user_id, module).
--     Finnes ingen rad → ingen tilgang (fail closed).
--   * Modul-kolonnen er begrenset av CHECK-constraint til de 15 kjente
--     modulene fra wireframe; dette speiler TypeScript-union-typen i
--     AgentPermissionService.ts slik at DB + kode er sammenkoblet.
--   * Action-kolonnene er boolean-bitmap: `can_create`, `can_edit`,
--     `can_view`, `can_delete`. `can_block_unblock` er spesifikt for
--     Player Management (Block/Unblock fra wireframe — ikke Create/Edit/
--     View/Delete).
--   * `updated_by` peker på admin-brukeren som sist endret raden (audit-
--     trail, ved siden av AuditLog-service). ON DELETE SET NULL hvis admin
--     slettes soft.
--
-- By-default (ikke lagret, håndheves i service-laget):
--   * Player Management (alle actions) + Cash In/Out Management.
--   * Disse gjelder alle agenter og kan IKKE endres av admin.
--
-- Hall-scoping:
--   * Selve permissions-matrix er IKKE hall-scoped — admin kan
--     konfigurere per-agent. Hall-filter skjer på data-lag (IP-matching
--     + app_agent_halls join ved runtime enforcement).
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent via CREATE TABLE
-- IF NOT EXISTS.

-- Up migration
CREATE TABLE IF NOT EXISTS app_agent_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN (
    'player',
    'schedule',
    'game_creation',
    'saved_game',
    'physical_ticket',
    'unique_id',
    'report',
    'wallet',
    'transaction',
    'withdraw',
    'product',
    'hall_account',
    'hall_specific_report',
    'payout',
    'accounting'
  )),
  can_create BOOLEAN NOT NULL DEFAULT false,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  -- Player Management only — ikke relevant for andre moduler (lagres 'false').
  can_block_unblock BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT uq_app_agent_permissions_agent_module UNIQUE (agent_user_id, module)
);

COMMENT ON TABLE  app_agent_permissions IS 'Per-agent permission-matrix (wireframe 2024-02-21 side 5). En rad per (agent, modul).';
COMMENT ON COLUMN app_agent_permissions.module          IS 'Modul-nøkkel fra wireframe-spec. CHECK-constraint matcher TypeScript-union AgentPermissionModule.';
COMMENT ON COLUMN app_agent_permissions.can_block_unblock IS 'Player Management only (Block/Unblock — ikke Create/Edit/View/Delete for spillere).';
COMMENT ON COLUMN app_agent_permissions.updated_by      IS 'Admin-user-id som sist endret raden. Audit-trail ved siden av AuditLog-service.';

-- Hot query: "hent alle permissions for denne agenten" (GET-endepunkt).
CREATE INDEX IF NOT EXISTS idx_app_agent_permissions_agent
  ON app_agent_permissions (agent_user_id);
