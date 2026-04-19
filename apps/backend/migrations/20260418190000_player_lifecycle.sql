-- BIN-587 B2.3: player-lifecycle-infrastruktur.
--
--   1. `app_users.deleted_at` — soft-delete. Ikke anonymiserer raden (i
--      motsetning til `deleteAccount` som skriver over e-post + navn).
--      Brukes av admin for å deaktivere en konto midlertidig med mulighet
--      for restore. Alle kjerne-queries (login, session-oppslag) må
--      filtrere `deleted_at IS NULL`.
--   2. `app_player_hall_status` — per-hall aktiv/inaktiv. Lar en operatør
--      blokkere en problemspiller i sin hall uten å påvirke spillerens
--      tilgang i andre haller. Er-ikke-tilgjengelig-i-X er ikke det
--      samme som self-exclusion (som er på loss-limits/wallet-siden).
--
-- Up migration

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_deleted_at
  ON app_users(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_player_hall_status (
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  hall_id     TEXT NOT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  reason      TEXT NULL,
  updated_by  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hall_id)
);

CREATE INDEX IF NOT EXISTS idx_app_player_hall_status_hall
  ON app_player_hall_status(hall_id) WHERE is_active = false;

COMMENT ON COLUMN app_users.deleted_at IS
  'BIN-587 B2.3: soft-delete — keep row, filter active queries by deleted_at IS NULL.';
COMMENT ON TABLE app_player_hall_status IS
  'BIN-587 B2.3: per-hall aktiv/inaktiv-status for spillere. Null-rad = aktiv som default.';
