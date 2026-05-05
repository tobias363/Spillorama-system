# Module: `apps/backend/src/jobs` — Background jobs (BIN-582)

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~2 419

## Ansvar

Periodic tasks driven by the `createJobScheduler` helper — same
`setInterval` + date-key pattern already used by
`createDailyReportScheduler`, plus an optional Redis lock so only one
instance runs each tick in multi-node deploys.

Inkluderer cron-jobber for:
- Game1 schedule-tick (auto-eskalering)
- Outbox-delivery (ADR-004)
- Reconciliation (wallet, compliance-ledger)
- Audit-anchor (ADR-003)
- Self-exclusion-cleanup, BankID-expiry-reminder
- Machine-ticket auto-close (Metronia, OK Bingo)

## Public API

`createJobScheduler(...)` plus per-job-modules under `apps/backend/src/jobs/`.
Configurable via env-vars:
- `JOBS_ENABLED=true` (master kill-switch)
- Per-job: `JOB_<NAME>_ENABLED=true|false`

## Registered jobs

| Job name | Schedule | Owner area | Flag |
| --- | --- | --- | --- |
| `swedbank-payment-sync` | every 60 min, `setInterval` | Payments | `JOB_SWEDBANK_ENABLED` |
| `bankid-expiry-reminder` | polled every 15 min, runs once after 07:00 local | KYC / auth | `JOB_BANKID_ENABLED` |
| `self-exclusion-cleanup` | polled every 15 min, runs once after 00:00 local | Responsible gaming (Spillvett) | `JOB_RG_CLEANUP_ENABLED` |
| `machine-ticket-auto-close` | polled every 15 min, runs once after 00:00 local | Metronia / OK Bingo (agent-POS) | `JOB_MACHINE_AUTO_CLOSE_ENABLED` |
| `game1-schedule-tick` | every 15 s, `setInterval` | Game 1 / scheduling | `GAME1_SCHEDULE_TICK_ENABLED` |

Master kill-switch: `JOBS_ENABLED` (default `true`).

## What each job does

### `swedbank-payment-sync`
Queries `swedbank_payment_intents` for rows whose status is not one of
`PAID | CREDITED | FAILED | EXPIRED | CANCELLED` and that are younger
than 24h, then calls `SwedbankPayService.reconcileIntentForUser` on each.

Behaviour in dev when the table doesn't exist yet: logs a `table missing`
note and returns 0 items (does not raise).

### `bankid-expiry-reminder`
Scans `app_users` for KYC verifications within 30 days of expiring
(treated as 12 months from `kyc_verified_at` — a legacy proxy until the
OIDC BankID handshake gives us a real `id_document_expires_at` column).
Expiring users get a log line (e-mail is stubbed until SMTP is signed
off). Already-expired verifications are flipped to `kyc_status='EXPIRED'`
so login forces re-KYC.

### `self-exclusion-cleanup`
Clears expired voluntary pauses (`timed_pause_until`) and lifts the
self-exclusion minimum marker (`self_exclusion_minimum_until`) when 1
year has passed. `self_excluded_at` is left in place to preserve the
audit trail; lifting the exclusion itself requires an explicit user
action per Spillvett policy.

### `machine-ticket-auto-close`
Daglig auto-close av hengende Metronia- og OK-Bingo-billetter — port av
legacy `Boot/Server.js:583-618` `autoCloseTicket('Metronia')` +
`autoCloseTicket('OK Bingo')`. Scanner `app_machine_tickets` for rader
der `is_closed=false` OG `created_at <= now() - maxAgeHours` (default
24h), og kaller `autoCloseTicket()` på tilhørende service. Wallet credit +
DB mark-closed + compliance-audit håndteres per ticket. Per-ticket-feil
logges og telles, men avbryter ikke batchen — hver ticket retry-es neste
dag.

Systembruker `system:auto-close-cron` brukes som `closed_by_user_id`.
`agent_transactions`-rad skrives kun hvis `ticket.shift_id` fortsatt er
satt (kolonnen er NOT NULL i DB); compliance-audit-entry skrives
uavhengig av dette. Idempotent via `uniqueTransaction`-suffix `:auto`.

### `game1-schedule-tick` (GAME1_SCHEDULE PR 1)
Spawns Game 1 rows into `app_game1_scheduled_games` from
`app_daily_schedules` × schedule-mal (looked up via
`daily_schedule.other_data.scheduleId`) × subGames, 24 h ahead. Per tick it
also transitions `scheduled → purchase_open` when
`scheduled_start_time - notification_start_seconds <= now`, and
marks expired rows `cancelled` with `stop_reason='end_of_day_unreached'`.

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
| `JOB_MACHINE_AUTO_CLOSE_ENABLED` | `true` | Toggle Metronia/OK-Bingo auto-close cron. |
| `JOB_MACHINE_AUTO_CLOSE_INTERVAL_MS` | `900000` (15m) | Polling tick. |
| `JOB_MACHINE_AUTO_CLOSE_RUN_AT_HOUR` | `0` | Local-time hour after which the daily body is allowed (legacy var 00:00). |
| `JOB_MACHINE_AUTO_CLOSE_MAX_AGE_HOURS` | `24` | Lukker kun billetter eldre enn dette. Legacy var 24h (forrige driftsdøgn). |
| `GAME1_SCHEDULE_TICK_ENABLED` | `false` | Toggle Game 1 schedule-tick (default OFF until PR 2-3 ready). |
| `GAME1_SCHEDULE_TICK_INTERVAL_MS` | `15000` (15s) | Tick interval. |

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

## Referanser

- BIN-582 (Background jobs)
- BIN-587 (Self-exclusion cleanup)
- ADR-003 (Hash-chain audit)
- ADR-004 (Outbox pattern)
- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md`
