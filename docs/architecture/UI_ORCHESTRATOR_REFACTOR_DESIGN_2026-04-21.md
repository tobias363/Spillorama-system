# UIOrchestrator-refactor (audit-funn #7)

**Status:** DESIGN godkjent av PM 2026-04-21. Implementering stand-by post-pilot (etter PR 4d + 4e).
**Branch:** `claude/hardcore-ardinghelli-257cc9`
**Scope:** `packages/game-client/src/games/game1/Game1Controller.ts` + 7 overlays.
**Ikke-scope:** nye features, cross-game-abstraksjon (Spill 2/3). Kun ansvar-flytting.

---

## 1. Problem

`Game1Controller.start()` instansierer 7 DOM-overlays direkte (linje 71–83, 179) og eier lifecycle + interaksjon. Dette tvinger controller-tester inn i happy-dom, kobler phase-maskin til UI-state (`pauseOverlay.isShowing()`-spørring linje 308), og lar toast-timing-konstanter lekke inn i domene-koden. Eksisterende tester (`Game1Controller.claim.test.ts` m.fl.) unngår problemet ved å duplisere controller-logikk i harness-funksjoner — bevis på at problemet er reelt.

## 2. UIOrchestrator-interface (full signatur)

```ts
// packages/game-client/src/games/game1/ui/UIOrchestrator.ts
import type { LoadingState } from "../../../components/LoadingOverlay.js";
import type { Game1Settings } from "../components/SettingsPanel.js";
import type { ScheduleSlot } from "../components/GamePlanPanel.js";

export interface UIOrchestrator {
  // ── Loader (LoadingOverlay) ─────────────────────────────────────────
  // Bevarer BIN-673 state-maskin. Ikke flat show/hide.
  setLoaderState(state: LoadingState, customMessage?: string): void;
  isLoaderVisible(): boolean;

  // ── Toast (ToastNotification) ───────────────────────────────────────
  toastInfo(message: string, durationMs?: number): void;
  toastWin(message: string, durationMs?: number): void;
  toastError(message: string, durationMs?: number): void;

  // ── Pause (PauseOverlay) ────────────────────────────────────────────
  // Idempotent. Controller eier wasPaused-flag og kaller setPaused(true/false).
  setPaused(paused: boolean, message?: string): void;

  // ── Settings (SettingsPanel) ────────────────────────────────────────
  showSettings(): void;
  getSettings(): Game1Settings;
  onSettingsChange(cb: (settings: Game1Settings) => void): void;

  // ── Marker/Background (MarkerBackgroundPanel) ───────────────────────
  showMarkerBackground(): void;
  onMarkerChange(cb: (id: number) => void): void;
  onBackgroundChange(cb: (id: number) => void): void;

  // ── Game plan (GamePlanPanel) ───────────────────────────────────────
  showGamePlan(hallId: string, apiBase: string): Promise<void>;
  onGamePlanBuy(cb: (slot: ScheduleSlot) => void): void;

  // ── Lucky number (LuckyNumberPicker) ────────────────────────────────
  showLuckyPicker(currentLucky: number | null): void;
  hideLuckyPicker(): void;
  onLuckySelect(cb: (n: number) => void): void;

  // ── Lifecycle ───────────────────────────────────────────────────────
  destroy(): void;
}
```

**Designvalg:**
- Event-callbacks (`onXxx`) settes én gang av controller etter konstruksjon — matcher eksisterende `setOnChange`-mønster og unngår EventEmitter-avhengighet.
- `isLoaderVisible()` + `getSettings()` er nødvendige query-metoder (brukt hhv. i reconnect-barriere og audio-sync).
- `setPaused(bool)` eier toast-"Spillet er gjenopptatt" internt? **Åpent spørsmål** — se §7.
- `hideLuckyPicker()` eksponeres fordi `onGameStarted` kaller `luckyPicker?.hide()` uavhengig av brukerinteraksjon.

## 3. Implementasjoner

**`Game1UIOrchestrator`** (produksjon) — wrapper de 7 overlay-klassene, eier `overlayContainer`, delegerer. ~150 LOC.

**`FakeUIOrchestrator`** (test-fixture) — spy-registrerer alle kall som `{method, args}[]`. ~80 LOC. Plasseres i `packages/game-client/src/games/game1/ui/__fixtures__/FakeUIOrchestrator.ts` — gjenbrukes av claim/patternWon/reconnect-tester.

## 4. Migrasjonstrinn (commit-rekkefølge)

