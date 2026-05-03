# Game 3 — Monster Bingo / Mønsterbingo (Web-implementasjon)

**Status:** Funksjonell MVP — 5x5 grids + chat + animert kulekø
**Dato:** 2026-04-17 (opprinnelig: 2026-04-14)

> **Autoritativ spesifikasjon:** [`docs/engineering/game3-canonical-spec.md`](../../../../../docs/engineering/game3-canonical-spec.md) (BIN-530).
> Ved motsigelser vinner canonical spec. Se spec §11 for G3-unike avvik (waypoint-bane, pattern-animasjon, multiple patterns) + G1-paritets-avvik.

## Hva er implementert

Fullstendig gameplay-loop med 5x5 grid, chat-panel, og animert kulekø (Game 3-signatur).

### Animert kulekø (port av Unity BingoNumberBalls + BallScript)

- Vertikal FIFO-kø med maks 5 synlige kuler (venstre side)
- Nye kuler dropper inn fra toppen med akselerasjonsanimasjon (`power2.in`)
- Skala 1.2x → 1.0x ved ankomst (matcher Unity `highlightScale`)
- Når køen er full: eldste fader ut, resten skyves ned, ny kule dropper inn
- Fargekodet etter tallområde (rød/oransje/gull/teal/blå)

### Filer

```
packages/game-client/src/games/game3/
├── Game3Controller.ts              # State machine med gameSlug "monsterbingo"
├── README.md                       # ← denne filen
├── screens/
│   └── PlayScreen.ts               # 5x5 grids + chat + AnimatedBallQueue (venstre side)
└── components/
    └── AnimatedBallQueue.ts         # FIFO kulekø med GSAP drop-animasjon
```

### Gjenbruk

- `screens/LobbyScreen.ts` og `screens/EndScreen.ts` fra Game 2
- `components/ChatPanel.ts` fra Game 1 (HTML input overlay)
- `components/TicketCard.ts`, `TicketScroller.ts`, `ClaimButton.ts`, `PlayerInfoBar.ts` fra Game 2
- `logic/ClaimDetector.ts`, `logic/TicketSorter.ts` fra Game 2

### Backend-integrasjon

Identisk med Game 1/Game 2. Backend slug: `"monsterbingo"`.

### Kjente begrensninger (MVP)

- **Waypoint-bane utsatt** — Unity har BallPathRottate.cs med waypoint-lerp og speed modifier. Nåværende implementasjon bruker enkel vertikal drop. Kan legges til senere med GSAP timeline.
- **Mønsteranimasjon utsatt** — Ping-pong skala-animasjon for mønstre (PrefabBingoGame3Pattern.cs)

### Hva er unikt for Game 3 vs Game 1

| Aspekt | Game 1 (Classic) | Game 3 (Monster) |
|--------|-----------------|------------------|
| Kulekø | Kun DrawnBallsPanel (horisontal) | AnimatedBallQueue (vertikal) + DrawnBallsPanel |
| Layout | Tickets fra venstre kant | Tickets forskjøvet for å gi plass til kulekø |

### Testing

```
http://localhost:4000/web/?webClient=game_3
```
Eller test alle: `?webClient=all`
