#!/usr/bin/env bash
# purchase-open-forensics.sh - focused evidence pack for Spill 1 purchase_open bugs.
#
# Goal:
#   Produce one markdown file that lets the PM classify whether the root cause is
#   seed timing, scheduler/cron, MasterActionService bypass, plan-run advance, or
#   stale client state before any implementation agent starts changing code.
#
# Output:
#   /tmp/purchase-open-forensics-<timestamp>.md
#
# Usage:
#   bash scripts/purchase-open-forensics.sh --phase before-master
#   bash scripts/purchase-open-forensics.sh --phase after-master-30s \
#     --scheduled-game-id <id> --posthog-session <url-or-id>

set -uo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/purchase-open-forensics.sh [options]

Options:
  --phase <label>              Label this snapshot, e.g. before-master, after-master-30s.
  --scheduled-game-id <id>     Focus queries on a specific app_game1_scheduled_games row.
  --plan-run-id <id>           Focus queries on a specific app_game_plan_run row.
  --player-id <id>             Include recent purchases for one buyer_user_id.
  --posthog-session <url|id>   Attach PostHog recording/session reference.
  --sentry-ref <issue|query>   Attach Sentry issue id or query reference.
  --note <text>                Add a short PM note to the report.
  --output <path>              Override report path.
  -h, --help                   Show this help.

Environment:
  PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD
  BACKEND_URL
  OUTPUT_DIR
EOF
}

PHASE="${PURCHASE_OPEN_PHASE:-snapshot}"
SCHEDULED_GAME_ID="${SCHEDULED_GAME_ID:-}"
PLAN_RUN_ID="${PLAN_RUN_ID:-}"
PLAYER_ID="${PLAYER_ID:-}"
POSTHOG_SESSION="${POSTHOG_SESSION:-}"
SENTRY_REF="${SENTRY_REF:-}"
PM_NOTE="${PM_NOTE:-}"
OUTPUT_PATH="${OUTPUT_PATH:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --phase)
      PHASE="${2:-}"
      shift 2
      ;;
    --scheduled-game-id)
      SCHEDULED_GAME_ID="${2:-}"
      shift 2
      ;;
    --plan-run-id)
      PLAN_RUN_ID="${2:-}"
      shift 2
      ;;
    --player-id)
      PLAYER_ID="${2:-}"
      shift 2
      ;;
    --posthog-session)
      POSTHOG_SESSION="${2:-}"
      shift 2
      ;;
    --sentry-ref)
      SENTRY_REF="${2:-}"
      shift 2
      ;;
    --note)
      PM_NOTE="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=spillorama}"
: "${PGDATABASE:=spillorama}"
: "${PGPASSWORD:=spillorama}"
: "${BACKEND_URL:=http://localhost:4000}"
: "${OUTPUT_DIR:=/tmp}"
export PGPASSWORD

TIMESTAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
if [ -z "$OUTPUT_PATH" ]; then
  OUTPUT_PATH="${OUTPUT_DIR%/}/purchase-open-forensics-${TIMESTAMP}.md"
fi
mkdir -p "$(dirname "$OUTPUT_PATH")"

psql_base() {
  psql \
    -X \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    -P pager=off \
    "$@"
}

psql_scalar() {
  local sql="$1"
  psql_base -tA -c "$sql" 2>/dev/null | head -1 | tr -d '\r'
}

append_cmd() {
  local title="$1"
  shift
  {
    echo ""
    echo "### $title"
    echo ""
    echo '```'
    "$@" 2>&1 || true
    echo '```'
  } >> "$OUTPUT_PATH"
}

append_sql() {
  local title="$1"
  local sql="$2"
  {
    echo ""
    echo "### $title"
    echo ""
    echo '```sql'
    echo "$sql"
    echo '```'
    echo ""
    echo '```'
    psql_base -c "$sql" 2>&1 || true
    echo '```'
  } >> "$OUTPUT_PATH"
}

append_file_tail() {
  local title="$1"
  local file_path="$2"
  local lines="${3:-120}"
  {
    echo ""
    echo "### $title"
    echo ""
    echo "File: \`$file_path\`"
    echo ""
    echo '```'
    if [ -f "$file_path" ]; then
      tail -n "$lines" "$file_path" 2>&1 || true
    else
      echo "(file not found)"
    fi
    echo '```'
  } >> "$OUTPUT_PATH"
}

file_status_line() {
  local file_path="$1"
  if [ ! -e "$file_path" ]; then
    echo "- \`$file_path\`: missing"
    return
  fi
  local size="?"
  local mtime="?"
  if stat -f "%z" "$file_path" >/dev/null 2>&1; then
    size="$(stat -f "%z" "$file_path" 2>/dev/null || echo "?")"
    mtime="$(stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%S%z" "$file_path" 2>/dev/null || echo "?")"
  elif stat -c "%s" "$file_path" >/dev/null 2>&1; then
    size="$(stat -c "%s" "$file_path" 2>/dev/null || echo "?")"
    mtime="$(stat -c "%y" "$file_path" 2>/dev/null || echo "?")"
  fi
  echo "- \`$file_path\`: present, ${size} bytes, mtime ${mtime}"
}

