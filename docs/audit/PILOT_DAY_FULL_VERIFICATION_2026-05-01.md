# Simulert pilot-dag — full verifisering 2026-05-01

**QA-agent:** Claude (Opus 4.7, 1M context)
**Test-vindu:** 2026-05-01 17:19 - 17:30 CET (~10 min via API)
**Test-mode:** REST API mot produksjon (`https://spillorama-system.onrender.com`)
**Mandat:** Eksplisitt fra Tobias — muter demo-data i prod
**Browser-tooling:** Chrome DevTools MCP blokkert (SingletonLock) — fall-back til API-testing

## Eksekutiv oppsummering

**Anbefaling: KAN IKKE starte pilot-dag i ekte hall i dag.**

Tre kritiske bugs blokkerer en realistisk pilot-dag selv etter at PR #799-#803 og fix-commit `48f70388` er på plass:

1. **🚨 KRITISK: `app_user_sessions`-tabell mangler i prod-DB.** Status-siden flagger `auth: outage — relation "app_user_sessions" does not exist`. Migration-drift som skulle ha blitt fanget av `npm run migrate` ved deploy. Påvirker REQ-132 active-sessions og potensielt audit-logging.

2. **🚨 KRITISK: Shift-flow har destruktiv ordering.** Hvis agent kaller `/shift/logout` (med "distribute winnings" + "transfer register tickets" checkbox-flagg) FØR `/shift/close-day`, blir shift-en avsluttet uten settlement-rapport — agenten kan ikke lenger filing settlement, og shift-en står som `isLoggedOut: true` med `settledAt: null`. Dette er regulatorisk uakseptabelt (hver shift må ha en Settlement Report per pengespillforskriften).

3. **🚨 KRITISK: AGENT-rolle har ikke `PHYSICAL_TICKET_WRITE` hall-scope.** `assertUserHallScope`-funksjonen i `apps/backend/src/platform/AdminAccessPolicy.ts:389-410` aksepterer kun `HALL_OPERATOR` (eller `ADMIN`/`SUPPORT`) — `AGENT` faller gjennom og får `FORBIDDEN — Du har ikke tilgang til denne hallen.` selv ved registrering i sin egen primary-hall. Bingoverten kan derfor IKKE registrere ticket-stack pre-game (Step 2 register-more/register-sold) gjennom `/api/admin/physical-tickets/ranges/register`. **Dette blokkerer hele pre-game ticket-registrering-flyten.**

I tillegg er det funnet 8 mindre/middels bugs (P1/P2). Detaljert nedenfor.

## Steg 1-8 resultat

