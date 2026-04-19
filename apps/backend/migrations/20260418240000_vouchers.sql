-- BIN-587 B4b: voucher-konfigurasjon (admin-CRUD).
--
-- app_vouchers — konfigurasjon av rabatt-koder som spillere kan bruke
-- ved ticket-purchase i G2/G3. Redemption-tabellen (app_voucher_
-- redemptions) legges til som follow-up når G2/G3 player-flow portes
-- — da trenger vi historikk av hvilken user/game som brukte koden.
--
-- type:
--   PERCENTAGE → value er 0-100 (rabatt-prosent)
--   FLAT_AMOUNT → value er cents (fast rabatt-beløp)
-- max_uses:
--   NULL = ubegrenset
--   tall = antall ganger koden kan brukes totalt
-- uses_count:
--   teller opp ved redemption (follow-up wire-up i G2/G3)
-- valid_from/valid_to:
--   ISO timestamps, NULL = ingen begrensning
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_vouchers (
  id              TEXT PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('PERCENTAGE', 'FLAT_AMOUNT')),
  value           BIGINT NOT NULL CHECK (value >= 0),
  max_uses        INTEGER NULL CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count      INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  valid_from      TIMESTAMPTZ NULL,
  valid_to        TIMESTAMPTZ NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  description     TEXT NULL,
  created_by      TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Fornuftighets-sjekker: prosent kan ikke overstige 100
  CHECK (type != 'PERCENTAGE' OR value <= 100),
  -- valid_to må være etter valid_from hvis begge er satt
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_app_vouchers_active_code
  ON app_vouchers(code) WHERE is_active = true;

COMMENT ON TABLE app_vouchers IS
  'BIN-587 B4b: voucher-konfigurasjon for G2/G3 ticket-purchase. Redemption-historikk kommer som follow-up.';
COMMENT ON COLUMN app_vouchers.value IS
  'PERCENTAGE: 0-100 (rabatt%); FLAT_AMOUNT: cents.';
