#!/usr/bin/env bash
# PM-onboarding — komplett current-state for ny prosjektleder.
#
# Usage:
#   ./scripts/pm-onboarding.sh                # write to stdout
#   ./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
#
# Wrapper rundt agent-onboarding.sh + PM-spesifikke seksjoner: forrige handoff,
# pilot-gating-status, dev-stack-helse, åpne PR-er med CI-state, hot-reload-
# restart-kommandoer, og lese-først-prioritert leserekkefølge for ny PM.
#
# Idempotent: leser kun fra repo + git + (optional) gh + (optional) curl mot
# lokal stack. Krasjer aldri på manglende verktøy — degraderer graceful.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

NOW="$(date +'%Y-%m-%d %H:%M %Z')"

# ─── Helpers ──────────────────────────────────────────────────────────────────

emit_or_empty() {
  local content="$1"
  if [ -z "$content" ]; then
    printf '_(ingen)_\n'
  else
    printf '%s\n' "$content"
  fi
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# ─── Header ───────────────────────────────────────────────────────────────────

cat <<HEADER
# Spillorama PM-onboarding

**Generert:** $NOW
**Repo:** $REPO_ROOT
**Aktiv branch:** $(git branch --show-current 2>/dev/null || echo '(ikke i git-repo)')

> **Til ny PM:** Les denne filen FØR du gjør noe annet. Den gir live-status av
> repo, pilot-gating, dev-stack, åpne PR-er, og siste handoff. Du skal kunne
> overta uten ekstra spørsmål etter å ha lest dette + de doc-ene som er
> linket nederst.

---

HEADER

# ─── Forrige PM-handoff ───────────────────────────────────────────────────────

cat <<'SECTION'
## Forrige PM-handoff

> Siste handoff er state-of-the-art. Les ALT i den FØR du tar første
> kode-action. Tobias eier git-pull lokalt — du eier git-pull i hans
> hovedrepo etter hver merge.

SECTION

LATEST_HANDOFF="$(ls -t docs/operations/PM_HANDOFF_*.md 2>/dev/null | head -1)"
if [ -n "$LATEST_HANDOFF" ]; then
  echo "**Fil:** \`$LATEST_HANDOFF\`"
  echo
  echo "**Siste 30 linjer:**"
  echo
  echo '```'
  head -30 "$LATEST_HANDOFF"
  echo '```'
else
  echo "_(ingen PM_HANDOFF-filer funnet)_"
fi

echo

# ─── Pilot-gating-status (R1-R12) ─────────────────────────────────────────────

cat <<'SECTION'
## Pilot-gating-status (R1-R12, Live-rom-robusthet-mandat)

> Per [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md).
> Pilot kan ikke gå live hvis pilot-gating-tiltak (R1, R2, R3, R5, R7, R12)
> er røde. R4/R6/R8/R9/R10/R11 er post-pilot eller utvidelses-gating.

SECTION

R_TESTS=(
  "R1:Lobby-rom Game1Controller-wireup:1018"
  "R2:Failover-test (instans-restart):1032"
  "R3:Klient-reconnect-test:1037"
  "R4:Load-test 1000 klienter:817"
  "R5:Idempotent socket-events:1028"
  "R6:Outbox for room-events:818"
  "R7:Health-endpoint per rom:1027"
  "R8:Alerting (Slack/PagerDuty):1031"
  "R9:Spill 2 24t-leak-test:819"
  "R10:Spill 3 phase-state-machine chaos:820"
  "R11:Per-rom resource-isolation:821"
  "R12:DR-runbook for live-rom:1025"
)

for entry in "${R_TESTS[@]}"; do
  IFS=':' read -r r_id r_title r_pr <<< "$entry"
  echo "- **$r_id** — $r_title (PR/issue ref: #$r_pr)"
done

echo
echo "**Test-resultater i \`docs/operations/\`:**"
echo
ls -1 docs/operations/R*_TEST_RESULT*.md 2>/dev/null | sed 's/^/- /' || echo "_(ingen test-resultater funnet)_"

echo

# ─── Dev-stack-helse ──────────────────────────────────────────────────────────

cat <<'SECTION'
## Dev-stack-helse (live)

> Hvis backend ikke lytter på 4000 → kjør "Ren restart" fra siste PM-handoff.
> Tobias rør aldri lokal git eller dev-stack — du må fikse det.

SECTION

# Backend
BACKEND_HEALTH=""
if has_cmd curl; then
  BACKEND_HEALTH="$(curl -s -m 2 http://localhost:4000/health 2>/dev/null | head -c 200)"
fi
if [ -n "$BACKEND_HEALTH" ]; then
  echo "- ✅ Backend (4000): live"
  echo "  \`\`\`"
  echo "  $BACKEND_HEALTH"
  echo "  \`\`\`"
else
  # Try 4001
  BACKEND_HEALTH_4001="$(curl -s -m 2 http://localhost:4001/health 2>/dev/null | head -c 200)"
  if [ -n "$BACKEND_HEALTH_4001" ]; then
    echo "- ⚠️ Backend (4001 — fallback-port): live"
  else
    echo "- 🚫 Backend (4000/4001): ikke tilgjengelig — kjør \`npm run dev:all\`"
  fi
fi

# Admin-web
if has_cmd lsof && lsof -nP -iTCP:5174 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
  echo "- ✅ Admin-web (5174): live"
else
  echo "- 🚫 Admin-web (5174): ikke tilgjengelig"
fi

# Postgres
if has_cmd docker && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "postgres"; then
  echo "- ✅ Postgres (Docker): kjører"
else
  echo "- ⚠️ Postgres (Docker): ikke i docker ps — sjekk \`docker-compose up -d\`"
fi

# Redis
if has_cmd docker && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "redis"; then
  echo "- ✅ Redis (Docker): kjører"
else
  echo "- ⚠️ Redis (Docker): ikke i docker ps"
fi

echo

# ─── Spill-health-endpoints ───────────────────────────────────────────────────

cat <<'SECTION'
## Spill 1/2/3 health-endpoints

> R7-implementasjon. Skal returnere `{ok:true, data:{status, lastDrawAge, ...}}`
> med `Cache-Control: no-cache, max-age=0`. Aldri stale > 5s.

SECTION

if has_cmd curl; then
  for slug in spill1 spill2 spill3; do
    health_resp="$(curl -s -m 2 "http://localhost:4000/api/games/$slug/health?hallId=demo-hall-001" 2>/dev/null | head -c 300)"
    if [ -n "$health_resp" ]; then
      echo "- **$slug**: \`$health_resp\`"
    else
      echo "- **$slug**: _(ingen respons)_"
    fi
  done
else
  echo "_(curl ikke tilgjengelig — sjekk manuelt med \`curl -s http://localhost:4000/api/games/spill1/health?hallId=demo-hall-001\`)_"
fi

echo

# ─── Sist 10 commits til origin/main ──────────────────────────────────────────

cat <<'SECTION'
## Sist 10 commits til origin/main

SECTION

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  git log --oneline origin/main -10 2>/dev/null | sed 's/^/- /' || echo "_(git log feilet)_"
else
  echo "_(origin/main mangler)_"
fi

echo

# ─── Lokale uncommitted changes ───────────────────────────────────────────────

cat <<'SECTION'
## Lokale uncommitted endringer (pågående arbeid)

> Hvis Tobias har vært i siste sesjon, ligger sannsynligvis hans endringer
> her som uncommitted. Sjekk forrige PM-handoff for kontekst.

SECTION

UNCOMMITTED="$(git status --short 2>/dev/null | head -30)"
if [ -n "$UNCOMMITTED" ]; then
  echo "$UNCOMMITTED" | sed 's/^/    /'
  echo
  echo "**Diff-stat (top 20 filer):**"
  echo
  git diff --stat 2>/dev/null | head -20 | sed 's/^/    /'
else
  echo "_(ingen uncommitted endringer)_"
fi

echo

# ─── Åpne PR-er med CI-status ─────────────────────────────────────────────────

cat <<'SECTION'
## Åpne PR-er (top 15 — med CI-status)

> Per `feedback_pm_verify_ci`: auto-merge fyrer KUN ved ekte CI-grønning.
> Hvis ≥ 3 PR-er feiler samme måte → INFRA-bug → root-cause-fix først.

SECTION

if has_cmd gh; then
  pr_list="$(gh pr list --state open --limit 15 \
    --json number,title,headRefName,statusCheckRollup,isDraft \
    --jq '.[] | "- PR #\(.number) — \(.title)\n  branch: `\(.headRefName)`  draft: \(.isDraft)\n  CI: \(if .statusCheckRollup == [] then "no checks" else (.statusCheckRollup | map(.conclusion // .status // "unknown") | unique | join(", ")) end)"' \
    2>/dev/null)"
  emit_or_empty "$pr_list"