| Steg | Område | Status | Detalj |
|---|---|---|---|
| 1 | Skift-start | 🟡 PASS m/ workaround | Måtte først seede 50000 NOK kontant til hall via admin (`POST /api/admin/halls/:id/add-money`) — pilot-haller har `cash_balance: 0` ved seeding. Etter seeding: `POST /shift/start` + `POST /shift/open-day {amount: 5000}` virker. |
| 2 | Pre-game tickets | ❌ BLOKKERT | (a) AGENT-rolle har ikke hall-scope-tilgang (P0). (b) Kun 3 ticket-farger i enum: `small`, `large`, `traffic-light` — ingen 11-color palette (yellow/white/purple/red/green/blue/small-green) som spes'd. (c) Ingen ticket-batches er forhåndsseedet — selv ADMIN får `TICKET_NOT_FOUND` ved scan av "100001". |
| 3 | Cash-flow + Unique ID | 🟡 DELVIS | Cash-in 200 NOK + cash-out 50 NOK fungerer (balance 500→700→650). **MEN: Create Unique ID returnerer alltid `INTERNAL_ERROR — "Uventet feil i server."`** (testet med både CASH/CARD og 24h/25h validity). Dette er et P0-pilot-blokker — Unique IDs er hovedmekanismen for walk-in-spillere uten konto. |
| 4 | Spill 1 game-flow | ❌ IKKE TESTBAR | Pilot-halls har ingen daily-schedule for **today** (2026-05-01) — kun for tomorrow (2026-05-02). Det er 2 BINGO-rooms som kjører i prod, men i `c4a191fc-...` og `demo-hall-999`, IKKE i pilot-haller. Ingen schedule = ingen game å starte. Mini-games + PAUSE/Check-for-Bingo + 5×5-grid kunne ikke verifiseres. |
| 5 | Sell Products | ❌ BLOKKERT | (a) `/api/agent/products` returnerer empty list — ingen produkter er seedet. (b) `/api/agent/products/categories` returnerer SPA HTML (route eksisterer ikke). (c) Cart-flow validerer korrekt men kan ikke utføres uten produkter. |
| 6 | Physical Cashout | 🟡 DELVIS | Lese-endepunkter virker: `/shift/physical-cashouts` returnerer cash-out-historikk (50-NOK cash-out vist), `/summary` aggregerer korrekt. Reward-All-flyten kunne ikke testes uten existing physical-tickets med winning-patterns. |
| 7 | Settlement | ✅ PASS | `POST /shift/control-daily-balance` med reportedDailyBalance=5150 — `severity: OK, diff: 0`. `POST /shift/close-day` med full machine-breakdown (Metronia/OK Bingo/Franco/Otium IN/OUT/Sum + Norsk Tipping/Rikstoto + Rekvisita + Servering + Bilag + Bank + Gevinst overført + Annet + Drop-safe) skapte gyldig `AgentSettlement` med `dailyBalanceDifference: 0`. Wireframe-paritet OK. |
| 8 | Shift Log Out | 🚨 KRITISK BUG | Tre forskjellige shift-end-endepunkter med ulik oppførsel (`/shift/end`, `/shift/logout`, `/shift/close-day`) — ingen koordinering mellom dem. Wireframe-checkbox-flagg ("distributeWinnings", "transferRegisterTickets", "logoutNotes") fungerer KUN på `/shift/logout`, men kall til `/shift/logout` AVSLUTTER shift-en uten settlement, slik at `/shift/close-day` ikke kan kalles etterpå (`NO_ACTIVE_SHIFT`). Reverse-rekkefølge (close-day først) avslutter også shift, så `/shift/logout` returnerer `NO_ACTIVE_SHIFT`. **Det finnes ingen sti der både settlement OG checkbox-flagg blir registrert.** |

## Bonus

| Test | Status | Detalj |
|---|---|---|
| Multi-hall — agent-2 åpner shift i hall-002 | ✅ PASS | Demo-agent-2 har 4 hall-tilordninger; kunne åpne shift i primary (demo-hall-002) uavhengig av agent-1's shift. |
| TV-state API | ✅ PASS | `GET /api/tv/demo-hall-001/<token>/state` returnerer hall-info + 5 patterns (Row 1-4 + Full House). `currentGame: null` korrekt siden ingen Game 1 kjører i hallen. |
| `transferHallAccess` 60s handshake | ⏭️ IKKE TESTET | Krever 2+ samtidige aktive Game 1-runder + master-hall-bytte; ikke realistisk uten seedede daily-schedules. |

## Pilot-blokkere (P0/Kritisk)

### P0-1 🚨 `app_user_sessions` mangler i prod-DB
**Severity:** Regulatorisk + sikkerhet
**Bekreftet via:** `GET /api/status` rapporterer `auth: outage — relation "app_user_sessions" does not exist`, samtidig som login fortsatt virker (sessions ligger et annet sted).
**Konsekvens:** REQ-132 active-sessions-listing er broken. Mulig stille svikt i audit-logging.
**Fix:** Sjekk migration-historikk i prod, kjør manglende migration. Validér at `apps/backend/run migrate` faktisk kjører ved deploy (render.yaml claim).
**Påvirker pilot:** Ja — Lotteritilsynet kan stille spørsmål ved at status-siden viser "outage" på pilot-dag.

### P0-2 🚨 Shift-flow destruktiv ordering (settlement vs logout-checkboxes)
**Severity:** Regulatorisk
**Bekreftet via:** API-test sekvens 17:27:25-17:27:26 CET. `POST /shift/start → /open-day {1000} → /shift/logout {distributeWinnings:true, transferRegisterTickets:true}` ➜ shift `endedAt: <ts>, isLoggedOut: true, settledAt: null, distributedWinnings: true`. `POST /shift/close-day` deretter ➜ `NO_ACTIVE_SHIFT`.
**Konsekvens:** Shift kan termineres uten Settlement Report. Pengespillforskriften krever en Settlement Report per shift (Lotteritilsynet-revisjon).
**Fix-anbefaling:** Enten (a) `/shift/logout` skal kreve at settlement er filed først (returner `SETTLEMENT_REQUIRED`), eller (b) merge `close-day` + `logout` til én atomisk operasjon der checkbox-flagg passes som body til `close-day`. Wireframe 17.6 (Shift Log Out)-popup forventer at både settlement og checkboxes er én flow.
**Påvirker pilot:** Ja — UI kan trigge logout før settlement er gjort, og da er shift ugjenopprettelig terminert uten regnskap.

