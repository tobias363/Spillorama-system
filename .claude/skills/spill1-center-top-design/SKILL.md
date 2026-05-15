---
name: spill1-center-top-design
description: When the user/agent works with the Spill 1 `center-top` HTML overlay — the combo panel (mini-grid + premietabell) and action-panel (game name + jackpot + Forhåndskjøp/Kjøp flere/Start spill) rendered above the Pixi canvas. Also use when they mention CenterTopPanel.ts, ensurePatternWonStyles, premie-row, premie-cell, mini-grid, prize-pill, premie-design.html, PatternMiniGrid, jackpot-display, setBuyMoreDisabled, setPreBuyDisabled, setGameRunning, setCanStartNow, swapMiniGrid, animateWinFlash, flashAmount, customPatternListView, autoClaimPhaseMode, top-group-wrapper, LeftInfoPanel, action-panel, combo-panel, eller mockup-iterasjon I-V. Make sure to use this skill whenever someone touches `packages/game-client/src/games/game1/components/CenterTopPanel.ts` or related premie/mini-grid mockup-er — even if the change looks like "just CSS" — because the panel sits over Pixi-canvas (no-backdrop-filter rule), gjenbrukes av Spill 3 (customPatternListView injection), og endringer i layout påvirker kollisjon mellom combo-panel og action-panel.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: packages/game-client/src/games/game1/components/CenterTopPanel.ts, packages/game-client/src/games/game1/components/CenterTopPanel.test.ts, packages/game-client/src/games/game1/__tests__/no-backdrop-filter-regression.test.ts, packages/game-client/src/games/game1/components/PatternMiniGrid.ts, packages/game-client/src/games/game1/components/PatternListView.ts, packages/game-client/src/games/game1/components/LeftInfoPanel.ts, packages/game-client/src/games/game1/screens/PlayScreen.ts (top-group-wrapper), packages/game-client/src/premie-design/premie-design.html (mockup), packages/game-client/src/games/game3/components/Game3PatternRow.ts (customPatternListView consumer) -->

# Spill 1 — Center-top design (combo-panel + action-panel)

`CenterTopPanel.ts` rendrer **høyre halvdelen av `top-group-wrapper`** i Spill 1: combo-panel (mini-grid + premietabell) og action-panel (game name + jackpot-display + Forhåndskjøp/Kjøp-flere/Start-spill-knappene). Panelet sitter som HTML-overlay over Pixi-canvas via `HtmlOverlayManager` og deler `top-group-wrapper` med `LeftInfoPanel` (eid av `PlayScreen.ts`).

## Kontekst — hvorfor er dette kritisk?

**Lese-først:**
- `packages/game-client/src/premie-design/premie-design.html` — IMMUTABLE mockup (iterasjon V, 2026-05-14). Live-iterert av Tobias.
- `packages/game-client/src/games/game1/components/CenterTopPanel.ts` — prod-komponent (~980 linjer)
- `packages/game-client/src/games/game1/__tests__/no-backdrop-filter-regression.test.ts` — Pixi-blink-guard
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §2.2 — bongpris-/multiplikator-spec

**Tobias-iterasjon I-V (2026-05-14):** Hele mockup-historikken er konsolidert i `premie-design.html`. Iterasjon V er nåværende kanonisk state. Endringer i prod CSS/layout MÅ verifiseres mot mockup.

## De fire sub-elementene

```
top-group-wrapper (eies av PlayScreen.ts — IKKE CenterTopPanel)
├── LeftInfoPanel        (player-info: 👤 12 / Innsats 30 kr / Gevinst 0 kr / Forhåndskjøp 15 kr)
└── CenterTopPanel root  (display: flex, flex-direction: row, align-self: flex-start)
    ├── combo (496 px bredt, padding 15px 22px, flexShrink:0)
    │   └── combo-body (display: flex, gap: 18px, alignItems: stretch)
    │       ├── gridHostEl (PatternMiniGrid 5×5, ~133 px, alignSelf: center)
    │       └── prizeListEl (.premie-table — 5×3 grid Rad 1-4 + Fullt Hus × Hvit/Gul/Lilla)
    └── actions (245 px bredt, padding 14px 22px 8px 22px, marginLeft: auto, flexShrink: 0)
        ├── gameNameEl     ("HOVEDSPILL 1")
        ├── jackpotEl      ("45 JACKPOT: 5000 KR" — hidden hvis !isDisplay)
        ├── preBuyBtn      ("Forhåndskjøp til dagens spill" / "Venter på master — kjøp åpner snart")
        ├── buyMoreBtn     ("Kjøp flere brett")
        └── startGameBtn   ("Start spill" — display: none til canStartNow)
```

