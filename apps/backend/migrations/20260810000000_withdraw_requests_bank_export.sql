-- Withdraw in Bank XML-export (wireframe 16.20):
--
-- Utvider eksisterende `app_withdraw_requests` med bank-felter og
-- XML-eksport-sporing. Legger også til 'EXPORTED' som gyldig status-verdi
-- i CHECK-constraint.
--
-- Bakgrunn: PM har låst XML-per-agent-format 2026-04-24. Når en
-- bank-uttaksforespørsel godkjennes, havner den i en kø til neste
-- XML-eksport (daglig cron 23:00). Etter at XML-en er generert og
-- vedlagt på e-post til regnskaps-allowlisten, settes status til
-- 'EXPORTED' og exported_xml_batch_id peker til batch-raden.
--
-- Design-valg:
--   - UTVIDELSE av eksisterende tabell, ikke ny tabell (PR-B4/BIN-646
--     bygde schema'et og `PaymentRequestService` bruker det allerede).
--   - Nye kolonner er NULL-tillatt: legacy-rader mangler bank-detaljer,
--     men accept/export-flyten krever alle tre for bank-uttak —
--     håndheves i service-laget, ikke DB.
--   - `exported_xml_batch_id` peker til `app_xml_export_batches(id)`
--     som opprettes i den påfølgende migration-filen.
--   - Kolonnene `requested_at` og `approved_at` eksisterer allerede som
--     `created_at` og `accepted_at` — vi legger ikke til duplikater, men
--     service-laget exposer dem med de domene-spesifikke navnene.
--
-- Up migration

ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT NULL;

ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS bank_name TEXT NULL;

ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS account_holder TEXT NULL;

ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ NULL;

ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS exported_xml_batch_id TEXT NULL;

-- Utvid CHECK-constraint til å inkludere 'EXPORTED' som gyldig status.
-- DROP + re-add fordi constraint-navnet kan variere på tvers av miljøer.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'app_withdraw_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%PENDING%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE app_withdraw_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END$$;

ALTER TABLE app_withdraw_requests
  ADD CONSTRAINT app_withdraw_requests_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPORTED'));

CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_exported_batch
  ON app_withdraw_requests (exported_xml_batch_id);

CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_accepted_not_exported
  ON app_withdraw_requests (status, destination_type, accepted_at)
  WHERE status = 'ACCEPTED' AND destination_type = 'bank';

COMMENT ON COLUMN app_withdraw_requests.bank_account_number IS
  'Kontonummer for bank-overføring (wireframe 16.20). NULL for legacy + hall-utbetaling.';
COMMENT ON COLUMN app_withdraw_requests.bank_name IS
  'Banknavn (f.eks. "DNB"). NULL for legacy + hall-utbetaling.';
COMMENT ON COLUMN app_withdraw_requests.account_holder IS
  'Kontoeiers fulle navn. NULL for legacy + hall-utbetaling.';
COMMENT ON COLUMN app_withdraw_requests.exported_at IS
  'Når raden ble inkludert i en XML-batch (status EXPORTED).';
COMMENT ON COLUMN app_withdraw_requests.exported_xml_batch_id IS
  'FK til app_xml_export_batches. NULL før eksport.';
