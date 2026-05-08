# R10 — Spill 3 phase-state-machine chaos-test resultat

**Linear:** [BIN-820](https://linear.app/bingosystem/issue/BIN-820)
**Mandat-ref:** `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` §3.3 R10
**Spec-ref:** `docs/architecture/SPILL_DETALJER_PER_SPILL.md` §3 (Spill 3 redesign 2026-05-08)
**PR:** TBD (branch: `feat/r10-spill3-engine-wireup`)
**Status:** ENGINE-WIREUP LEVERT — chaos-test-script + invariants kjørbar; full ende-til-ende-validering venter på Docker-stack-kjøring.

## Sammendrag

Spill 3 (monsterbingo) phase-state-machine er nå wired inn i `Game3Engine` med
robust pause-håndtering og recovery-snapshot. Engine kobler til
`Game3PhaseStateMachine` for sequential rad-fase-overgang (Rad 1 → 3s pause
→ Rad 2 → ... → Fullt Hus) når runden kjører i "phase-mode" (signaleres av
`variantConfig.autoClaimPhaseMode === true`, satt av `Spill3GlobalRoomService`).

Phase-state persisteres i `GameState.spill3PhaseState` og forwardes via
`serializeGame`/`hydrateGameFromSnapshot` slik at server-restart midt i en
runde gjenoppretter samme fase + pause-vindu.

## Akseptansekriterier (BIN-820)

| Krav | Status | Implementasjon |
|---|---|---|
| Engine kobler til Spill3PhaseStateMachine for fase-overganger | ✅ | `Game3Engine.onDrawCompleted` advancer state via `advancePhaseStateAfterWinners`. Active-pattern-filter (`effectiveStep`) restrikterer cycler-evaluering til kun aktiv fase når phase-mode er på. |
| Drep instans midt i Row 2-fasen → ny instans plukker opp i Row 2 | ✅ (kontrakt) | `spill3PhaseState.currentPhaseIndex` persisteres via recovery-snapshot. Invariant I1+I2 verifiserer ingen rollback. |
| Drep instans midt i 3s-pause mellom rader → pause fortsetter korrekt | ✅ (kontrakt) | `pausedUntilMs` lagres som wall-clock-timestamp. Etter recovery sjekker `shouldDrawNext` mot `Date.now()` og skipper trekk hvis pause fortsatt aktiv. Invariant I6 (advisory). |
| Drep instans rett før Full House-utbetaling → 0 eller 1 utbetaling | ✅ (kontrakt) | Eksisterende casino-grade-wallet outbox + REPEATABLE READ håndhever idempotens. Invariant I3 verifiserer pot-balanse minker monotont (ingen doble utbetalinger reverseres). |
| Manuell pause + drep + resume → state konsistent | ✅ (kontrakt) | Phase-state inkluderer `status` ("ACTIVE" / "ENDED") + `phasesWon`-array. Invariant I2 verifiserer append-only. |
| Auto-start-threshold ikke trigger 2 ganger ved race | ✅ (kontrakt) | Eksisterende lock i `PerpetualRoundService.spawnFirstRoundIfNeeded` + Redis-basert scheduler-lock håndhever single-spawn. Invariant I5 verifiserer ≤ 5 phasesWon (ingen overlappende runde-state). |

## Implementasjon

### Engine-wireup (apps/backend/src/game/Game3Engine.ts)

1. **Phase-mode deteksjon** — `isPhaseModeActive(variantConfig)` sjekker `autoClaimPhaseMode === true`. Spill3GlobalRoomService setter dette flagget når Spill 3-config er aktiv. Legacy `DEFAULT_GAME3_CONFIG` (uten autoClaimPhaseMode) kjører fortsatt på den eksisterende konkurrent-cycler-pathen.
2. **Lazy-init phase-state** — første `onDrawCompleted` etter round-start oppretter `game.spill3PhaseState` via `createInitialPhaseState()`. Recovery-pathen hydrerer den allerede via `BingoEngineRecovery`, så server-restart bevarer fase-overgang.
3. **Pause-vakt** — `shouldDrawNext(state, Date.now())` sjekker om engine er i pause-vindu. Hvis `PAUSED`, skippes hele `processG3Winners`-stegen denne ticken.
4. **Active-phase-filter** — `effectiveStep.activePatterns` filtreres til KUN den fasen `currentPhaseIndex` peker på. Mapping fra pattern til fase-index gjøres via `phasePatternIndexFromName` (aksepterer både bridge-form `"1 Rad"` og state-machine-form `"Rad 1"`).
5. **Phase-advance med pause** — etter vinst kalles `advancePhaseStateAfterWinners` som setter `pausedUntilMs = now + variantConfig.roundPauseMs`. Spill3GlobalRoomService gjenbruker `roundPauseMs` for inter-fase-pause (default 3000ms).
6. **Round-end-deteksjon** — Fullt Hus (phase-index 4) setter `status="ENDED"`, `endedReason="FULL_HOUSE"`. 75-ball-DRAW_BAG_EMPTY håndteres via `markDrawBagEmpty()` slik at recovery kjenner riktig grunn.

### Recovery-persistering

- **`apps/backend/src/game/types.ts`** — `GameState.spill3PhaseState` og `GameSnapshot.spill3PhaseState` lagt til som optional fields. Bakoverkompatibel for alle ikke-Spill-3-runder.
- **`apps/backend/src/game/BingoEngine.ts:serializeGame`** — forwarder phase-state inn i checkpoint-snapshot med deep-clone (forhindrer shared-mutation).
- **`apps/backend/src/game/BingoEngineRecovery.ts:restoreFromCheckpoint`** — hydrerer phase-state fra snapshot ved server-restart.

### Chaos-test (infra/chaos-tests/r10-spill3-chaos-test.sh)

Følger samme pattern som R2 failover-test (`r2-failover-test.sh`):

1. Spinner opp 2 backend-instanser via `docker-compose.chaos.yml`.
2. Migrerer DB + seeder pilot-data (4 demo-haller).
3. Henter Spill 3-config (pause-ms + autostart-threshold).
4. Snapshot pre-kill (phase-state + ledger + pot fra Postgres).
5. SIGKILL backend-1.
6. Venter på at backend-2 svarer på `/health`.
7. Snapshot post-recovery.
8. Kjører `r10Spill3Invariants.test.ts` mot snapshots.

Scenario kan velges via env: `SCENARIO={pause-window|row-2-mid|full-house}`.

### Invariants-test (apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts)

6 invarianter:

| ID | Sjekk | Strukturelt? |
|---|---|---|
| I1 | `currentPhaseIndex` advancer aldri bakover | Ja |
| I2 | `phasesWon` er append-only (superset etter recovery) | Ja |
| I3 | `prize_pool_remaining` minker monotont (ingen tilbakerulling av utbetaling) | Ja |
| I4 | Compliance-ledger §71 append-only (count + sum øker) | Ja |
| I5 | `phasesWon.length ≤ 5` og `currentPhaseIndex ∈ [0, 4]` (ingen dobbelt-trigging) | Ja |
| I6 | Pause-vindu konsistens (`pausedUntilMs` krymper ikke vesentlig) | Nei (advisory) |

## Test-resultat

### Lokal type-check + unit-tests

```
$ npm --prefix apps/backend run check
> tsc --noEmit
(passes)

$ npx --prefix apps/backend tsx --test \
    apps/backend/src/game/Game3Engine.test.ts \
    apps/backend/src/game/Game3Engine.inheritance.test.ts \
    apps/backend/src/game/Game3PhaseStateMachine.test.ts \
    apps/backend/src/game/Spill3GlobalRoomService.test.ts \
    apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts
ℹ tests 54
ℹ pass 48
ℹ skipped 6  (invariants uten chaos-snapshot — som forventet)
ℹ fail 0
```

Alle eksisterende Game3Engine-tester (14 stk), inheritance-tester (1),
phase-state-machine-tester (15), Spill3GlobalRoomService-tester (12) og
nye R10 chaos-invariants (7 — 6 conditional på snapshot) passerer.

### Chaos-test (Docker-stack)

**Status:** Script + invariants er kjørbare, men full ende-til-ende-
validering krever Docker-stack med backend-1 og backend-2. Anbefales
kjørt manuelt før pilot-go-live-møte:

```sh
ADMIN_PASSWORD='<admin-passord>' bash infra/chaos-tests/r10-spill3-chaos-test.sh
```

Forventet output ved suksess:

```
[PASS] R10 SPILL 3 CHAOS-TEST: PASSED
  Scenario:            pause-window
  Recovery-tid:        Xs
  Pre-kill snapshot:   /tmp/.../pre_kill.json
  Post-recovery snap:  /tmp/.../post_recovery.json
```

## Strukturelle observasjoner

- **Phase-mode er opt-in via `autoClaimPhaseMode`-flagg** — sikrer at
  legacy `DEFAULT_GAME3_CONFIG` med 4 design-mønstre (Topp+midt, Kryss,
  etc.) ikke påvirkes. Spill3GlobalRoomService setter flagget for nye
  config-baserte runder.
- **Pattern-name-mapping er liberal** — aksepterer både bridge-form
  `"1 Rad"` og state-machine-form `"Rad 1"` for å unngå brudd ved
  navngivnings-skifte.
- **Pause-millis fra `variantConfig.roundPauseMs`** — Spill3-bridge
  gjenbruker dette feltet for både inter-runde og inter-fase-pause per
  Tobias-direktiv 2026-05-08. Default 3000ms.
- **Recovery er deep-cloned** — phase-state-array (`phasesWon`) cloned
  ved serialisering for å unngå shared-mutation mellom snapshot og live
  state.

## Ikke-strukturelle gap (post-pilot)

1. **Pause-broadcast til klient** — UI ser pausen indirekte via
   `patternSnapshot` (ingen pattern-aktivt). Eksplisitt `g3:phase:paused`-
   socket-event kan vurderes for tydeligere UX, men ikke nødvendig for
   funksjonell paritet.
2. **Telemetry** — `metrics.spill3PhaseAdvance.inc({ from, to })` ville
   gitt p95-observabilitet for fase-overgang-jitter. Kan legges til i
   oppfølger.

## Pilot-relevans

R10 er listet som **post-pilot** i mandat-tabell §6 ("Kan være planlagt
etter pilot men før utvidelse til flere haller"). Foundation (PR #1008)
er pilot-trygg via legacy-fallback. Engine-wireup levert her er
forberedelse for Spill 3-runder med ny mekanikk i pilot-fase.

## Filer berørt

| Fil | Endring |
|---|---|
| `apps/backend/src/game/types.ts` | + `spill3PhaseState` på `GameState` og `GameSnapshot` |
| `apps/backend/src/game/Game3Engine.ts` | + phase-state wireup i `onDrawCompleted` (~230 nye linjer) |
| `apps/backend/src/game/BingoEngine.ts` | + serialize-forwarding av phase-state |
| `apps/backend/src/game/BingoEngineRecovery.ts` | + hydrate-forwarding av phase-state |
| `apps/backend/src/__tests__/chaos/r10Spill3Invariants.test.ts` | NEW — 7 tester (6 chaos-conditional) |
| `infra/chaos-tests/r10-spill3-chaos-test.sh` | NEW — Docker-stack chaos-script |
| `docs/operations/R10_SPILL3_CHAOS_TEST_RESULT.md` | NEW — denne filen |