**Player-info, mini-grid og knappe-blokken speiles i mockup-en for kontekst, men IKKE alle eies av CenterTopPanel.** Player-info eies av `LeftInfoPanel`, og `top-group-wrapper` eies av `PlayScreen`. CenterTopPanel eier kun combo + actions.

## Pixel-spec (mockup iterasjon V, 2026-05-14)

### Combo-panel
| Property | Verdi | Mockup-linje |
|---|---|---|
| Width | `496px` | premie-design.html:181 |
| Padding | `15px 22px` | premie-design.html:182 |
| `flexShrink` | `0` | premie-design.html:186 |
| `borderLeft` | `1px solid rgba(255, 120, 50, 0.2)` | premie-design.html:184 |
| `boxShadow` | `inset 10px 0 20px rgba(0, 0, 0, 0.15)` | premie-design.html:184 |

**Tobias-direktiv:** 376 px (gammel) var for trang og premie-tabellens Lilla-kolonne klemte action-panel + overlappet. 496 px gir plass til alle 3 prize-celler + label uten compression.

### Combo-body
| Property | Verdi | Mockup-linje |
|---|---|---|
| `display` | `flex` | premie-design.html:188 |
| `gap` | `18px` | premie-design.html:189 |
| `justifyContent` | `space-between` | premie-design.html:190 |
| `alignItems` | `stretch` | premie-design.html:191 |

### Mini-grid (gridHostEl)
- Rendres av `PatternMiniGrid.ts` med `display: grid; grid-template-columns: repeat(5, 25px); gap: 2px;`
- Faktisk bredde: `5 × 25 + 4 × 2 = 133 px` (mockup oppga 135 px som approx)
- `alignSelf: center` på `gridHostEl` overstyrer combo-body sin `stretch` per-item — sentrerer vertikalt under premie-tabellen siden mini-grid er kortere

### Premie-tabell (.premie-table + .premie-row + .premie-cell)
| Property | Verdi | Notat |
|---|---|---|
| `.premie-table` `display` | `flex; flex-direction: column` | Stables vertikalt |
| `.premie-table` `gap` | `3px` | Iterasjon V: redusert fra 5px → 3px |
| `.premie-row` `padding` | `3px 8px` | Iterasjon V: redusert fra 6px 10px → 3px 8px (smalere) |
| `.premie-row` `grid-template-columns` | `minmax(56px, 1fr) repeat(3, 1fr)` | Label + 3 bongfarger |
| `.premie-row` `gap` | `6px` | Mellom label og celler |
| `.premie-row` `background` | `rgba(30, 12, 12, 0.92)` | INGEN backdrop-filter (Pixi-blink-guard) |
| `.premie-row` `border` | `1px solid rgba(255, 100, 100, 0.2)` | Default |
| `.premie-row` `border-radius` | `10px` | — |
| `.premie-row.active` `border` | `1.5px solid #ffcc00` | Gul highlight på aktiv fase |
| `.premie-row.completed` | `text-decoration: line-through; opacity: 0.5` | Vunnet pattern |
| `.premie-cell` `padding` | `2px 6px` | Iterasjon V: redusert fra 4px 8px |
| `.premie-cell` `font-size` | `11px` | — |
| `.premie-cell.col-hvit` `background` | `#efefef` color `#1a0a0a` | — |
| `.premie-cell.col-gul` `background` | `#f1c40f` color `#1a0a0a` | — |
| `.premie-cell.col-lilla` `background` | `#c8b3e0` color `#2a0a3a` | — |

### Action-panel
| Property | Verdi | Mockup-linje |
|---|---|---|
| Width | `245px` | premie-design.html:370 |
| Padding | `14px 22px 8px 22px` | premie-design.html:369 |
| `marginLeft` | `auto` | premie-design.html:379 (Tobias-fix 2026-05-14) |
| `flexShrink` | `0` | premie-design.html:373 |
| `borderLeft` | `1px solid rgba(255, 120, 50, 0.2)` | premie-design.html:371 |