else
  echo "_(gh CLI ikke tilgjengelig)_"
fi

echo

# ─── Aktive worktrees ─────────────────────────────────────────────────────────

cat <<'SECTION'
## Aktive worktrees (parallelle agenter)

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

# ─── BACKLOG.md åpne saker ────────────────────────────────────────────────────

cat <<'SECTION'
## BACKLOG.md — åpne saker

SECTION

if [ -f BACKLOG.md ]; then
  awk '
    /^## [Åå]pne pilot-blokkere/ { in_section = 1; print "### " $0; next }
    /^## / && in_section { in_section = 0 }
    in_section && /^### / { print "- " substr($0, 5) }
    in_section && /^Status:/ { print "  " $0 }
  ' BACKLOG.md | head -40
else
  echo "_(BACKLOG.md ikke funnet)_"
fi

echo

# ─── Tobias-mønstre (kommunikasjons-stil) ─────────────────────────────────────

cat <<'SECTION'
## Tobias-kommunikasjons-mønstre (memorere dette)

> Direkte input fra forrige PM-handoff-historikk-research. Tobias er presis
> men leser ikke chat-essays. Match hans stil.

- **Direkte direktiver, ikke spørsmål:** "Vi må…" / "Du skal…" = DO IT NOW
- **Frustrasjons-signaler trigger PIVOT:** "unødvendig mye…" / "vi må få fremgang nå" → STOP iterasjon, foreslå alternativ
- **Tilliten gis etter solid leveranse:** "du har gjort en meget god jobb" — ikke chase compliments, fortsett bare
- **Quality > speed (2026-05-05):** Ingen deadline. All død kode skal fjernes.
- **Doc-en vinner over kode:** Hvis kode motsier kanonisk doc, koden må fikses.
- **Tobias rør ALDRI git lokalt:** PM eier git pull etter hver merge. Hot-reload tar resten.
- **Korte chat-svar:** Skriv ikke essays. Skriv konkret + handlings-orientert.

