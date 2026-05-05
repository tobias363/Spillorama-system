/**
 * Spill 1/2/3 — Visual Regression Harness
 * =====================================================================
 *
 * Standalone page mounting individual game components in deterministic,
 * backend-less states. Playwright navigates here via `?scenario=<name>`,
 * waits for `#readiness-beacon[data-ready="true"]`, then snapshots the page.
 *
 * Spill 1 scenarios:
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
 * Spill 2 scenarios (rocket — 3×3 grid, 1-21 balls, ETT globalt rom):
 *   ?scenario=spill2-lobby
 *     — Empty PlayScreen-look (no bongs, BallTube viser "Neste trekning"-
 *       counter, no jackpot prizes ennå).
 *   ?scenario=spill2-buy-popup-open
 *     — Game1BuyPopup open over PlayScreen baseline.
 *   ?scenario=spill2-pre-round-2-bongs
 *     — 2 forhåndskjøpte bonger sentrert i bong-grid (per-rad-sentrering
 *       for små antall).
 *   ?scenario=spill2-running-7-bongs
 *     — 7 bonger som fyller første rad i RUNNING-state.
 *   ?scenario=spill2-running-9-bongs
 *     — 7 bonger første rad + 2 sentrert andre rad (per-rad-sentrering
 *       for "9 = 7+2").
 *   ?scenario=spill2-countdown-with-prizes
 *     — between-rounds, 3 forhåndskjøpte bonger synlige + jackpot-priser
 *       BEVART (PR #925-fix verifisering).
 *
 * Spill 3 scenarios (monsterbingo — 5×5 uten free, T/X/7/Pyramide):
 *   ?scenario=spill3-lobby
 *     — Empty Spill 3 lobby look (BallTube tom + game1 BingoTicketHtml
 *       placeholder).
 *   ?scenario=spill3-running-with-bongs
 *     — 1-2 5×5-bonger uten free-center, noen marker, ball-tube med
 *       trukne baller.
 *   ?scenario=g3-pattern-row
 *     — Game3PatternRow (T/X/7/Pyramide à 25%) standalone.
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
import { BingoTicketHtml } from "../games/game1/components/BingoTicketHtml.js";
import { Game3PatternRow } from "../games/game3/components/Game3PatternRow.js";
import { PlayScreen as Game2PlayScreen } from "../games/game2/screens/PlayScreen.js";
import { BallTube as Game2BallTube } from "../games/game2/components/BallTube.js";
import { AudioManager } from "../audio/AudioManager.js";
import type { GameState } from "../bridge/GameBridge.js";
import type {
  PatternDefinition,
  PatternResult,
  Ticket,
} from "@spillorama/shared-types/game";

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
  | "win-screen"
  | "g3-pattern-row"
  | "spill2-lobby"
  | "spill2-buy-popup-open"
  | "spill2-pre-round-2-bongs"
  | "spill2-running-7-bongs"
  | "spill2-running-9-bongs"
  | "spill2-countdown-with-prizes"
  | "spill3-lobby"
  | "spill3-running-with-bongs";

const VALID_SCENARIOS: Readonly<Scenario[]> = [
  "idle",
  "buy-popup",
  "draw-active",
  "pattern-won",
  "win-screen",
  "g3-pattern-row",
  "spill2-lobby",
  "spill2-buy-popup-open",
  "spill2-pre-round-2-bongs",
  "spill2-running-7-bongs",
  "spill2-running-9-bongs",
  "spill2-countdown-with-prizes",
  "spill3-lobby",
  "spill3-running-with-bongs",
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

/**
 * Bare-bones Pixi stage for Spill 2/3 scenarios. Skips the Spill 1-specific
 * fixture (game1 BallTube + CenterBall) so each game can build its own
 * baseline without leftover Spill 1 chrome bleeding into snapshots.
 */
