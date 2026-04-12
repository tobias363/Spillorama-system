# Unity Scripts — Strukturguide

> Sist oppdatert: 2026-04-12

Unity-prosjektet er **ren spillmotor**. Det eier IKKE login, lobby, wallet, Spillvett eller
hallvalg — alt det er i web-shellen (`backend/public/web/`).

---

## Hva Unity eier

| Ansvarsområde | Hører til |
|---|---|
| Bingo-brett, brikker, mønster | Unity |
| Ball-trekk og animasjon | Unity |
| Claim Line / Claim Bingo | Unity |
| Chat i spillet | Unity |
| Hall-display (TV-skjerm) | Unity |
| Login, registrering | **Web-shell** |
| Lobby, spillfliser | **Web-shell** |
| Wallet, saldo | **Web-shell** |
| Spillvett / tapsgrenser | **Web-shell** |
| Hallvalg | **Web-shell** |

---

## Mappestruktur

```
_Scripts/
│
├── Bridge/          ← JS↔Unity-kontrakt
│                     UIManager.WebHostBridge.cs, SpilloramaGameBridge.cs
│
├── Core/            ← Kjerne-managers
│                     UIManager.cs + partials, SoundManager, BackgroundManager, etc.
│
├── Game/            ← ALL spillogikk — ett spill, én mappe
│   ├── Game1/       ← Panel, gameplay, tickets, purchase, patterns, upcoming
│   ├── Game2/       ← Panel, gameplay, RocketTicket, tickets, upcoming
│   ├── Game3/       ← Panel, gameplay, BallScript, BingoNumberBalls, tickets, patterns
│   │   └── Editor/  ← BallDisplayEditor (editor-only, ekskludert fra build)
│   ├── Game4/       ← Panel, gameplay + partials, template, tickets, patterns
│   └── Game5/       ← Panel, gameplay + partials, tickets, patterns
│       └── MiniGames/ ← Roulette-hjul, jackpot, DrumRotation
│
├── Network/         ← Socket og REST
│                     EventManager + partials, GameSocketManager,
│                     SpilloramaSocketManager, SpilloramaApiClient
│
├── Panels/          ← UI-panels som IKKE tilhører ett enkelt spill
│   ├── Chat/
│   ├── Hall Selection/
│   ├── Lobby/       ← LobbyPanel, SelectHallDropDown, BreakTimer, PanelGameStatus
│   ├── Login Register/
│   ├── Notification Panel/
│   ├── Setting/
│   ├── Spillvett/
│   ├── Voucher Panel/
│   ├── Wallet And Deposit/
│   ├── Wheel Of Fortune/
│   └── Game/        ← Delte spill-utilities (SelectLuckyNumber, TicketColor, etc.)
│
├── Prefabs/         ← Prefab-scripts som ikke tilhører ett spill
│   ├── Bingo Tickets/  ← BingoTicket (base), BingoResultPanel (delte)
│   ├── Game Plan Tickets/ ← GamePlanTicket (base), PrefabHallGameListButton
│   └── ...          ← Andre delte prefabs
│
├── Data/            ← Datamodeller, konstanter, ScriptableObjects
│                     Constants.cs, BingoTemplates.cs, TicketTemplates.cs
│
├── Dev/
│   └── Editor/      ← Editor-only verktøy, IKKE inkludert i build
│       └── ShellSimulator.cs  ← Test gameplay uten web-shell
│
├── NonMonoScripts/  ← Pure C# dataklasser (PlayerData, EventResponse, Spillvett)
│
└── Utility/         ← Generiske hjelpere (SafeArea, TabController, FlexibleGridLayout)
```

### Regel for nye filer
1. Ny spillogikk → `Game/GameX/`
2. Ny JS-bro-funksjon → `Bridge/`
3. Nytt editor-verktøy → `Dev/Editor/`
4. Ny datamodell → `Data/`
5. Generisk hjelper → `Utility/`
6. Ny socket-handler → `Network/`

---

## Teste gameplay uten web-shell

### Åpne Shell Simulator
```
Unity-meny → Spillorama → Shell Simulator
```

Vinduet lar deg simulere alt shellen normalt sender til Unity:
1. **JWT-token** — kopier fra nettleser: `sessionStorage.getItem('spillorama.accessToken')`
2. **Hall-ID** — f.eks. `default-hall` (hent fra `GET /api/halls`)
3. **Spillnavigasjon** — Launch Game 1–5 direkte

### Steg-for-steg
1. Start backend: `cd backend && npm run dev` (kjører på port 4000)
2. Åpne `Game.unity` i Unity
3. Trykk **Play**
4. Åpne `Spillorama → Shell Simulator`
5. Lim inn JWT og trykk **Send token + hall til Unity**
6. Klikk **Launch Game X** for å gå direkte til spillet

### Hvor får jeg en JWT?
Logg inn på `http://localhost:4000/web/` i nettleseren, åpne DevTools og kjør:
```js
sessionStorage.getItem('spillorama.accessToken')
```
Kopier verdien og lim inn i Shell Simulator.

---

## Scener

| Scene | Formål |
|---|---|
| `Game.unity` | Live bingo — **hoved-scene, det er denne som deployes** |
| `Admin Bingo Hall Display.unity` | TV-display for bingo-haller |
| `Loading.unity` | Innlastingsskjerm |
| `WheelOfFortune.unity` | Hjul-spillet (frittstående) |
| `Custom Socket URL.unity` | Dev-verktøy for å sette socket-URL manuelt |

---

## Viktige regler

1. **Unity eier ALDRI login eller lobby.** Disse panelene skal ikke vises i host-modus.
2. **`Application.ExternalCall()`** brukes KUN i `Bridge/`-kode.
3. **Editor-scripts** MÅ ligge i en mappe som heter `Editor/` — ellers inkluderes de i WebGL-builden.
4. **Nye spill** → ny mappe under `Game/`, ikke legg scripts flatt i `Panels/`.
