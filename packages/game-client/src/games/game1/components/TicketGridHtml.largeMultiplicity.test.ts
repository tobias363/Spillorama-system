/**
 * @vitest-environment happy-dom
 *
 * REGRESSION 2026-04-30 Bug B (frontend rendering layer) — Tobias rapporterte:
 * "Demo Hall buy-popup viser 'Large Yellow · 30 kr · 3 brett', men
 *  faktisk skjermbilde viser kun 6 brett (5 Smalls + 1 Large Yellow synlig)
 *  i stedet for forventede 8 brett (5 Smalls + 3 Large Yellow)."
 *
 * Backend-verifiseringen i `apps/backend/src/__tests__/buyTicket.largeMultiplicity.realRender.test.ts`
 * bekrefter at wire-payloaden faktisk inneholder 8 separate ticket-objekter
 * (5 Smalls + 3 Large Yellow). Hvis frontend allikevel viser 6 må feilen
 * ligge i `TicketGridHtml.setTickets` / `rebuild` — dvs. dedup, sortering
 * eller signature-mismatch som filtrerer bort identiske farger.
 *
 * Disse testene matcher backend-real-render-testene 1:1, men sjekker det
 * andre endepunktet i pipelinen: at TicketGridHtml gjenkjenner alle 3
 * Large Yellow som distinkte brett og rendrer dem som 3 separate
 * 5×5-grids i DOM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TicketGridHtml } from "./TicketGridHtml.js";
import type { Ticket } from "@spillorama/shared-types/game";
import type { GameState } from "../../../bridge/GameBridge.js";

/**
 * Mat hver ticket med et unikt grid for å holde signature-en distinkt.
 * Bug B kan trigge hvis 3 Large Yellow har samme grid-fingerprint
 * (samme tall i grid[0]) — da blir computeSignature lik for alle 3
 * og setTickets short-circuiter via lastSignature-cache.
 */
function makeTicket(i: number, color: string, type: string = "small"): Ticket {
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
    type,
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
      { name: "Small Orange", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Small Purple", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Small Red", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Large Yellow", type: "large", priceMultiplier: 3, ticketCount: 3 },
      { name: "Large White", type: "large", priceMultiplier: 3, ticketCount: 3 },
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

describe("TicketGridHtml — Bug B Large multiplicity rendering", () => {
  let grid: TicketGridHtml;
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
    grid = new TicketGridHtml();
    grid.mount(parent);
  });

  it("renderer 3 separate brett når 3 Large Yellow med distinkte grids passes inn", () => {
    // Backend leverer 3 separate ticket-objekter for 1 × Large Yellow (qty=1, ticketCount=3).
    // Hver må få sin egen 5×5-grid + sin egen DOM-kort.
    const tickets = [
      makeTicket(0, "Large Yellow", "large"),
      makeTicket(1, "Large Yellow", "large"),
      makeTicket(2, "Large Yellow", "large"),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 10,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 3 brett × 25 celler = 75 grid-celler.
    expect(grid.root.querySelectorAll("[data-number]").length).toBe(75);

    // 3 distinkte ticket-headere — alle med "Large Yellow" som farge-navn.
    const headers = Array.from(grid.root.querySelectorAll(".ticket-header-name"))
      .map((e) => (e as HTMLElement).textContent);
    expect(headers).toEqual(["Large Yellow", "Large Yellow", "Large Yellow"]);
    expect(headers.length).toBe(3);
  });

  it("Tobias' actual scenario: 5 Smalls + 3 Large Yellow = 8 distinkte brett", () => {
    // Tobias rapporterte: kjøpte 2× Small Orange + 1 Small White + 1 Small Purple
    //   + 1 Small Red + 1 Large Yellow → forventet 8 brett, så bare 6 i UI.
    // Backend leverer korrekt 8 ticket-objekter (verifisert via real-render-test).
    const tickets = [
      makeTicket(0, "Small Orange", "small"),
      makeTicket(1, "Small Orange", "small"),
      makeTicket(2, "Small White", "small"),
      makeTicket(3, "Small Purple", "small"),
      makeTicket(4, "Small Red", "small"),
      makeTicket(5, "Large Yellow", "large"),
      makeTicket(6, "Large Yellow", "large"),
      makeTicket(7, "Large Yellow", "large"),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 10,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 8 brett × 25 celler = 200 grid-celler.
    expect(grid.root.querySelectorAll("[data-number]").length).toBe(200);

    // 8 distinkte ticket-headere
    const headers = Array.from(grid.root.querySelectorAll(".ticket-header-name"))
      .map((e) => (e as HTMLElement).textContent);
    expect(headers.length).toBe(8);

    // Tell antall per farge
    const counts: Record<string, number> = {};
    for (const h of headers) {
      const k = h ?? "?";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts["Small Orange"]).toBe(2);
    expect(counts["Small White"]).toBe(1);
    expect(counts["Small Purple"]).toBe(1);
    expect(counts["Small Red"]).toBe(1);
    expect(counts["Large Yellow"]).toBe(3);
  });

  it("renderer 6 brett ved 1 Large Yellow + 1 Large White (3 + 3)", () => {
    const tickets = [
      makeTicket(0, "Large Yellow", "large"),
      makeTicket(1, "Large Yellow", "large"),
      makeTicket(2, "Large Yellow", "large"),
      makeTicket(3, "Large White", "large"),
      makeTicket(4, "Large White", "large"),
      makeTicket(5, "Large White", "large"),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 10,
      state: makeState(),
      liveTicketCount: 0,
    });

    expect(grid.root.querySelectorAll("[data-number]").length).toBe(150);

    const headers = Array.from(grid.root.querySelectorAll(".ticket-header-name"))
      .map((e) => (e as HTMLElement).textContent);
    expect(headers.length).toBe(6);

    const yellowCount = headers.filter((h) => h === "Large Yellow").length;
    const whiteCount = headers.filter((h) => h === "Large White").length;
    expect(yellowCount).toBe(3);
    expect(whiteCount).toBe(3);
  });

  it("renderer 3 brett ved Large Yellow med MANGLENDE id (legacy clients) — fingerprint via grid[0]", () => {
    // Sjekk at signature-distinksjonen virker uten id (Tickets generert
    // av enrichTicketList kan komme uten id ved live-game-runtime; kun
    // pre-round-tickets fra display-cache har "tkt-{i}"-id-er).
    const t1: Ticket = { ...makeTicket(0, "Large Yellow", "large") };
    delete (t1 as unknown as { id?: string }).id;
    const t2: Ticket = { ...makeTicket(1, "Large Yellow", "large") };
    delete (t2 as unknown as { id?: string }).id;
    const t3: Ticket = { ...makeTicket(2, "Large Yellow", "large") };
    delete (t3 as unknown as { id?: string }).id;

    grid.setTickets([t1, t2, t3], {
      cancelable: false,
      entryFee: 10,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 3 brett × 25 celler = 75 celler — verifiserer at signature-fix-en
    // (grid[0] som fallback for id) faktisk gir distinkte signaturer for
    // 3 forskjellige brett selv uten id.
    expect(grid.root.querySelectorAll("[data-number]").length).toBe(75);
    const headers = Array.from(grid.root.querySelectorAll(".ticket-header-name"))
      .map((e) => (e as HTMLElement).textContent);
    expect(headers.length).toBe(3);
  });
});
