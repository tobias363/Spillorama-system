#!/usr/bin/env bash
# Agent onboarding — current state of the Spillorama project.
#
# Usage:
#   ./scripts/agent-onboarding.sh                # write to stdout
#   ./scripts/agent-onboarding.sh > /tmp/onboarding.md
#
# Idempotent: kan kjøres når som helst, leser kun fra repo + git + (optional) gh.
# Wrappet rundt git/gh-kall som kan feile — scriptet exit-er aldri på manglende
# verktøy, men markerer seksjoner som "(ikke tilgjengelig)" i output.
#
# Mål: gi en ny agent-sesjon en ferdig kontekst-fil som kan leses før første
# kode-endring. Plasseres i `/tmp/onboarding.md` av oppstart-konvensjon.

set -u  # ikke -e — vi vil at scriptet aldri skal krasje, kun degradere graceful

# Finn repo-rot uavhengig av hvor scriptet kalles fra.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

NOW="$(date +'%Y-%m-%d %H:%M %Z')"

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Skriv en linje hvis den finnes, "(ingen)" ellers.
emit_or_empty() {
  local content="$1"
  if [ -z "$content" ]; then
    printf '_(ingen)_\n'
  else
    printf '%s\n' "$content"
  fi
}

# Sjekk om en kommando finnes.
has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# ─── Header ───────────────────────────────────────────────────────────────────

cat <<HEADER
# Spillorama agent-onboarding

**Generert:** $NOW
**Repo:** $REPO_ROOT
**Aktiv branch:** $(git branch --show-current 2>/dev/null || echo '(ikke i git-repo)')

> Les denne filen før første kode-endring. Gir current state av prosjektet:
> pågående refaktor-bølger, sist merger til main, åpne pilot-blokkere, aktive
> worktrees og hvilke skills som finnes for domenet.

## Obligatorisk preflight før filendring

Codex:

