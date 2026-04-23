# Legacy Minigames & Features Audit — 2026-04-24

**Formål:** Komplett inventar over legacy-funksjoner (mini-games, bonus-features, per-spill-spesialiteter, TV-skjerm-komponenter, Agent-app-features) som må portes for 1:1 paritet med Spillorama-systemet.

**Kilde:** Legacy-koden er quarantined i commit `5fda0f78` (`legacy/unity-client/` + `legacy/unity-backend/`). Working tree har ingen legacy-filer; alle referanser her er mot git-historikken.

**Fremgangsmåte:** Identifiserte legacy-filer via `git ls-tree -r 5fda0f78`, leste relevante C#-paneler og Node-socket-handlere/GameProcess-filer, krysssjekket mot nåværende kodebase (`apps/backend/src/game/minigames/`, `packages/game-client/src/games/game1/components/`) og tidligere dokumenter (`SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md`, `LEGACY_1_TO_1_MAPPING_2026-04-23.md`).

**Scope-avgrensning:** "Portert" = finnes i main-branch per 2026-04-23. "Delvis" = backend ferdig eller klient ferdig, men ikke end-to-end. "Ikke portert" = ingen sporbar implementasjon i ny stack.

---

## TL;DR

| Kategori                     | Totalt i legacy | ✅ Portert | 🟡 Delvis | ❌ Mangler |
|------------------------------|----------------:|----------:|----------:|-----------:|
| Mini-games (bingo-sekvens)   | 4               | 3         | 0         | 1          |
| Game 5 mini-games (rulett)   | 2               | 0         | 0         | 2          |
| Bonus/pot-features           | 8               | 1         | 3         | 4          |
| Per-spill unike features     | 9               | 3         | 3         | 3          |
| TV-skjerm-komponenter        | 11              | 4         | 2         | 5          |
| Agent-app unike features     | ~15             | 0         | 0         | ~15        |

**Topp 5 kritiske hull:**
1. **Mystery Game** — ❌ helt portert hverken på backend eller klient. Opp/ned + joker-mekanikk + autoTurn + 6-stige prizeList. Bekreftet av Tobias.
2. **Free Spin Jackpot (Game 5/4)** — ❌ WOF-preview + rulett-jackpot sekvens helt ikke-portert.
3. **Jackpott daglig-akkumulering** — 🟡 `Game1JackpotService` dekker fast sum, men daglig +4000 kr og 30k-cap og 50→55→56→57 draw-threshold mangler.
4. **Innsatsen-pot** — ❌ 20%-av-salg → pot, base 500, draw-threshold 2000 innen trekk 56. Legacy har `innsatsenSales`-felt på `dailySchedule`.
5. **Agent-portal minigame-polite driverflyt** — ❌ Bingoverten har ingen UI for å "release" mini-game, pause-under-mini-game, eller se claim-status på TV under mini-game.

**Estimert total port-tid:** ~28-42 dev-dager basert på PR-sekvensen i `SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md`, pluss ~4-6 dager for Mystery Game og ~8-12 dager for Game 5-rulett/jackpot som ikke er med i variant-katalogen.

---

## 1. Mini-games (triggers etter BINGO/Fullt Hus)

Mini-games i legacy har tre felles-mønster:
- Trigges fra `pattern.isWoF` / `isMys` / `isTchest` / `isColorDraft`-flagg satt per PatternConfig.
- Når vinner evalueres i `checkForWinners` setter engine `gameFlags.isColorDraft` / `isMiniGame*` på vinner-objektet.
- Socket-endpoint `*Data` returnerer `prizeList` fra `otherGame`-kolleksjonen (slug `wheelOfFortune`/`treasureChest`/`mystery`/`colorDraft`).
- Spiller må velge før `autoTurnMoveTime`-timeout, ellers sender backend `selectMysteryAuto`/`selectColorDraftAuto` med random valg.
- Ved Fullt Hus i **sub-game med** mini-game pattern: spiller trigges til overlay, selve "winningAmount" fra mini-game bestemmer faktisk utbetaling (i stedet for fast pattern-premie).

### 1.1 Wheel of Fortune (Lykkehjulet)

