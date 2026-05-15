---
name: bong-design
description: When the user/agent works with the Spillorama bong-card visual design — header layout, BINGO-letters, cell styling, FREE-celle, single vs triple-design. Also use when they mention BingoTicketHtml, BONG_COLORS, bong-design.html preview, BINGO_LETTER_COLORS, getColorDisplayName, isLargeTicket, bong-card padding, ticket-body wrapper, cream cell-bakgrunn (#fbf3df), MARKED_BG burgundy (#7a1a1a), per-bokstav-fyll med text-stroke, eller Tobias-bekreftet bong-design 2026-05-15 IMMUTABLE. Make sure to use this skill whenever someone touches `packages/game-client/src/games/game1/components/BingoTicketHtml.ts` — even if they don't mention bong-design directly — because changes to the bong-component must match §5.9 spec 1:1 (kanonisk i `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`).
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: packages/game-client/src/games/game1/components/BingoTicketHtml.ts, packages/game-client/src/games/game1/components/BingoTicketHtml.test.ts, packages/game-client/src/games/game1/components/BingoTicketHtml.elvis.test.ts, packages/game-client/src/games/game1/components/TicketGridHtml.largeMultiplicity.test.ts, packages/game-client/src/bong-design/bong-design.html, packages/game-client/src/bong-design/bong-design.ts -->

# Bong-design — single + triple (Spill 1 + Spill 3)

§5.9 i `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` (Tobias-bekreftet 2026-05-15 IMMUTABLE) er den kanoniske spec-en for hvordan bonger skal se ut i prod. Hvis kode motsier doc-en: **doc-en vinner**, koden må fikses (per `CLAUDE.md` §2.4).

## Lese-først

1. **`docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §5.9** — kanonisk spec
2. **`packages/game-client/src/bong-design/bong-design.html`** + **`bong-design.ts`** — live mockup som ble iterert med Tobias
3. **`packages/game-client/src/games/game1/components/BingoTicketHtml.ts`** — prod-komponent

## Hvilke komponenter rendrer bonger?

| Komponent | Brukes av | Grid-form | Beholder? |
|---|---|---|---|
| `BingoTicketHtml` | **Spill 1** (`bingo`) via `TicketGridHtml` | 5×5 med fri sentercelle | Nei — implementerer §5.9 |
| `BingoTicketHtml` | **Spill 3** (`monsterbingo`) via `Game3Controller` → `PlayScreen` → `TicketGridHtml` | 5×5 uten fri sentercelle | Nei — får §5.9-design automatisk (Tobias-direktiv 2026-05-03: "Alt av design skal være likt [Spill 1]") |
| `BongCard` | **Spill 2** (`rocket`) via Game2-PlayScreen | 3×3 full plate | **Ja — uberørt av §5.9**. Spill 2 har egen design-iterasjon. |

> **Vær obs:** §5.9 sier "Gjelder Spill 1 og Spill 2 (begge bruker BingoTicketHtml.ts)" — det er upresist. Spill 2 bruker `BongCard.ts`, ikke `BingoTicketHtml.ts`. Den faktiske effekten er: §5.9 påvirker Spill 1 + Spill 3 (begge bruker `BingoTicketHtml`). Tobias bekreftet at Spill 3 skal være "Alt av design skal være likt [Spill 1]" (2026-05-03 revert).

## Pixel-spec (single + triple)

### Container

| Element | Verdi |
|---|---|
| `.bong-card` bredde × høyde | 240×300 (single), 666px bredde × auto (triple) |
| `.bong-card` padding | `12px 18px 10px 18px` |
| `.bong-card` gap | `10px` (mellom header og body) |
| `.bong-card` border-radius | 8px |
| `.bong-card` box-shadow | `0 2px 8px rgba(0,0,0,0.08)` |

### Header (`.ticket-header-name` + `.ticket-header-price` + × cancel-knapp)

| Element | Verdi |
|---|---|
| Layout | `display: flex; justify-content: space-between; gap: 22px;` |
| Padding-bottom | 5px |
| Border-bottom | `1px solid rgba(0, 0, 0, 0.15)` |
| Name font | Inter 700, 12px, letter-spacing -0.005em |
| Price font | Inter 600, 12px, tabular-nums |
| × button | Inline (`marginLeft: auto`), 18×18px, background transparent, color inherit, font 500 18px |

### Header-tekst-spec

| Bong-type | Format | Eksempel |
|---|---|---|
| `ticket.type="small"` | KUN fargen (Norwegian) | `"Gul"` / `"Hvit"` / `"Lilla"` |
| `ticket.type="large"` | Fargen + " - 3 bonger" | `"Gul - 3 bonger"` / `"Hvit - 3 bonger"` |
| Elvis-varianter | `getElvisLabel()` (uendret) | `"Elvis 1"` osv. |

Implementert via `getColorDisplayName(color)` + `isLargeTicket(type, color)` (helper-funksjoner top-of-file).

**Backend wire-format:** sender 3 SEPARATE `Ticket`-objekter per Large-kjøp (per `TicketGridHtml.largeMultiplicity.test.ts`). Hver av disse rendres av denne komponenten — header-suffikset signaliserer at bongen tilhører en 3-brett-bunt. Det er IKKE en gruppert "triple-ticket" data-modell — derfor er triple-design med 3 sub-grids og dividers IKKE implementert som single render. Hvis backend en gang sender `{ siblingTicketIds: [...] }`, kan triple-rendering vurderes som ny komponent (TODO).

### `.ticket-body` wrapper

Inneholder BINGO-letters + grid + footer som flex-column med `gap: 4px`. Matcher mockup `.triple-sub`-strukturen 1:1 så single = sub-grid identisk om backend en gang sender gruppert data.

### BINGO-letters

| Element | Verdi |
|---|---|
| Layout | `display: grid; gridTemplateColumns: repeat(cols, 1fr); gap: 5px;` |
| Font | Inter 900, 16px, letter-spacing 0.02em |
| `text-stroke` | `WebkitTextStroke: 1.8px #000` + `paintOrder: stroke fill` |
| Per-bokstav farge (kun 5-kolonne) | B=#c45656 / I=#e0c068 / N=#6a8cd6 / G=#f3eee4 / O=#7aa874 |
| Fallback (annet enn 5-kolonne) | `MARKED_BG` (burgundy #7a1a1a) |

Per-bokstav-farger eksponert som `BINGO_LETTER_COLORS`-konstant (top-of-file).

### Grid + celler

| Element | Verdi |
|---|---|
| Grid | `display: grid; gridTemplateColumns: repeat(cols, 1fr); gridTemplateRows: repeat(rows, 1fr); gap: 5px;` |
| Cell font | Inter 700, 14px, tabular-nums |
| Cell border-radius | 4px |
| Cell UNMARKED bakgrunn | `#fbf3df` (cream — eksportert som `UNMARKED_BG`) |
| Cell UNMARKED tekstfarge | `#7a1a1a` (burgundy — samme som `MARKED_BG`) |
| Cell MARKED bakgrunn | `#7a1a1a` (burgundy) |
| Cell MARKED tekstfarge | `#ffffff` |
| Cell FREE-cell | Spillorama-logo (firkløver) `FREE_LOGO_URL` — **IKKE** "FREE"-tekst som i mockup |
| Cell LUCKY | Cream-base + firkløver-overlay (55% size) + gul innskrytt ramme (`inset 0 0 0 2px #ffe83d`) |

### Footer (`.ticket-togo`)

| Element | Verdi |
|---|---|
| Layout | `text-align: center;` |
| Font | Inter 500, 11px |
| Color | `#000` (svart — samme uansett bong-farge) |
| Margin-top | 4px |
| One-to-go-state | Inter 700, uppercase, letter-spacing 0.06em, samme svart farge + `bong-otg-pulse`-animasjon |

## Hva du IKKE skal endre

- **`FREE_LOGO_URL`** — Spillorama-logo i sentercellen er bevisst valg (avvik fra mockup som viser "FREE"-tekst)
- **`BONG_COLORS`-palette hex-verdier** — fargene er kanoniske; ikke endre `#f0b92e`, `#b8a4e8`, osv.
- **Pulse-keyframes** (`bong-pulse-cell`, `bong-otg-badge`) — fix mot blink-bug (round 3 + 5)
- **`disableFlipComposite()` / `enableFlipComposite()`** — perspective + preserve-3d kun under flip (blink-fix round 3 + 5)
- **Spill 2 `BongCard.ts`** — uberørt av §5.9; Spill 2 har egen design
- **Spill 3 ticket-rendering** — får §5.9-design automatisk via shared `BingoTicketHtml`, og det er korrekt per Tobias-direktiv 2026-05-03 ("Alt av design skal være likt [Spill 1]")

## Beskyttede invariants

1. **Header-rekkefølge må være `name → price → × button`** med `× marginLeft: auto`. Hvis du flytter pris til høyre eller × til venstre, bryter du flex-layouten og `× button` overlapper innholdet.
2. **`.ticket-body` wrapper er nødvendig** for `gap: 4px` mellom BINGO-letters + grid + footer. Uten wrapper får hver av disse face-direkte-margin og spacing-mockupen brytes.
3. **`palette.text` er IKKE lenger brukt i cell-rendering** — alle unmarked celler bruker burgundy `MARKED_BG`. Hvis du gjeninnfører palette-basert tekstfarge, bryter du konsistens-mockupen.
4. **`palette.footerText` er IKKE lenger brukt for footer** — footer er alltid `#000`. Tidligere variasjon mellom rød/grønn/lilla footer-tekstfarger er fjernet.

## Sub-bugs som §5.9 fjernet

- **Lucky-cell var lite synlig** (PR 2026-04-30) — fortsatt firkløver-overlay + gul ramme. Cream-base gjør at firkløveren skiller seg tydeligere fra grønn lucky-clover.
- **Pris og navn overlappet × button** (legacy) — `× button` var absolutt-posisjonert med `top: -4px right: -6px` og kunne overlappe pris. Nå inline → flex håndhever spacing.

## Hvis du må gjenopprette gamle mønstre

- **Trenger semi-transparent celle (skinn-gjennom-bakgrunn)**: ikke gjør det. §5.9 er IMMUTABLE.
- **Trenger ulik cell-tekstfarge per bong-farge**: ikke gjør det. Konsistens er bevisst.
- **Vil reintrodusere palette.footerText**: ikke gjør det. Mockup viser svart footer.

Hvis det er reell ny krav fra Tobias som gjør en av disse nødvendige, vent på eksplisitt direktiv. Hvis i tvil: spør, ikke gjett.

## Relaterte ADR-er

- (ingen direkte ADR for bong-design ennå — §5.9 er IMMUTABLE-spec, ikke ADR-format)

## Tester

Eksisterende tester:
- `BingoTicketHtml.test.ts` — basis-rendering, header, cells, flip
- `BingoTicketHtml.elvis.test.ts` — Elvis-banner-varianter
- `TicketGridHtml.largeMultiplicity.test.ts` — verifiserer at 3 Large = 3 separate tickets

**§5.9 oppdaterer IKKE eksisterende tester (per Tobias-direktiv).** Eksisterende assertions vil feile på:
- `header.textContent === "Small Yellow"` → nå "Gul"
- Cell-font-size `13px` → nå `14px`

Test-update planlegges separat når Tobias gir grønt lys.

## Design-iterasjons-sider

| Side | Path | Hva |
|---|---|---|
| Bong-design preview | `/web/games/bong-design.html` | Live mockup som ble iterert med Tobias |

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-15 | Initial v1.0.0 — §5.9 prod-implementasjon i `BingoTicketHtml.ts`. Spec-iterasjon ble gjort på `bong-design.html` mockup; denne skill-en dokumenterer prod-state. Skopet er Spill 1 + Spill 3 (begge bruker `BingoTicketHtml`); Spill 2 (`BongCard.ts`) er uberørt. |
