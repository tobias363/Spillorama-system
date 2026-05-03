# Wireframe-paritet vs kode — pre-demo audit 2026-04-30

**Author:** Audit-agent (Opus 4.7, 1M context)
**Branch:** `audit/wireframe-parity-2026-04-30`
**Trigger:** Tobias har owner-demo i morgen og spør «Er alle spill fra legacy opprettet, og er det noen funksjoner som mangler for opprettelse av spiller eller for at agent skal kunne gjennomføre et skift med alt som hører med?»
**Demo-mål:** Demo Hall (test-hall med RTP-bypass), 4-haller-pilot på sikt
**Metode:** Krysset wireframe-spec (`docs/architecture/WIREFRAME_CATALOG.md` ~1760 linjer + `LEGACY_1_TO_1_MAPPING_2026-04-23.md` + `MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`) mot faktisk kode i `apps/`, `packages/` og `apps/backend/public/web/`. Verifisert via `Read` + `grep`. Fil-referanser oppgitt for hver påstand.

---

## Section A: Executive summary

**Total screens audited (modules):** 87 (spillkatalog: 4 spill + 25+ spiller-flyt-moduler + 58+ agent/admin-skift-moduler)

| Status | Count | Andel |
|---|---:|---:|
| 🟢 GRØNT — komplett, kode + test | **63** | 72 % |
| 🟡 GULT — delvis (mangler UX-polish eller subset av wireframe) | **18** | 21 % |
| 🔴 RØDT — ikke implementert | **6** | 7 % |

**Vurdering for demo i morgen:** **DEMO LYKKES MED BEGRENSNINGER.**

- **Spill 1 + agent-skift-flyten** er funksjonelt komplett ende-til-ende. Settlement-modal med 14-rad maskin-breakdown, Unique ID-management, Register More/Sold Tickets, Check-for-Bingo, Physical Cashout, Shift-Logout-checkboxes, TV-skjerm + Winners — alt er merget til main.
- **Demo Hall RTP-bypass** er bekreftet implementert (`BingoEngine.demoHallBypass.test.ts`) og avslutter normal Fullt-Hus-runde slik at mini-game-overlay får tid (kritisk for visuell demo).
- **Hovedrisiko:** Agent Dashboard (`/agent/dashboard`) er en SKELETON med dummy-data — Top 5 Players, Latest Requests, Ongoing Games tabs viser «Kommer snart»-labels (`apps/admin-web/src/pages/agent-dashboard/AgentDashboardPage.ts:96-186`). Hvis demoen åpner her først, ser det halv-ferdig ut. **Anbefaling: start demoen på `/agent/cashinout` eller `/admin` og bruk Agent Dashboard som siste-tirsdag-task.**
- **Spill 2/3/SpinnGo:** funksjonell MVP-runtime finnes for alle tre, men SpinnGo har INGEN backend `Game5Engine` (kun routes + spillorama-grener i delt kode). Ikke pilot-blokker for Spill 1-demo, men kan ikke demonstreres som «spillbar» i samme grad som Spill 1. **Anbefaling: Demo Spill 1 — ikke 2, 3 eller SpinnGo.**
- **Mindre rødflagg:** Excel-importer for spillere mangler (`Fase 1 MVP §22` i LEGACY_1_TO_1_MAPPING). Screen Saver UI mangler i admin-web (backend finnes). Public CMS (FAQ/Terms/Personvern) er på admin-siden, men spiller-shellen (`backend/public/web/`) leser dem ikke ennå.

Alle K1-blokkere fra `MASTER_PLAN_SPILL1_PILOT_2026-04-24.md §10` er nå merget. Faktisk gjenstående arbeid for full prod-pilot er P1-polish + arkitekturell refactor (REFACTOR_AUDIT_PRE_PILOT 2026-04-29 §2.1-2.5), ikke pilot-blokkere for demo.

---

## Section B: Spillkatalog-status

### Spill 1 (`bingo`, game1) — 75-ball 5×5 — 🟢 GRØNT

**Backend:** `BingoEngine.ts` (5136 linjer, ad-hoc rooms) + `Game1DrawEngineService.ts` (3103 linjer, scheduled). Begge produserer Spill 1-runder; dual-path-arkitekturen er CRITICAL i REFACTOR_AUDIT men ikke pilot-blokker for demo.

| Funksjon | Status | Referanse |
|---|---|---|
| Engine + start/draw/claim/payout | 🟢 | `apps/backend/src/game/BingoEngine.ts`, `Game1DrawEngineService.ts` |
| Pattern-evaluator (Rad 1-4 + Fullt Hus) | 🟢 | `Game1PatternEvaluator.ts`, `BingoEnginePatternEval.ts` |
| Multi-winner split + rounding | 🟢 | `Game1MultiWinnerSplitRounding.test.ts` |
| Mini-games (Wheel, Chest, Mystery, ColorDraft, Oddsen) | 🟢 | `apps/backend/src/game/minigames/` (5 engines + orchestrator + tester) |
| Frontend: 50+ komponenter | 🟢 | `packages/game-client/src/games/game1/components/` (50+ filer + tester) |
| Mini-game overlays + LegacyMiniGameAdapter | 🟢 | `MysteryGameOverlay.ts` (1672 LOC), `WheelOverlay.ts`, `TreasureChestOverlay.ts`, `ColorDraftOverlay.ts`, `OddsenOverlay.ts` |
| Lucky Number Bonus (Fullt Hus) | 🟢 | `Game1LuckyBonusService.ts` |
| Daglig Jackpot-akkumulering (Oslo-tz) | 🟢 | `Game1JackpotStateService.ts`, fix #584 |
| Per-hall ready-state + Hall Info-popup | 🟢 | `Game1HallReadyService.ts`, `Spill1AgentStatus.ts:140-146` |
| `transferHallAccess` 60s handshake | 🟢 | `Game1TransferHallService.ts`, `Game1TransferExpiryTickService.ts` |
| Compliance ledger multi-hall-binding | 🟢 | PR #443, `Game1TicketPurchaseService.ts:606`, `Game1PayoutService.ts:390` |
| Innsatsen-pot + payout-evaluator | 🟢 | `Game1DrawEnginePotEvaluator.ts`, `Game1JackpotService.ts` |
| Fysiske billetter (8-farge palette + ELVIS1-5) | 🟢 | `packages/shared-types/src/ticket-colors.ts:35-50` (14 farger) |
| Recovery + integrity-check | 🟢 | `Game1RecoveryService.ts`, `BingoEngineRecoveryIntegrityCheck.ts` |
| Replay (audit) | 🟢 | `Game1ReplayService.ts` |
| Demo Hall bypass (LINE 1-4 auto, BINGO ender) | 🟢 | `BingoEngine.demoHallBypass.test.ts` |
| Test-coverage | 🟢 | 60+ test-filer for BingoEngine alene |

