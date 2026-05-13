---
name: casino-grade-testing
description: When the user/agent works with tests for the live-room architecture in the Spillorama bingo platform. Also use when they mention chaos-test, vitest, tsx --test, playwright, integration-test, snapshot-test, WALLET_PG_TEST_CONNECTION_STRING, R2 failover, R3 reconnect, R10 chaos, BIN-811, BIN-812, BIN-820, source-level wiring-regression-test, infra/chaos-tests/, apps/backend/src/__tests__/chaos/. Defines the test patterns required for Evolution Gaming-grade reliability — chaos, integration, snapshot, R2/R3 failover invariants, wiring-regression. Make sure to use this skill whenever someone touches tests for live-room code (Spill 1/2/3 engines, master handshake, ticket purchase, draw-tick, payout) even if they don't explicitly ask for it — these tests are pilot-gating per the Live-Room Robustness Mandate.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: infra/chaos-tests/**, apps/backend/src/__tests__/chaos/**, apps/backend/src/**/*.test.ts, tests/e2e/** -->

# Casino-Grade Testing

## Kontekst

Spillorama er en regulert pengespill-plattform der live-rommene (Spill 1/2/3) må holde **Evolution Gaming-grade oppetid (99.95%+)** innenfor åpningstid. Test-pyramiden er pilot-gating: hvis R2 (failover) eller R3 (reconnect) avdekker strukturelle problemer skal pilot **pauses** før utrulling — ikke "fikses i drift". Per `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §6.1.

Dette betyr at tester ikke er en best-effort sjekk — de er bevis vi viser regulator + Tobias før vi går live.

## Kjerne-arkitektur

### Test-runners

| Lag | Runner | Versjon | Bruks-område |
|---|---|---|---|
| Backend unit | `tsx --test` (Node built-in) | 4.19 | Service-logikk, pure-compute, mock-DB |
| Backend integration | `tsx --test` med real Postgres | 4.19 | Wallet, ledger, hash-chain — krever `WALLET_PG_TEST_CONNECTION_STRING` |
| Frontend / shared-types | `vitest` | 3.1 | Game-client, Pixi-rendering, Zod-schemaer |
| Visual regression | Playwright | — | Game-rendering snapshots (`npm run test:visual`) |
| Chaos | `tsx --test` + bash + docker-compose | — | R2/R3/R10 — drep instans midt i runde |

### Filstruktur

```
apps/backend/src/
  __tests__/
    chaos/
      r2FailoverInvariants.test.ts    # I1-I5 invariants
      r3ReconnectInvariants.test.ts   # State-replay invariants
  service-X.ts
  service-X.test.ts                    # Co-located unit
infra/
  chaos-tests/
    r2-failover-test.sh               # Docker-compose driver
    r3-reconnect-test.sh
    r3-mock-client.mjs                # Reconnect-simulator
    docker-compose.chaos.yml          # 2 backend-instanser, 1 Postgres, 1 Redis
```

## Immutable beslutninger

### Snapshot-tests per state, ikke per "happy path"

For aggregator/state-machine-mønstre: skriv snapshot-test for **hver gyldig state** med selv-dokumenterende navn `<state>-<scenario>`. Eksempel fra R7 helse-aggregator:

- `health-status-ok-active-round.test.ts`
- `health-status-ok-idle-within-opening-hours.test.ts`
- `health-status-degraded-redis-down-active-round.test.ts`
- `health-status-degraded-draw-stale-30s.test.ts`
- `health-status-down-db-unreachable.test.ts`

Test-navn skal kunne leses som spec av en non-coder. Hvis testen feiler skal navnet alene fortelle hva som er brutt.

### Integration-tester skipper grasiøst uten DB

Når en test krever Postgres (wallet, ledger, hash-chain audit), bruk dette mønsteret:

```typescript
const PG_URL = process.env.WALLET_PG_TEST_CONNECTION_STRING;
const skipReason = !PG_URL
  ? "WALLET_PG_TEST_CONNECTION_STRING not set — skipping integration test"
  : null;

test("wallet credit + debit preserves invariant", { skip: skipReason }, async () => {
  // ...
});
```

Aldri la testen krasje med uleselig DNS-feil. CI uten DB skal vise klar "skipped" — ikke "failed".

### Chaos-tester deler env-vars med snapshot-state

R2/R3 kjøres slik:

```bash
# 1. Start chaos-stack
docker-compose -f infra/chaos-tests/docker-compose.chaos.yml up -d

# 2. Driver-script kjører pre-kill snapshot, kill, post-recovery snapshot
bash infra/chaos-tests/r2-failover-test.sh

# 3. Driver eksporterer snapshots som env-vars og kjører invariants
PRE_KILL_SNAPSHOT=/tmp/pre.json \
POST_RECOVERY_SNAPSHOT=/tmp/post.json \
RECOVERY_TIME_SECONDS=3 \
  npx tsx --test src/__tests__/chaos/r2FailoverInvariants.test.ts
