-- MASTER_PLAN_SPILL1_PILOT_2026-04-24 §2.3 — Jackpot award-log for atomisk
-- debit-and-reset av app_game1_jackpot_state per Fullt Hus.
--
-- Bakgrunn:
--   PR #466 introduserte daglig akkumulering (state per hall-gruppe).
--   Award-pathen — selve debiten + reset til seed når Fullt Hus
--   vinnes innen draw-threshold — manglet. Denne migrasjonen og
--   tilhørende `awardJackpot()`-metode i Game1JackpotStateService
--   lukker det gapet.
--
-- Design:
--   * `idempotency_key` UNIQUE — sikrer at samme (game, draw, hall-group)
--     ikke kan utløse award to ganger (retry, partial-failure, ekstern
--     dobbel-trigger). Caller genererer key på formen
--     `g1-jackpot-{scheduledGameId}-{drawSequenceAtWin}` (jackpot
--     vinnes per spill, så stable per (game, sub-game) kombinasjon).
--   * `awarded_amount_cents` = beløp som ble debitert fra state.
--     Nullable i fallback-case der state var 0 (no-op award) — men da
--     opprettes ikke rad i det hele tatt; kolonnen er NOT NULL.
--   * `previous_amount_cents` / `new_amount_cents` for audit (revisjon
--     skal kunne rekonstruere state-historikk).
--   * `reason` valgfri TEXT (eks. "FULL_HOUSE_WITHIN_THRESHOLD",
--     "ADMIN_MANUAL_AWARD") — gir Lotteritilsynet en sjekkbar grunn.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_game1_jackpot_awards (
  id                       TEXT PRIMARY KEY,
  hall_group_id            TEXT NOT NULL
                              REFERENCES app_hall_groups(id) ON DELETE RESTRICT,
  idempotency_key          TEXT NOT NULL,
  awarded_amount_cents     BIGINT NOT NULL CHECK (awarded_amount_cents >= 0),
  previous_amount_cents    BIGINT NOT NULL CHECK (previous_amount_cents >= 0),
  new_amount_cents         BIGINT NOT NULL CHECK (new_amount_cents >= 0),
  scheduled_game_id        TEXT NULL,
  draw_sequence_at_win     INTEGER NULL CHECK (draw_sequence_at_win IS NULL OR draw_sequence_at_win >= 0),
  reason                   TEXT NULL,
  awarded_by_user_id       TEXT NULL,
  awarded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_game1_jackpot_awards_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_game1_jackpot_awards_hall_group
  ON app_game1_jackpot_awards (hall_group_id, awarded_at DESC);

CREATE INDEX IF NOT EXISTS idx_game1_jackpot_awards_scheduled_game
  ON app_game1_jackpot_awards (scheduled_game_id)
  WHERE scheduled_game_id IS NOT NULL;

COMMENT ON TABLE  app_game1_jackpot_awards IS
  'Audit-logg for jackpot-awards (debit-and-reset av app_game1_jackpot_state). MASTER_PLAN §2.3.';
COMMENT ON COLUMN app_game1_jackpot_awards.idempotency_key IS
  'Stable nøkkel per logisk award (eks. g1-jackpot-{scheduledGameId}-{drawSequenceAtWin}). UNIQUE for safe-retry.';
COMMENT ON COLUMN app_game1_jackpot_awards.awarded_amount_cents IS
  'Faktisk beløp i øre som ble trukket fra state og distribuert til vinner(e). Sum av jackpot-credit til alle vinnere.';
COMMENT ON COLUMN app_game1_jackpot_awards.previous_amount_cents IS
  'Snapshot av current_amount_cents FØR award (audit).';
COMMENT ON COLUMN app_game1_jackpot_awards.new_amount_cents IS
  'Snapshot av current_amount_cents ETTER award + reset (audit). Vanligvis = JACKPOT_DEFAULT_START_CENTS.';
COMMENT ON COLUMN app_game1_jackpot_awards.reason IS
  'Hvorfor award skjedde — FULL_HOUSE_WITHIN_THRESHOLD (auto), ADMIN_MANUAL_AWARD (admin), CORRECTION (manuell justering).';
