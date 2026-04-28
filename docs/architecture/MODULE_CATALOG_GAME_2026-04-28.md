# Module-katalog del 1 — Game-domenet (`apps/backend/src/game/`)

**Dato:** 2026-04-28
**Forfatter:** Module-catalog-agent (Tobias-direktiv)
**Scope:** Kjerne-game-modulene under `apps/backend/src/game/`. Andre kataloger (adapters/, compliance/, sockets/, routes/, etc.) dekkes i del 2-N.

**Formål:** Sjekkliste-katalog for bug-jakt og pilot-debug. Når noe brekker i live spill — finn modulen, finn bug-mønsteret, hopp rett til `Read`-call.

**Hvordan bruke dette:**
1. Bug-rapport peker mot et symptom (eks. "Fullt Hus betaler dobbelt").
2. Slå opp Bug-testing-guide i hver modul — finn matchende symptom.
3. Les modulen + tilhørende test-fil.
4. Verifiser Regulatoriske implikasjoner før patching (§11/§66/§71).

---

## Master-index

| # | Modul | Path | LOC | Hva den gjør (1 linje) |
|---|---|---|---|---|
| 1 | BingoEngine | `BingoEngine.ts` | 4329 | Ad-hoc engine for Spill 1/2/3 — rooms, draws, tickets, claims, payout. Source of truth for in-flight room-state. |
| 2 | BingoEnginePatternEval | `BingoEnginePatternEval.ts` | 886 | Phase- og pattern-evaluator for Spill 1 (BIN-694 sekvensiell flyt). Pure helpers, multi-winner tie-breaker. |
| 3 | Game1DrawEngineService | `Game1DrawEngineService.ts` | 3103 | Scheduled-game draw-engine for Spill 1. Master-as-admin, multi-hall, draws via DrawBagStrategy. |
| 4 | Game1MasterControlService | `Game1MasterControlService.ts` | 1708 | Master-actions: startGame, excludeHall, pause/resume/stop. State-machine for app_game1_scheduled_games. |
| 5 | Game1HallReadyService | `Game1HallReadyService.ts` | 924 | Per-hall ready-state for scheduled-games. Sales-snapshot, scan-tracking, purchase-cutoff-helper. |
| 6 | Game1TicketPurchaseService | `Game1TicketPurchaseService.ts` | 1359 | Ticket-purchase + refund for scheduled-games. Idempotent, wallet-integrasjon, compliance-binding. |
| 7 | Game1PayoutService | `Game1PayoutService.ts` | 573 | Phase payout: split-rounding, wallet.credit, phase_winners-rad, loyalty-hook. |
| 8 | Game1JackpotStateService | `Game1JackpotStateService.ts` | 731 | Daglig akkumulerende jackpot per hall-gruppe (2k start, +4k/dag, 30k cap). |
| 9 | Game1JackpotService | `Game1JackpotService.ts` | 196 | Per-farge fixed-amount jackpot (Free Spin) ved Fullt Hus innen draw 50. Pure service. |
| 10 | Game1LuckyBonusService | `Game1LuckyBonusService.ts` | 174 | Lucky Number Bonus ved Fullt Hus når lastBall === luckyNumber. Pure service. |
| 11 | Game1ScheduleTickService | `Game1ScheduleTickService.ts` | 1033 | Cron-tick: spawn games, open purchase, cancel end-of-day. Idempotent state-progression. |
| 12 | Game1AutoDrawTickService | `Game1AutoDrawTickService.ts` | 360 | Global 1s-tick: trigger drawNext når `last_drawn_at + seconds <= now()`. |
| 13 | Game1TransferHallService | `Game1TransferHallService.ts` | 776 | 60s handshake for runtime master-overføring mellom haller. |
| 14 | Game1ReplayService | `Game1ReplayService.ts` | 723 | Audit-replay: rekonstruer event-strøm for avsluttet spill (PII-redacted). |
| 15 | Game1RecoveryService | `Game1RecoveryService.ts` | 327 | Schedule-state crash-recovery på boot. Cancel running/paused etter 2t timeout. |
| 16 | BingoEngineMiniGames | `BingoEngineMiniGames.ts` | 387 | Pure helpers for jackpot-spin og mini-games i ad-hoc-engine (Game 5/legacy). |
| 17 | Game1MiniGameOrchestrator | `minigames/Game1MiniGameOrchestrator.ts` | 1140 | Mini-game-rotasjon (wheel→chest→mystery→colordraft) etter Fullt Hus. |
| 18 | Game1DrawEngineDailyJackpot | `Game1DrawEngineDailyJackpot.ts` | 291 | DrawEngine-hook: trigger daglig-jackpot-award ved Fullt Hus innen threshold. |
| 19 | Game1DrawEnginePotEvaluator | `Game1DrawEnginePotEvaluator.ts` | 256 | Pot-evaluator-wiring: Innsatsen + akkumulerende pot-er per hall i drawNext. |
| 20 | variantConfig | `variantConfig.ts` | 709 | Config-presets: ticket-types, patterns, multipliers, sub-varianter (norsk/kvikkis/super-nils/...). |
| 21 | spill1VariantMapper | `spill1VariantMapper.ts` | 535 | Admin-UI → GameVariantConfig mapper for Spill 1. Per-farge premie-matrise. |
| 22 | ComplianceLedger | `ComplianceLedger.ts` | 612 | §11-ledger: append-only, daglig rapport, overskudd-fordeling. Re-eksporterer til 4 split-filer. |
| 23 | ComplianceManager | `ComplianceManager.ts` | 1054 | §66-håndhevelse: tapsgrenser, obligatorisk pause, frivillig pause, selvutestengelse. |
| 24 | Game2Engine | `Game2Engine.ts` | 537 | Spill 2 (Rocket): 3×3 / 1-21, auto-claim-on-draw, jackpot-tabell, lucky-bonus. Subclass av BingoEngine. |
| 25 | Game3Engine | `Game3Engine.ts` | 706 | Spill 3 (Mønsterbingo): 5×5 / 1-75, pattern-cycler, ball-threshold, multi-pattern-pris. Subclass. |

---

## Lese-anbefaling for Tobias (top 5)

For å forstå Spill 1 pilot-flyt — les i denne rekkefølgen:

1. **`Game1ScheduleTickService.ts`** — hvordan spill spawnes og opens purchase
2. **`Game1HallReadyService.ts`** — hvordan haller signaliserer "Klar" (ready-state-machine)
3. **`Game1MasterControlService.ts`** — hvordan master starter spillet (state-progression)
4. **`Game1DrawEngineService.ts`** — hvor drawNext kjører (det egentlige spillet)
5. **`Game1PayoutService.ts`** + **`BingoEnginePatternEval.ts`** — hvor folk får premier

`BingoEngine.ts` (4329 LOC) er den ad-hoc-baserte legacy-engine. Den brukes av Spill 2/3 (subclasser) og av tester, men IKKE av Spill 1 scheduled-games-flyten. Spill 1 i pilot bruker `Game1DrawEngineService`.

---

## 1. BingoEngine
**Path:** `apps/backend/src/game/BingoEngine.ts`
**LOC:** 4329

### Ansvar
Legacy ad-hoc room-engine. Eier in-process `RoomState` (rooms-map), draws, tickets, marks, claims, payout, jackpot, mini-games. Brukes av Spill 2/3 (subclasser) og legacy Spill 5 (Game5Engine). Spill 1 scheduled-games bruker IKKE denne — de bruker `Game1DrawEngineService`.

### Public API
- `class BingoEngine` — host-room-livssyklus
- `createRoom`, `joinRoom`, `startGame`, `drawNextNumber`, `markNumber`, `submitClaim`, `endGame`, `pauseGame`, `resumeGame`, `destroyRoom`
- `setLuckyNumber`, `chargeTicketReplacement` (BIN-615 luck/replace)
- `activateJackpot`/`spinJackpot`/`activateMiniGame`/`playMiniGame` (legacy delegerer til BingoEngineMiniGames)
- Compliance proxies: `getPlayerCompliance`, `setPlayerLossLimits*`, `setTimedPause`, `setSelfExclusion`, `assertWalletAllowedForGameplay`
- Reports: `awardExtraPrize`, `listPayoutAuditTrail`, `listComplianceLedgerEntries`, `runDailyReportJob`
- `class DomainError` — eksportert herfra; ALLE andre game-services importerer via `from "./BingoEngine.js"`.
- `lossLimitAmountFromTransfer(fromTx, total)` — split-aware loss-amount-helper for §11 deposit-only-rule.
- `ballToColumn(ball, maxBall)` — utility for B/I/N/G/O-mapping.

### Avhengigheter
- **Inn:** `BingoSystemAdapter`, `WalletAdapter`, `RoomStateStore` (in-memory eller Redis), `ComplianceManager`, `ComplianceLedger`, `PrizePolicyManager`, `PayoutAuditTrail`, `LoyaltyPointsHookPort`, `SplitRoundingAuditPort`, `BingoEnginePatternEval`, `BingoEngineMiniGames`.
- **Ut:** `Game2Engine` + `Game3Engine` extender. Sockets `gameEvents.ts` kaller direkte. `Game1DrawEngineService.destroyRoomForScheduledGame` kaller `destroyRoom`. Tester importerer `DomainError` herfra.

### State-management
**Stateful — in-process Maps:**
- `rooms` (RoomStateStore — in-memory eller Redis-backed)
- `lastDrawAtByRoom`, `roomLastRoundStartMs` (rate-limit timing)
- `drawLocksByRoom` (per-room mutex hindrer parallell drawNextNumber)
- `variantConfigByRoom`, `variantGameTypeByRoom`, `luckyNumbersByPlayer`

