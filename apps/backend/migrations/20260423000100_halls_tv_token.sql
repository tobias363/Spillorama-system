-- TV Screen + Winners public display: per-hall URL-embedded token.
--
-- Kontekst: public TV-skjermer i hall trenger en stabil URL med token som
-- bingoverten kan åpne i nettleseren én gang og la stå. Fra Tobias
-- (technical lead) 2026-04-23: valgt hall-token i URL (ikke IP-whitelist)
-- per docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md §8.
--
-- Hvorfor en ny kolonne i tillegg til app_hall_display_tokens (BIN-503)?
-- BIN-503 er bygget for socket-handshake (plaintext hash-storage, rotable
-- multi-token). Her trenger vi en enkel stabil URL-token per hall som er
-- safe å vise i admin-UI som "TV URL"-kolonne. Kolonnen er UNIQUE + NOT
-- NULL + auto-generert med gen_random_uuid(); eksisterende haller får
-- unik token ved migrering.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

-- pgcrypto leverer gen_random_uuid(). IF NOT EXISTS gjør dette idempotent
-- selv om extensionen allerede er installert av tidligere migrering.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS tv_token TEXT;

-- Backfill eksisterende rader før vi setter NOT NULL. Én unik token per
-- hall; gen_random_uuid() pluss suffix gir 128 bit entropi per hall.
UPDATE app_halls
   SET tv_token = gen_random_uuid()::text
 WHERE tv_token IS NULL;

ALTER TABLE app_halls
  ALTER COLUMN tv_token SET NOT NULL;

ALTER TABLE app_halls
  ALTER COLUMN tv_token SET DEFAULT gen_random_uuid()::text;

-- UNIQUE constraint: tokenet er den eneste sikkerhetsgaten for public
-- TV-endepunktet. Duplikater ville tillate cross-hall token-replay.
CREATE UNIQUE INDEX IF NOT EXISTS ix_app_halls_tv_token
  ON app_halls (tv_token);

COMMENT ON COLUMN app_halls.tv_token IS
  'TV Screen public display token (URL-embedded). Unik per hall, auto-generert ved create. Separat fra app_hall_display_tokens (BIN-503) som er for socket-auth.';