### P0-3 🚨 AGENT mangler hall-scope-tilgang for register-ticket-ranges
**Severity:** Pilot-blokker (operasjonell)
**Bekreftet via:** demo-agent-1 (`role: AGENT`, `hallId: demo-hall-001`, primary-hall) kaller `POST /api/admin/physical-tickets/ranges/register` med `agentId: demo-agent-1, hallId: demo-hall-001` ➜ `FORBIDDEN — Du har ikke tilgang til denne hallen.` Samme call som ADMIN passerer auth.
**Root-cause:** `assertUserHallScope` i `apps/backend/src/platform/AdminAccessPolicy.ts:389-410` aksepterer kun `HALL_OPERATOR`. Den behandler `AGENT` som "ikke en hall-scope-rolle" og kaster FORBIDDEN.
**Konsekvens:** Bingoverten kan ikke registrere ticket-stack pre-game. Hele Step 2 (Register More Tickets / Register Sold Tickets) er blokkert.
**Fix:** Legg til `AGENT` som gyldig hall-scope-rolle i `assertUserHallScope`, gitt at AGENT-tilordnelse til hall (`app_agent_halls` via `agentService.assertHallMembership`) brukes for verifisering. Alternativt: lag en agent-spesifikk variant av endepunktet under `/api/agent/physical-tickets/ranges/register`.
**Påvirker pilot:** Ja — kjernet i hverdagsdrift.

### P0-4 🚨 Create Unique ID kaster INTERNAL_ERROR konsistent
**Severity:** Pilot-blokker (Customer Unique ID = walk-in prepaid-kort)
**Bekreftet via:** 3x forsøk med ulike kombinasjoner (`{amount: 200, paymentType: "CASH", hours: 24}`, `{amount: 100, "CARD", 24}`, `{amount: 50, "CASH", 25}`) — alle returnerte `INTERNAL_ERROR — "Uventet feil i server."`
**Andre Unique-ID-endepunkter virker:** `GET /api/agent/unique-ids?hallId=demo-hall-001` returnerer `{cards: [], count: 0}` (table eksisterer). Crash er i INSERT/transaction-path.
**Mistanke:** Kan være en CHECK constraint-feil (`balance_cents >= 0` med `NUMERIC(14,2)` ved 200), `DEFAULT now()`-feil, eller manglende `previous_balance` i `INSERT INTO app_unique_id_transactions`. Se SQL i `apps/backend/src/agent/UniqueIdStore.ts:251` (`INSERT app_unique_ids`) + `:330` (`INSERT app_unique_id_transactions`).
**Fix:** Reproduser lokalt mot prod-schema-snapshot. Sjekk Render-logs for stack-trace.
**Påvirker pilot:** Ja — Unique IDs er hovedflyt for walk-in-spillere uten konto.

## Mindre bugs (P1/P2)

### P1-1: Pilot-halls har `cash_balance: 0` ved seeding
**Lokasjon:** demo-pilot-day seed
**Konsekvens:** Agent kan ikke åpne dagen før admin manuelt seeder kontant via `add-money`. På realistisk pilot-dag vil dette være OK (admin gjør det én gang), men bør være med i seed-script.

### P1-2: 11-color ticket-palette mangler i `StaticTicketColor` enum
**Lokasjon:** `apps/backend/src/compliance/StaticTicketService.ts:38-40`, `apps/backend/src/routes/adminAgentTicketRanges.ts:55-59`
**Status:** Kun `small`, `large`, `traffic-light` støttes. MASTER_PLAN_SPILL1_PILOT §10 hevder "P0 2.7 Ticket-farger 11-palette ✅" men det er ikke sant. Frontend-gransking i `apps/admin-web/src/pages/agent-portal/` viste heller ingen 11-color UI.
**Konsekvens:** Wireframe 17.13 (Register More Tickets med 6+ farger) kan ikke implementeres.

