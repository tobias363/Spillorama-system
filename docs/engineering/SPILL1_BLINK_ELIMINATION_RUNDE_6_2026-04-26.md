# Spill 1 — Blink Elimination Runde 6

**Dato:** 2026-04-26
**Forfatter:** Blink Fix Agent runde 6
**Status:** Implementert — fix/spill1-blink-runde-6
**Foregående runder:** PR #468 (backdrop-filter), #491 (CenterBall idle-tween), #492 (4 composite-hazards), #493 (text-memoize + popup-timing), #529 (preserve-3d + bg/color-trans + pulse z-index)

## TL;DR

- Tobias rapporterte 1 blink/min etter runde 5 (PR #529).
- Implementert **6 sekundære hazards** fra runde-5-rapport (#4-#7 fikset, #8-#9 skipped per rapport-anbefaling).
- Implementert **3 nye runde-6-kandidater** (NEW-1 til NEW-3) — alle infinite-animasjoner over Pixi-canvas på vinner-skjermer.
- 13 nye vitest-tester. Alle 526 game-client-tester grønne.
- Forventet effekt: 1/min → < 1/5min, sannsynligvis lavere (avhenger av om infinite text-shadow/box-shadow var hovedkilden).

## §1 Implementerte fixes — sekundære fra runde 5

### Hazard #4 — WinPopup `wp-amount-glow` infinite

**Lokasjon:** `packages/game-client/src/games/game1/components/WinPopup.ts:195`

**Problem:** `text-shadow`-animasjon med `infinite` iteration-count tvinger Chrome til å re-paint amount-elementet i hver mellom-frame av Pixi-canvas under hele 4s popup-vinduet.

**Fix:** Begrenset til 2 sykluser (~4.8s, dekker hele 4s popup-vinduet). Visuell intensjon (gold glow pulserer) er bevart.

```ts
// Før:
animation: "wp-amount-glow 2.4s ease-in-out infinite",
// Etter:
animation: "wp-amount-glow 2.4s ease-in-out 2",
```

### Hazard #5 — PatternMiniGrid `setInterval(1000)` mid-frame mutation

**Lokasjon:** `packages/game-client/src/games/game1/components/PatternMiniGrid.ts:198-237`

**Problem:** `setInterval(step, 1000)` kunne fyre mid-frame relativt til Pixi-render-cyclen. DOM-mutasjonen (classList-toggle på opp til 25 celler) konkurrerte med Pixi sin neste frame for compositing.

**Fix:** Gate DOM-mutasjonen via `requestAnimationFrame` så den landerseg på frame-grensen, like før neste paint. setInterval er fortsatt backbone (1s-tempo, beholder test-asserts). Initial step kjører umiddelbart uten rAF-gate. `stopAnimation()` kanseller pending rAF.

```ts
const scheduleStep = (): void => {
  if (typeof requestAnimationFrame === "undefined") {
    applyStep();
    return;
  }
  if (this.rafScheduled !== null) return;
  this.rafScheduled = requestAnimationFrame(() => {
    this.rafScheduled = null;
    applyStep();
  });
};
applyStep(); // initial — synkron, ingen rAF-gate
this.animationTimer = setInterval(scheduleStep, 1000);
```

### Hazard #6 — ToastNotification box-shadow + transform-transition

**Lokasjon:** `packages/game-client/src/games/game1/components/ToastNotification.ts:48-95`

**Problem:**
1. `transition: opacity 0.3s, transform 0.3s` ga 2 transitionstart-events per toast og transform-transition tvang composite-recalc i hver mellom-frame.
2. `boxShadow: 0 4px 16px rgba(0,0,0,0.4)` — paint-property med stor blur-radius, vedvarende paint over Pixi.

**Fix:**
- Strippet `transform` fra transition-listen → kun opacity-fade (transform settes instant).
- Flatere box-shadow: `0 2px 8px rgba(0,0,0,0.25)` — ~50% mindre blur-radius, ~40% mindre alpha, billigere GPU-paint.
- Dismiss-path forenklet: kun `opacity = 0`, ingen transform-snap.

### Hazard #7 — buildElvisBanner re-create på loadTicket

**Lokasjon:** `packages/game-client/src/games/game1/components/BingoTicketHtml.ts:238-274`

**Problem:** Hver `loadTicket(ticket)` på en eksisterende Elvis-bong rev banner-noden ned og bygget på nytt, selv om `ticket.color` var identisk. Inkluderte img-decoding (kort flash mens browseren mellomlagrer pixel-buffer).

**Fix:** Memo via `elvisBannerColorKey`. Skip rebuild når farge er uendret — 0 DOM-mutasjoner, 0 img-decoding.

```ts
private elvisBannerColorKey: string | null = null;

private syncElvisBanner(): void {
  // ...
  if (shouldHave && existing) {
    if (this.elvisBannerColorKey === colorKey) return; // ← skip rebuild
    const replacement = this.buildElvisBanner();
    existing.replaceWith(replacement);
    this.elvisBannerColorKey = colorKey;
  }
}
```

### Hazard #8 — WinScreenV2 fountain rAF-loop (SKIPPED)

Per runde-5-rapport §2 KANDIDAT #8: "skjer kun ved Fullt Hus-vinn, så ikke en hovedmistanke for 1/90s blink". Skip per rapport-anbefaling.

### Hazard #9 — MysteryGameOverlay setInterval (SKIPPED)

Per runde-5-rapport §2 KANDIDAT #9: "kun aktiv mens overlayen er synlig, ikke hele tiden". Skip per rapport-anbefaling.

## §2 Nye runde-6-kandidater

Etter at sek. hazards var fikset, utforsket vi nye områder. Funnene:

### NEW-1 — WinScreenV2 `v2-amount-glow` infinite

**Lokasjon:** `packages/game-client/src/games/game1/components/WinScreenV2.ts:298`

**Hvorfor det blinker:** Samme prinsipp som hazard #4. `text-shadow` infinite-animasjon på det store amount-elementet over 10.8s screen-vinduet.

**Fix:** Begrenset til 5 sykluser (~11s, dekker hele 10.8s screen-vinduet).

### NEW-2 — WinScreenV2 sparkles 50× `v2-sparkle` infinite

**Lokasjon:** `packages/game-client/src/games/game1/components/WinScreenV2.ts:360`

**Hvorfor det blinker:** 50 sparkle-prikker × `box-shadow: 0 0 6px #f5c842` × infinite v2-sparkle = vedvarende composite-trafikk over Fullt Hus-vinnerskjermen. Box-shadow er paint-property.

**Fix:** Begrenset til 5 sykluser per partikkel (2.5s × 5 = 12.5s + 3s delay-spread = 15.5s, dekker hele 10.8s screen-vinduet).

### NEW-3 — WinPopup `wp-float` 14× infinite floating clovers

**Lokasjon:** `packages/game-client/src/games/game1/components/WinPopup.ts:316`

**Hvorfor det blinker:** 14 floating clovers × `wp-float ${dur}s infinite` = continuous transform/opacity-animation over hele 4s popup-vinduet.

**Fix:** Endret til `1` iteration. Hver partikkel har duration 5-8s, så én iteration dekker popupens 4s levetid med margin.

## §3 Diagnostikk-verifisering

### Tester lagt til (13 nye)

`packages/game-client/src/games/game1/components/BingoTicketHtml.test.ts`:
- "hazard #7: loadTicket med samme Elvis-farge skal ikke re-bygge banner-noden"
- "hazard #7: loadTicket med ny Elvis-farge skal fortsatt re-bygge banner"

`packages/game-client/src/games/game1/components/PatternMiniGrid.test.ts`:
- "hazard #5: rafScheduled-felt eksisterer på instansen (rAF-gate aktiv)"
- "hazard #5: initial step kjører umiddelbart (ikke gated bak rAF)"
- "hazard #5: stopAnimation kanseller pending rAF (ingen sent DOM-write)"

`packages/game-client/src/games/game1/components/WinPopup.test.ts`:
- "round 6 hazard #4: wp-amount-glow er IKKE infinite"
- "round 6 NEW-3: wp-float clovers er IKKE infinite"

`packages/game-client/src/games/game1/components/WinScreenV2.test.ts`:
- "round 6 NEW-1: v2-amount-glow er IKKE infinite"
- "round 6 NEW-2: v2-sparkle på sparkle-prikker er IKKE infinite"

`packages/game-client/src/games/game1/components/ToastNotification.test.ts` (ny fil, 4 tester):
- "info() viser toast med riktig tekst"
- "win() / error() / info() rendrer alle 3 samtidig"
- "hazard #6: toast-element har INGEN transform i transition-listen"
- "hazard #6: toast-element bruker flatere box-shadow"

### Test-resultater

```
Test Files  44 passed (44)
     Tests  526 passed (526)
```

## §4 Forventet effekt

Tobias rapporterte ~1 blink/min etter runde 5. Hovedmistenkte for gjenstående blink:

1. **Infinite text-shadow på amount-elementer** — paint-property × infinite = vedvarende re-paint over Pixi-canvas. Fikset i NEW-1, hazard #4.
2. **Infinite box-shadow på sparkles** — samme prinsipp × 50 elementer. Fikset i NEW-2.
3. **Floating clovers infinite** — 14 elementer × continuous transform over 4s. Fikset i NEW-3.
4. **PatternMiniGrid mid-frame mutation** — 1 mutasjon/sek mid-frame relativt til Pixi-render. Fikset i hazard #5.
5. **ToastNotification transform-transition** — komposit-recalc over Pixi for hver toast. Fikset i hazard #6.

Hvis hovedkilden var infinite paint-properties (text-shadow / box-shadow) — som er en sterk hypotese siden de er kandidater til **periodisk** GPU-paint over en kontinuerlig-rendrende Pixi-canvas — bør runde 6 redusere blink-frekvensen til < 1/5min, kanskje eliminere det helt.

Hvis blink fortsatt forekommer etter Tobias-verifisering: gjenstående kandidater er:
- **Pixi `Application` ticker** — fyrer per frame uavhengig av endringer; mulig at en spesifikk frame periodisk spike-r for paint-cost (vanskelig å diagnostisere uten dev-mode HUD).
- **GPU memory pressure-cycle** (runde 5 §5 Plan B) — periodic GC eller layer-eviction.
- **Hazard #8 (fountain rAF) eller #9 (Mystery setInterval)** — kun aktive under vinst eller mini-game, men kunne korrelere med blink hvis brukerens scenario inkluderer slike events.

## §5 Restkandidater hvis fortsatt blink

Hvis Tobias verifiserer 10-min gaming-session og fortsatt ser 1 blink/min:

### Plan A — Aktivér PerfHud i prod (#471)

`?perfhud=1` viser FPS, paint-rate, layer-count i real-time. Kjør 10 min og se etter:
- Layer-count > 30: indikerer permanent layer-promotion-pressure som ikke er fikset.
- Paint-rate > 30/sec: indikerer per-frame re-paint over et område.

### Plan B — Sub-pixel screenshot-diff (runde 5 §5 Plan A)

Implementer `BlinkDiagnostic`-modus som tar screenshot hvert 100ms og differ pixel-buffers. Logger spesifikt regioner (bbox) som har endret seg uten at det var en planlagt animasjon.

### Plan C — Hazard #8/#9 hvis brukerens session inkluderer mini-games

Hvis Tobias's 1 min med 2 blink-test inkluderer Fullt Hus-vinn eller Mystery/Wheel-mini-game, så kan #8/#9 være aktive. Implementér da:
- #8: Bytt fountain rAF til CSS-keyframes med pre-computed banner-attributes per partikkel.
- #9: Vis Mystery-countdown via HTML overlay i stedet for Pixi Text (Pixi text-rebuild = re-rasterize glyph cache 1/sec).

### Plan D — Pixi-renderer context-restore (runde 5 §5 Plan D)

Inspect `WebGLContextGuard.ts` for uplanlagte `restored`-events. Pixi.js v8 WebGL2-renderer kan ha bugs i context-restore-håndtering som gir periodisk frame-drop.

## §6 Filer endret

| Fil | Lines | Type |
|-----|-------|------|
| `packages/game-client/src/games/game1/components/WinPopup.ts` | +12 −2 | Fix #4 + NEW-3 |
| `packages/game-client/src/games/game1/components/WinScreenV2.ts` | +13 −2 | NEW-1 + NEW-2 |
| `packages/game-client/src/games/game1/components/PatternMiniGrid.ts` | +50 −4 | Fix #5 |
| `packages/game-client/src/games/game1/components/ToastNotification.ts` | +20 −6 | Fix #6 |
| `packages/game-client/src/games/game1/components/BingoTicketHtml.ts` | +20 −4 | Fix #7 |
| `packages/game-client/src/games/game1/components/BingoTicketHtml.test.ts` | +102 | Tester |
| `packages/game-client/src/games/game1/components/PatternMiniGrid.test.ts` | +52 | Tester |
| `packages/game-client/src/games/game1/components/WinPopup.test.ts` | +48 | Tester |
| `packages/game-client/src/games/game1/components/WinScreenV2.test.ts` | +47 | Tester |
| `packages/game-client/src/games/game1/components/ToastNotification.test.ts` (ny) | +89 | Tester |
| `docs/engineering/SPILL1_BLINK_ELIMINATION_RUNDE_6_2026-04-26.md` (ny) | +200 | Dokumentasjon |

**Totalt:** 9 filer modifisert + 2 nye filer (1 test + denne rapporten).
