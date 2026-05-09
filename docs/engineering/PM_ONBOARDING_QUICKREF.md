# PM Quick Reference — 1-side cheatsheet

**Bruk:** Når du står midt i sesjonen og må huske noe raskt. For full onboarding, se [PM_ONBOARDING_PLAYBOOK.md](./PM_ONBOARDING_PLAYBOOK.md).

---

## Generer current-state-rapport

```bash
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
```

## Standard restart-kommando (gi til Tobias etter merge)

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system && lsof -nP -iTCP:5174 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 && VITE_DEV_BACKEND_URL=http://localhost:4000 npm --prefix apps/admin-web run dev
```

**ALLTID med `cd /Users/...`** først — Tobias er ofte i `~`.

## Ren restart (ved stuck)

```bash
ps aux | grep -E "tsx watch.*src/index.ts|spillorama|dev:all" | grep -v grep | awk '{print $2}' | xargs -r kill -9
docker exec spillorama-system-redis-1 redis-cli FLUSHALL
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama -c "
UPDATE app_game1_scheduled_games SET status='cancelled', actual_end_time=now() WHERE status IN ('running','purchase_open','ready_to_start','paused');
UPDATE app_game_plan_run SET status='finished', finished_at=now() WHERE status NOT IN ('finished','idle');"
cd /Users/tobiashaugen/Projects/Spillorama-system && npm run dev:all
```

## PR-flyt

```bash
git checkout -b fix/scope-topic-$(date +%Y-%m-%d)
git add path/to/file.ts                              # ALDRI git add -A
git commit -m "fix(scope): kort beskrivelse"          # Conventional Commits
git push -u origin fix/scope-topic-$(date +%Y-%m-%d)
gh pr create --title "..." --body "..."
gh pr merge <nr> --squash --auto --delete-branch
gh pr checks <nr>                                    # verifiser CI 5-10 min etter
git checkout main && git pull --rebase --autostash   # post-merge
```

## Health-endpoint-sjekk

```bash
curl -s http://localhost:4000/health
for slug in spill1 spill2 spill3; do
  echo "=== $slug ==="
  curl -s "http://localhost:4000/api/games/$slug/health?hallId=demo-hall-001" | head -c 300
