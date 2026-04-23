-- BIN-MYSTERY M6: utvid `app_game1_mini_game_results.mini_game_type` CHECK
-- slik at verdien 'mystery' aksepteres for den nye Mystery Game mini-gamet.
--
-- Se: apps/backend/src/game/minigames/MiniGameMysteryEngine.ts — ny engine
-- implementerer `MiniGame`-interfacet med type="mystery" (portet 1:1 fra
-- legacy Unity MysteryGamePanel.cs, commit 5fda0f78).
--
-- Mystery Game er stateless per spill (single-call multi-round med seeded-
-- RNG i trigger+handleChoice). Krever ingen egen state-tabell — alt lagres
-- i `app_game1_mini_game_results.result_json` ved completion. Derfor kun
-- CHECK-utvidelse, ingen ny tabell.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

-- PostgreSQL krever DROP + ADD for å endre CHECK-constraint. IF EXISTS slik
-- at migrasjonen er idempotent mot partial-applied databaser.
ALTER TABLE app_game1_mini_game_results
  DROP CONSTRAINT IF EXISTS app_game1_mini_game_results_mini_game_type_check;

ALTER TABLE app_game1_mini_game_results
  ADD CONSTRAINT app_game1_mini_game_results_mini_game_type_check
    CHECK (mini_game_type IN (
      'wheel',
      'chest',
      'colordraft',
      'oddsen',
      'mystery'
    ));

COMMENT ON COLUMN app_game1_mini_game_results.mini_game_type IS
  'BIN-690 M1 + BIN-MYSTERY M6: framework-type-discriminator. Matcher MiniGame.type i backend/src/game/minigames/types.ts. Verdier: wheel | chest | colordraft | oddsen | mystery.';
