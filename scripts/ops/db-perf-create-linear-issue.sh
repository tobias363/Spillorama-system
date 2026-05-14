#!/usr/bin/env bash
# db-perf-create-linear-issue.sh — auto-create Linear issue for new DB-perf anomalies
#
# Called by db-perf-watcher.sh when anomalies are detected outside the
# dedup-window. Falls back gracefully to file-only + Slack-webhook if Linear
# is unreachable.
#
# Bruk:
#   bash scripts/ops/db-perf-create-linear-issue.sh <report-file> <anomalies-json>
#
# Args:
#   $1  Path to markdown-report (will be embedded in issue body)
#   $2  JSON array of anomalies (compact one-liner from jq -c)
#
# Env (sett en av disse — eller ingen for kun fallback):
#   LINEAR_API_KEY                — Linear personal API key (see secrets/linear-api.template.md)
#   LINEAR_TEAM_KEY               — default BIN (Spillorama team key)
#   LINEAR_LABEL_NAME             — default "db-performance" (must exist in workspace)
#   LINEAR_ISSUE_TITLE_PREFIX     — default "[db-perf-watcher]"
#   SLACK_ALERT_WEBHOOK_URL       — fallback if Linear API key missing
#   FALLBACK_OUTPUT_DIR           — default /tmp (where to write fallback-files)
#   DRY_RUN                       — 1 = skip both Linear and Slack
#
# Exit-codes:
#   0  — Issue created (or fallback succeeded)
#   1  — Both Linear and fallback failed
#   2  — Invalid arguments
#
# Idempotency:
#   The watcher is responsible for dedup via STATE_FILE. This script is
#   stateless and will create one issue per call.

set -u
set -o pipefail

: "${LINEAR_TEAM_KEY:=BIN}"
: "${LINEAR_LABEL_NAME:=db-performance}"
: "${LINEAR_ISSUE_TITLE_PREFIX:=[db-perf-watcher]}"
: "${FALLBACK_OUTPUT_DIR:=/tmp}"
: "${DRY_RUN:=0}"

REPORT_FILE="${1:-}"
ANOMALIES_JSON="${2:-}"

log() {
  echo "[db-perf-linear] $*" >&2
}

err() {
  echo "[db-perf-linear] ERROR: $*" >&2
}

if [ -z "$REPORT_FILE" ] || [ -z "$ANOMALIES_JSON" ]; then
  err "Usage: $0 <report-file> <anomalies-json>"
  exit 2
fi

if [ ! -f "$REPORT_FILE" ]; then
  err "Report file not found: $REPORT_FILE"
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  err "jq required"
  exit 2
fi

# ── Load Linear API key ─────────────────────────────────────────────────────
# Order: env var → secrets/linear-api.local.md (same pattern as cross-knowledge-audit.mjs)