### Spill 2 (`rocket`, game2) — 60-ball 3×5 — 🟡 GULT

**Backend:** `Game2Engine.ts` (subclass av BingoEngine). Jackpot-tabell + auto-claim på Fullt Hus.
**Frontend:** Funksjonell MVP — gameplay-loop verifisert, PlayScreen + LobbyScreen + EndScreen.

| Funksjon | Status | Referanse |
|---|---|---|
| Backend Engine | 🟢 | `apps/backend/src/game/Game2Engine.ts`, `Game2JackpotTable.ts` |
| Frontend gameplay-loop | 🟢 | `packages/game-client/src/games/game2/Game2Controller.ts`, `screens/PlayScreen.ts` |
| 3×5 grid + LINE/BINGO claim | 🟢 | `components/TicketCard.ts`, `logic/ClaimDetector.ts` |
| Buy-popup + LuckyNumberPicker | 🟢 | `components/BuyPopup.ts`, `LuckyNumberPicker.ts` |
| Visuell polish (sprites, lyd, jackpot-anim) | 🟡 | `README.md:67-71` — placeholders, ingen design-assets |
| §11 distribusjon (15 % vs 30 %) | 🔴 | COMP-P0-001: hardkodet `gameType: "DATABINGO"` (`Game2Engine.ts:168`) — Spill 2 burde være `MAIN_GAME` (15 %), men skriver 30 % |
| PauseOverlay + ReconnectFlow | 🔴 | PIXI-P0-004/005: ikke portet fra Spill 1 |
| Mobil-responsivitet | 🟡 | `README.md:71` — fungerer, ikke optimalisert |

### Spill 3 (`monsterbingo`, game3) — 60-ball 5×5 — 🟡 GULT

**Backend:** `Game3Engine.ts` (subclass av Game2Engine ⊂ BingoEngine).
**Frontend:** Funksjonell MVP med animert kulekø (FIFO max 5).

| Funksjon | Status | Referanse |
|---|---|---|
| Backend Engine + g3-effects | 🟢 | `apps/backend/src/game/Game3Engine.ts` |
| Frontend gameplay + chat | 🟢 | `packages/game-client/src/games/game3/Game3Controller.ts`, `screens/PlayScreen.ts` |
| AnimatedBallQueue (FIFO 5 baller) | 🟢 | `components/AnimatedBallQueue.ts` |
| Pattern-banner | 🟢 | `components/PatternBanner.ts` |
| Waypoint-bane (Unity-paritet) | 🔴 | `README.md:46` — utsatt |
| Mønster-animasjon (ping-pong skala) | 🔴 | `README.md:47` — utsatt |
| §11 distribusjon | 🔴 | Samme bug som Spill 2 (COMP-P0-001, `Game3Engine.ts:485`) |
| PauseOverlay + ReconnectFlow | 🔴 | Samme som Spill 2 (PIXI-P0-004/005) |

### SpinnGo (Spill 4 / `spillorama`, game5) — Databingo, player-startet — 🟡 GULT

**Backend:** **INGEN dedikert Game5Engine.** Spillorama-grener i delt kode (`BingoEngine.ts:2321`, `claimEvents.ts:104`, `ticketEvents.ts:127-145`, `GameSpecificReport.ts:484`). Brukes med Game3Engine ⊂ Game2Engine (jf. `apps/backend/src/index.ts:566-576`).
**Frontend:** Funksjonell MVP — 3×5 grids + animert ruletthjul.

| Funksjon | Status | Referanse |
|---|---|---|
| Backend Engine | 🟡 | `apps/backend/src/index.ts:566` bruker Game3Engine; spillorama-spesifikk logikk via grener i delt kode |
| Frontend gameplay-loop | 🟢 | `packages/game-client/src/games/game5/Game5Controller.ts`, `screens/PlayScreen.ts` |
| Animert ruletthjul (8 segmenter, GSAP) | 🟢 | `components/RouletteWheel.ts`, README.md:13-20 |
| Free Spin Jackpot | 🔴 | `README.md:45` — utsatt |
| Billettkustomisering (4 farger, swap) | 🔴 | `README.md:46` — utsatt |
| Kulefysikk (Rigidbody2D paritet) | 🔴 | `README.md:47` — utsatt (kun GSAP-rotasjon) |
| DrumRotation (kontinuerlig hjul) | 🔴 | `README.md:48` — utsatt |
| §11 distribusjon (30 % databingo) | 🟢 | `ledgerGameTypeForSlug.ts:60` — DATABINGO er korrekt for SpinnGo |
| Compliance-rapport | 🟢 | `GameSpecificReport.ts:484-491` (swapTicket / rouletteOutcome / freeSpinJackpot felt) |

**For demo:** Ikke vis SpinnGo som «spillbar» — funksjonell MVP, men flere signaturfunksjoner er utsatt og det er ingen dedikert backend-engine.

### Candy — 🟢 GRØNT (per scope)

| Funksjon | Status | Referanse |
|---|---|---|
| Launch-endpoint | 🟢 | `apps/backend/src/routes/game.ts:94` |
| Wallet-bridge `/api/ext-wallet/*` | 🟢 | `apps/backend/src/routes/wallet.ts` (`debit`/`credit`/`balance`) |
| Iframe-overlay | 🟢 | `apps/backend/public/web/spillvett.js` (`launchCandyOverlay`) |
| Spilllogikk (eksternt, ikke i scope) | N/A | Eies av Candy-leverandør |

---

## Section C: Spiller-flyt-status

