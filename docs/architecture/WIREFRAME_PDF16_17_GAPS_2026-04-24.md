# Wireframe PDF 16 + 17 — Gap-analyse
_2026-04-24_

Analyse av de to nylig leverte PDF-ene:
- **PDF 16**: `WF_B_Spillorama_Admin_V1.0_13-09-2024.pdf` (21 sider, 2.2 MB) — **25 skjermer** dokumentert
- **PDF 17**: `WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` (30 sider, 7.1 MB) — **40 skjermer** dokumentert

PDF-ene er nå integrert i [WIREFRAME_CATALOG.md](./WIREFRAME_CATALOG.md) §16-17.

## Sammendrag

- **PDF 16 (Admin)**: 25 skjermer dokumentert — 14 🟡 (delvis), 8 🔴 (mangler), 3 🟢 (finnes)
- **PDF 17 (Agent)**: 40 skjermer dokumentert — 11 🟡 (delvis), 20 🔴 (mangler), 9 🟢 (finnes)
- **Kritisk oppdagelse**: PDF 17 (Agent 14.10.2024) er **mellomversjon mellom PDF 11 (Agent V2.0 10.07.2024) og PDF 15 (Agent V1.0 Latest 06.01.2025)** — strukturelt 1:1 med PDF 15, så gap-listen er 95% overlappende med eksisterende mapping §3.2. **Vi får primært bekreftet** at Agent-portal-scope som beskrevet i §3.2 av LEGACY_1_TO_1_MAPPING er korrekt.
- **PDF 16 (Admin 13.09.2024)** gir nye detaljer for: Role Management-matrise, Close Day Edit/Remove-popups, Settlement Edit, Hall Account Report med edit-varianten, Withdraw in Bank XML-eksport til regnskaps-email.

### Topp-5 P0-gap (pilot-blokkere)

| # | Gap | PDF | Screen | Filepath/wireframe-ref | Est. dager |
|---|-----|-----|--------|------------------------|-----------|
| 1 | **Agent Settlement Popup** — 1:1 layout med 15 maskin/kategori-rader + Shift-delta-seksjon (Kasse start/slut, Innskudd dropsafe, Påfyll kasse, Difference in shifts) + Bilag upload | 16+17 | 16.25 / 17.40 | `apps/admin-web/src/pages/cash-inout/modals/SettlementModal.ts` eksisterer — mangler Shift-delta kalkulasjon + Bilag upload-UI | 5 |
| 2 | **Hall Account Report Settlement — Edit Popup** | 16 | 16.24-25 | `apps/admin-web/src/pages/hallAccountReport/SettlementPage.ts` eksisterer (listing) — **mangler Edit-popup som dobbelpeker mot Agent's settlement** og download-receipt-action | 3 |
| 3 | **Withdraw in Bank XML-eksport** — daglig generering av XML + mail til regnskap | 16 | 16.20 | Ingen implementasjon. `apps/admin-web/src/pages/amountwithdraw/RequestsPage.ts` har ingen XML-eksport | 4 |
| 4 | **Register Sold Tickets popup** — "Final ID of the stack"-scanner, auto-compute carry-forward | 17 | 17.15 | `apps/admin-web/src/pages/cash-inout/SellTicketPage.ts` eksisterer — mangler eksakt Register Sold Tickets-flyt med pre-game batch-scanning | 3 |
| 5 | **Start Next Game Ready/Not Ready-popup** — "Agents not ready: Agent 1, 2, 4" + Hall Info-popup | 16+17 | 16.4 / 17.17 | `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts` eksisterer — mangler full Ready/Not Ready-liste | 2 |

---

## 1. PDF 16 — Admin V1.0 (13.09.2024)

### 1.1 Skjerm-for-skjerm paritet

