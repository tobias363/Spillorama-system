-- ══════════════════════════════════════════════════════════════════════════════
-- Schema-sync 2026-04-26 — prod catch-up script
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Reconciles prod-DB with all 96 pending migrations in apps/backend/migrations/.
--
-- Strategy:
--   * Every statement gets existence guards (DO $sync$ ... $sync$).
--   * APPLIED-OUT-OF-BAND migrations only emit INSERT INTO pgmigrations.
--   * Constraints/indexes already in prod (with name variants like idx_public_*)
--     are skipped.
--   * Schema clashes (table exists with different shape, e.g. app_hall_groups
--     in 20260416000001 vs 20260424000000) are handled via column-existence
--     checks on COMMENT ON COLUMN.
--   * The CONFLICT (20260424153706_agent_shift_logout_flags) is wrapped with
--     table-existence guards. The ALTER for app_physical_ticket_pending_payouts
--     silently skips. A FOLLOW-UP block at the end re-applies it after the
--     20260608000000 migration creates the table.
--
-- The script ends with ROLLBACK so it's review-safe. To execute:
--   1. PM-review of docs/operations/SCHEMA_SYNC_PLAN_2026-04-26.md
--   2. Take fresh backup
--   3. Change ROLLBACK at end to COMMIT
--   4. psql $PGURL -f tools/schema-sync-2026-04-26.sql
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

LOCK TABLE pgmigrations IN EXCLUSIVE MODE;


-- ──────────────────────────────────────────────────────────────────────────────
-- 20260424153706_agent_shift_logout_flags
-- Class: CONFLICT
-- Reason: unresolvable: app_physical_ticket_pending_payouts (only created in 20260608000000_physical_ticket_pending_payouts, AFTER this)
-- ──────────────────────────────────────────────────────────────────────────────
-- Wireframe Gap #9 (PDF 17.6): Shift Log Out-flyt med 2 checkboxer.
--
-- Spec: docs/architecture/WIREFRAME_PDF16_17_GAPS_2026-04-24.md §9
--
-- Bakgrunn:
--   Agent V1.0 wireframe 17.6 (Shift Log Out-popup) krever at bingovert kan
--   avslutte skiftet sitt med to flagg:
--
--     1. "Distribute winnings to physical players" — markerer alle pending
--        cashouts (app_physical_ticket_pending_payouts) for agenten som
--        tilgjengelig for neste agent til å utbetale.
--     2. "Transfer register ticket to next agent" — markerer åpne
--        ticket-ranges (app_agent_ticket_ranges) for agenten som overførbare
--        ved neste innlogging / transfer-hall-access-flyt.
--
--   Begge flaggene er opt-in; logout uten avkrysning = legacy-oppførsel
--   (kun shift.end som før). Flaggene skrives til app_agent_shifts for
--   audit + rapport, mens selve markeringen skjer på child-tabellene.
--
-- Designvalg:
--   * distributed_winnings / transferred_register_tickets er BOOLEAN DEFAULT
--     FALSE på app_agent_shifts. Eksisterende rader får false implisitt.
--   * logout_notes er TEXT NULL for valgfri audit-kommentar fra bingovert
--     (legacy V1.0 har et fri-tekst-felt på popup-skjermen som vi beholder).
--   * pending_for_next_agent på app_physical_ticket_pending_payouts er
--     BOOLEAN DEFAULT FALSE. Settes true når distribute-flagget sendes.
--     Partial-indeks for rask query av "pending cashouts tilgjengelig for
--     meg".
--   * transfer_to_next_agent på app_agent_ticket_ranges er BOOLEAN DEFAULT
--     FALSE. Settes true sammen med transferred_register_tickets på shiften.
--     AgentTicketRangeService skal sjekke dette flagget ved neste
--     registrering og tilby overtagelse.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_shifts') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_shifts
  ADD COLUMN IF NOT EXISTS distributed_winnings BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transferred_register_tickets BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logout_notes TEXT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_shifts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_shifts' AND column_name='distributed_winnings') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_shifts.distributed_winnings         IS 'Gap #9: true hvis agent krysset av for "Distribute winnings to physical players" ved logout. Pending cashouts merkes pending_for_next_agent = true.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_shifts.distributed_winnings';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_shifts' AND column_name='transferred_register_tickets') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_shifts.transferred_register_tickets IS 'Gap #9: true hvis agent krysset av for "Transfer register ticket to next agent" ved logout. Åpne ticket-ranges merkes transfer_to_next_agent = true.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_shifts.transferred_register_tickets';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_shifts' AND column_name='logout_notes') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_shifts.logout_notes                 IS 'Gap #9: valgfri audit-notat fra bingovert på logout-popup (legacy V1.0 fri-tekst-felt).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_shifts.logout_notes';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_ticket_pending_payouts
  ADD COLUMN IF NOT EXISTS pending_for_next_agent BOOLEAN NOT NULL DEFAULT false $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_ticket_pending_payouts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='pending_for_next_agent') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.pending_for_next_agent IS 'Gap #9: true når avtroppende agent har valgt "Distribute winnings" ved logout. Neste agent ser denne raden i sin cashout-vakt. Settes false igjen ved paid_out_at / rejected_at (håndteres i service).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.pending_for_next_agent';
  END IF;
END $sync$;

-- Partial-indeks: "hvilke pending cashouts er overtakelses-klare i denne hallen?"
-- Brukt av neste agents dashboard ved innlogging.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_next_agent
  ON app_physical_ticket_pending_payouts (hall_id)
  WHERE pending_for_next_agent = true AND paid_out_at IS NULL AND rejected_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_physical_ticket_pending_payouts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_ticket_ranges
  ADD COLUMN IF NOT EXISTS transfer_to_next_agent BOOLEAN NOT NULL DEFAULT false $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_ticket_ranges' AND column_name='transfer_to_next_agent') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_ticket_ranges.transfer_to_next_agent IS 'Gap #9: true når avtroppende agent har valgt "Transfer register ticket" ved logout. Neste agent ved transfer-hall-access ser åpne ranges som tilgjengelig for overtagelse.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_ticket_ranges.transfer_to_next_agent';
  END IF;
END $sync$;

-- Partial-indeks: "hvilke range-er er merket som transfer-klare i denne hallen?"
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_transfer_ready
  ON app_agent_ticket_ranges (hall_id)
  WHERE transfer_to_next_agent = true AND closed_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260424153706_agent_shift_logout_flags', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260424153706_agent_shift_logout_flags');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000000_close_day_log
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-623: CloseDay log — regulatorisk dagsavslutning per GameManagement.
--
-- Hver rad representerer én lukket dag for ett spill (GameManagement). Tabellen
-- er append-only på (game_management_id, close_date): unique-indeks hindrer
-- dobbel-lukking av samme dag og gir fail-fast idempotency i service-laget.
--
-- Regulatorisk rolle:
--   Pengespillforskriften § 64 krever rekonstruerbar historikk per dag. Denne
--   tabellen er et sekundært oppslag — primær audit-trail skrives til
--   `app_audit_log` (action = "admin.game.close-day") i samme transaksjon slik
--   at både "strukturert aggregat-snapshot" og "hvem-gjorde-hva-når" er
--   bevart. Raden her mister ikke data om `app_audit_log` skulle feile
--   (fire-and-forget i audit-laget, se BIN-588).
--
-- Legacy-kontekst:
--   Legacy `closeDay` (legacy/unity-backend/App/Controllers/GameController.js
--   10126–10414) lagret "closed time-slots" embedded i `dailySchedule.otherData.closeDay`
--   som liste av (closeDate, startTime, endTime). Det er en SCHEDULING-feature
--   (markér et tidsvindu som stengt), ikke en audit-lukking av kjørt dag.
--   BIN-623 introduserer den regulatorisk-orienterte dagslukkingen som ikke
--   fantes i legacy-stacken — admin-UI (closeDay.html) slo bare fast at en
--   runde skulle markeres ferdig, uten audit-trail.
--
-- Summary-snapshot:
--   `summary_json` holder aggregatene vi har i dag (totalSold, totalEarning
--   fra `app_game_management`). Når BIN-622-tabellene for tickets/wins/jackpots
--   normaliseres videre, utvides snapshot-strukturen. Eksisterende rader
--   blir urørt siden kolonnen er JSONB og parseres defensivt.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_close_day_log (
  id                  TEXT PRIMARY KEY,
  game_management_id  TEXT NOT NULL,
  -- YYYY-MM-DD i hall-tidssone. Holdt som DATE slik at unique-indeks + range-
  -- queries på "lukket i dag" ikke trenger å tenke på tidssone-konvertering
  -- per query.
  close_date          DATE NOT NULL,
  closed_by           TEXT NULL,
  -- Aggregat-snapshot på lukketidspunkt. Inneholder minimum:
  --   { totalSold, totalEarning, ticketsSold, winnersCount,
  --     payoutsTotal, jackpotsTotal, capturedAt }
  -- Defensivt parse-mønster i service — manglende felter fallbackes til 0.
  summary_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency-håndheving: én lukking per (spill, dato).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_close_day_log') THEN
    EXECUTE $stmt$ CREATE UNIQUE INDEX IF NOT EXISTS uq_app_close_day_log_game_date
  ON app_close_day_log(game_management_id, close_date) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_close_day_log';
  END IF;
END $sync$;

-- Oppslags-index for "har dette spillet blitt lukket nylig?"-queries.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_close_day_log') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_close_day_log_game_recent
  ON app_close_day_log(game_management_id, closed_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_close_day_log';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_close_day_log') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_close_day_log IS
  'BIN-623: regulatorisk dagslukking per GameManagement. Unique (game_management_id, close_date) håndhever idempotency. Sekundær til app_audit_log.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_close_day_log' AND column_name='close_date') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_close_day_log.close_date IS
  'BIN-623: lukke-dato (YYYY-MM-DD) i hall-tidssone. UNIQUE med game_management_id.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_close_day_log.close_date';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_close_day_log' AND column_name='summary_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_close_day_log.summary_json IS
  'BIN-623: aggregat-snapshot (totalSold, totalEarning, ticketsSold, winnersCount, payoutsTotal, jackpotsTotal, capturedAt). Defensivt parset — manglende felter = 0.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_close_day_log.summary_json';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000000_close_day_log', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000000_close_day_log');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000000_game_types
-- Class: APPLIED-OUT-OF-BAND
-- Reason: all 4 effects present (after variant resolution)
-- ──────────────────────────────────────────────────────────────────────────────
-- All effects already in prod. Just record as applied.
INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000000_game_types', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000000_game_types');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000100_sub_games
-- Class: NOT-APPLIED
-- Reason: 5 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-621: SubGame CRUD (admin-katalog av gjenbrukbare pattern-bundles).
--
-- SubGame = en navngitt mal som bundler et sett mønster-referanser +
-- ticket-farge-liste, som DailySchedule (BIN-626) binder inn i
-- `subgames_json` for å kjøre en preconfigured kombinasjon. En SubGame er
-- ikke i seg selv et kjørbart spill; det er admin-katalog-entiteten som
-- gir DailySchedule-oppsett rask tilgang til gjentagelige pattern-oppsett.
--
-- Legacy Mongo-schema `subGame1` (se legacy/unity-backend/App/Models/subGame1.js
-- og legacy/unity-backend/App/Controllers/subGameController.js) hadde feltene:
--   {subGameId, gameName, patternRow: [{_id,name,patternId,patternType,...}],
--    allPatternRowId, status, ticketColor: [{name, type}], gameType}
--
-- Vi normaliserer slik at:
--   - `game_type_id` peker til app_game_types.type_slug (stabil referent).
--   - `pattern_rows_json` bevarer legacy patternRow-strukturen som JSON
--     (kan normaliseres senere hvis det blir behov). Service-laget
--     eksponerer et forenklet {patternId, name}-format på wire.
--   - `ticket_colors_json` bevarer farge-liste (legacy var array av
--     {name, type}-objekter; wire-formatet er string[] — type-feltet er en
--     deriverbar slug som service kan rekonstruere ved behov).
--   - `sub_game_number` bevarer legacy auto-increment ("SG_<timestamp>").
--
-- Legacy-opphav (controllers + services):
--   legacy/unity-backend/App/Controllers/subGameController.js
--     - subGame1 / subGame1List         → liste-side + DataTable
--     - addSubGame / addSubGamePostData → POST
--     - editSubGame / editSubGamePostData → PATCH
--     - getSubGameDelete                → DELETE
--     - viewSubGame                     → detalj-side
--     - checkForGameName                → duplikat-sjekk
--
-- Delete-policy (matches service-laget):
--   - Soft-delete default (sett deleted_at + status='inactive').
--   - Hard-delete blokkeres hvis SubGame er referert fra:
--       - `app_daily_schedules.subgames_json` (JSON array av subGame-ids)
--       - `app_game_management.config_json` (potensielt via subGameId-
--         array — bevart fra legacy).
--     Ved soft-delete bevares historiske schedule-referanser intakt.
--
-- Up

CREATE TABLE IF NOT EXISTS app_sub_games (
  id                  TEXT PRIMARY KEY,
  -- Referent til app_game_types.type_slug (stabil slug-id). Vi bruker TEXT
  -- (ikke FK) for å speile legacy-designet hvor game_type lagres som slug-
  -- streng ("game_1", "bingo"). Referent-integritet håndheves i service-
  -- laget (lookup via GameTypeService.getBySlug før insert/update).
  game_type_id        TEXT NOT NULL,
  -- Display-navn på game-type ("Game1", "Game3") — ikke unik, kun label.
  -- Legacy subGame.gameName-feltet.
  game_name           TEXT NOT NULL,
  -- Visnings-navn på SubGame-malen (unikt per gameType).
  name                TEXT NOT NULL,
  -- Legacy auto-increment ("SG_<timestamp>") — bevart for bakover-
  -- kompatibilitet med daily_schedules.subgames_json som kan referere
  -- både nye UUID-ids og gamle SG_-strenger.
  sub_game_number     TEXT NOT NULL,
  -- Legacy patternRow — array av {_id, name, patternId, patternType, ...}.
  -- Vi bevarer som JSON inntil service-laget normaliserer til egen tabell.
  -- Wire-formatet er forenklet til {patternId, name}[]; de øvrige legacy-
  -- feltene (patternType, isWoF, ...) bevares i JSON for read-back.
  pattern_rows_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Legacy ticketColor — array av {name, type}. Wire-formatet er string[]
  -- (kun navn); type deriveres (lower-camel-case av navn) av service.
  ticket_colors_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
  -- Fri-form fallback for legacy-felter som ikke har egen kolonne
  -- (f.eks. creationDateTime, allPatternRowId, eller fremtidige felt).
  extra_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

-- Unikt navn per gameType — partial index slik at soft-slettede rader ikke
-- okkuperer navnet og slik at duplikater innenfor samme gameType blokkeres
-- (matches legacy checkForGameName-logikken, som sjekket globalt, men vi
-- strammer til per-gameType for å unngå kollisjon mellom Game1/Game3-maler).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_sub_games') THEN
    EXECUTE $stmt$ CREATE UNIQUE INDEX IF NOT EXISTS uq_app_sub_games_name_per_type
  ON app_sub_games(game_type_id, name)
  WHERE deleted_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_sub_games';
  END IF;
END $sync$;

-- Unikt sub_game_number — partial index (legacy-format bevares per row).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_sub_games') THEN
    EXECUTE $stmt$ CREATE UNIQUE INDEX IF NOT EXISTS uq_app_sub_games_sub_game_number
  ON app_sub_games(sub_game_number)
  WHERE deleted_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_sub_games';
  END IF;
END $sync$;

-- Filter-indekser for liste-views (status-filter + per-gameType).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_sub_games') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_sub_games_game_type
  ON app_sub_games(game_type_id)
  WHERE deleted_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_sub_games';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_sub_games') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_sub_games_status
  ON app_sub_games(status)
  WHERE deleted_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_sub_games';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_sub_games') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_sub_games IS
  'BIN-621: admin-konfigurerte SubGame-maler (navngitte bundles av pattern-ids + ticket-farger). Erstatter legacy Mongo-schema subGame1. Referenced by app_daily_schedules.subgames_json.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_sub_games' AND column_name='game_type_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_sub_games.game_type_id IS
  'BIN-621: referent til app_game_types.type_slug (stabil slug). Service-laget håndhever lookup; ingen DB-level FK siden type_slug ikke har PK-garanti på tvers av soft-slettede rader.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_sub_games.game_type_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_sub_games' AND column_name='pattern_rows_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_sub_games.pattern_rows_json IS
  'BIN-621: legacy patternRow-array (bevart som JSON). Wire-format er forenklet til {patternId, name}[]; øvrige legacy-felter bevares for read-back.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_sub_games.pattern_rows_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_sub_games' AND column_name='ticket_colors_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_sub_games.ticket_colors_json IS
  'BIN-621: ticket-farge-liste. Lagret som JSON-array for enkel utveksling med legacy-schedule-snippets.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_sub_games.ticket_colors_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_sub_games' AND column_name='sub_game_number') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_sub_games.sub_game_number IS
  'BIN-621: legacy-format (SG_<timestamp>). Bevart for daily_schedules.subgames_json bakover-kompatibilitet.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_sub_games.sub_game_number';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000100_sub_games', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000100_sub_games');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000200_saved_games
-- Class: APPLIED-OUT-OF-BAND
-- Reason: all 5 effects present (after variant resolution)
-- ──────────────────────────────────────────────────────────────────────────────
-- All effects already in prod. Just record as applied.
INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000200_saved_games', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000200_saved_games');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000300_schedules
-- Class: APPLIED-OUT-OF-BAND
-- Reason: all 4 effects present (after variant resolution)
-- ──────────────────────────────────────────────────────────────────────────────
-- All effects already in prod. Just record as applied.
INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000300_schedules', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000300_schedules');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000400_leaderboard_tiers
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-668: Leaderboard tier CRUD (admin-katalog av plass→premie-mapping).
--
-- LeaderboardTier = admin-konfigurasjon av hvilke premier/poeng som deles ut
-- basert på plassering (place) i dag/periode-leaderboard. Dette er
-- KONFIGURASJON — ikke runtime-output. Runtime `/api/leaderboard` (i
-- apps/backend/src/routes/game.ts) aggregerer prize-points per bruker fra
-- faktiske wins og er urørt av denne tabellen. Admin-UI (PR-B6 Leaderboard
-- bolk) leser denne tabellen for å vise "hva tier-strukturen er" og for å
-- la admin editere hvilke plassverdier gir hvilke premier/points.
--
-- Tabellen er intensjonelt enkel: én rad per (place, tier_name) kombinasjon.
-- `tier_name` gir støtte for flere samtidige "profiler" (f.eks. "daily",
-- "weekly", "vip") — en tier-profil er en komplett plass→premie-tabell.
-- Hvis admin kun trenger ett sett, bruk tier_name="default".
--
-- Legacy-kontekst:
--   Legacy stack hadde ingen separat tier-tabell; premier ble lagt inline i
--   scheduler-snippets eller hardkodet i Unity Admin. Dette flyttes nå til
--   egen admin-CRUD slik at premie-strukturen er konfigurerbar uten
--   code-deploy.
--
-- Gjenbruk:
--   - Samme mønster som app_game_types (BIN-620) + app_hall_groups (BIN-665).
--   - Soft-delete default (sett deleted_at), hard-delete mulig når ingen
--     runtime-referanse finnes.
--   - Partial unique index på (tier_name, place) WHERE deleted_at IS NULL
--     for å hindre duplikater per profil uten å okkupere plass for
--     soft-slettede rader.
--
-- Delete-policy (matches service-laget):
--   - Soft-delete default (sett deleted_at + active=false).
--   - Hard-delete er alltid mulig — tier-raden har ingen runtime-referanser
--     (det er ren admin-konfigurasjon); eventuelle prize-awards som ble
--     utløst fra en gitt tier er lagret i audit/ledger, ikke i denne tabellen.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_leaderboard_tiers (
  id                  TEXT PRIMARY KEY,
  -- Logisk tier-profil-navn (f.eks. "default", "daily", "vip"). Lar admin
  -- vedlikeholde flere parallelle profiler. Validering i service-laget.
  tier_name           TEXT NOT NULL DEFAULT 'default',
  -- Plassering (1 = første plass, 2 = andre, osv.). Må være positiv.
  place               INTEGER NOT NULL CHECK (place > 0),
  -- Poeng tildelt for plasseringen (brukt til summering i leaderboard-
  -- aggregat). Må være ikke-negativ.
  points              INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  -- Premie-beløp i NOK (DECIMAL for regnskap — ingen floating-point slakk).
  -- NULL betyr "ingen premie" (kun poeng).
  prize_amount        NUMERIC(12, 2) NULL CHECK (prize_amount IS NULL OR prize_amount >= 0),
  -- Fri-form beskrivelse ("Gavekort 500 kr", "Vinner-trofé", etc.).
  prize_description   TEXT NOT NULL DEFAULT '',
  -- Aktiv-flag. Admin kan deaktivere en tier-rad uten å slette den.
  -- Inactive rader ignoreres av runtime-award-logikk men beholdes for
  -- historisk referanse.
  active              BOOLEAN NOT NULL DEFAULT true,
  -- Fri-form fallback for fremtidige felter (f.eks. badge-ikon,
  -- eligibility-filter, custom-payout-rules).
  extra_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL
);

-- Unikt (tier_name, place) per profil — partial index slik at soft-slettede
-- rader ikke okkuperer plass. Admin-CRUD bruker denne for duplikat-sjekk.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_leaderboard_tiers') THEN
    EXECUTE $stmt$ CREATE UNIQUE INDEX IF NOT EXISTS uq_app_leaderboard_tiers_tier_place
  ON app_leaderboard_tiers(tier_name, place)
  WHERE deleted_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_leaderboard_tiers';
  END IF;
END $sync$;

-- Filter-indeks for "liste alle aktive tiers i profil X".
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_leaderboard_tiers') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_leaderboard_tiers_tier_active
  ON app_leaderboard_tiers(tier_name, active)
  WHERE deleted_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_leaderboard_tiers';
  END IF;
END $sync$;

-- Ordens-indeks for ORDER BY place når vi lister en tier-profil.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_leaderboard_tiers') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_leaderboard_tiers_place
  ON app_leaderboard_tiers(tier_name, place ASC)
  WHERE deleted_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_leaderboard_tiers';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_leaderboard_tiers') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_leaderboard_tiers IS
  'BIN-668: admin-konfigurerte leaderboard-tiers (plass→poeng/premie-mapping). Ren KONFIGURASJON; runtime-leaderboard (/api/leaderboard) er separat og aggregerer fra wins. Forventet bruk: tier_name="default" med én rad per plass (1..N).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_leaderboard_tiers' AND column_name='tier_name') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_leaderboard_tiers.tier_name IS
  'BIN-668: profil-navn som grupperer et sett med tier-rader (f.eks. "default", "daily", "vip"). Unikt sammen med place.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_leaderboard_tiers.tier_name';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_leaderboard_tiers' AND column_name='place') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_leaderboard_tiers.place IS
  'BIN-668: plassering (1-basert). Må være positiv. Unikt innenfor (tier_name, place)-par per ikke-slettet rad.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_leaderboard_tiers.place';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_leaderboard_tiers' AND column_name='prize_amount') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_leaderboard_tiers.prize_amount IS
  'BIN-668: premie-beløp i NOK. NULL = ingen premie (kun points). NUMERIC(12,2) for regnskaps-presisjon.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_leaderboard_tiers.prize_amount';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_leaderboard_tiers' AND column_name='active') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_leaderboard_tiers.active IS
  'BIN-668: aktiv-flag. Deaktivert rad beholdes for historikk men ignoreres av runtime.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_leaderboard_tiers.active';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000400_leaderboard_tiers', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000400_leaderboard_tiers');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000500_system_settings_maintenance
-- Class: PARTIALLY-APPLIED
-- Reason: 2 present, 3 missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-677: System settings + maintenance-vinduer.
--
-- To separate tabeller:
--   app_system_settings     — key-value store for system-wide config (feks
--                             timezone, locale, version-refs, compliance-tak).
--   app_maintenance_windows — planlagte maintenance-vinduer (start/slutt/
--                             status/message). Ett vindu kan være aktivt av
--                             gangen; toggling gjøres via PUT.
--
-- Design-valg — system settings:
--   Key-value med JSONB value i stedet for strukturert tabell fordi legacy
--   `setting`-modell (Mongo) har ~25 fri-form felter (ios_version,
--   daily_spending, android_store_link, systemInformationData, ...) som
--   vokser over tid. Å normalisere hvert felt som kolonne ville kreve en
--   ny migration per nytt felt. JSONB-value lar service-laget typesjekke
--   per definert key (via registry) og admin-UI round-trippe uten data-tap.
--
--   Hver nøkkel har:
--     - `key` : stabil slug (TEXT PRIMARY KEY, feks "system.timezone")
--     - `value_json` : faktisk verdi (string/number/boolean/object) lagret
--                       som JSONB slik at vi bevarer typen.
--     - `category` : gruppering for admin-UI (f.eks. "general", "compliance",
--                    "app_versions", "branding"). Valgfritt.
--     - `description` : menneskelig beskrivelse (tom streng hvis ukjent).
--     - `updated_by_user_id` : hvem som sist rørte nøkkelen.
--     - `updated_at` : når.
--
--   Service-laget validerer type mot et seed/registry — ukjente nøkler
--   lagres ikke (fail-closed). Liste av kjente nøkler dokumenteres i
--   SettingsService.ts.
--
-- Design-valg — maintenance:
--   En rad per vindu (historikk beholdes). `status='active'` = vinduet er i
--   kraft NÅ; aktiv-invariant (kun ett samtidig aktivt vindu) håndheves i
--   service-laget fordi vi ikke kan lage en partial unique index på
--   `WHERE status='active'` uten at deaktivering blir klønete. Legacy hadde
--   det samme mønsteret (settings.maintenance overskrev seg selv); vi
--   moderniserer til separat tabell for audit/historikk.
--
--   `show_before_minutes` = minutter før start hvor UI skal vise banner.
--   `message` = fri-form tekst (vises til spillere). Default på norsk.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Legacy-opphav:
--   legacy/unity-backend/App/Models/setting.js
--   legacy/unity-backend/App/Controllers/SettingsController.js
--     - settings / settingsUpdate / settingsAdd  -> app_system_settings
--     - maintenance / editMaintenance / updateMaintenance -> app_maintenance_windows

