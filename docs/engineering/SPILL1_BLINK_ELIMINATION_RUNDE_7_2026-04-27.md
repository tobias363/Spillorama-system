# Spill 1 — Blink Elimination Runde 7

**Dato:** 2026-04-27
**Forfatter:** Blink Fix Agent runde 7
**Status:** Implementert — `fix/blink-mandatory-pause-modal`
**Foregående runder:** PR #468 (backdrop-filter), #491 (CenterBall idle-tween), #492 (4 composite-hazards), #493 (text-memoize + popup-timing), #529 (preserve-3d + bg/color-trans + pulse z-index), #530 (BuyPopup paint-property transitions), #532 (rAF-gates + memoize)

## TL;DR

Bruker rapporterte blink på **Obligatorisk spillepause-popupen** (§ 66 mandatory play-break). Skjermbilde viser modal med 02:52 countdown og "Du har spilt i 1 time. Loven krever at du tar en pause på 5 minutter".

Fant 4 hazards i `apps/backend/public/web/spillvett.js` + `spillvett.css`. Implementert fixes etter samme pattern som runde 5/6:

- **Memoize textContent-writes** (countdown, loss, playtime, gamecount) — 5 cached values + `_setIfChanged`-helper.
- **Skip setInterval-restart** når `blockedUntil` ikke har endret seg (tidligere `clear+set` på hver render() = 12+ ganger).
- **Halver tick-frekvens** fra 500ms → 1000ms (countdown viser MM:SS, ikke MS).
- **Drop `backdrop-filter: blur(8px)`** fra modal-overlay — paint-property-recompute over Pixi-backdrop var hovedmistanke.

7 nye node-tester (alle grønne).

## §1 Modal-lokasjon

| Komponent | Fil | Linjer |
|---|---|---|
| HTML markup | `apps/backend/public/web/index.html` | 2562-2585 |
| CSS styling | `apps/backend/public/web/spillvett.css` | 431-518 |
| JS lifecycle | `apps/backend/public/web/spillvett.js` | 740-849 (etter fix) |

Modalen rendres når `compliance.restrictions.isBlocked && blockedBy === "MANDATORY_PAUSE"`. `renderMandatoryPauseModal()` kalles fra `render()` som fyrer fra **12+ kallsteder** (socket-events, refreshData, hall-bytte, period-toggle, inline-error-set/clear, m.m.).

## §2 Hazards funnet

### Hazard #BLINK-MP-1 — `setInterval(500ms)` skriver `textContent` hver halve sekund

**Lokasjon:** `spillvett.js:779-795` (før fix)

**Problem:** Countdown viser bare MM:SS-tekst som endrer seg én gang per sekund. Men intervallet fyrer to ganger per sekund og skriver til `textContent` hver gang — selv når verdien er identisk med forrige write. Hver write trigger paint av countdown-elementet (et `52px font-weight: 800` element med `tabular-nums`).

### Hazard #BLINK-MP-2 — Stats re-skrives på hver `render()`

**Lokasjon:** `spillvett.js:761-773` (før fix)

**Problem:** Stat-verdiene (loss, playtime, gamecount) re-skrives uten endringssjekk hver gang `render()` kjører. `render()` triggers fra 12+ kallsteder. Resultat: vedvarende stat-element-paint hver gang en socket-event eller hall-bytte fyrer.

### Hazard #BLINK-MP-3 — `setInterval` clear+restart på hver `render()`

**Lokasjon:** `spillvett.js:776-778` (før fix)

**Problem:** Når modalen er synlig, ble `_pauseCountdownInterval` clearet og restartet på hver `render()`-kall. Dette gir to symptomer:

1. **Timing-jitter**: ny interval-fase landet ofte mid-frame relativt til Pixi-render-cyclen. DOM-mutasjon på en mid-frame-grense konkurrerer med Pixi-canvas for compositing.
2. **Sløsing**: opp til 12+ restart per render-pulse betyr ekstra GC + clock-resynkronisering.

### Hazard #BLINK-MP-4 — `backdrop-filter: blur(8px)` over Pixi-canvas

**Lokasjon:** `spillvett.css:441` (før fix)

**Problem:** `backdrop-filter: blur(8px)` på et fixed-position element som dekker hele viewport (inset:0) er en av de dyreste paint-operasjonene en browser kan utføre — for hver compositing-pass må GPU re-blur alt bak overlayet (Pixi-canvas, ticket-grid, Spillvett-FAB osv.).

Når Pixi-canvas eller andre layers re-promoterer composite-tre (vinner-popup, score-update, mini-game-overlay), ble backdrop-blur recomputert. Det er klassisk hazard for periodisk blink.

## §3 Fix-pattern

Brukt samme tilnærming som runde 5 (`PatternMiniGrid`-memoize) og runde 6 (`BingoTicketHtml`-memoize):

### Fix #1 — Memoize text-writes

```javascript
// Cache-felt
let _pauseLastCountdownText = null;
let _pauseLastLossText = null;
let _pauseLastPlaytimeText = null;
let _pauseLastGamecountText = null;

// Helper
function _setIfChanged(el, nextText, lastValue) {
  if (!el) return lastValue;
  if (lastValue === nextText) return lastValue;
  el.textContent = nextText;
  return nextText;
}

// Bruk
_pauseLastLossText = _setIfChanged(
  els.mandatoryPauseLoss,
  formatCurrency(loss),
  _pauseLastLossText
);
```

