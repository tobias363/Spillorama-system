#!/usr/bin/env bash
# scripts/list-knowledge-snapshots.sh
#
# Lister alle `knowledge/YYYY-MM-DD`-tags opprettet av
# .github/workflows/knowledge-backup-daily.yml.
#
# Output:
#   knowledge/2026-05-13  abc1234  Knowledge snapshot knowledge/2026-05-13
#   knowledge/2026-05-12  def5678  Knowledge snapshot knowledge/2026-05-12
#   ...
#
# Bruk:
#   bash scripts/list-knowledge-snapshots.sh         # alle
#   bash scripts/list-knowledge-snapshots.sh --last 7 # siste 7
#
# Se docs/engineering/KNOWLEDGE_BACKUP_RESTORE.md.

set -euo pipefail

LIMIT=0 # 0 = alle

while [[ $# -gt 0 ]]; do
  case "$1" in
    --last) LIMIT="${2:-0}"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/list-knowledge-snapshots.sh [--last N]

Lister alle knowledge/YYYY-MM-DD-tags i kronologisk rekkefølge (nyeste først).

Options:
  --last N    Vis kun N nyeste snapshots
USAGE
      exit 0
      ;;
    *) echo "ERROR: Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Verifiser at vi er i et git-repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Not inside a git repository" >&2
  exit 1
fi

# Hent tags fra origin (stille)
git fetch origin --tags --quiet 2>/dev/null || true

# Samle alle knowledge/*-tags. `git tag -l` med sort=-creatordate gir
# nyeste først. Annotated tags har creatordate-felt; lightweight tags
# fanges også opp.
TAGS=$(git tag -l 'knowledge/*' --sort=-creatordate)

if [[ -z "$TAGS" ]]; then
  echo "Ingen knowledge/*-tags funnet."
  echo ""
  echo "Snapshots opprettes daglig av .github/workflows/knowledge-backup-daily.yml"
  echo "(02:00 UTC). Kjør workflow manuelt via:"
  echo ""
  echo "  gh workflow run knowledge-backup-daily.yml"
  echo ""
  exit 0
fi

COUNT=0
echo ""
printf "%-28s %-9s %s\n" "TAG" "SHA" "MELDING"
printf "%-28s %-9s %s\n" "----" "---" "-------"

while IFS= read -r TAG; do
  [[ -z "$TAG" ]] && continue

  COUNT=$((COUNT+1))
  if [[ "$LIMIT" -gt 0 ]] && [[ "$COUNT" -gt "$LIMIT" ]]; then
    break
  fi

  SHA_SHORT=$(git rev-parse --short "$TAG" 2>/dev/null || echo "??")

  # Annotated tags har egen melding; lightweight tags arver fra commit.
  # Tag-subject er første linje av tag-melding eller commit-subject.
  SUBJECT=$(git tag -l --format='%(subject)' "$TAG" | head -n 1)
  if [[ -z "$SUBJECT" ]]; then
    SUBJECT=$(git log -1 --pretty=%s "$TAG" 2>/dev/null || echo "(no message)")
  fi

  printf "%-28s %-9s %s\n" "$TAG" "$SHA_SHORT" "$SUBJECT"
done <<< "$TAGS"

echo ""
TOTAL=$(echo "$TAGS" | grep -c '^knowledge/' || true)
if [[ "$LIMIT" -gt 0 ]] && [[ "$TOTAL" -gt "$LIMIT" ]]; then
  echo "Viser $LIMIT av $TOTAL snapshots. Kjør uten --last for komplett liste."
else
  echo "Total: $TOTAL snapshots."
fi
echo ""
echo "Restore:  bash scripts/restore-knowledge.sh --tag <tag> --reason \"<text>\""
echo "Doc:      docs/engineering/KNOWLEDGE_BACKUP_RESTORE.md"
