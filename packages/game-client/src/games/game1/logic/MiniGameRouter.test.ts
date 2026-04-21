/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Container } from "pixi.js";
import { MiniGameRouter } from "./MiniGameRouter.js";
import type { GameBridge } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { GameApp } from "../../../core/GameApp.js";
import type { MiniGameActivatedPayload } from "@spillorama/shared-types/socket-events";

// Mocke alle overlay-klassene — testene bryr seg ikke om Pixi-rendering, bare
// at riktig overlay-klasse instansieres per mini-game-type.
const wheelMock = vi.fn();
const chestMock = vi.fn();
const mysteryMock = vi.fn();
const colorDraftMock = vi.fn();

vi.mock("../components/WheelOverlay.js", () => ({
  WheelOverlay: vi.fn().mockImplementation((...args) => {
    wheelMock(...args);
    return makeFakeOverlay("wheel");
  }),
}));
vi.mock("../components/TreasureChestOverlay.js", () => ({
  TreasureChestOverlay: vi.fn().mockImplementation((...args) => {
    chestMock(...args);
    return makeFakeOverlay("chest");
  }),
}));
vi.mock("../components/MysteryGameOverlay.js", () => ({
  MysteryGameOverlay: vi.fn().mockImplementation((...args) => {
    mysteryMock(...args);
    return makeFakeOverlay("mystery");
  }),
}));
vi.mock("../components/ColorDraftOverlay.js", () => ({
  ColorDraftOverlay: vi.fn().mockImplementation((...args) => {
    colorDraftMock(...args);
    return makeFakeOverlay("colorDraft");
  }),
}));

interface FakeOverlay extends Container {
  _tag: string;
  setOnPlay: (cb: (idx?: number) => void) => void;
  setOnDismiss: (cb: () => void) => void;
  show: (data: MiniGameActivatedPayload) => void;
  animateResult: (data: unknown) => void;
  destroyed: boolean;
  _onPlay?: (idx?: number) => void;
  _onDismiss?: () => void;
}

function makeFakeOverlay(tag: string): FakeOverlay {
  const c = new Container() as FakeOverlay;
  c._tag = tag;
  c.destroyed = false;
  c.setOnPlay = (cb) => { c._onPlay = cb; };
  c.setOnDismiss = (cb) => { c._onDismiss = cb; };
  c.show = vi.fn();
  c.animateResult = vi.fn();
  // Pixi's destroy() sets destroyed=true; make our fake equivalent.
  const realDestroy = c.destroy.bind(c);
  c.destroy = vi.fn((opts?: unknown) => {
    c.destroyed = true;
    return realDestroy(opts as Parameters<Container["destroy"]>[0]);
  }) as unknown as Container["destroy"];
  return c;
}

function makeDeps(overrides: Partial<Parameters<typeof MiniGameRouter>[0]> = {}) {
  const root = new Container();
  const playMiniGame = vi.fn().mockResolvedValue({ ok: true, data: { type: "wheelOfFortune", prizeAmount: 50 } });
  const app = { app: { screen: { width: 1200, height: 800 } } } as unknown as GameApp;
  const socket = { playMiniGame } as unknown as SpilloramaSocket;
  const bridge = {} as GameBridge;
  return {
    deps: { root, app, socket, bridge, getRoomCode: () => "ROOM-1", ...overrides },
    playMiniGame,
    root,
  };
}