\`\`\`bash
cd /Users/tobiashaugen/Projects/Spillorama-system-codex
npm run agent:preflight -- --actor codex
\`\`\`

Claude:

\`\`\`bash
cd /Users/tobiashaugen/Projects/Spillorama-system-claude
npm run agent:preflight -- --actor claude
\`\`\`

Ikke endre filer før scriptet skriver \`PREFLIGHT PASS\`.
Les også \`docs/operations/CODEX_CLAUDE_WORKTREE_ROUTINE.md\`.

HEADER

# ─── Pågående refaktor-bølger ─────────────────────────────────────────────────

cat <<'SECTION'
## Pågående refaktor-bølger (K1-K4 i BACKLOG.md)

SECTION

if [ -f BACKLOG.md ]; then
  # Hent K1-K9-headere + neste linje (typisk Status-linje).
  awk '
    /^### K[0-9]/ {
      # Strip leading "### " for cleaner bullet output.
      header = substr($0, 5)
      print "- " header
      getline next_line
      if (next_line ~ /^Status:/ || next_line ~ /^\*\*Status:\*\*/) {
        print "  " next_line
      }
    }
  ' BACKLOG.md
else
  echo "_(BACKLOG.md ikke funnet)_"
fi

echo

# ─── Sist 10 merger til main ──────────────────────────────────────────────────

cat <<'SECTION'
## Sist 10 commits til origin/main

SECTION

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  git log --oneline origin/main -10 2>/dev/null | sed 's/^/- /' || echo "_(git log feilet)_"
elif git rev-parse --verify main >/dev/null 2>&1; then
  echo "_(origin/main mangler — fallback til lokal main)_"
  echo
  git log --oneline main -10 2>/dev/null | sed 's/^/- /' || echo "_(git log feilet)_"
else
  echo "_(verken origin/main eller main funnet)_"
fi

echo

# ─── Åpne pilot-blokkere ──────────────────────────────────────────────────────

cat <<'SECTION'
## Åpne pilot-blokkere (fra BACKLOG.md)

SECTION

if [ -f BACKLOG.md ]; then
  # Finn linjer med "Status:" og "Åpen" / "🔴" — vis omkringliggende kontekst.
  awk '
    BEGIN { in_section = 0; section = ""; printed_any = 0 }
    /^### / {
      section = $0
      in_section = 1
      next
    }
    /^Status:.*[Åå]pen/ || /^\*\*Status:\*\*.*[Åå]pen/ || /🔴/ {
      if (in_section && section != "") {
        print "- **" substr(section, 5) "**"
        print "  " $0
        printed_any = 1
        section = ""  # ikke skriv samme seksjon flere ganger
      }
    }
    END {
      if (printed_any == 0) {
        print "_(ingen åpne blokkere flagget i BACKLOG.md — sjekk Linear)_"
      }
    }
  ' BACKLOG.md
else
  echo "_(BACKLOG.md ikke funnet)_"
fi

echo

# ─── Åpne PR-er ───────────────────────────────────────────────────────────────

cat <<'SECTION'
## Åpne PR-er (top 10)

SECTION

if has_cmd gh; then
  gh_output="$(gh pr list --state open --limit 10 --json number,title,headRefName \
    --jq '.[] | "- PR #\(.number) — \(.title)  \n  branch: `\(.headRefName)`"' 2>/dev/null || true)"
  emit_or_empty "$gh_output"
else
  echo "_(gh CLI ikke tilgjengelig — installér med \`brew install gh\`)_"
fi

echo

# ─── Aktive worktrees ─────────────────────────────────────────────────────────

cat <<'SECTION'
## Aktive worktrees (mulige kjørende agenter)

> Hver worktree representerer en agent som potensielt jobber parallelt. Sjekk
> branch-navnet for å se hva agenten gjør. **Ikke push til samme branch** uten
> å koordinere.

SECTION

worktrees="$(git worktree list 2>/dev/null \
  | grep -v "^${REPO_ROOT}\b" \
  | grep -v "^${REPO_ROOT} " \
  | head -10 \
  | awk '{
      branch = ""
      for (i = 3; i <= NF; i++) {
        if ($i ~ /^\[/) branch = branch " " $i
      }
      print "- " $1 " " branch
    }')"
emit_or_empty "$worktrees"

echo

# ─── Skills tilgjengelig ──────────────────────────────────────────────────────

cat <<'SECTION'
## Domain-skills i `.claude/skills/`

> Project-skills lastes lazy per-task. Last KUN når du redigerer kode i
> domenet (vedtak 2026-04-25, se `feedback_skill_loading.md`). Skip for
> ren PM/orkestrering.

SECTION

if [ -d .claude/skills ]; then
  skills_output="$(ls -1 .claude/skills 2>/dev/null \
    | sort \
    | head -25 \
    | sed 's/^/- /')"
  emit_or_empty "$skills_output"
else
  echo "_(.claude/skills/ ikke funnet)_"
fi

echo

# ─── Skills sist oppdatert ────────────────────────────────────────────────────

cat <<'SECTION'
## Skills sist oppdatert (top 10)

SECTION

if [ -d .claude/skills ]; then
  recent="$(find .claude/skills -name 'SKILL.md' -type f 2>/dev/null \
    | xargs -I {} sh -c 'printf "%s\t%s\n" "$(git log -1 --format=%ar -- {} 2>/dev/null || echo unknown)" "$(basename $(dirname {}))"' 2>/dev/null \
    | sort \
    | head -10 \
    | sed 's/^/- /')"
  emit_or_empty "$recent"
else
  echo "_(.claude/skills/ ikke funnet)_"
fi

echo

# ─── Lese-først-liste ─────────────────────────────────────────────────────────

cat <<'FOOTER'
## Lese-først (alltid før kode-endring)

- `CLAUDE.md` (rot) — 🚨-blokker, project-conventions, skill-mapping
- `BACKLOG.md` (rot) — strategisk pilot-status og åpne blokkere
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` — P0-mandat for Spill 1/2/3

### Hvis du jobber med Spill-spesifikk kode:

- Spill 1: `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`
- Spill 2: `docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`
- Spill 3: `docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`

### Payout / spillkatalog:

- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — kanonisk premie-mekanikk
- `docs/architecture/SPILL_DETALJER_PER_SPILL.md` — per-spill bonus-defaults
- `docs/architecture/SPILLKATALOG.md` — markedsføring vs slug-mapping

### Refaktor-status:

- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`

## Linear

- https://linear.app/bingosystem — issues kategorisert som BIN-NNN
- Done-policy: lukket KUN etter merge til main + file:line + grønn test (vedtak 2026-04-17)

## Git-flyt

- Agent: commit + push feature-branch
- PM: `gh pr create` + merge
- Rapportér som "Agent N — [scope]:" med branch + commit-SHAs + test-status

FOOTER
