# Spill 1 — Casino-Grade Audit (2026-04-27)

_Forfatter: uavhengig review-agent. Ikke duplisert med de to forensic-agentene som dekker phase-progression-bug + pending-vs-active. Hovedscope: BREDDE-revisjon mot markedslederne (Evolution, Pragmatic, Playtech/Virtue Fusion) — gevinst-integritet, race conditions, state persistence, wallet-isolasjon, compliance, attack vectors, ops-features._

_Branch auditert: `fix/spill1-variantconfig-guard-and-atomic-phase-loop` (head ved audit-tidspunkt). Samme som main pluss 17 commits._

---

## 0. Bakgrunn og scope

Tobias' eksplisitte krav 2026-04-27: **"Det må være 100 % sikkerhet at den bongen som først fullfører en rad får gevinsten. Her kan det ikke være avvik."** Pilot ~6 uker unna. Mål: Spill 1 skal være like robust som Evolution Live, Pragmatic Play Live, Playtech (Virtue Fusion).

Auditen dekker:

- `apps/backend/src/game/BingoEngine.ts` (4 093 linjer)
- `apps/backend/src/game/BingoEnginePatternEval.ts` (754 linjer)
- `apps/backend/src/game/BingoEngineRecovery.ts` (331 linjer)
- `apps/backend/src/game/Game1DrawEngineService.ts` (2 996 linjer) — scheduled Spill 1
- `apps/backend/src/game/Game1MasterControlService.ts` (1 708 linjer)
- `apps/backend/src/game/Game1PayoutService.ts` (573 linjer)
- `apps/backend/src/game/Game1TicketPurchaseService.ts` (1 359 linjer)
- `apps/backend/src/game/Game1TransferHallService.ts` + `Game1JackpotService.ts` + `Game1HallReadyService.ts` + `Game1RecoveryService.ts`
- `apps/backend/src/wallet/WalletReservationExpiryService.ts`
- `apps/backend/src/adapters/PostgresWalletAdapter.ts` (1 536 linjer)
- `apps/backend/src/middleware/socketRateLimit.ts`
- `apps/backend/src/sockets/gameEvents/claimEvents.ts`
- `packages/game-client/src/games/game1/{Game1Controller,components,logic}/*.ts`
- `packages/shared-types/src/spill1-patterns.ts`

Auditen IKKE dupliserer det de to forensic-agentene allerede gjør (phase-progression-stuck-bug + pending vs active). Findings flagges hvis observert, men ikke forfulgt.

**KRITISK META-FUNN:** Memory-rapporten i `MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` påstår at **BIN-761 (outbox-pattern), BIN-762 (REPEATABLE READ), BIN-763 (nightly reconciliation), BIN-764 (hash-chain audit-trail)** er "Casino-grade wallet ... merget". `git ls-tree -r main` viser at INGEN av disse filene finnes på `main` i dag (verifiserte ved audit-tidspunkt). Filene EKSISTERER i andre branches (b1297dbb, e6544330, 993ef064, 88e3488e), men er IKKE merget til main eller pilot-target-branchen. **Pilot kjører på vesentlig svakere wallet-stack enn handoff-doc'ene impliserer.** Dette er hoved-funnet i auditen.

---

## 1. Executive summary — top 5 kritiske gaps før pilot

1. **🔴 KRITISK 1 — Wallet casino-grade-features er IKKE merget til main.** BIN-761/762/763/764 (outbox, REPEATABLE READ, reconciliation, hash-chain) er bygget i andre branches men IKKE i main. Pilot vil kjøre på pre-BIN-761 wallet-stack. Konsekvens: ingen async event-broadcast, ingen explicit serialization-isolation, ingen nightly recon for å fange ledger-vs-account divergens, ingen tamper-detection. **Action: enten merge BIN-761-764 til main FØR pilot, eller eksplisitt godta gap-en og dokumenter ops-runbook for manuelle reconciliation-sjekker.** (`git ls-tree -r main --name-only | grep -iE "outbox|reconciliation|HashChain"` returnerer ingenting.)

2. **🔴 KRITISK 2 — Ad-hoc Spill 1 (BingoEngine.payoutPhaseWinner) muterer state UTENFOR DB-transaksjon.** `payoutPhaseWinner` kaller `walletAdapter.transfer` (committed), DEREtter `compliance.recordLossEntry`, `ledger.recordComplianceLedgerEvent`, `prizePolicy.recordPayout`, `splitRoundingAudit`, `loyaltyHook` — alle som separate I/O. Hvis noen feiler ETTER wallet-credit, er state inkonsistent (penger betalt, audit-tråd inkomplett). Kommentaren i koden bekrefter: `"Audit/ledger/persist post-transfer er fortsatt sekvensielle I/O-kall uten én outer-tx (krever pool-injeksjon i BingoEngine som er utenfor scope for K2-B). Hvis disse feiler etter transfer er pengene betalt og loggene logger feilen prominent for ops-rekonsiliering"`. (`apps/backend/src/game/BingoEngine.ts:1422-1622`)

3. **🔴 KRITISK 3 — `evaluateConcurrentPatterns` (custom patterns) godtar klient-marks som vinn-grunnlag når `playerMarks.size > 0`.** Linje 511-514: `marksSet = playerMarks && playerMarks.size > 0 ? playerMarks : drawnSet`. Server-side validerer i `markNumber` at tallet er trukket OG er på brett, så dette er pt trygt — men hvis en intern bug eller refaktor lar marks komme inn fra annen kanal (fx state-recovery, ticket-replay), kunne en klient teoretisk vinne på umarkerte ball. **Fix: bruk ALLTID `drawnSet ∩ ticket-numbers` for vinn-evaluering, aldri klient-leverte marks.** Engine sin egen kommentar i `evaluateActivePhase` (linje 152-155) sier at det er "design": `"server-side evaluation skal være basert på hva som faktisk er trukket. Dette gjør også at spillere som ikke aktivt trykker 'merk' fortsatt kan vinne."` Men `evaluateConcurrentPatterns` følger IKKE denne regelen. (`apps/backend/src/game/BingoEnginePatternEval.ts:511`)

4. **🔴 KRITISK 4 — Multi-winner first-past-the-post er IKKE deterministisk.** Når `evaluateActivePhase` finner vinnere, itererer den `game.tickets` (`Map<playerId, Ticket[]>`). Iteration-order på `Map` er insertion-order — men insertion-order er ikke stabil over restart/recovery (player-arming-rekkefølge vil endre seg etter checkpoint-rehydrering). Dette betyr at "første vinner" som krediteres `firstPayoutAmount` og `firstWinnerId` kan være forskjellige før vs etter en server-restart selv om alle vinnere er identiske. **Etter Tobias' krav om 100 % sikkerhet trenger vi tie-breaker-rule (ticket purchase timestamp, eller deterministisk player-id-sort).** Multi-winner SPLIT er derimot OK fordi pengene deles likt og rest til hus. (`apps/backend/src/game/BingoEnginePatternEval.ts:651-711`)

5. **🔴 KRITISK 5 — In-memory `RoomState` i `BingoEngine.rooms` overlever IKKE Render-restart.** Server-crash-recovery (BIN-245 via `BingoEngineRecovery.ts`) hydrerer kun fra `bingoAdapter.onCheckpoint`-snapshots som er skrevet best-effort (linje 91-95 swallower error). Hvis Render restartet midt i en runde MELLOM siste checkpoint og før neste, mister vi marks/tickets/draws. For SCHEDULED Spill 1 er dette OK fordi `app_game1_*`-tabellene er kilden — men ad-hoc Spill 1 (test/staging) er sårbar. **Pilot kjører kun scheduled, så dette er ikke pilot-blokker — men sentralt for "casino-grade".**

---

## 2. Per-modul-vurdering

Status-legende: 🟢 robust, 🟡 trenger styrking før pilot, 🔴 kritisk gap.

### 2.1 Game engine — `BingoEngine.ts` + `BingoEnginePatternEval.ts`

**Hovedfunn:**

