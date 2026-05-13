#!/usr/bin/env bash
# pm-handover-brief.sh — auto-generer komplett sesjons-snapshot for PM-overlevering
#
# Tobias-direktiv 2026-05-13 (Tier 3-D): "PM-handover-brief auto-generator
# — null kontekst-tap mellom PM-sesjoner."
#
# Genererer markdown-rapport som inkluderer alt en ny PM-AI trenger for å
# starte umiddelbart uten 60-90 min manuell onboarding:
#   - Aktive PR-er + CI-status
#   - Aktive bakgrunns-agenter (PID-er, output-filer)
#   - Live-monitor-state + nyeste anomalier
#   - Nyeste FRAGILITY-entries
#   - Tobias-direktiv siste 24t (parsed fra PM_HANDOFF + commit-messages)
#   - Åpne bugs (BUG_CATALOG)
#   - In-flight tester
#
# Bruk:
#   bash scripts/pm-handover-brief.sh > /tmp/pm-handover.md
#   # ny PM leser /tmp/pm-handover.md som FØRSTE handling i sesjon

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

cat <<EOF
# PM Handover Brief — auto-generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")

**Repo:** $REPO_ROOT
**Branch på origin/main:** $(git rev-parse --short origin/main 2>/dev/null || echo "n/a")
**Lokalt:** $(git rev-parse --short HEAD 2>/dev/null) på $(git rev-parse --abbrev-ref HEAD 2>/dev/null)

---

## 1. Aktive PR-er

EOF

if command -v gh >/dev/null 2>&1; then
  gh pr list --state open --json number,title,headRefName,statusCheckRollup --limit 15 2>/dev/null | python3 -c "
import json, sys
prs = json.load(sys.stdin)
if not prs:
    print('_(ingen åpne PR-er)_')
