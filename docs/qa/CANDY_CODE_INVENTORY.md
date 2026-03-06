# Candy Code Inventory (2026-03-06)

## Scope
Kartlegging av hovedflyter i Candy for å redusere overlapp og gjøre runtime-kodeveien deterministisk.

## ACTIVE (autoritative flyter)
1. `Candy/Assets/Script/CandyLaunchBootstrap.cs`
   - Launch token resolve (`#lt=`) og runtime-context applicering.
2. `Candy/Assets/Script/APIManager.cs`
   - Realtime bootstrap, room lifecycle, scheduler sync, diagnostics.
3. `Candy/Assets/Script/APIManager.RealtimeState.cs`
   - Snapshot processing, tickets/draw/win visual sync.
4. `Candy/Assets/Script/APIManager.RealtimePlayFlow.cs`
   - Play/start/draw/claim/reroll handling mot backend.
5. `Candy/Assets/Script/BingoRealtimeClient.cs`
   - Socket transport og realtime event/ack kontrakter.

## LEGACY (stottes fortsatt, men ikke autoritativ multiplayer-flyt)
1. `Candy/Assets/Script/NumberGenerator.cs`
   - Lokal draw/pattern/render flyt brukt i fallback/visualisering.
2. `Candy/Assets/Script/EventManager.cs`
   - Legacy event-sentral for lokal spillflyt.
3. `Candy/Assets/Script/APIManager.cs` legacy HTTP start-kall (`legacyStartCallEnabled`).

## REMOVE_CANDIDATE (etter stabilisering)
1. Runtime auto-oppretting av kritiske realtime-komponenter i produksjonsflyt.
2. Editor lokal fallback-runde i standard runtime-flyt.
3. Ubrukte helper-flyt som dupliserer launch/bootstrap.

## Ryddeprioritet
1. Én startup-flyt: `CandyLaunchBootstrap` -> `APIManager` -> `JoinOrCreateRoom`.
2. Én autoritativ multiplayer-state: `APIManager*` + backend snapshot.
3. Isolere legacy-lokal modus bak tydelig dev-flagg.
