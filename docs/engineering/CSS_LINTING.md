# CSS linting — blink-hazards

## TL;DR

Dette repoet har en custom stylelint-plugin som fanger CSS-mønstre som
tidligere har forårsaket visuelle regresjoner (flimmer/blink) i
HTML-overlays over Pixi-canvas i Game 1. Alle CSS- og CSS-in-JS-endringer
må passere linting før commit (pre-commit hook) og i CI.

- **CSS-regler:** 4 custom stylelint-regler, se [Regler](#regler) nedenfor.
- **CSS-in-JS:** grep-basert scanner (`scripts/stylelint-rules/lint-no-backdrop-js.mjs`).
- **Pre-commit:** husky + lint-staged kjører stylelint + JS-scan på hvert commit.
- **CI:** `.github/workflows/stylelint.yml` kjører samme sjekker på hver PR.

Se også [`packages/game-client/src/games/game1/ARCHITECTURE.md`](../../packages/game-client/src/games/game1/ARCHITECTURE.md)
for bakgrunn på hvorfor disse reglene finnes (PR #468, 2026-04-24).

## Regler

### no-backdrop-filter {#no-backdrop-filter}

Stylelint-regel `plugin/no-backdrop-filter-without-allowlist`.

**Hva den fanger:** `backdrop-filter: <ikke-none>` på en selector som ikke
er i allowlist.

**Hvorfor:** Pixi-canvas rendrer kontinuerlig (60-120+ fps). HTML-elementer
over canvas med `backdrop-filter: blur(X)` tvinger GPU til å re-kjøre
blur-shader for regionen *per Pixi-frame*, hvilket gir synlig flimmer.

**Allowlist (i `.stylelintrc.json`):**

```json
{
  "plugin/no-backdrop-filter-without-allowlist": [
    true,
    {
      "allowedSelectors": [
        ".popup-backdrop",
        ".modal-backdrop",
        ".dialog-overlay",
        ".g1-overlay-root > div[data-backdrop]",
        ".spillvett-card",
        ".spillvett-drawer",
        ".mandatory-pause-modal"
      ]
    }
  ]
}
```

Allowlist gjelder både eksakt match og descendant-kombinator
(`.modal .popup-backdrop` er OK).

**Fix:** Bruk solid semi-transparent bakgrunn (alpha ≥ 0.85):

```css
/* IKKE */
.prize-pill { backdrop-filter: blur(6px); background: rgba(120, 20, 20, 0.4); }

/* GJØR */
.prize-pill { background: rgba(30, 12, 12, 0.92); }
```

### no-transition-all {#no-transition-all}

Stylelint-regel `plugin/no-transition-all`.

**Hva den fanger:** `transition: all <duration>` eller `transition-property: all`.

**Hvorfor:** `all` transiterer på alle endrede properties, inkl.
layout/paint-properties som skaper uforutsette re-layouts og flimmer
når CSS-tokens endres dynamisk.

**Fix:** Spesifiser eksakte properties:

```css
/* IKKE */
.btn { transition: all 0.3s ease; }

/* GJØR */
.btn { transition: opacity 0.3s, transform 0.3s; }
```

### animation-iteration-whitelist {#animation-iteration-whitelist}

Stylelint-regel `plugin/animation-iteration-whitelist`.

**Hva den fanger:** `animation: ... infinite` eller
`animation-iteration-count: infinite` hvor `animation-name` ikke er i
allowlist.

**Hvorfor:** Infinite-animasjoner over Pixi-canvas koster GPU-ressurser
*per frame*. Vi vil vite bevisst om hver infinite-animasjon som kjører.

**Allowlist (`allowedNames`):**

- `pattern-sweep`
- `pattern-won-flash`
- `ball-spin`
- `ball-bounce`
- `tv-active-pattern-pulse` (TV-skjerm i admin-web — ikke over Pixi)

**Hvordan legge til en ny animasjon:** Krever review av teamet. Åpne PR
med:
1. Endring i `.stylelintrc.json > allowedNames`.
2. Navngitt animation-name (ingen anonyme infinite-animasjoner).
3. Begrunnelse i PR-beskrivelsen for hvorfor den må være infinite.
4. Plasserings-kontekst — er den over Pixi-canvas eller ikke?

### will-change-whitelist {#will-change-whitelist}

Stylelint-regel `plugin/will-change-whitelist`.

**Hva den fanger:** `will-change: X` hvor X ikke er `transform`, `opacity`,
eller i allowlist.

**Hvorfor:** `will-change` tvinger browseren til å lage separate
komposit-lag. Bare `transform` og `opacity` kan komposites GPU-billig;
alt annet (f.eks. `left`, `background`, `filter`) får dyrt paint.

**Fix:** Bruk bare `transform` eller `opacity`:

```css
/* IKKE */
.panel { will-change: left, background; }

/* GJØR */
.panel { will-change: transform, opacity; }
```

Hvis du *må* ha et annet property, legg til i allowlist med PR-review.

## CSS-in-JS scanning

Stylelint scanner ikke TypeScript-filer. Men spillklienten setter
inline-styler via `Object.assign(el.style, { backdropFilter: "blur(...)" })`
og template-strenger. Dette fanges av:

```
scripts/stylelint-rules/lint-no-backdrop-js.mjs
```

Scriptet grep-scanner `.ts`/`.tsx`/`.mts` i:

- `packages/game-client/src`
- `apps/admin-web/src`

Og feiler på `backdropFilter` eller `-webkit-backdrop-filter` som
*ikke* er:

1. I en fil i ALLOWED_FILES (popup-backdrops), eller
2. Foregått av en `// lint-no-backdrop-js: <begrunnelse>` kommentar.

Tillatte filer (popup-backdrops, Pixi maskert bak popup):

- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts`
- `packages/game-client/src/games/game1/components/WinPopup.ts`
- `packages/game-client/src/games/game1/components/LuckyNumberPicker.ts`
- `packages/game-client/src/games/game1/components/CalledNumbersOverlay.ts`

## Kommandoer

```bash
# Kjør stylelint på alle CSS-filer
npm run lint:css

# Kjør CSS-in-JS-scanner
npm run lint:no-backdrop-js

# Kjør begge (det pre-commit + CI kjører)
npm run lint:blink

# Kjør test-suite for selve plugin-reglene
npm run test:stylelint
```

## Disabler regel lokalt

I **CSS-filer**, bruk stylelint disable-kommentar:

```css
/* stylelint-disable-next-line plugin/no-backdrop-filter-without-allowlist
   -- BEGRUNNELSE: Element er utenfor Pixi-kontekst (admin settings modal). */
.some-class { backdrop-filter: blur(6px); }
```

Disabler uten `-- BEGRUNNELSE:` skal ikke merges. Code review må kreve en
konkret forklaring for hvorfor regelen ikke gjelder i dette tilfellet.

I **TypeScript/CSS-in-JS**, bruk escape-kommentar (én-linje):

```ts
// lint-no-backdrop-js: Short-lived popup backdrop, Pixi masked behind.
Object.assign(el.style, { backdropFilter: "blur(6px)" });
```

## Integrasjoner

### Pre-commit hook (husky + lint-staged)

Installert automatisk via `npm install` (prepare-script kjører
`husky && node scripts/setup-husky.mjs`).

Konfigurasjon i `package.json`:

```json
{
  "lint-staged": {
    "**/*.css": "stylelint --fix",
    "**/*.{ts,tsx,mts,cts}": "bash -c 'npm run --silent lint:no-backdrop-js'"
  }
}
```

Hook-scriptet (`.husky/pre-commit`) kaller `npx lint-staged`.

**Bypass (nødfall, krever begrunnelse):**

```bash
git commit --no-verify -m "fix(urgent): <begrunnelse for bypass>"
```

### CI workflow

`.github/workflows/stylelint.yml` kjører på hver PR og push til main:

1. `npm ci`
2. `npm run lint:css` (stylelint på CSS)
3. `npm run lint:no-backdrop-js` (CSS-in-JS-scan)
4. `npm run test:stylelint` (selve plugin-testene)

Jobben feiler PR-en hvis noen av disse slår til.

## Testing

Test-suite (node:test, innebygd i Node 22+):

```
scripts/stylelint-rules/__tests__/no-backdrop-filter.test.mjs
```

Dekker alle 4 regler + CSS-in-JS-scanneren med 23 test-caser. Kjør:

```bash
npm run test:stylelint
```

## Historikk

- **2026-04-24 — Spor 4 etablert.** Etter PR #468 fjernet
  backdrop-filter fra 12 UI-elementer over Pixi-canvas. Denne
  stylelint-pluginen skal hindre at regresjonen reintroduseres.
- **Tidligere:** Se
  [`packages/game-client/src/games/game1/ARCHITECTURE.md`](../../packages/game-client/src/games/game1/ARCHITECTURE.md)
  for blink-historikken.
