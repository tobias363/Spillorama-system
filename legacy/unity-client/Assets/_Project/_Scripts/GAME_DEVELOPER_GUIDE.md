# Game Developer Guide — Spillorama Unity Client

Oppdatert: 12. april 2026

## Oversikt

Unity-klienten kommuniserer utelukkende med **Spillorama-backenden**. Det gamle AIS-systemet
(`GameSocketManager` / `EventManager` / `BestHTTP.SocketIO`) er fullstendig fjernet fra alle
spillskript (Game 1-5). All spillkommunikasjon går nå gjennom:

- **`SpilloramaSocketManager`** — Socket.IO-tilkobling mot Spillorama-backend
- **`SpilloramaGameBridge`** — Oversetter Spillorama socket-events til spillspesifikke datatyper
- **`SpilloramaApiClient`** — REST-kall (profil, wallet, compliance)

---

## Arkitektur

### Nettverkslag

| Komponent | Ansvar |
|-----------|--------|
| `SpilloramaApiClient` | REST: GET /api/auth/me, /api/wallet/me, /api/wallet/me/compliance |
| `SpilloramaSocketManager` | Socket: room:join, room:update, game events |
| `SpilloramaGameBridge` | Konverterer snapshots til Game1Data, Game2Data, ..., Game5Data |

### Spillstart-flyt

```
Web shell (lobby.js) → NavigateToGame("N") → UIManager.LaunchHostGame("N")
  → LobbyGameSelection.LaunchGameFromHost("N")
    → Spill 1-3: GamePlanPanel.GameN() → GamePlanPanel.OpenGameN()
    → Spill 4-5: LaunchGameWithComplianceCheck_Spillorama(openPanel)
    → Spill 6 (Candy): OnCandyButtonTap() → iframe redirect
```

### Spilltyper

| Spill | Type | Mønster |
|-------|------|---------|
| Game 1 (Bingo) | Multiplayer, sanntid | Room subscription — backend trekker tall, broadcaster til alle |
| Game 2 (Rocket Bingo) | Multiplayer, sanntid | Samme som Game 1 |
| Game 3 (Monster Bingo) | Multiplayer, sanntid | Samme som Game 1 |
| Game 4 (Tema Bingo) | Singleplayer, instant | Request/response — klient sender play, server returnerer alle tall+vinnere |
| Game 5 (Spillorama Bingo) | Hybrid | Room subscription + individuell roulette/minispill |

---

## Filstruktur per spill

Hvert spill bruker partial classes for å dele opp logikken:

| Fil | Innhold |
|-----|---------|
| `GameNGamePlayPanel.cs` | Felter, Unity-callbacks (Awake/OnEnable/OnDisable), SetData, properties |
| `GameNGamePlayPanel.SocketFlow.cs` | CallSubscribeRoom, EnableBroadcasts, DisableBroadcasts, event handlers |
| `GameNGamePlayPanel.Interactions.cs` | UI-knapper (play, bet, ticket selection, lucky number) |
| `GameNGamePlayPanel.Patterns.cs` | Pattern matching, 1-to-go highlight (Spill 3-5) |
| `GameNGamePlayPanel.Tickets.cs` | Billett-generering, kjøp, reset (Spill 4) |
| `GameNGamePlayPanel.MiniGames.cs` | Wheel of Fortune, Treasure Chest, Mystery Game (Spill 1) |
| `GameNGamePlayPanel.RouletteAndTickets.cs` | Roulette spinner, billett-generering (Spill 5) |
| `GameNGamePlayPanel.ChatLayout.cs` | Chat-panel layout (Spill 1) |
| `GameNGamePlayPanel.UpcomingGames.cs` | Kommende spill-visning (Spill 1) |

### Støttefiler per spill

| Fil | Innhold |
|-----|---------|
| `GameNPanel.cs` | Toppnivå-panel, åpner/lukker gameplay-panel |
| `GameNTicketPurchasePanel.cs` | Billettbutikk (velg antall, kjøp) |
| `PrefabGamePlanNTicket.cs` | Spillplan-flis i lobbyen (Buy/Play-knapper) |
| `PrefabGameNUpcomingGame(s).cs` | Kommende spill-popup (kjøp/kanseller) |
| `PrefabBingoGameNTicketNxN.cs` | Billett-prefab med nummer-celler og markering |
| `PrefabBingoGameNPattern.cs` | Bingo-mønster-prefab |

---

## Spillspesifikke detaljer

### Game 1 (Bingo) — FUNGERER

**Filer**: `_Scripts/Game1/` — 23 filer

