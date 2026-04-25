/**
 * Spill 1 — Bonusspill Preview
 * ================================================================
 *
 * Isolated dev-tool page for previewing the five Spill 1 mini-game
 * overlays without running a full bingo round.
 *
 * Earlier versions instantiated **5 parallel `Pixi.Application`s** —
 * one per overlay — each running its own ticker. That inflated the
 * idle baseline of the performance-budget gate (PR #469) by ~5-7x
 * (e.g. `rafCallsPerSec=360` for a single canvas at 60Hz instead of
 * the expected ~60), which masked real ticker leaks under noise.
 *
 * Refactor (this file): **single-active-application pattern**.
 *
 *   - One `Pixi.Application` (and one ticker) is alive at a time.
 *   - The five `<div class="stage-wrap" id="stage-X">` slots are kept
 *     for design-review UX, but only one of them holds a live canvas
 *     at any moment ("active" scenario). Inactive slots show a
 *     greyed-out placeholder with a "Klikk for å aktivere" hint and
 *     are wired so a click on the panel itself activates it.
 *   - Switching between scenarios destroys the previous Application
 *     (canvas + ticker + WebGL context) before creating the next one,
 *     guaranteeing the page never holds more than one ticker at a
 *     time. `Application.destroy(true, { children:true })` walks the
 *     whole stage so overlay graphics, GSAP-tracked targets, etc. are
 *     freed in the same step.
 *   - `wheel` is the default-active scenario on first load. The
 *     performance-budget collector (`scripts/performance-budget/
 *     collect-metrics.ts`) drives only the wheel scenario, so the
 *     pre-`waitForSelector("#stage-wheel canvas")` fast-path is
 *     preserved without any change to the collector.
 *
 * No backend calls. No socket. No auth. The overlays' `onChoice`
 * callbacks are captured and logged, not dispatched.
 *
 * Served at `/web/games/preview.html` after `npm run build`.
 *
 * Covered overlays:
 *   - WheelOverlay        — Lykkehjulet (default-active on load)
 *   - TreasureChestOverlay — Skattekisten
 *   - OddsenOverlay       — Oddsen (cross-round mystery)
 *   - ColorDraftOverlay   — Fargetrekning
 *   - MysteryGameOverlay  — Mystery Game (opp/ned, 5 runder, joker)
 */

import { Application } from "pixi.js";
import { WheelOverlay } from "../games/game1/components/WheelOverlay.js";
import { TreasureChestOverlay } from "../games/game1/components/TreasureChestOverlay.js";
import { OddsenOverlay } from "../games/game1/components/OddsenOverlay.js";
import { ColorDraftOverlay } from "../games/game1/components/ColorDraftOverlay.js";
import { MysteryGameOverlay } from "../games/game1/components/MysteryGameOverlay.js";

const STAGE_W = 800;
const STAGE_H = 600;

/**
 * No-op pause-bridge stub. The real GameBridge exposes `isPaused` for
 * the "Spillvett pause" flow; we never pause here, so `false` is fine.
 */
const noopBridge = { getState: (): { isPaused: boolean } => ({ isPaused: false }) };

type OverlayKey = "wheel" | "chest" | "oddsen" | "colordraft" | "mystery";

type AnyOverlay =
  | WheelOverlay
  | TreasureChestOverlay
  | OddsenOverlay
  | ColorDraftOverlay
  | MysteryGameOverlay;

interface ActiveScenario {
  key: OverlayKey;
  app: Application;
  instance: AnyOverlay;
}

const ALL_KEYS: OverlayKey[] = ["wheel", "chest", "oddsen", "colordraft", "mystery"];

const containerIdFor: Record<OverlayKey, string> = {
  wheel: "stage-wheel",
  chest: "stage-chest",
  oddsen: "stage-oddsen",
  colordraft: "stage-colordraft",
  mystery: "stage-mystery",
};

const logIdFor: Record<OverlayKey, string> = {
  wheel: "log-wheel",
  chest: "log-chest",
  oddsen: "log-oddsen",
  colordraft: "log-colordraft",
  mystery: "log-mystery",
};