SECTION

# ─── Rolle + identitet i prod ─────────────────────────────────────────────────

cat <<'SECTION'
## Tobias' identitet (login-credentials)

| Rolle | E-post | Passord-hint | Hall |
|---|---|---|---|
| Admin | `tobias@nordicprofil.no` | Spillorama123! (deles direkte) | (ingen) |
| Master-agent | `tobias-arnes@spillorama.no` | Samme | demo-hall-001 / Teknobingo Årnes |
| Master-agent (demo) | `demo-agent-1@spillorama.no` | Samme | demo-hall-001 |

**Pilot-haller (4 stk, 4-hall-pilot per LIVE_ROOM_MANDATE §8.2):**
- Teknobingo Årnes (master): `b18b7928-3469-4b71-a34d-3f81a1b09a88`
- Bodø: `afebd2a2-52d7-4340-b5db-64453894cd8e`
- Brumunddal: `46dbd01a-4033-4d87-86ca-bf148d0359c1`
- Fauske: `ff631941-f807-4c39-8e41-83ca0b50d879`

SECTION

# ─── Hot-reload restart-kommando (ferdig kopierbar) ───────────────────────────

cat <<'SECTION'
## Hot-reload-restart (etter PR-merge — gi denne til Tobias)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && lsof -nP -iTCP:5174 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 && VITE_DEV_BACKEND_URL=http://localhost:4000 npm --prefix apps/admin-web run dev
```

> Tobias' admin-web blir startet etter at du har pullet main. Han bare
> refresher nettleseren etter at han ser meldingen "ready in X ms".

## Ren restart (ved stuck-state)

```bash
ps aux | grep -E "tsx watch.*src/index.ts|spillorama|dev:all|start-all\.mjs" | grep -v grep | awk '{print $2}' | xargs -r kill -9
docker exec spillorama-system-redis-1 redis-cli FLUSHALL
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
UPDATE app_game1_scheduled_games SET status='cancelled', actual_end_time=now()
WHERE status IN ('running','purchase_open','ready_to_start','paused');
UPDATE app_game_plan_run SET status='finished', finished_at=now()
WHERE status NOT IN ('finished','idle');"
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:all
```

SECTION

# ─── Lese-først-prioritert ────────────────────────────────────────────────────

cat <<'FOOTER'
## Lese-først (PM-onboarding-prioritet)

### Trinn 1 — fundament (10 min)
- [`MASTER_README.md`](../MASTER_README.md) — 5-min pitch
- [`docs/SYSTEM_DESIGN_PRINCIPLES.md`](../docs/SYSTEM_DESIGN_PRINCIPLES.md) — true north
- [`BACKLOG.md`](../BACKLOG.md) — strategisk pilot-status

### Trinn 2 — current state (15 min)
- Siste PM-handoff (se topp av denne filen)
- [`docs/operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md`](../docs/operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md)
- [`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)

