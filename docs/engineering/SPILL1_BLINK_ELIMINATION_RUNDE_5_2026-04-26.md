# Spill 1 — Blink Elimination Runde 5

**Dato:** 2026-04-26
**Forfatter:** Blink Elimination Agent
**Status:** Analyse-rapport — ingen kode-endringer
**Foregående runder:** PR #468 (backdrop-filter), #491 (CenterBall idle-tween), #492 (4 composite-hazards), #493 (text-memoize + popup-timing)

## TL;DR

- Frekvens nå: **~1 blink per 90 sek (4 blink på 6 min)** rapportert av Tobias 2026-04-26.
- Mistenkte gjenstående hazards: **9 kandidater** identifisert.
- Foreslåtte fix: **3 høyt prioriterte + 6 sekundære** — alle hypoteser, må verifiseres med BlinkDiagnostic / PerfHud.
- Strategi: Hver kandidat har konkret reproduksjon. Anbefaler å fikse #1, #2, #3 i én PR og deretter måle igjen.

## §1 Historikk — hva er allerede fikset (per PR)

| PR | Hovedfunn | Fix |
|---|---|---|
| **#468** | 12 HTML-elementer over Pixi-canvas brukte `backdrop-filter: blur(X)` → tvang GPU til å re-kjøre blur-shader per Pixi-frame (60-120+ fps). | Fjernet `backdrop-filter` fra `.prize-pill` (5×), `#chat-panel`, action-buttons, toaster. Beholdt på 4 popup-backdrops (allow-list i `__tests__/no-backdrop-filter-regression.test.ts`). |
| **#491** | `CenterBall` kjørte `gsap.fromTo(..., { yoyo: true, repeat: -1 })` som idle-tween fra første swapTexture og hver state-overgang → konstant `.y`-mutasjon på Pixi-container, per-frame redraw. | Idle = statisk. Bob (4px yoyo) kjøres kun fra `showNumber.onComplete` med `repeat: 1` (~2.4s totalt). |
| **#492** | (1) PauseOverlay instant flip etter phase-won. (2) `filter:blur(0.5px)` på BallTube glass-striper. (3) `bong-pulse-ring` 4-lags box-shadow infinite på 20-50+ celler. (4) `perspective: 1000px` permanent på 30 bonger + `will-change` over-aggressiv. | (1) Opacity-fade 0.4s + display:none etter fade. (2) Erstattet med feathered gradient. (3) Fjernet box-shadow keyframe + background-animation. (4) Perspective KUN under flip; fjernet `will-change` i WinPopup + WinScreenV2. |
| **#493** | Bl.a. (1) MiniGrid-cells brukte transition + scale-pulse som restartet ved fase-cycling. (2) Pill-state via inline style trigger 30+ style-mutasjoner/sek. (3) WinPopup auto-close 3s→4s. | (1) Phase-locked sweep via `animation-delay` så fase-cycling ikke restarter pulsen. (2) All pill-styling i CSS-klasser, kun classList-toggle. (3) Auto-close justert. |

**Generelle invariants etablert:**
- `transition: all` forbudt (stylelint-regel `plugin/no-transition-all`)
- Infinite animations → allow-list i stylelintrc (`plugin/animation-iteration-whitelist`)
- `will-change` → kun `transform`/`opacity` (`plugin/will-change-whitelist`)
- 1 blink-test per runde i `__tests__/no-backdrop-filter-regression.test.ts`

## §2 Gjenstående hazards (kandidat-liste)

Hver hazard er kategorisert: **HØY** (sterkt mistenkt for 1/90s blink), **MEDIUM** (sannsynlig sekundær), **LAV** (teoretisk, lav payoff).

---

### KANDIDAT #1 — HØY PRIORITET

**Permanent composite-layer per bong via `transform-style: preserve-3d`**

**Lokasjon:** `packages/game-client/src/games/game1/components/BingoTicketHtml.ts:175-183`

```ts
this.inner = document.createElement("div");
Object.assign(this.inner.style, {
  position: "relative",
  width: "100%",
  height: "100%",
  transformStyle: "preserve-3d",         // ← Skaper composite-layer
  transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",   // ← + transition
  transform: "rotateY(0deg)",            // ← + transform aktiv
});
```