State persistert via `RoomStateStore` (Redis i prod, BIN-251). Crash-recovery i index.ts boot via `BIN-245`.

### Regulatoriske implikasjoner
- **§11:** `lossLimitAmountFromTransfer` — kun deposit-delen av buy-in teller som tap. Gevinst-konto-bruk skal IKKE øke netto-tap.
- **§66:** `assertWalletAllowedForGameplay` kalles før hver buy-in og hvert claim. Fail-closed på timed-pause / self-exclusion.
- **§71:** `submitClaim` skriver `ComplianceLedger.recordPrize` med hallId fra room (KAN være feil for multi-hall — se K1 fix i `Game1TicketPurchaseService`).

### Bug-testing-guide
- **Symptom: "DRAW_IN_PROGRESS"** → `drawLocksByRoom`-mutex kollisjon. Sjekk om to sockets sender `draw:next` samtidig.
- **Symptom: "Ingen variant-config for rommet"** → `variantConfigByRoom` ikke populert i `startGame`. Tidligere bug fikset; sjekk om setVariantConfig kalles.
- **Symptom: dobbel payout / dobbel debit** → idempotency-key-kollisjon. Sjekk `IdempotencyKeys.payout` / `IdempotencyKeys.buyIn`. Hver claim skal ha unik key (assignmentId + drawSeq).
- **Symptom: stale balance etter mini-game** → `refreshPlayerBalancesForWallet` ikke kalt. Sjekk `BingoEngineMiniGames` payout-paths.
- **Symptom: "Min round interval not elapsed"** → `roomLastRoundStartMs` blokkerer < 30s mellom runder. Forventet — ikke bug.
- **Symptom: Spill 2/3-rom oppfører seg som Spill 1** → `Game2Engine`/`Game3Engine`-override-guard feiler. Sjekk slug-detection (`isGame3Round`).

---

## 2. BingoEnginePatternEval
**Path:** `apps/backend/src/game/BingoEnginePatternEval.ts`
**LOC:** 886

### Ansvar
Phase + pattern evaluation for Spill 1 (BIN-694 sekvensiell flyt: 1 Rad → 2 Rader → ... → Fullt Hus). Pure helpers — ingen DB/I/O. Multi-winner-deterministisk tie-breaker (PR-T1).

### Public API
- `evaluateActivePhase(...)` — sekvensiell BIN-694-flyt, rekursiv hvis flere faser samtidig.
- `evaluateConcurrentPatterns(...)` — PR-P5 alternativ flyt (alle customPatterns parallelt).
- `computeCustomPatternPrize(pattern, pool, lastBall, ...)` — premie-formel per pattern (percent/fixed/multiplier-chain/column-specific/ball-value-multiplier).
- `detectPhaseWinners(tickets, drawnBalls, phase, gameType)` — flat- eller per-farge-gruppering.
- `meetsPhaseRequirement(ticketMask, phase, gameType)` — per-ticket fase-sjekk.
- `isSpill1Slug(slug)` — gameSlug-test for Spill 1 auto-pause.
- Konstanter: `FLAT_GROUP_KEY`, `UNCOLORED_KEY`.

### Avhengigheter
- **Inn:** `LoyaltyPointsHookPort`, `SplitRoundingAuditPort`, `PatternMatcher`, `ticket.ts` helpers, `spill1VariantMapper`, `variantConfig`, `BingoEngine.DomainError + ballToColumn`, `@spillorama/shared-types/spill1-patterns`.
- **Ut:** Kalles fra `BingoEngine.submitClaim` + `Game1DrawEngineService.drawNext` (fase-evaluering).

### State-management
**Stateless.** Mottar alt via parametere. Caller eier transaksjon + idempotency-key-generation.

### Regulatoriske implikasjoner
- **§11:** Premie-beregning (5 winningType-varianter) — alt utbetales via callback `payoutPhaseWinner`. Multi-winner-split bevarer `houseRetained`-rest til hus (audit-loggert).
- **PR-T1 deterministisk tie-breaker:** Lex-orden på playerId — sikrer at retries og crash-recovery alltid gir samme `firstWinnerId`. Tobias-krav: "100% sikkerhet at den bongen som først fullfører en rad får gevinsten — eller minst at det er deterministisk".

### Bug-testing-guide
- **Symptom: "Multi-winner-rekkefølge endres ved retry"** → tie-breaker brutt. Sjekk PR-T1 i `BingoEnginePatternEval.tieBreaker.test.ts`.
- **Symptom: "Fase 5 utbetales uten at fase 4 er løst først"** → BIN-694 sekvensiell flyt brutt. Sjekk recursion i `evaluateActivePhase`.
- **Symptom: "Premie er null på Super-NILS Fullt Hus"** → `winningType: "column-specific"` lookup. Sjekk `columnPrizesNok[col]` der col = `ballToColumn(lastBall, maxBall)`.
- **Symptom: "Ball × 10-premie er feil"** → `winningType: "ball-value-multiplier"` formel: `baseFullHousePrizeNok + lastBall × ballValueMultiplier`.
- **Symptom: "Multiplier-chain-premie er feil"** → fase 1 base × `phase1Multiplier`, ikke pool × percent. Spillernes spill: rad N = rad 1 × N.

---

## 3. Game1DrawEngineService
**Path:** `apps/backend/src/game/Game1DrawEngineService.ts`
**LOC:** 3103

### Ansvar
Master-as-admin scheduled-games draw-engine for Spill 1. Eier appens kritiske `drawNext`-loop: trekk ball → marks → fase-eval → payout → mini-game → jackpot. Multi-hall, parallell draw-strøm (IKKE BingoEngine-room-scoped).

### Public API
- `class Game1DrawEngineService`
- Setters (DI): `setPotService`, `setJackpotStateService`, `setPotDailyTickService`, `setWalletAdapter`, `setPhysicalTicketPayoutService`, `setMiniGameOrchestrator`, `setOddsenEngine`, `setBingoEngine`, `setAdminBroadcaster`, `setPlayerBroadcaster`.
- Lifecycle: `startGame(scheduledGameId, actor)`, `drawNext(scheduledGameId)`, `pauseGame`, `resumeGame`, `stopGame`, `destroyRoomForScheduledGameSafe`.
- Read: `getState`, `listDraws`, `getRoomCodeForScheduledGame`, `assignRoomCode`.
- Const: `DEFAULT_GAME1_MAX_DRAWS = 52`.
- `generateGridForTicket(...)` — utility for ticket-grid-generering.

### Avhengigheter
- **Inn:** `Pool`, `BingoEngine` (for room-cleanup), `Game1TicketPurchaseService`, `AuditLogService`, `Game1PayoutService`, `Game1JackpotService`, `Game1JackpotStateService`, `Game1LuckyBonusService`, `Game1PotService`, `Game1MiniGameOrchestrator`, `MiniGameOddsenEngine`, `WalletAdapter`, `PhysicalTicketPayoutService`, `PotDailyAccumulationTickService`, `Game1AdminBroadcaster`, `Game1PlayerBroadcaster`. Utils: `evaluatePhase`, `evaluatePhysicalTicketsForPhase`, `runAccumulatingPotEvaluation`, `runDailyJackpotEvaluation`.
- **Ut:** Kalles fra `Game1MasterControlService.startGame` (delegate), `Game1AutoDrawTickService.tick` (drawNext), socket-handlers (`game1Events.ts`).

### State-management
**DB-only state.** Service holder ingen in-process state — leser/skriver app_game1_*-tabeller. Idempotent retries via DB-state. Eneste in-process state er DI-injisert pekere til andre services.

### Regulatoriske implikasjoner
- **§11:** drawNext er den ENESTE atomic-transaksjonen som binder draw + payout + ledger + pot-eval. Failure her → ROLLBACK alt.
- **§71:** `complianceLedgerPort.recordPrize` skrives per vinner per fase med `winner.hallId` (K1-fix BIN-443) — IKKE master-hallens id.
- **§66:** Compliance ikke direkte håndhevet her; håndteres av `Game1TicketPurchaseService` ved kjøp (via `assertWalletAllowedForGameplay`).
- **Crash-recovery:** Service idempotent — `last_drawn_at` + `next_auto_draw_at` brukes for at AutoDrawTick ikke trigger duplisert.

### Bug-testing-guide
- **Symptom: "Ball trukket dobbelt"** → drawNext-mutex eller `draws_completed`-counter feil. Sjekk transaksjons-isolation.
- **Symptom: "Mini-game trigget før payout"** → Rekkefølge i drawNext: payout → daily-jackpot → mini-game. Sjekk `triggerMiniGamesForFullHouse` posisjon.
- **Symptom: "Fullt Hus betaler kun til master-hall"** → K1 compliance-bug (FIKSET BIN-443). Verifiser `complianceLedgerPort` får winner.hallId, ikke schedule-game.master_hall_id.
- **Symptom: "Auto-draw stopper etter resume"** → `last_drawn_at` ikke oppdatert eller `paused=true` ikke clearet. Sjekk `pauseGame`/`resumeGame`-flyt.
- **Symptom: "Dobbel payout ved retry"** → Idempotency-key for payout. Sjekk `IdempotencyKeys.payout(scheduledGameId, phase, drawSeq, assignmentId)`.

---

## 4. Game1MasterControlService
**Path:** `apps/backend/src/game/Game1MasterControlService.ts`
**LOC:** 1708

### Ansvar
Master-as-admin actions: startGame, pause/resume/stop, exclude/include hall, transfer-audit. State-machine for `app_game1_scheduled_games.status`. DB-only — broadcasting skjer i route-laget.

