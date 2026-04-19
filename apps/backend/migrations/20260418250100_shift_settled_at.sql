-- BIN-583 B3.3: app_agent_shifts.settled_at for transactions-freeze.
--
-- Når close-day fullfører settes settled_at = now(). AgentTransactionService
-- sjekker dette før cashIn/cashOut/sellPhysical/cancel og returnerer
-- SHIFT_SETTLED hvis non-null.
--
-- Skiller "shift ended (logged out, ikke ny tx ennå men kan re-åpnes via
-- re-login)" fra "shift settled (lukket regnskapsmessig, frozen)". Begge
-- gir is_active=false; bare settled_at gir freeze.
--
-- Up migration

ALTER TABLE app_agent_shifts
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ NULL;

ALTER TABLE app_agent_shifts
  ADD COLUMN IF NOT EXISTS settled_by_user_id TEXT NULL
    REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_agent_shifts_settled
  ON app_agent_shifts(settled_at) WHERE settled_at IS NOT NULL;

COMMENT ON COLUMN app_agent_shifts.settled_at IS
  'BIN-583 B3.3: når shift ble fullført via close-day. NULL = pending settlement.';
COMMENT ON COLUMN app_agent_shifts.settled_by_user_id IS
  'BIN-583 B3.3: bruker som utførte close-day. Vanligvis = user_id; ADMIN ved force.';
