-- BIN-761: Outbox pattern for wallet-events.
--
-- Industri-standard pattern (Pragmatic Play / Evolution): hver wallet-tx
-- skriver en `wallet_outbox`-rad i SAMME DB-tx som ledger-INSERT. En egen
-- worker (`WalletOutboxWorker`) poller pending-radene og emitter til
-- Socket.IO / Kafka / e-post / push. Eventually consistent — men aldri
-- inkonsistent (ingen wallet-credit uten matching event-rad).
--
-- Hvorfor:
--   Uten outbox skjer broadcast inline rett etter wallet-credit. Hvis
--   socket-laget feiler etter at wallet er kreditert (network blip,
--   Redis-pub-sub-glitch, server-restart), ser klienten aldri
--   oppdateringen — "min penger forsvant"-tickets oppstår.
--
-- Lifecycle:
--   1. PostgresWalletAdapter.executeLedger inserter ledger-entries.
--    I SAMME tx kalles WalletOutboxRepo.enqueue → status='pending'.
--   2. Worker poller `claimNextBatch` med `FOR UPDATE SKIP LOCKED` →
--    locker pending rader, dispatcher kjøres, status='processed'.
--   3. Hvis dispatcher kaster: `attempts++`, `last_error` settes,
--    rad blir 'pending' igjen for retry. Etter 5 forsøk → 'dead_letter'.
--
-- Idempotens-vinkelen:
--   Worker sin dispatcher må selv være idempotent på `operation_id` —
--   samme outbox-rad kan dispatches flere ganger ved retry, men siden
--   ledger-INSERT bruker UNIQUE idempotency_key er det ingen ledger-
--   side-effekter (kun re-broadcast).
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS wallet_outbox (
  id              BIGSERIAL PRIMARY KEY,
  operation_id    TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
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
-- ved at processed-rader (de fleste over tid) ekskluderes.
CREATE INDEX IF NOT EXISTS idx_wallet_outbox_pending
  ON wallet_outbox (status, created_at) WHERE status = 'pending';

-- Operasjonell: liste dead-letter for manuell inspeksjon / replay.
CREATE INDEX IF NOT EXISTS idx_wallet_outbox_dead
  ON wallet_outbox (status) WHERE status = 'dead_letter';

-- Diagnostikk: alle outbox-rader for en konkret operasjon (audit-trail).
CREATE INDEX IF NOT EXISTS idx_wallet_outbox_operation
  ON wallet_outbox (operation_id);

COMMENT ON TABLE wallet_outbox IS
  'BIN-761: outbox-tabell — wallet-events pollet av WalletOutboxWorker for å sikre at hver wallet-tx genererer en broadcast.';
COMMENT ON COLUMN wallet_outbox.operation_id IS
  'UUID matcher PostgresWalletAdapter operation_id for ledger-entries. Worker dispatcher bør være idempotent på dette.';
COMMENT ON COLUMN wallet_outbox.event_type IS
  'F.eks. "wallet.credit", "wallet.debit", "wallet.transfer" — fri streng som dispatcher mapper til socket/Kafka-event.';
COMMENT ON COLUMN wallet_outbox.payload IS
  'JSONB med nok kontekst til at dispatcher kan rekonstruere event uten ekstra DB-lookup (account_id, amount, type, deposit_balance, winnings_balance, related_account_id).';
COMMENT ON COLUMN wallet_outbox.status IS
  'pending → processed (success) eller dead_letter (>=5 attempts feilet).';
COMMENT ON COLUMN wallet_outbox.attempts IS
  'Antall forsøk worker har gjort. Inkrementeres ved hver feilet dispatch. Dead-letter ved 5.';