-- ── System settings (key-value) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_system_settings (
  key                 TEXT PRIMARY KEY,
  -- Faktisk verdi — JSONB for å bevare type. Eksempler:
  --   "Europe/Oslo"     (string)
  --   42                 (number)
  --   true              (boolean)
  --   {"enabled":true}  (object — brukes av feature-flags/branding-refs)
  value_json          JSONB NOT NULL DEFAULT 'null'::jsonb,
  -- Logisk gruppering for admin-UI. Fri-form slug, ikke foreign key.
  category            TEXT NOT NULL DEFAULT 'general',
  -- Menneskelig beskrivelse (vises i admin-UI).
  description         TEXT NOT NULL DEFAULT '',
  updated_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [SKIPPED — index exists] CREATE INDEX IF NOT EXISTS idx_app_system_settings_category
-- [SKIPPED — index exists]   ON app_system_settings(category);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_system_settings') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_system_settings IS
  'BIN-677: key-value store for system-wide config. Nøkler validerer mot service-registry (SettingsService.SYSTEM_SETTING_REGISTRY). JSONB value bevarer type.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_system_settings' AND column_name='key') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_system_settings.key IS
  'BIN-677: stabil slug (feks "system.timezone", "app.android_version"). Mønster: <category>.<name>.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_system_settings.key';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_system_settings' AND column_name='value_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_system_settings.value_json IS
  'BIN-677: verdi som JSONB. Type valideres av service-laget mot registry-definisjon.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_system_settings.value_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_system_settings' AND column_name='category') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_system_settings.category IS
  'BIN-677: admin-UI gruppering. Ingen FK — fri-form slug som speiler SYSTEM_SETTING_REGISTRY-kategoriene.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_system_settings.category';
  END IF;
END $sync$;

-- ── Maintenance windows ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_maintenance_windows (
  id                  TEXT PRIMARY KEY,
  -- Planlagt start + slutt (TIMESTAMPTZ for TZ-korrekt UI-formatering).
  -- `status='active'` => vinduet regnes som i kraft nå (matcher legacy
  -- `Sys.Setting.maintenance.status = 'active'` runtime-toggle).
  maintenance_start   TIMESTAMPTZ NOT NULL,
  maintenance_end     TIMESTAMPTZ NOT NULL,
  message             TEXT NOT NULL DEFAULT 'Systemet er under vedlikehold.',
  -- Minutter før start hvor banner skal vises. Matcher legacy
  -- showBeforeMinutes.
  show_before_minutes INTEGER NOT NULL DEFAULT 60 CHECK (show_before_minutes >= 0),
  status              TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('active', 'inactive')),
  created_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at        TIMESTAMPTZ NULL,
  deactivated_at      TIMESTAMPTZ NULL,
  CHECK (maintenance_end >= maintenance_start)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_maintenance_windows') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_maintenance_windows_status
  ON app_maintenance_windows(status) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_maintenance_windows';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_maintenance_windows') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_maintenance_windows_start
  ON app_maintenance_windows(maintenance_start DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_maintenance_windows';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_maintenance_windows') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_maintenance_windows IS
  'BIN-677: planlagte maintenance-vinduer. En rad per vindu; historikk beholdes. Kun ett samtidig aktivt vindu (håndheves i MaintenanceService).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_maintenance_windows' AND column_name='status') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_maintenance_windows.status IS
  'BIN-677: ''active'' = vinduet er i kraft NÅ; ''inactive'' = planlagt/avsluttet. Toggles via PUT /api/admin/maintenance/:id.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_maintenance_windows.status';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_maintenance_windows' AND column_name='show_before_minutes') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_maintenance_windows.show_before_minutes IS
  'BIN-677: minutter før maintenance_start hvor UI skal vise banner. Matches legacy showBeforeMinutes.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_maintenance_windows.show_before_minutes';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000500_system_settings_maintenance', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000500_system_settings_maintenance');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260425000600_mini_games_config
-- Class: APPLIED-OUT-OF-BAND
-- Reason: all 2 effects present (after variant resolution)
-- ──────────────────────────────────────────────────────────────────────────────
-- All effects already in prod. Just record as applied.
INSERT INTO pgmigrations (name, run_on)
  SELECT '20260425000600_mini_games_config', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260425000600_mini_games_config');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260426000200_cms
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
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

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_content') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_cms_content IS
  'BIN-676: tekst-CRUD for statiske sider (aboutus/terms/support/links/responsible-gaming). Slug-whitelisted i CmsService.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_cms_content' AND column_name='slug') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_cms_content.slug IS
  'BIN-676: stabil slug. Gyldige verdier håndheves i service-laget.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_cms_content.slug';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_cms_content' AND column_name='content') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_cms_content.content IS
  'BIN-676: rå tekst-innhold (HTML/markdown). Ingen strukturell validering.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_cms_content.content';
  END IF;
END $sync$;

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

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_faq') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_cms_faq_sort_order
  ON app_cms_faq(sort_order ASC, created_at ASC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_cms_faq';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_faq') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_cms_faq IS
  'BIN-676: FAQ-liste (Q&A). En rad per spørsmål; sort_order styrer admin-bestemt rekkefølge.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_cms_faq' AND column_name='sort_order') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_cms_faq.sort_order IS
  'BIN-676: stigende sort-order (lavere vises først). Erstatter legacy `queId`-string.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_cms_faq.sort_order';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260426000200_cms', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260426000200_cms');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260427000000_physical_ticket_cashouts
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-640: single-ticket cashout for fysiske papirbilletter.
--
-- Admin-endepunkt `POST /api/admin/physical-tickets/:uniqueId/cashout`
-- registrerer en utbetaling (cashout) for én fysisk billett som har
-- vunnet. Én rad per utbetalt billett; UNIQUE(ticket_unique_id) gir
-- idempotens-garanti (forsøk nr. 2 returnerer ALREADY_CASHED_OUT).
--
-- Mønsteret bevisst atskilt fra:
--   - `app_agent_transactions` (krever active shift, agent-initiert)
--   - `app_hall_cash_transactions` (agent-shift-delta-oppgjør)
--
-- Cashout her er admin/hall-operator-initiert; selve kontant-flyten
-- fra hall til spiller håndteres regnskapsmessig av close-day (samme
-- modell som andre fysisk-papir-betalinger registreres via audit-log).
--
-- Norsk pengespillforskriften §64: mutasjoner på regulatorisk sporbar
-- data må logges i `app_audit_log` — det gjøres i service-laget via
-- AuditLogService.record({ action: 'admin.physical_ticket.cashout' }).
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_physical_ticket_cashouts (
  id                  TEXT PRIMARY KEY,
  ticket_unique_id    TEXT NOT NULL UNIQUE,
  hall_id             TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  game_id             TEXT NULL,
  payout_cents        BIGINT NOT NULL CHECK (payout_cents > 0),
  paid_by             TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  paid_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes               TEXT NULL,
  other_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (ticket_unique_id) REFERENCES app_physical_tickets(unique_id) ON DELETE RESTRICT
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_cashouts') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_physical_ticket_cashouts_hall_paid_at
  ON app_physical_ticket_cashouts(hall_id, paid_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_physical_ticket_cashouts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_cashouts') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_physical_ticket_cashouts_game
  ON app_physical_ticket_cashouts(game_id, paid_at DESC)
  WHERE game_id IS NOT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_physical_ticket_cashouts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_cashouts') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_physical_ticket_cashouts IS
  'BIN-640: én rad per cashout av fysisk papirbillett. UNIQUE(ticket_unique_id) => idempotens.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_cashouts' AND column_name='payout_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_cashouts.payout_cents IS
  'Utbetalt beløp i cents (øre). Bestemmes av agent/admin via check-bingo (BIN-641) forut for cashout.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_cashouts.payout_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_cashouts' AND column_name='paid_by') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_cashouts.paid_by IS
  'admin/hall-operator som registrerte utbetalingen. FK til app_users.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_cashouts.paid_by';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260427000000_physical_ticket_cashouts', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260427000000_physical_ticket_cashouts');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260427000100_physical_ticket_win_data
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-698: win-data schema for fysiske papirbilletter.
--
-- Prerequisite for BIN-639 (reward-all): for at admin-UI skal kunne
-- finne alle vinnende, ikke-utbetalte billetter for et spill, må
-- vinn-data persisteres på selve billett-raden. BIN-641-endepunktet
-- (`POST /api/admin/physical-tickets/:uniqueId/check-bingo`) sjekker i
-- dag read-only mot game-state + papir-innsendte tall; denne migrasjonen
-- legger til kolonner slik at første check-bingo stemples permanent.
--
-- Idempotens-regel: etter første stamping er `numbers_json` immutable.
-- Påfølgende BIN-641-kall må verifisere at klientens numbers[] matcher
-- den stemplede verdien (NUMBERS_MISMATCH ved avvik — svindel-sikring).
--
-- `won_amount_cents` er NULL til BIN-639 (reward-all) distribuerer
-- beløpet; PR-beslutning 2026-04-20: BIN-641 stamper IKKE beløp, kun
-- numbers + pattern. BIN-639 krever eksplisitt amountCents fra admin-UI
-- per billett for å unngå duplikasjon av game-prize-lookup-logikk.
--
-- Partial index `idx_app_physical_tickets_undistributed_winners` gir
-- BIN-639-query (won_amount_cents > 0 AND !distributed) en dedikert
-- hurtig path for hall-operator-UI.
--
-- Norsk pengespillforskriften §64: vinn-data er regulatorisk sporbar;

-- derfor `evaluated_at` + `winning_distributed_at` timestamper, begge
-- uendret etter skriving. Audit-log blir skrevet av BIN-639-PR 2 ved
-- distribusjon; BIN-641-stamping forblir uten audit-log (idempotent
-- check-op, samme user-perspektiv som dagens read-only).
--
-- Forward-only per BIN-661.
--
-- Up migration

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_tickets') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_tickets
  ADD COLUMN IF NOT EXISTS numbers_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS pattern_won TEXT NULL,
  ADD COLUMN IF NOT EXISTS won_amount_cents BIGINT NULL,
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS is_winning_distributed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS winning_distributed_at TIMESTAMPTZ NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_tickets';
  END IF;
END $sync$;

-- CHECK-constraint på pattern_won — kun de 5 lovlige Bingo75-mønstrene.
-- NULL tillates (billett ikke evaluert enda, eller tapende etter eval
-- hvis vi velger å lagre null-pattern).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_tickets') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_tickets
  DROP CONSTRAINT IF EXISTS app_physical_tickets_pattern_won_check $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_tickets';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_tickets') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_tickets
  ADD CONSTRAINT app_physical_tickets_pattern_won_check
    CHECK (pattern_won IS NULL OR pattern_won IN ('row_1','row_2','row_3','row_4','full_house')) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_tickets';
  END IF;
END $sync$;

-- CHECK-constraint på won_amount_cents — må være ikke-negativ når satt.
-- 0 = checked-ikke-vunnet (eksplisitt null-sum). NULL = ikke evaluert.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_tickets') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_tickets
  DROP CONSTRAINT IF EXISTS app_physical_tickets_won_amount_cents_check $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_tickets';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_tickets') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_tickets
  ADD CONSTRAINT app_physical_tickets_won_amount_cents_check
    CHECK (won_amount_cents IS NULL OR won_amount_cents >= 0) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_tickets';
  END IF;
END $sync$;

-- Partial index for BIN-639 reward-all query:
--   "Finn alle SOLD billetter i et game med vunnet-men-ikke-utbetalt."
-- Scopet til (assigned_game_id) fordi BIN-639-UI iterer per game.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_tickets') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_physical_tickets_undistributed_winners
  ON app_physical_tickets(assigned_game_id)
  WHERE won_amount_cents > 0 AND is_winning_distributed = false $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_physical_tickets';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_tickets' AND column_name='numbers_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_tickets.numbers_json IS
  'BIN-698: 25 tall i row-major-rekkefølge (5×5 grid, index 12 = free-centre = 0). Stemplet ved første BIN-641 check-bingo; immutable etter dette.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_tickets.numbers_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_tickets' AND column_name='pattern_won') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_tickets.pattern_won IS
  'BIN-698: høyeste vinnende mønster stemplet av BIN-641. NULL = ikke evaluert eller tapte.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_tickets.pattern_won';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_tickets' AND column_name='won_amount_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_tickets.won_amount_cents IS
  'BIN-698: beregnet payout i cents. NULL i BIN-641 (ikke kalkulert); BIN-639 setter verdi ved distribusjon.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_tickets.won_amount_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_tickets' AND column_name='evaluated_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_tickets.evaluated_at IS
  'BIN-698: tidspunkt for første BIN-641-stamping. NULL før første check-bingo.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_tickets.evaluated_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_tickets' AND column_name='is_winning_distributed') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_tickets.is_winning_distributed IS
  'BIN-698: idempotens-flagg for BIN-639 reward-all. false = ikke utbetalt, true = distribuert.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_tickets.is_winning_distributed';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_tickets' AND column_name='winning_distributed_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_tickets.winning_distributed_at IS
  'BIN-698: tidspunkt BIN-639 distribuerte premien. NULL før distribusjon.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_tickets.winning_distributed_at';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260427000100_physical_ticket_win_data', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260427000100_physical_ticket_win_data');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260428000000_game1_scheduled_games
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 1: app_game1_scheduled_games (game-instanser spawned fra daily_schedules).
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.1
--
-- Formål: én rad per spawned Game 1-instans. Scheduler-ticken (15s) gjør
-- forward-spawn 24t frem fra daily_schedules × schedule-mal × subGames × weekdays.
-- Tabellen er kilden til sannhet for kommende, pågående og avsluttede
-- Game 1-instanser. Runtime-state (balls, winners, purchases) holdes
-- fremdeles i BingoEngine + game_sessions; denne tabellen holder
-- plan-snapshot + state-maskin (scheduled → purchase_open → ready_to_start →
-- running → paused → completed | cancelled).
--
-- Designvalg:
--   * `schedule_id` REFERENCES app_schedules(id): snapshot av schedule-mal
--     som ble brukt da raden ble spawned. Nødvendig for audit og for å
--     reproducer oppstart-config selv om malen senere endres.
--   * `daily_schedule_id` REFERENCES app_daily_schedules(id): link tilbake
--     til plan-instansen som trigget spawn.
--   * `sub_game_index` INT + `sub_game_name` TEXT: index i schedule.subGames[]
--     + denormalisert navn for rapporter.
--   * `notification_start_seconds` INTEGER: **normalisert fra "5m"/"60s"** —
--     lagret som sekunder, ikke string. Spec-avgjørelse: bedre typesikkerhet
--     enn rå string, forenkler countdown-logikk senere.
--   * `ticket_config_json` + `jackpot_config_json` (JSONB): snapshot av
--     schedule.subGame.ticketTypesData og jackpotData. Snapshot-pattern
--     beskytter mot mal-endringer midt i plan-perioden.
--   * `game_mode` TEXT: 'Auto' eller 'Manual' — arvet fra schedule.scheduleType.
--   * `master_hall_id` + `group_hall_id`: fra daily_schedule.hallIds. Master-hall
--     er bindet til daily_schedule (legacy pattern).
--   * `participating_halls_json` JSONB: array av hall-IDer. Snapshot av
--     daily_schedule.hallIds.hallIds + hall-group-members på spawn-tidspunkt.
--   * `status` TEXT: state-maskin med CHECK constraint. Initial: 'scheduled'.
--   * `actual_start_time` / `actual_end_time`: faktiske klokkeslett
--     (master-trykk + engine-finish). NULL frem til de skjer.
--   * `started_by_user_id` / `stopped_by_user_id`: audit. Ikke FK fordi
--     user-sletting ikke skal fjerne historikk.
--   * `excluded_hall_ids_json`: haller master har ekskludert (tekniske
--     problemer). Tom ved spawn.
--   * `stop_reason`: 'master_stop' | 'end_of_day_unreached' | …
--
-- Indexer:
--   * (status, scheduled_start_time): scheduler-tick-query "kommende
--     aktiviteter" og "utløpte scheduled"-queries.
--   * (group_hall_id, scheduled_day): admin-UI dagsoversikt per link.
--
-- UNIQUE-constraint: (daily_schedule_id, scheduled_day, sub_game_index)
--   hindrer dobbel-spawn når scheduler kjører raskt eller crash-resumes.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_scheduled_games (
  id                        TEXT PRIMARY KEY,
  daily_schedule_id         TEXT NOT NULL
                              REFERENCES app_daily_schedules(id) ON DELETE CASCADE,
  schedule_id               TEXT NOT NULL
                              REFERENCES app_schedules(id) ON DELETE RESTRICT,
  -- Index i schedule.subGames[] (0-basert) + denormalisert navn.
  sub_game_index            INTEGER NOT NULL CHECK (sub_game_index >= 0),
  sub_game_name             TEXT NOT NULL,
  custom_game_name          TEXT NULL,
  -- Datoen raden gjelder (DATE, ikke timestamp — 24t-vinduet avgjøres av
  -- scheduled_start_time/scheduled_end_time).
  scheduled_day             DATE NOT NULL,
  scheduled_start_time      TIMESTAMPTZ NOT NULL,
  scheduled_end_time        TIMESTAMPTZ NOT NULL,
  -- Normalisert til sekunder (INT). Legacy "5m"/"60s" konverteres i service.
  notification_start_seconds INTEGER NOT NULL
                              CHECK (notification_start_seconds >= 0),
  -- Snapshot av schedule.subGame.ticketTypesData (farger, priser, prizes).
  ticket_config_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Snapshot av schedule.subGame.jackpotData (white/yellow/purple + draw).
  jackpot_config_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 'Auto' = tick-based progression; 'Manual' = master trykker start.
  game_mode                 TEXT NOT NULL CHECK (game_mode IN ('Auto','Manual')),
  -- Master-hall: linkens master (bingovert-rollen aktiveres der).
  master_hall_id            TEXT NOT NULL
                              REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Hall-gruppe som raden hører til (link-ID).
  group_hall_id             TEXT NOT NULL
                              REFERENCES app_hall_groups(id) ON DELETE RESTRICT,
  -- Snapshot av deltagende haller. Array av hall-IDer.
  participating_halls_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- State-maskin: scheduled → purchase_open → ready_to_start → running
  --               → paused → completed | cancelled.
  status                    TEXT NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN (
                                'scheduled',
                                'purchase_open',
                                'ready_to_start',
                                'running',
                                'paused',
                                'completed',
                                'cancelled'
                              )),
  actual_start_time         TIMESTAMPTZ NULL,
  actual_end_time           TIMESTAMPTZ NULL,
  started_by_user_id        TEXT NULL,
  -- Haller master har ekskludert etter ready-tick (tekniske feil).
  excluded_hall_ids_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  stopped_by_user_id        TEXT NULL,
  stop_reason               TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Forhindre dobbel-spawn når scheduler kjører raskt eller ved crash-resume.
  CONSTRAINT uq_game1_sched_daily_day_sub UNIQUE
    (daily_schedule_id, scheduled_day, sub_game_index)
);

-- Tick-query: "hvilke rader skal bytte status nå?" filtrerer på status +
-- scheduled_start_time. Trunk composite-indeks dekker begge søk-mønstre.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_scheduled_games') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_sched_status_start
  ON app_game1_scheduled_games(status, scheduled_start_time) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_scheduled_games';
  END IF;
END $sync$;

-- Dagsoversikt per link (admin-UI + bingovert-UI).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_scheduled_games') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_sched_group_day
  ON app_game1_scheduled_games(group_hall_id, scheduled_day) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_scheduled_games';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_scheduled_games') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_scheduled_games IS
  'GAME1_SCHEDULE PR1: én rad per spawned Game 1-instans. Scheduler-ticken spawner 24t frem fra app_daily_schedules. Kilden til sannhet for kommende/pågående spill.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_scheduled_games' AND column_name='notification_start_seconds') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_scheduled_games.notification_start_seconds IS
  'GAME1_SCHEDULE PR1: notifikasjonsstart i sekunder (normalisert fra legacy "5m"/"60s"-strenger i schedule.subGame.notificationStartTime).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_scheduled_games.notification_start_seconds';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_scheduled_games' AND column_name='ticket_config_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_scheduled_games.ticket_config_json IS
  'GAME1_SCHEDULE PR1: snapshot av schedule.subGame.ticketTypesData på spawn-tidspunkt — ticket-farger, priser, prizes. Snapshot beskytter mot mal-endringer.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_scheduled_games.ticket_config_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_scheduled_games' AND column_name='jackpot_config_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_scheduled_games.jackpot_config_json IS
  'GAME1_SCHEDULE PR1: snapshot av schedule.subGame.jackpotData — { jackpotPrize: { white, yellow, purple }, jackpotDraw }.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_scheduled_games.jackpot_config_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_scheduled_games' AND column_name='status') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_scheduled_games.status IS
  'GAME1_SCHEDULE PR1: state-maskin scheduled → purchase_open → ready_to_start → running → paused → completed | cancelled.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_scheduled_games.status';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260428000000_game1_scheduled_games', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260428000000_game1_scheduled_games');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260428000100_game1_hall_ready_status
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 2: app_game1_hall_ready_status (per-hall ready-flagg + sales-snapshot).
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.2 + §3.4.
--
-- Formål: hver participating hall for et spawned Game 1-spill får en rad.
-- Bingovert-en i hallen trykker "klar" → is_ready=true, ready_at=NOW(),
-- digital_tickets_sold + physical_tickets_sold snapshot fra salgstall. Når
-- alle non-excluded haller er klare, flipper scheduler-tick spillets status
-- fra 'purchase_open' → 'ready_to_start'. Master-UI ser grønn/rød per hall
-- via socket-event `game1:ready-status-update`.
--
-- PK (game_id, hall_id) gjør UPSERT-flyten trivielt idempotent — bingovert
-- kan trykke klar → angre → klar igjen uten dobbelt-rad.
--
-- Designvalg:
--   * `game_id` FK → app_game1_scheduled_games(id) med ON DELETE CASCADE,
--     slik at sletting av et game-row (cancelled end-of-day, cleanup) rydder
--     opp ready-status-rader.
--   * `hall_id` FK → app_halls(id) med ON DELETE RESTRICT — vi vil ikke
--     miste audit-koblingen om en hall slettes midt i en plan.
--   * `is_ready` + `ready_at` + `ready_by_user_id` — bingovert-signalet.
--     ready_by_user_id er IKKE FK fordi user-sletting ikke skal fjerne
--     historikk (matcher mønsteret i app_game1_scheduled_games).
--   * `digital_tickets_sold` / `physical_tickets_sold` — INT snapshot på
--     ready-trykk-tidspunktet. Senere viser master-UI dette i live-view.
--     Default 0 (rad opprettes på første ready-trykk; evt seed-pre-create
--     er opt-in i service-laget).
--   * `excluded_from_game` + `excluded_reason` — master ekskluderer hall
--     (teknisk feil). `allParticipatingHallsReady` teller kun non-excluded.
--
-- Indexer:
--   * (game_id, is_ready) for "er alle klare?"-sjekk (hyppig query i
--     scheduler-tick + master-UI).
--   * (hall_id, is_ready) for per-hall dashboards og audit.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_hall_ready_status (
  game_id                  TEXT NOT NULL
                             REFERENCES app_game1_scheduled_games(id) ON DELETE CASCADE,
  hall_id                  TEXT NOT NULL
                             REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Ready-signal fra bingovert.
  is_ready                 BOOLEAN NOT NULL DEFAULT false,
  ready_at                 TIMESTAMPTZ NULL,
  -- Audit: userId til bingovert som trykket klar. Ikke FK — bevares ved user-delete.
  ready_by_user_id         TEXT NULL,
  -- Snapshot av salgstall på ready-trykk-tidspunktet.
  digital_tickets_sold     INTEGER NOT NULL DEFAULT 0
                             CHECK (digital_tickets_sold >= 0),
  physical_tickets_sold    INTEGER NOT NULL DEFAULT 0
                             CHECK (physical_tickets_sold >= 0),
  -- Master-ekskludering (teknisk feil i hall; teller ikke i allReady).
  excluded_from_game       BOOLEAN NOT NULL DEFAULT false,
  excluded_reason          TEXT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, hall_id)
);

-- "Er alle klare?"-query i scheduler-tick (transitionReadyToStartGames).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_hall_ready_status') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_hall_ready_game_ready
  ON app_game1_hall_ready_status(game_id, is_ready) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_hall_ready_status';
  END IF;
END $sync$;

