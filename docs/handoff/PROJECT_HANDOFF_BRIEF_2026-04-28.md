# Spillorama Project Handoff Brief

**Dato:** 2026-04-28
**Status:** Pre-pilot (uker fra første hall)
**Forfatter:** PM-koordinator (AI)
**Til:** Ny prosjektutvikler / tech lead

> Dette er hovedhåndover-dokumentet. Det fanger ALT vi har gjort, ALT som gjenstår, og hvorfor — slik at neste utvikler kan ta over uten å miste konteksten.

---

## 1. Executive Summary (les dette først)

### Hva er Spillorama?
Norsk regulert pengespillplattform (live bingo) for hall-baserte spillere. Bygget for pengespillforskriften. Tre hovedspill (Spill 1-3) + databingo (SpinnGo) + ekstern Candy-integrasjon.

### Hvor er vi?
- **Backend:** ~95% pilot-klar. Casino-grade på money-safety (BIN-761/762/763/764). 80-90% paritet med store iGaming-plattformer.
- **Admin-portal:** ~85% pilot-klar. Cash inn/ut, settlement, hall-admin, agent-creation, ops-console.
- **Game-client (Pixi.js):** ~70% pilot-klar. Spill 1 fungerer, Spill 2/3 delvis.
- **Code-kvalitet:** 4329-linjers BingoEngine.ts er gjeld, men brukes IKKE av prod-flyten (kun ad-hoc). Refactor-foundation lagt (Fase 0+1).

### Hovedrisiko
1. **Module boundaries** — `BingoEngine.ts` + `Game1DrawEngineService.ts` er for store. Reduserer dev-hastighet med 30-50%.
2. **Pilot-blockere lukket** men ikke smoke-testet i prod end-to-end.
3. **Frontend ikke deeply audited** for arkitektur (kun bug-fixes).

### Anbefalt fokus de neste 4 ukene
1. Smoke-test prod ende-til-ende (3-5 dager)
2. Module-catalog-basert bug-fix-bølge (2 uker)
3. Refactor Fase 2-4 (port-rensing + event-log) — ~5 dev-dager
4. Pilot-demo til ansatte
5. Første hall i pilot

---

## 2. Hva vi gjorde 2026-04-27 til 2026-04-28

### Dag 1 (2026-04-27): Pilot-paritet + bug-jakt

**Morgenen — pilot-paritet:**
- PR #660: Demo Hall test-mode bypass (runden ender ikke på pattern)
- PR #661: Pre-flight validation (link + spilleplan) + restart-UI
- PR #662: E2E 4-hall master flow test (24 steg)
- PR #663: E2E admin legacy game-setup full (51 steg)
- PR #664: Admin agent-form + ADMIN all-perms (97 perms)
- PR #665: ADMIN super-user route-access til agent-portal
- PR #666: E2E agent-portal full arbeidsdag (100 tests)
- PR #667-668: Ops Console backend + frontend (`/admin/ops`)
- PR #669: Check for Bingo PAUSE-modal
- PR #670: Physical Cashout 5×5 + Reward All

**Kvelden — bug-rapporter fra Tobias:**
- PR #671: KRITISK isTestHall socket-propagering (Demo Hall pauset på Phase 1)
- PR #672: Blink-fix Obligatorisk spillepause-modal (runde 7 av blink-eliminering)
- PR #673: CSS-only sidebar svart-element-spacing
- PR #674: Forhåndskjøp idempotency-key round-scoped (mellom runder feilet)
- PR #675: AdminOps-wire i index.ts (mistet i #667-merge → "Feil: HTTP 200")
- PR #676: GameManagement dropdown slug/UUID-mismatch
- PR #677: Demo Hall stadig pauser + 4RCQSX room-collision (canonical-aware lookup)
- PR #682: Stale-room cleanup + boot-sweep + admin clear-stuck-room

### Dag 2 (2026-04-28): Code reviews + refactor-foundation

