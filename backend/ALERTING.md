# Alerting & Monitoring Guide

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Full system health (DB queries, wallet, halls) |
| `GET /readiness` | Lightweight DB ping for load balancer probes |
| `GET /metrics` | Prometheus metrics export |

## Prometheus Alert Rules

### Critical — Immediate Action Required

```yaml
# Scheduler stopped — no draws happening
- alert: SchedulerStopped
  expr: rate(bingo_draws_total[5m]) == 0
  for: 3m
  labels:
    severity: critical
  annotations:
    summary: "No draws in 5 minutes — scheduler may have stopped"

# Process restarting repeatedly
- alert: HighRestartRate
  expr: changes(process_start_time_seconds[1h]) > 3
  labels:
    severity: critical
  annotations:
    summary: "Backend restarted >3 times in 1 hour"
```

### Warning — Investigate Soon

```yaml
# Draw latency too high
- alert: DrawLatencyHigh
  expr: histogram_quantile(0.99, rate(bingo_draw_duration_ms_bucket[5m])) > 500
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "p99 draw latency >500ms"

# Claim latency too high
- alert: ClaimLatencyHigh
  expr: histogram_quantile(0.99, rate(bingo_claim_duration_ms_bucket[5m])) > 1000
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "p99 claim latency >1000ms"

# Unusual socket connection count
- alert: HighSocketConnections
  expr: bingo_socket_connections_active > 500
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Over 500 active socket connections"

# Memory usage high
- alert: HighMemoryUsage
  expr: process_resident_memory_bytes > 512 * 1024 * 1024
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Backend memory usage >512MB"

# Event loop lag
- alert: EventLoopLag
  expr: nodejs_eventloop_lag_p99_seconds > 0.5
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Node.js event loop p99 lag >500ms"
```

### Info — Dashboard Monitoring

```yaml
# Games per hour
- record: bingo:games_per_hour
  expr: rate(bingo_games_started_total[1h]) * 3600

# Payout rate (NOK per hour)
- record: bingo:payout_nok_per_hour
  expr: rate(bingo_payout_amount_nok_total[1h]) * 3600

# Average draw duration
- record: bingo:avg_draw_duration_ms
  expr: rate(bingo_draw_duration_ms_sum[5m]) / rate(bingo_draw_duration_ms_count[5m])
```

## Grafana Dashboard Queries

| Panel | PromQL |
|-------|--------|
| Draws/min | `rate(bingo_draws_total[1m]) * 60` |
| Active connections | `bingo_socket_connections_active` |
| Active rooms | `bingo_active_rooms` |
| Draw latency p50 | `histogram_quantile(0.5, rate(bingo_draw_duration_ms_bucket[5m]))` |
| Draw latency p99 | `histogram_quantile(0.99, rate(bingo_draw_duration_ms_bucket[5m]))` |
| Payouts/hour | `rate(bingo_payouts_total[1h]) * 3600` |
| Total paid NOK | `bingo_payout_amount_nok_total` |
| Memory | `process_resident_memory_bytes / 1024 / 1024` |
| CPU | `rate(process_cpu_seconds_total[1m])` |