-- Per-hall dashboards + audit ("hvor mange ganger har denne hallen vært klar?").
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_hall_ready_status') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_hall_ready_hall_ready
  ON app_game1_hall_ready_status(hall_id, is_ready) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_hall_ready_status';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_hall_ready_status') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_hall_ready_status IS
  'GAME1_SCHEDULE PR2: per-hall ready-flagg + sales-snapshot per spawned Game 1-spill. Bingovert trykker klar → UPSERT is_ready=true + snapshot.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_hall_ready_status' AND column_name='digital_tickets_sold') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_hall_ready_status.digital_tickets_sold IS
  'GAME1_SCHEDULE PR2: antall solgte digitale billetter per hall på ready-trykk-tidspunktet (snapshot, ikke live).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_hall_ready_status.digital_tickets_sold';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_hall_ready_status' AND column_name='physical_tickets_sold') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_hall_ready_status.physical_tickets_sold IS
  'GAME1_SCHEDULE PR2: antall solgte fysiske billetter per hall på ready-trykk-tidspunktet (snapshot, ikke live).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_hall_ready_status.physical_tickets_sold';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_hall_ready_status' AND column_name='excluded_from_game') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_hall_ready_status.excluded_from_game IS
  'GAME1_SCHEDULE PR2: master har ekskludert denne hallen (teknisk feil). allParticipatingHallsReady teller kun non-excluded rader.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_hall_ready_status.excluded_from_game';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260428000100_game1_hall_ready_status', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260428000100_game1_hall_ready_status');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260428000200_game1_master_audit
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 3: app_game1_master_audit (master-control audit-trail).
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.3 + §3.9.
--
-- Formål: regulatorisk append-only audit-logg for alle master-actions i et
-- Game 1-spill (start / pause / resume / stop / exclude_hall / include_hall /
-- timeout_detected). Snapshot av halls-ready-status per action legges direkte
-- i raden så compliance kan rekonstruere "hvem var klar, hvem var ekskludert"
-- på action-tidspunktet uten å måtte korrelere med app_game1_hall_ready_status
-- (som er muterbar tabell).
--
-- Forskjell fra app_audit_log (BIN-588): sentralisert audit-service har
-- fire-and-forget semantikk og normalisert skjema for alle admin-actions.
-- Denne tabellen er game1-master-spesifikk med et STERKERE append-only-
-- krav (regulatorisk §11) og et snapshot-kolonne vi eier selv for at
-- compliance-rapporter skal være reproducerbare.
--
-- Designvalg:
--   * `id` TEXT PRIMARY KEY (uuid/nanoid fra service-laget).
--   * `game_id` FK → app_game1_scheduled_games(id) med ON DELETE RESTRICT.
--     Vi slettet eksplisitt aldri game-rader i produksjon, men RESTRICT
--     sikrer at audit-trailen overlever eventuell feil-opprydding.
--   * `action` CHECK-constraint — whitelist: {start, pause, resume, stop,
--     exclude_hall, include_hall, timeout_detected}. timeout_detected er
--     system-generert fra scheduler-tick (ikke en master-action).
--   * `actor_user_id` TEXT — bevares ved user-slett (IKKE FK, matcher mønster
--     i app_game1_scheduled_games.started_by_user_id).
--   * `actor_hall_id` TEXT NOT NULL — hallen actor jobber fra. Ikke FK fordi
--     vi vil bevare audit selv om hall slettes.
--   * `group_hall_id` TEXT NOT NULL — link-ID, kopiert fra
--     app_game1_scheduled_games.group_hall_id på action-tidspunkt. Kopi
--     forhindrer join for hyppige rapporter.
--   * `halls_ready_snapshot` JSONB — map hallId → { isReady, excluded }
--     på action-tidspunkt. Lagret som snapshot så rapporten er stabil
--     selv om hall_ready_status-rader senere endres.
--   * `metadata_json` JSONB DEFAULT '{}' — action-spesifikk data
--     (reason, excluded hallId, pause message, etc).
--   * `created_at` TIMESTAMPTZ DEFAULT NOW() — immutable append-time.
--
-- Indexer:
--   * (game_id, created_at) — spill-historikk i tidsrekkefølge.
--   * (actor_user_id, created_at) — "hva har denne brukeren gjort?"
--   * (action, created_at) — globale rapporter ("alle stops siste 30d").
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_master_audit (
  id                     TEXT PRIMARY KEY,
  game_id                TEXT NOT NULL
                           REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  action                 TEXT NOT NULL CHECK (action IN (
                             'start',
                             'pause',
                             'resume',
                             'stop',
                             'exclude_hall',
                             'include_hall',
                             'timeout_detected'
                           )),
  actor_user_id          TEXT NOT NULL,
  actor_hall_id          TEXT NOT NULL,
  group_hall_id          TEXT NOT NULL,
  halls_ready_snapshot   JSONB NOT NULL,
  metadata_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_audit') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_master_audit_game_created
  ON app_game1_master_audit(game_id, created_at) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_master_audit';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_audit') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_master_audit_actor_created
  ON app_game1_master_audit(actor_user_id, created_at) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_master_audit';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_audit') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_master_audit_action_created
  ON app_game1_master_audit(action, created_at) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_master_audit';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_audit') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_master_audit IS
  'GAME1_SCHEDULE PR3: append-only audit-trail for master-control-actions i Game 1 (start/pause/resume/stop/exclude_hall/include_hall/timeout_detected). Regulatorisk §11.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_master_audit' AND column_name='halls_ready_snapshot') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_master_audit.halls_ready_snapshot IS
  'GAME1_SCHEDULE PR3: snapshot av halls-ready-status på action-tidspunkt — map hallId → { isReady, excluded }. Sikrer rapporter er stabile selv om ready-status muteres senere.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_master_audit.halls_ready_snapshot';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_master_audit' AND column_name='metadata_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_master_audit.metadata_json IS
  'GAME1_SCHEDULE PR3: action-spesifikk metadata — reason, excludedHallId, pauseMessage, stopReason, confirmExcludedHalls osv.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_master_audit.metadata_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_master_audit' AND column_name='actor_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_master_audit.actor_user_id IS
  'GAME1_SCHEDULE PR3: userId til actor. Ikke FK — bevares ved user-slett (audit-trail-krav).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_master_audit.actor_user_id';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260428000200_game1_master_audit', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260428000200_game1_master_audit');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260429000000_loyalty
-- Class: APPLIED-OUT-OF-BAND
-- Reason: all 10 effects present (after variant resolution)
-- ──────────────────────────────────────────────────────────────────────────────
-- All effects already in prod. Just record as applied.
INSERT INTO pgmigrations (name, run_on)
  SELECT '20260429000000_loyalty', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260429000000_loyalty');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260429000100_drop_hall_client_variant
-- Class: NOT-APPLIED
-- Reason: DROP COLUMN pending: app_halls.client_variant
-- ──────────────────────────────────────────────────────────────────────────────
-- Drop the `app_halls.client_variant` rollback-flag column.
--
-- Historikk: BIN-540 (20260418090000_add_hall_client_variant.sql) innførte
-- et per-hall flagg som kunne vippes mellom 'unity' | 'web' | 'unity-fallback'
-- for å rulle tilbake Unity-stacken hall-for-hall i piloten. Unity er nå
-- fullstendig fjernet fra systemet (2026-04-21) og flagget er dekodet i
-- applikasjonslaget (`PlatformService.getHallClientVariant` returnerer
-- alltid "web"). Kolonnen er dermed dødvekt og kan droppes.
--
-- Rekkefølge på drop: CHECK-constraint først (Postgres kobler den til
-- kolonnen via auto-navn <table>_<col>_check), så selve kolonnen.
-- NOT EXISTS-guards gjør migrasjonen idempotent mot miljøer som allerede
-- kan ha droppet noe av dette manuelt.

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_halls') THEN
    EXECUTE $stmt$ ALTER TABLE app_halls
  DROP CONSTRAINT IF EXISTS app_halls_client_variant_check $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_halls';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_halls') THEN
    EXECUTE $stmt$ ALTER TABLE app_halls
  DROP COLUMN IF EXISTS client_variant $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_halls';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260429000100_drop_hall_client_variant', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260429000100_drop_hall_client_variant');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260430000000_app_game1_ticket_purchases
-- Class: NOT-APPLIED
-- Reason: 5 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 4a: app_game1_ticket_purchases — ticket-purchase-foundation.
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §4a.
--
-- Formål: én rad = én purchase-transaksjon (atomisk — en kjøper kan ha flere
-- billetter i én purchase). Tabellen er *felles grunnmur* for Game 1:
-- uansett om draw-engine bygges som Alt 1 eller Alt 3, trenger vi å vite
-- hvem som har kjøpt hvilke billetter til hvilket scheduled_game, når, og
-- i hvilken hall. Tabellen er kilden til sannhet for sales-tracking, audit
-- og refund-flyten.
--
-- Designvalg:
--   * `scheduled_game_id` FK → app_game1_scheduled_games(id) med ON DELETE
--     RESTRICT — purchase-historikk skal bevares selv om et scheduled game
--     slettes (BIN-661 forward-only semantikk + pengeflyt-audit).
--   * `buyer_user_id` FK → app_users(id) med ON DELETE RESTRICT — vi vil
--     ikke miste purchase-koblingen om en user slettes midt i plan.
--   * `hall_id` FK → app_halls(id) ON DELETE RESTRICT — hallen spilleren sto
--     i da kjøpet ble gjort. Viktig for hall-limits og Spillvett-rapporter.
--     Ikke avledet fra buyer.home_hall — spillere kan spille i flere haller.
--   * `ticket_spec_json` JSONB: array av { color, size, count, price_cents_each }.
--     Eksempel: [{"color":"yellow","size":"small","count":3,"price_cents_each":2000}].
--     Denormalisert snapshot av ticket-konfig på kjøp-tidspunktet (priser
--     valideres mot scheduled_games.ticket_config_json i service-laget).
--   * `total_amount_cents` BIGINT: Σ(count * price_cents_each) på kjøp-tidspunktet.
--     CHECK >= 0 (gratisbilletter støttes i teorien; service-laget avgjør policy).
--   * `payment_method` TEXT CHECK IN (…): 3 modi.
--       - 'digital_wallet' — kjøp fra egen spillerkonto (walletAdapter.debit).
--       - 'cash_agent'     — kontant via agent (ingen wallet-flyt).
--       - 'card_agent'     — kort via agent (ingen wallet-flyt).
--   * `agent_user_id` FK → app_users(id) ON DELETE SET NULL: kreves hvis
--     payment_method er agent-basert. Enforcet i service-laget fordi DB
--     CHECK ikke kan kombinere NULL-semantikk på tvers av kolonner rent.
--   * `idempotency_key` TEXT + UNIQUE: safe retry. Samme nøkkel → samme
--     purchase (idempotent hit returneres uten ny debit). Nøkkel format:
--     "game1-purchase:{scheduled_game_id}:{buyer_user_id}:{clientRequestId}".
--   * `refund_*`-felter: NULL frem til refund skjer. `refund_transaction_id`
--     peker til wallet-tx-ID ved digital_wallet refund, eller er NULL for
--     agent-refunds (håndteres fysisk, kun logg + audit).
--
-- Indexer:
--   * scheduled_game_id — per-spill sales queries + hall ready-snapshot.
--   * buyer_user_id — "mine billetter for dette spillet".
--   * hall_id — hall-lokal sales + Spillvett-rapport.
--   * partial (scheduled_game_id) WHERE refunded_at IS NULL — refundable
--     lookup brukes i refund-flyten og ved draw-engine-ticket-enumeration.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_ticket_purchases (
  id                        TEXT PRIMARY KEY,
  scheduled_game_id         TEXT NOT NULL
                              REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  buyer_user_id             TEXT NOT NULL
                              REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id                   TEXT NOT NULL
                              REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Array av { color, size, count, price_cents_each }. Snapshot av priser
  -- ved kjøp — service-laget validerer mot scheduled_games.ticket_config_json.
  ticket_spec_json          JSONB NOT NULL,
  total_amount_cents        BIGINT NOT NULL
                              CHECK (total_amount_cents >= 0),
  payment_method            TEXT NOT NULL
                              CHECK (payment_method IN (
                                'digital_wallet',
                                'cash_agent',
                                'card_agent'
                              )),
  -- Må være satt hvis payment_method er agent-basert (enforcet i service).
  agent_user_id             TEXT NULL
                              REFERENCES app_users(id) ON DELETE SET NULL,
  -- Idempotency for safe retry. Samme key → returner eksisterende rad
  -- uten ny wallet-debit (alreadyExisted: true).
  idempotency_key           TEXT NOT NULL,
  purchased_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Refund-state: NULL = ikke refundert. Settes ved refundPurchase().
  refunded_at               TIMESTAMPTZ NULL,
  refund_reason             TEXT NULL,
  refunded_by_user_id       TEXT NULL
                              REFERENCES app_users(id) ON DELETE SET NULL,
  -- wallet-tx-ID for digital_wallet-refund; NULL for agent-cash/card
  -- (håndteres fysisk, kun audit-log spor).
  refund_transaction_id     TEXT NULL,
  UNIQUE (idempotency_key)
);

-- Per-spill sales-listing (scheduler-tick, draw-engine-ticket-enumeration).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_purchases') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_purchases_scheduled_game
  ON app_game1_ticket_purchases(scheduled_game_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_ticket_purchases';
  END IF;
END $sync$;

-- "Mine billetter for dette spillet" + buyer-history.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_purchases') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_purchases_buyer
  ON app_game1_ticket_purchases(buyer_user_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_ticket_purchases';
  END IF;
END $sync$;

-- Hall-lokal sales-rapport + Spillvett-limit-sjekk per hall.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_purchases') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_purchases_hall
  ON app_game1_ticket_purchases(hall_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_ticket_purchases';
  END IF;
END $sync$;

-- Refundable lookup: ikke-refunderte rader per scheduled_game. Brukt av
-- refund-flyten og ved draw-engine-billett-enumerering i PR 4b.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_purchases') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_purchases_refundable
  ON app_game1_ticket_purchases(scheduled_game_id)
  WHERE refunded_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_ticket_purchases';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_purchases') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_ticket_purchases IS
  'GAME1_SCHEDULE PR4a: én rad per purchase-transaksjon til et Game 1 scheduled_game. Felles grunnmur for draw-engine (PR 4b).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_ticket_purchases' AND column_name='ticket_spec_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_ticket_purchases.ticket_spec_json IS
  'GAME1_SCHEDULE PR4a: array [{color, size, count, price_cents_each}]. Snapshot av kjøp — validert mot scheduled_games.ticket_config_json i service-laget.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_ticket_purchases.ticket_spec_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_ticket_purchases' AND column_name='payment_method') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_ticket_purchases.payment_method IS
  'GAME1_SCHEDULE PR4a: digital_wallet (walletAdapter.debit), cash_agent (agent tar kontanter), card_agent (agent kjører kort).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_ticket_purchases.payment_method';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_ticket_purchases' AND column_name='idempotency_key') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_ticket_purchases.idempotency_key IS
  'GAME1_SCHEDULE PR4a: UNIQUE safe-retry-nøkkel. Samme verdi ved retry returnerer eksisterende purchase uten ny wallet-debit.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_ticket_purchases.idempotency_key';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_ticket_purchases' AND column_name='refund_transaction_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_ticket_purchases.refund_transaction_id IS
  'GAME1_SCHEDULE PR4a: wallet-tx-ID ved digital_wallet-refund. NULL for agent-payments (refund skjer fysisk, kun audit-logg).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_ticket_purchases.refund_transaction_id';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260430000000_app_game1_ticket_purchases', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260430000000_app_game1_ticket_purchases');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260430000100_physical_tickets_scheduled_game_fk
-- Class: NOT-APPLIED
-- Reason: 2 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 4a: physical_tickets.assigned_game_id → FK app_game1_scheduled_games(id).
--
-- Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §4a.
--
-- Bakgrunn: BIN-587 B4a la `assigned_game_id TEXT NULL` på app_physical_tickets
-- uten FK fordi det pekte til legacy room-id-strenger uten egen tabell.
-- GAME1_SCHEDULE PR 1 innførte app_game1_scheduled_games som første kanoniske
-- target. Denne migrasjonen linker kolonnen til den nye tabellen.
--
-- Designvalg:
--   * NOT VALID-constraint: vi validerer ikke eksisterende rader nå fordi
--     legacy kan ha andre ref-er (room-ID-strenger eller NULL) i disse
--     radene. Nye rader valideres mot constraintet fra denne migrasjonen
--     og fremover. En separat VALIDATE-migrasjon kjøres når legacy-data er
--     cleanup'et eller migrert (tracked som eget issue i PR 4b).
--   * ON DELETE SET NULL: hvis et scheduled_game slettes, mister vi bare
--     koblingen — billetten forblir i tabellen (forward-only BIN-661).
--     Matcher tidligere intensjon med assigned_game_id NULL = "ikke tildelt".
--   * Batches-tabellen har også `assigned_game_id TEXT NULL` — samme FK
--     legges på der, same NOT VALID-strategi.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_tickets') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_tickets
  ADD CONSTRAINT fk_physical_tickets_scheduled_game
  FOREIGN KEY (assigned_game_id)
  REFERENCES app_game1_scheduled_games(id)
  ON DELETE SET NULL
  NOT VALID $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_tickets';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_batches') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_ticket_batches
  ADD CONSTRAINT fk_physical_ticket_batches_scheduled_game
  FOREIGN KEY (assigned_game_id)
  REFERENCES app_game1_scheduled_games(id)
  ON DELETE SET NULL
  NOT VALID $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_ticket_batches';
  END IF;
END $sync$;

COMMENT ON CONSTRAINT fk_physical_tickets_scheduled_game
  ON app_physical_tickets IS
  'GAME1_SCHEDULE PR4a: FK til app_game1_scheduled_games. NOT VALID for å unngå validering av legacy rader; VALIDATE kjører i separat migrasjon når legacy er ryddet.';

COMMENT ON CONSTRAINT fk_physical_ticket_batches_scheduled_game
  ON app_physical_ticket_batches IS
  'GAME1_SCHEDULE PR4a: FK til app_game1_scheduled_games. NOT VALID for legacy-kompatibilitet; validering deferred.';

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260430000100_physical_tickets_scheduled_game_fk', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260430000100_physical_tickets_scheduled_game_fk');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260501000000_app_game1_ticket_assignments
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 4b: app_game1_ticket_assignments — én rad per fysisk-
-- digital billett assignet til spilleren ved start av scheduled_game.
--
-- Spec: GAME1_SCHEDULE PR 4b (draw-engine core, Alt 3 parallell draw-strøm).
--
-- Formål: grid-tall genereres ved game-start (ikke ved purchase — det er
-- legacy semantikk). Én rad per enkeltbillett som kjøpes gjennom en
-- purchase-spec; sequence_in_purchase nummererer billettene innenfor
-- samme purchase (1-indexed) for audit og for ticket-rendering.
--
-- Designvalg:
--   * scheduled_game_id FK → app_game1_scheduled_games(id) ON DELETE RESTRICT:
--     assignments skal bevares selv om planen endres (audit + payout).
--   * purchase_id FK → app_game1_ticket_purchases(id) ON DELETE RESTRICT:
--     kobling tilbake til purchase som genererte billetten.
--   * buyer_user_id / hall_id denormalisert for enkle queries uten JOIN.
--   * ticket_color TEXT: farge fra ticket_spec ("yellow", "white", "purple",
--     "red", "green", "orange", "elvis1"-"elvis5"). Brukes av UI-rendering.
--   * ticket_size TEXT CHECK IN ('small','large'): LEGACY PRISKATEGORI.
--     Påvirker kun pris-oppslag og UI-rendering — IKKE grid-format. Alle Spill
--     1-bretter er 5x5 (25 celler). Tobias' PM-avklaring 2026-04-21:
--     "5x5 er det eneste riktige formatet for Spill 1".
--   * grid_numbers_json JSONB: flat row-major array av 25 celler (5x5). Index
--     12 (row 2, col 2) = 0 (free centre, alltid markert). Øvrige celler er
--     tall fra 1..maxBallValue, fordelt proporsjonalt per kolonne (f.eks.
--     maxBallValue=75 → col 0=1..15, col 1=16..30, col 2=31..45, col 3=46..60,
--     col 4=61..75). `null` tillatt for padding hvis en kolonne ikke har nok
--     tall (sjelden — kun ved svært lav maxBallValue).
--   * markings_json JSONB: { "marked": [bool × 25] } matchende grid. Index 12
--     er alltid true (free centre). Oppdateres av drawNext() når trukket kule
--     matcher en ikke-0-celle.
--   * sequence_in_purchase INT: 1-indexed rekkefølge innenfor purchase.
--     UNIQUE(purchase_id, sequence_in_purchase) hindrer dobbel-generering.
--
-- Indexer:
--   * (scheduled_game_id): draw-engine enumererer alle assignments når kule
--     trekkes for å oppdatere markings.
--   * (buyer_user_id, scheduled_game_id): "mine brett" i spiller-UI.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_ticket_assignments (
  id                    TEXT PRIMARY KEY,
  scheduled_game_id     TEXT NOT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  purchase_id           TEXT NOT NULL
                          REFERENCES app_game1_ticket_purchases(id) ON DELETE RESTRICT,
  buyer_user_id         TEXT NOT NULL
                          REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id               TEXT NOT NULL
                          REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Farge fra ticket_spec: "yellow" | "white" | "purple" | "red" | "green" |
  -- "orange" | "elvis1"-"elvis5".
  ticket_color          TEXT NOT NULL,
  ticket_size           TEXT NOT NULL
                          CHECK (ticket_size IN ('small','large')),
  -- Grid-tallene: 5x5 flat row-major array (25 celler). Index 12 = 0
  -- (free centre, alltid markert). ticket_size er LEGACY PRISKATEGORI og
  -- påvirker IKKE grid-format (Tobias' spec 2026-04-21).
  grid_numbers_json     JSONB NOT NULL,
  -- Rekkefølge-nummer innenfor samme purchase (1-indexed) for audit.
  sequence_in_purchase  INTEGER NOT NULL CHECK (sequence_in_purchase >= 1),
  -- Marking: hvilke grid-celler er markert (dekket av trukket kule).
  -- Format: { "marked": [bool, bool, ...] } matchende grid_numbers_json.length.
  markings_json         JSONB NOT NULL DEFAULT '{"marked":[]}'::jsonb,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, sequence_in_purchase)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_assignments') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_assignments_scheduled_game
  ON app_game1_ticket_assignments(scheduled_game_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_ticket_assignments';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_assignments') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_assignments_buyer
  ON app_game1_ticket_assignments(buyer_user_id, scheduled_game_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_ticket_assignments';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_ticket_assignments') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_ticket_assignments IS
  'GAME1_SCHEDULE PR4b: én rad per fysisk-digital billett for Game 1 scheduled_game. Grid-tall genereres ved startGame() i Game1DrawEngineService.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_ticket_assignments' AND column_name='grid_numbers_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_ticket_assignments.grid_numbers_json IS
  'GAME1_SCHEDULE PR4b/4c: flat row-major 5x5 (25 celler). Index 12 = 0 (free centre, alltid markert). Tall 1..maxBallValue fordelt proporsjonalt per kolonne (f.eks. maxBallValue=75 → col 0=1..15, col 4=61..75).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_ticket_assignments.grid_numbers_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_ticket_assignments' AND column_name='markings_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_ticket_assignments.markings_json IS
  'GAME1_SCHEDULE PR4b/4c: { "marked": [bool × 25] }. Index 12 (free centre) alltid true. Oppdateres av drawNext() når trukket kule matcher grid-celle.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_ticket_assignments.markings_json';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260501000000_app_game1_ticket_assignments', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260501000000_app_game1_ticket_assignments');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260501000100_app_game1_draws
-- Class: NOT-APPLIED
-- Reason: 2 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 4b: app_game1_draws — trukne kuler per scheduled_game.
--
-- Spec: GAME1_SCHEDULE PR 4b (draw-engine core, Alt 3 parallell draw-strøm).
--
-- Formål: append-only log av hver kule trukket i et Game 1 scheduled_game.
-- Én rad per trekning, med draw_sequence (1-indexed) + ball_value (1..75).
-- Brukes av:
--   * Admin-konsoll for å vise trekkingshistorikk + resume ved refresh.
--   * Spiller-UI for real-time display av trukne kuler (PR 4d).
--   * Pattern-evaluering (PR 4c) — leser alle draws i sekvens.
--
-- Designvalg:
--   * scheduled_game_id FK → app_game1_scheduled_games(id) ON DELETE RESTRICT:
--     trekke-historikk skal bevares (audit + regulatorisk krav).
--   * draw_sequence INT CHECK >= 1: 1-indexed rekkefølge. UNIQUE per spill
--     hindrer race-vinner-dupe.
--   * ball_value INT CHECK 1..75: kule-verdi. UNIQUE per spill hindrer at
--     samme kule trekkes to ganger (defensiv mot feil i draw-bag-logikk).
--   * current_phase_at_draw INT NULL CHECK 1..5: fase ved trekning.
--     NULL i PR 4b (fase-tracking er utsatt til PR 4c); default-fase 1.
--   * drawn_at TIMESTAMPTZ: trekne-tidspunkt for audit/replay.
--
-- Indexer:
--   * (scheduled_game_id, draw_sequence): ordered replay + resume-load.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_draws (
  id                    TEXT PRIMARY KEY,
  scheduled_game_id     TEXT NOT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Rekkefølge i trekkingen (1-indexed). UNIQUE per spill.
  draw_sequence         INTEGER NOT NULL CHECK (draw_sequence >= 1),
  ball_value            INTEGER NOT NULL
                          CHECK (ball_value >= 1 AND ball_value <= 75),
  drawn_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Fase ved trekning-øyeblikket (1..5). NULL inntil phase-tracking kobles i
  -- PR 4c.
  current_phase_at_draw INTEGER NULL
                          CHECK (current_phase_at_draw IS NULL OR
                                 (current_phase_at_draw >= 1 AND
                                  current_phase_at_draw <= 5)),
  UNIQUE (scheduled_game_id, draw_sequence),
  -- Samme kule kan ikke trekkes to ganger innen samme scheduled_game.
  UNIQUE (scheduled_game_id, ball_value)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_draws') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_draws_game_sequence
  ON app_game1_draws(scheduled_game_id, draw_sequence) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_draws';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_draws') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_draws IS
  'GAME1_SCHEDULE PR4b: append-only log av kuler trukket per Game 1 scheduled_game. Kilden til sannhet for trekkingshistorikk.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_draws' AND column_name='current_phase_at_draw') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_draws.current_phase_at_draw IS
  'GAME1_SCHEDULE PR4b: fase (1..5) ved trekne-øyeblikket. NULL i PR 4b — phase-tracking kommer i PR 4c.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_draws.current_phase_at_draw';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260501000100_app_game1_draws', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260501000100_app_game1_draws');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260501000200_app_game1_game_state
