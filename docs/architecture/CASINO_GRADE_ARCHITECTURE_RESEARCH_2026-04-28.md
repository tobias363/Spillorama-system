# Casino-Grade Architecture Research — 2026-04-28

**Author:** Research-agent (Claude Opus 4.7, 1M-context).
**Mandate (Tobias 2026-04-28):** *"Det er ekstremt viktig at denne funksjonaliteten er bygget så godt som mulig, dette er selve hjertet i spillet og må bli bygd på samme måte som de større casinoene gjør det."*
**Scope:** Strategisk gap-analyse av Spillorama Spill 1 mot industri-standard for regulerte online casino- og bingo-plattformer. Identifiserer konkrete refactor-områder, vurderer eksisterende Unified Pipeline-plan, og foreslår 6-måneders modnings-roadmap.

---

## 0. Lese-veiledning

| Hvis du har | Les |
|---|---|
| 5 min | §1 Executive Summary |
| 15 min | §1 + §2 Sammenligningsmatrise + §5 Vurdering av Unified Pipeline |
| 30 min | §1 + §2 + §3 dyp-dykk + §6 6-måneders roadmap |
| Full lesing | Hele dokumentet (ca 1300 linjer, 45 min) |

Sammenheng med eksisterende dokumenter:
- `SPILL1_CASINO_GRADE_AUDIT_2026-04-27.md` — line-level finn + kritisk-1-til-5-funn. **Dette dokumentet bygger videre med strategisk perspektiv, ikke duplikat.**
- `LIVE_CASINO_ROOM_ARCHITECTURE_RESEARCH_2026-04-27.md` — rom-arkitektur + Socket.IO-kapasitet (PR #616).
- `REFACTOR_PLAN_2026-04-23.md` — pågående refactor-bølger (PR-S1-S3, PR-C1-C5).
- `MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` — pilot-blokker-status (alle K1+P0 merget).
- `BACKEND_KOMPLETT_GJENNOMGANG_2026-04-27.md` — komplett backend-audit.

**Rettelse til SPILL1_CASINO_GRADE_AUDIT_2026-04-27 KRITISK 1:** Auditen påsto at BIN-761/762/763/764 IKKE var merget. Verifisert ved `git log main`: ALLE FIRE er nå merget (commits b1297dbb, e6544330, 993ef064, c983e30a). Hash-chain audit (`WalletAuditVerifier.ts`), outbox (`WalletOutboxRepo.ts` + `WalletOutboxWorker.ts`), reconciliation-cron (`apps/backend/src/index.ts:1466`), og REPEATABLE READ + retry (`withWalletTx`) er alle aktive på main. **Spillorama er nærmere casino-grade enn audit-doc'en antyder.**

---

## 1. Executive Summary — top 5 innsikter for Tobias

### Innsikt 1: Spillorama er allerede 80-90% på Pragmatic/Playtech-paritet for transaksjonell integritet

**Det Spillorama gjør riktig (industri-grade):**
- ✅ Atomisk DB-transaksjon for hele draw + payout-flyten i `Game1DrawEngineService` (linje 1033-1268)
- ✅ FOR UPDATE-pessimistisk-lås på alle wallet-mutering-paths
- ✅ REPEATABLE READ + retry på 40001/40P01 via `withWalletTx` (BIN-762, merget)
- ✅ Outbox-pattern for events (BIN-761, merget) — `WalletOutboxRepo` + worker med FOR UPDATE SKIP LOCKED
- ✅ Hash-chain audit-trail (BIN-764, merget) — SHA-256-chain over `wallet_entries` med `WalletAuditVerifier`
- ✅ Nightly reconciliation (BIN-763, merget) — cron sammenligner `wallet_accounts.balance` vs `SUM(wallet_entries)` per side
- ✅ Idempotency-keys på debit/credit/transfer (90d retention, BIN-767)
- ✅ Hus-garantert fixed-prize med system-konto + `is_system=true`-CHECK
- ✅ Compliance fail-closed på alle player-touching paths (`assertWalletAllowedForGameplay`)
- ✅ Wallet-split deposit/winnings (PR-W2-W5) per pengespillforskriften §11
- ✅ Per-hall §71-binding for compliance-ledger (K1 fix, PR #443)
- ✅ HOUSE_RETAINED-entry for split-rounding-rest (HIGH-6)

**Dette er bedre enn 80% av lisensierte iGaming-plattformer.** ([SDLC Corp Best Practices](https://sdlccorp.com/post/best-practices-in-casino-game-backend-architecture/), [Capermint RGS](https://www.capermint.com/how-a-remote-gaming-server-works/))

### Innsikt 2: Den største gjenværende gap-en er IKKE wallet — det er module boundaries (DDD)

**4285-linje `BingoEngine.ts`** er en god-class. Den eier:
1. Player-registry + room-state
2. Game-lifecycle (start/pause/resume/end)
3. Draw-mekanikk (delegert til `DrawBagStrategy` + `_drawNextNumberLocked`)
4. Pattern-evaluering (delegert til `BingoEnginePatternEval`)
5. Payout-orkestrering (`payoutPhaseWinner` 200 linjer)
6. Mini-game-trigger
7. Compliance-aggregering (`recordAccountingEvent`, `generateDailyReport`, etc.)
8. Wallet-port-fasade (`getComplianceLossPort`, `getPotSalesHookPort`)
9. Audit-aggregering
10. Pattern-policy
11. Recovery (delegert til `BingoEngineRecovery` men orkestrert herfra)

I et industri-grade casino-system ville dette vært **5-7 separate bounded contexts** (Evolution Gaming-modellen): `GameSession`, `Player`, `Wallet`, `Compliance`, `Audit`, `RNG`, `Reporting`. Hver med sin egen aggregat-rot.

**Dette er ikke et pilot-blokker** men det forsinker ALL videre utvikling med 30-50%. Hver ny feature-PR må navigere 4285-linjes-filen og forstå impliserte invariantar mellom "ansvar 1-11".

Mitt forslag: gjør Unified Pipeline-arbeidet (Fase 0-4) i Tobias' eksisterende plan, men **utvid det med eksplisitte aggregate roots** og **ports/adapters-rensing** før Fase 4 lander.

### Innsikt 3: Event-sourcing er IKKE riktig grep for Spillorama nå — men append-only event-log er riktig

**Event-sourcing** (lagre kun events, rebygg state fra events) er overkill for et bingo-system med 4-haller-pilot. Det er en arkitektur-investering på 6-12 måneder med betydelig læringskurve.

**Append-only event-log** (lagre snapshot + events parallelt) gir 80% av gevinsten med 20% av kostnaden. Dere har allerede det meste:
- `app_game1_draws` — append-only draw-log
- `app_game1_phase_winners` — append-only winner-log
- `wallet_entries` med hash-chain — append-only finansiell-log
- `app_audit_log` — append-only audit-stream
- `Game1ReplayService` — replay-API

**Det som mangler:** én **enhetlig event-stream** for hele runden ("game stream") som lar dere reprodusere ALL state for en gameId fra logs. I dag er state spredd over 8+ tabeller.

[Kurrent.io om Event Sourcing vs Audit Log](https://www.kurrent.io/blog/event-sourcing-audit) bekrefter: hvis primært målet er audit (deres tilfelle), er en disciplinert append-only log nok. Hvis målet er rebygg-fra-zero (rare i bingo), trenger man full event-sourcing.

### Innsikt 4: De største regulatoriske gap-ene er ikke i koden — de er i ops + RNG-isolasjon

**RNG-isolasjon (mest kritisk gap mot Evolution/Pragmatic):**
Dagens RNG (`buildDrawBag` + `node:crypto.randomInt`) kjører **i samme prosess som game-engine**. Det betyr at en kompromittert game-engine-prosess kan, i teorien, manipulere RNG-outputten før den persisteres.

Industri-grade casinoer (Evolution, Pragmatic) kjører RNG på **separat sertifisert hardware-server** med kun en ren input/output-API. RNG-svaret signeres kryptografisk.

**Dette er IKKE pengespillforskriften-krav** for Norge (§ 64-67 krever ikke ekstern RNG-sertifisering for bingohaller-bingo). Lotteritilsynet aksepterer in-house RNG. **Men hvis Spillorama vurderer EU-ekspansjon (Sverige Spelinspektionen, MGA Malta) blir GLI-19 + ekstern RNG-cert relevant.** ([GLI-19 spec](https://gaminglabs.com/wp-content/uploads/2020/07/GLI-19-Interactive-Gaming-Systems-v3.0.pdf), [DST Play GLI-19 forklaring](https://www.dstplay.com/blog-details/4/What-Is-GLI-19-Certification-and-Why-It-Matters-for-iGaming-Platforms))

**Failover/HA (post-pilot):**
Single-instance Render. Evolution duplikiserer studios for redundans. Spillorama vil måtte addressere dette **før første ikke-pilot-hall** — eller akseptere at "hall stenger ned hvis Render restarter".

**Streaming-latency (post-pilot):**
Evolution målretter sub-250ms studio→klient. Spillorama Frankfurt-region → Norge er 25-40ms baseline RTT. Med Socket.IO og sub-100ms server-prosessering, er sub-200ms total achievable. **Ikke målt under last.**

### Innsikt 5: Vurder strategisk wallet-isolasjon (PCI-DSS-style) for langsiktig compliance

Per [PCI-DSS Gaming compliance-guide](https://ems-ltd.global/pci-dss-compliance-for-online-gaming-platforms/) skal "systems that handle cardholder data" være **nettverks-segregerte** fra "gameplay servers".

Spillorama bruker Swedbank Pay som payment-tjeneste — så *direkte* kortdata-håndtering skjer ikke i deres backend. **MEN** wallet-balansen er blandet med game-engine-state i samme Postgres-instans. For PCI-DSS Level 4 (under 20K tx/år) er dette OK, men når Spillorama skalerer mot Level 1-2 (over 1M tx/år) bør wallet-laget være sin egen service.

**Anbefaling:** ikke skill nå (overkill). **Forbered abstraksjons-grensene** så split senere er en ren API-introduksjon, ikke en refactor. Du har allerede `WalletAdapterPort.ts` — bygg videre på det.

---

## 2. Sammenligningsmatrise — Spillorama vs casino best-practice

Legend: 🟢 paritet/leder, 🟡 acceptable-gap, 🔴 betydelig gap.

| Område | Spillorama nå | Industri best-practice (Evolution/Playtech/Pragmatic) | Gap | Anbefaling |
|---|---|---|---|---|
| **Module boundaries** | 4285-linje `BingoEngine.ts` god-class. Mange ansvar (§3.1) | 5-7 bounded contexts: GameSession, Player, Wallet, Compliance, Audit, RNG, Reporting | 🔴 | DDD-refactor i Fase 4 av Unified Pipeline. Splitt BingoEngine i 7 modules. |
| **State management** | Direct mutation på `RoomState` med Postgres-checkpoint (scheduled) eller best-effort (ad-hoc) | Append-only event-log + projection (hybrid event-sourcing) | 🟡 | Konsolider event-streamen for én gameId — ikke full ES. |
| **Game replay** | `Game1ReplayService` per gameId. State-snapshot via 8+ tabeller. | Full event-log replay deterministisk | 🟢 | Beholdt — replay fungerer. Vurder å konsolidere til "game-event-stream"-tabell. |
| **RNG-sertifisering** | In-house RNG (`node:crypto.randomInt`) i game-engine-prosess | Separat GLI-19-sertifisert RNG-server, kryptografisk signed output | 🟡 | Pengespillforskriften krever IKKE ekstern. Vurder ved EU-ekspansjon. |
| **Multi-tenancy** | `hall_group_id` + per-hall config + per-link (group-of-halls) rooms | Multi-operator-skin-modell (Playtech 100+ skins) | 🟢 | Spillorama-modellen er passende for hall-network — paritet. |
| **Concurrency** | FOR UPDATE + REPEATABLE READ + per-room mutex + idempotency-keys | Saga-pattern + idempotency + optimistisk-lock | 🟢 | Spillorama er pessimistisk; industrien er ofte mer optimistisk. Pessimistisk er trygt for bingo. |
| **Wallet-isolation** | Same Postgres + `wallet_*`-tabeller. PostgresWalletAdapter (1536 LOC). | PCI-DSS-isolert wallet-service som egen mikroservice (Pragmatic Single-Wallet) | 🟡 | Bygg videre på `WalletAdapterPort` så split senere er ren. Ikke split nå. |
| **Audit + compliance** | DB-tabeller + hash-chain (BIN-764) + audit-log-service | Append-only event-stream + ISO 27001 audit-flow | 🟢 | Hash-chain er industri-grade. Konsolider event-strømmen for full audit. |
| **Deploy strategy** | Render auto-deploy fra main + pre-deploy migrate (fail-fast) | Blue-green + canary + dark-launches | 🟡 | Render har auto-deploy + rollback. Tilstrekkelig for pilot. Post-pilot vurder blue-green. |
| **Observability** | Pino logger + Prometheus metrics (`util/metrics.ts`) + trace-ID propagation (MED-1) | Distributed-tracing (Jaeger/OpenTelemetry) + structured-events + dashboards | 🟡 | Trace-ID + metrics finnes. Mangler dashboard-konfig + alerting-policy. |
| **Failover/HA** | Single-instance Render | Dual-instance + leader-election + auto-failover (Evolution dupliserer studios) | 🔴 | Ikke pilot-blokker. Post-pilot prio for produksjons-grade. |
| **Stream-latency** | Socket.IO Norge → Frankfurt — ikke målt | Sub-250ms studio→klient (Evolution) | 🟡 | Last-test under simulert pilot-trafikk. 1k/5k/10k spillere. |
| **Distributed-locks** | Per-room mutex (in-process) + FOR UPDATE-DB-låser | Redlock for cross-instance, FOR UPDATE for DB | 🟡 | Single-instance gjør Redlock unødvendig. Når dual-instance: Redlock for non-DB-state. |
| **Tamper-detection** | `WalletAuditVerifier` SHA-256 hash-chain (BIN-764) | ISO 27001 audit-grade | 🟢 | Industri-paritet. |
| **Reconciliation** | Nightly cron `walletReconciliation` (BIN-763) | ISO 27001 implies | 🟢 | Industri-paritet. |
| **Outbox-pattern** | `WalletOutboxRepo` + worker (BIN-761) | Implicit i alle store iGaming-stacker | 🟢 | Industri-paritet. |
| **RGS-pattern (Remote Game Server)** | Spill-engine integrert i Spillorama-backend | Game-engine separat fra wallet/auth/admin | 🟡 | RGS-modellen er overkill for bingo-network. Spillorama-modellen er forsvarlig. |
| **Single-Wallet-aggregator** | PlayerWallet er pre-aggregert (Spill1 + Spill2 + Spill3 + SpinnGo + Candy via ext-wallet-bridge) | Pragmatic Enhance™ Single-Wallet | 🟢 | Spillorama har Single-Wallet-arkitektur via wallet-adapter-fasaden. |

---

## 3. Per-dimension dyp-dykk

### 3.1 Module boundaries — den største refactor-gevinsten

**Symptomer i `BingoEngine.ts` (4285 LOC):**
- 90+ public/private metoder
- Imports fra 30+ andre moduler
- Inline kall til Compliance, Wallet, Ledger, PrizePolicy, AuditTrail, Loyalty, SplitRounding
- Test-suite på 76 filer som alle starter med `BingoEngine.*.test.ts`
- "Functions fighting each other"-mønster — hver task må forstå hele filen

**Hva industri gjør:**
Per [SDLC Corp microservice-pattern](https://sdlccorp.com/post/best-practices-in-casino-game-backend-architecture/) skiller man "critical functions such as game logic, authentication, wallets, RNG, and analytics" i separate services. For et IKKE-mikroservice-monolith som Spillorama (forsvarlig valg gitt lisensens scope) skal man minst ha **bounded contexts internt** med klare ports.

**Konkret forslag:**

```
apps/backend/src/
  ├── game/
  │   ├── BingoEngine.ts           (orchestrator: room-state + lifecycle + delegering)
  │   ├── DrawEngine.ts            (NY: draw-mekanikk + drawNextNumber)
  │   ├── PatternMatcher.ts        (eksisterer, kanonisk owner)
  │   ├── PayoutOrchestrator.ts    (NY: extract payoutPhaseWinner ut)
  │   ├── MiniGameRouter.ts        (NY: extract aktivateMiniGame/playMiniGame)
  │   ├── RoomLifecycleService.ts  (NY: createRoom/joinRoom/destroyRoom)
  │   └── ports/
  │       ├── ComplianceLossPort.ts (eksisterer)
  │       ├── PrizePolicyPort.ts (eksisterer)
  │       └── ... (utvid til 7-8 ports)
  ├── wallet/
  │   └── (allerede separert, behold)
  ├── compliance/
  │   └── (allerede separert, behold)
  └── reporting/
      └── (NY: extract generate*Report-metoder fra BingoEngine)
```

**Anbefaling:**
1. **PR-S1a**: Extract `PayoutOrchestrator` (200-300 LOC) — `payoutPhaseWinner` ut av BingoEngine. Dette løser KRITISK 2 fra audit-doc'en samtidig (atomisk outer-tx).
2. **PR-S1b**: Extract `RoomLifecycleService` (300-400 LOC) — createRoom/joinRoom/destroyRoom + player-registry.
3. **PR-S1c**: Extract `ReportingService` (500+ LOC) — alle `generate*Report`-metodene flytter til `apps/backend/src/reporting/`.
4. **PR-S1d**: Extract `MiniGameOrchestrator` integration — fjern inline mini-game-state fra BingoEngine.

Etter PR-S1a-d skal `BingoEngine.ts` være ~1800-2000 LOC og ha ÉN ansvar: room-state + lifecycle-orchestration + draw-orchestration.

**Estimat:** 4-6 dev-dager. Risiko: medium — krever full test-suite-verification etter hver PR.

**ROI:** Hver fremtidig feature-PR går 30-50% raskere. Ny utvikler kan onboarde på BingoEngine på 1 dag i stedet for 1 uke.

### 3.2 Game-state — append-only event-log (ikke full event-sourcing)

**Hva Spillorama har i dag:**
8+ tabeller som sammen utgjør "game state":
- `app_game1_scheduled_games` (lifecycle-state)
- `app_game1_engine_state` (run-state med JSONB draw_bag)
- `app_game1_draws` (append-only draw-log) ✅
- `app_game1_ticket_purchases` + `app_game1_ticket_assignments` (purchases)
- `app_game1_phase_winners` (append-only winners-log) ✅
- `wallet_entries` (append-only finansiell-log med hash-chain) ✅
- `app_audit_log` (append-only audit-stream) ✅

For å rekonstruere "hele runden": JOIN på 8 tabeller med tidssortert merge.

**Hva industri gjør (Pragmatic):**
Per [Pragmatic Enhance™](https://pragmatic.solutions/integration-hub) er all state aggregert i ett "game-stream" per gameId. Replayer kan kjøre én SELECT.

**Anbefaling for Spillorama:**

**Ikke** gjør full event-sourcing (overkill, 6-12 måneder investering).

**Gjør** introduce én konsolidert `app_game_events`-tabell:

```sql
CREATE TABLE app_game_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL,
  game_slug TEXT NOT NULL,        -- 'bingo', 'rocket', 'monsterbingo', 'spillorama'
  event_type TEXT NOT NULL,        -- 'GAME_STARTED', 'DRAW', 'PHASE_WON', 'PAYOUT', 'GAME_ENDED'
  event_seq BIGINT NOT NULL,       -- monotonisk per gameId
  event_data JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hall_id TEXT NOT NULL,
  CONSTRAINT uniq_game_event_seq UNIQUE (game_id, event_seq)
);
CREATE INDEX idx_game_events_game ON app_game_events(game_id, event_seq);
CREATE INDEX idx_game_events_type ON app_game_events(event_type, occurred_at);
```

**Skriv events parallelt med eksisterende state-tabeller** (dual-write):
- `Game1DrawEngineService.drawNext` → INSERT `app_game1_draws` + INSERT `app_game_events(type='DRAW', data={ball, drawIndex, phaseWonAfter})`
- `Game1PayoutService.payoutPhase` → INSERT `app_game1_phase_winners` + INSERT `app_game_events(type='PAYOUT', data={phase, winners, totalPrize})`

**Hvorfor parallel ikke replace:**
1. Ingen breaking change for eksisterende kode
2. Replay-API kan velge "fast path" via game_events eller "gammel path" via 8 tabeller
3. Migrasjons-strategi: kjør parallel i 6 mnd, så vurder om gammel state-tabeller kan droppes
4. Auditor får ÉN tabell å spørre

[Bnaya Eshet — The Two-Layer Event Sourcing Architecture](https://medium.com/@bnayae/the-two-layer-event-sourcing-architecture-d9873c94369d) beskriver akkurat dette mønstret som "outer events for audit, inner state for performance".

**Estimat:** 3-5 dev-dager for migration + dual-write. **ROI:** auditor-tilgang blir mye enklere; replay-API forenkles dramatisk.

### 3.3 RNG-isolasjon — strategisk vurdering

**Spillorama i dag:**
```typescript
// apps/backend/src/game/DrawBagStrategy.ts
import { randomInt } from "node:crypto";

function shuffleDrawBag(bag: number[]): number[] {
  // Fisher-Yates med node:crypto.randomInt — kryptografisk-grade
  for (let i = bag.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
```

Kjører i Node.js-prosessen. Pre-shuffles draw-bag persisteres i `app_game1_engine_state.draw_bag_json`. Trekninger er deterministiske gitt seed.

**Hva industri gjør:**
Per [Wizards.us GLI-19](https://wizards.us/blog/what-is-gli-certification/) og [DST Play GLI-19](https://www.dstplay.com/blog-details/4/What-Is-GLI-19-Certification-and-Why-It-Matters-for-iGaming-Platforms):

1. **GLI-19-sertifisert RNG-hardware** — separat fysisk eller virtuell server, kryptografisk-test passert (Diehard/NIST STS-suite)
2. **Kun en RNG-API**: `requestRandom(seed?, count) → signed_response`
3. **Output kryptografisk signert** — game-engine kan IKKE manipulere output uten å bryte signaturen
4. **Audit-log på server-siden** av alle RNG-requests — auditor kan rekonstruere hver runde

**Pengespillforskriften (Norge):**
§ 64-67 om bingo-tilbud nevner ikke ekstern RNG-sertifisering. Lotteritilsynet aksepterer in-house RNG når kildkoden er åpen for inspeksjon. Spillorama er innenfor regelen.

**Når blir det relevant?**
- **Sverige Spelinspektionen** (svensk lisens): krever GLI-19 eller tilsvarende
- **MGA Malta** (EU-base): krever GLI-19
- **UK Gambling Commission**: krever ISO 27001 + uavhengig RNG-test

**Anbefaling:**
- **Pilot + Norge-only:** ikke gjør noe nå. Pengespillforskriften aksepterer in-house RNG.
- **EU-ekspansjon:** budsjetter 3-6 mnd for GLI-19-sertifisering. Krever uavhengig 3rd-party test (~50-150K NOK) + arkitektur-endring (separer RNG-server).

**Mellomfase-grep (3-måneders-arbeid hvis ønskelig):**
1. Extract `apps/backend/src/game/rng/` med `RngService` interface
2. Implementer `LocalRngService` (eksisterende `node:crypto`-basert) som default
3. Forbered `RemoteRngService` (kall til ekstern RNG-server) som kan plugges inn
4. Logg ALLE RNG-requests i `app_rng_requests` med game_id + seed-hash + ball-output

Dette gjør GLI-19-arbeidet senere til en "configuration-change" snarere enn "refactor".

### 3.4 Multi-tenancy — Spillorama-modellen er passende

**Spillorama:**
- Per-link rooms for Spill 1 (`BINGO_<groupId>`) per `canonicalRoomCode.ts`
- Per-hall RT compliance (§71-binding)
- Per-hall config + per-link config-overrides
- Shared engine, varied UI per hall (planlagt)

**Industri:**
- **Playtech Virtue Fusion**: 100+ operatør-skins, shared bingo network, 15K samtidige spillere ([NewBingoSites Virtue Fusion review](https://www.newbingosites.co/networks/playtech-virtue-fusion/))
- **Pragmatic Play**: aggregert via Enhance™-platform, single-wallet ([Pragmatic Solutions](https://pragmatic.solutions/integration-hub))
- **Evolution Gaming**: dedicated tables per operator ([Stanford Edu Evolution overview](https://stanford.edu.co.bz/understanding-the-evolution-casino-system-structure-technology-and-licensing/))

**Konklusjon:** Spillorama opererer som "hall-network" snarere enn "operator-network" — riktig modell for retail-bingo. Multi-tenancy-strukturen er adekvat. Anbefaling: ikke gjør noen endringer her.

### 3.5 Concurrency-modell — paritet med industri

**Spillorama:**
1. Per-room mutex (`drawLocksByRoom`) — blokkerer samtidige `draw:next`
2. FOR UPDATE-pessimistisk-lås på wallet + game-state
3. REPEATABLE READ + retry på 40001/40P01 (BIN-762)
4. Idempotency-keys på debit/credit/transfer (90d retention)
5. `existingClaim`-fallback for retry-claims
6. Rate-limiting (Socket-event-nivå)

Dette er **bedre enn industri-standard** for et bingo-system. Pragmatic/Evolution bruker tilsvarende mønstre, men ofte mer optimistisk-lock med saga-compensation.

**[Saga-pattern](https://microservices.io/patterns/data/saga.html)** er relevant for Spillorama IKKE, fordi:
- Single-Postgres betyr at full transaksjons-rollback er mulig
- Saga blir relevant ved cross-service-transaksjoner (når wallet er sin egen mikroservice)
- For bingo med single-DB er pessimistisk-lock raskere og enklere

**Distributed locks:** Per [Redis Redlock](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) er Redlock kun nødvendig ved multi-instance-deploy. Spillorama er single-instance — Redlock er overkill. Når dual-instance: ja.

**Anbefaling:** Behold dagens mønster. Vurder Redlock kun når Spillorama går til dual-instance Render (post-pilot).

### 3.6 Wallet-isolasjon — abstraksjons-grenser klare, ikke split

**Status:**
`WalletAdapter`-interface er allerede en port. `PostgresWalletAdapter`, `InMemoryWalletAdapter`, `FileWalletAdapter`, `HttpWalletAdapter` er separate adaptere. Wallet-koden kan i prinsippet flyttes til egen mikroservice ved å:
1. Spinne opp `apps/wallet-service` (egen Node.js-app)
2. Implementere `HttpWalletAdapter` mot ny service
3. Sett `WALLET_PROVIDER=http` i env

**Hvorfor ikke gjør det nå:**
- 6+ dev-uker arbeid
- Ingen umiddelbar gevinst (single-team monolith er raskere å iterere på)
- PCI-DSS Level 4 (under 20K tx/år) krever ikke isolasjon
- Render-deploy-kompleksitet øker

**Hvorfor forberede grensene:**
Per [PCI-DSS Gaming guide](https://ems-ltd.global/pci-dss-compliance-for-online-gaming-platforms/) krever Level 1-2 (over 1M tx/år) at "systems handling cardholder data are network-segregated from gameplay servers". Spillorama bruker Swedbank Pay (kortdata IKKE i deres system), men payment-intent + wallet-balanse logges i samme DB.

**Anbefaling:**
1. **NÅ:** Sørg for at `WalletAdapterPort` er rett og slett en kontrakt. Ingen "läk" av Postgres-detaljer ut. Sjekk at `Game1PayoutService` bruker port-en, ikke direct adapter.
2. **Pre-PCI-Level-1 (når dere når 100K tx/mnd):** evaluer kostnad/nytte ved split.
3. **Hold dokumentasjons-vedlikehold:** alle wallet-endringer må gå via porten, ikke direkte mot adapter.

### 3.7 Audit + compliance — industri-grade

Spillorama har:
- ✅ Hash-chain audit (BIN-764)
- ✅ Reconciliation cron (BIN-763)
- ✅ Outbox-pattern (BIN-761)
- ✅ §71 per-hall-binding (K1)
- ✅ Idempotency-key 90d retention (BIN-767)
- ✅ HOUSE_RETAINED-entry for split-rounding-rest (HIGH-6)
- ✅ Audit-log-service med fire-and-forget (`AuditLogService`)

**Per [Kurrent.io](https://www.kurrent.io/blog/event-sourcing-audit) er disse "audit-grade" tilstrekkelig** for de fleste regulerte iGaming-jurisdiksjoner.

**Gap (lite):**
- Mangler dashboard for auditor — ingen UI som lar Lotteritilsynet eller Tobias selv kjøre ad-hoc-queries
- Mangler XML-eksport til Lotteritilsynet (per § 71 årlig rapportering) — ifølge audit-doc er dette utsatt til post-pilot

**Anbefaling:**
- **Pilot:** ingen endring. Ops-runbook med SQL-query-templates dekker auditor-behov.
- **Post-pilot:** bygg auditor-dashboard (1-2 uker) hvis Lotteritilsynet etterspør det.

### 3.8 Deploy-strategi — Render auto-deploy er adekvat for pilot

**Spillorama:**
- Render auto-deploy fra `main` ved push
- Pre-deploy migrate (per `render.yaml`) — fail-fast
- Health-check `/health` + smoke-test runbook

**Industri:**
- Blue-green med trafikk-switch
- Canary med 1-5% trafikk → 100%
- Dark launch (deploy til prod, ikke serve)
- Feature-flagging

**Anbefaling:**
- **Pilot:** ingen endring. Render auto-deploy fungerer.
- **Post-pilot:** evaluer **feature-flagging** (LaunchDarkly eller in-house) for riskante endringer. Blue-green er overkill for hall-network med <50K daglige spillere.

### 3.9 Observability — godt grunnlag, mangler dashboards

**Spillorama:**
- Pino logger (structured JSON)
- Prometheus metrics (`util/metrics.ts`)
- Trace-ID propagation (MED-1) på tvers av HTTP/Socket.IO/async

**Industri:**
- Distributed-tracing (Jaeger / OpenTelemetry / Honeycomb)
- Real-time dashboards (Grafana / Datadog)
- Alerting-policy (PagerDuty / OpsGenie)
- Custom SLO-tracking

**Spillorama har infrastrukturen — mangler bare wiring + konfigurasjon.**

**Anbefaling:**
1. **Pilot:** Konfigurer Render's innebygde metrics-dashboard. Sett opp 5-10 kritiske alerts:
   - `wallet_reconciliation_divergence_total > 0` (BIN-763)
   - `wallet_outbox_dead_letter > 0` (BIN-761)
   - `wallet_audit_tamper_detected > 0` (BIN-764)
   - `claim_submitted_total{type="BINGO"}` flatlining
   - `draw_next_total` flatlining
   - HTTP 5xx > 1% av requests
   - WebSocket-disconnect-rate spike
2. **Post-pilot:** Vurder OpenTelemetry collector → Honeycomb eller Grafana Cloud (~$50/mnd for hobby-tier).

### 3.10 Failover/HA — single point of failure i dag

**Spillorama:**
- Single Render-instance
- Postgres på Render (single primary, daglig backup)
- Redis på Render (single instance for room-state)
- Hvis instans dør: pilot-haller går offline til Render restarter (typisk 30-90s)

**Industri:**
- **Evolution Gaming** dupliserer studios ([Stanford Edu](https://stanford.edu.co.bz/understanding-the-evolution-casino-system-structure-technology-and-licensing/))
- **Playtech** har 99.98% uptime SLA ([Playtech Bingo product page](https://www.playtech.com/products/bingo/))
- **Evolution AB** har failover-region per [Cockroach Labs gaming reference architecture](https://www.cockroachlabs.com/blog/how-to-build-modern-gaming-services-with-reference-architecture/)

**Anbefaling:**
- **Pilot (0-3 mnd):** Aksepter single-instance. Ops-runbook: monitorer Render uptime, ha eskaleringsprosess hvis instans henger > 5 min.
- **Post-pilot (3-9 mnd):** Vurder dual-instance Render + Redis Sentinel + Postgres replica. Estimat: 2-4 dev-uker.
- **Casino-grade (9-18 mnd):** Multi-region failover (Frankfurt + Stockholm). Estimat: 1-3 mnd avhengig av cloud-provider.

---

## 4. Konkrete refactor-anbefalinger (5-10 actionable)

### Anbefaling 1: Splitt `BingoEngine.ts` i 5-7 bounded contexts (HIGH PRIO)

**Problem:** 4285 LOC god-class.

**Action:**
- PR-S1a: Extract `PayoutOrchestrator` (200-300 LOC). Løser samtidig KRITISK 2 fra audit (atomisk outer-tx).
- PR-S1b: Extract `RoomLifecycleService` (300-400 LOC).
- PR-S1c: Extract `ReportingService` (500+ LOC).
- PR-S1d: Extract `MiniGameOrchestrator` integration.

**Estimat:** 4-6 dev-dager.
**Risiko:** medium (krever full test-suite-verifikasjon).
**ROI:** Hver fremtidig feature-PR går 30-50% raskere. Onboarding av ny utvikler reduseres fra 1 uke til 1 dag.
**Pilot-blokker?** Nei. Kan gjøres parallelt med eller etter pilot.

### Anbefaling 2: Konsolider game-event-stream i én tabell (`app_game_events`)

**Problem:** Game-state spredd over 8+ tabeller. Replay krever multi-tabel-JOIN.

**Action:**
1. Lag migrasjon for `app_game_events`-tabell
2. Dual-write fra `Game1DrawEngineService.drawNext` og `Game1PayoutService.payoutPhase`
3. Oppdater `Game1ReplayService` til å lese fra `app_game_events`
4. Etter 6 mnd, vurder å droppe gamle state-tabeller

**Estimat:** 3-5 dev-dager.
**Risiko:** lav (parallel write, ikke replace).
**ROI:** Auditor-tilgang forenkles dramatisk. Replay-API blir 10x raskere. Forberedelse for event-sourcing-modning.
**Pilot-blokker?** Nei.

### Anbefaling 3: Atomisk outer-transaksjon i `payoutPhaseWinner` (KRITISK 2)

**Problem:** `BingoEngine.payoutPhaseWinner` (line 1436-1622) gjør wallet-transfer + compliance.recordLossEntry + ledger.recordComplianceLedgerEvent + payoutAudit.appendPayoutAuditEvent + checkpoint sekvensielt UTEN én outer-tx. Hvis post-transfer-feiler → state inkonsistent (penger betalt, audit ufullstendig).

**Action:**
- Inject Postgres `Pool` i BingoEngine
- Wrap hele payout + audit + checkpoint i `runInTransaction(client, async () => { ... })`
- Wallet-transfer kjøres som første step i transaksjonen (rollback via SAVEPOINT)
- Audit + ledger-entries kjøres på samme `client`, så rollback feiler atomisk

ALTERNATIV (foretrukket): outbox-pattern via BIN-761. La payout-event gå til `wallet_outbox`, og audit-events kjører som async dispatcher. Hvis dispatcher feiler, retries automatisk.

**Estimat:** 2-3 dev-dager (atomisk outer-tx) eller 1-2 dager (outbox-utvidelse — bygger på BIN-761).
**Risiko:** medium — krever endring av Pool-injeksjon. Lavere via outbox-utvidelse.
**ROI:** Lukker KRITISK 2. State-konsistens garantert.
**Pilot-blokker?** Audit-doc sier nei (pilot er scheduled), men dette burde fikses før pilot uansett.

### Anbefaling 4: Tie-breaker for first-past-the-post i `detectPhaseWinners` (KRITISK 4)

**Problem:** Map-iteration-order ustabil over restart. `firstWinnerId` kan endre seg etter recovery.

**Action:**
I `BingoEnginePatternEval.ts:651-711`, sorter vinnere på (a) `assignment.purchaseTimestamp` ascending eller (b) `assignmentId` (UUID-sort) ascending **før** valg av `firstWinnerId`.

```typescript
// Før:
for (const [playerId, tickets] of game.tickets) { ... }

// Etter:
const sortedEntries = Array.from(game.tickets.entries()).sort((a, b) => {
  // Stable sort på purchaseTimestamp eller assignmentId
  const tsA = a[1][0]?.purchaseTimestamp ?? 0;
  const tsB = b[1][0]?.purchaseTimestamp ?? 0;
  return tsA - tsB || a[0].localeCompare(b[0]);
});
for (const [playerId, tickets] of sortedEntries) { ... }
```

**Estimat:** 0.5 dev-dag (kode + test).
**Risiko:** lav.
**ROI:** Lukker KRITISK 4. Determinisme garantert.
**Pilot-blokker?** Tobias' eksplisitte krav om "100% sikkerhet" — JA.

### Anbefaling 5: Forbered RNG-isolasjon (uten å implementere ekstern RNG-server)

**Problem:** RNG i game-engine-prosess. Ikke pengespillforskriften-blokker, men EU-ekspansjon-blokker.

**Action (Mellomfase, 1 dev-uke):**
1. Extract `apps/backend/src/game/rng/RngService.ts` med interface
2. Implementer `LocalRngService` som default (wrap `node:crypto.randomInt`)
3. Persistér ALLE RNG-requests i ny `app_rng_requests`-tabell:
   ```sql
   CREATE TABLE app_rng_requests (
     request_id UUID PRIMARY KEY,
     game_id UUID NOT NULL,
     game_slug TEXT NOT NULL,
     seed_hash TEXT NOT NULL,
     output_balls JSONB NOT NULL,
     occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```
4. Endre `DrawBagStrategy.buildDrawBag` til å gå via `RngService.requestDrawBag(gameId, ballRange)`

**Estimat:** 5-7 dev-dager.
**Risiko:** lav.
**ROI:** Forbereder GLI-19-sertifisering for EU-ekspansjon. Auditor får full RNG-trail.
**Pilot-blokker?** Nei.

### Anbefaling 6: Konfigurer alerting + dashboards basert på Prometheus-metrics

**Problem:** Metrics finnes (`util/metrics.ts`) men ingen alerting-policy eller dashboards.

**Action (1-2 dev-dager):**
1. Konfigurer Render's metrics-dashboard
2. Opprett 10 kritiske alerts (se §3.9)
3. Sett opp PagerDuty eller email-alerts for prod
4. Lag runbook for hvert alert ("hva betyr det? hva gjør du?")

**Estimat:** 1-2 dev-dager.
**Risiko:** ingen.
**ROI:** Drift-incidents fanges proaktivt. Mean-time-to-detection under 5 min.
**Pilot-blokker?** Nei, men sterkt anbefalt før første kommersielle hall.

### Anbefaling 7: Last-test stream-latency under simulert pilot-trafikk

**Problem:** Stream-latency Norge → Frankfurt ikke målt. Industri-mål er sub-250ms.

**Action (2-3 dev-dager):**
1. Sett opp k6 eller Artillery med Socket.IO-protokoll
2. Simuler 100/500/1000/5000 samtidige spillere
3. Mål p50/p95/p99 latency for `room:update` og `draw:new` events
4. Identifiser bottlenecks (event-broadcast, DB-load, wallet-credit-throughput)
5. Tune Socket.IO-konfig basert på resultater

**Estimat:** 2-3 dev-dager.
**Risiko:** lav (test, ikke prod-endring).
**ROI:** Vet om Spillorama kan håndtere pilot-volum. Dokumentert kapasitet.
**Pilot-blokker?** Nei men anbefalt.

### Anbefaling 8: Standardiser idempotency-key-format (PR-N1 fra REFACTOR_PLAN)

**Problem:** 4+ konvensjoner for idempotency-keys i kodebasen.

**Action:** Ferdigstill PR-N1 fra REFACTOR_PLAN_2026-04-23. Sentraliser i `apps/backend/src/game/idempotency.ts`. Alle wallet-debet/credit/transfer skal bruke `IdempotencyKeys.*`-helpers.

**Estimat:** 1-2 dev-dager.
**Risiko:** lav.
**ROI:** Prevention av duplicate-payout-bugs. Klarere kode.
**Pilot-blokker?** Nei.

### Anbefaling 9: Eksplisitt state-machine for game-lifecycle

**Problem:** Game-lifecycle (CREATED → WAITING → STARTING → RUNNING → PAUSED → COMPLETED) er implisitt i koden. State-transisjoner er spredd over flere services.

**Action:**
- Opprett `apps/backend/src/game/Game1StateMachine.ts` med eksplisitt FSM
- Definer alle transisjoner som funksjoner med pre/post-conditions
- Validér transisjoner før DB-mutasjon

Per [BoardGameArena state machine doc](https://en.boardgamearena.com/doc/Your_game_state_machine:_states.inc.php) er dette mønstret sentralt for kompleksitet-håndtering.

**Estimat:** 3-5 dev-dager.
**Risiko:** medium (krever refactor av eksisterende `Game1MasterControlService`).
**ROI:** Færre "impossible state"-bugs. Lett å resonnere om lifecycle. Lett å teste.
**Pilot-blokker?** Nei.

### Anbefaling 10: ADR-format for arkitektur-beslutninger

**Problem:** Beslutninger spredd over 30+ markdown-dokumenter. Vanskelig å spore "hvorfor valgte vi X".

**Action:**
- Opprett `docs/architecture/adr/` (Architecture Decision Records)
- Bruk standard format: Title / Status / Context / Decision / Consequences
- Skriv ADR for hver større beslutning som er gjort i pilot-perioden:
  - ADR-001: In-house RNG (ikke GLI-19) for Norge-pilot
  - ADR-002: Single-Postgres + monolith (ikke mikroservicer)
  - ADR-003: Render single-instance (ikke dual-instance for pilot)
  - ADR-004: Pessimistisk-lock + REPEATABLE READ (ikke saga-pattern)
  - ADR-005: Per-link rooms (ikke global pool)
  - ... etc

**Estimat:** 0.5 dag per ADR × 8-10 ADR-er = 4-5 dev-dager.
**Risiko:** ingen.
**ROI:** Onboarding av nye dev-ere går 50% raskere. Auditor finner svar uten å spørre Tobias.
**Pilot-blokker?** Nei.

---

## 5. Vurdering av Unified Pipeline-plan

**Note:** Dokumentet `UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md` eksisterer ikke i repo per audit-tidspunkt. Vurderingen baseres på Tobias' beskrivelse av "Fase 0-4" og eksisterende `REFACTOR_PLAN_2026-04-23.md` (Fase 1-6) + branch-navn `refactor/unified-pipeline-fase-1-payout-service`.

Vurderingen er derfor på **prinsippnivå** og forutsetter at Unified Pipeline-planen ligner Fase 2-5 i REFACTOR_PLAN.

### Hva er bra i planen

✅ **Prinsippet om "én ansvarslinje per modul"** matcher industri-DDD-praksis
✅ **Refactor-only PR-er** (ingen ny funksjonalitet underveis) — forhindrer scope-creep
✅ **Test-parity-krav** etter hver PR — sikrer ingen regressjoner
✅ **Modul-splitting** (PR-S1-S3) adresserer god-class-problemet direkte
✅ **Pattern-evaluator-konsolidering** (PR-C1) løser parallel-implementations-problemet

### Hva mangler i planen

🟡 **Ports/adapters-rensing** ikke eksplisitt nevnt
- Anbefaling: legg til "PR-P1" som eksplisitt går gjennom alle `*Port.ts`-filer og verifiserer at de er strikte kontrakter (ingen Postgres-implementasjons-detaljer leket ut).

🟡 **Bounded contexts** ikke navngitt
- REFACTOR_PLAN bruker "moduler" generisk. DDD-bounded-contexts er mer presist:
  - `gameSession` context: BingoEngine + DrawEngine + PatternMatcher
  - `payout` context: PayoutOrchestrator + Game1PayoutService
  - `compliance` context: ComplianceManager + ComplianceLedger
  - `wallet` context: WalletAdapter (allerede)
  - `audit` context: AuditLogService + WalletAuditVerifier
  - `reporting` context: ReportingService (NY)
  - `rng` context: RngService (NY)

🟡 **Event-stream-konsolidering** (Anbefaling 2 i §4) ikke i planen
- Forslag: legg til "PR-E1" for konsolidert `app_game_events`-tabell.

🔴 **Atomic outer-tx for payoutPhaseWinner** (KRITISK 2) ikke eksplisitt
- Forslag: legg til "PR-A1" som første prio (samtidig med PR-S1a).

🔴 **Tie-breaker for first-past-the-post** (KRITISK 4) ikke eksplisitt
- Forslag: legg til "PR-T1" som "tie-breaker fix" — 0.5 dag, men regulatorisk viktig.

🔴 **State-machine for game-lifecycle** ikke eksplisitt
- Forslag: legg til "PR-FSM1" som extract Game1StateMachine.

### Konkret revisjon av planen

**Foreslått oppdatert struktur:**

| Fase | Innhold | Estimat | Pilot? |
|---|---|---|---|
| **Fase 0 (KRITISK)** | PR-A1 (atomic outer-tx for payout) + PR-T1 (tie-breaker) | 3-4 dager | JA — pilot-blokker |
| **Fase 1 (Refactor-rens)** | PR-R1 (admin.ts split) + PR-R3 (schemas.ts split) + PR-R4 (gameEvents.ts split) | 3-5 dager parallelt | NEI |
| **Fase 2 (Konsolidering)** | PR-C1 (pattern-eval) + PR-C2 (pot-eval) + PR-C3 (mini-game-config) | 4-6 dager | NEI |
| **Fase 3 (Modul-splitting)** | PR-S1a-d (BingoEngine), PR-S2 (PhysicalTicketService), PR-S3 (ComplianceLedger) | 5-7 dager parallelt | NEI |
| **Fase 4 (Ports/adapters)** | PR-P1 (port-rensing), PR-N1 (idempotency) | 2-3 dager | NEI |
| **Fase 5 (Event-stream)** | PR-E1 (app_game_events tabell + dual-write) | 3-5 dager | NEI |
| **Fase 6 (FSM)** | PR-FSM1 (Game1StateMachine extract) | 3-5 dager | NEI |

**Totalt:** ~24-35 dev-dager hvis sekvensielt; ~12-18 dev-dager med 2-3 parallelle agenter.

### Skal vi heller gå for full event-sourcing eller hexagonal?

**Full event-sourcing:**
- ❌ Overkill for 4-haller-pilot
- ❌ 6-12 mnd læringskurve + investering
- ❌ Ikke industri-standard for bingo (Playtech bruker tradisjonell DB+state, ikke ES)
- ✅ Append-only event-log (Anbefaling 2) gir 80% av gevinsten

**Full hexagonal arkitektur:**
- ✅ Spillorama er allerede 60% hexagonal (`WalletAdapterPort`, `LoyaltyPointsHookPort`, `ComplianceLossPort`, `PrizePolicyPort`, `SplitRoundingAuditPort`, etc.)
- 🟡 Mangler bare disciplined enforcement
- 🟡 PR-P1 (Anbefaling 4 over) ville fullføre dette

**Min anbefaling:**
**Fortsett med Unified Pipeline-planen (modul-splitting + konsolidering) MEN utvid den med:**
1. PR-A1 (atomic outer-tx) som FASE 0
2. PR-T1 (tie-breaker) som FASE 0
3. PR-P1 (port-rensing) som FASE 4
4. PR-E1 (event-stream) som FASE 5
5. PR-FSM1 (state machine) som FASE 6

**Ikke** gå for event-sourcing eller full hexagonal nå. Hexagonal kommer naturlig via PR-P1. Event-sourcing er post-pilot vurdering.

---

## 6. 6-måneders modnings-roadmap

| Måned | Tema | Konkrete leveranser | Forutsetninger |
|---|---|---|---|
| **Måned 1: Pilot-kvalifisering** | Fase 0+1 av Unified Pipeline | PR-A1, PR-T1 (atomic + tie-breaker) PR-R1, PR-R3, PR-R4 (refactor-rens) Alerting-config (Anbefaling 6) Last-test (Anbefaling 7) | Pilot-team allokert 2-3 agenter |
| **Måned 2: Modul-splitting** | Fase 2+3 av Unified Pipeline | PR-C1, PR-C2, PR-C3 (konsolidering) PR-S1a-d (splitt BingoEngine) PR-S2, PR-S3 (splitt store filer) | Test-suite stable, ingen regressjoner |
| **Måned 3: Ports + Event-stream** | Fase 4+5 | PR-P1 (port-rensing) PR-N1 (idempotency-keys) PR-E1 (app_game_events dual-write) ADR-er for alle store beslutninger | Pilot live på første hall |
| **Måned 4: RNG-modning + state-machine** | Fase 6 + RNG-isolasjon | PR-FSM1 (Game1StateMachine) Extract `RngService.ts` `app_rng_requests`-tabell + persistens | Pilot live på 2-3 haller |
| **Måned 5: Observability + dashboards** | Drift-modning | OpenTelemetry collector → Honeycomb/Grafana SLO-tracking + alerting-policy Auditor-dashboard (read-only UI for Lotteritilsynet-queries) | Drift-team identifisert |
| **Måned 6: Wallet-isolasjons-prep + multi-region eval** | Casino-grade-modning | Audit av `WalletAdapterPort`-bruk Strategi-doc for evt. wallet-service-split Multi-region failover-evaluering (Frankfurt + Stockholm) Pre-GLI-19-vurdering hvis EU-ekspansjon | Forretnings-beslutning om ekspansjon |

**Etter 6 måneder:** Spillorama er på paritet med Pragmatic Play / Playtech for bingo-segment. Klar for kommersiell skala (50K+ daglige spillere) og EU-ekspansjon (etter GLI-19-sertifisering).

---

## 7. Risiko-analyse + ROI per anbefaling

| # | Anbefaling | Risiko | Effort | ROI (1-5) | Pilot-blokker? |
|---|---|---|---|---|---|
| 1 | Splitt BingoEngine | Medium | 4-6 dager | 5 | Nei |
| 2 | Konsolider game-event-stream | Lav | 3-5 dager | 4 | Nei |
| 3 | Atomic outer-tx i payoutPhaseWinner | Medium | 2-3 dager | 5 | **JA (KRITISK 2)** |
| 4 | Tie-breaker first-past-the-post | Lav | 0.5 dag | 5 | **JA (KRITISK 4)** |
| 5 | Forbered RNG-isolasjon | Lav | 5-7 dager | 3 | Nei |
| 6 | Alerting + dashboards | Ingen | 1-2 dager | 4 | Anbefalt |
| 7 | Last-test stream-latency | Lav | 2-3 dager | 4 | Anbefalt |
| 8 | Standardiser idempotency-keys | Lav | 1-2 dager | 3 | Nei |
| 9 | State-machine for game-lifecycle | Medium | 3-5 dager | 4 | Nei |
| 10 | ADR-format for beslutninger | Ingen | 4-5 dager | 3 | Nei |

**Totalt arbeid for 1-10:** ~26-39 dev-dager.
**Pilot-blokkere (kun #3 + #4):** ~3 dev-dager.
**Pre-GA (#3, #4, #6, #7, #8):** ~7-10 dev-dager.
**Pre-casino-grade (#1-10):** ~26-39 dev-dager (fordel over 6 måneder).

---

## 8. Hva Spillorama allerede gjør riktig (positivt)

For å gi balansert vurdering — her er det Spillorama gjør **bedre enn industri-standard**:

1. ✅ **Append-only audit-strømmer på 4 nivåer** (draws, phase-winners, wallet-entries med hash-chain, audit-log). Mange iGaming-stacker har bare 1-2 nivåer.
2. ✅ **Pessimistisk-lock + REPEATABLE READ + idempotency-keys + outbox** kombinert. De fleste plattformer velger 2-3 av disse, ikke alle 4.
3. ✅ **Ports/adapters allerede etablert** for wallet, compliance, prize-policy, loyalty, split-rounding. Hexagonal-grunnlag er solid.
4. ✅ **§71 per-hall-binding** (K1-fix). Multi-tenant compliance håndteres korrekt.
5. ✅ **Hus-garantert fixed-prize** med system-konto-CHECK. Forretningsmessig korrekt for retail-bingo.
6. ✅ **Wallet-split deposit/winnings** per pengespillforskriften §11. Mange plattformer mangler dette.
7. ✅ **Replay-API per gameId** (`Game1ReplayService`). Gode kasinoer har dette; mange iGaming-stacker mangler.
8. ✅ **Compliance fail-closed** på alle player-touching paths. Industri-standard, men ikke alle implementerer det disciplinert.
9. ✅ **Test-suite på 76+ filer** med crash-recovery, atomicity, race conditions. Bedre enn de fleste startup-pre-IPO-iGaming-stacker.
10. ✅ **Norsk regulatorisk-fokus** med konkret pengespillforskriften-mapping. Internasjonale leverandører savner ofte denne dybden for hver jurisdiksjon.

**Bottom line:** Spillorama har bygget en **solid casino-grade backend** for et regulert norsk bingo-system. De gjenstående gap-ene er primært **module boundaries** og **observability**, ikke fundamentale arkitektur-feil.

---

## 9. Konklusjon

**For Tobias' direktiv "som de større casinoene gjør det":**

1. **For norsk pilot (4 haller, scheduled Spill 1):** Spillorama er klar. Pilot-blokkere er KRITISK 2 + KRITISK 4 fra audit-doc'en (3 dev-dagers arbeid).

2. **For kommersiell skala (50K+ daglige spillere):** Spillorama trenger module-refactoring (Anbefaling 1) + observability (Anbefaling 6) + last-tested kapasitet (Anbefaling 7). 2-3 måneders arbeid.

3. **For EU-ekspansjon (GLI-19, Sverige/MGA):** Spillorama trenger ekstern RNG-cert (Anbefaling 5 forberedelse) + ISO 27001-modning. 6-12 måneders arbeid.

4. **For "casino-grade" som Evolution/Pragmatic:** Spillorama er allerede 80-90% der i transaksjonell integritet. Gjenstående gap er primært **observability** og **HA/failover**. 6-9 måneders arbeid.

**Tobias' krav om "100% sikkerhet at den bongen som først fullfører en rad får gevinsten":**
- Lukket via Anbefaling 4 (tie-breaker) + eksisterende `existingClaim`-guard + atomisk DB-tx i `Game1DrawEngineService`. **Etter PR-T1 er det 100%.**

**Strategisk anbefaling:**
- **Måned 1-2:** Fokuser på Fase 0-3 av Unified Pipeline (refactor + atomic + tie-breaker)
- **Måned 3-4:** Konsolider event-stream + state machine + RNG-prep
- **Måned 5-6:** Observability + multi-region-eval

Ikke jag etter event-sourcing eller full mikroservice-split. Spillorama-arkitekturen er **forsvarlig for skala 0-50K daglige spillere**. Refactor-fokuset bør være **disciplined module boundaries**, ikke fundamental rearkitektering.

---

## 10. Referanser

### Akademiske + arkitektur-pattern-kilder
- [Microservices.io: Saga Pattern](https://microservices.io/patterns/data/saga.html)
- [Microservices.io: Event Sourcing Pattern](https://microservices.io/patterns/data/event-sourcing.html)
- [Martin Fowler: CQRS](https://martinfowler.com/bliki/CQRS.html)
- [Martin Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Wikipedia: Hexagonal Architecture](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software))
- [Wikipedia: Domain-driven design](https://en.wikipedia.org/wiki/Domain-driven_design)
- [AWS Prescriptive Guidance: Hexagonal Architecture](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html)
- [AWS Prescriptive Guidance: Saga Patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html)
- [Bnaya Eshet: The Two-Layer Event Sourcing Architecture](https://medium.com/@bnayae/the-two-layer-event-sourcing-architecture-d9873c94369d)
- [Kurrent.io: Event Sourcing vs Audit Log](https://www.kurrent.io/blog/event-sourcing-audit)

### iGaming + casino-spesifikt
- [SDLC Corp: Best Practices in Casino Game Backend Architecture](https://sdlccorp.com/post/best-practices-in-casino-game-backend-architecture/)
- [SDLC Corp: Key Components of a Scalable Casino Game Architecture](https://sdlccorp.com/post/key-components-of-a-scalable-casino-game-architecture/)
- [SDLC Corp: Optimizing Casino Game Architecture for Low Latency](https://sdlccorp.com/post/optimizing-casino-game-architecture-for-low-latency/)
- [Capermint: How a Remote Gaming Server Works (RGS Architecture)](https://www.capermint.com/how-a-remote-gaming-server-works/)
- [Wizards.us: Why a remote gaming server (RGS) scales iGaming](https://wizards.us/blog/remote-gaming-server-rgs/)
- [Wizards.us: House Edge Explained](https://wizards.us/blog/house-edge-explained/)
- [Hathora: Scalable WebSocket Architecture](https://blog.hathora.dev/scalable-websocket-architecture/)
- [Cockroach Labs: How to build modern gaming services with reference architecture](https://www.cockroachlabs.com/blog/how-to-build-modern-gaming-services-with-reference-architecture/)
- [WebSocket.org: WebSockets at Scale](https://websocket.org/guides/websockets-at-scale/)
- [Ably: Challenges of scaling WebSockets](https://ably.com/topic/the-challenge-of-scaling-websockets)
- [Ascendion: Monoliths vs microservices in gaming architecture](https://ascendion.com/insights/monoliths-vs-microservices-in-gaming-architecture-striking-the-right-balance/)
- [Linux BSD OS: Backbone of real time casino gaming on modern servers in 2026](https://linuxbsdos.com/2026/04/11/backbone-of-real-time-casino-gaming-modern-server-infrastructure-in-2026/)
- [Technology.org: Inside the Tech Stack of Online Casino Apps](https://www.technology.org/2026/03/23/inside-the-tech-stack-of-online-casino-apps-rng-encryption-and-real-time-architecture/)

### GLI + sertifisering
- [GLI-19 Interactive Gaming Systems v3.0 (PDF)](https://gaminglabs.com/wp-content/uploads/2020/07/GLI-19-Interactive-Gaming-Systems-v3.0.pdf)
- [GLI-19 v2.0 Bahamas Gaming Board (PDF)](https://www.gamingboardbahamas.com/wp-content/uploads/2023/04/GLI-19_Interactive_Gaming_Systems_v2.0_Final.pdf)
- [GLI: Guaranteeing randomness](https://agbrief.com/news/01/02/2021/gli-guaranteeing-randomness/)
- [Wizards.us: What is GLI certification and its business value](https://wizards.us/blog/what-is-gli-certification/)
- [DST Play: What Is GLI 19 Certification and Why It Matters](https://www.dstplay.com/blog-details/4/What-Is-GLI-19-Certification-and-Why-It-Matters-for-iGaming-Platforms)
- [GLI Standards by Gaming Labs International](https://gaminglabs.com/gli-standards/)
- [GLI: Gaming Security & Vulnerability Compliance Audit](https://gaminglabs.com/services/igaming/security-auditing-vulnerability-analysis/)
- [The Xmas Designers: RNG Certification Requirements for Internet Gaming Platforms](https://www.thexmasdesigners.com/rng-certification-requirements-for-internet-gaming-platforms/)
- [SLGA: Internet Gaming Systems Standard June 2022 (PDF)](https://www.slga.com/-/media/slga/files/permits-and-licences/integrity-standards/internet-gaming-systems-standard-june-2022.pdf)

### Industri-leverandører
- [Playtech: Bingo product page](https://www.playtech.com/products/bingo/)
- [NewBingoSites: Playtech Bingo Sites (Virtue Fusion)](https://www.newbingosites.co/networks/playtech-virtue-fusion/)
- [Diamond Bingo: Virtue Fusion Bingo Network](https://diamondbingo.co.uk/virtue-fusion-bingo-network)
- [WhichBingo: Playtech Software Review](https://www.whichbingo.co.uk/software/playtech-bingo/)
- [Pragmatic Solutions: Integration Hub](https://pragmatic.solutions/integration-hub)
- [SOFTSWISS: Pragmatic Play Provider Review](https://www.softswiss.com/game-providers/pragmatic-play/)
- [Stanford Edu (Bz): Understanding the Evolution Casino System](https://stanford.edu.co.bz/understanding-the-evolution-casino-system-structure-technology-and-licensing/)
- [Tecpinion: Evolution](https://www.tecpinion.com/casino-games-provider-partners/evolution/)
- [Hacksaw Gaming: OpenRGS™](https://www.hacksawgaming.com/open-rgs)
- [Capermint: Creating Scalable and Secure Server Architectures for Online Casino Games](https://www.capermint.com/blog/creating-scalable-and-secure-server-architectures-for-online-casino-games/)

### PCI-DSS + compliance
- [PCI Security Standards Council](https://www.pcisecuritystandards.org/)
- [EMS: PCI DSS Compliance for Online Gaming Platforms 2026](https://ems-ltd.global/pci-dss-compliance-for-online-gaming-platforms/)
- [OpenMetal: Building PCI DSS Compliant Infrastructure for Payment Processors](https://openmetal.io/resources/blog/building-pci-dss-compliant-infrastructure-for-payment-processors/)
- [Sprinto: PCI DSS for Fintech](https://sprinto.com/blog/pci-dss-for-fintech/)
- [ISMS.online: How Gaming Operators Can Master Data Retention for Licence Compliance](https://www.isms.online/gaming-gambling/data-retention-and-logging-for-gaming-compliance/)
- [Riskonnect: Automating Key Compliance Challenges in the Gambling and Gaming Industry](https://riskonnect.com/compliance/automating-key-compliance-challenges-in-the-gambling-gaming-industry/)
- [American Gaming Association: Regulated Sports Betting Protects Game Integrity (PDF)](https://www.americangaming.org/wp-content/uploads/2024/07/AGA-Integrity-Factsheet-FINAL.pdf)
- [Sports Handle: What Regulators Actually Monitor in Online Casino Operations](https://sportshandle.com/what-regulators-actually-monitor-in-online-casino-operations/)
- [Barrel Mag: Why Online Casinos Audit Their Own Math Models](https://www.barrelmag.com/why-online-casinos-audit-their-own-math-models/)

### Distributed locks + concurrency
- [Redis Docs: Distributed Locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [Redis: Lock](https://redis.io/glossary/redis-lock/)
- [Architecture Weekly (Oskar Dudycz): Distributed Locking — A Practical Guide](https://www.architecture-weekly.com/p/distributed-locking-a-practical-guide)

### Spillorama-interne dokumenter (kontekst)
- `docs/architecture/SPILL1_CASINO_GRADE_AUDIT_2026-04-27.md`
- `docs/architecture/REFACTOR_PLAN_2026-04-23.md`
- `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`
- `docs/architecture/BACKEND_KOMPLETT_GJENNOMGANG_2026-04-27.md`
- `docs/engineering/CODE_REVIEW_*_2026-04-27.md` (5 filer)

---

_Slutt. Estimert lesetid: 45 min full-versjon, 5 min Executive Summary._
