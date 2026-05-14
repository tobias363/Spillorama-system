#!/usr/bin/env bash
# db-perf-watcher.sh — auto-detect new/regressing slow queries from pg_stat_statements
#
# Tobias-direktiv 2026-05-14:
#   "Vi må overvåke databasen så vi får data på hva som må forbedres.
#    Test-agent som overvåker alt og peker på svakheter og tregheter."
#
# Hva scriptet gjør:
#   1. Pinger lokal Postgres via PGPASSWORD=spillorama
#   2. Henter top-N queries fra pg_stat_statements sortert på total_exec_time
#   3. Sammenligner mot baseline-snapshot (lagret som JSON)
#   4. Flagger NEW queries (mean > 100ms, calls > 10) som ikke fantes i baseline
#   5. Flagger REGRESSIONS (kjent query, mean økt > 50% siden baseline)
#   6. Skriver markdown-rapport til /tmp/db-perf-watcher-<ISO>.md
#   7. Hvis anomaly → kaller scripts/ops/db-perf-create-linear-issue.sh
#
# Bruk:
#   bash scripts/ops/db-perf-watcher.sh                    # default kjøring
#   DRY_RUN=1 bash scripts/ops/db-perf-watcher.sh          # ikke opprett Linear-issue
#   FORCE_BASELINE=1 bash scripts/ops/db-perf-watcher.sh   # skriv ny baseline, ingen anomaly-deteksjon
#   BASELINE_FILE=/path/foo.json bash scripts/ops/db-perf-watcher.sh
#   REPORT_DIR=/tmp/myreports bash scripts/ops/db-perf-watcher.sh
#
# Env-overrides:
#   PGHOST                    — default localhost
#   PGUSER                    — default spillorama
#   PGDATABASE                — default spillorama
#   PGPORT                    — default 5432
#   PGPASSWORD                — default spillorama (lokal dev)
#   BASELINE_FILE             — default /tmp/db-perf-watcher-baseline.json
#   REPORT_DIR                — default /tmp
#   REPORT_RETENTION_HOURS    — default 168 (7 dager — eldre rapporter slettes)
#   MEAN_MS_THRESHOLD         — default 100 (anomaly hvis mean > X ms)
#   CALLS_THRESHOLD           — default 10  (anomaly hvis calls > X)
#   REGRESSION_PCT            — default 50  (anomaly hvis mean økt > X %)
#   TOP_N                     — default 20  (antall queries å hente)
#   DRY_RUN                   — 1 = ikke opprett Linear-issue
#   FORCE_BASELINE            — 1 = skriv ny baseline, exit uten anomaly-sjekk
#   LINEAR_ISSUE_DEDUP_HOURS  — default 24 (samme query-hash flagges max én gang/døgn)
#   STATE_FILE                — default /tmp/db-perf-watcher-state.json
#
# Exit-codes:
#   0  — Kjøring OK, ingen anomalier (eller baseline reset)
#   1  — Anomalier funnet (NEW eller REGRESSION)
#   2  — Postgres ikke tilgjengelig
#   3  — pg_stat_statements extension mangler
#   4  — Andre runtime-feil
#
# Sikkerhet:
#   * READ-ONLY mot pg_stat_statements (kun SELECT). Aldri INSERT/UPDATE/DELETE.
#   * Idempotent — kan kjøres gjentatte ganger uten side-effekt på DB.
#   * Linear-issue-call er DEDUP'et 24t per query-hash så vi ikke spammer.
#   * Skriver IKKE prod-Postgres — kun localhost via PGPASSWORD.

set -u
set -o pipefail

# ── Default env-config ──────────────────────────────────────────────────────

: "${PGHOST:=localhost}"
: "${PGUSER:=spillorama}"
: "${PGDATABASE:=spillorama}"
: "${PGPORT:=5432}"
: "${PGPASSWORD:=spillorama}"
export PGPASSWORD