- **Status:** ✅ portert (backend + klient)
- **Legacy klient:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/Wheel Of Fortune/WheelOfFortunePanel.cs` (468+ linjer), `SpinWheelScript.cs`, `NewFortuneWheelManager.cs`, `FortuneWheelManager.cs` (DOTween-variant), `WheelCategories.cs`, `CategoryPie.cs`
- **Legacy backend:** `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` — funksjonene `wheelOfFortuneData`, `playWheelOfFortune`, `wheelOfFortuneFinished`. `otherGame.wheelOfFortuneprizeList`-array.
- **Socket-events:** `WheelOfFortuneData` (request), `PlayWheelOfFortune`, `WheelOfFortuneFinished`, broadcasts `StartSpinWheel`, `StopSpinWheel`, `toggleGameStatus`
- **Mekanikk:**
  - Sektor-hjul med `prizeList.Count` lik sektorer (legacy spesifikt: 4000×2, 3000×4, 2000×8, 1000×32, 500×4).
  - 1 snurr per trigger. Ingen brukerinput utover "trykk Spin". Server-autoritativ random-index i `playWheelOfFortune`.
  - autoTurn-timer 10 s (game 1 default), game 4 kan overstyre via `turnTimer` param.
  - Reconnect: hvis pågående snurr finnes i `otherData.isWofSpinStopped`, klient spinner ikke, bare setter final-angle.
- **Trigger:** Pattern med `isWoF=true` og player har vunnet det pattern i dette sub-game.
- **Payout:** Selected prize blir winning amount — overstyrer pattern-pris.
- **Timer/timeout:** Hvis spiller ikke klikker på `Spin`-knappen innen 10s, server spinner automatisk.
- **Ny kode:** `apps/backend/src/game/minigames/MiniGameWheelEngine.ts` + `packages/game-client/src/games/game1/components/WheelOverlay.ts` + `apps/backend/src/admin/MiniGamesConfigService.ts` + `MiniGameRouter.ts`.

### 1.2 Treasure Chest (Skattekisten)

- **Status:** ✅ portert
- **Legacy klient:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/Treasure Chest/TreasureChestPanel.cs`, `PrefabTreasureChest.cs`
- **Legacy backend:** `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` — `TreasureChestData`, `SelectTreasureChest`. `otherGame.treasureChestprizeList`.
- **Socket-events:** `TreasureChestData`, `SelectTreasureChest`, broadcast `OpenTreasureChest`
- **Mekanikk:**
  - N lukkede kister (legacy varierer mellom 4-8 avhengig av `prizeList.Count`).
  - Spiller velger 1 kiste; den åpnes og viser en av prisene fra `prizeList`.
  - Ved reconnect med `isMinigamePlayed=true`: server returnerer en shuffled versjon av prizeList og highlighter vinnerkiste.
  - **Extra prize-formel:** Når pattern triggrer TChest i `checkForWinners`, vinningsbeløpet beregnes som `Math.max(...prizeList) * 2` (dobbelt høyeste pris — unikt for Treasure Chest). Se `GameProcess.js:~100-110`.
- **Timer:** Samme som WoF (10s default, autoTurn).
- **Ny kode:** `MiniGameChestEngine.ts` + `TreasureChestOverlay.ts`.

### 1.3 Mystery Game (Opp/ned + Joker) — **❌ IKKE PORTERT**

- **Status:** ❌ Mangler helt. Tobias har bekreftet dette.
- **Legacy klient:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/Mystery Game Panel/MysteryGamePanel.cs` (450+ linjer), `MysteryGameMiddleBall.cs`, `MysteryGameSelectionBall.cs`
- **Legacy backend:** `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` — `mysteryGameData`, `selectMysteryAuto`. `otherGame.mysteryPrizeList` (6 elementer).
- **Socket-events:** `MysteryGameData`, `SelectMystery`, broadcasts `SelectMysteryBall`, `mysteryGameFinished`, `mysteryGameFinishedAdmin`, `toggleGameStatus`
- **Mekanikk (kritisk detaljert, siden dette må portes):**
  - `middleNumber` (5-sifret, f.eks. `49237`) vises som et felles referansetall.
  - `resultNumber` (5-sifret) er hemmelig tall spiller "gjetter mot".
  - Spiller har **5 turn** (`maxBallsLength=5`).
  - Hver turn: spiller velger `UP` eller `DOWN` — "er neste siffer i `resultNumber` høyere eller lavere enn sist siffer i `middleNumber`"?
  - Ved riktig gjett: prisen øker ett steg i `prizeList[6]` (0-indeksert).
  - Ved feil gjett: prisen minker ett steg.
  - Ved **eksakt match** (`middleNumber siffer == resultNumber siffer`): **JOKER** — spiller vinner direkte maksimal pris (index 5) og spillet avsluttes. Dette vises som en egen animasjon (`PlayJokerAnimation`).
  - Klient-kode: `MysteryGamePanel.cs:~400-480` (`UpButtonTap`, `DownButtonTap`).
  - Game 4 har annen visningsform — bruker `GetSingleNumber(middleNumber)` vs hele tallet.
- **AutoTurn:** `autoTurnMoveTime` (20s første trekning) og `autoTurnReconnectMovesTime` (10s øvrige) — konfigurerbart per spill.
- **Trigger:** Pattern med `isMys=true`.
- **Payout:** `prizeList[finalIndex]` der index bestemmes av summen av riktige/galefte gjett. Verdier lagres i `room[0].otherData.mysteryGameResults.prizeList` + `mysteryHistory`.
- **Extra prize-formel i checkForWinners:** `Math.max(...mysteryPrizeList) * 2` (samme regel som TreasureChest).
- **Assets som må reprodusers/adapteres:** Ball-animasjon for opp/ned, joker-shine-animasjon, 5 `MysteryGameSelectionBall`-posisjoner per rad (2 rader), midtball med roterende animasjon.
- **Ny kode:** Ingen. Ikke engine, ikke UI-overlay.
- **Portering-estimat:** ~4-6 dev-dager (engine + server-autoritativ logikk + klient-overlay + timer/reconnect).

### 1.4 Color Draft (Fargekladden)

- **Status:** ✅ portert
- **Legacy klient:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/Color Draft/ColorDraftPanel.cs` (~350 linjer), `PrefabColorDraft.cs`
- **Legacy backend:** `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` — `colorDraftGameData`, `selectColorDraftAuto`. `otherGame.colordraftPrizeList`.
- **Socket-events:** `ColorDraftGameData`, `SelectColorDraft`, broadcasts `selectColorDraftIndex`, `colordraftGameFinished`, `colordraftGameFinishedAdmin`
- **Mekanikk:**
  - 12 luker med farger: **rød**, **gul**, **grønn** (`Color32 yellow/green/red` fra `ColorDraftPanel.cs`).
  - Spiller åpner 3 luker i rekkefølge.
  - Regelkombinasjon (nevnt i `SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md`, verifiser i `PrefabColorDraft.cs`):
    - Match 2 like farger → vinner beløpet i **1. luke**
    - Alle 3 ulike → vinner **sum av alle 3**
    - Ellers → sum av **2 første**
  - History persistert i `colorDraftGameData.miniGameData.history` (array av `{selectedIndex, amount, color}`) for reconnect-rebuild.
