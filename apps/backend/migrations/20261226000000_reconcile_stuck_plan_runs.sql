-- FIX-1 (2026-05-14): Backfill — auto-finish eksisterende stuck plan-runs.
--
-- Bakgrunn:
--   OBS-6 DB-auditor (audit:db --quick) avdekket et stuck plan-run:
--
--     plan_run_id: 30dfdd2c-9fa2-4102-bcc8-ed3a69cf9938
--     plan_run_status: running
--     hall_id: demo-hall-001
--     current_position: 1
--     business_date: 2026-05-13
--     active_sched_count: 0
--     total_sched_count: 1
--
--   Plan-run står i `status='running'` men ingen scheduled-games er aktive
--   (alle er i 'completed'/'cancelled'/'finished'). Klient sitter fast og
--   venter på neste runde som aldri spawnes.
--
-- Hvorfor reconcile på DB-nivå:
--   Eksisterende `GamePlanRunCleanupService.cleanupAllStale` finner kun rader
--   med `business_date < CURRENT_DATE`. Dette stuck-tilfellet er FRA I DAG
--   men plan-run er fortsatt running uten aktiv scheduled-game — så cron-
--   cleanup vil aldri ta den. Backfill her er en éngangs-rydding av rader
--   eldre enn 7 dager pluss audit-event for hver finishet rad.
--
--   Runtime-fixen i `MasterActionService.start()` + `advanceToNext()` (samme
--   PR) reconcileer slike rader on-the-fly FØR ny runde startes, så fremtidige
--   stuck-rader auto-rydder seg ved neste master-handling. Backfill rydder
--   gamle og nyere stuck-rader som ble igjen før fixen ble deployet.
--
-- §71-pengespillforskriften:
--   Plan-run-state må stemme med scheduled-games for daglig regulatorisk
--   rapport. Stuck-rader bryter denne invarianten siden plan-run telles som
--   "running" mens ingen spill faktisk pågår. Vi append-er audit-event per
--   reconcile slik at Lotteritilsynet kan reprodusere hvilke rader som ble
--   ryddet, når, og hvorfor.
--
-- Forward-only (ADR-0014):
--   Migrationen er idempotent — WHERE-klausulen filtrerer på status='running'
--   så finished rader berøres ikke ved re-kjøring. Audit-INSERT bruker
--   gen_random_uuid() så ingen kollisjon mulig.
--
-- Up

BEGIN;

-- Steg 1: Finn og finish stuck plan-runs (last 7 days, defensive cap).
-- WHERE-klausulen plukker kun rader hvor:
--   1. status = 'running' (idle/paused/finished påvirkes ikke)
--   2. business_date >= today - 7d (vi gjør ikke arkeologi)
--   3. INGEN scheduled-games for plan-run-id er i en aktiv status.
--
-- NOT EXISTS er mer eksplisitt enn NOT IN (NULL-safe) og lar planneren
-- bruke index på plan_run_id-FK.
WITH stuck_runs AS (
  SELECT pr.id,
         pr.plan_id,
         pr.hall_id,
         pr.business_date,
         pr.current_position,
         pr.status AS previous_status
    FROM app_game_plan_run pr
   WHERE pr.status = 'running'
     AND pr.business_date >= (CURRENT_DATE - INTERVAL '7 days')
     AND NOT EXISTS (
       SELECT 1
         FROM app_game1_scheduled_games sg
        WHERE sg.plan_run_id = pr.id
          AND sg.status IN (
            'scheduled',
            'purchase_open',
            'ready_to_start',
            'running',
            'paused'
          )
     )
),
finished AS (
  UPDATE app_game_plan_run r
     SET status      = 'finished',
         finished_at = COALESCE(r.finished_at, now()),
         updated_at  = now()
    FROM stuck_runs sr
   WHERE r.id = sr.id
   RETURNING r.id, r.plan_id, r.hall_id, r.business_date, r.current_position
)
INSERT INTO app_audit_log (
  actor_id,
  actor_type,
  action,
  resource,
  resource_id,
  details,
  created_at
)
SELECT
  'fix-1-backfill',
  'SYSTEM',
  'plan_run.reconcile_stuck.backfill',
  'app_game_plan_run',
  f.id,
  jsonb_build_object(
    'reason',           'backfill_stuck_state_2026_05_14',
    'plan_id',          f.plan_id,
    'hall_id',          f.hall_id,
    'business_date',    f.business_date,
    'current_position', f.current_position,
    'previous_status',  'running',
    'new_status',       'finished'
  ),
  now()
FROM finished f;

COMMIT;
