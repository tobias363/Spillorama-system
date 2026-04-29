-- COMP-P0-002: Outbox-pattern for compliance-ledger writes (§71-pengespillforskriften).
--
-- Bakgrunn:
--   Før denne migration var compliance-ledger-write soft-fail. Hvis
--   `recordComplianceLedgerEvent` feilet (DB-error, FK-violation,
--   transient connection-død) etter at wallet-debit/credit allerede var
--   committet, gikk pengene ut uten matching §71-rad. Audit-finding
--   COMP-P0-002 i COMPLIANCE_READINESS_AUDIT_2026-04-28.md fanger dette.
--
-- Pattern (samme som BIN-761 wallet_outbox):
--   1. Call-sites kaller `ComplianceOutboxComplianceLedgerPort.record-
--      ComplianceLedgerEvent`. Decoratoren skriver event-en til
--      `app_compliance_outbox` med status='pending' OG forsøker inline
--      dispatch til underliggende ComplianceLedger.
--   2. Inline dispatch lykkes → markér rad 'processed'.
--   3. Inline dispatch feiler → rad blir 'pending' og `Compliance-
--      OutboxWorker` retry-er ved neste tick (1s default).
--   4. Etter 5 forsøk → status='dead_letter', manuell ops-replay.
--
-- Atomicitets-garantien:
--   Wallet-debit kjører i sin egen tx (PostgresWalletAdapter) med BIN-761
--   wallet_outbox-rad enqueued atomisk. Compliance-ledger-write skjer
--   POST-commit av wallet — derfor kan vi ikke holde compliance-write
--   inni samme tx som wallet-debit. Outbox-pattern løser dette ved at
--   compliance-event persisteres i `app_compliance_outbox` FØR inline
--   dispatch forsøkes. Hvis outbox-INSERT lykkes (lavere feilrate enn
--   compliance-write fordi det er én enkel INSERT uten validering/
--   aggregering) garanterer worker eventual delivery.
--
-- Idempotency-key:
--   Bruker samme deterministiske `makeComplianceLedgerIdempotencyKey`-
--   format som `app_rg_compliance_ledger.idempotency_key` (PILOT-STOP-
--   SHIP 2026-04-28). UNIQUE-constraint på outbox-tabellen sikrer at
--   to call-sites med samme key kun lager én pending-rad — retry av
--   samme call (f.eks. ved transient feil i call-stack) blir én
--   §71-rad eventually.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up migration

CREATE TABLE IF NOT EXISTS app_compliance_outbox (
  id              BIGSERIAL PRIMARY KEY,
  -- Deterministisk key matchende `makeComplianceLedgerIdempotencyKey`-format.
  -- UNIQUE — to call-sites med samme key gir én outbox-rad totalt.
  idempotency_key TEXT NOT NULL UNIQUE,
  -- Hele compliance-event-payload (alt `recordComplianceLedgerEvent`
  -- trenger). Worker rekonstruerer call-en fra payload uten ekstra
  -- DB-lookup. Schema dokumentert i ComplianceOutboxRepo-typen.
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processed', 'dead_letter')),
  attempts        INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at TIMESTAMPTZ NULL,
  last_error      TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ NULL
);

-- Worker hot-path: claim oldest pending. Partial index minimerer størrelse
-- ved at processed-rader (de fleste over tid) ekskluderes — paritet med
-- wallet_outbox.
CREATE INDEX IF NOT EXISTS idx_app_compliance_outbox_pending
  ON app_compliance_outbox (status, created_at) WHERE status = 'pending';

-- Operasjonell: liste dead-letter for manuell inspeksjon / replay.
CREATE INDEX IF NOT EXISTS idx_app_compliance_outbox_dead
  ON app_compliance_outbox (status) WHERE status = 'dead_letter';

COMMENT ON TABLE app_compliance_outbox IS
  'COMP-P0-002: outbox-tabell for compliance-ledger-events (§71). Worker (ComplianceOutboxWorker) drainer pending-rader til ComplianceLedger.recordComplianceLedgerEvent og garanterer eventual §71-rad selv om inline dispatch feiler.';
COMMENT ON COLUMN app_compliance_outbox.idempotency_key IS
  'Deterministisk key fra makeComplianceLedgerIdempotencyKey (eventType:gameId:claimId|playerId:eventSubKey). UNIQUE — sikrer at to retries av samme logiske event kun gir én §71-rad.';
COMMENT ON COLUMN app_compliance_outbox.payload IS
  'Hele recordComplianceLedgerEvent-input som JSONB (hallId, gameType, channel, eventType, amount, gameId, claimId, playerId, walletId, sourceAccountId, targetAccountId, policyVersion, batchId, metadata, eventSubKey, roomCode).';
COMMENT ON COLUMN app_compliance_outbox.status IS
  'pending → processed (success) eller dead_letter (>=5 attempts feilet).';
COMMENT ON COLUMN app_compliance_outbox.attempts IS
  'Antall forsøk worker har gjort. Inkrementeres ved hver claimNextBatch. Dead-letter ved 5.';
