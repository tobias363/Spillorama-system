# Spill 1 Pilot — DEFINITIV verifikasjon — 2026-05-09 (kveld)

**Status:** 🔴 **NO-GO**
**Test-eier:** Test-engineer-agent (Claude Opus 4.7)
**Branch:** `test/spill1-pilot-final-verification-2026-05-09`
**Test-dato:** 2026-05-09 18:25-19:00 lokal Oslo-tid
**Test-metode:** End-to-end mot Tobias' lokale dev-stack på `localhost:4000` (backend) + `5174` (admin)
**Backend-state ved test-start:** main branch ved commit `04b00ce5`

---

## TL;DR — pilot-go/no-go

🔴 **NO-GO**. Vi kan IKKE pilot-launche i dag eller i morgen.

**Hvorfor:**
- 4 av 4 kritiske ventende PR-er er **ikke merget** (PR #1109, #1114, #1116, #1118)
- E2E mot main avdekket en **NY P0 pilot-blokker** ikke flagget tidligere: `pause_reason` kolonne mangler i DB-skjema
- F4 timezone-bug fortsetter å forgifte pre-validation slik at master ikke kan utføre noen handlinger så lenge en plan-run finnes
- Self-healing-stack er bare delvis (recover-stale virker for scheduled-games men ikke for stale plan-runs)

**Estimat til GO:**
- 4 pending PR-er må merges (CI er BLOCKED av lock-down-tester som forventer kjente bugs — krever oppdatering av testene parallelt med fixene)
- 1 ny P0 fix kreves: lag migration som legger til `pause_reason` kolonne på `app_game1_scheduled_games`
- Etter alle merges + ny fix: ny E2E-runde for å verifisere

---

## 8 scenario-resultater

| # | Scenario | Status | Severity | Notater |
|---|---|---|---|---|
| 1 | Cold-start + master start (uten warnings) | 🟡 PARTIAL | P0 | Master/start fungerer fra cleansed DB. Men blocker etter første runde pga F4. |
| 2 | Master start MED jackpot-popup (F-NEW-1) | 🔴 BLOCKED | P0 | Kunne ikke teste jackpotConfirmed-flow pga PR #1118 ikke merget. Source viser fix er der. |
| 3 | Komplett spill-runde (ticket → draw → vinst → payout) | 🔴 IKKE TESTET | P0 | Blokkeres av Scenario 1/2-funn. Master kan ikke pålitelig starte runde. |
| 4 | STALE_PLAN_RUN auto-cleanup | 🔴 FAIL | P0 | recover-stale ryddet IKKE plan-runs (kun scheduled-games). Plan-runs forblir blokkere selv etter recover. |
| 5 | BRIDGE_FAILED retry-rollback (F-NEW-2 + bridge-retry) | 🔴 IKKE TESTET | P0 | PR #1116 ikke merget. Eksisterende oppførsel: ingen retry, ingen rollback. |
| 6 | UI recovery-knapp | 🟡 PARTIAL | P0 | Endpoint fungerer (PR #1113 merget), men feiler logisk pga §4. Plan-runs blir liggende. |
| 7 | Multi-hall ready-flow | 🔴 IKKE TESTET | P1 | Blokker først på master/start-flyten. |
| 8 | dev:all auto-cleanup | 🔴 IKKE TESTET | P1 | Krever drep+restart av dev-stack — ikke lov å påvirke Tobias' lokale dev. |

---

## Funn — sortert P0 → P3

### 🔴 F-NEW-3 (P0): `pause_reason` kolonne mangler i DB-skjema

**Status:** NY pilot-blokker, ikke flagget i forrige E2E.

**Beskrivelse:**
`GameLobbyAggregator` SELECTer `pause_reason` fra `app_game1_scheduled_games` på 2 steder (`apps/backend/src/game/GameLobbyAggregator.ts:586,611`), men kolonnen finnes ikke i DB-skjemaet. Verifisering:

```sql
spillorama=> SELECT pause_reason FROM app_game1_scheduled_games LIMIT 1;
ERROR:  column "pause_reason" does not exist
```

Det finnes ingen migration som legger til kolonnen. Søk:
```bash
grep -rn "pause_reason" apps/backend/migrations/   # → 0 hits
grep -rn "pause_reason" apps/backend/src/          # → 4 hits, alle i GameLobbyAggregator
```

**Konsekvens:**
- Aggregator-query feiler med `42703` (column does not exist)
- Catch-blokken fanger feilen og returnerer null fra `queryScheduledGameByPlanRun` + `queryActiveScheduledGameForHall`
- Aggregator tror "ingen scheduled-game funnet for plan-run" → flagger `BRIDGE_FAILED` warning
- Master kan ikke starte/pause/resume/stop fordi pre-validate avviser ved blocking-warning

**E2E-bevis:**
```
=== Master pause (etter vellykket master/start) ===
{
    "ok": false,
    "error": {
        "code": "LOBBY_INCONSISTENT",
        "message": "Lobby-state har blocking-warnings (BRIDGE_FAILED) — manuell reconciliation kreves",
        "details": {
            "blockingWarnings": ["BRIDGE_FAILED"],
            "allWarnings": [
                {
                    "code": "BRIDGE_FAILED",
                    "message": "Plan-run er i 'running' men ingen scheduled-game ble opprettet."
                }
            ]
        }
    }
}
```

**Foreslått fix:**
1. Lag migration `apps/backend/migrations/<dato>_app_game1_scheduled_games_pause_reason.sql`:
   ```sql
   ALTER TABLE app_game1_scheduled_games ADD COLUMN pause_reason TEXT;
   ```
2. Eller fjern `pause_reason` fra aggregator-query og sett `pauseReason: null` direkte (fjern fra schema også)
3. Tobias bør vurdere: brukes `pause_reason` faktisk fra UI? Hvis ikke → fjern fra schema. Hvis ja → migration kreves.

**Prio:** P0 — pilot-blokker. Lobby-endpoint feiler 100% når aktiv runde finnes.

---

### 🔴 F4 (P0): Timezone-bug i `dateRowToString` (KJENT, fix venter)

**Status:** KJENT bug. Fix eksisterer i PR #1109 men ikke merget. PR har merge-konflikt + CI-failures.

**Beskrivelse:**
`dateRowToString()` i `GamePlanRunService.ts:191-204` bruker `getUTCDate()` på en JS Date som node-postgres returnerer for DATE-kolonner. Postgres-driveren konverterer `2026-05-09` til JS Date `2026-05-08T22:00:00Z` (Oslo midnatt = UTC -2:00). `getUTCDate()` returnerer `8`, ikke `9`.

**E2E-bevis:**
```sql
spillorama=> SELECT business_date::text FROM app_game_plan_run;
business_date 
2026-05-09
```

Men API-respons sier:
```json
"detail": {
    "planRunBusinessDate": "2026-05-08",   <- FEIL, skal være "2026-05-09"
    "todayBusinessDate": "2026-05-09",
    "planRunStatus": "running"
}
```

**Konsekvens:**
Aggregator sammenligner `"2026-05-08" < "2026-05-09"` → flagger `STALE_PLAN_RUN` for en helt fersk plan-run opprettet i samme sesjon. Master-actions blokkeres umiddelbart etter første start-call.

**Foreslått fix (allerede i PR #1109):**
```typescript
// Bruk formatOsloDateKey istedet
return formatOsloDateKey(value);
```

**Prio:** P0 — sammen med F-NEW-3 gjør dette master-flow umulig etter første runde.

---

### 🔴 F-Plan-Reuse (P0): `getOrCreateForToday` returnerer finished plan-runs

**Status:** KJENT, dokumentert i `apps/backend/src/__tests__/e2e/spill1PilotBlockers.test.ts:342`. Ingen pending fix.

**Beskrivelse:**
`getOrCreateForToday(hallId, dateStr)` kaller `findForDay(hall, dateStr)` og returnerer eksisterende plan-run uavhengig av `status`. Hvis dagens plan-run er `finished` (etter ulykke, manuell SQL-cleanup, eller normal fullføring), kaster master/start `PLAN_RUN_FINISHED` og master kan ikke starte ny runde.

**E2E-bevis:**
1. Set plan-run til `finished` via SQL
2. Kall master/start med jackpotConfirmed=true
3. Respons: `{"code": "PLAN_RUN_FINISHED", "message": "Plan-run er allerede ferdig for i dag."}`

**Foreslått fix:**
- `getOrCreateForToday` skal skippe `status='finished'` rader og lage ny INSERT
- Krever endring av UNIQUE constraint på `(hall_id, business_date)` (kanskje `(hall_id, business_date) WHERE status != 'finished'`)
- Eller forenkle: tillat re-INSERT med ny UUID når den eksisterende er finished

**Prio:** P0 — blokker for "andre runde samme dag" recovery (eks. om master ved ulykke trykker stop og må starte ny).

---

### 🔴 F-NEW-1 + F-NEW-2 (P0): KJENT, fix venter (PR #1118)

**Status:** Source-koden i PR #1118 er korrekt. PR ikke merget pga lock-down-test-failures.

**Beskrivelse:**
- F-NEW-1: master/start tar nå `jackpotConfirmed`-param og propagerer til engine
- F-NEW-2: engine-bridge genererer `room_code` opp-front så scheduled-game er bundet til BingoEngine-rom

**Verifisering ved E2E mot main (uten PR #1118):**
- Master/start fungerer for `bingo`-katalog (ikke trenger jackpotConfirmed)
- Source for jackpot-required spill antyder at parameteret IKKE blir lest i agentGame1Master.ts på main

**Prio:** P0 — kreves for jackpot-spill (Innsatsen, Jackpot, etc.)

---

### 🟡 F-Recovery-Incomplete (P1): UI recovery rydder ikke plan-runs

**Status:** Funn fra E2E. Ikke i tidligere rapport.

**Beskrivelse:**
`StalePlanRunRecoveryService.execute()` filtrerer på `business_date < CURRENT_DATE` for plan-runs. Men hvis plan-run har `business_date = today` (i DB), men aggregator tror den er fra i går (pga F4), så:
- Aggregator flagger `STALE_PLAN_RUN`
- UI viser recovery-knapp
- Bruker trykker recover
- Recovery finner 0 plan-runs (filteret matcher ikke) → returnerer `{planRuns: 0}`
- STALE_PLAN_RUN-warning står fortsatt

**E2E-bevis:**
```bash
$ curl -X POST .../master/recover-stale
{"ok":true,"data":{"cleared":{"planRuns":0,"scheduledGames":1}}}

# Etterpå er warnings fortsatt der:
$ curl .../master/start
{"code":"LOBBY_INCONSISTENT","details":{"blockingWarnings":["BRIDGE_FAILED"]}}
```

**Foreslått fix:**
- Recovery bør se på samme dato-konvertering som aggregator gjør (samme F4-bug)
- Eller fix F4 på alle steder samtidig
- Eller: recovery for `STALE_PLAN_RUN` baseres på status+age (eks. plan-run > 6 timer i `running` uten progresjon → recover)

**Prio:** P1 — kun manifestert pga F4-bug. Hvis F4 fikses, blir denne også løst.

---

### 🟡 F-Stale-SharedTypes (P2): Tobias' dev-stack har stale shared-types-bundle

**Status:** Lokal dev-issue, ikke prod. Ikke pilot-blokker.

**Beskrivelse:**
`packages/shared-types/dist/spill1-lobby-state.js` på Tobias' lokal hadde fortsatt `z.string().uuid()` (gammel pre-F17-versjon) selv om source-filen har `z.string().min(1)`. Dist-bundle ble bygget May 9 16:51 (før PR #1101 merge).

Backend leser fra dist-bundle, så schema-validering feilet selv etter PR #1101 ble merget.

**Foreslått fix:**
- Dev:all-script (PR #1106 ikke merget) bygger shared-types før backend starter
- Eller: package.json `prebuild` script på backend som triggerer shared-types-build

**Prio:** P2 — affekterer kun dev-flyt, ikke prod. Tobias bør kjøre `npm --prefix packages/shared-types run build` etter PR-merger.

---

### 🟡 F-CI-Selfblock (P1): Lock-down-tester blokkerer fixene som FIKSER bugs

**Status:** Strukturell prosess-bug. Påvirker alle 4 ventende kritiske PR-er.

**Beskrivelse:**
Forrige E2E-runder skrev tester som forventer å feile inntil bug fikses (eks `apps/backend/src/__tests__/e2e/spill1PilotBlockers.test.ts:342`). Disse testene blokkerer CI for ALLE pending fix-PR-er, inkludert dem som faktisk fikser bugs:

```
not ok 169 - Spill1 E2E lock-down — findings from 2026-05-09 verification
not ok 221 - E2E 4-hall master flow — pilot blokker-validering
```

PR #1118 (som fikser F-NEW-1/F-NEW-2) endrer KUN 5 service-filer, ingen tester. CI rødt → PR blocked → fix kan ikke merges.

**Påvirkede PR-er:**
- PR #1109 (F4 + F7): backend FAILURE + DIRTY merge-state
- PR #1114 (auto-cleanup-cron): backend + compliance + e2e FAILURE
- PR #1116 (bridge retry+rollback): backend FAILURE
- PR #1118 (F-NEW-1 + F-NEW-2): backend + e2e FAILURE

**Foreslått fix:**
- Hver fix-PR må også oppdatere tilhørende lock-down-tester (flippe assertion fra "expects fail" til "expects pass")
- Eller: lock-down-tester bør bruke `it.todo()` istedenfor `it()` så de ikke blokkerer CI
- Eller: PM må manuelt re-runne lock-down-test-suite etter merge for å bekrefte at den passerer

**Prio:** P1 — selv-blokkerende prosess. Pilot er blokkert til prosessen er løst.

---

## Konkret pilot-go-checklist (estimat)

### Steg 1: Fix CI-blokk og merge ventende PR-er

1. PR #1118 — oppdater `MasterActionService.test.ts` for å forvente at jackpotConfirmed propageres + lockdown-tests
2. PR #1109 — løs merge-konflikt + oppdater lockdown-tests
3. PR #1114 — fix backend/compliance/e2e failures + merge
4. PR #1116 — fix backend failure + merge

### Steg 2: Lag NY P0-fix for F-NEW-3

5. Migration: `ALTER TABLE app_game1_scheduled_games ADD COLUMN pause_reason TEXT;`
6. Eller fjern `pause_reason` fra aggregator hvis ikke brukt fra UI

### Steg 3: Fix F-Plan-Reuse

7. Endre `getOrCreateForToday` til å skippe `status='finished'` rader
8. Eller spesifiser at master må kalle eksplisitt "create-fresh" hvis dagens er finished

### Steg 4: Re-test E2E

9. Kjør samme 8 scenarier på nytt
10. Hvis alle 8 PASS → 🟢 GO

**Realistisk ETA:** 1-2 dager med fokusert arbeid hvis alle PR-er får merget. CI-selvblokk er hovedrisikoen.

---

## Test-detaljer

### Test-miljø

- Backend: tsx watch på localhost:4000 (PID 42264)
- Admin-web: Vite dev på localhost:5174 (PID 87657)
- Postgres: Docker spillorama-system-postgres-1 (port 5432, healthy)
- Redis: Docker spillorama-system-redis-1 (port 6379, healthy)
- DB: 27 haller, 70 wallets, 5 games, 2 active rooms

### Test-credentials brukt

- Master agent: `demo-agent-1@spillorama.no` / `Spillorama123!`
  - userId: `demo-agent-1`, hallId: `demo-hall-001` (master)
  - assigned hallId-er: 001 (primary), 002, 003, 004
  - role: AGENT, kycStatus: VERIFIED

### Endpoints testet

| Endpoint | Method | Resultat |
|---|---|---|
| /api/agent/auth/login | POST | ✅ 200 OK |
| /api/agent/game1/lobby | GET | 🔴 500 INTERNAL_ERROR (når aktiv runde) |
| /api/agent/game1/current-game | GET | ✅ 200 OK (legacy) |
| /api/agent/game1/master/start | POST | 🟡 PARTIAL (fungerer fra clean state, blocker etter første runde) |
| /api/agent/game1/master/pause | POST | 🔴 LOBBY_INCONSISTENT |
| /api/agent/game1/master/resume | POST | 🔴 LOBBY_INCONSISTENT |
| /api/agent/game1/master/recover-stale | POST | 🟡 200 OK men rydder ikke plan-runs |

### Reproduksjonssteg for kjernefunnene

**For F-NEW-3 (`pause_reason` mangler):**
```bash
# 1. Start fra fersk state
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama \
  -c "DELETE FROM app_game_plan_run; UPDATE app_game1_scheduled_games SET status = 'cancelled' WHERE status NOT IN ('completed', 'cancelled')"

# 2. Login som master
TOKEN=$(curl -s -X POST http://localhost:4000/api/agent/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo-agent-1@spillorama.no","password":"Spillorama123!"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["accessToken"])')

# 3. Start ny runde
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jackpotConfirmed":true}' http://localhost:4000/api/agent/game1/master/start

# 4. Hent lobby — feiler med 500
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/agent/game1/lobby

# 5. Verifiser i DB
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama \
  -c "SELECT pause_reason FROM app_game1_scheduled_games LIMIT 1"
# → ERROR: column "pause_reason" does not exist
```

**For F4 timezone-bug:**
```bash
# Etter master/start, sjekk warnings:
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' http://localhost:4000/api/agent/game1/master/pause | python3 -m json.tool

# Output: planRunBusinessDate "2026-05-08", todayBusinessDate "2026-05-09"
# Faktisk DB:
PGPASSWORD=spillorama psql -h localhost -U spillorama -d spillorama \
  -c "SELECT business_date::text FROM app_game_plan_run"
# → 2026-05-09 (riktig)
```

---

## Konklusjon

**Pilot er IKKE klar i dag.**

Vi har:
- 5 dokumenterte P0-bugs (4 kjente med pending PR-er, 1 ny)
- 1 P1 (CI-selvblokk-prosess)
- Alle 4 kritiske PR-er fortsatt OPEN/BLOCKED

For å nå GO trengs:
1. CI-prosess må løses så fix-PR-er kan merge (oppdater lockdown-tests sammen med fixene)
2. Ny P0 (`pause_reason`) må fixes
3. Re-E2E etter alle merger

**Tobias' beste neste steg:**
1. Krev at PR #1118 oppdateres til å også flippe lockdown-test-assertions
2. Fix `pause_reason`-kolonne (kort migration)
3. Re-kjør denne E2E-testen
4. GO/NO-GO-vurdering på nytt

---

## Vedlegg: tester skrevet

Følgende automatiserte tester er lagt til i `apps/backend/src/__tests__/e2e/spill1PilotFinalVerification.test.ts`:

1. `pause_reason column must exist on app_game1_scheduled_games` — fanger F-NEW-3
2. `recover-stale must clean stale plan-runs (not just scheduled-games)` — fanger F-Recovery-Incomplete
3. `getOrCreateForToday must NOT return finished runs (allow new attempt)` — fanger F-Plan-Reuse

Disse er strukturert som lockdown-tester slik at fix-PR-er må flippe assertion fra "expects bug" til "expects fix". Tobias bør verifisere at fix-PR-er gjør dette parallelt for å unngå CI-selvblokken.
