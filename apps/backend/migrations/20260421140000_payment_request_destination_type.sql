-- BIN-646 (PR-B4): Legg til destination_type på app_withdraw_requests for å
-- skille bank-overføring fra kontant-utbetaling i hall (legacy `transactionType`).
--
-- Legacy-port:
--   App/Controllers/WithdrawController.js — `transactionType` (hall|bank) i
--   body. Frontend viser to adskilte køer (hallRequests.html + bankRequests.html)
--   mot samme GET-endepunkt med `?transactionType=hall|bank`-filter.
--
-- Migration-plan:
--   - Legg til kolonnen som NULL-tillatt (gamle rows er ukjent destinasjon).
--   - CHECK-constraint begrenser gyldige verdier.
--   - Ingen backfill i denne migration — legacy-rows forblir NULL (= ukjent).
--     Nye requests fra modernisert UI setter feltet eksplisitt.
--   - Indeks på (destination_type, created_at) for queue-filter-ytelse.
--
-- Up

ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS destination_type TEXT NULL;

ALTER TABLE app_withdraw_requests
  DROP CONSTRAINT IF EXISTS app_withdraw_requests_destination_type_check;

ALTER TABLE app_withdraw_requests
  ADD CONSTRAINT app_withdraw_requests_destination_type_check
    CHECK (destination_type IS NULL OR destination_type IN ('bank', 'hall'));

CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_destination_type
  ON app_withdraw_requests (destination_type, created_at DESC);

COMMENT ON COLUMN app_withdraw_requests.destination_type IS
  'BIN-646: bank = overføring til kontonummer, hall = kontant-utbetaling i hall. NULL for legacy-rows.';
