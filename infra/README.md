# Spillorama — infra/

Deploy scripts and observability provisioning for the backend stack.

## Layout

| Path | Purpose |
| --- | --- |
| `deploy-backend.sh` | Triggers a Render backend deploy. Called from CI + manually. |
| `deploy/grafana-provision.sh` | BIN-539: Uploads `grafana/dashboards/*.json` to a Grafana instance via the HTTP API. Idempotent — running twice updates existing dashboards by uid. |
| `grafana/dashboards/*.json` | BIN-539: Three dashboards wired to the Prometheus datasource — draws & claims, connection health, finance gates. |
| `grafana/validate-dashboards.mjs` | Structural sanity check for the dashboard JSONs. Run before committing. |

## Grafana dashboards (BIN-539)

### What we provision

1. **`draws-and-claims.json`** — Live operational view per hall (claim rate, payout quantiles, active rooms). Watched by on-call during a pilot run.
2. **`connection-health.json`** — Socket health (reconnect ratio, rate-limit rejections, scheduler tick). First dashboard the on-call opens if a pilot goes sideways.
3. **`finance-gates.json`** — Compliance signals (draw-engine errors, wallet-operation latency, claim-type distribution, per-hall payout volume). Watched by compliance-eier + on-call.

All three reference the Prometheus datasource via the `${DS_PROM}` template variable and carry the tags `spillorama` + `BIN-539`.

### Validate locally

```bash
node infra/grafana/validate-dashboards.mjs
```

Checks valid JSON, required keys (title / uid / panels / templating / tags), unique uids, panel → target → datasource binding. Fails non-zero on drift. Designed to be callable from CI.

### Deploy to a Grafana instance

Prereqs:

- `curl`, `jq` on the path.
- A Grafana service-account token scoped for `Dashboards:Write`. In Grafana UI: *Administration → Service accounts → Add service account → Add token*. Save the token as a secret (**never** commit it).
- The Prometheus datasource must already exist in the target Grafana — dashboards pick it up by type, not name, via the `${DS_PROM}` template variable.

Then:

```bash
export GRAFANA_URL=https://grafana.internal
export GRAFANA_API_KEY=<service-account-token>
# Optional — drop all dashboards into a specific folder (by uid):
export GRAFANA_FOLDER_UID=spillorama

./infra/deploy/grafana-provision.sh
```

Output (success):

```
>> Uploading draws-and-claims.json
   ✓ uid=spillorama-draws-claims version=3 url=https://grafana.internal/d/spillorama-draws-claims/...
>> Uploading connection-health.json
   ✓ uid=spillorama-connection-health version=3 url=https://grafana.internal/d/...
>> Uploading finance-gates.json
   ✓ uid=spillorama-finance-gates version=3 url=https://grafana.internal/d/...
All dashboards provisioned.
```

The script calls `POST /api/dashboards/db` with `overwrite: true`, so rerunning simply bumps the dashboard version.

### Wire into deploy pipeline

The script is deliberately manual for the first pilot run — operator review of "is the dashboard actually rendering" is worth the extra step. Once the flow is proven we can add a CI step (e.g. a nightly GitHub Action with `GRAFANA_API_KEY` as an environment secret) that re-runs `grafana-provision.sh` on any change to `infra/grafana/dashboards/*.json`.

### Thresholds (reference)

Aligned with `docs/operations/OBSERVABILITY_RUNBOOK.md` §2:

| Signal | Threshold | Dashboard panel |
| --- | --- | --- |
| Reconnect ratio (5m) | < 2 % green, 2–5 % orange, > 5 % red + page | `connection-health.json` → *Reconnect ratio* |
| Scheduler p99 | < 250 ms green, > 500 ms red | `connection-health.json` → *Scheduler tick p95/p99* |
| Draw-engine errors / 5m | 0 green, > 5 / 5m red + page | `finance-gates.json` → *Draw-engine errors* |
| Stuck rooms | 0 green, > 0 red + page | `finance-gates.json` → *Stuck rooms* |
| Lock timeouts | 0 green, > 0 red | `finance-gates.json` → *Scheduler lock timeouts* |
| Wallet-op p99 | < 500 ms green, > 2000 ms red | `finance-gates.json` → *Wallet operation latency* |

### Known gaps / follow-ups

- **Sentry message → Grafana annotation** (for `client_draw_gap`): deferred until a Sentry→Grafana webhook is wired. In the meantime the on-call watches the Sentry spillorama-client project tab alongside.
- **Alert rules are not defined in JSON** (yet). The JSON ships panel thresholds (green / orange / red bands) but not PagerDuty/Slack routing — that lives in Grafana's alerting UI after the dashboards land. Rules deliberately aren't in source yet because the rule-DSL is fragile and staging/prod don't agree on notification channels.
- **No per-hall `$hall` variable on connection-health/finance-gates**: `draws-and-claims` has it; the other two are system-wide by design. If a per-hall split becomes important we add it case-by-case.
- **No dropped-event counter** (`bingo_connection_dropped_total`): the existing metric surface is sufficient for pilot (reconnect + rate-limit + stuck rooms). A dedicated dropped-event metric is queued for a follow-up issue once we've seen a real event at volume.
