/**
 * @vitest-environment happy-dom
 *
 * Tobias prod-incident 2026-04-29: end-of-round retail UX. Overlay erstatter
 * den gamle Game 2-style EndScreen for Spill 1 og gir spilleren et tydelig
 * "round done → klar for neste runde"-vindu. Tester dekker:
 *
 *   1. Mount + DOM-shape (header, patterns-tabell, knapper).
 *   2. Pattern-rader rendres med riktig vinner-tekst (single, multi, ikke-vunnet).
 *   3. Header copy reagerer på endedReason (BINGO_CLAIMED vs MAX_DRAWS_REACHED).
 *   4. Egen total beregnes fra patternResults når ownRoundWinnings ikke er gitt.
 *   5. CTA-knappene fyrer riktige callbacks og lukker overlay.
 *   6. Auto-dismiss timer fyrer onAutoDismiss (eller onReadyForNextRound som fallback).
 *   7. Lucky number + mini-game-result vises når til stede.
 *   8. Re-render via show() etter en tidligere show() (reconnect-scenario).
 *   9. Distinct DOM-marker (data-testid) gjør at "Kobler igjen" og end-of-round
 *      overlay kan skjelnes uten ambiguitet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Game1EndOfRoundOverlay,
  DEFAULT_AUTO_DISMISS_MS,
  type Game1EndOfRoundSummary,
} from "./Game1EndOfRoundOverlay.js";
import type { PatternResult } from "@spillorama/shared-types/game";
import type { MiniGameResultPayload } from "@spillorama/shared-types/socket-events";

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function mkPattern(over: Partial<PatternResult>): PatternResult {
  return {
    patternId: over.patternId ?? "p-row1",
    patternName: over.patternName ?? "Rad 1",
    claimType: over.claimType ?? "LINE",
    isWon: over.isWon ?? false,
    winnerId: over.winnerId,
    wonAtDraw: over.wonAtDraw,
    payoutAmount: over.payoutAmount,
    winnerIds: over.winnerIds,
    winnerCount: over.winnerCount,
  } as PatternResult;
}

function baseSummary(
  over: Partial<Game1EndOfRoundSummary> = {},
): Game1EndOfRoundSummary {
  return {
    endedReason: "BINGO_CLAIMED",
    patternResults: [],
    myPlayerId: "me",
    onReadyForNextRound: vi.fn(),
    onBackToLobby: vi.fn(),
    ...over,
  };
}

describe("Game1EndOfRoundOverlay", () => {
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

  it("mount: DOM rendres med header + buttons + patterns-tabell", () => {
    overlay.show(
      baseSummary({
        patternResults: [mkPattern({ isWon: false })],
      }),
    );

    const root = parent.querySelector(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(root).not.toBeNull();
    expect(parent.textContent).toContain("Spillet er ferdig");
    expect(
      parent.querySelector('[data-testid="eor-ready-btn"]'),
    ).not.toBeNull();
    expect(
      parent.querySelector('[data-testid="eor-lobby-btn"]'),
    ).not.toBeNull();
    expect(
      parent.querySelector('[data-testid="eor-patterns-table"]'),
    ).not.toBeNull();
    expect(overlay.isVisible()).toBe(true);
  });

  it("header: BINGO_CLAIMED viser 'Fullt Hus er vunnet'-subtitle", () => {
    overlay.show(baseSummary({ endedReason: "BINGO_CLAIMED" }));
    expect(parent.textContent).toContain("Fullt Hus er vunnet");
  });

  it("header: MAX_DRAWS_REACHED viser 'Alle baller trukket'-subtitle", () => {
    overlay.show(baseSummary({ endedReason: "MAX_DRAWS_REACHED" }));
    expect(parent.textContent).toContain("Alle baller trukket");
  });

  // Tobias prod-incident 2026-04-29: subtitles MÅ skille mellom faktisk
  // grunn for slutt slik at MAX_DRAWS-runder ikke feilaktig viser
  // "Fullt Hus er vunnet"-tekst.
  it("header: MAX_DRAWS_REACHED-subtitle inkluderer 'runden er slutt' (NOT 'Fullt Hus er vunnet')", () => {
    overlay.show(baseSummary({ endedReason: "MAX_DRAWS_REACHED" }));
    expect(parent.textContent).toContain("runden er slutt");
    // Specifically, MAX_DRAWS-runder skal IKKE vise "Fullt Hus er vunnet" —
    // det er misvisende fordi runden ble avsluttet PÅ TIDEN, ikke pga. en bingo.
    expect(parent.textContent).not.toContain("Fullt Hus er vunnet");
  });

  it("header: MANUAL_END viser 'Runden ble avsluttet'-subtitle", () => {
    overlay.show(baseSummary({ endedReason: "MANUAL_END" }));
    expect(parent.textContent).toContain("Runden ble avsluttet");
  });

  it("header: DRAW_BAG_EMPTY behandles likt som MAX_DRAWS_REACHED", () => {
    overlay.show(baseSummary({ endedReason: "DRAW_BAG_EMPTY" }));
    expect(parent.textContent).toContain("Alle baller trukket");
    expect(parent.textContent).toContain("runden er slutt");
  });

  it("patterns-tabell: viser alle 5 phases med vinnerinfo + payout", () => {
    overlay.show(
      baseSummary({
        myPlayerId: "me",
        patternResults: [
          mkPattern({
            patternId: "p1",
            patternName: "Rad 1",
            isWon: true,
            winnerId: "p2",
            payoutAmount: 100,
          }),
          mkPattern({
            patternId: "p2",
            patternName: "Rad 2",
            isWon: true,
            winnerId: "me",
            winnerIds: ["me"],
            payoutAmount: 200,
          }),
          mkPattern({
            patternId: "p3",
            patternName: "Rad 3",
            isWon: true,
            winnerIds: ["me", "p2"],
            winnerCount: 2,
            payoutAmount: 150,
          }),
          mkPattern({
            patternId: "p4",
            patternName: "Rad 4",
            isWon: false,
          }),
          mkPattern({
            patternId: "p5",
            patternName: "Fullt Hus",
            isWon: true,
            winnerIds: ["other-player"],
            winnerCount: 1,
            payoutAmount: 1000,
          }),
        ],
      }),
    );

    const text = parent.textContent ?? "";
    expect(text).toContain("Rad 1");
    expect(text).toContain("Rad 2");
    expect(text).toContain("Rad 3");
    expect(text).toContain("Rad 4");
    expect(text).toContain("Fullt Hus");
    expect(text).toContain("Du vant"); // Rad 2 — solo
    expect(text).toContain("Du delte"); // Rad 3 — split
    expect(text).toContain("Ikke vunnet"); // Rad 4
  });

  it("egen total: bruker ownRoundWinnings når gitt", () => {
    overlay.show(
      baseSummary({
        ownRoundWinnings: 1700,
        patternResults: [
          mkPattern({
            patternName: "Rad 1",
            isWon: true,
            winnerIds: ["me"],
            payoutAmount: 100,
          }),
        ],
      }),
    );

    const ownTotal = parent.querySelector('[data-testid="eor-own-total"]');
    // Norsk locale bruker non-breaking space (U+00A0) som tusenskiller.
    expect(ownTotal?.textContent).toContain("1 700");
  });

  it("egen total: beregnes fra patternResults når ownRoundWinnings ikke er gitt", () => {
    overlay.show(
      baseSummary({
        myPlayerId: "me",
        patternResults: [
          mkPattern({
            patternName: "Rad 1",
            isWon: true,
            winnerIds: ["me"],
            payoutAmount: 100,
          }),
          mkPattern({
            patternName: "Rad 2",
            isWon: true,
            winnerIds: ["other"],
            payoutAmount: 200,
          }),
          mkPattern({
            patternName: "Fullt Hus",
            isWon: true,
            winnerIds: ["me", "other"],
            winnerCount: 2,
            payoutAmount: 1000,
          }),
        ],
      }),
    );

    // 100 (egen Rad 1) + 1000 (egen Fullt Hus split — vist payout per
    // winner, server har allerede splittet beløpet) = 1100 kr.
    const ownTotal = parent.querySelector('[data-testid="eor-own-total"]');
    expect(ownTotal?.textContent).toContain("1 100");
  });

  it("Klar for neste runde: kaller callback + lukker overlay", () => {
    const onReady = vi.fn();
    overlay.show(baseSummary({ onReadyForNextRound: onReady }));

    const btn = parent.querySelector(
      '[data-testid="eor-ready-btn"]',
    ) as HTMLButtonElement;
    btn.click();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(
      parent.querySelector('[data-testid="game1-end-of-round-overlay"]'),
    ).toBeNull();
    expect(overlay.isVisible()).toBe(false);
  });

  it("Tilbake til lobby: kaller onBackToLobby + lukker overlay", () => {
    const onLobby = vi.fn();
    overlay.show(baseSummary({ onBackToLobby: onLobby }));

    const btn = parent.querySelector(
      '[data-testid="eor-lobby-btn"]',
    ) as HTMLButtonElement;
    btn.click();

    expect(onLobby).toHaveBeenCalledTimes(1);
    expect(overlay.isVisible()).toBe(false);
  });

  it("auto-dismiss: fyrer onAutoDismiss (override) etter timeout", () => {
    const onAuto = vi.fn();
    const onReady = vi.fn();
    overlay.show(
      baseSummary({
        onReadyForNextRound: onReady,
        onAutoDismiss: onAuto,
        autoDismissMs: 5000,
      }),
    );

    expect(onAuto).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);

    expect(onAuto).toHaveBeenCalledTimes(1);
    // onReady skal IKKE være kalt — vi har override-callback.
    expect(onReady).not.toHaveBeenCalled();
    expect(overlay.isVisible()).toBe(false);
  });

  it("auto-dismiss: faller tilbake til onReadyForNextRound når onAutoDismiss ikke er gitt", () => {
    const onReady = vi.fn();
    overlay.show(
      baseSummary({
        onReadyForNextRound: onReady,
        autoDismissMs: 3000,
      }),
    );

    vi.advanceTimersByTime(3000);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("auto-dismiss: bruker DEFAULT_AUTO_DISMISS_MS når ikke spesifisert", () => {
    const onReady = vi.fn();
    overlay.show(baseSummary({ onReadyForNextRound: onReady }));

    vi.advanceTimersByTime(DEFAULT_AUTO_DISMISS_MS - 1);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("manuell dismiss kansellerer auto-dismiss", () => {
    const onReady = vi.fn();
    const onAuto = vi.fn();
    overlay.show(
      baseSummary({
        onReadyForNextRound: onReady,
        onAutoDismiss: onAuto,
        autoDismissMs: 5000,
      }),
    );

    const btn = parent.querySelector(
      '[data-testid="eor-ready-btn"]',
    ) as HTMLButtonElement;
    btn.click();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onAuto).not.toHaveBeenCalled();

    // Avansér forbi auto-dismiss-tid; onAuto skal fortsatt ikke fyre.
    vi.advanceTimersByTime(10000);
    expect(onAuto).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("lucky number: rendres når til stede", () => {
    overlay.show(baseSummary({ luckyNumber: 42 }));
    const luckyEl = parent.querySelector(
      '[data-testid="eor-lucky-number"]',
    );
    expect(luckyEl?.textContent).toContain("42");
  });

  it("lucky number: rendres ikke når null", () => {
    overlay.show(baseSummary({ luckyNumber: null }));
    expect(
      parent.querySelector('[data-testid="eor-lucky-number"]'),
    ).toBeNull();
  });

  it("mini-game-result: rendres med type-spesifikk label", () => {
    const miniGameResult: MiniGameResultPayload = {
      resultId: "mg-1",
      miniGameType: "wheel",
      payoutCents: 50000, // 500 kr
      resultJson: {},
    };
    overlay.show(baseSummary({ miniGameResult }));

    const miniGameEl = parent.querySelector(
      '[data-testid="eor-mini-game"]',
    );
    expect(miniGameEl?.textContent).toContain("Lykkehjul");
    expect(miniGameEl?.textContent).toContain("500");
  });

  it("re-render: andre show() lukker forrige instans først (reconnect-scenario)", () => {
    overlay.show(baseSummary({ endedReason: "BINGO_CLAIMED" }));
    const first = parent.querySelector(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(first).not.toBeNull();

    overlay.show(baseSummary({ endedReason: "MAX_DRAWS_REACHED" }));
    // Skal fortsatt være kun ÉN overlay i DOM-en.
    const all = parent.querySelectorAll(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(all.length).toBe(1);
    expect(parent.textContent).toContain("Alle baller trukket");
  });

  it("destroy: lukker DOM + rydder timers", () => {
    const onAuto = vi.fn();
    overlay.show(
      baseSummary({
        onAutoDismiss: onAuto,
        autoDismissMs: 5000,
      }),
    );
    overlay.destroy();

    vi.advanceTimersByTime(10000);
    expect(onAuto).not.toHaveBeenCalled();
    expect(
      parent.querySelector('[data-testid="game1-end-of-round-overlay"]'),
    ).toBeNull();
    expect(overlay.isVisible()).toBe(false);
  });

  it("tom patternResults-array: viser 'Ingen vinnere denne runden'", () => {
    overlay.show(baseSummary({ patternResults: [] }));
    expect(parent.textContent).toContain("Ingen vinnere denne runden");
  });

  it("data-testid distinct: end-of-round overlay er distinct fra LoadingOverlay", () => {
    overlay.show(baseSummary());
    // LoadingOverlay bruker `role=status` (live-region) og er position:absolute.
    // End-of-round bruker `role=dialog` + data-testid + position:fixed.
    const root = parent.querySelector(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(root?.getAttribute("role")).toBe("dialog");
    expect(root?.getAttribute("aria-modal")).toBe("true");
  });

  it("countdown-modus: ready-button viser 'Neste runde om N s'", () => {
    overlay.show(
      baseSummary({
        showAutoRoundCountdown: true,
        autoDismissMs: 8000,
      }),
    );
    const btn = parent.querySelector(
      '[data-testid="eor-ready-btn"]',
    ) as HTMLButtonElement;
    expect(btn.textContent).toContain("Neste runde om");
    expect(btn.textContent).toContain("8");
  });
});