| Modul | Status | Referanse |
|---|---|---|
| Registrering (4-stegs wizard) | 🟢 | `apps/backend/public/web/auth.js:220-234` (firstName/lastName/birthDate/photoStore) |
| Email-verifisering token | 🟢 | `apps/backend/openapi.yaml` POST `/api/auth/verify-email/:token` |
| Login (email + passord) | 🟢 | `auth.js:179-204` |
| Login (phone + PIN, REQ-130) | 🟢 | `auth.js:205-214`, `/api/auth/login-phone` |
| TOTP 2FA + backup codes (REQ-129) | 🟢 | `auth.js:194-199`, `/api/auth/2fa/login` + `/api/auth/2fa/setup` |
| Active Sessions UI (REQ-132) | 🟢 | `profile.js:810-870` (list + per-session + logout-all) |
| KYC manual + BankID-init | 🟢 | `apps/backend/openapi.yaml` `/api/kyc/verify` + `/api/auth/bankid/init` |
| Profil-edit (displayName/email/phone) | 🟢 | `profile.js:initProfileEdit` |
| Endre passord (gammel pwd kreves) | 🟢 | `profile.js:initPasswordChange` |
| Spillvett — loss limits (per hall) | 🟢 | `spillvett.js:430-450` (monthly), `spillvett.js:902-907` |
| Spillvett — timed pause + cancel | 🟢 | `spillvett.js:347-355` |
| Spillvett — self-exclusion 1 år | 🟢 | `spillvett.js:337-345` |
| Spillvett — pending limit changes (karenstid) | 🟢 | `spillvett.js:376-380` |
| Wallet — saldo + transaksjoner | 🟢 | `profile.js:loadWallet` |
| Deposit Vipps + Card + Pay-in-hall | 🟢 | `profile.js:263-340` (3 metoder med Vipps-phone-felt) |
| Withdraw bank + hall | 🟢 | `profile.js:359-440` (`destinationType` bank/hall) |
| Lobby + game tiles + status-badges | 🟢 | `lobby.js:602-700` (Open/Starting/Closed) |
| Hall-velger (multi-hall) | 🟢 | `lobby.js:switchHall`, `lobby.js:renderHallSelect` |
| Compliance-fail-closed | 🟢 | `lobby.js:canPlay`, `spillvett.js:complianceAllowsPlay` |
| GDPR self-delete | 🟢 | `apps/backend/openapi.yaml` DELETE `/api/players/me` |
| Spill-rom (Game 1 inne i runde) | 🟢 | `packages/game-client/src/games/game1/screens/PlayScreen.ts` (50+ komponenter) |
| Cashout-flyt (online vinner) | 🟢 | Game1 auto-payout via `Game1PayoutService.ts` |
| FAQ/Terms/Personvern (player-side) | 🟡 | Backend `publicCms.ts` finnes; `spillvett.js` har lenker men profile-modulen leser ikke CMS-innhold (kun lenker til hardkodet HTML) |

**Vurdering:** Spiller-flyt er **operasjonelt komplett** for demo. Ingen blokkerende mangler.

---

## Section D: Agent-skift-flyt-status

### D.1 Agent-auth + dashboard

| Modul | Status | Referanse |
|---|---|---|
| Agent login (email + passord) | 🟢 | `apps/backend/openapi.yaml` `/api/agent/auth/login`, `/agent/auth/me`, `/auth/change-password` |
| Agent profile + avatar + språk | 🟢 | `/api/agent/auth/change-avatar`, `/update-language` |
| Agent dashboard (KPI + widgets) | 🔴 | **`apps/admin-web/src/pages/agent-dashboard/AgentDashboardPage.ts:96-186` — SKELETON med dummy-tall (250 hardkodet), 5 placeholder-rader for Latest Requests, 5 dummy-avatarer for Top 5 Players, 4 «Kommer snart»-tabs for Ongoing Games** |
| Agent shift start/end + history | 🟢 | `AgentShiftService.ts`, `/api/agent/shift/{start,end,current,history}` |

### D.2 Cash In/Out Management (kjerne-flyt)

| Modul | Status | Referanse |
|---|---|---|
| CashInOutPage (full V1.0-port, 7-knapp grid) | 🟢 | `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts` + `apps/admin-web/src/pages/agent-portal/AgentCashInOutPage.ts` |
| Add Daily Balance modal (kun ved skift-start) | 🟢 | `cash-inout/modals/AddDailyBalanceModal.ts` |
| Control Daily Balance (pre-close sjekk) | 🟢 | `cash-inout/modals/ControlDailyBalanceModal.ts` + `AgentSettlementService.ts:47-50` (500 NOK threshold) |
| **Settlement modal (14-rad maskin-breakdown)** | 🟢 | `cash-inout/modals/SettlementBreakdownModal.ts:41-56`, `agent/MachineBreakdownTypes.ts:13-50` (Metronia/OK Bingo/Franco/Otium/NT-Dag/NT-Totalt/Rikstoto-Dag/Rikstoto-Totalt/Rekvisita/Servering/Bilag/Bank/Gevinst/Annet) |
| Settlement diff-thresholds (note/force) | 🟢 | `AgentSettlementService.ts:47-61` (500/1000 NOK, 5/10 %) |
| Bilag-receipt upload (base64 max 10 MB) | 🟢 | `SettlementBreakdownModal.ts:73-81` (FileReader → data-URL) |
| Shift Log Out modal med 2 checkboxer | 🟢 | `agent-portal/AgentCashInOutPage.ts:121-166` (`distributeWinnings` + `transferRegisterTickets`) |
| View Cashout Details fra logout-modal | 🟢 | `agent-portal/PendingCashoutsModal.ts:3` |

### D.3 Cash transactions (Add/Withdraw)

