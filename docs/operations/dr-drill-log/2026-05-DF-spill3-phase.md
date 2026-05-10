# Drill F — Spill 3 phase-state chaos-test

**Drill-ID:** DF
**Mandat-scenario:** Spill 3 phase-recovery (per [`R12_DR_VALIDATION_PLAN.md`](../R12_DR_VALIDATION_PLAN.md) §4 Drill F)
**Mandat-ref:** [`LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.3 R10
**Linear:** [BIN-820](https://linear.app/bingosystem/issue/BIN-820) (R10 child) + [BIN-816](https://linear.app/bingosystem/issue/BIN-816) (R12 parent) under [BIN-810](https://linear.app/bingosystem/issue/BIN-810)
**Status:** ⏳ Klar for kjøring (forberedt 2026-05-10) | ✅ Bestått | ❌ Feilet
**Eier:** L2 backend / Tobias
**Estimat:** ~2 timer (script-kjøring 3 scenarier à ~30 min) + ~30 min rapport-skriving
**Prep-rapport:** [R10_SPILL3_CHAOS_TEST_RESULT.md](../R10_SPILL3_CHAOS_TEST_RESULT.md) (engine-wireup levert 2026-05-08)
**Kjørt dato:** TBD (fyll inn ved kjøring)
**Fullført dato:** TBD

---

## Hvorfor denne drillen er pilot-blokkerende

Spill 3 (`monsterbingo`) er det eneste live-rommet med sequential phase-state-machine
(Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus). Hvis backend-instansen dør midt i en
fase-overgang og recovery ikke er korrekt, kan vi ende opp med:

- `currentPhaseIndex` rullet tilbake → spillere ser allerede-vunnet rad bli aktiv igjen
- Dobbelt utbetaling for samme fase → wallet-double-spend
- §71-ledger inkonsistent → regulatorisk brudd (Lotteritilsynet 24t-rapport-flow)
- Auto-start trigget 2 ganger → overlappende runder for samme rom

Engine-wireup ble levert 2026-05-08 (PR `feat/r10-spill3-engine-wireup`, commit
`8d755781`) med invariants-tester som passerer skeleton-modus, men full
ende-til-ende-validering mot Docker-stack avventer denne drillen.

Per mandat §6.1: hvis denne drillen avdekker strukturelle problemer, **skal pilot
pauses** inntil løst.

---

## Pre-requisites

### System-krav

- [ ] **Docker daemon kjørende** (`docker info` returnerer health)
- [ ] **Docker Compose v2** tilgjengelig (`docker compose version` eller `docker-compose --version`)
- [ ] **`jq`** installert (`brew install jq` om mangler)
- [ ] **`curl`** tilgjengelig (følger med macOS)
- [ ] **Node 22+** for invariants-test (`node --version`)
- [ ] **Minst 4 GB ledig RAM** for å kjøre 2 backend-instanser + Postgres + Redis samtidig
- [ ] **Repo-rot ren** — `git status` skal være clean på relevant-branch (untatt drill-log-fil i flight)
- [ ] **Ingen andre Docker-stacks** som binder porter `4000-4002` (kjør `lsof -i:4001 -i:4002` for sjekk)

### Forberedelse

- [ ] `ADMIN_PASSWORD`-env-var satt (default `Spillorama123!` om ikke spesifisert)
- [ ] Backend-image bygget — første kjøring tar ~5-10 min for `--build`
- [ ] `infra/chaos-tests/.env.chaos` blir auto-generert av `setup-chaos-env.sh` (idempotent, kalles
      av `r10-spill3-chaos-test.sh` §0.5)

### Sjekkliste pre-flight (kjør før hver drill)

```bash
# 1. Verifiser depends
docker info > /dev/null && echo "docker: OK" || echo "docker: NOT RUNNING"
which jq curl
node --version

# 2. Sjekk at ingen porter er bundet
lsof -i:4001 2>&1 | head -3 || echo "port 4001: free"
lsof -i:4002 2>&1 | head -3 || echo "port 4002: free"

# 3. Verifiser script-syntax
bash -n infra/chaos-tests/r10-spill3-chaos-test.sh && echo "syntax: OK"

# 4. Sjekk repo-state
cd /Users/tobiashaugen/Projects/Spillorama-system && git status
```

---

## Hva kjøres

`infra/chaos-tests/r10-spill3-chaos-test.sh` med 3 scenarier:

| Scenario | Hva skjer | Hvorfor |
|---|---|---|
| `pause-window` | Drep backend-1 mens phase-state er i pause-window mellom rader (default scenario) | Verifiserer at `pausedUntilMs` overlever instans-restart og at recovery-instans ikke dropper pausen |
| `row-2-mid` | Drep backend-1 midt i Rad 2-fase (etter draws 5-7) | Verifiserer at fase-state midt i evaluering ikke ruller tilbake til Rad 1 |
| `full-house` | Drep backend-1 rett før Fullt Hus-utbetaling | Verifiserer at engine ikke utbetaler 0 eller 2 ganger ved race mellom payout-commit og kill |

### Test-flyt per scenario (oppsummert fra script)

1. Bygg + start chaos-stack (`postgres` + `redis` + `backend-1` + `backend-2`)
2. Kjør migrations via throwaway-container
3. Seed pilot-data (4 demo-haller)
4. Admin-login mot backend-1 → fetch Spill 3 config
5. Vent på at monsterbingo-runde går RUNNING (timeout 60s)
6. **Snapshot pre-kill** — dump phase-state + ledger + pot fra Postgres
7. **SIGKILL backend-1** — `docker kill -s SIGKILL spillorama-backend-1`
8. Vent på at backend-2 svarer (timeout 30s)
9. **Snapshot post-recovery** — samme dump som pre-kill
10. Kjør `r10Spill3Invariants.test.ts` mot snapshots
11. Cleanup (down -v) — også ved fail

### Exit-koder

- `0` — alle invarianter PASSED
- `1` — én eller flere invarianter FAILED (strukturelt problem — pilot pauses per §6.1)
- `2` — testen kunne ikke kjøres (oppsett-feil, container-feil, osv.)

---

## Kommandoer

```bash
# Start fra repo-rot
cd /Users/tobiashaugen/Projects/Spillorama-system

# Scenario 1: pause-window (default)
ADMIN_PASSWORD='Spillorama123!' SCENARIO=pause-window \
  bash infra/chaos-tests/r10-spill3-chaos-test.sh 2>&1 | tee /tmp/drill-f-pause-window.log

# Scenario 2: row-2-mid
ADMIN_PASSWORD='Spillorama123!' SCENARIO=row-2-mid \
  bash infra/chaos-tests/r10-spill3-chaos-test.sh 2>&1 | tee /tmp/drill-f-row-2-mid.log

# Scenario 3: full-house
ADMIN_PASSWORD='Spillorama123!' SCENARIO=full-house \
  bash infra/chaos-tests/r10-spill3-chaos-test.sh 2>&1 | tee /tmp/drill-f-full-house.log
```

**Tip:** Hvis du vil feilsøke uten å rydde opp etter hver kjøring, sett
`docker-compose -f docker-compose.yml -f infra/chaos-tests/docker-compose.chaos.yml logs -f`
i en separat terminal. Trap-cleanup i scriptet kjører `down -v` ved exit, så data
forsvinner mellom kjøringer (det er bevisst — vi vil ha frisk DB hver gang).

---

## Invariants som verifiseres

Per [`apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts`](../../../apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts):

| ID | Invariant | Strukturelt? | Hva sjekkes |
|---|---|---|---|
| **I1** | `currentPhaseIndex` advancer aldri bakover | Ja | post.phaseIdx ≥ pre.phaseIdx |
| **I2** | `phasesWon` er append-only (superset etter recovery) | Ja | post.phasesWon ⊇ pre.phasesWon |
| **I3** | `prize_pool_remaining` minker monotont (ingen wallet-rollback) | Ja | post.prizePool ≤ pre.prizePool |
| **I4** | Compliance-ledger §71 append-only (count + sum øker) | Ja | post.ledgerCount ≥ pre.ledgerCount AND post.ledgerSum ≥ pre.ledgerSum |
| **I5** | `phasesWon.length ≤ 5` og `currentPhaseIndex ∈ [0, 4]` | Ja | Bounds-sjekk for state-machine-konsistens |
| **I6** | Pause-vindu-konsistens (`pausedUntilMs` krymper ikke vesentlig) | Nei (advisory) | post.pausedUntilMs ≥ pre.pausedUntilMs - 100ms slack |

### Hvis I1, I2, I3, I4 eller I5 brudd
→ **STRUKTURELT problem** → exit-code 1 → **pilot pauses per LIVE_ROOM_ROBUSTNESS_MANDATE §6.1**.
→ Eskalér umiddelbart til Tobias + L3 incident commander.

### Hvis I6 brudd
→ Ikke-strukturelt (klokke-skew mellom instanser akseptabelt) → warning logges, drill kan
markeres som PASS men action-item logges for oppfølging.

---

## Resultat (fyll inn ved kjøring)

### Scenario 1: pause-window

- [ ] Script exit-code: ___
- [ ] Recovery-tid: ___ sek
- [ ] **I1** (phase-index monoton): ___ (PASS / FAIL)
- [ ] **I2** (phasesWon append-only): ___ (PASS / FAIL)
- [ ] **I3** (prize-pool monoton): ___ (PASS / FAIL)
- [ ] **I4** (compliance-ledger append-only): ___ (PASS / FAIL)
- [ ] **I5** (state-bounds): ___ (PASS / FAIL)
- [ ] **I6** (pause-vindu): ___ (PASS / FAIL / WARN)
- [ ] Datatap: ___ (none / N drawn balls / N marks / N payouts)
- [ ] Sentry-events under drill: ___
- [ ] Pre-kill snapshot path: ___
- [ ] Post-recovery snapshot path: ___
- [ ] Notater: ___

### Scenario 2: row-2-mid

- [ ] Script exit-code: ___
- [ ] Recovery-tid: ___ sek
- [ ] **I1**: ___ / **I2**: ___ / **I3**: ___ / **I4**: ___ / **I5**: ___ / **I6**: ___
- [ ] Datatap: ___
- [ ] Sentry-events: ___
- [ ] Notater: ___

### Scenario 3: full-house

- [ ] Script exit-code: ___
- [ ] Recovery-tid: ___ sek
- [ ] **I1**: ___ / **I2**: ___ / **I3**: ___ / **I4**: ___ / **I5**: ___ / **I6**: ___
- [ ] Datatap: ___
- [ ] Sentry-events: ___
- [ ] Notater: ___

---

## Sign-off-kriterier

- [ ] Alle 3 scenarier exit-code 0
- [ ] Alle invariants I1-I5 PASS i alle 3 scenarier (I6 advisory — tillatt WARN)
- [ ] Recovery-tid < 5 min for alle scenarier (mandat-krav: ≤ 4 timer RTO, men live-rom < 2 min foreslått)
- [ ] 0 datatap (compliance-ledger pre/post matcher per I4)
- [ ] Ingen Sentry-events av P0/P1-severity under drill
- [ ] Drill-log fullstendig fylt ut (denne filen)

**L2 backend-signatur:** ___
**Dato kjørt:** ___
**Linear-comment postet til BIN-820:** ___ (link til kommentar)
**Linear-comment postet til BIN-816:** ___ (R12 parent — krysslenk drill F-status)

---

## Findings

(Fyll inn etter kjøring — gaps, action-items, oppfølging-issues. Hvis ingen avvik
observert, skriv "Ingen avvik observert.")

---

## Action-items

| # | Tiltak | Severity | Eier | Linear |
|---|---|---|---|---|
| 1 | ___ | ___ | ___ | ___ |

---

## Lærdommer

(Hva fungerte, hva gikk overraskende, hvilke prosedyrer manglet. Bidrar til
[`docs/engineering/PITFALLS_LOG.md`](../../engineering/PITFALLS_LOG.md) §4 hvis nye
fallgruver oppdages.)

---

## Vedlegg

- Full drill-script-stdout: `/tmp/drill-f-pause-window.log`, `/tmp/drill-f-row-2-mid.log`, `/tmp/drill-f-full-house.log`
- Pre-kill og post-recovery snapshots: i `/tmp/tmp.*` per script-kjøring (slettes ved cleanup; kopier ut hvis du vil arkivere)
- Eventuelle screenshots fra `docker ps`, `docker logs` eller Render-dashboard: ___
- Commit-SHA på `feat/r10-spill3-engine-wireup`-branch ved drill-kjøring: `8d755781` (verifisert 2026-05-08)

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial — drill-log-template forberedt for kjøring av L2 backend / Tobias | Drill-prep-agent (under PM-orkestrering) |