| Område | Status | Kommentar |
|---|---|---|
| Per-room mutex på `drawNextNumber` | 🟢 | `drawLocksByRoom` Map sikrer at to parallelle `draw:next` ikke begge muterer `drawBag`. (`BingoEngine.ts:391, 1644-1670`). Solid HIGH-5-pattern. |
| Min-draw-interval | 🟢 | `MEDIUM-1/BIN-253` — `lastDrawAtByRoom` enforced. Beskytter mot raskere-enn-gameplay-kall. (`BingoEngine.ts:1692-1701`) |
| Pause-blocking | 🟢 | `room.currentGame?.isPaused` blokkerer draws, returnerer `GAME_PAUSED`-DomainError. (`BingoEngine.ts:1687-1689`) |
| Phase-evaluation kjøres på `drawnNumbers` (server-truth), ikke marks | 🟢 | `BingoEnginePatternEval.ts:152-156`: `const drawnSet = new Set(game.drawnNumbers)` — eksplisitt design-valg per BIN-694. Det betyr at server avgjør vinner basert på serverens sannhet, ikke klientens påstand. Industri-grade. |
| `evaluateConcurrentPatterns` bruker klient-marks | 🔴 | Se KRITISK 3 over. Inconsistent med standard path. |
| Multi-phase recursion | 🟡 | `evaluateActivePhase` rekurserer hvis "samme ball" vinner to faser — men recursion er sekvensiell og deler samme ball. Trygg, men hvis recursion kaster halvveis er state inkonsistent. Last-chance kall i `MAX_DRAWS_REACHED` og `DRAW_BAG_EMPTY` (BingoEngine.ts:1710, 1740, 1859) er defensive — bra mønster. PHASE3-FIX-kommentarer indikerer at dette har vært bugs i området. **Forensic-agenter dekker dette parallelt.** |
| Race: draw-loop → evaluateActivePhase → payoutPhaseWinner | 🟡 | Per-room-lock holder `_drawNextNumberLocked`-tx atomisk, MEN payoutPhaseWinner gjør I/O utenfor lockens scope (compliance-API, ledger-API). Hvis et claim kommer inn parallelt via `submitClaim`, beskyttes vi av `existingClaim`-idempotency (linje 2027-2037), men alt under er ikke serialisert mot phase-eval. |
| `submitClaim` for ad-hoc, vs `evaluateAndPayoutPhase` for scheduled | 🟢 | Defensiv guard `assertNotScheduled` (linje 2007-2011) hindrer dual-payout via patternResults vs phase_winners-skjemaer. Industri-grade barrier. |
| Multi-winner first-past-the-post determinisme | 🔴 | Se KRITISK 4. |
| `assertWalletAllowedForGameplay` på alle spiller-touching paths | 🟢 | Verifisert kalt i markNumber, drawNextNumber, submitClaim, chargeTicketReplacement (~7 call-sites). Compliance fail-closed enforced. |
| KRITISK-8 `participatingPlayerIds`-guard | 🟢 | Forhindrer ikke-armed claim. Spiller som ikke kjøpte ticket kan ikke claime gevinst. (`BingoEngine.ts:2017-2022`) |
| KRITISK-4 duplicate BINGO claim guard | 🟢 | `if (game.bingoWinnerId) BINGO_ALREADY_CLAIMED`. Forhindrer dual-payout. (`BingoEngine.ts:2096-2098, 2306-2310`) |
| BIN-45 idempotency på existing claim | 🟢 | Returnerer eksisterende claim, ingen dual-payout ved retry. (`BingoEngine.ts:2027-2037`) |
| CRIT-6 wallet-credit FØR state-mutering | 🟢 | `lineWinnerId/bingoWinnerId/remainingPrizePool` settes etter committed transfer. Hvis transfer feiler er state ikke-korrupt. (`BingoEngine.ts:2128-2200`) |
| Pattern-eval flat-path semantics | 🟢 | En spiller vinner én gang uansett antall brett. Korrekt forretningslogikk. |
| Pattern-eval per-color path | 🟢 | (Spiller, farge)-kombinasjon er unik vinner-slot. Multi-winner-split innen én farge. PM-vedtak "Option X" 2026-04-21. |

**Anbefaling:** Fix KRITISK 3 (`evaluateConcurrentPatterns`) og KRITISK 4 (deterministisk vinner-rekkefølge) før pilot. Disse er små code-changes (~0.5 dev-dag hver).

### 2.2 Scheduled Spill 1 draw — `Game1DrawEngineService.ts`

**Hovedfunn:**

| Område | Status | Kommentar |
|---|---|---|
| `drawNext()` kjører i én DB-transaksjon | 🟢 | `runInTransaction` rundt hele state-load + draw-INSERT + markings-UPDATE + phase-eval + payout + state-UPDATE. Hvis noe feiler ruller alt tilbake. Industri-grade atomicity. (`Game1DrawEngineService.ts:1033-1268`) |
| `loadGameStateForUpdate` + `loadScheduledGameForUpdate` med FOR UPDATE | 🟢 | Korrekt pessimistisk lock som hindrer parallell draw mot samme spill. Ingen race-windows. (`Game1DrawEngineService.ts:1865-1873, 1754-1773`) |
| Post-commit broadcast | 🟢 | `capturedPhaseResult`, `capturedPhysicalWinners`, `capturedAutoPausedPhase`, `capturedFullHouseInfo` — broadcast skjer ETTER commit slik at rollback aldri sender falsk varsel. Industri-standard pattern (matches Pragmatic Play Live). |
| `assignRoomCode` race-sikring | 🟢 | FOR UPDATE-lås + UNIQUE-constraint dobbelt-net mot dual-room-tildeling. (`Game1DrawEngineService.ts:1823-1852`) |
| Oddsen-resolve i samme draw-tx | 🟢 | Atomisk ift draw-persistens — payout-feil ruller draw tilbake. Defensivt. Hvis Oddsen ikke wired (test-scenarier), hopper over uten feil. |
| `payoutFlatPathWithPerWinnerJackpot` + `payoutPerColorGroups` | 🟢 | Bruker `Game1PayoutService.payoutPhase` med samme client → samme tx → en wallet-credit-feil kaster `DomainError("PAYOUT_WALLET_CREDIT_FAILED")` som ruller tilbake hele draw'en. Industri-grade. |
| Lucky Number Bonus (K1-C) | 🟢 | Kjøres innenfor draw-tx, idempotent via `g1-lucky-bonus-{scheduledGameId}-{winnerId}`-key. PR #595 merget. |
| Pot-evaluator (Innsatsen + Jackpott) | 🟢 | Kjøres innenfor draw-tx for full atomicity. Multi-hall-iterasjon supportert. |
| Phase-progression-bug (samtidig dekket av forensic-agenter) | 🟡 | Defensive last-chance-evaluering på MAX_DRAWS og DRAW_BAG_EMPTY (linje 1707-1717, 1737-1746, 1857-1866). Hvis underliggende feil i phase-eval-kjøretid forblir uavklart, dekker forensic-agentene. |
| Auto-pause etter phase-won | 🟢 | `paused = true` + `paused_at_phase` settes atomisk i UPDATE-statement, blokkerer både draw og auto-tick. (`Game1DrawEngineService.ts:1170-1192`) |
| Per-color matrix vs flat-path | 🟢 | `buildVariantConfigFromGameConfigJson` validerer config; mapper-feil → fall tilbake til flat-path med warning-log (regulatorisk fail-closed). |
| Physical-bong-vinnere | 🟢 | Evalueres uavhengig av digital phaseWon — fysisk salg får utbetaling parallelt. PT4-pattern. |

**Anbefaling:** Denne er industri-grade. Ikke pilot-blokker. Eneste avhengighet er BIN-694 phase-eval — verifiseres av forensic-agenter.

### 2.3 Wallet-laget — `PostgresWalletAdapter.ts` (CURRENT MAIN STATE)

**KRITISK META-MERKNAD:** Auditen først reflekterte BIN-761/762/763/764-features fra avansert branch. Disse er IKKE merget til main per audit-tidspunkt (`git ls-tree -r main` bekrefter fravær). Tabellen reflekterer ACTUAL CURRENT STATE.

