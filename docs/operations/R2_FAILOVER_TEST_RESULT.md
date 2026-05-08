# R2 Failover-test — resultat-rapport

**Linear:** [BIN-811](https://linear.app/bingosystem/issue/BIN-811)
**Mandat:** [docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md)
**Test-skript:** [`infra/chaos-tests/r2-failover-test.sh`](../../infra/chaos-tests/r2-failover-test.sh)
**Invariants:** [`apps/backend/src/__tests__/chaos/r2FailoverInvariants.test.ts`](../../apps/backend/src/__tests__/chaos/r2FailoverInvariants.test.ts)

---

## 1. Sammendrag

Pilot-gating-test som verifiserer at hvis backend-instans dør midt i en runde,
plukker en annen instans opp via Redis-state og fortsetter uten å miste draws,
marks eller payouts.

**Status pr. levering:** test-infrastruktur **bygget og klar for kjøring**.
Faktisk test-kjøring må utføres av PM/Tobias før pilot-go-live-møte
(per mandat §6.1: "R2/R3 må kjøres FØR pilot-go-live-møte — ikke etter").

---

## 2. Pre-conditions

| Komponent | Verdi |
|---|---|
| Versjon | branch `test/r2-failover-test` (base: `main` ace2ba1e) |
| Backend-runtime | Node.js 22 + Express 4.21 + Socket.IO 4.8 |
| Postgres | 16-alpine (delt mellom begge backend-instanser) |
| Redis | 7-alpine (delt — `ROOM_STATE_PROVIDER=redis`, `SCHEDULER_LOCK_PROVIDER=redis`) |
| Socket.IO Redis-adapter | `@socket.io/redis-adapter` 8.3 (cross-instance pub/sub aktiv) |
| Wallet-provider | postgres (casino-grade outbox + REPEATABLE READ) |
| Test-environment | Lokal Docker (kjøres av PM før hver pilot-go-live-vurdering) |

### 2.1 Arkitektoniske antakelser

Testen avhenger av at følgende fundament er på plass i koden:

1. **State-eierskap er i Postgres + Redis, ikke prosess-minne.**
   - Game-state for Spill 1 lever i `app_game1_game_state` (deterministisk
     draw-bag) + `app_game1_draws` (append-only sekvens) + `app_game1_scheduled_games`.
   - Ticket-purchase-state i `app_game1_ticket_purchases` + `app_game1_ticket_assignments`.
   - Wallet i `wallet_entries` (append-only ledger med hash-chain).
   - Pre-round arm-state i Redis via `RedisRoomLifecycleStore` (BIN-K4).

2. **Distribuert lås på draw-tick.** `RedisSchedulerLock` (`SET NX EX` med
   instance-ID + Lua-guarded release) hindrer at to instanser begge skriver
   neste draw samtidig. `app_game1_draws` har i tillegg `UNIQUE(scheduled_game_id, draw_sequence)`
   og `UNIQUE(scheduled_game_id, ball_value)` som siste forsvar.

3. **Idempotency-keys i wallet og compliance.** `forPayout(gameId, phaseId, playerId)`
   og `forCompliance(...)` sikrer at retry etter recovery ikke gir double-write.

Hvis noen av disse er borte/brutt, er det disse testen avdekker.

---

## 3. Steps som kjøres

Test-skriptet `infra/chaos-tests/r2-failover-test.sh` orkestrerer:

| § | Trinn | Forventet utfall |
|---|---|---|
| §0 | Pre-flight: jq, curl, docker-compose tilgjengelig | OK eller exit 2 |
| §1 | Bygg + start `docker-compose.chaos.yml` (backend-1 + backend-2 + postgres + redis) | Begge backends svarer på `/health` innen 90s |
| §2 | Migrate DB + seed pilot-data via `seed-demo-pilot-day.ts` | Demo-haller, gruppe + spillere på plass |
| §3 | Admin-login mot backend-1 | Access-token returnert |
| §4 | Capture pre-kill snapshot (Postgres-aggregat over draws/wallet/compliance) | JSON-fil i `/tmp/.../pre_kill.json` |
| §5 | Sanity: cross-instance katalog-read konsistent | `entries.length` likt på begge |
| §6 | **`docker kill -s SIGKILL spillorama-backend-1`** | backend-1 svarer ikke lenger på `/health` |
| §7 | Vent på at backend-2 svarer (timeout 30s) | Recovery-tid registrert |
| §8 | Verifiser at backend-2 ser samme DB-state | Katalog-count uendret |
| §9 | Capture post-recovery snapshot | JSON-fil i `/tmp/.../post_recovery.json` |
| §10 | Kjør invariant-validator (`npx tsx --test r2FailoverInvariants`) | I1-I5 PASS |
| §11 | Cleanup: stop chaos-stack | Containere fjernet |

---

## 4. Invarianter som verifiseres

| Id | Invariant | Strukturelt? | Hvis brutt |
|---|---|---|---|
| I1 | `MAX(draw_sequence) === COUNT(*)` per scheduled_game; ingen duplikate ball_value | Ja | Pilot pauses |
| I2 | Antall draws etter recovery ≥ antall før kill | Ja | Pilot pauses |
| I3 | `wallet_entries` SUM(CREDIT) og SUM(DEBIT) ikke minket; deltaer ≥ 0 | Ja | Pilot pauses |
| I4 | `app_rg_compliance_ledger` COUNT og SUM(amount) ikke minket | Ja | Pilot pauses |
| I5 | Recovery-tid ≤ 5 sek | Nei (advisory) | WARN, krever latency-tuning |

Strukturelle brudd → pilot pauses per mandat §6.1. Ikke-strukturelt → fix i drift.

---

## 5. Resultater

> **Status:** Klar til kjøring — venter på PM/Tobias for pilot-go-live-vurdering.
>
> Test-infrastrukturen er fullført. Faktisk run-result skal fylles inn av
> personen som kjører `bash infra/chaos-tests/r2-failover-test.sh` første
> gang. Eksempel på hvordan det skal se ut når det er kjørt:

| Invariant | Resultat | Notater |
|---|---|---|
| I1 (gaps) | _Ikke kjørt_ | Skal være PASS |
| I2 (draws ikke mistet) | _Ikke kjørt_ | Skal være PASS |
| I3 (wallet konsistent) | _Ikke kjørt_ | Skal være PASS |
| I4 (compliance intakt) | _Ikke kjørt_ | Skal være PASS |
| I5 (recovery-tid) | _Ikke kjørt_ | Mål: < 5s |

### 5.1 Kjent risiko og forutsetninger som må valideres

Selv om infrastrukturen er på plass og koden bør være Evolution-grade:

- **Recovery-tid > 5 sek er sannsynlig** ved første run. Healthcheck-interval
  i chaos-compose er 5s, så worst-case første gang kan det ta 5-10 sek før
  backend-2 melder healthy etter at backend-1 ble drept midt i en client-
  request. Dette er ikke-strukturelt og kan tunes (kortere healthcheck-interval,
  preemptive connection pool warmup).

- **Socket.IO-klienter bytter ikke instans automatisk** uten en sticky-session-
  LB foran. Testen verifiserer her bare at backend-server-staten overlever,
  ikke at en eksisterende klient-tilkobling re-konnektes mot ny instans —
  det dekkes av R3 (BIN-812).

- **Seed-script-en `seed-demo-pilot-day.ts` må være kompilert til `dist/`**
  for at testen skal kunne seede inne i container. Hvis ikke, hopper testen
  over seeding og bruker eksisterende data. Det reduserer test-coverage men
  bryter ikke testen.

---

## 6. Anbefaling

### 6.1 Hvis alle invarianter PASS

Pilot-go-live-møte kan markere R2 som **GRØNN**. Kombinert med:

- R3 (klient-reconnect) GRØNN
- R5 (idempotent socket-events) verifisert
- R7 (health-endpoint) live
- R8 (alerting) live
- R12 (runbook) validert

…kan pilot-utrulling fortsette per mandat §6.

### 6.2 Hvis I1, I2, I3 eller I4 FAIL

**STOP — pilot pauses.**

Per mandat §6.1: "Hvis Bølge 1-tiltakene R2 (failover) eller R3 (reconnect)
avdekker strukturelle arkitektur-problemer, **skal pilot-utrulling pauses**
inntil problemet er løst."

Eskalering:
1. Rapporter til Tobias umiddelbart med snapshot-filene + test-output.
2. Hvis fix-estimat > 1 uke: per §8.1 trigges vurdering av eksternt SRE-løft
   (200-400k NOK budsjett-ramme).
3. Pilot-go-live-møtet utsettes.

### 6.3 Hvis bare I5 FAIL

Pilot kan fortsette, men med åpen issue mot ops:
- Reduser healthcheck-interval i prod fra default til ~2s
- Vurder preemptive connection-pool warmup
- Mål p99 i prod og bekreft at < 5s holder under faktisk last

---

## 7. Hvordan kjøre testen

### 7.1 Lokal kjøring (utvikler / PM)

```bash
# Fra repo-rot:
cd /Users/tobiashaugen/Projects/Spillorama-system

# Kjør testen (krever Docker daemon)
ADMIN_PASSWORD='Spillorama123!' \
  bash infra/chaos-tests/r2-failover-test.sh

# Exit-koder:
#   0 — alle invarianter PASS
#   1 — strukturelt brudd → pilot pauses
#   2 — oppsett-feil (Docker, jq, osv.)
```

### 7.2 CI / automatisert

Testen er **ikke** ment for hvert PR-bygg (Docker-stack tar ~3 min å spinne
opp). Den er ment som pilot-go-live-gate og bør kjøres:

- Manuelt før hvert pilot-go-live-møte
- I CI som scheduled job (f.eks. nattlig på `main`)
- Etter større endringer i room-arkitektur, draw-engine eller wallet-paths

### 7.3 Hvis testen feiler underveis (oppsett, ikke invariant)

1. Sjekk Docker-daemon kjører: `docker info`
2. Sjekk at portene 4001 + 4002 er ledige: `lsof -i :4001 -i :4002`
3. Sjekk at `apps/backend/.env.production` finnes (`docker-compose.yml` env_file)
4. Test-skriptet rydder etter seg via `trap cleanup EXIT` — hvis stacken
   står igjen kan du tvinge cleanup: `docker-compose -f docker-compose.yml -f infra/chaos-tests/docker-compose.chaos.yml down -v`

---

## 8. Filer levert

| Fil | Formål |
|---|---|
| [`infra/chaos-tests/docker-compose.chaos.yml`](../../infra/chaos-tests/docker-compose.chaos.yml) | Override som spawner 2 backend-instanser |
| [`infra/chaos-tests/r2-failover-test.sh`](../../infra/chaos-tests/r2-failover-test.sh) | End-to-end orkestrator |
| [`apps/backend/src/__tests__/chaos/r2FailoverInvariants.test.ts`](../../apps/backend/src/__tests__/chaos/r2FailoverInvariants.test.ts) | Invariant-validator (tsx --test) |
| [`docs/operations/R2_FAILOVER_TEST_RESULT.md`](./R2_FAILOVER_TEST_RESULT.md) | Denne rapporten |

---

## 9. Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-08 | Initial — test-infrastruktur bygget. Klar for første kjøring før pilot-go-live-møte. | Agent R2 (test/r2-failover-test) |
