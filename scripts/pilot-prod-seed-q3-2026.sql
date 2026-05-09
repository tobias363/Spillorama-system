-- =============================================================================
-- Spillorama pilot Q3 2026 — SQL prod-seed (alternativ til tsx-orkestrator)
-- =============================================================================
--
-- Idempotent seed-script for pilot-data direkte mot Postgres. Kan kjøres
-- manuelt mot prod via psql når TypeScript-orkestratoren ikke er tilgjengelig.
--
-- HVORFOR DENNE FILEN:
--   TypeScript-orkestratoren (`scripts/seed-pilot-prod-q3-2026.mts`) er den
--   anbefalte løsningen — den bruker validering via service-laget. Denne
--   SQL-versjonen er en fallback for scenarioer der man kun har psql og
--   trenger å seede data raskt (eks. emergency, eller når Node-runtime ikke
--   er tilgjengelig). DEN INKLUDERER IKKE SCRYPT-PASSORD-HASHING — passord
--   må settes via PlatformService eller via password-reset-flyt etter seeding.
--
-- HVA DETTE SCRIPTET GJØR:
--   1. UPSERT Group of Halls "Pilot Q3 2026 — Teknobingo" med master pinned
--      til Teknobingo Årnes, og medlemskap for alle 4 pilot-haller.
--   2. UPSERT spilleplan "Pilot Q3 2026 — Hovedplan" bundet til GoH.
--   3. UPSERT 13 plan-items i sekvens (refererer til app_game_catalog).
--   4. Skriver ikke spillere/agenter — disse må gjennom service-laget for
--      å få korrekt scrypt-hash på passordet. Bruk TypeScript-orkestratoren
--      eller registrer dem manuelt.
--
-- HALL-ID-RESOLVING:
--   Scriptet slår opp hall-id via slug i stedet for å hardkode UUID. Dette
--   gjør det robust mot lokal dev (hvor seed-halls genererer nye UUIDs per
--   run). Slugs er stabile på tvers av miljøer.
--
-- FORUTSETNINGER:
--   - Migrasjoner kjørt: 20260424000000_hall_groups, 20261210000000_app_game_catalog,
--     20261214000000_app_hall_groups_master_hall_id, samt grunn-skjema.
--   - 4 pilot-haller eksisterer i app_halls (kjør seed-halls.ts først).
--   - app_game_catalog har de 13 katalog-spillene (kjør seed-demo-pilot-day først).
--
-- BRUK:
--   psql $DATABASE_URL -f scripts/pilot-prod-seed-q3-2026.sql
--
-- IDEMPOTENT: kan kjøres flere ganger uten å skape duplikater.
--
-- TRANSAKSJON: hele scriptet kjøres i én transaksjon — ROLLBACK ved feil.
--
-- ROLLBACK: se docs/operations/PILOT_PROD_SEEDING_Q3_2026.md §Cleanup.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── Pre-flight: verify halls exist via slug ──────────────────────────────────
--
-- ABORTER hvis noen pilot-hall mangler. Vi bruker DO-block + RAISE EXCEPTION
-- så ROLLBACK rulles ut riktig.

DO $$
DECLARE
  expected_slugs text[] := ARRAY['arnes', 'bodo', 'brumunddal', 'fauske'];
  found_count int;
  missing_slugs text;
BEGIN
  SELECT count(*) INTO found_count
    FROM app_halls
   WHERE slug = ANY(expected_slugs) AND is_active = TRUE;

  IF found_count <> array_length(expected_slugs, 1) THEN
    SELECT string_agg(s, ', ' ORDER BY s) INTO missing_slugs
      FROM unnest(expected_slugs) AS s
     WHERE s NOT IN (
       SELECT slug FROM app_halls WHERE is_active = TRUE
     );
    RAISE EXCEPTION
      'pilot-prod-seed: pilot-haller mangler/inactive (slug=%, % av % funnet). Kjør apps/backend/scripts/seed-halls.ts først.',
      missing_slugs, found_count, array_length(expected_slugs, 1);
  END IF;

  RAISE NOTICE 'pilot-prod-seed: alle 4 pilot-haller verifisert (slug-lookup)';
