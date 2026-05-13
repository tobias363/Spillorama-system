# Mutation testing — Stryker

**Status:** Aktiv (etablert 2026-05-13)
**Eier:** Backend-team + PM-AI
**Cadence:** Ukentlig (søndag 00:00 UTC) via `.github/workflows/mutation-test-weekly.yml`
**Skill-ref:** `vitest`, `casino-grade-testing`

---

## Hvorfor mutation-testing?

Spillorama-pilot Q3 2026 har én vanntett kvalitetskrav: kritiske
race-conditions og state-mismatch-bugs (eks. I14 plan-run vs scheduled-game-
ID-mismatch, I16 master-action-timing-bug) skal aldri lande i prod uten å
være fanget av tester. Tradisjonelle line/branch-coverage-metrics måler
KUN at en kodelinje ble eksekvert, ikke at testene faktisk **påvirkes** av
endringer i logikken.

Mutation-testing løser dette ved å:

1. Generere mange små "mutanter" av kildekoden (eks. `>` → `>=`, `&&` → `||`)
2. Kjøre test-suite mot hver mutant
3. Rapportere hvor mange mutanter som overlevde uten å bli oppdaget

Hvis 30 % av mutantene overlever, har testene din 30 % blind-flekk — selv
med 100 % line-coverage. Dette er den faktiske test-styrken som pilot-go-
live krever for Tier-A-kode.

**Tobias-direktiv 2026-05-13** (§2.12):
> "Hvis en bug sees 2+ ganger, MÅ test skrives FØRST som reproduserer, deretter fix."

Mutation-testing er målestokken som forteller oss om de testene faktisk er
sterke nok til å fange neste regresjon.

---

## Hvilke filer mutateres?

Per `apps/backend/stryker.config.json`-feltet `mutate`:

| Fil | LOC | Rasjonale |
|---|---|---|
| `src/game/MasterActionService.ts` | 2077 | Sekvenseringsmotor for master-actions. I16 var et state-mismatch-bug her. Enhver mutasjon som overlever er en potensiell prod-regresjon. |
| `src/game/Game1LobbyService.ts` | 700 | Kanonisk lobby-state. Bridge mellom plan-run-id og scheduled-game-id. I14 var her. |
| `src/game/Game1HallReadyService.ts` | 1029 | Per-hall ready-state med GoH-bindings. Master kan starte uten klare haller (ADR-0021), men ready-state må fortsatt være korrekt for telemetri og audit. |
| `src/game/GamePlanRunService.ts` | 1203 | Plan-run lifecycle. Stale-plan-run auto-cleanup (2026-05-09) bor her. |
| `src/wallet/WalletOutboxWorker.ts` | 170 | Outbox-worker som drainer wallet-eventer til Postgres + Socket.IO. Casino-grade idempotens forutsetter at workeren er rakk-trygt. |

Total mutert kode: ~5180 LOC. **Dry-run 2026-05-13 bekreftet 2386 mutanter
generert** (Stryker default-mutator-sett: ArithmeticOperator, ArrayDeclaration,
BlockStatement, BooleanLiteral, ConditionalExpression, EqualityOperator,
LogicalOperator, osv.). Det er ~0.46 mutanter per LOC — Stryker er
selektiv om hva som er meningsfullt å mutere.

**Initial test-run-tid: 22 sekunder** (4.5 s net + 17.5 s TypeScript-
checker-overhead). Med `perTest`-coverage-analysis kjører hver mutant kun
de testene som dekker den linja. Estimert full run-tid: ~30-50 min lokalt,
~50-80 min på CI-runner (2-vCPU). Det er hvorfor mutation-testing IKKE er
per-PR-gate.

---

## Hvordan kjøre

### Lokalt (full run)

```bash
cd apps/backend
npm install            # første gang — installerer Stryker-deps
npm run test:mutation
```

Resultat rapporteres i `apps/backend/reports/mutation/mutation.html`. Åpne:

```bash
npm --prefix apps/backend run test:mutation:report
```

### Lokalt (subset — for utvikling av Stryker-config)

Stryker har dessverre ikke en CLI-flag for å overstyre `mutate`-feltet uten å
redigere config. For å teste på én fil under utvikling:

1. Edit `apps/backend/stryker.config.json`
2. Sett `mutate` til kun ett element
3. Kjør `npm run test:mutation`
4. Revert config FØR du committer

### Dry-run (validerer config uten å kjøre mutanter)

```bash
npm --prefix apps/backend run test:mutation:dry-run
```

Brukes for å verifisere at:
- TAP-runner finner alle test-filene
- TypeScript-checker er fornøyd med projektet
- Config-validering er grønn

Dry-run kjører kun selve test-suite én gang (ingen mutasjon) og rapporterer
hvor lang tid det tok. Det er proxy for hvor lang full mutasjon vil ta.

### CI (weekly)

Workflow `mutation-test-weekly.yml` kjører hver søndag 00:00 UTC. Artifacts
(HTML + JSON-rapport) blir lastet opp til Actions med 30 dagers retention.

Workflow er **ikke** et blocking-gate på PR-er — for sakte (~60 min).

---

## Hvordan tolke mutation-score

Stryker rapporterer en **mutation score**:

```
mutation score = (killed + timeout) / (killed + timeout + survived + noCoverage)
```

