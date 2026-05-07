-- Fase 1 (2026-05-07): Spilleplan-redesign — game-catalog + plan + run.
--
-- Bakgrunn (Tobias 2026-05-07):
-- Dagens spilleplan-flyt har 9 tabeller (app_game_management,
-- app_daily_schedules, app_sub_games, app_schedule_sub_games,
-- app_game1_scheduled_games osv.) og krever at admin klikker seg gjennom
-- 5+ skjermer for å lage en plan. Tobias ønsker en radikal forenkling:
-- 4 nye tabeller, 2 admin-sider (game-catalog + plan-builder), drag-and-
-- drop-rekkefølge i sekvens.
--
-- Denne migrasjonen er FASE 1 av 4 — vi bygger ny modell PARALLELT med
-- eksisterende. Fase 2 (admin-UI), Fase 3 (runtime-kobling), Fase 4
-- (data-migrasjon) kommer senere.
--
-- Modellen:
--   - app_game_catalog: spillkatalog (én rad per "type spill" — Jackpot,
--     Innsatsen, Trafikklys osv.). Inneholder pris-per-bongfarge, premier
--     per fase (Rad 1-4 + Bingo per farge), bonus-game-flag og om master
--     må fylle inn jackpot-popup ved start.
--   - app_game_plan: spilleplan (template — "Spilleplan mandag-fredag")
--     bundet til hall ELLER group_of_halls (XOR), gyldig på et sett
--     ukedager innen et åpningstid-vindu.
--   - app_game_plan_item: spill i sekvens (1, 2, ..., N) som peker til
--     game-catalog. Duplikater er tillatt — Spill 2 og 14 i Tobias' bilde
--     er begge "Innsatsen".
--   - app_game_plan_run: runtime-state per (hall, business_date) — hvilken
--     plan som kjører, current_position, status (idle/running/paused/
--     finished), og jackpot-overrides per posisjon (master fyller ut popup
--     ved start av jackpot-spill).
--
-- Bongfarge-whitelist: gul, hvit, lilla. Bonus-game-whitelist: mystery,
-- wheel_of_fortune, treasure_chest, color_draft.
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent
-- (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
--
-- Up migration

-- ── app_game_catalog ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_game_catalog (
  id                       TEXT PRIMARY KEY,
  slug                     TEXT NOT NULL UNIQUE,
  display_name             TEXT NOT NULL,
  description              TEXT NULL,
  rules_json               JSONB NOT NULL DEFAULT '{}'::jsonb,
  ticket_colors_json       JSONB NOT NULL DEFAULT '["gul","hvit"]'::jsonb,
  ticket_prices_cents_json JSONB NOT NULL DEFAULT '{"gul":1000,"hvit":500}'::jsonb,
  prizes_cents_json        JSONB NOT NULL,
  bonus_game_slug          TEXT NULL,
  bonus_game_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  requires_jackpot_setup   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL
);

-- Hyppigste lookup er slug → row (admin-UI dropdowns + runtime-binding).
CREATE INDEX IF NOT EXISTS idx_app_game_catalog_slug
  ON app_game_catalog(slug)
  WHERE is_active = TRUE;

-- Admin-list sorterer på sort_order først, så display_name (samme rekkefølge
-- som GameTypeService bruker — passer admin-dropdown).
CREATE INDEX IF NOT EXISTS idx_app_game_catalog_sort
  ON app_game_catalog(sort_order, display_name);

COMMENT ON TABLE  app_game_catalog IS
  'Fase 1 (2026-05-07): spillkatalog. En rad per "type spill" (Jackpot, Innsatsen, Trafikklys). Pris-per-bongfarge, premier per fase, bonus-game-flag og jackpot-popup-flag.';

COMMENT ON COLUMN app_game_catalog.slug IS
  'Stabilt slug — lowercase + alfanumerisk + bindestrek. Brukes som programmatisk ID i admin-UI og runtime-kode.';

COMMENT ON COLUMN app_game_catalog.rules_json IS
  'Fritt strukturert spill-regler-objekt — varierer per spill-type. Service-laget validerer ikke innholdet, bare at det er gyldig JSON-objekt.';

COMMENT ON COLUMN app_game_catalog.ticket_colors_json IS
  'Liste av aktive bongfarger. Whitelist: gul/hvit/lilla. Service-laget validerer at hver innslag er i whitelisten.';

COMMENT ON COLUMN app_game_catalog.ticket_prices_cents_json IS
  'Pris per bongfarge i øre (cents). Keys må matche ticket_colors_json. Verdier > 0.';

COMMENT ON COLUMN app_game_catalog.prizes_cents_json IS
  'Premier per fase. Struktur: {"rad1": int, "rad2": int, "rad3": int, "rad4": int, "bingo": {"gul": int, "hvit": int, "lilla": int}}. Bingo-keys må matche ticket_colors_json. Alle beløp i øre.';

COMMENT ON COLUMN app_game_catalog.bonus_game_slug IS
  'Hvilket bonus-spill kjøres ved fullt hus. Whitelist: mystery, wheel_of_fortune, treasure_chest, color_draft. NULL hvis ingen bonus.';

COMMENT ON COLUMN app_game_catalog.bonus_game_enabled IS
  'Toggle for å skru av bonus-spill uten å slette bonus_game_slug. Service-laget bruker (bonus_game_enabled AND bonus_game_slug IS NOT NULL).';

COMMENT ON COLUMN app_game_catalog.requires_jackpot_setup IS
  'TRUE hvis spillet krever at master fyller ut jackpot-popup ved start (trekk + premier per bongfarge). Brukes av GamePlanRunService.advanceToNext for å returnere jackpotSetupRequired-flagg.';

-- ── app_game_plan ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_game_plan (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT NULL,
  hall_id             TEXT NULL REFERENCES app_halls(id) ON DELETE CASCADE,
  group_of_halls_id   TEXT NULL,
  weekdays_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  -- XOR: enten hall_id eller group_of_halls_id må være satt (ikke begge,
  -- ikke ingen). app_groups-tabellen finnes ikke ennå — derfor ingen FK
  -- på group_of_halls_id i denne migrasjonen. Service-laget validerer
  -- gyldigheten av group-id når den tabellen kommer.
  CONSTRAINT app_game_plan_hall_or_group CHECK (
    (hall_id IS NOT NULL AND group_of_halls_id IS NULL) OR
    (hall_id IS NULL AND group_of_halls_id IS NOT NULL)
  ),
  -- start_time < end_time (samme dag — ikke støtte for over-midnatt-vinduer).
  CONSTRAINT app_game_plan_time_window CHECK (start_time < end_time)
);

-- Aktive planer per hall (admin-UI: "vis planer for hall X").
CREATE INDEX IF NOT EXISTS idx_app_game_plan_hall
  ON app_game_plan(hall_id)
  WHERE is_active = TRUE AND hall_id IS NOT NULL;

-- Aktive planer per group (gjenbruk-mønster: én plan dekker flere haller).
CREATE INDEX IF NOT EXISTS idx_app_game_plan_group
  ON app_game_plan(group_of_halls_id)
  WHERE is_active = TRUE AND group_of_halls_id IS NOT NULL;

COMMENT ON TABLE  app_game_plan IS
  'Fase 1 (2026-05-07): spilleplan-template. Bundet til hall ELLER group_of_halls (XOR). Gyldig på et sett ukedager innen et tids-vindu (åpningstid).';

COMMENT ON COLUMN app_game_plan.weekdays_json IS
  'Liste av ukedager hvor planen er gyldig. Whitelist: mon/tue/wed/thu/fri/sat/sun. Service-laget validerer.';

COMMENT ON COLUMN app_game_plan.start_time IS
  'Åpningstid for hall-vinduet. CHECK-constraint sikrer start_time < end_time.';

COMMENT ON COLUMN app_game_plan.group_of_halls_id IS
  'app_groups-tabellen finnes ikke ennå — derfor ingen FK i denne migrasjonen. Service-laget kan validere når tabellen kommer.';

-- ── app_game_plan_item ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_game_plan_item (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES app_game_plan(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL CHECK (position >= 1),
  game_catalog_id     TEXT NOT NULL REFERENCES app_game_catalog(id) ON DELETE RESTRICT,
  notes               TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Position må være unik innen samme plan (ingen overlapp).
  UNIQUE(plan_id, position)
);

-- setItems-flow leser ALL items for en plan i en gang, sortert på position.
CREATE INDEX IF NOT EXISTS idx_app_game_plan_item_plan
  ON app_game_plan_item(plan_id, position);

COMMENT ON TABLE  app_game_plan_item IS
  'Fase 1 (2026-05-07): spill i plan-sekvens. Position 1, 2, ..., N. Duplikater (samme game_catalog_id i flere posisjoner) er TILLATT — Spill 2 og 14 i Tobias-bildet er begge Innsatsen.';

COMMENT ON COLUMN app_game_plan_item.game_catalog_id IS
  'ON DELETE RESTRICT: kan ikke slette en catalog-entry som er referert fra en plan. Soft-delete (is_active=false) på catalog-entry må brukes i stedet.';

-- ── app_game_plan_run ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_game_plan_run (
  id                       TEXT PRIMARY KEY,
  plan_id                  TEXT NOT NULL REFERENCES app_game_plan(id) ON DELETE RESTRICT,
  hall_id                  TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  business_date            DATE NOT NULL,
  current_position         INTEGER NOT NULL DEFAULT 1 CHECK (current_position >= 1),
  status                   TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'paused', 'finished')),
  jackpot_overrides_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at               TIMESTAMPTZ NULL,
  finished_at              TIMESTAMPTZ NULL,
  master_user_id           TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Én aktiv run per (hall, business_date). Tillater historiske rader
  -- (status=finished) ved siden av en ny aktiv run for samme dato? Nei —
  -- unique(hall_id, business_date) er strengt. Hvis vi i fremtiden trenger
  -- replay/historikk per hall+dato, må vi flytte historikk til egen tabell.
  UNIQUE(hall_id, business_date)
);

