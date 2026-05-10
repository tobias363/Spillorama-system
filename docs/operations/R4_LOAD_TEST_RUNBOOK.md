# R4 Load-test runbook — 1000 simultane Spill 1-klienter

**Linear:** https://linear.app/bingosystem/issue/BIN-817
**Mandat-ref:** [`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.5 R4
**Status:** Infrastruktur klar (smoke-test verifisert lokal). Full 1000-VU-run må kjøres på staging eller dedikert host (krever 4+ GB ledig RAM og rate-limit-bypass på backend).
**Pilot-gating:** Utvidelses-blokker — pilot kan kjøre 4 haller uten R4, men utvidelse til flere haller krever bestått R4-test.

---

## Innhold

1. [Hva testen verifiserer](#1-hva-testen-verifiserer)
2. [Hvorfor Node.js, ikke k6](#2-hvorfor-nodejs-ikke-k6)
3. [Filer og struktur](#3-filer-og-struktur)
4. [Lokal smoke-test (10 min)](#4-lokal-smoke-test-10-min)
5. [Stress-test (200 VUs)](#5-stress-test-200-vus)
6. [Full 1000-VU run på staging](#6-full-1000-vu-run-på-staging)
7. [Tolke resultater + baseline-tall](#7-tolke-resultater--baseline-tall)
8. [SLA-thresholds + alarmer](#8-sla-thresholds--alarmer)
9. [Feilsøking](#9-feilsøking)
10. [Pre-requisites: backend-endringer for skala](#10-pre-requisites-backend-endringer-for-skala)

---

## 1. Hva testen verifiserer

Per R4-mandatet skal Spill 1 tåle **1000 samtidige klienter per rom** uten degradering. Pilot-skala er 1500 spillere per rom (24 haller × ~60 spillere snitt). Vi tester med 1000 VUs som baseline og kan eventuelt skalere opp.

Testen måler under realistisk profil:

| Metrikk | Hva | Mål-SLA |
|---|---|---|
| Socket connect-time | Tid fra `io()` til `connect`-event | p95 < 500ms |
| `room:join` ack-roundtrip | Tid fra emit til ack | p95 < 500ms |
| `ticket:mark` ack-roundtrip | Tid fra emit til ack | p95 < 1000ms |
| `draw:new` event-rate | Events mottatt per VU per minutt | > 0 ved aktiv runde |
| Connection-errors | Disconnect-rate under hold-fasen | < 1% |
| Ack-timeouts | Emits uten ack innen 5s | < 2% |
| `socketRoundtrip` generelt | Aggregat over alle ack-baserte events | p95 < 500ms, p99 < 2000ms |

Hva som IKKE testes (out-of-scope for R4):
- Game-engine determinisme — dekket av unit-tester
- Wallet-konsistens under last — dekket av BIN-761→764 wallet-tester + R9 leak-test
- Phase-state-machine (Spill 3) — dekket av R10 chaos-test
- Reconnect-flyt — dekket av R3 reconnect-test

---

## 2. Hvorfor Node.js, ikke k6

k6 er industri-standard for HTTP load-test og har plain-WebSocket-støtte. Socket.IO legger imidlertid på et ekstra protokoll-lag som k6 ikke parser:

- **engine.io v4 framing** (`42["event-name", payload, ack-id]`-format)
- **Multiplexed namespaces** (`/game1`, `/admin` etc.)
- **Ack-callbacks** med numerisk msg-id
- **Heartbeat-protokoll** (ping/pong med custom timing)

Egen k6-extension (`xk6-socketio`) finnes men krever custom k6-build og er ikke standard pilot-tooling.

Vi bruker derfor **Node.js + `socket.io-client`** som load-runner. Det er identisk med eksisterende chaos-tests (`infra/chaos-tests/r3-mock-client.mjs`) og kan kjøre 1000 samtidige socket.io-klienter på én Node-prosess (~2-3 GB RAM, IO-bound).

For HTTP-only endpoints (eks. lobby-routes) kan k6 brukes som supplement; ikke nødvendig for R4-scope.

---

## 3. Filer og struktur

```
infra/load-tests/
├── README.md                        # Kort intro
├── spill1-1000-clients.mjs          # Main load-runner (Node.js + socket.io-client)
├── metrics-collector.mjs            # Percentile-aggregator + JSON-rapport-eksporter
├── seed-load-test-players.ts        # Idempotent seed for N loadtest-spillere
└── spill1-load-config.json          # Scenario-config (smoke / stress / full)

scripts/load-test-runner.sh          # Bash-wrapper med pre-flight + tee-logging

docs/operations/R4_LOAD_TEST_RUNBOOK.md  # Denne filen
```

---

## 4. Lokal smoke-test (10 min)

**Formål:** Verifiser at scriptet, infra, og metrics fungerer ende-til-ende. 50 VUs over 5 min.

### Forutsetninger

- Backend kjører lokalt på `http://localhost:4000` (`npm run dev:all`)
- Postgres + Redis tilgjengelig (via `docker-compose up -d`)
- Demo-haller seedet (`npm run seed:demo-pilot-day`)
- Node 22+ + Mac/Linux

### Steg

1. **Seed 50 load-test-spillere** (idempotent, kjør én gang):
   ```bash
   cd apps/backend
   APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
     npx tsx ../../infra/load-tests/seed-load-test-players.ts \
     --count=50 --hallId=demo-hall-001
   ```
   Forventet output:
   ```
   [seed-load-test] Seeding 50 players → hall=demo-hall-001
   [seed-load-test] Hashing password (engang)...
   [seed-load-test] Done: 50 created + 0 existing (in 0.5s)
   ```

2. **Kjør smoke-scenario:**
   ```bash
   bash scripts/load-test-runner.sh smoke
   ```
   Eller direkte:
   ```bash
   cd /Users/tobiashaugen/Projects/Spillorama-system
   SCENARIO=smoke node infra/load-tests/spill1-1000-clients.mjs
   ```

3. **Tolk resultatet:**
   - `[PASS] All SLA tresholds met` → smoke OK
   - JSON-rapport i `/tmp/r4-load-test-results/r4-smoke-<timestamp>.json`
   - Sammenlign p95/p99 mot SLA-tabell i §8

### Forventede smoke-tall (lokal Mac M-serie)

| Metrikk | Forventet p95 | Forventet p99 |
|---|---|---|
| socketRoundtrip | < 50ms | < 100ms |
| ack:room:join | < 50ms | < 200ms |
| ack:ticket:mark | < 50ms | < 100ms |
| loginLatency | < 200ms | < 500ms |

Tallene over forutsetter at lokal docker-stack kjører på samme host. Hvis backend kjører i prod-mode (`NODE_ENV=production`) eller med Redis-Cloud kan p99 være høyere.

---

## 5. Stress-test (200 VUs)

**Formål:** Mellomtest hvis full 1000-VU er for tungt lokalt. Verifiserer at 200 samtidige spillere på samme rom fungerer.

```bash
# Seed 200 spillere først
cd apps/backend
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npx tsx ../../infra/load-tests/seed-load-test-players.ts \
  --count=200 --hallId=demo-hall-001

# Kjør stress-scenario (~10 min total)
bash scripts/load-test-runner.sh stress
```

200 VUs × 8 min hold = ~10 min total. RAM-bruk ~800 MB.

---

## 6. Full 1000-VU run på staging

**Anbefalt miljø:** Render staging eller dedikert lokal host med ≥ 16 GB RAM.

### Steg 1: Backend-endring (rate-limit-bypass for load-test)

Backend har **rate-limit 5 logins/min/IP** (`apps/backend/src/middleware/httpRateLimit.ts`). Dette blokkerer >5 samtidige logins.

To strategier:

#### Strategi A: Pre-fetch tokens med 3-takt-cache (anbefalt for staging uten kode-endring)

Scriptet cacher tokens på disk og bruker dem i påfølgende kjøringer. Første prefetch tar ~5 timer for 1000 VUs (3 logins/min × 60 min × 60 min = 1080 logins). Cache er gyldig i 6 dager.

```bash
# Kjør én gang for å fylle cache (kjør om natten)
cd /Users/tobiashaugen/Projects/Spillorama-system
BACKEND_URL=https://staging.spillorama.no \
  SCENARIO=full \
  PREFETCH_RATE_PER_MIN=3 \
  HOLD_MINUTES_OVERRIDE=0 \
  node infra/load-tests/spill1-1000-clients.mjs

# Etterpå (innenfor 6 dager): full run bruker cache
bash scripts/load-test-runner.sh full
```

#### Strategi B: Rate-limit-bypass-flag i backend (preferert hvis staging)

Liten backend-PR (~10 linjer) som tillater bypass via env:

```typescript
// apps/backend/src/middleware/httpRateLimit.ts
constructor(tiers?: HttpRateLimitTier[]) {
  if (process.env.HTTP_RATE_LIMIT_DISABLED === "1") {
    this.tiers = []; // bypass
  } else {
    this.tiers = [...].sort(...);
  }
}
```

Staging deploy med `HTTP_RATE_LIMIT_DISABLED=1` → 1000-VU prefetch kjører på ~30 sek.

**Sikkerhetsmerknad:** flagget må KUN settes på staging/test-miljø, aldri prod. Vi anbefaler å sjekke `NODE_ENV !== "production"` i samme guards.

### Steg 2: Seed 1000 spillere på staging

```bash
# Kobl mot staging-DB
APP_PG_CONNECTION_STRING="<staging-conn-string>" \
  npx tsx infra/load-tests/seed-load-test-players.ts \
  --count=1000 --hallId=demo-hall-001
```

Ta ~30 sekunder. Forventet output:
```
[seed-load-test] Done: 1000 created + 0 existing (in 28.3s)
```

### Steg 3: Verifiser hall-tilstand

```bash
curl -s https://staging.spillorama.no/api/games/spill1/health?hallId=demo-hall-001 | jq
```

Forventet:
- `status: "ok"`
- `withinOpeningHours: true`
- `dbHealthy: true`, `redisHealthy: true`

### Steg 4: Kjør 1000-VU-scenario

```bash
BACKEND_URL=https://staging.spillorama.no \
  bash scripts/load-test-runner.sh full
```

Total varighet: ~63 min (60s ramp-up + 60 min hold + 30s ramp-down).

### Steg 5: Hent metrics fra backend

Mens testen kjører, sample backend-metrics:

```bash
# Lokal sampling-script
while true; do
  echo "=== $(date -u +%H:%M:%S) ==="
  curl -s https://staging.spillorama.no/metrics | grep -E "(bingo_|socket_|http_request_duration_seconds)" | head -30
  echo
  sleep 30
done
```

Lagre output for senere analyse.

### Steg 6: Etter test — review rapport

```bash
ls -la /tmp/r4-load-test-results/r4-full-*.json
cat /tmp/r4-load-test-results/r4-full-<timestamp>.json | jq '.latencies'
```

Verifiser:
- Alle SLA-thresholds møtt (`[PASS]` exit code 0)
- `vusCompleted` ≈ `vusActive` ramp-down (ingen krasj)
- `connection-errors` < 1% av totalt antall connects
- `businessError:*` er forventede (eks. `GAME_NOT_RUNNING` hvis ingen aktiv runde)

---

## 7. Tolke resultater + baseline-tall

### Hva ser et "godt" resultat ut?

```json
{
  "latencies": {
    "socketRoundtrip": {
      "count": 50000,
      "p50": 15, "p95": 80, "p99": 150,
      "max": 350
    },
    "ack:ticket:mark": {
      "count": 30000,
      "p50": 12, "p95": 60, "p99": 120
    }
  },
  "counters": {
    "loginsSuccessful": 998,
    "loginsFailed": 2,
    "socketConnectsSuccessful": 998,
    "ticketMarksSuccessful": 30000,
    "businessError:ticket:mark:GAME_NOT_RUNNING": 5000
  }
}
```

### Hva ser et "dårlig" resultat ut?

| Indikator | Problem | Sannsynlig årsak |
|---|---|---|
| p99 socketRoundtrip > 5000ms | Backend event-loop blocking | Synkron CPU-jobb, DB-query uten index, Redis pool exhaustion |
| ack-timeout > 5% | Backend overloaded | Socket.IO adapter pub/sub overload, eller backend CPU-saturated |
| `disconnect:transport close` > 10% | Network-instabilitet eller Node-prosessen kjørte ut av FD-er | Sjekk `ulimit -n` og Redis-pool |
| `loginsFailed` ≈ total | Rate-limit traff hele kohorten | Bytt til prefetched tokens eller disable rate-limit |
| `vusFailed` > 5% | VUs krasjet under hold | Sjekk stderr-log + Redis/DB-loginger |
| `connection-errors > 1%` | Server avviser tilkoblinger | Sjekk Socket.IO adapter konfigurasjon |

### Baseline (etter første godkjente run)

> Fyll inn etter første faktiske 1000-VU-run. Smoke-test 2026-05-10 (10 VUs lokal Mac M-serie):

| Scenario | VUs | p50 socket | p95 socket | p99 socket | Notater |
|---|---|---|---|---|---|
| Lokal smoke | 10 | 8ms | 18ms | 28ms | Mac M-serie, alt lokal |
| Lokal stress | TBD | TBD | TBD | TBD | Kjør 200-VU først |
| Staging full | TBD | TBD | TBD | TBD | Krever rate-limit bypass |
| Prod-paritet | TBD | TBD | TBD | TBD | Måles ved første pilot-kveld |

---

## 8. SLA-thresholds + alarmer

### SLA per LIVE_ROOM_ROBUSTNESS_MANDATE §3.4

| Metrikk | Grønn | Gul (varsel) | Rød (alarm) |
|---|---|---|---|
| socketRoundtrip p95 | < 250ms | 250-500ms | > 500ms |
| socketRoundtrip p99 | < 1000ms | 1000-2000ms | > 2000ms |
| ticketMarkLatency p95 | < 500ms | 500-1000ms | > 1000ms |
| Connection-error-rate | < 1% | 1-3% | > 3% |
| Ack-timeout-rate | < 2% | 2-5% | > 5% |
| VU disconnect-rate (over hold) | < 1% | 1-5% | > 5% |

### Eskalering ved rød alarm

1. **Stopp testen** (Ctrl-C i runneren)
2. **Hent backend-metrics-snapshot** fra `https://staging.spillorama.no/metrics`
3. **Sjekk Render-dashboard** for CPU/memory under testen
4. **Sjekk Redis Cloud-dashboard** for pool-exhaustion
5. **Spawn root-cause-agent** — flag som P0 i Linear (BIN-817)

### Pilot-gating-beslutning

Per LIVE_ROOM_ROBUSTNESS_MANDATE §6.1:
- **Strukturelt problem** (p99 > 5000ms, > 10% disconnects): pilot pauses for utvidelse til flere haller
- **Performance-tuning** (p99 800-1500ms): kan fikses i drift, ikke pilot-blokker

---

## 9. Feilsøking

### "socket.io-client mangler"

Kjør fra repo-rot. ESM bare-imports respekterer kun lokal `node_modules`:

```bash
cd /Users/tobiashaugen/Projects/Spillorama-system  # ikke ~/
ls node_modules/socket.io-client                    # må eksistere
node infra/load-tests/spill1-1000-clients.mjs
```

Hvis mangler: `npm install` fra repo-rot.

### "INVALID_PASSWORD_HASH" på login

Du har seeded med feil hash-format. Slett gamle players og re-seed:

```sql
DELETE FROM app_hall_registrations WHERE id LIKE 'loadtest-%';
DELETE FROM app_users WHERE id LIKE 'loadtest-%';
DELETE FROM wallet_accounts WHERE id LIKE 'loadtest-%';
```

```bash
cd apps/backend && npx tsx ../../infra/load-tests/seed-load-test-players.ts --count=N
```

### "GAME_NOT_RUNNING" feil på alle ticket:mark

Forventet — rommet er idle og ingen runde kjører. Marks vil fortsatt **roundtrippe** og måle protokoll-latency, men ikke ha business-effekt. For realistisk test:

1. Start en runde manuelt via admin-portal (`/admin/agent/cash-in-out` → "Start neste spill")
2. Eller la `Game1ScheduleTickService` cron auto-starte runden ved threshold

### "Bare X/N tokens hentet" (prefetch-error)

Rate-limit traff. Med `PREFETCH_RATE_PER_MIN=3` (default) kan vi hente 3 tokens / 60s. For 1000 VUs er det 333 min ≈ 5.5 timer. Strategier:
- Kjør prefetch én gang om natten → cache reuses 6 dager
- Disable rate-limit på staging via env-flag (se §6)

### "address already in use" på port

Backend kjører kanskje på port 4001 (chaos-stack). Sett `BACKEND_URL`:

```bash
BACKEND_URL=http://localhost:4001 bash scripts/load-test-runner.sh smoke
```

### "EMFILE: too many open files"

Hver VU bruker 1 socket + 1 fd for HTTP-login. 1000 VUs trenger ~2000 FDs. Hev ulimit:

```bash
ulimit -n 8192
```

### Backend "504 Gateway Timeout" eller "ECONNREFUSED"

Backend krasjet eller Render restarted instansen. Sjekk Render-logger. Hvis det skjer under load-test er det et **strukturelt funn** — backend overlevde ikke 1000-VU-last. Eskaler.

### Test henger på "Ramp-up done. Holding..."

Normal — testen venter `holdMinutes` minutter. Sjekk progress-logg hvert ~15 sek for `Active VUs` count. Hvis count plutselig stupes (eks 1000 → 100 → 0 i løpet av 30s) — det er disconnect-storm.

### "Ingen tokens hentet — abort"

Login-rate-limit har vart hele prefetch-fasen. Sjekk:
1. Er rate-limit fortsatt 5/min/IP? (`apps/backend/src/middleware/httpRateLimit.ts`)
2. Er load-test-spillere riktig seeded? (`SELECT count(*) FROM app_users WHERE id LIKE 'loadtest-%'`)
3. Er backend-URL riktig?

---

## 10. Pre-requisites: backend-endringer for skala

R4 kjører delvis "ut av boksen" med default rate-limit, men full 1000-VU på én IP krever en av:

1. **Rate-limit-bypass via env (anbefalt for staging):** liten backend-PR ~10 linjer. Kun aktiv på `NODE_ENV !== production`.

2. **Multi-IP-source:** bruk flere klient-hosts (vanskelig å koordinere; ikke nødvendig).

3. **Token-prefetch på 3/min over 5.5 timer:** funker uten kode-endring. Cache i 6 dager.

Strategi for pilot-utvidelse:
- T-30 dager: backend-PR med rate-limit-bypass (uke 1)
- T-21 dager: full 1000-VU-test på staging (uke 2) → baseline-tall i §7
- T-14 dager: rerun med konfig-justering hvis nødvendig
- T-7 dager: drill-run kvelden før pilot-utvidelse for å forsikre stabilitet

---

## 11. Resultathistorikk

| Dato | Scenario | VUs | p95 socket | p99 socket | PASS/FAIL | Notater |
|---|---|---|---|---|---|---|
| 2026-05-10 | smoke (lokal) | 10 | 18ms | 28ms | PASS | Initial smoke-verifikasjon. Marks failed med GAME_NOT_RUNNING (forventet). |
| TBD | smoke (lokal) | 50 | — | — | — | Neste smoke-run |
| TBD | stress (lokal) | 200 | — | — | — | Forventet ETA: pre-T-30-dager |
| TBD | full (staging) | 1000 | — | — | — | Pilot-utvidelses-baseline. Krever rate-limit-bypass. |

---

## 12. Referanser

- [`infra/load-tests/README.md`](../../infra/load-tests/README.md)
- [`infra/load-tests/spill1-1000-clients.mjs`](../../infra/load-tests/spill1-1000-clients.mjs)
- [`infra/load-tests/seed-load-test-players.ts`](../../infra/load-tests/seed-load-test-players.ts)
- [`infra/load-tests/spill1-load-config.json`](../../infra/load-tests/spill1-load-config.json)
- [`scripts/load-test-runner.sh`](../../scripts/load-test-runner.sh)
- [LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) §3.5 R4
- [Linear BIN-817](https://linear.app/bingosystem/issue/BIN-817)

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial — R4 load-test infrastruktur + runbook. Smoke-test 10-VU verifisert lokal. Full 1000-VU baseline gjenstår (krever rate-limit-bypass). | Agent G (ADR-0020 Bølge 2) |
