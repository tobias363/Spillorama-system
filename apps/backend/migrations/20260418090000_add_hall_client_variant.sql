-- BIN-540: per-hall client-variant feature flag.
--
-- Drives the hall-for-hall cutover from the legacy Unity client to the
-- web-native one. Flipping the row is a < 2-min rollback handle:
--   UPDATE app_halls SET client_variant = 'unity' WHERE slug = 'hall-x';
--
-- Values:
--   'unity'          — legacy Unity client (default; pre-rollout state).
--   'web'            — new web-native client.
--   'unity-fallback' — reserved for forced-rollback sessions when we need
--                      to cut one hall back after a pilot incident without
--                      touching the web-clients already loaded elsewhere.
--
-- Up migration
ALTER TABLE app_halls
  ADD COLUMN client_variant VARCHAR(16) NOT NULL DEFAULT 'unity'
  CHECK (client_variant IN ('unity', 'web', 'unity-fallback'));

COMMENT ON COLUMN app_halls.client_variant IS
  'BIN-540 rollback flag: which client engine a hall serves. unity = legacy, web = new, unity-fallback = emergency cutback.';