async function setupEmptyStage(): Promise<{
  pixi: Application;
  container: HTMLElement;
}> {
  const container = document.getElementById("game-container");
  if (!container) throw new Error("No #game-container in DOM");
  const pixi = await createPixiStage(container);
  Object.assign(window as unknown as Record<string, unknown>, {
    __harnessPixi: pixi,
  });
  return { pixi, container };
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

/**
 * Spill 3 — pattern-row scenario.
 *
 * Mountes Game3PatternRow standalone i en CenterTopPanel-lignende
 * containerstil for å verifisere de 4 mini-grids visuelt
 * (T / X / 7 / Pyramide). Patterns speiler `DEFAULT_GAME3_CONFIG.patterns`
 * 1:1, så det vi ser her er hva spilleren faktisk får i live spill.
 */
async function runG3PatternRow(): Promise<void> {
  await setupBaseLayout();
  const container = document.getElementById("game-container");
  if (!container) throw new Error("No #game-container in DOM");

  // Bygg en synlig CenterTopPanel-aktig boks rundt pattern-rad så vi ser
  // typisk dimensjon (376px combo-bredde) og kontrast.
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:absolute",
    "top:80px",
    "left:240px",
    "padding:15px 26px",
    "width:376px",
    "background:linear-gradient(180deg, rgba(60,10,14,0.9) 0%, rgba(30,5,7,0.6) 100%)",
    "border:1px solid rgba(255,232,61,0.2)",
    "border-radius:6px",
    "box-shadow:0 4px 20px rgba(0,0,0,0.6), inset 0 0 12px rgba(120,30,30,0.2)",
    "z-index:10",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText =
    "color:#ffe83d;font-size:11px;font-weight:700;letter-spacing:0.6px;margin-bottom:8px;";
  header.textContent = "SPILL 3 — MØNSTERBINGO";
  wrapper.appendChild(header);

  const cellsToBitmask = (cells: number[]): number[] => {
    const mask = new Array(25).fill(0);
    for (const c of cells) mask[c] = 1;
    return mask;
  };

  const patterns: PatternDefinition[] = [
    {
      id: "p-topp-midt",
      name: "Topp + midt",
      claimType: "BINGO",
      prizePercent: 25,
      order: 0,
      design: 0,
      patternDataList: cellsToBitmask([0, 1, 2, 3, 4, 7, 12, 17, 22]),
    },
    {
      id: "p-kryss",
      name: "Kryss",
      claimType: "BINGO",
      prizePercent: 25,
      order: 1,
      design: 0,
      patternDataList: cellsToBitmask([0, 4, 6, 8, 12, 16, 18, 20, 24]),
    },
    {
      id: "p-topp-diag",
      name: "Topp + diagonal",
      claimType: "BINGO",
      prizePercent: 25,
      order: 2,
      design: 0,
      patternDataList: cellsToBitmask([0, 1, 2, 3, 4, 8, 12, 16, 20]),
    },
    {
      id: "p-pyramide",
      name: "Pyramide",
      claimType: "BINGO",
      prizePercent: 25,
      order: 3,
      design: 0,
      patternDataList: cellsToBitmask([12, 16, 17, 18, 20, 21, 22, 23, 24]),
    },
  ];

  // Vis en typisk mid-runde-state: første pattern vunnet, andre aktiv.
  const results: PatternResult[] = [
    {
      patternId: "p-topp-midt",
      patternName: "Topp + midt",
      claimType: "BINGO",
      isWon: true,
      payoutAmount: 250,
    },
  ];

  const row = new Game3PatternRow();
  wrapper.appendChild(row.root);
  container.appendChild(wrapper);

  // 1000 kr pot → 25% = 250 kr per pattern.
  row.update(patterns, results, 1000, true);

  setTimeout(markReady, 300);
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

// ────────────────────────────────────────────────────────────────────────────
// Spill 2 (rocket) scenarios
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a synthetic GameState for Spill 2 scenarios. All fields are filled
 * with deterministic defaults so PlayScreen.buildTickets / updateInfo render
 * a stable frame. Callers override the fields they need (gameStatus,
 * preRoundTickets, myTickets, drawnNumbers, jackpot prizes).
 *
 * Spill 2 has ÉN ticket-type ("Standard") per PR #856 — `ticketTypes` therefore
 * has a single entry. `entryFee` is the price-per-bong (default 20 kr).
 */
function makeSpill2State(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    roomCode: "harness-spill2",
    hallId: "harness-hall",
    gameStatus: "WAITING",
    gameId: null,
    players: [],
    playerCount: 1,
    drawnNumbers: [],
    lastDrawnNumber: null,
    drawCount: 0,
    totalDrawCapacity: 21,
    myTickets: [],
    myMarks: [],
    myPlayerId: "harness-player",
    patterns: [],
    patternResults: [],
    prizePool: 0,
    entryFee: 20,
    myLuckyNumber: null,
    luckyNumbers: {},
    millisUntilNextStart: 30_000,
    autoDrawEnabled: true,
    canStartNow: false,
    disableBuyAfterBalls: 0,
    isPaused: false,
    pauseMessage: null,
    pauseUntil: null,
    pauseReason: null,
    gameType: "rocket",
    ticketTypes: [
      { name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 },
    ],
    replaceAmount: 0,
    jackpot: null,
    preRoundTickets: [],
    isArmed: false,
    myStake: 0,
    myPendingStake: 0,
    serverTimestamp: Date.now(),
  };
  return { ...base, ...overrides };
}

/**
 * Generate a deterministic 3×3 ticket grid for Spill 2 with `n` unique numbers
 * in the [1,21] range. Same seed → same ticket so snapshots stay stable.
 */
function makeSpill2Ticket(seed: number, label = "Standard"): Ticket {
  // Generate 9 unique numbers in [1,21] from a tiny LCG so the same seed
  // always produces the same grid.
  const used = new Set<number>();
  const out: number[] = [];
  let s = seed * 1103515245 + 12345;
  while (out.length < 9) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = (s % 21) + 1;
    if (!used.has(n)) {
      used.add(n);
      out.push(n);
    }
  }
  out.sort((a, b) => a - b);
  return {
    id: `harness-ticket-${seed}`,
    grid: [out.slice(0, 3), out.slice(3, 6), out.slice(6, 9)],
    color: label,
    type: "game2-3x3",
    price: 20,
  };
}

