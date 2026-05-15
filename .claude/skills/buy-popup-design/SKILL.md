---
name: buy-popup-design
description: When the user/agent works with the Game1BuyPopup ticket-purchase modal — premietabell, ticket-rows (Liten/Stor × 3 farger), stepper, "Du kjøper"-summary chips, or the kjopsmodal-design.html mockup. Also use when they mention Game1BuyPopup, BuyPopup, kjopsmodal-design, PrizeMatrix, premietabell, auto-multiplikator (5/10/15 kr), BONG_PALETTE, MiniBongChip, BongMini, setBuyPopupTicketConfig, setBuyPopupDisplayName, setBuyPopupLossState, lobbyTicketConfig, Tobias-bekreftet 2026-05-15 buy-popup, Spill 1 ticket-purchase. Make sure to use this skill whenever someone touches `packages/game-client/src/games/game1/components/Game1BuyPopup.ts` — even if they don't mention buy-popup-design directly — because changes to the BuyPopup must match the kjopsmodal-design.html mockup 1:1.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: packages/game-client/src/games/game1/components/Game1BuyPopup.ts, packages/game-client/src/games/game1/components/Game1BuyPopup.test.ts, packages/game-client/src/games/game1/components/Game1BuyPopup.lossState.test.ts, packages/game-client/src/games/game1/components/Game1BuyPopup.displayName.test.ts, packages/game-client/src/games/game1/components/Game1BuyPopup.ticketCount.test.ts, packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html -->

# BuyPopup-design — Game1BuyPopup (Spill 1 + Spill 2/3 ticket-purchase)

`packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html` er Tobias-bekreftet 2026-05-15 IMMUTABLE mockup for ticket-kjøp-modalen. Hvis kode motsier mockup: **mockup-en vinner**, koden må fikses (per `CLAUDE.md` §2.4).

## Lese-først

