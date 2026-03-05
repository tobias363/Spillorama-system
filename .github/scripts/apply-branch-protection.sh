#!/usr/bin/env bash
set -euo pipefail

OWNER="${GITHUB_OWNER:-tobias363}"
REPO="${GITHUB_REPO:-bingosystem}"
BRANCH="${GITHUB_BRANCH:-main}"
REQUIRED_APPROVALS="${REQUIRED_APPROVALS:-0}"
REQUIRE_LAST_PUSH_APPROVAL="${REQUIRE_LAST_PUSH_APPROVAL:-false}"

# Required checks can be overridden with comma separated values.
REQUIRED_CONTEXTS_CSV="${REQUIRED_CONTEXTS_CSV:-backend,compliance}"
IFS=',' read -r -a CONTEXTS <<< "$REQUIRED_CONTEXTS_CSV"

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

# Build JSON manually to avoid jq dependency.
{
  printf '{\n'
  printf '  "required_status_checks": {\n'
  printf '    "strict": true,\n'
  printf '    "contexts": ['
  for i in "${!CONTEXTS[@]}"; do
    ctx="${CONTEXTS[$i]}"
    ctx="${ctx## }"
    ctx="${ctx%% }"
    if [[ $i -gt 0 ]]; then
      printf ', '
    fi
    printf '"%s"' "$ctx"
  done
  printf ']\n'
  printf '  },\n'
  printf '  "enforce_admins": true,\n'
  printf '  "required_pull_request_reviews": {\n'
  printf '    "dismiss_stale_reviews": true,\n'
  printf '    "require_code_owner_reviews": false,\n'
  printf '    "required_approving_review_count": %s,\n' "$REQUIRED_APPROVALS"
  printf '    "require_last_push_approval": %s\n' "$REQUIRE_LAST_PUSH_APPROVAL"
  printf '  },\n'
  printf '  "restrictions": null,\n'
  printf '  "required_linear_history": true,\n'
  printf '  "allow_force_pushes": false,\n'
  printf '  "allow_deletions": false,\n'
  printf '  "block_creations": false,\n'
  printf '  "required_conversation_resolution": true,\n'
  printf '  "lock_branch": false,\n'
  printf '  "allow_fork_syncing": true\n'
  printf '}\n'
} > "$TMP_JSON"

echo "Applying branch protection on ${OWNER}/${REPO}:${BRANCH} ..."
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${OWNER}/${REPO}/branches/${BRANCH}/protection" \
  --input "$TMP_JSON" >/dev/null

echo "Branch protection updated successfully."
