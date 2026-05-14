#!/usr/bin/env bash
# wallet-mismatch-create-linear-issue.sh — auto-create Linear issue for new
# wallet-integrity violations (balance mismatches + hash-chain breaks).
#
# Called by wallet-integrity-watcher.sh when violations are detected outside
# the dedup-window. Falls back gracefully to Slack-webhook + file-on-disk if
# Linear is unreachable.
#
# Bruk:
#   bash scripts/ops/wallet-mismatch-create-linear-issue.sh <report-file> <violations-json>
#
# Args:
#   $1  Path to markdown-report (will be embedded in issue body)
#   $2  JSON array of violations (compact one-liner from jq -c). Each entry:
#         { "kind": "balance_mismatch" | "hash_chain_break",
#           "wallet_id": "...",
#           "details": {...} }
#
# Env (sett en av disse — eller ingen for kun fallback):
#   LINEAR_API_KEY                — Linear personal API key (see secrets/linear-api.template.md)
#   LINEAR_TEAM_KEY               — default BIN (Spillorama team key)
#   LINEAR_LABEL_NAME             — default "wallet-integrity"
#   LINEAR_ISSUE_TITLE_PREFIX     — default "[WALLET-INTEGRITY]"
#   LINEAR_PRIORITY               — default 1 (Urgent — wallet integritet er P0)
#   LINEAR_ISSUE_DEDUP_HOURS      — default 24 (used to query existing open issues)
#   SLACK_ALERT_WEBHOOK_URL       — fallback if Linear API key missing
#   FALLBACK_OUTPUT_DIR           — default /tmp/wallet-integrity-alerts
#   DRY_RUN                       — 1 = skip both Linear and Slack, just compose+log
#
# Exit-codes:
#   0 — Issue created (or fallback succeeded)
#   1 — Both Linear and fallback failed
#   2 — Invalid arguments
#
# Idempotency:
#   * Watcher håndterer per-wallet_id dedup via STATE_FILE.
#   * Linear-issue dedup: dette scriptet sjekker også Linear-API for åpne
#     issues med samme title-prefix opprettet siste LINEAR_ISSUE_DEDUP_HOURS.
#     Hvis funnet → skip create + log.

set -u
set -o pipefail

: "${LINEAR_TEAM_KEY:=BIN}"
: "${LINEAR_LABEL_NAME:=wallet-integrity}"
: "${LINEAR_ISSUE_TITLE_PREFIX:=[WALLET-INTEGRITY]}"
: "${LINEAR_PRIORITY:=1}"
: "${LINEAR_ISSUE_DEDUP_HOURS:=24}"
: "${FALLBACK_OUTPUT_DIR:=/tmp/wallet-integrity-alerts}"
: "${DRY_RUN:=0}"

REPORT_FILE="${1:-}"
VIOLATIONS_JSON="${2:-}"

log() {
  echo "[wallet-mismatch-linear] $*" >&2
}

err() {
  echo "[wallet-mismatch-linear] ERROR: $*" >&2
}

if [ -z "$REPORT_FILE" ] || [ -z "$VIOLATIONS_JSON" ]; then
  err "Usage: $0 <report-file> <violations-json>"
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

# ── Load Linear API key (env → secrets/linear-api.local.md) ────────────────

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

# ── Compose title + body ────────────────────────────────────────────────────

VIOLATION_COUNT=$(echo "$VIOLATIONS_JSON" | jq 'length')
AFFECTED_WALLETS=$(echo "$VIOLATIONS_JSON" | jq '[.[].wallet_id] | unique | length')
BALANCE_COUNT=$(echo "$VIOLATIONS_JSON" | jq '[.[] | select(.kind == "balance_mismatch")] | length')
HASH_COUNT=$(echo "$VIOLATIONS_JSON" | jq '[.[] | select(.kind == "hash_chain_break")] | length')

DATE_NOW=$(date -u +"%Y-%m-%d %H:%M UTC")
TIME_HHMM=$(date -u +"%H:%M")
ISSUE_TITLE="${LINEAR_ISSUE_TITLE_PREFIX} Mismatch: ${AFFECTED_WALLETS} wallet(s) affected (${TIME_HHMM})"

REPORT_BODY=$(cat "$REPORT_FILE")

