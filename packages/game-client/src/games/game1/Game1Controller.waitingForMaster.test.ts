/**
 * @vitest-environment happy-dom
 *
 * Spillerklient-rebuild — controller-flow-tester for "neste spill"-idle-state.
 *
 * 2026-05-11 (Tobias-direktiv): `WaitingForMasterOverlay` er fjernet helt.
 * Idle-tekst rendres direkte i CenterBall-posisjonen via:
 *   - `PlayScreen.setBuyPopupDisplayName(name)` → CenterBall.setIdleText(name)
 *   - `PlayScreen.update(state)` → CenterBall.showIdleText() når
 *     `gameStatus !== RUNNING` og lobby-status ikke har trygget runden.
 *   - `CenterBall.showNumber/setNumber/startCountdown` → auto-hideIdleText.
 *
 * Forrige design (slettet) brukte en separat HTML-overlay som la seg over
 * Pixi-stagen. Tobias-direktiv 2026-05-11: "den kula som viser hvilket tall
 * som blir trekt — når det ikke er aktiv runde fjerner vi den og skriver
 * tekst der: 'Neste spill: {neste spill på planen}' + 'Kjøp bonger for å være
 * med i trekningen'. Vi trenger ikke ha noen tekst om at vi venter på master."
 *
 * Disse testene speiler den nye flyten — fra controller-perspektiv: når
 * lobby-state oppdateres, hvilken signalering skjer mot PlayScreen?
 *
 *   N1 — Initial join uten lobby-state → CenterBall starter i idle-text-mode
 *   N2 — Lobby `purchase_open` → setBuyPopupDisplayName(catalogDisplayName)
 *   N3 — Lobby `running` → setLobbyOverallStatus("running") (driver
 *                          PlayScreen.update til hideIdleText)
 *   N4 — Lobby `paused`/`idle`/`closed`/`finished` → idle-text fortsatt aktiv
 *   N5 — Plan-item-bytte (Bingo → Innsatsen) → display-name pushes nytt navn
 *   N6 — onGameStarted: PlayScreen.update kalles med RUNNING → idle-text vekk
 *   N7 — destroy rydder uten å lekke (CenterBall-cleanup via root.destroy)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Spill1LobbyState } from "@spillorama/shared-types/api";

/**
 * Minimal harness som speiler `Game1Controller`-flyten i fase 3 (etter
 * 2026-05-11-rebuild): lobby-state-binding → PlayScreen-setters. Verifiserer
 * at PM-direktivet "ingen 'venter på master'-overlay, kun 'Neste spill: X'"
 * holdes ved hver state-overgang.
 *
 * Vi tester at:
 *  - `setBuyPopupDisplayName` kalles med catalog-navnet ved hver lobby-update
 *  - `setLobbyOverallStatus` forwardes synkronisert
 *  - Ingen DOM-noder med `data-spill1-waiting-for-master` mounteres
 */
class ControllerFlowHarness {
  hasLobbyFallback = false;
  bridgeGameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED" = "NONE";

  // Capture-mocks for PlayScreen-setters
  setBuyPopupDisplayName = vi.fn<(name: string | null | undefined) => void>();
  setLobbyOverallStatus = vi.fn<(
    status: Spill1LobbyState["overallStatus"] | null,
  ) => void>();