**Tobias-fix:** `marginLeft: auto` pusher action-panel til høyre kant av `top-group-wrapper` slik at det er visuelt adskilt fra combo-panel uten å overlappe. Spesielt viktig ved smale viewports der `width: fit-content` på `top-group-wrapper` kan trigge overflow.

### Action-knapper
- Background: `rgba(30, 12, 12, 0.92)` (INGEN backdrop-filter)
- Border: `1px solid rgba(255, 100, 100, 0.2)`
- Padding: `9px 12px`
- Font-size 11px, font-weight 700
- Hover via JS-event listeners — IKKE CSS-transitions (BIN-blink-permanent-fix 2026-04-24)

## Spill 3-gjenbruk (customPatternListView)

`CenterTopOptions.patternListViewFactory` injiserer alternativ pattern-listevisning. Brukes av Spill 3 for å vise 4 mini-grids horisontalt istedet for tekst-pills + active mini-grid.

```typescript
// Game3Controller.ts:669 (consumer)
const factory: PatternListViewFactory = () => new Game3PatternRow();
const panel = new CenterTopPanel(overlay, callbacks, { patternListViewFactory: factory });
```

**Kontrakt for CenterTopPanel:**
- Når `customPatternListView != null`: `comboBody` får KUN den injiserte visningen
- `gridHostEl` + `prizeListEl` allokeres som detached DOM-noder slik at `swapMiniGrid` / diff-logikk kan skrive uten try-catch
- `updatePatterns` delegerer 100% til `customPatternListView.update(...)` i Spill 3-mode

**Endringer i layout for combo (width, padding, gap, comboBody-gap) påvirker IKKE Spill 3** — Spill 3 rendrer egen DOM inne i `comboBody` og bryr seg ikke om gridHostEl/prizeListEl layout.

## Runtime-API (uendret over iterasjon V)

Disse public-metodene MÅ forbli funksjonelle — de er konsumert av `PlayScreen.ts`:

| Method | Signatur | Brukt av |
|---|---|---|
| `updatePatterns(patterns, results, prizePool, gameRunning)` | bygger diff-oppdatert grid | PlayScreen.update |
| `updateJackpot(jackpot)` | viser/skjuler jackpot-display | PlayScreen.applyState |
| `setBuyMoreDisabled(disabled, reason)` | disable "Kjøp flere brett" | PlayScreen.applyState |
| `setPreBuyDisabled(disabled, reason)` | wait-on-master-defensiv gate (Agent B 2026-05-12) | PlayScreen.applyState |
| `setGameRunning(running)` | bytt buyMore/preBuy synlig | PlayScreen.applyState |
| `setCanStartNow(canStart, gameRunning)` | toggle Start-knapp | PlayScreen.applyState |
| `setBadge(text)` | game-name header | PlayScreen.setBadge |
| `showButtonFeedback(button, success)` | 2-sek "Registrert!"-feedback | PlayScreen efter buy-result |
| `destroy()` | rydd GSAP-tweens + DOM | PlayScreen.destroy |

**Endringer som bryter disse API-ene krever koordinert PlayScreen-update.** Mockup-endringer som KUN justerer CSS bryter ikke API.

## Hva man IKKE skal endre

### Ingen backdrop-filter (Pixi-blink-guard)
`.prize-pill`, `.premie-row`, `.premie-cell`, action-buttons, `#chat-panel` og toast-elementer MÅ ALDRI ha `backdrop-filter`. Pixi-canvas re-kjører blur-shader per frame (60-120 fps) hvis HTML-overlay over canvas har backdrop-filter — verifiseres av `no-backdrop-filter-regression.test.ts`.

### Ingen CSS-transitions på state-bytte
`.premie-row.active`, `.completed`, `.pattern-won-flash` styres via class-toggle. CSS-transitions på `background`/`box-shadow`/`border` ville trigget `transitionstart`-events per state-bytte og forårsake samme blink. State-endringer er instant; kun GSAP-tweens på spesifikke `<span>`-etterkommere brukes for animation.

### .prize-pill-klassen er marker, ikke visuell styling
`.prize-pill` beholdes som dummy-class på `.premie-row` slik at `no-backdrop-filter-regression.test.ts` fortsatt finner elementer å sjekke. Visuell styling kommer fra `.premie-row` + `.premie-cell`. ALDRI legg `backdrop-filter` på `.prize-pill`-regelen.

