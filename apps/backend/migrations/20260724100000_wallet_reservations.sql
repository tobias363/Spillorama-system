-- BIN-693 Option B: Wallet reservasjons-tabell for pre-round bong-kjøp.
--
-- PM-beslutning 2026-04-24 (Tobias): spiller skal se saldo-reduksjon
-- umiddelbart ved bet:arm, men uten å endre regulatorisk "kjøp-tidspunkt"
-- (compliance-ledger skrives fortsatt ved startGame). Mønsteret følger
-- kredittkort-autorisasjon: reservasjon → commit eller release.
--
-- Lifecycle:
--   1. bet:arm        → INSERT status='active'
--   2. ticket:cancel  → UPDATE amount_cents (prorata) eller status='released'
--   3. startGame      → status='committed', committed_at=NOW(), faktisk transfer skjer
--   4. game-abort     → status='released', released_at=NOW()
--   5. expiry-tick    → status='expired' hvis expires_at < NOW() OG status='active'
--                       (crash-recovery: stale reservation etter backend-krasj)
--
-- Idempotens: idempotency_key er UNIQUE. Samme key ved reconnect returnerer
-- eksisterende aktiv reservasjon i stedet for å lage ny. Format:
--   arm-${roomCode}-${playerId}-${hashOfSelections}
--
-- Tilgjengelig saldo (klient-visning):
--   available_balance = deposit_balance + winnings_balance
--                       − sum(reservations WHERE status='active' AND wallet_id=X)

CREATE TABLE IF NOT EXISTS app_wallet_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'committed', 'expired')),
  room_code TEXT NOT NULL,
  game_session_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ NULL,
  committed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- Effektiv lookup for "aktive reservasjoner på denne walleten" — primær-spørsmål
-- ved saldo-beregning og klient-visning.
CREATE INDEX IF NOT EXISTS idx_wallet_reservations_wallet_active
  ON app_wallet_reservations(wallet_id) WHERE status = 'active';

-- Expiry-tick: sweep aktive reservasjoner med expires_at < NOW().
CREATE INDEX IF NOT EXISTS idx_wallet_reservations_expires_active
  ON app_wallet_reservations(expires_at) WHERE status = 'active';

-- Room-lookup: alle reservasjoner tilhørende et spesifikt rom. Brukes ved
-- game-abort (release all) og ved startGame (commit all).
CREATE INDEX IF NOT EXISTS idx_wallet_reservations_room
  ON app_wallet_reservations(room_code);

COMMENT ON TABLE app_wallet_reservations IS
  'BIN-693 Option B: wallet-reservasjoner for pre-round bong-kjøp. Commit skjer ved startGame (faktisk wallet-transfer + compliance-ledger-entry).';
COMMENT ON COLUMN app_wallet_reservations.idempotency_key IS
  'Format: arm-${roomCode}-${playerId}-${hashOfSelections}. UNIQUE så reconnect/retry ikke dupliserer reservasjoner.';
COMMENT ON COLUMN app_wallet_reservations.expires_at IS
  'TTL 30 min. Crash-recovery: bakgrunns-tick marks active→expired hvis NOW() > expires_at.';
COMMENT ON COLUMN app_wallet_reservations.game_session_id IS
  'NULL før commit. Settes av startGame når reservasjon konverteres til faktisk transfer.';