VIOLATION_SUMMARY_MD=$(echo "$VIOLATIONS_JSON" | jq -r '.[] |
  if .kind == "balance_mismatch" then
    "- **balance_mismatch** wallet `\(.wallet_id)`: stored=\(.details.stored_balance), computed=\(.details.computed_balance), delta=\(.details.delta)"
  else
    "- **hash_chain_break** wallet `\(.wallet_id)`, entry `\(.details.entry_id)` (\(.details.reason))"
  end' || true)

ISSUE_BODY=$(cat <<EOF
**Detected by:** \`scripts/ops/wallet-integrity-watcher.sh\` cron (auto)
**At:** ${DATE_NOW}
**Severity:** P0 — wallet integrity (Lotteritilsynet-relevant)
**Violations:** ${VIOLATION_COUNT} total (${BALANCE_COUNT} balance, ${HASH_COUNT} hash-chain)
**Affected wallets:** ${AFFECTED_WALLETS}

## Quick summary

${VIOLATION_SUMMARY_MD}

## Action

1. **STOP wallet writes for affected accounts** if hash-chain break is confirmed (page on-call).
2. Reproduce the invariant check manually:
   \`\`\`bash
   PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama
   -- Q1 (balance-sum):
   WITH computed AS (
     SELECT account_id,
            SUM(CASE side WHEN 'CREDIT' THEN amount ELSE -amount END) AS sum
       FROM wallet_entries GROUP BY account_id
   )
   SELECT w.id, w.balance, c.sum
     FROM wallet_accounts w JOIN computed c ON c.account_id = w.id
    WHERE w.id = '<wallet_id>';
   \`\`\`
3. Run full \`WalletAuditVerifier\` for hash-chain confirmation:
   \`npm --prefix apps/backend run audit:wallet-verify -- --account-id=<wallet_id>\`
4. Forensics — inspect operation_id/outbox-state for the diverging tx.
5. If confirmed tamper or unrecoverable loss → \`docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md\` (Lotteritilsynet within 24h).
6. **Append-only correction** — never UPDATE/DELETE from \`wallet_entries\`.

## Full report

<details>
<summary>Click to expand</summary>

\`\`\`md
${REPORT_BODY}
\`\`\`

</details>

## Runbook

\`docs/operations/WALLET_INTEGRITY_WATCHER_RUNBOOK.md\` for full diagnosis flow.

---

*Auto-generated. Will not re-fire for the same wallet_id for ${LINEAR_ISSUE_DEDUP_HOURS}h.*
*See ADR-0004 (hash-chain) + ADR-0005 (outbox) + ADR-0023 (MCP write-policy).*
EOF
)

# ── DRY_RUN — log and exit ──────────────────────────────────────────────────

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 — would create Linear-issue with title:"
  log "  ${ISSUE_TITLE}"
  log "Body length: ${#ISSUE_BODY} chars"
  log "Violations: balance=${BALANCE_COUNT} hash=${HASH_COUNT} wallets=${AFFECTED_WALLETS}"
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

  # Step 1: resolve team ID
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

  # Step 2: Dedup — look for an open issue with the same title prefix in the
  # last LINEAR_ISSUE_DEDUP_HOURS. If found, skip creation.
  local since_iso
  if since_iso=$(date -u -d "${LINEAR_ISSUE_DEDUP_HOURS} hours ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null); then
    :
  else
    # macOS BSD date
    since_iso=$(date -u -v-"${LINEAR_ISSUE_DEDUP_HOURS}H" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
  fi

  if [ -n "$since_iso" ]; then
    local dedup_query
    dedup_query=$(jq -nc \
      --arg tid "$team_id" \
      --arg prefix "$LINEAR_ISSUE_TITLE_PREFIX" \
      --arg since "$since_iso" \
      '{ query: "query { issues(filter: { team: { id: { eq: \"\($tid)\" } }, title: { contains: \"\($prefix)\" }, createdAt: { gt: \"\($since)\" }, state: { type: { nin: [\"completed\", \"canceled\"] } } }, first: 5) { nodes { id identifier title } } }" }')

    local dedup_res
    dedup_res=$(curl -s --max-time 15 -X POST https://api.linear.app/graphql \
      -H "Authorization: ${LINEAR_KEY}" \
      -H "Content-Type: application/json" \
      -d "$dedup_query" 2>&1) || dedup_res=""

    local existing
    existing=$(echo "$dedup_res" | jq -r '.data.issues.nodes[0].identifier // empty' 2>/dev/null || echo "")
    if [ -n "$existing" ]; then
      log "Linear dedup hit: open issue ${existing} already exists within ${LINEAR_ISSUE_DEDUP_HOURS}h. Skipping create."
      return 0
    fi
  fi

  # Step 3: resolve label ID (optional)
  local label_query
  label_query=$(jq -nc --arg name "$LINEAR_LABEL_NAME" --arg tid "$team_id" \
    '{ query: "query { issueLabels(filter: { name: { eq: \"\($name)\" }, team: { id: { eq: \"\($tid)\" } } }) { nodes { id name } } }" }')

  local label_res label_id
  label_res=$(curl -s --max-time 15 -X POST https://api.linear.app/graphql \
    -H "Authorization: ${LINEAR_KEY}" \
    -H "Content-Type: application/json" \
    -d "$label_query" 2>&1) || label_res=""
  label_id=$(echo "$label_res" | jq -r '.data.issueLabels.nodes[0].id // empty' 2>/dev/null || echo "")

  # Step 4: create issue
  local create_query
  if [ -n "$label_id" ]; then
    log "Attaching label ${LINEAR_LABEL_NAME} (${label_id})"
    create_query=$(jq -nc \
      --arg tid "$team_id" \
      --arg title "$ISSUE_TITLE" \
      --arg body "$ISSUE_BODY" \
      --arg lid "$label_id" \
      --argjson priority "$LINEAR_PRIORITY" \
      '{
        query: "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }",
        variables: {
          input: {
            teamId: $tid,
            title: $title,
            description: $body,
            priority: $priority,
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
      --argjson priority "$LINEAR_PRIORITY" \
      '{
        query: "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }",
        variables: {
          input: {
            teamId: $tid,
            title: $title,
            description: $body,
            priority: $priority
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
  slack_text=":rotating_light: *${ISSUE_TITLE}*\n\n${VIOLATION_SUMMARY_MD}\n\nReport: \`${REPORT_FILE}\`"

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
  fallback_file="${FALLBACK_OUTPUT_DIR}/$(date -u +%Y%m%dT%H%M%SZ).txt"

  cat > "$fallback_file" <<EOF
# Pending wallet-integrity alert (fallback)

Linear API not reachable / not configured. Manual action required.

## Title

${ISSUE_TITLE}

## Body

${ISSUE_BODY}

---

*Recommended:* copy title + body into Linear UI, attach \`${LINEAR_LABEL_NAME}\`
label, set priority Urgent.
EOF
  log "Wrote fallback pending-alert to ${fallback_file}"
  return 0
}

# ── Dispatch ────────────────────────────────────────────────────────────────

if create_via_linear 2>/dev/null; then
  exit 0
fi

log "Linear unavailable — trying fallback channels."

# Slack as secondary
create_via_slack || true

# Always write the fallback file so ops has a record
create_via_file
exit 0