const labelFor: Record<OverlayKey, string> = {
  wheel: "Lykkehjul",
  chest: "Skattekiste",
  oddsen: "Oddsen",
  colordraft: "Fargetrekning",
  mystery: "Mystery Game",
};

let active: ActiveScenario | null = null;

function logLine(log: HTMLElement, message: string, isError = false): void {
  const div = document.createElement("div");
  if (isError) div.className = "err";
  const ts = new Date().toLocaleTimeString();
  div.textContent = `[${ts}] ${message}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  // Cap history to keep DOM light.
  while (log.children.length > 40) log.removeChild(log.firstChild!);
}

function logFor(key: OverlayKey): HTMLElement | null {
  return document.getElementById(logIdFor[key]);
}

function containerFor(key: OverlayKey): HTMLElement | null {
  return document.getElementById(containerIdFor[key]);
}

/**
 * Render a static placeholder in a stage-wrap that has no live canvas.
 * The panel becomes click-to-activate via the global click handler in
 * `boot()`; this just gives the user a visible cue for that affordance.
 */
function renderInactivePlaceholder(key: OverlayKey): void {
  const container = containerFor(key);
  if (!container) return;
  container.innerHTML = "";
  const ph = document.createElement("div");
  ph.className = "stage-placeholder";
  ph.dataset["overlayPlaceholder"] = key;
  ph.textContent = `${labelFor[key]} — klikk for å aktivere`;
  container.appendChild(ph);
}

/**
 * Tear down the currently-active Pixi.Application (if any). Destroys
 * the canvas, the ticker, and the entire stage tree (including the
 * overlay's Graphics + Text children). After this call the previous
 * scenario's stage-wrap is empty and can be repopulated with either
 * a new Application or a placeholder.
 */
function destroyActive(): void {
  if (!active) return;
  const prev = active;
  active = null;
  try {
    // `removeChildren=true` walks the full stage tree so every overlay
    // graphic + text is destroyed alongside the renderer/ticker. Pass
    // `texture:false` because Pixi caches textures on the global
    // Assets registry and we want to keep the cache hot for the next
    // scenario — it's the GL context, ticker, and stage tree that
    // need to go.
    prev.app.destroy(true, { children: true, texture: false });
  } catch (err) {
    // A destroy-failure shouldn't wedge the page; log and move on.
    const log = logFor(prev.key);
    if (log) {
      logLine(
        log,
        `app.destroy() warning: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } else {
      console.warn("[preview] destroyActive failed:", err);
    }
  }
  renderInactivePlaceholder(prev.key);
}

async function createApp(containerId: string): Promise<Application> {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`No container element for #${containerId}`);
  // Clear any placeholder before mounting the new canvas.
  container.innerHTML = "";
  const app = new Application();
  await app.init({
    width: STAGE_W,
    height: STAGE_H,
    background: 0x101020,
    antialias: true,
    // Avoid auto-density scaling; preview is fixed-size for design review.
    resolution: 1,
    autoDensity: false,
  });
  container.appendChild(app.canvas);
  return app;
}

function buildOverlay(key: OverlayKey): AnyOverlay {
  switch (key) {
    case "wheel":
      return new WheelOverlay(STAGE_W, STAGE_H, noopBridge);
    case "chest":
      return new TreasureChestOverlay(STAGE_W, STAGE_H, noopBridge);
    case "oddsen":
      return new OddsenOverlay(STAGE_W, STAGE_H);
    case "colordraft":
      return new ColorDraftOverlay(STAGE_W, STAGE_H);
    case "mystery":
      return new MysteryGameOverlay(STAGE_W, STAGE_H);
  }
}

/**
 * Wire the overlay-specific `onChoice` / `onDismiss` hooks. Mirrors
 * the legacy per-scenario setup but pulled into one switch so the
 * activation path stays linear.
 */