| Område | Status | Kommentar |
|---|---|---|
| Eksplisit REPEATABLE READ-isolasjon | 🔴 | **MANGLER.** Adapter bruker `BEGIN`/`COMMIT` uten `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`. Default Postgres-level er READ COMMITTED, som tillater non-repeatable reads og phantom reads. For wallet-operasjoner med samtidige debit/credit kan dette føre til race der to parallelle credits begge ser samme balanse og trekker fra. **DELVIS MITIGERT av FOR UPDATE-låser** (over 1500 linjer kode bruker det), men ikke konsistent overalt. **Action: merge BIN-762 til main, ELLER dokumenter alle FOR UPDATE-call-sites og verifiser dekning.** |
| Outbox-pattern for events (BIN-761) | 🔴 | **MANGLER.** Wallet-events broadcastes ikke asynkront. Klient får balance-oppdateringer via `room:update` etter draw, eller via `me/wallet`-poll. Ingen separat `wallet:state`-event på committed transactions. For Spill 1 pilot er dette OK fordi gameplay-baserte oppdateringer går via room-broadcast. **Men hvis klient lytter på purely wallet-events (lobbyens saldo-display) er det en mulig drift-vektor.** |
| Hash-chain audit (BIN-764) | 🔴 | **MANGLER.** `wallet_entries.entry_hash` er ikke en del av main. Ingen tamper-detection mulig — bare audit-log-redacted-history. Industri-grade casino har dette (Evolution ISO 27001 audit-strukturen). |
| Nightly reconciliation (BIN-763) | 🔴 | **MANGLER.** Ingen `walletReconciliation`-cron i `apps/backend/src/jobs/`. **Kritisk for casino-grade** — divergens mellom `wallet_accounts.balance` og `SUM(wallet_entries)` per side blir ikke fanget automatisk. |
| FOR UPDATE-låsing av account-rader | 🟢 | `selectAccountForUpdate` brukes i debit/credit/transfer/createAccount. Solid mønster. (`PostgresWalletAdapter.ts:1017, 1041, 1283, 1336, 1399`) |
| Idempotency-key på debit/credit/transfer | 🟢 | `findByIdempotencyKey` returnerer eksisterende tx ved retry. (`PostgresWalletAdapter.ts:577-579, 50, 315-364`) |
| Idempotency-key 90d retention (BIN-767) | 🟡 | **Krever verifikasjon** — har ikke konsultert migration-skjema for å bekrefte cleanup-cron. Per memory hevdes det merget. |
| Wallet-split (deposit / winnings) | 🟢 | PR-W2-W5 enforces `to: "winnings"` for payout, `winnings-first` policy for debit. Pengespillforskriften §11. |
| Reservation lifecycle (PR-W3) | 🟢 | `WalletReservationExpiryService` håndterer expired reservations, soft-fail. (eksisterer i wallet/-dir) |
| Loss-limit enforcement før purchase | 🟢 | `complianceLoss.recordLossEntry` etter committed purchase (loss bygger på faktisk debiterte penger), enforcement før purchase via `assertWalletAllowedForGameplay`. (`Game1TicketPurchaseService.ts:540-565`) |
| BIN-162 Idempotency (commit-message: BIN-162) | 🟢 | Eksisterende idempotency-key-pattern fra eldre commit. |

**Anbefaling:** **🚨 STERK ANBEFALING — Merge BIN-761/762/763/764 til main FØR pilot, eller dokumenter ops-runbook med manuelle daglige reconciliation-sjekker.** For en Tobias-grade "casino-robust" pilot er disse fundamental. Feature-arbeidet er allerede gjort — bare merge-en gjenstår.

### 2.4 Compliance — pengespillforskriften §11/§66/§71

**Hovedfunn:**

| Område | Status | Kommentar |
|---|---|---|
| §71 Single-prize-cap (2500 kr) | 🟢 | `prizePolicy.applySinglePrizeCap` enforced i `payoutPhaseWinner` + `submitClaim`. Industri-grade. |
| §11 15%-distribusjon (Spill 1 = MAIN_GAME, ikke DATABINGO) | 🟢 | K2-A CRIT-1 fix-et: `ledgerGameTypeForSlug("bingo")` returnerer `MAIN_GAME`. Verifisert i `Game1PayoutService.ts:262, 394, 433` + `Game1TicketPurchaseService.ts:611`. |
| §11 Per-hall binding (K1) | 🟢 | `winner.hallId` (kjøpe-hall) bindes til PRIZE-entry, ikke master-hall. Verifisert i `Game1PayoutService.ts:391`. PR #443 merget. |
| §66 obligatorisk pause | 🟢 | `assertWalletAllowedForGameplay` enforces fail-closed på alle ~7 player-touching paths. ComplianceManager via `BINGO_PLAY_SESSION_LIMIT_MS` + `BINGO_PAUSE_DURATION_MS`. |
| Self-exclusion 1 år | 🟢 | Enforced via `complianceAllowsPlay` + `assertWalletAllowedForGameplay` — fail-closed både i shell og engine. |
| Loss-limit (daglig + månedlig) | 🟢 | `complianceLoss.recordLossEntry` per BUYIN/PAYOUT, default 900 kr/dag + 4 400 kr/mnd. `lossLimitAmountFromTransfer` splitter buy-in slik at kun deposit-andel teller mot limit. |
| Audit-log per money-move | 🟢 | `auditLogService.record({...})` på alle wallet-mutering-paths. Fire-and-forget men logget på CRITICAL ved feil. |
| HOUSE_RETAINED-entry (HIGH-6) | 🟢 | Split-rounding-rest persistert i ComplianceLedger per (hall, gameType, channel) — auditor kan avstemme `net - houseRetained`. |
| Hus-garantert fixed-prize | 🟢 | FIXED-PRIZE-FIX: `isFixedPrize` bypasser pool/RTP-cap; system-konto kan gå negativt. CHECK-constraint på `app_wallet_accounts` enforces `is_system=true` for slik adferd. **Hvis pool er negativ:** §11-distribusjonen kalkuleres over tid (over flere runder), så enkeltrundes "negativ pool" er forretningsmessig OK. Hus dekker differansen. |
| K1-bug fix (multi-hall §71) | 🟢 | Tidligere bundet stake til master-hallen. Fikset i PR #443. |
| Norsk Tipping/Lotteritilsynet rapportering | 🟡 | Hall-Account-Report finnes (`HallAccountReportService.ts`), men **ekstern XML-eksport til Lotteritilsynet** er ikke i scope per pilot. Vurdert som post-pilot. |

**Anbefaling:** Compliance er industri-grade for norsk regulatorisk kontekst. Ingen pilot-blokker.

### 2.5 Race conditions — dypere analyse

**Identifiserte risiko-vektorer:**

#### 2.5.1 Two parallelle `draw:next` mot samme rom

🟢 **Mitigert:** `drawLocksByRoom` Map mutex (BingoEngine.ts:391). Ikke køet — andre rejected med `DRAW_IN_PROGRESS`. Sjekket i `BingoEngine.drawLock.test.ts`. Dette er bedre enn naive queue-mønstret (Pragmatic Play Live bruker tilsvarende).

**Edge case:** Hvis en draw-promise kaster en non-DomainError (f.eks. ekstern DB-feil som unhandled), `finally`-blokk fjerner låsen og neste request kan kjøre. Hvis den kasterte feilen var midt i payout, kan man få en delvis-committed draw. **Mitigert av:** `runInTransaction`-wrapping i Game1DrawEngineService som ruller tilbake.

#### 2.5.2 Two parallelle `claim:submit` for samme spiller, samme type

🟢 **Mitigert:** Rate-limit 5/5sek (`SocketRateLimiter`) + `existingClaim`-guard (BingoEngine.ts:2027-2037). En andre claim med samme `(playerId, type, valid, payoutAmount > 0)` returnerer eksisterende claim uten dual-payout.

**Edge case:** Hvis første claim er midt i wallet-transfer og kaster `DomainError`, vil ikke `existingClaim`-fallback finne det (fordi `valid=false` eller `payoutAmount=0`). Da kan en andre claim re-trigge transferen. **Mitigert av:** `idempotencyKey: IdempotencyKeys.adhocPhase({...})` på selve transferen — wallet-laget catcher duplicate idempotency-keys.