END $$;

-- ── Pre-flight: verify game-catalog has required slugs ───────────────────────

DO $$
DECLARE
  required_slugs text[] := ARRAY[
    'bingo', '1000-spill', '5x500', 'ball-x-10', 'innsatsen', 'jackpot',
    'kvikkis', 'oddsen-55', 'oddsen-56', 'oddsen-57', 'trafikklys', 'tv-extra'
  ];
  found_count int;
  missing_slugs text;
BEGIN
  SELECT count(*) INTO found_count
    FROM app_game_catalog
   WHERE slug = ANY(required_slugs) AND is_active = TRUE;

  IF found_count < array_length(required_slugs, 1) THEN
    SELECT string_agg(s, ', ' ORDER BY s) INTO missing_slugs
      FROM unnest(required_slugs) AS s
     WHERE s NOT IN (SELECT slug FROM app_game_catalog WHERE is_active = TRUE);
    RAISE EXCEPTION
      'pilot-prod-seed: game-katalog mangler slugs: %. Kjør npm --prefix apps/backend run seed:demo-pilot-day først.',
      missing_slugs;
  END IF;

  RAISE NOTICE 'pilot-prod-seed: alle 12 unike katalog-slugs verifisert (bingo brukes 2x i sekvens)';
END $$;

-- ── 1. Group of Halls + master-binding ───────────────────────────────────────
--
-- Bruker subquery for å resolve master-hall-id via slug. Dette gjør scriptet
-- robust mot UUID-variasjon mellom miljøer.

INSERT INTO app_hall_groups
  (id, name, status, master_hall_id, products_json, extra_json,
   created_by, created_at, updated_at)
SELECT
  'pilot-q3-2026-teknobingo',
  'Pilot Q3 2026 — Teknobingo',
  'active',
  arnes.id,  -- Teknobingo Årnes (resolved via slug)
  '[]'::jsonb,
  jsonb_build_object(
    'is_test', true,
    'test_marker', 'pilot-q3-2026',
    'seeded_at', now(),
    'seeded_by_script', 'pilot-prod-seed-q3-2026.sql'
  ),
  -- created_by: foretrekker eksisterende admin, ellers NULL.
  (SELECT id FROM app_users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1),
  now(), now()
FROM app_halls arnes
WHERE arnes.slug = 'arnes'
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      status = 'active',
      master_hall_id = EXCLUDED.master_hall_id,
      extra_json = EXCLUDED.extra_json,
      deleted_at = NULL,
      updated_at = now();

-- Medlemskap: drop alle, re-insert i atomisk transaksjon.
DELETE FROM app_hall_group_members WHERE group_id = 'pilot-q3-2026-teknobingo';

INSERT INTO app_hall_group_members (group_id, hall_id, added_at)
SELECT 'pilot-q3-2026-teknobingo', id, now()
  FROM app_halls
 WHERE slug IN ('arnes', 'bodo', 'brumunddal', 'fauske')
   AND is_active = TRUE;

-- ── 2. GamePlan ──────────────────────────────────────────────────────────────

INSERT INTO app_game_plan
  (id, name, description, hall_id, group_of_halls_id,
   weekdays_json, start_time, end_time, is_active,
   created_by_user_id, created_at, updated_at)
VALUES
  ('pilot-q3-2026-hovedplan',
   'Pilot Q3 2026 — Hovedplan',
   'Pilot Q3 2026 spilleplan — alle 13 katalog-spill, 4 haller. Auto-seedet av pilot-prod-seed-q3-2026.sql.',
   NULL,  -- XOR: enten hall_id eller group_of_halls_id
   'pilot-q3-2026-teknobingo',
   '["mon","tue","wed","thu","fri","sat","sun"]'::jsonb,
   '11:00'::time,
   '21:00'::time,
   TRUE,
   (SELECT id FROM app_users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1),
   now(), now())
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      group_of_halls_id = EXCLUDED.group_of_halls_id,
      weekdays_json = EXCLUDED.weekdays_json,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      is_active = TRUE,
      updated_at = now();

