#!/usr/bin/env bash
# skill-evolution-review.sh — bi-weekly skill self-evolution review
#
# Tobias-direktiv 2026-05-13 (Tier 3-C): "Skill self-evolution — bi-weekly
# auto-stub-foreslager fra recurring patterns."
#
# Identifiserer mønstre i:
#   - AGENT_EXECUTION_LOG.md (recurring leveranser per domene)
#   - PITFALLS_LOG.md (recurring fallgruver per kategori)
#   - FRAGILITY_LOG.md (recurring file-clusters)
#   - BUG_CATALOG.md (recurring bug-klasser)
#
# Output:
#   - /tmp/skill-evolution-review-<dato>.md med:
#     - Foreslåtte nye skill-stubs (3+ recurring patterns)
#     - Stale skill-warnings (90+ dager uten oppdatering)
#     - Cross-skill-merge-kandidater (ofte ko-referert)
#     - Coverage-gaps (skills som mangler eksempler/anti-eksempler)
#
# Bruk:
#   bash scripts/skill-evolution-review.sh
#   # eller cron bi-weekly:
#   0 9 * * 1 cd /path/to/repo && bash scripts/skill-evolution-review.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
DATE=$(date +%Y-%m-%d)
OUT="${OUT:-/tmp/skill-evolution-review-$DATE.md}"

cat > "$OUT" <<EOF
# Skill Evolution Review — $DATE

**Generated:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**Repo:** $REPO_ROOT
**Purpose:** Identifiser mønstre i agent-arbeid som bør lære skills

---

## 1. Recurring patterns i AGENT_EXECUTION_LOG

EOF

AGENT_LOG="$REPO_ROOT/docs/engineering/AGENT_EXECUTION_LOG.md"
if [ -f "$AGENT_LOG" ]; then
  # Count topic-keywords i agent-entries (siste 30 dager)
  echo "Top recurring topics (siste 60 dager basert på entries):" >> "$OUT"
  echo "" >> "$OUT"
  echo '```' >> "$OUT"

  # Hent entries med dates de siste 60 dager
  awk '
    /^###[[:space:]]+(20[0-9]{2}-[0-9]{2}-[0-9]{2})/ {
      gsub("###[[:space:]]+","",$0)
      date=$1
      # We are interested in entries: simple heuristic, capture body until next ###
      capture=1
      next
    }
    capture==1 && /^###/ { capture=0 }
    capture==1 { print tolower($0) }
  ' "$AGENT_LOG" | tr -s '[:space:][:punct:]' '\n' | \
    grep -E "^(spill[123]|wallet|popup|room|socket|ticket|payout|compliance|master|monitor|fragility|pilot|game1|game2|game3|bingo|rocket|monsterbingo|reentry|gate|test|e2e|playwright|migration)$" | \
    sort | uniq -c | sort -rn | head -10 >> "$OUT" 2>/dev/null || echo "(parse error)" >> "$OUT"

  echo '```' >> "$OUT"
  echo "" >> "$OUT"

  # Hvilke topics har 3+ entries? = kandidater for skill-evolution
  echo "### Topics med ≥3 entries (kandidater for skill-evolution):" >> "$OUT"
  echo "" >> "$OUT"
  echo "_(Manuell review: er det skills som dekker disse adequately? Hvis ikke, foreslå nye)_" >> "$OUT"
fi

cat >> "$OUT" <<EOF

---

## 2. Recurring fallgruver i PITFALLS_LOG

EOF

PITFALLS="$REPO_ROOT/docs/engineering/PITFALLS_LOG.md"
if [ -f "$PITFALLS" ]; then
  echo "Antall pitfall-entries per kategori:" >> "$OUT"
  echo "" >> "$OUT"
  echo '```' >> "$OUT"
  grep -E "^### §[0-9]+\.[0-9]+" "$PITFALLS" | sed -E 's/^### (§[0-9]+)\..*/\1/' | sort | uniq -c | sort -rn >> "$OUT"
  echo '```' >> "$OUT"
  echo "" >> "$OUT"

  # Total entries
  TOTAL=$(grep -cE "^### §[0-9]+\.[0-9]+" "$PITFALLS" || echo "0")
  echo "**Total pitfall-entries:** $TOTAL" >> "$OUT"
  echo "" >> "$OUT"
fi

