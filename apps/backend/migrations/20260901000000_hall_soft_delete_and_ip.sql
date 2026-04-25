-- GAP #17 + #19 (audit BACKEND_1TO1_GAP_AUDIT_2026-04-24): hall soft-delete +
-- IP-adresse for legacy `/hall/check-ip-address`-paritet.
--
-- Bakgrunn (#17 — Delete hall):
--   Legacy `routes/backend.js:323` (`POST /hall/getHallDelete`) lar admin slette
--   hall etter konsolidering. Legacy gjør hard-delete via
--   `HallServices.deleteHall(_id)` etter validering av at ingen aktive
--   spill/spillere er knyttet til hallen.
--
--   Ny stack håndhever soft-delete via en ny `deleted_at TIMESTAMPTZ NULL`-
--   kolonne — ekvivalent med spillere/agenter-mønsteret. Dette bevarer
--   historikk og audit-trail (legacy mister all referanseintegritet ved hard-
--   delete). `is_active` er fortsatt på plass for "midlertidig deaktivert"-
--   semantikk; `deleted_at` er for permanent fjerning fra UI.
--
-- Bakgrunn (#19 — Pre-create hallNumber + IP-validering):
--   Legacy `hallController.checkIpAddress` (linje 1758) validerer at IP-adresse
--   er unik på tvers av haller før form submit. Brukes for IP-baseret
--   player-registrering (mappet via hall_number). Ny stack mangler
--   `ip_address`-kolonnen helt, så vi legger den til som UNIQUE-when-non-null
--   (samme mønster som `hall_number`).
--
-- Designvalg:
--   * `deleted_at TIMESTAMPTZ NULL`: soft-delete-flagg. NULL = aktiv (live);
--     TIMESTAMPTZ = soft-deleted ved gitt tidspunkt.
--   * `ip_address TEXT NULL`: tillatt fritekst (IPv4/IPv6) — backend
--     validerer format. UNIQUE-partial-indeks så NULL-er ikke teller som
--     duplikater (samme mønster som `hall_number`-indeksen).
--   * Alle eksisterende rader får `deleted_at = NULL` (default), `ip_address
--     = NULL` (ingen backfill ennå — admin fyller inn per hall).
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN app_halls.deleted_at IS
  'GAP #17: soft-delete-tidspunkt. NULL = aktiv hall; satt = soft-deleted (skjult fra UI, men beholder referanseintegritet).';

CREATE INDEX IF NOT EXISTS idx_app_halls_deleted_at
  ON app_halls (deleted_at)
  WHERE deleted_at IS NOT NULL;

ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS ip_address TEXT NULL;

COMMENT ON COLUMN app_halls.ip_address IS
  'GAP #19: IP-adresse for hall (legacy IP→hall-mapping). UNIQUE når ikke NULL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_halls_ip_address_unique'
  ) THEN
    -- Bruk partial-unique-indeks i stedet for constraint så NULL-er ikke
    -- kolliderer (Postgres tillater allerede multiple NULLs i UNIQUE-constraint
    -- på én kolonne, men vi er eksplisitte for å matche `hall_number`-mønsteret).
    CREATE UNIQUE INDEX IF NOT EXISTS app_halls_ip_address_unique
      ON app_halls (ip_address)
      WHERE ip_address IS NOT NULL;
  END IF;
END $$;