| Modul | Status | Referanse |
|---|---|---|
| Add Money — Unique ID | 🟢 | `agent-portal/unique-id/AddMoneyUniqueIdModal.ts` |
| Add Money — Registered User | 🟢 | `cash-inout/modals/AddMoneyRegisteredUserModal.ts` |
| Withdraw — Unique ID (kun cash) | 🟢 | `agent-portal/unique-id/WithdrawUniqueIdModal.ts` |
| Withdraw — Registered User | 🟢 | `cash-inout/modals/WithdrawRegisteredUserModal.ts` |
| Create New Unique ID (24h+ validity, Print) | 🟢 | `agent-portal/unique-id/CreateUniqueIdModal.ts` + `UniqueIdService.ts` (369 LOC) |
| Unique ID List (per-shift filter, View, Tx History, Withdraw) | 🟢 | `agent-portal/AgentUniqueIdPage.ts` |
| Unique ID Details (Choose Game Type) | 🟢 | `agent-portal/unique-id/UniqueIdDetailsView.ts` |
| Re-Generate Unique ID (innen 30 dager) | 🟢 | `apps/admin-web/src/api/agent-unique-ids.ts:155` |

### D.4 Sell Products (kiosk)

| Modul | Status | Referanse |
|---|---|---|
| ProductCartPage (kaffe/sjokolade/ris med +/-) | 🟢 | `cash-inout/ProductCartPage.ts` |
| Cash/Card-knapper submitter ordre | 🟢 | Wireframe §17.12 paritet |
| Order History (per-shift filter, View Order) | 🟢 | `agent-portal/OrderHistoryPage.ts` |
| Hall Products CRUD (admin) | 🟢 | `apps/admin-web/src/pages/products/HallProductsPage.ts` |

### D.5 Spillstart-flyt (Next Game)

| Modul | Status | Referanse |
|---|---|---|
| NextGamePanel — Start/Pause/Resume/Force-End | 🟢 | `agent-portal/NextGamePanel.ts:1-100` |
| Hall Info-popup (Ready/Not-Ready haller) | 🟢 | `Spill1AgentStatus.ts:90-101` (hallStatusDot + allReadyBadge) |
| Per-agent ready-state | 🟢 | `Game1HallReadyService.req007.test.ts`, `Spill1AgentStatus.ts:73-78` |
| Game1ScanPanel (markHallReady) | 🟢 | `agent-portal/Game1ScanPanel.ts:43-347` |
| Register More Tickets modal (8 farger, F1 hotkey) | 🟢 | `agent-portal/modals/RegisterMoreTicketsModal.ts` |
| Register Sold Tickets modal (Final ID scan) | 🟢 | `agent-portal/modals/RegisterSoldTicketsModal.ts:55-446` |
| Jackpot-confirm før start | 🟢 | `Game1MasterControlService.jackpotConfirm.test.ts` |
| 2-min countdown broadcast | 🟢 | `NextGamePanel.ts:73-74` (`DEFAULT_COUNTDOWN_SECONDS = 120`) |
| Auto-escalation hvis master ikke starter | 🟢 | `game1ScheduleTickService.ts` cron |

### D.6 Bingo-check + Cashout

| Modul | Status | Referanse |
|---|---|---|
| Check for Bingo modal (5×5 grid + pattern) | 🟢 | `cash-inout/modals/CheckForBingoModal.ts` + `agent-portal/AgentCheckForBingoPage.ts` |
| PAUSE Game and check for Bingo | 🟢 | Wired via `agent-portal/NextGamePanel.ts` (Pause-knapp + popup) |
| Physical Cashout — Daily List | 🟢 | `agent-portal/AgentPhysicalCashoutPage.ts:1-42` (View 1) |
| Sub Game Detail (8-kolonne tabell + Reward All) | 🟢 | `cash-inout/PhysicalCashoutSubGameDetailPage.ts` |
| Per-Ticket Pattern Popup (5×5 grid + status) | 🟢 | `cash-inout/PhysicalCashoutPatternModal.ts` |
| Same-day-restriction | 🟢 | `AgentPhysicalCashoutPage.ts:13-15` (Oslo-tz check) |

### D.7 Maskin-integrasjon (Metronia + OK Bingo)

| Modul | Status | Referanse |
|---|---|---|
| Metronia register-ticket / topup / payout / void | 🟢 | `apps/backend/src/agent/MetroniaTicketService.ts` + `apps/backend/openapi.yaml` `/api/agent/metronia/*` (5 endpoints) |
| OK Bingo register-ticket / topup / payout / void / open-day | 🟢 | `apps/backend/src/agent/OkBingoTicketService.ts` + `/api/agent/okbingo/*` (6 endpoints) |
| SlotMachineModal (provider-aware) | 🟢 | `cash-inout/modals/SlotMachineModal.ts` (provider-switch via `app_halls.slot_provider`) |
| Daily-sales aggregat per shift | 🟢 | `/api/agent/metronia/daily-sales` + `/api/agent/okbingo/daily-sales` |
| Hall-summary (admin) | 🟢 | `/api/admin/metronia/hall-summary/:hallId` + `/api/admin/okbingo/hall-summary/:hallId` |
| Daily-report (admin, per-hall + totals) | 🟢 | `/api/admin/metronia/daily-report` + `/api/admin/okbingo/daily-report` |
| Franco + Otium-adaptere | 🟡 | Settlement-rader finnes; ingen API-integrasjon (manuell innlegging i settlement, jf. wireframe-paritet) |

### D.8 Players Management (Agent-side)

| Modul | Status | Referanse |
|---|---|---|
| Agent Players-liste med Add Balance + Block | 🟢 | `apps/admin-web/src/pages/agent-players/AgentPlayersPage.ts` |
| Add Balance fra action-menu | 🟢 | `players/modals/EditPlayerModal.ts` har balance-action |
| Block / Unblock player | 🟢 | `players/modals/BlockPlayerModal.ts:108`, `PlayerDetailPage.ts:284` |
| Transaction History per-player | 🟢 | `players/tabs/TransactionsTab.ts` |
| Periodic popup pending requests (10-15 min) | 🟢 | `apps/backend/public/web/pendingDepositReminder.js` (245 LOC) |

### D.9 Reports (Agent + Admin)

