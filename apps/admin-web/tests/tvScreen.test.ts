/**
 * TV Screen + Winners public page tests.
 *
 * Dekker:
 *   - parseTvRoute: parser /tv/:hallId/:tvToken[/winners]
 *   - TVScreenPage: render med mock-state — pattern-rows, last-ball,
 *     ballsDrawn, voice-select persistering
 *   - WinnersPage: render med mock-summary — 3 store bokser, tabell
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseTvRoute, isTvRoute } from "../src/pages/tv/index.js";
import { mountTvScreenPage, unmountTvScreenPage } from "../src/pages/tv/TVScreenPage.js";
import { mountWinnersPage, unmountWinnersPage } from "../src/pages/tv/WinnersPage.js";

function mkContainer(): HTMLElement {
  const div = document.createElement("div");
  document.body.append(div);
  return div;
}

describe("parseTvRoute", () => {
  it("parses /tv/<hallId>/<token> as screen mode", () => {
    const m = parseTvRoute("/tv/hall-1/token-abc");
    expect(m).toEqual({ hallId: "hall-1", tvToken: "token-abc", mode: "screen" });
  });

  it("parses /tv/<hallId>/<token>/winners as winners mode", () => {
    const m = parseTvRoute("/tv/hall-1/token-abc/winners");
    expect(m).toEqual({ hallId: "hall-1", tvToken: "token-abc", mode: "winners" });
  });

  it("url-decodes path components", () => {
    const m = parseTvRoute("/tv/hall%20one/token%2Bx");
    expect(m).toEqual({ hallId: "hall one", tvToken: "token+x", mode: "screen" });
  });

  it("returns null for non-TV paths", () => {
    expect(parseTvRoute("/admin")).toBeNull();
    expect(parseTvRoute("/tv")).toBeNull();
    expect(parseTvRoute("/tv/hall-1")).toBeNull();
  });

  it("isTvRoute matches canonical forms", () => {
    expect(isTvRoute("/tv/h/t")).toBe(true);
    expect(isTvRoute("/tv/h/t/winners")).toBe(true);
    expect(isTvRoute("/admin")).toBe(false);
  });
});

describe("TVScreenPage rendering", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = mkContainer();
    // Stub fetch så rendering-pathen ikke treffer nettverk.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              hall: { id: "hall-1", name: "Test Hall" },
              currentGame: {
                id: "sg-1",
                name: "Mystery",
                number: 3,
                startAt: "2026-04-23T20:00:00Z",
                ballsDrawn: [71, 31, 1, 46, 75, 16],
                lastBall: 16,
              },
              patterns: [
                { name: "Row 1", phase: 1, playersWon: 5, prize: 10000, highlighted: true },
                { name: "Row 2", phase: 2, playersWon: 0, prize: 0, highlighted: false },
                { name: "Row 3", phase: 3, playersWon: 0, prize: 0, highlighted: false },
                { name: "Row 4", phase: 4, playersWon: 0, prize: 0, highlighted: false },
                { name: "Full House", phase: 5, playersWon: 0, prize: 0, highlighted: false },
              ],
              countdownToNextGame: null,
              status: "drawing",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
  });

  afterEach(() => {
    unmountTvScreenPage();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("mounts TV Screen header + voice select", async () => {
    mountTvScreenPage(container, "hall-1", "token-abc");
    expect(container.querySelector("[data-testid='tv-screen-host']")).toBeTruthy();
    expect(container.querySelector(".tv-header")!.textContent).toBe("SPILL-O-RAMA BINGO");
    const sel = container.querySelector<HTMLSelectElement>("[data-testid='tv-voice-select']")!;
    expect(sel.options.length).toBe(3);
  });

  it("renders state after initial fetch", async () => {
    mountTvScreenPage(container, "hall-1", "token-abc");
    // Wait for the async tick to render.
    await new Promise((r) => setTimeout(r, 10));
    const title = container.querySelector("[data-testid='tv-game-title']")!;
    expect(title.textContent).toContain("Game 3");
    expect(title.textContent).toContain("Mystery");
    expect(container.querySelector("[data-testid='tv-last-ball']")!.textContent!.trim()).toBe("16");
    expect(container.querySelector("[data-testid='tv-total-draws']")!.textContent).toBe("6");
    const rows = container.querySelectorAll("[data-testid='tv-pattern-row']");
    expect(rows.length).toBe(5);
    expect(rows[0]!.classList.contains("highlighted")).toBe(true);
  });

  it("persists voice-selection to localStorage per hall", async () => {
    mountTvScreenPage(container, "hall-1", "token-abc");
    const sel = container.querySelector<HTMLSelectElement>("[data-testid='tv-voice-select']")!;
    sel.value = "voice-2";
    sel.dispatchEvent(new Event("change"));
    expect(window.localStorage.getItem("tv_voice_hall-1")).toBe("voice-2");
  });

  it("restores voice-selection from localStorage on mount", async () => {
    window.localStorage.setItem("tv_voice_hall-42", "voice-3");
    mountTvScreenPage(container, "hall-42", "token-abc");
    const sel = container.querySelector<HTMLSelectElement>("[data-testid='tv-voice-select']")!;
    expect(sel.value).toBe("voice-3");
  });
});

describe("WinnersPage rendering", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = mkContainer();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              totalNumbersWithdrawn: 74,
              fullHouseWinners: 1,
              patternsWon: 5,
              winners: [
                { pattern: "Row 1", phase: 1, playersWon: 5, prizePerTicket: 5000, hallName: "Test Hall" },
                { pattern: "Row 2", phase: 2, playersWon: 0, prizePerTicket: 0, hallName: "" },
                { pattern: "Row 3", phase: 3, playersWon: 0, prizePerTicket: 0, hallName: "" },
                { pattern: "Row 4", phase: 4, playersWon: 0, prizePerTicket: 0, hallName: "" },
                { pattern: "Full House", phase: 5, playersWon: 1, prizePerTicket: 20000, hallName: "Test Hall" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
  });

  afterEach(() => {
    unmountWinnersPage();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("mounts Winners header", () => {
    mountWinnersPage(container, "hall-1", "token-abc");
    expect(container.querySelector("[data-testid='tv-winners-host']")).toBeTruthy();
    expect(container.querySelector(".tv-header")!.textContent).toBe("Winners");
  });

  it("renders 3 summary boxes with correct values", async () => {
    mountWinnersPage(container, "hall-1", "token-abc");
    await new Promise((r) => setTimeout(r, 10));
    const total = container.querySelector("[data-testid='tv-winners-box-total']")!;
    const fh = container.querySelector("[data-testid='tv-winners-box-fullhouse']")!;
    const patterns = container.querySelector("[data-testid='tv-winners-box-patterns']")!;
    expect(total.querySelector(".tv-winners-box-value")!.textContent).toBe("74");
    expect(fh.querySelector(".tv-winners-box-value")!.textContent).toBe("1");
    expect(patterns.querySelector(".tv-winners-box-value")!.textContent).toBe("5");
  });

  it("renders 5 winner rows with pattern names", async () => {
    mountWinnersPage(container, "hall-1", "token-abc");
    await new Promise((r) => setTimeout(r, 10));
    const rows = container.querySelectorAll("[data-testid='tv-winners-row']");
    expect(rows.length).toBe(5);
    expect(rows[0]!.textContent).toContain("Row 1");
    expect(rows[4]!.textContent).toContain("Full House");
  });
});
