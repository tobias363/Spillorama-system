# Game 1 — Classic Bingo (Web-implementasjon)

**Status:** Funksjonell MVP — 5x5 grids + chat + LINE/BINGO claims
**Dato:** 2026-04-14
**Branch:** feat/seed-halls

## Hva er implementert

### Fullstendig gameplay-loop (gjenbruk fra Game 2)
1. **Lobby** → joiner rom, ser spillerantall og nedtelling
2. **Arm/kjøp** → auto-arm ved join + re-arm etter hver runde
3. **Nedtelling** → GSAP-animert countdown
4. **Gameplay** → 5x5 billettkort med fri sentercelle, numre markeres i sanntid
5. **Claim** → LINE/BINGO deteksjon → server-validering
6. **Chat** → sanntids chat-panel (høyreside)
7. **Game end** → resultatskjerm → automatisk loop tilbake til lobby

### Forskjeller fra Game 2

| Aspekt | Game 2 (Rocket) | Game 1 (Classic) |
|--------|-----------------|------------------|
| Grid | 3x5 (15 celler) | 5x5 (25 celler, sentercelle fri) |
| Chat | Ingen | Sanntids chat-panel (høyreside) |
| Mini-spill | Ingen | ✅ Lykkehjul + Skattekiste (veksler, server-styrt) |
| Mønstervisualisering | Ingen | Utsatt (5 Unity design-typer er UI-only) |

### Filer

```
packages/game-client/src/games/game1/
├── Game1Controller.ts          # State machine, mini-game routing, gjenbruker Game 2-arkitektur
├── README.md                   # ← denne filen
├── screens/
│   ├── PlayScreen.ts           # 5x5 grids + chat-panel + claim-knapper
│   ├── LobbyScreen.ts          # → gjenbruker Game 2 LobbyScreen direkte
│   └── EndScreen.ts            # → gjenbruker Game 2 EndScreen direkte
└── components/
    ├── ChatPanel.ts            # Sanntids chat med meldingshistorikk
    ├── WheelOverlay.ts         # Lykkehjul mini-game (8 segmenter, GSAP spin)
    └── TreasureChestOverlay.ts # Skattekiste mini-game (N kister, server-styrt)
```

### Gjenbruk fra Game 2

Følgende filer importeres direkte fra `games/game2/`:
- `screens/LobbyScreen.ts` — identisk lobby-flow
- `screens/EndScreen.ts` — identisk resultatvisning
- `components/TicketCard.ts` — nå konfigurerbar gridSize (3x5 eller 5x5)
- `components/TicketScroller.ts`, `DrawnBallsPanel.ts`, `ClaimButton.ts`, `PlayerInfoBar.ts`
- `components/BuyPopup.ts`, `LuckyNumberPicker.ts`, `CountdownTimer.ts`
- `logic/ClaimDetector.ts` — LINE/BINGO fungerer på 5x5 (rader=5 celler, kolonner=5 celler)
- `logic/TicketSorter.ts`

### Backend-integrasjon

Identisk med Game 2, pluss chat:

| Socket event | Retning | Brukt til |
|---|---|---|
| `room:create` | client→server | Joine rom med `gameSlug: "bingo"` |
| `bet:arm` | client→server | Kjøpe billetter |
| `chat:send` | client→server | Sende chat-melding |
| `chat:history` | client→server | Hente meldingshistorikk |
| `room:update` | server→client | Full spillstatus |
| `draw:new` | server→client | Nytt trukket tall |
| `pattern:won` | server→client | Mønster vunnet |
| `chat:message` | server→client | Ny chat-melding |
| `minigame:activated` | server→client | Mini-spill aktivert etter BINGO (lykkehjul/skattekiste) |
| `minigame:play` | client→server | Spill mini-game (selectedIndex for skattekiste) |

### Kjente begrensninger (MVP)

- ~~**Mini-spill utsatt**~~ — ✅ Lykkehjul og skattekiste er fullstendig implementert (backend + frontend)
- **Mønstervisualisering utsatt** — De 5 Unity design-typene (rad, 2-rader, 3-rader, etc.) er UI-only, ikke claim-logikk
- **3 billettyper utsatt** — Farge/trafikklys/elvis-varianter er visuell styling
- **Chat bruker HTML overlay input** — Fungerer, men posisjonering kan forbedres ved resize
- **Visuell polish mangler** — Placeholder-grafikk

### Testing

```
http://localhost:4000/web/?webClient=game_1
```
Klikk Bingo. Feature flag matcher via `gameNumber: 1`.

For å teste begge spill samtidig:
```
http://localhost:4000/web/?webClient=all
```

### Teknisk stack

Identisk med Game 2: PixiJS 8 + GSAP 3 + socket.io-client 4 + TypeScript