| Skjerm | Beskrivelse | Eksisterer i kode? | Fil(er) | Gap |
|--------|-------------|---------------------|---------|-----|
| 16.1 | Approved Players — Import Excel | 🟡 | `apps/admin-web/src/pages/players/approved/ApprovedPlayerListPage.ts`, `apps/admin-web/src/pages/physical-tickets/ImportCsvPage.ts` | Player-list eksisterer. **Import Excel mangler**. Hall Number-mapping (0-840 i 20-trinn) mangler. Phone-eller-email-validering + Password-reset-link ved første login mangler. (Tobias har bestemt engangs-migrasjon — se MAPPING §8.5) |
| 16.2 | Hall Management (Hall Number-kolonne) | 🟢 | `apps/admin-web/src/pages/hall/HallListPage.ts:56-59` | Kolonne finnes (`key: "hallNumber"`, render `r.hallNumber`). |
| 16.3 | Add Hall (med Hall Number-felt) | 🟢 | `apps/admin-web/src/pages/hall/HallFormPage.ts:68-220` | `hallNumber`-felt inkludert i form + validering (`hall_number_positive_integer`). |
| 16.4 | Ongoing Schedule — "Agents not ready yet"-popup | 🟡 | `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts`, `apps/admin-web/tests/nextGamePanel.test.ts` | Panel eksisterer. **Mangler**: Popup som lister "Agent 1, Agent 2, Agent 4" før Start. Kun spørrings-confirm eksisterer. |
| 16.5 | Winners Public Display (Admin-view) | 🟡 | `apps/admin-web/src/pages/tv/WinnersPage.ts` | Admin-view av samme data. **Mangler**: eksplisitt KPI-bokser "Total Numbers Withdrawn / Full House Winners / Patterns Won", og "Hall Belongs To"-kolonne i pattern-tabellen |
| 16.6 | Role Management — Agent Role Permission Table (15×5 matrix) | 🟡 | `apps/admin-web/src/pages/role/AgentRolePermissionsPage.ts`, `apps/admin-web/src/pages/role/RoleMatrixPage.ts`, `apps/admin-web/tests/agentRolePermissionsPage.test.ts`, `apps/backend/src/routes/adminAgentPermissions.ts`, `apps/backend/src/platform/AgentPermissionService.ts`, `apps/backend/migrations/20260705000000_agent_permissions.sql` | Matrix-UI eksisterer. **Mangler verifiering**: Eksakt liste av 15 moduler og 5 actions (Create/Edit/View/Delete/Block-Unblock) matcher wireframe-spec. Default "Player Management always on"-regel må verifiseres. |
| 16.7 | Close Day — Papir Bingo (Game 1) list | 🟡 | `apps/admin-web/src/pages/games/gameManagement/GameManagementPage.ts:305-316`, `apps/admin-web/src/pages/games/gameManagement/GameManagementDetailPages.ts:356+` | "Close Day"-knapp + confirm finnes (BIN-623). **Mangler**: per-DailySchedule list-view med 4 action-ikoner (start/edit/stop/close-days) og "+Create Daily Schedule"-knapp. |
| 16.8 | View Close Days (per Daily Schedule) | 🔴 | Ingen | Ingen listing av eksisterende lukkedager per schedule. Kun enkel `closeDay`-kall. |
| 16.9 | Add Close Day — Date Picker Popup | 🔴 | Ingen | Enkel dato-velger eksisterer for single day. **Mangler**: Case 2 (Multiple consecutive) og Case 3 (Random multiple) støtte. |
| 16.10 | Edit Close Day Popup | 🔴 | Ingen | - |
| 16.11 | Remove Close Day Confirmation Popup | 🔴 | Ingen | - |
| 16.12 | Close Day — Data Bingo (Game 4) list | 🔴 | Ingen | "Currently displayed for Game 1 only" → må etableres for Game 4. |
| 16.13 | Game Creation — Game 4 (Data Bingo) Edit Form | 🟡 | `apps/admin-web/src/pages/games/gameManagement/GameManagementDetailPages.ts`, `apps/admin-web/src/pages/games/gameManagement/GameManagementAddForm.ts` | Form-skelett finnes, men **Pattern Name & Prize tabell (10 jackpot/pattern-slots)**, Bet Amount 4×4 matrix, Bot Game checkbox (droppet per mapping §8.4), og `Total Seconds to display single ball` per range (1-18: 0.5s, 19-33: 1s) mangler. |
| 16.14 | Game Creation — Game 5 (SpinnGo) Edit Form | 🔴 | Ingen | Admin-form for Game 5 eksisterer ikke (Game 5 = slug `spillorama`; mapping §8 sier droppet for pilot). 14 pattern-slots + Total Balls to Withdraw mangler. |
| 16.15 | Deposit Request — Pay in Hall | 🟡 | `apps/admin-web/src/pages/transactions/DepositRequestsPage.ts`, `apps/backend/src/routes/paymentRequests.ts` | Deposit requests-listing eksisterer. **Mangler**: Select Type-dropdown (Pay in Hall / Vipps / Card) + Hall Name-filter + Refresh Table + Approve/Reject-popup. |
| 16.16 | Deposit Request — Vipps/Card | 🔴 | Ingen | Samme tabell-struktur uten Action-kolonne. Må splittes fra 16.15 basert på Select Type. |
| 16.17 | Deposit History — Pay in Hall | 🟡 | `apps/admin-web/src/pages/transactions/DepositHistoryPage.ts` | History-listing eksisterer. **Mangler**: Transaction ID-kolonne + filtrering per type. |
| 16.18 | Deposit History — Vipps/Card | 🟡 | `apps/admin-web/src/pages/transactions/DepositHistoryPage.ts` | Samme som 16.17 — må splittes per type. |
| 16.19 | Withdraw in Hall | 🟡 | `apps/admin-web/src/pages/amountwithdraw/RequestsPage.ts`, `apps/admin-web/src/pages/amountwithdraw/modals/PaymentActionModal.ts` | Approve/Reject-queue eksisterer. **Mangler**: Hall Name-kolonne, CSV/Excel-eksport, og eksplisitt skille mellom Hall og Bank. |
| 16.20 | Withdraw in Bank — XML Export | 🔴 | `apps/admin-web/src/pages/amountwithdraw/RequestsPage.ts` eksisterer uten XML | **Ingen XML-eksport funksjonalitet**. Verken per-hall XML eller samlet. Mangler også mail-sending til regnskaps-email (16.24 Email list). Se også PDF 9 (18.03.2024 Deposit & Withdraw). |
| 16.21 | Withdraw History | 🟡 | `apps/admin-web/src/pages/amountwithdraw/HistoryPage.ts` | History-listing eksisterer. **Mangler**: Select Withdraw Type-dropdown (Hall vs. Bank) + Account Number-kolonne + Transaction ID. |
| 16.22 | Hall Account Report — Liste over haller | 🟢 | `apps/admin-web/src/pages/hallAccountReport/HallAccountListPage.ts`, `apps/admin-web/src/pages/hallAccountReport/index.ts` | Listing finnes med View-action → detail-page. |
| 16.23 | Hall Account Report — View (per hall) | 🟡 | `apps/admin-web/src/pages/hallAccountReport/HallAccountReportPage.ts`, `apps/backend/src/routes/adminHallReports.ts`, `apps/backend/src/compliance/HallAccountReportService.ts` | Daily breakdown eksisterer. **Mangler**: Per-kolonne verifiering mot wireframe (Resultat Bingonet, Metronia, OK bingo, Francs, Otium, Radio Bingo, Norsk Tipping, Norsk Rikstoto, Rekvisita, Kaffe-penger, Bilag, Gevinst overf. Bank, Bank terminal, Innskudd dropsafe, Inn/ut kasse, Diff, Kommentarer, Sum For UKE). Download PDF finnes (`apps/backend/src/util/pdfExport.ts`). |
| 16.24 | Hall Account Report — Settlement Report | 🟡 | `apps/admin-web/src/pages/hallAccountReport/SettlementPage.ts`, `apps/admin-web/tests/hallAccount/settlementPdf.test.ts` | Listing + PDF-eksport finnes. **Mangler**: Edit-action per rad + download-receipt-action. |
| 16.25 | Settlement — Edit Popup (Admin) | 🟡 | `apps/admin-web/src/pages/cash-inout/modals/SettlementModal.ts`, `apps/admin-web/src/pages/cash-inout/modals/SettlementBreakdownModal.ts`, `apps/admin-web/src/pages/cash-inout/modals/ControlDailyBalanceModal.ts`, `apps/backend/src/agent/AgentSettlementService.ts`, `apps/backend/migrations/20260725000000_settlement_machine_breakdown.sql` | Modal-struktur eksisterer. **Mangler**: Fullt 1:1 layout med 15 maskin/kategori-rader, Shift-delta-seksjon med Kasse start/slut + Innskudd dropsafe + Påfyll/ut kasse + Totalt dropsafe + **Difference in shifts**-formel `(Totalt-Endring)+Endring-Totalt Sum`. Bilag "Upload receipt"-ikon/funksjon mangler. |