if [ -z "$SCHEDULED_GAME_ID" ]; then
  SCHEDULED_GAME_ID="$(psql_scalar "SELECT id FROM app_game1_scheduled_games ORDER BY created_at DESC LIMIT 1;")"
fi

if [ -z "$PLAN_RUN_ID" ]; then
  PLAN_RUN_ID="$(psql_scalar "SELECT id FROM app_game_plan_run ORDER BY created_at DESC LIMIT 1;")"
fi

sql_literal() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

SQL_SCHEDULED_GAME_ID="$(sql_literal "$SCHEDULED_GAME_ID")"
SQL_PLAN_RUN_ID="$(sql_literal "$PLAN_RUN_ID")"
SQL_PLAYER_ID="$(sql_literal "$PLAYER_ID")"

GIT_HEAD="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
DEV_NUKE_HINT="Check terminal history or dev logs; this script cannot prove the last dev:nuke timestamp."

cat > "$OUTPUT_PATH" <<EOF
# purchase_open forensics - ${TIMESTAMP}

**Generated by:** \`scripts/purchase-open-forensics.sh\`
**Phase:** \`${PHASE}\`
**Repo:** \`$(git rev-parse --show-toplevel 2>/dev/null || pwd)\`
**Git branch:** \`${GIT_BRANCH}\`
**Git HEAD:** \`${GIT_HEAD}\`
**Backend URL:** \`${BACKEND_URL}\`
**Postgres:** \`${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}\`

## 0. PM run metadata

| Field | Value |
|---|---|
| scheduled_game_id | \`${SCHEDULED_GAME_ID:-not-resolved}\` |
| plan_run_id | \`${PLAN_RUN_ID:-not-resolved}\` |
| player_id | \`${PLAYER_ID:-not-provided}\` |
| PostHog session | \`${POSTHOG_SESSION:-not-attached}\` |
| Sentry ref/query | \`${SENTRY_REF:-not-attached}\` |
| PM note | ${PM_NOTE:-"(none)"} |
| dev:nuke timestamp | ${DEV_NUKE_HINT} |

## 1. How to use this report

Run this script at least twice during the same repro:

1. \`npm run forensics:purchase-open -- --phase before-master\`
2. Trigger the master action / player purchase attempt.
3. Wait 30 seconds.
4. \`npm run forensics:purchase-open -- --phase after-master-30s --scheduled-game-id <id> --posthog-session <recording>\`

Attach both files to the PM handoff or agent prompt. Do not start the implementation agent until one hypothesis below has concrete DB/log evidence.

## 2. Decision matrix

| Hypothesis | Evidence to confirm | Fix path |
|---|---|---|
| Seed/start_time is wrong | Latest scheduled game has \`scheduled_start_time <= now()\` or only seconds into the future | B.1 seed fix |
| Scheduler/tick is not running | No \`openPurchaseForImminentGames\` log and rows stay \`scheduled\` | B.2 scheduler infra |
| Scheduler condition is too narrow | Tick logs run, but row that should open is ignored | B.2 condition fix |
| MasterActionService bypasses purchase_open | Row goes \`scheduled -> running\` even with future start time | B.3 two-step master flow |
| Plan-run advance is separate | Purchase/run/completion works, but plan_run stays/finishes at pos 1 | Separate P0 |
| Client has stale localStorage | DB is valid, but client sends old bundle id after dev:nuke | Client reset UX |

EOF

{
  echo "## 3. Local readiness"
  echo ""
  echo "- Report path: \`$OUTPUT_PATH\`"
  echo "- Generated UTC: \`$TIMESTAMP\`"
  file_status_line "/tmp/pilot-monitor.log"
  file_status_line "/tmp/pilot-monitor-snapshot.md"
  file_status_line "/tmp/pilot-monitor-urgent.fifo"
  file_status_line "/tmp/pilot-checklist.log"
  file_status_line "/tmp/spillorama-backend.log"
  file_status_line "/tmp/spillorama-admin.log"
  echo ""
} >> "$OUTPUT_PATH"

append_cmd "Git working tree" git status --short --branch
append_cmd "Backend health" curl -sS -m 3 "$BACKEND_URL/health"
append_cmd "Monitor processes" pgrep -alf "pilot-monitor-enhanced|monitor-push-to-pm|pilot-checklist-poll"
append_cmd "Docker containers" docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

append_sql "Postgres connectivity" "SELECT now() AS db_now, current_database() AS db, current_user AS db_user;"

append_sql "Recent plan-runs" "
SELECT id, status, current_position, business_date, started_at, finished_at, updated_at
FROM app_game_plan_run
WHERE (${SQL_PLAN_RUN_ID} = '' OR id = ${SQL_PLAN_RUN_ID})
   OR created_at >= now() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 15;
"

append_sql "Recent scheduled-games with purchase counts" "
SELECT
  sg.id,
  sg.plan_run_id,
  sg.plan_position,
  sg.status,
  sg.scheduled_start_time,
  sg.actual_start_time,
  sg.actual_end_time,
  EXTRACT(EPOCH FROM (sg.scheduled_start_time - now()))::int AS seconds_until_scheduled_start,
  COALESCE(tp.purchase_count, 0) AS purchase_count,
  sg.created_at,
  sg.updated_at
FROM app_game1_scheduled_games sg
LEFT JOIN (
  SELECT scheduled_game_id, COUNT(*) AS purchase_count
  FROM app_game1_ticket_purchases
  GROUP BY scheduled_game_id
) tp ON tp.scheduled_game_id = sg.id
WHERE (${SQL_SCHEDULED_GAME_ID} = '' OR sg.id = ${SQL_SCHEDULED_GAME_ID})
   OR sg.status IN ('scheduled', 'purchase_open', 'ready_to_start', 'running', 'paused')
   OR sg.created_at >= now() - INTERVAL '24 hours'
ORDER BY sg.created_at DESC
LIMIT 20;
"

append_sql "Target game detail" "
WITH target AS (
  SELECT id
  FROM app_game1_scheduled_games
  WHERE (${SQL_SCHEDULED_GAME_ID} = '' OR id = ${SQL_SCHEDULED_GAME_ID})
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  sg.id,
  sg.status,
  sg.plan_run_id,
  sg.plan_position,
  sg.master_hall_id,
  sg.group_hall_id,
  sg.room_code,
  sg.catalog_entry_id,
  sg.scheduled_day,
  sg.scheduled_start_time,
  sg.actual_start_time,
  sg.actual_end_time,
  sg.started_by_user_id,
  sg.created_at,
  sg.updated_at,
  EXTRACT(EPOCH FROM (sg.scheduled_start_time - now()))::int AS seconds_until_scheduled_start,
  CASE
    WHEN sg.actual_start_time IS NOT NULL AND sg.actual_end_time IS NOT NULL
    THEN EXTRACT(EPOCH FROM (sg.actual_end_time - sg.actual_start_time))::int
    ELSE NULL
  END AS duration_seconds,
  left(sg.ticket_config_json::text, 240) AS ticket_config_preview,
  pr.status AS plan_run_status,
  pr.current_position AS plan_run_position,
  COALESCE(tp.purchase_count, 0) AS purchase_count,
  tp.first_purchase_at,
  tp.last_purchase_at
FROM app_game1_scheduled_games sg
LEFT JOIN app_game_plan_run pr ON pr.id = sg.plan_run_id
LEFT JOIN (
  SELECT scheduled_game_id, COUNT(*) AS purchase_count, MIN(purchased_at) AS first_purchase_at, MAX(purchased_at) AS last_purchase_at
  FROM app_game1_ticket_purchases
  GROUP BY scheduled_game_id
) tp ON tp.scheduled_game_id = sg.id
WHERE sg.id IN (SELECT id FROM target);
"

append_sql "Status distribution" "
SELECT status, COUNT(*) AS count
FROM app_game1_scheduled_games
GROUP BY status
ORDER BY status;
"

append_sql "Stale scheduled rows" "
SELECT id, plan_run_id, plan_position, status, scheduled_start_time, created_at, updated_at
FROM app_game1_scheduled_games
WHERE status = 'scheduled'
  AND scheduled_start_time < now() - INTERVAL '1 hour'
ORDER BY scheduled_start_time ASC
LIMIT 30;
"

append_sql "Completed games with zero purchases in last 24h" "
SELECT
  sg.id,
  sg.plan_run_id,
  sg.status,
  sg.scheduled_start_time,
  sg.actual_start_time,
  sg.actual_end_time,
  EXTRACT(EPOCH FROM (sg.actual_end_time - sg.actual_start_time))::int AS duration_seconds,
  COUNT(tp.id) AS purchase_count
FROM app_game1_scheduled_games sg
LEFT JOIN app_game1_ticket_purchases tp ON tp.scheduled_game_id = sg.id
WHERE sg.status = 'completed'
  AND sg.actual_end_time >= now() - INTERVAL '24 hours'
GROUP BY sg.id, sg.plan_run_id, sg.status, sg.scheduled_start_time, sg.actual_start_time, sg.actual_end_time
HAVING COUNT(tp.id) = 0
ORDER BY sg.actual_end_time DESC
LIMIT 20;
"

append_sql "Recent purchases" "
SELECT id, scheduled_game_id, buyer_user_id, hall_id, total_amount_cents, payment_method, idempotency_key, purchased_at, refunded_at
FROM app_game1_ticket_purchases
WHERE (${SQL_SCHEDULED_GAME_ID} = '' OR scheduled_game_id = ${SQL_SCHEDULED_GAME_ID})
  AND (${SQL_PLAYER_ID} = '' OR buyer_user_id = ${SQL_PLAYER_ID})
  AND purchased_at >= now() - INTERVAL '24 hours'
ORDER BY purchased_at DESC
LIMIT 40;
"

append_sql "Ticket assignment counts" "
SELECT scheduled_game_id, purchase_id, buyer_user_id, hall_id, ticket_color, ticket_size, COUNT(*) AS assignment_count
FROM app_game1_ticket_assignments
WHERE (${SQL_SCHEDULED_GAME_ID} = '' OR scheduled_game_id = ${SQL_SCHEDULED_GAME_ID})
  AND generated_at >= now() - INTERVAL '24 hours'
GROUP BY scheduled_game_id, purchase_id, buyer_user_id, hall_id, ticket_color, ticket_size
ORDER BY MAX(generated_at) DESC
LIMIT 40;
"

append_sql "Hall ready status for target/recent games" "
SELECT hrs.game_id, sg.status AS game_status, hrs.hall_id, hrs.is_ready, hrs.ready_at,
       hrs.digital_tickets_sold, hrs.physical_tickets_sold,
       hrs.excluded_from_game, hrs.excluded_reason
FROM app_game1_hall_ready_status hrs
JOIN app_game1_scheduled_games sg ON sg.id = hrs.game_id
WHERE (${SQL_SCHEDULED_GAME_ID} = '' OR hrs.game_id = ${SQL_SCHEDULED_GAME_ID})
   OR sg.created_at >= now() - INTERVAL '24 hours'
ORDER BY sg.created_at DESC, hrs.hall_id
LIMIT 60;
"

append_sql "Master audit actions" "
SELECT id, game_id, action, actor_user_id, actor_hall_id, group_hall_id, metadata_json, created_at
FROM app_game1_master_audit
WHERE (${SQL_SCHEDULED_GAME_ID} = '' OR game_id = ${SQL_SCHEDULED_GAME_ID})
   OR created_at >= now() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 50;
"

append_sql "pg_stat_statements top queries" "
SELECT calls, round(total_exec_time::numeric, 2) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms,
       rows, left(regexp_replace(query, '\s+', ' ', 'g'), 180) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
"

append_file_tail "Backend log tail" "/tmp/spillorama-backend.log" 240
append_file_tail "Pilot monitor tail" "/tmp/pilot-monitor.log" 220
append_file_tail "Pilot checklist DB delta tail" "/tmp/pilot-checklist.log" 160

{
  echo ""
  echo "### Recent round reports"
  echo ""
  echo '```'
  ls -lt /tmp/pilot-monitor-round-*.md 2>/dev/null | head -10 || true
  echo '```'
} >> "$OUTPUT_PATH"

