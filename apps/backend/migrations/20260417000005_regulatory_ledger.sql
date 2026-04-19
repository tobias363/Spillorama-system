-- Blokk 1.12 — Regulatorisk hovedbok (§ 71-compliance).
--
-- Pengespillforskriften § 71 krever daglig rapport over omsetning av bonger og
-- utdeling av premier, separat per lokale. Vår implementasjon: én append-only
-- tabell som kjede-signeres med sha256 (prev_hash → event_hash), med trigger
-- som blokkerer UPDATE/DELETE. Daglig rapport (Blokk 1.13) aggregerer fra
-- denne.
--
-- Kanal-semantikk (gjenbruker eksisterende `LedgerChannel` fra ComplianceLedger):
--   HALL     = papir-bong solgt fysisk i lokalet (via agent)
--   INTERNET = digital bong solgt via web/app
--
-- hall_id er ALLTID påkrevd (spiller er låst til hall per runde — Blokk 1.8).
-- draw_session_id og user_id er optional: noen hendelser (justering, refund)
-- er ikke knyttet til en spesifikk runde/spiller.
--
-- Hash-kjede: event_hash = sha256(id || event_date || channel || hall_id ||
-- transaction_type || amount_nok || ticket_ref || created_at || prev_hash).
-- Kjeden er per-tabell (ikke per-hall) — én kjede å verifisere, enklere
-- tamper-deteksjon.
--
-- Konvensjoner: TEXT PK, `app_` prefiks, CREATE TABLE IF NOT EXISTS,
-- TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK for enums.

-- Up Migration

