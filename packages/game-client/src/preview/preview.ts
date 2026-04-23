/**
 * Spill 1 — Bonusspill Preview
 * ================================================================
 *
 * Isolated dev-tool page for previewing the four Spill 1 mini-game
 * overlays without running a full bingo round. Each overlay gets its
 * own PIXI.Application (800 x 600) and a panel of buttons that fire
 * realistic `show()` / `animateResult()` / `showChoiceError()` calls
 * with dummy payloads.
 *
 * No backend calls. No socket. No auth. The overlays' `onChoice`
 * callbacks are captured and logged, not dispatched.
 *
 * Served at `/web/games/preview.html` after `npm run build`.
 *
 * Covered overlays:
 *   - WheelOverlay        — Lykkehjulet
 *   - TreasureChestOverlay — Skattekisten
 *   - OddsenOverlay       — Oddsen (cross-round mystery)
 *   - ColorDraftOverlay   — Fargetrekning
 */

import { Application } from "pixi.js";
import { WheelOverlay } from "../games/game1/components/WheelOverlay.js";
import { TreasureChestOverlay } from "../games/game1/components/TreasureChestOverlay.js";
import { OddsenOverlay } from "../games/game1/components/OddsenOverlay.js";
import { ColorDraftOverlay } from "../games/game1/components/ColorDraftOverlay.js";

const STAGE_W = 800;
const STAGE_H = 600;

/**
 * No-op pause-bridge stub. The real GameBridge exposes `isPaused` for
 * the "Spillvett pause" flow; we never pause here, so `false` is fine.
 */
const noopBridge = { getState: (): { isPaused: boolean } => ({ isPaused: false }) };

type OverlayKey = "wheel" | "chest" | "oddsen" | "colordraft";

interface OverlayHandle {
  app: Application;
  instance:
    | WheelOverlay
    | TreasureChestOverlay
    | OddsenOverlay
    | ColorDraftOverlay;
  log: HTMLElement;
}

const handles = new Map<OverlayKey, OverlayHandle>();

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

async function createApp(containerId: string): Promise<Application> {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`No container element for #${containerId}`);
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

// ─────────────────────────────────────────────────────────────────
// Overlay wiring
// ─────────────────────────────────────────────────────────────────

async function setupWheel(): Promise<void> {
  const app = await createApp("stage-wheel");
  const overlay = new WheelOverlay(STAGE_W, STAGE_H, noopBridge);
  app.stage.addChild(overlay);
  const log = document.getElementById("log-wheel")!;
  overlay.setOnChoice((choice) => {
    logLine(log, `onChoice fired: ${JSON.stringify(choice)} — auto-animating fake result in 500 ms`);
    // In the real flow, the server would respond with a result. For the
    // preview we synthesize one so the full animation can be observed.
    setTimeout(() => overlay.animateResult(wheelResultPayload(), 50000), 500);
  });
  overlay.setOnDismiss(() => logLine(log, "onDismiss fired (overlay auto-closed)"));
  handles.set("wheel", { app, instance: overlay, log });
  logLine(log, "Klar. Trykk 'Trigger Lykkehjul' for å starte.");
}

async function setupChest(): Promise<void> {
  const app = await createApp("stage-chest");
  const overlay = new TreasureChestOverlay(STAGE_W, STAGE_H, noopBridge);
  app.stage.addChild(overlay);
  const log = document.getElementById("log-chest")!;
  overlay.setOnChoice((choice) => {
    logLine(log, `onChoice fired: ${JSON.stringify(choice)} — animerer resultat om 500 ms`);
    setTimeout(() => overlay.animateResult(chestResultPayload(), 75000), 500);
  });
  overlay.setOnDismiss(() => logLine(log, "onDismiss fired"));
  handles.set("chest", { app, instance: overlay, log });
  logLine(log, "Klar. Trykk 'Trigger Skattekiste' for å starte.");
}

async function setupOddsen(): Promise<void> {
  const app = await createApp("stage-oddsen");
  const overlay = new OddsenOverlay(STAGE_W, STAGE_H);
  app.stage.addChild(overlay);
  const log = document.getElementById("log-oddsen")!;
  overlay.setOnChoice((choice) => {
    logLine(log, `onChoice fired: ${JSON.stringify(choice)} — viser venter-state om 500 ms`);
    setTimeout(
      () => overlay.animateResult(oddsenWaitingResultPayload(), 0),
      500,
    );
  });
  overlay.setOnDismiss(() => logLine(log, "onDismiss fired"));
  handles.set("oddsen", { app, instance: overlay, log });
  logLine(log, "Klar. Trykk 'Trigger Oddsen' for å starte.");
}

async function setupColorDraft(): Promise<void> {
  const app = await createApp("stage-colordraft");
  const overlay = new ColorDraftOverlay(STAGE_W, STAGE_H);
  app.stage.addChild(overlay);
  const log = document.getElementById("log-colordraft")!;
  overlay.setOnChoice((choice) => {
    logLine(log, `onChoice fired: ${JSON.stringify(choice)} — animerer treff om 500 ms`);
    setTimeout(() => overlay.animateResult(colordraftHitResultPayload(), 25000), 500);
  });
  overlay.setOnDismiss(() => logLine(log, "onDismiss fired"));
  handles.set("colordraft", { app, instance: overlay, log });
  logLine(log, "Klar. Trykk 'Trigger Fargetrekning' for å starte.");
}

// ─────────────────────────────────────────────────────────────────
// Button-dispatch
// ─────────────────────────────────────────────────────────────────

function handleAction(overlayKey: OverlayKey, action: string): void {
  const h = handles.get(overlayKey);
  if (!h) return;
  const log = h.log;

  try {
    switch (overlayKey) {
      case "wheel":
        handleWheelAction(h.instance as WheelOverlay, action, log);
        break;
      case "chest":
        handleChestAction(h.instance as TreasureChestOverlay, action, log);
        break;
      case "oddsen":
        handleOddsenAction(h.instance as OddsenOverlay, action, log);
        break;
      case "colordraft":
        handleColorDraftAction(h.instance as ColorDraftOverlay, action, log);
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

// ─────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  // Wire delegated click-handler before PIXI inits; buttons just sit
  // idle until setup completes, and any early clicks are no-ops.
  document.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLButtonElement>("button.action");
    if (!btn) return;
    const action = btn.dataset["action"];
    const overlayKey = btn.dataset["overlay"] as OverlayKey | undefined;
    if (!action || !overlayKey) return;
    handleAction(overlayKey, action);
  });

  // Parallel init keeps first paint snappy. Failures log to the specific
  // overlay log line so one broken overlay doesn't kill the page.
  await Promise.all([
    setupWheel().catch((e) => console.error("Wheel setup failed:", e)),
    setupChest().catch((e) => console.error("Chest setup failed:", e)),
    setupOddsen().catch((e) => console.error("Oddsen setup failed:", e)),
    setupColorDraft().catch((e) => console.error("ColorDraft setup failed:", e)),
  ]);
}

void boot();
