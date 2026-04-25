-- GAP #23: Screen Saver-bilder for hall-TV / dedikerte terminaler.
--
-- Wireframe-katalog WIREFRAME_CATALOG.md §PDF 14:
--   * Multi-image carousel (1920x1080, PNG/JPG)
--   * Per-image vis-tid (display_seconds)
--   * Globalt eller per-hall (hall_id NULL = global)
--   * Aktivt/inaktivt-flagg per bilde
--   * Reorder via display_order
--
-- Legacy-opphav (informative): legacy/unity-backend Controllers/SettingsController.js
-- (`addScreenSaverData` + tilhørende admin-route i routes/backend.js:481).
-- Legacy bruker en flat liste under `screenSaverImages`; vi normaliserer til
-- en separat tabell siden vi støtter per-hall override og reorder.
--
-- Forward-only (BIN-661): ingen Down-seksjon. Tabellen oppretters ikke
-- automatisk via service-init — alle nye tabeller skal være migration-eide
-- (BIN-661 / BIN-643).
--
-- Lifecycle:
--   * INSERT av nye bilder fra admin-UI (image_url peker på CDN/Cloudinary).
--   * UPDATE for endring av vis-tid, aktivt-flagg eller display_order.
--   * Soft-delete via `deleted_at` slik at audit-historikk består.

-- Up migration

CREATE TABLE IF NOT EXISTS app_screen_saver_images (
  id              TEXT PRIMARY KEY,
  -- NULL = globalt screensaver-bilde (vises i alle haller). Ellers
  -- per-hall override. ON DELETE CASCADE — hvis hall slettes, fjernes
  -- de tilhørende screensaver-overstyringene også.
  hall_id         TEXT NULL
                    REFERENCES app_halls(id) ON DELETE CASCADE,
  -- Absolutt URL til bildet (CDN/Cloudinary). Service-laget validerer
  -- http(s)-format. Tom streng tillates ikke.
  image_url       TEXT NOT NULL CHECK (length(image_url) > 0),
  -- Sorterings-indeks for carousel. Kan være duplikater på tvers av haller
  -- men er typisk distinct innenfor (hall_id IS NULL ELLER hall_id=X).
  display_order   INTEGER NOT NULL DEFAULT 0
                    CHECK (display_order >= 0),
  -- Antall sekunder hvert bilde vises før neste. Wireframe spesifiserer
  -- 5/10/20 sekunder; vi tillater 1-300 (5 min cap mot uhell).
  display_seconds INTEGER NOT NULL DEFAULT 10
                    CHECK (display_seconds BETWEEN 1 AND 300),
  -- Inaktive bilder hoppes over i carousel uten å slettes.
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- Audit
  created_by      TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL
);

-- Vanlig query-mønster: list aktive bilder for en gitt hall (eller global)
-- sortert etter display_order.
CREATE INDEX IF NOT EXISTS idx_screen_saver_images_hall_active
  ON app_screen_saver_images(hall_id, is_active, display_order)
  WHERE deleted_at IS NULL;

-- Reorder kjører ofte — gjør indeksert lookup raskere.
CREATE INDEX IF NOT EXISTS idx_screen_saver_images_order
  ON app_screen_saver_images(hall_id, display_order)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE  app_screen_saver_images IS
  'Screen-saver-bilder for hall-TV (GAP #23). Multi-image carousel med per-image vis-tid og global/per-hall override.';
COMMENT ON COLUMN app_screen_saver_images.hall_id IS
  'NULL = globalt bilde (alle haller). Ellers ID til spesifikk hall.';
COMMENT ON COLUMN app_screen_saver_images.image_url IS
  'Absolutt URL til CDN-bilde. Wireframe krever 1920x1080 PNG/JPG; håndheves UI-side.';
COMMENT ON COLUMN app_screen_saver_images.display_seconds IS
  'Sekunder bildet vises i carousel-rotasjon. Range 1-300.';
COMMENT ON COLUMN app_screen_saver_images.display_order IS
  'Sorteringsindeks (0=først). Service eksponerer reorder-endepunkt for å justere flere ganger samtidig.';