/**
 * Build a Spill 2 PlayScreen attached to #game-container. Returns the
 * PlayScreen handle so callers can drive buildTickets / updateInfo /
 * showBuyPopupForNextRound after construction.
 *
 * The audio module loads SFX as a side effect; we ignore the resulting
 * Howl-load promises since the harness only verifies layout, not sound.
 */
async function mountSpill2PlayScreen(): Promise<{
  pixi: Application;
  screen: Game2PlayScreen;
}> {
  // Pre-warm ball PNGs so BallTube renders sprites in first frame
  // (otherwise the first snapshot can capture procedural placeholders).
  await Assets.load(BALL_ASSETS);
  const { pixi, container } = await setupEmptyStage();
  const audio = new AudioManager();
  const screen = new Game2PlayScreen(
    container.clientWidth,
    container.clientHeight,
    audio,
  );
  pixi.stage.addChild(screen);
  Object.assign(window as unknown as Record<string, unknown>, {
    __harnessSpill2: screen,
  });
  return { pixi, screen };
}

async function runSpill2Lobby(): Promise<void> {
  const { screen } = await mountSpill2PlayScreen();
  // Tom lobby: ingen bonger, gameStatus=WAITING. BallTube viser "Neste
  // trekning"-counter (setRunning(false) er default for non-RUNNING) og
  // ComboPanel viser PlayerCard + Lykketall + Jackpot-rad uten priser.
  const state = makeSpill2State({
    gameStatus: "WAITING",
    millisUntilNextStart: 30_000,
  });
  screen.buildTickets(state);
  screen.updateInfo(state);
  // Two RAFs for Pixi command buffer + 300ms for any settle-tween.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  setTimeout(markReady, 400);
}

