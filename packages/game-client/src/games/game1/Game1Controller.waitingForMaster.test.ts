/**
 * @vitest-environment happy-dom
 *
 * Spillerklient-rebuild Fase 3 (2026-05-10) — controller-flow-tester for
 * "venter på master"-state.
 *
 * Tobias-direktiv 2026-05-09 (PM_ONBOARDING_PLAYBOOK §2.3):
 *   "Når man kommer inn i spill 1 som kunde så skal man alltid da se neste
 *    spill som er planlagt. Dette spillet skal da starte når master har
 *    trykket på knappen. Det skal aldri være noen andre views i det live
 *    rommet en neste planlagte spill."
 *
 * Disse testene speiler `applyWaitingForMasterFromLobbyState`-flyten i
 * Game1Controller (uten å instansiere full Pixi-app). Pattern matcher
 * `Game1Controller.endOfRoundFlow.test.ts` og fase 1+2-tester:
 *
 *   M1 — Initial join uten lobby-state → overlay vises ikke (state ukjent)
 *   M2 — Lobby `purchase_open` → overlay vises med catalog-navn
 *   M3 — Lobby `running` → overlay dismisses
 *   M4 — Lobby `paused`/`idle` → overlay vises (alle ikke-running)
 *   M5 — Bridge gameStatus=RUNNING overrider stale lobby-state (race-fix)
 *   M6 — Lobby-fallback aktiv → ingen waiting-overlay (allerede dekket av fallback)
 *   M7 — onGameStarted dismisses overlay defensivt før lobby-update
 *   M8 — Etter Fullt Hus (lobby → idle/purchase_open) → overlay vises på nytt
 *   M9 — destroy() rydder overlay (idempotent)
 *   M10 — Reconnect-scenario: server pusher fersh state, overlay reflekterer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WaitingForMasterOverlay } from "./components/WaitingForMasterOverlay.js";
import type { Spill1LobbyState } from "@spillorama/shared-types/api";

/**
 * Minimal harness som speiler `applyWaitingForMasterFromLobbyState`-
 * logikken i Game1Controller. Hvis controller-koden drifter, oppdater
 * også harness — kontrakten er "overlay-state speiler lobby-state +
 * bridge-state per Tobias §2.3".
 */
class WaitingForMasterHarness {
  overlay: WaitingForMasterOverlay | null = null;
  hasLobbyFallback = false;
  bridgeGameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED" = "NONE";
  showCount = 0;
  hideCount = 0;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Mirror av Game1Controller.applyWaitingForMasterFromLobbyState. */
  applyLobbyState(state: Spill1LobbyState | null): void {
    if (this.hasLobbyFallback) return;

    if (!state) return;

    if (state.overallStatus === "running") {
      this.overlay?.hide();
      this.hideCount += 1;
      return;
    }

    if (this.bridgeGameStatus === "RUNNING") {
      this.overlay?.hide();
      this.hideCount += 1;
      return;
    }

    if (!this.overlay) {
      this.overlay = new WaitingForMasterOverlay({
        container: this.container,
      });
    }
    this.overlay.show({
      catalogDisplayName: state.nextScheduledGame?.catalogDisplayName ?? null,
      currentPosition: state.currentRunPosition || null,
      totalPositions: state.totalPositions || null,
      planName: state.planName,
    });
    this.showCount += 1;
  }

  /** Mirror av Game1Controller.onGameStarted's defensive hide. */
  onGameStarted(): void {
    this.overlay?.hide();
    this.hideCount += 1;
  }

  /** Mirror av Game1Controller.destroy's overlay-cleanup. */
  destroy(): void {
    this.overlay?.destroy();
    this.overlay = null;
  }

  isOverlayVisible(): boolean {
    return this.overlay?.isVisible() ?? false;
  }
}

