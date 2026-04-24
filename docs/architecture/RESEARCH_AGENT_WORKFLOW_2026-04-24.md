# Research: Agent Workflow — 2026-04-24

**Forfatter:** Agent R2 (research-oppdrag)
**Branch:** `docs/research-agent-workflow`
**Dato:** 2026-04-24
**Scope:** En komplett agent/bingovert-dag i bingolokalet — fra skift-start til
stengning. Legacy (commit 9c0f3b33^ før slett) vs. ny stack (main).

---

## TL;DR

**En bingovert kan IKKE drive en full dag i ny stack per 2026-04-24.**
Status er **delvis** — alle regulatoriske kjernekonsepter (shift,
daily-balance, physical-tickets, products, settlement) er implementert på
backend-API-nivå, men mange agent-portal-sider er fortsatt placeholder
("Kommer snart"), noen sentrale legacy-flyter er utelatt, og ticket-farger
er redusert fra 6+ til 3 familier. Listen over harde pilot-blokkere er
nedenfor.

**Tallstatus (endepunkter og sider):**
- Backend agent-endepunkter: **ca. 70 endepunkter** implementert og wired
  i `apps/backend/src/index.ts` (agent.ts, agentBingo.ts, agentContext.ts,
  agentDashboard.ts, agentMetronia.ts, agentOkBingo.ts, agentOpenDay.ts,
  agentProducts.ts, agentSettlement.ts, agentTransactions.ts +
  adminAgentTicketRanges.ts).
- Agent-portal UI (ny subtree `/agent/*` i admin-web): **2 fulle
  implementasjoner** (AgentCheckForBingoPage, AgentPhysicalCashoutPage),
  **4 placeholders** (AgentPhysicalTickets, AgentCashInOut, AgentUniqueId,
  AgentPortalPlaceholder), **1 halvfull** (AgentDashboardPage med dummy-
  data), **1 komplett live** (NextGamePanel/AgentGamesPage), **1 komplett
  live** (AgentPlayersPage — kun listing + CSV-export).
- Agent-portal UI (legacy-stil under `/agent/cashinout` etc. — BIN-613):
  **8 live sider** (CashInOutPage, BalancePage, ProductCartPage,
  PhysicalCashoutPage, CashoutDetailsPage, SellTicketPage, SoldTicketsPage
  + 3 modals incl. SettlementModal). Disse er IKKE i agent-sidebar, men er
  referanse-portering.

**Arkitekturell gap-risiko:**
Agent-portal-skjelettet under `/agent/dashboard`, `/agent/physical-tickets`,
`/agent/cash-in-out`, `/agent/unique-id` (sidebarSpec.ts linje 276–312) er
placeholder. De komplette legacy-portede sidene under `/agent/cashinout`
(BIN-613, under `apps/admin-web/src/pages/cash-inout/`) er ikke koblet til
sidebar-navigasjonen. **Det er to parallelle agent-UI-skjeletter som ikke
er bundet sammen.** Dette er i praksis pilot-blokker #1 for wiring.

---

## Lese-strategi brukt

Legacy er slettet fra main (commit `9c0f3b33 chore(legacy): slett
legacy/unity-backend/`). Alle legacy-refs i rapporten er hentet via
`git show 9c0f3b33^:legacy/unity-backend/App/...`.

**Legacy-filer lest:**
- `legacy/unity-backend/App/Controllers/AgentController.js` (2711 linjer)
- `legacy/unity-backend/App/Controllers/CashInOutController.js` (555)
- `legacy/unity-backend/App/Controllers/UniqueIdController.js` (1827)
- `legacy/unity-backend/App/Controllers/agentcashinoutController.js` (6504)
- `legacy/unity-backend/App/Controllers/productManagement.js` (952)
- `legacy/unity-backend/App/Controllers/physicalTicketsController.js` (2657)
- `legacy/unity-backend/App/Controllers/machineApiController.js` (2978)
- `legacy/unity-backend/App/Controllers/scheduleController.js` (6119)
- `legacy/unity-backend/App/Controllers/subGameController.js` (517)
- `legacy/unity-backend/App/Controllers/patternController.js` (972)
- Alle `Models/*.js` relatert til agent/shift/settlement/ticket/product

**Ny-stack-filer lest:** alle `apps/backend/src/routes/agent*.ts` +
`adminAgent*.ts` + alle `apps/backend/src/agent/*.ts` + alle
`apps/admin-web/src/pages/agent-portal/*.ts` + agent-dashboard + agent-
players + cash-inout-pages + sidebarSpec.ts.

---

## 1. Skift-start (åpning)

### 1.1 Logg inn som agent

**Legacy** (`AgentController.js`):
- Innlogging via generisk `/login` mot `agent`-collection. Session-data
  i `req.session.details` med `id, role, hall, shiftId, language,
  isPermission` etc.
- **IP-basert hall-utledning** i `UniqueIdController.addUniqueId`
  (linje 634–647): `hall = getSingleHall({ ip: ipAddress, status:
  "active", agents: { $not: {$size: 0} } })`.

**Ny** (`apps/backend/src/routes/agent.ts`):
- `POST /api/agent/auth/login` — bruker `PlatformService.login` og
  rejekter hvis `role !== AGENT`. Returnerer `session.accessToken +
  agent`-profil. Audit-logging via `AuditLogService`.
- `GET /api/agent/auth/me`, `PUT /api/agent/auth/me` (self-service-
  whitelist: displayName, email, phone — ikke role/hallIds/status),
  `POST /api/agent/auth/change-password`, `change-avatar`,
  `update-language`.
- Fail-closed: `agentService.requireActiveAgent(user.id)` på hver
  agent-request for å avvise deaktivert agent.

**Delta:**
- ✅ Login + profil + password-endring er komplett i ny stack.
- ❌ **Ingen IP-til-hall-mapping.** Ny stack bruker agentens shift-
  assignment (`shift.hallId`) som hall-scope. Dette er strengere men
  forutsetter at agenten først åpner shift med valgt hall. Legacy
  kunne utlede hall fra terminalens IP uten eksplisitt skift-åpning.
