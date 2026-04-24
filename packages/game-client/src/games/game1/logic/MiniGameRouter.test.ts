/**
 * @vitest-environment happy-dom
 *
 * BIN-690 PR-M6: MiniGameRouter tests.
 *
 * Verifies the 3-step protocol:
 *   1. `mini_game:trigger` → correct overlay type + show() called.
 *   2. Overlay fires onChoice → router emits `mini_game:choice` with resultId.
 *   3. `mini_game:result` → overlay.animateResult() called.
 *
 * Plus edge cases: stale-result dropping, trigger-during-active (override),
 * socket-error fail-closed, dismiss idempotency, Oddsen two-phase flow.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Container } from "pixi.js";
import { MiniGameRouter } from "./MiniGameRouter.js";
import type { GameBridge } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { GameApp } from "../../../core/GameApp.js";
import type {
  MiniGameTriggerPayload,
  MiniGameResultPayload,
} from "@spillorama/shared-types/socket-events";

const wheelMock = vi.fn();
const chestMock = vi.fn();
const colorDraftMock = vi.fn();
const oddsenMock = vi.fn();
const mysteryMock = vi.fn();

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
vi.mock("../components/ColorDraftOverlay.js", () => ({
  ColorDraftOverlay: vi.fn().mockImplementation((...args) => {
    colorDraftMock(...args);
    return makeFakeOverlay("colordraft");
  }),
}));
vi.mock("../components/OddsenOverlay.js", () => ({
  OddsenOverlay: vi.fn().mockImplementation((...args) => {
    oddsenMock(...args);
    return makeFakeOverlay("oddsen");
  }),
}));
vi.mock("../components/MysteryGameOverlay.js", () => ({
  MysteryGameOverlay: vi.fn().mockImplementation((...args) => {
    mysteryMock(...args);
    return makeFakeOverlay("mystery");
  }),
}));

interface FakeOverlay extends Container {
  _tag: string;
  setOnChoice: (cb: (c: Readonly<Record<string, unknown>>) => void) => void;
  setOnDismiss: (cb: () => void) => void;
  show: (data: Readonly<Record<string, unknown>>) => void;
  animateResult: (data: Readonly<Record<string, unknown>>, payoutCents: number) => void;
  showChoiceError?: (err: { code: string; message: string }) => void;
  destroyed: boolean;
  _onChoice?: (c: Readonly<Record<string, unknown>>) => void;
  _onDismiss?: () => void;
}

function makeFakeOverlay(tag: string): FakeOverlay {
  const c = new Container() as FakeOverlay;
  c._tag = tag;
  c.destroyed = false;
  c.setOnChoice = (cb) => { c._onChoice = cb; };
  c.setOnDismiss = (cb) => { c._onDismiss = cb; };
  c.show = vi.fn();
  c.animateResult = vi.fn();
  c.showChoiceError = vi.fn();
  const realDestroy = c.destroy.bind(c);
  c.destroy = vi.fn((opts?: unknown) => {
    c.destroyed = true;
    return realDestroy(opts as Parameters<Container["destroy"]>[0]);
  }) as unknown as Container["destroy"];
  return c;
}

function makeDeps(
  overrides: Partial<{
    socket: SpilloramaSocket;
  }> = {},
) {
  const root = new Container();
  const sendMiniGameChoice = vi.fn().mockResolvedValue({ ok: true, data: { accepted: true } });
  const app = { app: { screen: { width: 1200, height: 800 } } } as unknown as GameApp;
  const socket = { sendMiniGameChoice } as unknown as SpilloramaSocket;
  const bridge = {} as GameBridge;
  return {
    deps: { root, app, socket: overrides.socket ?? socket, bridge },
    sendMiniGameChoice,
    root,
  };
}

function makeTrigger(
  miniGameType: "wheel" | "chest" | "colordraft" | "oddsen" | "mystery",
  payload: Readonly<Record<string, unknown>> = {},
  resultId = "mgr-test-1",
): MiniGameTriggerPayload {
  return { resultId, miniGameType, payload };
}

function makeResult(
  miniGameType: "wheel" | "chest" | "colordraft" | "oddsen" | "mystery",
  payoutCents = 0,
  resultJson: Readonly<Record<string, unknown>> = {},
  resultId = "mgr-test-1",
): MiniGameResultPayload {
  return { resultId, miniGameType, payoutCents, resultJson };
}

describe("MiniGameRouter — onTrigger overlay dispatch", () => {
  beforeEach(() => {
    wheelMock.mockReset();
    chestMock.mockReset();
    colorDraftMock.mockReset();
    oddsenMock.mockReset();
    mysteryMock.mockReset();
  });

  it("creates WheelOverlay for miniGameType=wheel", () => {
    const { deps } = makeDeps();
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("wheel"));
    expect(wheelMock).toHaveBeenCalledOnce();
    expect(chestMock).not.toHaveBeenCalled();
  });

  it("creates TreasureChestOverlay for miniGameType=chest", () => {
    const { deps } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("chest"));
    expect(chestMock).toHaveBeenCalledOnce();
  });

  it("creates ColorDraftOverlay for miniGameType=colordraft", () => {
    const { deps } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("colordraft"));
    expect(colorDraftMock).toHaveBeenCalledOnce();
  });

  it("creates OddsenOverlay for miniGameType=oddsen", () => {
    const { deps } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("oddsen"));
    expect(oddsenMock).toHaveBeenCalledOnce();
  });

  it("creates MysteryGameOverlay for miniGameType=mystery", () => {
    const { deps } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("mystery"));
    expect(mysteryMock).toHaveBeenCalledOnce();
    expect(wheelMock).not.toHaveBeenCalled();
    expect(chestMock).not.toHaveBeenCalled();
  });

  it("passes bridge to pause-aware overlays (wheel + chest)", () => {
    const { deps } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("wheel"));
    expect(wheelMock).toHaveBeenCalledWith(1200, 800, deps.bridge);
  });

  it("calls overlay.show() with the payload field (not whole trigger)", () => {
    const { deps, root } = makeDeps();
    const payload = { chestCount: 4, prizeRange: { minNok: 100, maxNok: 500 } };
    new MiniGameRouter(deps).onTrigger(makeTrigger("chest", payload));
    const overlay = root.children[0] as FakeOverlay;
    expect(overlay.show).toHaveBeenCalledWith(payload);
  });

  it("adds overlay as child of the root container", () => {
    const { deps, root } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("colordraft"));
    expect(root.children.length).toBe(1);
  });

  it("overrides any previously-active overlay on new trigger (race-safe)", () => {
    const { deps, root } = makeDeps();
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("wheel", {}, "mgr-1"));
    const first = root.children[0] as FakeOverlay;
    router.onTrigger(makeTrigger("chest", {}, "mgr-2"));
    // First overlay must be destroyed; the new one must be a live chest.
    expect(first.destroyed).toBe(true);
    // Live children should include the new chest (regardless of whether Pixi's
    // destroy() removes the old one from parent.children — the invariant we
    // care about is "only the new overlay is active").
    const live = root.children.filter((c) => !(c as FakeOverlay).destroyed) as FakeOverlay[];
    expect(live).toHaveLength(1);
    expect(live[0]._tag).toBe("chest");
  });
});

describe("MiniGameRouter — onChoice → socket.sendMiniGameChoice", () => {
  beforeEach(() => {
    wheelMock.mockReset();
    chestMock.mockReset();
    colorDraftMock.mockReset();
    oddsenMock.mockReset();
    mysteryMock.mockReset();
  });

  it("emits mini_game:choice with the active resultId + choiceJson", async () => {
    const { deps, root, sendMiniGameChoice } = makeDeps();
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("chest", {}, "mgr-abc"));
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({ chosenIndex: 3 });
    expect(sendMiniGameChoice).toHaveBeenCalledWith({
      resultId: "mgr-abc",
      choiceJson: { chosenIndex: 3 },
    });
  });

  it("accepts empty choiceJson for wheel", async () => {
    const { deps, root, sendMiniGameChoice } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("wheel", {}, "mgr-w1"));
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({});
    expect(sendMiniGameChoice).toHaveBeenCalledWith({
      resultId: "mgr-w1",
      choiceJson: {},
    });
  });

  it("passes chosenNumber for oddsen", async () => {
    const { deps, root, sendMiniGameChoice } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("oddsen", {}, "mgr-o1"));
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({ chosenNumber: 56 });
    expect(sendMiniGameChoice).toHaveBeenCalledWith({
      resultId: "mgr-o1",
      choiceJson: { chosenNumber: 56 },
    });
  });

  it("passes directions[] for mystery", async () => {
    const { deps, root, sendMiniGameChoice } = makeDeps();
    new MiniGameRouter(deps).onTrigger(makeTrigger("mystery", {}, "mgr-m1"));
    const overlay = root.children[0] as FakeOverlay;
    const directions = ["up", "down", "up", "down", "up"];
    await overlay._onChoice?.({ directions });
    expect(sendMiniGameChoice).toHaveBeenCalledWith({
      resultId: "mgr-m1",
      choiceJson: { directions },
    });
  });

  it("shows error on overlay + does NOT dismiss on socket-error (fail-closed)", async () => {
    const sendMiniGameChoice = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "BOOM", message: "boom" },
    });
    const { deps, root } = makeDeps({
      socket: { sendMiniGameChoice } as unknown as SpilloramaSocket,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("chest"));
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({ chosenIndex: 0 });
    expect(errSpy).toHaveBeenCalled();
    expect(overlay.showChoiceError).toHaveBeenCalledWith({
      code: "BOOM",
      message: "boom",
    });
    // Overlay is NOT dismissed on error — player can retry.
    expect(overlay.destroyed).toBe(false);
    expect(root.children.length).toBe(1);
    errSpy.mockRestore();
  });
});

describe("MiniGameRouter — onResult animation", () => {
  beforeEach(() => {
    wheelMock.mockReset();
    chestMock.mockReset();
    colorDraftMock.mockReset();
    oddsenMock.mockReset();
    mysteryMock.mockReset();
  });

  it("dispatches result to the active overlay when resultId matches", () => {
    const { deps, root } = makeDeps();
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("wheel", {}, "mgr-42"));
    const overlay = root.children[0] as FakeOverlay;
    router.onResult(makeResult("wheel", 5000, { winningBucketIndex: 7 }, "mgr-42"));
    expect(overlay.animateResult).toHaveBeenCalledWith(
      { winningBucketIndex: 7 },
      5000,
    );
  });

  it("drops stale result (resultId mismatch) silently", () => {
    const { deps, root } = makeDeps();
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("wheel", {}, "mgr-current"));
    const overlay = root.children[0] as FakeOverlay;
    router.onResult(makeResult("wheel", 5000, {}, "mgr-STALE"));
    expect(overlay.animateResult).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("drops result when no overlay is active", () => {
    const { deps } = makeDeps();
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const router = new MiniGameRouter(deps);
    // No onTrigger — just a stray result.
    router.onResult(makeResult("chest", 0, {}, "mgr-stray"));
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});

describe("MiniGameRouter — dismiss + destroy", () => {
  beforeEach(() => {
    wheelMock.mockReset();
    chestMock.mockReset();
    colorDraftMock.mockReset();
    oddsenMock.mockReset();
    mysteryMock.mockReset();
  });

  it("dismiss destroys the overlay and clears activeResultId", () => {
    const { deps, root } = makeDeps();
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("colordraft"));
    const overlay = root.children[0] as FakeOverlay;
    router.dismiss();
    expect(overlay.destroyed).toBe(true);
    // After dismiss, a late result for the same resultId should be dropped.
    router.onResult(makeResult("colordraft", 0));
    expect(overlay.animateResult).not.toHaveBeenCalled();
  });

  it("destroy is idempotent", () => {
    const { deps } = makeDeps();
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("wheel"));
    router.destroy();
    expect(() => router.destroy()).not.toThrow();
  });

  it("overlay-initiated dismiss wipes router state", () => {
    const { deps, root } = makeDeps();
    const router = new MiniGameRouter(deps);
    router.onTrigger(makeTrigger("oddsen"));
    const overlay = root.children[0] as FakeOverlay;
    overlay._onDismiss?.();
    expect(overlay.destroyed).toBe(true);
  });
});