**Spillorama-flyt**:
1. `GamePlanPanel.Game1()` → bygger `Game1Data` fra `SpilloramaGameBridge.LatestSnapshot`
2. `CallSubscribeRoom()` → subscribes til Spillorama rom-events
3. `EnableBroadcasts()` → lytter på `SpilloramaSocketManager.OnRoomUpdate`
4. Sanntids-events oppdaterer UI via `*_Spillorama`-handlere

**Nøkkelfiler**:
- `Game1GamePlayPanel.SocketFlow.cs` — rom-subscription og broadcast-handlers
- `Game1GamePlayPanel.MiniGames.cs` — minispill (WOF, Treasure Chest, Mystery, Color Draft)
- `Game1GamePlayPanel.Interactions.cs` — lucky number, marker-endring
- `Game1TicketPurchasePanel.cs` — billettbutikk med sub-typer
- `Game1ViewPurchaseTicketUI.cs` — visning av kjøpte billetter (color/traffic-light/elvis)

**Stub-endepunkter som mangler Spillorama REST**:
- `CallGame1PurchaseDataEvent()` — hent billettdata
- `CallPurchaseEvent()` — kjøp billetter
- `OnLuckyNumberSelection()` — velg lucky number (oppdaterer UI lokalt, men mangler backend-bekreftelse)
- `View_Purchased_Ticket()` — vis kjøpte billetter
- `Cancel_Tickets_Btn()` — kanseller billetter
- Minispill: WOF, Treasure Chest, Mystery Game, Color Draft

---

### Game 2 (Rocket Bingo) — FUNGERER

**Filer**: `_Scripts/Game2/` — 9 filer

**Spillorama-flyt**: Samme arkitektur som Game 1.

**Nøkkelfiler**:
- `Game2GamePlayPanel.SocketFlow.cs` — rom-subscription
- `Game2TicketPurchasePanel.cs` — billettvalg med paginering og rakett-animasjon
- `RocketTicketManager.cs` — rakett-billett-stack-visning

**Stub-endepunkter som mangler Spillorama REST**:
- `FetchTicketPurchaseData()` — hent tilgjengelige billetter
- `CallBuyTicketEvent()` — kjøp valgte billetter
- `BuyMoreBoardsButtonTap()` — hent flere brett
- `OnLuckyNumberSelection()` — velg lucky number
- `Show_Upcoming_Game_UI()` — vis kommende spill
- `Buy_Tickets()` (PrefabGame2UpcomingGames) — blindkjøp
- `Cancel_Tickets_Btn()` — kanseller billetter

---

### Game 3 (Monster Bingo) — FUNGERER

**Filer**: `_Scripts/Game3/` — 12 filer

**Spillorama-flyt**: Samme arkitektur som Game 1-2.

**Nøkkelfiler**:
- `Game3GamePlayPanel.SocketFlow.cs` — rom-subscription
- `Game3TicketPurchasePanel.cs` — enkel billettbutikk (antall + pris)
- `BallPathRottate.cs` / `BallScript.cs` — ball-animasjon

**Stub-endepunkter som mangler Spillorama REST**:
- `CallGame3PurchaseDataEvent()` — hent billettdata (min/max/pris)
- `CallPurchaseEvent()` — kjøp billetter
- `OnLuckyNumberSelection()` — velg lucky number
- `Show_Upcoming_Game_UI()` — vis kommende spill
- `Buy_Tickets()` (PrefabGame3UpcomingGame) — blindkjøp
- `Cancel_Tickets_Btn()` — kanseller billetter

---

### Game 4 (Tema Bingo) — IKKE FUNKSJONELL

**Filer**: `_Scripts/Game4/` — 11 filer

**Arkitekturforskjell**: Spill 1-3 observer et delt rom. Game 4 er request/response:
klienten sender play-request → server returnerer ALLE tall + vinnere i ett svar →
klienten animerer tallene lokalt.

**Status**: AIS-kode fjernet. Spillorama play-endepunkt finnes ikke ennå.

**Nøkkelfiler**:
- `Game4GamePlayPanel.SocketFlow.cs` — `CallGame4PlayEvent()` trenger REST-kall
- `Game4GamePlayPanel.Interactions.cs` — bet-multiplier, ticket-endring
- `Game4GamePlayPanel.Patterns.cs` — mønstervisning
- `Game4GamePlayPanel.Tickets.cs` — billett-generering og -bytte
- `Game4ThemeSelectionPanel.cs` — tema-valg

**Hva som trengs**:
1. Backend: `POST /api/game4/play` → returnerer `Game4PlayResponse` (withdrawNumberList, winningTicketList, etc.)
2. `CallGame4PlayEvent()` → REST-kall til nytt endepunkt
3. `Game4ChangeTickets()` → REST-endepunkt for billett-refresh
4. `CallPlayerHallLimitEvent()` → REST-kall

