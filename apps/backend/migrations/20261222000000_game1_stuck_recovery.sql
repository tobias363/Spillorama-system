-- ADR-0022: Multi-lag stuck-game-recovery for Spill 1 scheduled-runder.
--
-- Tre nye kolonner for å støtte:
--   Lag 1 (Auto-resume etter phase-pause):
--     - app_game1_scheduled_games.auto_resume_eligible_at TIMESTAMPTZ NULL
--       Settes av Game1DrawEngineService når engine auto-pauser etter phase-
--       won (= now() + GAME1_AUTO_RESUME_DELAY_MS). Game1AutoResumePausedService
--       cron-tikker hvert 5. sek og auto-resumer hvis master-heartbeat er
--       stale.
--
--   Lag 4 (Master heartbeat):
--     - app_game_plan_run.master_last_seen_at TIMESTAMPTZ NULL
--       Oppdateres av masterHeartbeatEvents-handler ved hver
--       `master:heartbeat`-socket-event fra admin-web cash-inout-side.
--       Brukes av Lag 1 til å sjekke om master er aktiv.
--     - app_game_plan_run.master_last_seen_socket_id TEXT NULL
--       Sist seen socket-id; brukes ikke direkte i auto-recovery men er
--       nyttig for ops-debug ("hvilken socket sendte siste heartbeat?").
--
-- Forward-only per ADR-0014. Idempotent via IF NOT EXISTS.

-- Lag 1 — auto-resume tidsstempel på scheduled-game-rad
ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS auto_resume_eligible_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN app_game1_scheduled_games.auto_resume_eligible_at IS
  'ADR-0022 Lag 1: settes av Game1DrawEngineService når engine auto-pauser etter phase-won (=now()+AUTO_RESUME_DELAY_MS). Game1AutoResumePausedService bruker dette + master_last_seen_at for å beslutte auto-resume. NULL ved ikke-pauset eller ved master-manuell-pause.';

CREATE INDEX IF NOT EXISTS idx_app_game1_scheduled_games_auto_resume_eligible
  ON app_game1_scheduled_games(auto_resume_eligible_at)
  WHERE auto_resume_eligible_at IS NOT NULL;

-- Lag 4 — master heartbeat på plan-run
ALTER TABLE app_game_plan_run
  ADD COLUMN IF NOT EXISTS master_last_seen_at TIMESTAMPTZ NULL;

ALTER TABLE app_game_plan_run
  ADD COLUMN IF NOT EXISTS master_last_seen_socket_id TEXT NULL;

COMMENT ON COLUMN app_game_plan_run.master_last_seen_at IS
  'ADR-0022 Lag 4: sist mottatte master:heartbeat-event fra admin-web. Brukes av Game1AutoResumePausedService for å skille "master aktiv men venter bevisst" fra "master borte → auto-resume safe". 90s threshold default.';

COMMENT ON COLUMN app_game_plan_run.master_last_seen_socket_id IS
  'ADR-0022 Lag 4: socket-id for sist heartbeat — kun for ops-debug, ikke recovery-logikk.';

CREATE INDEX IF NOT EXISTS idx_app_game_plan_run_master_last_seen
  ON app_game_plan_run(master_last_seen_at)
  WHERE master_last_seen_at IS NOT NULL;
