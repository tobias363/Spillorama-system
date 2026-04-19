-- BIN-583 B3.7 Alt B: physical-ticket batch cross-hall transfer log.
--
-- Edge-case util: admin overfører en misprinted batch fra hall A til
-- hall B. Atomisk — rejecter hvis NOEN billetter i batchen er SOLD
-- eller VOIDED (bare UNSOLD kan flyttes).
--
-- Unique Player-konseptet fra legacy (anonyme pre-paid kort) er formelt
-- droppet som NOT-NEEDED 2026-04-19 (regulatorisk review: Spillvett
-- krever identifiserte spillere; anonyme wallets vanskelig å spore).
-- Se HTTP_ENDPOINT_MATRIX.md §4b.
--
-- Up

CREATE TABLE IF NOT EXISTS app_physical_ticket_transfers (
  id                        TEXT PRIMARY KEY,
  batch_id                  TEXT NOT NULL REFERENCES app_physical_ticket_batches(id) ON DELETE CASCADE,
  from_hall_id              TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  to_hall_id                TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  reason                    TEXT NOT NULL,
  transferred_by            TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  transferred_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticket_count_at_transfer  INTEGER NOT NULL CHECK (ticket_count_at_transfer >= 0),
  CHECK (from_hall_id <> to_hall_id)
);

CREATE INDEX IF NOT EXISTS idx_physical_ticket_transfers_batch
  ON app_physical_ticket_transfers (batch_id, transferred_at DESC);
