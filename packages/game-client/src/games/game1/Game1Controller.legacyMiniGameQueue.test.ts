/**
 * @vitest-environment happy-dom
 *
 * Tobias prod-incident 2026-04-29: legacy `minigame:activated` queue.
 *
 * Mirrors `Game1Controller.miniGameQueue.test.ts` but for the legacy
 * auto-claim path. Backend (PR #727) emits `minigame:activated` after
 * Fullt Hus; the controller must hold the trigger back while WinScreenV2
 * is showing the fontene-animasjon, then release it via
 * `flushPendingMiniGameTrigger` when the win screen dismisses.
 *
 * Lightweight harness pattern matches the M6 queue test — verifies the
 * orchestration logic without spinning up the full controller (which
 * needs a real Pixi app + bridge).
 */
import { describe, it, expect, vi } from "vitest";
import type {
  MiniGameActivatedPayload,
  MiniGameTriggerPayload,
} from "@spillorama/shared-types/socket-events";

interface RouterStub {
  onTrigger: ReturnType<typeof vi.fn>;
}

interface LegacyAdapterStub {
  onActivated: ReturnType<typeof vi.fn>;
}

/**
 * Harness mirrors Game1Controller's queueing logic for both protocols. The
 * real controller has these methods inline; we extract the policy so we
 * can drive it with synthetic events and a fake clock.
 */
class Harness {
  isWinScreenActive = false;
  pendingMiniGameTrigger: MiniGameTriggerPayload | null = null;
  pendingLegacyMiniGame: MiniGameActivatedPayload | null = null;
  router: RouterStub;
  legacyAdapter: LegacyAdapterStub;

  constructor() {
    this.router = { onTrigger: vi.fn() };
    this.legacyAdapter = { onActivated: vi.fn() };
  }

  handleMiniGameTrigger(payload: MiniGameTriggerPayload): void {
    if (this.isWinScreenActive) {
      this.pendingMiniGameTrigger = payload;
      return;
    }
    this.router.onTrigger(payload);
  }

  handleLegacyMiniGameActivated(payload: MiniGameActivatedPayload): void {
    if (this.isWinScreenActive) {
      this.pendingLegacyMiniGame = payload;
      return;
    }
    this.legacyAdapter.onActivated(payload);
  }

  flushPendingMiniGameTrigger(): void {
    const pendingM6 = this.pendingMiniGameTrigger;
    if (pendingM6) {
      this.pendingMiniGameTrigger = null;
      this.router.onTrigger(pendingM6);
    }
    const pendingLegacy = this.pendingLegacyMiniGame;
    if (pendingLegacy) {
      this.pendingLegacyMiniGame = null;
      this.legacyAdapter.onActivated(pendingLegacy);
    }
  }

  showWinScreen(): void {
    this.isWinScreenActive = true;
  }

  dismissWinScreen(): void {
    this.isWinScreenActive = false;
    this.flushPendingMiniGameTrigger();
  }
}

function makeLegacyTrigger(
  overrides: Partial<MiniGameActivatedPayload> = {},
): MiniGameActivatedPayload {
  return {
    gameId: "auto-game-1",
    playerId: "player-1",
    type: "mysteryGame",
    prizeList: [50, 100, 200, 400, 800, 1500],
    ...overrides,
  };
}