-- Class: NOT-APPLIED
-- Reason: 1 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 4b: app_game1_game_state — per-spill draw-bag state +
-- phase-progresjon.
--
-- Spec: GAME1_SCHEDULE PR 4b (draw-engine core, Alt 3 parallell draw-strøm).
--
-- Formål: én rad per scheduled_game opprettet ved engine-start. Holder:
--   1) Hele draw-bag (shuffled ved start) slik at drawNext() er deterministisk
--      og crash-resumable — vi kan re-konstruere engine-state etter restart.
--   2) draws_completed: hvor mange kuler er trukket (= draw_sequence for
--      neste draw - 1).
--   3) current_phase: gjeldende fase (1..5). PR 4b holder på 1; fase-
--      progresjon implementeres i PR 4c.
--   4) paused-flag + next_auto_draw_at: utsatt til PR 4c (auto-draw timer).
--   5) engine_started_at / engine_ended_at: livssyklus-markører.
--
-- Designvalg:
--   * scheduled_game_id PRIMARY KEY: én rad per spill. INSERT ved engine-
--     start, UPDATE ved hver draw.
--   * draw_bag_json JSONB: hele shuffled bag lagres ved start. Array av
--     tall 1..maxBallValue (typisk 60 eller 75). Lagring gjør hele
--     engine deterministisk — drawNext() plukker bag[draws_completed].
--   * draws_completed INT DEFAULT 0 CHECK >= 0: teller trukne kuler.
--   * current_phase INT DEFAULT 1 CHECK 1..5: phase-progression. PR 4b
--     holder på 1; PR 4c evaluerer mot patterns og øker.
--   * last_drawn_ball / last_drawn_at: kortvei for UI uten å joine draws.
--   * next_auto_draw_at / paused: timing-state for PR 4c auto-mode.
--   * engine_ended_at NULL inntil stopGame/drawNext→completed skjer.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_game_state (
  scheduled_game_id     TEXT PRIMARY KEY
                          REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Hele shuffled draw-bag ved start. Array av 1..maxBallValue (typisk 60
  -- eller 75). Deterministisk — drawNext() plukker bag[draws_completed].
  draw_bag_json         JSONB NOT NULL,
  -- Antall kuler som er trukket så langt (= draw_sequence for neste draw - 1).
  draws_completed       INTEGER NOT NULL DEFAULT 0
                          CHECK (draws_completed >= 0),
  -- Gjeldende fase (1..5). Starter på 1. PR 4b holder på 1; PR 4c
  -- implementerer phase-progression.
  current_phase         INTEGER NOT NULL DEFAULT 1
                          CHECK (current_phase >= 1 AND current_phase <= 5),
  -- Siste trukne kule (null ved initial state).
  last_drawn_ball       INTEGER NULL,
  last_drawn_at         TIMESTAMPTZ NULL,
  -- Timing-state (for auto-mode i PR 4c). Pause-støtte.
  next_auto_draw_at     TIMESTAMPTZ NULL,
  paused                BOOLEAN NOT NULL DEFAULT false,
  -- Livssyklus.
  engine_started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  engine_ended_at       TIMESTAMPTZ NULL
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_game_state') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_game_state IS
  'GAME1_SCHEDULE PR4b: én rad per Game 1 scheduled_game med shuffled draw-bag + phase-progresjon. Crash-resumable.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_game_state' AND column_name='draw_bag_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_game_state.draw_bag_json IS
  'GAME1_SCHEDULE PR4b: hele shuffled draw-bag lagret ved engine-start. Array av 1..maxBallValue. Gjør drawNext() deterministisk og crash-resumable.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_game_state.draw_bag_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_game_state' AND column_name='current_phase') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_game_state.current_phase IS
  'GAME1_SCHEDULE PR4b: fase (1..5). PR 4b holder på 1; PR 4c evaluerer mønstre og øker fasen.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_game_state.current_phase';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_game_state' AND column_name='paused') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_game_state.paused IS
  'GAME1_SCHEDULE PR4b: pause-flag. Oppdateres av pauseGame/resumeGame. Auto-draw-timer i PR 4c leser dette.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_game_state.paused';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260501000200_app_game1_game_state', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260501000200_app_game1_game_state');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260501000300_app_game1_phase_winners
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 4c: app_game1_phase_winners — per-vinner audit-rekord.
--
-- Spec: GAME1_SCHEDULE PR 4c Bolk 2 (payout + split-rounding + loyalty-hook).
--
-- Formål: én rad per fase-vinner per spill. Persisterer den fullstendige
-- payout-konteksten slik at rapporter og compliance kan rekonstruere
-- vinner-trailen uavhengig av runtime-state.
--
-- Design:
--   * scheduled_game_id + phase + assignment_id i UNIQUE — én vinner-rad
--     per brett per fase. Multiple brett fra samme spiller kan vinne samme
--     fase (sjeldent, men mulig); vi logger hvert brett separat.
--   * phase INT CHECK 1..5: fasen som ble vunnet (matcher game_state.current_phase
--     ved tidspunktet vinnerskapen ble registrert).
--   * draw_sequence_at_win: hvilken draw-sekvens utløste winnen. Gjør det
--     mulig å spore "PÅ hvilken kule ble fasen vunnet" for reporting.
--   * prize_amount_cents: faktisk utbetalt beløp per brett (allerede split).
--   * total_phase_prize_cents + winner_brett_count: total-pott og antall
--     vinnende brett som delte potten — gjør split-rounding tracable.
--   * wallet_transaction_id: ID på wallet-credit-transaksjonen. Kan være null
--     hvis payout=0 (jackpot-only eller zero-prize-fase).
--   * loyalty_points_awarded: beregnet points-tilskudd, fire-and-forget —
--     NULL hvis hook ikke ble kalt eller feilet. Kun for reporting.
--   * created_at for audit-tidsstempel.
--
-- Indekser:
--   * (scheduled_game_id, phase): lookup per spill + fase (rapporter).
--   * (winner_user_id, created_at DESC): "mine vinster" for spiller-UI.
--   * (hall_id, created_at DESC): hall-rapport.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_phase_winners (
  id                        TEXT PRIMARY KEY,
  scheduled_game_id         TEXT NOT NULL
                              REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  assignment_id             TEXT NOT NULL
                              REFERENCES app_game1_ticket_assignments(id) ON DELETE RESTRICT,
  winner_user_id            TEXT NOT NULL
                              REFERENCES app_users(id) ON DELETE RESTRICT,
  hall_id                   TEXT NOT NULL
                              REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Fase som ble vunnet (1 = "1 Rad", 2 = "2 Rader", …, 5 = "Fullt Hus").
  phase                     INTEGER NOT NULL
                              CHECK (phase >= 1 AND phase <= 5),
  -- Draw-sekvens som utløste winnen (matcher app_game1_draws.draw_sequence).
  draw_sequence_at_win      INTEGER NOT NULL
                              CHECK (draw_sequence_at_win >= 1),
  -- Faktisk utbetalt beløp pr brett i øre (etter split + evt cap).
  prize_amount_cents        INTEGER NOT NULL
                              CHECK (prize_amount_cents >= 0),
  -- Total pot for fasen før split (øre).
  total_phase_prize_cents   INTEGER NOT NULL
                              CHECK (total_phase_prize_cents >= 0),
  -- Antall vinnende brett som delte total_phase_prize_cents.
  winner_brett_count        INTEGER NOT NULL
                              CHECK (winner_brett_count >= 1),
  -- Ticket-farge ved win (for farge-basert jackpot-oppslag).
  ticket_color              TEXT NOT NULL,
  -- ID på wallet-credit-transaksjonen (null hvis payout=0).
  wallet_transaction_id     TEXT NULL,
  -- Loyalty points tildelt (null hvis hook ikke kalt / feilet).
  loyalty_points_awarded    INTEGER NULL,
  -- Hvis jackpot ble utløst ved denne vinnerskapen (kun relevant for Fullt Hus).
  jackpot_amount_cents      INTEGER NULL
                              CHECK (jackpot_amount_cents IS NULL OR jackpot_amount_cents >= 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheduled_game_id, phase, assignment_id)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_phase_winners') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_phase_winners_game_phase
  ON app_game1_phase_winners(scheduled_game_id, phase) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_phase_winners';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_phase_winners') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_phase_winners_user
  ON app_game1_phase_winners(winner_user_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_phase_winners';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_phase_winners') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_phase_winners_hall
  ON app_game1_phase_winners(hall_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_phase_winners';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_phase_winners') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_phase_winners IS
  'GAME1_SCHEDULE PR4c: én rad per vinnende brett per fase i Spill 1. Persisterer split-rounding-kontekst og wallet-tx-ID for audit.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_phase_winners' AND column_name='phase') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_phase_winners.phase IS
  'Fase 1..5 = 1 Rad | 2 Rader | 3 Rader | 4 Rader | Fullt Hus.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_phase_winners.phase';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_phase_winners' AND column_name='jackpot_amount_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_phase_winners.jackpot_amount_cents IS
  'GAME1_SCHEDULE PR4c: ekstra jackpot-utbetaling utløst sammen med payout. Kun satt hvis Fullt Hus vunnet PÅ eller FØR scheduled_game.jackpot.draw.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_phase_winners.jackpot_amount_cents';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260501000300_app_game1_phase_winners', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260501000300_app_game1_phase_winners');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260503000000_game1_hall_scan_data
-- Class: NOT-APPLIED-NEEDS-PREDECESSOR
-- Reason: depends on tables created in earlier pending migrations: app_game1_hall_ready_status (created in 20260428000100_game1_hall_ready_status)
-- ──────────────────────────────────────────────────────────────────────────────
-- TASK HS: Hall-status farge-kode (Rød/Oransje/Grønn) + start-/slutt-scan-flyt.
--
-- Spec: Task HS locked av Tobias 2026-04-24.
--
-- Formål:
--   Utvider app_game1_hall_ready_status med start- og slutt-scan-data slik at
--   master-dashboard kan fargekode haller basert på scan-flyt:
--     🔴 Rød    = playerCount == 0 (ingen bonger solgt → ekskluderes auto)
--     🟠 Oransje = spillere finnes, men final-scan mangler eller ikke klar
--     🟢 Grønn   = alle spillere telt + slutt-scan gjort + Klar trykket
--
-- Scan-flyt (låst):
--   1. Start-scan (før salg)  → start_ticket_id + start_scanned_at
--   2. Agent selger bonger
--   3. Slutt-scan (etter salg) → final_scan_ticket_id + final_scanned_at
--   4. sold_range = [start_ticket_id, final_scan_ticket_id - 1]  (eksakt)
--   5. Agent trykker Klar → is_ready=true (eksisterende logikk, krever nå at
--      finalScanDone=true)
--
-- Edge-case (låst):
--   Hall uten fysiske bonger (digital-only) trenger ikke å scanne — service-
--   laget markerer `finalScanDone=true` automatisk når physical_tickets_sold
--   + start_ticket_id begge er 0/NULL, slik at hallen kan gå grønn kun på
--   readyConfirmed. Scan-kolonnene her er utelukkende for fysisk-bong-
--   scenarioet.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_hall_ready_status') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_hall_ready_status
  ADD COLUMN IF NOT EXISTS start_ticket_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS start_scanned_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS final_scan_ticket_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS final_scanned_at TIMESTAMPTZ NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_hall_ready_status';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_hall_ready_status' AND column_name='start_ticket_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_hall_ready_status.start_ticket_id IS
  'TASK HS: ticketId for første bong øverst i bunken (før salg starter).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_hall_ready_status.start_ticket_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_hall_ready_status' AND column_name='start_scanned_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_hall_ready_status.start_scanned_at IS
  'TASK HS: tidspunkt for start-scan. Idempotent re-scan oppdaterer feltet.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_hall_ready_status.start_scanned_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_hall_ready_status' AND column_name='final_scan_ticket_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_hall_ready_status.final_scan_ticket_id IS
  'TASK HS: ticketId for første usolgte bong etter salg. sold_range = [start_ticket_id, final_scan_ticket_id - 1].' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_hall_ready_status.final_scan_ticket_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_hall_ready_status' AND column_name='final_scanned_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_hall_ready_status.final_scanned_at IS
  'TASK HS: tidspunkt for slutt-scan.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_hall_ready_status.final_scanned_at';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260503000000_game1_hall_scan_data', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260503000000_game1_hall_scan_data');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260601000000_app_game1_scheduled_games_room_code
-- Class: NOT-APPLIED-NEEDS-PREDECESSOR
-- Reason: depends on tables created in earlier pending migrations: app_game1_scheduled_games (created in 20260428000000_game1_scheduled_games)
-- ──────────────────────────────────────────────────────────────────────────────
-- GAME1_SCHEDULE PR 4d.1: room_code-mapping for app_game1_scheduled_games.
--
-- Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.2
--
-- Formål: persistent 1:1-mapping mellom scheduled_game_id og BingoEngine
-- room_code. Nødvendig for at `game1:join-scheduled`-handler (kommer i
-- 4d.2) skal kunne slå opp riktig bingo-rom for en spiller som joiner en
-- schedulert økt via scheduledGameId — og for crash recovery der engine
-- må rebinde state etter restart.
--
-- Designvalg:
--   * NULL tillatt: historiske rader (completed/cancelled) får aldri
--     room_code bakoverkompatibelt. Nye rader er NULL frem til første
--     spiller joiner, da setter 4d.2-handler kolonnen atomisk.
--   * UNIQUE via partial index WHERE room_code IS NOT NULL: hindrer
--     dobbel-binding uten å regne NULL som duplikat.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_scheduled_games') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS room_code TEXT $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_scheduled_games';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_scheduled_games') THEN
    EXECUTE $stmt$ CREATE UNIQUE INDEX IF NOT EXISTS idx_app_game1_scheduled_games_room_code
  ON app_game1_scheduled_games (room_code)
  WHERE room_code IS NOT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_scheduled_games';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260601000000_app_game1_scheduled_games_room_code', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260601000000_app_game1_scheduled_games_room_code');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260605000000_app_game1_scheduled_games_game_config
-- Class: NOT-APPLIED-NEEDS-PREDECESSOR
-- Reason: depends on tables created in earlier pending migrations: app_game1_scheduled_games (created in 20260428000000_game1_scheduled_games)
-- ──────────────────────────────────────────────────────────────────────────────
-- Scheduler-config-kobling: admin-UI (GameManagement.config_json.spill1) →
-- scheduled-games-runtime.
--
-- Spec: docs/architecture/spill1-variantconfig-admin-coupling.md (scheduler-
-- fiks, avsnitt "Scope utsatt"). Kobler admin-UI-konfig til scheduled_games-
-- path slik at spawned Game 1-instanser ser per-farge premie-matriser
-- (Option X) i stedet for hardkodede defaults.
--
-- Formål: separat kolonne for GameManagement.config.spill1-snapshot —
-- holdt adskilt fra `ticket_config_json` (schedule.subGame.ticketTypesData)
-- og `jackpot_config_json` (schedule.subGame.jackpotData) slik at vi ikke
-- kolliderer med eksisterende scheduler-kontrakt. Scheduler-ticken
-- populerer denne kolonnen ved spawn ved å lese
-- `app_daily_schedules.game_management_id → app_game_management.config_json`.
--
-- Designvalg:
--   * NULLABLE: historiske scheduled_games + daily_schedules uten
--     game_management_id → NULL → Game1PayoutService faller tilbake til
--     default-patterns (bakoverkompat).
--   * JSONB (ikke TEXT): matcher resten av schedulertabellens JSON-kolonner
--     + GameManagement.config_json.
--   * Ingen backfill: forward-only (BIN-661). Eksisterende rader beholder
--     NULL → default-oppførsel.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_scheduled_games') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_scheduled_games
  ADD COLUMN IF NOT EXISTS game_config_json JSONB NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_scheduled_games';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_scheduled_games' AND column_name='game_config_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_scheduled_games.game_config_json IS
  'Scheduler-config-kobling: snapshot av GameManagement.config_json (typisk {spill1: {...}}) kopiert inn ved spawn. NULL → Game1PayoutService faller tilbake til DEFAULT_NORSK_BINGO_CONFIG.patterns.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_scheduled_games.game_config_json';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260605000000_app_game1_scheduled_games_game_config', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260605000000_app_game1_scheduled_games_game_config');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260606000000_app_game1_mini_game_results
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-690 Spor 3 M1: app_game1_mini_game_results (framework-persistens).
--
-- Spec: docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md §Spor 3
--
-- Formål: én rad per trigget mini-game-instans. Orchestrator (M1) INSERT-er
-- raden når en Fullt Hus-vinner trigger en mini-game, og UPDATE-er raden
-- når spilleren har gjort sitt valg og resultatet er utbetalt.
--
-- Kontrast mot `app_mini_games_config` (BIN-679): dén tabellen er admin-
-- konfigurasjon (én singleton-rad per spill-type, fri-form prize-lister).
-- Denne tabellen er RUNTIME-historikk (én rad per trigget instans, med
-- resultat + payout-referanse).
--
-- Designvalg:
--   * `mini_game_type` TEXT + CHECK: framework-type-discriminator. Matcher
--     MiniGameType-interface (MiniGame.type). Utvides når M2-M5 legges til.
--   * `scheduled_game_id` FK REFERENCES app_game1_scheduled_games: mini-
--     game er bundet til én Spill 1-instans. ON DELETE CASCADE slik at
--     rader forsvinner hvis spillet slettes.
--   * `winner_user_id` TEXT (ikke FK): spiller som trigget mini-game.
--     Ikke FK pga bruker-sletting ikke skal fjerne historikk.
--   * `triggered_at` / `completed_at`: lifecycle-timestamps. `completed_at`
--     NULL frem til spilleren har gjort valg + resultatet er utbetalt.
--     Orchestrator bruker dette til å detektere "abandoned" mini-games.
--   * `result_json` JSONB: spill-spesifikt resultat-payload. Schema varierer
--     per mini_game_type (wheel → { segmentIndex, prize }, chest → { chestIdx,
--     prize }, osv.). Valideres av mini-game-implementasjonen i M2-M5.
--   * `payout_cents` INT DEFAULT 0: utbetalt beløp i øre. 0 hvis mini-game
--     enda ikke fullført eller gave 0 kr.
--   * `choice_json` JSONB NULL: spillerens valg (f.eks. { chestIdx: 2 }
--     for chest, { color: "red" } for colordraft). NULL hvis spillet ikke
--     krever valg (wheel = ingen valg, bare spin).
--   * `config_snapshot_json` JSONB: snapshot av mini-game-config på
--     trigger-tidspunkt. Beskytter mot admin-endringer midt i spillet.
--   * UNIQUE (scheduled_game_id, winner_user_id): én mini-game per
--     (scheduled_game, winner). Legacy-pattern: én vinner per Fullt Hus →
--     én mini-game. Hvis fremtidig multi-winner Fullt Hus → migrer til
--     (scheduled_game_id, winner_user_id, triggered_at).
--
-- Indekser:
--   * (scheduled_game_id): list mini-games per spill (admin-overview).
--   * (winner_user_id, triggered_at DESC): spillerens mini-game-historikk.
--   * (completed_at) WHERE completed_at IS NULL: abandoned-detektor
--     (orchestrator-cron i M2+ kan finne ufullførte).
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_game1_mini_game_results (
  id                      TEXT PRIMARY KEY,
  scheduled_game_id       TEXT NOT NULL
                            REFERENCES app_game1_scheduled_games(id)
                            ON DELETE CASCADE,
  -- Framework-type. CHECK-listen utvides når M2-M5 lander. Start med alle
  -- fire typer så migrasjonen ikke må re-kjøres for å akseptere dem.
  mini_game_type          TEXT NOT NULL
                            CHECK (mini_game_type IN (
                              'wheel',
                              'chest',
                              'colordraft',
                              'oddsen'
                            )),
  -- Spilleren som trigget mini-game (typisk Fullt Hus-vinner).
  winner_user_id          TEXT NOT NULL,
  -- Snapshot av admin-config på trigger-tidspunkt.
  config_snapshot_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Spillerens valg (hvis relevant). NULL for wheel-type.
  choice_json             JSONB NULL,
  -- Spill-spesifikt resultat-payload. NULL frem til completed_at er satt.
  result_json             JSONB NULL,
  -- Utbetalt beløp i øre. 0 hvis ikke ferdig eller ingen premie.
  payout_cents            INTEGER NOT NULL DEFAULT 0
                            CHECK (payout_cents >= 0),
  triggered_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ NULL,
  -- Én mini-game per (spill, vinner).
  CONSTRAINT uq_game1_mini_game_results_sg_winner UNIQUE
    (scheduled_game_id, winner_user_id)
);

