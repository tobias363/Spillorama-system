# Mutation-testing baseline

> **AUTO-OPPDATERES** av `.github/workflows/mutation-test-weekly.yml` etter
> hver weekly mutation-run. Følg likevel med — Stryker oppdager
> regresjoner som tradisjonell coverage ikke ser.

**Generert:** 2026-05-13 (first run baseline + survivor-driven test additions)
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
| `src/game/Game1LobbyService.ts` | 914 | 1 test-fil (`src/game/Game1LobbyService.test.ts`) |
| `src/game/Game1HallReadyService.ts` | 1029 | 3 test-filer (basic + hallStatus + req007) |
| `src/game/GamePlanRunService.ts` | 1203 | 3 test-filer (basic + goh + dateRowToString) |
| `src/wallet/WalletOutboxWorker.ts` | 170 | 2 test-filer (basic + **survivors** — ny 2026-05-13) |
| **Sum** | ~5393 | 10 test-filer |

### Dry-run-numre (2026-05-13)

Dry-run verifisert lokalt med Stryker 9.6.1:

| Metric | Verdi |
|---|---|
| Project-filer skannet | 1159 |
| Filer mutert | 5 (matcher `mutate`-feltet) |
| Mutanter generert (instrumentert) | **2452** (oppdatert fra 2386 i pre-baseline doc) |
| Test-filer kjørt under dry-run | 9 |
| Initial test-run-tid (én gang gjennom hele suiten) | **5 sekunder** (i isolert kjøring; 22s ved samtidighet med andre Stryker-prosesser) |
| Estimert full mutation-run-tid (lokal, conc=4) | **~5-8 timer** observert ved første full-suite-poll (alle 5 filer parallelt; sterk overhead pga TypeScript-checker) |
| Estimert full mutation-run-tid (CI, conc=2-4) | **~50-80 min** for ren CI-runner (lavere kontensjon) |

**Strategi (etter 2026-05-13 første-iterasjon-funn):** Per-file mutation-runs er **vesentlig** raskere enn full-suite. Bruk en `stryker.<File>.config.json` per fil-isolasjon når du itererer på survivors-testing.

`coverageAnalysis: "perTest"` betyr at hver mutant kun kjører de testene
som faktisk dekker den linja. Det vil typisk være 1-3 tester per mutant,
ikke alle 9 — så reell run-tid kan være vesentlig under verstefall.

---

## Baseline-historikk

| Dato | Total score | MasterActionService | Game1LobbyService | Game1HallReadyService | GamePlanRunService | WalletOutboxWorker | Run-time |
|---|---|---|---|---|---|---|---|
| 2026-05-13 (baseline) | _venter on Plan/Master_ | _venter_ | 39.20 → **48.86** ↑ | 48.38 → **53.62** ↑ | _venter_ | 46.00 → **82.00** ↑↑ | ~2.5-16 min per fil |

### Notater per run

Hver weekly cron oppdaterer denne tabellen via PR fra
`mutation-test-weekly.yml`. Manuelle dypdykk og diff-analyser kan dokumenteres som egne notater
nedenfor.

#### 2026-05-13 — Initial baseline + survivor-tester for WalletOutboxWorker

- Etablerte Stryker-konfig (`apps/backend/stryker.config.json`)
- **First-run-resultat for WalletOutboxWorker (170 LOC, 64 mutanter):**

**Pre-tester (kun original test-fil):**
| Kategori | Antall |
|---|---|
| Killed | 22 |
| Survived | **14** |
| NoCoverage | **13** |
| Timeout | 1 |
| Errors | 14 |
| **Mutation score** | **46 %** (BELOW BREAK 50%) |

Run-tid: 2 min 6 s.

**Etter survivors-tester (`src/wallet/WalletOutboxWorker.survivors.test.ts` — 18 nye tester):**

| Kategori | Antall | Endring |
|---|---|---|
| Killed | 38 | +16 |
| Survived | **9** | -5 |
| NoCoverage | **0** | -13 |
| Timeout | 3 | +2 |
| Errors | 14 | 0 |
| **Mutation score** | **82 %** | **+36 prosentpoeng** ↑↑ |

Run-tid: 2 min 44 s.

**Konklusjon:**
- Score **over `high`-threshold (80 %)** — passerer mutation-test-mandatet for pilot Q3 2026.
- Alle no-coverage mutanter eliminert (defaultDispatcher, auto-tick via setInterval, markFailed-failure path, outer-catch).
- Gjenværende 9 survivors er hovedsakelig:
  - 2 StringLiteral i `console.error/debug`-meldinger (equivalent mutants — log-strenger har ingen funksjonell effekt)
  - 1 BlockStatement i defaultDispatcher body (equivalent — console.debug-call)
  - 1 OptionalChaining på `timer.unref?.()` — equivalent i node-environment der unref alltid eksisterer
  - 1 ConditionalExpression i stop() while-loop (deadline-konsistens; mutant `true` blir alltid sann, men deadline-sjekken hindrer infinite-loop)
  - 1 EqualityOperator i stop() while-loop (samme — boundary mellom `<` og `<=` på timestamp er praktisk-equivalent)
  - 1 BlockStatement i outer catch (logger-only — funksjonell oppførsel uendret hvis logger fjernes)

