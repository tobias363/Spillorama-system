-- BIN-791: Public Status Page — admin-managed incidents.
--
-- Bakgrunn:
-- Tobias 2026-04-30 vil ha en offentlig status-side (`/status`) som
-- spillere og hall-operatører kan sjekke ved problemer. Ved siden av
-- automatiske komponent-helsesjekker (i `StatusService`) trenger admin å
-- kunne publisere "incidents" — den menneskeskrevne fortellingen rundt
-- hendelsen mens den pågår ("Spill 1 har redusert kapasitet — vi jobber
-- med saken").
--
-- Hver incident har:
--   - Title + description (tekst spillerne ser)
--   - Status (investigating → identified → monitoring → resolved)
--   - Impact (none/minor/major/critical → UI-fargekode)
--   - Affected components (JSONB-array av component-IDer)
--   - Created/updated by ADMIN-bruker
--   - Resolved-timestamp settes automatisk når status → resolved.
--
-- Dette er en velkjent Atlassian Statuspage-style state-machine. Hvis vi
-- senere vil bytte til statuspage.io, mapper vi feltene 1:1 og slipper
-- redesign på UI-siden.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up migration

CREATE TABLE IF NOT EXISTS app_status_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  impact TEXT NOT NULL CHECK (impact IN ('none', 'minor', 'major', 'critical')),
  affected_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id TEXT NULL,
  updated_by_user_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL
);

-- Hovedindex for offentlig status-side: hent alle aktive incidents
-- (status != 'resolved') sortert nyeste først. Partial-index over kun
-- aktive holder størrelsen lav.
CREATE INDEX IF NOT EXISTS idx_app_status_incidents_active
  ON app_status_incidents (created_at DESC)
  WHERE status != 'resolved';

-- Historikk-listing (siste N) trenger en full index.
CREATE INDEX IF NOT EXISTS idx_app_status_incidents_created_at
  ON app_status_incidents (created_at DESC);

COMMENT ON TABLE app_status_incidents IS
  'BIN-791: Admin-publiserte incidents for offentlig status-side (/status). Atlassian Statuspage-style state machine: investigating → identified → monitoring → resolved.';
COMMENT ON COLUMN app_status_incidents.status IS
  'Lifecycle: investigating (oppdaget), identified (rotårsak funnet), monitoring (fix deployet, observerer), resolved (ferdig).';
COMMENT ON COLUMN app_status_incidents.impact IS
  'UI-fargekode: none=grønn (info), minor=gul, major=oransje, critical=rød.';
COMMENT ON COLUMN app_status_incidents.affected_components IS
  'Array av component-IDer (samme som i StatusService.checks). Brukes til å markere riktige rader i status-tabellen på frontend.';
COMMENT ON COLUMN app_status_incidents.resolved_at IS
  'Settes automatisk når status går fra non-resolved til resolved. Cleared hvis status re-åpnes (uvanlig, men støttet for å rette feilklikk).';
