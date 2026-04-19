-- BIN-587 B3-security: admin-tabeller for sikkerhets-ops.
--
--   1. app_withdraw_email_allowlist — notifikasjons-CC-liste.
--      Revisor/økonomi får CC når uttak godkjennes. IKKE en mottaker-
--      allowlist for uttak (per PM-avklaring 2026-04-18).
--
--   2. app_risk_countries — ISO-3166 alpha-2 landekoder flagget som
--      høy-risiko. Brukt i KYC-flyt for ekstra verifisering.
--
--   3. app_blocked_ips — persistert IP-blokkliste. Lastes inn ved boot
--      i en in-memory cache med 5-min TTL. Integreres med
--      HttpRateLimiter som pre-check.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_withdraw_email_allowlist (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  label       TEXT NULL,
  added_by    TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_risk_countries (
  country_code TEXT PRIMARY KEY CHECK (char_length(country_code) = 2),
  label        TEXT NOT NULL,
  reason       TEXT NULL,
  added_by     TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_blocked_ips (
  id           TEXT PRIMARY KEY,
  ip_address   TEXT UNIQUE NOT NULL,
  reason       TEXT NULL,
  blocked_by   TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: kun IP-er uten utløpsdato (permanent blokkert).
-- BIN-657: tidligere `WHERE ... OR expires_at > now()` ble avvist av
-- Postgres fordi `now()` er STABLE (ikke IMMUTABLE) — funksjoner i
-- index-predikater må være IMMUTABLE. Droppet now()-sjekken; app-koden
-- filtrerer expired uansett (SecurityService.refreshBlockedIpCache
-- sjekker expires_at i WHERE-clause). Indeksen dekker permanente
-- blokkeringer fullt ut + hjelper expires_at-filterets planner.
CREATE INDEX IF NOT EXISTS idx_app_blocked_ips_active
  ON app_blocked_ips(ip_address)
  WHERE expires_at IS NULL;

COMMENT ON TABLE app_withdraw_email_allowlist IS
  'BIN-587 B3-security: CC-liste for uttak-notifikasjoner til revisor/økonomi. Ikke mottaker-allowlist.';
COMMENT ON TABLE app_risk_countries IS
  'BIN-587 B3-security: ISO-3166 alpha-2 landekoder flagget som høy-risiko for KYC.';
COMMENT ON TABLE app_blocked_ips IS
  'BIN-587 B3-security: persistert IP-blokkliste. Lastes i in-memory cache ved boot + på 5-min TTL.';
