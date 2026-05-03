# Game 3 — Monster Bingo / Mønsterbingo (Web-implementasjon)

**Status:** Funksjonell MVP — 3×3-bonger (Spill 2 runtime) + Spill 1's stil
**Dato:** 2026-05-03 (rewrite per Tobias-direktiv) — opprinnelig 2026-04-14

> **Autoritativ spesifikasjon:** [`docs/engineering/game3-canonical-spec.md`](../../../../../docs/engineering/game3-canonical-spec.md).
> Ved motsigelser vinner canonical spec.

## 2026-05-03: Hybrid Spill 2-runtime + Spill 1-stil

Per Tobias-direktiv 2026-05-03 ble Spill 3 portet fra 5×5 / 1..75 (med Row 1-4
+ Coverall) til **3×3 / 1..21** med kun Coverall. Runtime er nå identisk med
Spill 2; det visuelle bibliotek-bruken er likt Spill 1 (ball-queue, chat,
pattern-banner). Spill 3 har ETT globalt rom (`MONSTERBINGO`), ingen group-of-
halls eller master/start/stop, og kjører perpetual loop (utbetal → ny runde
automatisk).

## Hva er implementert

- 3×3-bonger med tall fra 1..21 (samme format som Spill 2)
- Coverall (full bong) som eneste vinner-pattern
- Auto-claim på Coverall etter hver trekning
- Animert ball-queue (vertikal FIFO, maks 5 synlige) — gjenbruk fra Spill 1's stil
- Chat-panel (delt med Spill 1)
- Pattern-banner (Coverall-status)

### Animert kulekø (port av Unity BingoNumberBalls + BallScript)

- Vertikal FIFO-kø med maks 5 synlige kuler (venstre side)
- Nye kuler dropper inn fra toppen med akselerasjonsanimasjon (`power2.in`)
- Skala 1.2x → 1.0x ved ankomst (matcher Unity `highlightScale`)
- Når køen er full: eldste fader ut, resten skyves ned, ny kule dropper inn
- Fargekodet etter tallområde (1..21 fordeles over fargene)

### Filer

```
packages/game-client/src/games/game3/
├── Game3Controller.ts              # State machine med gameSlug "monsterbingo"
├── README.md                       # ← denne filen
├── screens/
│   └── PlayScreen.ts               # 3×3 grids + chat + AnimatedBallQueue (venstre side)
└── components/
    ├── AnimatedBallQueue.ts        # FIFO kulekø med GSAP drop-animasjon
    └── PatternBanner.ts            # Coverall-status (én pattern)
```

### Gjenbruk

- `screens/LobbyScreen.ts` og `screens/EndScreen.ts` fra Game 2
- `components/ChatPanel.ts` fra Game 1 (HTML input overlay)
- `components/TicketCard.ts`, `TicketScroller.ts`, `ClaimButton.ts`,
  `PlayerInfoBar.ts`, `DrawnBallsPanel.ts` fra Game 2
- `logic/ClaimDetector.ts` fra Game 2

### Backend-integrasjon

Backend slug: `"monsterbingo"` (også `"mønsterbingo"` / `"game_3"` aliaser).
Backend-engine: `apps/backend/src/game/Game3Engine.ts` (subklasse av BingoEngine).

Variant-config (`DEFAULT_GAME3_CONFIG`):
- 3×3-tickets, 9 unike tall fra 1..21
- maxBallValue=21, drawBagSize=21
- patternEvalMode="auto-claim-on-draw"
- ÉN ticket-type ("Standard")
- Ingen patterns[] (auto-claim KUN på full bong)
- Ingen jackpotNumberTable (skiller G3 fra G2)

### Forskjeller fra Spill 2

| Aspekt | Spill 2 (Rocket) | Spill 3 (Mønsterbingo) |
|--------|------------------|------------------------|
| Slug | `rocket` | `monsterbingo` |
| Jackpot-bar | Ja (per-draw 9/10/11/12/13/14-21) | Nei |
| Jackpot-tabell | jackpotNumberTable krevd | Ikke satt |
| Visuelle stil | Rocket-tema | Spill 1-stil (ball queue, chat, banner) |
| Min draws før vinner-sjekk | 9 (jackpot starter ved 9) | Ingen — Coverall sjekkes hver draw |

### Forskjeller fra Spill 1

| Aspekt | Spill 1 (Classic) | Spill 3 (Mønsterbingo) |
|--------|-------------------|------------------------|
| Grid | 5×5 (fri sentercelle) | 3×3 |
| Ball-range | 1..75 | 1..21 |
| Ticket-typer | 8 farger (Small/Large × Yellow/White/Purple, etc.) | 1 ("Standard") |
| Patterns | 5 faser (1 Rad, 2 Rader, 3 Rader, 4 Rader, Fullt Hus) | 1 (Coverall) |
| Master/start/stop | Ja (group-of-halls) | Nei (ETT globalt rom) |
| Mini-games | Wheel/Chest/Mystery/ColorDraft | Nei |

### Testing

```
http://localhost:4000/web/?webClient=game_3
```