function wireCallbacks(key: OverlayKey, instance: AnyOverlay, log: HTMLElement): void {
  switch (key) {
    case "wheel": {
      const overlay = instance as WheelOverlay;
      overlay.setOnChoice((choice) => {
        logLine(
          log,
          `onChoice fired: ${JSON.stringify(choice)} — auto-animating fake result in 500 ms`,
        );
        // In the real flow, the server would respond with a result. For the
        // preview we synthesize one so the full animation can be observed.
        setTimeout(() => overlay.animateResult(wheelResultPayload(), 50000), 500);
      });
      overlay.setOnDismiss(() => logLine(log, "onDismiss fired (overlay auto-closed)"));
      break;
    }
    case "chest": {
      const overlay = instance as TreasureChestOverlay;
      overlay.setOnChoice((choice) => {
        logLine(log, `onChoice fired: ${JSON.stringify(choice)} — animerer resultat om 500 ms`);
        setTimeout(() => overlay.animateResult(chestResultPayload(), 75000), 500);
      });
      overlay.setOnDismiss(() => logLine(log, "onDismiss fired"));
      break;
    }
    case "oddsen": {
      const overlay = instance as OddsenOverlay;
      overlay.setOnChoice((choice) => {
        logLine(log, `onChoice fired: ${JSON.stringify(choice)} — viser venter-state om 500 ms`);
        setTimeout(() => overlay.animateResult(oddsenWaitingResultPayload(), 0), 500);
      });
      overlay.setOnDismiss(() => logLine(log, "onDismiss fired"));
      break;
    }
    case "colordraft": {
      const overlay = instance as ColorDraftOverlay;
      overlay.setOnChoice((choice) => {
        logLine(log, `onChoice fired: ${JSON.stringify(choice)} — animerer treff om 500 ms`);
        setTimeout(() => overlay.animateResult(colordraftHitResultPayload(), 25000), 500);
      });
      overlay.setOnDismiss(() => logLine(log, "onDismiss fired"));
      break;
    }
    case "mystery": {
      const overlay = instance as MysteryGameOverlay;
      overlay.setOnChoice((choice) => {
        logLine(log, `onChoice fired: ${JSON.stringify(choice)} — animerer resultat om 500 ms`);
        setTimeout(() => overlay.animateResult(mysteryWinResultPayload(), 40000), 500);
      });
      overlay.setOnDismiss(() => logLine(log, "onDismiss fired"));
      break;
    }
  }
}

/**
 * Make a scenario the single live one. Tears down whatever was active
 * before and creates a fresh Application + overlay for the requested
 * key. Idempotent — if `key` is already active, nothing happens.
 */
async function activateScenario(key: OverlayKey): Promise<void> {
  if (active && active.key === key) return;
  destroyActive();
  const app = await createApp(containerIdFor[key]);
  const instance = buildOverlay(key);
  app.stage.addChild(instance);
  const log = logFor(key);
  if (log) wireCallbacks(key, instance, log);
  active = { key, app, instance };
  if (log) logLine(log, "Aktivert. Klar — én Pixi.Application kjører nå.");
}

// ─────────────────────────────────────────────────────────────────
// Dummy payload builders (kept near the UI so they're easy to tweak
// without touching the overlay source).
// ─────────────────────────────────────────────────────────────────

function wheelTriggerPayload(): Record<string, unknown> {
  return {
    totalBuckets: 50,
    spinCount: 1,
    prizes: [
      { amount: 100, buckets: 25 },
      { amount: 200, buckets: 15 },
      { amount: 500, buckets: 7 },
      { amount: 1000, buckets: 2 },
      { amount: 2500, buckets: 1 },
    ],
  };
}
function wheelResultPayload(): Record<string, unknown> {
  return {
    winningBucketIndex: 17,
    prizeGroupIndex: 2,
    amountKroner: 500,
    totalBuckets: 50,
    animationSeed: 12345,
  };
}

