-- Fase 4 (2026-05-07): Spilleplan-redesign — katalog-kobling på legacy
-- scheduled-games-tabell.
--
-- Bakgrunn (Fase 4-spec):
-- Fase 1-3 bygger ny modell parallelt med eksisterende:
--   app_game_catalog       = "type spill" (Jackpot, Innsatsen, ...)
--   app_game_plan          = template per (hall, ukedag, tids-vindu)
--   app_game_plan_item     = sekvens av spill i en plan
--   app_game_plan_run      = runtime-state per (hall, business_date)
--
-- For at draw-engine (Game1MasterControlService.startGame) skal kunne kjøre
-- en runde basert på katalog-data uten å re-skrive engine-stacken, bruker
-- Fase 4 en SHIM-tilnærming:
--   1) Når `/api/agent/game-plan/start` kalles (Fase 3), lager
--      GamePlanEngineBridge en `app_game1_scheduled_games`-rad i farten —
--      denne raden er dirigert av plan_run + catalog_entry og har full
--      legacy-shape så engine kan kjøre uendret.
--   2) Vi trenger to nye kolonner på `app_game1_scheduled_games` for å
--      koble tilbake til ny modell:
--      - catalog_entry_id: hvilken catalog-row er dette spillet basert på?
--      - plan_run_id: hvilken plan-run hører raden til?
--   3) Begge er NULLABLE for bakoverkompatibilitet — alle eksisterende
--      rader (spawnet av Game1ScheduleTickService før Fase 4) beholder NULL.
--      Ny kode som leser disse feltene må håndtere NULL → fall tilbake til
--      legacy-config (game_config_json + ticket_config_json).
--
-- Designvalg:
--   * Fremmednøkler: catalog_entry_id → app_game_catalog(id) ON DELETE SET
--     NULL. Hvis admin sletter en catalog-rad (sjelden — vanligvis brukes
--     soft-delete via is_active=false), beholder vi historikk. plan_run_id
--     peker til app_game_plan_run(id) ON DELETE SET NULL — runs slettes
--     ikke, men hvis det skulle skje skal ikke historikken forsvinne.
--   * Ingen backfill: forward-only (BIN-661). Migrasjons-skriptet
--     `migrate-game-plan-2026-05-07.ts` kjører separat og kan populere
--     disse feltene fra historiske rader hvis ønsket — men hvert spawn
--     etter Fase 4 deploy populerer dem direkte.
--   * Indeks (catalog_entry_id, scheduled_day): rapporter "hvilke runder
--     ble kjørt med Wheel of Fortune-katalog?" blir raske.
--   * Indeks (plan_run_id): "alle scheduled-games for en aktiv run".
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS catalog_entry_id TEXT NULL
    REFERENCES app_game_catalog(id) ON DELETE SET NULL;

ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS plan_run_id TEXT NULL
    REFERENCES app_game_plan_run(id) ON DELETE SET NULL;

-- For å spore hvilken posisjon i planen denne raden representerer.
-- Brukes for jackpot-override-lookup ved engine-start (override-keyen er
-- String(plan_position)). NULLABLE — kun satt når plan_run_id er satt.
ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS plan_position INTEGER NULL
    CHECK (plan_position IS NULL OR plan_position >= 1);

CREATE INDEX IF NOT EXISTS idx_game1_sched_catalog
  ON app_game1_scheduled_games(catalog_entry_id, scheduled_day)
  WHERE catalog_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game1_sched_plan_run
  ON app_game1_scheduled_games(plan_run_id)
  WHERE plan_run_id IS NOT NULL;

COMMENT ON COLUMN app_game1_scheduled_games.catalog_entry_id IS
  'Fase 4 (2026-05-07): kobling til app_game_catalog. NULL for legacy-rader spawnet av Game1ScheduleTickService før katalog-modell. Når satt: engine bruker catalog-konfig (premier, bongfarger, bonus-spill).';

COMMENT ON COLUMN app_game1_scheduled_games.plan_run_id IS
  'Fase 4 (2026-05-07): kobling til app_game_plan_run. NULL for legacy-rader. Når satt: GamePlanEngineBridge har spawnet raden basert på en aktiv plan-run.';

COMMENT ON COLUMN app_game1_scheduled_games.plan_position IS
  'Fase 4 (2026-05-07): hvilken posisjon i plan-sekvensen denne raden representerer. Brukes for jackpot-override-lookup (override-key=String(plan_position)). NULL for legacy-rader.';
