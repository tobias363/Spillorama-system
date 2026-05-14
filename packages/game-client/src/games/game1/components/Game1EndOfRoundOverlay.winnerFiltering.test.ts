/**
 * @vitest-environment happy-dom
 *
 * Tobias-direktiv 2026-05-14 (WinScreen-bug, runde 1edd90a1):
 *
 * Spiller vant på ALLE faser (Rad 1, 2, 3, 4 + Fullt Hus) men WinScreen
 * viste kun "Fullt Hus 1000 kr Du vant" — Rad 1-4 viste feilaktig
 * "Ikke vunnet" selv om DB hadde `app_game1_phase_winners`-rader for alle
 * 6 vinninger.
 *
 * Root cause: Scheduled Spill 1 sin `enrichScheduledGame1RoomSnapshot`
 * returnerer `patternResults: []` (synthetic snapshot uten engine-state).
 * Når game-end-snapshot ankommer via `room:update`, blir
 * `state.patternResults` RESET til [], og deretter SEEDED med `isWon: false`
 * for alle 5 faser → "Ikke vunnet"-default for alt spilleren faktisk vant.
 *
 * Fix: Game1Controller akkumulerer en `myRoundWinnings`-liste per
 * `pattern:won`-event der spilleren er blant `winnerIds`. Listen sendes til
 * overlay via `summary.myWinnings`. Overlay viser KUN vinnende rader.
 * Tom liste → "Beklager, ingen gevinst".
 *
 * Designvalg:
 *   1. Vis KUN faser spilleren har vunnet (filter)
 *   2. Sort etter `phase` (1 → 5)
 *   3. Multi-vinst per fase (eks. yellow + purple på Rad 2) → vis separate rader
 *   4. Ingen vinst → "Beklager, ingen gevinst" (ikke 5 "Ikke vunnet"-rader)
 *   5. Total-sum stemmer med summen av viste premier
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Game1EndOfRoundOverlay,
  type Game1EndOfRoundSummary,
  type MyPhaseWinRecord,
} from "./Game1EndOfRoundOverlay.js";

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function baseSummary(
  over: Partial<Game1EndOfRoundSummary> = {},
): Game1EndOfRoundSummary {
  return {
    endedReason: "BINGO_CLAIMED",
    patternResults: [],
    myPlayerId: "me",
    myTickets: [
      { id: "t1", grid: [[1]] },
    ] as Game1EndOfRoundSummary["myTickets"],
    onBackToLobby: vi.fn(),
    ...over,
  };
}

/**
 * Mock Tobias prod-bug-data: spiller demo-user-admin vant 6 fase-rader
 * i runde 1edd90a1. Tilsvarer DB-data:
 *   - Phase 1: yellow, 200 kr
 *   - Phase 2: purple 300 kr + white 100 kr (multi-color samme fase)
 *   - Phase 3: white, 100 kr
 *   - Phase 4: white, 100 kr
 *   - Phase 5 (Fullt Hus): white, 1000 kr
 * Total: 1800 kr
 */
const TOBIAS_BUG_WINNINGS: ReadonlyArray<MyPhaseWinRecord> = [
  {
    phase: 1,
    patternName: "1 Rad",
    ticketColor: "yellow",
    payoutAmount: 200,
    wonAtDraw: 8,
  },
  {
    phase: 2,
    patternName: "2 Rader",
    ticketColor: "purple",
    payoutAmount: 300,
    wonAtDraw: 15,
  },
  {
    phase: 2,
    patternName: "2 Rader",
    ticketColor: "white",
    payoutAmount: 100,
    wonAtDraw: 15,
  },
  {
    phase: 3,
    patternName: "3 Rader",
    ticketColor: "white",
    payoutAmount: 100,
    wonAtDraw: 22,
  },
  {
    phase: 4,
    patternName: "4 Rader",
    ticketColor: "white",
    payoutAmount: 100,
    wonAtDraw: 30,
  },
  {
    phase: 5,
    patternName: "Fullt Hus",
    ticketColor: "white",
    payoutAmount: 1000,
    wonAtDraw: 47,
  },
];

