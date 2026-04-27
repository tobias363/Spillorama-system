-- REQ-131: 90-day password rotation tracking.
--
-- Bakgrunn:
--   Per Wireframe Catalog (Frontend CR PDF 9 §8.2.2): "Password must be
--   changed every 90 days". Vi sporer siste passord-endring i
--   `app_users.password_changed_at` og lar klienten kalle
--   `/api/auth/me/password-needs-rotation` for å bli varslet når
--   gjenstående tid er < 7 dager (eller utløpt).
--
-- Backfill:
--   Eksisterende brukere får `password_changed_at = COALESCE(updated_at,
--   created_at, now())` så de ikke trigger umiddelbar tvunget rotasjon
--   ved deploy. Brukere som faktisk har gamle passord vil rulle inn i
--   rotasjons-vinduet over tid.
--
-- Konfigurasjon:
--   Rotasjonsperiode er konfigurerbar via env-var
--   `PASSWORD_ROTATION_DAYS=90` (default 90). Migrasjonen håndhever
--   ikke selv — backend-laget styrer policyen.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up migration

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;

UPDATE app_users
   SET password_changed_at = COALESCE(updated_at, created_at, now())
 WHERE password_changed_at IS NULL;

-- Etter backfill: alle eksisterende rader har en verdi. Nye rader fra
-- INSERT-er i PlatformService.register() / createPlayerByAdmin() vil få
-- en eksplisitt timestamp via koden.

CREATE INDEX IF NOT EXISTS idx_app_users_password_changed_at
  ON app_users (password_changed_at)
  WHERE deleted_at IS NULL;