### P1-3: Pilot daily-schedules seedet for 2026-05-02 (i morgen), ikke i dag
**Lokasjon:** demo-pilot-day seed
**Konsekvens:** Step 4 (Spill 1 game-flow) kan ikke testes på "dagen i dag". Ved en faktisk pilot-dag må admin enten manuelt opprette today's schedule eller la cron fortløpe.

### P1-4: Ingen produkter seedet for Sell Products
**Lokasjon:** demo-pilot-day seed
**Konsekvens:** Step 5 kan ikke testes. Wireframe 17.12 (Sell Products med Coffee/Chocolate/Rice) helt blokkert.

### P1-5: `/api/agent/products/categories` mangler (route returnerer SPA HTML)
**Lokasjon:** `apps/backend/src/routes/agentProducts.ts`
**Konsekvens:** UI som forventer kategorisert produktlisting feiler.

### P1-6: `/api/admin/game1/games` (list) mangler
**Lokasjon:** `apps/backend/src/routes/adminGame1Master.ts`
**Konsekvens:** Kun `GET /api/admin/game1/games/:gameId` finnes. Admin har ingen måte å liste pågående/upcoming spill via API.

### P2-1: Tre konkurrerende shift-end-endepunkter
**Endepunkter:** `/shift/end` (no body), `/shift/logout` (checkbox-flagg), `/shift/close-day` (settlement). Ingen er klart "primary" og UI-koden må vite hvilket å kalle i hvilken rekkefølge. Konsoliderer ikke godt.
**Anbefaling:** Pensjonér `/shift/end` (er overflødig). Lag `/shift/close-day` til den eneste vei å avslutte en shift, og la den ta checkbox-flagg som body. Audit-spor blir også enklere.

### P2-2: TV-tokens og hall-tokens i URL-stien (svært lange UUIDs)
**Lokasjon:** `/api/tv/:hallId/:tvToken/state`
**Bemerkning:** Fungerer som spes'd. UUIDs i URL-stien er OK her men gjør URL-en mindre lesbar i logger.

## Detaljerte test-loggdata

### Demo-agent-1 (kompromittert agent — bryt-i-shift via close-day først, så shift-2 logout uten settlement)

```
17:19:39 POST /shift/start (demo-hall-001) → shift-9e7a722c-...
17:19:39 POST /shift/open-day {amount: 5000} → INSUFFICIENT_HALL_CASH
17:20:25 POST (admin) /admin/halls/demo-hall-001/add-money {amount: 50000}
17:20:31 POST /shift/open-day {amount: 5000} → OK, hallCashBalanceAfter: 45000
17:22:09 POST /agent/players/demo-pilot-spiller-1/cash-in {amount: 200, CASH} → 500→700
17:22:14 POST /agent/players/demo-pilot-spiller-1/cash-out {amount: 50, CASH} → 700→650
17:22:?? POST /agent/unique-ids {200, CASH, 24h} → INTERNAL_ERROR
17:22:?? POST /agent/unique-ids {100, CARD, 24h} → INTERNAL_ERROR
17:22:?? POST /agent/unique-ids {50, CASH, 25h} → INTERNAL_ERROR
17:26:11 POST /shift/control-daily-balance {5150, 5150} → severity: OK, diff: 0
17:26:21 POST /shift/close-day {full machine-breakdown} → settlement-2efd6b7a-... OK
17:??:?? POST /shift/end → NO_ACTIVE_SHIFT (already ended via close-day)

Shift-2 (demo-agent-1):
17:27:25 POST /shift/start (demo-hall-001) → shift-b791d59e-...
17:27:25 POST /shift/open-day {amount: 1000} → OK, hallCashBalanceAfter: 49150
17:27:26 POST /shift/logout {distributeWinnings: true, transferRegisterTickets: true, logoutNotes}
         → OK shift ended med isLoggedOut: true, distributedWinnings: true, settledAt: null
17:??:?? POST /shift/close-day {1000} → NO_ACTIVE_SHIFT — kan ikke filing settlement

Demo-agent-2 (multi-hall test):
17:27:52 POST /shift/start (demo-hall-002) → shift-75861e89-... OK
17:28:17 POST /shift/end → OK, ended cleanly (no settlement attempted)
```