function makeLobbyState(
  overrides: Partial<Spill1LobbyState> = {},
): Spill1LobbyState {
  return {
    hallId: "demo-hall-001",
    businessDate: "2026-05-10",
    isOpen: true,
    openingTimeStart: "11:00",
    openingTimeEnd: "21:00",
    planId: "plan-1",
    planName: "Pilot Demo",
    runId: null,
    runStatus: "idle",
    overallStatus: "purchase_open",
    nextScheduledGame: {
      itemId: "item-1",
      position: 1,
      catalogSlug: "bingo",
      catalogDisplayName: "Bingo",
      status: "purchase_open",
      scheduledGameId: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
      actualStartTime: null,
      ticketColors: ["hvit", "gul", "lilla"],
      ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
      prizeMultiplierMode: "auto",
      bonusGameSlug: null,
    },
    currentRunPosition: 1,
    totalPositions: 13,
    ...overrides,
  };
}

describe("Game1Controller — venter på master (Fase 3)", () => {
  let container: HTMLElement;
  let harness: WaitingForMasterHarness;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    harness = new WaitingForMasterHarness(container);
  });

  afterEach(() => {
    harness.destroy();
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
  });

  function findOverlays(): NodeListOf<Element> {
    return container.querySelectorAll(
      "[data-spill1-waiting-for-master]",
    );
  }

  // ── M1 ──────────────────────────────────────────────────────────────────
  it("M1 — Initial join uten lobby-state → overlay vises IKKE", () => {
    harness.applyLobbyState(null);
    expect(findOverlays().length).toBe(0);
    expect(harness.isOverlayVisible()).toBe(false);
  });

  // ── M2 ──────────────────────────────────────────────────────────────────
  it("M2 — Lobby purchase_open viser overlay med catalog-navn", () => {
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));

    expect(findOverlays().length).toBe(1);
    const headline = container.querySelector(
      "[data-spill1-waiting-for-master] [data-role='headline']",
    );
    expect(headline?.textContent).toBe("Bingo");
    const subheadline = container.querySelector(
      "[data-spill1-waiting-for-master] [data-role='subheadline']",
    );
    expect(subheadline?.textContent).toBe("Venter på master");
    const planInfo = container.querySelector(
      "[data-spill1-waiting-for-master] [data-role='plan-info']",
    );
    expect(planInfo?.textContent).toBe("Spill 1 av 13 — Pilot Demo");
  });

  // ── M3 ──────────────────────────────────────────────────────────────────
  it("M3 — Lobby running dismisses overlay (master har trygget)", () => {
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));
    expect(findOverlays().length).toBe(1);

    harness.applyLobbyState(makeLobbyState({ overallStatus: "running" }));
    expect(findOverlays().length).toBe(0);
    expect(harness.isOverlayVisible()).toBe(false);
  });

  // ── M4 ──────────────────────────────────────────────────────────────────
  it("M4 — Alle ikke-running-status viser overlay", () => {
    const nonRunningStatuses: Array<Spill1LobbyState["overallStatus"]> = [
      "idle",
      "purchase_open",
      "ready_to_start",
      "paused",
      "closed",
      "finished",
    ];
    for (const status of nonRunningStatuses) {
      harness.applyLobbyState(makeLobbyState({ overallStatus: status }));
      expect(findOverlays().length).toBe(1);
    }
  });

  // ── M5 ──────────────────────────────────────────────────────────────────
  it("M5 — Bridge gameStatus=RUNNING overrider stale lobby (race-fix)", () => {
    harness.bridgeGameStatus = "RUNNING";
    // Lobby-state henger fortsatt på purchase_open (stale)
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));

    // Overlay skal IKKE vises — bridge-state har "vunnet" race-en
    expect(findOverlays().length).toBe(0);
  });

  // ── M6 ──────────────────────────────────────────────────────────────────
  it("M6 — Lobby-fallback aktiv → ingen waiting-overlay (fallback eier scenen)", () => {
    harness.hasLobbyFallback = true;
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));

    expect(findOverlays().length).toBe(0);
  });

  // ── M7 ──────────────────────────────────────────────────────────────────
  it("M7 — onGameStarted dismisses overlay defensivt før lobby-update", () => {
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));
    expect(findOverlays().length).toBe(1);

    // Master trekker Start. room:update kommer først (gameStatus=RUNNING),
    // så lobby-update (overallStatus=running). I gap-en: overlay skal
    // dismisses defensivt.
    harness.onGameStarted();
    expect(findOverlays().length).toBe(0);
  });

  // ── M8 ──────────────────────────────────────────────────────────────────
  it("M8 — Etter Fullt Hus: lobby → idle/purchase_open → overlay vises på nytt", () => {
    // Pre-game: overlay vises
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));
    expect(findOverlays().length).toBe(1);

    // Master starter — overlay dismisses
    harness.applyLobbyState(makeLobbyState({ overallStatus: "running" }));
    expect(findOverlays().length).toBe(0);

    // Fullt Hus → server spawn-er ny scheduled-game for neste plan-position.
    // Lobby går tilbake til purchase_open med ny catalog-entry.
    harness.applyLobbyState(
      makeLobbyState({
        overallStatus: "purchase_open",
        currentRunPosition: 2,
        nextScheduledGame: {
          itemId: "item-2",
          position: 2,
          catalogSlug: "innsatsen",
          catalogDisplayName: "Innsatsen",
          status: "purchase_open",
          scheduledGameId: null,
          scheduledStartTime: null,
          scheduledEndTime: null,
          actualStartTime: null,
          ticketColors: ["hvit", "gul", "lilla"],
          ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
          prizeMultiplierMode: "auto",
          bonusGameSlug: null,
        },
      }),
    );
    expect(findOverlays().length).toBe(1);
    const headline = container.querySelector(
      "[data-spill1-waiting-for-master] [data-role='headline']",
    );
    expect(headline?.textContent).toBe("Innsatsen");
    const planInfo = container.querySelector(
      "[data-spill1-waiting-for-master] [data-role='plan-info']",
    );
    expect(planInfo?.textContent).toBe("Spill 2 av 13 — Pilot Demo");
  });

  // ── M9 ──────────────────────────────────────────────────────────────────
  it("M9 — destroy() rydder overlay (idempotent)", () => {
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));
    expect(findOverlays().length).toBe(1);

    harness.destroy();
    expect(findOverlays().length).toBe(0);

    // Idempotent
    harness.destroy();
  });

  // ── M10 ─────────────────────────────────────────────────────────────────
  it("M10 — Reconnect: fersh state etter disconnect — overlay reflekterer ny state", () => {
    // Pre-disconnect: master har trygget, overlay dismissed
    harness.applyLobbyState(makeLobbyState({ overallStatus: "running" }));
    expect(findOverlays().length).toBe(0);

    // Klient reconnecter etter glipp. Server pusher fersh state via
    // resumeRoom/HTTP-poll. I tilfellet hvor master pauset under
    // disconnect → overlay vises igjen
    harness.applyLobbyState(makeLobbyState({ overallStatus: "paused" }));
    expect(findOverlays().length).toBe(1);
  });

  // ── Tobias-direktiv: alltid neste-planlagte-spill som default ──────────
  it("default catalog-display-name er 'Bingo' når nextScheduledGame mangler", () => {
    harness.applyLobbyState(
      makeLobbyState({
        overallStatus: "idle",
        nextScheduledGame: null,
      }),
    );
    const headline = container.querySelector(
      "[data-spill1-waiting-for-master] [data-role='headline']",
    );
    expect(headline?.textContent).toBe("Bingo");
  });

  // ── PlayScreen.setLobbyOverallStatus-kontrakt ─────────────────────────
  it("countdown-gating: lobby-status forwardet til PlayScreen-mock", () => {
    const setLobbyOverallStatus = vi.fn();
    // Simuler controller-koden i onChange-handler
    const fwd = (state: Spill1LobbyState | null) => {
      setLobbyOverallStatus(state?.overallStatus ?? null);
    };

    fwd(null);
    expect(setLobbyOverallStatus).toHaveBeenLastCalledWith(null);

    fwd(makeLobbyState({ overallStatus: "purchase_open" }));
    expect(setLobbyOverallStatus).toHaveBeenLastCalledWith("purchase_open");

    fwd(makeLobbyState({ overallStatus: "running" }));
    expect(setLobbyOverallStatus).toHaveBeenLastCalledWith("running");

    fwd(makeLobbyState({ overallStatus: "paused" }));
    expect(setLobbyOverallStatus).toHaveBeenLastCalledWith("paused");
  });
});
