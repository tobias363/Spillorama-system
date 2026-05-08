# R3 Klient-reconnect-test — resultat-rapport

**Linear:** [BIN-812](https://linear.app/bingosystem/issue/BIN-812)
**Mandat:** [docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)
**Test-skript:** [`infra/chaos-tests/r3-reconnect-test.sh`](../../infra/chaos-tests/r3-reconnect-test.sh)
**Mock-klient:** [`infra/chaos-tests/r3-mock-client.mjs`](../../infra/chaos-tests/r3-mock-client.mjs)
**Invariants:** [`apps/backend/src/__tests__/chaos/r3ReconnectInvariants.test.ts`](../../apps/backend/src/__tests__/chaos/r3ReconnectInvariants.test.ts)

---

## 1. Sammendrag

Pilot-gating-test som verifiserer at hvis klient mister socket-tilkoblingen i
5/15/60 sek, kan den reconnecte og fortsette runden uten tap av marks
eller blokkeres av stale-binding-feil.

R3 hviler på tre lag som allerede er bygget:
- **R5 idempotent socket-events** (BIN-813) — `clientRequestId` per
  `ticket:mark` slik at replay-emit etter reconnect ikke trigger duplikate
  marks.
- **`room:resume` socket-handler** — re-attacher socket-id-en til player-
  rad-en uten å forstyrre wallet/marks-state.
- **`cleanupStaleWalletInIdleRooms`** — fjerner orphan walletId-bindinger
  i andre rom så player kan reconnecte uten "PLAYER_ALREADY_IN_RUNNING_GAME".

R3-testen gjør et faktisk end-to-end-løp (mock-klient ↔ ekte backend ↔
ekte Postgres + Redis) så vi vet at de tre lagene faktisk arbeider sammen.

**Status pr. levering:** test-infrastruktur **bygget og klar for kjøring**.
Faktisk test-kjøring må utføres av PM/Tobias før pilot-go-live-møte
(per mandat §6.1: "R2/R3 må kjøres FØR pilot-go-live-møte — ikke etter").

---

## 2. Pre-conditions

| Komponent | Verdi |
|---|---|
| Versjon | branch `test/r3-reconnect-test` (base: `main`) |
| Backend-runtime | Node.js 22 + Express 4.21 + Socket.IO 4.8 |
| Postgres | 16-alpine (delt med backend) |
| Redis | 7-alpine (`ROOM_STATE_PROVIDER=redis`, `SCHEDULER_LOCK_PROVIDER=redis`) |
| Socket-klient | `socket.io-client` 4.8 (allerede dev-dep i `apps/backend`) |
| Wallet-provider | postgres (casino-grade outbox + REPEATABLE READ) |
| R5 idempotency | `SocketIdempotencyStore` aktiv på `ticket:mark` (BIN-813) |
| Test-environment | Lokal Docker (kjøres av PM før hver pilot-go-live-vurdering) |

### 2.1 Hva testen verifiserer (vs. hva den IKKE tester)

**Tester:**
- `room:resume` etter socket-disconnect på 5/15/60 sek bringer klient
  tilbake til samme rom uten feil
- Marks gjort før disconnect er fortsatt på server etter reconnect
- Ny mark etter reconnect aksepteres (ikke "PLAYER_ALREADY_IN_RUNNING_GAME")
- `clientRequestId`-deduplisering fungerer end-to-end (R5)

**Tester IKKE:**
- Klient-side replay av cached marks som ble forsøkt utført under
  disconnect (det krever en faktisk frontend-implementasjon — testen sender
  bare nye marks etter reconnect for å verifisere at server aksepterer dem)
- Bingo-claim-replay (`claim:submit` etter reconnect) — det dekkes av
  separat invariant ved behov
- Cross-instance failover (det er R2 — BIN-811)
- Last/skala (det er R4 — BIN-817)

---

## 3. Steps som kjøres

Test-skriptet `infra/chaos-tests/r3-reconnect-test.sh` orkestrerer:

| § | Trinn | Forventet utfall |
|---|---|---|
| §0 | Pre-flight: jq, curl, docker-compose, node, npm | OK eller exit 2 |
| §1 | Bygg + start `docker-compose.chaos.yml` (gjenbruker R2-stacken; backend-2 ignoreres) | backend-1 svarer på `/health` innen 90s |
| §2 | Migrate DB + seed pilot-data via `seed-demo-pilot-day.ts` | Demo-haller, gruppe + spillere på plass |
| §3 | Sanity: player-login (`demo-spiller-1@example.com`) | Access-token returnert |
| §4 | Forsøk admin-login (best-effort) | OK eller WARN |
| §5 | For hvert scenario (5s / 15s / 60s): kjør `r3-mock-client.mjs` | Per-scenario JSON-resultat-fil |
| §6 | Kjør invariant-validator (`tsx --test r3ReconnectInvariants`) | I1-I5 PASS per scenario |
| §7 | Sammendrag + cleanup | Containere fjernet |

### 3.1 Mock-klient-flyt per scenario

Hver kjøring av `r3-mock-client.mjs` gjør:

1. Login via REST → `accessToken`.
2. `io.connect(BACKEND_URL)` (websocket only — deterministisk disconnect).
3. `room:join` med `roomCode=BINGO1` → `actualRoomCode + playerId`.
4. `room:state` for å få initial snapshot + sjekke om en runde er aktiv.
5. Hvis aktiv runde: send 5 × `ticket:mark` med UUID v4 per call.
6. Snapshot pre-disconnect (`room:state` → tell `currentGame.marks`).
7. **Force `socket.disconnect()`** → vent `disconnectSeconds`.
8. **Reconnect** med ny `io.connect()` → nytt socket-id.
9. `room:resume` (med fallback til `room:join` hvis resume avvises).
10. Snapshot post-reconnect → tell marks → sammenlign mot pre.
11. Send én ny `ticket:mark` for å verifisere "kan fortsette".
12. Skriv JSON-resultat til `OUT_FILE` (mock-klient-shape).

---

## 4. Invarianter som verifiseres

| Id | Invariant | Strukturelt? | Hvis brutt |
|---|---|---|---|
| I1 | `postReconnectMarkCount >= preDisconnectMarkCount` (server bevarer marks) | Ja | Pilot pauses |
| I2 | `newMarkAcceptedAfterReconnect=true` (server aksepterer ny aktivitet) | Ja | Pilot pauses |
| I3 | Reconnect-overhead < 3 sek over disconnect-vinduet | Nei (advisory) | WARN, krever latency-tuning |
| I4 | `errors.length === 0` per scenario | Ja | Pilot pauses |
| I5 | `pass`-flag matcher I1+I2+I4 (kontrakt-sanity) | Ja | Pilot pauses (mock-bug) |

Strukturelle brudd → pilot pauses per mandat §6.1.
Ikke-strukturelt → fix i drift.

---

## 5. Resultater

> **Status:** Klar til kjøring — venter på PM/Tobias for pilot-go-live-vurdering.
>
> Test-infrastrukturen er fullført. Faktisk run-result skal fylles inn av
> personen som kjører `bash infra/chaos-tests/r3-reconnect-test.sh` første
> gang.

| Scenario | I1 (marks bevart) | I2 (ny mark ok) | I3 (overhead) | I4 (no errors) | I5 (pass-flag) |
|---|---|---|---|---|---|
| 5 sek disconnect | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ |
| 15 sek disconnect | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ |
| 60 sek disconnect | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ | _Ikke kjørt_ |

### 5.1 Kjent risiko og forutsetninger som må valideres

- **Mock-klienten kan ikke alltid trigge en aktiv runde.** `seed-demo-pilot-day`
  setter opp data, men `app_game1_scheduled_games`-rader i `running`-status
  må kjøres via admin-flyt eller cron-tikk. Hvis testen kjøres mellom kl. 11
  og 20 (lokal-tz) trigger `Game1ScheduleTickService` daglige rader; ellers
  er `currentGame=undefined` og `ticket:mark` er en no-op.
  - Mock-klienten håndterer dette ved å hoppe over mark-delen og fortsatt
    teste socket-replay-pathen (`room:resume` + ny `ticket:mark`-emit).
  - For full coverage må testen kjøres innenfor pilot-åpningstid.

- **Server-side `disconnect`-cleanup** kan ta noen sekunder (lifecycle-event
  + `cleanupStaleWalletInIdleRooms` ved neste join). Hvis vi reconnect-er
  mens cleanup pågår kan vi se en transient feil — men den dekkes av
  `room:join`-fallback i mock-klienten.

- **Reconnect-tid > forventet** (I3 advisory) er typisk symptom på lav
  socket-handshake-effektivitet. Ikke pilot-blokker, men bør tunes hvis
  > 3 sek på toppen av disconnect-vinduet.

---

## 6. Anbefaling

### 6.1 Hvis alle invarianter PASS for alle 3 scenarioer

Pilot-go-live-møte kan markere R3 som **GRØNN**. Kombinert med:

- R2 (failover-test) GRØNN
- R5 (idempotent socket-events) verifisert (allerede merget)
- R7 (health-endpoint) live
- R8 (alerting) live
- R12 (runbook) validert

…kan pilot-utrulling fortsette per mandat §6.

### 6.2 Hvis I1, I2 eller I4 FAIL

**STOP — pilot pauses.**

Per mandat §6.1: "Hvis Bølge 1-tiltakene R2 (failover) eller R3 (reconnect)
avdekker strukturelle arkitektur-problemer, **skal pilot-utrulling pauses**
inntil problemet er løst."

Eskalering:
1. Rapporter til Tobias umiddelbart med JSON-resultat-filene + test-output.
2. Hvis fix-estimat > 1 uke: per §8.1 trigges vurdering av eksternt SRE-løft
   (200-400k NOK budsjett-ramme).
3. Pilot-go-live-møtet utsettes.

### 6.3 Hvis bare I3 FAIL (advisory)

Pilot kan fortsette, men med åpen issue mot ops:
- Mål p99 reconnect-overhead i prod under faktisk last
- Bekreft at < 3 sek holder på pilot-traffic-nivåer

### 6.4 Spesielt for 60-sek-scenarioet

Hvis 5s + 15s er PASS men 60s FAIL → server-side timeout for "stale player"
sparker inn et sted mellom 15s og 60s. Mulige årsaker:
- Socket disconnect-cleanup-tid er for kort (fjerner player fra room før
  reconnect)
- §66 obligatorisk pause trigger fordi spilleren har vært "inaktiv"

I så fall logg `disconnect.cleanup.player_removed` + tidspunkt for
videre diagnose.

---

## 7. Hvordan kjøre testen

### 7.1 Lokal kjøring (utvikler / PM)

```bash
# Fra repo-rot:
cd /Users/tobiashaugen/Projects/Spillorama-system

# Kjør testen (krever Docker daemon)
ADMIN_PASSWORD='Spillorama123!' \
  bash infra/chaos-tests/r3-reconnect-test.sh

# Kjør bare ett scenario (raskere):
DISCONNECT_SCENARIOS="5" \
  ADMIN_PASSWORD='Spillorama123!' \
  bash infra/chaos-tests/r3-reconnect-test.sh

# Exit-koder:
#   0 — alle invarianter PASS
#   1 — strukturelt brudd → pilot pauses
#   2 — oppsett-feil (Docker, jq, osv.)
```

### 7.2 CI / automatisert

Testen er **ikke** ment for hvert PR-bygg (Docker-stack tar ~3 min å spinne
opp + 60-sek-scenarioet alene tar > 60s). Den er ment som pilot-go-live-gate
og bør kjøres:

- Manuelt før hvert pilot-go-live-møte
- I CI som scheduled job (f.eks. nattlig på `main`)
- Etter større endringer i room-arkitektur, socket-laget eller wallet-paths

### 7.3 Hvis testen feiler underveis (oppsett, ikke invariant)

1. Sjekk Docker-daemon kjører: `docker info`
2. Sjekk at portene 4001 + 4002 er ledige: `lsof -i :4001 -i :4002`
3. Sjekk at `apps/backend/.env.production` finnes (`docker-compose.yml` env_file)
4. Sjekk at `socket.io-client` er installert i `apps/backend/node_modules/`
   (testen forsøker `npm install` automatisk hvis det mangler).
5. Test-skriptet rydder etter seg via `trap cleanup EXIT` — hvis stacken
   står igjen kan du tvinge cleanup:
   `docker-compose -f docker-compose.yml -f infra/chaos-tests/docker-compose.chaos.yml down -v`

---

## 8. Filer levert

| Fil | Formål |
|---|---|
| [`infra/chaos-tests/r3-reconnect-test.sh`](../../infra/chaos-tests/r3-reconnect-test.sh) | End-to-end orkestrator (kjører alle scenarioer + invariant-test) |
| [`infra/chaos-tests/r3-mock-client.mjs`](../../infra/chaos-tests/r3-mock-client.mjs) | Per-scenario mock-klient (Socket.IO + REST) |
| [`apps/backend/src/__tests__/chaos/r3ReconnectInvariants.test.ts`](../../apps/backend/src/__tests__/chaos/r3ReconnectInvariants.test.ts) | Invariant-validator (tsx --test) |
| [`docs/operations/R3_RECONNECT_TEST_RESULT.md`](./R3_RECONNECT_TEST_RESULT.md) | Denne rapporten |

Gjenbrukt fra R2:

| Fil | Formål |
|---|---|
| [`infra/chaos-tests/docker-compose.chaos.yml`](../../infra/chaos-tests/docker-compose.chaos.yml) | Override som spawner backend-1 (+ backend-2 — ignoreres for R3) |

---

## 9. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial — test-infrastruktur bygget. Klar for første kjøring før pilot-go-live-møte. | Agent R3 (test/r3-reconnect-test) |
