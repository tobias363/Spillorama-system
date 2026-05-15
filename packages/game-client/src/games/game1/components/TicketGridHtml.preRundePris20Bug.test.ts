/**
 * @vitest-environment happy-dom
 *
 * Regression test for Tobias-rapport 2026-05-15:
 * "Etter at spilleren har kjøpt bonger (Small White, Small Yellow, Small
 * Purple — én av hver) FØR runden starter, vises ALLE 3 bonger med pris
 * '20 kr'. Etter at runden har startet → pris er riktig (5/10/15 kr)."
 *
 * Root cause (verifisert via fil:linje-referanser):
 *
 *   PRE-RUNDE (status=purchase_open/ready_to_start):
 *     - Backend `onScheduledGameCreated`-hooken har ikke fyrt ennå —
 *       master har ikke trykket "Start neste spill"
 *     - `roomState.roomConfiguredEntryFeeByRoom` er TOM for rommet
 *     - `getRoomConfiguredEntryFee` faller tilbake til
 *       `runtimeBingoSettings.autoRoundEntryFee` = env AUTO_ROUND_ENTRY_FEE
 *       (= 20 per `apps/backend/.env:41`)
 *     - `effectiveConfig` = DEFAULT_NORSK_BINGO_CONFIG der ALLE small_*
 *       har flat `priceMultiplier=1, ticketCount=1`
 *     - `enrichTicketList(list, 20)` → `t.price = 20 × 1 / 1 = 20` for ALLE
 *       tickets uavhengig av farge (White/Yellow/Purple)
 *     - Klient `computePrice` så `ticket.price > 0` → bruker 20 rått
 *
 *   POST-RUNDE-START:
 *     - `onScheduledGameCreated` + `onEngineStarted` binder
 *       `roomConfiguredEntryFeeByRoom=5` + variantConfig med per-farge
 *       ticketTypes
 *     - Server enriching nå gir korrekt 5/10/15 kr
 *
 * Bug-intermittens: in-memory state PERSISTERER mellom runder. Etter første
 * master-start i samme room-code-instans, neste runde viser riktige priser
 * (cached state). `dev:nuke` eller backend-crash → tilbake til bug for
 * første runde.
 *
 * Fix (TicketGridHtml.computePrice): lobby-types ER autoritativ kilde når
 * tilgjengelig — lobby-data kommer fra `Game1LobbyService` som leser
 * `app_game_catalog` direkte. Server-side `ticket.price` ignoreres når
 * lobby-types kan matche ticket (color, type) fordi server-pris kan være
 * stale før master har bundet scheduled-game-data.
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
    gameStatus: "WAITING",
    gameId: "g1",
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

describe("TicketGridHtml — pre-runde pris-20-bug (Tobias-rapport 2026-05-15)", () => {
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
   * Hovedscenario: bug reprodusert.
   *
   * Pre-runde med 3 bong-farger. Backend har sendt `ticket.price=20` for
   * ALLE (env-default `AUTO_ROUND_ENTRY_FEE=20` × default-variant
   * `priceMultiplier=1`). Lobby-config er tilgjengelig med riktig data.
   *
   * Forventet etter fix: lobby-types VINNER over `ticket.price=20`.
   *   - White:  entryFee=5 × multiplier=1 / count=1 = 5 kr
   *   - Yellow: entryFee=5 × multiplier=2 / count=1 = 10 kr
   *   - Purple: entryFee=5 × multiplier=3 / count=1 = 15 kr
   *
   * Pre-fix: alle 3 viste "20 kr".
   */
  it("pre-runde: lobby-types VINNER over stale ticket.price=20 fra backend default-variant", () => {
    const tickets = [
      // Backend `enrichTicketList` med entryFee=20 + DEFAULT_NORSK_BINGO_CONFIG
      // har sendt `price=20` for alle 3 fordi alle small har priceMultiplier=1.
      makeTicket(1, "Small White", "small", 20),
      makeTicket(2, "Small Yellow", "small", 20),
      makeTicket(3, "Small Purple", "small", 20),
    ];
    const state = makeState({
      gameStatus: "WAITING",
      // state.entryFee speiler backend's stale `getRoomConfiguredEntryFee`-
      // fallback = 20 (= env AUTO_ROUND_ENTRY_FEE).
      entryFee: 20,
    });

    grid.setTickets(tickets, {
      cancelable: true,
      // PlayScreen sender `gridEntryFee = lobbyTicketConfig?.entryFee` =
      // 5 (fra plan-runtime catalog). Dette OVERSTYRER state.entryFee=20.
      entryFee: 5,
      state,
      liveTicketCount: 0,
      // Lobby-types fra plan-runtime aggregator (autoritativ).
      ticketTypes: [
        { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
        { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
        { name: "Small Purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
      ],
    });

    // Bug-fix: lobby-types vinner over server-pris=20.
    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");
    expect(getPriceAttr("tkt-3")).toBe("15");

    // Eksplisitt: ALDRI 20 etter fix.
    expect(getPriceAttr("tkt-1")).not.toBe("20");
    expect(getPriceAttr("tkt-2")).not.toBe("20");
    expect(getPriceAttr("tkt-3")).not.toBe("20");
  });

  /**
   * State-transition test: pre-runde → runde-start må gi stabile priser.
   *
   * Når master trykker Start, server binder `roomConfiguredEntryFeeByRoom=5`
   * + variantConfig med korrekte per-farge multipliers. Klient skal vise
   * IDENTISKE priser før og etter — bug-en var at pre-runde viste 20 og
   * post-start viste 5/10/15. Etter fix skal begge faser være konsistente.
   */
  it("state-transition WAITING → RUNNING: priser forblir stabile (5/10/15)", () => {
    const tickets = [
      makeTicket(1, "Small White", "small", 20), // Pre-runde stale-pris
      makeTicket(2, "Small Yellow", "small", 20),
      makeTicket(3, "Small Purple", "small", 20),
    ];
    const lobbyTypes = [
      { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
      { name: "Small Purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
    ];

    // FASE 1: WAITING (pre-runde, før master har trykket Start)
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState({ gameStatus: "WAITING", entryFee: 20 }),
      liveTicketCount: 0,
      ticketTypes: lobbyTypes,
    });

    const prePrice1 = getPriceAttr("tkt-1");
    const prePrice2 = getPriceAttr("tkt-2");
    const prePrice3 = getPriceAttr("tkt-3");

    expect(prePrice1).toBe("5");
    expect(prePrice2).toBe("10");
    expect(prePrice3).toBe("15");

    // FASE 2: RUNNING (master har trykket Start, backend har bundet
    // korrekt entryFee + variantConfig). Server sender nå korrekte priser.
    const runningTickets = [
      makeTicket(1, "Small White", "small", 5),
      makeTicket(2, "Small Yellow", "small", 10),
      makeTicket(3, "Small Purple", "small", 15),
    ];
    grid.setTickets(runningTickets, {
      cancelable: false,
      entryFee: 5,
      state: makeState({ gameStatus: "RUNNING", entryFee: 5 }),
      liveTicketCount: 3,
      ticketTypes: lobbyTypes,
    });

    // Priser identiske før og etter state-transition.
    expect(getPriceAttr("tkt-1")).toBe(prePrice1);
    expect(getPriceAttr("tkt-2")).toBe(prePrice2);
    expect(getPriceAttr("tkt-3")).toBe(prePrice3);
  });

  /**
   * Defense-in-depth: lobby-types med BARE white-bong (Trafikklys-scenario).
   *
   * Trafikklys har flat 15 kr per bong. Lobby skal returnere bare "lilla"
   * med entryFee=15 (eller white/purple slik admin har satt det). Backend
   * stale ticket.price=20 må fortsatt ignoreres.
   */
  it("Trafikklys-scenario: lobby flat-pris VINNER over ticket.price=20", () => {
    const tickets = [
      makeTicket(1, "Small Purple", "small", 20),
      makeTicket(2, "Small Purple", "small", 20),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 15, // Trafikklys flat-pris
      state: makeState({ gameStatus: "WAITING", entryFee: 20 }),
      liveTicketCount: 0,
      // Trafikklys: bare purple med flat priceMultiplier=1.
      ticketTypes: [
        { name: "Small Purple", type: "small", priceMultiplier: 1, ticketCount: 1 },
      ],
    });

    // 15 × 1 / 1 = 15, ikke 20.
    expect(getPriceAttr("tkt-1")).toBe("15");
    expect(getPriceAttr("tkt-2")).toBe("15");
  });

  /**
   * Bevarer scenario 4 fra priceZeroBug-suite: når lobby-types MANGLER
   * faller vi tilbake til ticket.price (server-autoritativ).
   *
   * Sikrer at fix ikke regresserer eksisterende test-coverage.
   */
  it("lobby-types mangler: server's ticket.price brukes (legacy path)", () => {
    const tickets = [
      makeTicket(1, "Small White", "small", 5),
      makeTicket(2, "Small Yellow", "small", 10),
      makeTicket(3, "Small Purple", "small", 15),
    ];
    grid.setTickets(tickets, {
      cancelable: false,
      entryFee: 5,
      state: makeState({ gameStatus: "RUNNING", entryFee: 5 }),
      liveTicketCount: 3,
      // Ingen ticketTypes-opt — legacy klient eller før lobbyTicketConfig
      // er bundet (rask init-window).
    });

    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");
    expect(getPriceAttr("tkt-3")).toBe("15");
  });

  /**
   * Edge case: Large-bong pre-runde med stale ticket.price.
   *
   * Large-bong har `priceMultiplier=3, ticketCount=3` så bundle = 15 kr,
   * per-brett = 5 kr. Backend default-variant gir Large `priceMultiplier=3,
   * ticketCount=3` så `enrichTicketList(20)` gir `20 × 3 / 3 = 20`. Bug
   * forsterkes for Large (samme symptom: 20 kr per brett istedenfor 5).
   *
   * Lobby har korrekt mapping: Large White { name: "Large White",
   * priceMultiplier: 3, ticketCount: 3 } → 5 × 3 / 3 = 5 kr per brett.
   */
  it("Large-bong pre-runde: lobby gir korrekt per-brett-pris (ikke 20)", () => {
    const tickets = [
      // Server-side: Large har samme bug — alle får 20.
      makeTicket(1, "Large White", "large", 20),
      makeTicket(2, "Large Yellow", "large", 20),
    ];
    grid.setTickets(tickets, {
      cancelable: true,
      entryFee: 5,
      state: makeState({ gameStatus: "WAITING", entryFee: 20 }),
      liveTicketCount: 0,
      ticketTypes: [
        // Small + Large mix (full ticket-config).
        { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
        { name: "Large White", type: "large", priceMultiplier: 3, ticketCount: 3 },
        { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
        { name: "Large Yellow", type: "large", priceMultiplier: 6, ticketCount: 3 },
      ],
    });

    // Large White per brett:  entryFee=5 × multiplier=3 / count=3 = 5 kr
    // Large Yellow per brett: entryFee=5 × multiplier=6 / count=3 = 10 kr
    expect(getPriceAttr("tkt-1")).toBe("5");
    expect(getPriceAttr("tkt-2")).toBe("10");

    // Aldri 20 etter fix.
    expect(getPriceAttr("tkt-1")).not.toBe("20");
    expect(getPriceAttr("tkt-2")).not.toBe("20");
  });
});