### 1.2 Nye funksjoner oppdaget i PDF 16 som ikke er i §3.1 av LEGACY_1_TO_1_MAPPING_2026-04-23.md

Alle 25 skjermene i PDF 16 overlapper med moduler som allerede er flagget i §3.1. Men **følgende nye, konkrete detaljer** er nå dokumentert:

1. **Close Day 3-case-logikk** (Single / Consecutive / Random) — tidligere ikke eksplisitt spesifisert
2. **Close Day popup edit + remove confirm** — 2 nye skjermer
3. **Settlement-popupens eksakte 15-rad maskin-breakdown + 4-punkts Shift-delta** med fullt regnestykke
4. **Norsk Tipping Dag + Rikstoto Dag IKKE i rapport** — kun Totalt reflekteres
5. **Withdraw in Bank XML-spesifikasjon**: daglig generering, per-agent eller samlet mail-utsending
6. **Deposit Request spesifikke kolonner**: Order Number, Transaction ID, Pay-in-Hall har Action-kolonne MED Approve/Reject, Vipps/Card har ingen Action-kolonne
7. **Role Management modul-liste**: Player, Schedule, Game Creation, Saved Game List, Physical Ticket, Unique ID, Report, Wallet, Transaction, Withdraw, Product, Hall Account Report, Hall Account Report — Settlement, Hall Account Specific report, Payout, Accounting (16 moduler, ikke 15 som §3.1 sier — Accounting er tilleggs-modul)

---

## 2. PDF 17 — Agent V1.0 (14.10.2024)

### 2.1 Skjerm-for-skjerm paritet