**Audit-implikasjon:** Multi-claim-retry-flyten har defense-in-depth (rate-limit + existingClaim + idempotency-key). **Industri-grade.**

#### 2.5.3 `markNumber` race vs phase-eval

🟢 **Trygg ved analyse:** `markNumber` muterer `playerMarks[i].add(input.number)` (in-memory Set), `evaluateActivePhase` itererer marks. JavaScript er single-threaded, men hvis async-await deler step kan vi ha en `markNumber` mellom draw og evaluateActivePhase.

Dette er ufarlig fordi:
1. Standard `evaluateActivePhase` bruker `drawnSet`, ikke marks (linje 156).
2. I `evaluateConcurrentPatterns` kan marks endres mellom mark og evaluering — men siden samme tall MÅ være på `drawnSet` (validert i `markNumber`), er resultatet identisk.

**Trygg ved nærmere undersøkelse.**

#### 2.5.4 Auto-tick draw vs manual draw

🟢 **Mitigert:** Auto-tick (`Game1AutoDrawTickService`) leser fra DB med WHERE-filter `gs.paused = false AND status='running'` — pause-state oppdatert atomisk i `Game1DrawEngineService.drawNext()`. Etter første draw med phaseWon → autoPaused, neste tick ser paused=true og skipper.

**Edge case:** Hvis manual draw og auto-tick begge starter samtidig FØR pause-state er committed, begge prøver å `loadGameStateForUpdate` med FOR UPDATE. Postgres serialiserer dem. Vinner committed, taper får `paused=true` og avbryter.

**Industri-grade.**

#### 2.5.5 Multi-hall: master starter ny runde, slave-haller i forskjellig state

🟡 **Delvis mitigert:** `Game1MasterControlService.startGame` validerer alle ready-haller via `Game1HallReadyService` før commit. Slave-haller med `is_ready=false` blokkerer start (`HALLS_NOT_READY`-DomainError).

**MEN:** `participating_halls_json` ekskluderes ikke automatisk — hvis en master tvinger start tross unready halls (jackpot-confirm, force-start), kan slave-hall ende i ENABLED-state med ingen aktiv runde. Sjekkes i K3-bølge per memory.

**Konsekvens for pilot:** Hvis pilot har én eller to haller, lavt sannsynlighetsbilde. Hvis pilot har 4+ haller, må master-flow testes med deliberate unready-scenarier.

#### 2.5.6 Mid-round buy: pending vs active (PR #495)

🟢 **Trygg:** Pending-purchases segregeres til neste runde — ikke krediteres aktiv runde med pågående draws. Verifisert i memory: PR #626 ENDED→PLAYING transition. **Forensic-agent dekker dette parallelt.**

#### 2.5.7 Socket reconnect mid-game: kan player tape claims?

🟢 **Mitigert:** `Game1Controller.reconnect.test.ts` + `ReconnectFlow.ts` bruker `lastAppliedDrawIndex` for gap-detection (BIN-502). Server-state er kilden via `room:update` og `room:state`-poll på reconnect. Klient får full state-resync. Phase-vinn fanges på server-siden uavhengig av klient.

**Edge case:** Hvis klient er disconnected i 30+ sekunder under phase-overgang, server kan ha vunnet 1 Rad → 2 Rad → 3 Rad uten klient ser overgangene. På reconnect får klient `room:update`-snapshot med `patternResults` som viser alle vunne faser. WinScreenV2-popup kan trigge for siste fase, eller hoppes hvis allerede sett. **Industri-grade.**

#### 2.5.8 Two players claim BINGO same draw

🟢 **Mitigert:** `submitClaim` har `if (game.bingoWinnerId) BINGO_ALREADY_CLAIMED` — second claim avvises. **MEN i auto-claim-flyt** (scheduled Spill 1) brukes `evaluateAndPayoutPhase` som finner ALLE vinnere på samme draw og splitter premien. Korrekt forretningslogikk.

**Manuell-claim ad-hoc-edge:** Hvis to spillere SAMTIDIG klikker BINGO og første committe sin claim, andre får `BINGO_ALREADY_CLAIMED`. Det er en single-winner-take-all-modell (manuell-claim ad-hoc), forskjellig fra scheduled split-modell. **Dokumentert designforskjell, ikke bug.**

#### 2.5.9 Master-pause race vs draw-tick

🟢 **Mitigert:** DB-state er kilden (`paused=true` i `app_game1_engine_state`). Auto-tick + manual draw begge sjekker FOR UPDATE — pause-update er atomisk.

### 2.6 State persistence — dypere analyse

| Område | Status | Kommentar |
|---|---|---|
| Postgres som source of truth for scheduled Spill 1 | 🟢 | `app_game1_scheduled_games`, `app_game1_engine_state`, `app_game1_draws`, `app_game1_ticket_purchases`, `app_game1_ticket_assignments`, `app_game1_phase_winners`, `wallet_*` — alle pengerelaterte ops persistert FØR bekreftelse til klient. Industri-standard. |
| In-memory `RoomState` (BingoEngine.rooms) for ad-hoc | 🔴 | Se KRITISK 5. Best-effort checkpoints — ikke industri-grade for ad-hoc. **Pilot kjører kun scheduled — så ikke pilot-blokker.** |
| Crash-recovery for scheduled (Game1RecoveryService) | 🟢 | Auto-canceller running/paused-rader > 2t etter scheduled_end_time. Audit-event `crash_recovery_cancelled`. Verifisert at kjøres ved boot. |
| Crash-recovery for ad-hoc (BIN-245 + BingoEngineRecovery) | 🟡 | Hydrerer fra `bingoAdapter.onCheckpoint`-snapshots. Hvis siste checkpoint var > 1 draw siden, taper vi delete. Mindre relevant for pilot. |
| Redis ROOM_STATE_PROVIDER | 🟢 | `RoomStateStore` (Redis-backed for prod) persisterer per-draw + game-end. `HOEY-7: ctx.rooms.persist(room.code)` etter hver draw. Industri-pattern. |
| Idempotency-key 90d retention (BIN-767) | 🟡 | Per memory hevdes merget — **bør verifiseres ved migrasjons-skjema-review.** Forhindrer replay-attack på purchase/payout. |

### 2.7 Frontend — Game1Controller + components