-- ── 3. Plan items (13 stk i sekvens, drop+insert atomisk) ────────────────────

DELETE FROM app_game_plan_item WHERE plan_id = 'pilot-q3-2026-hovedplan';

-- INSERT i sekvens: position 1..13. Bruker subquery for å slå opp catalog-id
-- via slug (mer robust enn å hardkode UUID-er — slug er stabil per
-- SPILL_REGLER_OG_PAYOUT.md §1.4, mens id-format kan variere mellom miljøer).

INSERT INTO app_game_plan_item (id, plan_id, position, game_catalog_id, notes, created_at)
SELECT
  'pilot-q3-2026-hovedplan-item-' || row_num,
  'pilot-q3-2026-hovedplan',
  row_num,
  c.id,
  'Pilot Q3 2026 — posisjon ' || row_num || ': ' || slug_seq,
  now()
FROM (
  -- Sekvens av (position, slug) — stryk gjennom 1-13.
  -- Position 13 gjentar "bingo" som natt-spill per planlagt design.
  VALUES
    (1, 'bingo'),
    (2, '1000-spill'),
    (3, '5x500'),
    (4, 'ball-x-10'),
    (5, 'innsatsen'),
    (6, 'jackpot'),
    (7, 'kvikkis'),
    (8, 'oddsen-55'),
    (9, 'oddsen-56'),
    (10, 'oddsen-57'),
    (11, 'trafikklys'),
    (12, 'tv-extra'),
    (13, 'bingo')
) AS seq(row_num, slug_seq)
JOIN app_game_catalog c ON c.slug = seq.slug_seq
WHERE c.is_active = TRUE;

-- ── 4. Final report ──────────────────────────────────────────────────────────

DO $$
DECLARE
  goh_count int;
  member_count int;
  plan_count int;
  item_count int;
BEGIN
  SELECT count(*) INTO goh_count FROM app_hall_groups
   WHERE id = 'pilot-q3-2026-teknobingo' AND deleted_at IS NULL;
  SELECT count(*) INTO member_count FROM app_hall_group_members
   WHERE group_id = 'pilot-q3-2026-teknobingo';
  SELECT count(*) INTO plan_count FROM app_game_plan
   WHERE id = 'pilot-q3-2026-hovedplan' AND is_active = TRUE;
  SELECT count(*) INTO item_count FROM app_game_plan_item
   WHERE plan_id = 'pilot-q3-2026-hovedplan';

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  PILOT Q3 2026 — SQL SEED COMPLETE';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  GoH: % rader (forventet 1)', goh_count;
  RAISE NOTICE '  Members: % (forventet 4)', member_count;
  RAISE NOTICE '  Plan: % rader (forventet 1)', plan_count;
  RAISE NOTICE '  Items: % (forventet 13)', item_count;
  RAISE NOTICE '──────────────────────────────────────────────────────────────';
  RAISE NOTICE '  NB: spillere og bingoverter må seedes via TypeScript-';
  RAISE NOTICE '      orkestratoren (krever scrypt-hashing av passord):';
  RAISE NOTICE '      npx tsx scripts/seed-pilot-prod-q3-2026.mts';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';

  IF goh_count <> 1 OR member_count <> 4 OR plan_count <> 1 OR item_count <> 13 THEN
    RAISE EXCEPTION 'pilot-prod-seed: counts mismatch — abortere via ROLLBACK';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verifiser etter kjøring:
--   npx tsx scripts/verify-pilot-prod-q3-2026.mts
-- =============================================================================