async function runSpill2BuyPopupOpen(): Promise<void> {
  const { screen } = await mountSpill2PlayScreen();
  const state = makeSpill2State({
    gameStatus: "WAITING",
    millisUntilNextStart: 25_000,
  });
  screen.buildTickets(state);
  screen.updateInfo(state);
  // Trigger the same flow Game2Controller uses ~25s before round-start.
  screen.showBuyPopupForNextRound();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  // BuyPopup paints with backdrop-filter; give it 400ms to settle so we
  // don't snapshot a half-drawn blur.
  setTimeout(markReady, 500);
}

async function runSpill2PreRound2Bongs(): Promise<void> {
  const { screen } = await mountSpill2PlayScreen();
  // 2 forhåndskjøpte bonger sentrert i bong-grid. Per-rad-sentrering: én rad
  // med 2 bonger sentrert horisontalt iht. layoutBongGrid:597-611.
  const state = makeSpill2State({
    gameStatus: "WAITING",
    millisUntilNextStart: 18_000,
    preRoundTickets: [makeSpill2Ticket(1), makeSpill2Ticket(2)],
    isArmed: true,
    myPendingStake: 40,
  });
  screen.buildTickets(state);
  screen.updateInfo(state);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  setTimeout(markReady, 400);
}

async function runSpill2Running7Bongs(): Promise<void> {
  const { screen } = await mountSpill2PlayScreen();
  // 7 bonger som fyller første rad i RUNNING-state. BallTube viser "Trekk"-
  // raden uten "Neste trekning"-counter (setRunning(true)).
  const tickets = Array.from({ length: 7 }, (_, i) => makeSpill2Ticket(i + 10));
  // Hver bong er allerede markert med 2 trukne baller for å vise hvordan
  // markering ser ut mid-round (røde celler vs. lys-hvite umarkerte).
  const drawnNumbers = [3, 7, 12];
  const myMarks = tickets.map((t) =>
    t.grid.flat().filter((n) => drawnNumbers.includes(n)),
  );
  const state = makeSpill2State({
    gameStatus: "RUNNING",
    millisUntilNextStart: null,
    myTickets: tickets,
    myMarks,
    drawnNumbers,
    lastDrawnNumber: 12,
    drawCount: 3,
    myStake: 140,
  });
  screen.buildTickets(state);
  screen.updateInfo(state);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  setTimeout(markReady, 500);
}

async function runSpill2Running9Bongs(): Promise<void> {
  const { screen } = await mountSpill2PlayScreen();
  // 9 bonger: rad 1 = 7 sentrert (full bredde), rad 2 = 2 sentrert. Tester
  // per-rad-sentrering for "9 = 7+2" iht. layoutBongGrid-kommentar
  // ("Speiler Spill 1's HTML-grid med justify-content: center der partielle
  // rader auto-sentreres").
  const tickets = Array.from({ length: 9 }, (_, i) => makeSpill2Ticket(i + 20));
  const drawnNumbers = [5, 14, 18];
  const myMarks = tickets.map((t) =>
    t.grid.flat().filter((n) => drawnNumbers.includes(n)),
  );
  const state = makeSpill2State({
    gameStatus: "RUNNING",
    millisUntilNextStart: null,
    myTickets: tickets,
    myMarks,
    drawnNumbers,
    lastDrawnNumber: 18,
    drawCount: 3,
    myStake: 180,
  });
  screen.buildTickets(state);
  screen.updateInfo(state);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  setTimeout(markReady, 500);
}

