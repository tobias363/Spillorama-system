/**
 * Spill 1 — Visual Regression Harness
 * =====================================================================
 *
 * Standalone page mounting individual Spill 1 components in deterministic,
 * backend-less states. Playwright navigates here via `?scenario=<name>`,
 * waits for `#readiness-beacon[data-ready="true"]`, then snapshots the page.
 *
 * Scenarios:
 *   ?scenario=idle           — Pixi stage + HTML overlay in pre-round state
 *                              (ball-tube empty, centre ball blank, chat
 *                              panel collapsed). Catches "idle repaint"
 *                              regressions.
 *   ?scenario=buy-popup      — Same as idle PLUS Game1BuyPopup open. This
 *                              is the scenario that originally introduced
 *                              backdrop-filter flicker in early April.
 *   ?scenario=draw-active    — Ball-tube with 5 loaded balls, center-ball
 *                              showing number 42. Exercises texture
 *                              loading + tube-spacing without an active
 *                              animation at capture time.
 *   ?scenario=pattern-won    — WinPopup open with 500 kr. Catches the
 *                              pattern-won-flash regression where the
 *                              popup's own keyframe animation would flash
 *                              into an idle repaint.
 *   ?scenario=win-screen     — WinScreenV2 fullscreen (BINGO / full house).
 *
 * All scenarios skip animation settle-in by freezing after 300ms
 * (setTimeout → markReady()) so Playwright snapshots a stable frame. The
 * `animations: "disabled"` option on `toHaveScreenshot()` handles the
 * remainder (caret, CSS transitions, scroll anchors).
 */

import { Application, Assets } from "pixi.js";
import gsap from "gsap";
import { BallTube } from "../games/game1/components/BallTube.js";
import { CenterBall } from "../games/game1/components/CenterBall.js";
import { Game1BuyPopup } from "../games/game1/components/Game1BuyPopup.js";
import { HtmlOverlayManager } from "../games/game1/components/HtmlOverlayManager.js";
import { WinPopup } from "../games/game1/components/WinPopup.js";
import { WinScreenV2 } from "../games/game1/components/WinScreenV2.js";

/** Ball PNGs used by BallTube + CenterBall. Pre-warmed before loadBalls() so
 *  sprites render in their first frame (async Assets.load() inside BallTube
 *  otherwise causes a race where the snapshot fires before textures bind). */
const BALL_ASSETS = [
  "/web/games/assets/game1/design/balls/blue.png",
  "/web/games/assets/game1/design/balls/red.png",
  "/web/games/assets/game1/design/balls/purple.png",
  "/web/games/assets/game1/design/balls/green.png",
  "/web/games/assets/game1/design/balls/yellow.png",
];

type Scenario =
  | "idle"
  | "buy-popup"
  | "draw-active"
  | "pattern-won"
  | "win-screen";

const VALID_SCENARIOS: Readonly<Scenario[]> = [
  "idle",
  "buy-popup",
  "draw-active",
  "pattern-won",
  "win-screen",
];

const beacon = document.getElementById("readiness-beacon");

/** Announce to Playwright that the scenario has fully settled.
 *
 * Pauses GSAP's global timeline first so the flicker-guard test captures a
 * deterministic visual state — the CenterBall's idle-float tween (y ±4px
 * over 2.4s) would otherwise shift the pixels between consecutive snapshots
 * and mask or fake flicker regressions. CSS keyframes are frozen separately
 * by Playwright's `animations: "disabled"` option on toHaveScreenshot.
 */
function markReady(): void {
  gsap.globalTimeline.pause();
  if (beacon) beacon.setAttribute("data-ready", "true");
}

/** Guard against accidentally running multiple scenarios on one page. */
let scenarioStarted = false;

async function createPixiStage(container: HTMLElement): Promise<Application> {
  const app = new Application();
  await app.init({
    width: container.clientWidth,
    height: container.clientHeight,
    background: 0x1a0a0c, // matches PlayScreen's dark-red background
    antialias: true,
    resolution: 1,
    autoDensity: false,
  });
  container.appendChild(app.canvas);
  return app;
}

/**
 * Common fixture — HTML overlay manager + Pixi stage + ball-tube + center-ball,
 * arranged in the same rough left-to-right layout that PlayScreen uses. This
 * gives us a "baseline" of the game look without dragging in the full
 * PlayScreen constructor (which requires a GameBridge, AudioManager, and
 * socket).
 *
 * Returns `done: () => void` — callers invoke this once any scenario-specific
 * mutations (loading balls, opening popups) have settled and the page is safe
 * to snapshot.
 */
async function setupBaseLayout(): Promise<{
  pixi: Application;
  overlay: HtmlOverlayManager;
  container: HTMLElement;
}> {
  const container = document.getElementById("game-container");
  if (!container) throw new Error("No #game-container in DOM");

  const pixi = await createPixiStage(container);
  const overlay = new HtmlOverlayManager(container);

  // Position the ball-tube roughly at x=20, full container height.
  const tube = new BallTube(container.clientHeight - 40);
  tube.x = 40;
  tube.y = 20;
  pixi.stage.addChild(tube);

  // Center ball near the left-ish area, like PlayScreen puts it.
  const centerBall = new CenterBall();
  centerBall.x = 200;
  centerBall.y = 40;
  pixi.stage.addChild(centerBall);

  // Minimal header strip so the layout has a recognisable top-band.
  const header = overlay.createElement("harness-header", {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    height: "48px",
    background:
      "linear-gradient(180deg, rgba(60,10,14,0.9) 0%, rgba(30,5,7,0.6) 100%)",
    borderBottom: "1px solid rgba(255,232,61,0.2)",
    display: "flex",
    alignItems: "center",
    padding: "0 20px",
    color: "#ffe83d",
    fontSize: "16px",
    fontWeight: "600",
    letterSpacing: "1px",
  });
  header.textContent = "SPILLORAMA — HOVEDSPILL 1 (HARNESS)";

  // Expose handles for scenario-specific mutation.
  Object.assign(window as unknown as Record<string, unknown>, {
    __harnessPixi: pixi,
    __harnessTube: tube,
    __harnessCenterBall: centerBall,
    __harnessOverlay: overlay,
  });

  return { pixi, overlay, container };
}

