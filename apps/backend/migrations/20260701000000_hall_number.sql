-- Hall Number — integer identifier per hall (101, 102, ...) fra legacy-spec
-- (Admin V1.0 pages 20-28 + Admin CR 21.02.2024).
--
-- Bakgrunn:
--   Legacy-systemet bruker `hall_number` som menneskelig-lesbart heltall for
--   å mappe IP-baserte player-registreringer til riktig hall + for Import
--   Player Excel-mapping (hall_number → hall_id ved bulk-import). `slug` er
--   en intern teknisk nøkkel (URL-safe string) — hall_number er det
--   operatøren faktisk bruker i UI-et.
--
-- Designvalg:
--   * INT NULL UNIQUE: null i første omgang (ingen backfill ennå — PM vil
--     fylle inn per hall senere). UNIQUE på non-null-verdier forhindrer
--     dubletter når feltet først blir satt.
--   * Ingen CHECK-constraint på range: legacy bruker 101/102/... men det er
--     ikke regulatorisk bindende. Admin-UI validerer at verdien er
--     positivt heltall.
--   * Partial-indeks (WHERE NOT NULL) slik at vi kan raskt slå opp hall
--     basert på hall_number uten at NULL-ene gir plassbruk.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS hall_number INT NULL;

-- Separate statement så IF NOT EXISTS på constraint fungerer riktig.
-- (Postgres støtter ikke IF NOT EXISTS på ADD CONSTRAINT direkte, men vi
-- kan sjekke mot pg_constraint først.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_halls_hall_number_unique'
  ) THEN
    ALTER TABLE app_halls
      ADD CONSTRAINT app_halls_hall_number_unique UNIQUE (hall_number);
  END IF;
END $$;

COMMENT ON COLUMN app_halls.hall_number IS
  'Legacy Hall Number (101, 102, ...) brukt for IP→hall-mapping og Import Player Excel. UNIQUE når ikke NULL.';

CREATE INDEX IF NOT EXISTS idx_app_halls_hall_number
  ON app_halls (hall_number)
  WHERE hall_number IS NOT NULL;
