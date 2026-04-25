/**
 * Task 1.7 (2026-04-24): tester for badge-stripen som viser deltakende haller
 * med 🔴/🟠/🟢-fargekode.
 *
 * Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md §6 Task 1.7.
 *
 * Dekker:
 *   1. Tom participatingHalls → stripe skjules (tv-halls-stripe-hidden class)
 *   2. Tre haller (rød/oransje/grønn) → tre badges med riktig class + dot
 *   3. Player-count vises i badge
 *   4. Stripe synlig så snart state har ≥ 1 hall
 *
 * Tests disabler socket så vi ikke trenger socket.io-mocking her;
 * phase-won-banner dekkes i egen fil.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountTvScreenPage, unmountTvScreenPage } from "../src/pages/tv/TVScreenPage.js";

function mkContainer(): HTMLElement {
  const div = document.createElement("div");
  document.body.append(div);
  return div;
}

function mockFetchState(participatingHalls: Array<{ hallId: string; hallName: string; color: "red" | "orange" | "green"; playerCount: number }>) {
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

describe("Task 1.7: TVScreenPage badge-stripe — rendering av 3 farger", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = mkContainer();
  });

  afterEach(() => {
    unmountTvScreenPage();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("tom participatingHalls → stripen er skjult", async () => {
    mockFetchState([]);
    mountTvScreenPage(container, "hall-1", "token-abc", { disableSocket: true });
    await new Promise((r) => setTimeout(r, 20));
    const stripe = container.querySelector<HTMLElement>("[data-testid='tv-halls-stripe']");
    expect(stripe).toBeTruthy();
    expect(stripe!.classList.contains("tv-halls-stripe-hidden")).toBe(true);
    expect(stripe!.children.length).toBe(0);
  });

  it("rendrer tre badges for 3 haller med ulike farger", async () => {
    mockFetchState([
      { hallId: "hall-a", hallName: "Hall Alfa", color: "green", playerCount: 10 },
      { hallId: "hall-b", hallName: "Hall Bravo", color: "orange", playerCount: 3 },
      { hallId: "hall-c", hallName: "Hall Charlie", color: "red", playerCount: 0 },
    ]);
    mountTvScreenPage(container, "hall-1", "token-abc", { disableSocket: true });
    await new Promise((r) => setTimeout(r, 20));

    const stripe = container.querySelector<HTMLElement>("[data-testid='tv-halls-stripe']")!;
    expect(stripe.classList.contains("tv-halls-stripe-hidden")).toBe(false);

    const badges = container.querySelectorAll<HTMLElement>("[data-testid='tv-hall-badge']");
    expect(badges.length).toBe(3);

    // Bekreft farge-classes.
    expect(badges[0]!.classList.contains("tv-hall-badge-green")).toBe(true);
    expect(badges[1]!.classList.contains("tv-hall-badge-orange")).toBe(true);
    expect(badges[2]!.classList.contains("tv-hall-badge-red")).toBe(true);

    // Bekreft data-color attribute.
    expect(badges[0]!.getAttribute("data-color")).toBe("green");
    expect(badges[1]!.getAttribute("data-color")).toBe("orange");
    expect(badges[2]!.getAttribute("data-color")).toBe("red");

    // Navnene rendres.
    expect(badges[0]!.textContent).toContain("Hall Alfa");
    expect(badges[1]!.textContent).toContain("Hall Bravo");
    expect(badges[2]!.textContent).toContain("Hall Charlie");

    // Player-count rendres i badge.
    const counts = container.querySelectorAll<HTMLElement>(
      "[data-testid='tv-hall-badge-count']"
    );
    expect(counts.length).toBe(3);
    expect(counts[0]!.textContent!.trim()).toBe("10");
    expect(counts[1]!.textContent!.trim()).toBe("3");
    expect(counts[2]!.textContent!.trim()).toBe("0");
  });

  it("badge viser fargesirkel-dot (visuell indikator)", async () => {
    mockFetchState([
      { hallId: "hall-a", hallName: "Hall Alfa", color: "green", playerCount: 5 },
    ]);
    mountTvScreenPage(container, "hall-1", "token-abc", { disableSocket: true });
    await new Promise((r) => setTimeout(r, 20));

    const dot = container.querySelector<HTMLElement>(".tv-hall-badge-dot");
    expect(dot).toBeTruthy();
  });

  it("hall med lang navn rendres likevel uten clipping-artifacts i DOM", async () => {
    mockFetchState([
      {
        hallId: "hall-x",
        hallName: "Very Long Hall Name That Exceeds Normal Width",
        color: "green",
        playerCount: 7,
      },
    ]);
    mountTvScreenPage(container, "hall-1", "token-abc", { disableSocket: true });
    await new Promise((r) => setTimeout(r, 20));

    const badge = container.querySelector<HTMLElement>("[data-testid='tv-hall-badge']")!;
    expect(badge.textContent).toContain("Very Long Hall Name");
    // Sjekk title-attribute (tooltip) er satt.
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("Very Long Hall Name");
    expect(title).toContain("7");
  });

  it("mellom polls: stripe beholdes med siste hall-state (ikke flicker til hidden)", async () => {
    mockFetchState([
      { hallId: "hall-a", hallName: "Hall Alfa", color: "green", playerCount: 10 },
    ]);
    mountTvScreenPage(container, "hall-1", "token-abc", { disableSocket: true });
    await new Promise((r) => setTimeout(r, 20));

    let stripe = container.querySelector<HTMLElement>("[data-testid='tv-halls-stripe']")!;
    expect(stripe.classList.contains("tv-halls-stripe-hidden")).toBe(false);
    expect(stripe.querySelectorAll("[data-testid='tv-hall-badge']").length).toBe(1);

    // Vi lar fetch-mock returnere samme state igjen (polling-scenario).
    await new Promise((r) => setTimeout(r, 10));
    stripe = container.querySelector<HTMLElement>("[data-testid='tv-halls-stripe']")!;
    expect(stripe.querySelectorAll("[data-testid='tv-hall-badge']").length).toBe(1);
  });

  it("stabil sortering fra backend brukes (haller i samme rekkefølge)", async () => {
    // Backend sorterer alfabetisk — her tester vi at TVen IKKE re-sorterer.
    mockFetchState([
      { hallId: "hall-z", hallName: "Zulu", color: "green", playerCount: 1 },
      { hallId: "hall-a", hallName: "Alfa", color: "green", playerCount: 2 },
      { hallId: "hall-m", hallName: "Mike", color: "green", playerCount: 3 },
    ]);
    mountTvScreenPage(container, "hall-1", "token-abc", { disableSocket: true });
    await new Promise((r) => setTimeout(r, 20));

    const badges = container.querySelectorAll<HTMLElement>("[data-testid='tv-hall-badge']");
    // TVen bevarer backend-rekkefølgen.
    expect(badges[0]!.getAttribute("data-hall-id")).toBe("hall-z");
    expect(badges[1]!.getAttribute("data-hall-id")).toBe("hall-a");
    expect(badges[2]!.getAttribute("data-hall-id")).toBe("hall-m");
  });
});
