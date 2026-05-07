-- 2026-05-07 (Tolkning A): auto-multiplikator-modus for premier i spillkatalog.
--
-- Bakgrunn (Tobias 2026-05-07):
-- Standard hovedspill (1000-spill, 5x500, ball-x-10, bokstav, innsatsen,
-- jackpot, kvikkis, tv-extra, bingo) har én base-premie pr rad/bingo som
-- gjelder den BILLIGSTE bongen (5 kr = 500 øre). Dyrere bonger får
-- premier basert på en enkel multiplikator: faktor = ticketPrice / 500.
--   - hvit 5 kr   → base × 1
--   - gul  10 kr  → base × 2
--   - lilla 15 kr → base × 3
--
-- Spesialspill (Trafikklys o.l.) bruker en flat pris per bong + eksplisitt
-- gevinst per rad-farge — disse kan ikke bruke auto-multiplikator. Vi
-- modellerer dette som en separat modus.
--
-- Modes (whitelist håndheves i service-laget — GameCatalogService.ts):
--   "auto"               — én base, backend beregner med multiplikator
--                          (default for nye katalog-entries)
--   "explicit_per_color" — per-bongfarge-spec (Trafikklys-stil, definert via
--                          rules.gameVariant + rules.prizesPerRowColor)
--
-- For "auto"-modus forenkles `prizes_cents_json`-shape — `bingo` blir et
-- skalar `bingoBase` (gjelder billigste bong). For "explicit_per_color"
-- beholdes dagens shape med per-farge bingo-objekt.
--
-- Eksisterende katalog-data (10 entries i prod per 2026-05-07):
--   - Standard 9 spill: settes til "auto" + bingoBase = bingo.hvit (siden
--     hvit = 5 kr = billigste bong i alle eksisterende oppsett).
--   - Trafikklys: settes til "explicit_per_color" + behold rules-feltet.
-- Migrasjons-skriptet i UPDATE-blokken nedenfor håndterer dette.
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent
-- (ADD COLUMN IF NOT EXISTS, NOT NULL DEFAULT 'auto').
--
-- Up migration

ALTER TABLE app_game_catalog
  ADD COLUMN IF NOT EXISTS prize_multiplier_mode TEXT NOT NULL DEFAULT 'auto';

COMMENT ON COLUMN app_game_catalog.prize_multiplier_mode IS
  'Premie-skalering: "auto" (base × ticketPrice/500) eller "explicit_per_color" (per-farge-eksplisitt, brukes med rules.gameVariant=trafikklys o.l.). Whitelist håndheves i service-laget.';

-- Data-migrering for eksisterende katalog-rader. Idempotent: kjøres bare
-- på rader som ikke er allerede migrert (sjekker bingoBase-key i prizes).
--
-- Strategi:
-- 1) Trafikklys (rules.gameVariant = 'trafikklys') → 'explicit_per_color',
--    behold prizes_cents_json som-er.
-- 2) Alle andre → 'auto', kopier bingo.hvit (eller bingo.gul som fallback)
--    til ny bingoBase-key. Behold bingo-objektet for backwards-compat
--    (gamle plan-runs kan fortsatt lese det), men ny kode skal bruke
--    bingoBase.

DO $$
DECLARE
  rec RECORD;
  bingo_base_value INTEGER;
  current_prizes JSONB;
BEGIN
  FOR rec IN
    SELECT id, slug, prizes_cents_json, rules_json
    FROM app_game_catalog
    WHERE NOT (prizes_cents_json ? 'bingoBase')
  LOOP
    current_prizes := rec.prizes_cents_json;

    -- Trafikklys-detect: rules.gameVariant = 'trafikklys'
    IF rec.rules_json ->> 'gameVariant' = 'trafikklys' THEN
      UPDATE app_game_catalog
      SET prize_multiplier_mode = 'explicit_per_color',
          updated_at = now()
      WHERE id = rec.id;
      CONTINUE;
    END IF;

    -- Auto-modus: kopier bingo.hvit (5 kr-bong er billigste) til bingoBase.
    -- Fallback: bingo.gul hvis hvit mangler. Andre fallback: 0.
    bingo_base_value := COALESCE(
      (current_prizes -> 'bingo' ->> 'hvit')::INTEGER,
      (current_prizes -> 'bingo' ->> 'gul')::INTEGER,
      (current_prizes -> 'bingo' ->> 'lilla')::INTEGER,
      0
    );

    -- Skriv bingoBase-feltet inn i prizes_cents_json, behold resten.
    UPDATE app_game_catalog
    SET prizes_cents_json = jsonb_set(
          current_prizes,
          '{bingoBase}',
          to_jsonb(bingo_base_value),
          true
        ),
        prize_multiplier_mode = 'auto',
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END $$;
