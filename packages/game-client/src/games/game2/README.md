# Game 2 — Spill 2 / Tallspill (Web-implementasjon)

**Status:** Funksjonell MVP + Bong Mockup-design
**Dato:** 2026-05-03 (Bong Mockup-redesign), 2026-04-17, 2026-04-14

> **Autoritativ spesifikasjon:** [`docs/engineering/game2-canonical-spec.md`](../../../../../docs/engineering/game2-canonical-spec.md) (BIN-529).
> Ved motsigelser vinner canonical spec. Denne README-filen er en teknisk oversikt over koden her; se spec §11 for kjente avvik fra legacy og fra G1-paritet.

## Hva er implementert

### Fullstendig gameplay-loop
1. **Lobby** → spilleren joiner rom via socket, ser spillerantall og nedtelling
2. **Arm/kjøp** → auto-arm ved join + re-arm etter hver runde
3. **Nedtelling** → GSAP-animert countdown med pulsering
4. **Gameplay** → 3x5 billettkort rendret i PixiJS, numre markeres i sanntid
5. **Claim** → LINE/BINGO deteksjon (klient-side sjekk → server-validering)
6. **Game end** → resultatskjerm med vinnere og premier
7. **Loop** → automatisk overgang tilbake til lobby for neste runde

### Filer

```
packages/game-client/src/games/
├── registry.ts                         # gameSlug → factory mapping
└── game2/
    ├── Game2Controller.ts              # State machine (LOADING→LOBBY→PLAYING→ENDED)
    ├── README.md                       # ← denne filen
    ├── screens/
    │   ├── LobbyScreen.ts             # Vente/kjøp-skjerm med countdown + buy popup
    │   ├── PlayScreen.ts              # Bong Mockup-design (2026-05-03): ComboPanel + BallTube + 2×2 BongCard
    │   ├── ChooseTicketsScreen.ts     # 32-bretts pool-velger (PR #851 + #855)
    │   └── EndScreen.ts               # Resultat-overlay etter game end
    ├── components/
    │   ├── BongCard.ts                # 2026-05-03: beige bong-kort med 3×3 grid (erstatter TicketCard for Spill 2)
    │   ├── BallTube.ts                # 2026-05-03: glass-rør med countdown + drawn-balls-rad
    │   ├── ComboPanel.ts              # 2026-05-03: panel-rad med Lykketall + Hovedspill + Jackpots
    │   ├── LykketallGrid.ts           # 2026-05-03: 5×5 lucky-number-grid (1-21) med kløver-ikon
    │   ├── JackpotsRow.ts             # 2026-05-03: 6 jackpot-sirkler (erstatter forrige JackpotBar)
    │   ├── DesignBall.ts              # 2026-05-03: Pixi-kule for Bong Mockup-design (radial gradients)
    │   ├── TicketCard.ts              # BingoGrid (3x3/3x5) + "to-go" teller — fortsatt brukt av game3/game5
    │   ├── TicketScroller.ts          # Horisontal scroll med mask + drag — brukt av LobbyScreen + game3/5
    │   ├── CountdownTimer.ts          # GSAP scale/color pulse nedtelling — brukt av LobbyScreen
    │   ├── DrawnBallsPanel.ts         # Rad med NumberBall-instanser — brukt av game3/5
    │   ├── ClaimButton.ts             # LINE/BINGO knapp med pulsering
    │   ├── PlayerInfoBar.ts           # Spillerantall + trekk + pott — brukt av LobbyScreen + game3/5
    │   ├── BuyPopup.ts                # Billettantall-velger mellom runder
    │   └── LuckyNumberPicker.ts       # Modal tallvelger 1-21 — brukt av LobbyScreen
    └── logic/
        ├── ClaimDetector.ts           # Port av backend ticket.ts mønstersjekk
        └── TicketSorter.ts            # Best-card-first sortering
```

### Bong Mockup-design (2026-05-03)

Spill 2's PlayScreen er omformet etter `/tmp/spill2-design-extracted/spillorama/project/Bong Mockup.html`. Layout-oppsummering:

```
┌──────────────────────────────────────────────────────────────┐
│  ComboPanel (mørk-rød panel-rad)                              │
│  ┌────────────┬──────────────┬──────────────────────────────┐ │
│  │ Lykketall  │ Hovedspill 1 │ Jackpots                     │ │
│  │ 5×5 grid   │ Kjøp flere   │ ⬤ ⬤ ⬤ ⬤ ⬤ ⬤                  │ │
│  │ + clover   │   brett      │ 9 10 11 12 13 14-21         │ │
│  └────────────┴──────────────┴──────────────────────────────┘ │
│                                                                │
│  BallTube (glass-rør)                                          │
│  ┌──────────┬──────────────────────────────────────────────┐ │
│  │ Neste:   │  ●  ●  ●  ●  ●  ●  ●  ●  ●                   │ │
│  │ MM:SS    │  (siste 9 trukne baller, nyeste til venstre) │ │
│  ├──────────┤                                              │ │
│  │ Trekk    │                                              │ │
│  │ 04/21    │                                              │ │
│  └──────────┴──────────────────────────────────────────────┘ │
│                                                                │
│  Bong-grid (4 BongCard, 2×2, scale 0.70)                       │
│   ┌─────┐ ┌─────┐                                              │
│   │bong │ │bong │  ← beige med 3×3 numre                       │
│   └─────┘ └─────┘                                              │
│   ┌─────┐ ┌─────┐                                              │
│   │bong │ │bong │                                              │
│   └─────┘ └─────┘                                              │
└──────────────────────────────────────────────────────────────┘
```

**Bakgrunn:** `bong-bg.png` lastes som full-screen Sprite. Fallback-fyll `#2a0d0e` rendres bak inntil PNG er klar.

**Glass-effekt:** Pixi har ingen native `backdrop-filter: blur`. BallTube + ComboPanel kompenserer ved å bruke høyere alpha på de mørke fyll-lagene + multiple konsentriske highlights, slik at bakgrunns-bilde ikke "lekker" gjennom.

**3×3 vs FREE:** HTML-mockupen viste FREE-cellen i sentrum, men backend (`Game2TicketPoolService`) genererer 3×3-grids med 9 unike tall (ingen FREE). Vi rendrer alle 9 cellene som tall — dette matcher backend-realiteten og gir spilleren én ekstra mark-mulighet. `BongCard.loadTicket` har fallback-logikk som rendrer FREE hvis backend en dag legger til 0 i sentrum.

**Lucky number:** Tidligere ble lykketall valgt via en modal `LuckyNumberPicker` fra LobbyScreen. I det nye designet er 5×5-grid alltid synlig under spill (i ComboPanel), så spilleren kan velge eller endre lykketall i sanntid. Modal-pickeren beholdes på LobbyScreen for backward-compat (vises mellom runder).

**Assets:**
- `packages/game-client/public/assets/game2/design/bong-bg.png` (~1.7 MB)
- `packages/game-client/public/assets/game2/design/lucky-clover.png` (~565 KB)

Begge preloades via `preloadGameAssets("rocket")` for å unngå pop-in.

### Backend-integrasjon

Bruker eksisterende backend-kontrakter uten endringer:

| Socket event | Retning | Brukt til |
|---|---|---|
| `room:create` | client→server | Joine/opprette rom |
| `bet:arm` | client→server | Kjøpe billetter (arme) |
| `lucky:set` | client→server | Sette heldig tall |
| `claim:submit` | client→server | Melde LINE/BINGO |
| `room:update` | server→client | Full spillstatus (scheduler, tickets, etc.) |
| `draw:new` | server→client | Nytt trukket tall |
| `pattern:won` | server→client | Mønster vunnet |

### Billett-format

Backend genererer 3x5 grids (3 rader × 5 kolonner, tall 1-60). Mønstersjekk:
- **LINE**: Hel rad (5 celler) eller kolonne (3 celler)
- **BINGO**: Alle 15 celler markert

### Kjente begrensninger (MVP)

- **Visuell polish mangler** — placeholder-grafikk, ingen sprites/design
- **Ingen chat-panel** — planlagt for senere iterasjon
- **Ingen jackpot-animasjoner** — data finnes, visning mangler
- **Ingen lydeffekter** — AudioManager er implementert men lydfiler mangler
- **Responsive layout** — fungerer men ikke optimalisert for mobil

### Testing

Åpne `http://localhost:4000/web/?webClient=game_2`, klikk Spill 2. Feature flag i URL router til web-klient.

Alternativt: sett `clientEngine: "web"` i game settings via admin for permanent aktivering.

### Teknisk stack

- **PixiJS 8** — rendering
- **GSAP 3** — animasjoner (countdown pulse, blink, claim button)
- **socket.io-client 4** — sanntidskommunikasjon
- **TypeScript** — type-sikker hele veien

### Gjenbrukbare komponenter

Følgende Fase 0-komponenter brukes direkte:
- `BingoGrid` (3x5 grid med mark/blink/highlight)
- `BingoCell` (enkeltcelle med animasjon)
- `NumberBall` (trukket kule med farge)
- `SpilloramaSocket` (typed socket wrapper)
- `GameBridge` (snapshot→state oversetter)
- `TweenPresets` (GSAP presets)
- `AudioManager`, `PlayerPrefs`, `Telemetry`
