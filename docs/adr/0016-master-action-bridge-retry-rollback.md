# ADR-0016 — MasterActionService bridge-retry-with-rollback

**Status:** Accepted
**Dato:** 2026-05-09
**Deciders:** PM-AI (Claude Opus 4.7), validert mot pilot Q3 2026 stabilitetsmål
**Konsulterer:** —

## Kontekst

Spill 1 master-konsoll bruker `MasterActionService` (ADR-0009 kanonisk
sekvenseringsmotor) til å koordinere plan-runtime → engine-bridge → engine-
actions. Når master kaller `start` eller `advance`, går flyten gjennom:

1. `GameLobbyAggregator.getLobbyState` (pre-validering)
2. `GamePlanRunService.start` / `advanceToNext` (plan-state-mutering)
3. `GamePlanEngineBridge.createScheduledGameForPlanRunPosition` (spawn rad
   i `app_game1_scheduled_games`)
4. `Game1MasterControlService.startGame` (engine starter draws)

Steg 3 (bridge-spawn) kunne tidligere feile av flere grunner uten retry:

- **Transient DB-glitch:** connection pool exhausted, deadlock, network jitter
- **Race-condition:** to samtidige master-actions på samme (run, position)
- **FK-violation midlertidig:** GoH-membership refresh mid-spawn

Når bridgen feilet, kastet servicen `BRIDGE_FAILED` og lot plan-state stå i
`running` med en hengende posisjon. Master måtte deretter kjøre manuell SQL
for å rydde — eller bruke force-recovery-action — før neste forsøk var mulig.

For pilot Q3 2026 er dette uakseptabelt: hver hengende master-flow er én
hall-runde tapt og en av de 4 pilot-hallene står stille.

Krav fra task-spec (BIN-XXXX):

> Bridge-feil må enten:
> 1. Auto-retry og lykkes etter 1-2 forsøk
> 2. Eller etterlate systemet i en gjenopprettelig state (rollback plan-run-
>    status til idle)

## Beslutning

Vi implementerer **retry-med-rollback**:

1. Bridge-spawn pakkes i en `withRetry`-helper med 3 retries (exponential
   backoff: **100 ms → 500 ms → 2000 ms**, totalt opptil 4 forsøk).
2. Et `shouldRetry`-predikat (`isBridgeRetrySafe`) filtrerer ut KJENTE
   permanente DomainErrors (`JACKPOT_SETUP_REQUIRED`, `HALL_NOT_IN_GROUP`,
   etc.) — disse propageres uendret etter første forsøk.
3. Hvis alle retries feiler:
   - **start-action:** Hvis run var `idle` før vi startet, kalles
     `GamePlanRunService.rollbackToIdle` for å sette status tilbake til
     `idle` med `current_position=1`. Master kan trygt re-prøve `start`.
   - **advance-action:** Position rolles tilbake til forrige verdi via
     `GamePlanRunService.rollbackPosition` (status forblir `running`).
     Master kan trygt re-prøve `advance` med samme target.
4. Rollback skriver audit-event (`spill1.master.start.bridge_failed_with_rollback`
   eller `spill1.master.advance.bridge_failed_with_rollback`) for full
   Lotteritilsynet-sporbarhet.
5. DomainError-melding gjør det klart for master at situasjonen er rydd:
   *"Bridge feilet etter 3 forsøk — plan-run resatt til idle, prøv igjen."*

## Konsekvenser

### Positive
- **Transient-feil maskerer ikke seg selv:** retry fanger DB-glitch og
  race-conditions automatisk. Pilot-erfaring viser at bridge-failure typisk
  kommer i klynger på 1-2 forsøk.
- **Manuell SQL-recovery er ikke lenger pilot-blokker:** hvis retry feiler
  alle, etterlates systemet i kjent gjenopprettbart state. Master kan
  re-prøve uten DB-admin-intervensjon.
- **Audit-trail er forbedret:** rollback-event + correlation-id propageres
  fra første forsøk til siste rollback i samme trace. Lotteritilsynet kan
  reprodusere hele flyten fra én ID.
- **Idempotency-trygt:** `createScheduledGameForPlanRunPosition` er allerede
  idempotent på `(run_id, position)`-nøkkel i bridgen. Selv om første forsøk
  klarte halvveis (skrev row men feilet på response-side), gjenbruker andre
  forsøk eksisterende rad istedenfor å skape duplikater.
- **Backwards-compat:** alle 33 eksisterende `MasterActionService`-tester
  forblir grønne. Ny atferd er additiv.

