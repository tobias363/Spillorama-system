-- PILOT-STOP-SHIP fix 2026-04-28 — Compliance ledger idempotency
--
-- Bug:
--   `recordComplianceLedgerEvent` genererer randomUUID() per call, og
--   `app_rg_compliance_ledger` har bare PRIMARY KEY pa id. Soft-fail i
--   call-sites (Game1TicketPurchaseService, Game1PayoutService osv.) gjor
--   at retry etter wallet-success kan dobbel-skrive ledger-entries
--   -> §71-rapport teller stake/prize dobbelt.
--
-- Fix:
--   Legg til deterministisk `idempotency_key` med UNIQUE-constraint sa
--   `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` blir retry-
--   safe pa samme logiske event uavhengig av tilfeldig id.
--
-- Migration er idempotent (IF NOT EXISTS) og safe a re-kjore.

-- Up migration

ALTER TABLE app_rg_compliance_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Backfill eksisterende rader med id som deterministisk fallback. Gamle
-- rader er allerede unike per id, sa UNIQUE-constraint kan ikke kollidere.
-- `id` er TEXT i denne tabellen sa cast er no-op — `id::text` er trygg
-- form ogsa hvis kolonnen senere skulle bli UUID.
UPDATE app_rg_compliance_ledger
   SET idempotency_key = id::text
 WHERE idempotency_key IS NULL;

-- Las kolonnen som NOT NULL etter backfill.
ALTER TABLE app_rg_compliance_ledger
  ALTER COLUMN idempotency_key SET NOT NULL;

-- UNIQUE-index som §71-retry-guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rg_compliance_ledger_idempotency
  ON app_rg_compliance_ledger (idempotency_key);

COMMENT ON COLUMN app_rg_compliance_ledger.idempotency_key IS
  'Deterministisk key per ledger-event for retry-safe inserts. Format: <eventType>:<gameId|"no-game">:<actor>:<eventSubKey>. Brukes som ON CONFLICT-target i recordComplianceLedgerEvent for a forhindre dobbel-telling i §71-rapport.';
