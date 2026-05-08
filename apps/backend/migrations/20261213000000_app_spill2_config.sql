-- Spill 2 (rocket / Tallspill) global singleton-konfig 2026-05-08 — globalt
-- rom alltid aktivt (innenfor åpningstid), åpningstider, min-tickets-gate,
-- bongpris, jackpot-tabell (per-draw-mapping) og lucky-number-toggle.
--
-- Bakgrunn (Tobias 2026-05-08, parallel til Spill 3 — #1006):
-- Spill 2 redesignes til å speile Spill 3's globalt-singleton-mønster:
-- ETT globalt rom, alltid aktivt mellom `opening_time_start` og
-- `opening_time_end`. Endringer settes globalt for ALLE haller (ikke per
-- spilleplan-item som dagens GameManagement.config_json-flyt).
--
-- Modellen er en singleton (ÉN aktiv konfig globalt). Det finnes alltid
-- nøyaktig én aktiv rad — endringer overskriver eksisterende verdier; vi
-- beholder historikk via opprettelsestidsstempel og audit-log via
-- service-laget.
--
-- Spill 2-spesifikt:
--   - 21-ball, 3×3-grid, full plate i alle 9 ruter for å vinne
--   - Jackpot-mapping per draw-count (9..13 + 14-21-bucket): hvor mange
--     draws ved seier bestemmer premie-tier. Lagres som JSONB med 6 keys
--     ("9","10","11","12","13","1421") og {price, isCash}-objekter.
--   - Lucky number bonus: hvis `lastBall === luckyNumber` → ekstra
--     fastpremie (legacy game2.js:1628-1712 atferd).
--   - Pause mellom runder + ball-intervall settes også her (gjenbrukes som
--     legacy GameManagement.config.spill2 via roomState.extractPaceConfig).
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent
-- (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_spill2_config (
  id                          TEXT PRIMARY KEY,
  -- Åpningstider — HH:MM-format (24-timer). NULL = ingen begrensning
  -- (rommet er alltid aktivt). Service-laget validerer format og
  -- start <= end. Bruker TEXT i stedet for TIME for å unngå tz-fellen
  -- (bingolokalet kjører i Europe/Oslo, men vi vil ikke ha implisitte
  -- tz-konverteringer i DB).
  opening_time_start          TEXT NULL,
  opening_time_end            TEXT NULL,
  -- Antall bonger som må selges totalt før runden auto-starter. Speiler
  -- Spill 3's `min_tickets_to_start`. 0 = umiddelbar start.
  min_tickets_to_start        INTEGER NOT NULL DEFAULT 5 CHECK (min_tickets_to_start >= 0 AND min_tickets_to_start <= 1000),
  -- Bongpris i øre. Spill 2-default er 1000 (10 kr) per legacy-konvensjon.
  ticket_price_cents          INTEGER NOT NULL DEFAULT 1000 CHECK (ticket_price_cents > 0 AND ticket_price_cents <= 100000),
  -- Pause mellom runder i ms. Default 60_000 (60 sek pre-game vindu der
  -- spillere kan kjøpe bonger).
  round_pause_ms              INTEGER NOT NULL DEFAULT 60000 CHECK (round_pause_ms >= 1000 AND round_pause_ms <= 300000),
  -- Pause mellom hver ball-trekning i ms. Default 4000 (4 sek).
  ball_interval_ms            INTEGER NOT NULL DEFAULT 4000 CHECK (ball_interval_ms >= 1000 AND ball_interval_ms <= 10000),
  -- Jackpot-tabell: 6-key map over draw-count → {price, isCash}-payouts.
  -- Format speiler legacy `gamehelper/game2.js`-jackpot:
  --   "9","10","11","12","13" → exact draw-count match
  --   "1421" → draw-count i [14..21]-intervall
  --   value = {price: number, isCash: boolean}
  -- isCash=true → flat kr-beløp; false → prosent av (ticketCount × ticketPrice).
  -- Service-laget validerer shape (alle 6 keys + valid value-shape).
  jackpot_number_table_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Lucky number bonus: når `lastBall === luckyNumber` ved seier får vinneren
  -- en ekstra fastpremie. NULL = deaktivert.
  lucky_number_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  lucky_number_prize_cents    INTEGER NULL CHECK (lucky_number_prize_cents IS NULL OR lucky_number_prize_cents >= 0),
  -- Singleton-flagg. Service-laget håndhever at kun ÉN rad har active=TRUE.
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL
);

-- Singleton: kun én aktiv rad globalt. Partial unique index sikrer at vi
-- ikke kan ha to active=TRUE rader samtidig.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_spill2_config_singleton_active
  ON app_spill2_config((active))
  WHERE active = TRUE;

COMMENT ON TABLE app_spill2_config IS
  'Spill 2 (rocket) global singleton-konfig per Tobias-direktiv 2026-05-08. ETT globalt rom alltid aktivt innenfor åpningstid, auto-start på X solgte bonger, jackpot-mapping per draw-count, lucky-number-bonus. Kun ÉN rad active=TRUE per partial unique index. Parallel til app_spill3_config.';

COMMENT ON COLUMN app_spill2_config.opening_time_start IS
  'Åpningstid start i HH:MM-format (24h, Europe/Oslo). NULL = ingen begrensning. Engine bruker dette til å avgjøre om global runde skal spawnes.';

COMMENT ON COLUMN app_spill2_config.opening_time_end IS
  'Åpningstid slutt i HH:MM-format (24h). NULL = ingen begrensning. Service validerer at start <= end.';

COMMENT ON COLUMN app_spill2_config.min_tickets_to_start IS
  'Antall bonger som må selges totalt i rommet før runden auto-starter. 0 = umiddelbar start. Endres av admin uten kode-deploy.';

COMMENT ON COLUMN app_spill2_config.ticket_price_cents IS
  'Bongpris i øre. Default 1000 (10 kr) per legacy Spill 2-konvensjon.';

COMMENT ON COLUMN app_spill2_config.jackpot_number_table_json IS
  'Jackpot-mapping per draw-count: {"9":{"price":5000,"isCash":true},"10":{...},...,"1421":{...}}. Service-laget validerer shape ved oppdatering. Speiler legacy game2.js-format.';

COMMENT ON COLUMN app_spill2_config.lucky_number_enabled IS
  'Hvis TRUE: ved seier der lastBall === luckyNumber utbetales lucky_number_prize_cents som tilleggspremie.';

-- Seed default config-rad. Idempotent — INSERT ON CONFLICT DO NOTHING for at
-- repeat-runs ikke overskriver evt. admin-justerte verdier på prod.
--
-- Default-verdier per Tobias-direktiv 2026-05-08 (basert på DEFAULT_GAME2_CONFIG
-- i variantConfig.ts):
--   opening_time_start = NULL  — ingen begrensning til å starte (pilot)
--   opening_time_end = NULL    — admin må sette dette eksplisitt før produksjon
--   min_tickets_to_start = 5   — sane default for sparse pilot-trafikk
--   ticket_price_cents = 1000  — 10 kr per bong (legacy default)
--   round_pause_ms = 60000     — 60 sek pre-game-vindu
--   ball_interval_ms = 4000    — 4 sek per ball
--   jackpot_number_table_json = (legacy-default fra DEFAULT_GAME2_CONFIG):
--     "9"  → 5000 kr fast
--     "10" → 2500 kr fast
--     "11" → 1000 kr fast
--     "12" → 100% av omsetning
--     "13" → 75 % av omsetning
--     "1421" → 50 % av omsetning
--   lucky_number_enabled = FALSE  — admin må aktivere eksplisitt
--   lucky_number_prize_cents = NULL
INSERT INTO app_spill2_config (
  id,
  opening_time_start,
  opening_time_end,
  min_tickets_to_start,
  ticket_price_cents,
  round_pause_ms,
  ball_interval_ms,
  jackpot_number_table_json,
  lucky_number_enabled,
  lucky_number_prize_cents,
  active,
  created_at,
  updated_at
) VALUES (
  'spill2-default',
  NULL,
  NULL,
  5,
  1000,
  60000,
  4000,
  '{
    "9":    {"price": 5000, "isCash": true},
    "10":   {"price": 2500, "isCash": true},
    "11":   {"price": 1000, "isCash": true},
    "12":   {"price": 100,  "isCash": false},
    "13":   {"price": 75,   "isCash": false},
    "1421": {"price": 50,   "isCash": false}
  }'::jsonb,
  FALSE,
  NULL,
  TRUE,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;
