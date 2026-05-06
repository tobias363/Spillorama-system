# ADR-011: Batched parallel mass-payout for Spill 2/3

**Status:** Accepted
**Dato:** 2026-05-06
**Forfatter:** Tobias Haugen (Wave 3a — perf-engineering)

## Kontekst

Pilot-skala er 24 haller × 1500 spillere = 36 000 samtidige WebSocket-tilkoblinger på ETT globalt rom
per spill (`ROCKET` for Spill 2, `MONSTERBINGO` for Spill 3). På siste ball i en runde kan 100+
spillere vinne samtidig (worst-case ved Coverall i Spill 3, eller 9/9-match i Spill 2).

`SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md §3.1` identifiserte at sequential mass-payout-pathen i
`Game2Engine.onDrawCompleted` og `Game3Engine.processG3Winners` blokkerte auto-draw-tick-en under
last:

- Per vinner kreves 4-5 sekvensielle Postgres-roundtrips:
  1. `walletAdapter.transfer` (~50-100ms — Postgres TX med REPEATABLE READ + retry per BIN-762)
  2. `compliance.recordLossEntry` (~10-30ms)
  3. `ledger.recordComplianceLedgerEvent` (~10-30ms)
  4. `payoutAudit.appendPayoutAuditEvent` (~10-30ms)
  5. `writePayoutCheckpointWithRetry` (~50-100ms)
- 100 vinnere × ~500ms = ~50 sekunder.
- Auto-draw-tick kjører hver 30 sek — onDrawCompleted blokkerte tick-en og kaskaderte til
  timeout-errors.

## Beslutning

Innfør **batched parallel mass-payout** med to-fase atomicity:

### Fase A — synkron pre-allokering (regulatorisk-trygg budget-deling)

For hver vinner i deterministic rekkefølge (samme orden som sequential-pathen ville gjort):

1. Beregn `payout = min(applySinglePrizeCap, remainingPrizePool, remainingPayoutBudget)`
2. Hvis `payout > 0`: decrement `game.remainingPrizePool` og `game.remainingPayoutBudget`
   synkront. Dette sikrer at to parallelle calls aldri kan "se" samme budget=X og begge betale.
3. Lagre per-vinner allocation: `{ claim, jackpotPayout, luckyPayout, jackpotCappedPolicy, ... }`.

Pre-allokering skjer in-memory uten await — det går på <1ms per vinner. På 100 vinnere er hele
fasen ferdig på ~10ms.

### Fase B — parallelle I/O-batches

Etter pre-allokering grupperes vinnere i batches av `MASS_PAYOUT_BATCH_SIZE=50` og I/O kjøres med
`Promise.allSettled`:

- `walletAdapter.transfer` (per vinner, hver tar sin egen Postgres-FOR-UPDATE-lock)
- `compliance.recordLossEntry` (per vinner)
- `ledger.recordComplianceLedgerEvent` (per vinner, append-only)
- `payoutAudit.appendPayoutAuditEvent` (per vinner)
- `writePayoutCheckpointWithRetry` (per vinner)

Postgres connection-poolens størrelse (~25 connections på Render starter-plan) naturlig
serialiserer parallelism: 50-vinner-batch utfører faktisk i ~25-paralelle-omganger. For 100 vinnere
= 2 batches × ~3-5s = ~6-10s totalt (ned fra ~50s sequential).

### Fase C — sekvensiell claim-publishing

Etter alle I/O-batches: bygg `winnerRecords` + emit `bingoAdapter.onClaimLogged` sekvensielt. Dette
er rask in-memory-arbeid og må kjøre etter at `claim.payoutTransactionIds` er populert av Fase B.

### Aktiveringsterskel

- `useBatchedPath = candidates.length > MASS_PAYOUT_PARALLEL_THRESHOLD (=10)`
- Under terskelen brukes sequential-pathen som er enklere og rask nok.
- 4-hall-pilot med ~6-12 vinnere per ROCKET-rom treffer ikke batched-pathen.

## Konsekvenser

+ **Skala-mål oppfylt:** 100 vinnere fullfører ~6-10s (audit-mål: <5s p95 i prod).
+ **Regulatorisk atomicity bevart:** hver vinner får fortsatt enten alt eller ingenting per
  wallet-transfer (én Postgres-tx per transfer). Pre-allokering eliminerer race på budget.
