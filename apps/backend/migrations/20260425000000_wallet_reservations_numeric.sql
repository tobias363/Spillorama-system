-- Up migration
--
-- PR #513 review §1.1 (KRITISK pilot-blokker, 2026-04-25):
-- Bytt `app_wallet_reservations.amount_cents` fra BIGINT (heltall) til
-- NUMERIC(20,6) for å matche resten av wallet-skjemaet
-- (`wallet_accounts.deposit_balance`, `wallet_accounts.winnings_balance`,
--  `wallet_transactions.amount`, `wallet_entries.amount` — alle NUMERIC(20,6)).
--
-- Bug-detaljer:
--   `roomEvents.ts:reservePreRoundDelta` beregner `deltaKr = deltaWeighted * entryFee`
--   hvor `entryFee` kan være desimal (f.eks. 12.50 kr per brett). Med BIGINT-kolonne
--   trunkerte Postgres `amount_cents` til heltall ved INSERT — så et 12.50 kr brett
--   ble lagret som 12 kr og spilleren fikk 0.50 kr "gratis" per brett.
--
-- Nominalformat:
--   Selv om kolonnen heter `amount_cents` har den faktisk alltid lagret hele kroner
--   (ikke ører) — `reserve()` får inn `deltaKr` som tall i kroner og lagrer som-er.
--   Navnet `_cents` er en arv fra første skisse; vi rør ikke navnet for å holde
--   migrasjonen minimal og ikke tvinge endringer i alle queries. Presisjonen
--   matcher nå `wallet_accounts.balance` (NUMERIC(20,6)).
--
-- Idempotent:
--   - `ALTER COLUMN ... TYPE` med samme target-type er no-op i PG
--   - CHECK-constraint dropping/recreating er via `ALTER TABLE ... DROP/ADD CONSTRAINT IF EXISTS/IF NOT EXISTS`
--   - Hele migrasjonen er trygg å re-kjøre (men bør ikke trenges).
--
-- Test-strategi:
--   - PostgresWalletAdapter.reservation.test.ts dekker fractional-NOK (12.50 × 1)
--     og bekrefter at lagret beløp er nøyaktig 12.5 (ikke 12).

-- Endre datatype. NUMERIC har implicit cast fra BIGINT, så ingen data-tap
-- ved oppgradering av eksisterende rader.
ALTER TABLE app_wallet_reservations
  ALTER COLUMN amount_cents TYPE NUMERIC(20, 6) USING amount_cents::numeric(20, 6);

-- CHECK-constraint må re-formuleres for NUMERIC-semantikk. BIGINT > 0 og
-- NUMERIC > 0 har samme effektive betydning, men constraint-navnet kan ha
-- ulike former i forskjellige PG-versjoner — vi dropper IF EXISTS for
-- robusthet og legger til en eksplisitt navngitt constraint.
ALTER TABLE app_wallet_reservations
  DROP CONSTRAINT IF EXISTS app_wallet_reservations_amount_cents_check;

ALTER TABLE app_wallet_reservations
  ADD CONSTRAINT app_wallet_reservations_amount_positive
  CHECK (amount_cents > 0);

COMMENT ON COLUMN app_wallet_reservations.amount_cents IS
  'PR #513 §1.1: NUMERIC(20,6) for å matche wallet-balance-presisjon. '
  'Lagrer hele kroner (ikke ører) til tross for legacy-navn. Fractional-NOK '
  '(eks. 12.50 kr/brett) støttes nå uten trunkering.';