function chestTriggerPayload(): Record<string, unknown> {
  return {
    chestCount: 6,
    prizeRange: { minNok: 50, maxNok: 1000 },
    hasDiscreteTiers: false,
  };
}
function chestResultPayload(): Record<string, unknown> {
  // chosenIndex 2 (third chest, zero-indexed) is the server-picked winner.
  return {
    chosenIndex: 2,
    prizeAmountKroner: 750,
    allValuesKroner: [100, 200, 750, 50, 300, 150],
    chestCount: 6,
  };
}

function oddsenTriggerPayload(): Record<string, unknown> {
  return {
    validNumbers: [55, 56, 57],
    potSmallNok: 500,
    potLargeNok: 1500,
    resolveAtDraw: 57,
  };
}
function oddsenWaitingResultPayload(): Record<string, unknown> {
  return {
    chosenNumber: 56,
    oddsenStateId: "preview-oddsen-1",
    chosenForGameId: "preview-game-2",
    ticketSizeAtWin: "large" as const,
    potAmountNokIfHit: 1500,
    validNumbers: [55, 56, 57],
    payoutDeferred: true as const,
  };
}
function oddsenHitResultPayload(): Record<string, unknown> {
  return {
    chosenNumber: 56,
    resolvedOutcome: "hit" as const,
    potAmountKroner: 1500,
  };
}
function oddsenMissResultPayload(): Record<string, unknown> {
  return {
    chosenNumber: 56,
    resolvedOutcome: "miss" as const,
    potAmountKroner: 0,
  };
}

function colordraftTriggerPayload(): Record<string, unknown> {
  return {
    numberOfSlots: 12,
    targetColor: "blue",
    slotColors: [
      "red", "yellow", "green", "blue",
      "purple", "orange", "red", "yellow",
      "green", "pink", "blue", "white",
    ],
    winPrizeNok: 250,
    consolationPrizeNok: 0,
  };
}
function colordraftHitResultPayload(): Record<string, unknown> {
  return {
    chosenIndex: 3, // the "blue" slot at index 3 — matches targetColor
    chosenColor: "blue",
    targetColor: "blue",
    matched: true,
    prizeAmountKroner: 250,
    allSlotColors: [
      "red", "yellow", "green", "blue",
      "purple", "orange", "red", "yellow",
      "green", "pink", "blue", "white",
    ],
    numberOfSlots: 12,
  };
}
function colordraftMissResultPayload(): Record<string, unknown> {
  return {
    chosenIndex: 1, // "yellow" — does not match "blue"
    chosenColor: "yellow",
    targetColor: "blue",
    matched: false,
    prizeAmountKroner: 0,
    allSlotColors: [
      "red", "yellow", "green", "blue",
      "purple", "orange", "red", "yellow",
      "green", "pink", "blue", "white",
    ],
    numberOfSlots: 12,
  };
}

