# Game1-tjeneste-konsolidering — design-dok

**Status:** PM-godkjent (Alternativ B) 2026-04-21. Start post-pilot.
**Dato:** 2026-04-21 (addendum 2026-04-21)
**Forfatter:** Agent 3 (audit-funn #2)
**Scope:** Refactor av 6 Game1-backend-tjenester (totalt ~3661+ linjer i de 4 største)
**Beslutning kreves:** Godkjenn plan / endre scope / utsett

---

## 1. Nåværende tilstand

### 1.1 Tjenester og størrelse

| Fil | Linjer | Kjerneansvar |
|---|---|---|
| Game1MasterControlService | 962 | Master-konsoll: start/exclude/pause/stop + audit |
| Game1DrawEngineService | 923 | Trekking, grid-generering, auto-completion |
| Game1ScheduleTickService | 888 | Daglig tick: spawn, open, cancel, transition, timeout-detect |
| Game1TicketPurchaseService | 888 | Kjøp + refund, digital/agent, idempotent via key |
| Game1HallReadyService | ~400 | Per-hall ready-flip + purchase-cutoff-guard |
| Game1RecoveryService | ~250 | Boot-level crash-recovery, auto-cancel overraskede |

### 1.2 Offentlig API (kondensert)

- **Master:** `startGame / excludeHall / includeHall / pauseGame / resumeGame / stopGame / recordTimeoutDetected / getGameDetail / setDrawEngine`
- **DrawEngine:** `startGame / drawNext / pauseGame / resumeGame / stopGame / getState / listDraws / generateGridForTicket`
- **ScheduleTick:** `spawnUpcomingGame1Games / openPurchaseForImminentGames / cancelEndOfDayUnstartedGames / transitionReadyToStartGames / detectMasterTimeout`
- **TicketPurchase:** `purchase / refundPurchase / listPurchasesForGame / listPurchasesForBuyer / assertPurchaseOpen / getPurchaseById`
- **HallReady:** `markReady / unmarkReady / getReadyStatusForGame / allParticipatingHallsReady / assertPurchaseOpenForHall`
- **Recovery:** `runRecoveryPass`

### 1.3 Avhengighets-graf

```
MasterControl ──setDrawEngine──▶ DrawEngine ──listPurchases──▶ TicketPurchase
                                                                  │
TicketPurchase ──assertPurchaseOpenForHall──▶ HallReady           │
                                                  ▲                │
ScheduleTick ──allParticipatingHallsReady────────┘                │
                                                                   │
Recovery (boot-only) — ingen indirekte kall til andre tjenester, bare DB + audit-format
```

### 1.4 Faktisk overlapp (korreksjon av audit-funn)

Audit-påstanden var: *"alle tre rører ticket-generering, payout-validering, state-håndtering, compliance-sjekk"*. Research viser at påstanden **er delvis feil** i PR 1-5 scope:

| Område | Reell status |
|---|---|
| Ticket-generering | **Ekte overlapp** mellom DrawEngine (`generateGridForTicket`) og TicketPurchase (`validateTicketSpecAgainstConfig`) — begge parser `ticket_config_json` |
| Payout-validering | **Ingen overlapp i PR 1-5.** RTP/single-prize/pool-guard er ikke implementert ennå (planlagt PR 4c+). BingoEngine `ComplianceManager` er ikke kablet inn |
| State-håndtering | **Samarbeid, ikke duplisering.** 3 separate state-maskiner (scheduled_game-status, game_state, hall_ready_status). Hver tjeneste eier sin tabell. MasterControl delegerer POST-commit til DrawEngine |
| Compliance-sjekk (Spillvett/cutoff) | **Guard-pattern, ikke overlapp.** TicketPurchase kaller HallReady.assertPurchaseOpenForHall. Ikke duplisert logikk |

**Konsekvens:** Foreslått refactor-omfang bør reduseres. Se seksjon 7, Alternativ B.

---

## 2. Mål-arkitektur (Alternativ A — full coordinator)

```
                    Game1EngineCoordinator
                    (orkestrator, 200-300 linjer)
                             │
      ┌──────────────┬───────┼────────┬──────────────┬─────────────┐
      ▼              ▼       ▼        ▼              ▼             ▼
 TicketAllocator  PhaseEvaluator  PayoutValidator  StateMachine  ScheduleTicker  RecoveryRunner
 (ex-Purchase)    (ex-Master      (NY — samler      (ex-Master   (ex-Schedule-   (ex-Recovery)
                  pre-conditions)  RTP/cap-sjekk    actions)     Tick)
                                   når PR 4c
                                   kommer)
```

**Prinsipp:** Kun coordinator importerer fra moduler. Ingen kryss-imports mellom moduler.

## 3. Interface-signaturer (Alternativ A)

```typescript
// Coordinator — offentlig API som erstatter dagens tjeneste-entry-points
interface Game1EngineCoordinator {
  // Master-konsoll
  startGame(input: StartGameInput): Promise<MasterActionResult>;
  excludeHall(input: ExcludeHallInput): Promise<MasterActionResult>;
  includeHall(input: IncludeHallInput): Promise<MasterActionResult>;
  pauseGame(input: PauseGameInput): Promise<MasterActionResult>;
  resumeGame(input: ResumeGameInput): Promise<MasterActionResult>;
  stopGame(input: StopGameInput): Promise<MasterActionResult>;
  // Drawing
  drawNext(scheduledGameId: string): Promise<Game1GameStateView>;
  // Purchase (delegerer til TicketAllocator)
  purchase(input: Game1TicketPurchaseInput): Promise<Game1TicketPurchaseResult>;
  refundPurchase(input: Game1RefundInput): Promise<void>;
  // Hall
  markHallReady(input: MarkReadyInput): Promise<HallReadyStatusRow>;
  // Read-only views
  getGameDetail(gameId: string): Promise<GameDetail>;
}

// Spesialiserte moduler (smal API, ikke offentlig utad)
interface TicketAllocator {
  validateSpec(spec: TicketSpec, config: RawConfig): ValidatedSpec;
  priceTicket(spec: ValidatedSpec, config: RawConfig): number;
  writePurchase(tx: Tx, input: PurchaseInput): Promise<PurchaseRow>;
  refundPurchase(tx: Tx, purchaseId: string): Promise<void>;
}
interface PhaseEvaluator {
  canTransitionTo(game: Game, target: Status): Result<void>;
  meetsPhaseRequirement(game: Game, actor: Actor): Result<void>;
}
interface PayoutValidator {   // Placeholder — ikke implementert før PR 4c
  validateWin(pattern: Pattern, pool: Pool): Result<void>;
}
interface StateMachine {
  applyAction(tx: Tx, game: Game, action: MasterAction): Promise<StateResult>;
}
interface ScheduleTicker {   // Autonom, ikke kalt via coordinator
  runTick(nowMs: number): Promise<TickResult>;
}
interface RecoveryRunner {   // Boot-only
  runRecoveryPass(nowMs: number): Promise<RecoveryRunResult>;
}
```

## 4. Migrasjonsplan (fase for fase)

| Fase | Innhold | Dager | Hvorfor denne rekkefølgen |
|---|---|---|---|
| 0 | Design-godkjent (denne doken) + `ARCHITECTURE.md` for Game1 | 0.5 | PM-alignment, frys scope |
| 1 | Extract `TicketAllocator` fra TicketPurchaseService. Ny fil + test + adapter som gjør TicketPurchaseService til tynn wrapper | 2 | Smalest modul, lav risiko, god test-dekning finnes allerede |
| 2 | Extract `PhaseEvaluator` fra MasterControlService. Pre-condition-sjekk flyttes til ren funksjon-modul | 1.5 | Lav kobling, enkel å isolere |
| 3 | Extract `StateMachine` (master-aksjoner) fra MasterControlService. Timeout-handling inkludert | 2.5 | Høyest test-tyngde, mest risiko på MasterControl |
| 4 | Introduser `Game1EngineCoordinator` som tynt orkestreringslag over modulene 1-3. Eksisterende tjenester blir wrappers | 2 | Additiv, bryter ikke utad-API |
| 5 | Flytt ScheduleTick til `ScheduleTicker`-modul, peker på Coordinator i stedet for andre tjenester | 1.5 | Autonomt job, enkel å flytte |
| 6 | Flytt Recovery til `RecoveryRunner`-modul | 0.5 | Triviell |
| 7 | Bytt route-handlers + socket-handlers til å kalle Coordinator direkte; fjern deprecated service-wrappers | 1.5 | Cleanup, fjerner teknisk gjeld fra fase 4 |
| 8 | PayoutValidator — **utsatt til PR 4c landet**, ikke del av denne refactor-runden | — | Finnes ikke ennå |

**Totalt (fase 0-7):** 11.5 dager (best case). Buffer +30% for regresjoner → **~15 dager / 3 uker realistisk.**

## 5. Risiko-vurdering per fase

| Fase | Tester som må forbli grønne | Største risiko |
|---|---|---|
| 1 | `Game1TicketPurchaseService.test.ts`, `Game1DrawEngineService.test.ts` (leser purchases) | Idempotency-key-semantikk under refactor; DrawEngine-integrasjon som leser purchases via samme API |
| 2 | `Game1MasterControlService.test.ts` | Pre-condition-logikk er subtil (hall-ready-snapshot-tidspunkt) |
| 3 | `Game1MasterControlService.test.ts`, `socketIntegration.test.ts` | Timeout-detect + audit-format. Stop-refund-semantikk (pilot-kritisk) |
| 4 | Alle over + `BingoEngine.fivePhase.test.ts`, `BingoEngine.splitRoundingLoyalty.test.ts` | Transitiv brudd via coordinator-wrapping |
| 5 | `Game1ScheduleTickService.test.ts` | Race med spawn vs open-purchase ved fase-skifte |
| 6 | `Game1RecoveryService.test.ts` | Lav |
| 7 | Alle over + e2e socket-integration | Route-handler-oppdatering |

## 6. Estimat og timing

- **Total refactor-effort:** ~15 dager (3 uker)
- **Beste start-tidspunkt:** **etter PR 4d + 4e er mergeret til main** (pilot-blokkere)
- **Ikke parallell-kjørbar** med PR 4d/4e: merge-konflikter i MasterControl + TicketPurchase vil spise timer

## 7. Alternativer vurdert og forkastet

### Alternativ A — Full coordinator (over)
**Pro:** Ren arkitektur, klar ansvarsdeling, testbar i isolasjon.
**Contra:** 15 dager, høy regresjonsrisiko, legger til et orkestreringslag som kun gir verdi hvis vi faktisk har kryss-modul-logikk (som vi ikke har mye av per nå).

### Alternativ B — Intra-fil splitting (anbefalt lett versjon)
Behold dagens 6 tjeneste-grenser (de reflekterer faktisk ansvar rimelig godt), men split hver >800-linjers fil i 3-5 submoduler i samme mappe:

```
apps/backend/src/game/game1-master/
  index.ts                    # eksporter (offentlig API)
  masterActions.ts            # start/pause/stop/resume (StateMachine-kjerne)
  phaseEvaluator.ts           # pre-condition-sjekk
  auditSnapshot.ts            # audit-rad-bygger
  timeout.ts                  # timeout-detect + record
```

Samme pattern for DrawEngine, TicketPurchase, ScheduleTick.

**Pro:**
- ~5 dager totalt (1 dag per tung tjeneste + 1 dag test-refactor)
- Ingen utad-API endres
- Lav regresjonsrisiko — hver PR dekker én tjeneste
- Ingen coordinator-abstraksjon før kryss-modul-behov faktisk oppstår (YAGNI / "Spill 1 først"-memoryen)

**Contra:**
- Coordinator-laget blir utsatt. Hvis kryss-modul-logikk dukker opp i PR 4c (payout) eller Spill 2-innhenting, må vi gjøre det da.

### Alternativ C — Gjør ingenting (forkastet)
900-linjers filer er vanskelige å navigere i Cursor/VS Code, men koden er faktisk godt strukturert internt. Å gjøre ingenting er forkastet fordi vi har to konkrete test-pain-punkter: (a) MasterControl-tester tar lenge å kjøre, (b) TicketPurchase-tester trenger mye mock-oppsett.

---

## 8. Anbefaling

**Gå for Alternativ B (intra-fil-splitting), IKKE Alternativ A, med mindre PR 4c+ introduserer faktisk kryss-modul payout-logikk som krever coordinator.**

**Begrunnelse:**
1. Audit-funnet overdrev den faktiske overlappen. Tjenestene er rimelig godt separert allerede.
2. YAGNI: Ikke bygg coordinator-lag før vi har kryss-modul-logikk å orkestrere.
3. 5 dager vs 15 dager — 3x raskere, 3x lavere risiko.
4. Kan fases inn med én PR per tjeneste — enklere gjennomgang + roll-back.
5. Alternativ A står åpent hvis vi senere ser at coordinator-lag gir verdi — Alternativ B låser oss ikke inne.

**Foreslått rekkefølge for Alternativ B (post-pilot):**
1. TicketPurchase-splitting (1.5 dag) — start her, best test-dekning
2. MasterControl-splitting (1.5 dag)
3. DrawEngine-splitting (1 dag)
4. ScheduleTick-splitting (1 dag)
5. HallReady + Recovery — ingen splitting nødvendig (<500 linjer hver)

## 9. Åpne spørsmål til PM

1. **Velg mellom A og B.** Min anbefaling: B. Er det greit?
2. **Skal payout-validering (PR 4c) drive refactor-omfanget?** Hvis coordinator-lag blir nødvendig der, er A verd den ekstra investeringen.
3. **Timing-vindu.** Bekreft at refactor ikke starter før PR 4d/4e er i main.
4. **Én agent eller flere?** Alternativ B kan parallelliseres (én agent per tjeneste), men krever nøye merge-koordinering gjennom PM.
5. **Test-dekning-krav før start.** Skal vi kreve 100% linjedekning på berørte tjenester før refactor, eller er eksisterende dekning OK?

---

## Appendiks: Kilder

- Avhengighetskart: `apps/backend/src/game/Game1*.ts` + `apps/backend/src/game/index.ts`
- Feature-flag: `GAME1_SCHEDULE_TICK_ENABLED` (kun ScheduleTickService, styrer job-registrering i `apps/backend/src/index.ts`)
- Regresjonstester definert som bindende av PM:
  - `apps/backend/src/game/BingoEngine.fivePhase.test.ts`
  - `apps/backend/src/game/BingoEngine.splitRoundingLoyalty.test.ts`
  - `apps/backend/src/game/Game1MasterControlService.test.ts`
  - `apps/backend/src/game/Game1DrawEngineService.test.ts`
  - `apps/backend/src/sockets/__tests__/socketIntegration.test.ts`

---

## Addendum 2026-04-21 — Re-vurdering mot PR 4c (#317, #319) i main

PM meldte: *"PR 4c har landet — du har kanskje mindre arbeid enn du trodde."*
**Konklusjon etter re-vurdering: Netto litt MER arbeid, ikke mindre. Men totalen forblir under 6 dager — Alternativ B står fortsatt klart bedre enn A.**

### Hva PR 4c faktisk gjorde med scope

| Fil | Status | Linjer | Merknad |
|---|---|---|---|
| Game1PayoutService | **NY** | 380 | Pattern-evaluering → winners → wallet-credit + split-rounding-audit + loyalty-hook |
| Game1PatternEvaluator | **NY** | 243 | Ren fase-pattern-matching (5x5 + fase 2-4 kolonner etter #319) |
| Game1JackpotService | **NY** | 187 | Per-farge-jackpot-evaluering + color-family-resolver |
| Game1AutoDrawTickService | **NY** | 254 | Auto-draw-tick som eier `drawEngine`-instans som privat felt |
| Game1DrawEngineService | **VOKST** | 923 → **1283** (+360) | Fikk `evaluateAndPayoutPhase` + `computePotCents` + `resolveWalletIdForUser` som privat orkestrering |

**Overraskende sannhet:** DrawEngine er ikke krympet; den er blitt en **draw-side-coordinator** (Alternativ A-pattern i miniatyr). PR 4c splittet UT tre tunge fagområder (pattern, payout, jackpot) til dedikerte tjenester, men la til orkestreringskode i DrawEngine for å kople dem sammen.

### Oppdatert fase 3 (DrawEngine-splitting)

**Før addendum:** 1 dag (923 linjer, lav koordinasjon).
**Etter addendum:** 1.5 dag (1283 linjer, eksisterende coordinator-pattern).

**Anbefalt tilnærming endret:** Fortsett PR 4c sitt mønster — flytt **interne private DrawEngine-metoder til egne service-filer** (ikke submoduler i samme fil, som opprinnelig Alternativ B foreskrev for de andre tjenestene). Konkret:

- `evaluateAndPayoutPhase` (linje 835-937, ~100 linjer) → `Game1PhaseEvaluationOrchestrator.ts` (ren orkestrering av PayoutService + PatternEvaluator + JackpotService)
- `generateTicketAssignments` (linje 775-835, ~60 linjer) → `Game1TicketAssignmentGenerator.ts` (grid-bygging per kjøp)
- `markBallOnAssignments` (linje 984-1021, ~37 linjer) → inn i samme assignment-generator-fil som hjelpefunksjon
- `buildStateView` + tx-helpers → blir værende i DrawEngine (de er infra, ikke fagområde)

Sluttresultat: DrawEngine krymper til ~800-850 linjer og blir tydelig orkestrerings-lag over PR 4c-tjenestene + nye assignment/evaluation-moduler.

### Ny fase 5 — audit av PR 4c-tjenestene

**0.5 dag**, read-only. Sjekk om PayoutService/PatternEvaluator/JackpotService/AutoDrawTickService har kryss-overlapp eller internt delbare ansvar. Første kjappe lesing antyder **NEI** (alle er godt fokuserte). Men bekreft før pilot kjøres.

### Oppdatert totalestimat

| Fase | Opprinnelig | Etter addendum | Kommentar |
|---|---|---|---|
| 1. TicketPurchase-splitting | 1.5 dag | 1.5 dag | Uendret |
| 2. MasterControl-splitting | 1.5 dag | 1.5 dag | Uendret |
| 3. DrawEngine-splitting | 1 dag | **1.5 dag** | Større fil, men tyngste logikk er allerede ute |
| 4. ScheduleTick-splitting | 1 dag | 1 dag | Uendret |
| 5. PR 4c-tjeneste-audit | — | **0.5 dag (NY)** | Bekreft ingen videre splitting nødvendig |
| HallReady + Recovery | Skip | Skip | <500 linjer |
| **Sum** | **5 dager** | **6 dager** | Fortsatt 2.5x raskere enn Alternativ A (15 dager) |

### Parallelisering-beskrankning (oppdatert)

Fase 3 (DrawEngine) må nå bemannes av én agent som forstår PR 4c-arkitekturen. Kan ikke gis til en agent som ser DrawEngine for første gang uten å lese PR 4c-tjenestene først. Ingen endring for fase 1, 2, 4.

### Oppdatert anbefaling

**Alternativ B står.** PR 4c bekreftet at spesialisert-tjeneste-ekstraksjon fungerer godt for dette kodebasen — det er allerede mønstret vi følger, bare ufullført på DrawEngine-siden.

**Ikke bygg Game1EngineCoordinator (Alternativ A).** Hvis kryss-tjeneste-orkestrering blir nødvendig senere, eksisterer DrawEngine allerede som draw-side-coordinator og AutoDrawTickService har allerede adopter-pattern mot DrawEngine. Resten av systemet (master/schedule/purchase) kobles inn via smale offentlige API-er som allerede er godt atskilt.

### Nye åpne spørsmål til PM

6. **Fase 3 ny tilnærming.** OK å flytte DrawEngines private metoder til egne service-filer (fortsette PR 4c-mønster) fremfor submoduler i samme fil?
7. **Fase 5 (PR 4c-audit).** Skal den drives av samme agent som fase 3, eller separat?
