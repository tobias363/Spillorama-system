#!/usr/bin/env bash
# generate-pm-dashboard.sh — auto-generer HTML-dashboard for systemhelse
#
# Tobias-direktiv 2026-05-13 (Tier 3-B): "Visual dashboard — Tobias ser
# systemhelse på én side, auto-refresh 30s."
#
# Bygger /tmp/pm-dashboard.html som auto-refresher hvert 30 sek. Inneholder:
#   - Aktive PR-er + CI-status (farge-kodet)
#   - Pilot-monitor-state (live)
#   - Backend-helse (curl /health)
#   - DB-state-snapshot
#   - Siste 5 round-end-rapporter
#   - FRAGILITY-katalog
#   - Nyeste anomalier
#
# Bruk:
#   bash scripts/generate-pm-dashboard.sh && open /tmp/pm-dashboard.html
#   # eller for kontinuerlig refresh:
#   watch -n 30 'bash scripts/generate-pm-dashboard.sh'

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
OUT="${OUT:-/tmp/pm-dashboard.html}"

# Hent data
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:4000/health 2>/dev/null || echo "DOWN")
MONITOR_PID=""
MONITOR_ALIVE="off"
if [ -f /tmp/pilot-monitor.pid ]; then
  MONITOR_PID=$(cat /tmp/pilot-monitor.pid 2>/dev/null)
  if [ -n "$MONITOR_PID" ] && ps -p "$MONITOR_PID" >/dev/null 2>&1; then
    MONITOR_ALIVE="on"
  fi
fi

# Hent PR-er
PR_LIST="[]"
if command -v gh >/dev/null 2>&1; then
  PR_LIST=$(gh pr list --state open --json number,title,headRefName,statusCheckRollup --limit 15 2>/dev/null || echo "[]")
fi

# Hent FRAGILITY-headers
FRAGILITY_HEADERS=$(grep -E "^## F-" "$REPO_ROOT/docs/engineering/FRAGILITY_LOG.md" 2>/dev/null | head -10 || echo "")

# Hent åpne bugs
OPEN_BUGS=$(grep -E "^\| I[0-9]+" "$REPO_ROOT/tests/e2e/BUG_CATALOG.md" 2>/dev/null | grep -E "🔴|🟡" | head -10 || echo "")

# Siste anomalier
LAST_ANOMALIES=""
[ -f /tmp/pilot-monitor.log ] && LAST_ANOMALIES=$(grep -E "\[P[0-3]\]" /tmp/pilot-monitor.log 2>/dev/null | tail -10 || echo "")

# Round-end-rapporter
ROUND_REPORTS=""
for f in $(ls -t /tmp/pilot-monitor-round-*.md 2>/dev/null | head -5); do
  basename=$(basename "$f")
  mtime=$(stat -f "%Sm" -t "%H:%M" "$f" 2>/dev/null || echo "?")
  ROUND_REPORTS="$ROUND_REPORTS<li><code>$basename</code> ($mtime)</li>"
done

