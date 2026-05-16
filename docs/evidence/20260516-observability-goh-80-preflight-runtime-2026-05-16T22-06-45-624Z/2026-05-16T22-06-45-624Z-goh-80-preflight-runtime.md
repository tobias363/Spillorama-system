# Observability Snapshot — goh-80-preflight-runtime

**Generated:** 2026-05-16T22:06:45.624Z
**Event window:** last 30 minutes (2026-05-16T21:36:45.624Z → 2026-05-16T22:06:45.624Z)
**Git:** codex/goh-80-load-test-2026-05-16 @ 9ed83a8cf471 (dirty)

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
| SPILLORAMA-BACKEND-9 | 7 | 2026-05-16T20:06:30.986000Z | Error: Vent 1.0s mellom trekninger. |
| SPILLORAMA-BACKEND-4 | 621 | 2026-05-16T18:54:55.726268Z | N+1 Query |
| SPILLORAMA-BACKEND-8 | 3 | 2026-05-16T16:11:40.867940Z | N+1 Query |
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
| No events | 0 | |

## Pilot Monitor

Log: `/tmp/pilot-monitor.log`

| Severity | Count |
|---|---:|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 1 |

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

## Files

- JSON: `/Users/tobiashaugen/Projects/Spillorama-system-codex/docs/evidence/20260516-observability-goh-80-preflight-runtime-2026-05-16T22-06-45-624Z/2026-05-16T22-06-45-624Z-goh-80-preflight-runtime.json`
- Markdown: `/Users/tobiashaugen/Projects/Spillorama-system-codex/docs/evidence/20260516-observability-goh-80-preflight-runtime-2026-05-16T22-06-45-624Z/2026-05-16T22-06-45-624Z-goh-80-preflight-runtime.md`
- README: `/Users/tobiashaugen/Projects/Spillorama-system-codex/docs/evidence/20260516-observability-goh-80-preflight-runtime-2026-05-16T22-06-45-624Z/README.md`