if command -v docker >/dev/null 2>&1; then
  POSTGRES_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'postgres|spillorama.*db' | head -1 || true)"
  if [ -n "$POSTGRES_CONTAINER" ]; then
    append_cmd "Postgres slow-query log tail (${POSTGRES_CONTAINER})" bash -c "docker logs --since 15m '$POSTGRES_CONTAINER' 2>&1 | grep 'duration:' | tail -100"
  else
    append_cmd "Postgres slow-query log tail" bash -c "echo '(no postgres container found via docker ps)'"
  fi
else
  append_cmd "Postgres slow-query log tail" bash -c "echo '(docker not found)'"
fi

cat >> "$OUTPUT_PATH" <<'EOF'

## 4. PM conclusion checklist

Fill this in before spawning an implementation agent:

- [ ] I have attached the matching PostHog session recording or written "not available".
- [ ] I have checked Sentry unresolved/new issues for this exact time window.
- [ ] I can point to the DB row that should have entered `purchase_open`.
- [ ] I know whether the row stayed `scheduled`, became `purchase_open`, or jumped to `running`.
- [ ] I know whether any purchase row was created for this scheduled game.
- [ ] I know whether plan-run advanced after completion or stopped at position 1.
- [ ] I have chosen exactly one primary fix path: B.1, B.2, B.3, separate plan-run P0, or client localStorage reset.
- [ ] I have a failing test target for the chosen fix path.

## 5. Recommended agent prompt attachment

Attach this report plus the matching before/after report. The agent must not infer from memory; it must cite rows/log lines from the evidence pack when explaining root cause.
EOF

echo "[purchase-open-forensics] Report written: $OUTPUT_PATH"
echo "$OUTPUT_PATH"
