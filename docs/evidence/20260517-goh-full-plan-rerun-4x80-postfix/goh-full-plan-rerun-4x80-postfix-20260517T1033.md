# GoH full-plan run 2026-05-17T10-33-16-174Z

- Status: failed
- Backend: http://localhost:4000
- Group of halls: demo-pilot-goh
- Scope: 4 halls x 80 players = 320 players
- Purchase pacing: concurrency 8, retries 4
- Started: 2026-05-17T10:33:16.175Z
- Finished: 2026-05-17T10:52:42.040Z
- Pilot monitor log: /tmp/pilot-monitor.log
- Sentry token present: no
- PostHog env present: no

## Plan Items

| Pos | Slug | Result | Purchases | Tickets | Amount | Draws | Resumes | Marks |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | bingo | completed | 320 | 920 | 12800 kr | 63 | 4 | 13302 |
| 2 | 1000-spill | completed | 320 | 920 | 12800 kr | 62 | 4 | 13015 |
| 3 | 5x500 | completed | 320 | 920 | 12800 kr | 61 | 4 | 12789 |
| 4 | ball-x-10 | n/a | 0 | 0 | 0 kr | 0 | 0 | 0 |

## Anomalies

- 2026-05-17T10:45:32.162Z: purchase.retry.succeeded
- 2026-05-17T10:45:33.012Z: purchase.retry.succeeded
- 2026-05-17T10:45:33.128Z: purchase.retry.succeeded
- 2026-05-17T10:47:21.862Z: purchase.retry.succeeded
- 2026-05-17T10:47:21.980Z: purchase.retry.succeeded
- 2026-05-17T10:47:22.721Z: purchase.retry.succeeded
- 2026-05-17T10:47:23.210Z: purchase.retry.succeeded
- 2026-05-17T10:47:23.896Z: purchase.retry.succeeded
- 2026-05-17T10:49:11.838Z: purchase.retry.succeeded
- 2026-05-17T10:49:11.854Z: purchase.retry.succeeded
- 2026-05-17T10:49:11.997Z: purchase.retry.succeeded
- 2026-05-17T10:49:13.941Z: purchase.retry.succeeded
- 2026-05-17T10:49:14.106Z: purchase.retry.succeeded
- 2026-05-17T10:52:39.861Z: purchase.retry.succeeded
- 2026-05-17T10:52:40.123Z: purchase.retry.succeeded
- 2026-05-17T10:52:40.593Z: purchase.retry.succeeded
- 2026-05-17T10:52:41.161Z: purchase.retry.succeeded
- 2026-05-17T10:52:42.040Z: purchase.retry.succeeded

## Failure

```json
{
  "message": "Round 4 had join/purchase failures",
  "stack": "Error: Round 4 had join/purchase failures\n    at main (file:///Users/tobiashaugen/Projects/Spillorama-system/scripts/dev/goh-full-plan-run.mjs:180:13)\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)"
}
```

## Evidence Files

- JSON: docs/evidence/20260517-goh-full-plan-rerun-4x80-postfix/goh-full-plan-rerun-4x80-postfix-20260517T1033.json
- Markdown: docs/evidence/20260517-goh-full-plan-rerun-4x80-postfix/goh-full-plan-rerun-4x80-postfix-20260517T1033.md
