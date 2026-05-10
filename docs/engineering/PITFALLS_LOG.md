# Spillorama Pitfalls Log — kumulativ fallgruve-katalog

**Status:** Autoritativ. Alle fallgruver oppdaget i prosjektet samles her.
**Sist oppdatert:** 2026-05-10
**Eier:** PM-AI (vedlikeholdes ved hver agent-sesjon + hver PR-merge med learning)

> **Tobias-direktiv 2026-05-10:** *"Når agenter jobber og du verifiserer arbeidet deres er det ekstremt viktig at alt blir dokumentert og at fallgruver blir forklart slik at man ikke går i de samme fellene fremover. Det er virkelig det som vil være forskjellen på om vi får et fungerende system eller er alltid bakpå og krangler med gammel kode/funksjoner."*

---

## Hvorfor denne loggen eksisterer

Spillorama-prosjektet har siden 2026-04 hatt 12+ PM-handoffs, 1100+ commits og ~50 agent-sesjoner. **Hvert PM-handoff har dokumentert fallgruver** — men de er spredt over 14+ filer, ikke aggregert. Resultat: nye agenter og PM-er gjentar gamle feil fordi kunnskapen ikke er gjenfinnbar.

Denne loggen er **single source of truth** for "ting som har feilet før, hvorfor det feilet, og hvordan unngå å gjenta det". Krav:

1. **Hver gang en agent eller PM oppdager en fallgruve** → legg til entry her
2. **Hver gang du skal lage et agent-prompt** → søk denne loggen for relatert kategori
3. **Hver gang en PR har "Hva fungerte ikke"** i post-mortem → entry skal speilers her
4. **Aldri slett entries** — selv etter fix er kunnskapen verdifull historisk

Loggen er **kumulativ** — eldste entries beholdes selv om koden er fikset, fordi mønsteret kan dukke opp igjen.

---

## Hvordan bruke denne loggen

### For PM (deg)
1. **Før agent-spawn:** søk etter fallgruve-kategori for domenet agenten skal jobbe på
2. **I agent-prompt:** inkluder relevante "Kjente fallgruver"-pekere som referanser
3. **Etter agent-leveranse:** legg til nye fallgruver agenten oppdaget

### For agenter
1. **Ved oppstart:** les seksjonen som matcher ditt scope (compliance, wallet, spill1, etc.)
2. **Ved oppdaget bug/avvik:** legg til ny entry i samme PR
3. **Ved unsikkerhet:** søk loggen før du gjetter

### For Tobias
- Kvartalsvis review: identifiser mønstre, beslutt om noen fallgruver krever arkitektur-endring (ny ADR)

---

## Indeks

