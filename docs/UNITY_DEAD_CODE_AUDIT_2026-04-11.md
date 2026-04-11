## Unity Dead-Code Audit

Dato: 11. april 2026
Status: attende sikre pass gjennomfort

### Fjernet i denne runden

Disse filene var beviselig ubrukte eller kun backup/testartefakter:

- Unity-klient:
  - `Spillorama/Assets/_Project/_Scripts/Other/TestScript.cs`
  - `Spillorama/Assets/_Project/_Scripts/Other/Editor/TestEditor.cs`
  - `Spillorama/Assets/_Project/_Scenes/SamplePhysics.unity`
  - `Spillorama/Assets/_Project/_Scenes/Test.unity`
  - `Spillorama/Assets/StandaloneFileBrowser/Sample/BasicSampleScene.unity`
  - `Spillorama/Assets/_Project/_Scripts/Proto and Test/Skype Profile.png`
  - ubrukt tray-token helperkode i `Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs`
  - ubrukt `setVoiceLanguage(...)` i `Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs`
  - ubrukt `OpenMultiSelectionPanel(...)` i `Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs`
  - ubrukt `DisplayLoader(bool, string)` i `Spillorama/Assets/_Project/_Scripts/Manager/UIManager.cs`
  - foreldede kommentarspor og ubrukte imports i `Spillorama/Assets/_Project/_Scripts/Socket Manager/EventManager.cs`
  - `UIManager` splittet i partial-klasser for kjerne, notifikasjoner, spillpresentasjon og WebGL-host-bridge
  - `EventManager` splittet i partial-klasser for auth/profile, plattform/lobby og gameplay/socket-flyt
  - `Game1GamePlayPanel` splittet så socket/room-flyt ligger i `Game1GamePlayPanel.SocketFlow.cs`
  - `Game1GamePlayPanel` splittet videre så interaksjoner, upcoming-game, chatlayout og minigames ligger i egne partial-filer
  - `Game2GamePlayPanel` splittet så room/socket-flyt ligger i `Game2GamePlayPanel.SocketFlow.cs`
  - `Game3GamePlayPanel` splittet så room/socket-flyt ligger i `Game3GamePlayPanel.SocketFlow.cs`
  - `Game4GamePlayPanel` splittet så transport/minigame/room-flyt ligger i `Game4GamePlayPanel.SocketFlow.cs`
  - `Game4GamePlayPanel` splittet videre så interaksjoner/layout, pattern/highlight-logikk og ticket/reset-state ligger i egne partial-filer
  - `Game5GamePlayPanel` splittet så socket/minigame/room-flyt ligger i `Game5GamePlayPanel.SocketFlow.cs`
  - `Game5GamePlayPanel` splittet videre så interaksjoner, pattern/highlight-logikk og roulette/ticket/reset-state ligger i egne partial-filer
  - fjernet død `if (false)`-gren med gammel minigame-reconnectlogikk i `Spillorama/Assets/_Project/_Scripts/Panels/Game/Game 1/Game1GamePlayPanel.cs`
  - fjernet død `GenerateDummyTicket()`-helper og ubrukt `ArrayContainsValue(...)` i `Spillorama/Assets/_Project/_Scripts/Panels/Game/Game 4/Game4GamePlayPanel.cs`
  - fjernet ubrukt `SampleInput`-felt, død `GenerateRoulateData()` og kommentert gammel message-popup-branch i `Spillorama/Assets/_Project/_Scripts/Panels/Game/Game 5/Game5GamePlayPanel.cs`

- `unity-bingo-backend` controller:
  - `unity-bingo-backend/App/Controllers/GameController-old.js`

- `unity-bingo-backend` backup/test-views:
  - `unity-bingo-backend/App/Views/GameFolder/editTicket_bkp.html`
  - `unity-bingo-backend/App/Views/GameFolder/gameAdd-old.html`
  - `unity-bingo-backend/App/Views/GameFolder/gameAddOld16.html`
  - `unity-bingo-backend/App/Views/GameFolder/gameAdd_bkpMay18.html`
  - `unity-bingo-backend/App/Views/GameFolder/gameViewBkp_10_11_2022.html`
  - `unity-bingo-backend/App/Views/GameFolder/gameView_bkp.html`
  - `unity-bingo-backend/App/Views/GameFolder/gameView_bkp_15_10_2022.html`
  - `unity-bingo-backend/App/Views/GroupHall/addGroupHallTest.html`
  - `unity-bingo-backend/App/Views/PayoutforPlayers/payoutPlayers-backup.html`
  - `unity-bingo-backend/App/Views/cash-inout/product_cart_old.html`
  - `unity-bingo-backend/App/Views/hallAccountReport/hallAccount-old.html`
  - `unity-bingo-backend/App/Views/player/gameHistory-old.html`
  - `unity-bingo-backend/App/Views/player/playerStatsTest.html`
  - `unity-bingo-backend/App/Views/savedGame/gameAdd_bkp.html`
  - `unity-bingo-backend/App/Views/savedGame/gameView_bkp.html`

