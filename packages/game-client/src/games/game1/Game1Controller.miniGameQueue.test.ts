/**
 * @vitest-environment happy-dom
 *
 * Tobias 2026-04-26: Mini-game-trigger-kø ved Fullt Hus.
 *
 * Backend triggerer mini-game (Mystery, Wheel, etc.) POST-commit umiddelbart
 * etter Fullt Hus-payout (`Game1DrawEngineService.triggerMiniGamesForFullHouse`).
 * Klienten må holde tilbake overlay-en mens WinScreenV2 (fontene + count-up)
 * fortsatt vises (~10.8s) og spille det av etter at vinner-scenen er
 * dismissed (Tilbake-klikk eller auto-close).
 *
 * Speiler `handleMiniGameTrigger` + `flushPendingMiniGameTrigger` fra
 * Game1Controller — samme lettvekts-harness-pattern som
 * Game1Controller.patternWon.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import type { MiniGameTriggerPayload } from "@spillorama/shared-types/socket-events";

interface RouterStub {
  onTrigger: ReturnType<typeof vi.fn>;
}

class Harness {
  isWinScreenActive = false;
  pendingMiniGameTrigger: MiniGameTriggerPayload | null = null;
  router: RouterStub;

  constructor() {
    this.router = { onTrigger: vi.fn() };
  }

  handleMiniGameTrigger(payload: MiniGameTriggerPayload): void {
    if (this.isWinScreenActive) {
      this.pendingMiniGameTrigger = payload;
      return;
    }
    this.router.onTrigger(payload);
  }

  flushPendingMiniGameTrigger(): void {
    const pending = this.pendingMiniGameTrigger;
    if (!pending) return;
    this.pendingMiniGameTrigger = null;
    this.router.onTrigger(pending);
  }

  /** Simulerer WinScreenV2.show ved Fullt Hus. */
  showWinScreen(): void {
    this.isWinScreenActive = true;
  }

  /** Simulerer WinScreenV2.onDismiss (Tilbake-klikk eller auto-close). */
  dismissWinScreen(): void {
    this.isWinScreenActive = false;
    this.flushPendingMiniGameTrigger();
  }
}

function makeTrigger(
  overrides: Partial<MiniGameTriggerPayload> = {},
): MiniGameTriggerPayload {
  return {
    miniGameType: "mystery",
    resultId: "res-1",
    payload: {
      middleNumber: 12345,
      resultNumber: 67890,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
      autoTurnFirstMoveSec: 20,
      autoTurnOtherMoveSec: 10,
    },
    ...overrides,
  };
}

describe("Mini-game trigger-kø under Fullt Hus", () => {
  it("uten WinScreenV2 aktiv → trigger fyrer umiddelbart", () => {
    const h = new Harness();
    const trigger = makeTrigger();
    h.handleMiniGameTrigger(trigger);
    expect(h.router.onTrigger).toHaveBeenCalledTimes(1);
    expect(h.router.onTrigger).toHaveBeenCalledWith(trigger);
    expect(h.pendingMiniGameTrigger).toBeNull();
  });

  it("med WinScreenV2 aktiv → trigger holdes tilbake i kø", () => {
    const h = new Harness();
    h.showWinScreen();
    const trigger = makeTrigger();
    h.handleMiniGameTrigger(trigger);
    expect(h.router.onTrigger).not.toHaveBeenCalled();
    expect(h.pendingMiniGameTrigger).toBe(trigger);
  });

  it("WinScreenV2 dismiss → pending trigger frigis til router", () => {
    const h = new Harness();
    h.showWinScreen();
    const trigger = makeTrigger();
    h.handleMiniGameTrigger(trigger);
    h.dismissWinScreen();
    expect(h.router.onTrigger).toHaveBeenCalledTimes(1);
    expect(h.router.onTrigger).toHaveBeenCalledWith(trigger);
    expect(h.pendingMiniGameTrigger).toBeNull();
  });

  it("dismiss uten pending trigger → ingen router-kall", () => {
    const h = new Harness();
    h.showWinScreen();
    h.dismissWinScreen();
    expect(h.router.onTrigger).not.toHaveBeenCalled();
  });

  it("multiple triggere mens WinScreenV2 er aktiv → siste vinner (server-autoritativ)", () => {
    const h = new Harness();
    h.showWinScreen();
    const t1 = makeTrigger({ resultId: "res-1" });
    const t2 = makeTrigger({ resultId: "res-2" });
    h.handleMiniGameTrigger(t1);
    h.handleMiniGameTrigger(t2);
    expect(h.pendingMiniGameTrigger).toBe(t2);
    h.dismissWinScreen();
    expect(h.router.onTrigger).toHaveBeenCalledTimes(1);
    expect(h.router.onTrigger).toHaveBeenCalledWith(t2);
  });

  it("trigger etter dismiss → fyrer umiddelbart (kø er tom)", () => {
    const h = new Harness();
    h.showWinScreen();
    h.dismissWinScreen();
    const trigger = makeTrigger();
    h.handleMiniGameTrigger(trigger);
    expect(h.router.onTrigger).toHaveBeenCalledTimes(1);
    expect(h.router.onTrigger).toHaveBeenCalledWith(trigger);
  });

  it("Wheel-trigger oppfører seg likt (kø er mini-game-type-agnostisk)", () => {
    const h = new Harness();
    h.showWinScreen();
    const wheelTrigger = makeTrigger({
      miniGameType: "wheel",
      payload: { wheelConfig: "test" },
    });
    h.handleMiniGameTrigger(wheelTrigger);
    expect(h.router.onTrigger).not.toHaveBeenCalled();
    h.dismissWinScreen();
    expect(h.router.onTrigger).toHaveBeenCalledWith(wheelTrigger);
  });
});