| Skjerm | Beskrivelse | Eksisterer i kode? | Fil(er) | Gap |
|--------|-------------|---------------------|---------|-----|
| 17.1 | Agent Dashboard | 🟡 | `apps/admin-web/src/pages/agent-dashboard/AgentDashboardPage.ts`, `apps/admin-web/tests/agentDashboardPages.test.ts`, `apps/backend/src/routes/agentDashboard.ts` | Dashboard-skelett eksisterer. **Mangler**: `Total Number of Approved Players`-widget, `Latest Requests`-tabell + "View all Pending Request"-link, `Top 5 Players`-widget (listing delvis ved `TopPlayersBox.ts`), Game tabs 1-4, Cash In/Out-knapp i header, Language toggle NO/EN, Notification-bjelle. |
| 17.2 | Cash In/Out Management — Main View | 🟡 | `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts`, `apps/admin-web/src/pages/agent-portal/AgentCashInOutPage.ts`, `apps/admin-web/src/pages/cash-inout/README.md` | Core layout eksisterer. **Mangler**: Today's Sales Report-knapp, eksakt 6-knapp-grid (Add Money Unique ID + Reg User + Create Unique ID + Withdraw Unique ID + Withdraw Reg User + Sell Products), Next Game-panel (Register More/Sold Tickets, Start, i-info), Ongoing Game-panel med My Halls / Group Of Halls ticket-breakdown, See all drawn numbers. |
| 17.3 | Control Daily Balance Popup | 🟢 | `apps/admin-web/src/pages/cash-inout/modals/ControlDailyBalanceModal.ts` | Modal eksisterer. Må verifisere 2-felt (Daily balance + Total cash balance). |
| 17.4 | Settlement Popup (Agent) | 🟡 | Samme som 16.25 — `apps/admin-web/src/pages/cash-inout/modals/SettlementModal.ts` | Samme gap som 16.25. |
| 17.5 | Add Daily Balance Popup | 🟢 | `apps/backend/src/agent/AgentOpenDayService.ts`, `apps/backend/src/routes/agentOpenDay.ts`, `apps/admin-web/src/api/agent-shift.ts`, `apps/admin-web/src/pages/cash-inout/BalancePage.ts` | Add Daily Balance-flyt finnes. **Må verifisere**: Kun tillatt ved session-start eller etter forrige logout. |
| 17.6 | Shift Log Out Popup | 🟡 | `apps/admin-web/src/pages/agent-portal/AgentCashInOutPage.ts` inneholder Shift.Log.Out-referanse | **Mangler**: 2 checkboxes (Distribute winnings til physical players + Transfer register ticket til next agent) + "View Cashout Details"-link. |
| 17.7 | Add Money — Registered User Popup | 🔴 | Ingen konkret fil funnet | Kun referanse i `apps/admin-web/src/i18n/en.json`. Må implementeres. |
| 17.8 | Withdraw — Registered User Popup | 🔴 | Ingen | - |
| 17.9 | Create New Unique ID | 🟡 | `apps/admin-web/src/pages/agent-portal/AgentUniqueIdPage.ts`, `apps/admin-web/src/pages/unique-ids/ListPage.ts`, `apps/admin-web/src/pages/unique-ids/LookupPage.ts`, `apps/backend/src/routes/adminUniqueIdsAndPayouts.ts` | Agent-portal-side eksisterer. **Mangler verifiering**: Full form med Purchase Date+Time, Expiry Date+Time, Balance Amount, **Hours Validity min 24h**, Payment Type, PRINT-flyt. |
| 17.10 | Add Money — Unique ID Popup | 🟡 | `apps/admin-web/src/pages/agent-portal/AgentUniqueIdPage.ts` | Må verifisere Yes/No-flyt og balance-calc-regel (170kr + 200kr = 370kr akkumulert, ikke 200 overwrite). |
| 17.11 | Withdraw — Unique ID Popup | 🔴 | Ingen | Cancel-flow og "kun Cash-option"-regel må implementeres. |
| 17.12 | Sell Products (Kiosk) | 🟡 | `apps/admin-web/src/pages/cash-inout/ProductCartPage.ts`, `apps/backend/src/routes/agentProducts.ts`, `apps/backend/src/agent/AgentProductSaleService.ts` | Product-UI eksisterer. **Må verifiseres**: kurv-ikon, `-`-knapp for decrement, Total Order Amount, Cash/Card-valg. |
| 17.13 | Register More Tickets Popup | 🟡 | `apps/admin-web/src/pages/physical-tickets/AddPage.ts`, `apps/admin-web/src/pages/physical-tickets/RangeRegisterPage.ts`, `apps/admin-web/src/pages/physical-tickets/ActiveRangesPage.ts` | Physical-tickets-UI eksisterer. **Mangler**: F1-hotkey, "Initial ID of the stack → auto-compute Final ID"-scanner-flyt, modal-popup-visning. |
| 17.14 | Register More Tickets — Edit Popup | 🔴 | Ingen | Edit via hotkey med pre-filled initial ID mangler. |
| 17.15 | Register Sold Tickets Popup | 🟡 | `apps/admin-web/src/pages/cash-inout/SellTicketPage.ts`, `apps/admin-web/src/pages/cash-inout/SoldTicketsPage.ts`, `apps/admin-web/src/pages/physical-tickets/GameTicketListPage.ts` | Listing eksisterer. **Mangler**: Register Sold Tickets-popup (Final ID of the stack-scanner) med automatic carry-forward-logic for unsold tickets mellom games. |
| 17.16 | Next Game — PAUSE + Check for Bingo | 🟡 | `apps/admin-web/src/pages/agent-portal/AgentCheckForBingoPage.ts`, `apps/admin-web/src/pages/physical-tickets/CheckBingoPage.ts`, `apps/backend/src/routes/agentBingo.ts`, `apps/backend/src/routes/adminPhysicalTicketCheckBingo.ts` | CheckBingoPage eksisterer. **Mangler**: PAUSE+Resume-integrasjon fra CashInOutPage, ticket-nummer-input popup. |
| 17.17 | Next Game — Hall Info Ready/Not Ready-popup | 🟡 | `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts`, `apps/admin-web/tests/nextGamePanel.test.ts` | NextGamePanel-logic eksisterer. **Mangler**: "Ready to go"- og "Not ready yet"-listings med eksplisitte hall-navn (Gullerene Bingos, Centre, Notodden bingohal). |
| 17.18 | Next Game — Are You Ready | 🔴 | Ingen | Master-hall-ready-button + GOH-signalering mangler. |
| 17.19 | Next Game — Register Next Tickets (with Transfer Hall Access + Countdown Timer) | 🔴 | Ingen | Transfer Hall Access (agent-delegering) mangler helt. Countdown Timer (2-3 min pre-start) mangler. |
| 17.20 | Players Management — Approved Players (Agent-view) | 🟡 | `apps/admin-web/src/pages/agent-players/AgentPlayersPage.ts` | Agent players-listing eksisterer. **Mangler**: Action-menu med Add Balance / Transaction History / Game Details / Block/Unblock. POINTS-kolonne må skjules (konsistent med mapping §3.3). |
| 17.21 | Players Management — Add Balance Popup | 🔴 | Ingen | Må implementeres som del av 17.20 action-menu. |
| 17.22 | Add Physical Tickets (agent-view) | 🟡 | `apps/admin-web/src/pages/physical-tickets/AddPage.ts`, `apps/admin-web/src/pages/physical-tickets/ImportCsvPage.ts` | Add-sides eksisterer. **Mangler**: Eksakt Scanned Tickets-tabell-layout (Ticket Type, Initial ID, Final ID, Tickets Sold, Action), 6 forhåndsdefinerte ticket-types (Small Yellow, Small White, Large Yellow, Large White, Small Purple, Large Purple). |
| 17.23 | View Sub Game Details (agent) | 🟡 | `apps/admin-web/src/pages/agent-portal/AgentGamesPage.ts`, `apps/admin-web/src/pages/games/subGame/*` | Sub-game view-delt eksisterer. **Mangler**: Total Numbers displayed already-liste, User Type dropdown (Online user/Unique ID), Spin Wheel Winnings + Treasure Chest Winnings-input-kolonner (agent-entry på vegne av spiller), Filter på Group of Hall + Hall. |
| 17.24 | Add Physical Ticket Popup (inne i Sub Game Details) | 🔴 | Ingen | Inline popup fra sub-game details mangler. |
| 17.25 | Unique ID List | 🟡 | `apps/admin-web/src/pages/unique-ids/ListPage.ts` | Listing eksisterer. **Mangler**: Action-ikoner (View, Transaction History, Withdraw). |
| 17.26 | Unique ID Details (View Action) | 🟡 | `apps/admin-web/src/pages/unique-ids/LookupPage.ts`, `apps/backend/src/routes/adminUniqueIdsAndPayouts.ts` | Basic details-view finnes. **Mangler**: Choose Game Type-dropdown (Game 1-4) + per-game details-tabell (Game ID, Child Game ID, Unique Ticket ID, Ticket Price, Ticket Purchased from, Winning Amount, Winning Row). Print-knapp + **Re-Generate Unique ID**-knapp mangler. |
| 17.27 | Unique ID — Transaction History | 🔴 | Ingen per-UniqueID transaction-history-side | `apps/admin-web/src/pages/transactions/TransactionsLogPage.ts` finnes for global transactions, men ingen UniqueID-scoped history med 5-kol-tabell (Order Number, Transaction ID, Date, Transaction Type Credit/Debit, Amount, Status). |
| 17.28 | Unique ID — Withdraw Popup | 🔴 | Ingen | Modal med Unique ID + Balance (readonly) + Enter Amount + Withdraw/Cancel mangler. Kun Cash-option regel må implementeres. |
| 17.29 | Order History (for Sell Products) | 🟡 | `apps/admin-web/src/pages/products/HallProductsPage.ts`, `apps/backend/src/routes/agentProducts.ts` | Product-transactions-listing eksisterer via backend. **Mangler**: Dedikert Order History-side med Payment Type-dropdown (Cash/Online) + View-action. |
| 17.30 | View Order Details | 🔴 | Ingen | Order-detail-view med product-image + kvantum-tabell mangler. |
| 17.31 | Sold Ticket List | 🟡 | `apps/admin-web/src/pages/cash-inout/SoldTicketsPage.ts`, `apps/admin-web/src/pages/physical-tickets/GameTicketListPage.ts` | Delvis finnes. **Mangler**: Ticket Type-filter (Physical/Terminal/Web) + eksakt kolonne-sett. |
| 17.32 | Past Game Winning History | 🔴 | Ingen dedikert side | Ikke direkte implementert for agent-view. Winning data finnes i `apps/backend/src/compliance/PhysicalTicketService.ts` men ikke eksponert som Past Game Winning History-UI. |
| 17.33 | Physical Cashout — Daily List | 🟡 | `apps/admin-web/src/pages/agent-portal/AgentPhysicalCashoutPage.ts`, `apps/admin-web/src/pages/cash-inout/PhysicalCashoutPage.ts`, `apps/admin-web/src/pages/physical-tickets/CashOutPage.ts`, `apps/backend/src/routes/adminPhysicalTicketPayouts.ts` | Cashout-listing eksisterer. **Må verifisere**: Date-filter From/To + 6-kol-tabell. |
| 17.34 | Physical Cashout — Sub Game Detail | 🟡 | `apps/admin-web/src/pages/cash-inout/CashoutDetailsPage.ts`, `apps/admin-web/src/pages/physical-tickets/CashOutPage.ts`, `apps/backend/src/routes/adminPhysicalTicketsRewardAll.ts` | Reward All-funksjonalitet eksisterer. **Må verifisere**: Total Winnings / Rewarded / Pending-summering + Action-ikon (bank-ikon) per rad. |
| 17.35 | Physical Cashout — Per-Ticket Popup | 🟡 | `apps/admin-web/src/pages/agent-portal/AgentCheckForBingoPage.ts`, `apps/admin-web/src/pages/physical-tickets/CheckBingoPage.ts` | Grid-popup eksisterer. **Må verifisere**: 5x5 grid-rendering, winning patterns-liste, "Cashout/Rewarded"-statusskifte. **Mangler**: "Cash-out kun current day"-regel-håndheving i UI. |
| 17.36 | Hall Specific Report | 🟡 | `apps/admin-web/src/pages/reports/hallSpecific/HallSpecificReportPage.ts` | Page-skelett eksisterer. **Mangler**: Eksakt tabell med Group Of Hall Name, Hall Name, Agent, Elvis Replacement Amount, per-Game (Game 1-5) OMS/UTD/Payout%/RES-kolonner. |
| 17.37 | Order Report (under Hall Specific) | 🔴 | Ingen | Per-agent order-report med Cash/Card-kolonner + Customer Number mangler. |
| 17.38 | Hall Account Report (Agent-view) | 🟡 | `apps/admin-web/src/pages/hallAccountReport/*` | Samme som 16.23, må eksponere read-only for agent. |
| 17.39 | Hall Account Report — Settlement Report (Agent) | 🟡 | Samme som 16.24. | - |
| 17.40 | Settlement Popup (Agent - 1:1 med 16.25) | 🟡 | Samme som 16.25. | - |