**Hvorfor det blinker:**

PR #492 fikset `perspective: 1000px` ved å aktivere det KUN under flip-animasjon. Men `transform-style: preserve-3d` på `inner` (alltid på, alle 30 bonger) kombinert med `transition: transform 0.4s` + `transform: rotateY(0deg)` skaper:

1. **Permanent composite-layer per bong**. 30 bonger × layer-størrelse = ~360 MB GPU-tekstur ved 240×300 pixels (med devicePixelRatio).
2. Når GPU-minnet kommer nær eviction-terskelen (browseren bestemmer dynamisk), kan layers droppes og rebygges, → synlig blink.
3. Sammenfaller med 1/90s-frekvens hvis layer-eviction følger en cyclic GPU-memory pressure cycle.

**Speserielt mistanke fordi:**
- PR #492 påpeker at `perspective: 1000px` på root var en hovedmistenkt for layer-eviction (nå fikset). `preserve-3d` på inner har samme egenskap — det skaper en 3d-rendering-context som promoterer hele inner-treet til sitt eget lag.
- 30 permanente lag = vedvarende GPU-pressure som kan forårsake **periodiske** evictions.

**Foreslått fix:**

`transform-style: preserve-3d` brukes for at `backface-visibility: hidden` skal virke på front/back-fasene. Alternativer:

- **(a) Aktiver `preserve-3d` + `perspective` KUN under flip** (som PR #492 gjør for `perspective`). Default = ingen 3D-rendering-context. Vipp på under `toggleFlip()`, av igjen 450ms etter.
- **(b) Erstatt `preserve-3d`-flip med 2D-overgang.** Bytt fra `rotateY(180deg)` til en CSS-`opacity`+`scale`-flip av forgrunns/bakgrunns-divene. Mister 3D-rotasjon men beholder visuell flip.

Variant (a) er mer kompatibel; variant (b) er mer aggressiv composite-cleanup.

**Status:** GJENSTÅR (fix #492 dekket bare `perspective`, ikke `preserve-3d`).

---

### KANDIDAT #2 — HØY PRIORITET

**`transition: background 0.12s, color 0.12s` på alle 25 celler per bong**

**Lokasjon:** `packages/game-client/src/games/game1/components/BingoTicketHtml.ts:543-561` (i `buildCells`)

```ts
Object.assign(cell.style, {
  // ...
  transition: "background 0.12s, color 0.12s",
});
```

**Hvorfor det blinker:**

Hver `paintCell(idx)` (kalles fra `markNumber`, `reset`, `highlightLuckyNumber`, `loadTicket`, og initial paint) muterer `cell.style.background` og `cell.style.color`. Med `transition: background 0.12s, color 0.12s`:

1. Hver mutasjon triggrer `transitionstart:background-color` + `transitionstart:color` events (2 per celle).
2. Med 30 bonger × 25 celler = potensielt 750 transitionstart-events per ball-trekk når et nytt tall markeres.
3. Selv om bare ~15 celler faktisk markerer (én per bong i snitt), gir det 15-30 transitions samtidig.
4. **`background` og `color` er paint-egenskaper** (ikke composite-bar). En transition over 120ms tvinger Chrome til å re-paint regionen i hver mellomframe — synlig som en visuell jitter.

**Speserielt mistanke fordi:**
- `markNumber` kalles på `draw:new` (typisk hvert 2-4 sek), så ~15-30 paint-transitions per ball-draw.
- Med 70 baller per runde × 30 bonger × 25 celler = potensielt millioner av transitionstart-events (de mest aggressive Chrome DevTools-output).
- 1/90s frekvens kan korrelere med "uheldige sammenfall" mellom transition-mid-frame og Pixi render-cycle.

**Foreslått fix:**

Fjern transition på celler — mark-overgang skal være instant (matcher Unity-paritet, der celle-color-bytte er instant). Hvis ønsket fade beholdes for visuell smoothness, gjør det via class-toggle på en CSS-keyframe (single-shot) i stedet for inline transition.

```ts
Object.assign(cell.style, {
  // ... fjernet:
  // transition: "background 0.12s, color 0.12s",
});
```

**Status:** GJENSTÅR. Tidligere blink-runder fokuserte på animasjons-restart (PR #493) og infinite keyframes (PR #492). Per-celle-transition er mindre synlig, men 750+ events per draw er mye.

---

### KANDIDAT #3 — HØY PRIORITET

**Infinite CSS animations på "one-to-go"-celler og badge — composite-trafikk**

**Lokasjon:** `packages/game-client/src/games/game1/components/BingoTicketHtml.ts:86-117`

```css
@keyframes bong-otg-badge {
  0%, 100% { opacity: 0.85; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.04); }
}
.bong-otg-pulse { animation: bong-otg-badge 1.3s ease-in-out infinite; }

@keyframes bong-pulse-cell {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}
.bong-pulse {
  animation: bong-pulse-cell 1.3s ease-in-out infinite;
  background: rgba(255,255,255,0.95);
  outline: 2px solid #7a1a1a;
  z-index: 1;
  position: relative;            /* ← Nytt stacking-context */
}
```

**Hvorfor det blinker:**

PR #492 fikset `bong-pulse-ring` (4-lags box-shadow infinite). De gjenstående `bong-otg-badge` og `bong-pulse-cell` animasjoner er composite-bar (`transform: scale`), men:

1. **`position: relative; z-index: 1`** på `.bong-pulse` skaper et nytt stacking-context per celle.
2. Med 30 bonger × ~3 "one-to-go"-celler hver i late-game = 90 stacking-contexts. Hver er en kandidat for promotion til composite-layer.
3. Chrome's heuristikk for layer-promotion er ikke deterministisk; layers kan opprettes og fjernes underveis — synlig som en kortvarig blink.
4. `bong-otg-pulse` (footer-badge) er på 1 element per bong = 30 elementer. Mindre, men fortsatt løpende.

**Speserielt mistanke fordi:**
- Animasjonene er aktive **kontinuerlig under runden** (typisk siste 30-50% av runden når mange er one-to-go).
- 1/90s blink-frekvens kunne også korrelere med tidspunktet når en ny celle blir one-to-go (legges til `.bong-pulse` mid-runde) → ny stacking-context oppstår.

**Foreslått fix:**

(a) **Fjern `z-index: 1` fra `.bong-pulse`** — z-index trengs egentlig ikke for transform-pulsen. Hvis det trengs for outline-clip, prøv `position: relative` uten z-index først.

(b) **Eller flytt one-to-go-pulsen til en pseudo-element-overlay** (f.eks. `::after`) i stedet for å pulse cellen selv. Da unngås stacking-context på selve grid-cellen.

(c) **Eller fjern infinite-pulsen helt** — Bong.jsx-port valgte å kommunisere "one-to-go" via outline + farge, mens transform-pulsen var ekstra liv-signal. Outline + farge er statisk og blink-fri. Vurder om visuell pulsering er essensiell.

**Status:** Delvis adressert i PR #492 (4-lags box-shadow fjernet), men `transform: scale` + `z-index: 1` gjenstår.

---

### KANDIDAT #4 — MEDIUM PRIORITET

**`amountEl` dual-animation (text-in + amount-glow) i WinPopup forblir aktiv under runden**

**Lokasjon:** `packages/game-client/src/games/game1/components/WinPopup.ts:186-197`

```ts
const amountEl = document.createElement("div");
amountEl.textContent = `${amountFormatted} kr`;
Object.assign(amountEl.style, {
  // ...
  marginBottom: shared ? "16px" : "32px",
  animation: "wp-amount-glow 2.4s ease-in-out infinite",
});
```

**Hvorfor det blinker:**

WinPopup vises 4 sekunder etter fase-vinn (PR #493 endret 3s→4s). Under denne perioden kjører `wp-amount-glow` som animerer `text-shadow` infinite — text-shadow er **paint-property**, ikke composite-bar. Dette er en kontinuerlig paint-trafikk over et lite område, men samtidig som Pixi render-loop kjører.

**Foreslått fix:**

(a) Endre fra `infinite` til begrenset iteration-count (4-5 sykluser, 4 sek total).
(b) Eller bytt ut `text-shadow`-animasjon med `filter: drop-shadow` som er composite-bar.

**Status:** GJENSTÅR. Lite vindu (4 sek) men paint-tung.

---

### KANDIDAT #5 — MEDIUM PRIORITET

**`PatternMiniGrid.startPhaseCycleAnimation` `setInterval(step, 1000)` muterer DOM hver sekund**

**Lokasjon:** `packages/game-client/src/games/game1/components/PatternMiniGrid.ts:198-204`

```ts
const step = () => {
  this.highlightLines(combinations[stepIndex % combinations.length]);
  stepIndex++;
};
step();
this.animationTimer = setInterval(step, 1000);
```

**Hvorfor det blinker:**

Hver sekund kjører `highlightLines` som kan endre opp til 25 celler' classList. Selv med diff-gating (kun celler som faktisk bytter state får classList-toggle) er det fortsatt:
- 1-15 cells/sec klassetoggles (avhenger av fase)
- Hver toggle invalideres av Chrome's accessibility tree
- Sammenfaller med backend `room:update` (som også fyrer ~hver 1.2s)

**Foreslått fix:**

(a) Bruk `requestAnimationFrame`-basert timing slik at oppdateringer skjer på frame-grenser (mindre sjanse for race med Pixi-render-cycle).
(b) Eller gå over til CSS-only sweep — definér 5-10 keyframes der `background-position` flyttes gradvis, så cellen kan animeres uten DOM-write hvert sekund.

**Status:** GJENSTÅR. Lavprio fordi diff-gate har redusert volumet betraktelig (PR #493).

---

### KANDIDAT #6 — MEDIUM PRIORITET

**Toast-notifikasjon-overlay + transition under hver phase-won**

**Lokasjon:** `packages/game-client/src/games/game1/components/ToastNotification.ts:64-65, 110-113`

```ts
Object.assign(el.style, {
  // ...
  opacity: "0",
  transform: "translateY(-10px)",
  transition: "opacity 0.3s, transform 0.3s",
});

private dismiss(el: HTMLDivElement): void {
  el.style.opacity = "0";
  el.style.transform = "translateY(-10px)";
  setTimeout(() => this.removeEl(el), 300);
}
```

**Hvorfor det blinker:**

Game1Controller fyrer en toast på hver `patternWon` (`Rad 1 er vunnet`, etc.). Toasten har et 0.3s transition på opacity + transform. Dismiss-koden setter opacity=0 og transform=-10px, og removeEl etter 300ms via setTimeout.

Når flere phaseWon kommer tett (Rad 1 + Rad 2 om kort tid), kan flere toasts være aktive samtidig. Hver er et HTML-element over Pixi-canvas med `boxShadow: 0 4px 16px rgba(0,0,0,0.4)` (paint-property).

**Foreslått fix:**

(a) Rydd inn box-shadow → flat solid background uten shadow.
(b) Vurder om toast er nødvendig — patternMessage er allerede synlig i CenterTopPanel via `pattern-won-flash`.

**Status:** GJENSTÅR.

---

### KANDIDAT #7 — MEDIUM PRIORITET

**`buildElvisBanner` re-create på hver `loadTicket` (potensiell mid-round)**

**Lokasjon:** `packages/game-client/src/games/game1/components/BingoTicketHtml.ts:222-236`

```ts
private syncElvisBanner(): void {
  const existing = this.front.querySelector(".ticket-elvis-banner");
  // ...
  } else if (shouldHave && existing) {
    // Refresh banner (bilde/label kan ha endret seg ved variant-swap).
    const replacement = this.buildElvisBanner();
    existing.replaceWith(replacement);
  }
}
```

**Hvorfor det blinker:**

Hver gang `loadTicket(ticket)` kalles på en eksisterende Elvis-bong rives banner-noden ned og bygges på nytt — selv om bilde/label er identisk. På Elvis-runder med ticket:replace under runden vil dette skje pr replace-event.

**Foreslått fix:**

Compare ticket.color-banner-keys mot eksisterende. Skip rebuild hvis identisk.

**Status:** GJENSTÅR. Lav frekvens (ikke per draw, kun per replace), men inkluderer img-decoding.

---

### KANDIDAT #8 — LAV PRIORITET

**`fountain` rAF-loop i WinScreenV2 muterer DOM hver frame**

**Lokasjon:** `packages/game-client/src/games/game1/components/WinScreenV2.ts:423-446`

```ts
private startFountain(particleNodes): void {
  // ...
  const tick = (now: number): void => {
    for (const { node, particle: p } of particleNodes) {
      // ...
      node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;
      node.style.opacity = String(opacity);
    }
    this.rafId = requestAnimationFrame(tick);
  };
  this.rafId = requestAnimationFrame(tick);
}
```

**Hvorfor det blinker:**

70 partikler får inline-style mutasjoner hver frame i FOSS_DURATION_MS (3.6 sek). Dette er en eksplisitt rAF-loop som konkurrerer med Pixi-render-cycle. Men: skjer kun ved Fullt Hus-vinn, så ikke en hovedmistanke for 1/90s blink.

**Foreslått fix:**

Vurder å bruke CSS-keyframes med pre-computed banner-attributes på hver partikkel. Mer komplekst, men fjerner rAF-konkurranse.

**Status:** GJENSTÅR. Lav prio fordi hendelsen er sjelden.

---

### KANDIDAT #9 — LAV PRIORITET

**`MysteryGameOverlay.startRoundTimer` setInterval(1000) muterer Pixi Text**

**Lokasjon:** `packages/game-client/src/games/game1/components/MysteryGameOverlay.ts:680-697`

```ts
this.autoTimer = setInterval(() => {
  this.autoCountdown -= 1;
  if (this.autoCountdown <= 0) {
    this.clearAutoTimer();
    this.timerText.text = "";
    this.selectDirection("down");
  } else {
    this.timerText.text = `Auto-valg om ${this.autoCountdown}s`;
  }
}, 1000);
```

**Hvorfor det blinker:**

Pixi `Text.text =` triggrer Pixi-side text-rebuild (re-rasterize glyph cache). 1/sek under MysteryGame-overlayen. Men: kun aktiv mens overlayen er synlig (mini-game), ikke hele tiden.

**Foreslått fix:**

Ingen direkte fix nødvendig — frekvensen er lav nok. Hvis Pixi-text-rebuild merkes, vurder å vise countdown via HTML overlay i stedet.

**Status:** GJENSTÅR. Antatt ikke en hovedkilde til 1/90s blink.

---

## §3 Anbefalt fix-rekkefølge

For å målrette de mest sannsynlige årsakene til 1/90s blinking, anbefales:

### Steg 1 (KANDIDAT #1, #2, #3) — én PR

Tre fix som angriper composite-layer + paint-trafikk:

**1.1** Begrens `transform-style: preserve-3d` på `BingoTicketHtml.inner` til kun under aktiv flip (samme strategi som PR #492 brukte for `perspective`).

**1.2** Fjern `transition: background 0.12s, color 0.12s` fra grid-celler i `BingoTicketHtml.buildCells`.

**1.3** Fjern `z-index: 1` (og evaluér om `position: relative`) fra `.bong-pulse` i `BingoTicketHtml.ensureBongStyles`.

**Forventet effekt:** Hvis 1/90s blink skyldes layer-eviction eller paint-storm, bør det forsvinne. Hvis ikke, har vi minst eliminert 750+ paint-events per draw og noen permanent composite-layers.

### Steg 2 — verifisér med Tobias

Be Tobias kjøre 10 minutters gaming-session med:
- `?diag=blink` for BlinkDiagnostic-panel + visuell flash
- `?perfhud=1` for FPS/Paint/BF-count

Hvis blink-frekvens er redusert (<1 per 5 min): success.
Hvis fortsatt 1/90s: gå til Steg 3.

### Steg 3 (KANDIDAT #4, #5, #6) — sekundær fix-PR

Hvis Steg 1 ikke løste det, gå løs på paint-trafikk-kilder:
- WinPopup `wp-amount-glow` infinite text-shadow (begrens iteration)
- PatternMiniGrid setInterval (vurder rAF eller CSS-only)
- Toast box-shadow (flat ut)

### Steg 4 — hvis fortsatt problem

Aktiver "BF count > 0" logging i prod fra `PerfHud` for å fange regressions in real-time. Bygg ut diagnostic for compositing-layers (heuristikk i `PerfHud` — den `Layers`-metric'en).

## §4 Diagnostisk strategi for å bekrefte

For hver kandidat, anbefalt verifisering:

### Kandidat #1 (preserve-3d composite-layers)

**Reproduksjonssteg:**
1. Åpne Chrome DevTools → Rendering-pane.
2. Aktivér "Layer borders" og "Compositor frame visualizer".
3. Spill Spill 1 i 5 min, observer om det er 30 ekstra layers under bong-grid (en per bong's `inner`-element).
4. Aktivér "Show paint flashing" — hvis bong-områder flasher i grønt, bekrefter det re-paint-trafikk.

### Kandidat #2 (transition på celler)

**Reproduksjonssteg:**
1. Åpne med `?diag=blink`.
2. Etter ball-draw: se i panel om `transitionstart:background-color` events teller opp 15-30 per draw.
3. Hvis ja, bekreftelse på hazard.

### Kandidat #3 (one-to-go infinite)

**Reproduksjonssteg:**
1. Spill til late-game (mange one-to-go).
2. Chrome DevTools → Performance → Record 10s.
3. Se etter "Composite Layers" eller "Update Layer Tree" entries hyppig.
4. Hvis mange entries (> 30/sek), bekrefter z-index/stacking-context-issue.

### Kandidat #4-#9

Tilsvarende — bruk PerfHud "Paints/s" og "Layers" som grunn-baseline før/etter hver fix.

## §5 Hvis ingen av §2-kandidatene fikser det

Backup-plan: Installér mer aggressiv diagnostikk.

### Plan A — sub-pixel diagnostic

Skriv en ny `BlinkDiagnostic`-modus som:
1. Tar et screenshot av Pixi-canvas hvert 100ms.
2. Sammenligner pixel-buffer mellom konsekutive frames.
3. Logger spesifikt hvilke regioner (bbox) som har endret seg uten at det var en planlagt animasjon.

Kan implementeres ved å lese Pixi `.app.canvas` via `getImageData` og diff'e. Tung, men eliminerer all gjetting.

### Plan B — GPU memory pressure-monitor

Bruk `performance.measureMemory()` (Chrome) eller `performance.memory` for å se om JS heap eller GPU memory wobble korrelerer med blink. 1/90s frekvens kan være en garbage-collection-cycle.

### Plan C — overlay-isolation-test

Slå AV én HTML-overlay om gangen og se om blink forsvinner:
1. Slå AV chat-panel — fortsatt blink? Hvis nei: chat-panel er kilden.
2. Slå AV center-top-panel — fortsatt blink? Hvis nei: center-top.
3. Slå AV ticket-grid — fortsatt blink? Hvis nei: grid.
4. Slå AV bonger én og én — finn om det er ANTALL bonger eller en enkelt-bong-egenskap.

Manuell A/B-test, men dekker alt vi ikke har sett etter.

### Plan D — Pixi-renderer-mode

Hvis ingen overlay er kilden, vurder om Pixi-renderer selv kan blinke. Pixi.js v8 har egen WebGL2-renderer som kan ha bugs i context-restore-håndtering. Gå over `WebGLContextGuard.ts` og se om `restored`-events fyres uplanlagt.

## §6 Anbefalt next-step

**Implementer Steg 1 (KANDIDAT #1, #2, #3) som én PR** med følgende:
- Fjern `transform-style: preserve-3d` permanent på `BingoTicketHtml.inner` → aktivere kun under flip.
- Fjern `transition: background 0.12s, color 0.12s` fra grid-celler.
- Fjern `z-index: 1` fra `.bong-pulse`.
- Legg til 3 regresjonstester i `__tests__/no-backdrop-filter-regression.test.ts` (eller egen test-fil) som låser inn:
  - `inner.style.transformStyle !== "preserve-3d"` ved default-state.
  - `cell.style.transition === ""` ved default-state.
  - `.bong-pulse` CSS inneholder ikke `z-index: 1`.

Tobias bekrefter via 10-min gaming-session med `?diag=blink&perfhud=1`. Hvis blink-frekvens redusert til < 1 per 5 min: success.

---

**Kjernepoeng:** Vi har vært gjennom 4 fix-runder, og vi ser at hovedmønsteret er at hver runde har fjernet hovedkilden, men neste-størst igjen. Runde 5-kandidatene er svakere enn rundene 1-4, men kan fortsatt være kilden til 1/90s — vi må verifisere empirisk med BlinkDiagnostic + PerfHud før vi gir opp.