done
```

## Login (alle bruker `Spillorama123!`)

| Rolle | E-post |
|---|---|
| Admin | `tobias@nordicprofil.no` |
| Master-agent | `demo-agent-1@spillorama.no` |
| Spiller | `demo-pilot-spiller-1@example.com` |

## Spill-katalog (kanonisk)

| Markedsføring | Slug | §11 | Cap |
|---|---|---|---|
| Spill 1 | `bingo` | 15% MAIN_GAME | ingen |
| Spill 2 | `rocket` | 15% MAIN_GAME | ingen |
| Spill 3 | `monsterbingo` | 15% MAIN_GAME | ingen |
| **Spill 4 / SpinnGo** | `spillorama` | **30% DATABINGO** | **2500 kr** |
| Candy | `candy` | (ekstern) | (ekstern) |

**Game 4 / `themebingo` er DEPRECATED.**

## Forskjell Spill 1 / Spill 2 / Spill 3

| | Spill 1 | Spill 2 | Spill 3 |
|---|---|---|---|
| Grid | 5×5 m/fri | 3×3 full | 5×5 uten fri |
| Baller | 1-75 | 1-21 | 1-75 |
| Rom | Per-hall + GoH-master | ETT globalt (ROCKET) | ETT globalt (MONSTERBINGO) |
| Master | ✅ Ja | ❌ Ingen | ❌ Ingen |
| Auto-restart | ❌ | ✅ minTickets | ✅ Sequential phases |

## Auto-multiplikator (alle hovedspill untatt Trafikklys)

```
actualPrize = base × (ticketPriceCents / 500)
```

| Bong | Pris | Multiplikator |
|---|---|---|
| Hvit | 5 kr | × 1 |
| Gul | 10 kr | × 2 |
| Lilla | 15 kr | × 3 |

Trafikklys: flat 15 kr alle bonger, premier per RAD-FARGE (ikke bongfarge).

Oddsen: low/high split på Fullt Hus basert på `targetDraw`. Rad 1-4 følger auto-mult.

## Multi-vinner-regel (SPILL_REGLER §9)

**Pot per bongstørrelse**, ikke flat-deling.
- Hvit-pot deles likt mellom hvit-vinnere
- Gul-pot deles likt mellom gul-vinnere
- Lilla-pot deles likt mellom lilla-vinnere
- Hvis ingen vinnere i en bongstørrelse: pot utbetales ikke

## Compliance ALDRI-regler

1. ❌ Hardkode `gameType: "DATABINGO"` for Spill 1-3 → bruk `ledgerGameTypeForSlug(slug)`
2. ❌ Apply 2500 kr cap på Spill 1-3 → kun for `gameType === "DATABINGO"`
3. ❌ Bind ledger til `master_hall_id` → bruk `actor_hall_id` (kjøpe-hall)
4. ❌ `UPDATE`/`DELETE` audit-trail → append korrigerings-rad
5. ❌ Direct INSERT i `app_wallet*` → bruk `WalletAdapter`-interface

## Pilot-status (R-tiltak)

✅ Grønt for pilot:
- R2 (failover), R3 (reconnect), R5 (idempotency), R7 (health), R8 (alerting), R12 (DR-runbook)

⚠️ Utvidelses-blokkere (post-pilot):
- R4 (load 1000), R6 (outbox-rom), R9 (Spill 2 24t-leak), R10 (Spill 3 chaos), R11 (per-rom isolation)

## Tobias-mønstre

| Han sier | Du gjør |
|---|---|
| "Vi må…" / "Du skal…" | DO IT NOW |
| "unødvendig mye…" | Foreslå konkret refaktor + estimat |
| "vi må få fremgang nå" | STOP iterasjon, foreslå pivot |
| "kjør på" | GO — ingen flere spørsmål |
| "du har gjort en meget god jobb" | Fortsett kursen, ikke chase compliments |

**Aldri skriv:** lange chat-essays, "vi jobber med det", spørsmål han allerede svarte på.

## Linear

- https://linear.app/bingosystem
- BIN-810: Live-rom-robusthet parent (R1-R12)
- Done-policy: lukkes KUN etter merge til main + file:line + grønn test

## Render

- Dashboard: https://dashboard.render.com/
- Service: `srv-d7bvpel8nd3s73fi7r4g`
- Health: https://spillorama-system.onrender.com/health
- API-key: se [PM_HANDOFF_2026-05-07.md](../operations/PM_HANDOFF_2026-05-07.md)

## Pilot-haller (4 stk, første runde)

| Hall | UUID | Rolle |
|---|---|---|
| Teknobingo Årnes | `b18b7928-3469-4b71-a34d-3f81a1b09a88` | Master |
| Bodø | `afebd2a2-52d7-4340-b5db-64453894cd8e` | Deltaker |
| Brumunddal | `46dbd01a-4033-4d87-86ca-bf148d0359c1` | Deltaker |
| Fauske | `ff631941-f807-4c39-8e41-83ca0b50d879` | Deltaker |

## Hva PM eier vs Tobias eier

| PM eier | Tobias eier |
|---|---|
| Git lokalt (pull, push, merge) | Pilot go/no-go-beslutning |
| PR + auto-merge | Lotteritilsynet-godkjennelser |
| Agent-orkestrering | Hardware (terminaler, TV) |
| BACKLOG-oppdatering | Hall-eier-kontrakter |
| ADR-skriving | Strategisk scope |

---

**Full playbook:** [PM_ONBOARDING_PLAYBOOK.md](./PM_ONBOARDING_PLAYBOOK.md)
**Live current-state:** `./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md`
