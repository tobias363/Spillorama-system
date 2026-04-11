# Unity Game Architecture And Change Guide
Dato: 11. april 2026
Scope: `/Users/tobiashaugen/Projects/Spillorama-system/Spillorama`

## Formål

Dette dokumentet beskriver hvordan Unity-klienten i `Spillorama-system` er organisert, hvordan de fem Unity-spillene åpnes fra lobbyen, hvilke kodepunkter som faktisk styrer hver flyt, og hva som må endres når man skal gjøre endringer trygt.

Dette er en arbeidsguide for utvikling, feilsøking og parity-arbeid mot leverandørkode.

## Hovedstruktur

Unity-klienten er delt i fire hovedlag:

1. Global app- og panelstyring
   - [`UIManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs)
   - [`UIManager.GamePresentation.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Manager/UIManager.GamePresentation.cs)
   - [`UIManager.Notifications.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Manager/UIManager.Notifications.cs)
   - [`UIManager.WebHostBridge.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Manager/UIManager.WebHostBridge.cs)
   - ansvar: aktivere paneler, topbar, login, lobby, Game1–Game5, split-screen, globale sprites, notifikasjoner og WebGL-host-bridge

2. Socket- og eventlag
   - [`GameSocketManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/GameSocketManager.cs)
   - [`EventManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.cs)
   - [`EventManager.AuthProfile.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.AuthProfile.cs)
   - [`EventManager.Platform.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.Platform.cs)
   - [`EventManager.Gameplay.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.Gameplay.cs)
   - ansvar: socket-oppkobling, namespace-håndtering, auth refresh, lobby/plattformevents og gameplay payloads mot backend

3. Lobby- og spillrouting
   - [`LobbyGameSelection.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs)
   - [`GamePlanPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/GamePlanPanel.cs)
   - ansvar: status i spillgrid, åpne riktige spill, hente romdata og sende spilleren inn i korrekt panel

4. Spillspesifikke paneler
  - `Panels/Game/Game 1/*`
  - `Panels/Game/Game 2/*`
  - `Panels/Game/Game 3/*`
  - `Panels/Game/Game 4/*`
  - `Panels/Game/Game 5/*`

Game 1 til Game 5 er nå delvis splittet:
- [`Game1GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.cs)
- [`Game1GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.SocketFlow.cs)
- [`Game2GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%202/Game2GamePlayPanel.cs)
- [`Game2GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%202/Game2GamePlayPanel.SocketFlow.cs)
- [`Game3GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%203/Game3GamePlayPanel.cs)
- [`Game3GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%203/Game3GamePlayPanel.SocketFlow.cs)
- [`Game4GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.cs)
- [`Game4GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.SocketFlow.cs)
- [`Game5GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5GamePlayPanel.cs)
- [`Game5GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5GamePlayPanel.SocketFlow.cs)

## Runtime-flyt

Den faktiske flyten i klienten er:

1. [`GameSocketManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/GameSocketManager.cs) kobler klienten til rot-socket og game namespaces.
2. [`LoginPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Login%20Register/LoginPanel.cs) bruker [`EventManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.cs) til `LoginPlayer`.
3. Etter login åpnes lobbyen.
4. [`LobbyGameSelection.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs) avgjør om et spill er tilgjengelig og sender spilleren videre.
5. [`GamePlanPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/GamePlanPanel.cs) henter romdata for Game1–Game3 og åpner riktig gameplay-panel.
6. Game4 og Game5 åpnes mer direkte fra lobbyen og henter sine data etter at panelet er aktivt.

## Test- og verifikasjonslag

Det finnes nå seks grunnleggende Unity-sjekker som bør kjøres etter hver cleanup- eller strukturendring:

1. Compile-check
   - [`unity-compile-check.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-compile-check.sh)
   - formål: oppdage rene compile-feil i Unity-skript

2. Theme2 smoke
   - [`unity-theme2-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-theme2-smoke.sh)
   - [`Theme2SmokeTests.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Other/Editor/Theme2SmokeTests.cs)
   - formål: bekrefte at scenehierarki og Theme2-flyt fortsatt er lastbar i edit-mode

3. Game panel wiring smoke
   - [`unity-game-panel-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-panel-smoke.sh)
   - [`GamePanelWiringSmokeTests.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Other/Editor/GamePanelWiringSmokeTests.cs)
   - formål: bekrefte at `Game.unity` fortsatt har intakt wiring mellom `UIManager`, Game1-Game5-panelene og de viktigste gameplay-/minigame-referansene

4. Game flow contract smoke
   - [`unity-game-flow-contract-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-flow-contract-smoke.sh)
   - [`GameFlowContractSmokeTests.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Other/Editor/GameFlowContractSmokeTests.cs)
   - formål: bekrefte at Game1-Game5 fortsatt eksponerer de viktigste runtime-entrypoints for panelåpning, subscribe og play/purchase, og at `EventManager` fortsatt har de sentrale gameplay-kallene

5. Game panel lifecycle smoke
   - [`unity-game-panel-lifecycle-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-panel-lifecycle-smoke.sh)
   - [`GamePanelLifecycleSmokeTests.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Other/Editor/GamePanelLifecycleSmokeTests.cs)
   - formål: bekrefte at Game1-Game5 kan åpnes og lukkes i edit-mode uten play-mode, live socket eller `Awake()`-avhengige singletoner

6. Game interaction contract smoke
   - [`unity-game-interaction-contract-smoke.sh`](/Users/tobiashaugen/Projects/Spillorama-system/scripts/unity-game-interaction-contract-smoke.sh)
   - [`GameInteractionContractSmokeTests.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Other/Editor/GameInteractionContractSmokeTests.cs)
   - formål: bekrefte at kjøpsflater, lucky number, reconnect og minigame-entrypoints fortsatt finnes og er koblet opp per spill

Disse seks testene er ikke full gameplay-verifisering, men de er nok til å fange:

- brutt scene-wiring etter prefab-/sceneendringer
- feil etter partial-splitting av gameplay-paneler
- manglende serialiserte referanser som ellers først ville vist seg ved runtime-klikk i lobbyen
- regressjoner der sentrale per-spill entrypoints forsvinner under refaktor
- regressjoner der panelenes open/close-lifecycle fortsatt kompilere, men ikke lenger kan kjøres trygt i batch/edit-mode
- regressjoner i de mest endringsutsatte interaksjonsflatene: kjøp, lucky number, reconnect og minigame-entrypoints

## Spilloversikt

### Game 1

Primære filer:
- [`Game1Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1Panel.cs)
- [`Game1GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.cs)
- [`Game1GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.SocketFlow.cs)
- [`Game1GamePlayPanel.Interactions.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.Interactions.cs)
- [`Game1GamePlayPanel.UpcomingGames.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.UpcomingGames.cs)
- [`Game1GamePlayPanel.ChatLayout.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.ChatLayout.cs)
- [`Game1GamePlayPanel.MiniGames.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.MiniGames.cs)
- [`Game1PurchaseTicket.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1PurchaseTicket.cs)
- [`Game1ViewPurchaseTicketUI.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1ViewPurchaseTicketUI.cs)

Hvordan det åpnes:
- lobby -> [`LobbyGameSelection.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs) -> [`GamePlanPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/GamePlanPanel.cs) -> `Game1Room`
- deretter `OpenGame1(...)`
- gameplay bruker `SubscribeRoom`

Hva styrer opplevelsen:
- game status og innsteg: `Game1Room`
- full gameplay-state: `SubscribeRoom`
- kjøp: `PurchaseGame1Tickets`
- lucky number: `SetLuckyNumber` / `GetLuckyNumber`
- ekstra flyter: Elvis replacement, voucher, cancel ticket

Game 1 er nå referanseoppsettet for videre vedlikehold:
- `Game1GamePlayPanel.cs` holder kjernepanel og render/state
- `Game1GamePlayPanel.SocketFlow.cs` holder room/socket/broadcast
- `Game1GamePlayPanel.Interactions.cs` holder lucky number, loader og små panelhandlinger
- `Game1GamePlayPanel.UpcomingGames.cs` holder upcoming-game/purchase-setup
- `Game1GamePlayPanel.ChatLayout.cs` holder chat-layout og animasjon
- `Game1GamePlayPanel.MiniGames.cs` holder wheel/treasure/mystery/color-draft

Når du endrer Game 1, må du vanligvis sjekke:
- [`GamePlanPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/GamePlanPanel.cs)
- [`Game1Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1Panel.cs)
- [`Game1GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.cs)
- Game1-relaterte eventer i [`EventManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.cs)

### Game 2

Primære filer:
- [`Game2Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%202/Game2Panel.cs)
- [`Game2GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%202/Game2GamePlayPanel.cs)
- [`Game2TicketPurchasePanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%202/Game2TicketPurchasePanel.cs)
- [`RocketTicketManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%202/RocketTicketManager.cs)

Hvordan det åpnes:
- lobby -> [`GamePlanPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/GamePlanPanel.cs) -> `Game2Room`
- deretter `OpenGame2(...)`

Hva styrer opplevelsen:
- room bootstrap: `Game2Room`
- subscribe: `SubscribeRoom`
- kjøp: `Game2TicketPurchaseData`, `Game2BuyTickets`, `Game2BuyBlindTickets`, `CancelGameTickets`

### Game 3

Primære filer:
- [`Game3Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%203/Game3Panel.cs)
- [`Game3GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%203/Game3GamePlayPanel.cs)
- [`Game3TicketPurchasePanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%203/Game3TicketPurchasePanel.cs)

Hvordan det åpnes:
- lobby -> [`GamePlanPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/GamePlanPanel.cs) -> `Game3Room`
- deretter `OpenGame3(...)`

Hva styrer opplevelsen:
- room bootstrap: `Game3Room`
- subscribe: `SubscribeRoom`
- kjøp: `GetGame3PurchaseData`, `PurchaseGame3Tickets`, `CancelGameTickets`

### Game 4

Primære filer:
- [`Game4Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4Panel.cs)
- [`Game4ThemeSelectionPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4ThemeSelectionPanel.cs)
- [`Game4GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.cs)
- [`Game4GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.SocketFlow.cs)
- [`Game4GamePlayPanel.Interactions.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.Interactions.cs)
- [`Game4GamePlayPanel.Patterns.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.Patterns.cs)
- [`Game4GamePlayPanel.Tickets.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.Tickets.cs)

Hvordan det åpnes:
- lobby -> [`LobbyGameSelection.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs) -> `Game4()`
- theme- og runtime-data hentes etter at panelene er åpne

Hva styrer opplevelsen:
- theme fetch: `Game4ThemesData`
- active room data: `Game4Data`
- ticket refresh: `Game4ChangeTickets`
- spill: `Game4Play`
- minigames i Game4: wheel, treasure chest, mystery

Game 4 er mer UI-tung enn Game1–Game3. Endringer i layout og theme må nesten alltid verifiseres visuelt i Unity-editor eller WebGL.
Game 4 følger nå samme struktur som Game 1:
- `Game4GamePlayPanel.cs` holder panel-livssyklus og kjernedata-init
- `Game4GamePlayPanel.SocketFlow.cs` holder room/broadcast/minigame-socketflyt
- `Game4GamePlayPanel.Interactions.cs` holder knappetrykk, layout og loader/utility-flyt
- `Game4GamePlayPanel.Patterns.cs` holder one-to-go-, pattern- og highlightlogikk
- `Game4GamePlayPanel.Tickets.cs` holder ticketgenerering, reset og bet-/ticket-state

### Game 5

Primære filer:
- [`Game5Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5Panel.cs)
- [`Game5GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5GamePlayPanel.cs)
- [`Game5GamePlayPanel.SocketFlow.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5GamePlayPanel.SocketFlow.cs)
- [`Game5BetCoin.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5BetCoin.cs)

Hvordan det åpnes:
- lobby -> [`LobbyGameSelection.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs) -> `Game5()`
- gameplay-panelet henter selv `Game5Data`

Hva styrer opplevelsen:
- room bootstrap: `Game5Data`
- spill: `Game5Play`
- minigame-data: `WheelOfFortuneData`
- jackpot wheel / roulette: `Game5WheelOfFortuneData`, `Game5RouletteWheelData`, `SelectRouletteAuto`

Game 5 er tettere koblet til minigame- og rouletteflyt enn de andre spillene.

## Candy i Unity-lobbyen

Candy er ikke et native Unity-spill.

Candy ligger i lobbyen via:
- [`LobbyGameSelection.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs)

Det som skjer:
- Candy-tile opprettes eller gjenbrukes i lobby-grid
- Unity kaller `Application.ExternalCall("OpenUrlInSameTab", "/candy/")` i WebGL
- host-siden på `/web/` tar over og åpner Candy som iframe/overlay

Det betyr:
- endring i Candy gameplay gjøres ikke i Unity-klienten
- endring i Candy-entry i lobby gjøres i Unity-klienten
- endring i actual Candy-launch og wallet glue gjøres i host/backend, ikke i Game1–Game5-panelene

## Hva må til for å gjøre endringer trygt

### Endre status / åpning av spill

Du må sjekke:
- [`LobbyGameSelection.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LobbyGameSelection.cs)
- [`LandingScreenController.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/LandingScreenController.cs)
- [`GamePlanPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Lobby/GamePlanPanel.cs)
- backend-eventen som faktisk leverer status

### Endre ticket purchase

Du må sjekke:
- gameplay panel for spillet
- ticket purchase panel for spillet
- eventnavn i [`EventManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.cs)
- backend-handler for samme event

### Endre layout / plassering

Du må sjekke:
- gameplay-panelet
- tilhørende prefab(er)
- theme-/sprite-avhengigheter
- split-screen-flyt der relevant

UI-endringer skal ikke gjøres kun ut fra C#-kode. De må verifiseres i scene/prefab.

### Endre auth eller socket

Du må sjekke:
- [`GameSocketManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/GameSocketManager.cs)
- [`EventManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.cs)
- [`UIManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs)
- login-panelene

## Konkrete endringsregler

1. Endre aldri bare Unity-klienten hvis eventnavn eller payload også kommer fra backend.
2. Endre aldri bare gameplay-panel hvis problemet starter i lobby/status.
3. Endre aldri bare prefab hvis logikken genererer objekter dynamisk.
4. For Game4 og Game5 må minigames alltid tas med i vurderingen.
5. For Candy må Unity-lobby, host-side og backend sees samlet.

## Opprydding gjort i denne runden

Denne runden ryddet bare lavrisiko dødkode i Unity-klienten:

- fjernet gammel `LoginTmp`-bane i [`EventManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.cs)
- fjernet ubrukte dummy-simuleringsfelt og `DummyGamePlay()` i:
  - [`Game1GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.cs)
  - [`Game2GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%202/Game2GamePlayPanel.cs)
  - [`Game3GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%203/Game3GamePlayPanel.cs)
- fjernet store døde kommentarblokker i:
  - [`UIManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs)
  - [`Game4Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4Panel.cs)
  - [`Game5Panel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5Panel.cs)

Dette er en opprydding av kode som ikke hadde runtime-effekt, pluss en strukturrefaktor der manager-laget og Game1-Game5 room/socket-flyt ble flyttet til partial-klasser. Det er fortsatt ikke en full funksjonell refaktor av Game1-Game5.

## Hva som fortsatt bør ryddes senere

Disse områdene ser fortsatt tunge eller historisk lastet ut:

- [`EventManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Socket%20Manager/EventManager.cs)
  - veldig mange events i én stor klasse
- [`UIManager.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs)
  - for mange globale flags og panelreferanser i én singleton
- Game1/Game2/Game3 gameplay-panelene
  - store monolitter med både rendering, state, socket callbacks og UI-håndtering i samme klasse

Den riktige neste oppryddingen er ikke mer “slett kommentarkode”, men videre modulær splitting:
- videre intern splitting av Game1, Game4 og Game5 hvis de fortsatt blir for brede
- ticket rendering
- minigame integrations

## Anbefalt videre arbeid

1. Gjør en ny bredde-revisjon av [`Game1GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%201/Game1GamePlayPanel.cs), [`Game4GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%204/Game4GamePlayPanel.cs) og [`Game5GamePlayPanel.cs`](/Users/tobiashaugen/Projects/Spillorama-system/Spillorama/Assets/_Project/_Scripts/Panels/Game/Game%205/Game5GamePlayPanel.cs) for å se om de bør deles enda finere.
2. Gjør en parity-sammenligning mot leverandørens Unity-kode for layout-sensitive spill.
3. Etabler en fast regel:
   - Unity scene/prefab-endringer verifiseres visuelt
   - socket-endringer verifiseres mot backend payloads
   - lobby-endringer verifiseres fra login til faktisk åpning av spill
