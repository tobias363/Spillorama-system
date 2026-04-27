-- Scenario A — utvid swedbank_payment_intents til å støtte flere
-- betalingsmetoder (Vipps via Swedbank Pay, Visa/MC DEBIT-only, Apple Pay,
-- Google Pay) og dokumentere debit-only-håndhevelse for norske
-- pengespill-regulering.
--
-- Bakgrunn:
--   Pengespillforskriften forbyr kredittkort som betalingsmiddel for
--   pengespill. Vi MÅ derfor:
--     1) be Swedbank kun tilby DEBIT-varianter (Visa Debit + Mastercard
--        Debit) i checkout-widget,
--     2) verifisere at autorisert kort er debit (cardFundingType === "DEBIT")
--        i callback / reconcile,
--     3) automatisk refundere + reject hvis kunden lurte seg gjennom med
--        et kredittkort.
--
--   Vi utvider derfor swedbank_payment_intents med:
--     * payment_method   — "VIPPS" / "VISA_DEBIT" / "MASTERCARD_DEBIT" /
--                          "APPLE_PAY" / "GOOGLE_PAY". NULL for
--                          eksisterende rader (legacy "card uten metode-
--                          spec"). Default 'UNKNOWN' for nye rader hvis
--                          klienten ikke har sendt metode (skal ikke skje).
--     * card_funding_type — "DEBIT" / "CREDIT" / "PREPAID" / "DEFERRED_DEBIT"
--                           — populeres fra Swedbanks paid-resource ved
--                           reconcile. NULL inntil betaling autorisert.
--     * card_brand        — "VISA" / "MASTERCARD" / "VIPPS" / "APPLE_PAY"
--                           / "GOOGLE_PAY" — populeres fra Swedbanks
--                           paid-resource. NULL inntil autorisert.
--     * rejected_at       — TIMESTAMPTZ NULL — settes hvis vi avslår en
--                           betaling i etterkant (eks. credit-card-attempt).
--     * rejection_reason  — TEXT NULL — kort begrunnelse (eks. "CREDIT_CARD_FORBIDDEN").
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up migration

ALTER TABLE swedbank_payment_intents
  ADD COLUMN IF NOT EXISTS payment_method     TEXT NULL,
  ADD COLUMN IF NOT EXISTS card_funding_type  TEXT NULL,
  ADD COLUMN IF NOT EXISTS card_brand         TEXT NULL,
  ADD COLUMN IF NOT EXISTS rejected_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason   TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_swedbank_payment_intents_payment_method
  ON swedbank_payment_intents (payment_method)
  WHERE payment_method IS NOT NULL;

COMMENT ON COLUMN swedbank_payment_intents.payment_method IS
  'Klient-spesifisert betalingsmetode (VIPPS / VISA_DEBIT / MASTERCARD_DEBIT / APPLE_PAY / GOOGLE_PAY). NULL for legacy.';
COMMENT ON COLUMN swedbank_payment_intents.card_funding_type IS
  'Funding-type returnert fra Swedbank ved autorisering (DEBIT / CREDIT / PREPAID / DEFERRED_DEBIT). REGULATORISK: må være DEBIT for kort.';
COMMENT ON COLUMN swedbank_payment_intents.card_brand IS
  'Kort-brand returnert fra Swedbank (VISA / MASTERCARD / VIPPS / APPLE_PAY / GOOGLE_PAY). For audit.';
COMMENT ON COLUMN swedbank_payment_intents.rejected_at IS
  'Settes hvis vi avviser betalingen post-autorisering (eks. credit-card-attempt). NULL ellers.';
COMMENT ON COLUMN swedbank_payment_intents.rejection_reason IS
  'Kort begrunnelse for avvisning (CREDIT_CARD_FORBIDDEN, AMOUNT_MISMATCH, CURRENCY_MISMATCH).';