### Pattern-rebuild-logikk
`updatePatterns` har minimal-diff-mønster:
1. `rebuildPills` kjører KUN ved struktur-endring (signature = pattern-ids + designs)
2. `applyPillState` skriver til DOM KUN hvis cache (`pillCache`) viser endring
3. `prevWonIds`-set sikrer at win-flash trigges KUN én gang ved fase-overgang
4. `lastAmountByPatternId` cacher base-pris for flash-amount-deteksjon

Endringer som ville mutere `style` per-update (i stedet for `class`) reverserer 2026-04-24-blink-fix og forårsaker store frame-drops.

### Auto-multiplikator-regel (Hvit ×1, Gul ×2, Lilla ×3)
Premier i `applyPillState` skrives som `prize × color.multiplier`. Server-side bruker samme regel — displayed amount = paid-out amount (untatt single-prize-cap som KUN gjelder databingo). Se `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §3.

### Pre-game placeholder
Hvis `patterns.length === 0`, brukes `placeholderPatterns()` (5 dummy patterns med design=1..5, prize1=0). Sikrer at panelet aldri er tomt mens spillere venter på master-start. Skal ikke fjernes.

## Hvordan endre design

Når Tobias godkjenner ny mockup-iterasjon:

1. **Oppdater premie-design.html FØRST** — mockup er kanonisk
2. **Verifiser regler:**
   - INGEN backdrop-filter
   - Tekst matcher `displayNameFor` ("Rad 1", "Full Hus")
   - Auto-multiplikator-regel for premier i mockup-renderer
3. **Anvend pixel-spec til CenterTopPanel.ts:**
   - CSS i `ensurePatternWonStyles()` for `.premie-table` / `.premie-row` / `.premie-cell`
   - Inline-style for `combo`, `comboBody`, `actions`, button-styles
4. **Verifiser:**
   - `npm --prefix packages/game-client run check` (TS strict)
   - `npm --prefix packages/game-client test -- --run CenterTopPanel` (40 tester)
   - `npm --prefix packages/game-client test -- --run no-backdrop-filter-regression` (6 tester)
   - `npm --prefix packages/game-client test -- --run game3` (27 tester — verifiser Spill 3-kontrakt holder)

## Fallgruver (anti-patterns)

| ❌ Aldri | ✅ Gjør i stedet |
|---|---|
| Sett `backdrop-filter: blur(...)` på premie-row / action-button | Bruk solid `rgba(30, 12, 12, 0.92)`-bakgrunn |
| Legg til CSS-transitions på `background`/`box-shadow` for state-bytte | Class-toggle for instant state; GSAP for animasjon |
| Mutér `style` per-update på `.premie-row` | Bruk class-toggle (`.active`, `.completed`, `.pattern-won-flash`) |
| Fjern `.prize-pill`-klassen fra rad | Behold som marker for regression-test |
| Anta Spill 3 også får ny layout | Spill 3 bruker `customPatternListView` og bryr seg ikke om combo-layout |
| Endre offentlige metoder uten å oppdatere PlayScreen | API-er (`setBuyMoreDisabled`, `updatePatterns`, etc.) er kontrakt |
| Glem `.prize-pill premie-row` på `pill.className` i `rebuildPills` | `.prize-pill`-marker MÅ være med (regression-test) |
| Slå sammen mini-grid + premie-tabell uten `alignSelf: center` på mini | Mini er kortere; sentrer vertikalt for å unngå tomrom |

## Relaterte ADR-er

- ADR-0007 — Klient-debug-suite (samme overlay-arkitektur)
- ADR-0011 — Casino-grade observability (no-backdrop-filter er del av dette)
- (Ingen ADR for selve panelet — design-iterasjon er Tobias-direktiv 2026-05-14)

## Endringslogg

| Dato | Endring | Author |
|---|---|---|
| 2026-05-15 | Initial — etablert ved prod-implementasjon av premie-design.html iterasjon V (combo width 376→496, padding 26→22, gap 20→18, action padding 25→22, marginLeft:auto). Tobias-direktiv 2026-05-14. | Agent (center-top-design-prod-implementation) |
