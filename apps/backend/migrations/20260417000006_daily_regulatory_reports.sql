-- Blokk 1.13 — Daglig regulatorisk rapport (§ 71).
--
-- Aggregert visning per (rapport_dato, hall, kanal) fra app_regulatory_ledger.
-- Genereres av DailyReportService (cron 06:00 + manuelt via admin-endepunkt).
-- En gang skrevet, aldri endret — UNIQUE(report_date, hall_id, channel) og
-- UPDATE/DELETE-trigger forhindrer overwrite, i tråd med regnskapskravet.
--
-- `signed_hash` dekker innholdet + forrige dags hash = dag-til-dag-kjede. Det
-- gir Lotteritilsynet én kjede å verifisere over hele historikken.
--
-- Konvensjoner: TEXT PK, `app_` prefiks, CHECK for enums, speiler
-- kanal-semantikk fra app_regulatory_ledger (HALL/INTERNET).

-- Up Migration

CREATE TABLE IF NOT EXISTS app_daily_regulatory_reports (
  id                     TEXT PRIMARY KEY,
  sequence               BIGSERIAL UNIQUE NOT NULL,
  report_date            DATE NOT NULL,
  hall_id                TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  channel                TEXT NOT NULL
                           CHECK (channel IN ('HALL', 'INTERNET')),
  ticket_turnover_nok    NUMERIC(14, 2) NOT NULL,
  prizes_paid_nok        NUMERIC(14, 2) NOT NULL,
  tickets_sold_count     INTEGER NOT NULL CHECK (tickets_sold_count >= 0),
  unique_players         INTEGER NOT NULL CHECK (unique_players >= 0),
  ledger_first_sequence  BIGINT NOT NULL,
  ledger_last_sequence   BIGINT NOT NULL,
  prev_hash              TEXT NULL,
  signed_hash            TEXT NOT NULL,
  generated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by           TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (report_date, hall_id, channel)
);

COMMENT ON TABLE  app_daily_regulatory_reports                   IS 'Daglig aggregert rapport per (hall, kanal) — oppfyller § 71 kravet om daglig rapport over omsetning og premier. Unik per (dato, hall, kanal) — kan ikke genereres på nytt.';
COMMENT ON COLUMN app_daily_regulatory_reports.sequence              IS 'Monotont økende insert-rekkefølge. Brukes for deterministisk hash-kjede-ordering — generated_at kan kollidere når flere rader skrives i samme transaksjon, sequence kan ikke.';
COMMENT ON COLUMN app_daily_regulatory_reports.ledger_first_sequence IS 'Første ledger-sekvensnummer som inngår i rapporten. Brukes ved revisjons-reproduksjon.';
COMMENT ON COLUMN app_daily_regulatory_reports.ledger_last_sequence  IS 'Siste ledger-sekvensnummer som inngår i rapporten. Sammen med first gir det deterministisk kilde-spor.';
COMMENT ON COLUMN app_daily_regulatory_reports.prev_hash             IS 'Signert hash fra forrige dags rapport (global kjede). NULL for første rapport noensinne.';
COMMENT ON COLUMN app_daily_regulatory_reports.signed_hash           IS 'sha256(report_date||hall_id||channel||ticket_turnover||prizes_paid||tickets_sold||unique_players||first_seq||last_seq||prev_hash). Tuklesikring.';
COMMENT ON COLUMN app_daily_regulatory_reports.generated_by          IS 'Admin-brukeren som trigget generering (NULL når kjørt av scheduler).';

-- Listevisning admin: fra/til + hall-filter.
CREATE INDEX IF NOT EXISTS idx_app_daily_regulatory_reports_date_hall
  ON app_daily_regulatory_reports (report_date DESC, hall_id);

-- Hash-kjede-verifisering (global) — sequence gir deterministisk ordering.
CREATE INDEX IF NOT EXISTS idx_app_daily_regulatory_reports_sequence
  ON app_daily_regulatory_reports (sequence);

-- ── Immutability-trigger ───────────────────────────────────────────────────
-- Gjenbruker samme mønster som app_regulatory_ledger — én gang skrevet,
-- aldri endret. Kompenserende rad via ADJUSTMENT i ledger hvis nødvendig.

DROP TRIGGER IF EXISTS trg_app_daily_regulatory_reports_no_update ON app_daily_regulatory_reports;
CREATE TRIGGER trg_app_daily_regulatory_reports_no_update
  BEFORE UPDATE ON app_daily_regulatory_reports
  FOR EACH ROW EXECUTE FUNCTION app_regulatory_ledger_block_mutation();

DROP TRIGGER IF EXISTS trg_app_daily_regulatory_reports_no_delete ON app_daily_regulatory_reports;
CREATE TRIGGER trg_app_daily_regulatory_reports_no_delete
  BEFORE DELETE ON app_daily_regulatory_reports
  FOR EACH ROW EXECUTE FUNCTION app_regulatory_ledger_block_mutation();

DROP TRIGGER IF EXISTS trg_app_daily_regulatory_reports_no_truncate ON app_daily_regulatory_reports;
CREATE TRIGGER trg_app_daily_regulatory_reports_no_truncate
  BEFORE TRUNCATE ON app_daily_regulatory_reports
  FOR EACH STATEMENT EXECUTE FUNCTION app_regulatory_ledger_block_mutation();

-- Down Migration

DROP TRIGGER IF EXISTS trg_app_daily_regulatory_reports_no_truncate ON app_daily_regulatory_reports;
DROP TRIGGER IF EXISTS trg_app_daily_regulatory_reports_no_delete ON app_daily_regulatory_reports;
DROP TRIGGER IF EXISTS trg_app_daily_regulatory_reports_no_update ON app_daily_regulatory_reports;
DROP INDEX IF EXISTS idx_app_daily_regulatory_reports_sequence;
DROP INDEX IF EXISTS idx_app_daily_regulatory_reports_date_hall;
DROP TABLE IF EXISTS app_daily_regulatory_reports;