### Public API
- `class Game1MasterControlService`
- `startGame(input)`, `pauseGame`, `resumeGame`, `stopGame`
- `excludeHall(input)`, `includeHall(input)`
- `recordTimeoutDetected(input)` — for ScheduleTickService end-of-day
- `getGameDetail(gameId)` — read
- `MasterAuditAction` (type) + `MASTER_AUDIT_ACTIONS` (const)

### Avhengigheter
- **Inn:** `Pool`, `Game1DrawEngineService`, `AdminGame1Broadcaster`, `Game1TicketPurchaseService` (for refundAllForGame ved stop), `Game1JackpotStateService`. `BingoEngine.DomainError`.
- **Ut:** Kalles fra route-laget (`adminGame1Routes.ts`) og fra `Game1ScheduleTickService` ved end-of-day-cancel.

### State-management
**DB-only.** State i `app_game1_scheduled_games` + `app_game1_master_audit`. Audit + state oppdateres i samme transaksjon.

### Regulatoriske implikasjoner
- **§71:** Audit-tabellen `app_game1_master_audit` er regulatorisk — alle master-actions må logges (start/pause/stop/exclude/include + transfer-events).
- **CRIT-7 (Casino Review):** Hvis `drawEngine.startGame` feiler etter `master-control.startGame` har committet `status='running'` — skriv kompenserende `start_engine_failed_rollback`-audit.
- **K1-payout-binding:** Ikke direkte her, men master-hall_id bestemmer hvem som vises som "vert" — IKKE hvem som får §71-compliance-entry.

### Bug-testing-guide
- **Symptom: "Stopp lar pengene henge"** → `stopGame` skal kalle `Game1TicketPurchaseService.refundAllForGame`. Sjekk transaksjon.
- **Symptom: "Start fungerer fra ikke-master-hall"** → `assertActorIsMaster` brutt. Sjekk role-validation.
- **Symptom: "Exclude-hall ikke ruller status tilbake"** → `excludeHall` skal flytte 'ready_to_start' → 'purchase_open'. Sjekk side-effekt.
- **Symptom: "Pause uten audit-entry"** → audit + UPDATE skal være i samme transaksjon. Race condition mellom dem = bug.
- **Symptom: "Master-hall-action mangler i replay"** → `MasterAuditAction` ikke i whitelist. Sjekk migrasjon for CHECK-constraint.

---

## 5. Game1HallReadyService
**Path:** `apps/backend/src/game/Game1HallReadyService.ts`
**LOC:** 924

### Ansvar
Per-hall ready-state-tracking for scheduled-games. Bingovert trykker "Klar" → sales lukkes for hallen → master kan starte spillet når alle deltakende haller er klare. Også scan-tracking (start/final ticket-ID) og purchase-cutoff-helper.

### Public API
- `class Game1HallReadyService`
- `markReady(input)` / `unmarkReady(input)` — bingovert toggle
- `getReadyStatusForGame(gameId)` — alle hall-rader for et spill
- `allParticipatingHallsReady(gameId)` — true hvis alle non-excluded klare
- `assertPurchaseOpenForHall(gameId, hallId)` — kaster PURCHASE_CLOSED_FOR_HALL hvis hall lukket
- `recordStartScan(input)` / `recordFinalScan(input)` — scan-tracking
- `getHallStatusForGame(gameId)` — beriket per-hall-status med farge (red/orange/green)
- `forceUnmarkReady`, `sweepStaleReadyRows`, `resetReadyForNextRound`
- `computeHallStatus(row)` — pure helper for farge-resolusjon

### Avhengigheter
- **Inn:** `Pool`, `BingoEngine.DomainError`. Stateless service uten ekstra DI.
- **Ut:** Kalles fra route-laget (`agentGame1ReadyRoutes.ts`), fra `Game1TicketPurchaseService.purchase` (assertPurchaseOpenForHall), fra `Game1MasterControlService.startGame` (allParticipatingHallsReady).

### State-management
**DB-only:** `app_game1_hall_ready_status`. Snapshot-felter populert ved markReady.

### Regulatoriske implikasjoner
- **§64 spilleplan:** Hver hall må kunne stenge salg uavhengig før spillet starter. Audit-actions: `hall.sales.closed`, `hall.sales.reopened`.
- **§71:** Sales-snapshot (digital + physical) lagres ved markReady — kan brukes som regulatorisk bevis på cutoff-tidspunkt.
- **Farge-semantikk (Tobias låst 2026-04-24):** red=0 spillere, orange=spillere men ikke klar, green=alle scanner + Klar trykket.

### Bug-testing-guide
- **Symptom: "Salg fortsetter etter Klar trykket"** → `assertPurchaseOpenForHall` ikke kalt i purchase-pathen, eller is_ready ikke satt. Sjekk transaksjons-rekkefølge.
- **Symptom: "Master kan starte før alle klare"** → `allParticipatingHallsReady` returnerer feil. Sjekk excluded_from_game-filter.
- **Symptom: "Unmark ready blir avvist"** → game.status må være 'purchase_open'. Etter status='ready_to_start' er det låst.
- **Symptom: "Status-farge feil i UI"** → `computeHallStatus` logikk: playerCount=0→red, !finalScanDone→orange, alt OK→green.

---

## 6. Game1TicketPurchaseService
**Path:** `apps/backend/src/game/Game1TicketPurchaseService.ts`
**LOC:** 1359

### Ansvar
Ticket-purchase + refund for scheduled-games. Idempotent (UNIQUE-key), wallet-integrasjon (debit ved digital_wallet, no-op ved cash/card-agent), compliance-binding til kjøpe-hallen (K1-fix).

### Public API
- `class Game1TicketPurchaseService`
- `purchase(input)` → `Game1TicketPurchaseResult` (digital-wallet/cash/card)
- `refundPurchase(input)`, `refundAllForGame(input)`
- `listPurchasesForGame`, `listPurchasesForBuyer`, `getPurchaseById`
- `assertPurchaseOpen({scheduledGameId, hallId})` — kortvei

### Avhengigheter
- **Inn:** `Pool`, `WalletAdapter`, `AuditLogService`, `Game1HallReadyService`, `PlatformService`, `ComplianceLossPort`, `PotSalesHookPort`, `ComplianceLedgerPort`, `ledgerGameTypeForSlug`, `IdempotencyKeys`.
- **Ut:** Kalles fra route-laget (`game1PurchaseRoutes.ts`, `agentPosRoutes.ts`), fra `Game1MasterControlService.stopGame` (refundAllForGame).

### State-management
**DB-only:** `app_game1_ticket_purchases`. Wallet-flyt utenfor DB-transaksjon (egen wallet-tx). UNIQUE(idempotency_key) gjør retries idempotente.

### Regulatoriske implikasjoner
- **§11 (K1-fix BIN-443):** `complianceLedgerPort.recordBuyIn` skriver `actor_hall_id = input.hallId` (kjøpe-hallen), IKKE master-hallen. Dette fikset bug der multi-hall-spill skrev all compliance til master-hall — gjorde §71-rapporter feil.
- **§66:** `complianceLossPort.recordLossEntry` (BUYIN-type) bruker `lossLimitAmountFromTransfer` for kun-deposit-del.
- **PotSalesHook:** Pot-progresjon fyttes basert på buy-in. Hvis hookport feiler, skal IKKE rolle tilbake purchase (logget warning).

### Bug-testing-guide
- **Symptom: "Dobbel debit ved retry"** → idempotency-key-kollisjon ELLER UNIQUE-constraint mangler. Sjekk migrasjon. UNIQUE_VIOLATION (23505) skal mappes til `alreadyExisted: true`.
- **Symptom: "Cash-agent-kjøp debiterer wallet"** → paymentMethod-switch brutt. cash_agent + card_agent skal IKKE kalle wallet.debit.
- **Symptom: "Compliance §71 skrives til master-hall"** → K1 BIN-443 regresjon. Verifiser `actor_hall_id` i ledger-entry.
- **Symptom: "Purchase tillates etter hall trykket Klar"** → `assertPurchaseOpenForHall` ikke kalt eller hall.is_ready ikke sjekket.
- **Symptom: "Refund crash etter game.status='completed'"** → guard mangler. Avvis refund hvis status=completed.

---

## 7. Game1PayoutService
**Path:** `apps/backend/src/game/Game1PayoutService.ts`
**LOC:** 573

### Ansvar
Phase payout (1..5) for Spill 1: split-rounding, wallet.credit per vinner, INSERT phase_winners-rad, audit, loyalty-hook fire-and-forget. Atomisk innenfor caller's PoolClient — feil → kast for at drawNext skal rolle tilbake.

### Public API
- `class Game1PayoutService`
- `payoutPhase(input: Game1PhasePayoutInput): Promise<Game1PhasePayoutResult>`
- Types: `Game1WinningAssignment`, `Game1PhasePayoutInput`, `Game1PhasePayoutResult`.

### Avhengigheter
- **Inn:** `WalletAdapter`, `LoyaltyPointsHookPort`, `SplitRoundingAuditPort`, `ComplianceLedgerPort`, `AuditLogService`, `IdempotencyKeys`. `BingoEngine.DomainError`.
- **Ut:** Kalles fra `Game1DrawEngineService.drawNext` etter fase-evaluering.

### State-management
**Stateless** — bruker callers PoolClient. INSERT app_game1_phase_winners + per-vinner wallet.credit.