### Trinn 3 — kanonisk regel-spec (20 min)
- [`docs/architecture/SPILL_REGLER_OG_PAYOUT.md`](../docs/architecture/SPILL_REGLER_OG_PAYOUT.md) — premie + multi-vinner
- [`docs/architecture/SPILLKATALOG.md`](../docs/architecture/SPILLKATALOG.md) — Spill 1-3 = MAIN_GAME, SpinnGo = DATABINGO

### Trinn 4 — Spill-fundament (avhengig av scope)
- [`docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`](../docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md)
- [`docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`](../docs/architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md)
- [`docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`](../docs/architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md)

### Trinn 5 — engineering-prosess (10 min)
- [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](../docs/engineering/PM_ONBOARDING_PLAYBOOK.md) — full PM-onboarding-rutine
- [`docs/engineering/ENGINEERING_WORKFLOW.md`](../docs/engineering/ENGINEERING_WORKFLOW.md) — PR-flyt + Done-policy
- [`docs/SESSION_HANDOFF_PROTOCOL.md`](../docs/SESSION_HANDOFF_PROTOCOL.md) — hvordan skrive handoff

## Linear

- https://linear.app/bingosystem — issues kategorisert som BIN-NNN
- BIN-810: Live-rom-robusthet-parent (R1-R12 children)
- Done-policy: lukket KUN etter merge til main + file:line + grønn test

## Render (prod)

- Dashboard: https://dashboard.render.com/
- Service: `srv-d7bvpel8nd3s73fi7r4g` (spillorama-system)
- Health: https://spillorama-system.onrender.com/health
- API-key i [PM_HANDOFF_2026-05-07.md](../docs/operations/PM_HANDOFF_2026-05-07.md) §"Operasjonell info"

## Git-flyt (PM-sentralisert)

- **Agenter**: commit + push branch — aldri opprett PR
- **PM (deg)**: `gh pr create` + `gh pr merge --squash --auto --delete-branch`
- Tobias rør aldri git lokalt — du må pull i hovedrepo etter merge

FOOTER