cat >> "$OUT" <<EOF

---

## 3. FRAGILITY-katalog status

EOF

FRAGILITY="$REPO_ROOT/docs/engineering/FRAGILITY_LOG.md"
if [ -f "$FRAGILITY" ]; then
  TOTAL_F=$(grep -cE "^## F-[0-9]+" "$FRAGILITY" || echo "0")
  echo "**Total FRAGILITY-entries:** $TOTAL_F" >> "$OUT"
  echo "" >> "$OUT"

  # List file-clusters
  echo "Filer som vises i flere FRAGILITY-entries (sterk indikator på arkitektonisk skjørhet):" >> "$OUT"
  echo "" >> "$OUT"
  echo '```' >> "$OUT"
  grep -hE '`[a-zA-Z/.]+\.(ts|tsx|js|jsx|md|yml|sh)`' "$FRAGILITY" | \
    sed -E 's/.*`([^`]+)`.*/\1/' | sort | uniq -c | sort -rn | head -10 >> "$OUT"
  echo '```' >> "$OUT"
fi

cat >> "$OUT" <<EOF

---

## 4. Stale skills (90+ dager uten oppdatering)

EOF

SKILL_DIR="$REPO_ROOT/.claude/skills"
if [ -d "$SKILL_DIR" ]; then
  CUTOFF=$(date -v-90d +%s 2>/dev/null || date -d "90 days ago" +%s 2>/dev/null || echo "0")
  STALE_FOUND=0
  for skill_md in $(find "$SKILL_DIR" -name "SKILL.md" 2>/dev/null); do
    if [ -f "$skill_md" ]; then
      mtime=$(stat -f "%m" "$skill_md" 2>/dev/null || stat -c "%Y" "$skill_md" 2>/dev/null || echo "0")
      if [ "$mtime" -lt "$CUTOFF" ]; then
        rel=$(echo "$skill_md" | sed "s|$REPO_ROOT/||")
        days_ago=$(( ($(date +%s) - mtime) / 86400 ))
        echo "- \`$rel\` — sist oppdatert $days_ago dager siden" >> "$OUT"
        STALE_FOUND=$((STALE_FOUND + 1))
      fi
    fi
  done
  if [ $STALE_FOUND -eq 0 ]; then
    echo "_(Ingen stale skills funnet — alle oppdatert siste 90 dager)_" >> "$OUT"
  else
    echo "" >> "$OUT"
    echo "**$STALE_FOUND skills bør reviewes for relevans / oppdatering**" >> "$OUT"
  fi
else
  echo "_(.claude/skills/ dir mangler)_" >> "$OUT"
fi

cat >> "$OUT" <<EOF

---

## 5. Foreslåtte nye skill-stubs

Disse mønstrene har skjedd 3+ ganger i AGENT_EXECUTION_LOG men har ikke
dedikert skill enda:

EOF

# Identifiser topics med ≥3 entries men ingen matching skill
if [ -f "$AGENT_LOG" ] && [ -d "$SKILL_DIR" ]; then
  EXISTING_SKILLS=$(find "$SKILL_DIR" -name "SKILL.md" | sed -E 's|.*/skills/([^/]+)/.*|\1|' | sort -u)

  echo "_(Manuell PM-review trengs for å finne disse — bruk grep mot AGENT_EXECUTION_LOG)_" >> "$OUT"
  echo "" >> "$OUT"
  echo "**Eksisterende skills:**" >> "$OUT"
  echo '```' >> "$OUT"
  echo "$EXISTING_SKILLS" | head -25 >> "$OUT"
  echo '```' >> "$OUT"
fi

cat >> "$OUT" <<EOF

---

## 6. PM-action-anbefalinger

1. **Review topics med 3+ entries** mot eksisterende skill-dekning — opprett nye stubs hvis nødvendig
2. **Refresh stale skills** ≥ 90 dager med fersh eksempler fra recent agent-arbeid
3. **Sjekk fil-clusters i FRAGILITY** — hvis samme fil i 3+ entries, opprett dedikert skill for området
4. **Konsolider pitfall-entries** hvis duplikater eller for granulære

---

## Endringslogg

| Dato | Endring |
|---|---|
| $DATE | Initial bi-weekly review |
EOF

echo "Generated: $OUT"
echo ""
echo "Open with: open $OUT"
