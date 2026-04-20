-- BIN-668: Leaderboard tier CRUD (admin-katalog av plass→premie-mapping).
--
-- LeaderboardTier = admin-konfigurasjon av hvilke premier/poeng som deles ut
-- basert på plassering (place) i dag/periode-leaderboard. Dette er
-- KONFIGURASJON — ikke runtime-output. Runtime `/api/leaderboard` (i
-- apps/backend/src/routes/game.ts) aggregerer prize-points per bruker fra
-- faktiske wins og er urørt av denne tabellen. Admin-UI (PR-B6 Leaderboard
-- bolk) leser denne tabellen for å vise "hva tier-strukturen er" og for å
-- la admin editere hvilke plassverdier gir hvilke premier/points.
--
-- Tabellen er intensjonelt enkel: én rad per (place, tier_name) kombinasjon.
-- `tier_name` gir støtte for flere samtidige "profiler" (f.eks. "daily",
-- "weekly", "vip") — en tier-profil er en komplett plass→premie-tabell.
-- Hvis admin kun trenger ett sett, bruk tier_name="default".
--
-- Legacy-kontekst:
--   Legacy stack hadde ingen separat tier-tabell; premier ble lagt inline i
--   scheduler-snippets eller hardkodet i Unity Admin. Dette flyttes nå til
--   egen admin-CRUD slik at premie-strukturen er konfigurerbar uten
--   code-deploy.
--
-- Gjenbruk:
--   - Samme mønster som app_game_types (BIN-620) + app_hall_groups (BIN-665).
--   - Soft-delete default (sett deleted_at), hard-delete mulig når ingen
--     runtime-referanse finnes.
--   - Partial unique index på (tier_name, place) WHERE deleted_at IS NULL
--     for å hindre duplikater per profil uten å okkupere plass for
--     soft-slettede rader.
--
-- Delete-policy (matches service-laget):
--   - Soft-delete default (sett deleted_at + active=false).
--   - Hard-delete er alltid mulig — tier-raden har ingen runtime-referanser
--     (det er ren admin-konfigurasjon); eventuelle prize-awards som ble
--     utløst fra en gitt tier er lagret i audit/ledger, ikke i denne tabellen.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_leaderboard_tiers (
  id                  TEXT PRIMARY KEY,
  -- Logisk tier-profil-navn (f.eks. "default", "daily", "vip"). Lar admin
  -- vedlikeholde flere parallelle profiler. Validering i service-laget.
  tier_name           TEXT NOT NULL DEFAULT 'default',
  -- Plassering (1 = første plass, 2 = andre, osv.). Må være positiv.
  place               INTEGER NOT NULL CHECK (place > 0),
  -- Poeng tildelt for plasseringen (brukt til summering i leaderboard-
  -- aggregat). Må være ikke-negativ.
  points              INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  -- Premie-beløp i NOK (DECIMAL for regnskap — ingen floating-point slakk).
  -- NULL betyr "ingen premie" (kun poeng).
  prize_amount        NUMERIC(12, 2) NULL CHECK (prize_amount IS NULL OR prize_amount >= 0),
  -- Fri-form beskrivelse ("Gavekort 500 kr", "Vinner-trofé", etc.).
  prize_description   TEXT NOT NULL DEFAULT '',
  -- Aktiv-flag. Admin kan deaktivere en tier-rad uten å slette den.
  -- Inactive rader ignoreres av runtime-award-logikk men beholdes for
  -- historisk referanse.
  active              BOOLEAN NOT NULL DEFAULT true,
  -- Fri-form fallback for fremtidige felter (f.eks. badge-ikon,
  -- eligibility-filter, custom-payout-rules).
  extra_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

-- Unikt (tier_name, place) per profil — partial index slik at soft-slettede
-- rader ikke okkuperer plass. Admin-CRUD bruker denne for duplikat-sjekk.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_leaderboard_tiers_tier_place
  ON app_leaderboard_tiers(tier_name, place)
  WHERE deleted_at IS NULL;

-- Filter-indeks for "liste alle aktive tiers i profil X".
CREATE INDEX IF NOT EXISTS idx_app_leaderboard_tiers_tier_active
  ON app_leaderboard_tiers(tier_name, active)
  WHERE deleted_at IS NULL;

-- Ordens-indeks for ORDER BY place når vi lister en tier-profil.
CREATE INDEX IF NOT EXISTS idx_app_leaderboard_tiers_place
  ON app_leaderboard_tiers(tier_name, place ASC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE app_leaderboard_tiers IS
  'BIN-668: admin-konfigurerte leaderboard-tiers (plass→poeng/premie-mapping). Ren KONFIGURASJON; runtime-leaderboard (/api/leaderboard) er separat og aggregerer fra wins. Forventet bruk: tier_name="default" med én rad per plass (1..N).';

COMMENT ON COLUMN app_leaderboard_tiers.tier_name IS
  'BIN-668: profil-navn som grupperer et sett med tier-rader (f.eks. "default", "daily", "vip"). Unikt sammen med place.';

COMMENT ON COLUMN app_leaderboard_tiers.place IS
  'BIN-668: plassering (1-basert). Må være positiv. Unikt innenfor (tier_name, place)-par per ikke-slettet rad.';

COMMENT ON COLUMN app_leaderboard_tiers.prize_amount IS
  'BIN-668: premie-beløp i NOK. NULL = ingen premie (kun points). NUMERIC(12,2) for regnskaps-presisjon.';

COMMENT ON COLUMN app_leaderboard_tiers.active IS
  'BIN-668: aktiv-flag. Deaktivert rad beholdes for historikk men ignoreres av runtime.';