async function runSpill2CountdownWithPrizes(): Promise<void> {
  const { screen } = await mountSpill2PlayScreen();
  // Between-rounds (ENDED → countdown), 3 forhåndskjøpte bonger synlige +
  // jackpot-priser BEVART (PR #925 — under nedtelling sender server prize=0
  // for alle slots, men JackpotsRow.update beholder forrige rundes priser
  // hvis vi tidligere har hatt non-zero verdier).
  //
  // Vi simulerer dette ved først å pushe et non-zero jackpot-list, så et
  // alle-null-list — JackpotsRow skal beholde de første verdiene.
  const state = makeSpill2State({
    gameStatus: "ENDED",
    millisUntilNextStart: 22_000,
    preRoundTickets: [
      makeSpill2Ticket(30),
      makeSpill2Ticket(31),
      makeSpill2Ticket(32),
    ],
    isArmed: true,
    myPendingStake: 60,
  });
  screen.buildTickets(state);
  screen.updateInfo(state);
  // Send first non-zero prize-list (forrige rundes priser).
  screen.updateJackpot([
    { number: "9", prize: 80, type: "gain" },
    { number: "10", prize: 120, type: "gain" },
    { number: "11", prize: 200, type: "gain" },
    { number: "12", prize: 350, type: "gain" },
    { number: "13", prize: 600, type: "gain" },
    { number: "14-21", prize: 4000, type: "jackpot" },
  ]);
  // Send all-zero (countdown-state). JackpotsRow.update skipper denne så
  // priser fra forrige runde fortsatt vises.
  screen.updateJackpot([
    { number: "9", prize: 0, type: "gain" },
    { number: "10", prize: 0, type: "gain" },
    { number: "11", prize: 0, type: "gain" },
    { number: "12", prize: 0, type: "gain" },
    { number: "13", prize: 0, type: "gain" },
    { number: "14-21", prize: 0, type: "jackpot" },
  ]);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  setTimeout(markReady, 500);
}

// ────────────────────────────────────────────────────────────────────────────
// Spill 3 (monsterbingo) scenarios
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a deterministic Spill 3 ticket — 5×5 grid uten free-center, 25 unike
 * tall i [1,75]. Standard ticket-type som matcher Game3Controller (ÉN type
 * "Standard" / `monsterbingo-5x5`).
 */
function makeSpill3Ticket(seed: number): Ticket {
  const used = new Set<number>();
  const out: number[] = [];
  let s = seed * 1103515245 + 12345;
  while (out.length < 25) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = (s % 75) + 1;
    if (!used.has(n)) {
      used.add(n);
      out.push(n);
    }
  }
  // 5×5 layout, ingen FREE i sentercelle (Spill 3 har ikke fri sentercelle).
  const grid: number[][] = [];
  for (let r = 0; r < 5; r++) {
    grid.push(out.slice(r * 5, r * 5 + 5));
  }
  return {
    id: `harness-spill3-ticket-${seed}`,
    grid,
    color: "Standard",
    type: "monsterbingo-5x5",
    price: 50,
    ticketNumber: String(seed),
    hallName: "Harness Hall",
    supplierName: "Spillorama",
  };
}

/**
 * Spill 3-baseline: bare-bones Pixi stage + game1 BallTube + en HTML-overlay
 * containerstil for å mounte BingoTicketHtml(rows=5, cols=5). Vi bruker
 * Game1-komponenter direkte fordi Spill 3 reuses Game1 PlayScreen
 * (Game3Controller bruker Game1 PlayScreen som hovedshell).
 */
async function setupSpill3Baseline(): Promise<{
  pixi: Application;
  container: HTMLElement;
  tube: BallTube;
}> {
  await Assets.load(BALL_ASSETS);
  const { pixi, container } = await setupEmptyStage();
  // BallTube i venstre kant — speilet av Game1 PlayScreen-layout (tube i
  // 140px-bred kolonne lengst til venstre).
  const tube = new BallTube(container.clientHeight - 40);
  tube.x = 20;
  tube.y = 20;
  pixi.stage.addChild(tube);

  // Header-strip så scenario-snapshot er gjenkjennelig.
  const header = document.createElement("div");
  header.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    "right:0",
    "height:48px",
    "background:linear-gradient(180deg, rgba(60,10,14,0.9) 0%, rgba(30,5,7,0.6) 100%)",
    "border-bottom:1px solid rgba(255,232,61,0.2)",
    "display:flex",
    "align-items:center",
    "padding:0 20px",
    "color:#ffe83d",
    "font-size:16px",
    "font-weight:600",
    "letter-spacing:1px",
    "z-index:5",
  ].join(";");
  header.textContent = "SPILLORAMA — HOVEDSPILL 3 (HARNESS)";
  container.appendChild(header);

  Object.assign(window as unknown as Record<string, unknown>, {
    __harnessSpill3Tube: tube,
  });
  return { pixi, container, tube };
}

