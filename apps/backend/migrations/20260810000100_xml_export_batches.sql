-- Withdraw in Bank XML-export: batch-tabell.
--
-- Én rad per XML-fil generert av daglig cron (eller manuell trigger).
-- PM-beslutning 2026-04-24: ÉN SAMLET XML per agent per dag, alle haller
-- kombinert. `agent_user_id` peker til agent-brukeren som eier uttakene
-- (via hall-tilknytning). NULL hvis manuell batch uten agent-kontekst.
--
-- Kolonner:
--   id                        UUID/TEXT PK (genereres av service via randomUUID)
--   agent_user_id             TEXT NULL — agent som eier batchen (hall-eier).
--                             NULL for manuelle admin-batcher.
--   generated_at              når XML-en ble bygd (ISO timestamptz)
--   xml_file_path             relativ sti til lagret fil (f.eks.
--                             /var/spill-xml-exports/2026-08-10/agent-xyz.xml)
--   email_sent_at             når e-posten med vedlegg ble sendt. NULL
--                             hvis sendingen feilet / SMTP disabled.
--   recipient_emails          TEXT[] av mottakere fra
--                             app_withdraw_email_allowlist på sendtidspunkt
--                             (snapshot — senere endringer påvirker ikke historikk).
--   withdraw_request_count    INT — antall rader i batchen (for rapport).
--   created_at / updated_at   vanlig audit-timestamps
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_xml_export_batches (
  id TEXT PRIMARY KEY,
  agent_user_id TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  xml_file_path TEXT NOT NULL,
  email_sent_at TIMESTAMPTZ NULL,
  recipient_emails TEXT[] NOT NULL DEFAULT '{}',
  withdraw_request_count INT NOT NULL DEFAULT 0 CHECK (withdraw_request_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_xml_export_batches_agent_generated
  ON app_xml_export_batches (agent_user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_xml_export_batches_generated_at
  ON app_xml_export_batches (generated_at DESC);

COMMENT ON TABLE app_xml_export_batches IS
  'Withdraw XML-eksport: én rad per generert XML-fil. PM-format 2026-04-24: én samlet XML per agent per dag.';
COMMENT ON COLUMN app_xml_export_batches.recipient_emails IS
  'Snapshot av app_withdraw_email_allowlist på sendtidspunkt. Senere endringer påvirker ikke historikk.';
COMMENT ON COLUMN app_xml_export_batches.xml_file_path IS
  'Absolutt sti til XML-filen på disk. WITHDRAW_XML_EXPORT_DIR kan konfigurere root-mappen.';
