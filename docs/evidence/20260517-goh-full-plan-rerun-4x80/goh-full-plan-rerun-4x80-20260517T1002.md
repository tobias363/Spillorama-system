# GoH full-plan run 2026-05-17T10-02-26-743Z

- Status: failed
- Backend: http://localhost:4000
- Group of halls: demo-pilot-goh
- Scope: 4 halls x 80 players = 320 players
- Purchase pacing: concurrency 8, retries 4
- Started: 2026-05-17T10:02:26.744Z
- Finished: 2026-05-17T10:16:54.507Z
- Pilot monitor log: /tmp/pilot-monitor.log
- Sentry token present: no
- PostHog env present: no

## Plan Items

| Pos | Slug | Result | Purchases | Tickets | Amount | Draws | Resumes | Marks |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | bingo | completed | 320 | 920 | 12800 kr | 61 | 4 | 0 |
| 2 | 1000-spill | n/a | 0 | 0 | 0 kr | 0 | 0 | 0 |

## Anomalies

- 2026-05-17T10:14:42.614Z: purchase.retry.succeeded
- 2026-05-17T10:14:43.829Z: purchase.retry.succeeded
- 2026-05-17T10:15:59.769Z: ticket.mark.failures
- 2026-05-17T10:16:52.308Z: purchase.retry.succeeded
- 2026-05-17T10:16:52.331Z: purchase.retry.succeeded
- 2026-05-17T10:16:52.700Z: purchase.retry.succeeded
- 2026-05-17T10:16:53.534Z: purchase.retry.succeeded
- 2026-05-17T10:16:53.764Z: purchase.retry.succeeded

## Failure

```json
{
  "message": "Round 2 had join/purchase failures",
  "stack": "Error: Round 2 had join/purchase failures\n    at main (file:///Users/tobiashaugen/Projects/Spillorama-system/scripts/dev/goh-full-plan-run.mjs:180:13)\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)"
}
```

## Evidence Files

- JSON: docs/evidence/20260517-goh-full-plan-rerun-4x80/goh-full-plan-rerun-4x80-20260517T1002.json
- Markdown: docs/evidence/20260517-goh-full-plan-rerun-4x80/goh-full-plan-rerun-4x80-20260517T1002.md
