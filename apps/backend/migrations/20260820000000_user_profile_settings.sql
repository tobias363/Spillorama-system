-- Profile Settings API (BIN-720): per-user selv-service-innstillinger.
--
-- Bakgrunn: PDF 8 (Frontend CR 21.02.2024) + PDF 9 (Frontend CR 2024)
-- krever at spillere kan sette følgende selv via profile-siden:
--   - Månedlig tapsgrense (økning venter 48h)
--   - Daglig tapsgrense (økning venter 48h)
--   - Block myself for X dager (1d / 7d / 30d / 1y / permanent)
--   - Language (nb-NO / en-US)
--   - Pause (cooldown-pause, eksisterende spillvett-pause)
--
-- Design-valg:
--   - Ny tabell `app_user_profile_settings` for per-user-settings som
--     IKKE er scoped per-hall (language, block-myself). Per-hall loss-
--     limits fortsetter å leve i `app_rg_personal_loss_limits` (som
--     allerede er scoped (wallet_id, hall_id)).
--   - Tabellen `app_rg_pending_loss_limit_changes` EKSISTERER fra
--     initial schema. Vi bruker den som-er — 48h-queue-logikken
--     overrides `effective_from_ms` i ProfileSettingsService.
--   - `app_rg_restrictions` eksisterer allerede. Vi legger til kolonnen
--     `blocked_until` for time-based self-exclusion (1d/7d/30d) der
--     1y-self-exclusion (`self_excluded_at` + `self_exclusion_minimum_until`)
--     beholdes som-er for bakover-kompatibilitet.
--   - `permanent`-blokkering bruker `self_excluded_at` uten tidsbegrensning
--     (via eksisterende 1-år-self-exclusion som kan forlenges).

-- Up migration

CREATE TABLE IF NOT EXISTS app_user_profile_settings (
  user_id         TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  language        TEXT NOT NULL DEFAULT 'nb-NO' CHECK (language IN ('nb-NO', 'en-US')),
  blocked_until   TIMESTAMPTZ NULL,
  blocked_reason  TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_user_profile_settings IS
  'Per-user profile settings (BIN-720): language + time-based block-myself.';
COMMENT ON COLUMN app_user_profile_settings.language IS
  'Klient-locale for i18n. Gyldige verdier: nb-NO, en-US.';
COMMENT ON COLUMN app_user_profile_settings.blocked_until IS
  'Time-based block-myself (1d/7d/30d). NULL = ikke time-blokkert. For permanent/1y-self-exclusion, se app_rg_restrictions.';

CREATE INDEX IF NOT EXISTS idx_app_user_profile_settings_blocked_until
  ON app_user_profile_settings (blocked_until)
  WHERE blocked_until IS NOT NULL;

-- Trigger for oppdatert updated_at-kolonne.
CREATE OR REPLACE FUNCTION app_user_profile_settings_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_user_profile_settings_updated_at
  ON app_user_profile_settings;

CREATE TRIGGER trg_app_user_profile_settings_updated_at
  BEFORE UPDATE ON app_user_profile_settings
  FOR EACH ROW
  EXECUTE FUNCTION app_user_profile_settings_set_updated_at();