| # | Commit | Scope | Regresjonsrisiko |
|---|--------|-------|-------|
| 1 | Add `UIOrchestrator` interface + `Game1UIOrchestrator` impl (ikke brukt ennå) + `FakeUIOrchestrator` fixture | Ren additiv — ingen endring i kjørende kode | None |
| 2 | `Game1Controller` constructor tar `ui: UIOrchestrator` som 2. deps-param (default: new Game1UIOrchestrator for backward compat). Bytt ut `this.loader`/`this.toast`/`this.pauseOverlay`-felt med kall til `this.ui.*`. | Alle overlay-kall rutes, men samme klasser under panseret | Low (ren refactor uten endret DOM) |
| 3 | Bytt ut `SettingsPanel`, `MarkerBackgroundPanel`, `GamePlanPanel` (tre "show + callback"-paneler) | Lik mønster, lavere blast radius | Low |
| 4 | `LuckyNumberPicker` + pause-flag (`wasPaused`-eier hos controller) | Pause-toast-semantikk endres litt — se §5 | Medium |
| 5 | Konverter `Game1Controller.claim.test.ts`/`patternWon.test.ts`/`reconnect.test.ts` til å instansiere ekte controller med `FakeUIOrchestrator` (fjern harness-dupli) | Tester blir sterkere, ikke svakere | Low (tester verifiserer seg selv) |

Hvert trinn kjører full `packages/game-client/src/games/game1/` testsuite (236+ tester) før neste commit.

## 5. Risikovurdering per overlay

| Overlay | z-index | Timing-nyanse | Risiko |
|---------|---------|---------------|--------|
| LoadingOverlay | 100 | 5s stuck-timer (BIN-673), `isShowing()` brukt som reconnect-gate | **Høy** — feil sekvens kan skjule reload-knapp eller miste reconnect-trigger |
| PauseOverlay | 90 | `isShowing()`-spørring i `onStateChanged` må bort | **Medium** — Krev idempotent `setPaused()` + `wasPaused`-flag i controller |
| ToastNotification | 80 | queue max 3, 300ms fade-out, `pre-line` linjeskift | **Lav** — ren fire-and-forget API |
| SettingsPanel | 70 | localStorage-sync, `onChange` → `syncSettingsToAudio` | **Medium** — må bevare at `getSettings()` returnerer stabile refs etter `onChange`-callback |
| MarkerBackgroundPanel | 65 | localStorage | **Lav** |
| GamePlanPanel | ? (inspiseres) | async show() laster schedule fra API | **Lav** |
| LuckyNumberPicker | ? | egen `isShowing()`-getter | **Lav** |

## 6. Testplan

**Før refactor:** kjør `pnpm --filter @spillorama/game-client test` + `apps/backend/src/sockets/__tests__/socketIntegration.test.ts`. Baseline.

**Per commit:** samme suite. Grønn før push.

**Nye tester (trinn 5):**
- `Game1Controller.boot.test.ts` — ny fil. Verifiserer at controller i start() kaller `ui.setLoaderState("CONNECTING")` → `"LOADING_ASSETS"` → `"JOINING_ROOM"` → `"READY"` i riktig rekkefølge med `FakeUIOrchestrator`. Ingen happy-dom.
- Eksisterende 3 tester omskrives til ekte controller + fake ui. Harness-dupli fjernes.

**Browser-smoke-test (manuell):** Pilot-hall, spill én full runde. Sjekk:
- Loader viser riktig state-transitions ved join
- Pause/resume toast timer riktig
- Toast-kø aldri over 3
- Settings lagrer + AudioManager reagerer

## 7. PM-bekreftede beslutninger

Tre åpne spørsmål besvart av PM 2026-04-21:

1. **"Spillet er gjenopptatt"-toast:** **Controller** eier. Domene-hendelse (state-transition), ikke UI-state. Controller kaller `ui.toastInfo()` når `wasPaused` skifter fra `true` → `false`. Orchestrator eksponerer kun `setPaused(bool)` og `toastInfo()`.
2. **Backward compat i trinn 2:** **Ingen default-param.** Direkte call-site-update i `registerGame`-bunnen av `Game1Controller.ts`. Cleanere og eksplisitt. Ett `new Game1UIOrchestrator(deps)` legges inn ved den call-siten.
3. **`FakeUIOrchestrator`-scope:** **Kun lokalt** under `packages/game-client/src/games/game1/ui/__fixtures__/`. Ikke eksporter fra pakke-rot før Spill 2/3 faktisk trenger det. YAGNI + "Spill 1 først"-memory.

## 8. Effort-estimat

| Trinn | LOC | Tid |
|-------|-----|-----|
| 1 | ~230 (interface + impl + fake) | 3t |
| 2 | ~120 diff i controller | 4t |
| 3 | ~80 diff | 2t |
| 4 | ~100 diff (inkl. wasPaused-flag + pause-toast-flytting) | 3t |
| 5 | ~250 testfiler (netto -100 fra fjernet harness) | 4t |
| Browser-QA | — | 2t |
| **Totalt** | **~680 LOC endret** | **~18t / 2-2.5 dager** |

