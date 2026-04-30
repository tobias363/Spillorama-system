-- HV-2 (Tobias 2026-04-30): Spill 1 hall-default prize floors.
--
-- Bakgrunn (HV2_BIR036_SPEC §2):
-- Spill 1 (slug `bingo`) skal alltid utbetale per-fase-default-gevinster (Rad 1,
-- 2, 3, 4 og Fullt Hus) **uavhengig av antall spillere / pool-størrelse**. Når
-- buy-in-pool-en ikke dekker default-floor, må huset finansiere differansen
-- (HV-2 Option A: house pre-fund gap). Dette er en pilot-blokker for
-- §11-rapporter — uten konsekvent floor-utbetaling blir Lotteritilsynet-rapporten
-- inkonsistent på tvers av haller med ulik buy-in-volum.
--
-- Strategi:
-- En per-hall-tabell `app_spill1_prize_defaults` med (hall_id, phase_index)
-- som composite primary key. phase_index 1-5 = Rad 1, Rad 2, Rad 3, Rad 4 og
-- Fullt Hus. Beløpet lagres i øre (BIGINT) for konsistens med
-- wallet-arkitekturen.
--
-- Wildcard-fallback: en `hall_id='*'`-rad seedes med
-- `SPILL1_SUB_VARIANT_DEFAULTS.standard` så Spill1PrizeDefaultsService alltid
-- har en baseline når en hall ikke har eksplisitte defaults satt
-- (backwards-compat: alle eksisterende haller får samme floor som før).
--
-- Engine-bruk:
--   * Spill1PrizeDefaultsService.getDefaults(hallId) leses ved variant-mapping
--     for slug `bingo` og brukes som baseline `minPrize` på preset-patterns.
--   * Sub-variant-preset (Wheel of Fortune, Mystery, etc.) kan ØKE floor-en,
--     men aldri senke — validering skjer i B4 (admin-UI), ikke her.
--   * For Spill 2/3 (`rocket`, `monsterbingo`) og SpinnGo (`spillorama`) er
--     denne tabellen IKKE i bruk — variable-by-ticket-count gjelder uendret.
--
-- House pre-fund gap (HV-2 Option A): når runden starter med pool < floor og
-- huset må finansiere differansen, skriver PhasePayoutService en `HOUSE_DEFICIT`
-- ledger-event med `metadata.reason = "FIXED_PRIZE_HOUSE_GUARANTEE"` (samme
-- audit-shape som eksisterende fixed-prize hus-garanti). Demo Hall RTP-bypass
-- (`is_test_hall=true` + `BINGO_TEST_HALL_BYPASS_RTP_CAP`) er uberørt.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_spill1_prize_defaults (
  hall_id TEXT NOT NULL,
  phase_index SMALLINT NOT NULL CHECK (phase_index BETWEEN 1 AND 5),
  min_prize_cents BIGINT NOT NULL CHECK (min_prize_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  PRIMARY KEY (hall_id, phase_index)
);

COMMENT ON TABLE app_spill1_prize_defaults IS
  'HV-2: per-hall Spill 1 floor-gevinster for Rad 1, 2, 3, 4 og Fullt Hus. Wildcard-rad (hall_id=*) brukes som fallback når en hall ikke har eksplisitte defaults. House pre-fund gap aktiveres når buy-in-pool < floor og huset finansierer differansen — registreres som HOUSE_DEFICIT i compliance-ledger.';

COMMENT ON COLUMN app_spill1_prize_defaults.hall_id IS
  'Hall-ID, eller "*" for wildcard-fallback brukt når ingen hall-spesifikk default er satt.';

COMMENT ON COLUMN app_spill1_prize_defaults.phase_index IS
  'Fase-nummer 1-5: 1=Rad 1, 2=Rad 2, 3=Rad 3, 4=Rad 4, 5=Fullt Hus.';

COMMENT ON COLUMN app_spill1_prize_defaults.min_prize_cents IS
  'Floor-gevinst i øre (BIGINT). Engine bruker denne som `minPrize` på preset-pattern; payout < floor utløser house pre-fund gap.';

COMMENT ON COLUMN app_spill1_prize_defaults.updated_by IS
  'User-ID som sist endret denne raden (admin-audit-spor). NULL ved migration-seed.';

-- Seed wildcard-fallback fra SPILL1_SUB_VARIANT_DEFAULTS.standard (kr → øre):
--   row1 = 100 kr  = 10 000 øre
--   row2 = 200 kr  = 20 000 øre
--   row3 = 200 kr  = 20 000 øre
--   row4 = 200 kr  = 20 000 øre
--   fullHouse = 1000 kr = 100 000 øre
--
-- Idempotent: ON CONFLICT DO NOTHING så re-deploy ikke overskriver evt.
-- justerte verdier (admin kan overstyre wildcard via service-API senere).
INSERT INTO app_spill1_prize_defaults (hall_id, phase_index, min_prize_cents, updated_by)
VALUES
  ('*', 1, 10000, NULL),
  ('*', 2, 20000, NULL),
  ('*', 3, 20000, NULL),
  ('*', 4, 20000, NULL),
  ('*', 5, 100000, NULL)
ON CONFLICT (hall_id, phase_index) DO NOTHING;
