# Skift demo pipeline — verifisering 2026-04-27

**Status:** Klar for live demo med kjente snubletråder. Alle 12 stegene har fungerende implementasjon i kode; tre av dem har papir-cuts som krever oppmerksomhet under rehearsal.

**Branch:** `docs/skift-demo-pipeline-verification-2026-04-27`

---

## 1. Per-stege-status

### 1.1 Logg inn (master/admin)
- Status: 🟢 Fullt implementert
- Path: `apps/admin-web/src/pages/login/LoginPage.ts` + `apps/admin-web/src/main.ts:111-153`
- Rolle-basert redirect i `landingRouteForRole()` (`apps/admin-web/src/auth/Session.ts:43-46`):
  - `admin` / `super-admin` → `/admin`
  - `agent` / `hall-operator` → `/agent/dashboard`
- For demo: Tobias logger inn som **super-admin** for å få tilgang til Hall + Group + Schedule + Master Console. AGENT-rollen blir låst til `/agent/*` og kan ikke se Master Console eller Schedule-editor.

### 1.2 Linke haller (Group of Halls)
- Status: 🟢 Fullt implementert
- Filer: `apps/admin-web/src/pages/groupHall/GroupHallListPage.ts` + `GroupHallEditorModal.ts` + `GroupHallState.ts`
- Hall CRUD med Hall Number-felt + Add Money-popup: `apps/admin-web/src/pages/hall/HallListPage.ts:70-105` (cashBalance + isActive + tvToken-kolonne)
- Backend: `/api/admin/hall-groups` + `/api/admin/halls`, RBAC krever ADMIN.
- Hall-listen viser allerede en kopierbar TV-URL (`renderTvUrlCell` i `HallListPage.ts:133-170`) — bingoverten kan kopiere lenken direkte.

### 1.3 Sett opp spilleplan med Mystery
- Status: 🟢 Fullt implementert
- Filer: `apps/admin-web/src/pages/games/schedules/ScheduleListPage.ts` + `ScheduleEditorModal.ts` (425 L) + `SubGamesListEditor.ts` (1272 L)
- Sub-games-editoren støtter STANDARD og Mystery sub-game (`SubGamesListEditor.ts:115`, `:609` — feat/schedule-8-colors-mystery), 8-farge palette og winning-% per farge.
- Backend `/api/admin/schedules` håndterer CRUD; ticks via `createGame1ScheduleTickJob` (`apps/backend/src/index.ts:77,1340-1350`) konverterer schedule til `app_scheduled_games` ved start-tid.
- Sidebar-link: "Schedule Management" i `sidebarSpec.ts:83`.

### 1.4 Start dagens skift (Daily Balance)
- Status: 🟢 Fullt implementert
- Modal: `apps/admin-web/src/pages/cash-inout/modals/AddDailyBalanceModal.ts`
- Backend: `POST /api/agent/shift/start` (i `AgentShiftService.ts`)
- Modalen er triggret fra `CashInOutPage.ts:291` (`openAddDailyBalanceModal`).

### 1.5 Selg bonger og kioskvarer
- Status: 🟢 Fullt implementert
- Bonge-salg: `apps/admin-web/src/pages/cash-inout/SellTicketPage.ts` (`/agent/sellPhysicalTickets`)
- Kiosk: `apps/admin-web/src/pages/cash-inout/ProductCartPage.ts` (251 L; `renderCart` + Cash/Card-knapper) på `/agent/sellProduct`
- Begge er aktivert via cash-inout dispatcher (`pages/cash-inout/index.ts`) og er i agent-sidebar (sidebarSpec linje 346: `agent-sell-products`).

### 1.6 Start spill fra Master Console
- Status: 🟡 Fungerer, men ikke direkte navigerbar
- Game1MasterConsole.ts (1424 L): Start / Pause / Resume / Stop / Exclude-Hall + jackpot-confirm + ready-popup + transferHallAccess.
- **Snubletråd:** Sidebar linker til `/game1/master/placeholder` (`sidebarSpec.ts:66`) — det er en falsk path. Faktisk dispatch krever `/game1/master/<gameId>` (regex-match i `pages/games/index.ts:351-355`).
- Master må navigere via Saved Game List (`/savedGameList`) og klikke seg inn på et konkret game, eller via en ennå-ikke-bygd "Active Games"-vy. For demo: lim inn `/game1/master/<gameId>` direkte i URL-baren etter at scheduled_game er opprettet.