Matcher opprinnelig M-estimat (1-3 dager).

## 9. Koordinering

- PR 4d (socket/refund) endrer `Game1Controller.ts`? → **venter** til 4d merget.
- PR 4e (admin-UI) endrer ikke game1-client → ingen kollisjon.
- Denne refactor er **post-pilot-kandidat** (PM-bekreftet).

## 10. Konkrete type-signaturer (implementasjons-ready)

Alle typer verifisert mot eksisterende kildefiler 2026-04-21. Re-eksport fremfor ny definisjon der det er mulig, for å unngå drift.

### 10.1 `LoaderState`

Re-eksport fra eksisterende `LoadingOverlay.ts` (linje 23-31, BIN-673). **Ingen ny definisjon.**

```ts
// packages/game-client/src/games/game1/ui/UIOrchestrator.ts
export type { LoadingState } from "../../../components/LoadingOverlay.js";

// Ekvivalent:
// "CONNECTING" | "JOINING_ROOM" | "LOADING_ASSETS" | "SYNCING"
//   | "RECONNECTING" | "RESYNCING" | "DISCONNECTED" | "READY"
```

Controller kan fortsette å bruke samme streng-literaler den bruker i dag (`"CONNECTING"`, `"LOADING_ASSETS"`, `"JOINING_ROOM"`, `"READY"`, `"RECONNECTING"`, `"DISCONNECTED"`). `"SYNCING"` og `"RESYNCING"` er legacy fra `reconnectFlow`; holdes uendret.

### 10.2 `Game1Settings` + settings-endringsflyt

Re-eksport fra eksisterende `SettingsPanel.ts` (linje 14-22). Beholder alle fem felter inkl. `luckyNumber` (null-default) og `doubleAnnounce`.

```ts
export type { Game1Settings } from "../components/SettingsPanel.js";

// Shape (verifisert mot SettingsPanel.ts:14-22):
// interface Game1Settings {
//   soundEnabled: boolean;
//   voiceEnabled: boolean;
//   voiceLanguage: "nor-male" | "nor-female" | "english";
//   luckyAutoSelect: boolean;
//   luckyNumber: number | null;
//   doubleAnnounce: boolean;
// }

export type SettingsChangeListener = (settings: Game1Settings) => void;
```

**Viktig kontrakt:** `getSettings()` returnerer alltid en ny kopi (match dagens `{ ...this.settings }` i linje 144). Controller MÅ behandle returen som read-only — ingen mutasjon.

### 10.3 `ScheduleSlot`

Re-eksport fra backend shared-types (aliasert via `@spillorama/shared-types` eller direkte PlatformService-eksport). Verifisert struktur i `apps/backend/src/platform/PlatformService.ts:199-215`:

```ts
// Sjekk om @spillorama/shared-types allerede re-eksporterer. Hvis ikke,
// legg til i trinn 1. Alternativt: types-only import fra backend-path
// hvis tsconfig-path-mapping tillater det.
export type { ScheduleSlot } from "@spillorama/shared-types/platform";

// Ekvivalent shape:
// interface ScheduleSlot {
//   id: string; hallId: string; gameType: string; displayName: string;
//   dayOfWeek: number | null; startTime: string; prizeDescription: string;
//   maxTickets: number; isActive: boolean; sortOrder: number;
//   variantConfig: Record<string, unknown>;
//   parentScheduleId?: string | null;
//   ...
// }
```

**TODO trinn 1:** verifiser at `@spillorama/shared-types` eksporterer `ScheduleSlot`. Hvis ikke → legg til re-eksport der, ikke duplisere typen i game-client.

### 10.4 Callback-typer (alle 7 overlays)

```ts
// UIOrchestrator callback-types — navngitte for å gjøre kontrakt eksplisitt
// og teste-fixturer type-safe.

export type SettingsChangeListener = (settings: Game1Settings) => void;
export type MarkerChangeListener = (markerId: number) => void;
export type BackgroundChangeListener = (backgroundId: number) => void;
export type GamePlanBuyListener = (slot: ScheduleSlot) => void;
export type LuckyNumberListener = (luckyNumber: number) => void;
```

### 10.5 Konstruktør-kontrakt for `Game1UIOrchestrator`

```ts
export interface Game1UIOrchestratorOptions {
  /** DOM-container der alle overlays mountes (absolute-positioned). */
  overlayContainer: HTMLElement;
  /**
   * Valgfritt loader-override — hovedsakelig for tester som vil styre
   * stuck-timer. Defaults to real LoadingOverlay.
   */
  loader?: LoadingOverlay;
}

export class Game1UIOrchestrator implements UIOrchestrator {
  constructor(opts: Game1UIOrchestratorOptions);
  // ...metoder per §2
}
```