describe("Game1Controller — legacy minigame:activated queue", () => {
  it("uten WinScreenV2 aktiv → adapter.onActivated fyrer umiddelbart", () => {
    const h = new Harness();
    const trigger = makeLegacyTrigger();
    h.handleLegacyMiniGameActivated(trigger);
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledTimes(1);
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledWith(trigger);
    expect(h.pendingLegacyMiniGame).toBeNull();
  });

  it("med WinScreenV2 aktiv → trigger holdes tilbake i kø", () => {
    const h = new Harness();
    h.showWinScreen();
    const trigger = makeLegacyTrigger();
    h.handleLegacyMiniGameActivated(trigger);
    expect(h.legacyAdapter.onActivated).not.toHaveBeenCalled();
    expect(h.pendingLegacyMiniGame).toBe(trigger);
  });

  it("WinScreenV2 dismiss → pending legacy trigger frigis til adapter", () => {
    const h = new Harness();
    h.showWinScreen();
    const trigger = makeLegacyTrigger();
    h.handleLegacyMiniGameActivated(trigger);
    h.dismissWinScreen();
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledTimes(1);
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledWith(trigger);
    expect(h.pendingLegacyMiniGame).toBeNull();
  });

  it("dismiss uten pending trigger → ingen adapter-kall", () => {
    const h = new Harness();
    h.showWinScreen();
    h.dismissWinScreen();
    expect(h.legacyAdapter.onActivated).not.toHaveBeenCalled();
    expect(h.router.onTrigger).not.toHaveBeenCalled();
  });

  it("multiple legacy triggere mens WinScreen aktiv → siste vinner", () => {
    const h = new Harness();
    h.showWinScreen();
    const t1 = makeLegacyTrigger({ gameId: "g-1" });
    const t2 = makeLegacyTrigger({ gameId: "g-2" });
    h.handleLegacyMiniGameActivated(t1);
    h.handleLegacyMiniGameActivated(t2);
    expect(h.pendingLegacyMiniGame).toBe(t2);
    h.dismissWinScreen();
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledTimes(1);
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledWith(t2);
  });

  it("legacy + M6 triggere koeksisterer i samme WinScreen-kø", () => {
    const h = new Harness();
    h.showWinScreen();

    const legacy = makeLegacyTrigger({ gameId: "auto-1" });
    const m6: MiniGameTriggerPayload = {
      resultId: "res-1",
      miniGameType: "wheel",
      payload: { totalBuckets: 50, prizes: [{ amount: 100, buckets: 50 }] },
    };
    h.handleLegacyMiniGameActivated(legacy);
    h.handleMiniGameTrigger(m6);

    expect(h.pendingLegacyMiniGame).toBe(legacy);
    expect(h.pendingMiniGameTrigger).toBe(m6);
    expect(h.legacyAdapter.onActivated).not.toHaveBeenCalled();
    expect(h.router.onTrigger).not.toHaveBeenCalled();

    h.dismissWinScreen();

    // Begge protokollers handlere fyres etter dismiss — hver mot sin
    // egen overlay-manager. Single-overlay-invariantet i adapter/router
    // håndterer at bare én overlay vises totalt.
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledWith(legacy);
    expect(h.router.onTrigger).toHaveBeenCalledWith(m6);
    expect(h.pendingLegacyMiniGame).toBeNull();
    expect(h.pendingMiniGameTrigger).toBeNull();
  });

  it("legacy trigger etter dismiss → fyrer umiddelbart (kø er tom)", () => {
    const h = new Harness();
    h.showWinScreen();
    h.dismissWinScreen();
    const trigger = makeLegacyTrigger();
    h.handleLegacyMiniGameActivated(trigger);
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledTimes(1);
    expect(h.legacyAdapter.onActivated).toHaveBeenCalledWith(trigger);
  });

  it("alle 4 legacy-typer bruker samme kø-mekanikk", () => {
    const types: MiniGameActivatedPayload["type"][] = [
      "wheelOfFortune",
      "treasureChest",
      "colorDraft",
      "mysteryGame",
    ];
    for (const type of types) {
      const h = new Harness();
      h.showWinScreen();
      const trigger = makeLegacyTrigger({ type });
      h.handleLegacyMiniGameActivated(trigger);
      expect(h.legacyAdapter.onActivated).not.toHaveBeenCalled();
      h.dismissWinScreen();
      expect(h.legacyAdapter.onActivated).toHaveBeenCalledWith(trigger);
    }
  });
});
