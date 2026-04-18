-- BIN-583 B3.1: add AGENT role + agent-profile fields on app_users.
--
-- Agents are the kasse-operators who run physical hall bingo: open
-- shifts, sell physical tickets, handle cash in/out. Legacy stored
-- them in a separate `agent` collection; we unify under app_users with
-- a new role so auth/profile infra is shared.
--
-- HALL_OPERATOR remains "admin personell per hall" (hall CRUD, terminal
-- CRUD, prize policy); AGENT is the operator-on-the-floor persona. Kept
-- distinct per RBAC principle — two personas, two roles.
--
-- Up

-- Drop existing CHECK so we can widen it. PlatformService.initializeSchema
-- also self-heals this constraint via ensureUserRoleConstraint() at
-- startup; this migration brings static schema in sync with the code.
ALTER TABLE app_users
  DROP CONSTRAINT IF EXISTS app_users_role_check;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('ADMIN', 'HALL_OPERATOR', 'SUPPORT', 'PLAYER', 'AGENT'));

-- Profile fields ported from legacy `agent` schema.
-- Note: chips/point/walletAmount are NOT ported — balance lives in
-- wallet_accounts. uniqId is deferred to B3.7. bankId is deferred to
-- agent-onboarding PR.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS language        TEXT NOT NULL DEFAULT 'nb';
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS avatar_filename TEXT NULL;
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS parent_user_id  TEXT NULL
    REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS agent_status    TEXT NOT NULL DEFAULT 'active';

-- Separate ALTER for the CHECK — doing it in-line with ADD COLUMN IF NOT
-- EXISTS is brittle on already-migrated databases.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_users_agent_status_check'
      AND conrelid = 'app_users'::regclass
  ) THEN
    ALTER TABLE app_users
      ADD CONSTRAINT app_users_agent_status_check
      CHECK (agent_status IN ('active', 'inactive'));
  END IF;
END $$;

COMMENT ON COLUMN app_users.language IS
  'BIN-583: ISO-639-1 UI-språk. Default nb (norsk bokmål).';
COMMENT ON COLUMN app_users.parent_user_id IS
  'BIN-583: agent-hierarki (legacy parentId). NULL for non-AGENT.';
COMMENT ON COLUMN app_users.agent_status IS
  'BIN-583: aktiv/inaktiv AGENT. inactive = kan ikke logge inn, men data bevart.';
COMMENT ON COLUMN app_users.avatar_filename IS
  'BIN-583: filnavn for profilbilde lagret i public/profile/. NULL = default-avatar.';

CREATE INDEX IF NOT EXISTS idx_app_users_parent_user_id
  ON app_users(parent_user_id) WHERE parent_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_role_agent_status
  ON app_users(role, agent_status) WHERE role = 'AGENT';