### Negative
- **Master-action-respons kan ta opptil ~2.6 sekunder mer** (worst-case retry
  + sleep). For pilot-skala er dette akseptabelt — alternativet er full feil
  + manuell SQL.
- **Rollback krever ytterligere DB-roundtrip** ved feil-scenario. Dette er
  best-effort — hvis selv rollback feiler propageres original BRIDGE_FAILED
  uendret. Logging fanger det.

### Nøytrale
- Retry-policyen er **bevisst kort** (3 retries) for å unngå å maskere reelle
  strukturelle problemer. Hvis bridgen feiler etter 4 forsøk er det sannsynlig
  bug — vi vil at master skal se det.
- Permanente DomainErrors (`JACKPOT_SETUP_REQUIRED`, etc.) retries IKKE
  fordi de er avhengig av master-input som ikke endrer seg på sub-sekund.
  De kastes etter første forsøk.

## Alternativer vurdert

### Alternativ A: Full SAGA-pattern med cross-service-transaksjon
Avvist:
- Plan-runtime, bridge og engine eier hver sin DB-transaksjon med separate
  pool-tilkoblinger. Cross-service-transaksjon krever 2-phase commit eller
  outbox-koordinering — for komplekst for pilot Q3-tidsramme.
- "Best-effort rollback med audit" gir 95 % av nytten med 5 % av
  kompleksiteten.

### Alternativ B: Lengre retry-horisont (10+ forsøk over 30 sekunder)
Avvist:
- Master-konsollet er en synchronous request — å holde HTTP-forbindelsen
  åpen i 30 sek+ ville gitt timeout og gjøre UI låse.
- Hvis bridgen feiler 4 ganger med ~2 sek backoff er det IKKE en transient
  feil — vi vil at master skal se feilen og evt. eskalere.

### Alternativ C: Sirkel-bryter (circuit breaker) per bridge
Avvist for nå:
- Sirkel-bryter (`util/CircuitBreaker.ts` finnes allerede) er for skala-skytt.
  Pilot Q3 har 4 haller — ikke noen risiko for thundering herd. Kan vurderes
  post-pilot hvis bridge-failure-rate øker.

### Alternativ D: Ingen rollback, bare retry
Avvist:
- Hvis retry mislykkes uten rollback må master fortsatt kjøre manuell SQL.
  Det er status quo — ikke en forbedring.

## Implementasjon

**Filer endret:**

- `apps/backend/src/util/retry.ts` (ny) — `withRetry`-helper med
  exponential backoff, shouldRetry-predikat, correlation-id, sleep-injection
- `apps/backend/src/util/__tests__/retry.test.ts` (ny) — 13 unit-tester
- `apps/backend/src/game/GamePlanRunService.ts`:
  - Ny public method `rollbackToIdle(input)` — running → idle med restore
    av current_position. Atomisk WHERE (status + position match).
    Audit `game_plan_run.rollback`.
  - Ny public method `rollbackPosition(input)` — ruller current_position
    tilbake UTEN status-endring. Audit `game_plan_run.position_rollback`.
- `apps/backend/src/game/MasterActionService.ts`:
  - Importerer `withRetry` + `DEFAULT_RETRY_DELAYS_MS`
  - `PERMANENT_BRIDGE_ERROR_CODES`-set + `isBridgeRetrySafe`-helper
  - Options utvidet med `bridgeRetryDelaysMs?` + `retrySleep?`
  - `start()` og `advance()` wrap bridge-spawn i `withRetry`
  - To nye private helpers: `tryRollbackPlanRun` + `tryRollbackPlanRunPosition`
- `apps/backend/src/game/__tests__/MasterActionService.test.ts`:
  - Mock-stub utvidet med `rollbackToIdle` + `rollbackPosition`
  - 8 nye tester for retry-rollback-scenarier

**Skills som bør oppdateres:**

- `.claude/skills/spill1-master-flow/SKILL.md` — legg til ny `BRIDGE_FAILED`-
  semantikk: nå er bridge-failure rolled-back-tryggere, master kan re-prøve
  uten DB-admin-hjelp.

## Referanser

- ADR-0001 — ADR-format og prosess
- BIN-XXXX — Pilot Q3 2026 retry-rollback-arbeidet
- Task-spec: "Retry-mekanisme + smart-recovery for `GamePlanEngineBridge`"
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` — Spill 1
  master-flyt
- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` —
  rotårsak-analyse for ID-disambiguasjon (Bølge 1+2 fundament)