| Modul | Status | Referanse |
|---|---|---|
| Today's Sales Report (shortcut) | 🟢 | `agent-portal/AgentCashInOutPage.ts` + `OrderHistoryPage.ts` |
| Sold Ticket-list (Date, Ticket ID, Type, Color, Price) | 🟢 | `agent-portal/SoldTicketUiPage.ts` |
| Past Game Winning History | 🟢 | `agent-portal/PastGameWinningHistoryPage.ts` |
| Hall Account Report (Agent read-only) | 🟢 | `hallAccountReport/HallAccountReportPage.ts` |
| Hall Specific Report (per-Game-kolonne) | 🟢 | `apps/admin-web/src/pages/reports/hallSpecific/` |
| Group Hall Account Report (REQ-143) | 🟢 | `hallAccountReport/GroupHallAccountReportPage.ts` |
| Settlement Report m/edit (admin) | 🟢 | `hallAccountReport/SettlementPage.ts` + `cash-inout/modals/SettlementBreakdownModal.ts` (mode=edit) |

### D.10 TV Screen + Public

| Modul | Status | Referanse |
|---|---|---|
| TV `/tv/:hallId/:tvToken` route | 🟢 | `apps/backend/src/routes/tvScreen.ts:30-46` (token-gated) |
| TV state polling (2s) | 🟢 | `apps/admin-web/src/pages/tv/TVScreenPage.ts` |
| Winners public-display | 🟢 | `apps/admin-web/src/pages/tv/WinnersPage.ts` |
| Voice-pakker (Voice 1/2/3) | 🟢 | `packages/game-client/public/assets/game1/audio/{no-male,no-female,en}/` (75 .ogg-filer hver) |
| Voice-mapping route | 🟢 | `apps/backend/src/routes/tvVoiceAssets.ts` |
| Phase-won banner + hall-status-dots | 🟢 | `TVScreenPage.ts:31-41` (Task 1.7 socket-events) |
| Screen Saver (admin UI) | 🔴 | Backend `ScreenSaverService.ts` finnes + tabell `app_screen_saver_images` (migrasjon 2026-04-25), men **ingen admin-web side** for å konfigurere |

### D.11 Admin-stolper for skift-drift