Gevinsten: 12+ render()-call-paths skriver ikke lenger til DOM på modal-elementer. Kun reelle endringer (faktisk countdown-tick eller stat-update) trigger paint.

### Fix #2 — Gate interval-restart bak blockedUntil-endring

```javascript
let _pauseLastBlockedUntilEpoch = 0;

const blockedUntilEpoch = r.blockedUntil ? new Date(r.blockedUntil).getTime() : 0;

if (blockedUntilEpoch !== _pauseLastBlockedUntilEpoch) {
  _pauseLastBlockedUntilEpoch = blockedUntilEpoch;
  if (_pauseCountdownInterval) {
    clearInterval(_pauseCountdownInterval);
    _pauseCountdownInterval = null;
  }
  tickCountdown(); // Synkron første tick — unngå blink-vindu
  if (blockedUntilEpoch > Date.now()) {
    _pauseCountdownInterval = setInterval(tickCountdown, 1000);
  }
}
```

`render()` kan nå kalles ubegrenset uten at intervallet restartes. Restart skjer kun når backenden faktisk forlenger eller starter en ny pause.

### Fix #3 — 1000ms tick-frekvens

500ms → 1000ms. Halverer DOM-mutasjonsfrekvensen siden countdown bare viser sekund-presisjon.

### Fix #4 — Drop backdrop-filter

```css
/* Før */
background: rgba(0, 0, 0, 0.85);
backdrop-filter: blur(8px);

/* Etter */
background: rgba(0, 0, 0, 0.92);
```

Bevarer visuelt fokus (mørkere bakgrunn) uten GPU-blur-cost. 0.92 alpha er nok til at modalen står sterkt ut uten å skjule lobby-trekk helt.

## §4 Verifisering

### Tester lagt til (7 nye)

`apps/backend/src/compliance/MandatoryPauseModalBlink.test.ts`:

1. `renderMandatoryPauseModal har memoize-state-variabler for textContent-writes`
2. `_setIfChanged-helper finnes og tester ulikhet før textContent-write`
3. `countdown bruker _setIfChanged (ingen rå tickCountdown-write)`
4. `setInterval restart kun når blockedUntil endrer seg`
5. `countdown-tick-frekvens er 1000ms (ikke 500ms)`
6. `.mandatory-pause-modal har IKKE backdrop-filter`
7. `cleanup-greinen resetter alle memoize-state-felt`

```
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 368
```

### Manuell verifisering

Modal kan trigges lokalt ved å sette `compliance.restrictions = { isBlocked: true, blockedBy: "MANDATORY_PAUSE", blockedUntil: <ISO> }` mot Spillvett-shell-state. Visuelt skal det ikke være pixel-bevegelse i modal-elementene mens countdown står stille.

## §5 Forventet effekt

Tobias rapporterte blink på selve modal-skjermen. De 4 hazards spenner over alle de mest sannsynlige årsaker:

1. **Backdrop-filter-recompute**: hovedmistanke, særlig når Pixi-canvas re-promoterer compositing-tre.
2. **Stats-re-write 12+ ganger på render()-pulse**: stat-elementene har solid background og box-shadow på modal-card, så hver paint er ikke trivielt billig.
3. **Countdown 2× DOM-write/sek**: gjentatt write på 52px-element med tabular-nums = re-glyph-rasterize.
4. **Interval-restart-jitter**: timing-konflikt med Pixi-frame-grenser.

Hvis blink fortsatt forekommer etter denne fix-en: gjenstående kandidater (Plan B for runde 8):

- **Pixi-canvas-pause når modal er åpen** — modalen er en state hvor spilleren ikke kan gjøre noe; mest naturlig optimalisering er å pause Pixi-ticker. Krever kobling fra `renderMandatoryPauseModal` til Pixi-Application-state, som ikke er trivielt på tvers av spillvett.js (vanilla JS) og packages/game-client (Pixi).
- **Modal-card box-shadow** (`spillvett.css:457`): `0 8px 40px rgba(0,0,0,0.6)` — stor blur-radius. Hvis blink henger igjen kan vi flate ut til `0 4px 16px rgba(0,0,0,0.4)`.

## §6 Lignende modaler oppdaget

Sjekket andre modaler i public/web for samme pattern:

- **Drawer** (`spillvett.css:204-218`): har `backdrop-filter: blur(18px)` på `.spillvett-card,.spillvett-drawer`. Drawer er ikke alltid synlig — kun når brukeren åpner Spillvett-FAB. **Hvis brukeren rapporterer blink på drawer/FAB-flow også: samme fix-pattern.** Ikke fikset i denne PR-en for å holde scope minimalt.
- **Candy iframe overlay** (`spillvett.css:352-363`): solid `#060a18` background, ingen backdrop-filter. OK.
- **Hall-popup / login-overlay**: ingen backdrop-filter funnet. OK.

## §7 Filer endret

| Fil | Lines | Type |
|---|---|---|
| `apps/backend/public/web/spillvett.js` | +84 −31 | Memoize + interval-gate |
| `apps/backend/public/web/spillvett.css` | +9 −2 | Drop backdrop-filter |
| `apps/backend/src/compliance/MandatoryPauseModalBlink.test.ts` (ny) | +142 | 7 tester |
| `docs/engineering/SPILL1_BLINK_ELIMINATION_RUNDE_7_2026-04-27.md` (ny) | denne | Dokumentasjon |

**Totalt:** 2 filer modifisert + 2 nye filer.