# Sist 10 commits
LAST_COMMITS=$(git log --oneline -10 origin/main 2>/dev/null | head -10 | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')

# Generer HTML
cat > "$OUT" <<HTML
<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="30">
<title>Spillorama PM Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; background: #0f172a; color: #e2e8f0; }
  h1 { color: #f1f5f9; margin: 0 0 4px; font-size: 24px; }
  h2 { color: #fbbf24; margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; }
  .timestamp { color: #94a3b8; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
  .card { background: #1e293b; border-radius: 8px; padding: 16px; border: 1px solid #334155; }
  .status-ok { color: #34d399; }
  .status-warn { color: #fbbf24; }
  .status-err { color: #f87171; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .pill-ok { background: #065f46; color: #d1fae5; }
  .pill-warn { background: #78350f; color: #fef3c7; }
  .pill-err { background: #7f1d1d; color: #fee2e2; }
  .pill-pending { background: #1e3a8a; color: #dbeafe; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #94a3b8; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid #334155; }
  td { padding: 6px 8px; border-bottom: 1px solid #1e293b; }
  code { background: #0f172a; padding: 1px 4px; border-radius: 3px; font-size: 11px; color: #fbbf24; }
  pre { background: #0f172a; padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; color: #94a3b8; margin: 0; }
  ul { padding-left: 20px; margin: 4px 0; }
  li { margin: 2px 0; font-size: 13px; }
  .metric { font-size: 32px; font-weight: 700; line-height: 1; }
  .metric-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; }
  .row { display: flex; gap: 16px; align-items: center; }
  a { color: #60a5fa; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>🎯 Spillorama PM Dashboard</h1>
    <div class="timestamp">Auto-refresh 30s · Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")</div>
  </div>
  <div class="row">
    <div>
      <div class="metric-label">Backend</div>
HTML

if [ "$BACKEND_STATUS" = "200" ]; then
  echo "      <div class=\"metric status-ok\">●</div>" >> "$OUT"
else
  echo "      <div class=\"metric status-err\">●</div>" >> "$OUT"
fi

cat >> "$OUT" <<HTML
    </div>
    <div>
      <div class="metric-label">Monitor</div>
HTML

if [ "$MONITOR_ALIVE" = "on" ]; then
  echo "      <div class=\"metric status-ok\">●</div>" >> "$OUT"
else
  echo "      <div class=\"metric status-err\">●</div>" >> "$OUT"
fi

cat >> "$OUT" <<'HTML'
    </div>
  </div>
</div>

<div class="grid">

<div class="card">
  <h2>🔧 Live System</h2>
  <table>
    <tr><th>Komponent</th><th>Status</th></tr>
HTML

if [ "$BACKEND_STATUS" = "200" ]; then
  echo "    <tr><td>Backend (:4000)</td><td><span class=\"pill pill-ok\">HEALTHY</span></td></tr>" >> "$OUT"
else
  echo "    <tr><td>Backend (:4000)</td><td><span class=\"pill pill-err\">$BACKEND_STATUS</span></td></tr>" >> "$OUT"
fi

if [ "$MONITOR_ALIVE" = "on" ]; then
  echo "    <tr><td>Live Monitor</td><td><span class=\"pill pill-ok\">PID $MONITOR_PID</span></td></tr>" >> "$OUT"
else
  echo "    <tr><td>Live Monitor</td><td><span class=\"pill pill-err\">DOWN</span></td></tr>" >> "$OUT"
fi

cat >> "$OUT" <<HTML
  </table>
</div>

<div class="card">
  <h2>📦 Åpne PR-er</h2>
HTML

echo "$PR_LIST" | python3 -c "
import json, sys
prs = json.load(sys.stdin)
if not prs:
    print('  <p style=\"color:#64748b\">_(ingen åpne PR-er)_</p>')
else:
    print('  <table>')
    print('    <tr><th>#</th><th>Tittel</th><th>CI</th></tr>')
    for pr in prs[:10]:
        title = pr['title'][:50].replace('<','&lt;').replace('>','&gt;')
        checks = pr.get('statusCheckRollup', [])
        success = sum(1 for c in checks if c.get('conclusion') == 'SUCCESS' or c.get('state') == 'SUCCESS')
        failure = sum(1 for c in checks if c.get('conclusion') == 'FAILURE' or c.get('state') == 'FAILURE')
        pending = sum(1 for c in checks if c.get('status') in ('QUEUED', 'IN_PROGRESS'))
        if failure > 0:
            pill = 'pill-err'
            status = f'✗{failure}'
        elif pending > 0:
            pill = 'pill-pending'
            status = f'⋯{pending}'
        else:
            pill = 'pill-ok'
            status = f'✓{success}'
        print(f'    <tr><td><a href=\"https://github.com/tobias363/Spillorama-system/pull/{pr[\"number\"]}\">#{pr[\"number\"]}</a></td><td>{title}</td><td><span class=\"pill {pill}\">{status}</span></td></tr>')
    print('  </table>')
" 2>/dev/null >> "$OUT" || echo "  <p>_(ingen PR-data)_</p>" >> "$OUT"

cat >> "$OUT" <<HTML
</div>

<div class="card">
  <h2>⚠️ Åpne Bugs (BUG_CATALOG)</h2>
HTML

if [ -n "$OPEN_BUGS" ]; then
  echo "  <pre>" >> "$OUT"
  echo "$OPEN_BUGS" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' | head -10 >> "$OUT"
  echo "  </pre>" >> "$OUT"
else
  echo "  <p class=\"status-ok\">✓ Ingen åpne bugs</p>" >> "$OUT"
fi

cat >> "$OUT" <<HTML
</div>

<div class="card">
  <h2>🛡️ FRAGILITY-katalog</h2>
HTML

if [ -n "$FRAGILITY_HEADERS" ]; then
  echo "  <ul>" >> "$OUT"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    echo "    <li>$(echo "$line" | sed 's/^## //; s/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')</li>" >> "$OUT"
  done <<< "$FRAGILITY_HEADERS"
  echo "  </ul>" >> "$OUT"
fi

cat >> "$OUT" <<HTML
</div>

<div class="card">
  <h2>🚨 Siste anomalier (monitor)</h2>
HTML

if [ -n "$LAST_ANOMALIES" ]; then
  echo "  <pre>" >> "$OUT"
  echo "$LAST_ANOMALIES" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' >> "$OUT"
  echo "  </pre>" >> "$OUT"
else
  echo "  <p class=\"status-ok\">✓ Ingen anomalier</p>" >> "$OUT"
fi

cat >> "$OUT" <<HTML
</div>

<div class="card">
  <h2>🎮 Round-end-rapporter</h2>
  <ul>${ROUND_REPORTS:-<li>_(ingen rapporter enda)_</li>}</ul>
</div>

<div class="card" style="grid-column: 1 / -1;">
  <h2>📝 Sist 10 commits til main</h2>
  <pre>$LAST_COMMITS</pre>
</div>

</div>

<div style="margin-top: 24px; text-align: center; color: #64748b; font-size: 11px;">
  Refresh: <kbd>Ctrl+R</kbd> · Stay open for live updates · <a href="https://github.com/tobias363/Spillorama-system">GitHub</a>
</div>

</body>
</html>
HTML

echo "Dashboard generated: $OUT"
echo "Open with: open $OUT"
