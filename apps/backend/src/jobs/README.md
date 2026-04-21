# Background jobs (BIN-582)

Periodic tasks ported from the legacy `unity-backend/Boot/Server.js`
cron setup. The new backend had no cron engine — `createJobScheduler`
fills that gap with the same `setInterval` + date-key pattern already used
by `createDailyReportScheduler`, plus an optional Redis lock so only one
instance runs each tick in multi-node deploys.

## Registered jobs

| Job name | Schedule (legacy) | Schedule (new default) | Owner area | Flag |
| --- | --- | --- | --- | --- |
| `swedbank-payment-sync` | every hour (`0 * * * *`) | every 60 min, `setInterval` | Payments | `JOB_SWEDBANK_ENABLED` |
| `bankid-expiry-reminder` | daily 00:00 (`0 0 * * *`) | polled every 15 min, runs once after 07:00 local | KYC / auth | `JOB_BANKID_ENABLED` |
| `self-exclusion-cleanup` | daily 00:00 (`0 0 * * *`) | polled every 15 min, runs once after 00:00 local | Responsible gaming (Spillvett) | `JOB_RG_CLEANUP_ENABLED` |
| `game1-schedule-tick` | every 15 s (`startGameCron`) | every 15 s, `setInterval` | Game 1 / scheduling | `GAME1_SCHEDULE_TICK_ENABLED` |

Master kill-switch: `JOBS_ENABLED` (default `true`).

## What each job does

### `swedbank-payment-sync`
Queries `swedbank_payment_intents` for rows whose status is not one of
`PAID | CREDITED | FAILED | EXPIRED | CANCELLED` and that are younger
than 24h, then calls `SwedbankPayService.reconcileIntentForUser` on each.
Legacy equivalent: `swedbankpayCronToUpdateTransaction` in
legacy refs.

Behaviour in dev when the table doesn't exist yet: logs a `table missing`
note and returns 0 items (does not raise).

### `bankid-expiry-reminder`
Scans `app_users` for KYC verifications within 30 days of expiring
(treated as 12 months from `kyc_verified_at` — a legacy proxy until the
OIDC BankID handshake gives us a real `id_document_expires_at` column).
Expiring users get a log line (e-mail is stubbed until SMTP is signed
off). Already-expired verifications are flipped to `kyc_status='EXPIRED'`
so login forces re-KYC. Legacy equivalent:
`checkBankIdAndIdCardExpiryAndSendReminders` in
legacy refs.

### `self-exclusion-cleanup`
Clears expired voluntary pauses (`timed_pause_until`) and lifts the
self-exclusion minimum marker (`self_exclusion_minimum_until`) when 1
year has passed. `self_excluded_at` is left in place to preserve the
audit trail; lifting the exclusion itself requires an explicit user
action per Spillvett policy. Legacy equivalent: `updatePlayerBlockRules`
in legacy refs.

### `game1-schedule-tick` (GAME1_SCHEDULE PR 1)
Spawns Game 1 rows into `app_game1_scheduled_games` from
`app_daily_schedules` × schedule-mal (looked up via
`daily_schedule.other_data.scheduleId`) × subGames, 24 h ahead. Per tick it
also transitions `scheduled → purchase_open` when
`scheduled_start_time - notification_start_seconds <= now`, and
marks expired rows `cancelled` with `stop_reason='end_of_day_unreached'`.
Legacy equivalents: `processDailySchedules` + `createGame1FromSchedule`
in `legacy/unity-backend/Game/Game1/helpers/gameHelper.js` (15 s cron).

Default **OFF** (`GAME1_SCHEDULE_TICK_ENABLED=false`) until PR 2-3 land
the ready-flow and master-start endpoints — otherwise spawned rows would
just sit in `scheduled` without a way to progress. Enable in staging
after PR 3 merges.

Behaviour when tables don't exist: returns 0 items + a note (matches
swedbank-payment-sync pattern).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `JOBS_ENABLED` | `true` | Master kill-switch — disables all jobs in one toggle. |
| `JOB_SWEDBANK_ENABLED` | `true` | Toggle Swedbank reconcile job. |
| `JOB_SWEDBANK_INTERVAL_MS` | `3600000` (1h) | Tick interval. |
| `JOB_BANKID_ENABLED` | `true` | Toggle BankID expiry job. |
| `JOB_BANKID_INTERVAL_MS` | `900000` (15m) | Polling tick; body only runs once per calendar day after `JOB_BANKID_RUN_AT_HOUR`. |
| `JOB_BANKID_RUN_AT_HOUR` | `7` | Local-time hour after which the daily body is allowed. |
| `JOB_RG_CLEANUP_ENABLED` | `true` | Toggle self-exclusion/pause cleanup job. |
| `JOB_RG_CLEANUP_INTERVAL_MS` | `900000` (15m) | Polling tick. |
| `JOB_RG_CLEANUP_RUN_AT_HOUR` | `0` | Local-time hour after which the daily body is allowed. |
| `GAME1_SCHEDULE_TICK_ENABLED` | `false` | Toggle Game 1 schedule-tick (default OFF until PR 2-3 ready). |
| `GAME1_SCHEDULE_TICK_INTERVAL_MS` | `15000` (15s) | Tick interval (legacy parity). |

## Multi-instance safety

When `SCHEDULER_LOCK_PROVIDER=redis` (the existing
`RedisSchedulerLock`), every tick acquires a per-job key
(`bingo:lock:job:<name>`) with a 60s TTL. A second instance that fires at
the same moment sees `null` from `withLock` and skips the body, so the
work is not duplicated. Single-node dev (no Redis lock) runs every tick
unconditionally — acceptable because the jobs are idempotent.

## Operational notes

- Each tick logs `tick:start`, `tick:done` (with `itemsProcessed` and
  `durationMs`), or `tick:error`. All logs go through the central pino
  logger with the usual redaction rules applied.
- Daily jobs are idempotent: they key on `YYYY-MM-DD` and return early
  after the first successful run of the day.
- Jobs are registered in `src/index.ts` after `dailyReportScheduler` and
  stopped from the shutdown handler before the DB pool closes.
