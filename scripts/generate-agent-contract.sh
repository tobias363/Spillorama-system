#!/usr/bin/env bash
# generate-agent-contract.sh — fact-bound prompt contract for implementation agents.
#
# Purpose:
#   PM should not spawn high-risk implementation agents from memory or loose chat text.
#   This script generates a paste-ready contract that binds the agent to concrete
#   scope, evidence, context-pack output, invariants, documentation protocol, and
#   delivery-report format.
#
# Usage:
#   bash scripts/generate-agent-contract.sh \
#     --agent "Agent A — purchase_open seed/tick forensic fix" \
#     --objective "Prove and fix why scheduled games skip purchase_open" \
#     --files apps/backend/src/game/Game1ScheduleTickService.ts \
#     --files apps/backend/scripts/seed-demo-pilot-day.ts \
#     --evidence /tmp/purchase-open-forensics-2026-05-15T20-23-37Z.md \
#     --risk P0 \
#     --output /tmp/agent-contract.md
#
# Output defaults to stdout.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: must run inside a git repo" >&2
  exit 1
fi
cd "$REPO_ROOT"

AGENT_NAME=""
OBJECTIVE=""
RISK="P1"
OUTPUT=""
DECLARE_BRANCH=""
declare -a FILES=()
declare -a EVIDENCE=()
declare -a NON_GOALS=()

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/generate-agent-contract.sh \
    --agent "Agent A — purchase_open seed/tick forensic fix" \
    --objective "Prove and fix why scheduled games skip purchase_open" \
    --files apps/backend/src/game/Game1ScheduleTickService.ts \
    --files apps/backend/scripts/seed-demo-pilot-day.ts \
    --evidence /tmp/purchase-open-forensics-2026-05-15T20-23-37Z.md \
    --risk P0 \
    --output /tmp/agent-contract.md

Required:
  --agent       Agent name/scope label
  --objective   Concrete task objective
  --files       File path in write scope (repeatable)

Optional:
  --evidence    Evidence/report file the agent must cite (repeatable)
  --risk        P0/P1/P2/P3, default P1
  --branch      Suggested agent branch
  --non-goal    Explicit non-goal (repeatable)
  --output      Output file, defaults to stdout
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --agent)
      AGENT_NAME="${2:-}"
      shift 2
      ;;
    --objective)
      OBJECTIVE="${2:-}"
      shift 2
      ;;
    --risk)
      RISK="${2:-}"
      shift 2
      ;;
    --branch)
      DECLARE_BRANCH="${2:-}"
      shift 2
      ;;
    --files|--file)
      FILES+=("${2:-}")
      shift 2
      ;;
    --evidence)
      EVIDENCE+=("${2:-}")
      shift 2
      ;;
    --non-goal)
      NON_GOALS+=("${2:-}")
      shift 2
      ;;
    --output|-o)
      OUTPUT="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [ -z "$AGENT_NAME" ] || [ -z "$OBJECTIVE" ] || [ ${#FILES[@]} -eq 0 ]; then
  echo "ERROR: --agent, --objective and at least one --files value are required" >&2
  usage
  exit 2
fi

TMP_OUTPUT="$(mktemp -t agent-contract.XXXXXX.md)"
MAIN_SHA="$(git rev-parse origin/main 2>/dev/null || git rev-parse main 2>/dev/null || git rev-parse HEAD)"
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo "detached")"
NOW_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
SKILLS="$(node scripts/find-skills-for-file.mjs "${FILES[@]}" 2>/dev/null || true)"
LATEST_HANDOFF="$(find docs/operations -maxdepth 1 -name 'PM_HANDOFF_*.md' -type f 2>/dev/null | sort | tail -1 || true)"
LATEST_EXPORT="$(
  find docs/operations -maxdepth 1 -name 'PM_SESSION_KNOWLEDGE_EXPORT_*.md' -type f 2>/dev/null \
    | grep -v 'PM_SESSION_KNOWLEDGE_EXPORT_TEMPLATE.md' \
    | sort \
    | tail -1 \
    || true
)"

# Skill-SHA lockfile (Fase 2 — ADR-0024 follow-up).
# For each matched skill, capture version (from frontmatter) + commit-SHA at
# generation time. Allows reproducible audit later via verify-contract-freshness.mjs.
SKILLS_LOCK=""
if [ -n "$SKILLS" ]; then
  while IFS= read -r skill; do
    [ -z "$skill" ] && continue
    skill_path=".claude/skills/$skill/SKILL.md"
    if [ -f "$skill_path" ]; then
      sk_version=$(grep -E '^[[:space:]]*version:[[:space:]]*' "$skill_path" 2>/dev/null | head -1 | sed -E 's/^[[:space:]]*version:[[:space:]]*//;s/[[:space:]]*$//')
      [ -z "$sk_version" ] && sk_version="unversioned"
      sk_sha=$(git rev-parse "HEAD:$skill_path" 2>/dev/null || echo "uncommitted")
      sk_sha_short="${sk_sha:0:12}"
      SKILLS_LOCK+="${skill}|${sk_version}|${sk_sha_short}
