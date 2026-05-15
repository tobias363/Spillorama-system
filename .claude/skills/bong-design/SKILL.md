---
name: bong-design
description: When the user/agent works with the Spillorama bong-card visual design — header layout, BINGO-letters, cell styling, FREE-celle, single vs triple-design. Also use when they mention BingoTicketHtml, BONG_COLORS, bong-design.html preview, BINGO_LETTER_COLORS, getColorDisplayName, isLargeTicket, bong-card padding, ticket-body wrapper, cream cell-bakgrunn (#fbf3df), MARKED_BG burgundy (#7a1a1a), per-bokstav-fyll med text-stroke, eller Tobias-bekreftet bong-design 2026-05-15 IMMUTABLE. Make sure to use this skill whenever someone touches `packages/game-client/src/games/game1/components/BingoTicketHtml.ts` — even if they don't mention bong-design directly — because changes to the bong-component must match §5.9 spec 1:1 (kanonisk i `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`).
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: packages/game-client/src/games/game1/components/BingoTicketHtml.ts, packages/game-client/src/games/game1/components/BingoTicketTripletHtml.ts, packages/game-client/src/games/game1/components/TicketGridHtml.ts, packages/game-client/src/games/game1/components/BingoTicketHtml.test.ts, packages/game-client/src/games/game1/components/BingoTicketHtml.elvis.test.ts, packages/game-client/src/games/game1/components/TicketGridHtml.largeMultiplicity.test.ts, packages/game-client/src/bong-design/bong-design.html, packages/game-client/src/bong-design/bong-design.ts, packages/shared-types/src/game.ts, packages/shared-types/src/schemas/game.ts, apps/backend/src/game/Game1ScheduledRoomSnapshot.ts, apps/backend/src/game/types.ts -->

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

## Triple-bong group-rendering (Bølge 2, 2026-05-15)

Stor X (Large) er en 3-brett-bundle. Tobias-direktiv 2026-05-15: hver Large-bong skal vises som ÉN visuell triple-container — 3 sub-grids side-om-side med vertikale dividers — istedenfor 3 separate single-bonger.

### Når kicker triple-rendering inn?

`TicketGridHtml.rebuild()` grupperer 3 etterfølgende tickets hvis ALLE
betingelser oppfylles (oppdatert iterasjon 2 — 2026-05-15):

1. ALLE 3 har `type === "large"`
2. ALLE 3 har samme `purchaseId` (satt — null/undefined avvises)
3. ALLE 3 har samme `color` (normalisert til familie via `extractColorFamily`)

Hvis betingelsene oppfylles → render som `BingoTicketTripletHtml`. Ellers → fall tilbake til 3 single-bonger.

**Partial-purchase fallback:** Hvis backend sender 1-2 av 3 sub-tickets for en purchase (eks. en sub-ticket har blitt slettet), faller rendringen tilbake til single for de tickets som ikke kan grupperes. Per 2026-05-15 sender backend altid alle 3 atomisk (purchase er én transaksjon).

### Bug-fix 2026-05-15 (iter 2) — KRITISK regresjon-historie

PR #1500 (Bølge 2) introduserte triple-grupperings-funksjonalitet, men
opprinnelig `tryGroupTriplet` sjekket KUN `purchaseId` — IKKE `type` eller
`color`. Det førte til cross-color-grupperinger i handlekurv-scenarier:

**Bug-symptom (Tobias-rapport 2026-05-15):**
- Kjøpte 1 Stor hvit + 1 Stor gul + 1 Stor lilla
- Så 3 hvit-single + 6 gul-single + 0 lilla istedenfor 3 triple-containere

**Root cause:** Backend bruker ÉN `app_game1_ticket_purchases.id` per handlekurv
(ikke per stor-bundle). Alle bonger i samme handlekurv (small + large av
forskjellige farger) delte SAMME `purchaseId`. Frontend grupperte de første
3 tickets med matching purchaseId uavhengig av farge/størrelse.

**Fix:** Tre lag:

1. **Frontend (`TicketGridHtml.tryGroupTriplet`):** Krever nå at ALLE 3 har
   `type === "large"`, samme `purchaseId` OG samme color-familie. Cross-
   color-grupperinger avvises automatisk.

2. **Backend (`ensureAssignmentsForPurchases`):** Multipliserer rader for
   `size === "large"` med `LARGE_TICKET_BRETT_COUNT = 3`. Tidligere genererte
   bare 1 rad per Stor-bong → frontend hadde aldri 3 rader å gruppere.

3. **Pre-round (`getOrCreateDisplayTickets`):** Genererer synthetic
   `purchaseId` (`${roomCode}:${playerId}:bundle:${idx}`) + `sequenceInPurchase`
   1..3 når 3 etterfølgende `colorAssignments`-entries har `type=large`
   og samme color. Pre-round-bonger som tidligere hadde ingen purchaseId
   kan nå rendres som triple-containere.

**Test-coverage:**
- `TicketGridHtml.tripleGrouping.test.ts` (6 tests, frontend)
- `Game1ScheduledRoomSnapshot.test.ts` (2 nye tester, backend)
- `roomState.displayTicketColors.test.ts` (5 nye tester, pre-round)

### Backend → frontend wire-format

`Ticket`-interfacet (i både `packages/shared-types/src/game.ts` og `apps/backend/src/game/types.ts`) har to nye optional-felter:

```typescript
purchaseId?: string;          // FK til app_game1_ticket_purchases.id
sequenceInPurchase?: number;  // 1-indeksert posisjon i purchase (1, 2, 3)
```

`Game1ScheduledRoomSnapshot.enrichScheduledGame1RoomSnapshot` propagerer disse fra `app_game1_ticket_assignments`-tabellen til wire-objektet. Backend sender alltid sub-tickets i `sequence_in_purchase`-rekkefølge (ORDER BY i SQL-spørringen). Frontend stoler på rekkefølgen og sorterer ikke.

### Pixel-spec triple

| Element | Verdi |
|---|---|
| Container-bredde | 660px maks |
| Container-padding | `12px 18px 10px 18px` (samme som single) |
| Container-gap | `10px` (mellom header og grids) |
| `.bong-triplet-grids` | `display: grid; grid-template-columns: 1fr 1px 1fr 1px 1fr` |
| Dividere | 1px `rgba(0, 0, 0, 0.15)` vertikale linjer mellom sub-grids, `margin: 4px 0` |
| Sub-grid padding | `padding: 0 10px` (sub 1 + 3 = `padding-left/right: 0` på ytter-kantene; midt-sub `13px` ekstra) |
| Header-tekst | `"Gul - 3 bonger"` / `"Hvit - 3 bonger"` / `"Lilla - 3 bonger"` |
| Header-pris | `pris × 3` (total for hele triple-bundlen) |
| × cancel-knapp | ÉN knapp, canceler hele purchase (alle 3 sub-tickets) |

### Sub-bongers usynlige headere

`BingoTicketTripletHtml` legger CSS-overrides via `bong-triplet-card`-klasse-prefix:
```css
.bong-triplet-card .bong-triplet-sub .ticket-header-name,
.bong-triplet-card .bong-triplet-sub .ticket-header-price {
  display: none !important;
}
.bong-triplet-card .bong-triplet-sub button[aria-label="Avbestill brett"] {
  display: none !important;
}
```

Sub-bongene rendrer fortsatt sin egen `BingoTicketHtml`-DOM (med ticket-grid + BINGO-letters + footer), men header + cancel-knapp er skjult fordi wrapperen eier dem.

### TicketGridHtml — entry-rom vs ticket-rom

Etter Bølge 2 har `TicketGridHtml.tickets` BLANDET typer: `BingoTicketHtml | BingoTicketTripletHtml`. Kalt **entry-rom**.

`liveCount` som tidligere var i ticket-rom (1 large = 3 tickets) konverteres til entry-rom (1 large = 1 entry) inne i `rebuild()`. `applyMarks()` itererer på entry-rom og bruker `this.liveCount` direkte. Caller (`Game1Controller`) trenger ikke endres — `setTickets()` mottar fortsatt ticket-rom-`liveCount`.

`computeSignature` regnes på ticket-rom (uendret) så cache-hit-logikken fortsatt fungerer.

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
| 2026-05-15 | v1.1.0 — Bølge 2 triple-bong group-rendering. Ny `BingoTicketTripletHtml` wrapper-klasse + `TicketGridHtml` purchase-grouping-logikk. `Ticket`-interface utvidet med `purchaseId` + `sequenceInPurchase` i både shared-types og backend. `Game1ScheduledRoomSnapshot` propagerer disse fra `app_game1_ticket_assignments`. CSS-overrides skjuler sub-bongers individuelle header. Backend sender altid sub-tickets i sequence-rekkefølge per purchase. Partial-purchase faller tilbake til single-rendering. |
| 2026-05-15 | v1.2.0 (iter 2) — KRITISK fix av triple-rendering. PR #1500 hadde `tryGroupTriplet` som sjekket KUN `purchaseId`, ikke `type`/`color`. Førte til cross-color-grupperinger og 0 visuell triple-effekt i prod (Tobias-rapport med screenshot 2026-05-15). Tre-lag fix: (1) frontend `tryGroupTriplet` krever nå same-color + same-type=large, (2) backend `ensureAssignmentsForPurchases` multipliserer Stor X med 3 brett, (3) pre-round `getOrCreateDisplayTickets` emitter synthetic purchaseId for 3 brett av samme farge. Test-coverage: 13 nye tester på tvers av 3 test-filer. |