-- Admin-overview: list mini-games per spill.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_mini_game_results') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_mini_game_results_scheduled
  ON app_game1_mini_game_results(scheduled_game_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_mini_game_results';
  END IF;
END $sync$;

-- Spiller-historikk: mini-games siste først.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_mini_game_results') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_mini_game_results_winner_triggered
  ON app_game1_mini_game_results(winner_user_id, triggered_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_mini_game_results';
  END IF;
END $sync$;

-- Abandoned-detektor (partial-index for ikke-fullførte).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_mini_game_results') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_mini_game_results_open
  ON app_game1_mini_game_results(triggered_at)
  WHERE completed_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_mini_game_results';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_mini_game_results') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_mini_game_results IS
  'BIN-690 M1: runtime-historikk for Game 1 mini-games. Én rad per trigget instans. INSERT ved trigger, UPDATE ved completion.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_mini_game_results' AND column_name='mini_game_type') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_mini_game_results.mini_game_type IS
  'BIN-690 M1: framework-type-discriminator. Matcher MiniGame.type i backend/src/game/minigames/types.ts. Utvides når M2-M5 lander.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_mini_game_results.mini_game_type';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_mini_game_results' AND column_name='config_snapshot_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_mini_game_results.config_snapshot_json IS
  'BIN-690 M1: snapshot av app_mini_games_config.config_json på trigger-tidspunkt. Beskytter mot admin-endringer midt i spillet.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_mini_game_results.config_snapshot_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_mini_game_results' AND column_name='choice_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_mini_game_results.choice_json IS
  'BIN-690 M1: spillerens valg hvis spillet krever det (chest/colordraft/oddsen). NULL for wheel-type (kun spin).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_mini_game_results.choice_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_mini_game_results' AND column_name='result_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_mini_game_results.result_json IS
  'BIN-690 M1: spill-spesifikt resultat-payload. Schema valideres av mini-game-implementasjonen (M2-M5). NULL frem til completed_at er satt.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_mini_game_results.result_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_mini_game_results' AND column_name='payout_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_mini_game_results.payout_cents IS
  'BIN-690 M1: utbetalt beløp i øre. 0 hvis spillet enda ikke fullført eller resultatet gav 0 kr.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_mini_game_results.payout_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_mini_game_results' AND column_name='completed_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_mini_game_results.completed_at IS
  'BIN-690 M1: NULL frem til spilleren har gjort valg + resultatet er utbetalt. Abandoned-detektor bruker partial-index.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_mini_game_results.completed_at';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260606000000_app_game1_mini_game_results', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260606000000_app_game1_mini_game_results');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260606000000_static_tickets_pt1_extensions
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- PT1: Utvidelser av `app_static_tickets` for fysisk-bong pilot.
--
-- Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
--
-- Bakgrunn:
--   `app_static_tickets` (migrasjon 20260417000002) holder papirbong-inventaret
--   per hall. PT-serien legger nå på range-basert batch-salg ported fra legacy:
--   agenten reserverer en rekke bonger i en range (PT2), selger fritt i hallen,
--   og registrerer batch-salg ved retur (PT3). Vinn-flyt og utbetaling skjer
--   gjennom `sold_to_scheduled_game_id` + `paid_out_*` (PT4).
--
--   PT1 legger til fundamentet — kolonner + indekser — uten å endre eksisterende
--   rader. Selve flyt-logikken implementeres i PT2-PT6.
--
-- Designvalg:
--   * NULLABLE-kolonner: eksisterende rader beholder sine verdier. Ingen
--     backfill; forward-only (BIN-661).
--   * Fremmednøkler med `ON DELETE SET NULL` der det er naturlig (bruker
--     slettes men historikk beholdes). `sold_to_scheduled_game_id` og
--     `*_range_id` får `ON DELETE SET NULL` for å holde historikken
--     konsistent — vi vil ikke miste papirbong-salg fordi et planlagt
--     spill eller en range ble slettet.
--   * Partial-indeks for hot queries (PT4 vinn-broadcast + PT5 handover).
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_static_tickets') THEN
    EXECUTE $stmt$ ALTER TABLE app_static_tickets
  ADD COLUMN IF NOT EXISTS sold_by_user_id           TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_from_range_id        TEXT NULL REFERENCES app_agent_ticket_ranges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_to_scheduled_game_id TEXT NULL REFERENCES app_game1_scheduled_games(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserved_by_range_id      TEXT NULL REFERENCES app_agent_ticket_ranges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_out_at               TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paid_out_amount_cents     INTEGER NULL,
  ADD COLUMN IF NOT EXISTS paid_out_by_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_static_tickets';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='sold_by_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.sold_by_user_id            IS 'PT3: bingoverten som gjennomførte batch-salget (audit). Settes samtidig med is_purchased=true.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.sold_by_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='sold_from_range_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.sold_from_range_id         IS 'PT3: range-ID bongen ble solgt fra. Brukes av PT5-handover for å finne uutbetalte vinn fra avtroppende vakt.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.sold_from_range_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='responsible_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.responsible_user_id        IS 'PT4/PT5: nåværende ansvarlig bingovert. Lik sold_by_user_id inntil handover (PT5), deretter satt til overtagende bingovert.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.responsible_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='sold_to_scheduled_game_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.sold_to_scheduled_game_id  IS 'PT3/PT4: planlagt Game 1-spill bongen er solgt inn til. Danner grunnlag for pattern-evaluering i PT4 vinn-flyt.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.sold_to_scheduled_game_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='reserved_by_range_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.reserved_by_range_id       IS 'PT2: range som har reservert bongen (før salg). NULL etter PT3-salg (flyttet til sold_from_range_id) eller før PT2-reservasjon.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.reserved_by_range_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='paid_out_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.paid_out_at                IS 'PT4: tidspunkt for utbetaling til spiller. NULL = ikke utbetalt. Settes sammen med paid_out_amount_cents + paid_out_by_user_id.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.paid_out_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='paid_out_amount_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.paid_out_amount_cents      IS 'PT4: utbetalt beløp i øre. NULL før utbetaling.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.paid_out_amount_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_static_tickets' AND column_name='paid_out_by_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_static_tickets.paid_out_by_user_id        IS 'PT4: bingoverten som gjennomførte utbetalingen. NULL før utbetaling.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_static_tickets.paid_out_by_user_id';
  END IF;
END $sync$;

-- Partial-indeks: PT4 vinn-broadcast + pattern-evaluering for aktive fysiske
-- bonger i et planlagt spill ("hvilke uutbetalte bonger tilhører dette spillet?").
-- Ikke alle rader har sold_to_scheduled_game_id + is_purchased=true, så
-- partial-indeks er billigere enn full.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_static_tickets') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_static_tickets_scheduled_game_purchased
  ON app_static_tickets (sold_to_scheduled_game_id)
  WHERE is_purchased = true AND paid_out_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_static_tickets';
  END IF;
END $sync$;

-- Partial-indeks: PT5 handover + PT6 rapport ("hvilke uutbetalte bonger har
-- denne bingoverten ansvar for?"). Brukes når Kari går av og Per tar over,
-- eller når admin-dashboard viser utestående.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_static_tickets') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_static_tickets_responsible
  ON app_static_tickets (responsible_user_id)
  WHERE paid_out_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_static_tickets';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260606000000_static_tickets_pt1_extensions', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260606000000_static_tickets_pt1_extensions');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260606000000_wallet_split_deposit_winnings
-- Class: PARTIALLY-APPLIED
-- Reason: 1 present, 6 missing
-- ──────────────────────────────────────────────────────────────────────────────
-- PR-W1: Wallet-split schema — deposit vs. winnings konti
--
-- Design: docs/architecture/WALLET_SPLIT_DESIGN_2026-04-22.md
--
-- Splitter wallet_accounts.balance i to logiske konti per spiller:
--   * deposit_balance  — brukerens innskudd (topup, refund)
--   * winnings_balance — gevinster fra spill (payout)
--
-- Purchase-flyt (implementeres i PR-W2): trekk fra winnings først, så deposit.
-- Loss-limit (implementeres i PR-W5): teller kun deposit-trekk.
--
-- PM-beslutninger (låst 2026-04-22):
--   1. Retroaktiv splitt: alle eksisterende saldoer → deposit_balance, winnings=0.
--   2. Topup → alltid deposit_balance.
--   3. Admin-credit til winnings er IKKE TILLATT (regulatorisk forbud).
--   4. Withdrawal → winnings først, så deposit.
--
-- Schema-strategi:
--   * `balance` konverteres til GENERATED ALWAYS AS (deposit + winnings) STORED
--     for bakoverkompatibilitet. Eksisterende SELECT/sum-queries uendret.
--   * Systemkontoer (__system_house__, __system_external_cash__) holder all
--     saldo i deposit_balance; winnings_balance = 0 (enforced via CHECK).
--   * wallet_entries.account_side markerer hvilken "side" av split-kontoen en
--     entry gjelder — 'deposit' eller 'winnings'. Eksisterende entries
--     backfilles til 'deposit' (alle historiske er per definisjon deposit).
--
-- Bakoverkompatibilitet:
--   * `balance`-kolonnen forblir lesbar og returnerer deposit+winnings.
--   * Eksisterende PostgresWalletAdapter.getBalance() fortsetter å fungere.
--   * WalletAdapter-interface utvidelse (deposit/winnings getters) er additive.
--
-- Forward-only (BIN-661): ingen Down-seksjon. Rollback via ny migration hvis
-- nødvendig (vil måtte lagre sum tilbake i deposit_balance først, så droppe
-- GENERATED og ADD TEXT-kolonne).
--
-- Up migration

-- Steg 1: Legg til nye balance-kolonner med default 0.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_accounts') THEN
    EXECUTE $stmt$ ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS deposit_balance  NUMERIC(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS winnings_balance NUMERIC(20, 6) NOT NULL DEFAULT 0 $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: wallet_accounts';
  END IF;
END $sync$;

-- Steg 2: Retroaktiv backfill — alle eksisterende saldoer = deposit (PM-beslutning 4).
-- Både ikke-system-kontoer og system-kontoer får balance → deposit_balance.
-- Dette er idempotent (WHERE deposit_balance = 0 sikrer ingen dobbel-kopi hvis
-- migrasjonen ved uhell kjøres etter manuell testing).
UPDATE wallet_accounts
  SET deposit_balance = balance
  WHERE deposit_balance = 0 AND balance > 0;

-- Steg 3: Invariant — system-kontoer skal ALDRI ha winnings (de er motpart for
-- kjøp/uttak + payout-kilde, ikke målkonti).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_accounts') THEN
    EXECUTE $stmt$ ALTER TABLE wallet_accounts
  ADD CONSTRAINT wallet_accounts_system_no_winnings
  CHECK (is_system = false OR winnings_balance = 0) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: wallet_accounts';
  END IF;
END $sync$;

-- Steg 4: Invariant — hver split-saldo må være ikke-negativ for ikke-system-kontoer.
-- (System-kontoer kan ha negativ deposit_balance siden de er motpart-side i double-entry.)
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_accounts') THEN
    EXECUTE $stmt$ ALTER TABLE wallet_accounts
  ADD CONSTRAINT wallet_accounts_nonneg_deposit_nonsystem
  CHECK (is_system = true OR deposit_balance >= 0) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: wallet_accounts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_accounts') THEN
    EXECUTE $stmt$ ALTER TABLE wallet_accounts
  ADD CONSTRAINT wallet_accounts_nonneg_winnings_nonsystem
  CHECK (is_system = true OR winnings_balance >= 0) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: wallet_accounts';
  END IF;
END $sync$;

-- Steg 5: Erstatt `balance`-kolonnen med GENERATED ALWAYS AS (deposit+winnings) STORED.
-- Dette bevarer ALL eksisterende lese-logikk — `SELECT balance FROM wallet_accounts`
-- returnerer fortsatt korrekt totalsum, ingen kode-endring nødvendig før split aktiveres.
-- GENERATED STORED er viktig: indexer og queries trenger ikke re-beregne ved hver SELECT.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_accounts') THEN
    EXECUTE $stmt$ ALTER TABLE wallet_accounts DROP COLUMN IF EXISTS balance $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: wallet_accounts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_accounts') THEN
    EXECUTE $stmt$ ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS balance NUMERIC(20, 6)
  GENERATED ALWAYS AS (deposit_balance + winnings_balance) STORED $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: wallet_accounts';
  END IF;
END $sync$;

-- Steg 6: Legg til account_side på wallet_entries for audit-sporing av hvilken
-- "side" av split-kontoen en entry gjelder. Default 'deposit' for bakoverkompat
-- (alle historiske entries er per definisjon deposit — før split fantes ingen winnings).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_entries') THEN
    EXECUTE $stmt$ ALTER TABLE wallet_entries
  ADD COLUMN IF NOT EXISTS account_side TEXT NOT NULL DEFAULT 'deposit'
  CHECK (account_side IN ('deposit', 'winnings')) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: wallet_entries';
  END IF;
END $sync$;

-- Steg 7: Index for spørringer som filtrerer audit-log per account_side
-- (f.eks. "alle winnings-krediteringer for denne spilleren").
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallet_entries') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_wallet_entries_account_side
  ON wallet_entries (account_id, account_side, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: wallet_entries';
  END IF;
END $sync$;

-- Steg 8: Kommentarer for hvem-som-leser-schemaet.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_accounts' AND column_name='deposit_balance') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN wallet_accounts.deposit_balance IS
  'PR-W1 wallet-split: brukerens innskudd (topup, refund). Loss-limit teller kun trekk fra denne.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: wallet_accounts.deposit_balance';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_accounts' AND column_name='winnings_balance') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN wallet_accounts.winnings_balance IS
  'PR-W1 wallet-split: gevinster fra spill (payout). Trekkes først ved kjøp (winnings-first-policy). Admin-credit IKKE TILLATT (regulatorisk forbud).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: wallet_accounts.winnings_balance';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_accounts' AND column_name='balance') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN wallet_accounts.balance IS
  'PR-W1 wallet-split: generert sum av deposit_balance + winnings_balance. Bakoverkompat for eksisterende code paths.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: wallet_accounts.balance';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_entries' AND column_name='account_side') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN wallet_entries.account_side IS
  'PR-W1 wallet-split: hvilken side av split-kontoen denne entry gjelder. Historiske entries backfilled til deposit.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: wallet_entries.account_side';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260606000000_wallet_split_deposit_winnings', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260606000000_wallet_split_deposit_winnings');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260607000000_agent_ticket_ranges_pt2_extensions
-- Class: NOT-APPLIED
-- Reason: 2 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- PT2: Utvidelser av `app_agent_ticket_ranges` for agent range-registrering.
--
-- Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
--
-- Bakgrunn:
--   `app_agent_ticket_ranges` (migrasjon 20260417000003) eksisterer fra før med
--   `initial_serial`, `final_serial`, `serials` JSONB og `next_available_index`.
--   PT2 legger til to kolonner som PT3-batch-salg og PT5-handover trenger:
--
--     * `current_top_serial`  — peker på toppen av usolgte bonger i rangen.
--       Dekrementerer ved hver PT3-batch-oppdatering. Ved opprettelse
--       settes den lik `initial_serial`. NULL for historiske closed ranges
--       som eksisterer før PT2 landet (men eksisterende installasjoner er
--       tomme — tabellen er ny i BIN-661 Bølge 2).
--
--     * `handover_from_range_id` — peker på rangen som ble overlevert ved
--       PT5-handover. NULL for første-registrering (ikke handover).
--
--   PT2 selve håndteringen av rader skjer i `AgentTicketRangeService` og
--   wirer seg mot `StaticTicketService` (PT1). Ingen backfill — nye rader
--   skrives med `current_top_serial = initial_serial` eksplisitt.
--
-- Designvalg:
--   * `current_top_serial` er NULLABLE (ikke NOT NULL) for å tolerere
--     eksisterende rader fra pre-PT2-kode (det finnes ingen, men vi er
--     forward-only-strenge og unngår backfill). Service-laget tilordner
--     alltid verdien ved INSERT.
--   * `handover_from_range_id` referer til samme tabell — ON DELETE SET NULL
--     for å beholde handover-historikk selv om avtroppende range slettes
--     (regulatorisk krav om bevaring av audit-spor).
--   * Partial-indeks på aktive ranges for (agent_id, hall_id) — hot path
--     for "liste aktive ranges for denne bingoverten".
--
-- Forward-only (BIN-661): ingen Down-seksjon.

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_ticket_ranges
  ADD COLUMN IF NOT EXISTS current_top_serial     TEXT NULL,
  ADD COLUMN IF NOT EXISTS handover_from_range_id TEXT NULL
    REFERENCES app_agent_ticket_ranges(id) ON DELETE SET NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_ticket_ranges' AND column_name='current_top_serial') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_ticket_ranges.current_top_serial     IS 'PT2/PT3: peker på toppen av usolgte bonger i rangen. Settes lik initial_serial ved PT2-opprettelse, dekrementerer ved hver PT3-batch-oppdatering (ny top = scannet neste-topp-serial).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_ticket_ranges.current_top_serial';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_ticket_ranges' AND column_name='handover_from_range_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_ticket_ranges.handover_from_range_id IS 'PT5: peker på avtroppende range ved vakt-skift. NULL for første-registrering (ikke handover).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_ticket_ranges.handover_from_range_id';
  END IF;
END $sync$;

-- PT2 hot-path: "liste aktive ranges for denne bingoverten" (UI-dashboard).
-- Matcher det eksisterende partial-indeksmønsteret i migrasjon 20260417000003.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_agent_hall_open
  ON app_agent_ticket_ranges (agent_id, hall_id, registered_at DESC)
  WHERE closed_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260607000000_agent_ticket_ranges_pt2_extensions', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260607000000_agent_ticket_ranges_pt2_extensions');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260608000000_physical_ticket_pending_payouts
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- PT4: Pending-payouts for fysiske bonger etter pattern-match.
--
-- Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
--       (§ "Fase 6: Vinn-varsel + verifisering + utbetaling", linje 127-156)
--
-- Bakgrunn:
--   Digital bong → auto-payout fra wallet-pott ved phase-match i
--   Game1DrawEngineService.evaluateAndPayoutPhase(). Fysisk bong kan IKKE
--   auto-payout — spilleren må fysisk fremvise bongen for bingoverten, som
--   scanner den før kontant-utbetaling. Denne tabellen holder "pending"-
--   rader fra detect-øyeblikket (draw-engine) til verifisering og faktisk
--   utbetaling (bingovert) er gjennomført.
--
-- Design:
--   * En rad per (ticket_id, pattern_phase) — UNIQUE constraint forhindrer
--     duplikat-detection hvis drawNext kjøres idempotent.
--   * NULLABLE verifisering/utbetaling-felter: rad starter i "detected"-state
--     (kun detected_at satt), går via "verified" (scan + fire-øyne-flag) til
--     enten "paid_out" eller "rejected".
--   * `admin_approval_required` flagges ved verifisering hvis
--     expected_payout_cents >= 500000 (5000 kr). Admin må så kalle egen
--     admin-approve-endepunkt før confirm-payout er lovlig.
--   * Partial-indekser for hot queries:
--       - "hvilke pending-payouts for dette spillet?" (admin-skjerm ved
--         aktivt spill)
--       - "hvilke pending-payouts har denne bingoverten ansvar for?"
--         (bingovert-vakt)
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_physical_ticket_pending_payouts (
  id                         TEXT PRIMARY KEY,
  -- ticket_id speiler app_static_tickets.ticket_serial. FK droppes fordi
  -- ticket_serial alene ikke er unik (samme serial kan finnes i flere haller
  -- + farger). Unikhet sikres via (hall_id, ticket_id, pattern_phase) i
  -- kombinasjon med constraint under.
  ticket_id                  TEXT NOT NULL,
  hall_id                    TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  scheduled_game_id          TEXT NOT NULL REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  pattern_phase              TEXT NOT NULL,
  expected_payout_cents      BIGINT NOT NULL,
  responsible_user_id        TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  color                      TEXT NOT NULL,
  detected_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at                TIMESTAMPTZ NULL,
  verified_by_user_id        TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  paid_out_at                TIMESTAMPTZ NULL,
  paid_out_by_user_id        TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  admin_approval_required    BOOLEAN NOT NULL DEFAULT false,
  admin_approved_at          TIMESTAMPTZ NULL,
  admin_approved_by_user_id  TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_at                TIMESTAMPTZ NULL,
  rejected_by_user_id        TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_reason            TEXT NULL,
  -- Én pending-row per (hall, ticket_serial, phase). Forhindrer duplikat-
  -- detection hvis draw-engine skulle krasje og kjøre phase-evaluering om
  -- igjen for samme bong. (hall_id inkludert fordi samme ticket_serial kan
  -- finnes i flere haller.)
  CONSTRAINT pt4_unique_hall_ticket_phase UNIQUE (hall_id, ticket_id, pattern_phase)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts') THEN
    EXECUTE $stmt$ COMMENT ON TABLE  app_physical_ticket_pending_payouts IS 'PT4: Fysisk-bong pending-utbetalinger etter pattern-match. En rad per (ticket_id, pattern_phase). Går via detected → verified → (admin_approved) → paid_out / rejected.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='ticket_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.ticket_id               IS 'PT4: ticket_serial fra app_static_tickets (bong-ID som treffet pattern).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.ticket_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='hall_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.hall_id                 IS 'PT4: hall bongen tilhører (replika fra static_tickets for rask query).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.hall_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='scheduled_game_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.scheduled_game_id       IS 'PT4: planlagt Spill 1-økt bongen vant i.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.scheduled_game_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='pattern_phase') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.pattern_phase           IS 'PT4: pattern-key, f.eks. "row_1" | "row_2" | "row_3" | "row_4" | "full_house".' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.pattern_phase';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='expected_payout_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.expected_payout_cents   IS 'PT4: forventet utbetaling i øre beregnet av draw-engine (pot-andel eller fixed). Kan avvike fra faktisk utbetaling ved split mellom flere vinnere — verifiseres igjen ved confirm-payout.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.expected_payout_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='responsible_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.responsible_user_id     IS 'PT4: bingovert ansvarlig for denne bongen (sold_by_user_id / handover_to). Mottaker av varsel-socket.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.responsible_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='color') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.color                   IS 'PT4: ticket_color-familie (small/large/traffic-light) — replika fra static_tickets for UI-rendering.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.color';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='detected_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.detected_at             IS 'PT4: tidspunkt draw-engine detekterte match (audit-bevis).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.detected_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='verified_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.verified_at             IS 'PT4: tidspunkt bingovert scannet bongen for verifikasjon.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.verified_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='verified_by_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.verified_by_user_id     IS 'PT4: bingovert som scannet og verifiserte (ofte == responsible_user_id).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.verified_by_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='paid_out_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.paid_out_at             IS 'PT4: tidspunkt faktisk kontant-utbetaling ble bekreftet. Settes sammen med paid_out_by_user_id. Også speiler app_static_tickets.paid_out_at.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.paid_out_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='paid_out_by_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.paid_out_by_user_id     IS 'PT4: bingovert som bekreftet utbetaling.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.paid_out_by_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='admin_approval_required') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.admin_approval_required IS 'PT4: true hvis expected_payout_cents >= 500000 (5000 kr). Krever fire-øyne før confirm-payout.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.admin_approval_required';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='admin_approved_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.admin_approved_at       IS 'PT4: tidspunkt ADMIN gav fire-øyne-approval. Må være satt før confirm-payout hvis admin_approval_required = true.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.admin_approved_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='admin_approved_by_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.admin_approved_by_user_id IS 'PT4: ADMIN som godkjente (må være annen enn verified_by og paid_out_by ideelt, men ikke tvang-validert på tabellen — håndheves i service hvis policy utvides).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.admin_approved_by_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='rejected_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.rejected_at             IS 'PT4: tidspunkt rad ble avvist (f.eks. bong ikke fysisk frembrakt når bingovert gikk).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.rejected_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='rejected_by_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.rejected_by_user_id     IS 'PT4: bingovert/ADMIN som avviste.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.rejected_by_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='rejected_reason') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.rejected_reason         IS 'PT4: fri-tekst årsak for audit.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.rejected_reason';
  END IF;
END $sync$;

-- Partial-indeks: "hvilke pending-payouts er fortsatt åpne for dette spillet?"
-- Brukt av admin-skjerm som lister aktive vinn ved aktivt spill.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_game
  ON app_physical_ticket_pending_payouts (scheduled_game_id)
  WHERE paid_out_at IS NULL AND rejected_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_physical_ticket_pending_payouts';
  END IF;
END $sync$;

-- Partial-indeks: "hvilke pending-payouts har denne bingoverten ansvar for?"
-- Brukt av bingovert-vakt-skjerm.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_user
  ON app_physical_ticket_pending_payouts (responsible_user_id)
  WHERE paid_out_at IS NULL AND rejected_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_physical_ticket_pending_payouts';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260608000000_physical_ticket_pending_payouts', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260608000000_physical_ticket_pending_payouts');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260609000000_game1_oddsen_state
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-690 Spor 3 M5: app_game1_oddsen_state — cross-round state for Oddsen.
--
-- Spec: docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md §Spor 3 M5
--       + PR-M5 scope (2026-04-22): Oddsen er unik fordi tallet velges MELLOM
--       bingo-runder, persisteres, og resolves ved neste spill i samme hall.
--
-- Formål: Oddsen er det eneste mini-spillet med cross-round state. Forrige
-- Fullt Hus-vinner velger et av tallene 55/56/57 (default). Valget lagres
-- per-hall i denne tabellen og resolves når NESTE scheduled_game trekker
-- det valgte tallet som draw #57 (eller hvilket som er terskel). Pot er
-- 1500 kr (ticket=10) eller 3000 kr (ticket=20).
--
-- Kontrast mot app_game1_mini_game_results (M1):
--   * mini_game_results: én rad per trigget mini-game-instans, bundet til
--     ÉN scheduled_game (trigget + resolves samme spill). Passer for
--     wheel/chest/colordraft som spilles UNDER bingo-runden.
--   * oddsen_state: én rad per valg, spenner ACROSS to scheduled_games
--     (set_by_game_id i spill N, resolves i chosen_for_game_id = spill N+1).
--     Skiller pga cross-round semantikk + behov for regulatorisk sporbarhet
--     på cross-game ledger-trail (valget kan overleve server-restart, og
--     må kunne rekonstrueres forensic).
--
-- Design:
--   * chosen_number INTEGER CHECK (55, 56, 57): kun tre gyldige tall.
--     DB-constraint beskytter mot korrupt valg selv ved engine-bug.
--   * chosen_by_player_id TEXT: spiller som valgte. Ikke FK pga bruker-
--     sletting ikke skal fjerne historikk (samme pattern som
--     mini_game_results.winner_user_id).
--   * chosen_for_game_id TEXT FK app_game1_scheduled_games(id) ON DELETE
--     RESTRICT: spillet der state skal evalueres. RESTRICT (ikke CASCADE)
--     fordi historikk må bevares selv om et fremtidig spill senere slettes.
--   * set_by_game_id TEXT FK app_game1_scheduled_games(id) ON DELETE
--     RESTRICT: spillet der valget ble gjort (forrige Fullt Hus-vinner).
--   * UNIQUE (hall_id, chosen_for_game_id): kun ett aktivt valg per
--     (hall, neste-spill). Hindrer dobbel-INSERT ved retry. Hvis to forrige-
--     vinnere forsøker å velge for samme neste spill (sjelden multi-winner
--     Fullt Hus-scenario) → andre forsøk blir rejectet.
--   * resolved_at / resolved_outcome / pot_amount_cents: NULL frem til
--     evaluerings-tidspunkt. 'hit' = treff → pot utbetalt, 'miss' = ikke
--     truffet, 'expired' = neste-spill fullførte uten å nå terskel.
--   * ticket_size_at_win TEXT CHECK ('small','large'): snapshot av forrige-
--     vinners ticket-pris-kategori. Bestemmer pot-størrelse når resolved:
--     small → 1500 kr, large → 3000 kr. Lagres her fordi vinner-billetten
--     kan bli endret i ettertid (sjeldent, men historikk skal være immutable).
--   * hall_id TEXT FK app_halls(id) ON DELETE RESTRICT: hallen valget er
--     gyldig i. Cross-round state er per-hall fordi halls spiller ulike
--     scheduled_games parallelt — valg i hall A gjelder hall A's neste
--     spill, ikke hall B's.
--
-- Indekser:
--   * (hall_id, chosen_for_game_id) UNIQUE: samme som UNIQUE-constraint.
--   * (chosen_for_game_id): draw-engine lookup "finnes aktiv Oddsen-state
--     for dette spillet?" — brukes for resolving ved draw #N.
--   * (resolved_at) WHERE resolved_at IS NULL: abandoned-/expired-detektor
--     for cleanup-cron (fremtid).
--
-- Regulatoriske krav:
--   * Server-autoritativ: spilleren sender chosen_number via klient, men
--     engine validerer ∈ [55,56,57] og persisterer. Pot-beløp bestemmes
--     server-side av ticket_size_at_win.
--   * Audit: INSERT logges som mini_game.oddsen_number_chosen, resolve
--     logges som mini_game.oddsen_resolved_{hit,miss,expired}.
--   * Idempotency for payout: idempotency-key = `g1-oddsen-${id}` forhindrer
--     dobbel credit ved draw-retry. Se MiniGameOddsenEngine-kommentarer.
--   * Fail-closed: hvis chosen_for_game_id er NULL (ingen neste spill
--     planlagt), insert rejectes i service-laget før DB-hit.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_game1_oddsen_state (
  id                      TEXT PRIMARY KEY,
  -- Hall valget er gyldig i (per-hall cross-round state).
  hall_id                 TEXT NOT NULL
                            REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Valgt tall, kun 55/56/57 i M5.
  chosen_number           INTEGER NOT NULL
                            CHECK (chosen_number IN (55, 56, 57)),
  -- Spilleren som valgte (forrige Fullt Hus-vinner). Ikke FK pga
  -- bruker-sletting skal ikke fjerne historikk.
  chosen_by_player_id     TEXT NOT NULL,
  -- Spillet der valget skal evalueres (neste planlagte scheduled_game i hallen).
  chosen_for_game_id      TEXT NOT NULL
                            REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Spillet der valget ble gjort (spillet der Fullt Hus ble vunnet).
  set_by_game_id          TEXT NOT NULL
                            REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Ticket-størrelse ved win — bestemmer pot-størrelse ved resolve.
  -- small = 1500 kr pot, large = 3000 kr pot (M5-default).
  ticket_size_at_win      TEXT NOT NULL
                            CHECK (ticket_size_at_win IN ('small', 'large')),
  set_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL frem til evaluerings-tidspunkt.
  resolved_at             TIMESTAMPTZ NULL,
  resolved_outcome        TEXT NULL
                            CHECK (resolved_outcome IS NULL OR
                                   resolved_outcome IN ('hit', 'miss', 'expired')),
  -- Utbetalt pot i øre ved hit (NULL hvis miss/expired eller ikke resolved).
  pot_amount_cents        BIGINT NULL
                            CHECK (pot_amount_cents IS NULL OR pot_amount_cents >= 0),
  -- ID på wallet-transaksjonen for payout (ved hit). NULL hvis ingen payout.
  wallet_transaction_id   TEXT NULL,
  -- Én aktiv state per (hall, neste-spill). Hindrer dobbel-INSERT.
  CONSTRAINT uq_game1_oddsen_state_hall_for_game UNIQUE
    (hall_id, chosen_for_game_id)
);

-- Draw-engine lookup: "finnes aktiv Oddsen-state for dette spillet?"
-- Brukes for resolving ved draw #57 (eller terskel) i Game1DrawEngineService.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_oddsen_state') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_oddsen_state_for_game
  ON app_game1_oddsen_state(chosen_for_game_id)
  WHERE resolved_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_oddsen_state';
  END IF;
END $sync$;

-- Spiller-historikk: "mine Oddsen-valg" for bruker-UI (fremtid).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_oddsen_state') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_oddsen_state_player
  ON app_game1_oddsen_state(chosen_by_player_id, set_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_oddsen_state';
  END IF;
END $sync$;

-- Hall-rapport + cron-cleanup av expired states.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_oddsen_state') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_oddsen_state_hall
  ON app_game1_oddsen_state(hall_id, set_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_oddsen_state';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_oddsen_state') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_oddsen_state IS
  'BIN-690 M5: cross-round state for Oddsen mini-game. Forrige Fullt Hus-vinner velger et tall 55/56/57; state resolves ved neste spill i samme hall. Én rad per valg.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_oddsen_state' AND column_name='chosen_number') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_oddsen_state.chosen_number IS
  'BIN-690 M5: valgt tall (55, 56 eller 57). CHECK enforcer DB-validering selv ved engine-bug.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_oddsen_state.chosen_number';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_oddsen_state' AND column_name='chosen_for_game_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_oddsen_state.chosen_for_game_id IS
  'BIN-690 M5: scheduled_game der state skal evalueres. Engine slår opp denne ved draw-resolve i Game1DrawEngineService.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_oddsen_state.chosen_for_game_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_oddsen_state' AND column_name='ticket_size_at_win') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_oddsen_state.ticket_size_at_win IS
  'BIN-690 M5: snapshot av forrige-vinners ticket-pris-kategori. small → 1500 kr pot, large → 3000 kr pot.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_oddsen_state.ticket_size_at_win';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_oddsen_state' AND column_name='resolved_outcome') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_oddsen_state.resolved_outcome IS
  'BIN-690 M5: hit = treff på valgt tall ved terskel-draw, miss = ikke truffet, expired = neste-spill fullførte uten resolve (sjeldent).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_oddsen_state.resolved_outcome';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260609000000_game1_oddsen_state', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260609000000_game1_oddsen_state');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260610000000_agent_ticket_ranges_pt5_extensions
-- Class: NOT-APPLIED
-- Reason: 2 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- PT5: Utvidelser av `app_agent_ticket_ranges` for vakt-skift (handover) +
-- range-påfylling (extend).
--
-- Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
--       (§ "Fase 7: Handover (vakt-skift)", linje 157-191)
--       (§ "Fase 8: Range-påfylling",       linje 193-216)
--
-- Bakgrunn:
--   PT2 (migrasjon 20260607000000) la til `handover_from_range_id` som peker
--   fra NY range → avtroppende range ved handover. PT5 legger til speiling på
--   avtroppende side (`handed_off_to_range_id`) slik at audit-trailen er
--   bi-direksjonell: gitt en gammel range kan vi finne hvem som tok over,
--   uten å scanne hele tabellen.
--
-- Designvalg:
--   * NULLABLE (ikke NOT NULL): første gang en range lukkes uten handover
--     (vakt-slutt uten overlevering) er denne kolonnen fortsatt NULL. Bare
--     satt hvis bingovertens range ble overført til ny vakt.
--   * `ON DELETE SET NULL`: hvis den nye rangen slettes (skulle ikke skje,
--     men defensivt), beholder vi lukket-rad uten å miste rad.
--   * Ingen CHECK-constraint mellom `closed_at` og `handed_off_to_range_id`:
--     `closed_at` settes uansett ved handover ELLER vakt-slutt. Å koble dem
--     ville gjort CHECK for restriktiv — audit-trailen er presis nok via
--     `physical_ticket.range_handover`-eventen.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_ticket_ranges
  ADD COLUMN IF NOT EXISTS handed_off_to_range_id TEXT NULL
    REFERENCES app_agent_ticket_ranges(id) ON DELETE SET NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_ticket_ranges' AND column_name='handed_off_to_range_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_ticket_ranges.handed_off_to_range_id IS
  'PT5: peker på ny range som overtok ved vakt-skift (handover). Speiler handover_from_range_id bi-direksjonelt. NULL = rangen ble lukket uten handover (vakt-slutt).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_ticket_ranges.handed_off_to_range_id';
  END IF;
END $sync$;