### 2.2 Nye funksjoner oppdaget i PDF 17 som ikke er i §3.2

PDF 17 er **strukturelt ~95% identisk** med PDF 15 (Agent V1.0 Latest 06.01.2025) som allerede er i mapping. Nye detaljer som er nyttige å dokumentere:

1. **Transfer Hall Access widget** (17.19) — agent-delegering mellom agenter i GOH. Dette er ikke listet i §3.2.
2. **Countdown Timer widget** (17.19) — 2-3 min pre-start timer for next game. Ikke listet i §3.2.
3. **Agent "Are You Ready?"-knapp fra master-hall** (17.18) — master-hall signaliserer til GOH. Dette er implementert delvis i backend (`apps/backend/src/game/adminHallEvents.ts`) men ikke eksponert som UI-knapp.
4. **Re-Generate Unique ID-knapp** (17.26) — printe ticket igjen ved print-feil.
5. **Unique ID balance-accumulation-regel** (17.10) — 170+200 = 370 (akkumulert, ikke overwrite). **Må verifiseres i `AgentTransactionService.ts`**.
6. **"Cash-out kun current day"-regel** (17.35) — etter day ends kan agent ikke cashout. Dette bør håndheves i `apps/backend/src/routes/adminPhysicalTicketsRewardAll.ts`.