### Regulatoriske implikasjoner
- **§11 split-rounding:** `floor(totalPrize / numWinners)` per vinner, rest til hus (audit-loggert via `splitRoundingAudit`). Tobias låst: huset beholder rest-øre.
- **§11 single-prize-cap:** 2500 kr — håndhevet av `prizePolicy` UPSTREAM (ikke her). Service stoler på input.
- **§71:** `complianceLedgerPort.recordPrize` per vinner med `winner.hallId` (K1-fix), inkluderer ekstra jackpot-amount.
- **Loyalty:** Fire-and-forget — wallet-feil ruller payout, men loyalty-feil logges og ignoreres.

### Bug-testing-guide
- **Symptom: "Multi-winner split går ikke opp"** → `houseRetained` skal være `total - numWinners * prizePerWinner`. Sjekk floor.
- **Symptom: "Én credit feiler, andre vinnere får ikke betalt"** → Hele payoutPhase skal være atomisk i drawNext-transaksjonen. Wallet.credit utenfor transaksjonen er bug.
- **Symptom: "Phase_winners-rad mangler men wallet er kreditert"** → Idempotency-mismatch. Sjekk at `IdempotencyKeys.payout(...)` er deterministisk.
- **Symptom: "Loyalty-hook crash blokkerer payout"** → Den skal være fire-and-forget. Sjekk catch + log.warn.
- **Symptom: "Jackpot-amount lagt til ordinær prize i samme tx-id"** → Skal være separate wallet-credits med ulik idempotency-key.

---

## 8. Game1JackpotStateService
**Path:** `apps/backend/src/game/Game1JackpotStateService.ts`
**LOC:** 731

### Ansvar
Daglig akkumulerende jackpot per hall-gruppe. Seed 2000 kr, +4000 kr/dag, max 30000 kr. Draw-thresholds [50, 55, 56, 57] — Fullt Hus innen threshold[0] tømmer potten.

### Public API
- `class Game1JackpotStateService`
- `getCurrentAmount(hallGroupId)` / `getStateForGroup(hallGroupId)`
- `accumulateDaily()` — idempotent cron-metode (kjøres 00:15 Oslo)
- `awardJackpot(input)` — atomisk debit + reset + audit-rad (UNIQUE idempotency_key)
- `resetToStart(hallGroupId, reason)` — manuell reset (post-vinning eller correction)
- `ensureStateExists(hallGroupId)` — lazy-init
- Konstanter: `JACKPOT_DEFAULT_START_CENTS = 200_000` (2k), `JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS = 400_000` (4k), `JACKPOT_DEFAULT_MAX_CAP_CENTS = 3_000_000` (30k), `JACKPOT_DEFAULT_DRAW_THRESHOLDS = [50, 55, 56, 57]`.
- `JackpotAwardReason` (type): `FULL_HOUSE_WITHIN_THRESHOLD | ADMIN_MANUAL_AWARD | CORRECTION`.

### Avhengigheter
- **Inn:** `Pool`, `osloTimezone.ts:todayOsloKey`. Stateless DI-fri service.
- **Ut:** Kalles fra `Game1DrawEngineDailyJackpot.runDailyJackpotEvaluation` (etter Fullt Hus i drawNext), `Game1MasterControlService.startGame` (preflight), cron `jackpotDailyTick`.

### State-management
**DB-only:** `app_game1_jackpot_state` + `app_game1_jackpot_awards`. Atomisk award via PoolClient + UNIQUE idempotency_key.

