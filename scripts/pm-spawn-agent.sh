#!/usr/bin/env bash
# pm-spawn-agent.sh — local ergonomics wrapper for agent-contract spawn.
#
# Purpose:
#   Make it harder to forget the agent-contract step when PM spawns a
#   high-risk implementation-agent. PR-side agent-contract-gate is the
#   AUTHORITATIVE check (server-enforced, shadow-mode until 2026-05-24,
#   then hard-fail). This wrapper is ERGONOMI on top — fail-fast locally
#   instead of waiting for CI feedback.
#
# Usage:
#   bash scripts/pm-spawn-agent.sh \
#     --agent "Agent A — purchase_open fix" \
#     --objective "Prove and fix..." \
#     --files apps/backend/src/game/Game1ScheduleTickService.ts \
#     --evidence /tmp/forensics-2026-05-15.md \
#     --risk P0 \
#     --branch claude/agent-a-purchase-open-2026-05-16
#
# What it does:
#   1. Generates the contract via scripts/generate-agent-contract.sh.
#   2. Persists it to docs/evidence/<CONTRACT_ID>/contract.md.
#   3. Copies referenced ephemeral evidence files into same dir.
#   4. Prints the Contract-ID + Contract-path lines ready for PR body.
#   5. Refuses to proceed if a Tier-A (--risk P0/P1) call is missing
#      required args.
#
# This wrapper does NOT spawn the agent itself. The agent is spawned by
# the PM (Tobias/Claude) pasting the generated contract into the Agent
# tool prompt. The wrapper just ensures the contract exists, is committed,
# and has the audit-trail structure required by agent-contract-gate.yml.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

AGENT_NAME=""
OBJECTIVE=""
RISK="P1"
BRANCH=""
declare -a FILES=()
declare -a EVIDENCE=()
declare -a NON_GOALS=()

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/pm-spawn-agent.sh \
    --agent "<name>" \
    --objective "<concrete goal>" \
    --files <path> [--files <path> ...] \
    --evidence <path> [--evidence <path> ...] \
    --risk P0|P1|P2 \
    --branch <suggested-branch>

Required: --agent, --objective, --files (≥1)
Recommended: --evidence (≥1 for P0/P1), --branch

Produces:
  docs/evidence/<YYYYMMDD-slug>/contract.md
  + copies of evidence files (if --evidence supplied)

Prints PR-body lines to paste:
  Contract-ID: <id>
  Contract-path: docs/evidence/<id>/contract.md
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --agent) AGENT_NAME="${2:-}"; shift 2 ;;
    --objective) OBJECTIVE="${2:-}"; shift 2 ;;
    --risk) RISK="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --files|--file) FILES+=("${2:-}"); shift 2 ;;
    --evidence) EVIDENCE+=("${2:-}"); shift 2 ;;
    --non-goal) NON_GOALS+=("${2:-}"); shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$AGENT_NAME" ] || [ -z "$OBJECTIVE" ] || [ ${#FILES[@]} -eq 0 ]; then
  echo "ERROR: --agent, --objective, and at least one --files are required" >&2
  usage
  exit 1
fi

case "$RISK" in
  P0|P1)
    if [ ${#EVIDENCE[@]} -eq 0 ]; then
      cat >&2 <<'EOF'
WARNING: P0/P1 risk without any --evidence file.
Per AGENT_TASK_CONTRACT.md Regel 3, facts must be traceable to file:line,
DB-row, log-line, Sentry-issue, PostHog-session, or test-output.

Continue without evidence? This is allowed for forensic-discovery agents
where the agent's first task IS to produce evidence — but for fix-agents
you should normally have evidence first.

Press Ctrl+C to abort, or Enter to continue.
EOF
      read -r _
    fi
    ;;
esac

CONTRACT_ID_DATE="$(date -u +%Y%m%d)"
CONTRACT_ID_SLUG="$(echo "$AGENT_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/^-*//;s/-*$//' | cut -c1-40)"
[ -z "$CONTRACT_ID_SLUG" ] && CONTRACT_ID_SLUG="agent"
CONTRACT_ID="${CONTRACT_ID_DATE}-${CONTRACT_ID_SLUG}"
PERSISTENT_DIR="docs/evidence/${CONTRACT_ID}"
CONTRACT_PATH="${PERSISTENT_DIR}/contract.md"

mkdir -p "${PERSISTENT_DIR}"

GEN_ARGS=(
  --agent "$AGENT_NAME"
  --objective "$OBJECTIVE"
  --risk "$RISK"
  --output "$CONTRACT_PATH"
)
for f in "${FILES[@]}"; do
  GEN_ARGS+=(--files "$f")
done
for e in "${EVIDENCE[@]}"; do
  GEN_ARGS+=(--evidence "$e")
done
for ng in "${NON_GOALS[@]}"; do
  GEN_ARGS+=(--non-goal "$ng")
done
[ -n "$BRANCH" ] && GEN_ARGS+=(--branch "$BRANCH")

if [ ! -x scripts/generate-agent-contract.sh ]; then
  echo "ERROR: scripts/generate-agent-contract.sh not found or not executable" >&2
  exit 2
fi

bash scripts/generate-agent-contract.sh "${GEN_ARGS[@]}"

if [ ${#EVIDENCE[@]} -gt 0 ]; then
  for ev in "${EVIDENCE[@]}"; do
    case "$ev" in
      /tmp/*|/var/folders/*)
        if [ -f "$ev" ]; then
          dest="${PERSISTENT_DIR}/$(basename "$ev")"
          cp "$ev" "$dest"
          echo "Copied $ev -> $dest" >&2
        fi
        ;;
    esac
  done
fi

cat <<EOF

──────────────────────────────────────────────────────────────────────
✓ Agent contract generated
──────────────────────────────────────────────────────────────────────

Paste these lines into your PR body:

  Contract-ID: ${CONTRACT_ID}
  Contract-path: ${CONTRACT_PATH}

The contract file is at:
  ${REPO_ROOT}/${CONTRACT_PATH}

Next steps:
  1. Review the generated contract
  2. git add ${PERSISTENT_DIR}/
  3. Spawn agent with the contract content as prompt
  4. Verify the contract is in the PR diff before opening PR

EOF