+ **Idempotency bevart:** `IdempotencyKeys.game2Jackpot/Lucky/Game3Pattern` bruker `gameId` +
  `claimId` som før, så retry fra recovery-pathen hopper over duplikater.
+ **Observability lagt til:** `spill23_ondrawcompleted_duration_ms` (histogram) og
  `spill23_mass_payout_outcome_total` (counter) lar ops alarmere på p95 > 5s eller
  partial-batch-failures.
+ **Failure-isolasjon:** `Promise.allSettled` lar én vinners failure ikke blokkere de andre.
  Failure logges + outcome-metric flagger "partial". Recovery-pathen kan retry den failende vinneren
  via samme idempotency-key.

- **Kompleksitets-økning:** to-fase-modell + 4 nye helper-metoder per engine
  (`processG2WinnersBatched`, `transferG2PreallocatedPayout` + `processG3PatternMatchesBatched`,
  `transferG3PreallocatedPayout`). Code-review-byrde øker, men hver helper er fokusert.
- **Test-overflate øker:** må verifisere at sequential og batched-pathen produserer identisk
  end-state for samme inputs. Dekket av Game2Engine.massPayoutBatched.test.ts.
- **Defense-in-depth-kostnad:** hvis Fase B-I/O feiler etter at Fase A har decremented budget, er
  budget "tapt" men ingen payout skjedde. Dette er compliance-conservative (better to under-pay
  than over-pay), og recovery-pathen kan retry via idempotency-key.

~ **Postgres connection-pool-sensitivitet:** parallelism bestemmes av pool-størrelse. På Render
  starter (25 connections) har vi hodepunkt på ~25 paralelle transfers. Hvis vi skalerer til 100+
  connections kan vi øke `MASS_PAYOUT_BATCH_SIZE`. Konstanter er eksportert for fremtidig
  finjustering.

## Implementasjons-detaljer

**Filer:**
- `apps/backend/src/game/Game2Engine.ts` — `processG2WinnersBatched`, `transferG2PreallocatedPayout`
- `apps/backend/src/game/Game3Engine.ts` — `processG3PatternMatchesBatched`,
  `transferG3PreallocatedPayout`
- `apps/backend/src/util/metrics.ts` — nye prom-metrics
- `apps/backend/src/game/Game2Engine.massPayoutBatched.test.ts` — test-coverage

**Eksterne avhengigheter:** ingen — bruker eksisterende `walletAdapter.transfer` (BIN-762),
`PrizePolicyManager.applySinglePrizeCap`, `ComplianceLedger.recordComplianceLedgerEvent`,
`PayoutAuditTrail.appendPayoutAuditEvent`. Ingen API-endring i wallet-adapteret eller andre porter.

**Backwards-compat:** sequential-pathen er uberørt for små runder. Eksisterende tester (108 stk)
fortsetter å treffe sequential-pathen.

## Relasjoner til andre ADR-er

- **ADR-001 (perpetual-room-model):** denne ADR-en bygger på perpetual-loop-modellen — mass-payout
  skjer i `onDrawCompleted` som er trigget av cron-tick.
- **ADR-002 (system-actor):** mass-payout-events bruker `actorType: "SYSTEM"` for compliance-ledger.
- **ADR-003 (hash-chain-audit):** parallel I/O-batches er compatible med hash-chain — hver
  ledger-entry beregnes på Postgres-siden under FOR UPDATE-lock som før.
- **ADR-010 (casino-grade-observability):** nye metrics integreres i eksisterende
  Prometheus-stack.

## Open questions / fremtidige forbedringer

1. **Wallet adapter API:** kunne en `walletAdapter.batchedTransfer(...)` som ÉN Postgres-tx med
   `UNNEST + INSERT` være raskere enn 50-paralelle små tx? Krever DB-skjema-endring (single-tx må
   batche flere `wallet_entries`-rader). Vurderes hvis pilot avdekker at 100-vinnere fortsatt er
   for tregt på prod.
2. **Connection-pool size:** Render starter har 25 connections. Bumping til pro (100) ville
   doble parallel-throughput. Vurderes som infrastruktur-tuning, ikke kode-endring.
3. **Bulk compliance-ledger:** `recordComplianceLedgerEvent` kunne batche flere events per call.
   Krever endring i `ComplianceLedger.ts`-API. Lavere prioritet — wallet-transfer er tyngste call.