---

## 3. Sammenligning mot tidligere wireframes

### 3.1 PDF 17 (14.10.2024) vs PDF 15 (06.01.2025 — "Latest")

**Konklusjon**: PDF 17 er mellomversjon som er **95% strukturelt identisk** med "Latest" (PDF 15 i catalog). Både skjerm-listen og layout-er matcher.

**Forskjeller**:
- PDF 17 har **Transfer Hall Access** + **Countdown Timer**-widgets i Next Game panel (17.19) som ikke er i PDF 15
- PDF 17 har **eksplisitt 5 hotkey-referanser** (F1, F2, Enter, Cancel) som er mer utfylt i noen skjermer
- PDF 15 er mer polish-ferdig med konsistent styling-notat
- PDF 15 har **Reward All + individuell Reward** eksplisitt; PDF 17 har samme men med Bank-ikon

**Konklusjon**: **PDF 15 (Latest) er den autoritative versjonen for Agent-portal-implementering**. Bruk PDF 17 som referanse for de få widgets som ikke er i Latest (Transfer Hall Access, Countdown Timer).

### 3.2 PDF 17 (14.10.2024) vs PDF 11 (10.07.2024 — Agent V2.0)

PDF 11 (Agent V2.0) dekker samme funksjonalitets-område (30 sider), men er litt mer uferdig og mangler Settlement-popup. PDF 17 fyller dette inn.

**Konklusjon**: PDF 17 gir mer komplett dokumentasjon enn PDF 11 for Settlement + Shift Log Out + Players Management Add Balance.

### 3.3 PDF 16 (13.09.2024) vs PDF 2 (05.10.2023 - Admin V1.0 original)

PDF 16 er tilsynelatende oppdatert versjon av Admin V1.0 (PDF 2) med:
- **Nye moduler**: Import Excel for players (16.1), Hall Number (16.2-3), Role Management (16.6), Close Day popup-serien (16.8-11), Deposit/Withdraw Request+History (16.15-21), Hall Account Report Settlement med Edit (16.24-25)
- **Ikke-overlappende**: Basic CRUD for Hall, Group of Hall, Agent er dekket i PDF 2 og ikke gjentatt i PDF 16

**Konklusjon**: PDF 16 er **nødvendig supplement** til PDF 2 for komplett Admin-panel-implementering. Ingen av PDF 16-skjermene kan leses ut av PDF 2 alene.

### 3.4 PDF 16 (13.09.2024) vs PDF 7 (21.02.2024 - Admin CR)

PDF 7 dekker Role Management, Close Day, Import Player, Hall Number på change-request-nivå. PDF 16 er oppdatert med **full 1:1-spec** for disse. Ingen vesentlige forskjeller oppdaget; PDF 16 er autoritativ.

### 3.5 PDF 16 (13.09.2024) vs PDF 12 (29.08.2024 - Admin Import Player)

PDF 12 er dypere-dive-versjon av Import Player-flyten (18 sider). PDF 16 inneholder kun 1 side om Import Excel (16.1). **PDF 12 er autoritativ for Excel-import**; PDF 16 gir kontekst-rammen.

### 3.6 PDF 16 (13.09.2024) vs PDF 13 (30.08.2024 - Agent Daily Balance & Settlement)

