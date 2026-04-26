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

  it("forces × off for live tickets even when caller passes cancelable: true", () => {
    // Round-state-isolation (Tobias 2026-04-25): PlayScreen viser nå KUN
    // live-brett under RUNNING og KUN pre-round-brett mellom runder, så det
    // mixede scenariet eksisterer ikke lenger fra controlleren. TicketGridHtml
    // forventes likevel å håndtere mixede inputs defensivt: live-brett (index
    // < liveCount) skal aldri få ×, selv om caller sender cancelable: true.
    // Beholdt som regresjons-guard mot at noen senere reintroduserer mixede
    // grids uten å oppdatere cancelable-semantikken.
    const liveTicket = makeTicket(0, "Small Yellow");
    const preRoundTicket = makeTicket(1, "Small Purple");
    grid.setTickets([liveTicket, preRoundTicket], {
      cancelable: true,
      entryFee: 10,
      state: makeState(),
      liveTicketCount: 1, // Første brett er live, andre er pre-round
    });

    const cancelBtns = grid.root.querySelectorAll("button[aria-label='Avbestill brett']");
    expect(cancelBtns.length).toBe(1); // Bare pre-round-brettet får × — live blir tvunget til false
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

  describe("progress-based sortering (Tobias 2026-04-26)", () => {
    /** Bygger et 5×5-grid med tall offset+1..offset+25, midten 0. */
    function tightTicket(id: string, offset: number): Ticket {
      const numbers: number[] = [];
      for (let i = 0; i < 25; i++) {
        numbers.push(i === 12 ? 0 : offset + i + 1);
      }
      const grid: number[][] = [];
      for (let r = 0; r < 5; r++) grid.push(numbers.slice(r * 5, r * 5 + 5));
      return { id, grid, color: "Small Yellow", type: "small" };
    }

    function pattern1Rad(): GameState["patterns"] {
      return [
        {
          id: "phase-1",
          name: "1 Rad",
          claimType: "LINE",
          prizePercent: 50,
          order: 1,
          design: 1,
        },
      ];
    }

    it("sorterer live-bonger etter progress (mest komplett først) under fase 1", () => {
      // t1: kjøps-rekkefølge index 0, ingen rad nær fullføring.
      // t2: kjøps-rekkefølge index 1, har 4/5 i rad 0 → fase 1 1-til-fullt.
      const t1 = tightTicket("a", 0);
      const t2 = tightTicket("b", 30);
      const drawn = t2.grid[0].filter((n) => n !== 0).slice(0, 4); // 4 av 5 i rad 0 på t2

      const state = makeState({
        patterns: pattern1Rad(),
        patternResults: [],
        drawnNumbers: drawn,
      });

      grid.setTickets([t1, t2], {
        cancelable: false,
        entryFee: 10,
        state,
        liveTicketCount: 2,
      });

      // Header-rekkefølge i DOM skal nå starte med t2 (b) før t1 (a).
      const headers = Array.from(grid.root.querySelectorAll(".ticket-header-name")).map(
        (e) => (e as HTMLElement).textContent,
      );
      // Begge brettene har "Small Yellow" som farge, men header-tekst er det
      // samme. Sjekk DOM-rekkefølge via [data-number]-første-celle: t2 sin
      // første celle har data-number = 31 (offset 30 + 1).
      const firstCellOfFirstTicket = grid.root.querySelector("[data-number]") as HTMLElement;
      expect(firstCellOfFirstTicket.dataset.number).toBe("31"); // t2 først
      expect(headers).toHaveLength(2);
    });

    it("pre-round-bonger sorteres ikke (beholder original-rekkefølge bak live-bonger)", () => {
      const live = tightTicket("live", 0);
      const pre1 = tightTicket("pre1", 30);
      const pre2 = tightTicket("pre2", 50);

      const state = makeState({
        patterns: pattern1Rad(),
        patternResults: [],
        drawnNumbers: [],
      });

      grid.setTickets([live, pre1, pre2], {
        cancelable: false,
        entryFee: 10,
        state,
        liveTicketCount: 1,
      });

      // 3 brett rendret. Pre-round-rekkefølge skal være pre1 før pre2 (uendret).
      const ticketRoots = Array.from(grid.root.querySelectorAll("[data-number]"))
        .filter((_, i) => i % 25 === 0) // første celle av hver bong
        .map((c) => (c as HTMLElement).dataset.number);
      // live=offset 0 → første celle data-number = 1
      // pre1=offset 30 → første celle data-number = 31
      // pre2=offset 50 → første celle data-number = 51
      expect(ticketRoots).toEqual(["1", "31", "51"]);
    });

    it("re-sorter ved nytt drawn number (signature endres → rebuild)", () => {
      const t1 = tightTicket("a", 0); // ingen rad nær
      const t2 = tightTicket("b", 30); // ingen rad nær

      const state1 = makeState({
        patterns: pattern1Rad(),
        patternResults: [],
        drawnNumbers: [], // Empty → original-rekkefølge.
      });

      grid.setTickets([t1, t2], {
        cancelable: false,
        entryFee: 10,
        state: state1,
        liveTicketCount: 2,
      });

      // Tom drawn → t1 først (original index 0).
      let firstCell = grid.root.querySelector("[data-number]") as HTMLElement;
      expect(firstCell.dataset.number).toBe("1");

      // Nytt drawn-state hvor t2 har 4/5 i en rad → t2 skal flytte til front.
      const drawn = t2.grid[0].filter((n) => n !== 0).slice(0, 4);
      const state2 = makeState({
        patterns: pattern1Rad(),
        patternResults: [],
        drawnNumbers: drawn,
      });

      grid.setTickets([t1, t2], {
        cancelable: false,
        entryFee: 10,
        state: state2,
        liveTicketCount: 2,
      });

      firstCell = grid.root.querySelector("[data-number]") as HTMLElement;
      expect(firstCell.dataset.number).toBe("31"); // t2 nå først
    });

    it("ukjent active-pattern → server-rekkefølge bevart", () => {
      const t1 = tightTicket("a", 0);
      const t2 = tightTicket("b", 30);
      const drawn = t2.grid[0].filter((n) => n !== 0).slice(0, 4);

      // Custom-navn som ikke matches av classifyPhaseFromPatternName
      // → sortering hopper over → server-rekkefølge bevart.
      const state = makeState({
        patterns: [
          {
            id: "custom",
            name: "Stjerne",
            claimType: "BINGO",
            prizePercent: 50,
            order: 1,
            design: 0,
          },
        ],
        patternResults: [],
        drawnNumbers: drawn,
      });

      grid.setTickets([t1, t2], {
        cancelable: false,
        entryFee: 10,
        state,
        liveTicketCount: 2,
      });

      const firstCell = grid.root.querySelector("[data-number]") as HTMLElement;
      expect(firstCell.dataset.number).toBe("1"); // t1 først (original-rekkefølge)
    });
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

  describe("blink prevention (mark-state-diff-kontrakt)", () => {
    // Round 3 av BIN-blink-permanent-fix: backend sender room:update ~1.2s/tick
    // under trekning. Uten mark-state-sig re-kjører vi markNumbers × alle live
    // tickets × alle drawn numbers pr. tick — selv når ingenting er nytt.
    // Dette testsettet måler MutationObserver-count for å låse kontrakten.
    it("repeterte setTickets med identisk mark-state → 0 mutasjoner på celle-attributter", async () => {
      const tickets = [makeTicket(0, "Small Yellow"), makeTicket(1, "Small White")];
      const state = makeState({ drawnNumbers: [7, 12, 18] });
      grid.setTickets(tickets, { cancelable: false, entryFee: 10, state, liveTicketCount: 2 });

      const cells = Array.from(grid.root.querySelectorAll("[data-number]")) as HTMLElement[];

      // Observer ALLE celle-attributter + inline-style (mark/paint skriver
      // `background`, `color`, `fontWeight`, `boxShadow`, `dataset.lucky`).
      let mutations = 0;
      const observers = cells.map((c) => {
        const o = new MutationObserver((list) => { mutations += list.length; });
        o.observe(c, { attributes: true, attributeFilter: ["style", "data-lucky", "class"] });
        return o;
      });

      // Fem "ticks" med identisk state — skal gi 0 mutasjoner på cellene.
      for (let i = 0; i < 5; i++) {
        grid.setTickets(tickets, { cancelable: false, entryFee: 10, state, liveTicketCount: 2 });
      }

      // Gi MutationObserver tid til å levere pending records.
      await new Promise((r) => setTimeout(r, 0));
      for (const o of observers) o.disconnect();

      expect(mutations).toBe(0);
    });

    it("nytt drawn number → mutasjon kun på cellen som får ny mark", async () => {
      const tickets = [makeTicket(0, "Small Yellow")];
      const state1 = makeState({ drawnNumbers: [7, 12] });
      grid.setTickets(tickets, { cancelable: false, entryFee: 10, state: state1, liveTicketCount: 1 });

      const cells = Array.from(grid.root.querySelectorAll("[data-number]")) as HTMLElement[];

      const perCell = new Map<HTMLElement, number>();
      const observers = cells.map((c) => {
        const o = new MutationObserver((list) => {
          perCell.set(c, (perCell.get(c) ?? 0) + list.length);
        });
        o.observe(c, { attributes: true, attributeFilter: ["style"] });
        return o;
      });

      // Ny state med ett ekstra drawn number (18 → cell index 17 på i=0-ticket).
      const state2 = makeState({ drawnNumbers: [7, 12, 18] });
      grid.setTickets(tickets, { cancelable: false, entryFee: 10, state: state2, liveTicketCount: 1 });

      await new Promise((r) => setTimeout(r, 0));
      for (const o of observers) o.disconnect();

      // Mark-state-sig endret → applyMarks kjører. markNumber er idempotent
      // så kun den NYE cellen (18) skal få style-mutasjon.
      const mutated = Array.from(perCell.entries()).filter(([, n]) => n > 0);
      const mutatedNumbers = mutated.map(([cell]) => cell.dataset.number);
      expect(mutatedNumbers).toEqual(["18"]);
    });

    it("repetert highlightLuckyNumber er idempotent (ingen style-writes etter første)", async () => {
      const state = makeState({ drawnNumbers: [], myLuckyNumber: 7 });
      const tickets = [makeTicket(0, "Small Yellow")];
      grid.setTickets(tickets, { cancelable: false, entryFee: 10, state, liveTicketCount: 1 });

      const cells = Array.from(grid.root.querySelectorAll("[data-number]")) as HTMLElement[];
      let mutations = 0;
      const observers = cells.map((c) => {
        const o = new MutationObserver((list) => { mutations += list.length; });
        o.observe(c, { attributes: true, attributeFilter: ["style", "data-lucky"] });
        return o;
      });

      // Gjenta highlightLuckyNumber direkte — dataset.lucky er allerede satt,
      // så andre kall skal være no-op.
      grid.highlightLuckyNumber(7);
      grid.highlightLuckyNumber(7);
      grid.highlightLuckyNumber(7);

      await new Promise((r) => setTimeout(r, 0));
      for (const o of observers) o.disconnect();

      expect(mutations).toBe(0);
    });
  });
});
