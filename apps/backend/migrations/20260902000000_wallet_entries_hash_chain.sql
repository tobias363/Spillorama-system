-- BIN-764: Tamper-evident hash-chain for wallet_entries.
--
-- Casino-grade audit-trail: hver wallet-tx får `entry_hash = SHA256(prev_hash + canonical_json(entry_data))`.
-- Per konto (account_id) bygges en Merkle-lignende kjede der forrige hash brukes
-- som input til neste. Lotteritilsynet-revisjon kan re-beregne kjeden og verifisere
-- at logger ikke er manipulert post-hoc.
--
-- Design-valg:
--   * Per-konto-kjede (ikke global) — enklere parallelle inserts, fortsatt tamper-evident
--     fordi enhver in-place-endring ville bryte kjeden fra det punktet.
--   * `entry_hash` + `previous_entry_hash` som TEXT (hex SHA-256 = 64 chars).
--   * Genesis-rad (første entry per konto) bruker zero-hash
--     ('0000000000000000000000000000000000000000000000000000000000000000').
--   * Eksisterende rader får NULL initielt; nightly cron kan backfill-e
--     (eller en separat backfill-migrasjon).
--   * `updated_at` finnes ikke på wallet_entries (append-only) — ingen risiko for
--     UPDATE-trigger-konflikt.
--
-- Forward-only (BIN-661): ingen Down. Kolonnen `entry_hash` er essential — å droppe
-- den ville miste hele audit-trail.
--
-- Up migration

ALTER TABLE wallet_entries
  ADD COLUMN IF NOT EXISTS entry_hash TEXT,
  ADD COLUMN IF NOT EXISTS previous_entry_hash TEXT;

-- Indeks for chain-walking per konto (rekkefølge etter id = chronological).
-- Brukes av WalletAuditVerifier for å reberegne kjeden uten full table-scan.
CREATE INDEX IF NOT EXISTS idx_wallet_entries_hash_chain
  ON wallet_entries (account_id, id);

COMMENT ON COLUMN wallet_entries.entry_hash IS
  'BIN-764: SHA-256 hex over (previous_entry_hash + canonical_json(entry_data)). Tamper-evident audit-chain per account_id.';
COMMENT ON COLUMN wallet_entries.previous_entry_hash IS
  'BIN-764: entry_hash fra forrige rad (samme account_id). Genesis-rad bruker 64x ''0''.';