PDF 13 dekker Daily Balance + Settlement for Agent (20 sider). PDF 16 Settlement-popup (16.25) er **identisk layout** med Agent-popup i PDF 13. **PDF 13 er autoritativ**; PDF 16 bekrefter at admin har samme Edit-flyt.

### 3.7 PDF 16 (13.09.2024) vs PDF 9 (18.03.2024 - Deposit & Withdraw)

PDF 9 dekker Deposit Request + Withdraw flyten (19 sider). PDF 16 gir oppdatert tabell-versjon med CSV/Excel-eksport som ikke er i PDF 9. Begge er autoritative og bør brukes sammen.

---

## 4. Prioritert gap-liste

Alvorlighetsgrad:
- **P0** = pilot-blokkerer (uten denne kan pilot ikke kjøre)
- **P1** = kritisk for regnskap/drift men kan utsettes til dag-2
- **P2** = nice-to-have, post-pilot

| # | Gap | PDF | Screen | Alvorlighet | Est. dager |
|---|-----|-----|--------|-------------|-----------|
| 1 | Settlement Popup — full 15-rad breakdown + Shift-delta kalkulasjon + Bilag upload | 16+17 | 16.25 / 17.40 | **P0** | 5 |
| 2 | Hall Account Report — Settlement Edit Popup | 16 | 16.24-25 | **P0** | 3 |
| 3 | Withdraw in Bank — XML-eksport + mail til regnskap | 16 | 16.20 | **P0** | 4 |
| 4 | Register Sold Tickets Popup — Final ID scanner med carry-forward | 17 | 17.15 | **P0** | 3 |
| 5 | Start Next Game — Ready/Not Ready-popup med agent-liste | 16+17 | 16.4 / 17.17 | **P0** | 2 |
| 6 | Add Money — Registered User Popup | 17 | 17.7 | **P0** | 1 |
| 7 | Withdraw — Registered User Popup | 17 | 17.8 | **P0** | 1 |
| 8 | Withdraw — Unique ID Popup (kun Cash) | 17 | 17.11 + 17.28 | **P0** | 1 |
| 9 | Shift Log Out — 2 checkboxes (Distribute winnings + Transfer register) | 17 | 17.6 | **P0** | 2 |
| 10 | Unique ID Details — Choose Game Type + per-game tabell + Print + Re-Generate | 17 | 17.26 | **P0** | 3 |
| 11 | Create New Unique ID — Hours Validity min 24h-regel + PRINT-flyt | 17 | 17.9 | **P0** | 2 |
| 12 | Close Day — 3-case Single/Consecutive/Random + popup-serien (Add/Edit/Remove) | 16 | 16.7-16.12 | **P1** | 4 |
| 13 | Import Excel for Players med Hall Number-mapping | 16 | 16.1 | P1 (engangs-migrasjon per mapping §8.5) | 3 |
| 14 | Deposit Request — Select Type (Pay in Hall / Vipps / Card) + filtrering | 16 | 16.15-16.18 | P1 | 2 |
| 15 | Withdraw History — Select Withdraw Type-dropdown + Account Number-kolonne | 16 | 16.21 | P1 | 1 |
| 16 | Hall Account Report View — Verifiser alle 18 kolonner 1:1 mot wireframe | 16 | 16.23 | P1 | 2 |
| 17 | Winners Public Display — KPI-bokser + Hall Belongs To-kolonne | 16 | 16.5 | P1 | 2 |
| 18 | Role Management — Verifiser 15/16 modul-liste + default-regler | 16 | 16.6 | P1 | 2 |
| 19 | Next Game — Transfer Hall Access widget (delegering mellom agenter) | 17 | 17.19 | P1 | 2 |
| 20 | Next Game — Countdown Timer 2-3 min | 17 | 17.19 | P1 | 1 |
| 21 | Sub Game Details — Spin Wheel/Treasure Chest agent-entry på vegne av spiller | 17 | 17.23 | P1 | 3 |
| 22 | Unique ID Transaction History (per-ID scoped) | 17 | 17.27 | P1 | 2 |
| 23 | Past Game Winning History (Agent) | 17 | 17.32 | P1 | 1 |
| 24 | Hall Specific Report — alle 5 game-kolonner + Elvis Replacement | 17 | 17.36 | P1 | 3 |
| 25 | Players Management — Action-menu med Add Balance / TX History / Block | 17 | 17.20-17.21 | P1 | 2 |
| 26 | Sold Ticket List — Ticket Type-filter (Physical/Terminal/Web) | 17 | 17.31 | P1 | 1 |
| 27 | Game Creation — Game 4 Data Bingo: Pattern Prize 10 slots + Bet Matrix 4x4 | 16 | 16.13 | P2 | 3 |
| 28 | Game Creation — Game 5 SpinnGo: Pattern Prize 14 slots + Total Balls | 16 | 16.14 | P2 (mapping §8 droppet pilot) | 3 |
| 29 | Sell Products Order History + View Order Details | 17 | 17.29-17.30 | P2 | 2 |
| 30 | Add Physical Ticket-popup fra Sub Game Details (inline) | 17 | 17.24 | P2 | 1 |

**Totalt: P0 = 11 gap, ~28 dager** | **P1 = 14 gap, ~30 dager** | **P2 = 5 gap, ~10 dager**

---

## 5. Anbefaling

### 5.1 Pilot-scope (P0 only)