- ❌ **Ingen MAC/IP-terminal-binding** for "denne iPad'en tilhører
  hall X". Se Del 7 for dypere gap.

### 1.2 Åpne skift (shift_start)

**Legacy** (`agentcashinoutController.js` + `agentShift`-model):
- Shift-modell har felter: `hallId, agentId, startTime, endTime,
  dailyBalance, totalDailyBalanceIn, totalCashIn, totalCashOut,
  totalCardIn/Out, hallCashBalance, hallDropsafeBalance,
  dailyDifference, controlDailyBalance, settlement, previousSettlement,
  isActive, isLogOut, isDailyBalanceTransferred`.
- Åpning: via `addDailyBalance` (linje 11–99) som tar `amount +
  paymentType` og oppretter tx + oppdaterer `agentShift` + `hall` +
  `hallCashSafeTransaction`.

**Ny** (`apps/backend/src/routes/agent.ts` + `agentOpenDay.ts`):
- `POST /api/agent/shift/start` — starter shift med `hallId`.
  `AgentShiftService.startShift` sjekker at hallId er i agentens
  assigned halls.
- `POST /api/agent/shift/open-day` — legger `amount` som starting cash,
  oppretter ledger-tx i `HallCashLedger`, oppdaterer shift-
  `dailyBalance`.
- `GET /api/agent/shift/current` — henter aktiv shift.
- `GET /api/agent/shift/daily-balance` — henter snapshot (dailyBalance,
  hallCashBalanceAfter, cashIn/Out totals).
- `POST /api/agent/shift/end` — avslutt aktiv shift (owner-check:
  AGENT kan kun avslutte egen, ADMIN kan force-close).
- `GET /api/agent/shift/history` — paginert shift-logg.

**Delta:**
- ✅ Skift-start er **fullstendig implementert på backend**. Dobbel-
  split i start (shift med hall-assignment) + open-day (starting cash)
  matcher legacy-konsept.
- ❌ **`hallDropsafeBalance` er ikke eksplisitt modellert.** Legacy
  hadde dedikert felt; ny stack har kun `cash_balance` i hallen og
  tracking via `HallCashLedger.txType='MANUAL_ADJUSTMENT'`.
- ❌ **Ingen agent-portal-UI for å åpne shift fra `/agent/*`-ruter.**
  Modal-trigger er implementert i legacy-portede `CashInOutPage.ts`
  (linje 53, "Add Daily Balance"-knapp), men denne siden er ikke i
  agent-sidebar — agenten har ingen synlig vei til den.

### 1.3 Hall-status → aktiv + hente dagens spill

**Legacy:** `scheduleController.js` gir `dailySchedule.otherData.closeDay`
plus status-bits. Ingen eksplisitt "hall aktiv"-state.

**Ny** (`apps/backend/src/routes/game.ts` linje 180):
- `GET /api/halls/:hallId/schedule` er public + filtrert per
  `dayOfWeek`.
- `GET /api/admin/daily-schedules` (adminDailySchedules.ts) — ADMIN
  bare.
- `POST /api/admin/rooms/:code/room-ready` broadcaster 2-min count-
  down (brukt av NextGamePanel, men endepunktet krever ADMIN-
  permission).

**Delta:**
- ⚠️ **Agent kan lese spilleplan via public-endepunktet**, men har
  INGEN skrivende agent-schedule-endepunkt. Alle skjema-edits er
  admin-only. For pilot er dette OK (schedules eies av PM/admin).
- ❌ **"Hall Ready/Not Ready per agent"-signalering er ikke
  implementert.** Legacy hadde `agentcashinoutController.
  hallsStatusForGame` + `setHallStausWithColorCode` som rapporterte
  per-agent ready-state for Start Next Game. Ny stack har kun én
  aggregert `selfReady` i NextGamePanel.ts (pilot-MVP, én agent per
  hall — `NextGamePanel.ts` linje 64 + kommentar linje 16–18).

---

## 2. Bong-salg (fysisk billett-salg)

### 2.1 Ticket-farger

**Legacy:** 6+ farger støttet via `staticTicket.ticketColor`:
Small Yellow, Small White, Small Purple, Small Red (traffic-light),
Small Green, Small Blue + Large varianter + Mystery. Ticket-type
gruppert som `traffic-light` (linje 146, 148 i
physicalTicketsController.js).

**Ny** (`apps/backend/src/compliance/StaticTicketService.ts` linje 38):
```ts
export type StaticTicketColor = "small" | "large" | "traffic-light";
```
Kun **3 farge-familier**. Underklasser (yellow/white/purple etc.)
blir normalisert bort i `deriveColorFamily` (linje 133).

**Delta:**
- ❌ **Fargemappingen er ikke 1:1.** Legacy Wireframe V1.0 (PDF 15)
  §15.10 "Register More Tickets Modal" viser seks forskjellige rader:
  Small Yellow, Small White, Small Purple, Large Yellow, Large White,
  Large Purple med separate Initial/Final-ranges.
- **Vurdering:** Dette er et bevisst valg per `StaticTicketService.ts`
  — batch-import lagrer detaljert color i DB-feltet, men backend-
  aggregat og range-serie-logikk kollapser til 3 familier. Avklar
  om pilot-haller krever full 6-farge-paritet i UI eller om 3 er OK.

### 2.2 Register More Tickets (før runden)

**Legacy** (`physicalTicketsController.addPhysicalTicketsPost` linje
659): Agent scanner barcode → system oppretter ranges per ticket-
farge. Støtte for:
- `allRange[{ ticketColor, initialId, finalId, ticketsAvailableFrom,
  ticketIds, lastUpdatedDate }]` lagret på `agentRegisteredTicket`.
- "Auto-generate IDs" med F2-hotkey og auto-increment.
- Stash-listing via `getPhysicalTickets` — hva som er i hall, ikke
  solgt ennå.

