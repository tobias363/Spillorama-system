# Mutation-testing baseline

> **AUTO-OPPDATERES** av `.github/workflows/mutation-test-weekly.yml` etter
> hver weekly mutation-run. Følg likevel med — Stryker oppdager
> regresjoner som tradisjonell coverage ikke ser.

**Generert:** 2026-05-13 (initial baseline før første run)
**Verktøy:** StrykerJS 9.6.1 + `@stryker-mutator/tap-runner`
**Cadence:** Hver søndag 00:00 UTC
**Konfig:** `apps/backend/stryker.config.json`

Se [`docs/engineering/MUTATION_TESTING.md`](../engineering/MUTATION_TESTING.md)
for full rasjonale og tolkning.

---

## Mål (pilot Q3 2026)

Pre-pilot: hver Tier-A-fil ≥ 75 % mutation score.
Stretch-mål: ≥ 80 % på filer som har vært involvert i bug (MasterActionService, Game1LobbyService).

Threshold-bånd i config:
- `high`: 80 % (grønt)
- `low`: 60 % (gult)
- `break`: 50 % (rødt — CI rapporterer non-zero exit, men workflow er informational-only)

---

## Tier-A-filer i scope

| Fil | LOC | Test-filer |
|---|---|---|
| `src/game/MasterActionService.ts` | 2077 | 1 test-fil (`src/game/__tests__/MasterActionService.test.ts`) |
| `src/game/Game1LobbyService.ts` | 700 | 1 test-fil (`src/game/Game1LobbyService.test.ts`) |
| `src/game/Game1HallReadyService.ts` | 1029 | 3 test-filer (basic + hallStatus + req007) |
| `src/game/GamePlanRunService.ts` | 1203 | 3 test-filer (basic + goh + dateRowToString) |
| `src/wallet/WalletOutboxWorker.ts` | 170 | 1 test-fil (`src/wallet/WalletOutboxWorker.test.ts`) |
| **Sum** | ~5180 | 9 test-filer |

### Faktiske dry-run-numre (2026-05-13)

Dry-run verifisert lokalt med Stryker 9.6.1:

| Metric | Verdi |
|---|---|
| Project-filer skannet | 1157 |
| Filer mutert | 5 (matcher `mutate`-feltet) |
| Mutanter generert (instrumentert) | **2386** |
| Test-filer kjørt under dry-run | 9 |
| Initial test-run-tid (én gang gjennom hele suiten) | **22 sekunder** (4.5s net + 17.5s TypeScript-checker-overhead) |
| Estimert full mutation-run-tid (lokal, conc=4) | **~30-50 min** |
| Estimert full mutation-run-tid (CI, conc=2-4) | **~50-80 min** |

`coverageAnalysis: "perTest"` betyr at hver mutant kun kjører de testene
som faktisk dekker den linja. Det vil typisk være 1-3 tester per mutant,
ikke alle 9 — så reell run-tid kan være vesentlig under verstefall.

---

## Baseline-historikk

Tabellen fylles ut etter første weekly cron-kjøring.

| Dato | Total score | MasterActionService | Game1LobbyService | Game1HallReadyService | GamePlanRunService | WalletOutboxWorker | Run-time |
|---|---|---|---|---|---|---|---|
| 2026-05-13 | _venter første run_ | _venter_ | _venter_ | _venter_ | _venter_ | _venter_ | _venter_ |

### Notater per run

Hver weekly cron oppdaterer denne tabellen via PR fra
`mutation-test-weekly.yml`. Manuelle dypdykk og diff-analyser kan dokumenteres som egne notater
nedenfor.

#### 2026-05-13 — Initial setup
- Etablerte Stryker-konfig (`apps/backend/stryker.config.json`)
- **Dry-run verifisert lokalt:**
  - `npm run test:mutation:dry-run` → eksit 0
  - "Initial test run succeeded. Ran 9 tests in 22 seconds (net 4579.955043 ms, overhead 17435.044957 ms)"
  - "The dry-run has been completed successfully. No mutations have been executed."
- Stryker fant 5 av 1157 filer å mutere (matcher mutate-feltet)
- 2386 mutanter instrumentert totalt
- Første full-run scheduled for søndag etter merge (eller på-vent kjøring via `workflow_dispatch`)

---

## Hvordan tolke regresjon

Hvis ukens score er **lavere enn forrige uke** på minst én fil:

1. **Diff `mutation.json`** mellom denne uke og forrige uke (Stryker-rapporter
   beholdes i Actions-artifacts i 90 dager).
2. **Identifiser nye `Survived`-mutanter** — disse er mutanter som forrige
   uke ble drept, men denne uke overlevde.
3. **Sjekk om disse mutantene faller i kode som er endret denne uka.**
   - Hvis ja: ny kode mangler test-coverage → skriv test
   - Hvis nei: en eksisterende test har blitt svekket (assertion fjernet,
     mock for løs) → revurder testen
4. **Dokumenter funn i denne fila** under "Notater per run"

## Hvordan tolke forbedring

Score øker over tid er bra. Men:

- Hvis score går **fra 60 % til 90 %** på én uke uten store kode-endringer,
  sjekk om noen muterte filer ble fjernet fra `mutate`-feltet.
- Hvis noen filer er fjernet fra scope, dokumenter hvorfor i
  `MUTATION_TESTING.md`.

---

## Relaterte filer

- [`docs/engineering/MUTATION_TESTING.md`](../engineering/MUTATION_TESTING.md)
- [`.github/workflows/mutation-test-weekly.yml`](../../.github/workflows/mutation-test-weekly.yml)
- [`apps/backend/stryker.config.json`](../../apps/backend/stryker.config.json)
