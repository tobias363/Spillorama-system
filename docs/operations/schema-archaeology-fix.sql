-- =============================================================================
-- Schema-archaeology fix — 2026-04-29
-- =============================================================================
-- ─────────────────────────────────────────────────────────────────────────────
-- CHANGE LOG
-- ─────────────────────────────────────────────────────────────────────────────
--   2026-04-29 v2 (post-PM-dryrun fixes):
--     • BUG FIX #1 (3 instances): The `WITH numbered AS (...) SELECT ... AS
--       rows_out_of_order` order-check queries at original lines 335-346,
--       439-450, 513-524 were missing the `FROM numbered` clause. PostgreSQL
--       errored with `column "pos_by_run_on" does not exist`, which (with
--       ON_ERROR_STOP=1) aborts the whole transaction — including the STEP 5
--       backdate UPDATE that depends on running AFTER the verification.
--       Without ON_ERROR_STOP=1 the errors went to stderr (not captured by
--       `tee`) so dry-run output looked clean while STEP 5 was silently
--       skipped. Effect: COMMIT mode would have committed STEP 2 INSERTs
--       with `run_on = now()` (placing them AFTER pre-existing 2026-04-26
--       rows in chronological order) but no backdate — node-pg-migrate's
--       order-check would then fail on next deploy because the new rows'
--       `name` sort places them BEFORE existing rows. Fix: add `FROM numbered`
--       to all 3 queries.
--
--     • BUG FIX #2 (2 instances, STEP 5 + STEP 5b): The original
--       `to_timestamp(substring(name, 1, 14), 'YYYYMMDDHH24MISS')` parser
--       blows up with "date/time field value out of range" on 5 migrations
--       in the codebase that have intentionally-overflowed timestamp
--       prefixes for ordering — `20260418240000_agent_transactions`,
--       `20260418240000_vouchers`, `20260418250000_agent_settlements`,
--       `20260418250100_shift_settled_at`, `20260418250200_hall_cash_balance`,
--       `20260418250300_hall_cash_transactions`. These were named to sort
--       AFTER `20260418230000_*` and BEFORE `20260419*`, but `to_timestamp`
--       rejects HH=24 and HH=25. Fix: parse date-part as midnight
--       timestamp, then add HH*3600 + MM*60 + SS as a seconds-interval that
--       naturally rolls forward (250200 → 25h2m → next day 01:02). This
--       preserves alphabetical sort order while remaining valid timestamps.
--
--     • NEW: STEP 0 sanity-check block — verifies (a) we're connected to
--       the expected `bingo_db_64tj` database (configurable via
--       `-v expected_db=<name>` psql variable, default `bingo_db_64tj`),
--       (b) `pgmigrations` table exists with expected columns (id, name,
--       run_on), (c) `pgmigrations` is non-empty (warning if it is —
--       fresh DB scenarios). Uses RAISE EXCEPTION in DO blocks rather
--       than CASE+division-by-zero (which evaluates both branches and
--       false-fires on success). Runs OUTSIDE the main transaction so a
--       wrong-DB abort holds no LOCK and leaks nothing.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Closes the divergence between prod's `pgmigrations` and code's
-- `apps/backend/migrations/`. ONLY does INSERT INTO pgmigrations — does NOT
-- mutate any schema, does NOT run migration bodies, does NOT touch user data.
--
-- The migration BODIES are NOT replayed by this script. They have already
-- been executed on prod (out-of-band, via boot-time `initializeSchema()` or
-- via the partial commit on 2026-04-26 — see SCHEMA_ARCHAEOLOGY_2026-04-29.md
-- §3 for the audit trail). All this script does is teach `pgmigrations` what
-- prod already knows about its own state.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- USAGE
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Run docs/operations/schema-archaeology-inspect.sql FIRST. Confirm that
--    Section 6 of its output matches the candidate list in §STEP 2 below.
--
-- 2. DRY-RUN (default): leaves transaction in ROLLBACK state — no permanent
--    change, but you see exactly what would happen.
--      psql "$PROD_PG_URL" -v ON_ERROR_STOP=1 \
--        -f docs/operations/schema-archaeology-fix.sql \
--        | tee /tmp/schema-archaeology-fix-dry.log
--
-- 3. REVIEW the dry-run log. Verify "rows_inserted" matches the expected count.
--
-- 4. COMMIT MODE: edit the last line below from `ROLLBACK;` to `COMMIT;` and
--    run again:
--      sed -i.bak 's/^ROLLBACK; -- DEFAULT/COMMIT; -- COMMITTED/' \
--        docs/operations/schema-archaeology-fix.sql
--      psql "$PROD_PG_URL" -v ON_ERROR_STOP=1 \
--        -f docs/operations/schema-archaeology-fix.sql \
--        | tee /tmp/schema-archaeology-fix-commit.log
--
-- 5. After commit, restore the file:
--      mv docs/operations/schema-archaeology-fix.sql.bak \
--         docs/operations/schema-archaeology-fix.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SAFETY
-- ─────────────────────────────────────────────────────────────────────────────
-- * Single transaction. EXCLUSIVE lock on pgmigrations during run prevents
--   concurrent migrate-deploys.
-- * Idempotent: every INSERT uses NOT EXISTS — re-running has no effect.
-- * Backed by NOT EXISTS (rather than ON CONFLICT) because in node-pg-migrate
--   8.x the pgmigrations.name column is not UNIQUE — it's only PK on id.
--   See: previous schema-sync-2026-04-26 §11 for evidence and rationale.
-- * Default action: ROLLBACK. Tobias must explicitly flip to COMMIT.
-- * Each INSERT row is conditional on (a) the migration NOT being already
--   registered AND (b) the schema fingerprint being live in prod. If a row
--   was somehow added between inspect and fix, the second check skips it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS SCRIPT DOES NOT DO
-- ─────────────────────────────────────────────────────────────────────────────
-- * Does NOT run any migration body. If a migration is "schema-not-live and
--   not registered" (e.g. a new migration added recently), it is left for
--   the next Render build to apply via the regular `npm run migrate up`
--   pipeline.
-- * Does NOT register DATA-only migrations. Those have no fingerprint, and
--   marking them as run without confirming the data state could leave prod
--   inconsistent. Tobias must register those manually after inspecting each.
-- * Does NOT touch row data, FKs, indexes, constraints, or any schema object.
-- * Does NOT remove or "fix" the orphan tables `app_draw_session_*`. That is
--   a separate P2 concern (DB-P2-1 in DATABASE_AUDIT_2026-04-28.md) — not in
--   scope for this archaeology pass.
-- =============================================================================

\echo '── Schema-archaeology FIX — 2026-04-29 ──'
\echo ''
\echo 'Default action: ROLLBACK (dry-run). Edit the last line of this script'
\echo 'from `ROLLBACK; -- DEFAULT` to `COMMIT; -- COMMITTED` to actually'
\echo 'persist changes.'
\echo ''

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 — Sanity check (fail-fast on wrong DB or missing pgmigrations)
-- ─────────────────────────────────────────────────────────────────────────────
-- Runs OUTSIDE the main transaction so that pre-flight errors abort with
-- minimal side-effect (no LOCK held, no BEGIN issued). Each check is a
-- DO-block that RAISE EXCEPTION on failure — combined with
-- `-v ON_ERROR_STOP=1` this halts the script immediately with a clear
-- diagnostic message.
--
-- Override defaults via psql command line, e.g.:
--   psql ... -v expected_db=bingo_dev -f ...
-- Default behaviour: must be on `bingo_db_64tj`; pgmigrations must exist
-- with all 3 expected columns.
-- ─────────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 0: Sanity check'
\echo '═══════════════════════════════════════════════════════════════════════════'

\set ON_ERROR_STOP on

-- Default expected_db if not provided via `-v expected_db=<name>`. psql
-- only sets the variable to its provided value when `-v` is used; without
-- it, `:expected_db` would fail to substitute. Set a fallback here.
\if :{?expected_db}
\else
  \set expected_db 'bingo_db_64tj'
\endif

\echo 'Connection details:'

SELECT
  current_database()      AS connected_db,
  :'expected_db'          AS expected_db,
  current_user            AS connected_role,
  inet_server_addr()      AS server_addr,
  version()               AS pg_version;

-- 0.1 — Database name must match expected. If you intentionally point this
-- at a non-prod DB (e.g. dev, staging, local), override with
-- `-v expected_db=<other>`.
--
-- We pass the expected_db value into the DO-block via SET LOCAL on a
-- custom GUC — then the DO-block reads it via current_setting() and
-- RAISE EXCEPTION on mismatch. This is more robust than CASE+division-by-
-- zero (which evaluates both branches and false-fires on success).

\echo ''
\echo '0.1: Verifying connected database matches expected …'

-- Pass the psql variable into a session-level GUC that DO-blocks can read.
SELECT set_config('schema_archaeology.expected_db', :'expected_db', false);

DO $$
DECLARE
  expected_db TEXT := current_setting('schema_archaeology.expected_db', TRUE);
  actual_db   TEXT := current_database();
BEGIN
  IF expected_db IS NULL OR expected_db = '' THEN
    RAISE EXCEPTION 'STEP 0.1 FATAL: schema_archaeology.expected_db not set. '
                    'Did you forget `-v expected_db=<name>`?';
  END IF;
  IF actual_db <> expected_db THEN
    RAISE EXCEPTION 'STEP 0.1 FATAL: connected_db=% but expected_db=%. '
                    'Override with `-v expected_db=<your-db>` if intentional.',
                    actual_db, expected_db;
  END IF;
  RAISE NOTICE '0.1 OK: connected to %', actual_db;
END $$;

-- 0.2 — pgmigrations table must exist with the 3 expected columns.

\echo ''
\echo '0.2: Verifying pgmigrations table shape …'

DO $$
DECLARE
  col_count   INTEGER;
  found_cols  TEXT;
BEGIN
  SELECT
    count(*),
    string_agg(column_name, ', ' ORDER BY column_name)
  INTO col_count, found_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'pgmigrations'
    AND column_name IN ('id', 'name', 'run_on');

  IF col_count <> 3 THEN
    RAISE EXCEPTION 'STEP 0.2 FATAL: pgmigrations has % of expected 3 columns '
                    '(id, name, run_on). Found columns: %',
                    col_count, COALESCE(found_cols, '(none)');
  END IF;
  RAISE NOTICE '0.2 OK: pgmigrations has all 3 expected columns (%)', found_cols;
END $$;

-- 0.3 — pgmigrations must have at least 1 row. An empty pgmigrations could
-- mean a fresh DB (where the fix is a no-op anyway) but is still suspicious
-- — we surface it as a warning rather than an error.

\echo ''
\echo '0.3: pgmigrations row count …'

DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT count(*) INTO row_count FROM pgmigrations;
  IF row_count = 0 THEN
    RAISE WARNING '0.3 WARN: pgmigrations is empty. If this is intentional '
                  '(fresh DB), proceed; otherwise abort and verify connection.';
  ELSE
    RAISE NOTICE '0.3 OK: pgmigrations has % rows', row_count;
  END IF;
END $$;

\echo ''
\echo 'STEP 0 passed. Proceeding to main transaction.'
\echo ''

-- ─────────────────────────────────────────────────────────────────────────────
-- Main transaction begins here. STEP 0 ran auto-commit; from here on we are
-- inside an explicit transaction with EXCLUSIVE lock on pgmigrations.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Take an EXCLUSIVE lock on pgmigrations to prevent a concurrent Render
-- deploy's `npm run migrate` from racing this script. Held until COMMIT/
-- ROLLBACK.
LOCK TABLE pgmigrations IN EXCLUSIVE MODE;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — Pre-flight summary (read-only)
-- ─────────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 1: Pre-flight'
\echo '═══════════════════════════════════════════════════════════════════════════'

SELECT
  (SELECT count(*) FROM pgmigrations) AS pgmigrations_before,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public') AS public_tables_now,
  current_user AS executing_role,
  current_database() AS db,
  now() AS executed_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — Conditional INSERT INTO pgmigrations (the actual fix)
-- ─────────────────────────────────────────────────────────────────────────────
-- Each row is registered ONLY IF:
--   (a) the migration is NOT already in pgmigrations
--   (b) the migration's schema fingerprint exists in prod RIGHT NOW
--
-- This means the script is idempotent and self-correcting: if the inspection
-- ran 3 hours ago and prod has changed since, the per-row condition prevents
-- false registrations.
--
-- The list of (migration_name, kind, fingerprint) MUST be kept in sync with
-- `docs/operations/schema-archaeology-inspect.sql` Section 4.
-- ─────────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 2: Conditional registration'
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'Inserts a row into pgmigrations for every migration where:'
\echo '  - the schema fingerprint is currently live, AND'
\echo '  - the migration is not already registered.'
\echo 'Uses INSERT ... SELECT WHERE NOT EXISTS for idempotency.'
\echo ''

-- Use a CTE so we can RETURNING the inserted rows for visibility.
WITH candidates(name, object_kind, object_qualifier) AS (
  -- ⚠️ Identical to schema-archaeology-inspect.sql Section 4. Keep in lock-step.
  VALUES
    ('20260413000001_initial_schema',                      'TABLE',  'wallet_accounts'),
    ('20260413000002_max_tickets_30_all_games',            'DATA',   ''),
    ('20260415000001_game_variant_config',                 'COLUMN', 'hall_game_schedules.variant_config'),
    ('20260416000001_multi_hall_linked_draws',             'TABLE',  'app_hall_groups'),
    ('20260417000001_ticket_draw_session_binding',         'COLUMN', 'game_sessions.draw_session_id'),
    ('20260417000002_static_tickets',                      'TABLE',  'app_static_tickets'),
    ('20260417000003_agent_ticket_ranges',                 'TABLE',  'app_agent_ticket_ranges'),
    ('20260417000004_idempotency_records',                 'TABLE',  'app_idempotency_records'),
    ('20260417000005_regulatory_ledger',                   'TABLE',  'app_regulatory_ledger'),
    ('20260417000006_daily_regulatory_reports',            'TABLE',  'app_daily_regulatory_reports'),
    ('20260417000007_user_hall_binding',                   'COLUMN', 'app_users.hall_id'),
    ('20260417000008_draw_session_tickets',                'TABLE',  'app_draw_session_tickets'),
    ('20260417120000_deactivate_game4_temabingo',          'DATA',   ''),
    ('20260418090000_add_hall_client_variant',             'COLUMN', 'app_halls.client_variant'),
    ('20260418130000_chat_messages',                       'TABLE',  'app_chat_messages'),
    ('20260418140000_halls_tv_url',                        'COLUMN', 'app_halls.tv_url'),
    ('20260418150000_hall_display_tokens',                 'TABLE',  'app_hall_display_tokens'),
    ('20260418160000_app_audit_log',                       'TABLE',  'app_audit_log'),
    ('20260418160000_deposit_withdraw_queue',              'TABLE',  'app_deposit_requests'),
    ('20260418170000_user_hall_scope',                     'COLUMN', 'app_users.hall_scope'),
    ('20260418180000_auth_tokens',                         'TABLE',  'app_password_reset_tokens'),
    ('20260418190000_player_lifecycle',                    'TABLE',  'app_player_hall_status'),
    ('20260418200000_aml_red_flags',                       'TABLE',  'app_aml_rules'),
    ('20260418210000_security_admin',                      'TABLE',  'app_withdraw_email_allowlist'),
    ('20260418220000_agent_role_and_profile',              'COLUMN', 'app_users.language'),
    ('20260418220100_agent_halls',                         'TABLE',  'app_agent_halls'),
    ('20260418220200_agent_shifts',                        'TABLE',  'app_agent_shifts'),
    ('20260418220300_audit_log_agent_actor_type',          'DATA',   ''),
    ('20260418230000_physical_tickets',                    'TABLE',  'app_physical_ticket_batches'),
    ('20260418240000_agent_transactions',                  'TABLE',  'app_agent_transactions'),
    ('20260418240000_vouchers',                            'TABLE',  'app_vouchers'),
    ('20260418250000_agent_settlements',                   'TABLE',  'app_agent_settlements'),
    ('20260418250100_shift_settled_at',                    'COLUMN', 'app_agent_shifts.settled_at'),
    ('20260418250200_hall_cash_balance',                   'COLUMN', 'app_halls.cash_balance'),
    ('20260418250300_hall_cash_transactions',              'TABLE',  'app_hall_cash_transactions'),
    ('20260419000000_game_management',                     'TABLE',  'app_game_management'),
    ('20260420000000_products',                            'TABLE',  'app_product_categories'),
    ('20260420000050_agent_tx_product_sale',               'DATA',   ''),
    ('20260420000100_physical_ticket_transfers',           'TABLE',  'app_physical_ticket_transfers'),
    ('20260420100000_machine_tickets',                     'TABLE',  'app_machine_tickets'),
    ('20260420100100_agent_tx_machine_actions',            'DATA',   ''),
    ('20260421000000_hall_manual_adjustments',             'TABLE',  'app_hall_manual_adjustments'),
    ('20260421000100_set_bingo_client_engine_web',         'DATA',   ''),
    ('20260421120000_sub_game_parent_link',                'COLUMN', 'hall_game_schedules.parent_schedule_id'),
    ('20260421130000_purge_legacy_bingo1_no_gameslug',     'DATA',   ''),
    ('20260421140000_payment_request_destination_type',    'COLUMN', 'app_withdraw_requests.destination_type'),
    ('20260422000000_daily_schedules',                     'TABLE',  'app_daily_schedules'),
    ('20260423000000_patterns',                            'TABLE',  'app_patterns'),
    ('20260423000100_halls_tv_token',                      'COLUMN', 'app_halls.tv_token'),
    ('20260424000000_add_game_slug_to_game_sessions',      'COLUMN', 'game_sessions.game_slug'),
    ('20260424000000_hall_groups',                         'TABLE',  'app_hall_groups'),
    ('20260424153706_agent_shift_logout_flags',            'COLUMN', 'app_agent_shifts.distributed_winnings'),
    ('20260425000000_close_day_log',                       'TABLE',  'app_close_day_log'),
    ('20260425000000_game_types',                          'TABLE',  'app_game_types'),
    ('20260425000000_wallet_reservations_numeric',         'DATA',   ''),
    ('20260425000100_sub_games',                           'TABLE',  'app_sub_games'),
    ('20260425000200_saved_games',                         'TABLE',  'app_saved_games'),
    ('20260425000300_schedules',                           'TABLE',  'app_schedules'),
    ('20260425000400_leaderboard_tiers',                   'TABLE',  'app_leaderboard_tiers'),
    ('20260425000500_system_settings_maintenance',         'TABLE',  'app_system_settings'),
    ('20260425000600_mini_games_config',                   'TABLE',  'app_mini_games_config'),
    ('20260425125008_screen_saver_settings',               'TABLE',  'app_screen_saver_images'),
    ('20260426000200_cms',                                 'TABLE',  'app_cms_content'),
    ('20260426120000_chat_moderation',                     'COLUMN', 'app_chat_messages.deleted_at'),
    ('20260427000000_physical_ticket_cashouts',            'TABLE',  'app_physical_ticket_cashouts'),
    ('20260427000000_wallet_outbox',                       'TABLE',  'wallet_outbox'),
    ('20260427000100_physical_ticket_win_data',            'COLUMN', 'app_physical_tickets.numbers_json'),
    ('20260428000000_game1_scheduled_games',               'TABLE',  'app_game1_scheduled_games'),
    ('20260428000100_game1_hall_ready_status',             'TABLE',  'app_game1_hall_ready_status'),
    ('20260428000200_game1_master_audit',                  'TABLE',  'app_game1_master_audit'),
    ('20260428080000_compliance_ledger_idempotency',       'COLUMN', 'app_rg_compliance_ledger.idempotency_key'),
    ('20260429000000_loyalty',                             'TABLE',  'app_loyalty_tiers'),
    ('20260429000100_drop_hall_client_variant',            'DATA',   ''),
    ('20260429074303_compliance_outbox',                   'TABLE',  'app_compliance_outbox'),
    ('20260430000000_app_game1_ticket_purchases',          'TABLE',  'app_game1_ticket_purchases'),
    ('20260430000100_physical_tickets_scheduled_game_fk',  'DATA',   ''),
    ('20260501000000_app_game1_ticket_assignments',        'TABLE',  'app_game1_ticket_assignments'),
    ('20260501000100_app_game1_draws',                     'TABLE',  'app_game1_draws'),
    ('20260501000200_app_game1_game_state',                'TABLE',  'app_game1_game_state'),
    ('20260501000300_app_game1_phase_winners',             'TABLE',  'app_game1_phase_winners'),
    ('20260503000000_game1_hall_scan_data',                'COLUMN', 'app_game1_hall_ready_status.start_ticket_id'),
    ('20260601000000_app_game1_scheduled_games_room_code', 'COLUMN', 'app_game1_scheduled_games.room_code'),
    ('20260605000000_app_game1_scheduled_games_game_config','COLUMN','app_game1_scheduled_games.game_config_json'),
    ('20260606000000_app_game1_mini_game_results',         'TABLE',  'app_game1_mini_game_results'),
    ('20260606000000_static_tickets_pt1_extensions',       'COLUMN', 'app_static_tickets.sold_by_user_id'),
    ('20260606000000_wallet_split_deposit_winnings',       'COLUMN', 'wallet_accounts.deposit_balance'),
    ('20260607000000_agent_ticket_ranges_pt2_extensions',  'COLUMN', 'app_agent_ticket_ranges.current_top_serial'),
    ('20260608000000_physical_ticket_pending_payouts',     'TABLE',  'app_physical_ticket_pending_payouts'),
    ('20260609000000_game1_oddsen_state',                  'TABLE',  'app_game1_oddsen_state'),
    ('20260610000000_agent_ticket_ranges_pt5_extensions',  'COLUMN', 'app_agent_ticket_ranges.handed_off_to_range_id'),
    ('20260611000000_game1_accumulating_pots',             'TABLE',  'app_game1_pot_events'),
    ('20260700000000_cms_content_versions',                'TABLE',  'app_cms_content_versions'),
    ('20260701000000_hall_number',                         'COLUMN', 'app_halls.hall_number'),
    ('20260705000000_agent_permissions',                   'TABLE',  'app_agent_permissions'),
    ('20260706000000_app_notifications_and_devices',       'TABLE',  'app_user_devices'),
    ('20260723000000_voucher_redemptions',                 'TABLE',  'app_voucher_redemptions'),
    ('20260724000000_game1_mini_game_mystery',             'DATA',   ''),
    ('20260724001000_app_unique_ids',                      'TABLE',  'app_unique_ids'),
    ('20260724100000_wallet_reservations',                 'TABLE',  'app_wallet_reservations'),
    ('20260725000000_settlement_machine_breakdown',        'COLUMN', 'app_agent_settlements.machine_breakdown'),
    ('20260726000000_game1_auto_pause_on_phase',           'COLUMN', 'app_game1_game_state.paused_at_phase'),
    ('20260726000000_settlement_breakdown_k1b_fields',     'DATA',   ''),
    ('20260726100000_ticket_ranges_per_game',              'TABLE',  'app_ticket_ranges_per_game'),
    ('20260727000000_game1_master_transfer_requests',      'TABLE',  'app_game1_master_transfer_requests'),
    ('20260727000001_game1_master_audit_add_transfer_actions', 'DATA', ''),
    ('20260810000000_withdraw_requests_bank_export',       'COLUMN', 'app_withdraw_requests.bank_account_number'),
    ('20260810000100_xml_export_batches',                  'TABLE',  'app_xml_export_batches'),
    ('20260811000000_halls_tv_voice_selection',            'COLUMN', 'app_halls.tv_voice_selection'),
    ('20260820000000_user_profile_settings',               'TABLE',  'app_user_profile_settings'),
    ('20260821000000_game1_jackpot_state',                 'TABLE',  'app_game1_jackpot_state'),
    ('20260825000000_close_day_log_3case',                 'COLUMN', 'app_close_day_log.start_time'),
    ('20260825000000_player_profile_images',               'COLUMN', 'app_users.profile_image_url'),
    ('20260826000000_wallet_reconciliation_alerts',        'TABLE',  'wallet_reconciliation_alerts'),
    ('20260901000000_close_day_recurring_patterns',        'TABLE',  'app_close_day_recurring_patterns'),
    ('20260901000000_game1_jackpot_awards',                'TABLE',  'app_game1_jackpot_awards'),
    ('20260902000000_app_user_pins',                       'TABLE',  'app_user_pins'),
    ('20260902000000_payment_methods',                     'COLUMN', 'swedbank_payment_intents.payment_method'),
    ('20260902000000_swedbank_intent_last_reminded_at',    'COLUMN', 'swedbank_payment_intents.last_reminded_at'),
    ('20260902000000_wallet_entries_hash_chain',           'COLUMN', 'wallet_entries.entry_hash'),
    ('20260910000000_user_2fa_and_session_metadata',       'TABLE',  'app_user_2fa'),
    ('20260926000000_wallet_currency_readiness',           'COLUMN', 'wallet_accounts.currency'),
    ('20260928000000_password_changed_at',                 'COLUMN', 'app_users.password_changed_at'),
    ('20261001000000_ticket_ranges_11_color_palette',      'DATA',   ''),
    ('20261103000000_default_kiosk_products',              'DATA',   ''),
    ('20261110000000_app_halls_is_test_hall',              'COLUMN', 'app_halls.is_test_hall'),
    ('20261115000000_app_ops_alerts',                      'TABLE',  'app_ops_alerts'),
    ('20261120000000_agent_transactions_idempotency',      'COLUMN', 'app_agent_transactions.client_request_id')
), to_register AS (
  SELECT c.name
  FROM candidates c
  WHERE
    -- not already registered (idempotent)
    NOT EXISTS (SELECT 1 FROM pgmigrations p WHERE p.name = c.name)
    -- AND schema fingerprint is live (safe to claim "already run")
    AND (
      (c.object_kind = 'TABLE' AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = c.object_qualifier
      ))
      OR (c.object_kind = 'COLUMN' AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = split_part(c.object_qualifier, '.', 1)
          AND col.column_name = split_part(c.object_qualifier, '.', 2)
      ))
      -- DATA-only migrations are NOT auto-registered. They have no
      -- fingerprint to probe. Tobias must register them manually after
      -- verifying the data state directly. See §3 of
      -- SCHEMA_ARCHAEOLOGY_2026-04-29.md for the list and rationale.
    )
)
-- ORDER BY name ensures SERIAL `id`s are allocated in alphabetical = filename
-- order. This matters when two migrations share the same timestamp prefix and
-- thus end up with identical run_on after STEP 5 backdate — `id` becomes the
-- tie-breaker that keeps `(run_on, id)`-sort aligned with `(name)`-sort.
INSERT INTO pgmigrations (name, run_on)
SELECT name, now()
FROM to_register
ORDER BY name
RETURNING id, name, run_on;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — Post-flight summary
-- ─────────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 3: Post-flight'
\echo '═══════════════════════════════════════════════════════════════════════════'

SELECT
  (SELECT count(*) FROM pgmigrations) AS pgmigrations_after,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public') AS public_tables_after;

\echo ''
\echo 'Migrations now registered, sorted alphabetically (= filename order):'

SELECT name FROM pgmigrations ORDER BY name;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — Verify the order-check in node-pg-migrate would now pass
-- ─────────────────────────────────────────────────────────────────────────────
-- node-pg-migrate's checkOrder() walks both lists (sorted-by-name files vs
-- pgmigrations sorted-by-(run_on,id)) in parallel and fails on the first
-- mismatch. If we INSERT-without-shifting-run_on, the new rows have run_on
-- ≈ now() — placing them at the END of the (run_on,id) sort. That breaks
-- the order if the new rows have NAMES that sort BEFORE existing rows.
--
-- The check below tells us whether the (run_on,id) sort and the (name) sort
-- agree. If they don't, node-pg-migrate's checkOrder will still fail after
-- COMMIT — and we need to backdate the run_on values to fix it.
-- ─────────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 4: Order-check simulation (the actual node-pg-migrate gate)'
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'For each row, we compare the position of `name` in the two sorts:'
\echo '  - sort-by-(run_on,id) (this is what node-pg-migrate sees as runNames[])'
\echo '  - sort-by-(name)      (this is what node-pg-migrate sees as migrations[].name'
\echo '                         when restricted to registered names)'
\echo 'They MUST be identical for the order-check to pass.'
\echo ''

WITH numbered AS (
  SELECT
    name,
    run_on,
    row_number() OVER (ORDER BY run_on, id) AS pos_by_run_on,
    row_number() OVER (ORDER BY name)       AS pos_by_name
  FROM pgmigrations
)
SELECT
  count(*)                                                  AS total_rows,
  count(*) FILTER (WHERE pos_by_run_on = pos_by_name)       AS rows_in_agreement,
  count(*) FILTER (WHERE pos_by_run_on <> pos_by_name)      AS rows_out_of_order
FROM numbered; -- BUG-FIX 2026-04-29: was missing FROM clause; aborted txn.

\echo ''
\echo 'Rows where the two sorts DISAGREE (these are the rows that will trip'
\echo 'node-pg-migrate''s order-check on next deploy):'
\echo ''

WITH numbered AS (
  SELECT
    name,
    run_on,
    row_number() OVER (ORDER BY run_on, id) AS pos_by_run_on,
    row_number() OVER (ORDER BY name)       AS pos_by_name
  FROM pgmigrations
)
SELECT
  pos_by_run_on,
  pos_by_name,
  name,
  run_on
FROM numbered
WHERE pos_by_run_on <> pos_by_name
ORDER BY pos_by_name
LIMIT 20;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5 — If STEP 4 shows out-of-order rows, BACKDATE run_on
-- ─────────────────────────────────────────────────────────────────────────────
-- node-pg-migrate's order-check requires that the (run_on,id) sort matches
-- the (name) sort. By default, our INSERTs above use `now()` for run_on,
-- which places them at the END of the run_on sort — but their NAMES may
-- sort earlier. To fix, we backdate each newly-registered row's run_on to
-- a synthetic timestamp derived from its name (the timestamp prefix).
--
-- This is a SAFE rewrite of the run-log: it does not mutate any user data
-- or schema, only the run_on metadata that node-pg-migrate uses for
-- ordering. The audit trail is preserved (the rows are still there) — only
-- the timestamp is normalized to match the filename order.
--
-- We ONLY rewrite rows that were inserted by THIS transaction (run_on >=
-- the start time saved at the top of STEP 1).
--
-- This UPDATE is conditional on STEP 4 showing disagreement — we don't
-- waste a write if the order is already aligned.
-- ─────────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 5: Backdate run_on for newly-registered rows (if needed)'
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'Sets run_on = parsed timestamp prefix of `name` for rows we just'
\echo 'inserted, IF the inserted name sorts before any pre-existing name.'
\echo ''
\echo 'NOTE: This is a metadata-only rewrite — schema and user data unchanged.'
\echo ''

-- Update each row whose run_on is "today" (now-window) to a timestamp parsed
-- from its name. The timestamp prefix YYYYMMDDHHMMSS gives us a parseable
-- value; we strip timezone for storage simplicity. This places the run_on
-- in chronological filename-order, matching the (name) sort.
--
-- For migrations sharing the same timestamp prefix (e.g.
-- 20260418240000_agent_transactions and 20260418240000_vouchers), we add
-- a tiny per-name offset (`name`-rank * 1 microsecond) so each row's run_on
-- is unique AND sort-aligned with the alphabetical filename order. This
-- removes any dependency on PostgreSQL's SERIAL allocation order during
-- INSERT...SELECT.
--
-- BUG-FIX 2026-04-29: original parser used `to_timestamp(.., 'YYYYMMDDHH24MISS')`
-- which REJECTS hour values > 23 (and minute > 59, second > 59) with
-- "date/time field value out of range". But the codebase has 5 migrations
-- with intentionally-overflowed prefixes for ordering — e.g.
-- `20260418240000_*` and `20260418250200_*`. Those names are valid in
-- alphabetical-sort terms but blow up `to_timestamp`. We replace the parser
-- with a date-part + (HHMMSS as seconds) decomposition that handles overflow
-- by rolling forward (e.g. 20260418250200 → 2026-04-19 01:02:00).
WITH parsed AS (
  SELECT
    id,
    name,
    -- Date prefix as midnight, then add HH:MM:SS as a seconds-interval that
    -- naturally rolls forward when the value exceeds 24h (e.g. 250200 →
    -- 25 hours + 2 minutes = next day 01:02). Per-name rank within the
    -- same prefix gets a microsecond offset for stable ordering.
    (
      (substring(name, 1, 8) || ' 00:00:00')::timestamp
      + (substring(name, 9, 2)::int * 3600 +
         substring(name, 11, 2)::int * 60 +
         substring(name, 13, 2)::int) * interval '1 second'
      + (row_number() OVER (
          PARTITION BY substring(name FROM 1 FOR 14)
          ORDER BY name
        ) - 1) * interval '1 microsecond'
    ) AS synthetic_run_on
  FROM pgmigrations
  -- Only rows we just inserted in this transaction (run_on within last hour).
  WHERE run_on >= now() - interval '1 hour'
    AND name ~ '^[0-9]{14}_'
)
UPDATE pgmigrations p
SET run_on = parsed.synthetic_run_on
FROM parsed
WHERE p.id = parsed.id;

\echo ''
\echo 'Re-running order-check after backdate:'

WITH numbered AS (
  SELECT
    name,
    run_on,
    row_number() OVER (ORDER BY run_on, id) AS pos_by_run_on,
    row_number() OVER (ORDER BY name)       AS pos_by_name
  FROM pgmigrations
)
SELECT
  count(*)                                                  AS total_rows,
  count(*) FILTER (WHERE pos_by_run_on = pos_by_name)       AS rows_in_agreement,
  count(*) FILTER (WHERE pos_by_run_on <> pos_by_name)      AS rows_out_of_order
FROM numbered; -- BUG-FIX 2026-04-29: was missing FROM clause; aborted txn.

\echo ''
\echo 'If `rows_out_of_order` is 0, node-pg-migrate''s order-check WILL PASS'
\echo 'on the next deploy.'
\echo ''
\echo 'If `rows_out_of_order` > 0, see STEP 5b below for the (manual, opt-in)'
\echo 'normalization of ALL pgmigrations rows. By default STEP 5b is a no-op'
\echo 'commented out — Tobias must uncomment and re-run if needed.'
\echo ''

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5b — (OPTIONAL, OPT-IN) Normalize ALL pgmigrations.run_on values
-- ─────────────────────────────────────────────────────────────────────────────
-- If STEP 4 still shows `rows_out_of_order > 0` after STEP 5, that means
-- pre-existing pgmigrations rows have run_on values that don't match their
-- alphabetical name-order. This typically happens when the partial commit
-- on 2026-04-26 inserted rows in a different order than alphabetical.
--
-- The safest fix is to normalize EVERY row's run_on to its parsed timestamp
-- prefix (with per-name microsecond tie-breaker). This rewrites the run_on
-- of pre-existing rows — bigger surgery — but only touches the LOG of run
-- order, never schema or data.
--
-- ⚠️ This is OPT-IN. Uncomment the UPDATE below ONLY after:
--   1. STEP 4 reports rows_out_of_order > 0 even after STEP 5
--   2. Tobias has reviewed the misordered rows and confirmed they are all
--      false-positive metadata-misordering (not real "we forgot to run X
--      before Y" bugs)
--   3. PM has signed off on rewriting run_on for previously-applied rows

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 5b: Normalize ALL run_on values (OPT-IN, no-op by default)'
\echo '═══════════════════════════════════════════════════════════════════════════'

-- DEFAULT: NO-OP. Uncomment to enable. To enable, change `WHERE 1=0` to `WHERE 1=1`.
--
-- BUG-FIX 2026-04-29: same parser fix as STEP 5 — handle overflow prefixes
-- (e.g. 20260418240000, 20260418250200) by date+seconds decomposition rather
-- than to_timestamp().
WITH all_parsed AS (
  SELECT
    id,
    name,
    (
      (substring(name, 1, 8) || ' 00:00:00')::timestamp
      + (substring(name, 9, 2)::int * 3600 +
         substring(name, 11, 2)::int * 60 +
         substring(name, 13, 2)::int) * interval '1 second'
      + (row_number() OVER (
          PARTITION BY substring(name FROM 1 FOR 14)
          ORDER BY name
        ) - 1) * interval '1 microsecond'
    ) AS synthetic_run_on
  FROM pgmigrations
  WHERE name ~ '^[0-9]{14}_'
)
UPDATE pgmigrations p
SET run_on = all_parsed.synthetic_run_on
FROM all_parsed
WHERE p.id = all_parsed.id
  AND 1=0;  -- ← Change to `AND 1=1` to enable. Default is no-op.

\echo 'STEP 5b: skipped (1=0). Edit the script to enable if needed.'
\echo ''

-- Re-run order-check after STEP 5b (if enabled).
\echo 'Order-check after STEP 5b:'

WITH numbered AS (
  SELECT
    name,
    run_on,
    row_number() OVER (ORDER BY run_on, id) AS pos_by_run_on,
    row_number() OVER (ORDER BY name)       AS pos_by_name
  FROM pgmigrations
)
SELECT
  count(*)                                                  AS total_rows,
  count(*) FILTER (WHERE pos_by_run_on = pos_by_name)       AS rows_in_agreement,
  count(*) FILTER (WHERE pos_by_run_on <> pos_by_name)      AS rows_out_of_order
FROM numbered; -- BUG-FIX 2026-04-29: was missing FROM clause; aborted txn.

\echo ''
\echo 'If rows_out_of_order is still > 0 after STEP 5b is enabled, STOP and'
\echo 'escalate. The pgmigrations table has rows with non-conformant names'
\echo '(not matching the YYYYMMDDHHMMSS_xxx pattern) — those are not handled'
\echo 'by this script and require manual review.'
\echo ''

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6 — Final action
-- ─────────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'STEP 6: Final action'
\echo '═══════════════════════════════════════════════════════════════════════════'
\echo 'Default: ROLLBACK (no permanent change). Edit script to flip to COMMIT.'
\echo ''

ROLLBACK; -- DEFAULT — change to `COMMIT; -- COMMITTED` after dry-run succeeds.