**Ny** (`apps/backend/src/routes/adminAgentTicketRanges.ts`):
- `POST /api/admin/physical-tickets/ranges/register` — agent (eller
  ADMIN on-behalf) registrerer range med `firstScannedSerial + count`
  → service allokerer serienumre i `AgentTicketRangeService`.
- `POST /api/admin/physical-tickets/ranges/:id/extend` (PT5) —
  range-påfylling.
- `POST /api/admin/physical-tickets/ranges/:id/handover` (PT5) —
  overføring til ny bingovert.
- `GET /api/admin/physical-tickets/ranges?agentId=&hallId=` —
  aktive ranges.

**Delta:**
- ✅ Backend for range-registrering er komplett (PT2+PT3+PT5 spec).
- ❌ **Endepunktene er under `/api/admin/`-namespace**, ikke
  `/api/agent/`. HALL_OPERATOR kan bruke dem med `PHYSICAL_TICKET_
  WRITE`-permission. AGENT kan registrere egen range (authz gating
  linje 207–216), men å ha admin-URL er forvirrende for en agent-
  portal og gjør det tyngre å lage agent-portal-client for dem.
- ❌ **Agent-portal UI-side `/agent/physical-tickets`** (AgentPhysical
  TicketsPage.ts) er **placeholder "Kommer snart"**. Ingen scan-knapp,
  ingen F2-hotkey, ingen ticket-farge-grid.

### 2.3 Register Sold Tickets (per runde)

**Legacy** (`physicalTicketsController.purchasePhysicalTickets` linje
1676–2000): Agent scanner Final ID per runde → system regner ut
carry-forward (resterende i stativet går videre til neste runde) +
knytter tickets til `scheduled_game_id` + `sub_game_id`.

**Ny** (`apps/backend/src/routes/adminAgentTicketRanges.ts` linje 361):
- `POST /api/admin/physical-tickets/ranges/:id/record-batch-sale`
  med `newTopSerial + scheduledGameId` → service regner ut solgte
  serienumre mellom `previousTopSerial` og `newTopSerial`.
- `SCHEDULED_GAME_NOT_JOINABLE` + `SCHEDULED_GAME_HALL_MISMATCH`-
  validering håndheves.

**Delta:**
- ✅ Backend er komplett og matcher legacy-flyt.
- ❌ **Agent-portal UI for Register Sold Tickets er ikke
  implementert.** Er placeholder.

### 2.4 Add Physical Ticket (enkelt-salg)

**Legacy:** Agent scanner Final ID + velger CASH/CARD + print receipt.

**Ny** (`apps/backend/src/routes/agentTransactions.ts`):
- `POST /api/agent/physical/sell` — sell 1 ticket mot `playerUserId +
  ticketUniqueId + paymentMethod` (CASH/CARD/WALLET) med client-
  request-id-idempotens.
- `POST /api/agent/physical/sell/cancel` — counter-tx innen 10-min.

**Delta:**
- ✅ Backend komplett.
- ❌ **Ingen receipt-printing.** Legacy støttet `print`-action i UI.
  Ny stack har kun tx-data. Terminal-print-integrasjon mangler.

### 2.5 Lagring

**Legacy DB-tabeller:** `agentRegisteredTicket`, `agentSellPhysicalTicket`,
`staticPhysicalTicket`, `staticTicket`.

**Ny DB-tabeller (migrations 20260418xxx):**
- `app_agent_ticket_ranges` — active ranges per agent/hall/color
  (fra adminAgentTicketRanges.ts kommentarer).
- `app_physical_tickets` — ticket-level data (fra B4a spec).
- `app_agent_transactions` — tx-log.

**Delta:** Data-modellen er omorganisert men semantisk ekvivalent.
Backend-level paritet er OK.

---

## 3. Kasse-operasjoner

### 3.1 Cash In (under skift)

**Legacy** (`agentcashinoutController.registerUserAddBalanceView +
updateRegisterUserBalance` linje 143–724): Agent søker bruker →
skriver inn beløp → velger betaling → wallet oppdateres.

**Ny** (`apps/backend/src/routes/agentTransactions.ts`):
- `POST /api/agent/players/lookup` — søk spiller i hall.
- `GET /api/agent/players/:id/balance` — wallet-balance.
- `POST /api/agent/players/:id/cash-in` — CASH/CARD med
  `clientRequestId`-idempotens.

**Delta:**
- ✅ Backend komplett.
- ✅ UI-side `BalancePage.ts` (cash-inout-trees) — fungerer men er
  under `/agent/cashinout`-ruten, ikke i ny `/agent/*`-sidebar.

### 3.2 Cash Out (utbetaling)

**Legacy** (`agentcashinoutController.updateRegisterUserBalance
withdraw`-gren). Full sjekk mot wallet-balance + tx-log.

**Ny:**
- `POST /api/agent/players/:id/cash-out` — CASH/CARD (ikke WALLET-
  target, selvsagt).

**Delta:**
- ✅ Backend komplett.
- ⚠️ **Ingen eksplisitt "verifiser ticket før cashout"-gate.** Agent
  må manuelt bruke `/api/agent/bingo/check` først.

### 3.3 Unique ID (medlemskort)

