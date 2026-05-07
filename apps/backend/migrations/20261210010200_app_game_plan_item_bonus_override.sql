-- 2026-05-07 (Tolkning A): per-item bonus-game-override på spilleplan-item.
--
-- Bakgrunn (Tobias 2026-05-07):
-- Hovedspill = generisk "Bingo" (én katalog-entry, slug `bingo`). Bonus-
-- mini-spill (Lykkehjul, Fargekladd, Skattekiste, Mystery Joker) er IKKE
-- separate hovedspill. Bonus VELGES per spilleplan-item (posisjon i
-- sekvensen), slik at samme katalog-entry "Bingo" kan kjøres flere ganger
-- i sekvensen med ulike bonus-spill per posisjon.
--
-- Denne migrasjonen legger til `bonus_game_override` på `app_game_plan_item`.
-- NULL = bruk catalog.bonus_game_slug (fallback). Ikke-NULL = overstyrer
-- catalog.
--
-- Whitelist håndheves i service-laget (samme som BONUS_GAME_SLUG_VALUES
-- i gameCatalog.types.ts):
--   mystery, wheel_of_fortune, treasure_chest, color_draft
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent
-- (ADD COLUMN IF NOT EXISTS).
--
-- Up migration

ALTER TABLE app_game_plan_item
  ADD COLUMN IF NOT EXISTS bonus_game_override TEXT;

COMMENT ON COLUMN app_game_plan_item.bonus_game_override IS
  'Per-item bonus-spill-override. Hvis satt, overstyrer catalog.bonus_game_slug. Verdier: NULL (ingen override — fallback til catalog) | "wheel_of_fortune" | "color_draft" | "treasure_chest" | "mystery". Whitelist håndheves i service-laget (BONUS_GAME_SLUG_VALUES).';
