-- GAME1_SCHEDULE PR 4c: app_game1_phase_winners — per-vinner audit-rekord.
--
-- Spec: GAME1_SCHEDULE PR 4c Bolk 2 (payout + split-rounding + loyalty-hook).
--
-- Formål: én rad per fase-vinner per spill. Persisterer den fullstendige
-- payout-konteksten slik at rapporter og compliance kan rekonstruere
-- vinner-trailen uavhengig av runtime-state.
--
-- Design:
--   * scheduled_game_id + phase + assignment_id i UNIQUE — én vinner-rad
--     per brett per fase. Multiple brett fra samme spiller kan vinne samme
--     fase (sjeldent, men mulig); vi logger hvert brett separat.
--   * phase INT CHECK 1..5: fasen som ble vunnet (matcher game_state.current_phase
--     ved tidspunktet vinnerskapen ble registrert).
--   * draw_sequence_at_win: hvilken draw-sekvens utløste winnen. Gjør det
--     mulig å spore "PÅ hvilken kule ble fasen vunnet" for reporting.
--   * prize_amount_cents: faktisk utbetalt beløp per brett (allerede split).
--   * total_phase_prize_cents + winner_brett_count: total-pott og antall
--     vinnende brett som delte potten — gjør split-rounding tracable.
--   * wallet_transaction_id: ID på wallet-credit-transaksjonen. Kan være null
--     hvis payout=0 (jackpot-only eller zero-prize-fase).
--   * loyalty_points_awarded: beregnet points-tilskudd, fire-and-forget —
--     NULL hvis hook ikke ble kalt eller feilet. Kun for reporting.
--   * created_at for audit-tidsstempel.
--
-- Indekser:
--   * (scheduled_game_id, phase): lookup per spill + fase (rapporter).
--   * (winner_user_id, created_at DESC): "mine vinster" for spiller-UI.
--   * (hall_id, created_at DESC): hall-rapport.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_phase_winners (
  id                        TEXT PRIMARY KEY,
  scheduled_game_id         TEXT NOT NULL
                              REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  assignment_id             TEXT NOT NULL
                              REFERENCES app_game1_ticket_assignments(id) ON DELETE RESTRICT,
  winner_user_id            TEXT NOT NULL
                              REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id                   TEXT NOT NULL
                              REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Fase som ble vunnet (1 = "1 Rad", 2 = "2 Rader", …, 5 = "Fullt Hus").
  phase                     INTEGER NOT NULL
                              CHECK (phase >= 1 AND phase <= 5),
  -- Draw-sekvens som utløste winnen (matcher app_game1_draws.draw_sequence).
  draw_sequence_at_win      INTEGER NOT NULL
                              CHECK (draw_sequence_at_win >= 1),
  -- Faktisk utbetalt beløp pr brett i øre (etter split + evt cap).
  prize_amount_cents        INTEGER NOT NULL
                              CHECK (prize_amount_cents >= 0),
  -- Total pot for fasen før split (øre).
  total_phase_prize_cents   INTEGER NOT NULL
                              CHECK (total_phase_prize_cents >= 0),
  -- Antall vinnende brett som delte total_phase_prize_cents.
  winner_brett_count        INTEGER NOT NULL
                              CHECK (winner_brett_count >= 1),
  -- Ticket-farge ved win (for farge-basert jackpot-oppslag).
  ticket_color              TEXT NOT NULL,
  -- ID på wallet-credit-transaksjonen (null hvis payout=0).
  wallet_transaction_id     TEXT NULL,
  -- Loyalty points tildelt (null hvis hook ikke kalt / feilet).
  loyalty_points_awarded    INTEGER NULL,
  -- Hvis jackpot ble utløst ved denne vinnerskapen (kun relevant for Fullt Hus).
  jackpot_amount_cents      INTEGER NULL
                              CHECK (jackpot_amount_cents IS NULL OR jackpot_amount_cents >= 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheduled_game_id, phase, assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_game1_phase_winners_game_phase
  ON app_game1_phase_winners(scheduled_game_id, phase);

CREATE INDEX IF NOT EXISTS idx_game1_phase_winners_user
  ON app_game1_phase_winners(winner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game1_phase_winners_hall
  ON app_game1_phase_winners(hall_id, created_at DESC);

COMMENT ON TABLE app_game1_phase_winners IS
  'GAME1_SCHEDULE PR4c: én rad per vinnende brett per fase i Spill 1. Persisterer split-rounding-kontekst og wallet-tx-ID for audit.';

COMMENT ON COLUMN app_game1_phase_winners.phase IS
  'Fase 1..5 = 1 Rad | 2 Rader | 3 Rader | 4 Rader | Fullt Hus.';

COMMENT ON COLUMN app_game1_phase_winners.jackpot_amount_cents IS
  'GAME1_SCHEDULE PR4c: ekstra jackpot-utbetaling utløst sammen med payout. Kun satt hvis Fullt Hus vunnet PÅ eller FØR scheduled_game.jackpot.draw.';