**Legacy** (`UniqueIdController.js`): Opprett ny Unique ID med:
- Auto-generert ID
- Purchase date + 24h+ expiry (Wireframe V1.0 §11.3 "Hours Validity
  (e.g., '24 hours')")
- Balance + Payment Type (CASH/CARD)
- PRINT receipt
- Transaksjons-historikk per Unique ID
- `addUniqueId` linje 624+ har hele flyten.

**Ny:**
- **IKKE IMPLEMENTERT.** Det nye `uniqueId`-konseptet i
  `physical_ticket.uniqueId` er en engangs-physical-ticket-ID, ikke
  et customer-prepaid-kort med balance + expiry.
- `adminUniqueIdsAndPayouts.ts` gir kun listing av
  physical-ticket-unique-ids + payout drill-down.
- Ingen `createCustomerUniqueId`-funksjon, ingen `uniqueIdExpiry`-
  felt, ingen "Add Money to Unique ID"-tx-type, ingen `hoursValidity`.

**Delta:**
- ❌❌❌ **STOR GAP.** Hele "Unique ID som customer-prepaid-kort"-
  konseptet (Wireframe V1.0 §11.2, §11.3, §13.3) mangler. Dette er
  en pilot-blokker for haller som har faste medlemmer som kjøper et
  kort med balance og bruker det over flere runder uten separat
  login.
- `apps/admin-web/src/pages/agent-portal/AgentUniqueIdPage.ts` er
  placeholder.

### 3.4 Transaksjonshistorikk per Unique ID

**Legacy** (`UniqueIdController.viewSpaceficTicketDetails` linje 1177):
Full transaksjons-liste per Unique ID med type + amount + date.

**Ny:** Se 3.3 — mangler helt siden customer-Unique-ID ikke finnes.

---

## 4. Produkt-salg (kaffe, rekvisita)

### 4.1 Produkt-katalog per hall

**Legacy** (`productManagement.js` + `product` + `productCart`-modeller):
Globalt `product`-collection + hall-assignment via
`updateProductinHall`.

**Ny** (`apps/backend/src/routes/adminProducts.ts`):
- Global products + categories CRUD under `/api/admin/products` +
  `/api/admin/product-categories`.
- `GET/PUT /api/admin/halls/:hallId/products` — hall-binding.
- HALL_OPERATOR kan lese/skrive egen hall.

**Delta:** ✅ Komplett og matcher legacy-modell.

### 4.2 Agent POS (cart + betaling)

**Legacy** (`agentcashinoutController.createCart + placeOrder` linje
3058–3318).

**Ny** (`apps/backend/src/routes/agentProducts.ts`):
- `GET /api/agent/products` — hall-filtrert katalog.
- `POST /api/agent/products/carts` — opprett draft cart.
- `GET /api/agent/products/carts/:id` — hent cart.
- `POST /api/agent/products/carts/:id/finalize` — commit med
  `paymentMethod (CASH/CARD/CUSTOMER_NUMBER) + expectedTotalCents +
  clientRequestId`.
- `POST /api/agent/products/carts/:id/cancel` — soft-cancel.
- `GET /api/agent/products/sales/current-shift` — liste per shift.

**Delta:**
- ✅ Backend komplett.
- ✅ UI `apps/admin-web/src/pages/cash-inout/ProductCartPage.ts` er
  live men ligger under `/agent/sellProduct`-rute (legacy-sti).

### 4.3 Order History

**Legacy** (`agentcashinoutController.orderHistoryView + getOrderHistory
Data` linje 3442+).

**Ny:** `GET /api/agent/products/sales/current-shift` for *nåværende
shift* kun. Paginert historikk over flere skift mangler.

**Delta:**
- ❌ **Ingen dedikert order-history-side for agent.** Placeholder i
  sidebarSpec `/orderHistory` er kun admin-stil.

### 4.4 Cancel Order

**Legacy:** `cancelOrder` før completed.

**Ny:** `POST /api/agent/products/carts/:id/cancel` kun for draft cart.
Etter finalize — ingen cancel-path på agent-side. (Cancel-sale-
endepunktet `POST /api/agent/physical/sell/cancel` er for physical-
ticket-salg, ikke produkt-salg.)

**Delta:** ⚠️ Cancel etter finalize må gå via admin.

---

## 5. Under-runde-operasjoner

### 5.1 Start Next Game

**Legacy** (`agentcashinoutController.agentGameStatusForStart +
agentGameStart + startManualGame` linje 1456–2150):
- "Agents not ready yet: Agent 1, 2, 4" popup med per-agent ready-
  state.
- Jackpot-confirm hvis aktuelt.
- 2-min countdown broadcast.
- Hall-ready-signal per agent.

**Ny** (`apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` + 
`apps/backend/src/routes/adminShared.ts` med rooms):
- UI: Start Next Game, PAUSE, Resume, Force End — koblet til
  `POST /api/admin/rooms/:code/start + pause + resume + end +
  room-ready` (2-min countdown).
- Ready-indikator: **pilot-MVP med én agent per hall (selfReady
  boolean)**. Per-agent-liste ikke implementert (NextGamePanel.ts
  linje 64 + 16–18-kommentar).
- Jackpot-confirm: **feature-flag, default off** (linje 68).
- Polling 5s + socket-event via `agentHallSocket.ts`.

**Delta:**
- ✅ Basis-flyt fungerer.
- ❌ **Ingen per-agent-ready-state** for multi-agent-haller. Blokker
  for haller med 2+ bingoverter samtidig.
- ❌ **Jackpot-confirm er feature-flag off** — aktiveres ikke.

### 5.2 Check for Bingo

**Legacy** (`agentcashinoutController.agentGameCheckBingo` linje 2359).

**Ny** (`apps/backend/src/routes/agentBingo.ts` + 
`AgentCheckForBingoPage.ts`):
- `POST /api/agent/bingo/check` med `uniqueId + gameId + numbers[25]`.
- Service returnerer `winningPattern`, `winningPatterns[]`,
  `matchedCellIndexes` + BIN-698-idempotens (stempler `numbersJson`
  på første check).
- UI viser 5×5 grid med highlighted celler + "Winning Patterns"-
  liste med status (Cashout/Rewarded) + `Reward This / Reward All`-
  knapper.

**Delta:** ✅ **Fullstendig og ferdig implementert.** Dette er én av
de to komplette agent-portal-sidene.

### 5.3 Physical Cashout

**Legacy** (`agentcashinoutController.physicalCashOutPage + getPhysical
CashoutDetails + rewardAll` linje 3729–4080).

**Ny** (`apps/backend/src/routes/agentBingo.ts` +
`AgentPhysicalCashoutPage.ts`):
- `GET /api/agent/physical/pending?gameId=` — listing med status.
- `POST /api/agent/physical/reward-all` — batch utbetaling.
- `POST /api/agent/physical/:uniqueId/reward` — per-ticket.
- UI viser pending + rewarded separat, med Reward All-knapp +
  per-rad-Reward-knapp med default-amount pre-populert.

**Delta:** ✅ **Fullstendig og ferdig implementert.**

---

## 6. Skift-slutt (stengning)

### 6.1 Control Daily Balance

**Legacy** (`agentcashinoutController.controlDailyBalance` linje 4419).

**Ny** (`apps/backend/src/routes/agentSettlement.ts`):
- `POST /api/agent/shift/control-daily-balance` med
  `reportedDailyBalance + reportedTotalCashBalance + notes`.
- Service regner `diff`, `diffPct`, `severity` (OK /
  NOTE_REQUIRED / FORCE_REQUIRED) med terskler:
  - NOTE: |diff| > 500 kr ELLER > 5%
  - FORCE: |diff| > 1000 kr ELLER > 10%
- Modal `ControlDailyBalanceModal.ts` i cash-inout-tree ber om note
  når diff > 500 ELLER > 5%.

**Delta:** ✅ Backend komplett. ✅ UI finnes i legacy-portert tree.

### 6.2 Settlement — dagsavslutning med maskin-inntjening

**Legacy** (`agentcashinoutController.settlement + editSettlement`
linje 4569–5076 + `settlement`-modell 93 linjer): Settlement lagrer:
- Per-spill profit (game1..5)
- Per-maskin IN/OUT/Total: Metronia, OK Bingo, Franco, Otium
- Norsk Tipping Dag + Totalt (manuell input)
- Norsk Rikstoto Dag + Totalt (manuell input)
- Rekvisita (kiosk-vare)
- Servering/kaffe
- Bilag m/upload (billImages array)
- Bank (in/out)
- Gevinst overført bank
- Annet (in/out)
- dailyBalanceAtStart/End/Difference
- Drop-safe in/out/total
- Shift-diff in/out/total
- settlementNote
- billImages[]

**Ny** (`apps/backend/src/agent/AgentSettlementService.ts` + 
`AgentSettlementStore.ts`):
- `AgentSettlement` har KUN: `reportedCashCount,
  dailyBalanceDifference, settlementToDropSafe, withdrawFromTotal
  Balance, totalDropSafe, shiftCashIn/Out/CardIn/OutTotal,
  settlementNote, isForced, editedBy, otherData (JSONB)`.
- **Ingen Metronia/OK Bingo/Franco/Otium-felter. Ingen
  NorskTipping/Rikstoto-felter. Ingen Rekvisita/Servering/Bilag/
  Bank/Annet-felter. Ingen billImages-upload.**
- Agent-portal UI `SettlementModal.ts` (cash-inout-tree) har kun
  et `reportedCashCount + note`-felt.

**Delta:**
- ❌❌❌ **STOR REGULATORISK GAP.** Wireframe V1.0 §15.8 (Settlement
  Report) + V2.0 §13.5 (Settlement Dialog) krever full machine-
  break-down. Uten dette kan ikke hallen reconcile Metronia/OK
  Bingo/Franco/Otium-inntjening mot bank-innskudd — pilot-kritisk
  for regnskap.
- Backend har `otherData` JSONB som KUNNE brukes som escape-hatch,
  men ingen dedikerte kolonner, ingen typed input-validation, ingen
  edit-rapport.
- `agentMetronia.ts` og `agentOkBingo.ts` har *egne* daily-sales-
  aggregater som agent/admin kan lese, men de er IKKE koblet inn i
  settlement-close-flyten automatisk. Agenten må selv overføre
  tallene — duplikat-risk.
- Franco + Otium har ingen egne routes/services i ny stack — kun
  Metronia + OK Bingo.

### 6.3 Shift Log Out

**Legacy** (`agentcashinoutController.settlement` + shift-end +
distributeWinnings-flyt): Wireframe V1.0 §13.6:
- Checkbox "Distribute bonuses to all physical players"
- Checkbox "Do you want to transfer the register ticket to next
  agent"
- "View Cashout Details"-link
- Generate shift-rapport (PDF/CSV)

**Ny:**
- `POST /api/agent/shift/close-day` lukker dagen og lager settlement.
- `POST /api/agent/shift/end` terminerer shift.
- `GET /api/agent/shift/:shiftId/settlement.pdf` — PDF-eksport.
- **IKKE IMPLEMENTERT:** "Distribute winnings"-checkbox, "Transfer
  register ticket to next agent"-checkbox (handover er kun i
  `AgentTicketRangeService.handoverRange` men ikke koblet inn i
  shift-end-flyten).

