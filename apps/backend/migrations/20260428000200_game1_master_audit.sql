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

CREATE INDEX IF NOT EXISTS idx_game1_master_audit_game_created
  ON app_game1_master_audit(game_id, created_at);

CREATE INDEX IF NOT EXISTS idx_game1_master_audit_actor_created
  ON app_game1_master_audit(actor_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_game1_master_audit_action_created
  ON app_game1_master_audit(action, created_at);

COMMENT ON TABLE app_game1_master_audit IS
  'GAME1_SCHEDULE PR3: append-only audit-trail for master-control-actions i Game 1 (start/pause/resume/stop/exclude_hall/include_hall/timeout_detected). Regulatorisk §11.';

COMMENT ON COLUMN app_game1_master_audit.halls_ready_snapshot IS
  'GAME1_SCHEDULE PR3: snapshot av halls-ready-status på action-tidspunkt — map hallId → { isReady, excluded }. Sikrer rapporter er stabile selv om ready-status muteres senere.';

COMMENT ON COLUMN app_game1_master_audit.metadata_json IS
  'GAME1_SCHEDULE PR3: action-spesifikk metadata — reason, excludedHallId, pauseMessage, stopReason, confirmExcludedHalls osv.';

COMMENT ON COLUMN app_game1_master_audit.actor_user_id IS
  'GAME1_SCHEDULE PR3: userId til actor. Ikke FK — bevares ved user-slett (audit-trail-krav).';
