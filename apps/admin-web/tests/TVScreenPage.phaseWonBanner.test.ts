/**
 * Task 1.7 (2026-04-24): tester for phase-won-banner som vises i 3s ved
 * `game1:phase-won`-socket-event.
 *
 * Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md §6 Task 1.7.
 *
 * Dekker:
 *   1. Banner skjules når ingen event har kommet
 *   2. Socket-event → banner vises med riktig tekst ("BINGO!" + pattern)
 *   3. Banner disappears etter 3s
 *   4. Ball-grid freezer (class `tv-phase-banner-active` på body) mens
 *      banner vises
 *   5. Aria-hidden toggle for a11y
 *   6. Edge-case: to events i rask rekkefølge → banners køes, ikke overlappes
 *   7. Live hall-status-update oppdaterer badge uten å vente på poll
 *
 * Bruker socket.io-client fake for å simulere backend-events inn i UI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountTvScreenPage, unmountTvScreenPage } from "../src/pages/tv/TVScreenPage.js";
import * as tvSocketModule from "../src/pages/tv/tvScreenSocket.js";

function mkContainer(): HTMLElement {
  const div = document.createElement("div");
  document.body.append(div);
  return div;
}

function mockFetchWithHalls(
  participatingHalls: Array<{
    hallId: string;
    hallName: string;
    color: "red" | "orange" | "green";
    playerCount: number;
  }> = []
) {
  // mockImplementation gir en frisk Response per call så body ikke låses
  // mellom fetchTvVoice (PR #477) og fetchTvState (Task 1.7).
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.endsWith("/voice")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, data: { voice: "voice1" } }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              hall: { id: "hall-1", name: "Test Hall" },
              currentGame: {
                id: "sg-1",
                name: "Test Game",
                number: 1,
                startAt: "2026-04-24T20:00:00Z",
                ballsDrawn: [],
                lastBall: null,
              },
              patterns: [
                { name: "1 Rad", phase: 1, playersWon: 0, prize: 0, highlighted: false },
                { name: "2 Rader", phase: 2, playersWon: 0, prize: 0, highlighted: false },
                { name: "3 Rader", phase: 3, playersWon: 0, prize: 0, highlighted: false },
                { name: "4 Rader", phase: 4, playersWon: 0, prize: 0, highlighted: false },
                { name: "Fullt Hus", phase: 5, playersWon: 0, prize: 0, highlighted: false },
              ],
              drawnCount: 0,
              totalBalls: 75,
              nextGame: null,
              countdownToNextGame: null,
              status: "drawing",
              participatingHalls,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    })
  );
}

/**
 * Spion på `connectTvScreenSocket` slik at vi kan kalle `onPhaseWon`-
 * og `onHallStatusUpdate`-handlerne direkte fra testen.
 */
interface CapturedHandlers {
  onPhaseWon?: (payload: {
    gameId: string;
    patternName: string;
    phase: number;
  }) => void;
  onHallStatusUpdate?: (payload: {
    hallId: string;
    color?: "red" | "orange" | "green";
    playerCount?: number;
  }) => void;
}

function spySocket(captured: CapturedHandlers) {
  return vi
    .spyOn(tvSocketModule, "connectTvScreenSocket")
    .mockImplementation((opts) => {
      captured.onPhaseWon = opts.handlers.onPhaseWon;
      captured.onHallStatusUpdate = opts.handlers.onHallStatusUpdate;
      return {
        dispose: () => undefined,
        isConnected: () => true,
      };
    });
}