- **Trigger:** Pattern med `isColorDraft=true` (Color Draft-flagg — i `savedGame.js` er det også `colorDraftWinners`-array).
- **Extra prize-formel:** Hvis `colordraftPrizeList.length > 0`, `winningAmount = prizeListe sin aggregert basert på regel` (mer kompleks enn chest/wheel som er `max * 2`).
- **Timer:** Samme som WoF/TChest, 10-20s.
- **Ny kode:** `MiniGameColordraftEngine.ts` + `ColorDraftOverlay.ts`.

---

## 2. Game 5 mini-games (rulett + jackpot)

**Status på Game 5 generelt:** Game 5 (aka SpinnGo / tidligere "Game 5") er ikke planlagt for Fase 1-pilot. Backend har `Game5JackpotTable.ts` i ny stack, men rulett-UI eksisterer bare som skissert i `packages/game-client/src/games/game5/components/RouletteWheel.ts`.

### 2.1 Game 5 Free Spin Jackpot (Lykkehjul-preview før rulett)

- **Status:** ❌ Ikke portert
- **Legacy klient:** `legacy/unity-client/Assets/_Project/_Scripts/Game5/Game5FreeSpinJackpot.cs`
- **Legacy backend:** `legacy/unity-backend/Game/Game5/Controllers/GameProcess.js` — delen rundt `jackpotsWinnigs`, `scheduleExtraWinnings`. Ekstra prize-utbetaling skjer i `processJackpotWin`.
- **Socket-events:** `WheelOfFortuneData` (for Game 5 variant), `PlayWheelOfFortune`, `SelectWofAuto`
- **Mekanikk:**
  - Lykkehjul med 20 sektorer (`PlatesData` + `PlatesVectorValues`).
  - Prize-tekst er **"N Spinn"** (ikke kroner) — dvs. spiller vinner antall gratis spinn på rulett.
  - Eksempel-spins-verdier: 1, 2, 5, 10 (`SampleInput`).
  - 10s auto-turn.
- **Trigger:** Spesiell Jackpot pattern i Game 5 (`Jackpot_1`, `Jackpot_2`).
- **Payout:** Converterer antall spinn × rulett-multiplier når spillet fortsetter.
- **Portering-estimat:** ~3-5 dev-dager (må ha både WOF-preview og rulett-integrasjon).

### 2.2 Game 5 Roulette Wheel (hovedspill-komponent)

- **Status:** ❌ Ikke portert
- **Legacy klient:** `Game5JackpotRouletteWheel.cs`, `Game5RouletteWheelController.cs`, `BallPathRottate.cs`, `BallScript.cs` (alle i `Game5/`)
- **Legacy backend:** `legacy/unity-backend/Game/Game5/Controllers/GameProcess.js` — `determineRouletteOutcome` (Game5Helper).
- **Socket-events:** `SelectRouletteAuto`, broadcasts via Game5 namespace
- **Mekanikk:**
  - 37-tall rulett med **Red / Black / Green** fargekategorier (Green = 0).
  - `txtMultiplierRed`/`Black`/`Green` — hver farge har egen multiplikator.
  - `totalSpins` + `playedSpins` — spillet kan ha mange spinn per runde (fra jackpot-gevinst).
  - SpinHistory-prefab rendrer siste N utfall.
  - `spinDetails` inkluderer `playedSpins / totalSpins / spinHistory`.
- **Portering-estimat:** ~5-7 dev-dager (ballistisk animasjon + server-autoritativ outcome + UI).

---

## 3. Bonus-features utover mini-games

### 3.1 Jackpott (Jackpot-pattern på Fullt Hus)

- **Status:** 🟡 Delvis portert
- **Legacy:** Pattern med `isJackpot=true` triggrer utbetaling fra `room.jackpotPrize[ticketColor]` hvis `withdrawBallCount <= room.jackpotDraw` (legacy default `jackpotDraw=51`).
- **Per-farge jackpot:** `jackpotPrize` er objekt `{yellow: N, white: N, purple: N, ...}` indexert av ticket-color.
- **Daglig-akkumulering:** ❌ Ikke i legacy-koden jeg kan se — papir-planen sier "+4000/dag, max 30.000". Kan være admin-manuelt satt hver dag via GameManagement, ikke automatisk.
- **Draw-threshold-eskalering:** Papir-planen sier 50→55→56→57, men legacy har bare **ett** `jackpotDraw`-tall. Dette er en **lite dokumentert gap**.
- **Ny kode:** `Game1JackpotService.ts` dekker fixed-amount-per-farge per game. Mangler multi-threshold-eskalering + daglig-akkumulering.
- **Legacy-stier:** `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` (`checkForWinners` case `"Jackpot"`); `legacy/unity-backend/App/Models/savedGame.js` (`jackpotDraw`, `jackpotPrize`, `jackpotWinners`).
- **Gjenstår:** Multi-threshold-regel (kan håndteres i ny PatternConfig med `drawThresholds?: number[]`), pot-akkumulering-service.

