-- Spill 3 (monsterbingo) re-design 2026-05-08 — globalt rom, auto-start på threshold.
--
-- Bakgrunn (Tobias 2026-05-08):
-- Spill 3 redesignes til en globalt-konfigurerbar singleton: ETT globalt rom
-- alltid aktivt for ALLE haller, automatisk runde-start når X bonger er solgt
-- (admin-konfigurerbar threshold), faste 3-sekunders pauser mellom Rad 1 → 2
-- → 3 → 4 → Fullt Hus, kun 1 type bong (5 kr), online-only.
--
-- Premier kan settes på to måter (admin velger global modus):
--   1. "fixed"      — fast kr-beløp per fase (uavhengig av antall solgte bonger)
--   2. "percentage" — prosent av total bong-omsetning for runden
--
-- Modellen er en singleton (ÉN aktiv konfig globalt). Det finnes alltid
-- nøyaktig én aktiv rad — endringer overskriver eksisterende verdier; vi
-- beholder historikk via opprettelsestidsstempel og audit-log via
-- service-laget. Designet er bevisst enkelt: dette er ikke per-hall eller
-- per-spilleplan-item — det er global konfig som master kan justere
-- løpende uten kode-deploy.
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent
-- (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_spill3_config (
  id                          TEXT PRIMARY KEY,
  -- Antall bonger som må selges totalt før runden auto-starter. Samme som
  -- Spill 2/3's `minTicketsBeforeCountdown` men her gjelder det runde-start
  -- (ikke countdown for ny runde etter forrige). 0 = umiddelbar start.
  min_tickets_to_start        INTEGER NOT NULL DEFAULT 20,
  -- Modus for premie-beregning. Whitelist håndheves i service-laget.
  prize_mode                  TEXT NOT NULL CHECK (prize_mode IN ('fixed', 'percentage')),
  -- Fixed-mode: faste kr-beløp i øre (cents). NULL = ikke konfigurert
  -- (service-laget kaster INVALID_CONFIG ved start hvis prize_mode='fixed'
  -- og noen av disse er NULL).
  prize_rad1_cents            INTEGER NULL CHECK (prize_rad1_cents IS NULL OR prize_rad1_cents >= 0),
  prize_rad2_cents            INTEGER NULL CHECK (prize_rad2_cents IS NULL OR prize_rad2_cents >= 0),
  prize_rad3_cents            INTEGER NULL CHECK (prize_rad3_cents IS NULL OR prize_rad3_cents >= 0),
  prize_rad4_cents            INTEGER NULL CHECK (prize_rad4_cents IS NULL OR prize_rad4_cents >= 0),
  prize_full_house_cents      INTEGER NULL CHECK (prize_full_house_cents IS NULL OR prize_full_house_cents >= 0),
  -- Percentage-mode: prosent av runde-omsetning (0-100). NULL = ikke
  -- konfigurert (service-laget kaster INVALID_CONFIG ved start hvis
  -- prize_mode='percentage' og noen av disse er NULL).
  prize_rad1_pct              NUMERIC(5,2) NULL CHECK (prize_rad1_pct IS NULL OR (prize_rad1_pct >= 0 AND prize_rad1_pct <= 100)),
  prize_rad2_pct              NUMERIC(5,2) NULL CHECK (prize_rad2_pct IS NULL OR (prize_rad2_pct >= 0 AND prize_rad2_pct <= 100)),
  prize_rad3_pct              NUMERIC(5,2) NULL CHECK (prize_rad3_pct IS NULL OR (prize_rad3_pct >= 0 AND prize_rad3_pct <= 100)),
  prize_rad4_pct              NUMERIC(5,2) NULL CHECK (prize_rad4_pct IS NULL OR (prize_rad4_pct >= 0 AND prize_rad4_pct <= 100)),
  prize_full_house_pct        NUMERIC(5,2) NULL CHECK (prize_full_house_pct IS NULL OR (prize_full_house_pct >= 0 AND prize_full_house_pct <= 100)),
  -- Bongpris i øre. Default 500 (5 kr) per Tobias-direktiv 2026-05-08.
  ticket_price_cents          INTEGER NOT NULL DEFAULT 500 CHECK (ticket_price_cents > 0),
  -- Pause mellom rad-faser i ms. Default 3000 (3 sek) per spec.
  pause_between_rows_ms       INTEGER NOT NULL DEFAULT 3000 CHECK (pause_between_rows_ms >= 0 AND pause_between_rows_ms <= 60000),
  -- Singleton-flagg. Service-laget håndhever at kun ÉN rad har active=TRUE.
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL
);

-- Singleton: kun én aktiv rad globalt. Partial unique index sikrer at vi
-- ikke kan ha to active=TRUE rader samtidig.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill3_config_singleton_active
  ON app_spill3_config((active))
  WHERE active = TRUE;

COMMENT ON TABLE app_spill3_config IS
  'Spill 3 (monsterbingo) global singleton-konfig per Tobias-direktiv 2026-05-08. ETT globalt rom alltid aktivt, auto-start på X solgte bonger, faste 3s-pauser mellom rad-faser. Kun ÉN rad active=TRUE per partial unique index.';

COMMENT ON COLUMN app_spill3_config.min_tickets_to_start IS
  'Antall bonger som må selges totalt i rommet før runden auto-starter. 0 = umiddelbar start. Endres av admin uten kode-deploy.';

COMMENT ON COLUMN app_spill3_config.prize_mode IS
  'Modus for premie-beregning. "fixed" = faste kr-beløp per fase (uavhengig av omsetning); "percentage" = prosent av total bong-omsetning for runden. Modus settes globalt for hele Spill 3.';

COMMENT ON COLUMN app_spill3_config.prize_rad1_cents IS
  'Fixed-mode: Rad 1-premie i øre (NULL hvis prize_mode=percentage). Service-laget validerer ved oppdatering.';

COMMENT ON COLUMN app_spill3_config.prize_rad1_pct IS
  'Percentage-mode: Rad 1-prosent av runde-omsetning (NULL hvis prize_mode=fixed). Service-laget validerer ved oppdatering.';

COMMENT ON COLUMN app_spill3_config.ticket_price_cents IS
  'Bongpris i øre. Per Tobias-direktiv 2026-05-08: 500 (5 kr) — KUN 1 type bong, online-only.';

COMMENT ON COLUMN app_spill3_config.pause_between_rows_ms IS
  'Auto-progresjon-pause mellom Rad 1 → 2 → 3 → 4 → Fullt Hus. Per spec: 3000 ms.';

-- Seed default config-rad. Idempotent — INSERT ON CONFLICT DO NOTHING for at
-- repeat-runs ikke overskriver evt. admin-justerte verdier på prod.
--
-- Default-verdier per Tobias-direktiv 2026-05-08:
--   min_tickets_to_start = 20  — sane default for sparse pilot-trafikk
--   prize_mode           = "percentage"  — anbefalt for pilot (skalerer med omsetning)
--   prize_rad1_pct       = 5.00  — Rad 1 = 5% av omsetning
--   prize_rad2_pct       = 8.00  — Rad 2 = 8% av omsetning
--   prize_rad3_pct       = 12.00 — Rad 3 = 12% av omsetning
--   prize_rad4_pct       = 15.00 — Rad 4 = 15% av omsetning
--   prize_full_house_pct = 30.00 — Fullt Hus = 30% av omsetning
--   ticket_price_cents   = 500   — 5 kr per bong
--   pause_between_rows_ms = 3000 — 3 sek pause mellom rad-faser
--
-- Sum: 5+8+12+15+30 = 70% av omsetning utbetales som premier.
-- Resten (30%) er huset/§11-distribusjon.
INSERT INTO app_spill3_config (
  id,
  min_tickets_to_start,
  prize_mode,
  prize_rad1_pct,
  prize_rad2_pct,
  prize_rad3_pct,
  prize_rad4_pct,
  prize_full_house_pct,
  ticket_price_cents,
  pause_between_rows_ms,
  active,
  created_at,
  updated_at
) VALUES (
  'spill3-default',
  20,
  'percentage',
  5.00,
  8.00,
  12.00,
  15.00,
  30.00,
  500,
  3000,
  TRUE,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;