**Delta:**
- ✅ PDF-rapport finnes (via `generateDailyCashSettlementPdf`).
- ❌ "Distribute winnings" — ingen backend-route for å auto-
  utbetale alle pending winners ved shift-end.
- ❌ "Transfer register ticket to next agent" — handover må utføres
  manuelt via range-handover-endpoint. Ikke i skift-end-UI.

---

## 7. Terminal-integrasjon

### 7.1 Hva er en "terminal"?

**Legacy:** Iflg. `UniqueIdController.js` linje 634–647, hall utledes
fra `req.connection.remoteAddress` — hver hall har **én statisk IP-
whitelist** i `hall.ip` feltet. Terminalen er antageligvis en fysisk
iPad/PC med fast IP på hall-nettverket. Ingen eksplisitt "terminal"-
konsept i legacy — kun hall+IP-mapping.

**Ny** (`apps/backend/src/platform/PlatformService.ts` linje 172+):
- `TerminalDefinition { id, hallId, terminalCode, displayName,
  isActive, lastSeenAt }` — eksisterer som førsteklasses konsept.
- `GET /api/admin/terminals`, `POST/PUT /api/admin/terminals/:id`
  (i adminHallsTerminals.ts linje 215–276).
- `HallDisplayTokenWithPlaintext` for TV-display-login (compositeToken
  `<hallSlug>:<token>`).

