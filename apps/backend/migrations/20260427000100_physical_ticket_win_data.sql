-- BIN-698: win-data schema for fysiske papirbilletter.
--
-- Prerequisite for BIN-639 (reward-all): for at admin-UI skal kunne
-- finne alle vinnende, ikke-utbetalte billetter for et spill, må
-- vinn-data persisteres på selve billett-raden. BIN-641-endepunktet
-- (`POST /api/admin/physical-tickets/:uniqueId/check-bingo`) sjekker i
-- dag read-only mot game-state + papir-innsendte tall; denne migrasjonen
-- legger til kolonner slik at første check-bingo stemples permanent.
--
-- Idempotens-regel: etter første stamping er `numbers_json` immutable.
-- Påfølgende BIN-641-kall må verifisere at klientens numbers[] matcher
-- den stemplede verdien (NUMBERS_MISMATCH ved avvik — svindel-sikring).
--
-- `won_amount_cents` er NULL til BIN-639 (reward-all) distribuerer
-- beløpet; PR-beslutning 2026-04-20: BIN-641 stamper IKKE beløp, kun
-- numbers + pattern. BIN-639 krever eksplisitt amountCents fra admin-UI
-- per billett for å unngå duplikasjon av game-prize-lookup-logikk.
--
-- Partial index `idx_app_physical_tickets_undistributed_winners` gir
-- BIN-639-query (won_amount_cents > 0 AND !distributed) en dedikert
-- hurtig path for hall-operator-UI.
--
-- Norsk pengespillforskriften §64: vinn-data er regulatorisk sporbar;
-- derfor `evaluated_at` + `winning_distributed_at` timestamper, begge
-- uendret etter skriving. Audit-log blir skrevet av BIN-639-PR 2 ved
-- distribusjon; BIN-641-stamping forblir uten audit-log (idempotent
-- check-op, samme user-perspektiv som dagens read-only).
--
-- Forward-only per BIN-661.
--
-- Up migration

ALTER TABLE app_physical_tickets
  ADD COLUMN IF NOT EXISTS numbers_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS pattern_won TEXT NULL,
  ADD COLUMN IF NOT EXISTS won_amount_cents BIGINT NULL,
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS is_winning_distributed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS winning_distributed_at TIMESTAMPTZ NULL;

-- CHECK-constraint på pattern_won — kun de 5 lovlige Bingo75-mønstrene.
-- NULL tillates (billett ikke evaluert enda, eller tapende etter eval
-- hvis vi velger å lagre null-pattern).
ALTER TABLE app_physical_tickets
  DROP CONSTRAINT IF EXISTS app_physical_tickets_pattern_won_check;
ALTER TABLE app_physical_tickets
  ADD CONSTRAINT app_physical_tickets_pattern_won_check
    CHECK (pattern_won IS NULL OR pattern_won IN ('row_1','row_2','row_3','row_4','full_house'));

-- CHECK-constraint på won_amount_cents — må være ikke-negativ når satt.
-- 0 = checked-ikke-vunnet (eksplisitt null-sum). NULL = ikke evaluert.
ALTER TABLE app_physical_tickets
  DROP CONSTRAINT IF EXISTS app_physical_tickets_won_amount_cents_check;
ALTER TABLE app_physical_tickets
  ADD CONSTRAINT app_physical_tickets_won_amount_cents_check
    CHECK (won_amount_cents IS NULL OR won_amount_cents >= 0);

-- Partial index for BIN-639 reward-all query:
--   "Finn alle SOLD billetter i et game med vunnet-men-ikke-utbetalt."
-- Scopet til (assigned_game_id) fordi BIN-639-UI iterer per game.
CREATE INDEX IF NOT EXISTS idx_app_physical_tickets_undistributed_winners
  ON app_physical_tickets(assigned_game_id)
  WHERE won_amount_cents > 0 AND is_winning_distributed = false;

COMMENT ON COLUMN app_physical_tickets.numbers_json IS
  'BIN-698: 25 tall i row-major-rekkefølge (5×5 grid, index 12 = free-centre = 0). Stemplet ved første BIN-641 check-bingo; immutable etter dette.';
COMMENT ON COLUMN app_physical_tickets.pattern_won IS
  'BIN-698: høyeste vinnende mønster stemplet av BIN-641. NULL = ikke evaluert eller tapte.';
COMMENT ON COLUMN app_physical_tickets.won_amount_cents IS
  'BIN-698: beregnet payout i cents. NULL i BIN-641 (ikke kalkulert); BIN-639 setter verdi ved distribusjon.';
COMMENT ON COLUMN app_physical_tickets.evaluated_at IS
  'BIN-698: tidspunkt for første BIN-641-stamping. NULL før første check-bingo.';
COMMENT ON COLUMN app_physical_tickets.is_winning_distributed IS
  'BIN-698: idempotens-flagg for BIN-639 reward-all. false = ikke utbetalt, true = distribuert.';
COMMENT ON COLUMN app_physical_tickets.winning_distributed_at IS
  'BIN-698: tidspunkt BIN-639 distribuerte premien. NULL før distribusjon.';