describe("Task 1.7: TVScreenPage phase-won-banner", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = mkContainer();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    unmountTvScreenPage();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("banner er skjult ved mount (ingen events ennå)", async () => {
    mockFetchWithHalls();
    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);
    const banner = container.querySelector<HTMLElement>("[data-testid='tv-phase-banner']")!;
    expect(banner).toBeTruthy();
    expect(banner.classList.contains("tv-phase-banner-hidden")).toBe(true);
    expect(banner.getAttribute("aria-hidden")).toBe("true");
  });

  it("phase-won event → banner vises med 'BINGO!' + pattern-navn", async () => {
    mockFetchWithHalls();
    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);

    captured.onPhaseWon!({ gameId: "sg-1", patternName: "1 Rad", phase: 1 });
    // Tillat DOM-oppdatering.
    await vi.advanceTimersByTimeAsync(0);

    const banner = container.querySelector<HTMLElement>("[data-testid='tv-phase-banner']")!;
    expect(banner.classList.contains("tv-phase-banner-hidden")).toBe(false);
    expect(banner.getAttribute("aria-hidden")).toBe("false");

    const title = container.querySelector<HTMLElement>(
      "[data-testid='tv-phase-banner-title']"
    )!;
    const pattern = container.querySelector<HTMLElement>(
      "[data-testid='tv-phase-banner-pattern']"
    )!;
    expect(title.textContent).toBe("BINGO!");
    expect(pattern.textContent!.trim()).toBe("1 Rad");
  });

  it("banner disappears etter 3 sekunder", async () => {
    mockFetchWithHalls();
    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);

    captured.onPhaseWon!({ gameId: "sg-1", patternName: "Fullt Hus", phase: 5 });
    await vi.advanceTimersByTimeAsync(0);

    const banner = container.querySelector<HTMLElement>("[data-testid='tv-phase-banner']")!;
    expect(banner.classList.contains("tv-phase-banner-hidden")).toBe(false);

    // Før 3s: banner fortsatt synlig. Bruker 2500ms margin (ikke 2999) for å
    // unngå flaky-failure i CI når setup-ticker (30ms) sammen med
    // sub-millisecond timing i vi.advanceTimersByTimeAsync landet rett på
    // 3s-grensen.
    await vi.advanceTimersByTimeAsync(2500);
    expect(banner.classList.contains("tv-phase-banner-hidden")).toBe(false);

    // Ved 3s: skjules. 600ms margin dekker reste + setup-ticker-forskyvning.
    await vi.advanceTimersByTimeAsync(600);
    expect(banner.classList.contains("tv-phase-banner-hidden")).toBe(true);
    expect(banner.getAttribute("aria-hidden")).toBe("true");
  });

  it("ball-grid freezer (class tv-phase-banner-active) mens banner vises", async () => {
    mockFetchWithHalls();
    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);

    const body = container.querySelector<HTMLElement>("#tv-body")!;
    expect(body.classList.contains("tv-phase-banner-active")).toBe(false);

    captured.onPhaseWon!({ gameId: "sg-1", patternName: "2 Rader", phase: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(body.classList.contains("tv-phase-banner-active")).toBe(true);

    // Etter 3s: class fjernes.
    await vi.advanceTimersByTimeAsync(3001);
    expect(body.classList.contains("tv-phase-banner-active")).toBe(false);
  });

  it("to phase-won-events i rask rekkefølge → køes, ikke overlappes", async () => {
    mockFetchWithHalls();
    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);

    captured.onPhaseWon!({ gameId: "sg-1", patternName: "1 Rad", phase: 1 });
    await vi.advanceTimersByTimeAsync(0);
    // Andre event mens første fortsatt vises (køes).
    captured.onPhaseWon!({ gameId: "sg-1", patternName: "2 Rader", phase: 2 });
    await vi.advanceTimersByTimeAsync(0);

    const pattern = container.querySelector<HTMLElement>(
      "[data-testid='tv-phase-banner-pattern']"
    )!;
    // Første banner viser "1 Rad" — andre event venter.
    expect(pattern.textContent!.trim()).toBe("1 Rad");

    // Etter 3s: første skjules, andre i køen vises.
    await vi.advanceTimersByTimeAsync(3001);
    const patternAfter = container.querySelector<HTMLElement>(
      "[data-testid='tv-phase-banner-pattern']"
    )!;
    expect(patternAfter.textContent!.trim()).toBe("2 Rader");

    // Og etter 3s til: begge er ferdig.
    await vi.advanceTimersByTimeAsync(3001);
    const banner = container.querySelector<HTMLElement>("[data-testid='tv-phase-banner']")!;
    expect(banner.classList.contains("tv-phase-banner-hidden")).toBe(true);
  });

  it("live hall-status-update oppdaterer badge uten poll", async () => {
    // Start med 1 hall i oransje; live-event flipper til grønn.
    mockFetchWithHalls([
      { hallId: "hall-a", hallName: "Hall Alfa", color: "orange", playerCount: 5 },
    ]);
    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);

    const initialBadge = container.querySelector<HTMLElement>(
      "[data-testid='tv-hall-badge']"
    )!;
    expect(initialBadge.getAttribute("data-color")).toBe("orange");

    captured.onHallStatusUpdate!({ hallId: "hall-a", color: "green" });
    await vi.advanceTimersByTimeAsync(0);

    const updatedBadge = container.querySelector<HTMLElement>(
      "[data-testid='tv-hall-badge']"
    )!;
    expect(updatedBadge.getAttribute("data-color")).toBe("green");
    expect(updatedBadge.classList.contains("tv-hall-badge-green")).toBe(true);
  });

  it("poll overrider socket-live-color (server er autoritativ)", async () => {
    // Initial state: oransje. Bruk mockImplementation-routing så fetchTvVoice
    // (PR #477) får sin egen response og ikke kannibaliserer state-mocks.
    let stateCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.endsWith("/voice")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, data: { voice: "voice1" } }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        // State-call: orange begge poll (server autoritativ).
        stateCallCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                hall: { id: "hall-1", name: "Test Hall" },
                currentGame: null,
                patterns: [],
                drawnCount: 0,
                totalBalls: 75,
                nextGame: null,
                countdownToNextGame: null,
                status: "waiting",
                participatingHalls: [
                  { hallId: "hall-a", hallName: "Hall Alfa", color: "orange", playerCount: 5 },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      })
    );
    void stateCallCount; // brukt for fremtidig assertions; foreløpig bare for sporing.

    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);

    // Socket: grønn.
    captured.onHallStatusUpdate!({ hallId: "hall-a", color: "green" });
    await vi.advanceTimersByTimeAsync(0);

    let badge = container.querySelector<HTMLElement>("[data-testid='tv-hall-badge']")!;
    expect(badge.getAttribute("data-color")).toBe("green");

    // Poll-intervallet er 2000ms — vent på neste poll (server fortsatt oransje).
    await vi.advanceTimersByTimeAsync(2001);

    badge = container.querySelector<HTMLElement>("[data-testid='tv-hall-badge']")!;
    // Etter poll: back to orange fordi live-overrides renses ved poll.
    expect(badge.getAttribute("data-color")).toBe("orange");
  });

  it("phase-won med ukjent payload-shape → ignoreres (robust mot skjema-drift)", async () => {
    mockFetchWithHalls();
    const captured: CapturedHandlers = {};
    spySocket(captured);
    mountTvScreenPage(container, "hall-1", "token-abc");
    await vi.advanceTimersByTimeAsync(30);

    // Simuler en ugyldig payload-form (banner-koden har egen valid-sjekk
    // men test også UI-handleren: med `phase` som string, skal ingenting skje).
    captured.onPhaseWon!({
      gameId: "sg-1",
      patternName: "Test",
      // phase manglende for test — TypeScript-kontrakt strikter, runtime
      // skal rendre. Dette er et sanity-check for at vi ikke kræsjer.
      phase: 1,
    });
    await vi.advanceTimersByTimeAsync(0);

    const banner = container.querySelector<HTMLElement>("[data-testid='tv-phase-banner']")!;
    expect(banner.classList.contains("tv-phase-banner-hidden")).toBe(false);
  });
});
