-- BIN-587 B2.1: single-use tokens for password reset + e-mail verify.
--
-- Felles design:
--   - id: uuid pk
--   - user_id: FK til app_users (CASCADE ved sletting)
--   - token_hash: sha256-hash (hex) av klartekst-tokenet — vi lagrer aldri
--     klartekst
--   - expires_at: UTC timestamptz
--   - used_at: timestamptz NULL — settes når tokenet er forbrukt (én gang)
--   - created_at: timestamptz default now()
--
-- Tokenets klartekst leveres kun i respons/e-post ved opprettelse og
-- kan ikke gjenopprettes fra DB. Partial index på (user_id) filtrert
-- på WHERE used_at IS NULL gir rask oppslag av aktive tokener ved
-- revoke-ved-ny-utstedelse.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_password_reset_tokens_user
  ON app_password_reset_tokens(user_id) WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_password_reset_tokens_expires
  ON app_password_reset_tokens(expires_at) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS app_email_verify_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_email_verify_tokens_user
  ON app_email_verify_tokens(user_id) WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_email_verify_tokens_expires
  ON app_email_verify_tokens(expires_at) WHERE used_at IS NULL;

COMMENT ON TABLE app_password_reset_tokens IS
  'BIN-587 B2.1: single-use passord-reset-tokens. token_hash = sha256 av klartekst.';
COMMENT ON TABLE app_email_verify_tokens IS
  'BIN-587 B2.1: single-use e-post-verify-tokens. token_hash = sha256 av klartekst.';