async function runSpill3Lobby(): Promise<void> {
  const { container } = await setupSpill3Baseline();
  // Tom lobby — ingen bonger, BallTube uten baller. Viser bare baseline-
  // chrome (header + tom tube). Speilet av "før innkjøp"-state i Game1
  // PlayScreen som Game3Controller bruker.
  const placeholder = document.createElement("div");
  placeholder.style.cssText = [
    "position:absolute",
    "top:50%",
    "left:50%",
    "transform:translate(-50%, -50%)",
    "color:rgba(245,232,216,0.55)",
    "font-size:18px",
    "font-weight:500",
    "text-align:center",
    "pointer-events:none",
  ].join(";");
  placeholder.textContent =
    "Mønsterbingo — venter på neste runde\n5×5 uten free • T / X / 7 / Pyramide";
  placeholder.style.whiteSpace = "pre-line";
  container.appendChild(placeholder);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  setTimeout(markReady, 400);
}

async function runSpill3RunningWithBongs(): Promise<void> {
  const { container, tube } = await setupSpill3Baseline();
  // Last 8 trukne baller i tuben for å vise mid-round-state.
  tube.loadBalls([7, 19, 23, 31, 42, 55, 64, 70]);

  // 2 BingoTicketHtml-bonger 5×5 uten free-center. BingoTicketHtml håndterer
  // dette automatisk når ticket.grid har en non-zero sentercelle (i.e.
  // monsterbingo-5x5 har 25 unike tall, ingen free 0-celle).
  const grid = document.createElement("div");
  grid.style.cssText = [
    "position:absolute",
    "top:80px",
    "left:200px",
    "right:40px",
    "display:grid",
    "grid-template-columns:repeat(2, 1fr)",
    "gap:24px",
    "z-index:6",
  ].join(";");

  const ticket1 = makeSpill3Ticket(101);
  const ticket2 = makeSpill3Ticket(102);
  // Marker noen celler så vinning-progresjonen er synlig.
  const drawn = [7, 19, 23, 31, 42, 55, 64, 70];

  const bong1 = new BingoTicketHtml({
    ticket: ticket1,
    price: 50,
    rows: 5,
    cols: 5,
    cancelable: false,
  });
  bong1.markNumbers(drawn.filter((n) => ticket1.grid.flat().includes(n)));
  grid.appendChild(bong1.root);

  const bong2 = new BingoTicketHtml({
    ticket: ticket2,
    price: 50,
    rows: 5,
    cols: 5,
    cancelable: false,
  });
  bong2.markNumbers(drawn.filter((n) => ticket2.grid.flat().includes(n)));
  grid.appendChild(bong2.root);

  container.appendChild(grid);

  // To RAFs for WebGL-tube + DOM-bonger settle.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  setTimeout(markReady, 500);
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
    case "g3-pattern-row":
      await runG3PatternRow();
      break;
    case "spill2-lobby":
      await runSpill2Lobby();
      break;
    case "spill2-buy-popup-open":
      await runSpill2BuyPopupOpen();
      break;
    case "spill2-pre-round-2-bongs":
      await runSpill2PreRound2Bongs();
      break;
    case "spill2-running-7-bongs":
      await runSpill2Running7Bongs();
      break;
    case "spill2-running-9-bongs":
      await runSpill2Running9Bongs();
      break;
    case "spill2-countdown-with-prizes":
      await runSpill2CountdownWithPrizes();
      break;
    case "spill3-lobby":
      await runSpill3Lobby();
      break;
    case "spill3-running-with-bongs":
      await runSpill3RunningWithBongs();
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
  document.title = `Spillorama Harness — ${scenario}`;
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

// Suppress unused-import warning for Game2BallTube — currently we mount the
// full PlayScreen which constructs its own BallTube, but the import keeps the
// dependency graph explicit if a future scenario wants a standalone tube.
void Game2BallTube;

boot();
