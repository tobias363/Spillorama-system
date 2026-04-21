-- GAME1_SCHEDULE PR 4b: app_game1_draws — trukne kuler per scheduled_game.
--
-- Spec: GAME1_SCHEDULE PR 4b (draw-engine core, Alt 3 parallell draw-strøm).
--
-- Formål: append-only log av hver kule trukket i et Game 1 scheduled_game.
-- Én rad per trekning, med draw_sequence (1-indexed) + ball_value (1..75).
-- Brukes av:
--   * Admin-konsoll for å vise trekkingshistorikk + resume ved refresh.
--   * Spiller-UI for real-time display av trukne kuler (PR 4d).
--   * Pattern-evaluering (PR 4c) — leser alle draws i sekvens.
--
-- Designvalg:
--   * scheduled_game_id FK → app_game1_scheduled_games(id) ON DELETE RESTRICT:
--     trekke-historikk skal bevares (audit + regulatorisk krav).
--   * draw_sequence INT CHECK >= 1: 1-indexed rekkefølge. UNIQUE per spill
--     hindrer race-vinner-dupe.
--   * ball_value INT CHECK 1..75: kule-verdi. UNIQUE per spill hindrer at
--     samme kule trekkes to ganger (defensiv mot feil i draw-bag-logikk).
--   * current_phase_at_draw INT NULL CHECK 1..5: fase ved trekning.
--     NULL i PR 4b (fase-tracking er utsatt til PR 4c); default-fase 1.
--   * drawn_at TIMESTAMPTZ: trekne-tidspunkt for audit/replay.
--
-- Indexer:
--   * (scheduled_game_id, draw_sequence): ordered replay + resume-load.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_draws (
  id                    TEXT PRIMARY KEY,
  scheduled_game_id     TEXT NOT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Rekkefølge i trekkingen (1-indexed). UNIQUE per spill.
  draw_sequence         INTEGER NOT NULL CHECK (draw_sequence >= 1),
  ball_value            INTEGER NOT NULL
                          CHECK (ball_value >= 1 AND ball_value <= 75),
  drawn_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Fase ved trekning-øyeblikket (1..5). NULL inntil phase-tracking kobles i
  -- PR 4c.
  current_phase_at_draw INTEGER NULL
                          CHECK (current_phase_at_draw IS NULL OR
                                 (current_phase_at_draw >= 1 AND
                                  current_phase_at_draw <= 5)),
  UNIQUE (scheduled_game_id, draw_sequence),
  -- Samme kule kan ikke trekkes to ganger innen samme scheduled_game.
  UNIQUE (scheduled_game_id, ball_value)
);

CREATE INDEX IF NOT EXISTS idx_game1_draws_game_sequence
  ON app_game1_draws(scheduled_game_id, draw_sequence);

COMMENT ON TABLE app_game1_draws IS
  'GAME1_SCHEDULE PR4b: append-only log av kuler trukket per Game 1 scheduled_game. Kilden til sannhet for trekkingshistorikk.';

COMMENT ON COLUMN app_game1_draws.current_phase_at_draw IS
  'GAME1_SCHEDULE PR4b: fase (1..5) ved trekne-øyeblikket. NULL i PR 4b — phase-tracking kommer i PR 4c.';
