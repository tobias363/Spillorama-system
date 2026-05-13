#!/usr/bin/env bash
# scripts/restore-knowledge.sh
#
# Restore knowledge artefakter fra et `knowledge/YYYY-MM-DD`-tag opprettet
# av .github/workflows/knowledge-backup-daily.yml.
#
# Bruk:
#   bash scripts/restore-knowledge.sh \
#     --tag knowledge/2026-05-12 \
#     --reason "FRAGILITY_LOG ble feilaktig overskrevet av agent X i PR #1234"
#
# Med --yes for unattended (eks. fra annet script):
#   bash scripts/restore-knowledge.sh --tag knowledge/2026-05-12 --reason "..." --yes
#
# Restorer overskriver lokale filer fra tag og lager EN commit. Push til
# remote må gjøres manuelt etter at PM/Tobias har verifisert diff-en.
#
# Se docs/engineering/KNOWLEDGE_BACKUP_RESTORE.md for full beskrivelse.

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/restore-knowledge.sh --tag <tag> --reason <text> [--yes]

Required:
  --tag <tag>       Knowledge snapshot-tag, eks. knowledge/2026-05-12
  --reason <text>   Hvorfor restore — havner i commit-message + audit-trail.

Optional:
  --yes             Skip interactive confirmation (for unattended/CI bruk).

Eksempel:
  bash scripts/restore-knowledge.sh \
    --tag knowledge/2026-05-12 \
    --reason "FRAGILITY_LOG corrupted in PR #1234, rolling back"
USAGE
}

TAG=""
REASON=""
YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "ERROR: --tag is required" >&2
  usage
  exit 2
fi

if [[ -z "$REASON" ]]; then
  echo "ERROR: --reason is required (will be in commit-message)" >&2
  usage
  exit 2
fi

# Verifiser at vi er i et git-repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Not inside a git repository" >&2
  exit 1
fi

# Sjekk for uncommitted changes — restore overskriver filer så vi vil
# advare brukeren hvis de mister noe.
if ! git diff --quiet HEAD -- 2>/dev/null; then
  echo "WARNING: Du har uncommitted endringer i working tree:" >&2
  git status --short
  echo "" >&2
  if [[ $YES -ne 1 ]]; then
    read -r -p "Fortsette likevel? (yes/no): " ANSWER
    if [[ "$ANSWER" != "yes" ]]; then
      echo "Avbrutt." >&2
      exit 1
    fi
  else
    echo "WARNING: --yes satt, fortsetter med uncommitted endringer." >&2
  fi
fi

echo "Henter tags fra origin..."
git fetch origin --tags --quiet

if ! git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "ERROR: Tag '$TAG' finnes ikke." >&2
  echo "Kjør 'bash scripts/list-knowledge-snapshots.sh' for å se tilgjengelige tags." >&2
  exit 1
fi

TAG_SHA=$(git rev-parse "$TAG")
TAG_DATE=$(git log -1 --pretty=%ai "$TAG")

echo ""
echo "=== Restore-plan ==="
echo "  Tag:         $TAG"
echo "  Tag SHA:     $TAG_SHA"
echo "  Tag dato:    $TAG_DATE"
echo "  Reason:      $REASON"
echo ""

# Filer som skal restoreres. Listen MÅ matche workflow-en.
FILES=(
  "docs/engineering/FRAGILITY_LOG.md"
  "docs/engineering/PITFALLS_LOG.md"
  "docs/engineering/AGENT_EXECUTION_LOG.md"
  "docs/engineering/KNOWLEDGE_AUTONOMY_PROTOCOL.md"
  "tests/e2e/BUG_CATALOG.md"
)

# SKILL_FILE_MAP.md hvis den eksisterer i tag eller working tree
if git show "$TAG:docs/engineering/SKILL_FILE_MAP.md" >/dev/null 2>&1 \
   || [ -f "docs/engineering/SKILL_FILE_MAP.md" ]; then
  FILES+=("docs/engineering/SKILL_FILE_MAP.md")
fi

# Skills-katalog (hele treet hvis det fantes i tag)
if git ls-tree -r --name-only "$TAG" -- .claude/skills 2>/dev/null | grep -q .; then
  FILES+=(".claude/skills")
fi

echo "Filer som vil bli overskrevet (diff fra current HEAD):"
echo ""

# Vis diff-stat så brukeren ser hva som vil endres
git diff --stat "$TAG" -- "${FILES[@]}" || {
  echo "(ingen diff, eller fil-mismatch — restoren vil gjøre filene identiske med tag)"
}
echo ""

if [[ $YES -ne 1 ]]; then
  read -r -p "Anvend restore? (yes/no): " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Avbrutt — ingen endringer gjort." >&2
    exit 1
  fi
fi

echo ""
echo "Restorerer filer fra $TAG..."

# git checkout <tag> -- <files> kopierer fil-innholdet fra tag inn i working
# tree OG inn i index. Filer som finnes i HEAD men ikke i tag fjernes IKKE
# automatisk — vi må håndtere det eksplisitt for .claude/skills/ siden den
# kan ha fått nye filer etter tag-tidspunktet.
git checkout "$TAG" -- "${FILES[@]}"

# Stage endringene. git checkout gjorde det allerede, men vi kjører
# git add for å være eksplisitt og for å håndtere eventuelle file-mode-diff.
git add "${FILES[@]}"

# Hvis ingen endringer ble lagd er working tree allerede identisk med tag.
if git diff --cached --quiet; then
  echo "Ingen forskjell mellom current HEAD og $TAG — ingen commit opprettet."
  exit 0
fi

# Conventional Commits: chore(knowledge): restore from <tag> — <reason>
COMMIT_MSG="chore(knowledge): restore from $TAG — $REASON

Source tag:   $TAG
Source SHA:   $TAG_SHA
Source dato:  $TAG_DATE
Restore-tid:  $(date -u +%Y-%m-%dT%H:%M:%SZ)

Reason: $REASON

Restorerte filer:
$(for f in "${FILES[@]}"; do echo "  - $f"; done)

Audit:
  - Husk å legge entry i docs/engineering/AGENT_EXECUTION_LOG.md
  - Beskriv hvorfor restore var nødvendig og hva som ble lært

[bypass-pm-gate: knowledge-restore]
gate-not-applicable: emergency-knowledge-restore

Doc: docs/engineering/KNOWLEDGE_BACKUP_RESTORE.md"

git commit -m "$COMMIT_MSG"

NEW_SHA=$(git rev-parse HEAD)

echo ""
echo "=== Restore fullført ==="
echo "  Ny commit: $NEW_SHA"
echo ""
echo "Neste steg:"
echo "  1. Verifiser at filer ser riktige ut (git show HEAD)"
echo "  2. Push til remote når PM/Tobias har godkjent:"
echo "     git push origin HEAD"
echo "  3. Legg entry i docs/engineering/AGENT_EXECUTION_LOG.md"
echo ""