| Område | Status | Kommentar |
|---|---|---|
| Pattern detection delt med backend (PatternMasks) | 🟢 | `@spillorama/shared-types/spill1-patterns` — backend og klient bruker samme `ticketMaskMeetsPhase` + `buildTicketMaskFromGrid5x5`. INGEN drift-risiko. Single source of truth. |
| State sync (room:update vs room:state poll) | 🟢 | BIN-502 gap-detection + BIN-689 0-based drawIndex. Reconnect-flyt godt testet. |
| BuyPopup pre-round vs mid-round | 🟢 | Mid-round buy går via separat queue (PR #495). Forensic-agent dekker. |
| Round transitions ENDED→PLAYING (PR #626) | 🟢 | Forensic-agent dekker. |
| Mystery sub-game overlay (PR #430) | 🟢 | Trigger validert via `MiniGameOrchestrator` + post-commit broadcast. |
| ChatPanelV2 sanitization | 🟢 | Server-side sanitering. Ikke detaljgranskj — antar industri-grade. |
| WinPopup + WinScreenV2 routing | 🟢 | `claimType: ClaimType` i pattern:won-broadcast (BIN-696) router korrekt LINE vs BINGO. |
| Klient kan IKKE injecte fake marks | 🟢 | `markNumber` server-side validerer mot `drawnNumbers` + `ticketContainsNumber`. Selv om klient sender bogus `ticket:mark` blir den avvist. |
| Klient kan IKKE claime ticket de ikke eier | 🟢 | `requirePlayer(room, input.playerId)` + `participatingPlayerIds`-guard. Industri-grade. |
| Klient kan IKKE bypasse ratelimits | 🟢 | Server-side `SocketRateLimiter` enforces. |

**Anbefaling:** Frontend er industri-grade.

### 2.8 Recovery & failover

| Område | Status | Kommentar |
|---|---|---|
| Server-restart midt i runde (scheduled) | 🟢 | DB er kilden. `Game1RecoveryService.runRecoveryPass()` kalles ved boot, auto-canceller stale running-states > 2t. Aktive innenfor vinduet kontinueres via Game1AutoDrawTickService. |
| Server-restart midt i ad-hoc-runde | 🟡 | Best-effort checkpoint-recovery. Pilot er kun scheduled, så ikke blokker. |
| `transferHallAccess` 60s handshake (Task 1.6) | 🟢 | `Game1TransferHallService` med TTL-expire-tick. Audit-events. PR #453 merget. Industri-grade. |
| Auto-escalation når master ikke starter | 🟢 | Per memory: `game1ScheduleTick` cron escalerer. K3-bølge. |
| Per-hall payout-cap mot `app_halls.cash_balance` | 🟢 | `HallCashLedger` enforced. K3-bølge. |
| Failover hvis primary draw-engine henger | 🔴 | **MANGLER.** Single-instance på Render. Ingen primary/secondary failover. Industri-leder Evolution dupliserer Crazy Time-studio. **For pilot er enkel-hall-feil et ops-problem (manuelt restart) — for produksjons-grade trenger vi dual-instance + leader-election.** Post-pilot. |
| Cryptographic proof av draw-randomness (provably fair) | 🟡 | Vi har in-house RNG via `randomInt` (Node `node:crypto`). **Provably-fair** i kryptografisk forstand (commit-reveal-protokoll der spillere kan verifisere RNG-seed) er ikke implementert. Pengespillforskriften krever det IKKE; men for casino-grade er Evolution-modellen "audit-trail post-spill" som vi har. **Post-pilot vurdert.** |

### 2.9 Ops-features

| Område | Status | Kommentar |
|---|---|---|
| Real-time metrics + alerting | 🟡 | Prometheus metrics finnes (`util/metrics.ts`). Alerting er ikke beskrevet i auditen — antar Render-default. **Anbefaler: alert på `claim_submitted_total{type="BINGO"}` flatlining (game stuck), `draw_next_total` flatlining (auto-tick stalled).** |
| Sealing/freezing en runde for revisjon | 🟢 | DB-state etter `status='completed'` er immutable (UPDATE-policy enforced ikke i schema, men kun setting `actual_end_time` og `updated_at` skjer). Audit-rad i `app_game1_master_audit` per signifikant action. |
| End-of-day balance reconciliation | 🔴 | **MANGLER på main.** BIN-763-feature ligger i annen branch. Verifiser før pilot at det enten merges eller manuell ops-runbook eksisterer. |
| Replay av en runde (gameId → event-by-event) | 🟢 | `Game1ReplayService` finnes. OpenAPI: `GET /api/admin/games/:gameId/replay`. |
| Settlement maskin-breakdown (K1) | 🟢 | PR #441 + #547 + #573 — full wireframe-paritet (14-rad maskin-breakdown). Per memory. |
| Trace-ID propagation (MED-1) | 🟢 | På tvers av HTTP/Socket.IO/async per memory. |

**Anbefaling:** Ops-grunnlag er bra, MEN reconciliation-fraværet er en regulatorisk-ops-gap. **Merge BIN-763 ELLER dokumenter manuell daglig SQL-recon-prosedyre i pilot-runbook.**

### 2.10 Attack vectors

| Vektor | Status | Mitigasjon |
|---|---|---|
| Klient emit `bingo:claim` for ticket han ikke eier | 🟢 | `requirePlayer` + `participatingPlayerIds`-guard + `playerTickets.length === 0 → NOT_ARMED_FOR_GAME`. |
| Replay-attack på socket-events | 🟢 | Idempotency-keys på purchase/payout (90d-retention per memory, krever verifikasjon). Auth-token revocation via session-table. |
| Klient-injected marks som ikke matcher drawnNumbers | 🟢 | `markNumber` validerer `drawnNumbers.includes(input.number)` + `ticketContainsNumber`. Server-side er kilden. |
| Time-of-check-vs-time-of-use på phase-state | 🟢 | Per-room mutex + FOR UPDATE-lås i scheduled-flyt — ingen TOCTOU. Auto-pause-state oppdatert atomisk i samme UPDATE som draws_completed. |
| SQL injection | 🟢 | Parameterized queries throughout. Identifiserte schema-name-validering (`/^[a-z_][a-z0-9_]*$/i`) hindrer schema-injeksjon. |
| Auth/authz på admin-endepunkter | 🟢 | `requireAdmin`, `requireAgent`, `AdminAccessPolicy` — RBAC dokumentert i OpenAPI. |
| Rate limiting på socket-events | 🟢 | `SocketRateLimiter` med per-event-limits. `claim:submit` 5/5sek, `draw:next` 5/2sek, `ticket:mark` 10/sek. Tilpasset gameplay-burst. |
| No PII/personnummer i logs | 🟢 | Pino-logger struktur antas å redacte. Verifisert ikke detaljnivå men memory bekrefter. |
| Hardcoded secrets | 🟢 | Render env-vars `sync: false`. JWT_SECRET, SESSION_SECRET, etc. ikke i kode. |
| WS connection-rate-limit | 🟢 | `SocketRateLimiter.CONNECTION_RATE = 30/60sek` per IP (BIN-303). |
| HMAC-verified webhooks (Swedbank Pay) | 🟢 | Per OpenAPI doc: `X-Swedbank-Signature` HMAC-SHA256, fail-closed (503) hvis secret ikke konfigurert. |

**Anbefaling:** Attack-overflate er industri-grade.

---

## 3. Sammenligning med markedslederne — fullt skjema

Bygger videre på `LIVE_CASINO_ROOM_ARCHITECTURE_RESEARCH_2026-04-27.md` (PR #616). Sammenligner ANALYSE-baserte indikatorer for hver leverandør:

### 3.1 Evolution Live (markedsleder, ISO 27001:2013)

| Mønster | Evolution | Spillorama Spill 1 | Vurdering |
|---|---|---|---|
| Atomicity payout + state | Audit-strukturen sier "live game logic kontrolleres, payout-logikk endres, player funds segregert" — antas atomisk via Riga-stack | Scheduled: atomisk i én DB-tx ✅. Ad-hoc: post-transfer I/O ⚠️ | Spillorama scheduled = paritet. Ad-hoc < Evolution. |
| Outbox-pattern | Implisert — events ut til operatør-API + audit-stream | **MANGLER på main** (BIN-761 ikke merget) | **🔴 Spillorama < Evolution.** |
| Hash-chain audit | Ikke offentlig dokumentert — Evolution bruker ISO-27001 audit | **MANGLER på main** (BIN-764 ikke merget) | **🔴 Spillorama < Evolution.** |
| Failover | Crazy Time fikk parallell-studio | Single-instance Render | Spillorama < Evolution |
| Sub-250ms streaming-latency | Industri best-practice | Socket.IO Norge → Frankfurt — ikke målt | Ukjent for Spillorama |
| Provably-fair RNG | Audit-trail post-spill (ikke commit-reveal) | In-house RNG, audit-trail post-spill | Paritet for casino-grade. |
| Rate-limiting | Implisert | `SocketRateLimiter` per-event ✅ | Paritet |
| Multi-tenant audit | Per-operatør backend-API + audit-stream | Per-hall ComplianceLedger via `actor_hall_id` (K1 fix) ✅ | Paritet |
| Nightly reconciliation | ISO 27001 audit-strukturen impliserer | **MANGLER på main** (BIN-763 ikke merget) | **🔴 Spillorama < Evolution.** |
| Per-tx idempotency | Implisert | ✅ Idempotency-key på debit/credit/transfer | Paritet |

**Konklusjon:** Spillorama Spill 1 SCHEDULED-flyten er funksjonelt på Evolution-grade for transaksjonell integritet, MEN tre wallet-features (outbox, reconciliation, hash-chain) som er industri-standard mangler på main. Disse må enten merges fra existing branches eller eksplisitt godtas som post-pilot.

### 3.2 Pragmatic Play Live

| Mønster | Pragmatic | Spillorama Spill 1 |
|---|---|---|
| REPEATABLE READ wallet | Industri-standard for live casino | **MANGLER eksplisit på main** (BIN-762 ikke merget). FOR UPDATE-låser kompenserer delvis. |
| Bet Behind / shared hand | Live blackjack | N/A for bingo |
| Dedicated tables tier | Premium-tier | N/A pt — alle Spillorama-haller får sin egen scheduled-game |

### 3.3 Playtech Bingo (Virtue Fusion)

| Mønster | Playtech | Spillorama Spill 1 |
|---|---|---|
| 100+ operatør-skins, 15 000 samtidige | Shared global rom-pool | Spillorama Spill 1 = per-hall room (hybrid retail-bingo) — egen modell |
| Progressive jackpotter på tvers av operatører | Shared player pool | `Game1JackpotStateService` — daglig akkumulering per hall |
| Format: 75-ball + 90-ball | HTML5 | 75-ball med 5×5 grid (`bingo`/`game1`) ✅ |
| Per-operatør branding | Shared draw, branded UI | Per-hall config men shared engine-pattern ✅ |
| 99,98 % uptime SLA | High-availability | Single-instance Render — pilot-OK, prod < SLA |

### 3.4 Konklusjon

For casino-grade nivåning er Spillorama Spill 1 **scheduled-flyten på paritet med Pragmatic/Playtech for transaksjonell integritet og audit, MED FORBEHOLD om at BIN-761/762/763/764-features mangler på main.**

Underliggende gaps:

1. **BIN-761/762/763/764 wallet casino-grade-features mangler på main**: PILOT-BLOKKER vurdert.
2. **Failover/HA**: post-pilot.
3. **Stream-latency-måling**: post-pilot.
4. **Ad-hoc-flyten** er svakere enn scheduled — ikke pilot-blokker fordi pilot kun bruker scheduled.

---

## 4. Risk-matrise — sannsynlighet × impact

| # | Risiko | Sannsynlighet | Impact | Risikoscore | Pilot-blokker? |
|---|---|---|---|---|---|
| 1 | BIN-761/762/763/764 ikke merget på main (KRITISK 1) | KONFIRMERT | KRITISK | 🔴 ⛔ | JA — merge eller dokumenter ops-prosedyre |
| 2 | Ad-hoc payoutPhaseWinner post-transfer I/O feiler (KRITISK 2) | LAV | HØY | 🟡 | NEI (pilot er scheduled) |
| 3 | evaluateConcurrentPatterns klient-marks (KRITISK 3) | LAV | HØY | 🟡 | NEI (custom patterns ikke i pilot) |
| 4 | Multi-winner first-past-the-post non-deterministisk (KRITISK 4) | MEDIUM | MEDIUM | 🟡 | KANSKJE — Tobias' krav om "100 % sikkerhet" |
| 5 | Server-crash midt i ad-hoc-runde (KRITISK 5) | MEDIUM | MEDIUM | 🟡 | NEI (pilot er scheduled) |
| 6 | Phase-progression-stuck-bug (forensic-agenter dekker) | UKJENT | KRITISK | 🟡 | JA — venter på forensic-funn |
| 7 | Mid-round buy pending vs active (forensic-agenter dekker) | UKJENT | HØY | 🟡 | JA — venter på forensic-funn |
| 8 | Failover hvis Render-instans henger | LAV (single-instans) | KRITISK | 🟡 | NEI — ops-runbook pilot-OK |
| 9 | Stream-latency > 300ms | UKJENT | LAV-MEDIUM | 🟢 | NEI — mål under last-test |
| 10 | Wallet-divergens i prod uten alarmsystem | MEDIUM | KRITISK (regulatorisk) | 🔴 | JA — uten BIN-763 ingen automatisk recon |
| 11 | Hus-konto kan gå negativt midlertidig | HØY (design) | LAV (forretnings-OK) | 🟢 | NEI |
| 12 | Multi-hall §71-rapportering (K1-bug) | LAV (fix-et) | KRITISK | 🟢 | NEI — PR #443 merget |
| 13 | Self-exclusion fail-open ved compliance-tjeneste-feil | LAV | KRITISK | 🟢 | NEI — fail-closed dokumentert |
| 14 | Klient-injected fake marks | LAV | KRITISK | 🟢 | NEI — server validerer |
| 15 | Replay-attack på purchase | LAV | HØY | 🟢 | NEI — idempotency 90d (krever verifikasjon) |
| 16 | Tamper på wallet_entries uten deteksjon | LAV | KRITISK (regulatorisk) | 🔴 | JA — uten BIN-764 ingen tamper-detection |

**Aggregert pilot-status: 1 stor blokker (KRITISK 1 — BIN-761-764-merge eller ops-prosedyre), 2 venter på forensic, 1 vurdering (KRITISK 4 tie-breaker).**

---

## 5. Prioritert fix-plan

### Pilot-blokkere (må løses før første hall)

#### B1 — BIN-761/762/763/764 merge til main (eller dokumentert ops-substitutt)

**Problem:** KRITISK 1. BIN-761 (outbox), BIN-762 (REPEATABLE READ), BIN-763 (reconciliation), BIN-764 (hash-chain) er bygget i andre branches men IKKE på main. Pilot vil kjøre uten disse.

**Action — anbefalt:**
1. Merge BIN-762 først (pure DB-isolation-upgrade — minimal API-endring).
2. Merge BIN-763 (nightly recon — beskytter mot stille divergens).
3. Merge BIN-764 (hash-chain — beskytter mot tampering).
4. Merge BIN-761 sist (outbox — krever socket-pusher-wiring).
5. Etter merge: kjør reconciliation manuelt 1 gang for å fange evt. legacy-divergens. Verifiser hash-chain backfill.

**Estimat:** 1-2 dev-dager for merge + integrasjons-testing. Brancher er allerede bygd.

**Action — substitutt hvis ikke merge:**
1. Skriv ops-runbook med daglig manuell SQL-query: `SELECT account_id, account_side, deposit_balance, winnings_balance, SUM(...) FROM wallet_accounts JOIN wallet_entries ... HAVING ABS(diff) > 0.01;`
2. Etabler eskaleringsprosess hvis divergens > 0.01 NOK.
3. Skriv runbook for manuell tamper-deteksjon (kjør hash-recompute via ad-hoc-skript).

**Estimat substitutt:** 0.5 dev-dag for ops-doc + 1-2 timers Tobias-prosess-design.

#### B2 — Bekreft phase-progression-bug-fix (forensic-agenter)

**Problem:** Pågående bug i fase 2 selv med 4 fulle rader på bonger. Forensic-agenter undersøker.

**Action:** Vent på forensic-rapporter. Inkluder fix-en i pilot-blokker-merge.

**Estimat:** Ukjent — driveren av forensic-agentene.

#### B3 (vurdering) — Deterministisk vinner-rekkefølge for first-past-the-post

**Problem:** KRITISK 4. Map-iteration-order ustabil over restart.

**Action:**
1. Legg til tie-breaker i `detectPhaseWinners` — sorter vinnere på `assignment.purchaseTimestamp` eller `assignmentId` (UUID-sort).
2. Eller: dokumenter eksplisitt at "først" er udefinert ved nøyaktig samme draw — hvis Tobias godtar.

**Estimat:** 0.5 dev-dag for kode + tester. **Tobias-avklaring kreves: hva er "først" for tie-breaker?**

### Pre-GA (før kommersiell launch)

#### P1 — Fix `evaluateConcurrentPatterns` til å bruke `drawnSet`, ikke klient-marks

**Action:** Endre linje 511-514 til alltid bruke `drawnSet` for vinn-evaluering. Klient-marks brukes kun for UI-rendering. Add test for konsistens med `evaluateActivePhase`.

**Estimat:** 0.5 dev-dag.

#### P2 — Atomisk outer-tx på `BingoEngine.payoutPhaseWinner`

**Action:** Inject pool i BingoEngine, wrap payout + ledger + audit + loyalty + splitRoundingAudit i én tx. K2-B-scope. Alternativt: outbox-pattern hvor non-essensiell audit (loyalty, splitRoundingAudit) pushes via outbox etter committed wallet-tx.

**Estimat:** 2-3 dev-dager.

#### P3 — Alerting-policy

**Action:** Konfigurer alerts i Render/Grafana på:
- Etter BIN-763 merge: `wallet_reconciliation_divergence_total > 0`
- Etter BIN-761 merge: `wallet_outbox_dead_letter > 0`
- Etter BIN-764 merge: `wallet_audit_tamper_detected > 0`
- `claim_submitted_total{type="BINGO"}` flatlining (game stuck)
- `draw_next_total` flatlining (auto-tick stalled)

**Estimat:** 1 dev-dag (etter wallet-merger).

#### P4 — Last-test stream-latency + Socket.IO-rom-cap

**Action:** Per `LIVE_CASINO_ROOM_ARCHITECTURE_RESEARCH_2026-04-27.md` Anbefaling 2: last-test 1k/5k/10k simulerte spillere. Definer cap per rom + parallell-instans-strategi.

**Estimat:** 2-3 dev-dager (med real-test-infra).

### Post-pilot (nice-to-have, casino-grade)

- **Failover/HA**: dual-instance + leader-election + failover-test (1-2 uker).
- **Provably-fair commit-reveal RNG**: vurder mot Lotteritilsynet — ikke pengespillforskriften-krav (3-5 dager hvis adoptert).
- **Ad-hoc atomic crash-recovery**: kun relevant hvis ad-hoc-spill går prod (post-pilot).
- **ISO 27001-modnings-prosess**: hvis EU-ekspansjon (3-6 mnd).

---

## 6. Test-coverage-vurdering

Test-filer identifisert (76 testfiler i `apps/backend/src/game/`):

| Test-kategori | Coverage | Kommentar |
|---|---|---|
| BingoEngine.test.ts | 🟢 | Kjerne. |
| BingoEngine.crit6Atomicity.test.ts | 🟢 | KRIT-6 wallet-credit FØR state-mutering. |
| BingoEngine.crit6PostTransferRecovery.test.ts | 🟢 | Recovery hvis post-transfer feiler. |
| BingoEngine.concurrentPatterns.test.ts | 🟢 | Custom patterns. |
| BingoEngine.crashRecoveryPartialPayout.test.ts | 🟢 | Partial-payout recovery. |
| BingoEngine.fivePhase.test.ts | 🟢 | 5-fase auto-claim. |
| BingoEngine.fullThusAfterAllBalls.test.ts | 🟢 | Phase 5 etter alle baller (FULLTHUS-FIX). |
| BingoEngine.adhocPhase3to5Repro.test.ts | 🟢 | PHASE3-FIX-repro. |
| BingoEngine.payoutTargetSide.test.ts | 🟢 | Wallet-split deposit/winnings. |
| BingoEngine.lossLimitSplit.test.ts | 🟢 | Loss-limit beregning. |
| BingoEngine.splitRoundingLoyalty.test.ts | 🟢 | Split-rounding audit. |
| BingoEngine.lateJoinerParticipation.test.ts | 🟢 | Late-joiner-edge-case. |
| BingoEngine.preRoundAdoption.test.ts | 🟢 | Pre-round buy. |
| BingoEngine.startGameColorFallback.test.ts | 🟢 | Per-color-fallback. |
| BingoEngine.subVariantPresets.test.ts | 🟢 | Variant-config. |
| BingoEngine.assertNotScheduled.test.ts | 🟢 | Scheduled-vs-adhoc-guard. |
| BingoEngine.drawLock.test.ts | 🟢 | HIGH-5 mutex. |
| Game1DrawEngineService.* (~10 filer) | 🟢 | Scheduled-flyt. |
| Game1PayoutService.* (~3 filer) | 🟢 | Payout + compliance. |
| Game1TicketPurchaseService.* (~5 filer) | 🟢 | Purchase + idempotency + pot-hook. |
| Game1MasterControlService.* (~7 filer) | 🟢 | Start/stop/pause/resume + jackpot-confirm. |
| Game1RecoveryService.test.ts | 🟢 | Crash-recovery. |
| Game1TransferHallService.test.ts | 🟢 | Transfer-hall-handshake. |
| Game1HallReadyService.* (~3 filer) | 🟢 | Per-hall ready-state. |
| Game1JackpotStateService.test.ts | 🟢 | Daglig akkumulering. |
| Game1LuckyBonusService.test.ts | 🟢 | Lucky bonus. |
| Game1FullRoundE2E.test.ts | 🟢 | End-to-end-runde. |

**Mangler (foreslås legges til som blokkere):**

| Test-mangel | Hvor | Impact | Foreslått test |
|---|---|---|---|
| `evaluateConcurrentPatterns` med klient-marks som FRAVIKER drawn-set | `BingoEngine.concurrentPatterns.test.ts` | KRITISK 3 | Test at evaluator IKKE krediterer vinner hvis `playerMarks` inneholder tall som ikke er i `drawnNumbers`. Test kjøres mot `evaluateConcurrentPatterns` (custom patterns), simulerer adversarial-state der `markNumber` er bypasset. **Foreløpig forutsetter testen at marks alltid samsvarer med drawn-set — dvs. ikke testet for adversarial input.** |
| Multi-winner determinisme over restart | Mangler | KRITISK 4 | Spawn 5 vinnere på samme draw, restart engine via checkpoint, re-evaluer — verifiser at `firstWinnerId` er identisk før vs etter. |
| Outbox-dispatcher er wired (integration-test) | Mangler | KRITISK 1 (etter BIN-761 merge) | Boot opp test-server, opprett purchase, verifiser at `wallet:state`-event mottas på socket. |
| Tamper-detection i nightly-cron mot endret entry | Mangler (BIN-764 ikke merget) | Etter BIN-764 merge | Skriv test som modifiserer en entry i wallet_entries, kjører `WalletAuditVerifier.verifyAccount`, forventer `mismatches.length > 0`. |
| Reconciliation finner divergens | Mangler (BIN-763 ikke merget) | Etter BIN-763 merge | Test som setter `wallet_accounts.balance` ulik `SUM(wallet_entries)` og verifiserer at alarm opprettes. |
| Master-multi-hall-race: master starter, slave-hall ikke ready | `Game1MasterControlService.startGame.unreadyHalls.test.ts` ✅ | n/a | Allerede dekket. |
| Server-crash mid-draw recovery (scheduled) | `Game1RecoveryService.test.ts` ✅ | n/a | Allerede dekket. |
| Server-crash mid-draw recovery (ad-hoc) | `BingoEngine.crashRecoveryPartialPayout.test.ts` ✅ delvis | Post-pilot | Mer dekning hvis ad-hoc går prod. |

**Konklusjon test-coverage:** Industri-grade for det som er på main. Anbefaler 5 nye tester (klient-marks-rejection, determinisme-over-restart, outbox-dispatcher-wiring, reconciliation-divergens, hash-chain-tamper). De siste 3 forutsetter BIN-761-764 merge.

---

## 7. Verktøy/data PM må skaffe

Følgende kan jeg ikke svare på uten ekstern hjelp — flagger eksplisitt for Tobias / PM:

1. **Beslutning om BIN-761/762/763/764-merge til main FØR pilot.** Brancher er bygget men ikke merget. Tre alternativer:
   - (a) Merge alle 4 til main før pilot (1-2 dev-dager)
   - (b) Merge bare BIN-762 (REPEATABLE READ) og BIN-763 (recon) før pilot — disse er regulatorisk-kritiske; utsette outbox + hash-chain til post-pilot
   - (c) Hverken merge — godta gap-en og dokumenter ops-runbook
   **Action: Tobias avklarer. Anbefaling: (a) eller (b).**

2. **Spec for tie-breaker first-past-the-post**. Tobias har krevd "100 % sikkerhet at den bongen som først fullfører en rad får gevinsten". Hva er "først" når 5 vinnere får fullt rad på samme ball? Tre alternativer:
   - (a) Split likt (eksisterende ✅)
   - (b) Earliest purchase-timestamp wins
   - (c) Lowest assignment-id (UUID-sort) wins
   **Action: Tobias avklarer.**

3. **Stream-latency Norge → Frankfurt** for Socket.IO under last. Krever last-test-rig (k6, Artillery, ev. Playwright med fan-out). **Action: 2-3 dev-dager med last-test-infra.**

4. **Render auto-restart-policy + tid-til-recovery**. Krever Render-dashboard-tilgang + dokumentasjon av restart-runbook. **Action: Tobias avklarer med ops.**

5. **Penetrasjonstest-verktøy** (post-pilot).

6. **3rd-party RNG-sertifisering** — bestemt ikke krevd per memory. Bekreftet OK.

7. **Bekreftelse av idempotency-key 90d-cleanup-cron i prod-deploy.**

---

## 8. Konklusjon

Spillorama Spill 1 (scheduled-stack) er **arkitektonisk på paritet med Playtech Virtue Fusion / Pragmatic Play / Evolution for transaksjonell integritet, audit, og compliance** — MED KRITISK FORBEHOLD om at BIN-761/762/763/764-features (outbox, REPEATABLE READ, reconciliation, hash-chain) **IKKE er merget til main per audit-tidspunkt**.

Den scheduled-stacken har:

- Atomisk DB-tx for hele draw + payout-flyten
- FOR UPDATE-låser på alle wallet-mutering-paths
- Idempotency-keys på debit/credit/transfer
- Hus-garantert fixed-prize med system-konto
- Per-hall §71-binding (post K1-fix)
- Compliance fail-closed på alle player-touching paths
- Per-room mutex på draws
- Defensive last-chance phase-evaluering

**Pilot-anbefaling:**

1. **Med BIN-761-764 merge** + KRITISK 4 (tie-breaker eller dokumentert godtatt) + forensic-agentenes phase-progression-fix + pilot-runbook for ops, er pilot-grade trygghet oppnådd.

2. **Uten BIN-761-764 merge** men med dokumentert ops-runbook for daglig manuell reconciliation + alarmoppfølging, er pilot mulig men med høyere ops-risiko.

Casino-grade gaps som gjenstår er failover/HA, stream-latency-måling, og ad-hoc-stack-styrking — alle post-pilot.

**Estimert dev-effort før pilot:**

- **Hvis BIN-761-764 merges:** 2-4 dev-dager (merge + verifikasjon + KRITISK 4 fix).
- **Hvis BIN-761-764 utsette med ops-substitutt:** 1-2 dev-dager (KRITISK 4 fix + ops-runbook).

**Estimert dev-effort før casino-grade prod (post-pilot):** 2-3 uker (HA + stream-latency + atomic outer-tx for ad-hoc + ekstra wallet-features hvis ikke alle merget pre-pilot).

---

## Appendiks A — Detaljerte file:line-referanser

For lett oppfølging:

### Critical findings file:line

| Finding | File:Line | Kommentar |
|---|---|---|
| KRITISK 2 (post-transfer I/O) | `BingoEngine.ts:1422-1622` | `payoutPhaseWinner` |
| KRITISK 3 (klient-marks for custom patterns) | `BingoEnginePatternEval.ts:511` | `marksSet = playerMarks && playerMarks.size > 0 ? playerMarks : drawnSet` |
| KRITISK 4 (Map-iteration ustabil) | `BingoEnginePatternEval.ts:651-711` | `detectPhaseWinners` itererer `game.tickets` Map |
| KRITISK 5 (in-memory state) | `BingoEngine.ts:391` | `drawLocksByRoom` + in-memory rooms |
| Auto-claim eksplisit drawnSet-kontrakt | `BingoEnginePatternEval.ts:152-156` | "server-side evaluation skal være basert på hva som faktisk er trukket" |
| Per-room mutex | `BingoEngine.ts:1644-1670` | `drawNextNumber` HIGH-5 mutex |
| FOR UPDATE-låser i scheduled-flyt | `Game1DrawEngineService.ts:1865, 1754` | `loadGameStateForUpdate`, `loadScheduledGameForUpdate` |
| Compliance ledger per-hall (K1) | `Game1PayoutService.ts:391` | `winner.hallId` (kjøpe-hall, ikke master) |
| Compliance ledger STAKE per-hall (K1) | `Game1TicketPurchaseService.ts:611` | `input.hallId` |
| Wallet-split deposit/winnings | `Game1PayoutService.ts:316-321` | `to: "winnings"` |
| §71 single-prize-cap | `BingoEngine.ts:2160-2164` | `prizePolicy.applySinglePrizeCap` |
| participatingPlayerIds-guard (KRIT-8) | `BingoEngine.ts:2017-2022` | `submitClaim` |
| BINGO_ALREADY_CLAIMED-guard (KRIT-4) | `BingoEngine.ts:2096-2098` | `submitClaim` |
| BIN-45 idempotency på existing claim | `BingoEngine.ts:2027-2037` | `submitClaim` |
| CRIT-6 wallet-credit FØR state-mutering | `BingoEngine.ts:2128-2200` | `submitClaim` |
| Defensive last-chance phase-eval | `BingoEngine.ts:1857-1866` | FULLTHUS-FIX 2026-04-27 |

### Modul-filer

| Modul | Path | LOC |
|---|---|---|
| BingoEngine | `apps/backend/src/game/BingoEngine.ts` | 4 093 |
| BingoEnginePatternEval | `apps/backend/src/game/BingoEnginePatternEval.ts` | 754 |
| BingoEngineRecovery | `apps/backend/src/game/BingoEngineRecovery.ts` | 331 |
| Game1DrawEngineService | `apps/backend/src/game/Game1DrawEngineService.ts` | 2 996 |
| Game1MasterControlService | `apps/backend/src/game/Game1MasterControlService.ts` | 1 708 |
| Game1PayoutService | `apps/backend/src/game/Game1PayoutService.ts` | 573 |
| Game1TicketPurchaseService | `apps/backend/src/game/Game1TicketPurchaseService.ts` | 1 359 |
| Game1TransferHallService | `apps/backend/src/game/Game1TransferHallService.ts` | (sjekket) |
| Game1RecoveryService | `apps/backend/src/game/Game1RecoveryService.ts` | 327 |
| PostgresWalletAdapter (current main) | `apps/backend/src/adapters/PostgresWalletAdapter.ts` | 1 536 |
| WalletReservationExpiryService | `apps/backend/src/wallet/WalletReservationExpiryService.ts` | (sjekket) |
| SocketRateLimiter | `apps/backend/src/middleware/socketRateLimit.ts` | (sjekket) |
| spill1-patterns (shared) | `packages/shared-types/src/spill1-patterns.ts` | 167 |
| Game1Controller (klient) | `packages/game-client/src/games/game1/Game1Controller.ts` | (sjekket) |

---

## Appendiks B — Sammenligning nåværende main vs hypotetisk-merget BIN-761-764

| Feature | Nåværende main | Etter BIN-761-764 merge |
|---|---|---|
| Wallet REPEATABLE READ-isolasjon | READ COMMITTED + FOR UPDATE | REPEATABLE READ + retry på 40001/40P01 |
| Outbox-pattern for events | Direkte broadcast via RoomState fan-out | `wallet_outbox`-tabell + worker-poll med FOR UPDATE SKIP LOCKED |
| Hash-chain audit | Audit-log uten tamper-detection | SHA-256-chain over wallet_entries med nightly verify |
| Reconciliation | Manuell ops-prosess | Automatisk nightly cron med alarm |
| Outbox-dead-letter handling | N/A | Auto-retry × 5 + dead_letter-status |
| Tamper-detection deteksjons-window | N/A | Innen 24t (nightly cron) |

Conditional pre-pilot: **anbefaler å merge i denne rekkefølgen for minimal risiko**:

1. BIN-762 (REPEATABLE READ) — pure DB-isolasjon-upgrade, lavest risiko.
2. BIN-763 (reconciliation) — additiv (ny cron + ny tabell), ingen eksisterende-flyt-påvirkning.
3. BIN-764 (hash-chain) — additiv (ny hash-kolonne + verifier), ingen eksisterende-flyt-påvirkning. Krever backfill-strategi for legacy-rader.
4. BIN-761 (outbox) — størst integration-flate, krever socket-pusher-wiring i `apps/backend/src/index.ts`. Sist.

---

_Slutt. Estimert lesetid: 30-40 min._