-- Hyppigste lookup er aktiv run per (hall, business_date).
CREATE INDEX IF NOT EXISTS idx_app_game_plan_run_active
  ON app_game_plan_run(hall_id, business_date)
  WHERE status IN ('idle', 'running', 'paused');

COMMENT ON TABLE  app_game_plan_run IS
  'Fase 1 (2026-05-07): runtime-state per (hall, business_date). Hvilken plan som kjører, current_position, status (idle/running/paused/finished), jackpot-overrides (master fyller popup per jackpot-posisjon).';

COMMENT ON COLUMN app_game_plan_run.business_date IS
  'Dato (Oslo-tz) for skiftet. Service-laget bruker today/tomorrow-validering — historiske datoer er ikke lov ved create.';

COMMENT ON COLUMN app_game_plan_run.current_position IS
  'Hvilken posisjon i plan-sekvensen som kjører nå. Initial 1. Inkrementeres av advanceToNext.';

COMMENT ON COLUMN app_game_plan_run.status IS
  'Status-overganger: idle → running → (paused ↔ running) → finished. Force-finish er OK fra alle ikke-finished-states.';

COMMENT ON COLUMN app_game_plan_run.jackpot_overrides_json IS
  'Jackpot-popup-data per posisjon. Struktur: {"<position>": {"draw": int, "prizes_cents": {"gul": int, "hvit": int, "lilla": int}}}. advanceToNext blokkerer (returnerer jackpotSetupRequired=true) hvis posisjon krever setup men override mangler.';