- `unity-bingo-backend` lokale test-/ops-artefakter:
  - `unity-bingo-backend/bingo-push-to-git.php`
  - `unity-bingo-backend/bingo_ci-cd.php`
  - `unity-bingo-backend/developement_requirement`
  - `unity-bingo-backend/spiloDev`
  - `unity-bingo-backend/test-dev.html`
  - `unity-bingo-backend/test.js`
  - `unity-bingo-backend/test.txt`

### Hvorfor disse var trygge a fjerne

- `TestScript.cs` og `TestEditor.cs` refererte bare til hverandre.
- `SamplePhysics.unity`, `Test.unity` og `BasicSampleScene.unity` var disabled i `EditorBuildSettings` og hadde ingen andre prosjektreferanser enn build-listen.
- `Skype Profile.png` hadde ingen GUID-referanser i prosjektet.
- `download.png` i samme mappe ble ikke fjernet fordi den fortsatt brukes av `AIS_CustomSprite.mat`.
- `LoadFirebaseTokenFromTray()` og `LoadTokenFromTray()` hadde ingen kode-, scene- eller prefab-referanser.
- `setVoiceLanguage(...)` hadde ingen referanser i kode, scene eller host.
- `OpenMultiSelectionPanel(...)` hadde ingen kode-, scene-, prefab- eller host-referanser.
- `DisplayLoader(bool, string)` hadde ingen kode-, scene-, prefab- eller host-referanser.
- Cleanupen i `EventManager.cs` endret ikke runtime-signaturer; den fjernet bare dokumentert foreldet kommentarkode og imports som ikke lenger brukes.
- Partial-splittingen av `UIManager`, `EventManager`, `Game1GamePlayPanel`, `Game2GamePlayPanel`, `Game3GamePlayPanel`, `Game4GamePlayPanel` og `Game5GamePlayPanel` beholdt eksisterende public API og passerte Unity compile-check og Theme2 smoke-test.
- Backup-viewene i `unity-bingo-backend` hadde ingen runtime-referanser i controllere eller `res.render(...)`.
- `addGroupHallTest.html` var bare nevnt i kommentert kode.
- `GameController-old.js` hadde ingen referanser i runtime.
- root-testfilene i `unity-bingo-backend` var ikke del av appstart, routes eller build.
- den nye lifecycle-smoken initialiserer scene-singletons eksplisitt i edit-mode i stedet for å anta at `Awake()` har kjørt, og gameplay-panelene for Game1-Game5 har nå trygge edit-mode-kortslutninger for open/subscribe-lifecycle

### Ikke fjernet i denne runden

Disse kandidatene er fortsatt ikke bevist dode nok til automatisk sletting:

- Unity-scener som ikke er i build:
  - `Spillorama/Assets/_Project/_Scenes/Custom Socket URL.unity`
  - `Spillorama/Assets/_Project/_Scenes/Admin Bingo Hall Display.unity`

- debug-/prototype-assets:
  - `Spillorama/Assets/_Project/_Scripts/Proto and Test/download.png`

- store authored runtimefiler som trolig trenger videre intern refaktor, ikke sletting:
  - `Spillorama/Assets/_Project/_Scripts/Panels/Game/Game 1/Game1GamePlayPanel.cs`
  - `Spillorama/Assets/_Project/_Scripts/Panels/Game/Game 4/Game4GamePlayPanel.cs`
  - `Spillorama/Assets/_Project/_Scripts/Panels/Game/Game 5/Game5GamePlayPanel.cs`

### Neste sikre pass

Neste oppryddingsrunde bor deles i to:

1. Unity-klient:
   - verifisere om `Custom Socket URL.unity` og `Admin Bingo Hall Display.unity` fortsatt trengs for manuell drift/debug
   - rydde prototype-assets som fortsatt ligger igjen hvis de mister siste material-/scene-referanse
   - ta ny vurdering av om Game1/Game4/Game5 trenger enda finere ansvarsdeling internt