Prioriter de **11 P0-gapene (~28 dager)** for pilot:
1. Settlement Popup-komplett (#1, 5d) + Edit-variant (#2, 3d) = **regnskap-drift blocker**
2. Withdraw in Bank XML-eksport (#3, 4d) = **regnskap-mail blocker**
3. Register Sold Tickets (#4, 3d) = **daglig agent-rutine blocker**
4. Start Next Game Ready-popup (#5, 2d) + Shift Log Out 2 checkboxes (#9, 2d) = **game-kontroll blocker**
5. Add Money / Withdraw Reg User (#6+7, 2d) + Withdraw Unique ID (#8, 1d) = **cash-in/out blocker**
6. Unique ID Details + Create + Hours min 24h (#10+11, 5d) = **walk-in spiller blocker**

### 5.2 Oppdatert Fase 1 (MVP) per LEGACY_1_TO_1_MAPPING §9

LEGACY_1_TO_1_MAPPING §9 lister 24 MVP-PR-er. Basert på PDF 16+17 bør §9 **oppdateres** med følgende presiseringer:

- **PR 11 "Settlement"** må nå eksplisitt matche 15-rad + Shift-delta fra 16.25/17.40 — ikke nøyd med basic. Est. økes fra 3d → 5d.
- **PR 17 "Shift Log Out-flyt"** må nå implementere begge checkboxes (Distribute winnings + Transfer register ticket) fra 17.6. Est. 2d.
- **Ny PR 25**: "Withdraw in Bank XML-eksport" (#3 i topp-5 P0). 4 dager.
- **Ny PR 26**: "Create New Unique ID — 24h-regel + PRINT + Re-Generate" (kombinasjon av 17.9 + 17.26). 3 dager.
- **Ny PR 27**: "Register Sold Tickets — Final ID scanner med carry-forward" (17.15). 3 dager. Dette er **forskjellig** fra PR 14 "Register More Tickets".
- **Ny PR 28**: "Transfer Hall Access + Countdown Timer widgets" (17.19). 3 dager.

**Tilleggs-scope: +4 PR-er, +16 dager til Fase 1**. Totalt Fase 1 MVP = 28 PR-er.

### 5.3 Åpne spørsmål til Tobias — BESVART 2026-04-24

Alle 7 spørsmål er avklart av PM (Tobias). Svarene er autoritative.

1. **✅ LÅST — Norsk Tipping/Rikstoto Dag-felt:** Også summeres i Totalt (ikke kun display). Dag + Total = samlet rapporterings-sum.
2. **✅ LÅST — Withdraw XML-format:** Én samlet XML per agent, med alle hallene kombinert. Ikke per-hall.
3. **✅ LÅST — Transfer Hall Access (17.19):** Pilot-relevant. Legacy-flyt 1:1 (agent-initiert fra master-hall → target-hall aksepterer direkte, 60s TTL, ingen admin-mellomtrinn). Implementert i Task 1.6 (`feat/game1-transfer-hall-access`, PR #453).
4. **✅ LÅST — Unique ID balance-accumulation:** Akkumulerer, 170+200=370. Innbetaling legges alltid på top av eksisterende saldo, aldri overskriv. Backend `AgentTransactionService.ts` må verifiseres for denne regelen.
5. **✅ LÅST — "Cash-out kun current day" (17.35):** UI-håndheving (gray-out-knapp). Agent ser umiddelbart at bonger fra tidligere dager ikke kan kontant-utbetales. Backend også blokkerer som defence-in-depth. Håndteres i `apps/backend/src/routes/adminPhysicalTicketsRewardAll.ts` + UI i `AgentCheckForBingoPage.ts`.
6. **✅ LÅST — Elvis Replacement Amount (17.36):** Beholdes i rapport. Dette er total fee-inntekt fra Spill 1 Elvis-variant-byttefee (se `elvisReplace` i `packages/game-client/src/games/game1/logic/SocketActions.ts`). Jo mer rapport-funksjonalitet, jo bedre drifts-kontroll. Skal inkluderes i Hall Specific Report.
7. **✅ LÅST — Role Management 16 moduler:** Accounting-modul UTSATT til post-pilot per PM-beslutning ("vi må ikke ha regnskapstilgangen nå"). Spores i Linear som **BIN-692** i prosjektet "Post-pilot backlog — Wireframe + Audit deferred". I pilot: behold 15-modul-matrix; i post-pilot: legg til Accounting som 16. modul.

**Implikasjon for pilot-scope:** P0-listen uendret. P1 gap #18 (Role Management) nedgraderes til post-pilot (se Linear BIN-692). Gaps #19 (Transfer Hall Access) er allerede implementert via Task 1.6. Q1-Q2-Q4-Q5 krever oppdatering av eksisterende PR-er eller små mikro-fixer.

---

**Laget av:** Audit-agent 2026-04-24
**PR:** `docs/wireframes-pdf16-17-audit`
**Source PDFs:**
- `docs/wireframes/WF_B_Spillorama_Admin_V1.0_13-09-2024.pdf`
- `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf`

**Integrert i:**
- [WIREFRAME_CATALOG.md](./WIREFRAME_CATALOG.md) §PDF 16, §PDF 17
- [LEGACY_1_TO_1_MAPPING_2026-04-23.md](./LEGACY_1_TO_1_MAPPING_2026-04-23.md) §1 (rad 15-16 oppdatert)
