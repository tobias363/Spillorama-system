# Game 1 — Arkitektur-regler og kritiske invariants

Supplement til [`README.md`](./README.md). Denne filen dokumenterer **kritiske
regler** som må følges for å unngå kjente regresjoner. Ved motsigelser mellom
denne filen og canonical spec
(`docs/engineering/game1-canonical-spec.md`), vinner canonical spec.

## Generelt render-mønster

Game 1 er et **hybrid PixiJS + HTML-overlay**-spill:

- **Pixi-canvas** (base): BallTube, CenterBall, background, animasjoner.
- **HTML-overlay** (`HtmlOverlayManager`, `z-index: 10`): chat-panel,
  center-top-panel, header-bar, toaster, popups. Alle HTML-elementer ligger
  over Pixi-canvas og tar ikke pekerhendelser (kun `pointerEvents: auto` der
  det trengs).

Pixi rendrer **kontinuerlig 60-120+ fps** (ikke on-demand). Dette gjør det
spesielt viktig å holde alle HTML-overlays GPU-billige — hvert HTML-element
over canvas koster noe per frame.

## KRITISK: Ingen `backdrop-filter` over Pixi-canvas

**Regel:** INGEN `.prize-pill`, `#chat-panel`, `#center-top`-knapp, toaster,
eller andre persistente HTML-overlays skal bruke CSS `backdrop-filter`.

**Hvorfor:** Pixi-canvas rendrer kontinuerlig. Hvert HTML-element over
canvas med `backdrop-filter: blur(X)` tvinger GPU til å re-kjøre
blur-shader for sin region **per Pixi-frame** (60-120+ ganger per
sekund). Dette forårsaker:

1. **Synlig visuell flimring** — skygger/kanter på elementene skjelver
   fordi blur-shader ikke er perfekt stabil mellom frames.
2. **GPU-kost** som vokser med region-areal × aktive elementer.

**Unntak (allow-list):** Kort-levde popup-backdrops. Disse er OK fordi:

- De er bare synlige mens brukeren har åpen popup (typisk sekunder, ikke
  hele spillet).
- Pixi-canvas er uansett maskert bak popup mens den er åpen.
- Blur-effekten er intensjonell fokus-separasjon.

Godkjent allow-list (2026-04-24):

| Fil | Element | Bruk |
|-----|---------|------|
| `components/Game1BuyPopup.ts` | `backdrop` | Kjøp-popup fullskjerm overlay |
| `components/WinPopup.ts` | `backdrop` | Gevinst-popup fullskjerm overlay |
| `components/LuckyNumberPicker.ts` | `backdrop` | Lykkenummer-popup overlay |
| `components/CalledNumbersOverlay.ts` | `backdrop` | "Oppleste tall" overlay |

**Regresjonstest:**
[`__tests__/no-backdrop-filter-regression.test.ts`](./__tests__/no-backdrop-filter-regression.test.ts)
feiler hvis noen UI-overlay får backdrop-filter.

### Erstatning-mønster

Hvis du tidligere ville brukt `backdropFilter: "blur(Xpx)"` på et
persistent UI-element, bruk i stedet en **solid semi-transparent
bakgrunn**:

```ts
// IKKE:
backdropFilter: "blur(6px)",
background: "rgba(120, 20, 20, 0.4)",

// GJØR:
background: "rgba(30, 12, 12, 0.92)",
```

Velg alpha ≥ 0.85 for at blur-effekten skal være minimalt savnet. Tilpass
farge-palett mot eksisterende design tokens (typisk dypere varianter av
`#781414` i Game 1-temaet).

### Historikk

- **2026-04-24** (denne commit-en): Regel etablert etter blink-profilering
  i Chrome DevTools identifiserte 12 HTML-elementer med backdrop-filter over
  Pixi-canvas. Fjernet backdrop-filter fra `.prize-pill` (5×), `#chat-panel`
  (1×), `#center-top` button (3×), toaster (inntil 3×). Beholdt på 4
  popup-backdrops.
- **Regresjonskilde:** 5× `.prize-pill` backdrop-filter ble introdusert i
  blink-fiks runde 1 (commit 23caea5b i branch `fix/spill1-visual-polish`)
  — tidligere blink-runder målte DOM-mutasjoner, ikke GPU-shader-cost.

## Andre invariants (kort-form)

Disse er dokumentert nærmere i `README.md`:

- **Ingen diagonaler i noen fase** — kun horisontale rader (fase 1) eller
  vertikale kolonner (fase 2-5).
- **Gratis-felt** (`grid[2][2] === 0`) teller alltid som merket.
- **Multi-winner-split**: `prizePerWinner = floor(totalPhasePrize / winnerCount)`.
- **Server-autoritativt** `evaluateActivePhase` — klient auto-markerer på
  `draw:new` men validerer aldri selv.