### 1.7 TV-skjerm
- Status: 🟢 Fullt implementert
- Public route: `/admin/#/tv/<hallId>/<tvToken>` (uten auth) — håndtert i `apps/admin-web/src/main.ts:75-93`.
- Backend: `apps/backend/src/routes/tvScreen.ts:36-58` validerer tvToken; ugyldig token gir 404 (uniform med ukjent hall — fail-soft).
- TV-page poller 2s + Socket.IO live-updates (`tvScreenSocket.ts`). Voice-pack-valg, phase-won-banner og participating-halls-badges er implementert.

### 1.8 Phase-progression (1 Rad → 2 Rader → ... → Fullt Hus)
- Status: 🟢 Fullt implementert
- Engine: `apps/backend/src/game/BingoEngine.ts` + `Game1DrawEngineBroadcast.ts:126-134` (currentPhase emit) + `Game1DrawEnginePhysicalTickets.ts:132-236` (phase-evaluering).
- Auto-pause etter phase-won: `adminGame1Socket.ts:39` (Task 1.1) + Resume-knapp i Master Console (`Game1MasterConsole.ts:80-89`).
- Master må trykke Resume etter hver phase-won (`onAutoPaused` event).

### 1.9 Mini-game (Mystery) trigges etter Fullt Hus
- Status: 🟢 Engine + integration test grønne
- Filer: `apps/backend/src/game/minigames/MiniGameMysteryEngine.ts` + `MiniGameMysteryEngine.integration.test.ts`
- Default mini-game er Mystery ved Fullt Hus (verifisert i `BingoEngine.adhocMysteryDefault.test.ts`).
- TV-overlay og spiller-klient-overlay er bygget (PR #430).

### 1.10 Cashout for fysiske vinnere
- Status: 🟢 Fullt implementert
- Side: `PhysicalCashoutPage.ts` (70 L) + `PhysicalCashoutSubGameDetailPage.ts` + `CashoutDetailsPage.ts` + `CheckForBingoModal.ts`
- Sidebar: `agent-bingo-check`, `agent-physical-cashout` (sidebarSpec linje 353-354).
- Reward-All og per-ticket Rewarded-status er implementert.

### 1.11 Stopp spillet og start neste schedule
- Status: 🟡 Stop-flyten finnes, men "neste schedule" startes ikke fra UI
- Stop-dialog med refund-omfang (digitale + fysiske bonger): `Game1MasterConsole.ts:1184-1242` + `renderStopDialog`.
- Krever begrunnelse (`g1-stop-reason`-input) — backend logger til audit.
- **Snubletråd:** Det er ingen "Start Next Game from Schedule"-knapp i Master Console. Neste game opprettes av cron-jobben `game1ScheduleTick` ved scheduled_start_time. For demo: enten vente på cron, eller bruk `POST /api/admin/game1/games/:gameId/start` manuelt. NextGamePanel i agent-portalen har en "Start Next Game"-knapp men den krever et eksisterende game.

### 1.12 Skift-slutt (Settlement)
- Status: 🟢 Fullt implementert
- Modal: `apps/admin-web/src/pages/cash-inout/modals/SettlementBreakdownModal.ts`
- 14 maskin-rader (Metronia / OK Bingo / Franco / Otium / Norsk Tipping Dag+Totall / Norsk Rikstoto Dag+Totall / Rekvisita / Servering/kaffe / Bilag / Bank / Gevinst overføring bank / Annet).
- Tre sub-seksjoner: Machine Breakdown + Shift Delta + Notice (`SettlementBreakdownModal.ts:33-49`).
- Bilag-receipt upload er FileReader → base64 (innen `MAX_BILAG_BYTES`).
- Backend: `POST /api/agent/shift/close-day` + `PUT /api/admin/shifts/:shiftId/settlement` (admin edit med required reason).
- Shift Log Out-modal med "Distribute winnings" + "Transfer register ticket"-checkboxer: `AgentCashInOutPage.ts:118` (`openShiftLogoutModal`).

---

## 2. Klikk-stier

### 2A. Master forberedelse (én gang per dag)
1. Login `/admin` → super-admin lander på `/admin` dashboard
2. **Sidebar → Hall Management** (`/hall`) → opprett haller (Notodden, Hamar osv.) med Hall Number → Submit
3. **Sidebar → Group of Halls** (`/groupHall`) → opprett "Demo Group" → tilordne haller → Submit
4. **Sidebar → Schedule Management** (`/schedules`) → "Add" → fyll inn Schedule-malen med Mystery sub-game + 8-farger + winning-% → Save
5. **Sidebar → Hall Management** (`/hall`) → klikk eksternlink-ikonet i TV URL-kolonnen for å åpne `/admin/#/tv/<hallId>/<tvToken>` på hall-TV-skjermen i ny fane

### 2B. Bingovert dagsdrift (per skift)
1. Login som agent/hall-operator → automatisk redirect til `/agent/dashboard`
2. **Sidebar → Cash Inn/Ut** (`/agent/cash-in-out`) — siden viser:
   - Box 1: Daglig saldo + "Legg til daglig saldo"-knapp → modal → Submit
   - Box 2: 7-knapps grid for cash inn/ut + Selg Produkter + Spillemaskiner
   - Header: "Logg ut skift"-knapp øverst-høyre
3. Kioskdrift via "Selg Produkter"-knapp → `/agent/sellProduct` (ProductCartPage)
4. Bonge-salg via "Spillemaskiner"/"Legg til penger"-knappene eller `/agent/sellPhysicalTickets`

### 2C. Spill-runtime (per game)
1. Master åpner `/game1/master/<gameId>` (manuell URL — sidebar-linken er placeholder)
2. Halls-tabellen viser farge-kodet status (🔴/🟠/🟢) + "Klar"-bekreftelse per hall
3. Master trykker Start (når alle grønne) → Ready-popup hvis noen ikke klar → Jackpot-confirm hvis pot armert → spillet starter
4. TV-skjermen viser ball-trekninger live + voice-utrop
5. Etter hver phase-won: Auto-pause → Master trykker Resume
6. Etter Fullt Hus: Mystery mini-game trigges automatisk → spilleren ser overlay → premie betalt
7. Master trykker Stop med begrunnelse → refund-summary vises → bekreft

### 2D. Skift-slutt
1. Bingovert er på `/agent/cash-in-out`
2. Trykk "Oppgjør" → SettlementBreakdownModal → fyll ut 14 maskin-rader + bilag-upload + Submit
3. Trykk "Logg ut skift" → ShiftLogout-modal → 2 checkboxer + View Cashout Details → Yes
4. Backend gjør: distribute winnings (hvis check'et) + transfer register tickets (hvis check'et) + audit-log

---

## 3. Krasj-tester

### 3A. Hall uten TV-token
- Backend `tvScreen.ts:90-93` returnerer 404 med `NOT_FOUND`-kode → TV-side viser ingen state.
- DB-migrasjon `app_halls.tv_token = gen_random_uuid()::text WHERE tv_token IS NULL` (`PlatformService.ts:4190`) er kjørt — alle haller har token.
- Fail-soft: TV-page viser "Kunne ikke hente state" uten å avsløre om hall finnes.

### 3B. Schedule med 0 sub-games
- ScheduleListPage tillater opprettelse uten sub-games (skjema-validering ikke obligatorisk).
- Cron-jobben `game1ScheduleTick` vil opprette et scheduled_game uten faser → BingoEngine vil feile ved Start.
- **Anbefalt før demo:** verifiser at minst én sub-game er lagt til.

### 3C. Master starter uten registrerte bonger
- `Game1MasterConsole.ts:520-543`: hvis `lastHallStatus.size > 0` (hall-status data tilgjengelig), kreves `orangeHalls.length === 0 && allRedConfirmed`. En 🟠-hall blokkerer start (UI-message + tooltip).
- Hvis ingen hall-status data: faller tilbake til `detail.allReady`-flagget.
- **Konklusjon:** Master kan IKKE starte hvis 🟠 — UI-en blokkerer. Men hvis backend ikke har levert hall-status (network feil) tillater den fall-back-flow.

### 3D. Ingen agenter klar når Master trykker Start
- `Game1MasterConsole.ts:959-969`: hvis backend returnerer `HALLS_NOT_READY`, popper modal (`promptNotReadyDialog`) som viser unready hall-navn med [Avbryt] / [Start uansett].
- Master kan velge å overstyre med audit-trail.

### 3E. TV-skjermen mister socket-tilkoblingen
- `TVScreenPage.ts` har 2s polling som primær + socket som progressive enhancement.
- Hvis socket dropper: polling sikrer fortsatt 2s-refresh. Voice/banner-events går glipp men state oppdateres.

---

## 4. Missing pieces

### 4A. Master Console sidebar-link er placeholder
- **Fil:** `apps/admin-web/src/shell/sidebarSpec.ts:66` — path `/game1/master/placeholder` matcher ingenting.
- **Effekt:** Master må manuelt skrive `/game1/master/<gameId>` i URL-baren eller navigere via Saved Game List.
- **Estimat fix:** 0.5 dev-dag — endre til en "Active Games"-listevy som dispatcher inn til konkrete master-console-instanser.
- **Pilot-blocker?** Nei (workaround: bruk Saved Game List eller URL).

### 4B. "Start Next Game"-knapp i Master Console mangler
- Master Console har Start/Pause/Resume/Stop for **gjeldende** spill, men ingen "Start neste schedule-runde"-knapp.
- Workflow: enten vente på `game1ScheduleTick` cron (varierer pr. schedule) eller bruke NextGamePanel i agent-portalen som har egen Start-knapp.
- **Effekt:** Hvis demo skal vise consecutive runder, må Tobias bytte til agent-portalen mellom hver runde.
- **Estimat fix:** 1 dev-dag — legg til "Start Next Scheduled Game"-knapp i Master Console som lister upcoming scheduled_games.
- **Pilot-blocker?** Nei (agent-portalen dekker det).

### 4C. Phase-progression er auto-pause, ikke manuell prompt
- Etter hver phase-won må Master trykke Resume for å fortsette trekkingen. Det er ingen popup som forteller "Phase X er vunnet, trykk Resume". Master må se på status-banneret.
- **Effekt:** Ved første demo-runde må Tobias være oppmerksom på når banneret dukker opp.
- **Estimat fix:** Fungerer som spesifisert; ingen fix nødvendig — bare en demo-instruksjon.

---

## 5. Demo-rehearsal-script

### Forutsetninger
- En kjørende staging-env (backend + admin-web)
- En super-admin-konto + en agent-konto
- Minst 2 haller opprettet med tv_token (auto-generert)

### Steg-for-steg

```
A) MASTER (ny dag)

1.  Åpne /admin, logg inn som super-admin
2.  Sidebar → "Group of Halls" (#/groupHall) → "Add Group of Halls"
    → Navn "Demo Group" → tilordne 2-3 haller → Submit
3.  Sidebar → "Hall Management" (#/hall) → verifiser at hver hall har:
    - Hall Number (101, 102, ...)
    - Cash Balance > 0 (klikk "+money" hvis tom)
    - tvToken (synlig i TV URL-kolonnen)
4.  Sidebar → "Schedule Management" (#/schedules) → "Add"
    → Schedule Name "Demo Skift"
    → Sub-games: legg til "Mystery Round" som Mystery sub-game-type
    → Velg 8 ticket-farger med winning-% per farge
    → Save
5.  I hall-listen: klikk eksternlink-ikonet i TV URL-kolonnen
    → Åpner /admin/#/tv/<hallId>/<tvToken> i ny fane
    → Vis denne fanen på hall-TV-projector

B) AGENT (start skift)

6.  Åpne /admin i ny inkognito-vindu, logg inn som agent
    → Auto-redirect til #/agent/dashboard
7.  Sidebar → "Cash Inn/Ut" (#/agent/cash-in-out)
8.  Klikk "Legg til daglig saldo" → fyll inn 30000 → ADD
9.  Selg en bonge: klikk "Spillemaskiner" eller "Legg til penger" knappene
10. Selg en kaffe: klikk "Selg Produkter" → kategori → Coffee →
    Cash → Submit Order

C) MASTER (start spill)

11. I master-vinduet: åpne #/game1/master/<gameId>
    (gameId hentes fra Saved Game List eller fra at cron har laget en
     scheduled_game etter scheduled_start_time)
12. Halls-tabellen: bekreft at alle haller er 🟢
    → Hvis 🟠: vent på at agenter trykker "Klar"
    → Hvis 🔴: hak av "Ekskludér rød hall" om aktuelt
13. Trykk Start
    → Hvis Jackpot armert: bekreft i popup
    → Hvis ingen er klar: velg "Start uansett" eller avbryt
14. TV-fanen viser nå ball-trekninger live

D) UNDERVEIS

15. Etter hver phase-won (Rad 1, Rad 2, ..., Fullt Hus):
    → Master Console viser "Spillet er pause etter fase N"
    → Trykk Resume
16. Etter Fullt Hus: Mystery mini-game trigges automatisk
    → Spillere får overlay
    → Vinneren får premie
17. Cashout: agent åpner #/agent/physical-cashout
    → Per-ticket: Reward-All eller per-pattern Cashout

E) AVSLUTT

18. Master trykker Stop med begrunnelse "Demo avsluttet"
    → Refund-summary popup → Bekreft
19. Agent: Sidebar → "Cash Inn/Ut" → "Oppgjør"
    → SettlementBreakdownModal: fyll inn 14 rader (selv 0 er OK)
    → Last opp en dummy-bilag
    → Submit
20. Agent klikker "Logg ut skift"
    → 2 checkboxer (anbefal å hake av begge)
    → "View Cashout Details" for å verifisere ingen pending
    → Yes

DEMOEN ER NÅ FERDIG.
```

### Pre-demo sanity checks (kjør 30 min før)
- [ ] Verifiser at minst én scheduled_game er aktiv eller kan opprettes
- [ ] Verifiser at agent-kontoen har en hall i `agent_hall_assignments`
- [ ] Verifiser at TV-skjerm-fanen viser pattern-tabell uten 404
- [ ] Verifiser at Mystery sub-game er lagret i schedulen

---

## 6. Sammendrag

| Steg | Status | Demo-trygt? |
|---|---|---|
| 1 Login | 🟢 | Ja |
| 2 Linke haller | 🟢 | Ja |
| 3 Spilleplan + Mystery | 🟢 | Ja |
| 4 Daily Balance | 🟢 | Ja |
| 5 Bonge + kiosk-salg | 🟢 | Ja |
| 6 Master starter spill | 🟡 | Ja, men URL må limes manuelt |
| 7 TV-skjerm | 🟢 | Ja |
| 8 Phase-progression | 🟢 | Ja, husk Resume etter hver phase |
| 9 Mystery mini-game | 🟢 | Ja |
| 10 Cashout | 🟢 | Ja |
| 11 Stopp + neste runde | 🟡 | Ja, neste runde via cron eller agent-portal |
| 12 Settlement + Logout | 🟢 | Ja |

**Pilot-blockers:** Ingen.
**Demo-snubletråder:** 2 (sidebar master-link er placeholder; "neste runde"-knapp mangler).
**Anbefaling:** Demoen kan kjøres i dag, men Tobias bør øve på URL-snarveien til Master Console og rute fra agent-portalen for "neste runde". Begge snubletrådene kan fikses i 1.5 dev-dager hvis ønsket før produksjons-pilot.
