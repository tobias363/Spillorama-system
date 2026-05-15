/**
 * @vitest-environment happy-dom
 *
 * Bug-fix 2026-05-15 (iter 2) — triple-rendering color-validation regresjon.
 *
 * PR #1500 (Bølge 2) introduserte triple-grupperings-funksjonalitet, men
 * tryGroupTriplet sjekket KUN purchaseId (ikke type eller color). Det førte
 * til cross-color-grupperinger som [white-large, yellow-small, yellow-large]
 * når handlekurven inneholdt blandet stor + liten av forskjellige farger
 * med samme purchase-rad-ID.
 *
 * Tobias-rapport 2026-05-15 (med screenshot-bevis):
 *   "Kjøpte 1 Stor hvit + 1 Stor gul + 1 Stor lilla. Så 3 hvit single
 *    + 6 gul single + 0 lilla istedenfor 3 triple-containere."
 *
 * Root cause: `tryGroupTriplet` matchet bare purchaseId. Backend's
 * `app_game1_ticket_purchases.id` representerer HELE handlekurven, ikke
 * 1 stor bundle — så alle 6 tickets (small white, large white, small yellow,
 * large yellow, small purple, large purple) delte SAMME purchaseId. Triple-
 * grupperingen plukket tilfeldig 3 etterfølgende tickets med matching
 * purchaseId uavhengig av farge.
 *
 * Fix: tryGroupTriplet krever nå at ALLE 3 tickets har:
 *   - type === "large"
 *   - samme purchaseId (allerede)
 *   - samme color-familie (yellow/white/purple/...)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TicketGridHtml } from "./TicketGridHtml.js";
import type { Ticket } from "@spillorama/shared-types/game";
import type { GameState } from "../../../bridge/GameBridge.js";

function makeTicket(
  seq: number,
  color: string,
  type: string,
  purchaseId: string | undefined,
): Ticket {
  return {
    id: `tkt-${seq}`,
    grid: [
      [seq * 10 + 1, seq * 10 + 2, seq * 10 + 3, seq * 10 + 4, seq * 10 + 5],
      [seq * 10 + 6, seq * 10 + 7, seq * 10 + 8, seq * 10 + 9, seq * 10 + 10],
      [seq * 10 + 11, seq * 10 + 12, 0, seq * 10 + 14, seq * 10 + 15],
      [seq * 10 + 16, seq * 10 + 17, seq * 10 + 18, seq * 10 + 19, seq * 10 + 20],
      [seq * 10 + 21, seq * 10 + 22, seq * 10 + 23, seq * 10 + 24, seq * 10 + 25],
    ],
    color,
    type,
    ...(purchaseId !== undefined ? { purchaseId } : {}),
    sequenceInPurchase: seq,
  };
}

function makeState(): GameState {
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
    entryFee: 5,
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
      { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Large White", type: "large", priceMultiplier: 3, ticketCount: 3 },
      { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
      { name: "Large Yellow", type: "large", priceMultiplier: 6, ticketCount: 3 },
      { name: "Small Purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
      { name: "Large Purple", type: "large", priceMultiplier: 9, ticketCount: 3 },
    ],
    replaceAmount: 0,
    jackpot: null,
    preRoundTickets: [],
    isArmed: false,
    myStake: 0,
    serverTimestamp: Date.now(),
  } as GameState;
}

describe("TicketGridHtml — tryGroupTriplet color-validation (Bug-fix 2026-05-15)", () => {
  let grid: TicketGridHtml;
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
    grid = new TicketGridHtml();
    grid.mount(parent);
  });

  it("grupperer 3 large av samme farge med samme purchaseId som ÉN triplet", () => {
    // Backend leverer 3 brett for 1 Stor White-kjøp, alle med samme
    // purchaseId og sekvens-indekser 1, 2, 3.
    const purchaseId = "p-large-white-only";
    const tickets = [
      makeTicket(1, "Large White", "large", purchaseId),
      makeTicket(2, "Large White", "large", purchaseId),
      makeTicket(3, "Large White", "large", purchaseId),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 1 triplet-container = 1 DOM-node med data-test="ticket-triplet"
    const triplets = grid.root.querySelectorAll('[data-test="ticket-triplet"]');
    expect(triplets.length).toBe(1);

    // Sub-bongene inne i triplet har data-test="ticket-card" via
    // BingoTicketHtml. Sjekk at INGEN top-level single-cards finnes —
    // bruk grid-elementets direkte barn for å unngå å plukke opp triplets'
    // interne sub-bonger.
    const directChildren = Array.from(grid.root.querySelectorAll('*')).filter(
      (el) =>
        el.getAttribute("data-test") === "ticket-card" &&
        !el.closest('[data-test="ticket-triplet"]'),
    );
    expect(directChildren.length).toBe(0);
  });

  it("BUG-REGRESJON: avviser cross-color-gruppering når 3 large av FORSKJELLIGE farger deler purchaseId", () => {
    // Tobias-scenario 2026-05-15: handlekurv med blandet farger får alle
    // tickets samme purchaseId (handlekurven er ÉN purchase-rad), men
    // hver large er sin egen bundle. Skal IKKE grupperes.
    const cartPurchaseId = "p-mixed-cart";
    const tickets = [
      makeTicket(2, "Large White", "large", cartPurchaseId),
      makeTicket(4, "Large Yellow", "large", cartPurchaseId),
      makeTicket(6, "Large Purple", "large", cartPurchaseId),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 0 triplet-containere — alle 3 skal være single
    const triplets = grid.root.querySelectorAll('[data-test="ticket-triplet"]');
    expect(triplets.length).toBe(0);
  });

  it("BUG-REGRESJON: avviser blanding av small + large i triplet selv om de deler purchaseId", () => {
    // Realistisk handlekurv: small white + large white + small yellow + large yellow
    // alle med samme purchaseId og påfølgende sekvensnumre.
    const cartPurchaseId = "p-mixed-sizes";
    const tickets = [
      makeTicket(1, "Small White", "small", cartPurchaseId),
      makeTicket(2, "Large White", "large", cartPurchaseId),
      makeTicket(3, "Small Yellow", "small", cartPurchaseId),
      makeTicket(4, "Large Yellow", "large", cartPurchaseId),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 0 triplet-containere — ingen 3-i-rad har same color + large
    const triplets = grid.root.querySelectorAll('[data-test="ticket-triplet"]');
    expect(triplets.length).toBe(0);
  });

  it("Tobias' scenario: 1 Stor hvit (3 brett) + 1 Stor gul (3 brett) + 1 Stor lilla (3 brett) = 3 triplets", () => {
    // SLIK backend SKAL sende: 3 separate ticket-objekter per Stor-kjøp,
    // grupperingen mellom forskjellige Stor-bunter skjer via color.
    // Alle 9 tickets deler samme handlekurv-purchaseId.
    const cartPurchaseId = "p-tobias-3-stor";
    const tickets = [
      // 3 brett av Stor hvit
      makeTicket(1, "Large White", "large", cartPurchaseId),
      makeTicket(2, "Large White", "large", cartPurchaseId),
      makeTicket(3, "Large White", "large", cartPurchaseId),
      // 3 brett av Stor gul
      makeTicket(4, "Large Yellow", "large", cartPurchaseId),
      makeTicket(5, "Large Yellow", "large", cartPurchaseId),
      makeTicket(6, "Large Yellow", "large", cartPurchaseId),
      // 3 brett av Stor lilla
      makeTicket(7, "Large Purple", "large", cartPurchaseId),
      makeTicket(8, "Large Purple", "large", cartPurchaseId),
      makeTicket(9, "Large Purple", "large", cartPurchaseId),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 3 triplet-containere — én per farge
    const triplets = grid.root.querySelectorAll('[data-test="ticket-triplet"]');
    expect(triplets.length).toBe(3);

    // Verifiser at fargene er korrekt: white, yellow, purple
    const tripletColors = Array.from(triplets).map((el) =>
      (el as HTMLElement).getAttribute("data-test-ticket-color")?.toLowerCase(),
    );
    expect(tripletColors).toContain("large white");
    expect(tripletColors).toContain("large yellow");
    expect(tripletColors).toContain("large purple");
  });

  it("avviser triplet hvis purchaseId mangler (legacy / pre-round display tickets)", () => {
    // Pre-round display tickets har ingen purchaseId — single-rendering.
    const tickets = [
      makeTicket(1, "Large White", "large", undefined),
      makeTicket(2, "Large White", "large", undefined),
      makeTicket(3, "Large White", "large", undefined),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState(),
      liveTicketCount: 0,
    });

    // 0 triplets — purchaseId mangler
    const triplets = grid.root.querySelectorAll('[data-test="ticket-triplet"]');
    expect(triplets.length).toBe(0);
  });

  it("avviser triplet hvis kun 1-2 av 3 store brett finnes (partial purchase)", () => {
    const purchaseId = "p-partial";
    const tickets = [
      makeTicket(1, "Large White", "large", purchaseId),
      makeTicket(2, "Large White", "large", purchaseId),
      // mangler 3. brett
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState(),
      liveTicketCount: 0,
    });

    const triplets = grid.root.querySelectorAll('[data-test="ticket-triplet"]');
    expect(triplets.length).toBe(0);
  });
});
