-- MASTER_PLAN_SPILL1_PILOT_2026-04-24 §2.3 / SPILL1_FULL_VARIANT_CATALOG §70:
-- Jackpot daglig akkumulering per hall-gruppe for Spill 1.
--
-- Produkt-spec (PM-låst, Appendix B.9):
--   * Starter 2000 kr (200_000 øre)
--   * +4000 kr/dag (400_000 øre/dag)
--   * Max 30_000 kr (3_000_000 øre)
--   * Draw-thresholds: 50 → 55 → 56 → 57 (per sub-game, IKKE eskalering
--     i ett spill — drawNext konsumerer neste threshold i lista).
--
-- Design:
--   * En rad per hall-gruppe (PK på hall_group_id). `app_game1_accumulating_pots`
--     (PR-T1) er en generell pot-framework per hall; denne tabellen er det
--     dedikerte daglig-akkumulerings-statet for Jackpott mellom spill på
--     tvers av alle haller i gruppen.
--   * `last_accumulation_date` brukes for idempotent daglig tick (2x
--     samme dag = no-op).
--   * `draw_thresholds_json` er en array [50,55,56,57] per pilot-spec —
--     tillater fremtidig per-hall-gruppe-override uten migrasjon.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_game1_jackpot_state (
  hall_group_id           TEXT PRIMARY KEY
                            REFERENCES app_hall_groups(id) ON DELETE RESTRICT,
  current_amount_cents    BIGINT NOT NULL DEFAULT 200000,   -- 2000 kr start
  last_accumulation_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  max_cap_cents           BIGINT NOT NULL DEFAULT 3000000,  -- 30k cap
  daily_increment_cents   BIGINT NOT NULL DEFAULT 400000,   -- 4000/dag
  draw_thresholds_json    JSONB NOT NULL DEFAULT '[50,55,56,57]'::jsonb,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jackpot_state_amount_nonneg CHECK (current_amount_cents >= 0),
  CONSTRAINT jackpot_state_cap_positive CHECK (max_cap_cents > 0),
  CONSTRAINT jackpot_state_increment_nonneg CHECK (daily_increment_cents >= 0)
);

COMMENT ON TABLE  app_game1_jackpot_state IS
  'Daglig-akkumulerende Jackpott-state per hall-gruppe (Spill 1, Appendix B.9).';
COMMENT ON COLUMN app_game1_jackpot_state.current_amount_cents IS
  'Nåværende jackpot-saldo i øre. 2000 kr start, økes daglig, cappes ved max_cap_cents.';
COMMENT ON COLUMN app_game1_jackpot_state.last_accumulation_date IS
  'UTC-dato for siste daglig-tick. Brukes for idempotens (samme dag to ganger = no-op).';
COMMENT ON COLUMN app_game1_jackpot_state.max_cap_cents IS
  'Øvre grense i øre. Default 3_000_000 (30 000 kr). Bredde i kolonnen tillater fremtidig override uten migrasjon.';
COMMENT ON COLUMN app_game1_jackpot_state.daily_increment_cents IS
  'Påfyll per dag i øre. Default 400_000 (4000 kr).';
COMMENT ON COLUMN app_game1_jackpot_state.draw_thresholds_json IS
  'Array av draw-sekvenser [50,55,56,57] (per sub-game). Tillater framtidig override per hall-gruppe.';

-- Seed: sørg for at alle eksisterende hall-grupper får et start-state.
-- Idempotent via ON CONFLICT DO NOTHING — migrasjonen kan trygt kjøres
-- flere ganger eller legges til etter at grupper er opprettet.
INSERT INTO app_game1_jackpot_state (hall_group_id)
SELECT id FROM app_hall_groups WHERE deleted_at IS NULL
ON CONFLICT (hall_group_id) DO NOTHING;