"
    fi
  done <<< "$SKILLS"
fi

# Contract ID for persistent evidence storage (docs/evidence/<contract-id>/).
# Format: YYYYMMDD-<short-slug-of-agent-name>
CONTRACT_ID_DATE="$(date -u +%Y%m%d)"
CONTRACT_ID_SLUG="$(echo "$AGENT_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/^-*//;s/-*$//' | cut -c1-40)"
[ -z "$CONTRACT_ID_SLUG" ] && CONTRACT_ID_SLUG="agent"
CONTRACT_ID="${CONTRACT_ID_DATE}-${CONTRACT_ID_SLUG}"
PERSISTENT_EVIDENCE_DIR="docs/evidence/${CONTRACT_ID}"

# Detect ephemeral evidence paths for audit-warning
EPHEMERAL_EVIDENCE=()
for evidence in "${EVIDENCE[@]}"; do
  case "$evidence" in
    /tmp/*|/var/folders/*) EPHEMERAL_EVIDENCE+=("$evidence") ;;
  esac
done

{
  cat <<EOF
# Agent Task Contract — $AGENT_NAME

**Generated:** $NOW_UTC
**Repo:** $REPO_ROOT
**PM branch when generated:** \`$CURRENT_BRANCH\`
**Main baseline SHA:** \`$MAIN_SHA\`
**Risk:** \`$RISK\`
**Contract ID:** \`$CONTRACT_ID\`
**Persistent evidence dir:** \`$PERSISTENT_EVIDENCE_DIR\` (convention; see \`docs/evidence/README.md\`)
**Suggested agent branch:** \`${DECLARE_BRANCH:-"<PM fills branch before spawn>"}\`

This contract is the prompt source of truth. Do not infer requirements from chat
memory if they conflict with this file. If evidence conflicts with the objective,
stop and report the conflict before editing code.

---

## 1. Objective

$OBJECTIVE

## 2. Files In Scope

EOF

  for file in "${FILES[@]}"; do
    echo "- \`$file\`"
  done

  cat <<'EOF'

Rules:
- Treat this list as the write boundary.
- If you discover another file must change, state why before editing it.
- Do not touch unrelated refactors, formatting churn, or generated artifacts unless explicitly required.

## 3. Evidence Pack

EOF

  if [ ${#EVIDENCE[@]} -eq 0 ]; then
    cat <<'EOF'
- No external evidence file was supplied.

Because no evidence file was supplied, you must produce file:line proof from the
repo before claiming root cause. For repeated live-test bugs, ask PM for a
forensic report before implementation.
EOF
  else
    for evidence in "${EVIDENCE[@]}"; do
      echo "- \`$evidence\`"
    done
    cat <<'EOF'

You must cite concrete evidence from these files in your root-cause summary:
- DB rows, log lines, Sentry issue IDs, PostHog session URLs, test output, or file:line references.
- If a claim cannot be tied to evidence, mark it as a hypothesis, not a fact.
EOF
  fi

  # Ephemeral evidence warning (Fase 2 — ADR-0024 follow-up)
  if [ ${#EPHEMERAL_EVIDENCE[@]} -gt 0 ]; then
    cat <<EOF

**Evidence persistence warning:** One or more evidence files are in an
ephemeral location (\`/tmp\` or \`/var/folders\`) and will not survive a
reboot or be available for audit weeks later. For audit-grade contracts,
copy evidence to persistent storage before spawning the agent:

\`\`\`bash
mkdir -p ${PERSISTENT_EVIDENCE_DIR}
EOF
    for evidence in "${EPHEMERAL_EVIDENCE[@]}"; do
      echo "cp $evidence ${PERSISTENT_EVIDENCE_DIR}/"
    done
    cat <<'EOF'
```

See `docs/evidence/README.md` for the full persistent-evidence convention.
EOF
  fi

  cat <<'EOF'

## 3a. Cross-Cutting Impact Analysis

Before implementation, the agent must answer in the delivery report:

1. **Beyond the files in scope above**, what other files, services, or
   modules might this change affect? Be specific (`file:line` or module name).
2. **What invariants** must be preserved across these touch-points? Examples:
   wallet balance equation, audit-trail hash-chain continuity, plan-runtime
   state-machine ordering, socket-event contract.
3. **If "no ripple effects"**, justify with a concrete reference (test
   coverage, module isolation, type-system enforcement).

This is a discipline check, not a hard gate. Skipping it is acceptable when
scope is genuinely isolated, but the justification must be in the delivery
report. PM will reject vague "no ripple" claims.

## 4. Mandatory Context Before Any Code Change

Read these before editing:

EOF

  if [ -n "$LATEST_HANDOFF" ]; then
    echo "- Latest PM handoff: \`$LATEST_HANDOFF\`"
  fi
  if [ -n "$LATEST_EXPORT" ]; then
    echo "- Latest PM knowledge export: \`$LATEST_EXPORT\`"
  fi
  echo "- \`docs/engineering/PITFALLS_LOG.md\` sections relevant to this scope"
  echo "- \`docs/engineering/AGENT_EXECUTION_LOG.md\` latest related entries"

  if [ -n "$SKILLS" ]; then
    echo "- Relevant skills matched by scope (skill @ version @ SHA at generation):"
    if [ -n "$SKILLS_LOCK" ]; then
      while IFS='|' read -r sk_name sk_ver sk_short; do
        [ -z "$sk_name" ] && continue
        echo "  - \`.claude/skills/$sk_name/SKILL.md\` @ \`v$sk_ver\` @ \`$sk_short\`"
      done <<< "$SKILLS_LOCK"
    else
      while IFS= read -r skill; do
        [ -z "$skill" ] && continue
        echo "  - \`.claude/skills/$skill/SKILL.md\` (version/SHA capture failed)"
      done <<< "$SKILLS"
    fi
    cat <<'EOF'

**Verify skill freshness before agent spawn:**

```bash
node scripts/verify-contract-freshness.mjs <path-to-this-contract.md>
```

Exit 0 = skill SHAs match current HEAD. Exit 1 = at least one skill has drifted
since this contract was generated; review the diff before spawning.
EOF
  else
    echo "- No skill matched automatically. Search \`.claude/skills/\` manually and document if none applies."
  fi

  cat <<'EOF'

## 5. Auto Context Pack

The following context pack was generated from the scoped files. Read it and obey
the "MUST read" sections.

EOF

  bash scripts/generate-context-pack.sh "${FILES[@]}" || true

  cat <<'EOF'

---

## 6. Hard Constraints

- Do not create or merge PRs. PM owns PR creation and merge.
- Do not push to `main`.
- Do not perform direct prod DB writes. Schema/data corrections go through migration PRs.
- Do not edit preview/design source unless this contract explicitly says so.
- Do not remove or weaken compliance, wallet, audit, or live-room guards to make a test pass.
- Do not mark work done without tests or a concrete reason tests could not run.
- If the bug has appeared 2+ times, write or update a deterministic regression test before the fix, unless PM explicitly scoped a docs-only forensic task.

## 7. Non-Goals

EOF

  if [ ${#NON_GOALS[@]} -eq 0 ]; then
    echo "- No extra non-goals supplied by PM. Default non-goal: unrelated cleanup."
  else
    for non_goal in "${NON_GOALS[@]}"; do
      echo "- $non_goal"
    done
  fi

  cat <<'EOF'

## 8. Documentation Protocol (Immutable)

If this task changes pilot, wallet, compliance, live-room, or PM-workflow behavior,
the same branch must update all three:

- Relevant `.claude/skills/<skill>/SKILL.md`
- `docs/engineering/PITFALLS_LOG.md`
- `docs/engineering/AGENT_EXECUTION_LOG.md`

Use `docs/engineering/SKILL_DOC_PROTOCOL_TEMPLATE.md` for the exact text shape.
If you believe one is not applicable, state the reason in the delivery report and
PR body. PM will reject vague "not applicable" claims.

## 9. Required Delivery Report

Return your final report using `docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md`.
The report must include:

- Context read before changes
- Evidence-backed root cause
- Files changed
- Invariants preserved
- Tests run and result
- Skill/PITFALLS/AGENT_EXECUTION_LOG updates
- Open risk or "none"
- Ready for PR: yes/no with reason

## 10. Stop Conditions

Stop and ask PM before editing if:

- Evidence contradicts the objective.
- Required fix needs files outside scope and the reason is not obvious.
- You cannot identify the right skill/PITFALLS section.
- The safest fix requires a product or compliance decision.
EOF
} > "$TMP_OUTPUT"

if [ -n "$OUTPUT" ]; then
  mkdir -p "$(dirname "$OUTPUT")"
  cp "$TMP_OUTPUT" "$OUTPUT"
  echo "Wrote agent contract: $OUTPUT"
else
  cat "$TMP_OUTPUT"
fi

rm -f "$TMP_OUTPUT"