| Kategori | Antall entries | Sist oppdatert |
|---|---:|---|
| [§1 Compliance & Regulatorisk](#1-compliance--regulatorisk) | 8 | 2026-05-10 |
| [§2 Wallet & Pengeflyt](#2-wallet--pengeflyt) | 7 | 2026-05-10 |
| [§3 Spill 1, 2, 3 arkitektur](#3-spill-1-2-3-arkitektur) | 9 | 2026-05-10 |
| [§4 Live-rom-state](#4-live-rom-state) | 7 | 2026-05-10 |
| [§5 Git & PR-flyt](#5-git--pr-flyt) | 7 | 2026-05-10 |
| [§6 Test-infrastruktur](#6-test-infrastruktur) | 5 | 2026-05-10 |
| [§7 Frontend / Game-client](#7-frontend--game-client) | 8 | 2026-05-10 |
| [§8 Doc-disiplin](#8-doc-disiplin) | 5 | 2026-05-10 |
| [§9 Konfigurasjon / Environment](#9-konfigurasjon--environment) | 4 | 2026-05-10 |
| [§10 Routing & Permissions](#10-routing--permissions) | 3 | 2026-05-10 |
| [§11 Agent-orkestrering](#11-agent-orkestrering) | 7 | 2026-05-10 |

**Total:** 71 entries (per 2026-05-10)

---

## §1 Compliance & Regulatorisk

### §1.1 — 2500 kr cap KUN for databingo, ALDRI hovedspill

**Severity:** P0 (regulatorisk)
**Oppdaget:** 2026-04-25 (audit), fixet i PR #443
**Symptom:** `applySinglePrizeCap` aktivert på Spill 1/2/3-paths → premier capped feilaktig
**Root cause:** Hard-coded `gameType: "DATABINGO"` for alle spill i `Game2Engine.ts:986-988`, `Game3Engine.ts:1137`
**Fix:** Bruk `ledgerGameTypeForSlug(slug)` — returnerer `MAIN_GAME` for `bingo`/`rocket`/`monsterbingo`, `DATABINGO` for `spillorama`
**Prevention:**
- Aldri hardkode `gameType: "DATABINGO"` for noe annet enn `slug === "spillorama"`
- Pre-pilot regression-test: betal 5000 kr på Spill 1 Innsatsen → ikke capped
**Related:**
- [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §4
- [`SPILLKATALOG.md`](../architecture/SPILLKATALOG.md)
- `apps/backend/src/game/ledgerGameTypeForSlug.ts`

### §1.2 — Compliance-ledger MÅ binde til kjøpe-hall, IKKE master_hall_id

**Severity:** P0 (§71-rapport-feil per Lotteritilsynet)
**Oppdaget:** 2026-04-24 R3-research, fixet i PR #443
**Symptom:** Multi-hall Spill 1-runde der spillere fra Hall B kjøper bonger, men compliance-ledger binder til master-hall (Hall A) → §71-rapporten viser feil hall-omsetning
**Root cause:** `Game1TicketPurchaseService:606` brukte `room.hallId` (master-hall) istedenfor `actor_hall_id` (kjøpe-hall)
**Fix:** Alle wallet-touch-paths må bruke `actor_hall_id`-feltet fra request-context, IKKE `room.hallId`
**Prevention:**
- Mini-game payouts, pot-evaluator, jackpot-payouts — ALLE bindes til kjøpe-hall
- Test: kjøp bong fra Hall B i master=Hall A-runde → verifiser ledger-rad har `actor_hall_id=Hall B`
**Related:**
- PR #443 multi-hall-binding fix
- `Game1TicketPurchaseService.ts:606`, `Game1PayoutService.ts:390`
- [`PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md`](../operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md) §6

### §1.3 — Audit-trail er APPEND-ONLY, aldri UPDATE/DELETE

**Severity:** P0 (regulatorisk + tampering)
**Oppdaget:** 2026-04-26 (BIN-764 etablert)
**Symptom:** Forsøk på korrigere feilaktig audit-event ved UPDATE → bryter hash-chain → §71-rapport invalid
**Root cause:** Hash-chain audit-trail (BIN-764) bruker `prev_hash → curr_hash → entry_hash`-kjede. Endre én rad bryter alle etterfølgende.
**Fix:** Ved feil → skriv NY korrigerings-rad som refererer originalen via `details.correction_of`. Aldri rør eksisterende.
**Prevention:**
- ALDRI `UPDATE app_compliance_audit_log` eller `app_wallet_entries`
- ALDRI `DELETE` fra audit-tabeller
- ALDRI direct INSERT (bypass `AuditLogService.record()`)
- DB-policy / triggere bør håndheve dette (TODO post-pilot)
**Related:**
- [ADR-0004](../adr/0004-hash-chain-audit.md) hash-chain audit-trail
- `apps/backend/src/compliance/AuditLogService.ts`

### §1.4 — Spill 4 er DATABINGO, ikke hovedspill

**Severity:** P1 (terminologi-forvirring → §11-prosent-feil)
**Oppdaget:** 2026-04-23 (feil spikret), korrigert 2026-04-25
**Symptom:** "Spill 4" markedsføring assumed å være hovedspill (15%) men er faktisk databingo (30% + 2500 kr cap)
**Root cause:** Markedsførings-navn "Spill 4" = SpinnGo = `spillorama` slug = legacy `game5` kode-navn = DATABINGO regulatorisk
**Fix:** Sjekk SPILLKATALOG.md før du gjør antakelser om §11-prosent
**Prevention:**
- "Spill X"-nummerering matcher IKKE `gameN`-kode-navn — sjekk slug
- Game 4 / `game4` / `themebingo` er **deprecated (BIN-496)** — ikke bruk
**Related:**
- [`SPILLKATALOG.md`](../architecture/SPILLKATALOG.md) komplett mapping

### §1.5 — §66 5-min pause håndheves SERVER-SIDE

**Severity:** P1 (regulatorisk)
**Oppdaget:** Designet 2026-04 (BIN-585)
**Symptom:** Klient kunne potensielt overstyre obligatorisk pause via lokal cache
**Root cause:** Pause-state holdes på server (`ResponsibleGamingPersistence`), aldri klient-side
**Fix:** All §66-håndhevelse skjer i `RgRestrictionService` på backend. Klient ser kun "blocked"-flag.
**Prevention:**
- Aldri implementer pause-logikk i game-client
- Aldri stol på klient-payload for compliance-state
- Validér via `complianceManager.assertCanPlay()` ved hver wallet-touch

### §1.6 — Self-exclusion (§23) er IKKE hevbar

**Severity:** P0 (regulatorisk)
**Oppdaget:** Designet 2026-04
**Symptom:** Admin forsøker å fjerne self-exclusion før 1 år har gått → Lotteritilsynet-brudd
**Root cause:** §23 sier minimum 1 år, ikke hevbar tidligere — selv av admin
**Fix:** Backend avviser `lift_self_exclusion` hvis `excluded_at + 1 year > now()`
**Prevention:**
- Aldri legg til "force-unlift"-knapp i admin-UI
- DB-CHECK constraint på rg_restrictions

### §1.7 — `auto-multiplikator` gjelder per bongfarge, IKKE per ticket-pris flat

**Severity:** P1 (premie-feil)
**Oppdaget:** 2026-04 design-spec
**Symptom:** Premier hardkodet flat istedenfor `base × (ticketPrice / 500)` skalering
**Root cause:** Standard hovedspill bruker `prize_multiplier_mode = "auto"` med `bingoBase` for 5 kr-bong. Backend skalerer.
**Fix:** Engine-bridge MÅ skalere: hvit (5kr)×1, gul (10kr)×2, lilla (15kr)×3
**Prevention:**
- Trafikklys avviker (`explicit_per_color`) — bruk `prizesPerRowColor`
- Oddsen har egne `bingoBaseLow`/`bingoBaseHigh` med target-draw-bucket
**Related:**
- [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §3 + §5 + §6

### §1.8 — Multi-vinner-deling: pot per bongstørrelse, IKKE flat

**Severity:** P1 (premie-fordelings-feil)
**Oppdaget:** 2026-05-08 (Tobias bekreftet regel)
**Symptom:** Multi-vinner ble flat-delt (50/50) eller per-vinner-uavhengig — bryter "innsats avgjør gevinst"-prinsippet
**Root cause:** `Game1DrawEngineService.payoutPerColorGroups` med "firstColor's pattern" eller PR #995 per-vinner — begge feil
**Fix:** Pot per bongstørrelse → andel = pot[size] / antall_vinnende_bonger_i_samme_størrelse. Floor-rest til HOUSE_RETAINED.
**Prevention:**
- Lilla-spillere må ALLTID vinne mer enn gul-spillere ved same vinst (3:2:1-forhold på Rad/Bingo)
- Test: 2 hvit + 2 lilla på Rad 1 base=100 → hver hvit får 50, hver lilla får 150
**Related:**
- [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §9
- Status 2026-05-08: regel definert, engine-pathen MÅ rebuiles for å matche §9.7-formel

---

## §2 Wallet & Pengeflyt

### §2.1 — Wallet 2.-vinn-bug (cache-stale efter Game1-payout)

**Severity:** P0 (KRITISK, pengetap-risiko)
**Oppdaget:** 2026-04-26, fixet i PR #553 (4 timer)
**Symptom:** Spiller vinner 2 ganger på rad i samme runde → 2.-utbetaling ble redusert eller mistet pga stale wallet-cache
**Root cause:** Klient-cache av wallet-saldo ikke invalidert efter første payout → 2. wallet-debit/credit-kall brukte gammel saldo som baseline
**Fix:** `Cache-Control: no-store` på `/api/wallet/me`-routes (PR #553) + force-refresh efter payout
**Prevention:**
- Aldri stol på klient-cached wallet-saldo for noe regulatorisk
- Refresh wallet-saldo etter HVER payout-event (server kan emit `wallet:state` socket-event)
- Test: 2 wins på Rad 1 + Rad 2 i samme runde → begge premier kreditert korrekt

### §2.2 — `BIN-611` race condition: SELECT-before-BEGIN gir UNIQUE-violation

**Severity:** P0 (concurrency-bug)
**Oppdaget:** 2026-04-18 BIN-611
**Symptom:** Parallelle retries av samme idempotency-key → første gjør SELECT (ikke funnet), andre gjør BEGIN+INSERT → første prøver INSERT → UNIQUE_VIOLATION crash
**Root cause:** `PostgresWalletAdapter.singleAccountMovement` (linje 438-441) gjorde dedup-SELECT FØR `BEGIN`-transaksjon
**Fix:** Flytt SELECT inn i transaksjon med `FOR UPDATE` lock på idempotency-key-rad
**Prevention:**
- Alle dedup-sjekker for wallet-operasjoner MÅ være inne i transaksjonen
- Bruk `INSERT ... ON CONFLICT DO NOTHING RETURNING *` for atomic dedup
**Related:** `apps/backend/src/adapters/PostgresWalletAdapter.ts`

### §2.3 — `BIN-612` ExternalWalletAdapter retry-er 5× ved ALLE feil

**Severity:** P0 (KRITISK, dobbeltutbetaling-risiko)
**Oppdaget:** 2026-04-18 BIN-612
**Symptom:** `providerCredit` retry-er 5× ved alle feil-typer — også 4xx (validation, ikke retry-able) → dobbeltutbetaling
**Root cause:** Asymmetri: `providerDebit` har eksponentiell backoff + skill mellom retry-able/non-retry-able. `providerCredit` mangler dette.
**Fix:** Klassifiser feil som retryable (5xx, timeout, network) vs non-retryable (4xx, validation). Kun retry førstnevnte.
**Prevention:**
- Wallet-credit/-debit MÅ ha samme retry-strategi
- Test: mock 4xx-svar fra provider → ingen retry
- Test: mock 503 → retry max 3× med backoff

### §2.4 — Outbox-pattern på alle wallet-operasjoner

**Severity:** P0 (atomicity)
**Oppdaget:** 2026-04-26 BIN-761 etablert
**Symptom:** Wallet-debit + socket-emit i to separate operasjoner → crash mellom dem → wallet debited men klient vet ikke
**Root cause:** Wallet-state og event-emit må være atomic
**Fix:** Outbox-pattern: skriv `app_event_outbox` i samme TX som wallet-mutation. Worker-prosess emit-er events fra outbox.
**Prevention:**
- Aldri `socket.emit()` direkte etter wallet-mutering
- Bruk `WalletAdapter.transfer({ idempotencyKey, ... })` som håndterer outbox internt
**Related:**
- [ADR-0005](../adr/0005-outbox-pattern.md)
- BIN-761

### §2.5 — REPEATABLE READ, ikke SERIALIZABLE for wallet-debit

**Severity:** P1 (performance + correctness)
**Oppdaget:** 2026-04-26 BIN-762
**Symptom:** SERIALIZABLE gir for mange retry-able conflicts på wallet-debit → throughput-tap
**Root cause:** Wallet-debit trenger READ + WRITE-konsistens, ikke full serializability
**Fix:** Bruk REPEATABLE READ med `SELECT ... FOR UPDATE` på saldo-rad
**Prevention:**
- Aldri eskaler til SERIALIZABLE uten case-by-case-vurdering
- BIN-762 etablerte REPEATABLE READ som baseline

### §2.6 — Aldri direct INSERT i `app_wallet*`-tabeller

**Severity:** P0 (konsistens)
**Symptom:** Direct INSERT bypasser dedup-sjekk + outbox-skriving → orphan-rader
**Fix:** Bruk `WalletAdapter`-interface for ALLE wallet-mutasjoner
**Prevention:**
- Code-review: grep etter `INSERT INTO app_wallet` og `INSERT INTO app_compliance_ledger` i nye PR-er
- Architecture-lint kan fange dette

### §2.7 — Idempotency-key for ALLE wallet-operasjoner

**Severity:** P0 (dobbel-debit-prevensjon)
**Oppdaget:** Designet 2026-04 BIN-767
**Symptom:** Operasjon uten idempotency-key → re-tries skaper duplikater
**Fix:** Hver operasjon må ha eksplisitt key via `IdempotencyKeys.<operation>(...)`
**Prevention:**
- Hard rule: ingen wallet-operasjon uten idempotency-key
- 90-dager TTL cleanup (BIN-767)
**Related:** `apps/backend/src/wallet/IdempotencyKeys.ts`

---

## §3 Spill 1, 2, 3 arkitektur

### §3.1 — KRITISK: Spill 1, 2, 3 har FUNDAMENTALT forskjellige arkitekturer

**Severity:** P0 (antakelser overføres feil → bryter implementasjon)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Symptom:** Agent prøver å bruke perpetual-loop-pattern på Spill 1, eller master-rolle på Spill 2/3
**Root cause:** Tre forskjellige grunn-arkitekturer:
- **Spill 1** (`bingo`): per-hall lobby + GoH-master-rom + plan-runtime + scheduled-games
- **Spill 2** (`rocket`): ETT globalt rom + perpetual loop + auto-tick
- **Spill 3** (`monsterbingo`): ETT globalt rom + perpetual loop + sequential phase-state-machine
**Prevention:**
- Les FØRST `SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md` for spillet du jobber med
- Aldri kopier antakelser fra ett spill til et annet
- Hvis koden krangler mot doc-en: doc-en vinner, fix koden
**Related:**
- [`SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md)
- [`SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md)
- [`SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md)
- CLAUDE.md "Spill 1, 2, 3 fundament"-blokk

### §3.2 — Spill 1 har INGEN auto-restart, Spill 2/3 HAR

**Severity:** P0 (regulatorisk: master-trigger vs auto)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** DrawScheduler auto-startet runder for `bingo`-rom → "spill running uten å ha startet" (Tobias rapporterte)
**Root cause:** DrawScheduler-cron auto-restartet ALLE perpetual-rom uavhengig av slug
**Fix:** Kill-switch i `schedulerSetup.ts:135-200`: hvis `slug === "bingo"` → blokker auto-start
**Prevention:**
- Spill 1 = master-styrt → kun `MasterActionService.start` kan starte engine
- Spill 2/3 = perpetual → `PerpetualRoundService.handleGameEnded` schedulerer ny runde
- Hvis du legger til ny slug → bestem eksplisitt om den er master-styrt eller perpetual

### §3.3 — Spill 2 ROCKET = ETT globalt rom for ALLE haller

**Severity:** P0 (singleton-konstrukten)
**Oppdaget:** Designet 2026-05
**Symptom:** Forsøk på spawne flere `rocket`-rom (eks. per hall) → bryter singleton-invariant
**Root cause:** `canonicalRoomCode("rocket")` returnerer alltid `"ROCKET"` med `effectiveHallId: null`. Partial unique idx på `app_spill2_config(active=TRUE)`.
**Fix:** Aldri prøv å lage hall-spesifikke `rocket`-rom. Hall-binding skjer i ledger-events, ikke i room-code.
**Prevention:**
- Hvis du finner kode som spawn-er flere `rocket`-rom → det er bug, fix umiddelbart
- Test: spawn 4 klienter med ulik `hallId` → alle havner i room `ROCKET`

### §3.4 — Spill 3 phase-state-machine: sequential, ikke parallel

**Severity:** P0 (Tobias-revert 2026-05-03)
**Oppdaget:** PR #860 ble revertet 2026-05-03
**Symptom:** PR #860 portet Spill 3 til 3×3 / 1..21-form med parallel pattern-eval — Tobias revertet
**Root cause:** Spill 3 skal være 5×5 / 75-baller med sequential phases (Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus)
**Fix:** Bruk `Game3PhaseStateMachine.ts` med `autoClaimPhaseMode=true` flag
**Prevention:**
- Aldri reverter Spill 3 til 3×3-form eller parallel-pattern-eval
- Pattern-navn-mapping: bridge bruker `"1 Rad"`, state-machine bruker `"Rad 1"` — `phasePatternIndexFromName` aksepterer begge
- T/X/7/Pyramide-pattern var PR #860-formen som ble revertet — IKKE bruk
**Related:** [`SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md) §1.1

### §3.5 — Master-handlinger: ingen "Avbryt spill", ingen "Hopp over"

**Severity:** P1 (UX/regulatorisk)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Prevention:**
- Master kan IKKE hoppe over neste spill i sekvensen (alltid umiddelbart neste)
- "Avbryt spill" er IKKE master-action — flyttet til admin-only (regulatorisk-tung)
- Master kan starte/stoppe uavhengig av om andre haller er ready (ready = informativ, ikke gate)

### §3.6 — Master-hall valg: `app_hall_groups.master_hall_id`-kolonne

**Severity:** P1 (UI rendering bug)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Master-knapp vises ikke i UI selv om GoH har master
**Root cause:** Eldre seed-script lagret kun `master_hall_id` i `extra_json.masterHallId`, ikke i kolonnen → `GameLobbyAggregator.computeMasterHallId` leser fra kolonnen og returnerte null
**Fix:** Set BÅDE kolonne OG extra_json (BIN-1034 / 2026-05-08)
**Prevention:**
- Ny seed-rad MÅ sette `app_hall_groups.master_hall_id` direkte
- Ved migration: backfill kolonnen fra eksisterende `extra_json.masterHallId`
**Related:** `apps/backend/scripts/seed-demo-pilot-day.ts:1857-1880`

### §3.7 — Bridge-pattern for Spill 2/3 config

**Severity:** P1 (consistency)
**Oppdaget:** Designet 2026-05-08
**Symptom:** Direkte bruk av `Spill2Config` / `Spill3Config` på engine-laget → tett kobling
**Fix:** `Spill2GlobalRoomService.buildVariantConfigFromSpill2Config()` + Spill 3-tilsvarende oversetter til engine-format
**Prevention:**
- Ny config-felt? → oppdater bridge-funksjonen samtidig
- Tester verifiserer mappingen (`roomState.bindSpill2Config.test.ts`)

### §3.8 — `PerpetualRoundOpeningWindowGuard` (BIN-823 fix 2026-05-08)

**Severity:** P0 (regulatorisk åpningstid)
**Oppdaget:** 2026-05-08, fixet i PR #1051
**Symptom:** Spill 2 perpetual-loop spawnet runder utenfor `Spill2Config.openingTimeStart/End`-vindu — Lotteritilsynet-brudd
**Root cause:** `canSpawnRound`-callback returnerte `null` for `rocket`-slug (kun Spill 3-grenen var implementert)
**Fix:** Factory-pattern i `PerpetualRoundOpeningWindowGuard.ts` — felles helper for Spill 2 + Spill 3, wireup via `index.ts:281, 3025-3026`
**Prevention:**
- Test: sett `openingTimeEnd = "12:00"` kl 13:00 → ingen ny runde spawnes
- Wiring-regression-test bevarer factory-injection
**Related:** [`SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md) §3.8 + §10.2

### §3.9 — `lazy-spawn` av scheduled-game krever cron-race-håndtering

**Severity:** P1 (race-condition)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Mark-ready feilet pga `Game1HallReadyService` aksepterte kun `scheduled`/`purchase_open`-status, ikke `ready_to_start`
**Root cause:** `Game1ScheduleTickService` cron flipper status: `scheduled → purchase_open → ready_to_start`. Lazy-spawn kunne treffe etter cron-flip.
**Fix:** Aksepter hele "pre-running"-vinduet (`scheduled` + `purchase_open` + `ready_to_start`) i `markReady()` og `unmarkReady()`
**Prevention:**
- Tester må dekke cron-race-scenarier (lazy-spawn rett før cron-tick)

---

## §4 Live-rom-state

### §4.1 — Phantom-rom etter restart → FLUSHALL Redis

**Severity:** P2 (dev-stack)
**Oppdaget:** Daglig under utvikling
**Symptom:** Backend gjenoppretter rooms fra Redis efter restart → spøkelses-rom som ikke matcher DB-state
**Fix:** `docker exec spillorama-system-redis-1 redis-cli FLUSHALL` + restart backend
**Prevention:**
- `npm run dev:all -- --reset-state` for ren restart
- I prod: ikke et problem siden Redis-state og DB-state synkes via outbox

### §4.2 — Stale plan-runs ved instans-krasj

**Severity:** P1 (UI viser STALE_PLAN_RUN-warning)
**Oppdaget:** 2026-05-08
**Symptom:** Master-konsoll viser warning fra gårsdagens leftover plan-run
**Fix:** `GamePlanRunCleanupService` — cron 03:00 Oslo + inline self-heal-hook
**Prevention:**
- `getOrCreateForToday` self-healer stale runs
- SQL-cleanup ved utviklingsfeil:
  ```sql
  UPDATE app_game_plan_run SET status='finished', finished_at=now()
  WHERE status NOT IN ('finished','idle');
  ```

### §4.3 — Recovery-snapshot må deep-clone phase-state

**Severity:** P0 (R10 invariants brudd)
**Oppdaget:** 2026-05-08 R10 chaos-test design
**Symptom:** Spill 3 phase-state ikke survival-er instans-restart → `currentPhaseIndex` reset til 0 → spillere mister rad-vinster
**Fix:** `BingoEngine.serializeGame` deep-cloner `spill3PhaseState` (array clone for `phasesWon`)
**Prevention:**
- Hvis du legger til nye state-felter til `GameState` → oppdater `serializeGame` + `restoreFromCheckpoint` samtidig
- R10-test verifiserer I1-I5 invariants

### §4.4 — `GamePlanEngineBridge` cancelled-rad-gjenbruk

**Severity:** P0 (kjent bug, ikke pilot-blokker)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Mark-ready feiler med `GAME_NOT_READY_ELIGIBLE: 'cancelled'` etter at runde har vært cancelled tidligere samme dag
**Root cause:** `createScheduledGameForPlanRunPosition` gjenbruker eksisterende rader på `(plan_run_id, plan_position)` uten status-filter
**Fix-anbefaling:** Filter `WHERE status NOT IN ('cancelled','finished')` på idempotency-lookup
**Status:** Åpen — workaround er SQL-cleanup
**Prevention:** Test: cancel runde → forsøk advance → verifiser ny rad spawner, ikke gjenbruker cancelled

### §4.5 — Aldri `io.emit()` — alltid `io.to(roomCode)`

**Severity:** P0 (skala-katastrofe)
**Oppdaget:** Designet 2026-05
**Symptom:** Full broadcast på 1500-spillere-skala blokkerer event-loop og spiser bandwidth
**Fix:** Targeted broadcast per rom; per-spiller-strip for perpetual-rom (ADR-011)
**Prevention:**
- Code-review fanger `io.emit()` automatisk
- Alle nye socket-paths må bruke `io.to(roomCode).emit(...)`
- Wave 3b reduserte `room:update` payload fra 314 KB til 0.8 KB pr mottaker
**Related:** [ADR-0013](../adr/0013-per-recipient-broadcast-perpetual-rooms.md)

### §4.6 — Idempotente socket-events med `clientRequestId`

**Severity:** P0 (R5 mandat)
**Oppdaget:** 2026-05-08 BIN-813
**Symptom:** Socket-disconnect midt i `ticket:mark` → klient retry-er → server får 2 events → dobbel-mark
**Fix:** `withSocketIdempotency`-wrapper på `ticket:mark`, `claim:submit`, `bet:arm` — Redis-dedup med 5-min TTL på `(userId, eventName, clientRequestId)`
**Prevention:**
- Alle nye socket-events som muterer state MÅ bruke wrapper
- Fail-soft ved Redis-utfall (wallet-laget er fortsatt idempotent som defense-in-depth)
**Related:** [ADR-0005](../adr/0005-outbox-pattern.md), tester `withSocketIdempotency.test.ts`

### §4.7 — DR-runbook S1-S7-navne-kollisjon (mandat vs runbook)

**Severity:** P1 (forvirring under press → feil prosedyre)
**Oppdaget:** 2026-05-10 av Plan-agent under R12-valideringsplan-arbeid (BIN-816)
**Symptom:** Ops/compliance leser "S5"-prosedyre i én doc og forventer en annen i annen doc — ulik forståelse under incident
**Root cause:** To dokumenter bruker SAMME notasjon "S1-S7" for ULIKE scenario-sett:
- `docs/operations/LIVE_ROOM_DR_RUNBOOK.md` bruker S1-S7 for INFRASTRUKTUR-scenarier:
  - S1: Backend-instans-krasj
  - S2: Redis-failover
  - S3: Postgres failover
  - S4: Region-down
  - S5: DDoS
  - S6: Rolling restart
  - S7: Perpetual-loop-leak
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` referer til S1-S7 for APPLICATION/COMPLIANCE-scenarier:
  - S1: Master-hall fail
  - S2: Multi-hall desync
  - S3: Ledger poison
  - S4: Wallet corruption
  - S5: Rate-limit cascade
  - S6: RNG drift
  - S7: Network partition
**Fix-plan (per `R12_DR_VALIDATION_PLAN.md` §8):**
- Re-numerér ELLER eksplisitt cross-reference mellom mandat-S1-S7 og runbook-S1-S7
- Legg mapping-tabell øverst i `LIVE_ROOM_DR_RUNBOOK.md`
- Når denne fallgruven slår inn, kan compliance-eier følge feil prosedyre under press
**Prevention:**
- Aldri bruk samme notasjon (S1-S7, P0-P3, etc.) for to ulike kategorier i samme prosjekt
- Code-/doc-review: hvis du ser overlappende numbering, krev cross-reference
- Test: kan ny ops/compliance lese "S5 trigget" og umiddelbart vite hvilken prosedyre uten konflikt?
**Related:**
- [`R12_DR_VALIDATION_PLAN.md`](../operations/R12_DR_VALIDATION_PLAN.md) §8 (foreslått fix)
- BIN-816 R12 DR-runbook validering

---

## §5 Git & PR-flyt

### §5.1 — Squash-merge SHA-mismatch ved kjedede PR-er

**Severity:** P1 (utvikling-friksjon)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** PR B basert på PR A. Når A squash-merges, får A ny SHA → B refererer original → CONFLICTING/DIRTY
**Fix-mønstre:**
1. **Sekvensiell merge + rebase:** vent på A merger, rebase B mot ny main, push (3× CI)
2. **Combined PR fra start:** lag som én PR med cherry-pick alle commits (PR #1132 brukte denne)
3. **Merge istedenfor squash:** bevarer SHA-er men forurenser commit-historikk
**Prevention:**
- Hvis du planlegger ≥2 relaterte PR-er → vurder combined PR fra start
- Aldri base PR B på open PR A uten å være forberedt på rebase-arbeid

### §5.2 — Aldri `git add -A` (.env og secrets-risk)

**Severity:** P0 (security)
**Symptom:** `git add -A` plukker `.env`, `.env.backup`, `tobias-keys.json` etc.
**Fix:** Stage spesifikke filer: `git add path/to/file.ts`
**Prevention:**
- `.gitignore` dekker mest, men ikke alt
- Pre-commit hook (`secret-scanner`) fanger noen tilfeller
- Code-review: sjekk PR-diff for `.env*` eller credentials

### §5.3 — Aldri `--no-verify` på commit

**Severity:** P1 (umiddelbar feilkilde)
**Symptom:** Bypass av pre-commit-hook → senere CI-fail i andre PR-er
**Fix:** Fix hooks-feil, ikke bypass
**Prevention:**
- Hvis hook feiler: investigér root-cause (sannsynligvis manglende deps i worktree)

### §5.4 — Tobias rør ALDRI git lokalt — PM eier git pull

**Severity:** P0 (workflow)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Prevention:**
- Etter HVER PR-merge: PM må `git pull` i hovedrepoet
- Gi Tobias hot-reload-restart-kommando med `cd /Users/...`-prefiks (han er ofte i `~`)
- Standard restart:
  ```bash
  cd /Users/tobiashaugen/Projects/Spillorama-system && lsof -nP -iTCP:5174 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 && VITE_DEV_BACKEND_URL=http://localhost:4000 npm --prefix apps/admin-web run dev
  ```

### §5.5 — Done-policy (ADR-0010): commit til main + file:line + grønn test

**Severity:** P0 (regulatorisk-sporbarhet)
**Oppdaget:** 2026-04-17 etter 4 falske Done-funn
**Prevention:**
- Aldri lukk Linear-issue på branch-merge alene
- Krev: commit-SHA på main, file:line-bevis, grønn CI eller test-bevis

### §5.6 — PM verifiserer CI etter PR-åpning (5-10 min)

**Severity:** P1 (auto-merge fail-mode)
**Oppdaget:** 2026-05-09 (memory: feedback_pm_verify_ci.md)
**Symptom:** Auto-merge fyrer KUN ved ekte CI-grønning, ikke ved INFRA-fail (schema-gate stale, flaky tests, dependabot)
**Fix:** Periodisk sjekk `gh pr checks <nr>` etter 5-10 min
**Prevention:**
- Hvis ≥ 3 PR-er feiler samme måte → INFRA-bug → root-cause-fix før mer arbeid

### §5.7 — Conventional Commits er BLOKKERENDE (danger.yml rule 7)

**Severity:** P1 (PR avvises uten match)
**Oppdaget:** 2026-04 CI-config
**Format:** `<type>(<scope>): <subject>` på PR-tittel
**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`
**Scopes:** `backend`, `game-client`, `admin-web`, `shared-types`, `infra`, `compliance`
**Prevention:**
- Sjekk PR-tittel matcher regex før push

---

## §6 Test-infrastruktur

### §6.1 — e2e-workflow har ingen migrate-step → BIN-828

**Severity:** P0 (CI-blokker)
**Oppdaget:** 2026-05-09
**Symptom:** PR #1091 flyttet `wallet_accounts/transactions/entries/reservations` CREATE TABLE ut av `PostgresWalletAdapter.initializeSchema()`. Production fungerer (render.yaml kjører `npm run migrate`), men e2e-workflow har INGEN migrate-step → 9 røde main-e2e-runs
**Fix:** Kalle `bootstrapWalletSchemaForTests` i `Spill1FullDay.e2e.test.ts`-`startSession()` (PR #1127)
**Prevention:**
- E2E-tester bruker fresh test-schema — krever explicit bootstrap
- Helper finnes: `walletSchemaTestUtil.ts.bootstrapWalletSchemaForTests`
- Aldri bruk i prod-koden — kun test-only

### §6.2 — Smoke-test API-shape forventninger feiler

**Severity:** P3 (test-infra-bug)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** `pilot-smoke-test.sh` antok `.data` er flat array, men `/api/admin/hall-groups` returnerer `{"ok":true,"data":{"groups":[...]}}`
**Fix:** Bruk `.data.groups[]` for hall-groups (objekt-wrapper)
**Prevention:**
- Verifiser API-shape med live curl FØR du skriver smoke-test
- Endpoints kan ha forskjellig shape — sjekk OpenAPI-spec

### §6.3 — Mock vs ekte DB i tester

**Severity:** P1 (false confidence)
**Oppdaget:** 2026-04 designet
**Symptom:** Mocked tests passed but prod-migration feilet
**Fix:** Wallet/compliance-tester bruker integration-test mod ekte Postgres (`WALLET_PG_TEST_CONNECTION_STRING`)
**Prevention:**
- For REPEATABLE READ-paths: ALDRI mock — bruk integration-test
- Memory-only adapter er kun for unit-isolation

### §6.4 — Worktree pre-commit hook + dependencies

**Severity:** P2 (dev-friksjon)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** Agent committer i worktree → pre-commit hook feiler hvis worktreen mangler dependencies
**Fix:** Worktree må ha node_modules installert (eller gjenbruke main-repo via symlink)
**Prevention:**
- `.husky/`-config deles, men deps må være per-worktree
- Test-engineer / agent som jobber i worktree må ha node_modules

### §6.5 — `.crdownload`-filer i wireframe-katalog

**Severity:** P3 (data-tap)
**Oppdaget:** 2026-04-23
**Symptom:** Wireframes i `docs/wireframes/` med `.crdownload`-suffiks → ufullstendige filer
**Fix:** Re-last fra Tobias' originale kilde
**Prevention:** Sjekk filstørrelse / PDF-validity før commit

---

## §7 Frontend / Game-client

### §7.1 — Game1Controller default `variantConfig=STANDARD`

**Severity:** P0 (pilot-blokker, fixed PR #1128)
**Oppdaget:** 2026-05-09
**Symptom:** Spillerklient header viste "STANDARD" istedenfor "Bingo"
**Root cause:** Game1Controller brukte hardkodet default istedenfor å hente fra plan-runtime aggregator
**Fix:** Hent fra `lobby.planMeta?.catalogDisplayName` via `LobbyStateBinding`
**Prevention:**
- Aldri hardkode display-text — alltid fra catalog/plan-runtime

### §7.2 — BongCard 8 hardkodete farger

**Severity:** P0 (spec-brudd, fixed PR #1132)
**Oppdaget:** 2026-05-09
**Symptom:** Buy-popup viste 8 farger; spec sier 3 (hvit/gul/lilla)
**Fix:** Les `lobby.scheduledGameMeta.ticketColors` + `ticketPricesCents` fra plan-runtime
**Prevention:**
- Trafikklys er spesialtilfelle: 1 farge flat 15 kr
- Backend må eksponere `ticketColors[]` i lobby-state

### §7.3 — Aldri lokal countdown — vente på master-trigger

**Severity:** P1 (Tobias-direktiv 2026-05-09)
**Oppdaget:** 2026-05-09 sesjon, fixed PR #1132
**Symptom:** Spillerklient kjørte auto-countdown → degradert state ("...") når 0
**Fix:** Lytt på `lobby.scheduledGameStatus` transition → vis "Venter på master" når ikke `running`
**Prevention:**
- Spill 1 = master-trigger ONLY
- `WaitingForMasterOverlay`-komponent må mountes når status !== `running`

### §7.4 — Browser-debugging via chrome-devtools-mcp, IKKE computer-use

**Severity:** P2 (workflow)
**Oppdaget:** 2026-04 (memory: debug_preference.md)
**Prevention:** Bruk `chrome-devtools-mcp` for console logs, screenshots, JS eval, network. Aldri computer-use for browser-tasks.

### §7.5 — Frontend må normalisere query-params før backend-kall

**Severity:** P0 (pilot-blokker for lokal test, fixed PR #1149)
**Oppdaget:** 2026-05-10 (Tobias-bug)
**Symptom:** `?dev-user=demo-pilot-spiller-1` (uten `@example.com`) → 403 fra backend
**Root cause:** Frontend (`auth.js` + `main.ts`) sendte raw query-param uten normalisering. Backend allowlist-regex (`/^demo-pilot-\w+@example\.com$/`) krever full email — KORREKT spec.
**Fix:** Pure-funksjon `normalizeDevUserParam()` i begge dev-user-paths som mapper kort-form → full email FØR backend-kall
**Prevention:**
- Backend-kontrakter (allowlist-regex, schemas) er sannhet — frontend MÅ matche
- Kasusvis kort-form-syntax må normaliseres på frontend, ikke løsne backend
- Lås kontrakter i tester: `devAutoLoginRoute.handler.test.ts` (16 tester) verifiserer at short-form FORBLIR avvist
- Frontend må ha matchende regression-test (`devUserAutoLoginRegression.test.ts`)
- Anti-mønster: "Backend rejecter min input → backend må fikses" — ofte er backend riktig

### §7.6 — JackpotSetupModal eksisterte død i 3 dager før wireup

**Severity:** P0 (UX-blocker for jackpot-spill)
**Oppdaget:** 2026-05-10 (Tobias-bug fra screenshot)
**Symptom:** Backend kastet `JACKPOT_CONFIRM_REQUIRED` / `JACKPOT_SETUP_REQUIRED` → frontend viste rå `Toast.error` istedenfor popup
**Root cause:** `JackpotSetupModal.ts` (245 linjer fra Fase 3, 2026-05-07) var bygd men ALDRI wired inn noe sted. Komponenten kunne kun kalles fra tester.
**Fix (PR #1150):** Wire-er begge modaler (Setup + Confirm) inn i `Spill1HallStatusBox.startGame` + `NextGamePanel.attemptSpill1Start` via `runStartWithJackpotFlow`-loop som retry'er etter modal-submit
**Prevention:**
- Når en komponent opprettes for et flowfix, må wireup-PR landes i SAMME bølge — ikke etterlate "klar-til-bruk" som dødkode
- Sjekk: kan komponenten kalles fra produksjons-flyt? Hvis nei, ikke marker leveranse som ferdig
- Backend error-codes skal ALLTID ha matchende UI-handler i frontend — `Toast.error` er IKKE handler, det er fallback
- Tester må dekke wireup-pathen, ikke bare selve komponenten isolert

### §7.7 — `Number(null) === 0`-edge-case i JSON-parsing

**Severity:** P2 (subtil bug i JackpotSetupModal-data-extraction)
**Oppdaget:** 2026-05-10 (PR #1150 test eksponerte)
**Symptom:** `extractJackpotConfirmData` filtrerte ikke ut `null`/`undefined`/`boolean` i drawThresholds-array → `Number(null) === 0` ble inkludert som gyldig threshold
**Fix:** Eksplisitt type-sjekk for `null`/`undefined`/`boolean` før `Number()`-konvertering
**Prevention:**
- `Number()` kaster ikke ved invalid input — det returnerer `0` eller `NaN`
- Bruk `typeof v === 'number' && Number.isFinite(v)` som primær guard
- Skriv tester som passerer `[null, undefined, false, 50, "55"]` for å fange edge-cases

### §7.8 — JackpotConfirmModal var feil mental modell (fjernet ADR-0017)

**Severity:** P1 (designfeil korrigert)
**Oppdaget:** 2026-05-10 (Tobias-bug-test rett etter PR #1150)
**Symptom:** Master fikk read-only popup på Bingo (pos 1) som viste daglig akkumulert pott. Tobias forventet input-felt (per-bongfarge + draw) — men kun på Jackpot-katalog-spillet (pos 7), ikke på alle spill.
**Root cause:** Backend kastet `JACKPOT_CONFIRM_REQUIRED` ved start av ALLE spill for å bekrefte daglig pott bygd opp av cron (`jackpotDailyTick` +4000/dag, max 30 000). Mental modell var "auto-akkumulering + master bekrefter på hvert spill". Tobias' faktiske mental modell: "ingen akkumulering, master setter alt manuelt KUN på Jackpot-spillet."
**Fix:** ADR-0017 (`docs/adr/0017-remove-daily-jackpot-accumulation.md`, lander via PR #1154) fjerner daglig akkumulering helt. Cron-job deaktiveres, `JACKPOT_CONFIRM_REQUIRED`-error fjernes, `JackpotConfirmModal.ts` slettes. KUN `JACKPOT_SETUP_REQUIRED`-flow på `jackpot`-katalog-spillet (pos 7) beholdes — master setter blank input via `JackpotSetupModal`.
**Prevention:**
- Test mental-modell-antakelser med Tobias FØR større features bygges (særlig "smart auto"-funksjonalitet)
- Daglig akkumulering var bygd uten eksplisitt Tobias-direktiv om at det var ønsket — anti-mønster: implementer "smart auto-funksjonalitet" når brukerne forventer manuell kontroll
- Når en feature blokkerer master-flyt for ALLE spill (ikke bare det relevante), er det signal om feil scoping
- Frontend popup-visualisering avslører ofte mental-modell-feil — Tobias så popup på Bingo og forsto umiddelbart at modellen var feil
- ADR-0017 demonstrerer korrekt response: ny ADR som fjerner feilen, ikke patch på toppen
**Related:**
- ADR-0017 — fjerner daglig jackpot-akkumulering
- PR #1150 (introduserte `JackpotConfirmModal` som denne ADR-en fjerner)
- §7.6 (JackpotSetupModal eksisterte død i 3 dager) — beholdes; KUN `JackpotSetupModal` brukes på pos 7

---

## §8 Doc-disiplin

### §8.1 — BACKLOG.md går stale uten review

**Severity:** P1 (informasjons-divergens)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** K4 (BIN-823) markert ÅPEN selv om FIKSET 2026-05-08
**Fix:** Kvartalsvis sweep + agent-rutine for å oppdatere BACKLOG ved hver PR-merge
**Prevention:**
- PR-template krever "Oppdatert BACKLOG.md? Y/N"
- Hver agent-leveranse må sjekke om BACKLOG-entry påvirkes

### §8.2 — PM-handoff-historikk er kumulativ — les ALLE

**Severity:** P0 (kunnskapstap mellom sesjoner)
**Oppdaget:** Tobias-direktiv 2026-05-10 (PR #1134)
**Symptom:** Ny PM leser kun siste handoff → går i samme feller som tidligere PM-er har dokumentert
**Fix:** Les ALLE handoffs siden 2026-04-23 (~12-15 stk, 3-5 min hver)
**Prevention:**
- PM_ONBOARDING_PLAYBOOK §3 trinn 3 håndhever dette
- Anti-mønster: "Jeg leser bare den siste — den er state-of-the-art"

### §8.3 — ADR-er er IMMUTABLE etter merge

**Severity:** P1 (audit-integritet)
**Prevention:**
- Hvis beslutning overstyres: lag ny ADR med `Superseded by ADR-MMMM`
- Aldri redigér eksisterende ADR-tekst
- Hver kanonisk doc skal ha "Endringslogg"-seksjon for sporbarhet

### §8.4 — Konflikt: kode vs doc → DOC-EN VINNER

**Severity:** P0 (regel)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Prevention:**
- Hvis kode motsier doc: fix koden, oppdater doc samme PR
- Hvis du oppdager doc er feil: fix doc + entry her i fallgruve-loggen

### §8.5 — Tema-spesifikke audits leses basert på scope

**Severity:** P1 (kontekst-tap)
**Oppdaget:** PR #1134 (lese-disiplin-oppdatering)
**Prevention:**
- Wallet-scope → les `docs/compliance/` + wallet-audits
- Spill 1/2/3-scope → les `SPILL[1-3]_IMPLEMENTATION_STATUS_*` + `SPILL_REGLER_OG_PAYOUT.md` + `SPILLKATALOG.md`
- Pilot-go-live-scope → les `LIVE_ROOM_ROBUSTNESS_MANDATE_*` + `PILOT_*`-runbooks + `R[2-12]_*_TEST_RESULT*`
**Related:** [`PM_ONBOARDING_PLAYBOOK.md`](./PM_ONBOARDING_PLAYBOOK.md) §3.1

---

## §9 Konfigurasjon / Environment

### §9.1 — Tobias' `.env` pekte på ikke-eksisterende DB

**Severity:** P0 (login feilet med 500 INTERNAL_ERROR i timer)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** `tobiashaugen@localhost:5432/spillorama_local` finnes ikke på Tobias' Mac
**Fix:** Korrigert til Docker-Postgres `spillorama:spillorama@localhost:5432/spillorama`
**Prevention:**
- `.env.example` matcher Docker-Compose
- Backup `.env.backup-YYYY-MM-DD` ved endringer

### §9.2 — Migration timestamp-rekkefølge bug (MED-2)

**Severity:** P1 (migrations-blokker)
**Oppdaget:** 2026-05 fixet
**Symptom:** ALTER TABLE migration kjørt før CREATE TABLE-migration → feiler
**Fix:** ADR-0014 idempotent migrasjoner — `CREATE TABLE IF NOT EXISTS` før ALTER
**Prevention:**
- Forward-only-policy
- Test: kjør migration på fersk DB → må passere

### §9.3 — Renderdeploy auto-migrate via buildCommand

**Severity:** P1 (zero-downtime krav)
**Oppdaget:** Designet 2026-04
**Symptom:** Migrate kjørt etter app-start → mismatch i schema-state
**Fix:** `render.yaml.buildCommand` kjører `npm run migrate` FØR app-start
**Prevention:**
- Aldri legg `migrate` i `startCommand`
- Hvis migrate feiler → build aborts → forrige versjon kjører videre (no downtime)

### §9.4 — Master-hall-pin: kolonne + extra_json

**Severity:** P1 (per §3.6)
**Oppdaget:** 2026-05-09
**Prevention:** Set BÅDE kolonne OG extra_json ved seed/migration

---

## §10 Routing & Permissions

### §10.1 — Spillerklient bruker public lobby-endpoint

**Severity:** P1 (auth-confusion)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Game1Controller forsøkte hente fra `/api/agent/game1/lobby` (auth'd) → 401 fra spillerklient
**Fix:** Bruk `/api/games/spill1/lobby` (public, hallId-param)
**Prevention:**
- Public endpoints prefix `/api/games/...`
- Auth'd agent endpoints prefix `/api/agent/...`
- Sjekk OpenAPI for security-section

### §10.2 — Master-action-routes krever `GAME1_MASTER_WRITE`

**Severity:** P0 (RBAC-fail)
**Oppdaget:** Designet
**Prevention:**
- ADMIN, HALL_OPERATOR, AGENT har permission
- SUPPORT-rolle eksplisitt utelatt
- Hall-scope: HALL_OPERATOR/AGENT låst til egen hall via `resolveHallScopeFilter`

### §10.3 — Cron-jobs MÅ ha lock-mekanisme

**Severity:** P1 (race-conditions ved horizontal scaling)
**Oppdaget:** 2026-04
**Fix:** Redis-distributed lock på cron-jobs (`SCHEDULER_LOCK_PROVIDER=redis`)
**Prevention:**
- Aldri legg til cron uten lock — multi-instance vil duplikere

---

## §11 Agent-orkestrering

### §11.1 — PM-sentralisert git-flyt (ADR-0009)

**Severity:** P1 (workflow)
**Oppdaget:** 2026-04-21 etter accidental cross-agent-merge
**Prevention:**
- Agenter committer + pusher feature-branch — ALDRI åpne PR eller merge
- PM eier `gh pr create` + `gh pr merge --squash --auto --delete-branch`
- Agent-rapport-format: `Agent N — [scope]:` med branch, commits, test-status

### §11.2 — Skill-loading lazy per-task

**Severity:** P2 (performance)
**Oppdaget:** 2026-04-25 (memory: feedback_skill_loading.md)
**Prevention:**
- Last KUN skills når du selv skal redigere kode i det domenet
- Skip for ren PM/orkestrering eller delegert agent-arbeid
- Hver user-prompt får protokoll — alltid output decision FØR kode

### §11.3 — Parallelle agenter må eie ulike filer

**Severity:** P1 (merge-conflict)
**Oppdaget:** 2026-05-10 sesjon
**Prevention:**
- Eksempel trygg parallellisering:
  - Agent A: `apps/backend/scripts/`
  - Agent B: `BACKLOG.md`
  - Agent C: `docs/engineering/`
- Aldri spawne ≥2 agenter på samme fil eller samme branch

### §11.4 — Agent-prompt MÅ inkludere kjente fallgruver

**Severity:** P1 (kunnskapstap → repeterte feil)
**Oppdaget:** 2026-05-10 (Tobias-direktiv om dokumentasjon)
**Prevention:**
- Hver agent-prompt skal ha "Kjente fallgruver"-seksjon med pekere til relevante §-er i denne loggen
- Agent skal lese pekerne FØR start
- Etter levering: agent legger til nye fallgruver i samme PR

### §11.5 — Agent-leveranse må dokumenteres i AGENT_EXECUTION_LOG

**Severity:** P1 (kunnskapsbevaring)
**Oppdaget:** 2026-05-10 (denne sesjonen)
**Prevention:**
- Etter hver agent-leveranse: legg til entry i [AGENT_EXECUTION_LOG.md](./AGENT_EXECUTION_LOG.md)
- Format: dato, agent-type, scope, fallgruver oppdaget, learnings

### §11.6 — Test-engineer + implementer-pattern for fix-PR

**Severity:** P1 (workflow)
**Oppdaget:** 2026-05-10 (spillerklient normalize-fix vellykket)
**Prevention:**
- For bug-fix der ROOT-CAUSE ikke er åpenbar: spawn først `test-engineer`-agent
- Test-engineer leverer:
  - Regression-tester som låser kontrakten
  - Spec for pure-funksjon (signature + mapping-tabell)
  - Slut-rapport med "Anbefaling til implementer-agent"
- Implementer-agent (eller PM) porter spec til produksjons-kode
- Pattern brukt vellykket i PR #1149 (devUserAutoLoginRegression spec → 38 linjers fix)

### §11.7 — Komponent-uten-wireup er IKKE leveranse

**Severity:** P0 (illusjons-leveranse)
**Oppdaget:** 2026-05-10 (JackpotSetupModal lå død i 3 dager)
**Symptom:** Komponent commit'et + tester grønne, men aldri kalt fra produksjons-flyt → bug forblir
**Fix:** Wireup-PR må landes i SAMME bølge som komponent-PR — ellers er ikke leveransen ferdig
**Prevention:**
- DoD for komponent: "Kan jeg trigge denne fra UI uten devtools?"
- Hvis nei: leveranse er IKKE ferdig — wireup må inn i samme PR eller raskt-følge-PR
- PM-checklist: "Hver ny komponent → finn `import`-statement i prod-path"

---

## Hvordan legge til ny entry

```markdown
### §X.Y — Kort tittel som beskriver fallgruven

**Severity:** P0 / P1 / P2 / P3
**Oppdaget:** YYYY-MM-DD (kontekst, eks "PR #1234 review")
**Symptom:** Hva ser man når feilen treffer
**Root cause:** Hvorfor det skjer (teknisk, ikke "noe gikk galt")
**Fix:** Konkret hva som ble gjort (eller bør gjøres)
**Prevention:** Hvordan unngå at det skjer igjen
**Related:**
- Lenker til relevante PR-er, ADR-er, docs, file:line
```

**Plassering:** Velg riktig kategori-§. Hvis du ikke finner passende kategori, lag ny seksjon nederst og oppdater Indeks.

---

## Relaterte dokumenter

- [`PM_ONBOARDING_PLAYBOOK.md`](./PM_ONBOARDING_PLAYBOOK.md) — full PM-rutine, §3.2 peker hit
- [`AGENT_EXECUTION_LOG.md`](./AGENT_EXECUTION_LOG.md) — kronologisk agent-arbeid
- `AGENT_PROMPT_GUIDELINES.md` — mal for agent-prompts (TODO — fil ikke opprettet enda)
- [`ENGINEERING_WORKFLOW.md`](./ENGINEERING_WORKFLOW.md) — branch + PR + Done-policy
- [`docs/adr/`](../adr/) — Architecture Decision Records
- [`CLAUDE.md`](../../CLAUDE.md) — repo-root project conventions

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial — 63 entries fra 12 PM-handoffs + audits + sesjons-erfaringer | PM-AI (Claude Opus 4.7) |
| 2026-05-10 | Lagt til §7.8 (JackpotConfirmModal var feil mental modell — fjernet ADR-0017). Indeks-counts korrigert mot faktiske tall (§7=8, §11=7, total=71). | docs-agent (ADR-0017 PR-C) |