-- PT5 handover hot-path: "gitt avtroppende range, finn etterfølgeren".
-- Partial-indeks siden feltet er NULL for de fleste lukkede ranges.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_handed_off_to
  ON app_agent_ticket_ranges (handed_off_to_range_id)
  WHERE handed_off_to_range_id IS NOT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260610000000_agent_ticket_ranges_pt5_extensions', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260610000000_agent_ticket_ranges_pt5_extensions');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260611000000_game1_accumulating_pots
-- Class: NOT-APPLIED
-- Reason: 5 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- PR-T1 Spor 4 (Pot-service-framework): akkumulerende pot-er for Spill 1.
--
-- Bakgrunn:
--   Spor 4-rammen dekker pot-er som lever MELLOM spill (f.eks. "Jackpott" og
--   "Innsatsen") — de bygger seg opp over tid (daglig boost + andel av
--   billettsalg) og utbetales når en gyldig vinn-betingelse inntreffer. Dette
--   er distinkt fra Game1JackpotService (som håndterer per-spill fixed-amount
--   Fullt Hus-jackpot per farge) — de to tjenestene skal leve i parallell.
--
-- Design:
--   * `app_game1_accumulating_pots` holder nåværende pot-tilstand per
--     (hall_id, pot_key). `pot_key` er en fri tekst som identifiserer pot-
--     typen ("jackpott", "innsatsen", ...). Én rad per aktiv pot.
--   * `current_amount_cents` er pot-balanse i øre. Resettes til seed ved
--     utløsning, boost/sales-akkumulering legger til.
--   * `config_json` holder per-pot regler (seed, daily boost, per-salg-andel,
--     vinn-regler, draw-threshold) som JSONB slik at admin-UI kan utvide
--     uten migrasjoner.
--   * `app_game1_pot_events` er append-only audit-log: hver akkumulering,
--     hver vinn, hver reset og hver konfigurasjonsendring registreres med
--     delta og ny balanse. Brukes for rapportering og regulatorisk
--     sporbarhet (pengespillforskriften § 11).
--
-- Konvensjoner (matcher øvrige app_* tabeller):
--   * TEXT PRIMARY KEY (ikke UUID-type); UUID-strenger genereres i service via
--     randomUUID() og skrives som tekst.
--   * TIMESTAMPTZ NOT NULL DEFAULT now() på lifecycle-timestamps.
--   * ON DELETE RESTRICT på hall_id, scheduled_game_id (for å bevare
--     audit-trail selv om hall/spill senere slettes softly).
--   * CREATE TABLE IF NOT EXISTS for re-run-trygghet.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_game1_accumulating_pots (
  id                    TEXT PRIMARY KEY,
  hall_id               TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- pot_key: fri tekst, f.eks. "jackpott" | "innsatsen". Kombinert med
  -- hall_id må være unik — hver hall kan ha én pot per key.
  pot_key               TEXT NOT NULL,
  -- Menneskelig navn vist i admin-UI. Ikke unik.
  display_name          TEXT NOT NULL,
  -- Nåværende pot-saldo i øre. Etter reset = seed_amount_cents (fra config).
  current_amount_cents  BIGINT NOT NULL DEFAULT 0,
  -- Pot-konfigurasjon:
  --   {
  --     seedAmountCents:       int,           // reset-sokkel
  --     dailyBoostCents:       int,           // daglig auto-påfyll (0 = av)
  --     salePercentBps:        int,           // basispoeng av billett-salg (0..10000)
  --     maxAmountCents:        int | null,    // cap (null = ingen)
  --     winRule: {
  --       kind: "phase_at_or_before_draw",   // kun variant støttet i T1
  --       phase: int,                         // 1..5
  --       drawThreshold: int                  // vunnet PÅ eller FØR denne draw-sekvensen
  --     },
  --     ticketColors: string[]               // tillatt ticket-color (tom = alle)
  --   }
  config_json           JSONB NOT NULL,
  -- Sist gang daglig boost ble applisert (UTC-dato som tekst "YYYY-MM-DD" slik
  -- at idempotens-sjekken ikke avhenger av timezone). NULL = aldri.
  last_daily_boost_date TEXT NULL,
  -- Sist gang pot ble resatt (etter win eller admin-override). NULL = aldri.
  last_reset_at         TIMESTAMPTZ NULL,
  last_reset_reason     TEXT NULL,
  -- Lifecycle.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT t1_unique_hall_pot_key UNIQUE (hall_id, pot_key)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_accumulating_pots') THEN
    EXECUTE $stmt$ COMMENT ON TABLE  app_game1_accumulating_pots IS 'PR-T1: Akkumulerende pot-er (Jackpott, Innsatsen) som lever mellom Spill 1-økter.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_accumulating_pots' AND column_name='pot_key') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_accumulating_pots.pot_key               IS 'PR-T1: fri-tekst-identifikator per pot-type per hall, f.eks. "jackpott".' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_accumulating_pots.pot_key';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_accumulating_pots' AND column_name='display_name') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_accumulating_pots.display_name          IS 'PR-T1: menneskelig navn vist i admin-UI og eventuelt spiller-UI.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_accumulating_pots.display_name';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_accumulating_pots' AND column_name='current_amount_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_accumulating_pots.current_amount_cents  IS 'PR-T1: nåværende pot-saldo i øre. Økes av accumulateDaily/accumulateFromSale, resettes av tryWin/resetPot.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_accumulating_pots.current_amount_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_accumulating_pots' AND column_name='config_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_accumulating_pots.config_json           IS 'PR-T1: pot-regler (seed, daily-boost, sale-andel, win-rule, ticketColors) — se migration-header for skjema.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_accumulating_pots.config_json';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_accumulating_pots' AND column_name='last_daily_boost_date') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_accumulating_pots.last_daily_boost_date IS 'PR-T1: UTC-dato (YYYY-MM-DD) siste daglige boost ble applisert. Brukes for idempotens.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_accumulating_pots.last_daily_boost_date';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_accumulating_pots' AND column_name='last_reset_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_accumulating_pots.last_reset_at         IS 'PR-T1: tidspunkt for siste reset (win eller admin-override).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_accumulating_pots.last_reset_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_accumulating_pots' AND column_name='last_reset_reason') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_accumulating_pots.last_reset_reason     IS 'PR-T1: fri-tekst begrunnelse for siste reset.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_accumulating_pots.last_reset_reason';
  END IF;
END $sync$;

-- Audit-log (append-only). Skal aldri UPDATE-es.
CREATE TABLE IF NOT EXISTS app_game1_pot_events (
  id                   TEXT PRIMARY KEY,
  pot_id               TEXT NOT NULL REFERENCES app_game1_accumulating_pots(id) ON DELETE RESTRICT,
  hall_id              TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  -- Hvilken type endring. T1-kjente verdier:
  --   "init"      — pot opprettet
  --   "daily"     — daglig boost applisert
  --   "sale"      — andel av billett-salg akkumulert
  --   "win"       — pot utbetalt + reset
  --   "reset"     — admin-reset uten win
  --   "config"    — kun config_json endret (delta=0)
  event_kind           TEXT NOT NULL,
  -- Endring i øre (positiv for akkumulering, negativ for win/reset). 0 for "config".
  delta_cents          BIGINT NOT NULL,
  -- Saldo ETTER denne hendelsen. Redundant med kjede av delta_cents, men
  -- gjør rapport-queryer enormt mye enklere.
  balance_after_cents  BIGINT NOT NULL,
  -- Valgfri referanse til scheduled-game som utløste hendelsen (sale/win).
  scheduled_game_id    TEXT NULL REFERENCES app_game1_scheduled_games(id) ON DELETE RESTRICT,
  -- Valgfri ticket-purchase-id (for "sale" — hvilket kjøp utløste andelen).
  ticket_purchase_id   TEXT NULL,
  -- Valgfri vinner-user-id (for "win").
  winner_user_id       TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  -- Valgfri ticket-color (for "win" — hvilken farge vant).
  winner_ticket_color  TEXT NULL,
  -- Fri-tekst ekstra context (f.eks. "rtp_cap_reached", "manual_admin_reset").
  reason               TEXT NULL,
  -- Snapshot av config_json ved tidspunkt for hendelsen. Brukes for å
  -- reprodusere win-beregning selv om admin senere endrer config.
  config_snapshot_json JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_pot_events') THEN
    EXECUTE $stmt$ COMMENT ON TABLE  app_game1_pot_events IS 'PR-T1: Append-only audit-log for alle pot-endringer (init/daily/sale/win/reset/config).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='event_kind') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.event_kind           IS 'PR-T1: hendelsestype — "init" | "daily" | "sale" | "win" | "reset" | "config".' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.event_kind';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='delta_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.delta_cents          IS 'PR-T1: endring i øre (positiv for akkumulering, negativ for win/reset, 0 for config).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.delta_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='balance_after_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.balance_after_cents  IS 'PR-T1: pot-saldo ETTER denne hendelsen — redundant men gir raske rapport-queryer.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.balance_after_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='scheduled_game_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.scheduled_game_id    IS 'PR-T1: hvilken Spill 1-økt utløste hendelsen (sale/win). NULL for daily/config/init/manual reset.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.scheduled_game_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='ticket_purchase_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.ticket_purchase_id   IS 'PR-T1: hvilket billett-kjøp utløste andel-akkumulering (sale). NULL for andre event_kinds.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.ticket_purchase_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='winner_user_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.winner_user_id       IS 'PR-T1: vinner (win). NULL for andre event_kinds.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.winner_user_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='winner_ticket_color') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.winner_ticket_color  IS 'PR-T1: vinner ticket-color (win). NULL for andre event_kinds.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.winner_ticket_color';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_pot_events' AND column_name='config_snapshot_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_pot_events.config_snapshot_json IS 'PR-T1: snapshot av config_json på hendelses-tidspunktet — beviser hvilke regler vinn ble beregnet mot.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_pot_events.config_snapshot_json';
  END IF;
END $sync$;

-- Hot query: "hvilke pot-er for denne hallen?"
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_accumulating_pots') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_t1_pots_hall
  ON app_game1_accumulating_pots (hall_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_accumulating_pots';
  END IF;
END $sync$;

-- Hot query: "alle events for denne pot-en (admin audit-vis)".
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_pot_events') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_t1_pot_events_pot
  ON app_game1_pot_events (pot_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_pot_events';
  END IF;
END $sync$;

-- Hot query: "win-events i tidsintervall for rapport".
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_pot_events') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_t1_pot_events_win
  ON app_game1_pot_events (created_at DESC)
  WHERE event_kind = 'win' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_pot_events';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260611000000_game1_accumulating_pots', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260611000000_game1_accumulating_pots');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260700000000_cms_content_versions
-- Class: NOT-APPLIED-NEEDS-PREDECESSOR
-- Reason: depends on tables created in earlier pending migrations: app_cms_content (created in 20260426000200_cms)
-- ──────────────────────────────────────────────────────────────────────────────
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

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_content_versions') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_cms_content_versions IS
  'BIN-680 Lag 1: versjonert historikk for regulatorisk CMS-tekst. Append-only; kun status + approvedBy/publishedBy/retired-metadata oppdateres.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_cms_content_versions' AND column_name='status') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_cms_content_versions.status IS
  'BIN-680 state-machine: draft → review → approved → live → retired. Håndheves av service-laget.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_cms_content_versions.status';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_cms_content_versions' AND column_name='version_number') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_cms_content_versions.version_number IS
  'BIN-680: monotont per slug. Tildelt av service-laget (max+1) i samme transaksjon som INSERT.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_cms_content_versions.version_number';
  END IF;
END $sync$;

-- Partial index: de-facto unik live-versjon per slug. Gir O(1) lookup til
-- "current live" uten å scanne hele historikken. Delvis unique-constraint
-- håndheves ikke på DB (fordi to haller kunne i teorien kjøre race), men
-- service-laget holder live → retired i én transaksjon.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_content_versions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_cms_content_versions_slug_live
  ON app_cms_content_versions(slug) WHERE status = 'live' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_cms_content_versions';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_content_versions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_cms_content_versions_slug_history
  ON app_cms_content_versions(slug, version_number DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_cms_content_versions';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_content_versions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_cms_content_versions_status
  ON app_cms_content_versions(status) WHERE status IN ('draft', 'review', 'approved') $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_cms_content_versions';
  END IF;
END $sync$;

-- ── Forward-compat on app_cms_content ─────────────────────────────────────
--
-- `app_cms_content` beholdes uendret for backwards-compat med BIN-676-kode
-- som enda ikke er portet til versjons-APIet (f.eks. andre slugs som ikke
-- krever versjonering). To nye kolonner gir optimalisert FK til live-versjon
-- slik at player-facing reads (Lag 2) kan slå opp uten dobbel-query.

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_cms_content') THEN
    EXECUTE $stmt$ ALTER TABLE app_cms_content
  ADD COLUMN IF NOT EXISTS live_version_id     TEXT NULL REFERENCES app_cms_content_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS live_version_number INTEGER NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_cms_content';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_cms_content' AND column_name='live_version_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_cms_content.live_version_id IS
  'BIN-680 Lag 1: FK til gjeldende live-versjon i app_cms_content_versions. NULL for slugs som ikke er versjonert enda.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_cms_content.live_version_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_cms_content' AND column_name='live_version_number') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_cms_content.live_version_number IS
  'BIN-680 Lag 1: denormalisert versjons-nummer for rask visning uten join.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_cms_content.live_version_number';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260700000000_cms_content_versions', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260700000000_cms_content_versions');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260701000000_hall_number
-- Class: PARTIALLY-APPLIED
-- Reason: 1 present, 2 missing
-- ──────────────────────────────────────────────────────────────────────────────
-- Hall Number — integer identifier per hall (101, 102, ...) fra legacy-spec
-- (Admin V1.0 pages 20-28 + Admin CR 21.02.2024).
--
-- Bakgrunn:
--   Legacy-systemet bruker `hall_number` som menneskelig-lesbart heltall for
--   å mappe IP-baserte player-registreringer til riktig hall + for Import
--   Player Excel-mapping (hall_number → hall_id ved bulk-import). `slug` er
--   en intern teknisk nøkkel (URL-safe string) — hall_number er det
--   operatøren faktisk bruker i UI-et.
--
-- Designvalg:
--   * INT NULL UNIQUE: null i første omgang (ingen backfill ennå — PM vil
--     fylle inn per hall senere). UNIQUE på non-null-verdier forhindrer
--     dubletter når feltet først blir satt.
--   * Ingen CHECK-constraint på range: legacy bruker 101/102/... men det er
--     ikke regulatorisk bindende. Admin-UI validerer at verdien er
--     positivt heltall.
--   * Partial-indeks (WHERE NOT NULL) slik at vi kan raskt slå opp hall
--     basert på hall_number uten at NULL-ene gir plassbruk.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_halls') THEN
    EXECUTE $stmt$ ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS hall_number INT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_halls';
  END IF;
END $sync$;

-- Separate statement så IF NOT EXISTS på constraint fungerer riktig.
-- (Postgres støtter ikke IF NOT EXISTS på ADD CONSTRAINT direkte, men vi
-- kan sjekke mot pg_constraint først.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_halls_hall_number_unique'
  ) THEN
    ALTER TABLE app_halls
      ADD CONSTRAINT app_halls_hall_number_unique UNIQUE (hall_number);
  END IF;
END $$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_halls' AND column_name='hall_number') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_halls.hall_number IS
  'Legacy Hall Number (101, 102, ...) brukt for IP→hall-mapping og Import Player Excel. UNIQUE når ikke NULL.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_halls.hall_number';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_halls') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_halls_hall_number
  ON app_halls (hall_number)
  WHERE hall_number IS NOT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_halls';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260701000000_hall_number', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260701000000_hall_number');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260705000000_agent_permissions
-- Class: NOT-APPLIED
-- Reason: 2 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- Agent Role Management (Admin CR 21.02.2024 side 5 + Agent V1.0 permissions).
--
-- Bakgrunn:
--   Legacy Admin har per-agent permission-matrix som styrer hvilke admin-
--   moduler en agent har tilgang til. Wireframe-spec (2024-02-21) definerer
--   15 moduler * 4-5 actions (Create/Edit/View/Delete + Block/Unblock for
--   Player Management).
--
-- Design:
--   * `app_agent_permissions` holder én rad per (agent_user_id, module).
--     Finnes ingen rad → ingen tilgang (fail closed).
--   * Modul-kolonnen er begrenset av CHECK-constraint til de 15 kjente
--     modulene fra wireframe; dette speiler TypeScript-union-typen i
--     AgentPermissionService.ts slik at DB + kode er sammenkoblet.
--   * Action-kolonnene er boolean-bitmap: `can_create`, `can_edit`,
--     `can_view`, `can_delete`. `can_block_unblock` er spesifikt for
--     Player Management (Block/Unblock fra wireframe — ikke Create/Edit/
--     View/Delete).
--   * `updated_by` peker på admin-brukeren som sist endret raden (audit-
--     trail, ved siden av AuditLog-service). ON DELETE SET NULL hvis admin
--     slettes soft.
--
-- By-default (ikke lagret, håndheves i service-laget):
--   * Player Management (alle actions) + Cash In/Out Management.
--   * Disse gjelder alle agenter og kan IKKE endres av admin.
--
-- Hall-scoping:
--   * Selve permissions-matrix er IKKE hall-scoped — admin kan
--     konfigurere per-agent. Hall-filter skjer på data-lag (IP-matching
--     + app_agent_halls join ved runtime enforcement).
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent via CREATE TABLE
-- IF NOT EXISTS.

-- Up migration
--
-- NB: `agent_user_id` og `updated_by` er TEXT (ikke UUID) for å matche
-- `app_users.id` som er TEXT PRIMARY KEY (se 20260413000001_initial_schema.sql
-- linje 61). FK-er mot app_users MÅ bruke samme datatype — UUID-deklarasjon
-- her ga "foreign key constraint cannot be implemented" på fresh DB. `id`-
-- kolonnen beholder UUID siden den er intern primærnøkkel uten FK utover.
CREATE TABLE IF NOT EXISTS app_agent_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN (
    'player',
    'schedule',
    'game_creation',
    'saved_game',
    'physical_ticket',
    'unique_id',
    'report',
    'wallet',
    'transaction',
    'withdraw',
    'product',
    'hall_account',
    'hall_specific_report',
    'payout',
    'accounting'
  )),
  can_create BOOLEAN NOT NULL DEFAULT false,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  -- Player Management only — ikke relevant for andre moduler (lagres 'false').
  can_block_unblock BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  CONSTRAINT uq_app_agent_permissions_agent_module UNIQUE (agent_user_id, module)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_permissions') THEN
    EXECUTE $stmt$ COMMENT ON TABLE  app_agent_permissions IS 'Per-agent permission-matrix (wireframe 2024-02-21 side 5). En rad per (agent, modul).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_permissions' AND column_name='module') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_permissions.module          IS 'Modul-nøkkel fra wireframe-spec. CHECK-constraint matcher TypeScript-union AgentPermissionModule.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_permissions.module';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_permissions' AND column_name='can_block_unblock') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_permissions.can_block_unblock IS 'Player Management only (Block/Unblock — ikke Create/Edit/View/Delete for spillere).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_permissions.can_block_unblock';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_permissions' AND column_name='updated_by') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_permissions.updated_by      IS 'Admin-user-id som sist endret raden. Audit-trail ved siden av AuditLog-service.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_permissions.updated_by';
  END IF;
END $sync$;

-- Hot query: "hent alle permissions for denne agenten" (GET-endepunkt).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_permissions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_agent_permissions_agent
  ON app_agent_permissions (agent_user_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_agent_permissions';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260705000000_agent_permissions', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260705000000_agent_permissions');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260706000000_app_notifications_and_devices
-- Class: NOT-APPLIED
-- Reason: 7 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-FCM: push-notifikasjoner for mobil-app (Firebase Cloud Messaging).
--
-- Porterer legacy-backend sitt fcm-node/fcm-notification-subsystem:
--   * `sendGameStartNotifications` (cron hver 1min, pre-game-varsler)
--   * `EnableNotification` / `UpdateFirebaseToken` (socket — device-registrering)
--   * `PlayerNotifications` / `sendMulNotifications` (socket — send varsel)
--
-- To tabeller:
--
-- 1) `app_user_devices` — hvilke devices (iOS/Android) en spiller har registrert
--    FCM-token for. Én spiller kan ha flere devices (telefon + tablet),
--    derfor egen tabell framfor enkel `firebase_token`-kolonne på `app_users`.
--    `is_active` styres av service-laget (mark=false når FCM returnerer
--    UNREGISTERED — vi beholder raden for audit/debug i stedet for DELETE).
--
-- 2) `app_notifications` — historisk logg over varsler sendt til spillere.
--    Både for visning i app (GET /api/notifications) og for trace/debug
--    når FCM svarer failed. JSONB `data`-kolonne rommer deep-link-payload
--    (gameId, url osv).
--
-- Design-valg:
--   * `type` er fritekst (ikke enum) slik at nye varseltyper kan legges
--     til uten migration. Service-laget har konstant-liste som valideres
--     før insert — DB er bare lagring.
--   * `title` / `body` er lagret som strings (ikke JSONB) for nå.
--     Multi-språk kan legges til som egen `locale`-kolonne senere hvis
--     behov — pilot kjører bare på norsk.
--   * `fcm_message_id` er responsen fra FCM (`projects/.../messages/xyz`)
--     slik at ops kan korrelere med Firebase-console.
--   * `status` styres gjennom livssyklus:
--         `pending`  — rad opprettet, ikke sendt til FCM enda
--         `sent`     — FCM har akseptert (men ikke nødvendigvis levert)
--         `failed`   — FCM avviste (se `error_message`)
--   * `read_at` / `delivered_at` er valgfrie — vi oppdaterer dem kun når
--     vi får signal (in-app les, eller mobil-app ACK via egen endpoint).
--
-- Forward-only (BIN-661): ingen Down-seksjon. Idempotent via
-- `CREATE TABLE IF NOT EXISTS`.

-- Up migration
--
-- NB: `user_id` er TEXT (ikke UUID) for å matche `app_users.id` som er
-- TEXT PRIMARY KEY (se 20260413000001_initial_schema.sql linje 61). FK-er
-- mot app_users MÅ bruke samme datatype — UUID-deklarasjon her ga
-- "foreign key constraint cannot be implemented" på fresh DB. `id`-kolonnen
-- beholder UUID siden den er intern primærnøkkel uten FK utover.

CREATE TABLE IF NOT EXISTS app_user_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  firebase_token  TEXT NOT NULL,
  device_type     TEXT NOT NULL CHECK (device_type IN ('ios', 'android', 'web')),
  device_label    TEXT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_user_devices_token UNIQUE (firebase_token)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_user_devices') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_user_devices IS
  'BIN-FCM: FCM-tokens per device for mobil-app push-notifikasjoner. Unique på token for å matche legacy-dedupering.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_user_devices' AND column_name='firebase_token') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_user_devices.firebase_token IS
  'FCM registration token fra Firebase SDK på klient. Kan roteres — klient POST-er ny token til /api/notifications/device ved endring.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_user_devices.firebase_token';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_user_devices' AND column_name='is_active') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_user_devices.is_active IS
  'False når FCM returnerer UNREGISTERED/INVALID_ARGUMENT — beholdes for audit, ekskluderes fra fan-out.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_user_devices.is_active';
  END IF;
END $sync$;

-- Hot queries: "finn alle aktive devices for user X" (fan-out ved send)
-- og "finn device på token" (register/unregister).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_user_devices') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_user_devices_user_active
  ON app_user_devices (user_id)
  WHERE is_active = true $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_user_devices';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_user_devices') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_user_devices_last_seen
  ON app_user_devices (last_seen_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_user_devices';
  END IF;
END $sync$;

CREATE TABLE IF NOT EXISTS app_notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  fcm_message_id   TEXT NULL,
  error_message    TEXT NULL,
  sent_at          TIMESTAMPTZ NULL,
  delivered_at     TIMESTAMPTZ NULL,
  read_at          TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_notifications') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_notifications IS
  'BIN-FCM: historisk logg over push-notifikasjoner. Brukes både for in-app-liste (GET /api/notifications) og for trace/debug ved FCM-feil.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_notifications' AND column_name='type') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_notifications.type IS
  'Fritekst-type, eks "game-start", "bonus", "rg-warning", "deposit-confirmed". Validert av FcmPushService før insert.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_notifications.type';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_notifications' AND column_name='data') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_notifications.data IS
  'Deep-link-payload: { gameId, url, scheduledGameId, ... }. Sendes også til FCM som data-payload slik at klient kan route.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_notifications.data';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_notifications' AND column_name='status') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_notifications.status IS
  'pending=opprettet men ikke sendt. sent=FCM akseptert. delivered=klient ACK. failed=FCM avviste (se error_message).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_notifications.status';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_notifications' AND column_name='fcm_message_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_notifications.fcm_message_id IS
  'Firebase message-name (f.eks. projects/<project>/messages/<id>). Brukes for korrelasjon med Firebase-console.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_notifications.fcm_message_id';
  END IF;
END $sync$;

-- Hot queries: "hent siste varsler for user X" (inbox) + "finn ulest".
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_notifications') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_notifications_user_created
  ON app_notifications (user_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_notifications';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_notifications') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_notifications_user_unread
  ON app_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_notifications';
  END IF;
END $sync$;

