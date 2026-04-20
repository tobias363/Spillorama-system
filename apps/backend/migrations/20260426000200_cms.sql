-- BIN-676: CMS content + FAQ.
--
-- To separate tabeller:
--   app_cms_content — tekst-sider (aboutus, terms, support, links,
--                     responsible-gaming). Slug PRIMARY KEY, rå TEXT-innhold
--                     (HTML/markdown). En rad per slug (upsert på PUT).
--   app_cms_faq     — FAQ-liste. Separat tabell siden FAQ er mange rader
--                     (ikke én blob per slug), hver med spørsmål + svar +
--                     sort-order.
--
-- Design-valg — CMS content:
--   Legacy `cms`-kolleksjon var et singleton-Mongo-dokument med fem
--   keyed felt (terms, support, aboutus, responsible_gameing, links), hver
--   et fri-form objekt. Vi normaliserer til én rad per slug i v1 — enklere
--   upsert-semantikk, og vi unngår å blande fem ulike redigeringsflyter
--   i ett dokument. `content` er TEXT (ikke JSONB) fordi admin-UI redigerer
--   ren HTML/markdown; ingen strukturell validering per slug.
--
--   `slug` er stabil ident (`aboutus`, `terms`, `support`, `links`,
--   `responsible-gaming`). Service-laget begrenser til den kjente listen —
--   ukjente slugs avvises fail-closed. `responsible-gaming` er hermetisk
--   gated på PUT inntil BIN-680 implementerer versjons-historikk (regulatorisk
--   krav, pengespillforskriften §11).
--
-- Design-valg — FAQ:
--   En rad per Q&A. `sort_order` for admin-bestemt rekkefølge (legacy hadde
--   `queId` som stringified sort-nummer — vi moderniserer til INTEGER).
--   `id` er TEXT (UUID fra service-laget) slik at API-kontrakten er stabil
--   selv om vi evt. re-importerer legacy-dokumenter.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Legacy-opphav:
--   legacy/unity-backend/App/Models/cms.js
--   legacy/unity-backend/App/Models/faq.js
--   legacy/unity-backend/App/Services/cmsServices.js
--   legacy/unity-backend/App/Controllers/cmsController.js

-- ── CMS content (tekst-sider) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_cms_content (
  -- Stabil slug (en av: aboutus, terms, support, links, responsible-gaming).
  slug                TEXT PRIMARY KEY,
  -- Rå tekst-innhold (HTML/markdown). TEXT (ikke JSONB) fordi admin
  -- redigerer sidene som tekst; ingen strukturert validering.
  content             TEXT NOT NULL DEFAULT '',
  updated_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_cms_content IS
  'BIN-676: tekst-CRUD for statiske sider (aboutus/terms/support/links/responsible-gaming). Slug-whitelisted i CmsService.';

COMMENT ON COLUMN app_cms_content.slug IS
  'BIN-676: stabil slug. Gyldige verdier håndheves i service-laget.';

COMMENT ON COLUMN app_cms_content.content IS
  'BIN-676: rå tekst-innhold (HTML/markdown). Ingen strukturell validering.';

-- ── FAQ (liste med Q&A) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_cms_faq (
  id                  TEXT PRIMARY KEY,
  question            TEXT NOT NULL,
  answer              TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_cms_faq_sort_order
  ON app_cms_faq(sort_order ASC, created_at ASC);

COMMENT ON TABLE app_cms_faq IS
  'BIN-676: FAQ-liste (Q&A). En rad per spørsmål; sort_order styrer admin-bestemt rekkefølge.';

COMMENT ON COLUMN app_cms_faq.sort_order IS
  'BIN-676: stigende sort-order (lavere vises først). Erstatter legacy `queId`-string.';
