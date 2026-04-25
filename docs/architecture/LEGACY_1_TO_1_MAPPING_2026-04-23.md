# Legacy 1:1 Mapping — 2026-04-23

Kartlegging av funksjonalitet i legacy Spillorama (`spillorama.aistechnolabs.info`) vs. nåværende Spillorama-system, basert på 18 wireframe-PDF-er fra tidligere utviklerteam (2023-03 → 2025-01).

**Spill-klassifisering** (per [SPILLKATALOG.md](SPILLKATALOG.md)): Spill 1, 2, 3 er **hovedspill** (live, server-trukket, min 15% til organisasjoner). SpinnGo (Spill 4 / Game 5 / slug `spillorama`) er **databingo** (forhåndstrukket per sekvens, min 30% til organisasjoner). Game 4 / `themebingo` er deprecated (BIN-496).

**Formål:** etablere komplett oversikt over hva som mangler for 1:1-paritet med legacy, prioritert for pilot (4 haller + Notodden-link).

**Konklusjon:** legacy-systemet er **to sammenvevde systemer** vi må ha oversikt over:
1. **Admin-panel** (som vi har bygget ~70% av)
2. **Agent-/bingovert-portal** (helt separat, som vi har bygget **~5% av**)

Uten Agent-portalen kan bingoverten ikke operere en fysisk hall. Dette er nå identifisert som den **største gjenværende pilot-blokkeren**.

---

## 1. Wireframe-kilder

