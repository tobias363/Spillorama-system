-- REQ-137 — Pending-deposit reminder.
--
-- Bakgrunn:
--   Spillere som starter en Swedbank Pay top-up (Vipps/kort) men ikke
--   fullfører i Swedbank-checkout etterlater seg en PENDING-rad i
--   swedbank_payment_intents. Når de kommer tilbake til lobbyen ønsker
--   vi å vise en periodisk popup-reminder: "Du har et åpent innskudd
--   på X kr — vil du fullføre?".
--
-- Design:
--   * `last_reminded_at` (TIMESTAMPTZ NULL) — settes når klienten har
--     sett reminderen, slik at vi kan fall back til klient-side dedupe
--     dersom flere faner er åpne. I første versjon brukes feltet kun
--     som en read-only-markør; klienten styrer 5-min-intervallet.
--   * Felt nullable; eksisterende rader trenger ingen backfill.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up migration

ALTER TABLE swedbank_payment_intents
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ NULL;

-- Hjelpe-indeks for "list pending for user, nyeste først".
-- created_at DESC indeks finnes allerede; vi legger til status-filtreren
-- i samme indeks for å holde lookup rask når PENDING-rader vokser.
CREATE INDEX IF NOT EXISTS idx_swedbank_payment_intents_user_pending
  ON swedbank_payment_intents (user_id, created_at DESC)
  WHERE status NOT IN ('PAID', 'CREDITED', 'FAILED', 'EXPIRED', 'CANCELLED');
