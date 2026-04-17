# Backend load-tests (BIN-508)

Artillery-based Socket.IO load-tests for the Spillorama bingo backend. The primary scenario validates that the backend handles 1000+ concurrent players in a single room without dropping events.

## Files

| File | Purpose |
| --- | --- |
| `room-1000-players.yml` | Main scenario — 4-phase ramp-up/sustain/running/ramp-down. |
| `room-1000-players.processor.js` | Token seeding + `drawLoop` listener + latency histogram. |

## Acceptance criteria

A run is "passed" when all three hold:

1. **`p99(latency_draw_to_client_ms) < 500`** — the draw-to-client latency at the 99th percentile.
2. **`server CPU < 80%`** during phase 3 ("running"). Read from Grafana, `/metrics`, or `htop` on the node.
3. **Zero dropped events** — no `engine.unresponsive`, no `disconnects before ramp-down` in the Artillery report.

## Prerequisites

### Backend config

The scenario sends `accessToken: "loadtest-<uuid>"` on every emit. In a real deployment the auth middleware would reject unknown tokens, so run with:

```bash
# On the backend being load-tested
AUTH_ALLOW_LOADTEST=true \
REDIS_URL=redis://<redis-host>:6379 \
NODE_ENV=staging \
BINGO_MAX_DRAWS_PER_ROUND=75 \
npm --prefix apps/backend start
```

`AUTH_ALLOW_LOADTEST=true` tells the platform service to synthesize an ephemeral user for any token with the `loadtest-` prefix. **This flag must never be set in production** — there is a fail-safe in `PlatformService` that throws on startup if both this flag and `NODE_ENV=production` are set. (If that fail-safe is missing in the branch you're on, add it in the same PR as the first production run of this scenario.)

`REDIS_URL` is required because the scenario exercises multi-node fanout behavior (BIN-494). Without Redis, `io.to(room).emit(...)` only reaches the node each client is pinned to, so latency numbers will be artificially low on a single-node run.

### Runner host limits

1000 concurrent WebSocket connections easily exceeds the default per-process file-descriptor limit. **Before running:**

```bash
ulimit -n 65536
```

On macOS you may also need `sudo launchctl limit maxfiles 65536 200000`. On Linux CI runners the GitHub-hosted `ubuntu-latest` image defaults to 65 536, so no change needed for the nightly workflow.

## Running locally

```bash
# From repo root
ulimit -n 65536

# Smoke — 500 VUs, faster iteration
TARGET=ws://localhost:4000 \
  npx --prefix apps/backend artillery run \
    --scenario-name 500-player-smoke \
    apps/backend/load-tests/room-1000-players.yml

# Full — 1000 VUs
TARGET=ws://localhost:4000 \
  npx --prefix apps/backend artillery run \
    --scenario-name 1-player-lifecycle \
    apps/backend/load-tests/room-1000-players.yml
```

The report prints median / p95 / p99 of `latency_draw_to_client_ms` plus counters (`drawLoop.timeout`, `vusers.completed`, `vusers.failed`).

## Baseline — TO BE FILLED after first CI runs

The BIN-508 nightly workflow fires the full 1000-VU scenario at a staging target and writes the summary to the workflow's run log. Paste the first three successful run numbers here so regressions are easy to spot:

| Date | Scenario | VUs | p50 ms | p95 ms | p99 ms | CPU % | Drops | Run link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _TBD_ | 500-player-smoke | 500 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| _TBD_ | 1-player-lifecycle | 1000 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| _TBD_ | 1-player-lifecycle | 1000 | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

The 500-VU baseline was previously validated via `apps/backend/tools/draw-session-loadtest.ts` in the `feat/multi-hall-databingo-v1` branch (p95 ≤ 100 ms at 500 VUs, per BIN-508 description). That tool is not yet in main — once it lands, add its numbers to the table above for cross-validation.

## Known limitations

- **Single-room scenario only.** BIN-508 focuses on the fanout hotpath within one room. Multi-hall / multi-room scaling (e.g. 10 halls × 100 VUs each) is tracked separately.
- **No ticket-marking correctness check.** `drawLoop` emits `ticket:mark` on a deterministic heuristic (`number % 3 === 0`) without verifying the number is actually on the issued ticket. This is fine for perf measurement — invalid marks cost the same backend-CPU as valid ones — but means the claim-submit path occasionally claims an invalid BINGO. Server-side validation rejects those; the report will show them as non-fatal error counters.
- **No observability plumbing.** CPU / memory / GC metrics come from whatever dashboard you're watching (Grafana, `/metrics`). BIN-539 adds Prometheus histograms for latency so the numbers can be read from `/metrics` after the run.

## Nightly CI

`.github/workflows/nightly-loadtest.yml` runs the full scenario every night at 02:00 UTC against the staging target. It's non-blocking for PRs — this is an ops signal, not a gate. Failures are surfaced as a Slack alert (configured in the workflow) but do not fail the main CI.