-- ── Regulatorisk hovedbok ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_regulatory_ledger (
  id                TEXT PRIMARY KEY,
  sequence          BIGSERIAL NOT NULL UNIQUE,
  event_date        DATE NOT NULL,
  channel           TEXT NOT NULL
                      CHECK (channel IN ('HALL', 'INTERNET')),
  hall_id           TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  draw_session_id   TEXT NULL REFERENCES app_draw_sessions(id) ON DELETE RESTRICT,
  user_id           TEXT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  transaction_type  TEXT NOT NULL
                      CHECK (transaction_type IN (
                        'TICKET_SALE',
                        'PRIZE_PAYOUT',
                        'REFUND',
                        'ADJUSTMENT'
                      )),
  amount_nok        NUMERIC(12, 2) NOT NULL,
  ticket_ref        TEXT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash         TEXT NULL,
  event_hash        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_regulatory_ledger                   IS 'Append-only hovedbok for § 71-compliance. Alle pengeflyter (TICKET_SALE/PRIZE_PAYOUT/REFUND/ADJUSTMENT) skrives hit i samme transaksjon som wallet-endringen.';
COMMENT ON COLUMN app_regulatory_ledger.sequence          IS 'BIGSERIAL — monoton rekkefølge. Brukes til å rekonstruere kjede-rekkefølgen deterministisk ved verifisering (created_at kan kollidere på samme mikrosekund).';
COMMENT ON COLUMN app_regulatory_ledger.event_date        IS 'Dato for hendelsen (ikke created_at) — brukes til daglig partisjonering og rapport-aggregat (Blokk 1.13).';
COMMENT ON COLUMN app_regulatory_ledger.channel           IS 'HALL = papir-bong solgt i lokalet. INTERNET = digital bong solgt via web/app. Premie-utbetaling får samme kanal som kjøpet.';
COMMENT ON COLUMN app_regulatory_ledger.hall_id           IS 'Alltid påkrevd — regnskap er per-lokale per forskriften.';
COMMENT ON COLUMN app_regulatory_ledger.draw_session_id   IS 'Kobling til draw-session. NULL for justeringer / refusjoner som ikke er rundespesifikke.';
COMMENT ON COLUMN app_regulatory_ledger.user_id           IS 'Spiller ved digital bong, agent ved papir-salg. NULL for systemjusteringer.';
COMMENT ON COLUMN app_regulatory_ledger.amount_nok        IS 'Positivt for omsetning (TICKET_SALE), negativt for utbetaling (PRIZE_PAYOUT). Alltid NOK — ingen valuta-konvertering på dette nivået.';
COMMENT ON COLUMN app_regulatory_ledger.ticket_ref        IS 'Referanse til bong: serial for papir (kan være komma-separert liste ved batch-salg), ticket_id for digital.';
COMMENT ON COLUMN app_regulatory_ledger.metadata          IS 'Fri-form JSONB for kontekst (f.eks. agent_id, countSold, claim_id). Ikke del av hash-kjeden — endringer her truer ikke integriteten av selve pengetallet.';
COMMENT ON COLUMN app_regulatory_ledger.prev_hash         IS 'sha256 av forrige rad i kjeden. NULL bare for første rad noensinne.';
COMMENT ON COLUMN app_regulatory_ledger.event_hash        IS 'sha256(id || event_date || channel || hall_id || transaction_type || amount_nok || ticket_ref || created_at || prev_hash). Bruddd i kjeden = tukling.';

-- Daglig rapport-aggregat (Blokk 1.13).
CREATE INDEX IF NOT EXISTS idx_app_regulatory_ledger_daily
  ON app_regulatory_ledger (event_date, hall_id, channel);

-- Spiller-historikk (Blokk 1.14).
CREATE INDEX IF NOT EXISTS idx_app_regulatory_ledger_user
  ON app_regulatory_ledger (user_id, event_date DESC)
  WHERE user_id IS NOT NULL;

-- Per-session etterforskning (claims, revisjon).
CREATE INDEX IF NOT EXISTS idx_app_regulatory_ledger_session
  ON app_regulatory_ledger (draw_session_id)
  WHERE draw_session_id IS NOT NULL;

-- Kjede-verifisering: rekonstruer i sekvens-rekkefølge.
CREATE INDEX IF NOT EXISTS idx_app_regulatory_ledger_sequence
  ON app_regulatory_ledger (sequence);

-- ── Immutability-trigger ───────────────────────────────────────────────────
-- Blokkerer UPDATE/DELETE på regnskap. Eneste måten å "rette" en feilført rad
-- er å skrive en kompenserende ADJUSTMENT-rad — historikken bevares.

CREATE OR REPLACE FUNCTION app_regulatory_ledger_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'app_regulatory_ledger er append-only — % er blokkert. Skriv en kompenserende ADJUSTMENT-rad isteden.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_regulatory_ledger_no_update ON app_regulatory_ledger;
CREATE TRIGGER trg_app_regulatory_ledger_no_update
  BEFORE UPDATE ON app_regulatory_ledger
  FOR EACH ROW EXECUTE FUNCTION app_regulatory_ledger_block_mutation();

DROP TRIGGER IF EXISTS trg_app_regulatory_ledger_no_delete ON app_regulatory_ledger;
CREATE TRIGGER trg_app_regulatory_ledger_no_delete
  BEFORE DELETE ON app_regulatory_ledger
  FOR EACH ROW EXECUTE FUNCTION app_regulatory_ledger_block_mutation();

-- TRUNCATE har egen trigger — må blokkeres separat.
DROP TRIGGER IF EXISTS trg_app_regulatory_ledger_no_truncate ON app_regulatory_ledger;
CREATE TRIGGER trg_app_regulatory_ledger_no_truncate
  BEFORE TRUNCATE ON app_regulatory_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION app_regulatory_ledger_block_mutation();

-- Down Migration

DROP TRIGGER IF EXISTS trg_app_regulatory_ledger_no_truncate ON app_regulatory_ledger;
DROP TRIGGER IF EXISTS trg_app_regulatory_ledger_no_delete ON app_regulatory_ledger;
DROP TRIGGER IF EXISTS trg_app_regulatory_ledger_no_update ON app_regulatory_ledger;
DROP FUNCTION IF EXISTS app_regulatory_ledger_block_mutation();
DROP INDEX IF EXISTS idx_app_regulatory_ledger_sequence;
DROP INDEX IF EXISTS idx_app_regulatory_ledger_session;
DROP INDEX IF EXISTS idx_app_regulatory_ledger_user;
DROP INDEX IF EXISTS idx_app_regulatory_ledger_daily;
DROP TABLE IF EXISTS app_regulatory_ledger;