async function runIdle(): Promise<void> {
  await setupBaseLayout();
  // Let Pixi settle one frame, then mark ready. No numbers, no popup.
  requestAnimationFrame(() => {
    setTimeout(markReady, 300);
  });
}

async function runBuyPopup(): Promise<void> {
  const { overlay } = await setupBaseLayout();
  const popup = new Game1BuyPopup(overlay);
  popup.showWithTypes(50, [
    {
      name: "Yellow",
      type: "standard",
      priceMultiplier: 1,
      ticketCount: 3,
    },
    {
      name: "Purple",
      type: "standard",
      priceMultiplier: 2,
      ticketCount: 6,
    },
    {
      name: "Red",
      type: "elvis",
      priceMultiplier: 3,
      ticketCount: 9,
    },
    {
      name: "Green",
      type: "traffic-light",
      priceMultiplier: 4,
      ticketCount: 12,
    },
  ]);
  // Popup + backdrop-filter stack takes a couple of frames to paint; 300ms
  // is well past that boundary on every target runner we've tested on.
  requestAnimationFrame(() => setTimeout(markReady, 300));
}

async function runDrawActive(): Promise<void> {
  // Pre-warm Pixi Assets cache before BallTube/CenterBall run their own
  // Assets.load calls — this guarantees the "cached path" in BallTube.ts:243
  // fires and sprites bind textures synchronously in the first frame. Without
  // this pre-warm, BallTube falls back to a procedural placeholder and the
  // first screenshot captures the wrong graphic.
  await Assets.load(BALL_ASSETS);

  await setupBaseLayout();
  const tube = (window as unknown as { __harnessTube: BallTube }).__harnessTube;
  const centerBall = (window as unknown as { __harnessCenterBall: CenterBall })
    .__harnessCenterBall;

  // Load 5 balls directly (no animation) — loadBalls() sets final positions
  // synchronously so the tube renders deterministically.
  tube.loadBalls([7, 23, 42, 58, 72]);
  centerBall.setNumber(42);

  // Two extra RAFs for the WebGL command buffer to flush to the framebuffer.
  // Without this, the first snapshot after texture-load sometimes captures
  // a partially-uploaded mipmap pyramid.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  setTimeout(markReady, 500);
}

async function runPatternWon(): Promise<void> {
  const { container } = await setupBaseLayout();
  const popup = new WinPopup(container);
  popup.show({
    rows: 2,
    amount: 500,
    onClose: () => {
      /* no-op */
    },
  });
  // WinPopup paints a shimmer sweep in the first 0.8s; snapshot after it
  // settles so we don't capture mid-sweep (flaky).
  setTimeout(markReady, 900);
}

async function runWinScreen(): Promise<void> {
  const { container } = await setupBaseLayout();
  const win = new WinScreenV2(container);
  win.show({
    amount: 2500,
    shared: false,
    headline: "BINGO! DU VANT",
    subline: "GRATULERER MED GEVINSTEN",
  });
  // WinScreenV2 has a count-up animation + fountain rAF. Wait until count-up
  // has plausibly finished (800ms) plus a small settle window.
  setTimeout(markReady, 1200);
}

async function runScenario(name: Scenario): Promise<void> {
  if (scenarioStarted) return;
  scenarioStarted = true;
  switch (name) {
    case "idle":
      await runIdle();
      break;
    case "buy-popup":
      await runBuyPopup();
      break;
    case "draw-active":
      await runDrawActive();
      break;
    case "pattern-won":
      await runPatternWon();
      break;
    case "win-screen":
      await runWinScreen();
      break;
  }
}

function parseScenario(): Scenario {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("scenario") ?? "idle";
  if (!(VALID_SCENARIOS as readonly string[]).includes(raw)) {
    throw new Error(
      `Unknown scenario "${raw}". Valid: ${VALID_SCENARIOS.join(", ")}`,
    );
  }
  return raw as Scenario;
}

function boot(): void {
  const scenario = parseScenario();
  // Announce to Playwright which scenario was chosen (visible in the trace).
  document.title = `Spill 1 Harness — ${scenario}`;
  runScenario(scenario).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const host = document.getElementById("game-container") ?? document.body;
    const banner = document.createElement("div");
    banner.style.cssText =
      "position:fixed;inset:0;background:#300;color:#fff;font-family:monospace;" +
      "font-size:16px;display:flex;align-items:center;justify-content:center;" +
      "padding:40px;text-align:center;white-space:pre-wrap;z-index:9999;";
    banner.textContent = `HARNESS ERROR\n\n${msg}`;
    host.appendChild(banner);
    // Still flip ready so Playwright doesn't hang; test will fail on the
    // banner showing up in the snapshot.
    markReady();
  });
}

boot();