describe("Game1EndOfRoundOverlay — myWinnings-filter (Tobias 2026-05-14)", () => {
  let parent: HTMLElement;
  let overlay: Game1EndOfRoundOverlay;

  beforeEach(() => {
    document.body.innerHTML = "";
    parent = container();
    overlay = new Game1EndOfRoundOverlay(parent);
    vi.useFakeTimers();
  });

  afterEach(() => {
    overlay.destroy();
    parent.remove();
    vi.useRealTimers();
  });

  // ── Scenario A: spiller vant alt (Tobias prod-bug) ──────────────────
  describe("Scenario A — spiller vant alle faser + multi-color (runde 1edd90a1)", () => {
    it("rendrer 6 rader (én per phase_winners-DB-rad)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1800,
          myWinnings: TOBIAS_BUG_WINNINGS,
        }),
      );
      const rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"]',
      );
      expect(rows.length).toBe(6);
    });

    it("ingen rader viser 'Ikke vunnet' (root cause-bekreftelse)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1800,
          myWinnings: TOBIAS_BUG_WINNINGS,
        }),
      );
      expect(parent.textContent).not.toContain("Ikke vunnet");
    });

    it("ingen 'Beklager, ingen gevinst'-state når player vant alt", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1800,
          myWinnings: TOBIAS_BUG_WINNINGS,
        }),
      );
      const noWinnings = parent.querySelector(
        '[data-testid="eor-no-winnings"]',
      );
      expect(noWinnings).toBeNull();
    });

    it("hver vinnende rad har premien synlig + 'Du vant'-tekst", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1800,
          myWinnings: TOBIAS_BUG_WINNINGS,
        }),
      );
      // 200 kr (Rad 1 yellow)
      expect(parent.textContent).toContain("200 kr");
      // 300 kr (Rad 2 purple)
      expect(parent.textContent).toContain("300 kr");
      // 100 kr forekommer 3 ganger (Rad 2 white, Rad 3, Rad 4)
      expect(parent.textContent).toContain("100 kr");
      // 1 000 kr (Fullt Hus white) — formatKr bruker thin-space som separator
      expect(parent.textContent).toMatch(/1.000\s*kr/);
    });

    it("multi-color samme fase: Rad 2 viser to separate rader (yellow + purple)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1800,
          myWinnings: TOBIAS_BUG_WINNINGS,
        }),
      );
      const phase2Rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"][data-phase="2"]',
      );
      expect(phase2Rows.length).toBe(2);
      // Begge skal ha ticket-color attribute
      const colors = Array.from(phase2Rows).map((r) =>
        r.getAttribute("data-ticket-color"),
      );
      expect(colors).toContain("purple");
      expect(colors).toContain("white");
    });

    it("rader sorteres etter phase (1 → 5)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1800,
          // Send i shuffled rekkefølge for å verifisere sortering
          myWinnings: [
            TOBIAS_BUG_WINNINGS[5]!, // Fullt Hus først
            TOBIAS_BUG_WINNINGS[0]!, // Rad 1 senere
            TOBIAS_BUG_WINNINGS[3]!, // Rad 3 i midten
            TOBIAS_BUG_WINNINGS[2]!, // Rad 2 (white) tilbake
            TOBIAS_BUG_WINNINGS[1]!, // Rad 2 (purple)
            TOBIAS_BUG_WINNINGS[4]!, // Rad 4
          ],
        }),
      );
      const rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"]',
      );
      const phases = Array.from(rows).map((r) =>
        Number(r.getAttribute("data-phase")),
      );
      // Skal være monotont voksende: 1, 2, 2, 3, 4, 5
      expect(phases).toEqual([1, 2, 2, 3, 4, 5]);
    });
  });

  // ── Scenario B: spiller vant Rad 1 + Fullt Hus (sparse-win) ─────────
  describe("Scenario B — spiller vant kun Rad 1 + Fullt Hus", () => {
    const sparseWinnings: ReadonlyArray<MyPhaseWinRecord> = [
      {
        phase: 1,
        patternName: "1 Rad",
        ticketColor: "yellow",
        payoutAmount: 200,
      },
      {
        phase: 5,
        patternName: "Fullt Hus",
        ticketColor: "white",
        payoutAmount: 1000,
      },
    ];

    it("rendrer KUN 2 rader (ikke Rad 2/3/4 som 'Ikke vunnet')", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1200,
          myWinnings: sparseWinnings,
        }),
      );
      const rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"]',
      );
      expect(rows.length).toBe(2);
    });

    it("Rad 2, 3, 4 vises ALDRI som rader (ingen 'Ikke vunnet'-default)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1200,
          myWinnings: sparseWinnings,
        }),
      );
      expect(parent.textContent).not.toContain("Ikke vunnet");
      // Verifiser at Rad 3 og Rad 4 ikke har egne data-phase-rader
      const phase3Rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"][data-phase="3"]',
      );
      const phase4Rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"][data-phase="4"]',
      );
      expect(phase3Rows.length).toBe(0);
      expect(phase4Rows.length).toBe(0);
    });

    it("Rad 1 + Fullt Hus vises med riktig pattern-navn + premie", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 1200,
          myWinnings: sparseWinnings,
        }),
      );
      expect(parent.textContent).toContain("1 Rad");
      expect(parent.textContent).toContain("Fullt Hus");
      expect(parent.textContent).toContain("200 kr");
      expect(parent.textContent).toMatch(/1.000\s*kr/);
    });
  });

  // ── Scenario C: ingen vinst ─────────────────────────────────────────
  describe("Scenario C — spiller vant ingenting", () => {
    it("tom myWinnings-liste viser 'Beklager, ingen gevinst'", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 0,
          myWinnings: [],
        }),
      );
      const noWinnings = parent.querySelector(
        '[data-testid="eor-no-winnings"]',
      );
      expect(noWinnings).not.toBeNull();
      expect(noWinnings?.textContent).toBe("Beklager, ingen gevinst");
    });

    it("ingen vinnings-rader vises", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 0,
          myWinnings: [],
        }),
      );
      const rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"]',
      );
      expect(rows.length).toBe(0);
    });

    it("ingen 'Ikke vunnet'-tekst vises (anti-mønster)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 0,
          myWinnings: [],
        }),
      );
      expect(parent.textContent).not.toContain("Ikke vunnet");
    });

    it("'Tilbake til lobby'-knapp er fortsatt synlig (kan navigere bort)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 0,
          myWinnings: [],
        }),
      );
      const btn = parent.querySelector(
        '[data-testid="eor-lobby-btn"]',
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toBe("Tilbake til lobby");
    });
  });

  // ── Multi-vinner per fase (shared count) ────────────────────────────
  describe("shared-count: 'Du delte med X'-tekst", () => {
    it("sharedCount=1 (solo) viser 'Du vant'", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 200,
          myWinnings: [
            {
              phase: 1,
              patternName: "1 Rad",
              payoutAmount: 200,
              sharedCount: 1,
            },
          ],
        }),
      );
      expect(parent.textContent).toContain("Du vant");
      expect(parent.textContent).not.toContain("Du delte");
    });

    it("sharedCount=2 viser 'Du delte med 1 annen'", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 100,
          myWinnings: [
            {
              phase: 1,
              patternName: "1 Rad",
              payoutAmount: 100,
              sharedCount: 2,
            },
          ],
        }),
      );
      expect(parent.textContent).toContain("Du delte med 1 annen");
    });

    it("sharedCount=3 viser 'Du delte med 2 andre'", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 100,
          myWinnings: [
            {
              phase: 1,
              patternName: "1 Rad",
              payoutAmount: 100,
              sharedCount: 3,
            },
          ],
        }),
      );
      expect(parent.textContent).toContain("Du delte med 2 andre");
    });

    it("sharedCount undefined → behandles som solo ('Du vant')", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 200,
          myWinnings: [
            {
              phase: 1,
              patternName: "1 Rad",
              payoutAmount: 200,
              // sharedCount: undefined
            },
          ],
        }),
      );
      expect(parent.textContent).toContain("Du vant");
    });
  });

  // ── ticket-color rendering ──────────────────────────────────────────
  describe("ticket-color: vises inline når satt", () => {
    it("med ticketColor → 'Rad 1 — yellow' (color inline)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 200,
          myWinnings: [
            {
              phase: 1,
              patternName: "1 Rad",
              ticketColor: "yellow",
              payoutAmount: 200,
            },
          ],
        }),
      );
      expect(parent.textContent).toContain("1 Rad");
      expect(parent.textContent).toContain("yellow");
    });

    it("uten ticketColor → kun pattern-navn", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 200,
          myWinnings: [
            {
              phase: 1,
              patternName: "1 Rad",
              payoutAmount: 200,
              // ticketColor: undefined
            },
          ],
        }),
      );
      const rows = parent.querySelectorAll(
        '[data-testid="eor-my-winnings-row"]',
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.getAttribute("data-ticket-color")).toBeNull();
      // Skal ikke ha "—"-separator når color mangler
      expect(parent.textContent).not.toContain("—");
    });
  });

  // ── Backwards-compat: legacy patternResults-path ────────────────────
  describe("backwards-compat: legacy patternResults-pathen", () => {
    it("myWinnings undefined → fall tilbake til patternResults-tabell", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 100,
          // myWinnings: undefined ← bevisst utelatt
          patternResults: [
            {
              patternId: "p1",
              patternName: "Rad 1",
              claimType: "LINE",
              isWon: true,
              winnerId: "me",
              payoutAmount: 100,
              winnerIds: ["me"],
              winnerCount: 1,
            },
          ],
        }),
      );
      // Legacy table testid skal være synlig
      const legacy = parent.querySelector(
        '[data-testid="eor-patterns-table"]',
      );
      expect(legacy).not.toBeNull();
      // Ny tabell skal IKKE være rendret når myWinnings er undefined
      const newTable = parent.querySelector(
        '[data-testid="eor-my-winnings-table"]',
      );
      expect(newTable).toBeNull();
    });

    it("myWinnings=[] (eksplisitt tom) viser 'Beklager' (ikke legacy)", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 0,
          myWinnings: [], // ← eksplisitt tom, ikke undefined
          patternResults: [
            {
              patternId: "p1",
              patternName: "Rad 1",
              claimType: "LINE",
              isWon: false,
            },
          ],
        }),
      );
      // Ny "Beklager"-state skal vinne over legacy-tabell
      const noWinnings = parent.querySelector(
        '[data-testid="eor-no-winnings"]',
      );
      expect(noWinnings).not.toBeNull();
      // Legacy-tabell skal IKKE rendres
      const legacy = parent.querySelector(
        '[data-testid="eor-patterns-table"]',
      );
      expect(legacy).toBeNull();
    });
  });

  // ── Total-sum-verifikasjon ──────────────────────────────────────────
  describe("total-sum: ownRoundWinnings stemmer med summen", () => {
    it("ownRoundWinnings 1800 matcher 200+300+100+100+100+1000=1800", () => {
      const total = TOBIAS_BUG_WINNINGS.reduce(
        (s, r) => s + r.payoutAmount,
        0,
      );
      expect(total).toBe(1800);

      overlay.show(
        baseSummary({
          ownRoundWinnings: total,
          myWinnings: TOBIAS_BUG_WINNINGS,
        }),
      );
      // Total vises i `eor-own-total`-elementet (count-up til 1800)
      const ownTotal = parent.querySelector('[data-testid="eor-own-total"]');
      expect(ownTotal).not.toBeNull();
    });
  });
});