**Delta:**
- ✅ **Ny stack har bedre terminal-modell** enn legacy.
- ❌ **INGEN binding fra agent-login til terminal.** Agent logger inn
  med email/password, ingen terminalkode/IP-whitelist håndheves.
- ❌ **Ingen screensaver-flyt** (Wireframe PDF 14) per terminal.
- ❌ **Ingen terminal-last-seen-heartbeat fra agent-portalen.**
- ❌ **Ingen kiosk-modus** i admin-web (full-screen lock uten
  sidebar/logout-knapp).

### 7.2 Terminal vs. bingo-TV vs. Player-klient

**Roller:**
- **TV-display** = display i hallen som viser drawn numbers + chat
  + countdown. Auth via `HallDisplayToken` (ikke bruker-login).
- **Agent-terminal** = bingovertens iPad — logger inn som AGENT-
  bruker i admin-web.
- **Player-klient** = spillerens mobilapp/browser (Spillorama Live
  + Candy).

**Delta:** ✅ **Rollene er arkitekturmessig separert.** Men (se 7.1)
det mangler screensaver + kiosk-UI.

---

## 8. Admin-oppsett som kreves for agent-flyt

For at agenten skal kunne kjøre en dag trenger ADMIN å ha konfigurert:

| # | Hva | Endepunkt | Admin-UI-side | Status |
|---|---|---|---|---|
| 1 | Hall med IP/hallNumber | `POST /api/admin/halls` | `/groupHall/*` | ✅ OK |
| 2 | Terminal under hallen | `POST /api/admin/terminals` | `/halls/terminals` (placeholder?) | ⚠️ Endepunkt OK, UI uklar |
| 3 | Agent-bruker med rolle + hall-assignment | `POST /api/admin/agents` | `/agent/*` (admin-side!) | ✅ OK |
| 4 | Produkt-katalog + hall-tildeling | Products + hallProductList | `/productList` + `/hallProductList` | ✅ OK |
| 5 | Ticket-colors (CSV-import) | StaticTicketService | `/staticTickets` | ✅ endepunkt OK |
| 6 | Ticket-priser per ticketColor | ??? | — | ❌ **Uklart** — nye `StaticTicketColor` har ingen egen pris-kolonne. Pris antas å leve i `GameType.variantConfig` eller `PatternConfig` |
| 7 | Pattern-priser per sub-game | `/api/admin/patterns` | `/patternList` | ✅ OK |
| 8 | Daily schedule aktivt | `/api/admin/daily-schedules` | `/dailySchedule` | ✅ OK |
| 9 | Metronia/OK Bingo maskin-konfig | `platformService.setHallSlotProvider` | ⚠️ Ingen UI (README advarsel i cash-inout-README) | ❌ Manglende admin-UI |
| 10 | Role permissions per agent | `/api/admin/agent-permissions` | `/role/agent` | ✅ OK |
| 11 | Overskudd/pot-konfig | adminOverskudd.ts | `/overskudd` | ✅ OK |

**Delta:**
- ❌ **Terminal-CRUD-UI uklar.** Endepunkter finnes men siden er
  ikke i sidebar-spec.
- ❌ **Ticket-priser per farge er ikke en egen CRUD-flate** —
  legacy §15.3 hadde "Ticket Configuration Table" med Ticket
  Color/Type/Price-kolonner per sub-game. Ny stack kan gjøre det
  via `daily_schedule.variantConfig` men det er ikke en eksplisitt
  pris-redigering.
- ❌ **Slot-provider-admin-UI mangler** (README flag'er dette
  eksplisitt i cash-inout/README.md linje 49 — `app_halls.slot_
  provider` column not present).

---

## 9. End-to-end dag-sjekkliste

Tidslinje for en typisk dag i hallen. Rødt = blokker, gult = delvis,
grønt = klart.