**Kjernespilllogikk er intakt**: `WithdrawBingoBallAction`, `HighlightWinningPattern`, mønster/billett-generering fungerer — de trenger bare data fra backend.

---

### Game 5 (Spillorama Bingo) — DELVIS FUNGERENDE

**Filer**: `_Scripts/Game5/` — 16 filer

**Status**: Rom-subscription fungerer. Spillpanel åpnes med data fra snapshot.
Full spillflyt (play, kjøp) mangler Spillorama-endepunkt.

**Nøkkelfiler**:
- `Game5GamePlayPanel.SocketFlow.cs` — `CallSubscribeRoom()` fungerer via SpilloramaGameBridge
- `Game5GamePlayPanel.RouletteAndTickets.cs` — roulette-spinner og billett-generering
- `Game5FreeSpinJackpot.cs` — WOF-minispill (renset, trenger Spillorama-endepunkt)
- `Game5JackpotRouletteWheel.cs` — roulette-minispill (renset, trenger Spillorama-endepunkt)
- `PrefabBingoGame5Ticket3x3.cs` — billett med swap-funksjon

**Stub-endepunkter som mangler Spillorama REST**:
- `CallGame5PlayEvent()` — start spill
- `CallPlayerHallLimitEvent()` — hall-begrensning
- `SwapTicket()` (PrefabBingoGame5Ticket3x3) — bytt billett
- `spinButtonTab()` (Game5FreeSpinJackpot) — WOF auto-spin
- `spinButtonTab()` (Game5JackpotRouletteWheel) — roulette auto-spin
- `EnableBroadcasts()` — ingen sanntids-events abonnert ennå

---

## Delt infrastruktur

### SpilloramaGameBridge (`_Scripts/Bridge/SpilloramaGameBridge.cs`)

Bygger spillspesifikke datatyper fra `SpilloramaSnapshotRaw`:

| Metode | Brukes av | Status |
|--------|-----------|--------|
| `BuildGame1Data()` | Game 1 | Komplett |
| `BuildGame2Data()` | Game 2 | Komplett |
| `BuildGame3Data()` | Game 3 | Komplett |
| `BuildGame4Data()` | Game 4 | Skjelett (gameId + status) |
| `BuildGame5Data()` | Game 5 | Komplett |
| `BuildPatternDataList()` | Game 1, 3 | Komplett |
| `BuildGame5PatternList()` | Game 5 | Komplett |

### GamePlanPanel (`_Scripts/Panels/Lobby/GamePlanPanel.cs`)

Inngangspunkt for Spill 1-3. `Game1()`, `Game2()`, `Game3()` bygger data fra
`SpilloramaGameBridge.LatestSnapshot` og åpner spillpanelene.

### LobbyGameSelection (`_Scripts/Panels/Lobby/LobbyGameSelection.cs`)

Inngangspunkt for Spill 4-5 (via compliance-sjekk) og Spill 6 (Candy iframe).

---

## Slik legger du til en ny Spillorama event-handler

1. Legg til handler-metode i `SocketFlow.cs`:
```csharp
private void OnMyEvent_Spillorama(SpilloramaSnapshotRaw snap)
{
    // Oppdater UI basert på snapshot-data
}
```

2. Subscribe i `EnableBroadcasts()`:
```csharp
SpilloramaSocketManager.OnRoomUpdate += OnMyEvent_Spillorama;
```

3. Unsubscribe i `DisableBroadcasts()`:
```csharp
SpilloramaSocketManager.OnRoomUpdate -= OnMyEvent_Spillorama;
```

## Slik implementerer du et stub-endepunkt

Alle stub-metoder følger dette mønsteret:
```csharp
Debug.LogWarning("[GameN] MethodName: Spillorama endpoint not yet implemented");
```

For å implementere, erstatt med REST-kall:
```csharp
SpilloramaApiClient.Instance.PostJson<ResponseType>(
    "/api/gameN/action",
    new { gameId = data.gameId, /* params */ },
    (ResponseType resp) => {
        // Oppdater UI med response-data
    },
    (string code, string msg) => {
        Debug.LogError($"[GameN] Action failed: {code} {msg}");
        UIManager.Instance.DisplayLoader(false);
    }
);
```

---

## AIS-opprydding utført 12. april 2026

### Hva ble fjernet

All bruk av det gamle AIS-systemet er fjernet fra spillskript (Game 1-5):