| # | Fil | Dato | Sider | Dekker |
|---|---|---|---|---|
| 1 | `WF_B_Spillorama Admin V1.0.pdf` | 2023-03-24? | 38 | Admin V1.0: Dashboard, Players, Agent, Hall, Group of Hall, Game Management 1-4 |
| 2 | `WF_B_Spillorama Admin V1.0 - Game 1 - 24.3.2023.pdf` | 2023-03-24 | 34 | Game 1 dyp-spec: Schedule, DailySchedule, Sub Games, Manual/Auto, Unique ID, TV Screen |
| 3 | `WF_B_Spillorama Admin V1.0 - 5.10.2023.pdf` | 2023-10-05 | 13 | Mystery Game, oppdatert meny |
| 4 | `WF_F_Game 1, 2 & 3_V1.0 - 5.10.2023.pdf` | 2023-10-05 | 5 | Frontend for Game 1/2/3 (spiller) + Mystery |
| 5 | `WF_B_Spillorama_Game5_Admin_V1.0_23.11.2023.pdf` | 2023-11-23 | 12 | Game 5 / SpinnGo (databingo) admin med pattern multipliers |
| 6 | `WF_B_SpilloramaBotReport_V1.0_31.01.2024.pdf` | 2024-01-31 | 8 | Bot Game-checkbox + Report filter By Player/By Bot |
| 7 | `WF_B_Spillorama Admin_CR_21_02_2024_V1.0.pdf` | 2024-02-21 | 11 | Role Management, Close Day, Import Player, Hall Number, Start Game "not ready"-popup |
| 8 | `WF_F_Game_CR_21.02.2024_V1.1.pdf` | 2024-02-21 | 3 | Frontend login (Username/Phone/NickName), Landing (Open/Start@HH:MM/Closed), Profile Settings (self-exclusion, monthly limit) |
| 9 | `WF_B_Spillorama 18_03_2024_Deposit & withdraw.pdf` | 2024-03-18 | 19 | Deposit Request (Pay in Hall / Vipps / Card), Withdraw in Hall / Bank, Add email account |
| 10 | `WF_B_Spillorama Agent V2.0- 10.07.2024.pdf` | 2024-07-10 | 30 | Agent-portal V2 (Cash In/Out, Unique ID, Physical Cashout etc.) |
| 11 | `WF_B_Spillorama Admin- Import playerV1.0 - 29-08-2024.pdf` | 2024-08-29 | 18 | Excel-import for spillere, Hall Number-felt |
| 12 | `WF_B_Spillorama Agent-Daily balance & settlement V1.0 - 30.08.2024.pdf` | 2024-08-30 | 20 | Add Daily Balance, Settlement (Metronia/OK Bingo/Franco/Otium/Norsk Tipping/Rikstoto/Rekvisita/Kaffe/Bank) |
| 13 | `WF_B_Spillorama Screen Saver setting.pdf` | 2024-11 | 2 | Screen Saver på/av + multi-image + per-image tid |
| 14 | `WF_B_Spillorama Agent V1.0- 06.01.2025 (1).pdf` | 2025-01-06 | 30 | Siste Agent-portal-design |
| 15 | `WF_B_Spillorama Admin V1.0 - 13-09-2024.pdf` | 2024-09-13 | 21 | Admin V1.0: Approved Players+Import Excel, Hall Number, Ongoing Schedule (agents-not-ready-popup), Winners public display, Role Management, Close Day for Game 4+5, Deposit/Withdraw Request+History, Withdraw XML, Hall Account Report+Settlement (kilde til §4-6 nedenfor) |
| 16 | `WF_B_Spillorama Agent V1.0 - 14-10-2024.pdf` | 2024-10-14 | 30 | Agent V1.0 (mellomversjon mellom #11 og #14). Identisk struktur med #14 men tidligere polish. Bekrefter 1:1 paritet av dashboard, Cash In/Out, Settlement, Unique ID, Physical Cashout, Players Management, Unique ID Transaction History, Hall Specific Report, Order Report |
| 17 | `WF_F_Game 2 & 3_V1.0.pdf` | ukjent | — | **Ikke lest** |

**Handling:** PDF 15 + 16 integrert 2026-04-24 — se [WIREFRAME_PDF16_17_GAPS_2026-04-24.md](./WIREFRAME_PDF16_17_GAPS_2026-04-24.md) for gap-analyse. PDF 17 (`WF_F_Game 2 & 3_V1.0.pdf`) gjenstår å leses.

---

## 2. Nåværende kodestate (per 2026-04-23)

### Backend (`apps/backend`)
- ✅ BingoEngine (Game 1 runtime, 75-ball 5×5, all winning-types)
- ✅ Game2Engine + Game3Engine (mini-games)
- ✅ ScheduleService + SubGameService + GameManagementService
- ✅ PatternService (CRUD)
- ✅ HallService + GroupOfHallService + AgentService
- ✅ PlayerManagement (Approved/Pending/Rejected)
- ✅ CloseDayService (grunnleggende, BIN-627)
- ✅ PhysicalTicketService (PT1-PT5: CSV-import, AgentRange, batch-sale, payout, handover)
- ✅ DailyScheduleService + SpecialSchedule
- ✅ WalletService (deposit_balance + winnings_balance etter W1-W5)
- ✅ ComplianceManager (netto-tap, self-exclusion 1 år)
- ✅ MiniGamesConfigService (Wheel/Chest/Colordraft/Oddsen)

### Admin-web (`apps/admin-web`, ~167+ sider)
- ✅ Dashboard (KPI + ongoing — kun Game 1)
- ✅ GameType CRUD (BIN-620)
- ✅ SubGame CRUD
- ✅ GameManagement med DailySchedule-tabell (PR #402 NÅ — venter CI)
- ✅ Schedule Management (weekly + ScheduleDetail med strukturert sub-games-editor #400)
- ✅ Saved Game List
- ✅ Pattern CRUD
- ✅ CloseDay (basic)
- ✅ Hall / Group of Hall / Agent Management
- ✅ Players (Approved/Pending/Rejected) — listing
- ✅ CSV-eksport (BIN-583)
- ✅ System-info + audit-log UI
- ✅ Loyalty-admin (BIN-700)

### Spiller-klient (`packages/game-client`)
- ✅ Game 1 PixiJS-runtime (etter refaktor: SocketActions, MiniGameRouter, ReconnectFlow, ChatPanel)
- ✅ Game 2/3 runtime
- ✅ Spillvett-modal
- ✅ Lobby med hall-valg

### Agent-portal — **EKSISTERER IKKE**
Ingen dedikert bingovert-frontend. Verken lukket `/agent/*`-rute eller separat app.

---

## 3. Gap-analyse per modul

Legend:
- 🟢 = i kode, matcher legacy
- 🟡 = delvis i kode, har gaps
- 🔴 = mangler helt
- 🎯 = pilot-kritisk (MVP)

### 3.1 Admin-panel

| Modul | Status | Gap | Pilot? |
|---|---|---|---|
| Dashboard KPI | 🟡 | Top 5 Players mangler, ongoing-tabs kun Game 1 (ikke 2/3/4/5) | 🎯 |
| Players Approved | 🟢 | — | |
| Players Pending + **Approve/Reject-flyt** | 🟢 | Modal m/mandatory reason (min 10 tegn) + auto-email via retry-kø (BIN-702) | 🎯 |
| Players Rejected | 🟡 | Listing finnes, View-detalj + Delete mangler | |
| **Import Player (Excel)** | 🔴 | xls/xlsx bulk-import med Hall Number-mapping (Zerlyn→0, 100→100 Hamar osv.) | |
| Agent Management | 🟢 | Unassign-before-deactivate-check må verifiseres | |
| Hall Management | 🟡 | **Hall Number**-felt (101,102,...) + **Add Money (cash-balanse)**-popup mangler | 🎯 |
| Group of Hall | 🟢 | — | |
| **Schedule Management (weekly)** | 🟡 | Strukturert editor klar (#400). Men: ticket-colors (6 nivåer: Small/Large Yellow/White/Purple/Red/Green/Blue), per-color winning %, Mystery Game | 🎯 |
| **Game Management — Game 1 DailySchedule** | 🟢 | PR #402 — venter CI-merge | 🎯 |
| Game Management — Game 2/3/4/5 | 🟡 | Create/Edit/View-forms eksisterer delvis, men Jackpot-slots (9,10,11,12,13,14-21) med kr/% og Pattern Name+Prize mangler | |
| **Saved Game List (per Game)** | 🟢 | — | |
| **Unique ID Modules** | 🔴 | Generate (med 24h min validity, Print), List, Details, Re-generate, Withdraw | |
| **Close Day per Game** | 🟡 | Basic finnes. UI med Single/Consecutive/Random-dager (kalender-popup) mangler | |
| **Role Management** | 🔴 | `Agent Role Permission Table` (Create/Edit/View/Delete/Block-Unblock × 15 moduler) | |
| **Report Management — Game 1-5** | 🔴 | Oms/Utd/Payout%/Res-tabell + Print/Export + By Player/By Bot-filter | 🎯 (for drift) |
| **Game History** | 🔴 | Per-ticket winning-log (Online/Unique ID/Physical ticket) | |
| **Payout Management (Players + Tickets)** | 🔴 | Profit/Loss-tabell, View Tickets popup | |
| **Hall Account Report** | 🔴 | Daglig journal: Date, Day, Bingonet, Metronia, OK Bingo, Franco, Otium, Radio Bingo, Norsk Tipping, Norsk Rikstoto, Rekvisita, Kaffe, Bilag, Gevinst overf. Bank, Bank terminal, Innskudd dropsafe, Inn/ut kasse, Diff. Real/Bot-filter. Download PDF/CSV/Excel | 🎯 (regnskap) |
| **Hall Specific Reports** | 🔴 | Per-Game-kolonne for hver hall + agent-tilordning | |
| **Settlement Report** | 🔴 | Edit/download pr. skift (linker opp mot Agent Settlement) | 🎯 (regnskap) |
| **Deposit Request (Admin-side)** | 🔴 | Pay in Hall / Vipps / Card. Approve-Reject-flow | |
| **Deposit History** | 🔴 | — | |
| **Withdraw in Hall / Bank / History** | 🔴 | XML-eksport per hall til regnskap-mail, Accept/Decline | 🎯 (regnskap) |
| **Add email account** | 🔴 | Regnskaps-email-liste for XML-utsendinger | |
| **TV Screen + Winners-public display** | 🔴 | BINGO-header, vinner-highlight, pattern-tabell, voice-valg (Voice 1/2/3) | 🎯 (for hall) |
| **Screen Saver setting** | 🔴 | Multi-image m/per-image tid (1920×1080 kun PNG/JPG), før/etter login | |
| **Settings (Withdraw Limit)** | 🔴 | — | |
| **Bot Game-checkbox + No. of Games** | 🔴 | Pre-generer bot-games for å fylle hallen | |
| **Language toggle NO/EN** | 🔴 | Header-toggle, dynamisk oversettelse av både statisk og backend-data | |

### 3.2 Agent-/Bingovert-portal

**ALT i denne tabellen er 🔴 med mindre annet nevnt.** Dette er selve hjertet av hall-driften.

| Modul | Kompleksitet | Pilot? |
|---|---|---|
| **Agent Login** (samme authservice kan brukes, men separat app-skall) | Lav | 🎯 |
| **Agent Dashboard** (KPI, Latest Requests, Top 5 Players, Ongoing Games tabs Game 1-4, **Cash In/Out-knapp**, **Language toggle**, Profile/Logout) | Medium | 🎯 |
| **Cash In/Out Management** (Agent Name, Total Cash Balance, Cash In, Cash Out, Daily Balance, 6 knapper: Add/Withdraw Unique ID + Registered User, Create New Unique ID, Sell Products, Back, Shift Log Out, Today's Sales Report) | Høy | 🎯 |
| **Add Daily Balance** (kun v/skift-start, ikke mid-shift) | Lav | 🎯 |
| **Control Daily Balance** (submit Daily balance + Total cash balance) | Lav | 🎯 |
| **Settlement** (Metronia/OK Bingo/Franco/Otium IN-OUT-Sum + Norsk Tipping/Rikstoto dag+total + Rekvisita + Servering/kaffe + Bilag m/upload + Bank + Gevinst overføring + Annet + Drop-safe + Shift-diff) | Svært høy | 🎯 |
| **Shift Log Out** (med checkbox "Distribute winnings to physical players" + "Transfer register ticket to next agent") | Medium | 🎯 |
| **Add Money — Unique ID** (Enter Unique ID, Amount, Payment Type Cash/Card, YES/NO confirm) | Lav | 🎯 |
| **Add Money — Registered User** (Username, Amount, Payment Type) | Lav | 🎯 |
| **Create New Unique ID** (Purchase Date+Time, Expiry Date+Time, Balance Amount, Hours Validity 24h+, Payment Type, PRINT) | Medium | 🎯 |
| **Withdraw — Unique ID** (kun Cash) | Lav | 🎯 |
| **Withdraw — Registered User** | Lav | 🎯 |
| **Sell Products** (kiosk: Coffee/Chocolate/Rice kategorier, kvantum, Total Order Amount, Cash/Card) | Medium | |
| **Order History + View Order** | Lav | |
| **Next Game-panel** (Register More Tickets, Register Sold Tickets, Start Next Game, PAUSE/Resume, Info popup med Ready/Not Ready agents) | Høy | 🎯 |
| **Register More Tickets** (scan Initial-Final ID per Ticket Type, 6 farger: Small/Large Yellow/White/Purple+Large purple, stash-listing, F2 hotkey, autogen-increment) | Høy | 🎯 |
| **Register Sold Tickets** (per game, scan Final ID, resten carry-forward) | Høy | 🎯 |
| **Start Next Game** (only Manual-mode; "Agents not ready yet: Agent 1, 2, 4" popup, Jackpot-confirm, 2min-countdown) | Medium | 🎯 |
| **PAUSE Game and check for Bingo** (ticket-popup med 5×5 grid, pattern-highlight, Winning Patterns-liste Status: Cashout/Rewarded, Reward All-knapp) | Medium | 🎯 |
| **Check for Bingo** (Enter Ticket Number → GO → pattern-validate) | Medium | 🎯 |
| **Today's Sales Report** (shortcut til Hall-specific) | Lav | |
| **Physical Cashout** (per dato + sub-game, Reward All, per-ticket Rewarded-status) | Medium | 🎯 |
| **Past Game Winning History** (Date, Ticket ID, Type, Color, Price, Winning Pattern, filter) | Lav | |
| **Sold Ticket** (Date, Ticket ID, Type Physical/Terminal/Web, Color, Price, Winning) | Lav | |
| **Unique ID List** (filter, View, Transaction History, Withdraw) | Medium | 🎯 |
| **Unique ID Details** | Lav | 🎯 |
| **Transaction History** per Unique ID | Lav | |
| **Add Physical Ticket** (fra Sub Game Details, scan Final ID of Stack, Payment Type) | Medium | |
| **Players Management (Agent-side)** (Approved med Add Balance-popup + Block/Unblock + Transaction History fra action-menu) | Medium | |
| **Pending Requests periodic popup** (hvert 10-15 min) | Lav | |
| **Hall Account Report (Agent read-only view)** | Lav | |
| **Hall Specific Report (Agent)** | Lav | |

### 3.3 Spiller-frontend

| Funksjon | Status | Gap |
|---|---|---|
| Login | 🟡 | Legacy: Username/Phone/NickName + Password. Remember me + Forgot password |
| Landing (Bingo Games 1-5 som tiles) | 🟢 | Statuser: Open / Start @ HH:MM / Closed må matches med schedule |
| Profile Settings | 🟡 | Mangler: Language toggle, Block myself for, Set Limit (monthly — regulatorisk viktig), About Us, FAQ, T&C, Support, Responsible Gaming, Links of other agencies |
| Game 1 runtime | 🟢 | Number Completed, Pick Any Number, Lucky Number |
| Game 1 Mystery (inne i sub-game) | 🔴 | 10-bucket spin wheel, 10s timer, auto-play hvis ingen input, color-multiplier (yellow 2x white) |
| Game 2 (72-ball) | 🟡 | Jackpot-tall 9/10/11/12/13/14-21 med gain-beløp, Speed Dial (5/10/15/20/25/30 boards) |
| Game 3 (Pick any number 75-ball) | 🟡 | Speed Dial kvantum-valg |
| Buy Tickets-flyt | 🟡 | Midt i aktivt spill må være mulig fram til draw 3, men ikke etter notification trigger |
| Points-skjuling | 🔴 | Alle "Points"-labels må skjules fra Admin/Agent/Spiller-panelet |

---

## 4. Prioritert execution-plan

### Fase 1 — **MVP for pilot** (må-ha)

**Admin-panel:**
1. Approve/Reject Player-flyt med mandatory reason + auto-email (1 PR)
2. Hall Number-felt + Add Money-popup (cash-balanse per hall) (1 PR)
3. Report Management Game 1 (Oms/Utd/Payout%/Res + Print/Export) (1 PR)
4. Hall Account Report + Settlement Report (regnskap-drift) (2 PR-er)
5. Withdraw in Hall / Bank + Add email account + XML-eksport (1 PR)

**Agent-portal (ny app eller ny route-tree under admin-web):**
6. Agent-portal skelett: login + dashboard + routing (1 PR)
7. Cash In/Out Management-panel (1 PR)
8. Add Daily Balance + Control Daily Balance + Settlement (2 PR-er)
9. Unique ID: Create/Add Money/Withdraw/List/Details (2 PR-er)
10. Add Money / Withdraw — Registered User (1 PR)
11. Register More Tickets + Register Sold Tickets (scan-integrasjon) (2 PR-er)
12. Next Game panel: Start + PAUSE + Resume + Ready/Not Ready (1 PR)
13. Check for Bingo + Physical Cashout (med Reward All + Cashout/Rewarded-status) (2 PR-er)
14. Shift Log Out-flyt (1 PR)

**Public display:**
15. TV Screen + Winners-sider + voice-select per hall (1 PR)

**Frontend-spiller:**
16. Mystery Game-runtime (10-bucket spin wheel) (1 PR)
17. Points skjul + Landing Open/Start@HH:MM/Closed (1 PR)
18. Profile Settings Language/Block myself/Set Limit (1 PR)

**Totalt Fase 1: ~20 PR-er**

### Fase 2 — **Post-pilot** (høy verdi)

- Game Management Game 2/3/4/5 komplette admin-forms (Pattern Name & Prize, Bot Game, Close Day)
- Role Management (per-agent permissions)
- Import Player Excel
- Game History + Payout Management
- Hall Specific Reports
- Sell Products + Order History
- Past Game Winning History
- Deposit Request-flyt (Pay in Hall / Vipps / Card)
- Agent Players Management (Add Balance fra action-menu)
- Screen Saver Setting
- Language toggle NO/EN
- Pending requests periodic popup (hvert 10-15 min)

### Fase 3 — **Nice-to-have**

- SpinnGo (Spill 4 / Game 5, slug `spillorama`) — databingo runtime + admin
- Bot Game-runtime + Report filter By Player/By Bot
- Game 4 pattern-editor (Jackpot/Double H/2L/Pyram/V)
- Dashboard Top 5 Players-widget

---

## 5. Arkitektoniske beslutninger som må tas

### 5.1 Agent-portal: separat app eller ny route-tree?

**Alternativer:**
- **A)** Ny pakke `apps/agent-web` (speiler `apps/admin-web`-struktur). Isolerer bingovert-UI fullt ut.
- **B)** Ny route-tree `/agent/*` i `apps/admin-web` med auth-gate (role=AGENT).
- **C)** Felles shell-komponenter, men egne routes.

**Anbefaling:** **B** (ny route-tree i admin-web) fordi:
- Lavere vedlikehold (én build, én deploy)
- Gjenbruk av DataTable/Modal/Toast/i18n/auth
- Kan senere ekstraheres til egen app om nødvendig
- Bingoverten logger inn via samme endpoint, men redirect til `/agent` basert på role

### 5.2 TV Screen — public route eller egen app?

**Anbefaling:** Ny offentlig route `/tv/:hallId` i admin-web med:
- Full-screen layout uten nav
- Auto-refresh via websocket (samme `/admin-game1` ns eller ny `/tv`)
- Autentisering via hall-spesifikk token (eller IP-whitelist per hall)

### 5.3 Ticket Colors (6 farger)

Legacy har **8 farger**: Small/Large × Yellow/White/Purple, pluss Red, Green, Blue, Small Green.
Vi har per i dag kun Small/Large Yellow.

**Beslutning:** Utvide `ticket_color_enum` i DB + legge til winning-% per farge i `ScheduleSubGame`. Er ~2 dagers backend-jobb.

### 5.4 Physical Cashout-flow

Legacy: agent pauser spillet → enter ticket number → system viser pattern-check → Rewarded/Cashout-status → Reward All. Disse må integreres med:
- `PhysicalTicketService.registerCashout(ticketId, pattern)` i backend
- PixiJS pattern-rendering for visuell bekreftelse

### 5.5 Settlement

Settlement er **regulatorisk kritisk**. Det binder dagens omsetning + utbetaling + maskiner + kasse. 
**Beslutning:** Ny `SettlementService` + `app_hall_settlements`-tabell med:
- `shift_id`, `agent_id`, `hall_id`, `date`
- `machine_breakdown` (JSONB: Metronia/OK Bingo/Franco/Otium IN/OUT)
- `norsk_tipping_dag`, `norsk_tipping_total`, `norsk_rikstoto_dag`, `norsk_rikstoto_total`
- `rekvisita`, `kaffe_servering`, `bilag_amount + receipt_url`, `bank_amount`, `gevinst_overforing`, `annet`
- `drop_safe_in`, `drop_safe_out`, `shift_diff`, `notice`
- `bilag_receipt_url` (S3 el. Render disk)

---

## 6. Åpne spørsmål til Tobias

1. **Skal vi bygge Agent-portal som separat app eller som route-tree i admin-web?** (Min anbefaling: B)
2. **TV Screen — hvordan er autentisering ment?** (IP-whitelist, hall-token, noe annet?)
3. **Ticket Colors — skal vi utvide til alle 8 nå, eller bare Red+Green for pilot?**
4. **Bot Game — hvor viktig for pilot?** (Kan utsettes til Fase 2?)
5. **Import Player — hvor mange eksisterende spillere i legacy som skal migreres?** (Dette avgjør om vi trenger Excel-import nå eller en one-shot migrering)
6. **Settlement — hvilke maskin-typer skal egentlig dekkes?** (Wireframes har Metronia/OK Bingo/Franco/Otium men dette kan variere per hall)
7. **Norsk Tipping / Rikstoto — er disse API-integrasjoner eller manuell innlegging?** (Wireframe-kommentarer sier "API", men dette er uklart)
8. **Role Management — pilot-kritisk eller post-pilot?** (Kan alle agenter ha samme rettigheter initialt?)
9. **Screen Saver — skal dette være på player-client (kiosk-modus) eller admin-config?** (Begge er mulig i wireframene)

---

## 7. Umiddelbare neste handlinger

1. ✅ PR #402 (GameManagement DS) — venter CI
2. 🟡 Re-last `.crdownload`-filer (14.10.2024 Agent V1.0 + 13.09.2024 Admin V1.0) for komplett bilde
3. 🔴 Spawn 3 parallelle agenter på Fase 1-MVP-nr 1, 2, 3 (Approve/Reject, Hall Add Money, Report Management Game 1)
4. 🔴 Svar på §6 åpne spørsmål fra Tobias før større Agent-portal-arbeid starter

---

## 8. Arkitekturbeslutninger tatt 2026-04-23 (svar fra Tobias)

| # | Beslutning | Konsekvens |
|---|---|---|
| 1 | **Agent-portal:** Route-tree i `apps/admin-web` (`/agent/*`) | Redirect basert på role (ADMIN → `/admin/*`, AGENT → `/agent/*`). Samme build/deploy. |
| 2 | **TV Screen auth:** Hall-token i URL (`/tv/:hallId/:hallToken`) | Hver hall får unik token i DB (`app_halls.tv_token` UUID). Ingen IP-whitelist-krav initialt. |
| 3 | **Ticket Colors:** Utvid til alle 8 farger nå | Small/Large × Yellow/White/Purple + Red + Green + Blue + Small Green. DB-enum + winning % per farge på ScheduleSubGame. |
| 4 | **Bot Game:** Droppes | Simulering skjer på andre måter. Ingen `Bot Game`-checkbox eller `By Player/By Bot`-filter i rapporter. |
| 5 | **Import Player:** Engangs-migrering | Tobias deler Excel med ~6000 spillere. Vi lager script som kjøres én gang på prod. Permanent Excel-import kan bygges senere om nødvendig. |
| 6 | **Settlement:** Alle 4 maskiner + 1:1 wireframe | Metronia, OK Bingo, Franco, Otium (manuell innlegging). |
| 7 | **Norsk Tipping/Rikstoto:** Manuell innlegging | Verifisert mot wireframe. Admin-Hall Account Report har "API" for maskiner men resten er manuelt. |
| 8 | **Role Management:** 1:1 wireframe | Full `Agent Role Permission Table` med 15 moduler × 5 actions (Create/Edit/View/Delete/Block-Unblock). |
| 9 | **Screen Saver:** TV-skjermen (primær) + dedikerte terminaler (sekundær) | Admin-config definerer bilder + timing. Viser på TV når inaktiv + evt. hall-terminaler. IKKE på spiller-mobil. |

## 9. Oppdatert Fase 1 (MVP) basert på beslutninger

Med avgjørelsene over er MVP-scope justert:

**Admin-panel (6 PR-er):**
1. Approve/Reject Player-flyt (pågår — Agent 1)
2. Hall Number + Add Money (pågår — Agent 2)
3. Report Management Game 1 (pågår — Agent 3) — **uten By Bot-filter**
4. Schedule Management: Utvid til 8 ticket-colors + winning % per farge + Mystery Game
5. Hall Account Report + Settlement Report
6. Withdraw in Hall / Bank + Add email account + XML-eksport

**Agent-portal som route-tree i admin-web (11 PR-er):**
7. Login-gate: redirecter AGENT-role til `/agent/*`
8. Agent Dashboard
9. Cash In/Out Management-panel
10. Add Daily Balance + Control Daily Balance
11. Settlement (alle 4 maskiner + Norsk Tipping + Norsk Rikstoto manuelt)
12. Unique ID: Create/Add Money/Withdraw/List/Details
13. Add Money / Withdraw — Registered User
14. Register More Tickets + Register Sold Tickets (8 farger)
15. Next Game panel: Start + PAUSE + Resume
16. Check for Bingo + Physical Cashout
17. Shift Log Out-flyt

**Public display (1 PR):**
18. TV Screen `/tv/:hallId/:hallToken` + Winners + voice-select per hall

**Frontend-spiller (3 PR-er):**
19. Mystery Game-runtime
20. Points-skjul + Landing Open/Start@HH:MM/Closed
21. Profile Settings Language/Block myself/Set Limit

**Tillegg (3 PR-er):**
22. Role Management UI + backend enforcement (per-agent permissions)
23. Import Player: engangs-migrering av 6000 spillere fra Excel
24. Screen Saver: admin-config + TV-klient rendering

**Totalt: ~24 PR-er i Fase 1**

Post-pilot (Fase 2) krymper tilsvarende — Role Management og Screen Saver flyttes nå opp til MVP.

---

**Laget av:** PM-agent 2026-04-23
**Sist oppdatert:** 2026-04-23 (arkitekturbeslutninger tatt med Tobias)
**Status:** Beslutninger forankret. Fase 1 kan nå detaljeres og bygges.