| Tid | Aktivitet | Krever | Ny stack? |
|---|---|---|---|
| 08:00 | Agent ankommer, logger inn | auth/login + profil + hall-assignment | 🟢 OK |
| 08:05 | Agent åpner skift (shift_start) | `POST /shift/start` | 🟢 Backend OK. 🔴 Ingen UI-kobling fra `/agent/dashboard`. Agent må manuelt navigere til `/agent/cashinout`-siden (ikke i sidebar). |
| 08:10 | Agent legger inn starting-cash (open-day) | `POST /shift/open-day` + `HallCashLedger` | 🟢 Backend OK. 🟡 UI: Modal `AddDailyBalance` i CashInOutPage (ikke ny `/agent/*`-sidebar). |
| 08:15 | Agent henter dagens spilleplan | `GET /halls/:id/schedule` | 🟢 OK (public endpoint). |
| 08:30 | Agent registrerer ticket-ranges for dagens spill (scanner) | `POST /admin/physical-tickets/ranges/register` | 🟡 Backend OK med 3 farge-familier (ikke 6). 🔴 UI `/agent/physical-tickets` er placeholder. |
| 09:00 | Åpne for spillere | Ingen formell stage | 🟢 Ingen tilstand å endre. |
| 09:30 | Første walk-in spiller — agent lager ny Unique ID med balance | createUniqueIdCustomer | 🔴 **IKKE IMPLEMENTERT** i ny stack (se §3.3). |
| 09:45 | Agent cash-in til registrert spiller | `POST /players/:id/cash-in` | 🟢 Backend OK + UI BalancePage OK (under `/agent/cashinout`). |
| 10:00 | Første spill starter — agent klikker Start Next Game | `POST /rooms/:code/start` | 🟢 OK, ✅ `NextGamePanel` live. |
| 10:05 | Ready-sjekk: 3 agenter i hallen, kun 1 klar | Per-agent ready-state | 🔴 **IKKE IMPLEMENTERT** — kun self-ready boolean. |
| 10:15 | Spiller får bingo — agent sjekker ticket | `POST /bingo/check` | 🟢 OK, ✅ AgentCheckForBingoPage live. |
| 10:16 | Agent trykker Reward | `POST /physical/:uid/reward` | 🟢 OK. |
| 10:17 | Cash-out utbetaling | `POST /players/:id/cash-out` | 🟢 Backend OK + UI BalancePage OK. |
| 11:00 | Agent selger kaffe + plakat | Products cart + finalize | 🟢 OK + UI ProductCartPage OK. |
| 13:00 | Metronia-maskin registrerer ticket | `POST /agent/metronia/register-ticket` | 🟢 Backend OK. 🟡 UI mangler i ny agent-portal-tree. |
| 14:00 | Skiftbytte — neste agent overtar hall | Ticket-range handover | 🟡 Backend endpoint OK (`ranges/:id/handover`). 🔴 UI ikke koblet til shift-end-flyten. |
| 15:00 | Mid-shift daily-balance sjekk | `POST /control-daily-balance` | 🟢 Backend OK + UI ControlDailyBalanceModal OK. |
| 20:00 | Siste spill | Start Next Game | 🟢 OK. |
| 21:00 | Check for Bingo siste runde | `POST /bingo/check` | 🟢 OK. |
| 21:30 | Physical Cashout — reward all | `POST /physical/reward-all` | 🟢 OK + UI AgentPhysicalCashoutPage live. |
| 22:00 | Settlement: full machine-breakdown | Metronia/OK Bingo/Franco/Otium/Norsk Tipping/Rikstoto/Rekvisita/Kaffe/Bilag/Bank/Annet | 🔴🔴 **STOR GAP** — se §6.2 — settlement-service mangler ca. 20 regulatoriske felter. UI er kun `reportedCashCount + note`. |
| 22:10 | Distribute winnings checkbox | Auto-reward pending | 🔴 Ingen UI + backend i close-day-flyt. Må gjøres manuelt via `/physical/reward-all`. |
| 22:15 | Transfer register tickets checkbox | Handover-range | 🔴 Ikke koblet til close-day. |
| 22:20 | Shift log out | `POST /shift/end` | 🟢 Backend OK. 🔴 Skift-rapport-generering i UI er minimal. |

**Sum:** En agent kan i dag kjøre **~40% av en full dag i ren ny-
stack agent-sidebar** (`/agent/*`-ruter som er i sidebar-nav). Hvis
de legacy-portede cash-inout-sidene (`/agent/cashinout` m.m.) legges
til i sidebar, er vi oppe i ~65%. De **harde blokkerne** er:
1. Customer-Unique-ID (prepaid-kort) — mangler helt.
2. Full settlement-rapport med maskin-breakdown — utilstrekkelig
   modell.
3. Per-agent ready-state — multi-agent-haller ikke støttet.

---

## 10. Prioritert gap-liste