### Regulatoriske implikasjoner
- **§11 forutsigbarhet:** Jackpot-config må være regulatorisk transparent. Beløpene er hardkodet i konstanter — endring krever ny konstant + migrasjon.
- **Oslo-tidssone (BIN fix #584):** `todayOsloKey()` brukes for `last_accumulation_date` slik at midnight-tick skjer på riktig dato i CET/CEST. Bug var at UTC ble brukt → 1-2 timers feilvindu.
- **Cap-håndhevelse:** `MAX_CAP_CENTS` er hard cap — accumulateDaily må ikke overskride.

### Bug-testing-guide
- **Symptom: "Jackpot fyller opp dobbelt på 1 dag"** → `last_accumulation_date < today_oslo`-sjekk feiler. Sjekk Oslo-tz-helper.
- **Symptom: "Jackpot vunnet men beløp ikke resettet"** → Award-transaksjon ikke atomisk. Sjekk PoolClient-flyt.
- **Symptom: "Award skjer dobbelt ved retry"** → idempotencyKey ikke unik. Format må være `g1-jackpot-{scheduledGameId}-{drawSequenceAtWin}`.
- **Symptom: "Award bypasser threshold"** → drawSequenceAtWin > thresholds[0] men award skjer. Sjekk caller (`Game1DrawEngineDailyJackpot.runDailyJackpotEvaluation`) — guard er der.
- **Symptom: "Cap overskridelse"** → `Math.min(current + increment, max_cap_cents)`. Test at tickle-akkumulering stopper på 30k.

---

## 9. Game1JackpotService
**Path:** `apps/backend/src/game/Game1JackpotService.ts`
**LOC:** 196

### Ansvar
Per-farge fixed-amount jackpot ("Free Spin Jackpot") evaluert ved Fullt Hus innenfor `jackpotConfig.draw` (typisk 50-59). Pure service — ingen DB.

### Public API
- `class Game1JackpotService`
- `evaluate(input: Game1JackpotEvaluationInput): Game1JackpotEvaluationResult`
- `resolveColorFamily(ticketColor)` — pure helper for farge-suffiks-mapping
- Types: `Game1JackpotConfig`, `JackpotPrizeByColor`, `JackpotColorFamily` (yellow/white/purple/red/green/orange/elvis/other).

### Avhengigheter
- **Inn:** Ingen — pure service.
- **Ut:** Kalles fra `Game1DrawEngineService.drawNext` etter Full House-detection (separat fra daily-jackpot).

### State-management
**Stateless.** Pure function på input.

### Regulatoriske implikasjoner
- **§11 fail-closed:** `Math.floor(NaN)=NaN` og `x > NaN === false` — service sjekker eksplisitt `Number.isFinite(maxDraw)` og `Number.isFinite(drawSequenceAtWin)`. Uten dette kunne en invalid config bypasse threshold.
- **Per-farge-config:** Lagret i `ticket_config_json.spill1.jackpot.prizeByColor` (NOK), konvertert til øre i evaluate.

### Bug-testing-guide
- **Symptom: "Jackpot trigget på fase 4 (2 rader)"** → `phase !== 5` sjekk skal returnere `triggered: false`. Verifiser.
- **Symptom: "Jackpot trigget etter draw 60"** → `drawSequenceAtWin > maxDraw` skal blokkere. Sjekk Number.isFinite-vakter.
- **Symptom: "Elvis-ticket får 0 jackpot"** → `resolveColorFamily("elvis1") === "elvis"`. Hvis prizeByColor.elvis er satt, skal det matche.
- **Symptom: "Trafikklys-ticket får ikke jackpot"** → Hvis ticketColor ikke matcher kjent suffix → `colorFamily="other"` → 0. Konfigurer eksakt farge-navn i prizeByColor (fallback på exact match først).

---

## 10. Game1LuckyBonusService
**Path:** `apps/backend/src/game/Game1LuckyBonusService.ts`
**LOC:** 174

### Ansvar
Lucky Number Bonus ved Fullt Hus når `lastBall === player.luckyNumber`. Pure service. Bonus = fixed amount (config), per kvalifisert vinner (ikke split). Reglene fra legacy `GameProcess.js:420-429`.

### Public API
- `class Game1LuckyBonusService`
- `evaluate(input): Game1LuckyBonusEvaluationResult`
- `resolveLuckyBonusConfig(ticketConfigJson)` — parser config fra DB-JSON
- Types: `Game1LuckyBonusConfig`, `Game1LuckyBonusEvaluationInput`.

### Avhengigheter
- **Inn:** `TOTAL_PHASES = 5` fra `Game1PatternEvaluator`.
- **Ut:** Kalles fra `Game1DrawEngineService.drawNext` per Fullt Hus-vinner.

### State-management
**Stateless.** Pure function.

### Regulatoriske implikasjoner
- **§11 fail-closed:** 5 separate vakter — phase, enabled, amountCents, luckyNumber, lastBall. Default = ingen bonus.
- **Per-winner, ikke split:** Hver kvalifisert vinner får FULL bonus. Skiller seg fra ordinær split-rounding-flyt.
- **Wallet-target:** Legacy utbetales til `winnings`-konto (purchasedSlug "realMoney" → winnings-side).

### Bug-testing-guide
- **Symptom: "Bonus utbetales på fase 4"** → `phase !== TOTAL_PHASES (5)` guard. Skal returnere triggered=false.
- **Symptom: "Bonus utbetales selv uten luckyNumber"** → `Number.isInteger(luckyNumber)` feiler først. Sjekk null/undefined-håndtering.
- **Symptom: "Bonus 2x ved multiple wins"** → Per-winner-design: hvert kvalifisert brett får ETT bonus. Hvis spilleren har 2 vinnende brett med matching lucky → 2x bonus by design.
- **Symptom: "0-bonus selv om enabled=true"** → `amountCents <= 0`-guard. Sjekk parsed config fra `resolveLuckyBonusConfig`.

---

## 11. Game1ScheduleTickService
**Path:** `apps/backend/src/game/Game1ScheduleTickService.ts`
**LOC:** 1033

### Ansvar
Cron-driver: spawn games fra daily_schedules, åpne purchase ved notification-time, cancel rader som ikke startet. Idempotent — kan kjøres hvert minutt uten dobbeltarbeid.

### Public API
- `class Game1ScheduleTickService`
- `spawnUpcomingGame1Games()` → `SpawnResult` — INSERT-rad for hver subGame i 0-24t-vindu
- `openPurchaseForImminentGames()` — UPDATE 'scheduled' → 'purchase_open' når notification-time nådd
- `cancelEndOfDayUnstartedGames()` — UPDATE 'scheduled' | 'purchase_open' → 'cancelled' (end_of_day_unreached)
- `Game1ScheduledGameStatus` (type) + `GAME1_SCHEDULED_GAME_STATUSES` (const)

### Avhengigheter
- **Inn:** `Pool`. Leser `app_daily_schedules` + `app_schedules` + `app_game1_scheduled_games`.
- **Ut:** Kalles fra cron `game1ScheduleTick` (`apps/backend/src/scheduler/`).

### State-management
**DB-only:** `app_game1_scheduled_games`. UNIQUE(daily_schedule_id, scheduled_day, sub_game_index) hindrer dobbel-spawn.

### Regulatoriske implikasjoner
- **§64 spilleplan:** `app_daily_schedules.otherData.scheduleId` peker til malen — denne tick-en er bro mellom mal og faktiske runder.
- **§71:** Cancelled-rader får `stop_reason='end_of_day_unreached'` — auditerbart.
- **Notification-window:** Default 5 min (300s) før start — definerer når §66-pre-game-warnings sendes til spillere.

### Bug-testing-guide
- **Symptom: "Games spawnes ikke neste dag"** → 0-24t-vindu med Oslo-tz. Sjekk dato-parsing for `scheduled_day`.
- **Symptom: "Dobbel-spawn"** → UNIQUE-constraint feilet eller catch-23505 mangler.
- **Symptom: "Purchase aldri åpnes"** → notification_start_seconds parsing. Sjekk `parseDuration("5m")` / `("60s")`.
- **Symptom: "Slot uten startTime spawnes"** → guard mangler. Skal hoppe over og logge.
- **Symptom: "End-of-day cancel sletter aktive runder"** → `scheduled_end_time < now AND status IN ('scheduled', 'purchase_open')`. Running/paused skal IKKE cancelles av denne (det gjør Game1RecoveryService).

---

## 12. Game1AutoDrawTickService
**Path:** `apps/backend/src/game/Game1AutoDrawTickService.ts`
**LOC:** 360

### Ansvar
Global 1s-tick som driver automatisk drawNext for alle running spill. Sjekker `last_drawn_at + seconds <= now()` per game. Per-game-feil isolert — én feil blokkerer ikke andre.

### Public API
- `class Game1AutoDrawTickService`
- `tick()` → `Game1AutoDrawTickResult` (checked, drawsTriggered, errors)
- Options: `defaultSeconds`, `forceSecondsOverride` (env-var `AUTO_DRAW_INTERVAL_MS`)

### Avhengigheter
- **Inn:** `Pool`, `Game1DrawEngineService`.
- **Ut:** Kalles fra cron-scheduler 1×/sek.

### State-management
**DB-only.** Ingen in-process state.

### Regulatoriske implikasjoner
- **PM-låst (Tobias 2026-04-21):** "hver kule kommer med akuratt samme mellomrom" — fixed interval, IKKE random min/max.
- **§64:** `seconds` er regulatorisk synlig på spilleplan — endring krever audit.
- **Force-override:** `forceSecondsOverride` (env-var) overrider per-game-config — kun for tuning. Må ikke aktiveres uten dokumentert avvik.

### Bug-testing-guide
- **Symptom: "Draw-intervall hopper mellom verdier"** → `forceSecondsOverride` ikke konsistent. Tidligere bug: env-var leses kun ved første draw — fix bruker den ved hver tick.
- **Symptom: "Auto-draw stopper helt"** → `paused=true` eller `engine_ended_at IS NOT NULL`-filter. Sjekk SELECT.
- **Symptom: "Pause + resume → ingen draws"** → `last_drawn_at` ikke clearet ved resume. Den skal være intakt slik at neste draw skjer naturlig når intervallet passerer.
- **Symptom: "Én crash stopper alle"** → Per-game-feil-isolation. Sjekk catch + continue i loop.

---

## 13. Game1TransferHallService
**Path:** `apps/backend/src/game/Game1TransferHallService.ts`
**LOC:** 776

### Ansvar
Runtime master-overføring mellom haller via 60s handshake. Hindrer at master-hall som blir uoperasjonell midt i dagen lager DB-admin-job. Legacy-paritet (AdminController.js:253-522).

### Public API
- `class Game1TransferHallService`
- `requestTransfer({gameId, fromHallId, toHallId, initiatedByUserId})` — INSERT request, valid_till=now+60s
- `approveTransfer({requestId, respondedByUserId, respondedByHallId})` — UPDATE master_hall_id + request status
- `rejectTransfer({requestId, ...})`
- `expireStaleTasks()` — periodisk cron, expire pending > valid_till
- `getActiveRequestForGame(gameId)` / `getRequestById`
- Konstant: `TRANSFER_REQUEST_TTL_SECONDS = 60`
- Types: `TransferRequest`, `TransferRequestStatus` (pending/approved/rejected/expired).

### Avhengigheter
- **Inn:** `Pool`. `BingoEngine.DomainError`.
- **Ut:** Kalles fra route-laget (`adminGame1TransferRoutes.ts`) og cron `game1TransferExpiryTick` (egen `Game1TransferExpiryTickService`).

### State-management
**DB-only:** `app_game1_master_audit` (transfer_request/transfer_approved/transfer_rejected/transfer_expired audit-events) + UPDATE av `app_game1_scheduled_games.master_hall_id`.

### Regulatoriske implikasjoner
- **§71 audit:** Alle 4 transfer-events må logges. Action-whitelist i `MasterAuditAction` (Game1MasterControlService).
- **Pilot-blokker (lukket):** Tidligere DB-admin-job; nå runtime-action.
- **TTL 60s:** Hardkodet for å unngå ubekrefta requests som henger evig.

### Bug-testing-guide
- **Symptom: "Approve fra feil hall lyktes"** → `respondedByHallId === to_hall_id`-sjekk. Skal kaste TRANSFER_NOT_TARGET_HALL.
- **Symptom: "Master-hall ikke endret etter approve"** → UPDATE app_game1_scheduled_games.master_hall_id må skje i samme transaksjon.
- **Symptom: "Pending request henger > 60s"** → expireStaleTasks ikke kjører. Sjekk cron-frekvens (default 5s).
- **Symptom: "Multiple pending requests for samme spill"** → requestTransfer skal kansellere tidligere pending. Sjekk DELETE/UPDATE-flyt.

---

## 14. Game1ReplayService
**Path:** `apps/backend/src/game/Game1ReplayService.ts`
**LOC:** 723

### Ansvar
Audit-replay: rekonstruer event-strøm for avsluttet scheduled-game. Joiner master_audit + draws + phase_winners + ticket_purchases + ticket_assignments + mini_game_results + wallet_transactions til én tidslinje.

### Public API
- `class Game1ReplayService`
- `getReplay(gameId)` → `Game1ReplayEvent[]` sortert på sequence
- `Game1ReplayEvent` (interface) + `Game1ReplayEventType` (15 events)

### Avhengigheter
- **Inn:** `Pool`. Stateless service.
- **Ut:** Kalles fra `adminGameReplayRouter` (RBAC `GAME1_GAME_READ + PLAYER_KYC_READ`).

### State-management
**Read-only DB.** Tabellene er append-only (RESTRICT FK), så replay er stabil og reproduserbar.

### Regulatoriske implikasjoner
- **§71 reproduserbar bevisførsel:** userId/walletId/assignmentId IKKE redacted — auditor må kunne korrelere mot ledger.
- **PII-redaction:** E-post (`f***@domene.no`), display-name (`Fornavn E***`), wallet-display (`wal_***xyz9`).
- **GDPR forward-only:** Hvis player har bedt om sletting — userId beholdes for compliance, men profile er anonymisert i player-tabellen.

### Bug-testing-guide
- **Symptom: "Events i feil rekkefølge"** → `sequence`-felt = ms-timestamp + sub-sequence. Sjekk sortering.
- **Symptom: "Plain email/displayName lekker"** → PII-redaction-helpers ikke kalt. Sjekk redactEmail/redactDisplayName.
- **Symptom: "Mini-game-event mangler"** → Join til `app_game1_mini_game_results`. Hvis tom → spillet ble cancelled før Fullt Hus.
- **Symptom: "Wallet-tx ikke koblet til purchase"** → Join på `idempotency_key` ↔ `wallet_transactions.idempotency_key`. Hvis NULL → cash/card-agent (ingen wallet-tx).

---

## 15. Game1RecoveryService
**Path:** `apps/backend/src/game/Game1RecoveryService.ts`
**LOC:** 327

### Ansvar
Schedule-state crash-recovery på boot. Cancel `running`/`paused`-rader hvor `scheduled_end_time` er passert med >2t. Separat fra BIN-245 engine-recovery (som henter runtime room-state).

### Public API
- `class Game1RecoveryService`
- `runRecovery()` → `RecoveryRunResult` (inspected/cancelled/preserved/failures)
- Options: `maxRunningWindowMs` (default 2t)

### Avhengigheter
- **Inn:** `Pool`. `BingoEngine.DomainError`.
- **Ut:** Kalles én gang ved server-boot fra `index.ts`.

### State-management
**DB-only.** Skriver `status='cancelled'` + audit-action `'stop'` med metadata `{reason: 'crash_recovery_cancelled'}`.

### Regulatoriske implikasjoner
- **§71 audit:** Bruker eksisterende 'stop'-action (ikke ny enum-verdi) for å unngå CHECK-constraint-migrasjon. Metadata skiller crash-cancel fra master-stop.
- **2-t-vindu:** Tobias-låst som spec §3.8-default. Stopp-tid er valgt for å gi DB-admin tid til manuell intervensjon før auto-cancel kicker inn.

### Bug-testing-guide
- **Symptom: "Aktive runder cancelled på reboot"** → `scheduled_end_time + 2t < now()`-guard. Hvis vinduet er for kort eller dato-parsing feil → false-positives.
- **Symptom: "Crashed runde ikke cancelled på boot"** → Service ikke kalt fra index.ts ved boot. Sjekk init-rekkefølge.
- **Symptom: "Refund skjer ikke for cancelled rader"** → Recovery cancler kun status; den kaller IKKE refundAllForGame. Refund må håndteres separat.

---

## 16. BingoEngineMiniGames
**Path:** `apps/backend/src/game/BingoEngineMiniGames.ts`
**LOC:** 387

### Ansvar
Pure helpers for jackpot-spin og mini-games i ad-hoc-engine (Game 5 og legacy-spill). Brukes IKKE av scheduled Spill 1 — den bruker `Game1MiniGameOrchestrator` med DB-state.

### Public API
- `JACKPOT_PRIZES` / `MINIGAME_PRIZES` (default arrays)
- `MINIGAME_ROTATION` — `[wheel, chest, mystery, colorDraft]` BIN-505/506
- Functions: `activateJackpotForPlayer`, `spinJackpotForPlayer`, `activateMiniGameForPlayer`, `playMiniGameForPlayer`
- `MiniGamesContext` (interface) — narrow port fra BingoEngine

### Avhengigheter
- **Inn:** `WalletAdapter`, `ComplianceManager`, `ComplianceLedger`, `IdempotencyKeys`. `BingoEngine.DomainError` + `MiniGamesContext` fra caller.
- **Ut:** Kalles fra `BingoEngine.activateJackpot/spinJackpot/activateMiniGame/playMiniGame`.

### State-management
**Stateless** — bruker context-objekt fra caller. Mutaterer `game.jackpot` / `game.miniGame` som er del av RoomState (callers ansvar).

### Regulatoriske implikasjoner
- **§11 payout:** Wallet-transfer skjer her. `compliance.recordLossEntry` brukes IKKE (mini-game-payout er ikke loss). `ledger.recordPrize` skrives.
- **`refreshPlayerBalancesForWallet`:** Fail-soft — feil her gir stale visning, men ikke regulatorisk feil (vinneren er allerede betalt).

### Bug-testing-guide
- **Symptom: "Mini-game-rotasjon hopper over en type"** → `MINIGAME_ROTATION`-state per hall. Sjekk pekken.
- **Symptom: "Stale balance etter mini-game"** → `refreshPlayerBalancesForWallet` failed. Sjekk fail-soft logging.
- **Symptom: "Dobbel payout ved retry"** → Idempotency-key-format: `IdempotencyKeys.miniGamePayout(roomCode, playerId, type)`.

---

## 17. Game1MiniGameOrchestrator
**Path:** `apps/backend/src/game/minigames/Game1MiniGameOrchestrator.ts`
**LOC:** 1140

### Ansvar
Mini-game-rotasjon for scheduled Spill 1. Etter Fullt Hus → trigger neste mini-game-type (FIFO per scheduled_game) → vent på klient-svar → server-autoritativ resolve → wallet.credit. Subengines: Wheel, Chest, Mystery, Colordraft, Oddsen.

### Public API
- `class Game1MiniGameOrchestrator`
- `maybeTriggerFor(input: MaybeTriggerInput)` — fire-and-forget fra drawNext post-commit
- `handleChoice(input: HandleChoiceInput)` — server-autoritativ resolve
- `listPending()`, `markAbandoned()` — M2+ stubber
- Sub-engines registrert via konstruktør Map<MiniGameType, MiniGame>

### Avhengigheter
- **Inn:** `Pool`, `WalletAdapter`, `ComplianceLedgerPort`, `PrizePolicyPort`, `AuditLogService`. Sub-engines: `MiniGameWheelEngine`, `MiniGameChestEngine`, `MiniGameMysteryEngine`, `MiniGameColordraftEngine`, `MiniGameOddsenEngine`.
- **Ut:** Kalles fra `Game1DrawEngineService.triggerMiniGamesForFullHouse` (post-commit) + socket-handler (`miniGameEvents.ts`) for handleChoice.

### State-management
**DB-only:** `app_game1_mini_game_results`. Atomisk update + wallet.credit i én transaksjon.

### Regulatoriske implikasjoner
- **§11 server-autoritativ:** Klient kan ikke bestemme payout. Resultatet beregnes server-side i sub-engine.
- **§71:** Mini-game payout får egen `complianceLedgerPort.recordPrize` med `gameType=ledgerGameTypeForSlug("game_1")` (MAIN_GAME).
- **PrizePolicyPort:** Gir cap (2500 kr) — sub-engine må respekt.
- **Fire-and-forget på trigger:** Hvis trigger feiler etter at drawNext har committet, drawn skal IKKE rolles. Logget warn + audit-event "game1_minigame.trigger_failed".

### Bug-testing-guide
- **Symptom: "Mini-game trigget med 0 prize"** → Sub-engine config tom eller `MiniGameOddsenEngine.parseOddsenConfig` failed. Sjekk `gameConfigJson.spill1.miniGames`.
- **Symptom: "Klient submitter resultat dobbelt"** → idempotency: `completed_at IS NULL`-guard. Andre submit returnerer ALREADY_COMPLETED.
- **Symptom: "Mini-game-type i feil rekkefølge"** → FIFO per scheduled_game. Sjekk SQL `ORDER BY created_at ASC` + WHERE `triggered_at IS NULL`.
- **Symptom: "Wallet-credit lykkes men app_game1_mini_game_results.payout_cents NULL"** → atomic update brutt. Hele handleChoice skal være én tx.
- **Symptom: "Trigger crash blokkerer drawNext"** → fire-and-forget brutt. Sjekk catch i `maybeTriggerFor`.

---

## 18. Game1DrawEngineDailyJackpot
**Path:** `apps/backend/src/game/Game1DrawEngineDailyJackpot.ts`
**LOC:** 291

### Ansvar
DrawEngine-hook som binder Fullt Hus til daglig-jackpot. Kalt fra drawNext etter ordinær payout. Resolver hall_group → atomisk award via `Game1JackpotStateService.awardJackpot` → distribuer til vinnere via wallet.credit.

### Public API
- `runDailyJackpotEvaluation(params)` — main entry-point
- `DailyJackpotWinner` (type)

### Avhengigheter
- **Inn:** `PoolClient`, `Game1JackpotStateService`, `WalletAdapter`, `AuditLogService`.
- **Ut:** Kalles fra `Game1DrawEngineService.drawNext` (mellom payoutPhase og mini-game-trigger).

### State-management
**Stateless** — bruker callers PoolClient for SELECT, men awardJackpot skjer i sin EGEN pool.connect()-transaksjon (kan ikke rolle ved partial credit-failure).

### Regulatoriske implikasjoner
- **§11 partial-failure:** Pragmatisk valg dokumentert i header — pilot-scope er én hall. Full atomicitet utsettes til post-pilot.
- **Idempotency:** Award-key + per-(award, winner)-credit-key. Retries fra operatør gir samme awardedAmount uten dobbel-debit.

### Bug-testing-guide
- **Symptom: "Jackpot-debit men ingen wallet-credit"** → Partial failure. Sjekk audit-log for "DAILY_JACKPOT_PARTIAL_CREDIT_FAILURE". Manuell re-trigger.
- **Symptom: "Award skjer på fase 4"** → Caller (drawNext) feilkalt. Hook skal kun kalles på fase=5.
- **Symptom: "drawSequenceAtWin > thresholds[0] men award skjer"** → Guard mangler. Sjekk threshold-sjekk i `awardJackpot`.

---

## 19. Game1DrawEnginePotEvaluator
**Path:** `apps/backend/src/game/Game1DrawEnginePotEvaluator.ts`
**LOC:** 256

### Ansvar
Pot-evaluator-wiring i drawNext. Iterer over haller, kall `evaluateAccumulatingPots` for Innsatsen + akkumulerende pot-er per hall. Pure orchestrator — selve pot-logikken er i `pot/PotEvaluator.ts`.

### Public API
- `runAccumulatingPotEvaluation(params)`
- `computeOrdinaryWinCentsByHallPerColor(...)` / `computeOrdinaryWinCentsByHallFlat(...)` — helpers for capType=total

### Avhengigheter
- **Inn:** `PoolClient`, `Game1PotService`, `WalletAdapter`, `AuditLogService`, `PotDailyAccumulationTickService`, `pot/PotEvaluator.evaluateAccumulatingPots`, `ComplianceLedgerPort`, `PrizePolicyPort`.
- **Ut:** Kalles fra `Game1DrawEngineService.drawNext` post-payoutPhase.

### State-management
**Stateless.** Pure orchestrator.

### Regulatoriske implikasjoner
- **§11 transaksjon:** Pot-evaluering kjører INNE i drawNext-transaksjonen. Innsatsen/generic-feil kaster ut → drawNext ruller tilbake.
- **Jackpott-feil:** Egen swallow-policy inne i `evaluateAccumulatingPots` — når ikke opp hit. Pragmatisk pilot-valg.

### Bug-testing-guide
- **Symptom: "Innsatsen ikke utbetalt selv om threshold nådd"** → `firstWinnerPerHall`-beregning feil. Sjekk `ordinaryWinCentsByHall`-input.
- **Symptom: "Pot-payout dobbelt"** → Idempotency på pot-payout-key. Sjekk `IdempotencyKeys.potPayout`.
- **Symptom: "EXTRA_PRIZE-entry mangler"** → `complianceLedgerPort` ikke wired. K2-A CRIT-2.

---

## 20. variantConfig
**Path:** `apps/backend/src/game/variantConfig.ts`
**LOC:** 709

### Ansvar
Config-presets for game-varianter. Definerer ticket-types, patterns, multipliers, og 5 sub-varianter for Spill 1 (norsk-bingo, kvikkis, tv-extra, ball-x-10, super-nils, spillernes-spill). Lagres i `hall_game_schedules.variant_config` (JSONB).

### Public API
- Types: `GameVariantConfig`, `TicketTypeConfig`, `PatternConfig`, `CustomPatternDefinition`
- Presets: `DEFAULT_NORSK_BINGO_CONFIG`, `DEFAULT_QUICKBINGO_CONFIG`
- Constants: `PATTERNS_BY_COLOR_DEFAULT_KEY = "__default__"`
- Functions: `expandTicketSelection(...)`, `validateVariantConfig(...)`, `winningTypeOf(pattern)`.

### Avhengigheter
- **Inn:** `types.ts:PatternDefinition`, `@spillorama/shared-types/spill1-patterns`.
- **Ut:** Importert av `BingoEngine`, `BingoEnginePatternEval`, `spill1VariantMapper`, `Game2Engine`, `Game3Engine`, sockets.

### State-management
**Stateless** — pure types + presets.

### Regulatoriske implikasjoner
- **§11 winningType-formler:** 5 varianter (percent / fixed / multiplier-chain / column-specific / ball-value-multiplier). Endring krever migrasjon + audit.
- **Per-farge-matrise:** `patternsByColor[color]` — multi-winner-split skjer innen én farges vinnere (PM-vedtak Option X 2026-04-21).
- **Safety net:** `__default__`-nøkkel matcher `DEFAULT_NORSK_BINGO_CONFIG` (100/200/200/200/1000 kr).

### Bug-testing-guide
- **Symptom: "Ny variant-config godtas ikke"** → `validateVariantConfig` schema-mismatch. Sjekk Zod-shapes.
- **Symptom: "Premie 0 for ny ticket-farge"** → patternsByColor mangler entry. Default `__default__` brukes hvis ikke matchet.
- **Symptom: "Plain number i prizePerPattern crash"** → Legacy pre-PR-A format. Sjekk `winningTypeOf`-coercion til `{mode: "percent", amount: n}`.

---

## 21. spill1VariantMapper
**Path:** `apps/backend/src/game/spill1VariantMapper.ts`
**LOC:** 535

### Ansvar
Admin-UI → GameVariantConfig mapper for Spill 1. Tar `GameManagement.config_json.spill1` og produserer struktur som BingoEngine forventer. Per-farge premie-matrise er kjernen.

### Public API
- `mapSpill1ConfigToVariantConfig(config: Spill1ConfigInput): GameVariantConfig`
- `resolvePatternsForColor(variantConfig, ticketColor)` — pure helper for farge-lookup
- `Spill1ConfigInput` (interface) — defensive shape av admin-UI JSON

### Avhengigheter
- **Inn:** `variantConfig.ts` (presets + types), `@spillorama/shared-types:buildSubVariantPresetPatterns`.
- **Ut:** Kalles fra `BingoEngine.startGame` (bind variant til room) og fra `BingoEnginePatternEval` (resolvePatternsForColor).

### State-management
**Stateless** — pure mapper.

### Regulatoriske implikasjoner
- **PM-vedtak Option X (2026-04-21):** Per-farge premie-matrise. Multi-winner-split innen én farges vinnere.
- **Sub-variant-presets:** 5 varianter har hardkodet papir-regel-preset — admin-UI sitt manuelle prizePerPattern ignoreres for forutsigbarhet.
- **Bakoverkompat:** Plain number tolkes som `{mode: "percent"}`, undefined config → fallback til DEFAULT_NORSK_BINGO_CONFIG.

### Bug-testing-guide
- **Symptom: "Sub-variant ignorerer admin-input"** → By design for 5 preset-varianter. norsk-bingo/standard respekterer admin-input.
- **Symptom: "Ny farge får 0 premie"** → Default-fallback til `__default__`-matrise. Verifiser PATTERNS_BY_COLOR_DEFAULT_KEY.
- **Symptom: "Kvikkis utbetaler 5 faser"** → Kvikkis skal kun ha Fullt Hus 1000 kr. Sjekk `buildSubVariantPresetPatterns("kvikkis")`.

---

## 22. ComplianceLedger
**Path:** `apps/backend/src/game/ComplianceLedger.ts`
**LOC:** 612

### Ansvar
§11-ledger: append-only event-log for alle pengebevegelser i spill (BUYIN, PRIZE, EXTRA_PRIZE, REFUND, CORRECTION). Generer daglige rapporter, range-rapporter, statistikk, top-players, time-series. Overskudd-fordeling per pengespillforskriften.

### Public API
- `class ComplianceLedger`
- `recordEvent(input)` — append-only
- `recordBuyIn`, `recordPrize`, `recordExtraPrize`, `recordRefund`, `recordCorrection` — typed helpers
- `generateDailyReport`, `generateRangeReport`, `generateGameStatistics`, `generateRevenueSummary`, `generateTimeSeries`, `generateTopPlayers`, `generateGameSessions`
- `exportDailyReportCsv`
- `previewOverskuddDistribution`, `createOverskuddDistributionBatch`
- `makeHouseAccountId(...)` — house-konto-format

### Avhengigheter
- **Inn:** `WalletAdapter`, `ResponsibleGamingPersistenceAdapter`, split-filer: `ComplianceLedgerTypes`, `ComplianceLedgerValidators`, `ComplianceLedgerAggregation`, `ComplianceLedgerOverskudd`. `BingoEngine.DomainError`.
- **Ut:** Kalles fra `BingoEngine` (intern), eksponert via `ComplianceLedgerPort` (adapter) til `Game1TicketPurchaseService`, `Game1PayoutService`, `Game1MiniGameOrchestrator`, `Game1DrawEnginePotEvaluator`.

### State-management
**Hybrid:** In-process state for hot path (rapport-aggregering) + persistert via `ResponsibleGamingPersistenceAdapter` (Postgres).

### Regulatoriske implikasjoner
- **§11 KJERNE:** Netto-tap-formel, rundingsorden, 50k cap, 0.30/0.15 minstegrense. **Byte-identisk bevart** ved PR-S3 split — INVARIANT.
- **Game-type-skille:** `MAIN_GAME` (Spill 1-3, 15%) vs `DATABINGO` (SpinnGo, 30%). Bruker `ledgerGameTypeForSlug` for routing.
- **Ledger er append-only:** Kan ikke endre eksisterende entries — kun via `CORRECTION`-event.
- **Hash-chain:** PR-S3 har `createHash` for tamper-evidence — sjekk om alle recordEvent-paths bruker.

### Bug-testing-guide
- **Symptom: "Daily report viser feil overskudd"** → Netto-tap-formel-bug. Sjekk `generateDailyReport` i ComplianceLedgerAggregation.
- **Symptom: "BUYIN skrives med master-hall i multi-hall"** → K1 BIN-443 regresjon. Verifiser `actor_hall_id` i caller.
- **Symptom: "PRIZE-entry mangler ved Fullt Hus"** → ComplianceLedgerPort ikke wired i `Game1PayoutService`. Sjekk DI.
- **Symptom: "Overskudd-batch dobbeltdistribuerer"** → Idempotency-key-mangel. Sjekk `createOverskuddDistributionBatch` UNIQUE.
- **Symptom: "House-account-id format inkonsistent"** → `makeHouseAccountId` bruker `gameType + channel`. Endring her krever wallet-migrasjon.

---

## 23. ComplianceManager
**Path:** `apps/backend/src/game/ComplianceManager.ts`
**LOC:** 1054

### Ansvar
§66-håndhevelse: tapsgrenser (daglig 900 kr / månedlig 4400 kr default), obligatorisk pause etter 60 min sammenhengende spilling, frivillig pause, selvutestengelse 1 år. Pending-loss-limit-changes med karenstid (legacy-paritet).

### Public API
- `class ComplianceManager`
- `recordLossEntry(input)`, `personalLimitFor(walletId, hallId)`, `wouldExceedLossLimit(...)`
- `setPersonalLossLimits`, `setPersonalLossLimitsWithEffectiveAt`, `promotePendingLossLimitIfDue`
- `setTimedPause`, `clearTimedPause`, `setSelfExclusion`, `clearSelfExclusion`
- `recordPlaySessionTick`, `getPlaySessionState`, `getMandatoryBreakSummary`
- `assertWalletAllowedForGameplay(walletId)` — fail-closed gameplay-guard
- `getPlayerCompliance(walletId, hallId)` — full snapshot for UI

### Avhengigheter
- **Inn:** `ResponsibleGamingPersistenceAdapter`, `BingoEngine.DomainError`, `ComplianceManagerTypes`, `ComplianceDateHelpers`, `ComplianceMappers`.
- **Ut:** Eksponert via `BingoEngine` proxy-metoder. `assertWalletAllowedForGameplay` kalt før hver buy-in og claim.

### State-management
**Hybrid:** In-process Maps for hot path (loss-entries-by-scope, personal-limits, restrictions, play-session-state) + persistert via adapter.

### Regulatoriske implikasjoner
- **§66 obligatorisk pause:** 60 min sammenhengende → 5 min pause. `playSessionLimitMs` + `pauseDurationMs`.
- **§66 tapsgrense:** Default 900/4400. Per-hall override mulig. Karenstid for økning (legacy 7 dager); nedjustering tar effekt umiddelbart.
- **§23 selvutestengelse:** Min 1 år (`DEFAULT_SELF_EXCLUSION_MIN_MS = 365*24*60*60*1000`). Kan ikke clearees før perioden er over.
- **Fail-closed:** `assertWalletAllowedForGameplay` kaster `WALLET_BLOCKED_FOR_GAMEPLAY` ved aktiv pause/selvutestengelse — gameplay må stoppes.

### Bug-testing-guide
- **Symptom: "Tapsgrense ikke håndhevet"** → `wouldExceedLossLimit` returnerer false når den burde true. Sjekk netto-tap-formel: `sum(BUYIN) - sum(PRIZE/REFUND)`.
- **Symptom: "Selvutestengelse opphevet før 1 år"** → `clearSelfExclusion` mangler date-guard. Sjekk `selfExclusionMinMs`.
- **Symptom: "Personal limit-økning trer i kraft umiddelbart"** → karenstid-bug. `promotePendingLossLimitIfDue` skal vente til `effective_at`.
- **Symptom: "Obligatorisk pause utløses ikke etter 60 min"** → `recordPlaySessionTick` ikke kalt fra socket. Sjekk session-tick-cron.
- **Symptom: "Spill tillates under aktiv timed-pause"** → `assertWalletAllowedForGameplay` ikke kalt før purchase. Sjekk caller-paths.
- **Symptom: "Hydration restorer ikke pending limit-changes"** → `hydrateFromSnapshot` mangler felt. Sjekk `ComplianceMappers.toPersistedPendingLossLimitChange`.

---

## 24. Game2Engine
**Path:** `apps/backend/src/game/Game2Engine.ts`
**LOC:** 537

### Ansvar
Spill 2 (Rocket / Tallspill): 3×3 / 1-21 ball-range. Auto-claim-on-draw — ingen manuell claim, vinner detekteres når ticket har full 3×3. Jackpot-tabell + Lucky Number Bonus. Subclass av BingoEngine.

### Public API
- `class Game2Engine extends BingoEngine`
- Override: `onDrawCompleted` (auto-claim hook)
- `getG2LastDrawEffects(roomCode)` → `G2DrawEffects | null` (atomic read-and-clear)
- Const: `GAME2_MIN_DRAWS_FOR_CHECK = 9`

### Avhengigheter
- **Inn:** `BingoEngine`, `Game2JackpotTable.ts:computeJackpotList/resolveJackpotPrize`, `ticket.ts:hasFull3x3`, `IdempotencyKeys`.
- **Ut:** Subclass — wired i `BingoEngineFactory` (eller index.ts) basert på slug. `gameEvents.ts:draw:next` kaller `getG2LastDrawEffects` for socket-emit.

### State-management
**Stateful (subclass):** Per-room G2-effects-buffer. `getG2LastDrawEffects` er atomic read-and-clear.

### Regulatoriske implikasjoner
- **§11:** Multi-winner-split inne i `checkForWinners`. Bruker samme `splitRoundingAudit`-port som Spill 1.
- **Lucky Number Bonus:** Legacy-paritet `gamehelper/game2.js:1628-1712`. Bonus = fixed amount når `lastBall === player.luckyNumber`.
- **`patternEvalMode === "auto-claim-on-draw"` guard:** Hindrer at G2-hook fires for non-G2-rom.

### Bug-testing-guide
- **Symptom: "G2-rom oppfører seg som Spill 1"** → patternEvalMode-guard feiler. Sjekk variantConfig.
- **Symptom: "Vinner detektert før 9 baller"** → `GAME2_MIN_DRAWS_FOR_CHECK = 9`-guard brutt. Sjekk `checkForWinners`-call-site.
- **Symptom: "Lucky-bonus 2x"** → Per-ticket vs per-player. Sjekk ticket-iterasjon.
- **Symptom: "G2DrawEffects null på socket-emit"** → `getG2LastDrawEffects` allerede consumed. Bruk atomic read-and-clear; ikke kall to ganger.
- **Symptom: "Jackpot-list ikke oppdatert per draw"** → `g2:jackpot:list-update` ikke emittet. Sjekk socket-handler.

---

## 25. Game3Engine
**Path:** `apps/backend/src/game/Game3Engine.ts`
**LOC:** 706

### Ansvar
Spill 3 (Mønsterbingo): 5×5 / 1-75 / no-free-centre. Pattern-driven auto-claim med `PatternCycler` (rotating patterns) og ball-threshold (pattern deactiveres etter N balls). Multi-pattern-pris. Subclass av BingoEngine.

### Public API
- `class Game3Engine extends BingoEngine`
- Override: `onDrawCompleted` (auto-claim hook + pattern-cycler)
- `getG3LastDrawEffects(roomCode)` — atomic read-and-clear

### Avhengigheter
- **Inn:** `BingoEngine`, `PatternCycler`, `PatternMatcher`, `ticket.ts:uses5x5NoCenterTicket/buildTicketMask`, `IdempotencyKeys`.
- **Ut:** Subclass — wired basert på slug. `gameEvents.ts:draw:next` kaller `getG3LastDrawEffects`.

### State-management
**Stateful (subclass):** Per-room G3-effects-buffer + `PatternCycler`-state per room.

### Regulatoriske implikasjoner
- **§11 ball-threshold:** `pattern.ballNumberThreshold` deaktiverer pattern etter N draws uten vinner. Legacy `gamehelper/game3.js:738`. Påvirker premie-distribusjon.
- **Pattern-priority:** `getPatternToCheckWinner` — row priority. Avgjør hvilket pattern som vinnes først ved samtidig match.
- **G3 og G2 mutually exclusive:** Samme rom kan ikke ha begge subclass — slug-guard.

### Bug-testing-guide
- **Symptom: "Pattern aldri deaktiveres"** → `ballNumberThreshold`-counter feil. Sjekk `PatternCycler.evaluateAndUpdate`.
- **Symptom: "Multi-pattern wins gir 0"** → split-fordeling per pattern. Sjekk `processPatternWinners`.
- **Symptom: "Ticket med free-centre godkjennes"** → `uses5x5NoCenterTicket`-guard feiler. Sjekk ticket-shape-verification.
- **Symptom: "G3 spawner ad-hoc-room utenom slug"** → `isGame3Round`-guard. Sjekk slug-detection (`game_3` / `monsterbingo`).

---

## Vedlegg: Sub-katalog `minigames/` (ikke i top-25, refererer for komplettering)

Inneholder også:
- `MiniGameWheelEngine.ts` — Wheel of Fortune (8-segment, prize-array)
- `MiniGameChestEngine.ts` — Treasure Chest (3-pick choose-1)
- `MiniGameMysteryEngine.ts` — Mystery Game (10-bucket spin wheel)
- `MiniGameColordraftEngine.ts` — ColorDraft (color-multiplier)
- `MiniGameOddsenEngine.ts` — Oddsen (odds-basert pick)
- `types.ts` — `MiniGame` (interface), `MiniGameType` (union: wheel/chest/mystery/colorDraft/oddsen)

Alle 5 implementerer `MiniGame`-interface og er server-autoritative (klient kan ikke bestemme payout).

## Vedlegg: Sub-katalog `pot/` (ikke i top-25)

- `Game1PotService.ts` — generic + innsatsen + progressive pots per (hall, pot_key)
- `PotEvaluator.ts` — `evaluateAccumulatingPots` — den ekte pot-logikken
- `PotDailyAccumulationTickService.ts` — daglig akkumulering for pots med daglig-rate

---

## Status-felter ikke dekket (kommer i del 2)

Filer i `apps/backend/src/game/` som ikke er top-25 men som bør dokumenteres senere:
- `AdminGame1Broadcaster.ts` (6KB) — socket admin-emit
- `BingoEngineRecovery.ts` + `BingoEngineRecoveryIntegrityCheck.ts` (BIN-245 boot recovery)
- `ComplianceLedgerAggregation.ts` (24KB) — rapport-generering
- `ComplianceLedgerOverskudd.ts` (8KB) — §11-fordeling
- `ComplianceLedgerTypes.ts`, `ComplianceLedgerValidators.ts`, `ComplianceMappers.ts`, `ComplianceDateHelpers.ts` — split-filer
- `DrawBagStrategy.ts` — bag-build for varianter
- `Game1DrawEngineBroadcast.ts`, `Game1DrawEngineCleanup.ts`, `Game1DrawEngineHelpers.ts`, `Game1DrawEnginePhysicalTickets.ts` — DrawEngine-helpers
- `Game1PatternEvaluator.ts` (8KB) — TOTAL_PHASES + sjekk-helpers
- `Game1PlayerBroadcaster.ts`, `Game1TransferExpiryTickService.ts`, `Game1TicketPurchasePortAdapter.ts`
- `PostgresResponsibleGamingStore.ts` (39KB) — adapter for ComplianceManager-persistens
- `PrizePolicyManager.ts` — §11 cap + policy-versjonering
- `PayoutAuditTrail.ts` — append-only audit
- `RoomStartPreFlightValidator.ts` — pre-game-validering
- `SubGameManager.ts` — sub-game-config
- `TvScreenService.ts` (23KB) — TV-skjerm view-state
- `Game2JackpotTable.ts` — Spill 2 jackpot-tabell
- `PatternCycler.ts`, `PatternMatcher.ts`, `idempotency.ts`, `ledgerGameTypeForSlug.ts` — utilities
- `compliance.ts`, `ResponsibleGamingPersistence.ts` — kontrakter

---

**Slutt på del 1.** Estimert dekning: ~85% av Spill 1 hot-path. For runtime debug i pilot er dette tilstrekkelig.