function mysteryTriggerPayload(): Record<string, unknown> {
  // middle = 53472, result = 78913. Ingen equal digits, så spillet kan kjøre
  // 5 full-runder. Optimal play: DOWN, DOWN, UP, UP, UP (reversed: digit 0..4).
  return {
    middleNumber: 53472,
    resultNumber: 78913,
    prizeListNok: [50, 100, 200, 400, 800, 1500],
    maxRounds: 5,
    autoTurnFirstMoveSec: 20,
    autoTurnOtherMoveSec: 10,
  };
}
function mysteryWinResultPayload(): Record<string, unknown> {
  return {
    middleNumber: 53472,
    resultNumber: 78913,
    rounds: [
      {
        direction: "down",
        middleDigit: 2,
        resultDigit: 3,
        outcome: "wrong",
        priceIndexAfter: 0,
      },
      {
        direction: "up",
        middleDigit: 7,
        resultDigit: 1,
        outcome: "wrong",
        priceIndexAfter: 0,
      },
      {
        direction: "up",
        middleDigit: 4,
        resultDigit: 9,
        outcome: "correct",
        priceIndexAfter: 1,
      },
      {
        direction: "up",
        middleDigit: 3,
        resultDigit: 8,
        outcome: "correct",
        priceIndexAfter: 2,
      },
      {
        direction: "up",
        middleDigit: 5,
        resultDigit: 7,
        outcome: "correct",
        priceIndexAfter: 3,
      },
    ],
    finalPriceIndex: 3,
    prizeAmountKroner: 400,
    jokerTriggered: false,
  };
}
function mysteryJokerResultPayload(): Record<string, unknown> {
  // Joker på runde 0 (digit 2 == 2). Spillet termineres umiddelbart.
  return {
    middleNumber: 53472,
    resultNumber: 78912,
    rounds: [
      {
        direction: "up",
        middleDigit: 2,
        resultDigit: 2,
        outcome: "joker",
        priceIndexAfter: 5,
      },
    ],
    finalPriceIndex: 5,
    prizeAmountKroner: 1500,
    jokerTriggered: true,
  };
}
function mysteryBustResultPayload(): Record<string, unknown> {
  // Alle runder wrong → priceIndex = 0 → min-premie.
  return {
    middleNumber: 53472,
    resultNumber: 78913,
    rounds: [
      { direction: "up", middleDigit: 2, resultDigit: 3, outcome: "correct", priceIndexAfter: 1 },
      { direction: "down", middleDigit: 7, resultDigit: 1, outcome: "correct", priceIndexAfter: 2 },
      { direction: "down", middleDigit: 4, resultDigit: 9, outcome: "wrong", priceIndexAfter: 1 },
      { direction: "down", middleDigit: 3, resultDigit: 8, outcome: "wrong", priceIndexAfter: 0 },
      { direction: "down", middleDigit: 5, resultDigit: 7, outcome: "wrong", priceIndexAfter: 0 },
    ],
    finalPriceIndex: 0,
    prizeAmountKroner: 50,
    jokerTriggered: false,
  };
}

// ─────────────────────────────────────────────────────────────────
// Button-dispatch
// ─────────────────────────────────────────────────────────────────

/**
 * Every overlay starts with `this.visible = false` from its constructor and
 * only becomes visible inside `show(triggerPayload)`. In the real game the
 * router always calls `show()` before anything else, but in the preview a
 * user can click "Vis resultat", "Simuler klikk", or "Simuler choice-error"
 * directly — so we lazily call `show()` with the matching trigger-payload
 * first if the overlay hasn't been shown yet (or auto-dismissed since last
 * show). Without this, `animateResult()` / `showChoiceError()` run on a
 * Container whose `.visible` is still `false` and the canvas appears empty.
 */
function ensureShown(overlayKey: OverlayKey, overlay: AnyOverlay, log: HTMLElement): void {
  if (overlay.visible) return;
  switch (overlayKey) {
    case "wheel":
      (overlay as WheelOverlay).show(wheelTriggerPayload());
      break;
    case "chest":
      (overlay as TreasureChestOverlay).show(chestTriggerPayload());
      break;
    case "oddsen":
      (overlay as OddsenOverlay).show(oddsenTriggerPayload());
      break;
    case "colordraft":
      (overlay as ColorDraftOverlay).show(colordraftTriggerPayload());
      break;
    case "mystery":
      (overlay as MysteryGameOverlay).show(
        mysteryTriggerPayload() as Parameters<MysteryGameOverlay["show"]>[0],
      );
      break;
  }
  logLine(log, "(auto-show() først — overlay var skjult)");
}

