-- System-account API-keys (PR-B 2026-05-07): langlevende API-keys for
-- ops/automation/CI som kan kalle admin-endpoints uten passord-flow.
--
-- Bakgrunn (Tobias 2026-05-07):
-- I dag krever alle admin-endepunkter en JWT som kun kan hentes via
-- `POST /api/auth/login` med email+passord. Det blokkerer Tobias' AI-flyt
-- (AI-agenter kan ikke logge inn med passord) og bryter Anthropic privacy-
-- policy (passord skal ikke deles med agenter).
--
-- Løsning: en separat `app_system_accounts`-tabell med scoped permissions,
-- hall-scope, langlevende API-keys (sa_<32hex>) og full audit-trail. Auth-
-- middleware ruter Authorization-header med `sa_`-prefix til SystemAccount-
-- AuthService; JWT-er (med `eyJ`-prefix) håndteres uendret av platform-
-- service.getUserFromAccessToken.
--
-- Sikkerhet:
--   - api_key_hash er scrypt-hashet (samme oppskrift som passord — se
--     PlatformService.hashPassword). Klartekst-key returneres ÉN gang ved
--     opprettelse, lagres aldri.
--   - permissions_json er en whitelist (subset av AdminPermission). Operasjon
--     blokkeres hvis permission ikke er i whitelist, selv om syntetisk role
--     i seg selv ville passert ADMIN_ACCESS_POLICY-sjekken.
--   - hall_scope_json: NULL = global (alle haller). Liste = bare disse hall-
--     IDene. Håndheves separat fra permission-whitelist.
--   - revoked_at: soft-delete; revoked keys avvises av verify(). is_active
--     gir rask toggle uten å gå via revoke-flow (admin kan slå av/på).
--   - last_used_at + last_used_ip: fire-and-forget update fra middleware
--     for å spore aktivitet uten å blokkere request.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_system_accounts (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  description         TEXT NULL,
  api_key_hash        TEXT NOT NULL UNIQUE,
  permissions_json    JSONB NOT NULL,
  hall_scope_json     JSONB NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ NULL,
  last_used_ip        TEXT NULL,
  created_by_user_id  TEXT NULL,
  revoked_at          TIMESTAMPTZ NULL,
  revoked_by_user_id  TEXT NULL,
  revoke_reason       TEXT NULL
);

-- Verify-flow gjør lookup på api_key_hash og må filtrere bort revoked +
-- deaktiverte rader. Partial-index gir rask happy-path.
CREATE INDEX IF NOT EXISTS idx_app_system_accounts_active
  ON app_system_accounts (api_key_hash)
  WHERE revoked_at IS NULL AND is_active = TRUE;

-- Admin-list-endpoint sorterer normalt newest-first.
CREATE INDEX IF NOT EXISTS idx_app_system_accounts_created_at
  ON app_system_accounts (created_at DESC);

COMMENT ON TABLE app_system_accounts IS
  'Langlevende API-keys for ops/automation/CI. Auth-middleware ruter Bearer-tokens med sa_-prefix hit; JWT-er (eyJ-prefix) er uendret. Permissions-whitelist + hall-scope håndheves uavhengig av syntetisk role i actor-objektet. Hver bruk skrives til app_audit_log som system_account.use.';

COMMENT ON COLUMN app_system_accounts.api_key_hash IS
  'scrypt-hash av klartekst-keyen (samme oppskrift som PlatformService.hashPassword). Klartekst returneres kun ved opprettelse og lagres aldri.';

COMMENT ON COLUMN app_system_accounts.permissions_json IS
  'JSONB-array med AdminPermission-strings (whitelist). Et anrop blokkeres hvis ønsket permission ikke er i whitelist, selv om syntetisk role ville passert ADMIN_ACCESS_POLICY-sjekken.';

COMMENT ON COLUMN app_system_accounts.hall_scope_json IS
  'JSONB-array med hall-IDer eller NULL. NULL = globalt scope (alle haller). Liste = kun disse hall-IDene tillatt for hall-scoped operasjoner.';

COMMENT ON COLUMN app_system_accounts.is_active IS
  'Quick toggle uten å gå via revoke-flow. FALSE = avvises i verify(). TRUE er default.';

COMMENT ON COLUMN app_system_accounts.last_used_at IS
  'Sist gang denne keyen autentiserte en request. Oppdateres fire-and-forget av middleware for å spore aktivitet uten å blokkere request-pipelinen.';

COMMENT ON COLUMN app_system_accounts.last_used_ip IS
  'IP-adresse som sist brukte keyen. Brukes for ops-overvåking; ikke en sikkerhets-grense (revoke key hvis du ikke kjenner igjen IP-en).';

COMMENT ON COLUMN app_system_accounts.revoked_at IS
  'Hvis satt: keyen er soft-deleted og avvises av verify() permanent. revoke_reason + revoked_by_user_id må også være satt for audit.';