**5 parallelle code reviews (35 P0 dokumentert):**
- PR #678: Agent shift + settlement (8 P0)
- PR #679: Spill 1 engine + payout (6 P0)
- PR #680: Pre-flight + scheduling + rooms (5 P0)
- PR #681: Multi-hall socket lifecycle (8 P0, 6 race-conditions)
- bddc2b36 (direct): Wallet + compliance + audit (8 P0)

**Bølge 1 stop-ship-fixes (6 PR-er):**
- PR #684: Multi-hall scheduled effectiveHallId (4-haller-link)
- PR #685: ComplianceLedger UNIQUE idempotency (§71 dobbel-telling)
- PR #686: Settlement aggregateByShift SUM (truncation)
- PR #687: REST-purchase §23/§66 gate
- PR #688: No-winnings forensic + regression-vakt (ingen bug, regression-test)
- PR #689: Cash-op atomicity (money-safety)

**Casino-grade research (PR #694):**
- 30+ industri-kilder citert
- Sammenligning mot Microgaming, Playtech, Pragmatic, Evolution, Virtue Fusion, GLI-19
- Konklusjon: Spillorama 80-90% på industri-paritet; største gap er module boundaries

**Refactor-foundation:**
- PR #691: Fase 0 — 6 ports + 5 invariant-tester (foundation)
- PR #693: Fase 1 — PayoutService extraction (atomic 4-step API + adapter-bridges)

**Module-catalog (oppstart):**
- PR #696: Del 1 — game/ (25 moduler, 969 linjer) ✅ MERGET
- Del 2 — wallet+agent+admin (kjører) 🟡
- Del 3 — sockets+util+auth+routes (kjører) 🟡

**Diagnostiske + emergency:**
- PR #690: Testbruker prod-diagnose (root-cause-rapport)
- PR #692: KRITISK payout-guard + percent-mode mapper (4 fix-deler)
- PR #695: Multi-winner tie-breaker deterministic ("førstemann får gevinsten")

**Total leveranse 2026-04-28: 36 PR-er merget på main.**

---

## 3. Arkitekturbeslutninger

### Tatt 2026-04-27
- Cash inn/ut ADMIN super-user-tilgang via route-relax (ikke separat side)
- Demo Hall test-mode via DB-flag (`is_test_hall`), ikke env-var
- Pre-flight validation før engine.startGame, ikke i engine selv
- Canonical room-mapping per group-of-halls (`BINGO1-<groupId>`)

### Tatt 2026-04-28
- Refactor: unified pipeline med ports + InMemory-adaptere
- IKKE event-sourcing eller mikroservice-split (overkill per casino-research)
- Append-only event-log via dual-write (Fase 5+) i stedet
- Tie-breaker på `purchase_timestamp ASC, assignmentId ASC` (deterministisk)
- ComplianceLedger UNIQUE idempotency-key på DB-nivå (ikke service-nivå)
- Atomic cash-op via shared-client tx (ikke outbox)

### IKKE besluttet ennå
- GLI-19 RNG-server-isolasjon (post-pilot, EU-ekspansjon)
- Multi-region failover (post-pilot)
- Distributed tracing (Jaeger/OpenTelemetry)

---

## 4. Casino-grade research — hva den fortalte oss

Full rapport: `docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md` (847 linjer).

### Spillorama matcher 80-90% industri-paritet
- ✅ Hash-chain audit (BIN-764) — bedre enn de fleste
- ✅ Outbox-pattern (BIN-761) — sjelden i lisensierte plattformer
- ✅ Nightly reconciliation (BIN-763)
- ✅ REPEATABLE READ + retry (BIN-762)
- ✅ Pessimistic-locking
- ✅ Idempotency-keys gjennomgående
- ✅ Append-only audit på 4 nivåer
- ✅ Wallet-split deposit/winnings
- ✅ Replay-API per gameId
- ✅ §71 multi-hall-binding korrekt
- ✅ Fail-closed compliance

### Største gap (i prioritert rekkefølge)
1. **Module boundaries** (4329 LOC BingoEngine) — refactor in progress
2. **RNG-isolasjon** (post-pilot, EU)
3. **Multi-region failover** (post-pilot)
4. **Distributed tracing** (post-pilot)

### Pilot-blockere fra researchen
- ✅ PR-T1 tie-breaker (merget #695)
- ⏸ PR-A1 atomic outer-tx (droppet — module-catalog #696 viste at det ikke er pilot-blokker; Game1DrawEngineService er allerede atomisk)

---

## 5. Refactor-roadmap

### Fase 0 — Ports + Invariants ✅ MERGET (#691)
- 6 ports: Wallet, Compliance, Audit, Hall, Clock, IdempotencyKey
- 5 InMemory-implementasjoner
- 18 invariant-tester (fast-check property-based)

### Fase 1 — PayoutService ✅ MERGET (#693)
- Atomic 4-step API (wallet credit → compliance → house-retained → audit)
- Adapter-bridges til legacy infrastruktur
- 14 unit-tester
- **0 av 12 kallsteder migrert in-place** — for risikofylt, gjøres i Fase 2-4

### Fase 2 — DrawingService (planlagt, 1-2 dager)
- Extract draw-logikk fra BingoEngine til egen service
- Tester: invariant "drawn ≤ maxDraws"

### Fase 3 — PatternEvalService (planlagt, 1-2 dager)
- Extract auto-claim-on-draw + recursive phase progression
- Tester: 5/5 phase progression, multi-winner

### Fase 4 — GameOrchestrator (planlagt, 1 dag)
- Wires alle services sammen
- Slett `Game1DrawEngineService` (samme orchestrator brukes for scheduled + ad-hoc)
- Tester: scheduled vs ad-hoc gir samme resultat

### Fase 5 — Event-stream-konsolidering (post-pilot, 3-5 dager)
- Konsolider 4 eksisterende append-only-strømmer til én `app_game_events`-tabell
- Dual-write først (uten å bryte eksisterende)
- Senere: les fra event-log i stedet for tabeller

### Fase 6 — Game1StateMachine extract (post-pilot, 2-4 dager)
- Eksplisitt FSM for Spill 1-runde-lifecycle
- Erstatter spredt `game.status`-mutation

**Total estimat:** 8-15 dev-dager for full unified-pipeline.

---

## 6. Module-catalog (les disse for bug-testing)

### Del 1 (✅ MERGET #696)
- `docs/architecture/MODULE_CATALOG_GAME_2026-04-28.md` (969 linjer, 25 moduler)

### Del 2 (🟡 kjører)
- Wallet + agent + admin

### Del 3 (🟡 kjører)
- Sockets + util + auth + services + ports + jobs + routes

### Top 5 moduler å forstå først (Spill 1 pilot-flyt)
1. `Game1ScheduleTickService` — hvordan spill spawnes
2. `Game1HallReadyService` — multi-hall ready-state
3. `Game1MasterControlService` — master starter spillet
4. `Game1DrawEngineService` — drawNext + payout (PROD-flyten, ikke BingoEngine)
5. `Game1PayoutService` + `BingoEnginePatternEval` — utbetalinger

### Viktig avklaring
**`BingoEngine.ts` er IKKE prod-flyten for Spill 1.** Det er ad-hoc-engine for tester + Spill 2/3. Spill 1 scheduled-games bruker `Game1DrawEngineService` som ALLEREDE er atomisk via `runInTransaction`.

---

## 7. Code review findings (35 P0)

5 parallelle code-review-rapporter dokumenterte 35 P0-funn. Status:

### Lukket i Bølge 1 (6 PR-er)
- ✅ #684 Multi-hall scheduled effectiveHallId (Review #4 P0-2)
- ✅ #685 ComplianceLedger UNIQUE (Review #2 P0-6 + #5 P0-3)
- ✅ #686 Settlement aggregate SUM (Review #1 P0-2)
- ✅ #687 REST-purchase compliance gate (Review #5 P0-1)
- ✅ #689 Cash-op atomicity (Review #1 P0-1)
- ✅ #695 Multi-winner tie-breaker (Casino-research)

### Gjenstående P0 (29 stk) — backlog

**Review #1 Agent shift + settlement (3 P0 igjen):**
- P0-3 UniqueIdService.ts:342 expiry-check mangler ved mustGetActive
- P0-4 MachineBreakdownTypes.ts: bilag-validator DoS-vektor (10MB JSONB)
- P0-5 AgentShiftService.ts:204 unreconciled balance-guard (allerede merget #689 — dobbeltsjekk)
- P0-6 AgentOpenDayService.ts:91 alreadyOpened truncation (samme som #686-pattern, applies også her)
- P0-7 AgentSettlementService.ts (6 sub-mangler i settlement breakdown)
- P0-8 AgentTransactionService.ts (relaterte mangler)

**Review #2 Spill 1 engine + payout (5 P0 igjen):**
- P0-1 BingoEngineMiniGames.ts:153,326 hardkoder gameType: "DATABINGO" (bør være MAIN_GAME)
- P0-2 BingoEngine.ts:1436 payoutPhaseWinner per-step try/catch mangler (downgraded — Game1DrawEngineService er prod, allerede atomisk)
- P0-3 BingoEnginePatternEval.ts:520 auto-pause socket-event mangler i ad-hoc engine
- P0-4 Game1DrawEngineDailyJackpot.ts:154 jackpot-debit ikke atomisk (pragmatisk pilot-akseptert)
- P0-5 Game1TransferHallService UX (downgrade til P1)

**Review #3 Pre-flight + scheduling + rooms (5 P0 igjen):**
- P0-1 adminGame1Master.ts:280 Game1Master-path mangler pre-flight-validation
- P0-2 adminRooms.ts:189 TOCTOU mellom validate() og engine.startGame
- P0-3 ScheduleService.ts:307 ingen 100% sum-validering på rowPrizesByColor
- P0-4 HallGroupService.ts:637 isReferenced bruker LIKE substring (false-positives)
- P0-5 ScheduleService.ts:252 sub-game tids-overlap-validering mangler

**Review #4 Multi-hall socket (7 P0 igjen):**
- P0-1 BingoEngine.ts:754 createRoom silent fallback til random-kode
- ✅ P0-2 multi-hall effectiveHallId (merget #684)
- P0-3 chatEvents.ts:86 cross-hall chat blokkert i shared rooms
- P0-4 adminHallEvents.ts:220 HALL_OPERATOR mangler hallId-scope
- P0-5 hall_groups multi-membership tillatt (DB-constraint mangler)
- P0-6 + P0-7 + P0-8 (race-conditions R3, R4, R6)

**Review #5 Wallet + compliance + audit (4 P0 igjen):**
- ✅ P0-1 REST-purchase gate (merget #687)
- P0-2 ComplianceManager mutate-before-persist (4 metoder)
- ✅ P0-3 ComplianceLedger UNIQUE (merget #685)
- P0-4 Soft-fail compliance-write uten retry-job

### Anbefalt rekkefølge for backlog

**Bølge 2 (3-5 dev-dager):**
1. ScheduleService.ts:307 (sum-validering)
2. ScheduleService.ts:252 (overlap-validering)
3. adminRooms.ts:189 (TOCTOU advisory-lock)
4. HallGroupService.ts:637 (LIKE → JSONB @>)
5. UniqueIdService.ts:342 (expiry-check)

**Bølge 3 (5-7 dev-dager):**
6. ComplianceManager 4 mutate-before-persist
7. BingoEngineMiniGames gameType DATABINGO → MAIN_GAME
8. AgentSettlementService 6 sub-mangler
9. AgentTransactionService P0-8

**Bølge 4 (3-5 dev-dager):**
10. Multi-hall race-conditions R3/R4/R6
11. Compliance-write outbox-retry
12. createRoom silent fallback fjernes

---

## 8. Andre områder for deep-dive review (anbefales)

### 1. Frontend (admin-web + game-client) ⚠️ HØY PRIORITET
**Vi har gjort 30+ frontend-fixes men aldri en arkitektur-review.** Anbefalt:
- Audit av komponent-tree (sidebar, layout, modal-pattern)
- State-management (lokal state vs global)
- API-error-handling consistency
- i18n-coverage (mange hardkodede strings funnet)
- Accessibility (WCAG 2.1 AA — kun delvis dekket)
- Performance (4-haller dashboard, ops-console live-updates)

**Estimat:** 2-3 dev-dager review + 5-10 dager fix-bølge.

### 2. Database / Migrations strategi ⚠️ HØY PRIORITET
**91 DB-tabeller, ~120 migrations.** Aldri formelt audit.
- Index-coverage på hot queries
- Orphan-tabeller (legacy fra tidlig utvikling)
- Foreign-key-konsistens
- Backup + rollback-strategi
- Connection-pool-tuning (Render-instance starter cold)

**Estimat:** 1-2 dev-dager audit.

### 3. Deployment / Observability ⚠️ MIDDELS
- Render auto-deploy fra main fungerer, men ingen blue-green
- Ingen distributed tracing (kun logger)
- Alerts-kanal — hvor ender de? (Render dashboard alone)
- Metrics: response-time p50/p95/p99 ikke synlig
- Health check er for grunt (sjekker kun DB-up)

**Estimat:** 3-5 dev-dager (OpenTelemetry + Grafana/Datadog).

### 4. Security audit ⚠️ HØY PRIORITET (regulatorisk)
- Ingen formell pen-test ennå
- Auth-token-rotering (hvor ofte?)
- RBAC-edge-cases (97 permissions — er noen overlappende?)
- SQL-injection-risiko (vi bruker parametrized queries, men noe raw query?)
- XSS i admin-portal (textContent vs innerHTML — sjekk consistency)
- Secrets management (Render env-vars OK, men logging?)
- CSRF-tokens på sensitive endpoints
- Rate-limiting per endpoint (kun socket-events har rate-limiter)

**Estimat:** 3-5 dev-dager.

### 5. Testing strategi ⚠️ MIDDELS
- 76+ test-filer i backend, men coverage-tall ukjent
- E2E-tester finnes (#662, #663, #666) men dekker ikke alt
- Visuell-regression (Playwright) — kun for Pixi.js-game-client
- Ingen load-testing (4-hall scaling untested)
- Ingen chaos-engineering (random crash-test)

**Estimat:** 2-3 dev-dager planlegging + ~10 dager implementasjon.

### 6. Game-client (Pixi.js) ⚠️ HØY PRIORITET
**Ikke deeply audited.** Spill 1 fungerer men:
- Pixi-rendering pattern — composite-restart-issues (vi har hatt 7 blink-runder!)
- WebGL-context-loss-handling
- Memory-leaks (long-running sessions)
- Spill 2/3 ufullstendig
- Mobile-respons OK?

**Estimat:** 2-3 dev-dager review.

### 7. Mobile / Native apps ⚠️ POST-PILOT
- iOS/Android/Windows er placeholder-prosjekter
- Strategi: native vs PWA? (Norwegian regulatorisk-krav?)

### 8. Candy-integrasjon ⚠️ MIDDELS
- Iframe + wallet-bridge fungerer
- Men vi eier ikke Candy-koden — failure-modes?
- Wallet-reconciliation mellom Spillorama og Candy?

**Estimat:** 1-2 dev-dager review.

### 9. Cache-strategi (Redis) ⚠️ LAV
- Room-state i Redis — TTL-strategi?
- Sessions i Redis — invalidation pattern?
- Cache-stampede-protection?

**Estimat:** 1 dev-dag review.

### 10. Compliance-readiness ⚠️ HØY PRIORITET
- Lotteritilsynet-audit kan komme uvarslet
- Audit-trail komplett? (vi har hash-chain, men er det tilgjengelig?)
- §11 distribusjon-rapport automatisk?
- Rapporter-template for myndighetene?

**Estimat:** 3-5 dev-dager.

---

## 9. Pilot-readiness status

### Klar ✅
- Multi-hall flyter (4-haller-link)
- Wallet-laget (casino-grade)
- Compliance §23/§66/§71
- Pre-flight validation
- Demo Hall test-mode
- Settlement (1:1 wireframe)
- Cash inn/ut + agent-portal
- Ops Console for ADMIN
- ADMIN all-perms (97)
- Bug-fixes for kritiske symptomer

### Ikke klar 🟡
- Smoke-test ende-til-ende i prod (anbefalt FØR ansatt-demo)
- Module-catalog del 2+3 (kjører nå)
- Bug-fix Bølge 2 (29 P0 igjen i backlog)
- Frontend arkitektur-audit
- Performance / load-testing

### Vil ikke være klar pre-pilot (post-pilot OK) 🔴
- GLI-19 RNG-isolasjon (EU-ekspansjon)
- Multi-region failover
- Event-sourcing
- Distributed tracing

---

## 10. Onboarding-sekvens for ny utvikler

### Dag 1: Forstå plattformen (4-6 timer)
1. Les `CLAUDE.md` (project root) — full kontekst
2. Les `docs/architecture/ARKITEKTUR.md` — system-tegninger
3. Les `docs/architecture/SPILLKATALOG.md` — game-katalog
4. Les `docs/architecture/UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md`
5. Les `docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md`

### Dag 2: Forstå koden (4-6 timer)
1. Les `docs/architecture/MODULE_CATALOG_GAME_2026-04-28.md` — top 5 moduler
2. Naviger live: `apps/backend/src/game/Game1DrawEngineService.ts`
3. Følg en runde: `Game1ScheduleTickService → drawNext → evaluatePhase → payoutPhase`
4. Forstå wallet-flyten: `WalletService → PostgresWalletAdapter → outbox`
5. Les 5 code-review-rapporter for kjente issues

### Dag 3: Sett opp lokalt (3-4 timer)
1. `docker-compose up -d` (Postgres 16 + Redis 7)
2. `npm install`
3. `npm --prefix apps/backend run migrate`
4. `npm run dev` (backend port 4000)
5. `npm run dev:admin` (admin-web port 5173)
6. `npm run dev:games` (game-client port 5174)
7. Bruk test-bruker (se tidligere session-logs)

### Dag 4: Første bidrag (4-6 timer)
1. Plukk fra Bølge 2-backlog (P0-funn)
2. Lag branch `fix/<beskrivelse>`
3. Skriv test FØRST
4. Implementer fix
5. Push branch — PM oppretter PR

### Uke 2: Kjøre Bølge 2-fixes
- 5 P0-fix-er per uke som mål
- Følg PM-sentralisert git-flyt: agenter pusher branches, PM merger

---

## 11. Kritiske filer å kjenne

### Backend kjerne
- `apps/backend/src/index.ts` — hoved-bootstrap (Express + Socket.IO)
- `apps/backend/src/game/Game1DrawEngineService.ts` — Spill 1 prod-flyt
- `apps/backend/src/game/BingoEngine.ts` — ad-hoc engine (test-only nå)
- `apps/backend/src/wallet/WalletService.ts` — money-safety
- `apps/backend/src/compliance/ComplianceManager.ts` — §-enforcement
- `apps/backend/src/services/PayoutService.ts` — ny refactor (Fase 1)

### Backend infrastruktur
- `apps/backend/src/sockets/gameEvents/roomEvents.ts` — Socket.IO room
- `apps/backend/src/util/canonicalRoomCode.ts` — single-room-per-link
- `apps/backend/src/middleware/SocketRateLimiter.ts` — rate-limiting
- `apps/backend/migrations/` — DB schema (~120 filer)

### Admin-web
- `apps/admin-web/src/main.ts` — entry + route-guard
- `apps/admin-web/src/shell/sidebarSpec.ts` — venstre meny
- `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts` — agent-dashboard
- `apps/admin-web/src/pages/admin-ops/AdminOpsConsolePage.ts` — ops-dashboard

### Test-infrastruktur
- `apps/backend/src/__tests__/e2e_*.test.ts` — E2E-tester (#662, #663, #666)
- `apps/backend/src/__tests__/invariants/` — property-based invariant-tester (Fase 0)

### Konfig
- `CLAUDE.md` — project context
- `render.yaml` — deploy
- `docker-compose.yml` — local infra
- `apps/backend/.env.example` — env-var-template

---

## 12. Operasjonell runbook

### Deploy
- Push til `main` → Render auto-deployer (~5-10 min)
- Render dashboard: https://dashboard.render.com/
- Migration kjøres ved boot (build-step)
- Health-check: `https://spillorama-system.onrender.com/health`

### Logs
- Render dashboard har live-logs
- Ingen aggregator (Datadog/CloudWatch) ennå

### Rollback
- Render dashboard → "redeploy previous"
- Migrations: forward-only (BIN-661) — ingen down-migration. Manuelt SQL hvis nødvendig.

### Incident-response
1. Sjekk `/health` — er backend oppe?
2. Sjekk `/admin/ops` — er det aktive rom som henger?
3. Sjekk Render-dashbord for deploy-status
4. Hvis stuck-rom: bruk admin clear-stuck-room-endpoint
5. Hvis broken-state etter deploy: rollback via Render

### Vanlige feil
- **HTTP 502/503:** Render kald boot, vent 30-60s
- **HTTP 200 men HTML:** endpoint mangler, sjekk wire-up i index.ts (lære fra #675)
- **"Player allerede i rom":** stale state, kjør clear-stuck-room
- **No-winnings:** sjekk GameManagement config_json mode (skal være "fixed")

---

## 13. Åpne spørsmål til forretning / Tobias

### Regulatorisk
1. GLI-19-sertifisering — når trenger vi det? (kun ved EU-ekspansjon?)
2. Lotteritilsynet-audit-readiness — hva forventes formelt?
3. § 11-distribusjon-rapport — hvordan skal den genereres + distribueres?

### Pilot
4. Hvilke 4 haller skal være første pilot?
5. Hvordan onboarder vi de 4 first-pilot-bingovertene?
6. Hva er rollback-plan hvis pilot går galt? (Tilbake til legacy-system?)

### Forretning
7. Hva med Norsk Tipping/Rikstoto — manuell eller API-integrasjon?
8. Customer support-flyt — hvor logges incidents?
9. Marketing/launch-strategi for full produksjon

### Tekniske beslutninger
10. Mobile-strategi: native eller PWA?
11. Skal vi GLI-19-sertifisere RNG-server FØR EU-ekspansjon?
12. Skal Spill 5 (game5/spillorama/SpinnGo) være pilot-ready? (Ikke prioritert per nå)

---

## 14. Glossary

| Term | Definisjon |
|---|---|
| **Hall** | Fysisk bingolokasjon med agenter |
| **Hall Group** | Gruppe av haller som spiller sammen ("link") |
| **Master Hall** | Hovedhall i en gruppe — eier draw-engine |
| **Agent / Bingovert** | Operativ ansatt i hallen |
| **Spill 1** | "Hovedspill 1" / "Papir Bingo" / "game1" / slug=`bingo` |
| **Spill 2** | "Rocket" / "game2" / slug=`rocket` |
| **Spill 3** | "Monsterbingo" / "game3" / slug=`monsterbingo` |
| **SpinnGo / Spill 4** | Databingo / "game5" / slug=`spillorama` |
| **Candy** | Ekstern iframe-spill (tredjeparts) |
| **Demo Hall** | Test-hall med `is_test_hall=true` (runde fortsetter til 75 baller) |
| **Canonical room** | Deterministisk rom-kode per link (`BINGO1-<groupId>`) |
| **§23** | Pengespillforskriften: 1-års self-exclusion |
| **§66** | Mandatory pause etter 60 min spilling |
| **§71** | Multi-hall §-rapportering (actor_hall_id-binding) |
| **§11** | Distribusjon til organisasjoner (15% main, 30% databingo) |
| **K1-fix** | "Kritisk 1"-fixes fra master plan (alle merget) |
| **Bølge** | Fix-bølge / refactor-bølge |
| **PR-A1, PR-T1** | Fra casino-research: atomic outer-tx + tie-breaker |
| **Fase 0-6** | Refactor-faser (ports → orchestrator → events → FSM) |
| **Outbox** | BIN-761 — pattern for distributed transactions |
| **Hash-chain** | BIN-764 — tamper-evident audit-log |

---

## 15. Avsluttende observasjoner

### Det som fungerte
1. **Parallel-agent-orkestrering** — 36 PR-er på 24 timer er kun mulig fordi vi kjørte 5+ agenter samtidig
2. **Code review FØR fix** — fanger strukturelle issues, ikke bare symptomer
3. **PM-sentralisert git-flyt** — agentene pusher, PM merger med discipline
4. **Property-based invariants** — fanger regressioner som unit-tester ikke fanger

### Det som ikke fungerte
1. **Whack-a-mole** — vi fikset symptomer i stedet for root causes (frem til Tobias presset på refactor)
2. **Parallel-agent worktree-konflikter** — flere agenter i samme tre brukte git-reset destruktivt på andres arbeid
3. **Code reviews kunne overdrive** — research viste at vi var bedre stilt enn reviewene antydet
4. **Module-catalog stallet på første forsøk** — for stort scope, måtte splittes i 3

### Anbefaling til neste utvikler
- **Les module-catalogen først, kode etter.**
- **Stol på casino-research-konklusjonen** — vi er solide, fokus på inkrementelle forbedringer.
- **Ikke gjør whack-a-mole** — hvis bug krever 3+ filer endret, refactor først.
- **Skriv test FØRST** for hver fix — invariants > unit-tester.
- **Bruk PM-sentralisert merge** — ikke push direkte til main alene.

---

## 16. Kontakter + ressurser

- **Repo:** https://github.com/tobias363/Spillorama-system
- **Render:** https://dashboard.render.com/
- **Prod-URL:** https://spillorama-system.onrender.com/
- **Linear:** https://linear.app/bingosystem/
- **Memory dir:** `~/.claude/projects/-Users-tobiashaugen-Projects-Spillorama-system/memory/`

### Viktige docs som er allerede skrevet
- `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`
- `docs/architecture/UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md`
- `docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md`
- `docs/architecture/MODULE_CATALOG_GAME_2026-04-28.md`
- `docs/architecture/LEGACY_PARITY_AUDIT_FIELD_LEVEL_2026-04-27.md`
- `docs/architecture/WIREFRAME_CATALOG.md`
- `docs/architecture/SPILLKATALOG.md`
- `docs/architecture/ARKITEKTUR.md`
- `CLAUDE.md` (project root)
- 5 code-review-rapporter i `docs/engineering/CODE_REVIEW_*_2026-04-27.md`

---

## Lykke til. Du er ikke alene — alt vi gjorde er dokumentert. Stol på koden, men verifiser via tester.

🤖 Skrevet 2026-04-28 av PM-koordinator. Denne briefen erstatter alle tidligere "next-step"-dokumenter.
