-- REQ-130 (PDF 9 Frontend CR): Phone+PIN-login som alternativ til Email+Password.
--
-- Spillere som primært bruker mobilen i hallen kan sette opp en 4-6-sifret
-- PIN. PIN-en kan brukes sammen med telefonnummer for rask innlogging på
-- terminal/mobil. PIN-en er ALDRI lagret i klartekst — kun scrypt-hash
-- (samme algoritme som passord-hashing for konsistens med eksisterende
-- platformService.hashPassword).
--
-- ───────── Schema ─────────
-- `app_user_pins` — én rad per bruker med PIN aktivert.
--   user_id            FK app_users (PK)         — én PIN per bruker
--   pin_hash           TEXT                      — scrypt:salt:digest envelope
--   failed_attempts    INTEGER (default 0)       — siste streak av feil-PIN
--   locked_until       TIMESTAMPTZ (nullable)    — null = ikke låst
--   last_used_at       TIMESTAMPTZ (nullable)    — siste vellykkede PIN-login
--   created_at/updated_at
--
-- Rate-limit-tilstand:
--   - 5 feilede PIN-forsøk innen 15 min → låser PIN til admin reset
--     (locked_until settes til langt i framtid; admin må kalle disable
--     eller setup på vegne av brukeren for å gjenåpne).
--   - Vellykket PIN nullstiller failed_attempts.
--
-- Up migration.

CREATE TABLE IF NOT EXISTS app_user_pins (
  user_id          TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  pin_hash         TEXT NOT NULL,
  failed_attempts  INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until     TIMESTAMPTZ NULL,
  last_used_at     TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_user_pins_locked
  ON app_user_pins(locked_until)
  WHERE locked_until IS NOT NULL;

COMMENT ON TABLE app_user_pins IS
  'Phone+PIN-login (REQ-130 / PDF 9 Frontend CR). PIN-hash bruker scrypt for konsistens med passord-hashing.';
COMMENT ON COLUMN app_user_pins.pin_hash IS
  'Scrypt-envelope: scrypt:<saltHex>:<digestHex>. Aldri klartekst, aldri loggført.';
COMMENT ON COLUMN app_user_pins.locked_until IS
  'Hvis ikke null og > now(): PIN er låst, brukeren må logge inn med passord eller admin må reset-e.';