### 3.2 Innsatsen (20% av salg → pot)

- **Status:** ❌ Ikke portert
- **Legacy:** `dailySchedule.js` har `innsatsenSales: Number, default: 0`. Tall akkumuleres per dag, og legacy bruker dette i `otherData.isInnsatsenJackpotWon`-flagg. Papir-planen: base 500, +20% av salg, utbetales hvis pot når 2000 innen 56 trekk (øker til 58 ellers).
- **Legacy-sti:** `legacy/unity-backend/App/Models/dailySchedule.js:46-49` + `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js:~200` (`isInnsatsenJackpotWon`).
- **Ny kode:** Ingen. `Game1JackpotService.ts` dekker ikke denne typen akkumulering.
- **Portering-estimat:** ~3-4 dev-dager (ny `Game1PotService` + admin-UI + draw-threshold-logikk).

### 3.3 Lucky Number Bonus

- **Status:** 🟡 Delvis portert
- **Legacy:** Spiller velger 1 tall fra 1-90 før spill starter. Hvis dette tallet er siste trekning når spiller får Fullt Hus, vinner spiller `luckyNumberPrize` (fast sum per game). `luckyNumberBonusWinners`-array på `game.js`.
- **Klient-UI:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/Game/SelectLuckyNumberPanel.cs` + `PrefabLuckeyNumberBall.cs` + `Game1LuckyNumberAutoSelectionBtn.cs` (setting for auto-select).
- **Per-spill-forskjell:**
  - Game 1: 1 tall fra 1-90, matches mot siste trekning ved Fullt Hus.
  - Game 2: Pre-round pick, brukes i jackpot-beregning.
  - Game 3: Pre-round pick med rolle i **Pick Any Number**.
- **Socket-events:** `SelectLuckyNumber` (universelt på tvers av Game 1/2/3).
- **Ny kode:** `packages/game-client/src/games/game1/components/LuckyNumberPicker.ts` eksisterer. Mangler Game 1-integrasjon med `luckyNumberBonusWinners`-utbetaling.
- **Gjenstår:** Verifiser at lucky-bonus-pattern (`pattern.isLuckyBonus=true`) triggrer korrekt i ny BingoEngine.

### 3.4 Voucher-innløsning

- **Status:** 🟡 Delvis portert (kun admin)
- **Legacy klient:** `legacy/unity-client/Assets/_Project/_Scripts/Panels/Voucher Panel/VoucherPanel.cs` — spiller-klient viser en **liste med vouchers** (`VoucherData[]`) med "redeem"-knapp per voucher.
- **Legacy backend:** `legacy/unity-backend/App/Controllers/VoucherController.js` — admin CRUD for vouchers (voucherView, permission-checks).
- **Mekanikk:**
  - Admin oppretter voucher (ID, type, expiry, points-verdi).
  - Spiller henter liste med `ApplyVoucherCode`-socket (Game 4 har det i socket-handler; Game 1/2/3 har det kommentert ut).
  - Voucher blir addet til wallet eller brukes som gratis ticket-purchase.
- **Ny kode:** Vi har nylig implementert backend-endepunkt for voucher-administrasjon, men **klient-flyt** (spiller-side innløsning) er ikke implementert.
- **Portering-estimat:** ~2-3 dev-dager (klient-UI + eksisterende backend-integrasjon).

### 3.5 Bot Game

- **Status:** Ikke implementert i ny stack. **Legacy har det** (verifisert — `dailySchedule.isBotGame`, `savedGame.isBotGame`). Tobias har sagt "droppet" — bekreftet at denne **ikke skal portes**.
- **Legacy-felt:** `isBotGame: Boolean` på `dailySchedule`, `savedGame`, `parentGame`, `game`. `otherData.isBotGame` brukes i notifikasjoner ("Real player vs Bot").
- **Handling:** Ingen — dokumenter bare at legacy støttet det for å unngå forvirring i fremtidige rapporter.

### 3.6 Elvis Ticket Replace

- **Status:** 🟡 Delvis portert
- **Legacy klient:** `Game1ViewPurchaseElvisTicket.cs` — panel for å vise + bytte Elvis-bilder.
- **Legacy backend:** `Game1Controller.replaceElvisTickets`, socket-event `ReplaceElvisTickets`.
- **Mekanikk:** Spiller med Elvis-bong ser 5 mulige Elvis-bilder (Elvis 1-5) og kan erstatte bongen med annen versjon før spill starter. Hver Elvis har forskjellig premie (500/1000/1500/2000/2500 kr) ifølge papir-plan.
- **Ny kode:** `packages/game-client/src/assets/elvis/` har SVG-er og `ElvisAssetPaths.ts`. `BingoTicketHtml.elvis.test.ts` indikerer rendering-støtte. **Replace-flyt** (spiller bytter Elvis-ID) er **ikke** verifisert implementert.
- **Gjenstår:** Klient-UI for bytte + backend-endepunkt for Elvis-swap.

### 3.7 Swap Ticket (Game 5-spesifikt)

- **Status:** ❌ Ikke portert (del av Game 5, ikke prioritet for pilot)
- **Legacy:** `legacy/unity-backend/Game/Game5/Controllers/GameController.js:swapTicket` — generer ny random ticket (9 tall fra 1-36) for eksisterende ticket-ID. Kun lov når `gameData.status == "Waiting"`.
- **Socket:** `SwapTicket`.
- **Portering-estimat:** ~1-2 dev-dager hvis Game 5 prioriteres senere.

### 3.8 Rocket Ticket (Game 2 bonus)

- **Status:** 🟡 Delvis portert (mangler visning)
- **Legacy klient:** `RocketTicket.cs` + `RocketTicketManager.cs` (Game 2).
- **Legacy backend:** `legacy/unity-backend/Game/Game2/Controllers/GameProcess.js` — `rocketLaunch` emit via broadcast `Game2RocketLaunch`.
- **Mekanikk:** Når et visst antall bonger er solgt (`purchasedTicketsCountTxt`), animasjon av rakett-oppskyting. Visuell belønning — ingen direkte gevinst, men indikerer at jackpot-pot har nådd en threshold.
- **Ny kode:** Ikke verifisert implementert i Game 2 ny stack.
- **Portering-estimat:** ~1-2 dev-dager (ren visuell, ingen komplisert logikk).

---

## 4. Per-spill unike features

### 4.1 Spill 1 (Game 1)

| Feature | Legacy-sti | Status | Kommentar |
|---|---|---|---|
| 5-fase bingo | `legacy/unity-backend/Game/Game1/Controllers/GameProcess.js` | ✅ | Portert til BingoEngine |
| Per-farge jackpot | `savedGame.jackpotPrize` object | ✅ | PR #316 + per-farge-utvidelse |
| Trafikklys | `game.trafficLightExtraOptions` | ✅ | `DEFAULT_TRAFFIC_LIGHT_CONFIG` |
| Lucky Number Bonus | `game.luckyNumberBonusWinners` | 🟡 | UI-picker finnes, bonus-utbetaling trenger verifisering |
| Mystery Game-integrasjon | `pattern.isMys` | ❌ | Ingen engine i ny stack |
| Chat (in-game) | `Game1/Services/ChatServices.js` | ✅ | Portert til `ChatPanel` |
| Number Completed-varsling | `Game1GamePlayPanel.Interactions.cs` | ❌ | Popup når spiller får siste nummer på en rad — ikke portert |
| Pick Any Number (Game 3 faktisk) | — | ❌ | Spill 1 har det ikke — ligger i Spill 3 |
| Elvis ticket-type | `Game1ViewPurchaseElvisTicket.cs` | 🟡 | Assets finnes, bytte-flyt mangler |

### 4.2 Spill 2 (Game 2)

| Feature | Legacy-sti | Status | Kommentar |
|---|---|---|---|
| 72-ball bingo 3×3 | `Game2/Sockets/game2.js` | ✅ | Portert (Game2Engine) |
| **Blind ticket purchase** | `Game2BuyBlindTickets`-socket | 🟡 | Se om `packages/game-client/src/games/game2/` har denne flyten |
| Rocket-ticket-animasjon | `RocketTicket.cs` + `Game2RocketLaunch`-broadcast | 🟡 | Backend logikk sannsynligvis, klient-visual mangler |
| Jackpot-tall 9/10/11/12/13/14-21 | `game.jackPotNumber` array + `Game2JackpotTable.ts` | ✅ | Portert til `Game2JackpotTable` |
| Speed Dial (5/10/15/20/25/30 boards) | Nevnt i `LEGACY_1_TO_1_MAPPING` | ❌ | Spillhastighet-konfig mangler i admin-UI |
| Lucky Number | `SelectLuckyNumber` socket | 🟡 | `LuckyNumberPicker.ts` finnes |

### 4.3 Spill 3 (Game 3)

| Feature | Legacy-sti | Status | Kommentar |
|---|---|---|---|
| 75-ball bingo 5×5 | `Game3/Sockets/game3.js` | ✅ | Portert |
| **Pick Any Number** | `Game3TicketPurchasePanel.cs` | ❌ | Spiller kan velge custom nummer-layout — ikke portert |
| **32-pattern variant** | `game3TicketCheck32` (nevnt i audit-scope) | ❌ | Ikke funnet i denne auditen — sannsynligvis utgått funksjon i legacy |
| Speed Dial | Nevnt i `LEGACY_1_TO_1_MAPPING` | ❌ | Mangler |
| Lucky Number | `SelectLuckyNumber` socket | 🟡 | Samme som Game 2 |

### 4.4 Spill 4 (legacy Game 5)

| Feature | Legacy-sti | Status | Kommentar |
|---|---|---|---|
| Rulett + tickets 3×3 (9 tall 1-36) | `Game5/Sockets/game5.js` + `Game5Helper.generateRandomTicket` | ❌ | Ikke portert |
| SwapTicket | `GameController.swapTicket` | ❌ | Ikke portert |
| SelectWofAuto + SelectRouletteAuto | `GameProcess.selectWofAuto/selectRouletteAuto` | ❌ | Ikke portert |
| Free Spin Jackpot (WOF-preview) | `Game5FreeSpinJackpot.cs` | ❌ | Se 2.1 over |
| Rulett-fysikk (ball path) | `BallPathRottate.cs`, `BallScript.cs`, `DrumRotation.cs` | ❌ | Ikke portert |
| Pattern multiplier (x-multiplikator per pattern) | `game.allPatternArray[].multiplier` | ❌ | Ikke portert (Spill 1 har fixed/percent, ikke multiplier) |
| **Pattern Jackpot_1 / Jackpot_2** | `checkForWinners` spesial-håndtering | ❌ | Legacy har 2 separate jackpot-patterns |
| Verified Player-sjekk | `isGameAvailbaleForVerifiedPlayer` socket | ❌ | Ikke portert |

---

## 5. TV-skjerm-komponenter (`SpilloramaTv` / `BingoHallDisplay`)

### 5.1 Ferdig portert til ny TV-UI (PR #411 + #424)

| Komponent | Legacy-sti | Status |
|---|---|---|
| Ball-drawn counter | `Ball_Drawn_Count_Txt` | ✅ |
| Current game-navn + game-number | `Current_Game_Name_Txt`, `Game_Count_Txt` | ✅ |
| Pattern-tabell (aktivt pattern) | `prefabWinnerDetails` listing | ✅ (PR #424) |
| Empty-state-layout (Bølge 1) | `a129bda0` | ✅ |

### 5.2 Delvis portert

| Komponent | Legacy-sti | Status | Gap |
|---|---|---|---|
| Voice-språk-valg (Norsk Male/Female/English) | `soundlanguage` enum, `PlayNorwegianMaleNumberAnnouncement`, `SoundManager` | 🟡 | Ny TV har lyd-muting, men mangler voice-selector-UI |
| Mute/unmute-knapp | `soundBtn` + `SoundManager.TvScreenSoundStatus` | 🟡 | Ny TV har det som toggle, men ikke vist som visual-knapp på hall-display |

### 5.3 Ikke portert

| Komponent | Legacy-sti | Status | Portering-estimat |
|---|---|---|---|
| **ClaimWinnerPanel** (når spiller melder Bingo) | `Panels/Bingo Hall Display/ClaimWinnerPanel.cs` | ❌ | ~2-3 dager — viser claim-tall, pattern-highlight, "Valid/Invalid" |
| **MissedWinningClaimsData** (unclaimed winners) | `Prefabs/Admin Hall Display Panel/Missed Winning Claims Data.prefab` + `savedGame.otherData.unclaimedWinners` | ❌ | ~2-3 dager — liste-prefab under game |
| **AdminExtraGameNotifications** | `adminExtraGameNoti`-broadcast + `PanelMiniGameWinners` | ❌ | ~2 dager |
| **PanelMiniGameWinners** (mini-game-vinnere på TV) | `PanelMiniGameWinners.cs` | ❌ | ~2 dager — viser hvem som vant mini-game + beløp |
| **ScreenSaverManager** | `Core/ScreenSaverManager.cs` + `Scheduler-controller image upload` | ❌ | ~3-4 dager — admin kan konfigurere bilder + per-image tid; TV viser disse ved inaktivitet |

### 5.4 Dokumenterte gaps i ny TV (`apps/admin-web/src/pages/tv/`)

Basert på det jeg kan se i git-historikken (PR #411, #424, #425, #426):
- TV har grunnleggende ball-animasjon og pattern-visning
- Mangler: JackPotData, trafikklys-animasjon, lyd-annonsering (kun norsk male/female ifølge legacy).

---

## 6. Agent-app (bingovert-portal) game-specific features

Per `LEGACY_1_TO_1_MAPPING_2026-04-23.md` er hele Agent-portalen (~30 Wireframe-sider) på ~5% portert. Relevante **game-specific** agent-features (ikke CRUD/Kasse/Unique ID — det er dekket i PM_HANDOFF) som må portes:

### 6.1 Game-operasjon (fra Agent-dashboard)

| Feature | Legacy | Status | Pilot-kritisk |
|---|---|---|---|
| **Start Next Game (med Ready/Not Ready-popup)** | Agent V1.0 2025-01-06 spec | ❌ | ✅ Ja |
| **PAUSE Game and check for Bingo** | Agent V1.0 spec + admin-socket `adminExtraGameNoti` | ❌ | ✅ Ja |
| **Check for Bingo** (enter ticket → GO → pattern-validate) | Agent V1.0 spec | ❌ | ✅ Ja |
| **Reward All** (etter mini-game) | Agent V1.0 spec | ❌ | ✅ Ja |
| **Pattern-highlight i claim-popup (5×5 grid)** | Agent V1.0 spec | ❌ | ✅ Ja |

### 6.2 Mini-game-spesifikke agent-features

Agent-app-en i legacy har **ingen spesiell UI for mini-games** — mini-games trigges automatisk backend + TV. Men Agent-app-en må:
- Se status ("Wheel of Fortune running — auto-turn in 8s")
- Kunne pause en pågående mini-game (via `toggleGameStatus`-broadcast)
- Se vinnere per mini-game

### 6.3 Physical Cashout per mini-game-runde

| Feature | Legacy | Status |
|---|---|---|
| Liste over physical tickets som vant mini-game | Agent V1.0 spec | ❌ |
| Per-ticket Cashout / Rewarded-status | Agent V1.0 spec | ❌ |

---

## 7. Admin-web game-specific features

Basert på `LEGACY_1_TO_1_MAPPING_2026-04-23.md` (som dekker alle admin-gaps bredt). Her listes kun dem som er **game-spesifikke**:

| Feature | Legacy | Status |
|---|---|---|
| Mini-game config per Game 1 sub-game (prize-list + aktivt/ikke) | `MiniGamesConfigService.ts` | ✅ Portert |
| Mini-game "otherGame"-admin (definer priser per mini-game) | `otherGameController.js` + `otherGame.js`-model | 🟡 Delvis — admin-UI for endre `wheelOfFortuneprizeList` osv. trenger verifisering |
| Per-game bot-game-checkbox | Wireframe 2024-01-31 | ❌ Ikke portert (og Tobias sier "droppet") |
| Speed Dial-config for Game 2/3 | Wireframe 2024-02-21 | ❌ Ikke portert |
| Jackpot-slots-config for Game 2 (9-21) | — | 🟡 Backend har `Game2JackpotTable.ts`, admin-UI usikker |

---

## 8. Prioritert port-liste (anbefalinger)

Sortert etter pilot-kritikalitet + dev-impact.

| # | Prioritet | Feature | Est. dev-dager | Blokker pilot? | Noter |
|---|---|---|---:|---|---|
| 1 | 🔴 Høy | Mystery Game (engine + klient + TV) | 4-6 | Nei (ikke for pilot, ifølge `SPILL1_FULL_VARIANT_CATALOG` fase 3) | Men Tobias har bekreftet at dette må portes parallelt — start `feat/mystery-game-port` |
| 2 | 🔴 Høy | Innsatsen-pot (daglig-akkumulering + draw-threshold) | 3-4 | Nei (post-pilot) | Papir-plan spesifiserer |
| 3 | 🔴 Høy | Jackpott-daglig-akkumulering (+4000/dag, max 30k, multi-threshold) | 2-3 | Nei | Utvidelse av `Game1JackpotService` |
| 4 | 🟡 Medium | Number Completed-varsling (popup når siste nummer på rad trekkes) | 1-2 | Nei | Klient-only, liten implementasjon |
| 5 | 🟡 Medium | TV ClaimWinnerPanel | 2-3 | 🎯 Ja — for hall-drift | Trenger i pilot |
| 6 | 🟡 Medium | TV PanelMiniGameWinners + AdminExtraGameNotifications | 3-4 | Nei | Bonus-visuelle |
| 7 | 🟡 Medium | ScreenSaverManager (admin + TV) | 3-4 | Nei | Pent-å-ha |
| 8 | 🟡 Medium | Voucher-klient-redemption | 2-3 | Nei | Backend finnes |
| 9 | 🟡 Medium | Elvis Ticket Replace (klient + backend) | 2 | Nei | Elvis-assets finnes allerede |
| 10 | 🟢 Lav | Rocket Ticket-animasjon (Game 2 visual) | 1-2 | Nei | Kun visual |
| 11 | 🟢 Lav | Game 2 Blind Ticket Purchase | 1 | Nei | Bekreft om eksisterer |
| 12 | 🟢 Lav | Game 3 Pick Any Number | 2-3 | Nei | Kun for Game 3, ikke pilot-prioritet |
| 13 | 🟢 Lav | Game 2/3 Speed Dial (5/10/15/... boards) | 2-3 | Nei | Admin-konfig + klient-UI |
| 14 | ⏸ Utsett | Alt Game 5 / Spill 4 (rulett + jackpot) | 8-12 | Nei | Game 5 er ikke i pilot-scope |
| 15 | ⏸ Utsett | Agent-portal game-operation-features | 6-10 | ✅ Ja — pilot-blocker, men tracked i PM_HANDOFF | Se `PM_HANDOFF_2026-04-23.md` |

**Total estimat (eksl. utsett):** ~28-42 dev-dager fordelt på ~11 port-PR-er.

---

## 9. Åpne spørsmål til Tobias

1. **Mystery Game:** Skal den portes parallelt med pilot, eller post-pilot? Tobias har bekreftet at den er ikke-portert, men ikke eksplisitt tidsplan. Dette auditen anbefaler parallelt (`feat/mystery-game-port` som side-branch).

2. **Jackpot multi-draw-threshold (50→55→56→57):** Papir-planen spesifiserer dette. Legacy-kode har bare ett `jackpotDraw`-tall per game. **Er draw-eskalering kun på papiret, eller er den implementert i en legacy-branch jeg ikke har sett?** Det kan være at "eskalering" er håndtert ved å opprette **flere** Jackpot-patterns med ulike `jackpotDraw` — dette kan verifiseres ved å se på et live schedule.

3. **Innsatsen-pot:** Legacy har `innsatsenSales`-felt men jeg fant **ikke** eksplisitt pot-distribusjon-logikk i `GameProcess.js`. Er det mulig at denne er implementert i et admin-script i stedet? Trenger avklaring før porting.

4. **Game 5 (Spill 4 i ny nummerering):** Er Game 5 definitivt utenfor pilot-scope? Hvis ja, bør vi slette / arkivere `packages/game-client/src/games/game5/` for å unngå forvirring.

5. **Elvis-bilde-bytte:** Er "replaceElvisTickets" en funksjon spiller-siden har (bytte mellom 5 Elvis-versjoner) eller admin-siden (bytte Elvis-mot-ikke-Elvis)? Legacy-koden indikerer spiller-siden, men wireframe spesifiserer ikke tydelig.

6. **Game 2 Blind Ticket Purchase:** Legacy har `Game2BuyBlindTickets`-socket. Finnes denne i ny stack eller ble den fjernet bevisst? Bør verifiseres ved å søke `packages/game-client/src/games/game2/`.

7. **Voice-språk på TV:** Legacy støtter Norwegian Male, Norwegian Female, English. Ny TV har ikke-verifisert støtte. Bør vi beholde alle 3, eller bare norsk?

---

## Appendix A — Legacy directory-struktur (for senere referanse)

```
legacy/unity-client/Assets/_Project/_Scripts/
├── Panels/
│   ├── Mystery Game Panel/           ← Mystery Game (IKKE PORTERT)
│   ├── Wheel Of Fortune/             ← WoF (portert)
│   ├── Treasure Chest/               ← Chest (portert)
│   ├── Color Draft/                  ← ColorDraft (portert)
│   ├── Bingo Hall Display/           ← TV-skjerm
│   ├── Voucher Panel/                ← Voucher-innløsning (klient mangler)
│   ├── Game/                         ← LuckyNumber, SplitScreen, Multi-Screen
│   └── ...
├── Game1/                            ← Bingo 75-ball 5×5
├── Game2/                            ← Bingo 72-ball 3×3 + Rocket
├── Game3/                            ← Bingo 75-ball + Pick Any
├── Game4/                            ← (unused i legacy?)
└── Game5/                            ← Rulett + Jackpot (IKKE PORTERT)