| Fjernet mønster | Beskrivelse |
|-----------------|-------------|
| `EventManager.Instance.*` | Alle AIS socket-emit kall (kjøp, kanseller, lucky number, play, etc.) |
| `GameSocketManager.SocketGameN` | Socket-instanser per spill |
| `GameSocketManager.SetSocketGameNNamespace` | Namespace-setting for hvert spill |
| `GameSocketManager.OnSocketReconnected` | Reconnect-callbacks |
| `SocketGameN.On/Off/Emit` | Direkte socket broadcast subscribe/emit |
| `using BestHTTP.SocketIO` | Import av AIS socket-bibliotek |
| `Socket socket, Packet packet, object[] args` | AIS callback-signaturer |

### Filer endret per spill

**Game 1** (7 filer):
| Fil | Endring |
|-----|---------|
| `Game1TicketPurchasePanel.cs` | Fjernet GetGame1PurchaseData, PurchaseGame1Tickets, OnSocketReconnected, SocketGame1 |
| `Game1GamePlayPanel.Interactions.cs` | Fjernet SelectLuckyNumberGame1 |
| `Game1GamePlayPanel.MiniGames.cs` | Skrevet om: 280→42 linjer. Fjernet 16 SocketGame1-referanser og 4 EventManager mini-game kall |
| `Game1Panel.cs` | Fjernet AIS blind purchase |
| `PrefabGame1UpcomingGame.cs` | Fjernet Game1CancelTickets, View_Purchased_Tickets |
| `Game1PurchaseTicket.cs` | Fjernet View_Purchased_Tickets |
| `Game1ViewPurchaseTicketUI.cs` | Fjernet Replace_Elvis_Tickets |
| `Game1ViewPurchaseElvisTicket.cs` | Fjernet CancelTicketGame1 |
| `PrefabGamePlan1Ticket.cs` | Skrevet om: 131→37 linjer. Fjernet SetSocketGame1Namespace, GetGame1PurchaseData |

**Game 2** (4 filer):
| Fil | Endring |
|-----|---------|
| `Game2TicketPurchasePanel.cs` | Fjernet Game2TicketPurchaseData (5x), Game2BuyTickets, Game2List, SetSocketGame2Namespace, 4 broadcast-handlere |
| `Game2GamePlayPanel.cs` | Fjernet SelectLuckyNumberGame2, Game2List |
| `PrefabGame2UpcomingGames.cs` | Fjernet Game2BlindPurchase, SetSocketGame2Namespace, Game2CancelTickets |
| `PrefabGamePlan2Ticket.cs` | Fjernet SetSocketGame2Namespace (2x) |

**Game 3** (4 filer):
| Fil | Endring |
|-----|---------|
| `Game3TicketPurchasePanel.cs` | Fjernet GetGame3PurchaseData, PurchaseGame3Tickets, OnSocketReconnected, SocketGame3 |
| `Game3GamePlayPanel.cs` | Fjernet SelectLuckyNumberGame3, Game3List |
| `PrefabGame3UpcomingGame.cs` | Fjernet Game3Purchase, Game3CancelTickets |
| `PrefabGamePlan3Ticket.cs` | Fjernet SetSocketGame3Namespace (2x) |

**Game 5** (5 filer):
| Fil | Endring |
|-----|---------|
| `Game5GamePlayPanel.SocketFlow.cs` | Fjernet PlayerHallLimit, Game5Play, Game5PlayResponse |
| `Game5FreeSpinJackpot.cs` | Full omskriving: fjernet socket-felt, OnSocketReconnected, SelectWofAuto, alle broadcast-handlere, ReconnectOpen |
| `Game5JackpotRouletteWheel.cs` | Full omskriving: fjernet socket-felt, OnSocketReconnected, SelectRouletteAuto, alle broadcast-handlere, ReconnectOpen |
| `PrefabBingoGame5Ticket3x3.cs` | Fjernet SwapTicket_Game_5, Game5SwapTicketResponse |
| `PanelWheelCompnentContainer.cs` | Renset død kommentert kode |

### Verifikasjon

- 0 forekomster av `EventManager.Instance` i Game 1-5 skript
- 0 forekomster av `GameSocketManager` (aktive referanser) i Game 1-5 skript
- 0 forekomster av `using BestHTTP.SocketIO` i Game 1-5 skript
- Unity kompilerer uten feil

### Gjenstående AIS utenfor Game 1-5

Disse filene er delt infrastruktur og ble ikke endret i denne runden:

| Fil | Referanse |
|-----|-----------|
| `Core/BackgroundManager.cs` | `EventManager.Instance.PlayerHallLimit` (broadcast-handler) |
| `Socket Manager/EventManager*.cs` | Selve AIS event-systemet (brukes ikke av spill lenger) |
| `Socket Manager/GameSocketManager.cs` | Socket-manager (brukes ikke av spill lenger) |
| `Panels/SelectPurchaseTypePanel.cs` | `GameSocketManager.OnSocketReconnected` |

Disse kan fjernes når alle Spillorama REST-endepunkter er på plass.