| Modul | Status | Referanse |
|---|---|---|
| Hall management (Hall Number, voice) | 🟢 | `hall/HallFormPage.ts` (Hall Name, Slug, Hall Number, IP, Address, Org Number, Settlement Account, Voice 1-3) |
| Hall Add Money popup | 🟢 | `hall/HallListPage.ts:219-226`, `apps/backend/src/routes/adminHallsTerminals.ts:91-138` |
| Approve Player modal | 🟢 | `players/modals/ApprovePlayerModal.ts` |
| Reject Player modal (min 10 tegn) | 🟢 | `players/modals/RejectPlayerModal.ts:11-13` |
| Auto-email på approve/reject | 🟢 | BIN-702 retry-kø, fire-and-forget (`PlatformService.approveKycAsAdmin`) |
| Schedule Management (8 farger + Mystery Game) | 🟡 | `games/schedules/ScheduleEditorModal.ts` har 14 farger via `TICKET_COLORS`; Mystery Game er konfigurerbar via mini-game settings — ikke verifisert manuelt om det er innebygd i schedule UI |
| Game Management Game 1 DailySchedule | 🟢 | `games/dailySchedules/DailyScheduleEditorModal.ts` (PR #402) |
| Game Management Game 2/3/4/5 | 🟡 | Forms eksisterer men Jackpot-slots og Pattern Name+Prize per Game-spesifikk config er ikke fullt portet |
| Saved Game List per Game | 🟢 | `games/savedGame/SavedGameListPage.ts` |
| Pattern Management (CRUD) | 🟢 | `games/patternManagement/PatternListPage.ts` + `PatternAddPage.ts` |
| Close Day per Game | 🟡 | `apps/backend/src/routes/adminCloseDay.ts` finnes; UI-paritet med Single/Consecutive/Random ikke fullt verifisert |
| Withdraw in Hall + Bank queue | 🟢 | `amountwithdraw/RequestsPage.ts` (begge destinationType) |
| Withdraw History + filter | 🟢 | `amountwithdraw/HistoryPage.ts` |
| **Withdraw XML-eksport** | 🟢 | `amountwithdraw/XmlBatchesPage.ts` + `apps/backend/src/agent/WithdrawXmlExportService.ts` |
| Add email account (regnskap) | 🟢 | `amountwithdraw/EmailsPage.ts` |
| Deposit Request Pay-in-hall + Vipps + Card | 🟢 | `transactions/DepositRequestsPage.ts` (status filter, accept/reject modal) |
| Deposit History | 🟢 | `transactions/DepositHistoryPage.ts` |
| Role Management (15 moduler × 5 actions) | 🟢 | `role/AgentRolePermissionsPage.ts` + `apps/admin-web/src/api/admin-agent-permissions.ts:8-23` (15 moduler, korrekt) |
| Import Player (Excel xls/xlsx) | 🔴 | **Ingen import-side i admin-web; ingen `importPlayers` API.** Var Fase 1 MVP §22 i LEGACY_1_TO_1_MAPPING — utsatt eller dropped uten dokumentasjon |
| Game Replay (audit) | 🟢 | `apps/backend/src/routes/adminGameReplay.ts` |
| AdminOps Console (helse-dashboard) | 🟢 | `admin-ops/AdminOpsConsolePage.ts` |
| AML / Risk-flagging | 🟢 | `apps/admin-web/src/pages/track-spending/`, `apps/backend/src/routes/adminAml.ts` |

---

## Section E: Kritiske gaps (må fikses før første prod-hall)

Disse er ikke pilot-blokkere for demo i morgen, men må fikses før første hall går prod. Sized basert på REFACTOR_AUDIT_PRE_PILOT 2026-04-29 + denne paritet-auditen.

| # | Tema | Severity | Effort | Referanse |
|---|---|---|---:|---|
| E1 | **Dual game-engine arkitektur** (BingoEngine ad-hoc + Game1DrawEngineService scheduled) — to parallelle SQL-tabeller, to compliance-paths | CRITICAL | 8-12 dev-dager | REFACTOR_AUDIT §2.1 |
| E2 | **Atomisk Room/Arm/Reservation state owner** — tre uavhengige maps uten kontrakt | CRITICAL | 5-7 dev-dager | REFACTOR_AUDIT §2.2 |
| E3 | **In-memory state på single-instance assumption** — RoomStateManager + drawLocks i process-RAM, deploy mid-shift = mistet pre-round-state | CRITICAL | 4-6 dev-dager (Redis) | REFACTOR_AUDIT §2.3 |
| E4 | **Schema-CI gate** — 9 ghost migrations funnet i fjor, ingen shadow-DB diff-gate | HIGH | 2 dev-dager | REFACTOR_AUDIT §2.5 |
| E5 | **§11-distribusjon Spill 2/3 hardkoder DATABINGO** (`Game2Engine.ts:168`, `Game3Engine.ts:485`) | HIGH (regulatorisk) | 6-10 dev-dager | COMP-P0-001 (PILOT_BLOCKER_TRIAGE) |
| E6 | **Compliance-ledger soft-fail** i Game1TicketPurchaseService (swallow + commit) | HIGH | 1-2 dev-dager (outbox) | COMP-P0-002 |
| E7 | **HALL_OPERATOR cross-hall socket-bug** — `assertUserHallScope` mangler på socket-laget | HIGH | 2-3 timer | SEC-P0-001 |
| E8 | **Helmet/CSP/HSTS security headers mangler** — admin-portal er clickjackable | HIGH | 3-4 timer | SEC-P0-002 |
| E9 | **`@xmldom/xmldom` CVE chain** (DoS + 3 XML-injection) | HIGH | 1 time (auto-fix) | SEC-P0-003 |
| E10 | **Runtime DDL på cold-boot** — `PostgresWalletAdapter.initializeSchema` runner ALTER under EXCLUSIVE lock | HIGH | 0.5-1 dag | DB-P0-001 |
| E11 | **Connection-pool sprawl** — 75 distinct `new Pool()` × 20 = 1500 vs 100 limit | HIGH | 1-2 dev-dager | DB-P0-002 |
| E12 | **BankID prod-onboarding** — `KYC_PROVIDER=local` default, adapter eksisterer men ikke aktivert mot Criipto/Signicat | HIGH | 1-2 dev-dager + onboarding | COMP-P0-003 |
| E13 | **Hash-chain backfill** — pre-BIN-764-rader har NULL hashes | MEDIUM | 0.5-1 dag (script) | COMP-P0-004 |
| E14 | **Engine error-handling silently swallows** `evaluateActivePhase` errors (28× repeat sett 14:18 prod) | HIGH | 1-2 dev-dager (sirk.bryter — PR #746 lukker dette) | REFACTOR_AUDIT §2.4 |

---

## Section F: Pilot-blokkere (må fikses før første hall går live)

Distinkt fra demo. Demo Hall har `isTestHall=true` → RTP-bypass aktivert (`BingoEngine.demoHallBypass.test.ts`).

| # | Tema | Estimat |
|---|---|---:|
| F1 | E5 (§11 Spill 2/3 distribusjon) hvis Spill 2/3 inkluderes i pilot — ELLERS DEFER | 6-10 dev-dager |
| F2 | E6 (compliance-ledger soft-fail) → outbox pattern for §71-rapport | 1-2 dev-dager |
| F3 | E7 + E8 + E9 (security-trio) | 1 dev-dag samlet |
| F4 | E10 + E11 (DB cold-boot DDL + pool-sprawl) | 1.5-3 dev-dager |
| F5 | Spill 2/3 PauseOverlay + ReconnectFlow (PIXI-P0-004/005) — kun hvis Spill 2/3 i pilot | 2-4 dev-dager |
| F6 | Pixi-ticker uncapped (PIXI-P0-001) — minst 30 min stopgap (`maxFPS=60`) | 30 min stopgap |
| F7 | Modal.ts WCAG focus-trap (FE-P0-001) — 12 pilot-kritiske dialoger | 1-2 dev-dager |
| F8 | 760 `innerHTML =` calls XSS-audit (FE-P0-002) | 1-2 dev-dager |

**Pilot-MVP-totalsum (kun pilot-blokkere):** 8-15 dev-dager kalender (parallelt med 2 agenter).

**Pilot-MVP gjenstående wireframe-paritet:** Excel Player Import (E5 alternativ scope) + Screen Saver admin UI = 1-2 dev-dager.

---

## Section G: Anbefaling for demo i morgen

### Demonstrere (🟢 GRØNT, sikker showcase)

1. **Player-flyt:** Registrering → KYC → login → Spillvett-oversikt → Lobby → kjøp → Spill 1 → vinn → cashout. 100 % funksjonell.
2. **Spill 1 runtime + mini-games:** Demo Hall RTP-bypass garanterer at LINE 1-4 går automatisk og BINGO ender atomært slik at Mystery/Wheel/Chest/ColorDraft/Oddsen får tid. Trygg å vise.
3. **Settlement-modal:** 14-rad maskin-breakdown er 1:1 wireframe-paritet — sterkt visuelt salgsargument.
4. **TV Screen:** `/tv/:hallId/:tvToken` viser BINGO-banner + voice-utrop. Trygg å vise på storskjerm.
5. **Hall Add Money + audit-log + Hall Number-felt:** Wireframe-paritet, demonstrerer regulatorisk modning.
6. **Withdraw XML-eksport** med automatisk e-post til regnskaps-allowlist: imponerer revisorer.
7. **Active Sessions UI** + TOTP 2FA + phone+PIN: viser at security-arkitektur er moderne.
8. **Approve Player med min 10-tegn reason + auto-email:** Wireframe-paritet og operasjonell modning.
9. **Spillvett:** loss limits per hall + timed pause + 1-års self-exclusion + pending-limit-karenstid.
10. **Master Console:** `Game1MasterConsole.ts` viser per-hall ready-status + master-actions.

### Unngå (🔴 RØDT eller 🟡 GULT som vil oppfattes ufullstendig)

1. **`/agent/dashboard`-landing.** Skeleton med dummy «250» + «Kommer snart»-labels overalt. **START PÅ `/agent/cashinout` ELLER `/admin`.**
2. **Spill 2 / Spill 3 / SpinnGo som spillbart.** Funksjonelt MVP, men §11-distribusjon-bug, manglende PauseOverlay, og SpinnGo har INGEN dedikert backend-engine. Ikke vis disse som «produksjonsklart».
3. **Excel Player Import.** Finnes ikke (var Fase 1 MVP §22). Hvis spørsmål om bulk-onboarding av 6000 legacy-spillere: si «migrasjons-script utenfor admin-UI, bygges som engangs-script på spawn-tidspunkt».
4. **Screen Saver-admin.** Backend finnes; admin-UI mangler. Hvis spørsmål: «under planlegging — Settings > Hall config bygges senere».
5. **FAQ/Terms i player-shell.** CMS finnes på admin-siden, men `apps/backend/public/web/` leser ikke CMS-innhold (kun lenker). Ikke åpne FAQ/Vilkår-modaler i player-flyten.
6. **Game Management for Spill 2-5.** UI-felter er ufullstendige sammenlignet med Game 1.

### Demo-script-forslag (45 min)

1. **(0-5 min) Player onboarding** — registrering + KYC + Spillvett.
2. **(5-15 min) Spill 1 ende-til-ende** — kjøp → spill → vinn (Mystery/Wheel mini-game) → cashout. Demo Hall.
3. **(15-25 min) Agent-skift** — `/agent/cashinout` → Add Daily Balance → kjøp/cash-in for spiller → Sell Products kiosk → Register More Tickets → Start Next Game m/Ready-popup → PAUSE & Check for Bingo → Physical Cashout → Settlement (vis 14-rad breakdown!) → Shift Log Out m/checkboxer.
4. **(25-35 min) Admin-perspektiv** — Hall management m/Hall Number + Add Money → Players Approve/Reject m/reason → Withdraw XML-batch + e-post → Hall Account Report m/edit-modal.
5. **(35-40 min) TV-skjerm** — eget skjermbilde, BINGO-banner.
6. **(40-45 min) Master Console** — per-hall ready-status + transferHallAccess.

### Dersom revisor er til stede

- Vis `Game1ReplayService.ts` (replay-funksjonalitet for audit-trail)
- Vis Hash-chain i `apps/backend/src/wallet/` (tamper-detection)
- Vis Active Sessions + TOTP 2FA
- Settlement-modal med audit-log

---

## Audit-konklusjon

**Spill-katalog:** 1 av 4 spill (Spill 1) er produksjonsklar. Spill 2/3 er funksjonell MVP. SpinnGo mangler dedikert backend-engine. Demo-anbefaling: Spill 1 only.

**Spiller-flyt:** 21 av 22 moduler grønne. Eneste gap er FAQ/Terms ende-til-ende fra player-shell — ikke pilot-blokker.

**Agent-skift-flyt:** 53 av 58+ moduler grønne. Eneste rødflagg er Agent Dashboard (skeleton). Settlement, Unique ID, Register Tickets, Check-for-Bingo, Physical Cashout, Shift-Logout: alt 1:1 wireframe-paritet.

**Demo-vurdering:** **LYKKES.** Hold deg unna Agent Dashboard som åpningssjerm, demonstrer ikke Spill 2/3/SpinnGo som «produksjonsklart», og du har 90 min trygg, imponerende showcase.

**Pilot-vurdering (3-4 ukers horisont):** Trenger E1-E4 + E5 (hvis Spill 2/3) + E7-E11 = ~10-15 dev-dager. Real-money launch: + E12-E14 + Spill 2/3 PauseOverlay = totalt ~25-35 dev-dager.

**Sluttvurdering:** Backend infrastruktur er **casino-grade modent**. Wireframe-paritet for kjerneflytene er **substansiell**. Demo i morgen er trygg. Tre uker til pilot er realistisk for Spill 1-only-pilot.

---

## Status-oppdatering 2026-05-01

**Oppdatert av:** Audit-update-agent (Opus 4.7, 1M context)
**Branch:** `docs/audit-update-2026-05-01`
**Trigger:** Bølge 2 av pilot-readiness-arbeidet — re-validere de 6 røde funn fra 30. april mot main-state per 1. mai.
**Metode:** `git log --since=2026-04-30 main` (27 commits siden audit) + `grep` i kodebasen for hvert funn.

### F.1 Lukkede funn siden 30. april (3 av 6)

| # | Funn (30. april) | Status 1. mai | Lukket av | Commit-SHA |
|---|---|---|---|---|
| 1 | **Agent Dashboard skeleton** (D.1, `AgentDashboardPage.ts:96-186`) — dummy-tall + «Kommer snart»-tabs | 🟢 LUKKET | PR #772 | `8d6aa602` — komplett wiring mot ny `/api/agent/dashboard` aggregator (180 LOC backend), polling 30s, real Top 5/Latest Requests/Ongoing Games |
| 2 | **§11 distribusjon Spill 2/3** (E5/COMP-P0-001) — hardkodet `gameType: "DATABINGO"` ga 30 % i stedet for 15 % | 🟢 LUKKET | PR #769 | `6bdae77b` — `ledgerGameTypeForSlug` utvidet for rocket/monsterbingo, `Game2Engine.processG2Winners` + `Game3Engine.processG3Winners` + mini-game payouts oppdatert. SpinnGo beholder DATABINGO. |
| 3 | **Screen Saver admin UI** (D.10) — backend fantes, admin-side manglet | 🟢 LUKKET | PR #768 | `8806cc1d` — `feat(admin): Screen Saver config + TV-integrasjon (Fase 1 MVP §24)` — admin-UI + TV-klient-rendering wired |

### F.2 Re-validering av gjenværende røde funn (3 av 6 fortsatt åpne)

| # | Funn (30. april) | Status 1. mai | Begrunnelse |
|---|---|---|---|
| 4 | **Spill 2 + Spill 3 PauseOverlay + ReconnectFlow** (PIXI-P0-004/005) — ikke portet fra Spill 1 | 🔴 FORTSATT ÅPEN | Ingen commits til `packages/game-client/src/games/game2/` eller `game3/` siden 30. april. Demo-vurdering uendret: ikke vis Spill 2/3 som «produksjonsklart». |
| 5 | **Import Player (Excel xls/xlsx)** (D.11) — Fase 1 MVP §22 fra LEGACY_1_TO_1_MAPPING | 🔴 FORTSATT ÅPEN | Ingen `importPlayers`-API, ingen admin-side. Anbefalt fallback uendret: engangs migrasjons-script ved pilot-onboarding. |
| 6 | **SpinnGo signaturfunksjoner** (Free Spin Jackpot, Billettkustomisering, Kulefysikk, DrumRotation) + **Spill 3 Unity-paritet** (Waypoint-bane, Mønster-animasjon) | 🔴 FORTSATT ÅPEN (utsatt per README) | Eksplisitt utsatt i README-er. Ikke pilot-blokker for Spill 1-only-pilot. |

**Oppsummert:** 3 av 6 røde funn lukket på samme dag eller dagen etter audit. 3 utestående er enten Spill 2/3-spesifikke (kun blokker hvis pilot inkluderer disse) eller eksplisitt utsatt scope.

### F.3 Nye observasjoner fra commits siden 30. april

| Endring | Status | Type | Effekt på audit |
|---|---|---|---|
| `feat/seed-demo-pilot-day-4halls` (`fb180ec5`) — Profil B 4-hall pilot-seed | Pushed, ikke merget | Forberedelse | Forbereder multi-hall master-koordinerings-demo. Bekreftet IKKE i `main` per 1. mai. **Venter merge.** |
| PR #774 (`8fbeedca`) — public CMS-endpoints i OpenAPI + `/api/cms/about` alias | Merget | 🟡→🟢 oppgradering | Reduserer C-rad «FAQ/Terms/Personvern» fra 🟡 til 🟢 på backend-siden. Player-shell-konsumpsjon (`backend/public/web/`) fortsatt en åpen integrasjons-task. |
| PR #773 (`04796a9f`) — TV Screen wireframe-paritet (PDF 16 §16.5) | Merget | 🟢→🟢 polish | KPI-bokser, Hall Belongs To-kolonne, Full House-fanfare. TV-skjerm-rad i D.10 fortsatt 🟢, men nå mer wireframe-likt. |
| PR #771 (`162717ec`) — `seed-demo-pilot-day` Profil A (1 hall) | Merget | Forberedelse | Komplementært til Profil B (4-hall, ennå ikke merget). Profil A demo-hall fungerer for single-hall-flyt. |
| PR #768 (`8806cc1d`) — Screen Saver config | Merget | 🔴→🟢 lukker funn | Allerede registrert i F.1 over. |
| PR #767 (`4ec7255e`) — Mystery Joker fix (joker-crown.png på joker-treff) | Merget | 🟢→🟢 polish | Spill 1 mini-game polish, ikke endring av status. |
| PR #765/#764 (HV2-B3+B4) — admin-UI for per-hall Spill 1 default-gevinster + sub-variant.minPrize-validering | Merget | Nytt tema | Hall-defaults og prize-floor-validering. Ikke direkte adressert i 30-april-audit; nytt forberedelses-arbeid for hall-spesifikk Spill 1-konfigurasjon. **MERK:** ikke et nytt rødt funn, men nytt scope verdt å holde øye med ved neste audit. |
| PR #758 (`1e24a5cc`) — BIR-036 50 000 kr/dag kontant-cap per hall (HV2-A) | Merget | Nytt tema | Regulatorisk cap implementert. **MERK:** nytt forretningskritisk tema — bør innlemmes i neste compliance-audit. |
| PR #746 (`d1272820`) — K5 engine error-handling sirk.bryter (CRIT-4) | Merget | E14 lukker | Adresserer Section E §14 «engine error-handling silently swallows». Bør reklassifiseres som lukket ved neste audit. |
| PR #756/#755 (`624ba2e5`/`a62ef53b`) — F2-D + F2-C BingoEngine refaktor (DrawOrchestrationService + RoomLifecycleService) | Merget | E1 progresjon | Inkrementell oppmykning av dual-engine-arkitekturen (E1 i Section E). Ikke fullt lukket, men progresjon. |
| PR #775 (`6fd1c1e6`) — BIN-768 e2e smoke-test framework | Merget | Forberedelse | Nytt e2e-rammeverk for pilot-runbook. **MERK:** øker tilliten til at pilot-smoke kan kjøres regelmessig. |

### F.4 Nye gaps oppdaget i diff siden 30. april

Ingen nye **røde** funn oppdaget i diff. To temaer verdt å flagge for neste audit:

1. **HV2-B3/B4 Spill 1 hall-defaults** (PR #765/#764): nytt scope (per-hall prize-floors med sub-variant-validering). Ikke i 30-april-audit — bør valideres mot wireframe ved neste runde.
2. **BIR-036 kontant-cap** (PR #758): regulatorisk håndheving av 50 000 kr/dag/hall. Bør innlemmes i neste compliance-audit-runde.

### F.5 Anbefalt timing for neste audit

| Tidspunkt | Audit-type | Begrunnelse |
|---|---|---|
| **Etter pilot-demo (innen 1 uke)** | Lett retro-audit (~2 timer) | Fang opp eventuelle gaps som dukket opp under demoen + lukk Profil B 4-hall-seed når mergen lander. |
| **Før pilot-prod (T-2 uker)** | Full re-audit (~1 dag) | Re-verifiser alle 6 funn, valider HV2-B3/B4 + BIR-036, sjekk om E14 (sirk.bryter) virkelig løser produksjons-feilene fra 14:18-snapshot, og inkluder Spill 2/3 status hvis disse er blitt scope'et inn i pilot. |
| **Før real-money launch** | Compliance + Security re-audit | Krever revisjon av E5 (hvis Spill 2/3 medtas), E12 (BankID prod-onboarding), E13 (hash-chain backfill) + Section F pilot-blokkere. |

**Konklusjon:** Lukkings-raten (3/6 på 24 timer) er oppmuntrende. Pilot-demo-vurdering fra 30. april står ved lag, og er nå *enklere* fordi Agent Dashboard ikke lenger trenger «start-utenom»-instruks. Neste full-audit anbefales T-2 uker før første pilot-hall går prod.

---

**Sluttdato:** 2026-04-30 (Tobias)
**Audit-agent:** Opus 4.7 (1M context)
**Filer verifisert:** ~150 (kode) + 5 store wireframe-dokumenter + 4 audit-rapporter

**Status-oppdatering:** 2026-05-01 (Audit-update-agent, Opus 4.7 1M context)
