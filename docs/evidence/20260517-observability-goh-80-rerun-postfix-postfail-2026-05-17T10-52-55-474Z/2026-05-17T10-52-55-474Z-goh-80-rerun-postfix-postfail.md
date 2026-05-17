# Observability Snapshot — goh-80-rerun-postfix-postfail

**Generated:** 2026-05-17T10:52:55.474Z
**Event window:** last 90 minutes (2026-05-17T09:22:55.474Z → 2026-05-17T10:52:55.474Z)
**Git:** codex/goh-4x80-rerun-2026-05-17 @ 1bd55b1f7654 (dirty)

## Summary

- Sentry: OK
- PostHog: OK
- Pilot-monitor P0/P1: 0
- Database snapshot: OK

## Sentry

Query: `is:unresolved`, statsPeriod: `24h`

### spillorama-backend

| Issue | Count | Last seen | Title |
|---|---:|---|---|
| SPILLORAMA-BACKEND-8 | 15 | 2026-05-16T22:46:27.228066Z | N+1 Query |
| SPILLORAMA-BACKEND-A | 3 | 2026-05-16T22:44:37.393439Z | N+1 Query |
| SPILLORAMA-BACKEND-9 | 7 | 2026-05-16T20:06:30.986000Z | Error: Vent 1.0s mellom trekninger. |
| SPILLORAMA-BACKEND-4 | 621 | 2026-05-16T18:54:55.726268Z | N+1 Query |
| SPILLORAMA-BACKEND-7 | 5 | 2026-05-16T15:10:21.942919Z | N+1 Query |
| SPILLORAMA-BACKEND-3 | 143 | 2026-05-16T09:11:14.534738Z | N+1 Query |
| SPILLORAMA-BACKEND-6 | 2 | 2026-05-15T14:34:53.103000Z | Error: Reservasjon med samme key (arm-BINGO_DEMO-PILOT-GOH-7bd7b9ee-1a31-4730-8aae-a480ea7a4ccc-8a51800a-391d-4d50-b4b3-47ee0db68899-9) har beløp 60.000000, ikke 180. |
| SPILLORAMA-BACKEND-5 | 1 | 2026-05-14T11:23:30.663000Z | error: terminating connection due to administrator command |
| SPILLORAMA-BACKEND-2 | 2 | 2026-05-14T07:35:30.528000Z | Error: [OBS-TEST] Smoke-test error fra /api/_dev/observability-test (obs-test-1778744130521) |
| SPILLORAMA-BACKEND-1 | 1 | 2026-05-13T23:06:01.807000Z | SyntaxError: Unexpected token 'y', ..."ata":{"x":yyyyyyyyyy"... is not valid JSON |

### spillorama-frontend

| Issue | Count | Last seen | Title |
|---|---:|---|---|
| SPILLORAMA-FRONTEND-2 | 24 | 2026-05-16T19:28:42.443000Z | loading-overlay.soft-fallback aktivert (state=RECONNECTING) |
| SPILLORAMA-FRONTEND-1 | 27 | 2026-05-16T19:00:43.988000Z | loading-overlay.soft-fallback aktivert (state=RESYNCING) |

## PostHog

Project: Default project

| Event | Count | Last seen |
|---|---:|---|
| ticket.purchase.success | 1898 | 2026-05-17T10:52:41.821000Z |
| spill1.payout.pattern | 30 | 2026-05-17T10:50:23.200000Z |
| spill1.master.start | 4 | 2026-05-17T10:49:15.146000Z |

## Pilot Monitor

Log: `/tmp/pilot-monitor.log`

| Severity | Count |
|---|---:|
| P0 | 0 |
| P1 | 0 |
| P2 | 9 |
| P3 | 5 |

## Database

Postgres: `postgresql://dpg-d6k3ren5r7bs73a4c0bg-a.frankfurt-postgres.render.com/bingo_db_64tj?sslmode=require (user=spillorama_pm_readonly)`

### pg_stat_activity

```text
active | 1
 | 13
```

### game1_scheduled_status_24h

```text
(no rows)
```

### game_plan_run_status_24h

```text
(no rows)
```

## Comparison

Compared with: goh-80-rerun-postfix-preflight (2026-05-17T10:32:52.097Z)

### Sentry New Issues

No new Sentry issues.

### Sentry Count Increases

No issue count increases.

### PostHog Event Deltas

| Event | Delta |
|---|---:|
| ticket.purchase.success | +1258 |
| spill1.payout.pattern | +23 |
| spill1.master.start | +3 |

### Pilot Monitor Delta

- P0 delta: 0
- P1 delta: 0

## Files

- JSON: `/Users/tobiashaugen/Projects/Spillorama-system/docs/evidence/20260517-observability-goh-80-rerun-postfix-postfail-2026-05-17T10-52-55-474Z/2026-05-17T10-52-55-474Z-goh-80-rerun-postfix-postfail.json`
- Markdown: `/Users/tobiashaugen/Projects/Spillorama-system/docs/evidence/20260517-observability-goh-80-rerun-postfix-postfail-2026-05-17T10-52-55-474Z/2026-05-17T10-52-55-474Z-goh-80-rerun-postfix-postfail.md`
- README: `/Users/tobiashaugen/Projects/Spillorama-system/docs/evidence/20260517-observability-goh-80-rerun-postfix-postfail-2026-05-17T10-52-55-474Z/README.md`
