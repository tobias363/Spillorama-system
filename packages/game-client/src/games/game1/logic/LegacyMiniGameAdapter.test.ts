/**
 * @vitest-environment happy-dom
 *
 * Tobias prod-incident 2026-04-29: tests for `LegacyMiniGameAdapter`.
 *
 * Verifies the legacy `minigame:activated` → M6-overlay adapter:
 *   1. Trigger payload synthesis maps each legacy type to the right shape
 *      that the existing overlays understand.
 *   2. Result payload synthesis converts the legacy `minigame:play` ack
 *      into an M6-shaped result the overlays' `animateResult` can render.
 *   3. The adapter routes choice events through `socket.playMiniGame`
 *      (NOT `sendMiniGameChoice`) — preserving the legacy auto-claim
 *      protocol on the wire.
 *   4. Single-overlay invariant: a new activate dismisses the previous.
 *   5. Failed ack → overlay shows error and is NOT dismissed.
 *
 * Mock-pattern mirrors `MiniGameRouter.test.ts`: the four overlays are
 * mocked so we can verify full choice round-trip without spinning up the
 * heavy DOM/Pixi components.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "pixi.js";
import {
  synthesizeTriggerPayload,
  synthesizeResultPayload,
  LegacyMiniGameAdapter,
} from "./LegacyMiniGameAdapter.js";
import type {
  MiniGameActivatedPayload,
  MiniGamePlayResult,
} from "@spillorama/shared-types/socket-events";
import type { GameApp } from "../../../core/GameApp.js";
import type { GameBridge } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";

// ── Mock overlays so we can drive choice/animateResult deterministically ────

const wheelMock = vi.fn();
const chestMock = vi.fn();
const colorDraftMock = vi.fn();
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
  c.setOnChoice = (cb): void => {
    c._onChoice = cb;
  };
  c.setOnDismiss = (cb): void => {
    c._onDismiss = cb;
  };
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

// ── Trigger-payload shape tests ─────────────────────────────────────────

describe("synthesizeTriggerPayload — adapts legacy MiniGameActivatedPayload to overlay shape", () => {
  it("wheelOfFortune → {totalBuckets, prizes, spinCount}", () => {
    const out = synthesizeTriggerPayload(
      "wheelOfFortune",
      [10, 20, 50, 100],
    ) as { totalBuckets: number; prizes: Array<{ amount: number; buckets: number }>; spinCount: number };
    expect(out.totalBuckets).toBe(50);
    expect(out.spinCount).toBe(1);
    expect(out.prizes).toHaveLength(4);
    expect(out.prizes.map((p) => p.amount)).toEqual([10, 20, 50, 100]);
    const totalBuckets = out.prizes.reduce((s, p) => s + p.buckets, 0);
    expect(totalBuckets).toBe(50);
  });

  it("wheelOfFortune → empty prizeList still produces 50 buckets (defensive)", () => {
    const out = synthesizeTriggerPayload("wheelOfFortune", []) as {
      totalBuckets: number;
      prizes: Array<{ amount: number; buckets: number }>;
    };
    expect(out.totalBuckets).toBe(50);
    expect(out.prizes).toHaveLength(1);
    expect(out.prizes[0]?.buckets).toBe(50);
  });

  it("treasureChest → {chestCount, prizeRange, hasDiscreteTiers}", () => {
    const out = synthesizeTriggerPayload(
      "treasureChest",
      [10, 50, 200, 1000, 5000, 25000],
    ) as { chestCount: number; prizeRange: { minNok: number; maxNok: number }; hasDiscreteTiers: boolean };
    expect(out.chestCount).toBe(6);
    expect(out.prizeRange).toEqual({ minNok: 10, maxNok: 25000 });
    expect(out.hasDiscreteTiers).toBe(true);
  });

  it("treasureChest → minimum 2 chests even for tiny prizeList", () => {
    const out = synthesizeTriggerPayload("treasureChest", [100]) as {
      chestCount: number;
    };
    expect(out.chestCount).toBeGreaterThanOrEqual(2);
  });

  it("colorDraft → {numberOfSlots, targetColor, slotColors, winPrizeNok, consolationPrizeNok}", () => {
    const out = synthesizeTriggerPayload(
      "colorDraft",
      [200, 0],
    ) as {
      numberOfSlots: number;
      targetColor: string;
      slotColors: string[];
      winPrizeNok: number;
      consolationPrizeNok: number;
    };
    expect(out.numberOfSlots).toBe(12);
    expect(typeof out.targetColor).toBe("string");
    expect(out.slotColors).toEqual([]);
    expect(out.winPrizeNok).toBe(200);
    expect(out.consolationPrizeNok).toBe(0);
  });

  it("mysteryGame → 6-element prizeListNok + middleNumber + resultNumber", () => {
    const out = synthesizeTriggerPayload(
      "mysteryGame",
      [50, 100, 200, 400, 800, 1500],
    ) as {
      middleNumber: number;
      resultNumber: number;
      prizeListNok: number[];
      maxRounds: number;
      autoTurnFirstMoveSec: number;
      autoTurnOtherMoveSec: number;
    };
    expect(out.prizeListNok).toHaveLength(6);
    expect(out.maxRounds).toBe(5);
    expect(out.middleNumber).toBeGreaterThanOrEqual(10000);
    expect(out.middleNumber).toBeLessThan(100000);
    expect(out.resultNumber).toBeGreaterThanOrEqual(10000);
    expect(out.resultNumber).toBeLessThan(100000);
    expect(out.autoTurnFirstMoveSec).toBeGreaterThan(0);
    expect(out.autoTurnOtherMoveSec).toBeGreaterThan(0);
  });

  it("mysteryGame → pads short prizeList to 6 entries", () => {
    const out = synthesizeTriggerPayload("mysteryGame", [100, 200]) as {
      prizeListNok: number[];
    };
    expect(out.prizeListNok).toHaveLength(6);
    expect(out.prizeListNok).toEqual([100, 200, 100, 200, 100, 200]);
  });
});

// ── Result-payload shape tests ──────────────────────────────────────────

describe("synthesizeResultPayload — converts legacy ack to M6-shaped result", () => {
  const wheelTrigger = {
    totalBuckets: 50,
    prizes: [
      { amount: 10, buckets: 25 },
      { amount: 100, buckets: 25 },
    ],
  };

  it("wheelOfFortune → {winningBucketIndex within prize-range, amountKroner = ack.prizeAmount}", () => {
    const ack: MiniGamePlayResult = {
      type: "wheelOfFortune",
      segmentIndex: 1,
      prizeAmount: 100,
      prizeList: [10, 100],
    };
    const result = synthesizeResultPayload("wheelOfFortune", ack, wheelTrigger) as {
      winningBucketIndex: number;
      amountKroner: number;
      totalBuckets: number;
    };
    expect(result.winningBucketIndex).toBeGreaterThanOrEqual(25);
    expect(result.winningBucketIndex).toBeLessThan(50);
    expect(result.amountKroner).toBe(100);
    expect(result.totalBuckets).toBe(50);
  });

  it("treasureChest → {chosenIndex carried through, allValuesKroner has chosen=prizeAmount}", () => {
    const trigger = { chestCount: 6, prizeRange: { minNok: 10, maxNok: 1500 } };
    const ack: MiniGamePlayResult = {
      type: "treasureChest",
      segmentIndex: 2,
      prizeAmount: 500,
      prizeList: [10, 50, 500, 1000, 1500],
    };
    const result = synthesizeResultPayload("treasureChest", ack, trigger, 3) as {
      chosenIndex: number;
      prizeAmountKroner: number;
      allValuesKroner: number[];
      chestCount: number;
    };
    expect(result.chosenIndex).toBe(3);
    expect(result.prizeAmountKroner).toBe(500);
    expect(result.allValuesKroner).toHaveLength(6);
    expect(result.allValuesKroner[3]).toBe(500);
    expect(result.chestCount).toBe(6);
  });

  it("colorDraft (matched) → matched=true, prizeAmountKroner reflects win", () => {
    const trigger = {
      numberOfSlots: 12,
      targetColor: "yellow",
      slotColors: [],
      winPrizeNok: 300,
      consolationPrizeNok: 0,
    };
    const ack: MiniGamePlayResult = {
      type: "colorDraft",
      segmentIndex: 4,
      prizeAmount: 300,
      prizeList: [300, 0],
    };
    const result = synthesizeResultPayload("colorDraft", ack, trigger, 4) as {
      chosenIndex: number;
      matched: boolean;
      prizeAmountKroner: number;
      targetColor: string;
      allSlotColors: string[];
    };
    expect(result.chosenIndex).toBe(4);
    expect(result.matched).toBe(true);
    expect(result.prizeAmountKroner).toBe(300);
    expect(result.targetColor).toBe("yellow");
    expect(result.allSlotColors).toHaveLength(12);
    expect(result.allSlotColors[4]).toBe("yellow");
  });

  it("colorDraft (no match) → matched=false, allSlotColors[chosen]≠targetColor", () => {
    const trigger = {
      numberOfSlots: 12,
      targetColor: "yellow",
      slotColors: [],
      winPrizeNok: 300,
      consolationPrizeNok: 0,
    };
    const ack: MiniGamePlayResult = {
      type: "colorDraft",
      segmentIndex: 0,
      prizeAmount: 0,
      prizeList: [300, 0],
    };
    const result = synthesizeResultPayload("colorDraft", ack, trigger, 7) as {
      matched: boolean;
      allSlotColors: string[];
    };
    expect(result.matched).toBe(false);
    expect(result.allSlotColors[7]).not.toBe("yellow");
  });

  it("mysteryGame → finalPriceIndex matches ack.prizeAmount in trigger ladder", () => {
    const trigger = {
      middleNumber: 12345,
      resultNumber: 67890,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
    };
    const ack: MiniGamePlayResult = {
      type: "mysteryGame",
      segmentIndex: 3,
      prizeAmount: 400,
      prizeList: [50, 100, 200, 400, 800, 1500],
    };
    const result = synthesizeResultPayload("mysteryGame", ack, trigger) as {
      finalPriceIndex: number;
      prizeAmountKroner: number;
      jokerTriggered: boolean;
    };
    expect(result.finalPriceIndex).toBe(3);
    expect(result.prizeAmountKroner).toBe(400);
    expect(result.jokerTriggered).toBe(false);
  });

  it("mysteryGame → max-prize triggers jokerTriggered=true", () => {
    const trigger = {
      middleNumber: 1,
      resultNumber: 2,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
    };
    const ack: MiniGamePlayResult = {
      type: "mysteryGame",
      segmentIndex: 5,
      prizeAmount: 1500,
      prizeList: [50, 100, 200, 400, 800, 1500],
    };
    const result = synthesizeResultPayload("mysteryGame", ack, trigger) as {
      finalPriceIndex: number;
      jokerTriggered: boolean;
    };
    expect(result.finalPriceIndex).toBe(5);
    expect(result.jokerTriggered).toBe(true);
  });

  it("mysteryGame → 0 prize → finalPriceIndex=0, jokerTriggered=false", () => {
    const trigger = {
      middleNumber: 1,
      resultNumber: 2,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
    };
    const ack: MiniGamePlayResult = {
      type: "mysteryGame",
      segmentIndex: 0,
      prizeAmount: 0,
      prizeList: [50, 100],
    };
    const result = synthesizeResultPayload("mysteryGame", ack, trigger) as {
      finalPriceIndex: number;
      jokerTriggered: boolean;
    };
    expect(result.finalPriceIndex).toBe(0);
    expect(result.jokerTriggered).toBe(false);
  });
});

// ── End-to-end adapter tests with mocked overlays ───────────────────────

interface AdapterTestDeps {
  adapter: LegacyMiniGameAdapter;
  root: Container;
  playMiniGame: ReturnType<typeof vi.fn>;
  bridge: { getState: ReturnType<typeof vi.fn> };
}

function makeAdapter(opts?: {
  roomCode?: string;
  ack?: { ok: true; data: MiniGamePlayResult } | { ok: false; error: { code: string; message: string } };
}): AdapterTestDeps {
  const root = new Container();
  const playMiniGame = vi.fn().mockResolvedValue(
    opts?.ack ?? {
      ok: true,
      data: {
        type: "mysteryGame",
        segmentIndex: 3,
        prizeAmount: 400,
        prizeList: [50, 100, 200, 400, 800, 1500],
      } satisfies MiniGamePlayResult,
    },
  );
  const bridge = {
    getState: vi.fn().mockReturnValue({
      roomCode: opts?.roomCode ?? "ROOM-1",
      isPaused: false,
    }),
  };
  const app = { app: { screen: { width: 1200, height: 800 } } } as unknown as GameApp;
  const socket = { playMiniGame } as unknown as SpilloramaSocket;
  const adapter = new LegacyMiniGameAdapter({
    root,
    app,
    socket,
    bridge: bridge as unknown as GameBridge,
  });
  return { adapter, root, playMiniGame, bridge };
}

describe("LegacyMiniGameAdapter — overlay lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    wheelMock.mockReset();
    chestMock.mockReset();
    colorDraftMock.mockReset();
    mysteryMock.mockReset();
  });

  it("activates WheelOverlay for type=wheelOfFortune", () => {
    const { adapter, root } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "wheelOfFortune",
      prizeList: [10, 50, 100],
    });
    expect(wheelMock).toHaveBeenCalledOnce();
    expect(chestMock).not.toHaveBeenCalled();
    expect(root.children.length).toBe(1);
  });

  it("activates TreasureChestOverlay for type=treasureChest", () => {
    const { adapter } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "treasureChest",
      prizeList: [10, 50, 100],
    });
    expect(chestMock).toHaveBeenCalledOnce();
  });

  it("activates ColorDraftOverlay for type=colorDraft", () => {
    const { adapter } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "colorDraft",
      prizeList: [10, 50, 100],
    });
    expect(colorDraftMock).toHaveBeenCalledOnce();
  });

  it("activates MysteryGameOverlay for type=mysteryGame", () => {
    const { adapter } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "mysteryGame",
      prizeList: [50, 100, 200, 400, 800, 1500],
    });
    expect(mysteryMock).toHaveBeenCalledOnce();
  });

  it("calls overlay.show() with synthesized M6-shaped trigger payload", () => {
    const { adapter, root } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "treasureChest",
      prizeList: [10, 50, 100, 500, 1000, 5000],
    });
    const overlay = root.children[0] as FakeOverlay;
    expect(overlay.show).toHaveBeenCalledOnce();
    const passedPayload = vi.mocked(overlay.show).mock.calls[0]?.[0] as { chestCount: number };
    expect(passedPayload.chestCount).toBe(6);
  });

  it("single-overlay invariant: new activate destroys previous", () => {
    const { adapter, root } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "wheelOfFortune",
      prizeList: [10, 50, 100],
    });
    const first = root.children[0] as FakeOverlay;
    adapter.onActivated({
      gameId: "g-2",
      playerId: "p-1",
      type: "treasureChest",
      prizeList: [50, 100, 200],
    });
    expect(first.destroyed).toBe(true);
    const live = root.children.filter((c) => !(c as FakeOverlay).destroyed);
    expect(live).toHaveLength(1);
  });

  it("dismiss() destroys active overlay", () => {
    const { adapter, root } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "mysteryGame",
      prizeList: [50, 100, 200, 400, 800, 1500],
    });
    const overlay = root.children[0] as FakeOverlay;
    adapter.dismiss();
    expect(overlay.destroyed).toBe(true);
  });

  it("destroy() is idempotent (no double-dismiss-throw)", () => {
    const { adapter } = makeAdapter();
    adapter.destroy();
    expect(() => adapter.destroy()).not.toThrow();
  });

  it("pause-aware overlays receive bridge as 3rd constructor arg", () => {
    const { adapter, bridge } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "wheelOfFortune",
      prizeList: [10, 50, 100],
    });
    expect(wheelMock).toHaveBeenCalledWith(1200, 800, bridge);
  });
});

describe("LegacyMiniGameAdapter — choice routing via legacy minigame:play", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    wheelMock.mockReset();
    chestMock.mockReset();
    colorDraftMock.mockReset();
    mysteryMock.mockReset();
  });

  it("routes overlay choice to socket.playMiniGame (NOT sendMiniGameChoice)", async () => {
    const { adapter, root, playMiniGame } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "treasureChest",
      prizeList: [10, 50, 500, 1000],
    });
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({ chosenIndex: 2 });
    expect(playMiniGame).toHaveBeenCalledOnce();
    expect(playMiniGame).toHaveBeenCalledWith({
      roomCode: "ROOM-1",
      selectedIndex: 2,
    });
  });

  it("Wheel choice (no chosenIndex) → playMiniGame called without selectedIndex", async () => {
    const { adapter, root, playMiniGame } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "wheelOfFortune",
      prizeList: [10, 50, 100],
    });
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({});
    expect(playMiniGame).toHaveBeenCalledWith({ roomCode: "ROOM-1" });
  });

  it("ack ok → calls overlay.animateResult with synthesized M6-shaped result", async () => {
    const { adapter, root } = makeAdapter({
      ack: {
        ok: true,
        data: {
          type: "mysteryGame",
          segmentIndex: 3,
          prizeAmount: 400,
          prizeList: [50, 100, 200, 400, 800, 1500],
        },
      },
    });
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "mysteryGame",
      prizeList: [50, 100, 200, 400, 800, 1500],
    });
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({ directions: ["up", "down", "up"] });
    expect(overlay.animateResult).toHaveBeenCalledOnce();
    const [resultPayload, payoutCents] = vi.mocked(overlay.animateResult).mock.calls[0]!;
    expect(resultPayload).toMatchObject({
      finalPriceIndex: 3,
      prizeAmountKroner: 400,
      jokerTriggered: false,
    });
    // 400 NOK → 40000 øre (cents)
    expect(payoutCents).toBe(40000);
  });

  it("ack failure → overlay.showChoiceError called, NOT animateResult, NOT dismissed", async () => {
    const { adapter, root } = makeAdapter({
      ack: {
        ok: false,
        error: { code: "BOOM", message: "Backend feilet." },
      },
    });
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "treasureChest",
      prizeList: [10, 50, 100],
    });
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({ chosenIndex: 1 });
    expect(overlay.showChoiceError).toHaveBeenCalledOnce();
    expect(overlay.showChoiceError).toHaveBeenCalledWith({
      code: "BOOM",
      message: "Backend feilet.",
    });
    expect(overlay.animateResult).not.toHaveBeenCalled();
    expect(overlay.destroyed).toBe(false);
  });

  it("missing roomCode → choice rejected via showChoiceError", async () => {
    const { adapter, root, playMiniGame } = makeAdapter({ roomCode: "" });
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "wheelOfFortune",
      prizeList: [10, 50, 100],
    });
    const overlay = root.children[0] as FakeOverlay;
    await overlay._onChoice?.({});
    expect(playMiniGame).not.toHaveBeenCalled();
    expect(overlay.showChoiceError).toHaveBeenCalledOnce();
  });

  it("overlay setOnDismiss → adapter.dismiss → overlay destroyed", () => {
    const { adapter, root } = makeAdapter();
    adapter.onActivated({
      gameId: "g-1",
      playerId: "p-1",
      type: "mysteryGame",
      prizeList: [50, 100, 200, 400, 800, 1500],
    });
    const overlay = root.children[0] as FakeOverlay;
    overlay._onDismiss?.();
    expect(overlay.destroyed).toBe(true);
  });
});
