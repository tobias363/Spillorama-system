-- BIN-583 B3.1: many-to-many between AGENT users and halls.
--
-- Legacy stored halls as an embedded array on the agent document
-- (`agent.hall: []`). In relational form this is a join table.
-- A sentralt administrert agent kan jobbe flere haller; vi trenger
-- m:n for 100% paritet med legacy.
--
-- Rules:
--   - An AGENT must have ≥1 hall assignment to start a shift.
--   - is_primary marks the hall the UI defaults to. Enforced as
--     partial unique-index: max one primary per user_id.
--   - Shift-start validates (user_id, hall_id) membership here.
--
-- HALL_OPERATOR fortsatt bruker `app_users.hall_id` (1:1). Denne
-- tabellen er kun for AGENT-rollen.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_agent_halls (
  user_id             TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  hall_id             TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  is_primary          BOOLEAN NOT NULL DEFAULT false,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by_user_id TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, hall_id)
);

CREATE INDEX IF NOT EXISTS idx_app_agent_halls_hall_id
  ON app_agent_halls(hall_id);

-- En agent kan kun ha én primary hall om gangen.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_app_agent_halls_primary_per_user
  ON app_agent_halls(user_id) WHERE is_primary;

COMMENT ON TABLE app_agent_halls IS
  'BIN-583: m:n mellom AGENT users og app_halls. Legacy `agent.hall[]` portet relasjonelt.';
COMMENT ON COLUMN app_agent_halls.is_primary IS
  'Default-hall for UI; partial unique-index sikrer maks én primary per agent.';
COMMENT ON COLUMN app_agent_halls.assigned_by_user_id IS
  'Admin som tildelte hallen. NULL ved self-assignment eller migrerte rader.';
