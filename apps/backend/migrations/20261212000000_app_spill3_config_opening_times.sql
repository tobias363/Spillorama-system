-- Spill 3 (monsterbingo) opening times 2026-05-08 — utvider
-- app_spill3_config med åpningstid-vindu (HH:MM-format).
--
-- Bakgrunn (Tobias 2026-05-08):
-- Spill 3 er ETT globalt rom alltid aktivt INNENFOR åpningstid. Etter
-- åpningstid skal nye runder ikke spawnes (PerpetualRoundService /
-- bridge må sjekke vinduet før start). Eksisterende rad-pause +
-- threshold-logikk uendret.
--
-- Mønster: matcher `app_close_day_log.start_time/end_time` (TEXT
-- HH:MM 24t) — service-laget validerer format og at start < end.
--
-- Default per Tobias-direktiv:
--   opening_time_start = '11:00'
--   opening_time_end   = '23:00'
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent
-- (ALTER TABLE ADD COLUMN IF NOT EXISTS, UPDATE WHERE NULL).
--
-- Up migration

ALTER TABLE app_spill3_config
  ADD COLUMN IF NOT EXISTS opening_time_start TEXT NULL,
  ADD COLUMN IF NOT EXISTS opening_time_end   TEXT NULL;

-- Backfill default-vinduer for eksisterende rader. Bruker `WHERE col
-- IS NULL` så denne migrasjonen er idempotent og ikke overskriver
-- evt. admin-justerte verdier ved replay.
UPDATE app_spill3_config
   SET opening_time_start = '11:00'
 WHERE opening_time_start IS NULL;

UPDATE app_spill3_config
   SET opening_time_end = '23:00'
 WHERE opening_time_end IS NULL;

COMMENT ON COLUMN app_spill3_config.opening_time_start IS
  'HH:MM (24t) — starten på det daglige vinduet hvor nye runder kan spawnes. Default 11:00. Service-laget validerer format og start < end.';

COMMENT ON COLUMN app_spill3_config.opening_time_end IS
  'HH:MM (24t) — slutten på det daglige vinduet hvor nye runder kan spawnes. Default 23:00. Service-laget validerer format og start < end.';