legacy/unity-backend/
├── App/
│   ├── Controllers/                  ← Admin REST-endepunkter
│   └── Models/                       ← MongoDB-schemas
├── Game/
│   ├── Game1/, Game2/, Game3/, Game4/, Game5/
│   │   ├── Controllers/
│   │   ├── Services/
│   │   └── Sockets/                  ← Socket.IO-handlere per spill
│   ├── AdminEvents/                  ← Admin-socket (joinHall, getNextGame)
│   └── Common/
├── gamehelper/
│   ├── game1.js, ..., game5.js
│   └── common.js
└── Helper/
```

## Appendix B — Legacy socket-events per spill

| Game | Socket-events (fra `*/Sockets/*.js`) |
|---|---|
| Game 1 | Game1Room, SubscribeRoom, PurchaseGame1Tickets, CancelGame1Tickets, UpcomingGames, SelectLuckyNumber, ViewPurchasedTickets, ReplaceElvisTickets, StartGame, SendGameChat, GameChatHistory, LeftRoom, AdminHallDisplayLogin, gameFinished, **WheelOfFortuneData**, **PlayWheelOfFortune**, **WheelOfFortuneFinished**, **TreasureChestData**, **SelectTreasureChest**, **MysteryGameData**, **SelectMystery**, **ColorDraftGameData**, **SelectColorDraft**, CancelTicket, StopGameByPlayers, TvscreenUrlForPlayers |
| Game 2 | Game2Room, SubscribeRoom, Game2PlanList, Game2TicketPurchaseData, **Game2BuyBlindTickets**, Game2BuyTickets, CancelGameTickets, CancelTicket, SelectLuckyNumber, SendGameChat, GameChatHistory, LeftRoom, **LeftRocketRoom** |
| Game 3 | Game3Room, SubscribeRoom, Game3PlanList, GetGame3PurchaseData, PurchaseGame3Tickets, CancelGameTickets, CancelTicket, LeftRoom, SelectLuckyNumber, SendGameChat, GameChatHistory |
| Game 4 | isGameAvailbaleForVerifiedPlayer, ApplyVoucherCode, Game4Data, Game4ChangeTickets, Game4Play, **WheelOfFortuneData**, **WheelOfFortuneFinished**, **PlayWheelOfFortune**, **TreasureChestData**, **SelectTreasureChest**, **MysteryGameData**, **MysteryGameFinished**, Game4ThemesData |
| Game 5 | isGameAvailbaleForVerifiedPlayer, Game5Data, **SwapTicket**, Game5Play, checkForWinners, LeftRoom, **WheelOfFortuneData**, **PlayWheelOfFortune**, **SelectWofAuto**, **SelectRouletteAuto** |
| AdminEvents | joinHall, joinRoom, getNextGame, getOngoingGame, getHallBalance, onHallReady, getWithdrawPenddingRequest, gameCountDownTimeUpdate, secondToDisplaySingleBallUpdate, checkTransferHallAccess, transferHallAccess, approveTransferHallAccess |

## Appendix C — `otherGame` MongoDB-kolleksjon (legacy)

Fra `legacy/unity-backend/App/Models/otherGame.js`:

```javascript
const otherGameSchema = new Schema({
    treasureChestprizeList: { type: 'array', default: [] },
    mysteryPrizeList:       { type: 'array', default: [] },
    wheelOfFortuneprizeList:{ type: 'array', default: [] },
    colordraftPrizeList:    { type: 'array', default: [] },
    slug:                    { type: 'string', default: '' },  // 'treasureChest' / 'mystery' / 'wheelOfFortune' / 'colorDraft'
    ...
});
```

**Nøkkel-observasjon:** Alle 4 mini-games har sin prize-list her. Slug-basert lookup betyr at admin kan redigere priser sentralt, og alle spill som bruker det mini-game ser samme pris-liste. Ikke per-hall-unik.

**Ny stack mapping:** `apps/backend/src/admin/MiniGamesConfigService.ts` håndterer dette per game-management. **Verifiser at Mystery-prize-list-felt finnes i ny MiniGamesConfig når Mystery Game portes.**
