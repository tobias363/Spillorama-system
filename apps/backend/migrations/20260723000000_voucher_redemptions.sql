-- BIN-587 B4b follow-up: voucher redemption-historikk (player-side flow).
--
-- Admin-CRUD over app_vouchers kom i migrasjon 20260418240000. Denne
-- migrasjonen legger til app_voucher_redemptions som logger hver gang en
-- spiller faktisk INNLØSER en voucher-kode under spill (G2/G3 ad-hoc-rom,
-- og etterhvert G1 scheduled-games).
--
-- Design-prinsipper:
--   - (voucher_id, user_id) er UNIQUE: samme spiller kan ikke bruke samme
--     voucher to ganger. Legacy `ApplyVoucherCode`-socket i G2/G3 hadde
--     tilsvarende one-per-player-regel.
--   - game_slug + scheduled_game_id + room_code er diagnostikk/audit; ingen
--     foreign keys til G1/G2/G3-spesifikke tabeller fordi scope dekker
--     flere game-modeller (scheduled vs ad-hoc).
--   - discount_applied_cents er applied beløp (ikke voucher-value): for en
--     PERCENTAGE-voucher på 25% og et ticket-kjøp på 100 kr, logges 25*100
--     = 2500 cents. Gjør det enkelt å rapportere hvor mye "gave-penger"
--     vouchere har kostet huset.
--
-- Idempotens er kombinasjonen (voucher_id, user_id). Service-laget gjør
-- atomisk INSERT + UPDATE app_vouchers.uses_count i samme transaksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_voucher_redemptions (
  id                        TEXT PRIMARY KEY,
  voucher_id                TEXT NOT NULL
                              REFERENCES app_vouchers(id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL
                              REFERENCES app_users(id) ON DELETE CASCADE,
  wallet_id                 TEXT NOT NULL,
  game_slug                 TEXT NOT NULL,
  scheduled_game_id         TEXT NULL,
  room_code                 TEXT NULL,
  discount_applied_cents    BIGINT NOT NULL CHECK (discount_applied_cents >= 0),
  redeemed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- En spiller kan ikke innløse samme voucher to ganger
  UNIQUE (voucher_id, user_id)
);

-- Vanlig oppslag: "har denne spilleren brukt denne koden?"
CREATE INDEX IF NOT EXISTS idx_app_voucher_redemptions_user_voucher
  ON app_voucher_redemptions(user_id, voucher_id);

-- Rapporter: "alle innløsninger i tidsrom"
CREATE INDEX IF NOT EXISTS idx_app_voucher_redemptions_redeemed_at
  ON app_voucher_redemptions(redeemed_at);

COMMENT ON TABLE app_voucher_redemptions IS
  'BIN-587 B4b follow-up: spiller-side voucher-innløsning. En rad per (voucher, spiller) — unik-constraint håndhever en innløsning per spiller per kode.';
COMMENT ON COLUMN app_voucher_redemptions.discount_applied_cents IS
  'Faktisk rabattbeløp påført i cents (ikke voucher-value). For PERCENTAGE-vouchere = ticket-pris × value/100.';
COMMENT ON COLUMN app_voucher_redemptions.scheduled_game_id IS
  'Referanse til app_game1_scheduled_games hvis spillet tilhører scheduled-modell; NULL for ad-hoc G2/G3-rom.';
