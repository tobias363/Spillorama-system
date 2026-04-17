# Game 5 — Spillorama Bingo (Web-implementasjon)

**Status:** Funksjonell MVP — 3x5 grids + ruletthjul + LINE/BINGO
**Dato:** 2026-04-17 (opprinnelig: 2026-04-14)

> **Autoritativ spesifikasjon:** [`docs/engineering/game5-canonical-spec.md`](../../../../../docs/engineering/game5-canonical-spec.md) (BIN-531).
> Ved motsigelser vinner canonical spec. Se spec §11 for 8 G5-unike avvik (rulett-fysikk, Free Spin Jackpot, SwapTicket, KYC-gate, billettfarger, auto-select m.fl.) + G1-paritets-avvik.

## Hva er implementert

Fullstendig gameplay-loop med 3x5 grid, LINE/BINGO claims, og animert ruletthjul (Game 5-signatur).

### Ruletthjul (port av Unity Game5RouletteWheelController)

- 8 fargerike segmenter med tall
- Spinnanimasjon: 5 fulle rotasjoner + mållanding (GSAP `power3.out` = Unity `easeOutCubic`)
- Gul pil-peker øverst (statisk — roterer ikke)
- Etter landing: tall zoomes til senteret (matcher Unity `HighlightBall` zoom 7x → 1x)
- Rent visuelt — trukket tall bestemmes server-side via `draw:new`

### Filer

```
packages/game-client/src/games/game5/
├── Game5Controller.ts              # State machine med gameSlug "spillorama"
├── README.md                       # ← denne filen
├── screens/
│   └── PlayScreen.ts               # 3x5 grids + roulette (høyreside)
└── components/
    └── RouletteWheel.ts            # Animert ruletthjul med GSAP spin
```

### Gjenbruk

- `screens/LobbyScreen.ts` og `screens/EndScreen.ts` fra Game 2
- `components/TicketCard.ts`, `TicketScroller.ts`, `ClaimButton.ts`, `PlayerInfoBar.ts` fra Game 2
- `logic/ClaimDetector.ts`, `logic/TicketSorter.ts` fra Game 2

### Backend-integrasjon

Identisk med Game 2. Backend slug: `"spillorama"`.

### Kjente begrensninger (MVP)

- **Free Spin Jackpot utsatt** — Lykkehjul-variant, krever backend endpoints
- **Billettkustomisering utsatt** — 4 farger (blå, grønn, rød, lilla) med swap
- **Kulefysikk utsatt** — Unity bruker Rigidbody2D + Collider2D for kule på hjulet. Nåværende versjon bruker ren GSAP-rotasjon uten fysikksimulering.
- **DrumRotation utsatt** — Kontinuerlig hjulrotasjon med kollisjonsdeteksjon

### Hva er unikt for Game 5 vs Game 2

| Aspekt | Game 2 (Rocket) | Game 5 (Spillorama) |
|--------|-----------------|---------------------|
| Ruletthjul | Ingen | AnimatedRouletteWheel (høyreside) |
| Layout | Tickets fullbredde | Tickets venstre, roulette høyre |
| Nummerpresentasjon | Kun DrawnBallsPanel | DrawnBallsPanel + rouletteanimasjon |

### Testing

```
http://localhost:4000/web/?webClient=game_5
```
Eller test alle: `?webClient=all`