load_linear_key() {
  if [ -n "${LINEAR_API_KEY:-}" ]; then
    echo "$LINEAR_API_KEY"
    return 0
  fi

  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  local repo_root
  repo_root="$(cd -- "${script_dir}/../.." >/dev/null 2>&1 && pwd)"
  local local_path="${repo_root}/secrets/linear-api.local.md"

  if [ ! -f "$local_path" ]; then
    return 1
  fi

  # Extract the key from the code block in the template format.
  local key
  key=$(awk '
    /^```/ { in_block = !in_block; next }
    in_block && NF && !/^</ { print; exit }
  ' "$local_path" | tr -d '[:space:]')

  if [ -z "$key" ] || [ ${#key} -lt 10 ]; then
    return 1
  fi
  echo "$key"
}

LINEAR_KEY=""
if KEY_OUT=$(load_linear_key); then
  LINEAR_KEY="$KEY_OUT"
fi

# ── Compose issue title + body ──────────────────────────────────────────────

ANOMALY_COUNT=$(echo "$ANOMALIES_JSON" | jq 'length')
NEW_COUNT=$(echo "$ANOMALIES_JSON" | jq '[.[] | select(.kind == "NEW")] | length')
REGRESSION_COUNT=$(echo "$ANOMALIES_JSON" | jq '[.[] | select(.kind == "REGRESSION")] | length')

DATE_NOW=$(date -u +"%Y-%m-%d %H:%M UTC")
ISSUE_TITLE="${LINEAR_ISSUE_TITLE_PREFIX} ${ANOMALY_COUNT} DB-anomalies (${NEW_COUNT} NEW, ${REGRESSION_COUNT} REGRESSION) — ${DATE_NOW}"

# Embed full markdown-report into body, but prepend a "where & why" header
# and the anomaly-summary as a quick-glance table.
REPORT_BODY=$(cat "$REPORT_FILE")

ANOMALY_SUMMARY_MD=$(echo "$ANOMALIES_JSON" | jq -r '.[] |
  "- **\(.kind)** — `\(.current.query | .[0:120])` (mean=\(.current.mean_ms)ms, calls=\(.current.calls))"' || true)

ISSUE_BODY=$(cat <<EOF
**Detected by:** \`scripts/ops/db-perf-watcher.sh\` cron (auto)
**At:** ${DATE_NOW}
**Anomalies:** ${ANOMALY_COUNT} (${NEW_COUNT} NEW slow, ${REGRESSION_COUNT} REGRESSION)

## Quick summary

${ANOMALY_SUMMARY_MD}

## Action

1. Reproduce via \`PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "EXPLAIN ANALYZE <query>"\`
2. Check recent migrations + data growth on touched tables
3. For N+1 → batch resolver (DataLoader); for missing index → migration with \`CREATE INDEX CONCURRENTLY\`
4. After fix: \`FORCE_BASELINE=1 bash scripts/ops/db-perf-watcher.sh\` to re-baseline

## Full report

<details>
<summary>Click to expand</summary>

\`\`\`md
${REPORT_BODY}
\`\`\`

</details>

## Runbook

\`docs/operations/DB_PERF_WATCHER_RUNBOOK.md\` for full diagnosis flow.

---

*Auto-generated. Will not re-fire for the same queryid for 24h.*
EOF
)

# ── DRY_RUN — log and exit ──────────────────────────────────────────────────

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 — would create Linear-issue with title:"
  log "  ${ISSUE_TITLE}"
  log "Body length: ${#ISSUE_BODY} chars"
  exit 0
fi

# ── Try Linear first ────────────────────────────────────────────────────────

create_via_linear() {
  if [ -z "$LINEAR_KEY" ]; then
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    err "curl required for Linear API"
    return 1
  fi

  # Step 1: resolve team ID from team key
  local team_query
  team_query=$(jq -nc --arg key "$LINEAR_TEAM_KEY" \
    '{ query: "query { teams(filter: { key: { eq: \"\($key)\" } }) { nodes { id name key } } }" }')

  local team_res
  team_res=$(curl -s --max-time 15 -X POST https://api.linear.app/graphql \
    -H "Authorization: ${LINEAR_KEY}" \
    -H "Content-Type: application/json" \
    -d "$team_query" 2>&1) || {
      err "Linear team lookup failed (network): $team_res"
      return 1
    }

  local team_id
  team_id=$(echo "$team_res" | jq -r '.data.teams.nodes[0].id // empty' 2>/dev/null || echo "")
  if [ -z "$team_id" ]; then
    err "Could not resolve Linear team-id for key=${LINEAR_TEAM_KEY}: $team_res"
    return 1
  fi
  log "Resolved Linear team-id: $team_id"

  # Step 2: try to resolve label ID (optional — issue will still be created without label)
  local label_query
  label_query=$(jq -nc --arg name "$LINEAR_LABEL_NAME" --arg tid "$team_id" \
    '{ query: "query { issueLabels(filter: { name: { eq: \"\($name)\" }, team: { id: { eq: \"\($tid)\" } } }) { nodes { id name } } }" }')

  local label_res label_id
  label_res=$(curl -s --max-time 15 -X POST https://api.linear.app/graphql \
    -H "Authorization: ${LINEAR_KEY}" \
    -H "Content-Type: application/json" \
    -d "$label_query" 2>&1) || label_res=""
  label_id=$(echo "$label_res" | jq -r '.data.issueLabels.nodes[0].id // empty' 2>/dev/null || echo "")

  # Step 3: create issue
  local create_query
  if [ -n "$label_id" ]; then
    log "Attaching label ${LINEAR_LABEL_NAME} (${label_id})"
    create_query=$(jq -nc \
      --arg tid "$team_id" \
      --arg title "$ISSUE_TITLE" \
      --arg body "$ISSUE_BODY" \
      --arg lid "$label_id" \
      '{
        query: "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }",
        variables: {
          input: {
            teamId: $tid,
            title: $title,
            description: $body,
            labelIds: [$lid]
          }
        }
      }')
  else
    log "Label ${LINEAR_LABEL_NAME} not found in team; issue created without label."
    create_query=$(jq -nc \
      --arg tid "$team_id" \
      --arg title "$ISSUE_TITLE" \
      --arg body "$ISSUE_BODY" \
      '{
        query: "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }",
        variables: {
          input: {
            teamId: $tid,
            title: $title,
            description: $body
          }
        }
      }')
  fi

  local create_res
  create_res=$(curl -s --max-time 15 -X POST https://api.linear.app/graphql \
    -H "Authorization: ${LINEAR_KEY}" \
    -H "Content-Type: application/json" \
    -d "$create_query" 2>&1) || {
      err "Linear issue-create failed (network): $create_res"
      return 1
    }

  local identifier url success
  success=$(echo "$create_res" | jq -r '.data.issueCreate.success // false' 2>/dev/null || echo "false")
  identifier=$(echo "$create_res" | jq -r '.data.issueCreate.issue.identifier // empty' 2>/dev/null || echo "")
  url=$(echo "$create_res" | jq -r '.data.issueCreate.issue.url // empty' 2>/dev/null || echo "")

  if [ "$success" = "true" ] && [ -n "$identifier" ]; then
    log "Linear issue created: ${identifier} ${url}"
    echo "$identifier"
    return 0
  fi

  err "Linear issue-create response did not include identifier: $create_res"
  return 1
}

# ── Fallback 1: Slack webhook ───────────────────────────────────────────────

create_via_slack() {
  if [ -z "${SLACK_ALERT_WEBHOOK_URL:-}" ]; then
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi

  local slack_text
  slack_text="*${ISSUE_TITLE}*\n\n${ANOMALY_SUMMARY_MD}\n\nReport: \`${REPORT_FILE}\`"

  local slack_payload
  slack_payload=$(jq -nc --arg text "$slack_text" '{ text: $text }')

  if curl -s --max-time 10 -X POST "$SLACK_ALERT_WEBHOOK_URL" \
       -H 'Content-Type: application/json' \
       -d "$slack_payload" >/dev/null 2>&1; then
    log "Posted to Slack webhook"
    return 0
  fi

  err "Slack webhook post failed"
  return 1
}

# ── Fallback 2: write to disk ───────────────────────────────────────────────

create_via_file() {
  mkdir -p "$FALLBACK_OUTPUT_DIR"
  local fallback_file
  fallback_file="${FALLBACK_OUTPUT_DIR}/db-perf-pending-issue-$(date -u +%Y%m%dT%H%M%SZ).md"

  cat > "$fallback_file" <<EOF
# Pending Linear-issue (fallback)

Linear API not reachable / not configured. Manual action required.

## Title

${ISSUE_TITLE}

## Body

${ISSUE_BODY}

---

*Recommended:* copy title + body into Linear UI, attach \`db-performance\` label.
EOF
  log "Wrote fallback pending-issue to ${fallback_file}"
  return 0
}

# ── Dispatch ────────────────────────────────────────────────────────────────

ISSUE_ID=""
if create_via_linear 2>/dev/null; then
  exit 0
fi

log "Linear unavailable — trying fallback channels."

# Try Slack as secondary channel
create_via_slack || true

# Always write the fallback file so ops has a record
create_via_file
exit 0