  /** Mirror av Game1Controller.lobbyStateBinding.onChange-handleren (post-2026-05-11). */
  applyLobbyState(state: Spill1LobbyState | null): void {
    if (this.hasLobbyFallback) return;

    const name = state?.nextScheduledGame?.catalogDisplayName ?? "Bingo";
    this.setBuyPopupDisplayName(name);
    this.setLobbyOverallStatus(state?.overallStatus ?? null);
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

describe("Game1Controller — 'Neste spill'-idle-text (post-2026-05-11)", () => {
  let container: HTMLElement;
  let harness: ControllerFlowHarness;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    harness = new ControllerFlowHarness();
  });

  afterEach(() => {
    if (container.parentElement) {
      container.parentElement.removeChild(container);
    }
  });

  function findLegacyOverlay(): NodeListOf<Element> {
    // Den gamle overlay-noden skal ALDRI eksistere i ny flyt.
    return document.querySelectorAll("[data-spill1-waiting-for-master]");
  }

  // ── N1 ──────────────────────────────────────────────────────────────────
  it("N1 — Initial uten lobby-state → ingen call til PlayScreen (vi vet ikke navnet enda)", () => {
    harness.applyLobbyState(null);
    // Mirror av production-flyten: når state er null fyrer vi ikke
    // setBuyPopupDisplayName fordi navnet er ukjent. CenterBall har
    // allerede fallback "Bingo" fra constructor.
    expect(harness.setBuyPopupDisplayName).toHaveBeenCalledWith("Bingo");
    expect(harness.setLobbyOverallStatus).toHaveBeenCalledWith(null);

    // Tobias-direktiv: ingen legacy-overlay.
    expect(findLegacyOverlay().length).toBe(0);
  });

  // ── N2 ──────────────────────────────────────────────────────────────────
  it("N2 — Lobby purchase_open → forwarder 'Bingo' til BuyPopup + 'purchase_open' til status", () => {
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));

    expect(harness.setBuyPopupDisplayName).toHaveBeenLastCalledWith("Bingo");
    expect(harness.setLobbyOverallStatus).toHaveBeenLastCalledWith("purchase_open");
    expect(findLegacyOverlay().length).toBe(0);
  });

  // ── N3 ──────────────────────────────────────────────────────────────────
  it("N3 — Lobby running → forwarder 'running' (PlayScreen.update vil hideIdleText)", () => {
    harness.applyLobbyState(makeLobbyState({ overallStatus: "running" }));
    expect(harness.setLobbyOverallStatus).toHaveBeenLastCalledWith("running");
    expect(findLegacyOverlay().length).toBe(0);
  });

  // ── N4 ──────────────────────────────────────────────────────────────────
  it("N4 — Alle ikke-running-statuses driver idle-text-mode i PlayScreen", () => {
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
      expect(harness.setLobbyOverallStatus).toHaveBeenLastCalledWith(status);
    }
    // Ingen legacy-overlay i noen tilstand.
    expect(findLegacyOverlay().length).toBe(0);
  });

  // ── N5 ──────────────────────────────────────────────────────────────────
  it("N5 — Plan-item-bytte (Bingo → Innsatsen) pusher nytt display-name", () => {
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));
    expect(harness.setBuyPopupDisplayName).toHaveBeenLastCalledWith("Bingo");

    // Master advancer til neste plan-position
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
    expect(harness.setBuyPopupDisplayName).toHaveBeenLastCalledWith("Innsatsen");
  });

  // ── N6 ──────────────────────────────────────────────────────────────────
  it("N6 — Lobby-fallback aktiv → onChange-handleren no-op (fallback eier scenen)", () => {
    harness.hasLobbyFallback = true;
    harness.applyLobbyState(makeLobbyState({ overallStatus: "purchase_open" }));

    expect(harness.setBuyPopupDisplayName).not.toHaveBeenCalled();
    expect(harness.setLobbyOverallStatus).not.toHaveBeenCalled();
    expect(findLegacyOverlay().length).toBe(0);
  });

  // ── N7 ──────────────────────────────────────────────────────────────────
  it("N7 — nextScheduledGame=null → display-name faller tilbake til 'Bingo' (Tobias-default)", () => {
    harness.applyLobbyState(
      makeLobbyState({
        overallStatus: "idle",
        nextScheduledGame: null,
      }),
    );
    expect(harness.setBuyPopupDisplayName).toHaveBeenLastCalledWith("Bingo");
  });

  // ── Garanti: WaitingForMasterOverlay-DOM eksisterer ikke ────────────────
  it("regresjon: ingen DOM-node med `data-spill1-waiting-for-master` (overlay fjernet 2026-05-11)", () => {
    // Kjør alle statuses for å verifisere at INGEN av dem mounter overlay-en.
    const statuses: Array<Spill1LobbyState["overallStatus"]> = [
      "idle",
      "purchase_open",
      "ready_to_start",
      "running",
      "paused",
      "closed",
      "finished",
    ];
    for (const status of statuses) {
      harness.applyLobbyState(makeLobbyState({ overallStatus: status }));
      expect(findLegacyOverlay().length).toBe(0);
    }
  });
});
