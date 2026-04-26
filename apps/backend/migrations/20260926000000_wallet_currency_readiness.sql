-- BIN-766 wallet casino-grade review: Multi-currency readiness
--
-- Spillorama er NOK-only i dag, men separate `currency`-kolonne på
-- wallet_accounts, wallet_transactions og wallet_entries gjør fremtidig
-- EUR/SEK-utvidelse triviell. Float-feil ved cross-currency er den
-- nest-vanligste produksjonsbugen i casino-walleter — derfor:
--
--   * Vi legger inn `currency` NÅ med CHECK = 'NOK' så ingen kan ved uhell
--     skrive en transaksjon i feil valuta før vi har implementert reell
--     multi-currency-logikk (FX-rates, per-currency saldo, settlement).
--   * Når vi senere åpner for EUR/SEK fjernes/lempes CHECK-en, og adapter
--     må valideres kontoer mot tx.currency.
--
-- Schema-strategi:
--   * `currency TEXT NOT NULL DEFAULT 'NOK'` på alle tre tabeller.
--   * CHECK-constraint `currency = 'NOK'` på alle tre — tvinger no-cross-
--     currency-mismatch nå. Lett å lempe senere ved å skrive ny migration
--     som DROP CONSTRAINT og ADD CONSTRAINT `currency IN ('NOK','EUR','SEK',...)`.
--   * Backfill: alle eksisterende rader får `currency = 'NOK'` via DEFAULT
--     (NOT NULL DEFAULT håndterer bestående rader automatisk).
--
-- Backwards-compat:
--   * WalletAdapter-API uendret. Returverdier kan utvides additivt med
--     `currency`-felt i typer, eksisterende code paths leser ikke feltet.
--   * Eksisterende SELECT/INSERT-queries fungerer uendret — DEFAULT-en
--     og NOT NULL-constraint betyr at INSERTs uten currency-kolonne
--     fortsatt får `'NOK'` automatisk.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

-- Steg 1: Legg til `currency` på wallet_accounts.
ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NOK';

-- Steg 2: Legg til `currency` på wallet_transactions.
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NOK';

-- Steg 3: Legg til `currency` på wallet_entries.
ALTER TABLE wallet_entries
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NOK';

-- Steg 4: Eksplisitt backfill — alle eksisterende rader settes til 'NOK'.
-- DEFAULT NOT NULL gjør dette automatisk for nye rader, men dette UPDATE
-- er forsvar i dybden mot rare race-conditions hvor en migration kjører
-- mens sessions skriver. Idempotent (WHERE currency != 'NOK' eller IS NULL).
UPDATE wallet_accounts SET currency = 'NOK' WHERE currency IS NULL OR currency != 'NOK';
UPDATE wallet_transactions SET currency = 'NOK' WHERE currency IS NULL OR currency != 'NOK';
UPDATE wallet_entries SET currency = 'NOK' WHERE currency IS NULL OR currency != 'NOK';

-- Steg 5: CHECK-constraints — tvinger NOK-only nå.
-- Når vi senere åpner for multi-currency: skriv ny migration som dropper
-- disse og legger til `currency IN ('NOK','EUR','SEK',...)`.
ALTER TABLE wallet_accounts
  ADD CONSTRAINT wallet_accounts_currency_nok_only
  CHECK (currency = 'NOK');

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_currency_nok_only
  CHECK (currency = 'NOK');

ALTER TABLE wallet_entries
  ADD CONSTRAINT wallet_entries_currency_nok_only
  CHECK (currency = 'NOK');

-- Steg 6: Kommentarer for hvem-som-leser-schemaet.
COMMENT ON COLUMN wallet_accounts.currency IS
  'BIN-766: ISO 4217-valuta for kontoen. NOK-only nå (CHECK-constraint). Fjernes når reell multi-currency aktiveres.';
COMMENT ON COLUMN wallet_transactions.currency IS
  'BIN-766: ISO 4217-valuta for transaksjonen. Må matche account.currency. NOK-only nå (CHECK-constraint).';
COMMENT ON COLUMN wallet_entries.currency IS
  'BIN-766: ISO 4217-valuta for ledger-entry. Må matche account.currency. NOK-only nå (CHECK-constraint).';