async function handleAction(overlayKey: OverlayKey, action: string): Promise<void> {
  // Activate this scenario if it isn't already. This destroys whatever
  // was running before (canvas + ticker + stage tree), so the page only
  // ever holds one Application at a time.
  if (!active || active.key !== overlayKey) {
    await activateScenario(overlayKey);
  }
  if (!active || active.key !== overlayKey) return;
  const log = logFor(overlayKey);
  if (!log) return;
  const instance = active.instance;

  // For every action except "trigger" (which calls show() itself) and "hide"
  // (which explicitly hides), force the overlay to be visible first. This
  // guarantees the canvas renders even if the user clicks a post-trigger
  // action button standalone.
  if (action !== "trigger" && action !== "hide") {
    ensureShown(overlayKey, instance, log);
  }

  try {
    switch (overlayKey) {
      case "wheel":
        handleWheelAction(instance as WheelOverlay, action, log);
        break;
      case "chest":
        handleChestAction(instance as TreasureChestOverlay, action, log);
        break;
      case "oddsen":
        handleOddsenAction(instance as OddsenOverlay, action, log);
        break;
      case "colordraft":
        handleColorDraftAction(instance as ColorDraftOverlay, action, log);
        break;
      case "mystery":
        handleMysteryAction(instance as MysteryGameOverlay, action, log);
        break;
    }
  } catch (err) {
    logLine(log, `ERROR: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

function handleWheelAction(overlay: WheelOverlay, action: string, log: HTMLElement): void {
  switch (action) {
    case "trigger":
      overlay.show(wheelTriggerPayload());
      logLine(log, "show() kalt med dummy wheel-trigger");
      break;
    case "choice":
      // Wheel has no choice UI — simulate by calling onChoice directly
      // (the click/auto-timeout both send empty choiceJson).
      logLine(log, "Simulerer 'SPINN'-klikk → onChoice({}) → animateResult");
      overlay.animateResult(wheelResultPayload(), 50000);
      break;
    case "result":
      overlay.animateResult(wheelResultPayload(), 50000);
      logLine(log, "animateResult() kalt (500 kr, bucket 17)");
      break;
    case "error":
      overlay.showChoiceError({ code: "E_PREVIEW", message: "Dummy-feil (preview)" });
      logLine(log, "showChoiceError() kalt", true);
      break;
    case "hide":
      overlay.visible = false;
      logLine(log, "overlay.visible = false");
      break;
  }
}

function handleChestAction(overlay: TreasureChestOverlay, action: string, log: HTMLElement): void {
  switch (action) {
    case "trigger":
      overlay.show(chestTriggerPayload());
      logLine(log, "show() kalt med dummy chest-trigger (6 kister, 50-1000 kr)");
      break;
    case "choice":
      logLine(log, "Simulerer valg av kiste 3 (index 2) → animateResult");
      overlay.animateResult(chestResultPayload(), 75000);
      break;
    case "result":
      overlay.animateResult(chestResultPayload(), 75000);
      logLine(log, "animateResult() kalt (kiste 3 vinner 750 kr)");
      break;
    case "error":
      overlay.showChoiceError({ code: "E_PREVIEW", message: "Dummy-feil (preview)" });
      logLine(log, "showChoiceError() kalt", true);
      break;
    case "hide":
      overlay.visible = false;
      logLine(log, "overlay.visible = false");
      break;
  }
}

function handleOddsenAction(overlay: OddsenOverlay, action: string, log: HTMLElement): void {
  switch (action) {
    case "trigger":
      overlay.show(oddsenTriggerPayload());
      logLine(log, "show() kalt — velg tall 55/56/57, avgjøres i neste spill");
      break;
    case "choice":
      logLine(log, "Simulerer klikk på tall 56 → venter-state");
      overlay.animateResult(oddsenWaitingResultPayload(), 0);
      break;
    case "result":
      overlay.animateResult(oddsenWaitingResultPayload(), 0);
      logLine(log, "animateResult() kalt — payoutDeferred=true (venter-state)");
      break;
    case "result-hit":
      overlay.animateResult(oddsenHitResultPayload(), 150000);
      logLine(log, "animateResult() kalt — resolvedOutcome=hit, 1500 kr");
      break;
    case "result-miss":
      overlay.animateResult(oddsenMissResultPayload(), 0);
      logLine(log, "animateResult() kalt — resolvedOutcome=miss");
      break;
    case "error":
      overlay.showChoiceError({ code: "E_PREVIEW", message: "Dummy-feil (preview)" });
      logLine(log, "showChoiceError() kalt", true);
      break;
    case "hide":
      overlay.visible = false;
      logLine(log, "overlay.visible = false");
      break;
  }
}

function handleColorDraftAction(overlay: ColorDraftOverlay, action: string, log: HTMLElement): void {
  switch (action) {
    case "trigger":
      overlay.show(colordraftTriggerPayload());
      logLine(log, "show() kalt — mål=blå, 12 luker, premie 250 kr");
      break;
    case "choice":
      logLine(log, "Simulerer valg av luke 4 (index 3, blå = match) → animateResult");
      overlay.animateResult(colordraftHitResultPayload(), 25000);
      break;
    case "result":
      overlay.animateResult(colordraftHitResultPayload(), 25000);
      logLine(log, "animateResult() kalt — TREFF (blå + blå), 250 kr");
      break;
    case "result-miss":
      overlay.animateResult(colordraftMissResultPayload(), 0);
      logLine(log, "animateResult() kalt — BOM (valgte gul, mål=blå), 0 kr");
      break;
    case "error":
      overlay.showChoiceError({ code: "E_PREVIEW", message: "Dummy-feil (preview)" });
      logLine(log, "showChoiceError() kalt", true);
      break;
    case "hide":
      overlay.visible = false;
      logLine(log, "overlay.visible = false");
      break;
  }
}

function handleMysteryAction(overlay: MysteryGameOverlay, action: string, log: HTMLElement): void {
  switch (action) {
    case "trigger":
      overlay.show(mysteryTriggerPayload());
      logLine(log, "show() kalt — middle=53472, result=78913, 6-trinns premie-stige");
      break;
    case "result-win":
      overlay.animateResult(mysteryWinResultPayload(), 40000);
      logLine(log, "animateResult() kalt — priceIndex=3, 400 kr");
      break;
    case "result-joker":
      overlay.animateResult(mysteryJokerResultPayload(), 150000);
      logLine(log, "animateResult() kalt — JOKER på runde 0, 1500 kr (max)");
      break;
    case "result-bust":
      overlay.animateResult(mysteryBustResultPayload(), 5000);
      logLine(log, "animateResult() kalt — priceIndex=0, 50 kr (min)");
      break;
    case "error":
      overlay.showChoiceError({ code: "E_PREVIEW", message: "Dummy-feil (preview)" });
      logLine(log, "showChoiceError() kalt", true);
      break;
    case "hide":
      overlay.visible = false;
      logLine(log, "overlay.visible = false");
      break;
  }
}

// ─────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  // Render placeholders for every panel up-front so the layout is
  // stable and inactive panels show a clear cue to activate them.
  for (const key of ALL_KEYS) renderInactivePlaceholder(key);

  // Wire delegated click-handler. Two click paths land here:
  //   1) `button.action[data-action][data-overlay]` — the per-overlay
  //      action buttons inside `.controls`.
  //   2) `.stage-placeholder[data-overlay-placeholder]` — the inactive
  //      panel cue. Clicking it activates that scenario without firing
  //      any specific action (the user can then trigger from buttons).
  document.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const placeholder = target.closest<HTMLElement>(".stage-placeholder");
    if (placeholder) {
      const placeholderKey = placeholder.dataset["overlayPlaceholder"] as
        | OverlayKey
        | undefined;
      if (placeholderKey) {
        void activateScenario(placeholderKey).then(() => {
          const log = logFor(placeholderKey);
          if (log) logLine(log, "Scenario aktivert via placeholder-klikk");
        });
      }
      return;
    }

    const btn = target.closest<HTMLButtonElement>("button.action");
    if (!btn) return;
    const action = btn.dataset["action"];
    const overlayKey = btn.dataset["overlay"] as OverlayKey | undefined;
    if (!action || !overlayKey) return;
    void handleAction(overlayKey, action);
  });

  // Boot the wheel scenario by default. The performance-budget collector
  // (scripts/performance-budget/collect-metrics.ts) waits for
  // `#stage-wheel canvas` immediately after navigation, so wheel must be
  // active on first paint.
  try {
    await activateScenario("wheel");
  } catch (e) {
    console.error("Wheel default-activation failed:", e);
  }
}

void boot();
