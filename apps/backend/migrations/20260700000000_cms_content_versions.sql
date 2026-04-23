-- BIN-680 Lag 1: regulatorisk versjonering for CMS-tekst-sider.
--
-- Pengespillforskriften §11 + intern compliance-policy krever at regulatorisk
-- tekst (Spillvett/responsible-gaming) har:
--   1. Immutable versjoner (ingen in-place redigering — hver endring er ny rad).
--   2. 4-øyne-godkjenning (approver må være en annen admin enn createdBy).
--   3. Full audit-trail (alle state-transitions loggførst via AuditLogService).
--   4. Retention — versjoner beholdes uendret (pengespillforskriften §11).
--
-- Design-valg:
--   * `app_cms_content_versions` er append-only. DB-mønsteret følger
--     `app_regulatory_ledger`/`app_audit_log` — rader oppdateres kun i status-
--     kolonne + approvedBy/publishedBy/retired metadata. Aldri DELETE.
--   * Versjons-tallet er per slug (UNIQUE(slug, version_number)). Service-
--     laget tildeler neste version_number i samme transaksjon som INSERT.
--   * State-machine: draft → review → approved → live → retired. DB-CHECK
--     begrenser status; service-laget håndhever overganger.
--   * 4-øyne håndheves DOBBELT: DB CHECK (approved_by ≠ created_by) +
--     service-validator (kastes DomainError('FOUR_EYES_VIOLATION')). DB er
--     siste forsvarslinje hvis service-laget har bug.
--   * `app_cms_content.live_version_id` er denormalisert FK til gjeldende
--     live-versjon. Optimizer-hint for player-facing read (Lag 2). Oppdateres
--     i samme transaksjon som publish (retire gammel live → promote approved).
--
-- ID-type: TEXT (ikke UUID) fordi app_users.id og resten av Spillorama-
-- skjemaet bruker TEXT-primær-nøkler. UUID genereres i service-laget via
-- randomUUID() fra Node — samme mønster som alle andre tabeller i prosjektet.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_cms_content_versions (
  id                     TEXT PRIMARY KEY,
  -- Slug refererer app_cms_content.slug (stabil whitelist i service-laget).
  -- Ikke FK-referert her fordi app_cms_content.slug ikke har UNIQUE (den er
  -- PRIMARY KEY, som teknisk er unique); vi vil ha fleksibiliteten til å
  -- opprette versjoner før content-raden eksisterer (backfill-scenario).
  slug                   TEXT NOT NULL,
  -- Monotont økende pr slug. Tildelt av service-laget som (max+1) under
  -- transaksjon. UNIQUE-constraint sikrer integritet ved race.
  version_number         INTEGER NOT NULL,
  content                TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'live', 'retired')),
  created_by_user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by_user_id    TEXT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  approved_at            TIMESTAMPTZ NULL,
  published_by_user_id   TEXT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  published_at           TIMESTAMPTZ NULL,
  retired_at             TIMESTAMPTZ NULL,
  UNIQUE (slug, version_number),
  -- 4-øyne: DB-siste forsvarslinje. Service-laget validerer allerede, men
  -- en direkte DB-write (f.eks. manual fix i prod) vil fortsatt feile.
  CONSTRAINT cms_content_versions_four_eyes_chk
    CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> created_by_user_id)
);

COMMENT ON TABLE app_cms_content_versions IS
  'BIN-680 Lag 1: versjonert historikk for regulatorisk CMS-tekst. Append-only; kun status + approvedBy/publishedBy/retired-metadata oppdateres.';
COMMENT ON COLUMN app_cms_content_versions.status IS
  'BIN-680 state-machine: draft → review → approved → live → retired. Håndheves av service-laget.';
COMMENT ON COLUMN app_cms_content_versions.version_number IS
  'BIN-680: monotont per slug. Tildelt av service-laget (max+1) i samme transaksjon som INSERT.';

-- Partial index: de-facto unik live-versjon per slug. Gir O(1) lookup til
-- "current live" uten å scanne hele historikken. Delvis unique-constraint
-- håndheves ikke på DB (fordi to haller kunne i teorien kjøre race), men
-- service-laget holder live → retired i én transaksjon.
CREATE INDEX IF NOT EXISTS idx_cms_content_versions_slug_live
  ON app_cms_content_versions(slug) WHERE status = 'live';

CREATE INDEX IF NOT EXISTS idx_cms_content_versions_slug_history
  ON app_cms_content_versions(slug, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_cms_content_versions_status
  ON app_cms_content_versions(status) WHERE status IN ('draft', 'review', 'approved');

-- ── Forward-compat on app_cms_content ─────────────────────────────────────
--
-- `app_cms_content` beholdes uendret for backwards-compat med BIN-676-kode
-- som enda ikke er portet til versjons-APIet (f.eks. andre slugs som ikke
-- krever versjonering). To nye kolonner gir optimalisert FK til live-versjon
-- slik at player-facing reads (Lag 2) kan slå opp uten dobbel-query.

ALTER TABLE app_cms_content
  ADD COLUMN IF NOT EXISTS live_version_id     TEXT NULL REFERENCES app_cms_content_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS live_version_number INTEGER NULL;

COMMENT ON COLUMN app_cms_content.live_version_id IS
  'BIN-680 Lag 1: FK til gjeldende live-versjon i app_cms_content_versions. NULL for slugs som ikke er versjonert enda.';
COMMENT ON COLUMN app_cms_content.live_version_number IS
  'BIN-680 Lag 1: denormalisert versjons-nummer for rask visning uten join.';
