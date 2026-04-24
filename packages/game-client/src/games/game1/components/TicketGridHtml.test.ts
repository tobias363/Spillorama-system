/**
 * @vitest-environment happy-dom
 *
 * TicketGridHtml tests — container for the new HTML ticket pipeline.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TicketGridHtml } from "./TicketGridHtml.js";
import type { Ticket } from "@spillorama/shared-types/game";
import type { GameState } from "../../../bridge/GameBridge.js";

function makeTicket(i: number, color: string): Ticket {
  return {
    id: `tkt-${i}`,
    grid: [
      [i * 10 + 1, i * 10 + 2, i * 10 + 3, i * 10 + 4, i * 10 + 5],
      [i * 10 + 6, i * 10 + 7, i * 10 + 8, i * 10 + 9, i * 10 + 10],
      [i * 10 + 11, i * 10 + 12, 0, i * 10 + 14, i * 10 + 15],
      [i * 10 + 16, i * 10 + 17, i * 10 + 18, i * 10 + 19, i * 10 + 20],
      [i * 10 + 21, i * 10 + 22, i * 10 + 23, i * 10 + 24, i * 10 + 25],
    ],
    color,
    type: "small",
  };
}

function makeState(override: Partial<GameState> = {}): GameState {
  return {
    roomCode: "ROOM1",
    hallId: "hall-test",
    gameStatus: "WAITING",
    gameId: null,
    players: [],
    playerCount: 1,
    drawnNumbers: [],
    lastDrawnNumber: null,
    drawCount: 0,
    totalDrawCapacity: 75,
    myTickets: [],
    myMarks: [],
    myPlayerId: "p1",
    patterns: [],
    patternResults: [],
    prizePool: 0,
    entryFee: 10,
    myLuckyNumber: null,
    luckyNumbers: {},
    millisUntilNextStart: null,
    autoDrawEnabled: false,
    canStartNow: false,
    disableBuyAfterBalls: 0,
    isPaused: false,
    pauseMessage: null,
    gameType: "standard",
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    replaceAmount: 0,
    jackpot: null,
    preRoundTickets: [],
    isArmed: false,
    myStake: 0,
    serverTimestamp: Date.now(),
    ...override,
  } as GameState;
}

describe("TicketGridHtml", () => {
  let grid: TicketGridHtml;
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
    grid = new TicketGridHtml();
    grid.mount(parent);
  });

  it("starts empty", () => {
    expect(grid.root.querySelectorAll("[data-number]").length).toBe(0);
  });

  it("renders one ticket per entry", () => {
    const tickets = [makeTicket(0, "Small Yellow"), makeTicket(1, "Small White")];
    grid.setTickets(tickets, { cancelable: false, entryFee: 10, state: makeState() });

    // 2 tickets × 25 cells = 50.
    expect(grid.root.querySelectorAll("[data-number]").length).toBe(50);
    // Two different headers.
    const headers = Array.from(grid.root.querySelectorAll(".ticket-header-name")).map(
      (e) => (e as HTMLElement).textContent,
    );
    expect(headers).toEqual(["Small Yellow", "Small White"]);
  });

  it("diff-renders unchanged tickets (same signature → same DOM nodes)", () => {
    const t = [makeTicket(0, "Small Yellow")];
    grid.setTickets(t, { cancelable: false, entryFee: 10, state: makeState() });
    const firstCell = grid.root.querySelector("[data-number]") as HTMLElement;

    // Second call with identical ticket shape — signature matches, no rebuild.
    grid.setTickets(t, { cancelable: false, entryFee: 10, state: makeState() });
    const secondCell = grid.root.querySelector("[data-number]") as HTMLElement;
    expect(firstCell).toBe(secondCell);
  });

  it("rebuilds when colour changes (different signature)", () => {
    grid.setTickets([makeTicket(0, "Small Yellow")], { cancelable: false, entryFee: 10, state: makeState() });
    const firstCell = grid.root.querySelector("[data-number]") as HTMLElement;

    grid.setTickets([makeTicket(0, "Small Red")], { cancelable: false, entryFee: 10, state: makeState() });
    const secondCell = grid.root.querySelector("[data-number]") as HTMLElement;
    expect(firstCell).not.toBe(secondCell);

    const header = grid.root.querySelector(".ticket-header-name") as HTMLElement;
    expect(header.textContent).toBe("Small Red");
  });

  it("rebuilds when cancelable flag toggles", () => {
    grid.setTickets([makeTicket(0, "Small Yellow")], { cancelable: true, entryFee: 10, state: makeState() });
    expect(grid.root.querySelector("button[aria-label='Avbestill brett']")).not.toBeNull();

    grid.setTickets([makeTicket(0, "Small Yellow")], { cancelable: false, entryFee: 10, state: makeState() });
    expect(grid.root.querySelector("button[aria-label='Avbestill brett']")).toBeNull();
  });

  it("applies drawnNumbers as marks on live tickets (liveTicketCount > 0)", () => {
    // 2026-04-21: Marks only apply to live tickets — pre-round brett (for
    // the next round) stay unmarked even when drawnNumbers is non-empty.
    // Callers must pass liveTicketCount to signal which are live.
    const state = makeState({ drawnNumbers: [7] }); // ticket 0 cell (i*10+7 → 7)
    grid.setTickets([makeTicket(0, "Small Yellow")], {
      cancelable: false, entryFee: 10, state, liveTicketCount: 1,
    });

    // 25 cells; free centre always marked so remaining = 23 after marking 7.
    const headerRemaining = grid.root.querySelector(".ticket-togo") as HTMLDivElement;
    expect(headerRemaining.textContent).toContain("23");
  });

  it("does NOT apply drawnNumbers to pre-round tickets (liveTicketCount = 0)", () => {
    const state = makeState({ drawnNumbers: [7] });
    grid.setTickets([makeTicket(0, "Small Yellow")], {
      cancelable: true, entryFee: 10, state, liveTicketCount: 0,
    });

    // All 24 non-centre cells remain unmarked for a pre-round brett.
    const headerRemaining = grid.root.querySelector(".ticket-togo") as HTMLDivElement;
    expect(headerRemaining.textContent).toContain("24");
  });

  it("propagates markNumberOnAll to every LIVE ticket (pre-round ignored)", () => {
    // liveTicketCount: 2 — begge brett er live, begge skal få mark-kall.
    grid.setTickets([makeTicket(0, "Small Yellow"), makeTicket(1, "Small White")], {
      cancelable: false,
      entryFee: 10,
      state: makeState(),
      liveTicketCount: 2,
    });
    // i=0 ticket has number 7 in its grid; i=1 ticket has number 17.
    grid.markNumberOnAll(7);
    const toGoTexts = Array.from(grid.root.querySelectorAll(".ticket-togo")).map(
      (e) => (e as HTMLElement).textContent,
    );
    // First ticket (had 7) shows 23 remaining, second (no 7) still 24.
    expect(toGoTexts[0]).toContain("23");
    expect(toGoTexts[1]).toContain("24");
  });

  it("markNumberOnAll skips pre-round tickets (index ≥ liveCount)", () => {
    // liveTicketCount: 1 — bare første brett er live. Andre brett er pre-round.
    grid.setTickets([makeTicket(0, "Small Yellow"), makeTicket(1, "Small White")], {
      cancelable: false,
      entryFee: 10,
      state: makeState(),
      liveTicketCount: 1,
    });
    grid.markNumberOnAll(7);
    const toGoTexts = Array.from(grid.root.querySelectorAll(".ticket-togo")).map(
      (e) => (e as HTMLElement).textContent,
    );
    // Live-brettet (i=0) fikk marken selv om det ikke inneholdt 7... vent,
    // det INNEHOLDER 7 per makeTicket. Live-brett markeres. Pre-round-brett
    // (i=1) skal IKKE markeres selv om det potensielt inneholder tallet.
    // I dette testoppsettet inneholder ikke i=1 tallet 7, så "24" uansett.
    expect(toGoTexts[0]).toContain("23");
    expect(toGoTexts[1]).toContain("24");
  });

  it("clear() empties the grid", () => {
    grid.setTickets([makeTicket(0, "Small Yellow")], { cancelable: false, entryFee: 10, state: makeState() });
    grid.clear();
    expect(grid.root.querySelectorAll("[data-number]").length).toBe(0);
  });

  it("setBounds positions and sizes the root", () => {
    grid.setBounds(10, 20, 500, 600);
    expect(grid.root.style.left).toBe("10px");
    expect(grid.root.style.top).toBe("20px");
    expect(grid.root.style.width).toBe("500px");
    expect(grid.root.style.height).toBe("600px");
  });

  it("forwards onCancelTicket to children", () => {
    let cancelled: string | null = null;
    const g = new TicketGridHtml({ onCancelTicket: (id) => { cancelled = id; } });
    g.mount(parent);
    g.setTickets([makeTicket(0, "Small Yellow")], { cancelable: true, entryFee: 10, state: makeState() });
    const btn = g.root.querySelector("button[aria-label='Avbestill brett']") as HTMLButtonElement;
    btn.click();
    expect(cancelled).toBe("tkt-0");
  });
});
