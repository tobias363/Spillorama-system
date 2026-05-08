-- Trafikklys runtime (2026-05-08): persistert rad-farge per scheduled-game.
--
-- Bakgrunn (TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md + SPILL_REGLER_OG_PAYOUT.md
-- §5):
-- Trafikklys-spill (`gameVariant=trafikklys`) er en spesial-variant av
-- Spill 1 hvor premier styres av RAD-FARGE (rød/grønn/gul) — IKKE bongfarge.
-- Når engine starter en Trafikklys-runde må den trekke ÉN rad-farge fra
-- `rules.rowColors` og bevare valget gjennom hele runden (Rad 1 → Rad 2 →
-- Rad 3 → Rad 4 → Fullt Hus). Klient (TV-skjerm + spiller-app) henter
-- rad-fargen fra game-state-snapshot for å vise banner ("Denne runden er
-- GRØNN").
--
-- Persistering:
-- Vi legger rad-fargen som egen kolonne `trafikklys_row_color` på
-- `app_game1_scheduled_games`. Alternativene var:
--   1) Egen kolonne (valgt)               — typesikker (CHECK-constraint),
--                                           lett å spørre + indekserbar.
--   2) Inn i `game_config_json.spill1.trafikklys.rowColor`
--                                          — krever JSON-mutering ved
--                                            startGame; mer kompleks å
--                                            audite på tvers av runder.
--   3) Inn i `game_state.markings_json` el.l.
--                                          — feil semantikk; rad-farge
--                                            er ikke draw-state.
-- Egen kolonne gir tydeligst lesbarhet og audit-flyt.
--
-- Verdier:
-- Whitelist via CHECK-constraint: 'rød', 'grønn', 'gul'. NULL betyr "ikke
-- Trafikklys-spill" eller "ikke trukket ennå" (legacy-rader får NULL).
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent
-- (ADD COLUMN IF NOT EXISTS).
--
-- Up

ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS trafikklys_row_color TEXT NULL
    CHECK (
      trafikklys_row_color IS NULL
      OR trafikklys_row_color IN ('rød', 'grønn', 'gul')
    );

COMMENT ON COLUMN app_game1_scheduled_games.trafikklys_row_color IS
  'Trafikklys runtime (2026-05-08): server-trukket rad-farge for Trafikklys-spill (rules.gameVariant=trafikklys). Bestemmer hvilken pot som brukes for Rad 1-4 (rules.prizesPerRowColor) og Fullt Hus (rules.bingoPerRowColor). NULL for ikke-Trafikklys-spill (standard hovedspill, Oddsen) og legacy-rader. Verdier: rød/grønn/gul.';
