-- Task 1.1: Auto-pause ved phase-won.
--
-- Gap #1 i docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md (PR #449).
-- Forankrer legacy-paritet: når Game1DrawEngineService detekterer at en fase
-- (rad 1..N / fullt hus) akkurat ble vunnet, skal engine auto-pause seg selv
-- og vente på manuell Resume fra master/agent. Datamodell: i tillegg til
-- `paused` (bool, eksisterer fra GAME1_SCHEDULE PR4b) trenger vi å spore
-- HVILKEN fase pause-en skjedde etter, slik at UI kan vise
-- "Pause etter Rad 1 — trykk Resume for Rad 2".
--
-- Designvalg:
--   * `paused_at_phase INT NULL` — sidecar til `paused`. NULL i hvilende
--     tilstand og når master har trykket Resume; satt til `current_phase`
--     ved auto-pause. Brukes av admin-UI for å rendre banner-tekst og av
--     test-suite for assertions.
--   * Ingen endring i semantikken til `paused`: true blokkerer
--     `drawNext()` (eksisterende guard i Game1DrawEngineService linje ~909)
--     og `Game1AutoDrawTickService.tick()` (eksisterende WHERE-filter
--     linje ~177).
--   * `status` (app_game1_scheduled_games) forblir 'running' under auto-
--     pause. Dette er bevisst — legacy hadde både `status='running'` og
--     `isPaused=true` som sidestate. Vi beholder DEN enkleste modellen:
--     `status='paused'` (master-initiert, eksplisitt), eller
--     `status='running' + paused=true` (auto-pause pga phase-won).
--     Resume skal håndtere begge caser; se Game1MasterControlService.
--   * Forward-only per BIN-661.
--
-- Up migration

ALTER TABLE app_game1_game_state
  ADD COLUMN IF NOT EXISTS paused_at_phase INT NULL
    CHECK (paused_at_phase IS NULL OR (paused_at_phase >= 1 AND paused_at_phase <= 5));

COMMENT ON COLUMN app_game1_game_state.paused_at_phase IS
  'Task 1.1: satt til current_phase når drawNext auto-pauser runden etter en phase-won. NULL når ikke auto-paused. Kombineres med paused=true. Nullstilles ved Resume.';