-- For cron-job som sjekker "har vi allerede sendt game-start for denne runden?"
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_notifications') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_notifications_type_data
  ON app_notifications (type, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_notifications';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260706000000_app_notifications_and_devices', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260706000000_app_notifications_and_devices');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260723000000_voucher_redemptions
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-587 B4b follow-up: voucher redemption-historikk (player-side flow).
--
-- Admin-CRUD over app_vouchers kom i migrasjon 20260418240000. Denne
-- migrasjonen legger til app_voucher_redemptions som logger hver gang en
-- spiller faktisk INNLØSER en voucher-kode under spill (G2/G3 ad-hoc-rom,
-- og etterhvert G1 scheduled-games).
--
-- Design-prinsipper:
--   - (voucher_id, user_id) er UNIQUE: samme spiller kan ikke bruke samme
--     voucher to ganger. Legacy `ApplyVoucherCode`-socket i G2/G3 hadde
--     tilsvarende one-per-player-regel.
--   - game_slug + scheduled_game_id + room_code er diagnostikk/audit; ingen
--     foreign keys til G1/G2/G3-spesifikke tabeller fordi scope dekker
--     flere game-modeller (scheduled vs ad-hoc).
--   - discount_applied_cents er applied beløp (ikke voucher-value): for en
--     PERCENTAGE-voucher på 25% og et ticket-kjøp på 100 kr, logges 25*100
--     = 2500 cents. Gjør det enkelt å rapportere hvor mye "gave-penger"
--     vouchere har kostet huset.
--
-- Idempotens er kombinasjonen (voucher_id, user_id). Service-laget gjør
-- atomisk INSERT + UPDATE app_vouchers.uses_count i samme transaksjon.
--
-- Up migration

CREATE TABLE IF NOT EXISTS app_voucher_redemptions (
  id                        TEXT PRIMARY KEY,
  voucher_id                TEXT NOT NULL
                              REFERENCES app_vouchers(id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL
                              REFERENCES app_users(id) ON DELETE CASCADE,
  wallet_id                 TEXT NOT NULL,
  game_slug                 TEXT NOT NULL,
  scheduled_game_id         TEXT NULL,
  room_code                 TEXT NULL,
  discount_applied_cents    BIGINT NOT NULL CHECK (discount_applied_cents >= 0),
  redeemed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- En spiller kan ikke innløse samme voucher to ganger
  UNIQUE (voucher_id, user_id)
);

-- Vanlig oppslag: "har denne spilleren brukt denne koden?"
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_voucher_redemptions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_voucher_redemptions_user_voucher
  ON app_voucher_redemptions(user_id, voucher_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_voucher_redemptions';
  END IF;
END $sync$;

-- Rapporter: "alle innløsninger i tidsrom"
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_voucher_redemptions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_voucher_redemptions_redeemed_at
  ON app_voucher_redemptions(redeemed_at) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_voucher_redemptions';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_voucher_redemptions') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_voucher_redemptions IS
  'BIN-587 B4b follow-up: spiller-side voucher-innløsning. En rad per (voucher, spiller) — unik-constraint håndhever en innløsning per spiller per kode.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_voucher_redemptions' AND column_name='discount_applied_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_voucher_redemptions.discount_applied_cents IS
  'Faktisk rabattbeløp påført i cents (ikke voucher-value). For PERCENTAGE-vouchere = ticket-pris × value/100.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_voucher_redemptions.discount_applied_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_voucher_redemptions' AND column_name='scheduled_game_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_voucher_redemptions.scheduled_game_id IS
  'Referanse til app_game1_scheduled_games hvis spillet tilhører scheduled-modell; NULL for ad-hoc G2/G3-rom.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_voucher_redemptions.scheduled_game_id';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260723000000_voucher_redemptions', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260723000000_voucher_redemptions');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260724000000_game1_mini_game_mystery
-- Class: NOT-APPLIED
-- Reason: 1 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-MYSTERY M6: utvid `app_game1_mini_game_results.mini_game_type` CHECK
-- slik at verdien 'mystery' aksepteres for den nye Mystery Game mini-gamet.
--
-- Se: apps/backend/src/game/minigames/MiniGameMysteryEngine.ts — ny engine
-- implementerer `MiniGame`-interfacet med type="mystery" (portet 1:1 fra
-- legacy Unity MysteryGamePanel.cs, commit 5fda0f78).
--
-- Mystery Game er stateless per spill (single-call multi-round med seeded-
-- RNG i trigger+handleChoice). Krever ingen egen state-tabell — alt lagres
-- i `app_game1_mini_game_results.result_json` ved completion. Derfor kun
-- CHECK-utvidelse, ingen ny tabell.
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

-- PostgreSQL krever DROP + ADD for å endre CHECK-constraint. IF EXISTS slik
-- at migrasjonen er idempotent mot partial-applied databaser.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_mini_game_results') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_mini_game_results
  DROP CONSTRAINT IF EXISTS app_game1_mini_game_results_mini_game_type_check $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_mini_game_results';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_mini_game_results') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_mini_game_results
  ADD CONSTRAINT app_game1_mini_game_results_mini_game_type_check
    CHECK (mini_game_type IN (
      'wheel',
      'chest',
      'colordraft',
      'oddsen',
      'mystery'
    )) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_mini_game_results';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_mini_game_results' AND column_name='mini_game_type') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_mini_game_results.mini_game_type IS
  'BIN-690 M1 + BIN-MYSTERY M6: framework-type-discriminator. Matcher MiniGame.type i backend/src/game/minigames/types.ts. Verdier: wheel | chest | colordraft | oddsen | mystery.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_mini_game_results.mini_game_type';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260724000000_game1_mini_game_mystery', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260724000000_game1_mini_game_mystery');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260724001000_app_unique_ids
-- Class: NOT-APPLIED
-- Reason: 8 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- Wireframe gaps #8/#10/#11 (2026-04-24): Agent Unique ID cards.
--
-- Port of legacy V1.0 "Unique ID"-flow (wireframes 17.9/17.10/17.11/17.26/
-- 17.27/17.28). A Unique ID is a play-card that belongs to the HALL (not
-- a player): the agent creates it at the counter, the customer pays cash/
-- card, the card's balance can be topped up ("Add Money") or withdrawn
-- (cash only), and its lifecycle tracks re-prints + re-generates.
--
-- PM-locked rule (Q4): Add Money AKKUMULERES — 200 kr added to a card
-- with 170 kr becomes 370 kr. Balance is NEVER overwritten.
--
-- ───────── Schema ─────────
-- `app_unique_ids` — one row per issued card.
--   id                 TEXT PRIMARY KEY  — the printed card number (string)
--   hall_id            FK app_halls       — which hall issued the card
--   balance_cents      NUMERIC(14, 2)     — current balance (accumulates)
--   purchase_date      TIMESTAMPTZ        — when the card was created
--   expiry_date        TIMESTAMPTZ        — purchase + hours_validity
--   hours_validity     INTEGER            — min 24
--   payment_type       TEXT               — CASH | CARD (at create-time)
--   created_by_agent_id  FK app_users     — the agent that created it
--   printed_at         TIMESTAMPTZ        — first PRINT (on create)
--   reprinted_count    INTEGER            — # times re-printed
--   last_reprinted_at  TIMESTAMPTZ
--   last_reprinted_by  FK app_users
--   status             TEXT               — ACTIVE | WITHDRAWN | REGENERATED | EXPIRED
--   regenerated_from_id TEXT              — if this card replaces an older one
--   created_at/updated_at
--
-- `app_unique_id_transactions` — audit trail of CREATE/ADD_MONEY/WITHDRAW/
--   REGENERATE events. Append-only — balance mutations go through this log.
--
-- Up migration.

CREATE TABLE IF NOT EXISTS app_unique_ids (
  id                    TEXT PRIMARY KEY,
  hall_id               TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  balance_cents         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  purchase_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expiry_date           TIMESTAMPTZ NOT NULL,
  hours_validity        INTEGER NOT NULL CHECK (hours_validity >= 24),
  payment_type          TEXT NOT NULL CHECK (payment_type IN ('CASH', 'CARD')),
  created_by_agent_id   TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  printed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  reprinted_count       INTEGER NOT NULL DEFAULT 0 CHECK (reprinted_count >= 0),
  last_reprinted_at     TIMESTAMPTZ NULL,
  last_reprinted_by     TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
                          status IN ('ACTIVE', 'WITHDRAWN', 'REGENERATED', 'EXPIRED')
                        ),
  regenerated_from_id   TEXT NULL REFERENCES app_unique_ids(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_ids') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_unique_ids_hall_created
  ON app_unique_ids(hall_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_unique_ids';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_ids') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_unique_ids_agent
  ON app_unique_ids(created_by_agent_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_unique_ids';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_ids') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_unique_ids_status
  ON app_unique_ids(status, expiry_date) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_unique_ids';
  END IF;
END $sync$;

CREATE TABLE IF NOT EXISTS app_unique_id_transactions (
  id                    TEXT PRIMARY KEY,
  unique_id             TEXT NOT NULL REFERENCES app_unique_ids(id) ON DELETE CASCADE,
  action_type           TEXT NOT NULL CHECK (action_type IN (
                          'CREATE', 'ADD_MONEY', 'WITHDRAW', 'REPRINT', 'REGENERATE'
                        )),
  amount_cents          NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  previous_balance      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  new_balance           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_type          TEXT NULL CHECK (payment_type IS NULL OR payment_type IN ('CASH', 'CARD')),
  agent_user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  game_type             TEXT NULL,
  reason                TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_id_transactions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_unique_id_tx_card
  ON app_unique_id_transactions(unique_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_unique_id_transactions';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_id_transactions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_unique_id_tx_agent
  ON app_unique_id_transactions(agent_user_id, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_unique_id_transactions';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_id_transactions') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_unique_id_tx_type
  ON app_unique_id_transactions(action_type, created_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_unique_id_transactions';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_ids') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_unique_ids IS
  'Agent-facing Unique ID cards (V1.0 wireframes 17.9-17.28). Balance accumulates via Add Money; withdraw is cash-only.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_unique_ids' AND column_name='status') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_unique_ids.status IS
  'ACTIVE=usable, WITHDRAWN=balance zeroed via withdraw, REGENERATED=replaced by new id, EXPIRED=past expiry_date.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_unique_ids.status';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_unique_ids' AND column_name='regenerated_from_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_unique_ids.regenerated_from_id IS
  'If this card replaces a previous one (Re-Generate flow), points back to the source row for audit continuity.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_unique_ids.regenerated_from_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_unique_id_transactions') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_unique_id_transactions IS
  'Append-only audit + transaction log for Unique ID cards. All balance mutations recorded here.' $stmt$;
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260724001000_app_unique_ids', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260724001000_app_unique_ids');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260724100000_wallet_reservations
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-693 Option B: Wallet reservasjons-tabell for pre-round bong-kjøp.
--
-- PM-beslutning 2026-04-24 (Tobias): spiller skal se saldo-reduksjon
-- umiddelbart ved bet:arm, men uten å endre regulatorisk "kjøp-tidspunkt"
-- (compliance-ledger skrives fortsatt ved startGame). Mønsteret følger
-- kredittkort-autorisasjon: reservasjon → commit eller release.
--
-- Lifecycle:
--   1. bet:arm        → INSERT status='active'
--   2. ticket:cancel  → UPDATE amount_cents (prorata) eller status='released'
--   3. startGame      → status='committed', committed_at=NOW(), faktisk transfer skjer
--   4. game-abort     → status='released', released_at=NOW()
--   5. expiry-tick    → status='expired' hvis expires_at < NOW() OG status='active'
--                       (crash-recovery: stale reservation etter backend-krasj)
--
-- Idempotens: idempotency_key er UNIQUE. Samme key ved reconnect returnerer
-- eksisterende aktiv reservasjon i stedet for å lage ny. Format:
--   arm-${roomCode}-${playerId}-${hashOfSelections}
--
-- Tilgjengelig saldo (klient-visning):
--   available_balance = deposit_balance + winnings_balance
--                       − sum(reservations WHERE status='active' AND wallet_id=X)

CREATE TABLE IF NOT EXISTS app_wallet_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'committed', 'expired')),
  room_code TEXT NOT NULL,
  game_session_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ NULL,
  committed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- Effektiv lookup for "aktive reservasjoner på denne walleten" — primær-spørsmål
-- ved saldo-beregning og klient-visning.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_wallet_reservations') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_wallet_reservations_wallet_active
  ON app_wallet_reservations(wallet_id) WHERE status = 'active' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_wallet_reservations';
  END IF;
END $sync$;

-- Expiry-tick: sweep aktive reservasjoner med expires_at < NOW().
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_wallet_reservations') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_wallet_reservations_expires_active
  ON app_wallet_reservations(expires_at) WHERE status = 'active' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_wallet_reservations';
  END IF;
END $sync$;

-- Room-lookup: alle reservasjoner tilhørende et spesifikt rom. Brukes ved
-- game-abort (release all) og ved startGame (commit all).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_wallet_reservations') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_wallet_reservations_room
  ON app_wallet_reservations(room_code) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_wallet_reservations';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_wallet_reservations') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_wallet_reservations IS
  'BIN-693 Option B: wallet-reservasjoner for pre-round bong-kjøp. Commit skjer ved startGame (faktisk wallet-transfer + compliance-ledger-entry).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_wallet_reservations' AND column_name='idempotency_key') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_wallet_reservations.idempotency_key IS
  'Format: arm-${roomCode}-${playerId}-${hashOfSelections}. UNIQUE så reconnect/retry ikke dupliserer reservasjoner.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_wallet_reservations.idempotency_key';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_wallet_reservations' AND column_name='expires_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_wallet_reservations.expires_at IS
  'TTL 30 min. Crash-recovery: bakgrunns-tick marks active→expired hvis NOW() > expires_at.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_wallet_reservations.expires_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_wallet_reservations' AND column_name='game_session_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_wallet_reservations.game_session_id IS
  'NULL før commit. Settes av startGame når reservasjon konverteres til faktisk transfer.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_wallet_reservations.game_session_id';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260724100000_wallet_reservations', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260724100000_wallet_reservations');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260725000000_settlement_machine_breakdown
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- K1 settlement machine breakdown: utvider app_agent_settlements med full
-- 15-rad maskin-breakdown fra legacy wireframes (PDF 13 §13.5 + PDF 15 §15.8).
--
-- Regulatorisk: pengespillforskriften § 64 krever at vi kan rekonstruere
-- dagsoppgjør per maskin/kategori. Før denne endringen hadde vi kun
-- aggregerte shift-totaler (cash_in/out) + et fritekst `other_data`-felt.
-- Nå lagrer vi struktert 15-rad breakdown pluss bilag-dokument.
--
-- Design-valg: JSONB heller enn 45 dedikerte kolonner, fordi:
--   1. 15 maskiner × 3 IN/OUT/Sum-kolonner = 45 kolonner — SELECT * blir tungt
--   2. Enklere å utvide med nye maskin-typer uten migration-kostnad
--   3. JSONB er indeksbart for agg-queries (e.g. SUM per maskin-type)
--   4. Matcher hvordan B3.4/B3.5 allerede bruker `other_data` JSONB
--
-- Struktur av machine_breakdown JSONB (15 rader + calculations):
-- {
--   "rows": {
--     "metronia":            { "in_cents": 481000, "out_cents": 174800 },
--     "ok_bingo":            { "in_cents": 362000, "out_cents": 162500 },
--     "franco":              { "in_cents": 477000, "out_cents": 184800 },
--     "otium":               { "in_cents": 0,      "out_cents": 0 },
--     "norsk_tipping_dag":   { "in_cents": 0,      "out_cents": 0 },
--     "norsk_tipping_totall":{ "in_cents": 0,      "out_cents": 0 },
--     "rikstoto_dag":        { "in_cents": 0,      "out_cents": 0 },
--     "rikstoto_totall":     { "in_cents": 0,      "out_cents": 0 },
--     "rekvisita":           { "in_cents": 2500,   "out_cents": 0 },
--     "servering":           { "in_cents": 26000,  "out_cents": 0 },
--     "bilag":               { "in_cents": 0,      "out_cents": 0 },
--     "bank":                { "in_cents": 81400,  "out_cents": 81400 },
--     "gevinst_overfoering_bank": { "in_cents": 0, "out_cents": 0 },
--     "annet":               { "in_cents": 0,      "out_cents": 0 }
--   },
--   "ending_opptall_kassie_cents": 4613,
--   "innskudd_drop_safe_cents": 0,
--   "difference_in_shifts_cents": 0
-- }
--
-- Bilag-receipt lagres som base64 data-URL i eget JSONB-felt for å unngå
-- at vi må bygge ut S3/Render-disk-infrastruktur akkurat nå. Max 10 MB
-- håndheves i service-laget (index.ts aksepterer 15 MB body). Når vi
-- senere flytter til ekstern blob-storage, kan vi migrere feltet til URL.

-- Up migration

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_settlements') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_settlements
  ADD COLUMN IF NOT EXISTS machine_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_settlements';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_settlements') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_settlements
  ADD COLUMN IF NOT EXISTS bilag_receipt JSONB NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_settlements';
  END IF;
END $sync$;

-- GIN-indeks for aggregat-queries på maskin-type (f.eks. sum metronia/dag).
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_settlements') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_agent_settlements_machine_breakdown
  ON app_agent_settlements USING gin (machine_breakdown) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_agent_settlements';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_settlements' AND column_name='machine_breakdown') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_settlements.machine_breakdown IS
  'K1: 15-rad maskin-breakdown pr wireframe (PDF 13 §13.5, PDF 15 §15.8). Se migration-header for full struktur.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_settlements.machine_breakdown';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_settlements' AND column_name='bilag_receipt') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_settlements.bilag_receipt IS
  'K1: opplastet bilag (PDF/JPG) som JSON: { mime, filename, dataUrl, sizeBytes, uploadedAt }. NULL = ikke opplastet.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_settlements.bilag_receipt';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260725000000_settlement_machine_breakdown', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260725000000_settlement_machine_breakdown');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260726000000_game1_auto_pause_on_phase
-- Class: NOT-APPLIED-NEEDS-PREDECESSOR
-- Reason: depends on tables created in earlier pending migrations: app_game1_game_state (created in 20260501000200_app_game1_game_state)
-- ──────────────────────────────────────────────────────────────────────────────
-- Task 1.1: Auto-pause ved phase-won.
--
-- Gap #1 i docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md (PR #449).
-- Forankrer legacy-paritet: når Game1DrawEngineService detekterer at en fase
-- (rad 1..N / fullt hus) akkurat ble vunnet, skal engine auto-pause seg selv
-- og vente på manuell Resume fra master/agent. Datamodell: i tillegg til
-- `paused` (bool, eksisterer fra GAME1_SCHEDULE PR4b) trenger vi å spore
-- HVILKEN fase pause-en skjedde etter, slik at UI kan vise
-- "Pause etter Rad 1 — trykk Resume for Rad 2".
--
-- Designvalg:
--   * `paused_at_phase INT NULL` — sidecar til `paused`. NULL i hvilende
--     tilstand og når master har trykket Resume; satt til `current_phase`
--     ved auto-pause. Brukes av admin-UI for å rendre banner-tekst og av
--     test-suite for assertions.
--   * Ingen endring i semantikken til `paused`: true blokkerer
--     `drawNext()` (eksisterende guard i Game1DrawEngineService linje ~909)
--     og `Game1AutoDrawTickService.tick()` (eksisterende WHERE-filter
--     linje ~177).
--   * `status` (app_game1_scheduled_games) forblir 'running' under auto-
--     pause. Dette er bevisst — legacy hadde både `status='running'` og
--     `isPaused=true` som sidestate. Vi beholder DEN enkleste modellen:
--     `status='paused'` (master-initiert, eksplisitt), eller
--     `status='running' + paused=true` (auto-pause pga phase-won).
--     Resume skal håndtere begge caser; se Game1MasterControlService.
--   * Forward-only per BIN-661.
--
-- Up migration

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_game_state') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_game_state
  ADD COLUMN IF NOT EXISTS paused_at_phase INT NULL
    CHECK (paused_at_phase IS NULL OR (paused_at_phase >= 1 AND paused_at_phase <= 5)) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_game_state';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_game_state' AND column_name='paused_at_phase') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_game_state.paused_at_phase IS
  'Task 1.1: satt til current_phase når drawNext auto-pauser runden etter en phase-won. NULL når ikke auto-paused. Kombineres med paused=true. Nullstilles ved Resume.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_game_state.paused_at_phase';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260726000000_game1_auto_pause_on_phase', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260726000000_game1_auto_pause_on_phase');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260726100000_ticket_ranges_per_game
-- Class: NOT-APPLIED
-- Reason: 4 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-GAP#4 (wireframe 17.15 / 15.2) — Register Sold Tickets scanner med
-- carry-forward per spill + ticket-type.
--
-- Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.2 Register Sold Tickets"
--       docs/architecture/WIREFRAME_CATALOG.md § "15.10 Register More Tickets Modal"
--
-- Formål:
--   En agent registrerer per Game 1-instans hvor mange bonger som ble solgt
--   av hver ticket-type (Small Yellow, Small White, Large Yellow, Large White,
--   Small Purple, Large Purple). Per (game, hall, type) finnes én rad som
--   holder:
--     - initial_id: laveste ID i denne batch (carry-forward fra forrige spill,
--       eller fra hall-inventoriets startpunkt for første spill).
--     - final_id: høyeste ID scannet av agenten etter salg (usolgte bonger
--       begynner her i neste runde).
--     - sold_count: antall solgte bonger = final_id - initial_id (enkelt
--       numerisk område, ikke skip-step).
--     - round_number: rekkefølge av rundene i samme hall + type (1-basert).
--     - carried_from_game_id: forrige spill i samme hall + type (carry-forward
--       audit-trail). NULL ved første runde.
--
-- Designvalg:
--   * Separat fra `app_agent_ticket_ranges` fordi dette er et enklere model:
--     én rad per (game, hall, ticket_type) med numerisk initial/final, ikke
--     en JSONB-array av serials. PT2-flyten er barcode-first; 15.2-flyten er
--     counter-first. Begge eksisterer samtidig fordi de representerer ulike
--     salgs-scenarier.
--   * `ticket_type` er TEXT med CHECK — matcher wireframe-katalogens 6 typer.
--   * `sold_count` persisteres (ikke bare beregnet) for rapport-ytelse og
--     for å kunne overstyre ved spesielle scenarier (f.eks. ugyldig bong i
--     intervallet som må trekkes ut).
--   * UNIQUE (game_id, hall_id, ticket_type) — én rad per tuple. Insert eller
--     update er triggered av recordFinalIds-servicen.
--   * `carried_from_game_id` er self-referencing audit-link, ON DELETE SET NULL
--     for å beholde carry-forward-spor når game_id slettes.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

-- Up

CREATE TABLE IF NOT EXISTS app_ticket_ranges_per_game (
  id                    TEXT PRIMARY KEY,
  game_id               TEXT NOT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE CASCADE,
  hall_id               TEXT NOT NULL
                          REFERENCES app_halls(id) ON DELETE RESTRICT,
  ticket_type           TEXT NOT NULL
                          CHECK (ticket_type IN (
                            'small_yellow',
                            'small_white',
                            'large_yellow',
                            'large_white',
                            'small_purple',
                            'large_purple'
                          )),
  initial_id            INTEGER NOT NULL CHECK (initial_id >= 0),
  final_id              INTEGER NULL CHECK (final_id IS NULL OR final_id >= initial_id),
  sold_count            INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  round_number          INTEGER NOT NULL DEFAULT 1 CHECK (round_number >= 1),
  carried_from_game_id  TEXT NULL
                          REFERENCES app_game1_scheduled_games(id) ON DELETE SET NULL,
  recorded_by_user_id   TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  recorded_at           TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game') THEN
    EXECUTE $stmt$ COMMENT ON TABLE  app_ticket_ranges_per_game IS 'Register Sold Tickets-flyt (wireframe 15.2): per-game per-hall per-ticket-type range med initial_id (carry-forward) + final_id (scannet etter salg).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game' AND column_name='ticket_type') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_ticket_ranges_per_game.ticket_type          IS 'En av 6 typer: small_yellow, small_white, large_yellow, large_white, small_purple, large_purple.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_ticket_ranges_per_game.ticket_type';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game' AND column_name='initial_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_ticket_ranges_per_game.initial_id           IS 'Laveste ID i range (inklusiv). Carry-forward: nye rader arver verdien fra forrige rundes final_id for samme (hall, type).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_ticket_ranges_per_game.initial_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game' AND column_name='final_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_ticket_ranges_per_game.final_id             IS 'Høyeste ID scannet (inklusiv). NULL = ennå ikke registrert (pre-salg). Brukes også som initial_id for neste runde.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_ticket_ranges_per_game.final_id';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game' AND column_name='sold_count') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_ticket_ranges_per_game.sold_count           IS 'Persistert final_id - initial_id + 1 (hvis final_id IS NOT NULL). 0 før registrering.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_ticket_ranges_per_game.sold_count';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game' AND column_name='round_number') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_ticket_ranges_per_game.round_number         IS '1-basert rekkefølge for samme (hall, type). 1 = første runde fra hall-startpunkt.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_ticket_ranges_per_game.round_number';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game' AND column_name='carried_from_game_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_ticket_ranges_per_game.carried_from_game_id IS 'Audit-trail for carry-forward: forrige game_id i samme (hall, type). NULL for første runde.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_ticket_ranges_per_game.carried_from_game_id';
  END IF;
END $sync$;

-- UNIQUE: én rad per (game, hall, type) tuple.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game') THEN
    EXECUTE $stmt$ CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_ranges_per_game_unique
  ON app_ticket_ranges_per_game (game_id, hall_id, ticket_type) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_ticket_ranges_per_game';
  END IF;
END $sync$;

-- Carry-forward-oppslag: "finn forrige runde for (hall, type)". Sortert på
-- round_number DESC for raskeste LIMIT 1.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_ticket_ranges_per_game_hall_type_round
  ON app_ticket_ranges_per_game (hall_id, ticket_type, round_number DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_ticket_ranges_per_game';
  END IF;
END $sync$;

-- Rapport/summary-oppslag per game.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_ticket_ranges_per_game') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_ticket_ranges_per_game_game
  ON app_ticket_ranges_per_game (game_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_ticket_ranges_per_game';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260726100000_ticket_ranges_per_game', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260726100000_ticket_ranges_per_game');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260727000000_game1_master_transfer_requests
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- Task 1.6: `app_game1_master_transfer_requests` — runtime master-overføring.
--
-- Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md Appendix B.3 +
-- B.10. Legacy-referanse: legacy/unity-backend/Game/AdminEvents/AdminController/
-- AdminController.js linje 253-522 (`transferHallAccess` + `approveTransferHallAccess`).
--
-- Formål: spore agent-initierte master-hall-overføringer i Spill 1. Flow:
--   1. Agent på nåværende master-hall klikker "Overfør master til Hall B"
--      → INSERT rad med status='pending' og valid_till = NOW() + 60s.
--   2. Agent på target-hall godtar → UPDATE status='approved' og
--      `app_game1_scheduled_games.master_hall_id = to_hall_id`.
--      Alternativt avviser → UPDATE status='rejected'.
--   3. Hvis ingen svar innen 60s, expiry-tick UPDATE status='expired'.
--
-- Låst produkt-krav (PM-godkjent 2026-04-24):
--   * Agent-initiert (ikke admin-initiert)
--   * Target-hall aksepterer direkte (ingen admin-godkjenning-mellomtrinn)
--   * 60s TTL på request
--   * Én aktiv request om gangen per gameId — ny request kansellerer forrige
--   * Audit-logg via eksisterende `app_game1_master_audit` (ny action-type).
--
-- Designvalg:
--   * `id` UUID PRIMARY KEY med gen_random_uuid() default (matcher mønster i
--     nyere migrations som accumulating_pots / voucher_redemptions).
--   * `game_id` FK → app_game1_scheduled_games(id) med ON DELETE CASCADE —
--     requests er underordnet gameId, sletter vi spillet mister de mening.
--   * `from_hall_id` / `to_hall_id` TEXT uten FK (matcher pattern i
--     app_game1_master_audit hvor hall-referanser ikke er FK for å beholde
--     audit-trail selv om hall slettes).
--   * `initiated_by_user_id` TEXT uten FK (samme pattern).
--   * `status` CHECK-constraint — whitelist 4 states.
--   * `valid_till` brukes av expiry-tick (WHERE status='pending' AND valid_till < NOW()).
--   * `responded_by_user_id` NULLABLE — satt ved approve/reject.
--   * `reject_reason` NULLABLE — satt ved reject.
--   * `created_at` / `updated_at` TIMESTAMPTZ DEFAULT NOW().
--
-- Indekser:
--   * (game_id, status) — "finn aktiv pending request for gameId".
--   * (valid_till) WHERE status='pending' — expiry-tick scan.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

CREATE TABLE IF NOT EXISTS app_game1_master_transfer_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                TEXT NOT NULL
                           REFERENCES app_game1_scheduled_games(id) ON DELETE CASCADE,
  from_hall_id           TEXT NOT NULL,
  to_hall_id             TEXT NOT NULL,
  initiated_by_user_id   TEXT NOT NULL,
  initiated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_till             TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN (
                             'pending',
                             'approved',
                             'rejected',
                             'expired'
                           )),
  responded_by_user_id   TEXT NULL,
  responded_at           TIMESTAMPTZ NULL,
  reject_reason          TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_transfer_requests') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_master_transfer_game_status
  ON app_game1_master_transfer_requests(game_id, status) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_master_transfer_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_transfer_requests') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_game1_master_transfer_valid_till_pending
  ON app_game1_master_transfer_requests(valid_till)
  WHERE status = 'pending' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_game1_master_transfer_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_transfer_requests') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_game1_master_transfer_requests IS
  'Task 1.6: agent-initierte master-hall-overføringer for Spill 1. 60s TTL, én aktiv request per game. Approve → UPDATE app_game1_scheduled_games.master_hall_id.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_master_transfer_requests' AND column_name='status') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_master_transfer_requests.status IS
  'pending (awaiting response) | approved (master_hall_id updated) | rejected (target declined) | expired (TTL tick).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_master_transfer_requests.status';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_master_transfer_requests' AND column_name='valid_till') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_master_transfer_requests.valid_till IS
  'Request utløper automatisk hvis target ikke aksepterer innen denne tiden. Expiry-tick: UPDATE status=expired WHERE status=pending AND valid_till < NOW().' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_master_transfer_requests.valid_till';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260727000000_game1_master_transfer_requests', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260727000000_game1_master_transfer_requests');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260727000001_game1_master_audit_add_transfer_actions