: "${BASELINE_FILE:=/tmp/db-perf-watcher-baseline.json}"
: "${REPORT_DIR:=/tmp}"
: "${REPORT_RETENTION_HOURS:=168}"
: "${MEAN_MS_THRESHOLD:=100}"
: "${CALLS_THRESHOLD:=10}"
: "${REGRESSION_PCT:=50}"
: "${TOP_N:=20}"
: "${DRY_RUN:=0}"
: "${FORCE_BASELINE:=0}"
: "${LINEAR_ISSUE_DEDUP_HOURS:=24}"
: "${STATE_FILE:=/tmp/db-perf-watcher-state.json}"

# ── Helpers ─────────────────────────────────────────────────────────────────

ISO_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SAFE_TS=$(date -u +"%Y%m%dT%H%M%SZ")

# Resolve script path so we can find sibling scripts
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
LINEAR_SCRIPT="${SCRIPT_DIR}/db-perf-create-linear-issue.sh"

log() {
  echo "[db-perf-watcher] $*" >&2
}

err() {
  echo "[db-perf-watcher] ERROR: $*" >&2
}

ensure_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command not found: $cmd"
    exit 4
  fi
}

# ── Pre-flight ──────────────────────────────────────────────────────────────

ensure_cmd psql
ensure_cmd jq

mkdir -p "$REPORT_DIR"

REPORT_FILE="${REPORT_DIR}/db-perf-watcher-${SAFE_TS}.md"

# Ping Postgres
if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
       -tA -c 'SELECT 1' >/dev/null 2>&1; then
  err "Cannot connect to Postgres at ${PGHOST}:${PGPORT}/${PGDATABASE} as ${PGUSER}"
  exit 2
fi

# Verify pg_stat_statements extension
EXT_OK=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
           -tA -c "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'" 2>/dev/null || true)

if [ "$EXT_OK" != "1" ]; then
  err "pg_stat_statements extension is not installed."
  err "See docs/operations/PG_STAT_STATEMENTS_RUNBOOK.md to enable it."
  exit 3
fi

# ── Cleanup old reports (keep last REPORT_RETENTION_HOURS) ─────────────────

cleanup_old_reports() {
  find "$REPORT_DIR" -maxdepth 1 -name 'db-perf-watcher-*.md' -type f \
       -mmin +$((REPORT_RETENTION_HOURS * 60)) -delete 2>/dev/null || true
}
cleanup_old_reports

# ── Fetch top-N queries from pg_stat_statements ─────────────────────────────
#
# Output as TSV: queryid \t calls \t total_ms \t mean_ms \t rows \t blks_read \t blks_hit \t query
#
# We use queryid as a stable key for baseline comparison. queryid is a hash
# of the normalized SQL text + dbid + userid. The query column is the
# normalized text (with $1, $2 placeholders).
#
# We filter out:
#   - pg_stat_statements meta-queries (our own watcher SELECT)
#   - System catalog queries (information_schema, pg_*) that are unavoidable
#   - SET, BEGIN, COMMIT (transaction control, not workload)

fetch_top_queries() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
       --no-psqlrc --pset=footer=off --pset=expanded=off \
       -tAF $'\t' \
       -c "SELECT
            queryid::text,
            calls::bigint,
            ROUND(total_exec_time::numeric, 2)::text,
            ROUND(mean_exec_time::numeric, 2)::text,
            rows::bigint,
            shared_blks_read::bigint,
            shared_blks_hit::bigint,
            REPLACE(REPLACE(substring(query, 1, 500), E'\t', ' '), E'\n', ' ')
          FROM pg_stat_statements
          WHERE query NOT ILIKE '%pg_stat_statements%'
            AND query NOT ILIKE 'SET %'
            AND query NOT ILIKE 'BEGIN%'
            AND query NOT ILIKE 'COMMIT%'
            AND query NOT ILIKE 'ROLLBACK%'
            AND query NOT ILIKE 'SHOW %'
            AND queryid IS NOT NULL
          ORDER BY total_exec_time DESC
          LIMIT ${TOP_N}"
}

TOP_QUERIES_TSV=$(fetch_top_queries 2>&1) || {
  err "Failed to fetch pg_stat_statements: $TOP_QUERIES_TSV"
  exit 4
}

if [ -z "$TOP_QUERIES_TSV" ]; then
  log "No queries in pg_stat_statements yet (empty workload)."
  cat > "$REPORT_FILE" <<EOF