### Hall-cash forbruk
- Start: 0 NOK
- Etter admin add-money (50000): 50000 NOK
- Etter open-day (5000): 45000 NOK
- Etter open-day shift-2 (1000): 49150 NOK (hvor kom 4150 fra? ⚠️ verifiser hall-cash-recon — sannsynligvis settlement transferTx tilbake)

## Anbefaling

**KAN IKKE starte pilot-dag i ekte hall fordi:**

1. `app_user_sessions`-tabellen mangler i prod (status-side viser auth: outage). Selv om login virker, er noe broken i auth-laget. Lotteritilsynet kan stille spørsmål.

2. AGENT-rolle har ikke fysisk-ticket hall-scope. Bingoverten kan ikke registrere bonger pre-game — kjernet i hverdagsdrift er blokkert.

3. Create Unique ID kraser konsistent. Walk-in-spillere uten konto kan ikke kjøpe prepaid-kort.

4. Shift-flow har destruktiv ordering — agent kan termineres ut av shift uten settlement-rapport, brudd på regulatorisk sporbarhet.

**Andre forhold som krever workaround/seed på pilot-dagen:**
- Hall-kontant må seedes via `/admin/halls/:id/add-money` (ikke automatisk).
- Daily-schedule for "i dag" må opprettes manuelt eller cron må vekke (seed har kun morgendag).
- Produkter for kiosk må seedes (Coffee, etc.) for Step 5.
- 11-color ticket-palette må implementeres for å nå wireframe-paritet.

**Estimert dev-tid for å fjerne P0-blokkere:** 1-2 dev-dager.

- P0-1 (`app_user_sessions`): 1-2 timer (kjør manglende migration, verifiser).
- P0-2 (shift-flow): 2-4 timer (rydd opp `/shift/end` vs `/shift/logout` vs `/shift/close-day`; gjør én atomisk endpoint).
- P0-3 (AGENT hall-scope): 1-2 timer (utvid `assertUserHallScope` til AGENT, eller separat endpoint).
- P0-4 (Unique ID INTERNAL_ERROR): 2-4 timer (root-cause via Render-logs).

Etter at disse er fikset må alle 8 stegene re-testes — Steg 4 (Game 1-flow) er **fortsatt ikke testet** og må verifiseres med live game før pilot.

## Vedlegg: Browser-tooling

Chrome DevTools MCP profilen var låst (SingletonLock + aktiv Chrome-prosess PID 64215). Da forrige QA-rapport BUG_WALKTHROUGH_2026-05-01_VERIFY.md ble skrevet brukte agenten Playwright direkte. For denne rapporten falt jeg tilbake til API-testing via curl, som er **bedre egnet for å verifisere backend-bugs** men kan ikke verifisere UI-rendering, F1/F2-hotkeys, modal-popups, eller TV-rendering.

**Anbefaling:** Tobias bør stenge Chrome-instans og kjøre Playwright direkte for UI-verifisering av Step 2 (Register-More-modal med F2 hotkey + 11-fargers UI), Step 4 (5×5-grid + mini-game-overlay), Step 5 (Sell Products-cart), Step 8 (Shift Log Out-popup med checkboxer).

## Test-data status

Følgende demo-data ble mutert under denne QA-runden:

- `demo-hall-001.cashBalance`: 0 → 49150 NOK (etter shift-1 close-day og shift-2 åpning).
- 2 fullførte demo-agent-1 shifts: `shift-9e7a722c-...` (med settlement) og `shift-b791d59e-...` (uten settlement, terminert).
- 1 fullført demo-agent-2 shift: `shift-75861e89-...` (uten settlement).
- 1 settlement-record: `sett-2efd6b7a-578a-4fb0-bb2f-2deb3a29c900`.
- `demo-pilot-spiller-1.balance`: 500 → 650 NOK (cash-in 200, cash-out 50).
- 2 audit-tx: `agenttx-0be26565-...` (cash-in), `agenttx-0afb73f0-...` (cash-out).
- 1 hall-cash-tx: `hcashtx-114628b2-...` (admin add-money 50000).
- 2 transferTx for shift open-day: `hcashtx-f87948e3-...` (5000 til shift-1), `hcashtx-756e7d2c-...` (1000 til shift-2).

**Cleanup-anbefaling før neste pilot-test:** Reset demo-state via re-seed eller manuelt rulle tilbake settlements/shifts som ble opprettet av denne kjøringen.