```

Hvis env-vars ikke er satt → kjør et "skeleton-test" som dokumenterer hva som vil testes når chaos-driver-en ble brukt. Dette gjør at `npm test` aldri blokkerer på chaos-infrastruktur.

### R2/R3-invarianter er strukturelle akseptkriterier

Per `LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §3.3:

**R2 (failover) — pilot-gating:**

- I1: Draws-sekvens uten gaps. `MAX(draw_sequence) === COUNT(*)`. Ingen duplikat-draws fra to instanser.
- I2: Marks/draws ikke gått tapt. Antall draws etter recovery ≥ antall før kill.
- I3: Wallet ikke double-debited. SUM(CREDIT) - SUM(DEBIT) konsistent.
- I4: Compliance-ledger intakt. Audit-rader bevart.
- I5 (advisory): Recovery-tid ≤ 5 sek. > 5 = WARN, ikke FAIL.

**R3 (reconnect) — pilot-gating:**

- Klient som mister nett 5/15/60 sek skal få full state-replay.
- Ingen mistede draws/marks etter reconnect.
- Idempotente socket-events: samme `clientRequestId` to ganger = én effekt.

Strukturelt brutt → pilot pauses. Ikke "best effort, fix in drift".

### Source-level wiring-regression-tests

For services som er DI-injisert (R8 alerting, dependency injection), skriv en regresjons-test som verifiserer at `bootstrap.ts` faktisk wirer servicen inn. Mønster fra BIN-823:

```typescript
test("RoomAlertingService wired in production bootstrap", () => {
  const source = readFileSync("src/index.ts", "utf-8");
  assert.match(source, /createRoomAlertingService\(/);
  assert.match(source, /\.start\(\)/);
});
```

Dette fanger silent regressions der noen kommenterer ut wiring i et merge-konflikt.

### Mock-kvalitet: ingen "happy path"-mocks

For DB-mocks: bruk presis SQL-regex-matching, ikke generisk `mock.fn().mockResolvedValue([])`:

```typescript
mockPool.query = mock.fn(async (sql: string) => {
  if (/SELECT.*FROM app_game1_scheduled_games.*WHERE master_hall_id = \$1/.test(sql)) {
    return { rows: [{ id: "uuid-1", status: "running" }] };
  }
  throw new Error(`Unexpected SQL in mock: ${sql.slice(0, 100)}`);
});
```

Throw-på-unexpected-call er hva som skiller en regulator-grade-test fra en "best effort"-test.

## Vanlige feil og hvordan unngå dem

| Feil | Symptom | Fix |
|---|---|---|
| Bruker `vitest` for backend | Import-feil med `.js`-extensions | Backend = `tsx --test`. Frontend = `vitest`. |
| `npm test` krasjer pga manglende DB | "ECONNREFUSED 127.0.0.1:5432" | Pakk inn i `{ skip: !PG_URL ? "..." : null }` |
| Snapshot-test med generisk navn | Vanskelig å feilsøke når den feiler | Bruk `<state>-<scenario>` i test-navn |
| Chaos-test forutsetter docker-compose | CI uten Docker fanger ikke regressions | Skeleton-test når env-vars mangler |
| Mock som ALDRI feiler | Bug-er som mocken godtok når prod-DB ville rejected | Throw på unexpected SQL |
| R8/health-tests uten wiring-regression | Service deklarert men aldri startet | Skriv source-level-test (BIN-823-mønster) |

## Kanonisk referanse

- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §3.3 (R2/R3-krav), §6.1 (go/no-go-policy)
- `apps/backend/src/__tests__/chaos/r2FailoverInvariants.test.ts` — I1-I5-invarianter (kommentar-blokk er spec)
- `apps/backend/src/__tests__/chaos/r3ReconnectInvariants.test.ts` — reconnect-spec
- `infra/chaos-tests/r2-failover-test.sh` — driver-script
- `apps/backend/src/observability/__tests__/RoomAlertingService.test.ts` — eksempel på 16+ snapshot-tester for state-machine
- `docs/operations/R2_FAILOVER_TEST_RESULT.md` — siste R2-resultat
- `docs/operations/R3_RECONNECT_TEST_RESULT.md` — siste R3-resultat
- `docs/operations/R9_SPILL2_LEAK_TEST_RESULT.md` — leak-test-mønster

## Når denne skill-en er aktiv

- Skrive nye tester for live-rom-kode (Spill 1/2/3 engines, master handshake, draw-tick, payout)
- Endre eksisterende chaos-tester eller invariants
- Spawn-e en agent som skal lage R2/R3/R10-tester
- Verifisere at en service som er DI-injisert faktisk er wired inn (regresjons-mønster)
- Sette opp test-infrastruktur for nye state-machines (snapshot per state)
- Refaktorere mocks til regulator-grade kvalitet
- Pre-pilot-validering av at alle pilot-gating-tester er grønne