# DB-Perf Watcher Report ${ISO_TS}

## Status

No queries in pg_stat_statements yet. Workload is too small or stats were
just reset. Skipping anomaly check.

## Configuration

- Host: ${PGHOST}:${PGPORT}/${PGDATABASE}
- Baseline: ${BASELINE_FILE}
- Top-N: ${TOP_N}
EOF
  log "Wrote empty report to ${REPORT_FILE}"
  exit 0
fi

# Convert TSV to JSON array. jq does the heavy lifting.
# Each line is: queryid \t calls \t total_ms \t mean_ms \t rows \t blks_read \t blks_hit \t query
CURRENT_SNAPSHOT_JSON=$(echo "$TOP_QUERIES_TSV" \
  | jq -R -s -c '
      split("\n")
      | map(select(length > 0))
      | map(split("\t"))
      | map({
          queryid: .[0],
          calls: (.[1] | tonumber),
          total_ms: (.[2] | tonumber),
          mean_ms: (.[3] | tonumber),
          rows: (.[4] | tonumber),
          blks_read: (.[5] | tonumber),
          blks_hit: (.[6] | tonumber),
          query: .[7]
        })
    ')

CURRENT_COUNT=$(echo "$CURRENT_SNAPSHOT_JSON" | jq 'length')
log "Fetched ${CURRENT_COUNT} top queries from pg_stat_statements"

# ── FORCE_BASELINE — write baseline and exit ────────────────────────────────

if [ "$FORCE_BASELINE" = "1" ] || [ ! -f "$BASELINE_FILE" ]; then
  if [ "$FORCE_BASELINE" = "1" ]; then
    log "FORCE_BASELINE=1 — writing new baseline to ${BASELINE_FILE}"
  else
    log "No baseline file at ${BASELINE_FILE} — bootstrapping first run."
  fi

  echo "$CURRENT_SNAPSHOT_JSON" \
    | jq --arg ts "$ISO_TS" '{ taken_at: $ts, queries: . }' \
    > "$BASELINE_FILE"

  cat > "$REPORT_FILE" <<EOF
# DB-Perf Watcher Report ${ISO_TS}

## Status

Baseline (re-)established. ${CURRENT_COUNT} queries captured. Anomaly
detection skipped this run; next run will compare against this baseline.

## Configuration

- Host: ${PGHOST}:${PGPORT}/${PGDATABASE}
- Baseline file: ${BASELINE_FILE}
- Mean threshold: ${MEAN_MS_THRESHOLD} ms
- Calls threshold: ${CALLS_THRESHOLD}
- Regression threshold: ${REGRESSION_PCT}%
- Top-N: ${TOP_N}

## Top 10 by total_exec_time

| # | Calls | Mean ms | Total ms | Rows | Query |
|---|------:|--------:|---------:|-----:|-------|
EOF

  echo "$CURRENT_SNAPSHOT_JSON" \
    | jq -r '.[:10] | to_entries | .[] |
        "| \(.key + 1) | \(.value.calls) | \(.value.mean_ms) | \(.value.total_ms) | \(.value.rows) | `\(.value.query | .[0:120])` |"' \
    >> "$REPORT_FILE"

  log "Wrote baseline + report to ${REPORT_FILE}"
  exit 0
fi

# ── Compare against baseline ────────────────────────────────────────────────

# Read baseline
BASELINE_JSON=$(jq -c '.queries // []' "$BASELINE_FILE")
BASELINE_TAKEN_AT=$(jq -r '.taken_at // "unknown"' "$BASELINE_FILE")
BASELINE_COUNT=$(echo "$BASELINE_JSON" | jq 'length')

log "Comparing against baseline taken ${BASELINE_TAKEN_AT} (${BASELINE_COUNT} queries)"

# Build comparison via jq.
# For each current query:
#   - if queryid NOT in baseline AND mean > THRESHOLD AND calls > THRESHOLD → NEW anomaly
#   - if queryid IN baseline AND mean changed > REGRESSION_PCT → REGRESSION anomaly
ANOMALY_JSON=$(jq -c -n \
  --argjson current "$CURRENT_SNAPSHOT_JSON" \
  --argjson baseline "$BASELINE_JSON" \
  --argjson mean_threshold "$MEAN_MS_THRESHOLD" \
  --argjson calls_threshold "$CALLS_THRESHOLD" \
  --argjson regression_pct "$REGRESSION_PCT" \
  '
    # Build baseline lookup by queryid
    ($baseline | map({key: .queryid, value: .}) | from_entries) as $base_lookup
    |
    $current | map(
      . as $cur
      | ($base_lookup[$cur.queryid] // null) as $base
      | if $base == null then
          # NEW query — only flag if exceeds thresholds
          if ($cur.mean_ms > $mean_threshold) and ($cur.calls > $calls_threshold) then
            {
              kind: "NEW",
              queryid: $cur.queryid,
              current: $cur,
              baseline: null,
              delta_pct: null,
              reason: "New slow query (mean=\($cur.mean_ms)ms, calls=\($cur.calls))"
            }
          else
            empty
          end
        else
          # Existing query — check for regression
          ($base.mean_ms) as $base_mean
          | if ($base_mean > 0) then
              ((($cur.mean_ms - $base_mean) / $base_mean) * 100) as $delta
              | if $delta > $regression_pct then
                  {
                    kind: "REGRESSION",
                    queryid: $cur.queryid,
                    current: $cur,
                    baseline: $base,
                    delta_pct: ($delta | floor),
                    reason: "Regression (was \($base_mean)ms → \($cur.mean_ms)ms, +\($delta | floor)%)"
                  }
                else
                  empty
                end
            else
              empty
            end
        end
    )
  ')

ANOMALY_COUNT=$(echo "$ANOMALY_JSON" | jq 'length')
NEW_COUNT=$(echo "$ANOMALY_JSON" | jq '[.[] | select(.kind == "NEW")] | length')
REGRESSION_COUNT=$(echo "$ANOMALY_JSON" | jq '[.[] | select(.kind == "REGRESSION")] | length')

log "Anomalies detected: ${ANOMALY_COUNT} (${NEW_COUNT} NEW, ${REGRESSION_COUNT} REGRESSION)"

# ── Build markdown report ───────────────────────────────────────────────────

build_report() {
  cat <<EOF
# DB-Perf Watcher Report ${ISO_TS}

## Summary

- **Host:** ${PGHOST}:${PGPORT}/${PGDATABASE}
- **Top queries scanned:** ${CURRENT_COUNT}
- **Baseline taken:** ${BASELINE_TAKEN_AT}
- **Anomalies detected:** ${ANOMALY_COUNT} (${NEW_COUNT} NEW, ${REGRESSION_COUNT} REGRESSION)
- **Mean threshold:** ${MEAN_MS_THRESHOLD} ms
- **Calls threshold:** ${CALLS_THRESHOLD}
- **Regression threshold:** ${REGRESSION_PCT}%

EOF

  if [ "$ANOMALY_COUNT" -gt 0 ]; then
    cat <<EOF
## Anomalies detected

EOF
    echo "$ANOMALY_JSON" | jq -r '.[] |
      "- **\(.kind)** (queryid: `\(.queryid)`, mean=\(.current.mean_ms)ms, calls=\(.current.calls)): `\(.current.query | .[0:160])`\n  - \(.reason)"' \
      || true

    cat <<EOF

## Recommended actions

EOF
    echo "$ANOMALY_JSON" | jq -r '.[] |
      if .kind == "NEW" then
        (if .current.calls > 100 then
          "- **N+1 suspect** on `\(.current.query | .[0:80])` — \(.current.calls) calls. Investigate code path; consider batch resolver (DataLoader pattern) or eager-loading JOIN."
         else
          "- **New slow query** on `\(.current.query | .[0:80])` — \(.current.mean_ms)ms mean. Check EXPLAIN ANALYZE and add appropriate index."
         end)
      else
        "- **Regression** on `\(.current.query | .[0:80])` — was \(.baseline.mean_ms)ms, now \(.current.mean_ms)ms (+\(.delta_pct)%). Check recent migrations or data growth on touched tables."
      end' || true

    echo
  else
    cat <<EOF
## Anomalies detected

None — workload is within thresholds compared to baseline.

EOF
  fi

  cat <<EOF
## Top 10 queries by total_exec_time

| # | Calls | Mean ms | Total ms | Rows | Disk reads | Query |
|---|------:|--------:|---------:|-----:|-----------:|-------|
EOF

  echo "$CURRENT_SNAPSHOT_JSON" \
    | jq -r '.[:10] | to_entries | .[] |
        "| \(.key + 1) | \(.value.calls) | \(.value.mean_ms) | \(.value.total_ms) | \(.value.rows) | \(.value.blks_read) | `\(.value.query | .[0:120])` |"'

  cat <<EOF

## Configuration

- Baseline file: ${BASELINE_FILE}
- Report retention: ${REPORT_RETENTION_HOURS} hours
- Linear dedup window: ${LINEAR_ISSUE_DEDUP_HOURS} hours
- Dry-run: ${DRY_RUN}

---

*Generated by \`scripts/ops/db-perf-watcher.sh\`. See*
*\`docs/operations/DB_PERF_WATCHER_RUNBOOK.md\` for details.*
EOF
}

build_report > "$REPORT_FILE"
log "Wrote report to ${REPORT_FILE}"

# ── Linear-issue creation ──────────────────────────────────────────────────

if [ "$ANOMALY_COUNT" -eq 0 ]; then
  log "No anomalies. Exit 0."
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 — skipping Linear-issue creation. Anomalies present (exit 1)."
  exit 1
fi

# Dedup: filter out anomalies we've flagged recently in STATE_FILE
# State format: { "seen": { "<queryid>": "<ISO timestamp>", ... } }
NOW_EPOCH=$(date -u +%s)
DEDUP_WINDOW_SEC=$((LINEAR_ISSUE_DEDUP_HOURS * 3600))

if [ ! -f "$STATE_FILE" ]; then
  echo '{"seen": {}}' > "$STATE_FILE"
fi

# Find anomalies that are NOT in dedup-window
ANOMALIES_TO_REPORT=$(jq -c \
  --argjson anomalies "$ANOMALY_JSON" \
  --argjson now_epoch "$NOW_EPOCH" \
  --argjson dedup_window_sec "$DEDUP_WINDOW_SEC" \
  '
    (.seen // {}) as $seen
    | $anomalies | map(
        . as $a
        | (($seen[$a.queryid] // null) | if . then (. | fromdate) else null end) as $last_seen
        | if $last_seen == null or (($now_epoch - $last_seen) > $dedup_window_sec) then
            $a
          else
            empty
          end
      )
  ' "$STATE_FILE")

UNDEDUP_COUNT=$(echo "$ANOMALIES_TO_REPORT" | jq 'length')

if [ "$UNDEDUP_COUNT" -eq 0 ]; then
  log "All ${ANOMALY_COUNT} anomalies are within dedup-window (${LINEAR_ISSUE_DEDUP_HOURS}h). Skipping Linear-issue."
  exit 1
fi

log "${UNDEDUP_COUNT} anomalies are new since last ${LINEAR_ISSUE_DEDUP_HOURS}h — creating Linear-issue."

# Update state file with these anomalies' timestamps
NEW_STATE=$(jq -c \
  --arg ts "$ISO_TS" \
  --argjson anomalies "$ANOMALIES_TO_REPORT" \
  '
    .seen = (
      (.seen // {}) as $seen
      | reduce $anomalies[] as $a ($seen; .[$a.queryid] = $ts)
    )
  ' "$STATE_FILE")

echo "$NEW_STATE" > "$STATE_FILE"

# Call Linear-issue script if available
if [ -x "$LINEAR_SCRIPT" ]; then
  if "$LINEAR_SCRIPT" "$REPORT_FILE" "$ANOMALIES_TO_REPORT"; then
    log "Linear-issue created."
  else
    log "Linear-issue creation failed (see script output). Report still on disk."
  fi
else
  log "Linear-issue script not executable at ${LINEAR_SCRIPT} — fallback: report on disk only."
fi

exit 1
