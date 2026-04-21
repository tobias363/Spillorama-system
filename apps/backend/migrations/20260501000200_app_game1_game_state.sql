-- GAME1_SCHEDULE PR 4b: app_game1_game_state — per-spill draw-bag state +
-- phase-progresjon.
--
-- Spec: GAME1_SCHEDULE PR 4b (draw-engine core, Alt 3 parallell draw-strøm).
--
-- Formål: én rad per scheduled_game opprettet ved engine-start. Holder:
--   1) Hele draw-bag (shuffled ved start) slik at drawNext() er deterministisk
--      og crash-resumable — vi kan re-konstruere engine-state etter restart.
--   2) draws_completed: hvor mange kuler er trukket (= draw_sequence for
--      neste draw - 1).
--   3) current_phase: gjeldende fase (1..5). PR 4b holder på 1; fase-
--      progresjon implementeres i PR 4c.
--   4) paused-flag + next_auto_draw_at: utsatt til PR 4c (auto-draw timer).
--   5) engine_started_at / engine_ended_at: livssyklus-markører.
--
-- Designvalg:
--   * scheduled_game_id PRIMARY KEY: én rad per spill. INSERT ved engine-
--     start, UPDATE ved hver draw.
--   * draw_bag_json JSONB: hele shuffled bag lagres ved start. Array av
--     tall 1..maxBallValue (typisk 60 eller 75). Lagring gjør hele
--     engine deterministisk — drawNext() plukker bag[draws_completed].
--   * draws_completed INT DEFAULT 0 CHECK >= 0: teller trukne kuler.
--   * current_phase INT DEFAULT 1 CHECK 1..5: phase-progression. PR 4b
--     holder på 1; PR 4c evaluerer mot patterns og øker.
--   * last_drawn_ball / last_drawn_at: kortvei for UI uten å joine draws.
--   * next_auto_draw_at / paused: timing-state for PR 4c auto-mode.
--   * engine_ended_at NULL inntil stopGame/drawNext→completed skjer.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_game_state (
  scheduled_game_id     TEXT PRIMARY KEY
                          REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Hele shuffled draw-bag ved start. Array av 1..maxBallValue (typisk 60
  -- eller 75). Deterministisk — drawNext() plukker bag[draws_completed].
  draw_bag_json         JSONB NOT NULL,
  -- Antall kuler som er trukket så langt (= draw_sequence for neste draw - 1).
  draws_completed       INTEGER NOT NULL DEFAULT 0
                          CHECK (draws_completed >= 0),
  -- Gjeldende fase (1..5). Starter på 1. PR 4b holder på 1; PR 4c
  -- implementerer phase-progression.
  current_phase         INTEGER NOT NULL DEFAULT 1
                          CHECK (current_phase >= 1 AND current_phase <= 5),
  -- Siste trukne kule (null ved initial state).
  last_drawn_ball       INTEGER NULL,
  last_drawn_at         TIMESTAMPTZ NULL,
  -- Timing-state (for auto-mode i PR 4c). Pause-støtte.
  next_auto_draw_at     TIMESTAMPTZ NULL,
  paused                BOOLEAN NOT NULL DEFAULT false,
  -- Livssyklus.
  engine_started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  engine_ended_at       TIMESTAMPTZ NULL
);

COMMENT ON TABLE app_game1_game_state IS
  'GAME1_SCHEDULE PR4b: én rad per Game 1 scheduled_game med shuffled draw-bag + phase-progresjon. Crash-resumable.';

COMMENT ON COLUMN app_game1_game_state.draw_bag_json IS
  'GAME1_SCHEDULE PR4b: hele shuffled draw-bag lagret ved engine-start. Array av 1..maxBallValue. Gjør drawNext() deterministisk og crash-resumable.';

COMMENT ON COLUMN app_game1_game_state.current_phase IS
  'GAME1_SCHEDULE PR4b: fase (1..5). PR 4b holder på 1; PR 4c evaluerer mønstre og øker fasen.';

COMMENT ON COLUMN app_game1_game_state.paused IS
  'GAME1_SCHEDULE PR4b: pause-flag. Oppdateres av pauseGame/resumeGame. Auto-draw-timer i PR 4c leser dette.';
