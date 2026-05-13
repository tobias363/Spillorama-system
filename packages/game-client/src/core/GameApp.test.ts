/**
 * @vitest-environment happy-dom
 *
 * PIXI-P0-001 (Bølge 2A pilot-blockers, 2026-04-28): GameApp tests.
 *
 * The audit `docs/audit/GAME_CLIENT_PIXI_AUDIT_2026-04-28.md` identified the
 * uncapped Pixi v8 ticker as the load-bearing precondition for the entire
 * "blink" bug class (7 fix-rounds and counting). The Bølge 2A stopgap is a
 * single line — `app.ticker.maxFPS = 60` — added in `init()` right after
 * `Application.init` resolves. The full ticker-lease refactor (Plan B in
 * `SPILL1_BLINK_ELIMINATION_RUNDE_7 §5`) is deferred to Bølge 3.
 *
 * This test verifies the stopgap holds: after `GameApp.init()` resolves, the
 * Pixi ticker's `maxFPS` is exactly 60. If a future refactor accidentally
 * removes the cap, this test fires.
 *
 * Pixi's real `Application.init` requires a WebGL renderer which happy-dom
 * cannot provide, so we mock the Pixi entry-points the constructor + init
 * actually touch. The test is intentionally narrow: it verifies the
 * contract — not Pixi internals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const tickerInstance = { maxFPS: 0, autoStart: true, start: vi.fn(), stop: vi.fn() };
const stageInstance = { addChild: vi.fn() };

const initMock = vi.fn().mockResolvedValue(undefined);
const destroyMock = vi.fn();

vi.mock("pixi.js", async () => {
  const actual = await vi.importActual<typeof import("pixi.js")>("pixi.js");
  class FakeApplication {
    // Allocate a real DOM canvas per instance so happy-dom appendChild works.
    private _canvas: HTMLCanvasElement = document.createElement("canvas");
    init = initMock;
    destroy = destroyMock;
    get ticker() {
      return tickerInstance;
    }
    get stage() {
      return stageInstance;
    }
    get canvas() {
      return this._canvas;
    }
  }
  return {
    ...actual,
    Application: FakeApplication,
  };
});

// Stub everything GameApp.init touches downstream so the test stays focused
// on the ticker-cap invariant. None of these branches execute their real
// implementations — they just need to exist as no-ops.
vi.mock("../net/SpilloramaSocket.js", () => ({
  SpilloramaSocket: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: () => false,
    on: vi.fn(() => () => {}),
  })),
}));
vi.mock("../bridge/GameBridge.js", () => ({
  GameBridge: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    on: vi.fn(() => () => {}),
    getState: vi.fn(() => ({})),
    getGapMetrics: vi.fn(() => ({ gaps: 0, duplicates: 0, lastAppliedDrawIndex: 0 })),
  })),
}));
vi.mock("../audio/AudioManager.js", () => ({
  AudioManager: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("../telemetry/Telemetry.js", () => ({
  telemetry: {
    init: vi.fn(),
    trackFunnelStep: vi.fn(),
    trackEvent: vi.fn(),
  },
}));
vi.mock("../telemetry/Sentry.js", () => ({
  initSentry: vi.fn().mockResolvedValue(undefined),
  captureClientMessage: vi.fn(),
  captureClientError: vi.fn(),
  addClientBreadcrumb: vi.fn(),
  setClientSentryTag: vi.fn(),
  setClientSentryUser: vi.fn().mockResolvedValue(undefined),
  hashPii: vi.fn(async () => "hashedpii12"),
}));
vi.mock("../observability/sentryBootstrap.js", () => ({
  bootstrapClientSentry: vi.fn().mockResolvedValue(undefined),
  setClientScreen: vi.fn(),
  setClientScheduledGameId: vi.fn(),
  setClientPlanRunId: vi.fn(),
  updateClientSentryUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../components/LoadingOverlay.js", () => ({
  LoadingOverlay: vi.fn().mockImplementation(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
  })),
}));
vi.mock("./WebGLContextGuard.js", () => ({
  WebGLContextGuard: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("../games/registry.js", () => ({
  registryReady: Promise.resolve(),
  createGame: vi.fn(() => null),
}));

import { GameApp } from "./GameApp.js";

describe("PIXI-P0-001: GameApp ticker maxFPS cap", () => {
  beforeEach(() => {
    initMock.mockClear();
    tickerInstance.maxFPS = 0; // simulate Pixi default ("uncapped" = 0)
  });

  it("caps app.ticker.maxFPS to 60 after init() resolves", async () => {
    const container = document.createElement("div");
    const game = new GameApp();
    await game.init(container, {
      gameSlug: "bingo",
      accessToken: "test-token",
      hallId: "hall-a",
      serverUrl: "http://localhost:4000",
    });

    // The structural fix: after Pixi has been initialised, the ticker must
    // be capped at 60 fps. Stopgap from the 2026-04-28 audit.
    expect(tickerInstance.maxFPS).toBe(60);
  });

  it("calls Pixi Application.init with the documented config (smoke check)", async () => {
    const container = document.createElement("div");
    const game = new GameApp();
    await game.init(container, {
      gameSlug: "bingo",
      accessToken: "test-token",
      hallId: "hall-a",
      serverUrl: "http://localhost:4000",
    });

    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resizeTo: container,
        antialias: true,
        autoDensity: true,
      }),
    );
  });
});