1. **`packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html`** — Tobias-design (bundlet mockup; JSX inni manifest)
2. **`packages/game-client/src/games/game1/components/Game1BuyPopup.ts`** — prod-komponent
3. **`docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §3** — auto-multiplikator-formel

## Hvilke spill bruker BuyPopup?

| Spill | Hvor | Notat |
|---|---|---|
| Spill 1 (`bingo`) | `Game1Controller` → `PlayScreen.showBuyPopup` | Primær case — 3 farger (hvit/gul/lilla) eller Trafikklys (1 farge) |
| Spill 2 (`rocket`) | `Game2-PlayScreen` (HTML-overlay via `Game1BuyPopup`-instans) | Bruker samme komponent, 1 farge "Standard" |
| Spill 3 (`monsterbingo`) | Gjenbruker Spill 1 frontend (via `Game3Controller`) | 1 farge "Standard" |

Alle 3 spill går gjennom **samme** `Game1BuyPopup.ts`. Komponenten må derfor være robust for både 1-farge (Spill 2/3) og 3-farge (Spill 1) configs.

## Komponent-struktur (Tobias-bekreftet 2026-05-15)

### 4 sub-elementer i mockup

1. **Header** — "Neste spill" + subtitle (catalog-display-navn i gull, letter-spacing 0.14em)
2. **Premietabell** — 5 phases (1 Rad, 2 Rader, 3 Rader, 4 Rader, Fullt Hus) × N farger
3. **Ticket-grid** — 2-col grid med Liten/Stor × {Hvit, Gul, Lilla} (eller subset)
4. **Total + Knapper** — "Totalt: X brett / Y kr" + grønn primær Kjøp + sekundær Avbryt

### card.children-indices (test-kompatibilitet)

Tests assumer denne rekkefølgen — `Game1BuyPopup.test.ts`, `Game1BuyPopup.lossState.test.ts`:

```
card.children[0] = header (title + subtitle + summaryEl + lossStateEl)
card.children[1] = typesContainer (2-col grid med ticket-rader)
card.children[2] = prizeMatrixEl (NY i 2026-05-15-iterasjon)
card.children[3] = statusMsg
card.children[4] = sep (wrapper-div som inneholder totalRow)
card.children[5] = buyBtn
card.children[6] = cancelBtn
```

> **Vær obs:** Eksisterende tester bruker `getCard(container).children[3]` for `statusMsg`, `[5]` for `buyBtn`, `[6]` for `cancelBtn`. Hvis du legger til/fjerner top-level children, ALDRI endre disse indices uten å oppdatere alle 4 test-filer samtidig.

### header.children-indices

`Game1BuyPopup.lossState.test.ts` bruker `getHeader(container).children[3]` for `lossStateEl`:

```
header.children[0] = title-div ("Neste spill")
header.children[1] = subtitle-div (letter-spacing 0.14em, holder catalog-navn)
header.children[2] = summaryEl
header.children[3] = lossStateEl
```

### Subtitle uniqueness-marker

`Game1BuyPopup.displayName.test.ts` finner subtitle via `letter-spacing: 0.14em` på et `<div>`-element. To regler:

1. **Subtitle MÅ være `<div>`**, ikke `<span>` — testen søker kun `<div>`
2. **Letter-spacing 0.14em er reservert** — andre elementer i komponenten MÅ bruke annet (eks. premietabell-header "PREMIETABELL" bruker 0.12em for å unngå falsk match)

## Pixel-spec (kjopsmodal-design.html, Tobias 2026-05-15)

### Container

| Element | Verdi |
|---|---|
| `.card` bredde | `min(580px, 92vw)` |
| `.card` bakgrunn | `radial-gradient(ellipse at top, #2a0f12 0%, #1a0809 70%, #140607 100%)` |
| `.card` border-radius | 18px |
| `.card` padding | 22px |
| `.card` box-shadow | `0 30px 80px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,200,120,0.08)` |

### Bong-palette (matcher mockup `COLORS`)

```typescript
const BONG_PALETTE = {
  white: { bg: "#e8e4dc", border: "rgba(255,255,255,0.4)", inkOnBg: "#1a0808" },
  yellow: { bg: "#f0b92e", border: "rgba(240,185,46,0.6)", inkOnBg: "#2a1a00" },
  purple: { bg: "#b8a4e8", border: "rgba(184,164,232,0.55)", inkOnBg: "#2a1040" },
};
```

### Premietabell

| Element | Verdi |
|---|---|
| Container padding | `14px 14px 12px` |
| Container bakgrunn | `rgba(245,184,65,0.07)` (gull-tint) |
| Container border | `1px solid rgba(255,255,255,0.22)` |
| Container border-radius | 12px |
| Header label | "Premietabell", Inter 700, 11px, color gold #f5c842, **letter-spacing 0.12em** (IKKE 0.14em — kollidererer med subtitle-marker), uppercase |
| Phase-rad | dark-pill, padding 5px 10px, bg rgba(0,0,0,0.38), border-radius 999px, border rgba(255,255,255,0.22) |
| Phase-label | Inter 700, 13px, color #f5e8d8, letter-spacing 0.01em |
| Premie-celle | linear-gradient(180deg, palette.bg 0%, rgba(palette.bg, 0.88) 100%), inkOnBg-tekstfarge, font-size 13px |

### Ticket-grid (typesContainer)

| Element | Verdi |
|---|---|
| Grid | `2-col, row-gap 16px, column-gap 65px` |
| Row | flex, gap 12px, padding 10px |
| Stepper | inline-flex, height 32px, border-radius 8px, rgba(255,255,255,0.04) bg når inaktiv / rgba(245,184,65,0.12) når aktiv |
| Plus/minus | width 30px, transparent bg, color rgba(245,232,216,0.75) |

### Primær Kjøp-knapp

| State | Verdi |
|---|---|
| Inaktiv | `rgba(16,185,129,0.2)` (mute-grønn), color TEXT_FAINT, cursor not-allowed |
| Aktiv | `linear-gradient(180deg, #10b981 0%, #047857 100%)` (full grønn), color #fff, box-shadow `0 4px 14px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.22)` |

Tekst-format: `"Kjøp ${X} brett · ${Y} kr"` (aktiv) eller `"Velg brett for å kjøpe"` (inaktiv).

## Premie-data-flyt

### Default phases (fall-back fra mockup)

```typescript
const DEFAULT_PHASES = [
  { id: "rad1",    label: "1 Rad",     baseCents: 10000 },   // 100 kr
  { id: "rad2",    label: "2 Rader",   baseCents: 20000 },   // 200 kr
  { id: "rad3",    label: "3 Rader",   baseCents: 20000 },   // 200 kr
  { id: "rad4",    label: "4 Rader",   baseCents: 20000 },   // 200 kr
  { id: "fullhus", label: "Fullt Hus", baseCents: 100000 },  // 1000 kr
];
```

Per-fase, per-farge premie beregnes via auto-multiplikator-formelen fra `SPILL_REGLER_OG_PAYOUT.md §3.1`:

```typescript
actualCents = baseCents * (ticketPriceCents / 500);
```

Eksempel:
- Hvit (5 kr / 500 øre): `100 kr × 500/500 = 100 kr`
- Gul (10 kr / 1000 øre): `100 kr × 1000/500 = 200 kr`
- Lilla (15 kr / 1500 øre): `100 kr × 1500/500 = 300 kr`

### Ticket-pris-resolusjon

`ticketPriceCentsForColor(key)` finner billigste matching `tt.priceMultiplier` for fargen, og beregner per-brett-pris:

```typescript
priceCents = Math.round((entryFee * cheapest.priceMultiplier * 100) / ticketCount);
```

Fall-back ved tom `currentTicketTypes`: white=500, yellow=1000, purple=1500 (matcher mockup-default).

## Runtime-API (uendret kontrakt)

Disse public methods MÅ forbli:

```typescript
showWithTypes(entryFee, ticketTypes, alreadyPurchased?, lossState?, displayName?): void
setDisplayName(displayName: string | null | undefined): void
setOnBuy(callback): void
showResult(success: boolean, message?: string): void
showPartialBuyResult(input): void
updateLossState(lossState | null): void
getTotalTicketCount(): number
isShowing(): boolean
hide(): void
destroy(): void
getUiState(): "idle" | "confirming" | "error" | "success"
```

`PlayScreen.showBuyPopup` (Game1) og `Game2-PlayScreen` konsumerer disse — ALDRI endre signatur uten å oppdatere alle call-sites samtidig.

## Hva du IKKE skal endre

1. **`card.children`-rekkefølgen** — tests assumer header=[0], typesContainer=[1], statusMsg=[3], buyBtn=[5], cancelBtn=[6]. PrizeMatrix er kilet inn på [2] uten å rokere indices.
2. **Subtitle-`<div>` med letter-spacing 0.14em** — test-marker for `getSubtitleText()`. Endre IKKE til `<span>` eller annen letter-spacing.
3. **`totalRow` skal være barnet av `sep`-elementet** — gjør sep-elementet til wrapper for å holde card.children-tellet stabilt. Andre layouts kan bryte tests.
4. **`BONG_PALETTE`-hex-verdier** — matcher mockup COLORS 1:1 (white=#e8e4dc, yellow=#f0b92e, purple=#b8a4e8)
5. **Auto-multiplikator-formelen** — `actualCents = base × (ticketPrice / 500)`. Definert i `SPILL_REGLER_OG_PAYOUT.md` — IKKE endre uten Tobias-godkjennelse.
6. **PrizeMatrix-header letter-spacing 0.12em** — bevisst forskjellig fra subtitle (0.14em) for å unngå at displayName-test feiler.

## Hvis du legger til nytt element

Hvis du må legge til en ny seksjon (eks. en "Promo-bånd"-banner):

1. **IKKE legg det som direkte child av `card`** uten å oppdatere alle 4 test-filers child-indices
2. **IKKE bruk letter-spacing 0.14em** på det nye elementet
3. **IKKE bruk `<div>` med ID/data-test som matcher subtitle's letter-spacing**

Foretrukket: pakk det inn i en eksisterende wrapper (header, sep), eller hoist det inn i `prizeMatrixEl` som ny sub-rad.

## Relaterte ADR-er

- ADR-0001 (ADR-format) — generelt
- SPILL_REGLER_OG_PAYOUT.md §3 (auto-multiplikator) — kanonisk regel-spec

## Tester

Disse 4 test-filer beskytter komponenten:

| Fil | Hva |
|---|---|
| `Game1BuyPopup.test.ts` | 30-brett-grense (D1), stepper-logikk, buy-knapp-state |
| `Game1BuyPopup.lossState.test.ts` | State-machine (idle/confirming/error/success), lossState-rendering |
| `Game1BuyPopup.displayName.test.ts` | Subtitle-display via letter-spacing 0.14em-marker |
| `Game1BuyPopup.ticketCount.test.ts` | Bug B regression — verifiserer at selections.qty IKKE multipliseres med ticketCount |

Per Tobias-direktiv 2026-05-15: **ikke skriv NYE tester** denne PR-en. Endringer som bryter eksisterende tester MÅ oppdatere testen (ikke regresjon, men bevisst designendring).

## Designsider for iterasjon

| Side | Path | Hva |
|---|---|---|
| Kjøpsmodal-mockup | `packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html` | Tobias-bekreftet 2026-05-15 design (bundlet React/JSX) |

## Iterasjon 2 (2026-05-15 ettermiddag) — pixel-perfect mot mockup

Etter PR #1502 (initial implementasjon) rapporterte Tobias at design ikke matchet mockup pixel-perfect. Følgende justeringer er gjort:

### Visuell rekkefølge (DOM vs visuell)

DOM-rekkefølgen er fortsatt test-locked (children[0]=header, [1]=typesContainer, [2]=prizeMatrixEl, [3]=statusMsg, [4]=sep, [5]=buyBtn, [6]=cancelBtn). For å matche mockup-en der premietabell ligger ØVERST (mellom header og ticket-rows), bruker vi nå CSS `order:` på flex-container.

**Card endret til `display: flex; flexDirection: column`**, og hver child har eksplisitt `order`:

| Child | DOM-index | Visuell rekkefølge (`order`) |
|---|---|---|
| header | 0 | 0 |
| prizeMatrixEl | 2 | **1** ← visuelt FØR typesContainer |
| typesContainer | 1 | 2 |
| statusMsg | 3 | 3 |
| sep (totalRow-wrapper) | 4 | 4 |
| buyBtn | 5 | 5 |
| cancelBtn | 6 | 6 |

### Pixel-spec-justeringer

| Element | FØR (iter1) | ETTER (iter2) | Begrunnelse |
|---|---|---|---|
| `card.display` | `block` (default) | `flex column` | Krevd for `order:`-stack ordering |
| `prizeMatrixEl.marginTop` | `18px` | (fjernet) | Header har allerede marginBottom 18px |
| `prizeMatrixEl.marginBottom` | (ikke satt) | `18px` | Gir 18px gap til typesContainer (matcher mockup-rytme) |
| `typesContainer.rowGap` | `16px` | `10px` | Strammere ticket-row-spacing per mockup |
| `typesContainer.columnGap` | `65px` | `24px` | 65px var altfor stort — mockup viser ~24px |
| `statusMsg.marginTop` | `18px` | `16px` | Litt strammere mot total-row |
| `sep` (totalRow-wrapper) | `height:1px; background:rgba(245,232,216,0.08)` | `background:transparent` | 1px-divider flyttet til totalRow.borderTop for renere CSS-modell |
| `totalRow.marginBottom` | `14px` | `0` | Wrapper håndterer margin |
| `totalRow.paddingTop` | (ingen) | `12px` | Plass over divider-linje |
| `totalRow.borderTop` | (ingen) | `1px solid rgba(245,232,216,0.08)` | Mockup viser 1px-divider over total-summary |
| `prizeMatrix headerRow.padding` | `0 10px 8px` | `0 10px 10px` | Litt mer luft mellom header-rad og første premie-rad |
| `prizeMatrix headerLabel.textAlign` | `center` | `left` | Mockup viser "PREMIETABELL" venstrejustert |

### Hvorfor disse endringene er trygge

- DOM-indices uendret (32/32 tester passer)
- TypeScript strict-mode passer
- Runtime-API uendret
- Spill 2/3 PlayScreen-konsumenter uberørt
- Letter-spacing 0.14em (subtitle) og 0.12em (premietabell-header) uendret — `displayName.test.ts` finner fortsatt subtitle korrekt

## Designsider for iterasjon

| Side | Path | Hva |
|---|---|---|
| Kjøpsmodal-mockup | `packages/game-client/src/kjopsmodal-design/kjopsmodal-design.html` | Tobias-bekreftet 2026-05-15 design (bundlet React/JSX) |

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-15 | Initial v1.0.0 — Game1BuyPopup oppdatert til kjopsmodal-design.html mockup. Premietabell lagt til som card.children[2]. Subtitle beholdt som `<div>` med letter-spacing 0.14em for test-kompatibilitet. PrizeMatrix-header bruker 0.12em for å unngå falsk uniqueness-match. Auto-multiplikator-formel speilet fra `SPILL_REGLER_OG_PAYOUT.md §3.1`. Grønn primær-knapp (matcher mockup `#10b981 → #047857`-gradient). Spill 2 `BongCard.ts` er uberørt — kun Spill 1's `Game1BuyPopup.ts` (delt med Spill 2/3 PlayScreen). |
| 2026-05-15 (iter2) | v1.0.1 — pixel-perfect iterasjon mot mockup. Card endret til flex-column med eksplisitt `order:` per child, slik at premietabell rendres VISUELT mellom header og ticket-rows (DOM-index 2 bevart for tests). Tightere spacing-verdier: typesContainer.rowGap 16→10px, columnGap 65→24px. 1px-divider flyttet fra sep.background til totalRow.borderTop (renere CSS-modell). PrizeMatrix-header venstrejustert. 32/32 tester passer. |