| Score-bånd | Threshold (vår config) | Tolkning |
|---|---|---|
| ≥ 80 % | `high` | Sterk test-suite — kan trygt deploye til pilot |
| 60-80 % | `low` | Akseptabel for ikke-kritisk kode, må styrkes for Tier-A |
| 50-60 % | mellom `break` og `low` | Advarsel — neste mutasjon kan slå CI |
| < 50 % | under `break` | CI feiler (informasjons-only — workflow stoppes ikke) |

For pilot Q3 2026 forventer vi å starte rundt 50-65 % på muterte filer.
Mål er **≥ 75 % på alle Tier-A-filer innen pilot-go-live**.

### Mutant-statuser

| Status | Hva det betyr |
|---|---|
| `Killed` | Mutant ble oppdaget av minst én test — bra |
| `Timeout` | Mutant skapte infinite-loop — bra (Stryker tolker som detected) |
| `Survived` | INGEN test feilet på denne mutanten — **dette er din blind-flekk** |
| `NoCoverage` | Mutant ble aldri eksekvert av noen test — du har coverage-gap |
| `RuntimeError` | Mutant krasjer ved kjøring (eks. typesfeil) — Stryker ignorerer |
| `CompileError` | Mutant feiler TypeScript-check — Stryker ignorerer (det er hva typescript-checker gjør) |

`Survived` og `NoCoverage` er der du skal fokusere innsatsen din når du
leser HTML-rapporten. Hver overlevd mutant er en kode-endring som testene
ikke fanget — i prod ville den endringen passere CI.

---

## Hvordan legge til ny fil i mutation-scope

1. Verifiser at det finnes minst én tilhørende `*.test.ts`-fil
2. Edit `apps/backend/stryker.config.json` `mutate`-feltet
3. Legg til tilsvarende test-fil i `tap.testFiles` (Stryker kjører kun de
   testene som er listet — for ytelse)
4. Test lokalt med `npm run test:mutation:dry-run` først
5. Hvis dry-run er grønn, kjør full mutation lokalt på den ene filen
6. Commit + PR

---

## Tekniske valg

### Hvorfor TAP-runner i stedet for vitest-runner?

Brief sa "Test runner: vitest" men `apps/backend` bruker `tsx --test`
(Node's built-in test-runner). Node `--test` produserer TAP-output. Stryker
har en `@stryker-mutator/tap-runner` som passer eksakt til denne setupen.

Migrering av backend fra `node --test` til vitest hadde vært en
~10-15 dagers refaktor (130+ test-filer). Det er ute av scope for denne
oppgaven. Vi bruker tap-runner som er semantisk ekvivalent for våre formål.

`@stryker-mutator/vitest-runner` er fortsatt riktig valg for
`apps/admin-web/` og `packages/game-client/` (begge bruker vitest), men
dette er foreløpig ute av scope (kun backend muteres i denne første
iterasjonen).

### Hvorfor ikke per-PR-gate?

Full mutation-run tar 30-60 min. Det er for sakte for PR-gate-bruk.
Per-PR-gates skal ferdige innen 5 min. Mutation-testing er en
**kvalitetsmålestokk**, ikke en sikkerhetsmekanisme — den skal kjøres
periodisk for å spore om test-styrken degraderer over tid.

Hvis vi senere ønsker per-PR-feedback, kan vi:
- Mutere kun de filene som endres i diff (Stryker `--incremental`-mode)
- Sample 100 mutanter i stedet for alle (`--mutationRate=0.1` el. lign.)

Men det er post-pilot-arbeid.

### Hvorfor `coverageAnalysis: "perTest"`?

Stryker har tre coverage-strategier:
- `off`: kjør alle tester for hver mutant (treigest, men ufeilbarlig)
- `all`: kjør alle tester én gang, anta at samme tester dekker alle mutanter
- `perTest`: bygg per-test-coverage-map, kjør kun relevante tester per mutant

`perTest` er ~10x raskere enn `off`. TAP-runner støtter perTest-coverage
direkte. Hvis vi får merkelige resultater (mutanter som "overlever" men
burde dø), kan vi alltid falle tilbake til `all` eller `off`.

---

## Kjente begrensninger

1. **Første run er sakte.** Forvent 30-60 minutter for full suite.
2. **Database-tester muteres ikke effektivt.** Mutanter som krever
   integration-tester med ekte Postgres vil ofte `Timeout` (Stryker tolker
   det som detected, men det er svakt signal). Mockede services er bedre.
3. **`MasterActionService.ts` er 2077 LOC.** Det er den største filen i
   scope. Mutasjon kan ta 20-30 min på den filen alene.
4. **Stryker krever skrive-tilgang til repo-root** (`.stryker-tmp/`). Vi
   har lagt mappen i `.gitignore` (sjekk at det stemmer før første merge).

---

## Relaterte ADR-er

Ingen ADR påkrevd for denne første iterasjonen — mutation-testing er en
ren tooling-add som ikke endrer arkitektur. Hvis vi senere bestemmer at
mutation-score skal være pilot-gating-kriterium, lager vi ADR da.

## Relaterte docs

- [`AGENT_EXECUTION_LOG.md`](./AGENT_EXECUTION_LOG.md) — agent-leveranser
- [`docs/auto-generated/MUTATION_BASELINE.md`](../auto-generated/MUTATION_BASELINE.md) — baseline-numre
- [`docs/engineering/PITFALLS_LOG.md`](./PITFALLS_LOG.md) — §6 (test-fallgruver)
- [`docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md`](./PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md) — overordnet test-strategi

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — Stryker mutation-testing etablert. Tap-runner (ikke vitest pga backend bruker `node --test`). 5 Tier-A-filer i scope. Weekly cron. | Backend-agent |