else:
    print('| # | Tittel | Branch | CI |')
    print('|---|---|---|---|')
    for pr in prs:
        title = pr['title'][:60]
        branch = pr['headRefName'][:40]
        checks = pr.get('statusCheckRollup', [])
        success = sum(1 for c in checks if c.get('conclusion') == 'SUCCESS' or c.get('state') == 'SUCCESS')
        failure = sum(1 for c in checks if c.get('conclusion') == 'FAILURE' or c.get('state') == 'FAILURE')
        pending = sum(1 for c in checks if c.get('status') in ('QUEUED', 'IN_PROGRESS'))
        status = f'✓{success}✗{failure}⋯{pending}'
        print(f\"| #{pr['number']} | {title} | {branch} | {status} |\")
" 2>/dev/null || echo "_(gh CLI feilet)_"
else
  echo "_(gh CLI ikke installert)_"
fi

cat <<EOF

---

## 2. Aktive bakgrunns-agenter (TaskList)

EOF

# List aktive agent-prosesser fra /private/tmp/claude-501
TASK_DIR=$(ls -d /private/tmp/claude-501/*Spillorama-system*/*/tasks 2>/dev/null | head -1)
if [ -n "$TASK_DIR" ] && [ -d "$TASK_DIR" ]; then
  RECENT=$(find "$TASK_DIR" -name "*.output" -mmin -120 2>/dev/null | head -10)
  if [ -n "$RECENT" ]; then
    echo "Siste agent-tasks (siste 2 timer):"
    echo ""
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      basename=$(basename "$f" .output)
      mtime=$(stat -f "%Sm" -t "%H:%M:%S" "$f" 2>/dev/null || echo "?")
      echo "- \`$basename\` (last updated $mtime)"
    done <<< "$RECENT"
  else
    echo "_(ingen aktive agent-tasks de siste 2 timene)_"
  fi
else
  echo "_(task-dir ikke funnet — sjekk Cowork sub-agent runtime)_"
fi

cat <<EOF

---

## 3. Live-monitor state

EOF

MONITOR_PID_FILE="/tmp/pilot-monitor.pid"
if [ -f "$MONITOR_PID_FILE" ]; then
  PID=$(cat "$MONITOR_PID_FILE")
  if ps -p "$PID" >/dev/null 2>&1; then
    echo "✅ Monitor kjører (PID $PID)"
  else
    echo "❌ Monitor PID $PID skrevet men prosess ikke aktiv"
  fi
else
  echo "❌ Monitor ikke startet (pid-fil mangler)"
fi
echo ""

if [ -f /tmp/pilot-monitor-snapshot.md ]; then
  echo "**Siste snapshot:**"
  echo '```'
  head -20 /tmp/pilot-monitor-snapshot.md
  echo '```'
else
  echo "_(ingen snapshot tilgjengelig)_"
fi
echo ""

if [ -f /tmp/pilot-monitor.log ]; then
  echo "**Siste 10 anomalier:**"
  echo '```'
  grep -E "\[P[0-3]\]" /tmp/pilot-monitor.log | tail -10 || echo "(ingen)"
  echo '```'
fi
echo ""

ROUND_REPORTS=$(ls /tmp/pilot-monitor-round-*.md 2>/dev/null | head -5)
if [ -n "$ROUND_REPORTS" ]; then
  echo "**Round-end-rapporter tilgjengelig:**"
  echo ""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    head_line=$(head -1 "$f")
    echo "- \`$f\` — $head_line"
  done <<< "$ROUND_REPORTS"
fi

cat <<EOF

---

## 4. Nyeste FRAGILITY-entries (TOP-prioritet å lese)

EOF

FRAGILITY="$REPO_ROOT/docs/engineering/FRAGILITY_LOG.md"
if [ -f "$FRAGILITY" ]; then
  # List F-NN-headers
  grep -E "^## F-[0-9]+" "$FRAGILITY" | head -15
else
  echo "_(FRAGILITY_LOG.md mangler)_"
fi

cat <<EOF

---

## 5. Sist 10 commits til main

EOF

git log --oneline -10 origin/main 2>/dev/null | head -15

cat <<EOF

---

## 6. Sist PM-handoff

EOF

LATEST_HANDOFF=$(ls -t "$REPO_ROOT/docs/operations/PM_HANDOFF_"*.md 2>/dev/null | head -1)
if [ -n "$LATEST_HANDOFF" ]; then
  echo "**Fil:** \`$LATEST_HANDOFF\`"
  echo ""
  echo "**Første 40 linjer:**"
  echo '```markdown'
  head -40 "$LATEST_HANDOFF"
  echo '```'
else
  echo "_(ingen PM_HANDOFF-filer funnet)_"
fi

cat <<EOF

---

## 7. Åpne bugs (siste fra BUG_CATALOG)

EOF

BUG_CATALOG="$REPO_ROOT/tests/e2e/BUG_CATALOG.md"
if [ -f "$BUG_CATALOG" ]; then
  # Vis åpne (🔴 og 🟡) entries
  grep -E "^\| I[0-9]+" "$BUG_CATALOG" | grep -E "🔴|🟡" | tail -15
else
  echo "_(BUG_CATALOG.md mangler)_"
fi

cat <<EOF

---

## 8. Tobias-direktiv siste 24t (parsed fra commit-messages)

EOF

git log --since="24 hours ago" --grep="Tobias-direktiv" --format="%h %s" 2>/dev/null | head -10 || echo "_(ingen)_"

cat <<EOF

---

## 9. Knowledge-protocol-status

EOF

# Verify hvilke pilarer er oppdatert siste 24h
for f in PITFALLS_LOG.md FRAGILITY_LOG.md AGENT_EXECUTION_LOG.md; do
  full="$REPO_ROOT/docs/engineering/$f"
  if [ -f "$full" ]; then
    mtime=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$full" 2>/dev/null || echo "?")
    echo "- \`$f\` last modified: $mtime"
  fi
done

cat <<EOF

---

## 10. Anbefalt PM-action-rekkefølge

1. **Les denne brief-en helt** (du er allerede her)
2. **Sjekk monitor lever:** \`ps -p \$(cat /tmp/pilot-monitor.pid)\`
3. **Sjekk åpne PR-er:** prioriter pilot-relaterte (Spill 1/2/3/master/agent)
4. **Les siste PM_HANDOFF** for kontekst
5. **Sjekk åpne bugs i BUG_CATALOG** (🔴 først, så 🟡)
6. **Kjør \`bash scripts/generate-context-pack.sh\`** før du spawner agenter
7. **Spawn pilot-monitor hvis ikke aktiv:**
   \`\`\`bash
   bash scripts/pilot-monitor-enhanced.sh &
   echo \$! > /tmp/pilot-monitor.pid
   \`\`\`

---

**Generated by:** \`bash scripts/pm-handover-brief.sh\`
**Source:** Spillorama-system PM autonomy infrastructure
EOF
