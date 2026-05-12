-- 2026-05-12: Cleanup av pre-PR-#1253 stale `app_game1_scheduled_games`-rader.
--
-- Bakgrunn:
--   Før PR #1253 (`fix(spill1): bridge tar over eksisterende hall-default-
--   rom`) kunne bridgen lazy-bind room_code etter spawn. Hvis serveren
--   krasjet eller en agent ble re-spawnet før det skjedde, ble `room_code`
--   stående NULL. Etter PR #1253 håndhever `idx_app_game1_scheduled_games_
--   room_code` (unique-indeks fra migration 20261221000000) at aktive rader
--   må ha non-null room_code, så nye rader rammes ikke. De gamle NULL-
--   radene henger fortsatt i `status='scheduled'`.
--
-- Hvorfor cleanup nå:
--   - PITFALLS §4.4-fix (samme PR som denne migrationen — `fix/spill1-bridge-
--     cancelled-row-reuse-2026-05-12`) endrer idempotency-SELECT til å
--     ekskludere `'cancelled'`+`'completed'` rader.
--   - De stale NULL-room_code-radene kan i teorien matche idempotency-
--     SELECT på (plan_run_id, plan_position) hvis noen advance-r til
--     samme posisjon. For pilot er det null sannsynlighet (alle har
--     `plan_run_id=NULL`), men cleanup fjerner risikoen helt.
--
-- Påvirker:
--   - `app_game1_scheduled_games`-rader hvor `status='scheduled'` AND
--     `room_code IS NULL`. Disse cancelleres med `stop_reason=
--     'pre_pr_1253_cleanup'` og `actual_end_time=now()`.
--
-- Idempotens:
--   WHERE-klausulen filtrerer kun ikke-cancelled NULL-room_code-rader.
--   Etter første kjøring blir disse `status='cancelled'`, så re-kjøring
--   matcher ingenting. Forward-only per ADR-0014.
--
-- Test-resultat lokalt (2026-05-12 før kjøring):
--   `SELECT count(*) FROM app_game1_scheduled_games WHERE status =
--    'scheduled' AND room_code IS NULL;` → 24
--
-- Up

UPDATE app_game1_scheduled_games
   SET status          = 'cancelled',
       stop_reason     = 'pre_pr_1253_cleanup',
       actual_end_time = COALESCE(actual_end_time, now()),
       updated_at      = now()
 WHERE status     = 'scheduled'
   AND room_code IS NULL;