Controller kaller i `start()`:

```ts
const overlayContainer = app.app.canvas.parentElement ?? document.body;
this.ui = opts.ui ?? new Game1UIOrchestrator({ overlayContainer });
```

Per PM-beslutning 7.2: ingen default-param i konstruktør. `Game1Controller(deps, ui)` — to required params. `registerGame`-call-site lager UI-instansen eksplisitt.

### 10.6 Full `UIOrchestrator`-interface (ferdig med typer)

```ts
export interface UIOrchestrator {
  // Loader
  setLoaderState(state: LoadingState, customMessage?: string): void;
  isLoaderVisible(): boolean;

  // Toast
  toastInfo(message: string, durationMs?: number): void;
  toastWin(message: string, durationMs?: number): void;
  toastError(message: string, durationMs?: number): void;

  // Pause
  setPaused(paused: boolean, message?: string): void;

  // Settings
  showSettings(): void;
  getSettings(): Game1Settings;
  onSettingsChange(cb: SettingsChangeListener): void;

  // Marker/Background
  showMarkerBackground(): void;
  onMarkerChange(cb: MarkerChangeListener): void;
  onBackgroundChange(cb: BackgroundChangeListener): void;

  // GamePlan
  showGamePlan(hallId: string, apiBase: string): Promise<void>;
  onGamePlanBuy(cb: GamePlanBuyListener): void;

  // Lucky
  showLuckyPicker(currentLucky: number | null): void;
  hideLuckyPicker(): void;
  onLuckySelect(cb: LuckyNumberListener): void;

  // Lifecycle
  destroy(): void;
}
```

### 10.7 `FakeUIOrchestrator` fixture-shape

```ts
// packages/game-client/src/games/game1/ui/__fixtures__/FakeUIOrchestrator.ts
export interface UICall {
  method: keyof UIOrchestrator;
  args: unknown[];
}

export class FakeUIOrchestrator implements UIOrchestrator {
  readonly calls: UICall[] = [];
  private loaderState: LoadingState = "READY";
  private settings: Game1Settings = { ...DEFAULT_TEST_SETTINGS };
  private listeners: {
    settings: SettingsChangeListener[];
    marker: MarkerChangeListener[];
    background: BackgroundChangeListener[];
    gamePlanBuy: GamePlanBuyListener[];
    lucky: LuckyNumberListener[];
  } = { settings: [], marker: [], background: [], gamePlanBuy: [], lucky: [] };

  // Test-helpers for å trigge UI→controller-events fra tester:
  emitSettingsChange(settings: Partial<Game1Settings>): void;
  emitMarkerChange(id: number): void;
  emitLuckySelect(n: number): void;
  emitGamePlanBuy(slot: ScheduleSlot): void;

  // Query-helpers:
  wasCalledWith(method: keyof UIOrchestrator, ...args: unknown[]): boolean;
  callsTo(method: keyof UIOrchestrator): UICall[];
}
```

`emit*`-metodene er fixture-only (ikke på `UIOrchestrator`-interfacet). Bruksmønster i tester:

```ts
const ui = new FakeUIOrchestrator();
const controller = new Game1Controller(deps, ui);
await controller.start();

expect(ui.callsTo("setLoaderState").map(c => c.args[0]))
  .toEqual(["CONNECTING", "LOADING_ASSETS", "JOINING_ROOM", "READY"]);

// Simulér at bruker endrer settings fra panel:
ui.emitSettingsChange({ voiceEnabled: false });
expect(deps.audio.setVoiceEnabled).toHaveBeenCalledWith(false);
```

### 10.8 Importer controller trenger

Etter migrasjon blir controller-filens UI-imports redusert fra 7 direkte component-imports til én interface + en impl:

```diff
- import { LoadingOverlay } from "../../components/LoadingOverlay.js";
- import { ToastNotification } from "./components/ToastNotification.js";
- import { PauseOverlay } from "./components/PauseOverlay.js";
- import { SettingsPanel, type Game1Settings } from "./components/SettingsPanel.js";
- import { MarkerBackgroundPanel } from "./components/MarkerBackgroundPanel.js";
- import { GamePlanPanel } from "./components/GamePlanPanel.js";
- import { LuckyNumberPicker } from "./components/LuckyNumberPicker.js";
+ import type { UIOrchestrator } from "./ui/UIOrchestrator.js";
+ import { Game1UIOrchestrator } from "./ui/Game1UIOrchestrator.js";
+ import type { Game1Settings } from "./components/SettingsPanel.js"; // fortsatt til audio-sync
```

Netto: −6 UI-imports fra controller, +2 orchestrator-imports. Forbedret koblings-rensing alene.
