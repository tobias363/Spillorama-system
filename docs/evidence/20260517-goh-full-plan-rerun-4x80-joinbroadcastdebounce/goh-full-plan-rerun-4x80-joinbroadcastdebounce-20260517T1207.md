# GoH full-plan run 2026-05-17T12-07-31-519Z

- Status: failed
- Backend: http://localhost:4000
- Group of halls: demo-pilot-goh
- Scope: 4 halls x 80 players = 320 players
- Purchase pacing: concurrency 8, retries 4
- Started: 2026-05-17T12:07:31.520Z
- Finished: 2026-05-17T12:26:28.239Z
- Pilot monitor log: /tmp/pilot-monitor.log
- Sentry token present: no
- PostHog env present: no

## Plan Items

| Pos | Slug | Result | Purchases | Tickets | Amount | Draws | Resumes | Marks |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | bingo | completed | 320 | 920 | 12800 kr | 57 | 4 | 12039 |
| 2 | 1000-spill | completed | 320 | 920 | 12800 kr | 57 | 4 | 12060 |
| 3 | 5x500 | completed | 320 | 920 | 12800 kr | 62 | 4 | 13097 |
| 4 | ball-x-10 | completed | 320 | 920 | 12800 kr | 61 | 4 | 12959 |
| 5 | bokstav | n/a | 0 | 0 | 0 kr | 0 | 0 | 0 |

## Anomalies

- 2026-05-17T12:19:41.457Z: purchase.retry.succeeded
- 2026-05-17T12:19:42.425Z: purchase.retry.succeeded
- 2026-05-17T12:19:42.793Z: purchase.retry.succeeded
- 2026-05-17T12:21:16.840Z: purchase.retry.succeeded
- 2026-05-17T12:21:16.903Z: purchase.retry.succeeded
- 2026-05-17T12:21:17.580Z: purchase.retry.succeeded
- 2026-05-17T12:21:18.293Z: purchase.retry.succeeded
- 2026-05-17T12:21:18.481Z: purchase.retry.succeeded
- 2026-05-17T12:21:18.726Z: purchase.retry.succeeded
- 2026-05-17T12:22:52.672Z: purchase.retry.succeeded
- 2026-05-17T12:22:53.185Z: purchase.retry.succeeded
- 2026-05-17T12:22:53.916Z: purchase.retry.succeeded
- 2026-05-17T12:22:53.981Z: purchase.retry.succeeded
- 2026-05-17T12:24:35.698Z: purchase.retry.succeeded
- 2026-05-17T12:24:36.180Z: purchase.retry.succeeded
- 2026-05-17T12:24:36.204Z: purchase.retry.succeeded
- 2026-05-17T12:24:36.879Z: purchase.retry.succeeded
- 2026-05-17T12:24:36.971Z: purchase.retry.succeeded
- 2026-05-17T12:24:37.497Z: purchase.retry.succeeded
- 2026-05-17T12:24:38.207Z: purchase.retry.succeeded
- 2026-05-17T12:24:38.376Z: purchase.retry.succeeded
- 2026-05-17T12:24:38.600Z: purchase.retry.succeeded
- 2026-05-17T12:26:20.556Z: purchase.retry.succeeded
- 2026-05-17T12:26:20.671Z: purchase.retry.succeeded
- 2026-05-17T12:26:20.884Z: purchase.retry.succeeded
- 2026-05-17T12:26:21.888Z: purchase.retry.succeeded
- 2026-05-17T12:26:22.214Z: purchase.retry.succeeded
- 2026-05-17T12:26:22.374Z: purchase.retry.succeeded
- 2026-05-17T12:26:22.986Z: purchase.retry.succeeded
- 2026-05-17T12:26:23.146Z: purchase.retry.succeeded
- 2026-05-17T12:26:23.861Z: purchase.retry.succeeded
- 2026-05-17T12:26:24.931Z: purchase.retry.succeeded
- 2026-05-17T12:26:25.102Z: purchase.retry.succeeded
- 2026-05-17T12:26:25.247Z: purchase.retry.succeeded
- 2026-05-17T12:26:26.340Z: purchase.retry.succeeded
- 2026-05-17T12:26:26.886Z: purchase.retry.succeeded
- 2026-05-17T12:26:27.606Z: purchase.retry.succeeded

## Failure

```json
{
  "message": "Round 5 had join/purchase failures",
  "stack": "Error: Round 5 had join/purchase failures\n    at main (file:///Users/tobiashaugen/Projects/Spillorama-system/scripts/dev/goh-full-plan-run.mjs:180:13)\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)"
}
```

## Evidence Files

- JSON: docs/evidence/20260517-goh-full-plan-rerun-4x80-joinbroadcastdebounce/goh-full-plan-rerun-4x80-joinbroadcastdebounce-20260517T1207.json
- Markdown: docs/evidence/20260517-goh-full-plan-rerun-4x80-joinbroadcastdebounce/goh-full-plan-rerun-4x80-joinbroadcastdebounce-20260517T1207.md
