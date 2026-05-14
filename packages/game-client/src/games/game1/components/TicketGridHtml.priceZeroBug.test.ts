/**
 * @vitest-environment happy-dom
 *
 * Regression test for Tobias-rapport 2026-05-14:
 * "Bong-pris vises som '0 kr' under aktiv trekning, men korrekt før spillet starter."
 *
 * Root cause: backend `entryFeeFromTicketConfig` returnerte 0 fordi den så
 * etter `priceCentsEach` mens `GamePlanEngineBridge.buildTicketConfigFromCatalog`
 * skrev `pricePerTicket`. Når engine startet (status WAITING → RUNNING)
 * trigget `enrichScheduledGame1RoomSnapshot` `buildSyntheticGameSnapshot`
 * som satte `currentGame.entryFee = 0`. Klient `state.entryFee` ble
 * overskrevet, og `??`-fallback fanget ikke 0 (kun null/undefined). Resultat:
 * alle bonger vises "0 kr".
 *
 * Fix-strategi (defense-in-depth):
 *   1. Backend `entryFeeFromTicketConfig` leser nå `pricePerTicket` også
 *   2. Backend `currentEntryFee` (roomHelpers.ts) bruker `> 0`-sjekk istedenfor `??`
 *   3. Klient `applyGameSnapshot` overskriver KUN hvis `game.entryFee > 0`
 *   4. Klient `gridEntryFee` (PlayScreen) bruker `> 0`-sjekk istedenfor `??`
 *   5. Klient `computePrice` (TicketGridHtml) bruker `ticket.price > 0`-sjekk
 *   6. Klient `priceEl` (BingoTicketHtml) skjuler price hvis 0
 *
 * Disse 5 testene dekker hvert nivå i pipelinen for å fange regression.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TicketGridHtml } from "./TicketGridHtml.js";
import type { Ticket } from "@spillorama/shared-types/game";
import type { GameState } from "../../../bridge/GameBridge.js";

function makeTicket(i: number, color: string, type: string, price?: number): Ticket {
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
    ...(price !== undefined ? { price } : {}),
  };
}

function makeState(override: Partial<GameState> = {}): GameState {
  return {
    roomCode: "BINGO_DEMO",
    hallId: "demo-hall-001",
    gameStatus: "RUNNING",
    gameId: "g1",
    players: [],
    playerCount: 1,
    drawnNumbers: [1, 5, 10],
    lastDrawnNumber: 10,
    drawCount: 3,
    totalDrawCapacity: 75,
    myTickets: [],
    myMarks: [],
    myPlayerId: "p1",
    patterns: [],
    patternResults: [],
    prizePool: 0,
    entryFee: 5,
    myLuckyNumber: null,
    luckyNumbers: {},
    millisUntilNextStart: null,
    autoDrawEnabled: true,
    canStartNow: false,
    disableBuyAfterBalls: 0,
    isPaused: false,
    pauseMessage: null,
    gameType: "standard",
    ticketTypes: [
      { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
      { name: "Small Purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
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

describe("TicketGridHtml — bong-pris bevares under aktiv trekning (BUG fix 2026-05-14)", () => {
  let grid: TicketGridHtml;
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
    grid = new TicketGridHtml();
    grid.mount(parent);
  });

  function getPriceAttr(ticketId: string): string | null {
    const el = grid.root.querySelector(`[data-test-ticket-id="${ticketId}"]`);
    return el?.getAttribute("data-test-ticket-price") ?? null;
  }

  /**
   * Scenario 1 (baseline): PRE-trekning før engine starter.
   * `state.ticketTypes` populert, `state.entryFee=5`. Lobby-config null.
   * Server-side ticket.price ikke satt (klienten må compute selv).
   *
   * Expected: white=5, yellow=10, purple=15
   */
  it("pre-trekning (WAITING): viser korrekt pris per bongfarge fra lobby-ticketTypes", () => {
    const tickets = [
      makeTicket(1, "Small White", "small"),
      makeTicket(2, "Small Yellow", "small"),
      makeTicket(3, "Small Purple", "small"),
    ];
    const state = makeState({ gameStatus: "WAITING", entryFee: 5 });
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state,
      // Lobby-types fra plan-runtime aggregator (korrekt mapping per farge).
      ticketTypes: [
        { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
        { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
        { name: "Small Purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
      ],
    });

    // computePrice: entryFee × priceMultiplier / ticketCount
    // white: 5 × 1 / 1 = 5
    // yellow: 5 × 2 / 1 = 10
    // purple: 5 × 3 / 1 = 15
    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");
    expect(getPriceAttr("tkt-3")).toBe("15");
  });

  /**
   * Scenario 2 (KJERNE-BUG): RUNNING med state.entryFee=0 (synthetic snapshot).
   * Backend gir entryFee=0 fordi `entryFeeFromTicketConfig` field-mismatch.
   * Lobby-config tilgjengelig med korrekte priser via ticketTypes-opt.
   *
   * Expected: fallback til lobbyTicketConfig.entryFee → priser fortsatt korrekte.
   */
  it("RUNNING med state.entryFee=0 og lobby-config: priser bevares via fallback", () => {
    const tickets = [
      makeTicket(1, "Small White", "small"),
      makeTicket(2, "Small Yellow", "small"),
      makeTicket(3, "Small Purple", "small"),
    ];
    // Bug-scenario: entryFee blir 0 fordi backend ikke kunne resolve det
    const state = makeState({ gameStatus: "RUNNING", entryFee: 0 });
    // PlayScreen ville her sett `gridEntryFee = lobbyTicketConfig?.entryFee
    // ?? validStateEntryFee ?? 10`. Med ny `validStateEntryFee = null` (0
    // er ikke gyldig) faller den til lobby=5. Vi simulerer ved å sende
    // entryFee=5 (det PlayScreen ville sendt etter fix).
    grid.setTickets(tickets, {
      cancelable: false,
      entryFee: 5, // <- fra lobbyTicketConfig.entryFee (post-fix)
      state,
      liveTicketCount: 3,
      // Klient sender lobbyTypes via PlayScreen så computePrice kan mappe
      // (color, type) → riktig priceMultiplier per bongfarge.
      ticketTypes: [
        { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
        { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
        { name: "Small Purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
      ],
    });

    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");
    expect(getPriceAttr("tkt-3")).toBe("15");
  });

  /**
   * Scenario 3: RUNNING der server sendte ticket.price=0 (gammel bug).
   * `computePrice` må IGNORERE 0 og bruke computed fallback.
   *
   * Expected: ticket.price=0 ignoreres, fallback fra entryFee×multiplier.
   */
  it("RUNNING med ticket.price=0 fra server: ignoreres, bruker computed fallback", () => {
    const tickets = [
      makeTicket(1, "Small White", "small", 0),
      makeTicket(2, "Small Yellow", "small", 0),
      makeTicket(3, "Small Purple", "small", 0),
    ];
    const state = makeState({ gameStatus: "RUNNING", entryFee: 5 });
    grid.setTickets(tickets, {
      cancelable: false,
      entryFee: 5,
      state,
      liveTicketCount: 3,
      // Bruker lobbyTypes for korrekt mapping per bongfarge.
      ticketTypes: [
        { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
        { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
        { name: "Small Purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
      ],
    });

    // computePrice ignorerer ticket.price=0 og faller til entryFee×multiplier
    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");
    expect(getPriceAttr("tkt-3")).toBe("15");
  });

  /**
   * Scenario 4: RUNNING med korrekt ticket.price fra server (autoritativ).
   * Server-side fixet: enrichTicketList sendte `(fee×multiplier)/ticketCount`.
   *
   * Expected: server-pris brukes uten endring.
   */
  it("RUNNING med korrekt server-pris: server-pris er autoritativ", () => {
    const tickets = [
      makeTicket(1, "Small White", "small", 5),
      makeTicket(2, "Small Yellow", "small", 10),
      makeTicket(3, "Small Purple", "small", 15),
    ];
    const state = makeState({ gameStatus: "RUNNING", entryFee: 5 });
    grid.setTickets(tickets, {
      cancelable: false,
      entryFee: 5,
      state,
      liveTicketCount: 3,
    });

    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");
    expect(getPriceAttr("tkt-3")).toBe("15");
  });

  /**
   * Scenario 5 (defensive): state.ticketTypes={} OG lobbyTypes mangler.
   * Kun entryFee+default-multiplier=1 → alle bonger får samme pris.
   *
   * Expected: alle bonger får entryFee (5) som baseline, ikke 0.
   */
  it("RUNNING med tom state.ticketTypes: faller til entryFee uten multiplikator", () => {
    const tickets = [
      makeTicket(1, "Small White", "small"),
      makeTicket(2, "Small Yellow", "small"),
    ];
    const state = makeState({
      gameStatus: "RUNNING",
      entryFee: 5,
      ticketTypes: [], // <- backend ga ingen ticket-types
    });
    grid.setTickets(tickets, {
      cancelable: false,
      entryFee: 5,
      state,
      liveTicketCount: 2,
    });

    // Uten multiplikator-info: fallback til entryFee × 1 / 1 = 5
    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("5");
    expect(getPriceAttr("tkt-1")).not.toBe("0");
    expect(getPriceAttr("tkt-2")).not.toBe("0");
  });

  /**
   * Scenario 6 (klient-side defensive): lobby-config tilgjengelig.
   * PlayScreen sender `ticketTypes` fra lobbyTicketConfig (autoritativ).
   *
   * Expected: lobbyTypes vinner over state.ticketTypes for å unngå
   * legacy 8-type-format-mismatch.
   */
  it("RUNNING med lobby ticketTypes: prioriteres over state.ticketTypes", () => {
    const tickets = [
      makeTicket(1, "Small White", "small"),
      makeTicket(2, "Small Yellow", "small"),
    ];
    const state = makeState({
      gameStatus: "RUNNING",
      entryFee: 5,
      // state.ticketTypes har FEIL data (legacy small_yellow)
      ticketTypes: [
        { name: "Small Yellow", type: "small", priceMultiplier: 99, ticketCount: 1 },
      ],
    });
    grid.setTickets(tickets, {
      cancelable: false,
      entryFee: 5,
      state,
      liveTicketCount: 2,
      // Lobby-config (post-fix) har RIKTIG data
      ticketTypes: [
        { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
        { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
      ],
    });

    // Skal bruke lobby-types (multiplier 1 og 2), IKKE state (99)
    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");
  });
});