| # | Gap | Legacy-ref | Ny-stack-status | Prioritet | Estimat |
|---|---|---|---|---|---|
| 1 | **Customer Unique ID (prepaid-kort) — create + add/withdraw money + transaction history + expiry + print** | `UniqueIdController.addUniqueId` + `UniqueIdController.viewSpaceficTicketDetails` | Ikke implementert. Ny `physical_ticket.uniqueId` er annet konsept. | 🔴 P0 | 3-5 PR-er (DB-schema + service + 4 UI-sider) |
| 2 | **Settlement — maskin-breakdown** (Metronia/OK Bingo/Franco/Otium IN/OUT/Total + Norsk Tipping Dag+Totalt + Norsk Rikstoto Dag+Totalt + Rekvisita/Servering/Bilag m/upload/Bank/Gevinst overf/Annet + Drop-safe + ShiftDiff) | `settlement`-model 93 linjer + `editSettlement` linje 5902 | Kun 8 kolonner. Mangler ca. 20 regulatoriske felter. | 🔴 P0 | 2-3 PR-er (DB-migration + service + SettlementModal redesign + PDF-rapport) |
| 3 | **Per-agent ready-state** for Start Next Game i multi-agent-haller + "Agents not ready yet"-popup + Jackpot-confirm | `agentcashinoutController.hallsStatusForGame + setHallStausWithColorCode` + `agentGameStatusForStart` | Kun aggregert `selfReady` boolean (NextGamePanel linje 64 + kommentar 16-18). Jackpot feature-flag default off. | 🔴 P0 | 2 PR-er (backend multi-agent-ready-API + NextGamePanel redesign) |
| 4 | **Agent-portal-sidebar wiring** — koble `/agent/cashinout`-siden inn i `/agent/*`-sidebar + erstatte placeholder `AgentCashInOutPage.ts` + `AgentPhysicalTicketsPage.ts` + `AgentUniqueIdPage.ts` | Wireframe PDF 15 side-nav | To parallelle portal-tre som ikke henger sammen. Sidebar spec linje 276–312 vs. legacy-port under `apps/admin-web/src/pages/cash-inout/`. | 🔴 P0 | 1 PR (sidebar-refaktor + route-dispatcher) |
| 5 | **Ticket-farger — 6+ → 3 reduction** (eller avklaring av om hall-UI kan leve med 3) | `staticTicket.ticketColor` Small Yellow/White/Purple/Red/Green/Blue + Large + Mystery | `StaticTicketService.StaticTicketColor = small \| large \| traffic-light` | 🟠 P1 | 1 PR (utvide type + UI for 6 rader) ELLER avklaring fra Tobias |
| 6 | **Register More Tickets UI (AgentPhysicalTicketsPage)** — scan-knapp, F2-hotkey auto-generate, Initial/Final-grid per farge | `physicalTicketsController.addPhysicalTicketsPost` + Wireframe §15.10 | Placeholder "Kommer snart". | 🟠 P1 | 1 PR |
| 7 | **Register Sold Tickets UI** — Final ID scan per runde, carry-forward-visualisering | `purchasePhysicalTickets` linje 1676 + Wireframe §15.2 | Ingen UI (backend `record-batch-sale` finnes). | 🟠 P1 | 1 PR |
| 8 | **Distribute winnings til physical players ved shift-end** — auto-reward-all pending ved close-day | Wireframe §13.6 checkbox | Ikke implementert. Agent må manuelt reward-all per game. | 🟠 P1 | 1 PR (close-day utvidelse) |
| 9 | **Transfer register tickets til next agent ved shift-end** — koble handover inn i close-day | `AgentTicketRangeService.handoverRange` finnes men ikke i close-day | Manuelt via separat endpoint. | 🟠 P1 | 1 PR |
| 10 | **Franco + Otium maskin-integrasjon** — manglende route/service | `settlement.inAmountFranco/Otium` | Kun Metronia + OK Bingo implementert. | 🟠 P1 | 2 PR-er per maskin |
| 11 | **Order History (multi-shift) agent-side** | `orderHistoryView` | Kun current-shift sales tilgjengelig. | 🟡 P2 | 1 PR |
| 12 | **Screensaver UI** per terminal | Wireframe PDF 14 | Ikke implementert. | 🟡 P2 | 1 PR |
| 13 | **Kiosk-modus** i admin-web (full-screen lock) | Antatt fra iPad-setup | Ikke implementert. | 🟡 P2 | 1 PR |
| 14 | **Terminal-IP-binding** for agent-login (whitelist IP per terminal) | `hall.ip` i legacy | Terminal-konsept finnes men ikke koblet til auth. | 🟡 P2 | 1 PR |
| 15 | **Slot-provider admin-UI** (`app_halls.slot_provider`-kolonne) | Implicit i legacy | README flags det, mangler CRUD-felt | 🟡 P2 | 1 PR |
| 16 | **Ticket-priser per farge × sub-game** (eksplisitt CRUD) | Wireframe §15.3 Ticket Configuration Table | Data antatt i variantConfig JSONB | 🟡 P2 | 1 PR |
| 17 | **Print receipt** for physical sale + Unique ID create | Wireframe §11.3 + legacy print-action | Ingen terminal-print-integrasjon | 🟡 P2 | 1 PR (scoped til thermal-printer eller pdf-download) |
| 18 | **"Hall Specific Report" agent read-only view** | Wireframe §15.7 | Ingen agent-side rapport-UI. Admin-rapport finnes. | 🟡 P2 | 1 PR |
| 19 | **Past Game Winning History** (lookup-historikk for dispute) | Wireframe §15.6 | Ingen dedikert UI, kan bygges på `agent/transactions` | 🟢 P3 | 1 PR |
| 20 | **AgentDashboardPage dummy-data** — wire til `/api/agent/dashboard` + Latest Requests + Top 5 Players live data | Wireframe §11.1 | Skjelett med hardkodet "250"-tall + dummy rows (AgentDashboardPage.ts linje 74, 96–106). | 🟡 P2 | 1 PR |

---

## 11. Arkitektur-observasjoner

1. **Two parallel agent-UI-skjeletter** er teknisk gjeld #1. Enten
   må `/agent/dashboard`-placeholder-tre erstatte legacy-portet
   `/agent/cashinout`-tree, eller omvendt. Pågår i #410 men ikke
   fullført.
2. **`otherData` JSONB** brukes som escape-hatch for settlement-
   data som ikke får dedikerte kolonner. Dette er pragmatisk men
   ugunstig for regnskap-rapportering (queries må parse JSON).
   Anbefaling: utvid schema med dedikerte kolonner for minst
   Metronia/OK Bingo/Franco/Otium i/ut-beløp.
3. **Permission-modell er bra.** `AdminAccessPolicy` har dedikerte
   permissions `AGENT_SHIFT_*`, `AGENT_CASH_*`, `AGENT_TICKET_*`,
   `AGENT_SETTLEMENT_*`, `AGENT_PRODUCT_SELL`, `AGENT_TX_READ`.
   Fint for RBAC-matrix i Wireframe PDF 1 §6.1 (Role Management).
4. **Testcoverage** er god: 14 `__tests__`-filer for agent-routes
   finnes. Agent-portal-UI har tests i `apps/admin-web/tests/`.
5. **Socket-integrasjon** eksisterer via `agentHallSocket.ts` +
   `hall-status-broadcast`. Progressive enhancement over HTTP-polling
   (NextGamePanel linje 54).

---

## 12. Oppsummering — hva må til for pilot-klar

**Minimum (for å kjøre 1-agent-hall med enkle produkter):**
- Gap #4 (sidebar-wiring) — 1 PR
- Gap #6 (Register More Tickets UI) — 1 PR
- Gap #7 (Register Sold Tickets UI) — 1 PR
- Gap #20 (Dashboard live data) — 1 PR
- Gap #2 *eller* escape-hatch via `otherData` for settlement — 1 PR

**Nice-to-have for regulatorisk klar pilot:**
- Gap #1 (Customer Unique ID) — kan omgås hvis alle spillere
  registrerer seg som players, men legacy-haller har trad. "kjøp
  et kort og spill anonymt"-flyt som er hard å erstatte.
- Gap #2 full settlement-rapport.
- Gap #8 + #9 (shift-end checkboxes).

**Multi-agent / flere haller-klar pilot:**
- Gap #3 (per-agent ready-state).
- Gap #10 (Franco + Otium).
- Gap #14 (terminal-IP-binding) hvis fysisk sikkerhet kreves.

**Total estimat:** ~15-20 PR-er for "en agent kan drive en full dag
1:1 med legacy". Matcher PM-handoff-estimat (§5 Fase 1 har 10 igjen,
hvorav 8 er agent-portal-innhold).

---

**Forfatter:** Agent R2
**Dato:** 2026-04-24
**Status:** Komplett research per 2026-04-24. Ingen kode endret.