-- Class: NOT-APPLIED
-- Reason: 1 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- Task 1.6: utvid `app_game1_master_audit.action`-whitelist med transfer-actions.
--
-- Game1TransferHallService skriver audit med action ∈ {
--   'transfer_request',
--   'transfer_approved',
--   'transfer_rejected',
--   'transfer_expired'
-- }.
--
-- Den eksisterende CHECK-constraint (fra migration
-- 20260428000200_game1_master_audit.sql) whitelist-er kun master-control-
-- actions (start/pause/resume/stop/exclude_hall/include_hall/
-- timeout_detected). Vi må drope og re-opprette constrainten med utvidet
-- liste.
--
-- Forward-only per BIN-661. Ingen Down-seksjon.
--
-- Up

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_audit') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_master_audit
  DROP CONSTRAINT IF EXISTS app_game1_master_audit_action_check $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_master_audit';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_master_audit') THEN
    EXECUTE $stmt$ ALTER TABLE app_game1_master_audit
  ADD CONSTRAINT app_game1_master_audit_action_check
    CHECK (action IN (
      'start',
      'pause',
      'resume',
      'stop',
      'exclude_hall',
      'include_hall',
      'timeout_detected',
      'transfer_request',
      'transfer_approved',
      'transfer_rejected',
      'transfer_expired'
    )) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_game1_master_audit';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_master_audit' AND column_name='action') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_master_audit.action IS
  'Task 1.6: utvidet whitelist med transfer_request/approved/rejected/expired for runtime master-overføring. Opprinnelig whitelist (PR 3): start, pause, resume, stop, exclude_hall, include_hall, timeout_detected.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_master_audit.action';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260727000001_game1_master_audit_add_transfer_actions', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260727000001_game1_master_audit_add_transfer_actions');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260810000000_withdraw_requests_bank_export
-- Class: PARTIALLY-APPLIED
-- Reason: 1 present, 7 missing
-- ──────────────────────────────────────────────────────────────────────────────
-- Withdraw in Bank XML-export (wireframe 16.20):
--
-- Utvider eksisterende `app_withdraw_requests` med bank-felter og
-- XML-eksport-sporing. Legger også til 'EXPORTED' som gyldig status-verdi
-- i CHECK-constraint.
--
-- Bakgrunn: PM har låst XML-per-agent-format 2026-04-24. Når en
-- bank-uttaksforespørsel godkjennes, havner den i en kø til neste
-- XML-eksport (daglig cron 23:00). Etter at XML-en er generert og
-- vedlagt på e-post til regnskaps-allowlisten, settes status til
-- 'EXPORTED' og exported_xml_batch_id peker til batch-raden.
--
-- Design-valg:
--   - UTVIDELSE av eksisterende tabell, ikke ny tabell (PR-B4/BIN-646
--     bygde schema'et og `PaymentRequestService` bruker det allerede).
--   - Nye kolonner er NULL-tillatt: legacy-rader mangler bank-detaljer,
--     men accept/export-flyten krever alle tre for bank-uttak —
--     håndheves i service-laget, ikke DB.
--   - `exported_xml_batch_id` peker til `app_xml_export_batches(id)`
--     som opprettes i den påfølgende migration-filen.
--   - Kolonnene `requested_at` og `approved_at` eksisterer allerede som
--     `created_at` og `accepted_at` — vi legger ikke til duplikater, men
--     service-laget exposer dem med de domene-spesifikke navnene.
--
-- Up migration

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_withdraw_requests') THEN
    EXECUTE $stmt$ ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_withdraw_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_withdraw_requests') THEN
    EXECUTE $stmt$ ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS bank_name TEXT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_withdraw_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_withdraw_requests') THEN
    EXECUTE $stmt$ ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS account_holder TEXT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_withdraw_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_withdraw_requests') THEN
    EXECUTE $stmt$ ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_withdraw_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_withdraw_requests') THEN
    EXECUTE $stmt$ ALTER TABLE app_withdraw_requests
  ADD COLUMN IF NOT EXISTS exported_xml_batch_id TEXT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_withdraw_requests';
  END IF;
END $sync$;

-- Utvid CHECK-constraint til å inkludere 'EXPORTED' som gyldig status.
-- DROP + re-add fordi constraint-navnet kan variere på tvers av miljøer.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'app_withdraw_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%PENDING%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE app_withdraw_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END$$;

-- [SKIPPED — constraint exists] ALTER TABLE app_withdraw_requests
-- [SKIPPED — constraint exists]   ADD CONSTRAINT app_withdraw_requests_status_check
-- [SKIPPED — constraint exists]     CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPORTED'));

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_withdraw_requests') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_exported_batch
  ON app_withdraw_requests (exported_xml_batch_id) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_withdraw_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_withdraw_requests') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_withdraw_requests_accepted_not_exported
  ON app_withdraw_requests (status, destination_type, accepted_at)
  WHERE status = 'ACCEPTED' AND destination_type = 'bank' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_withdraw_requests';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_withdraw_requests' AND column_name='bank_account_number') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_withdraw_requests.bank_account_number IS
  'Kontonummer for bank-overføring (wireframe 16.20). NULL for legacy + hall-utbetaling.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_withdraw_requests.bank_account_number';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_withdraw_requests' AND column_name='bank_name') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_withdraw_requests.bank_name IS
  'Banknavn (f.eks. "DNB"). NULL for legacy + hall-utbetaling.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_withdraw_requests.bank_name';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_withdraw_requests' AND column_name='account_holder') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_withdraw_requests.account_holder IS
  'Kontoeiers fulle navn. NULL for legacy + hall-utbetaling.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_withdraw_requests.account_holder';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_withdraw_requests' AND column_name='exported_at') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_withdraw_requests.exported_at IS
  'Når raden ble inkludert i en XML-batch (status EXPORTED).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_withdraw_requests.exported_at';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_withdraw_requests' AND column_name='exported_xml_batch_id') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_withdraw_requests.exported_xml_batch_id IS
  'FK til app_xml_export_batches. NULL før eksport.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_withdraw_requests.exported_xml_batch_id';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260810000000_withdraw_requests_bank_export', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260810000000_withdraw_requests_bank_export');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260810000100_xml_export_batches
-- Class: NOT-APPLIED
-- Reason: 3 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
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

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_xml_export_batches') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_xml_export_batches_agent_generated
  ON app_xml_export_batches (agent_user_id, generated_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_xml_export_batches';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_xml_export_batches') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_xml_export_batches_generated_at
  ON app_xml_export_batches (generated_at DESC) $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_xml_export_batches';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_xml_export_batches') THEN
    EXECUTE $stmt$ COMMENT ON TABLE app_xml_export_batches IS
  'Withdraw XML-eksport: én rad per generert XML-fil. PM-format 2026-04-24: én samlet XML per agent per dag.' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_xml_export_batches' AND column_name='recipient_emails') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_xml_export_batches.recipient_emails IS
  'Snapshot av app_withdraw_email_allowlist på sendtidspunkt. Senere endringer påvirker ikke historikk.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_xml_export_batches.recipient_emails';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_xml_export_batches' AND column_name='xml_file_path') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_xml_export_batches.xml_file_path IS
  'Absolutt sti til XML-filen på disk. WITHDRAW_XML_EXPORT_DIR kan konfigurere root-mappen.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_xml_export_batches.xml_file_path';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260810000100_xml_export_batches', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260810000100_xml_export_batches');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260811000000_halls_tv_voice_selection
-- Class: APPLIED-OUT-OF-BAND
-- Reason: all 1 effects present (after variant resolution)
-- ──────────────────────────────────────────────────────────────────────────────
-- All effects already in prod. Just record as applied.
INSERT INTO pgmigrations (name, run_on)
  SELECT '20260811000000_halls_tv_voice_selection', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260811000000_halls_tv_voice_selection');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260821000000_game1_jackpot_state
-- Class: NOT-APPLIED
-- Reason: 1 effects missing
-- ──────────────────────────────────────────────────────────────────────────────
-- MASTER_PLAN_SPILL1_PILOT_2026-04-24 §2.3 / SPILL1_FULL_VARIANT_CATALOG §70:
-- Jackpot daglig akkumulering per hall-gruppe for Spill 1.
--
-- Produkt-spec (PM-låst, Appendix B.9):
--   * Starter 2000 kr (200_000 øre)
--   * +4000 kr/dag (400_000 øre/dag)
--   * Max 30_000 kr (3_000_000 øre)
--   * Draw-thresholds: 50 → 55 → 56 → 57 (per sub-game, IKKE eskalering
--     i ett spill — drawNext konsumerer neste threshold i lista).
--
-- Design:
--   * En rad per hall-gruppe (PK på hall_group_id). `app_game1_accumulating_pots`
--     (PR-T1) er en generell pot-framework per hall; denne tabellen er det
--     dedikerte daglig-akkumulerings-statet for Jackpott mellom spill på
--     tvers av alle haller i gruppen.
--   * `last_accumulation_date` brukes for idempotent daglig tick (2x
--     samme dag = no-op).
--   * `draw_thresholds_json` er en array [50,55,56,57] per pilot-spec —
--     tillater fremtidig per-hall-gruppe-override uten migrasjon.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

CREATE TABLE IF NOT EXISTS app_game1_jackpot_state (
  hall_group_id           TEXT PRIMARY KEY
                            REFERENCES app_hall_groups(id) ON DELETE RESTRICT,
  current_amount_cents    BIGINT NOT NULL DEFAULT 200000,   -- 2000 kr start
  last_accumulation_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  max_cap_cents           BIGINT NOT NULL DEFAULT 3000000,  -- 30k cap
  daily_increment_cents   BIGINT NOT NULL DEFAULT 400000,   -- 4000/dag
  draw_thresholds_json    JSONB NOT NULL DEFAULT '[50,55,56,57]'::jsonb,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jackpot_state_amount_nonneg CHECK (current_amount_cents >= 0),
  CONSTRAINT jackpot_state_cap_positive CHECK (max_cap_cents > 0),
  CONSTRAINT jackpot_state_increment_nonneg CHECK (daily_increment_cents >= 0)
);

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_game1_jackpot_state') THEN
    EXECUTE $stmt$ COMMENT ON TABLE  app_game1_jackpot_state IS
  'Daglig-akkumulerende Jackpott-state per hall-gruppe (Spill 1, Appendix B.9).' $stmt$;
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_jackpot_state' AND column_name='current_amount_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_jackpot_state.current_amount_cents IS
  'Nåværende jackpot-saldo i øre. 2000 kr start, økes daglig, cappes ved max_cap_cents.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_jackpot_state.current_amount_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_jackpot_state' AND column_name='last_accumulation_date') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_jackpot_state.last_accumulation_date IS
  'UTC-dato for siste daglig-tick. Brukes for idempotens (samme dag to ganger = no-op).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_jackpot_state.last_accumulation_date';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_jackpot_state' AND column_name='max_cap_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_jackpot_state.max_cap_cents IS
  'Øvre grense i øre. Default 3_000_000 (30 000 kr). Bredde i kolonnen tillater fremtidig override uten migrasjon.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_jackpot_state.max_cap_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_jackpot_state' AND column_name='daily_increment_cents') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_jackpot_state.daily_increment_cents IS
  'Påfyll per dag i øre. Default 400_000 (4000 kr).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_jackpot_state.daily_increment_cents';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_game1_jackpot_state' AND column_name='draw_thresholds_json') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_game1_jackpot_state.draw_thresholds_json IS
  'Array av draw-sekvenser [50,55,56,57] (per sub-game). Tillater framtidig override per hall-gruppe.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_game1_jackpot_state.draw_thresholds_json';
  END IF;
END $sync$;

-- Seed: sørg for at alle eksisterende hall-grupper får et start-state.
-- Idempotent via ON CONFLICT DO NOTHING — migrasjonen kan trygt kjøres
-- flere ganger eller legges til etter at grupper er opprettet.
INSERT INTO app_game1_jackpot_state (hall_group_id)
SELECT id FROM app_hall_groups WHERE deleted_at IS NULL
ON CONFLICT (hall_group_id) DO NOTHING;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260821000000_game1_jackpot_state', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260821000000_game1_jackpot_state');

-- ──────────────────────────────────────────────────────────────────────────────
-- 20260825000000_close_day_log_3case
-- Class: NOT-APPLIED-NEEDS-PREDECESSOR
-- Reason: depends on tables created in earlier pending migrations: app_close_day_log (created in 20260425000000_close_day_log)
-- ──────────────────────────────────────────────────────────────────────────────
-- BIN-700: CloseDay 3-case — utvider app_close_day_log med tids-vindu og notes.
--
-- Legacy `closeDayAdd` (legacy/unity-backend/App/Controllers/GameController.js
-- 10126–10265) lagret per dato et tids-vindu (startTime, endTime) som angir
-- når på dagen rom-blokkering gjelder. For Consecutive-mode genererte
-- legacy:
--   - første dag:   startTime → "23:59"
--   - mellomdager:  "00:00"   → "23:59"
--   - siste dag:    "00:00"   → endTime
-- Random-mode (frittstående datoer): hver dato bruker sitt eget vindu.
-- Single-mode: dato + vindu (default 00:00 → 23:59 hvis ikke spesifisert).
--
-- BIN-623 (forrige versjon) støttet kun "lukk dagen som helhet" og hadde ikke
-- start_time/end_time-kolonner. Denne migrasjonen legger dem til som NULL-
-- nullbar (eksisterende rader → "hele dagen"), pluss en valgfri notes-felt
-- for hall-operatør-notater (jul, påske, "stengt for ombygning").
--
-- Forward-only (BIN-661): ingen Down-seksjon.
--
-- Up migration

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_close_day_log') THEN
    EXECUTE $stmt$ ALTER TABLE app_close_day_log
  ADD COLUMN IF NOT EXISTS start_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS end_time   TEXT NULL,
  ADD COLUMN IF NOT EXISTS notes      TEXT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_close_day_log';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_close_day_log' AND column_name='start_time') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_close_day_log.start_time IS
  'BIN-700: HH:MM (24t) — starten på lukke-vinduet for denne dagen. NULL = hele dagen lukket.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_close_day_log.start_time';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_close_day_log' AND column_name='end_time') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_close_day_log.end_time IS
  'BIN-700: HH:MM (24t) — slutten på lukke-vinduet for denne dagen. NULL = hele dagen lukket.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_close_day_log.end_time';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_close_day_log' AND column_name='notes') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_close_day_log.notes IS
  'BIN-700: hall-operatør-notater (eks. "jul", "påske", "ombygning"). Valgfri.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_close_day_log.notes';
  END IF;
END $sync$;

INSERT INTO pgmigrations (name, run_on)
  SELECT '20260825000000_close_day_log_3case', NOW()
  WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = '20260825000000_close_day_log_3case');

-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP: re-apply CONFLICT-class migrations now that all tables exist
-- ══════════════════════════════════════════════════════════════════════════════

-- Re-apply: 20260424153706_agent_shift_logout_flags
-- Wireframe Gap #9 (PDF 17.6): Shift Log Out-flyt med 2 checkboxer.
--
-- Spec: docs/architecture/WIREFRAME_PDF16_17_GAPS_2026-04-24.md §9
--
-- Bakgrunn:
--   Agent V1.0 wireframe 17.6 (Shift Log Out-popup) krever at bingovert kan
--   avslutte skiftet sitt med to flagg:
--
--     1. "Distribute winnings to physical players" — markerer alle pending
--        cashouts (app_physical_ticket_pending_payouts) for agenten som
--        tilgjengelig for neste agent til å utbetale.
--     2. "Transfer register ticket to next agent" — markerer åpne
--        ticket-ranges (app_agent_ticket_ranges) for agenten som overførbare
--        ved neste innlogging / transfer-hall-access-flyt.
--
--   Begge flaggene er opt-in; logout uten avkrysning = legacy-oppførsel
--   (kun shift.end som før). Flaggene skrives til app_agent_shifts for
--   audit + rapport, mens selve markeringen skjer på child-tabellene.
--
-- Designvalg:
--   * distributed_winnings / transferred_register_tickets er BOOLEAN DEFAULT
--     FALSE på app_agent_shifts. Eksisterende rader får false implisitt.
--   * logout_notes er TEXT NULL for valgfri audit-kommentar fra bingovert
--     (legacy V1.0 har et fri-tekst-felt på popup-skjermen som vi beholder).
--   * pending_for_next_agent på app_physical_ticket_pending_payouts er
--     BOOLEAN DEFAULT FALSE. Settes true når distribute-flagget sendes.
--     Partial-indeks for rask query av "pending cashouts tilgjengelig for
--     meg".
--   * transfer_to_next_agent på app_agent_ticket_ranges er BOOLEAN DEFAULT
--     FALSE. Settes true sammen med transferred_register_tickets på shiften.
--     AgentTicketRangeService skal sjekke dette flagget ved neste
--     registrering og tilby overtagelse.
--
-- Forward-only (BIN-661): ingen Down-seksjon.

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_shifts') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_shifts
  ADD COLUMN IF NOT EXISTS distributed_winnings BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transferred_register_tickets BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logout_notes TEXT NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_shifts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_shifts' AND column_name='distributed_winnings') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_shifts.distributed_winnings         IS 'Gap #9: true hvis agent krysset av for "Distribute winnings to physical players" ved logout. Pending cashouts merkes pending_for_next_agent = true.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_shifts.distributed_winnings';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_shifts' AND column_name='transferred_register_tickets') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_shifts.transferred_register_tickets IS 'Gap #9: true hvis agent krysset av for "Transfer register ticket to next agent" ved logout. Åpne ticket-ranges merkes transfer_to_next_agent = true.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_shifts.transferred_register_tickets';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_shifts' AND column_name='logout_notes') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_shifts.logout_notes                 IS 'Gap #9: valgfri audit-notat fra bingovert på logout-popup (legacy V1.0 fri-tekst-felt).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_shifts.logout_notes';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts') THEN
    EXECUTE $stmt$ ALTER TABLE app_physical_ticket_pending_payouts
  ADD COLUMN IF NOT EXISTS pending_for_next_agent BOOLEAN NOT NULL DEFAULT false $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_physical_ticket_pending_payouts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts' AND column_name='pending_for_next_agent') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_physical_ticket_pending_payouts.pending_for_next_agent IS 'Gap #9: true når avtroppende agent har valgt "Distribute winnings" ved logout. Neste agent ser denne raden i sin cashout-vakt. Settes false igjen ved paid_out_at / rejected_at (håndteres i service).' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_physical_ticket_pending_payouts.pending_for_next_agent';
  END IF;
END $sync$;

-- Partial-indeks: "hvilke pending cashouts er overtakelses-klare i denne hallen?"
-- Brukt av neste agents dashboard ved innlogging.
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_physical_ticket_pending_payouts') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_pt4_pending_payouts_next_agent
  ON app_physical_ticket_pending_payouts (hall_id)
  WHERE pending_for_next_agent = true AND paid_out_at IS NULL AND rejected_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_physical_ticket_pending_payouts';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ ALTER TABLE app_agent_ticket_ranges
  ADD COLUMN IF NOT EXISTS transfer_to_next_agent BOOLEAN NOT NULL DEFAULT false $stmt$;
  ELSE
    RAISE NOTICE 'Skipping ALTER — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_agent_ticket_ranges' AND column_name='transfer_to_next_agent') THEN
    EXECUTE $stmt$ COMMENT ON COLUMN app_agent_ticket_ranges.transfer_to_next_agent IS 'Gap #9: true når avtroppende agent har valgt "Transfer register ticket" ved logout. Neste agent ved transfer-hall-access ser åpne ranges som tilgjengelig for overtagelse.' $stmt$;
  ELSE
    RAISE NOTICE 'Skipping COMMENT — column missing: app_agent_ticket_ranges.transfer_to_next_agent';
  END IF;
END $sync$;

-- Partial-indeks: "hvilke range-er er merket som transfer-klare i denne hallen?"
DO $sync$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_agent_ticket_ranges') THEN
    EXECUTE $stmt$ CREATE INDEX IF NOT EXISTS idx_app_agent_ticket_ranges_transfer_ready
  ON app_agent_ticket_ranges (hall_id)
  WHERE transfer_to_next_agent = true AND closed_at IS NULL $stmt$;
  ELSE
    RAISE NOTICE 'Skipping INDEX — table missing: app_agent_ticket_ranges';
  END IF;
END $sync$;

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES — run inside the transaction (before COMMIT)
-- ══════════════════════════════════════════════════════════════════════════════

\echo 'Verification:'
SELECT 'tables_count_after_sync' AS metric, count(*) AS value
FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';

SELECT 'pgmigrations_count_after_sync' AS metric, count(*) AS value FROM pgmigrations;

-- Should be empty (no missing migrations):
WITH expected(name) AS (VALUES
  ('20260413000001_initial_schema'),
  ('20260413000002_max_tickets_30_all_games'),
  ('20260415000001_game_variant_config'),
  ('20260417120000_deactivate_game4_temabingo'),
  ('20260418090000_add_hall_client_variant'),
  ('20260418130000_chat_messages'),
  ('20260418140000_halls_tv_url'),
  ('20260424153706_agent_shift_logout_flags'),
  ('20260425000000_close_day_log'),
  ('20260425000000_game_types'),
  ('20260425000100_sub_games'),
  ('20260425000200_saved_games'),
  ('20260425000300_schedules'),
  ('20260425000400_leaderboard_tiers'),
  ('20260425000500_system_settings_maintenance'),
  ('20260425000600_mini_games_config'),
  ('20260426000200_cms'),
  ('20260427000000_physical_ticket_cashouts'),
  ('20260427000100_physical_ticket_win_data'),
  ('20260428000000_game1_scheduled_games'),
  ('20260428000100_game1_hall_ready_status'),
  ('20260428000200_game1_master_audit'),
  ('20260429000000_loyalty'),
  ('20260429000100_drop_hall_client_variant'),
  ('20260430000000_app_game1_ticket_purchases'),
  ('20260430000100_physical_tickets_scheduled_game_fk'),
  ('20260501000000_app_game1_ticket_assignments'),
  ('20260501000100_app_game1_draws'),
  ('20260501000200_app_game1_game_state'),
  ('20260501000300_app_game1_phase_winners'),
  ('20260503000000_game1_hall_scan_data'),
  ('20260601000000_app_game1_scheduled_games_room_code'),
  ('20260605000000_app_game1_scheduled_games_game_config'),
  ('20260606000000_app_game1_mini_game_results'),
  ('20260606000000_static_tickets_pt1_extensions'),
  ('20260606000000_wallet_split_deposit_winnings'),
  ('20260607000000_agent_ticket_ranges_pt2_extensions'),
  ('20260608000000_physical_ticket_pending_payouts'),
  ('20260609000000_game1_oddsen_state'),
  ('20260610000000_agent_ticket_ranges_pt5_extensions'),
  ('20260611000000_game1_accumulating_pots'),
  ('20260700000000_cms_content_versions'),
  ('20260701000000_hall_number'),
  ('20260705000000_agent_permissions'),
  ('20260706000000_app_notifications_and_devices'),
  ('20260723000000_voucher_redemptions'),
  ('20260724000000_game1_mini_game_mystery'),
  ('20260724001000_app_unique_ids'),
  ('20260724100000_wallet_reservations'),
  ('20260725000000_settlement_machine_breakdown'),
  ('20260726000000_game1_auto_pause_on_phase'),
  ('20260726100000_ticket_ranges_per_game'),
  ('20260727000000_game1_master_transfer_requests'),
  ('20260727000001_game1_master_audit_add_transfer_actions'),
  ('20260810000000_withdraw_requests_bank_export'),
  ('20260810000100_xml_export_batches'),
  ('20260811000000_halls_tv_voice_selection'),
  ('20260820000000_user_profile_settings'),
  ('20260821000000_game1_jackpot_state'),
  ('20260825000000_close_day_log_3case')
)
SELECT 'still_pending' AS metric, name FROM expected
WHERE name NOT IN (SELECT name FROM pgmigrations);

-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK by default (review-safe). Change to COMMIT after PM-review.
-- ══════════════════════════════════════════════════════════════════════════════
ROLLBACK;

-- After review:
--   1. Take fresh backup:
--      pg_dump $PGURL --no-owner --no-acl | gzip > /tmp/pre-sync-$(date +%s).sql.gz
--   2. Change ROLLBACK above to COMMIT
--   3. Run WITHOUT --single-transaction (the script handles its own BEGIN/COMMIT):
--      psql $PGURL -v ON_ERROR_STOP=1 -f tools/schema-sync-2026-04-26.sql 2>&1 | tee /tmp/schema-sync.log
--   4. Verify pgmigrations.count = 104
--
-- IMPORTANT: do NOT use --single-transaction. The script's own BEGIN/COMMIT
--   is the transaction boundary. --single-transaction creates a wrapper that
--   conflicts and can result in partial commits if the script errors.