2. `unity-bingo-backend`:
   - fjerne kommenterte testbaner i controllere
   - identifisere gamle admin-views som bare er historiske kopier

### Viktig presisering

Dette betyr ikke at "all dodkode er borte".
Det betyr at den forste, lave risiko-pass er gjort, og at source-of-truth na er i git slik at videre cleanup kan gjores kontrollert.

### Verifisering etter denne runden

Følgende automatiske sjekker er grønne etter splitten av manager-laget og Game1-Game5-panelene:

- `bash scripts/unity-compile-check.sh`
- `bash scripts/unity-theme2-smoke.sh`
- `bash scripts/unity-game-panel-smoke.sh`
- `bash scripts/unity-game-flow-contract-smoke.sh`
- `bash scripts/unity-game-panel-lifecycle-smoke.sh`
- `bash scripts/unity-game-interaction-contract-smoke.sh`
- `bash scripts/unity-game-runtime-state-smoke.sh`

Den siste testen kjøres via:

- `Spillorama/Assets/_Project/_Scripts/Other/Editor/GamePanelWiringSmokeTests.cs`
- `scripts/unity-game-panel-smoke.sh`

Den nye kontraktsmoken kjøres via:

- `Spillorama/Assets/_Project/_Scripts/Other/Editor/GameFlowContractSmokeTests.cs`
- `scripts/unity-game-flow-contract-smoke.sh`

Den nye lifecycle-smoken kjøres via:

- `Spillorama/Assets/_Project/_Scripts/Other/Editor/GamePanelLifecycleSmokeTests.cs`
- `scripts/unity-game-panel-lifecycle-smoke.sh`

Den nye interaksjonskontraktsmoken kjøres via:

- `Spillorama/Assets/_Project/_Scripts/Other/Editor/GameInteractionContractSmokeTests.cs`
- `scripts/unity-game-interaction-contract-smoke.sh`

Den nye runtime-state-smoken kjøres via:

- `Spillorama/Assets/_Project/_Scripts/Other/Editor/GameRuntimeStateSmokeTests.cs`
- `scripts/unity-game-runtime-state-smoke.sh`

og verifiserer at `Game.unity` fortsatt har intakt referanse-wiring for:

- `UIManager.game1Panel` til `UIManager.game5Panel`
- Game1-Game5 sine panelreferanser
- sentrale gameplay-/minigame-referanser som fortsatt må være satt i scenen

Kontraktsmoken verifiserer i tillegg at de sentrale per-spill entrypoints fortsatt finnes:

- panelåpning og close-flyt for Game1-Game5
- subscribe-/play-entrypoints i gameplay-panelene
- sentrale purchase-/play-kall i `EventManager`

Lifecycle-smoken verifiserer i tillegg at Game1-Game5 kan åpnes og lukkes i edit-mode uten live socket eller play-mode:

- `Game1GamePlayPanel.OpenPanel(...)` setter panelstate uten å kreve full runtime-UI
- `Game2GamePlayPanel.OpenPanel(...)` og `Game3GamePlayPanel.OpenPanel(...)` setter `Current_Game_Number` og `isGame*`
- `Game4Panel.OpenPanel()` og `Game5Panel.OpenPanel()` kan aktiveres uten `BackgroundManager`/socket-crash i batch

Interaksjonskontraktsmoken verifiserer i tillegg at de mest endringsutsatte spillflatene fortsatt finnes og er koblet opp:

- Game1 purchase- og view-purchase-flyt via `HallGameListPanel`, `Game1TicketPurchasePanel` og lucky number-entrypoints
- Game2/Game3 purchase-paneler, buy/cancel-lignende entrypoints, buy-more-boards og lucky number-flyt
- Game4 minigame-entrypoints for wheel, treasure og mystery
- Game5 jackpot/free-spin-entrypoints og reconnect-surface
- `EventManager`-kontrakter for cancel, reconnect, lucky number og minigame-API

Runtime-state-smoken verifiserer i tillegg faktiske state-overganger etter refaktor i Game4 og Game5:

- Game4 `TicketCount`, `BetValue`, `OnTicketButtonTap()` og `IsGamePlayInProcess`
- Game5 `IsGamePlayInProcess` og oppdatering av `LastWithdrawNumber`