#### 2026-05-13 — Initial baseline for Game1HallReadyService

- Stryker kjørt på 488 mutanter for `Game1HallReadyService.ts` (1029 LOC). Run-tid: 16 min 12 s.
- **Pre-tester (kun originale 3 test-filer):**

| Kategori | Antall |
|---|---|
| Killed | 194 |
| Survived | 139 |
| NoCoverage | 68 |
| Timeout | 0 |
| Errors | 87 |
| **Mutation score** | **48.38 %** (UNDER BREAK 50 %) |

**Hovedklynger av survivors:**
- Linje 1000-1006 (computeHallStatus soldCount-beregning): 18+ survivors
- Linje 977-984 (computeHallStatus hasPhysicalFlow + scan-detection): 13+ survivors
- Linje 918 (countPhysicalSoldForHall finite check): 6 survivors
- Linje 832 (resetReadyRowsForNextRound logging): 5 survivors
- Linje 261-263 (markReady scheduled/purchase_open guard): 4 survivors
- StringLiteral i error-melding-strenger: ~31 survivors (de fleste equivalent — log-strenger)

**Etter survivors-tester (`src/game/Game1HallReadyService.survivors.test.ts` — 20 nye tester for `computeHallStatus`):**

| Kategori | Antall | Endring |
|---|---|---|
| Killed | 215 | +21 |
| Survived | 118 | -21 |
| NoCoverage | 68 | 0 |
| Timeout | 0 | 0 |
| Errors | 87 | 0 |
| **Mutation score** | **53.62 %** | **+5.24 prosentpoeng** ↑ |

Run-tid: 15 min 27 s.

**Konklusjon:**
- Over `break`-threshold (50%) — passerer pilot Q3 2026-mandatet ikke ennå (krever ≥ 75%).
- 20 nye tester fokuserte på `computeHallStatus` pure function — drepte 21 mutants i den klyngen.
- 118 survivors gjenstår — dominert av:
  - 68 no-coverage mutanter (mest StringLiteral i ubenyttede error-strenger og logging-paths)
  - 31 StringLiteral-mutanter (mange equivalent — log/error-strenger uten funksjonell effekt)
  - 52 ConditionalExpression-mutanter spredt over flere services
- Neste iterasjon: utvide tester for `markReady`, `unmarkReady`, `sweepStaleReadyRows`, og scan-flyten.

#### 2026-05-13 — Initial baseline + survivors-tester for Game1LobbyService

**Pre-tester (kun original test-fil — 30 tester):**

| Kategori | Antall |
|---|---|
| Killed | 69 |
| Survived | **49** |
| NoCoverage | **58** |
| Timeout | 0 |
| Errors | 140 |
| **Mutation score** | **39.20 %** (UNDER BREAK 50 %) |

Run-tid: 7 min 33 s. 316 mutanter.

**Hovedklynger av survivors (pre):**
- Linje 667 (ticketPricesCents > 0 filter): 6 survivors
- Linje 582, 795, 899 (auto-reconcile-paths): 3 hver
- Linje 220-225 (TIME_REGEX + timeToMinutes): 4 survivors
- Linje 326-336 (ZOD-validering for Game1LobbyState): 12 nocov-mutanter

**Etter survivors-tester (`src/game/Game1LobbyService.survivors.test.ts` — 16 nye tester):**

| Kategori | Antall | Endring |
|---|---|---|
| Killed | 86 | +17 |
| Survived | 41 | -8 |
| NoCoverage | 49 | -9 |
| Timeout | 0 | 0 |
| Errors | 140 | 0 |
| **Mutation score** | **48.86 %** | **+9.66 prosentpoeng** ↑↑ |

Run-tid: 8 min 45 s.

**Konklusjon:**
- Kun marginalt under `break`-threshold (48.86 vs 50). Score nesten tredoblet i forhold til pre-baseline-distansen.
- Nye tester drepte 17 mutants + eliminerte 9 no-coverage mutanter.
- 16 nye tester targeted: ticketPricesCents-filter, bonusGameOverride-prioritet, TERMINAL_SCHEDULED_GAME_STATUSES set, TIME_REGEX, h*60+m beregning.
- 41 survivors + 49 nocov gjenstår — dominert av:
  - 140 errors er TypeScript-compile-failures (faktisk healthy signal — type-system fanger mutasjoner)
  - StringLiteral-mutanter på logger.warn-meldinger (mange equivalent)
  - 12 nocov i ZOD-schema-validering (linje 326-336) — kunne testes med invalid input fixture
  - Auto-reconcile-detaljer (linje 582, 795, 899) — kunne testes med DB-write-mock

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