describe("MiniGameRouter", () => {
  beforeEach(() => {
    wheelMock.mockReset();
    chestMock.mockReset();
    mysteryMock.mockReset();
    colorDraftMock.mockReset();
  });

  describe("onActivated", () => {
    it("creates WheelOverlay for wheelOfFortune", () => {
      const { deps } = makeDeps();
      const router = new MiniGameRouter(deps);
      router.onActivated({ type: "wheelOfFortune" } as MiniGameActivatedPayload);
      expect(wheelMock).toHaveBeenCalledOnce();
      expect(chestMock).not.toHaveBeenCalled();
    });

    it("creates MysteryGameOverlay for mysteryGame", () => {
      const { deps } = makeDeps();
      new MiniGameRouter(deps).onActivated({ type: "mysteryGame" } as MiniGameActivatedPayload);
      expect(mysteryMock).toHaveBeenCalledOnce();
    });

    it("creates ColorDraftOverlay for colorDraft", () => {
      const { deps } = makeDeps();
      new MiniGameRouter(deps).onActivated({ type: "colorDraft" } as MiniGameActivatedPayload);
      expect(colorDraftMock).toHaveBeenCalledOnce();
    });

    it("defaults to TreasureChestOverlay for unknown types", () => {
      const { deps } = makeDeps();
      new MiniGameRouter(deps).onActivated({ type: "treasureChest" } as MiniGameActivatedPayload);
      expect(chestMock).toHaveBeenCalledOnce();
    });

    it("passes bridge to pause-aware overlays (wheel + chest)", () => {
      const { deps } = makeDeps();
      new MiniGameRouter(deps).onActivated({ type: "wheelOfFortune" } as MiniGameActivatedPayload);
      // 3rd arg is the bridge for WheelOverlay
      expect(wheelMock).toHaveBeenCalledWith(1200, 800, deps.bridge);
    });

    it("adds overlay as child of the root container", () => {
      const { deps, root } = makeDeps();
      new MiniGameRouter(deps).onActivated({ type: "colorDraft" } as MiniGameActivatedPayload);
      expect(root.children.length).toBe(1);
    });
  });

  describe("play", () => {
    it("calls socket.playMiniGame with the active room code + selected index", async () => {
      const { deps, playMiniGame } = makeDeps();
      const router = new MiniGameRouter(deps);
      router.onActivated({ type: "colorDraft" } as MiniGameActivatedPayload);
      // Grab the registered play-callback and fire it with an index
      const overlay = deps.root.children[0] as FakeOverlay;
      await overlay._onPlay?.(3);
      expect(playMiniGame).toHaveBeenCalledWith({ roomCode: "ROOM-1", selectedIndex: 3 });
    });

    it("passes selectedIndex=undefined for wheel (no selection)", async () => {
      const { deps, playMiniGame } = makeDeps();
      const router = new MiniGameRouter(deps);
      router.onActivated({ type: "wheelOfFortune" } as MiniGameActivatedPayload);
      const overlay = deps.root.children[0] as FakeOverlay;
      await overlay._onPlay?.();
      expect(playMiniGame).toHaveBeenCalledWith({ roomCode: "ROOM-1", selectedIndex: undefined });
    });

    it("animates result on successful play", async () => {
      const { deps } = makeDeps();
      new MiniGameRouter(deps).onActivated({ type: "wheelOfFortune" } as MiniGameActivatedPayload);
      const overlay = deps.root.children[0] as FakeOverlay;
      await overlay._onPlay?.();
      expect(overlay.animateResult).toHaveBeenCalledOnce();
    });

    it("logs + does not throw on socket error", async () => {
      const playMiniGame = vi.fn().mockResolvedValue({ ok: false, error: { message: "boom" } });
      const { deps } = makeDeps({ socket: { playMiniGame } as unknown as SpilloramaSocket });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      new MiniGameRouter(deps).onActivated({ type: "wheelOfFortune" } as MiniGameActivatedPayload);
      const overlay = deps.root.children[0] as FakeOverlay;
      await expect(overlay._onPlay?.()).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe("dismiss + destroy", () => {
    it("dismiss destroys the overlay and clears state", () => {
      const { deps } = makeDeps();
      const router = new MiniGameRouter(deps);
      router.onActivated({ type: "colorDraft" } as MiniGameActivatedPayload);
      const overlay = deps.root.children[0] as FakeOverlay;
      router.dismiss();
      expect(overlay.destroyed).toBe(true);
    });

    it("destroy is idempotent", () => {
      const { deps } = makeDeps();
      const router = new MiniGameRouter(deps);
      router.onActivated({ type: "wheelOfFortune" } as MiniGameActivatedPayload);
      router.destroy();
      expect(() => router.destroy()).not.toThrow();
    });

    it("overlay's dismiss-callback wipes router state", () => {
      const { deps } = makeDeps();
      const router = new MiniGameRouter(deps);
      router.onActivated({ type: "mysteryGame" } as MiniGameActivatedPayload);
      const overlay = deps.root.children[0] as FakeOverlay;
      overlay._onDismiss?.();
      expect(overlay.destroyed).toBe(true);
    });
  });
});
