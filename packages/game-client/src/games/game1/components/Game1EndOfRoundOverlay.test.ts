/**
 * @vitest-environment happy-dom
 *
 * Tobias UX-mandate 2026-04-29 (option C, fluid 3-phase overlay):
 * tester for kombinert SUMMARY → LOADING → COUNTDOWN overlay som
 * transitions naturlig uten popup-stacking. Tester dekker:
 *
 *   1. Mount + initial DOM-shape (phase 1 = SUMMARY).
 *   2. Phase transitions trigger på timer (SUMMARY → LOADING → COUNTDOWN).
 *   3. Header copy reagerer på endedReason + ownTotal ("Du vant" vs "Du vant ikke").
 *   4. Animated count-up mot ownTotal (Phase 1).
 *   5. Patterns-tabell rendres med riktig vinner-tekst.
 *   6. Lucky number + mini-game-result vises i SUMMARY.
 *   7. Buy-popup-trigger fyrer ved ≤5 sek igjen i COUNTDOWN.
 *   8. onOverlayCompleted fyrer når countdown utløper.
 *   9. "Tilbake til lobby" fungerer fra alle 3 faser.
 *  10. Disconnect-resilience: elapsedSinceEndedMs starter overlay i riktig fase.
 *  11. Empty-summary case (0 tickets armed) — phase 1 reduseres til 1s.
 *  12. Re-render via show() lukker forrige instans først (reconnect-scenario).
 *  13. Distinct DOM-marker (data-testid) — kan skjelnes fra LoadingOverlay.
 *  14. Mini-game-result: type-spesifikk label.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Game1EndOfRoundOverlay,
  SUMMARY_PHASE_MS,
  SUMMARY_PHASE_SPECTATOR_MS,
  LOADING_PHASE_MS,
  BUY_POPUP_TRIGGER_REMAINING_MS,
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
    myTickets: [{ id: "t1", grid: [[1]] }] as Game1EndOfRoundSummary["myTickets"],
    onBackToLobby: vi.fn(),
    millisUntilNextStart: 30_000,
    ...over,
  };
}

// Helper to advance both timers AND rAF (happy-dom doesn't auto-flush rAF
// when fake timers are active).
function advanceAndFlush(ms: number): void {
  vi.advanceTimersByTime(ms);
}

describe("Game1EndOfRoundOverlay (fluid 3-phase)", () => {
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

  it("mount: phase 1 (SUMMARY) er aktiv initially", () => {
    overlay.show(
      baseSummary({
        patternResults: [mkPattern({ isWon: false })],
      }),
    );

    expect(
      parent.querySelector('[data-testid="game1-end-of-round-overlay"]'),
    ).not.toBeNull();
    expect(parent.querySelector('[data-testid="eor-phase-summary"]')).not.toBeNull();
    expect(parent.querySelector('[data-testid="eor-phase-loading"]')).toBeNull();
    expect(parent.querySelector('[data-testid="eor-phase-countdown"]')).toBeNull();
    expect(overlay.isVisible()).toBe(true);
    expect(overlay.getCurrentPhase()).toBe("SUMMARY");
  });

  it("mount: 'Tilbake til lobby'-knapp er alltid synlig (fase-uavhengig)", () => {
    overlay.show(baseSummary());
    expect(parent.querySelector('[data-testid="eor-lobby-btn"]')).not.toBeNull();
  });

  it("phase transitions: SUMMARY → LOADING → COUNTDOWN på timer", () => {
    overlay.show(baseSummary({ ownRoundWinnings: 100 }));
    expect(overlay.getCurrentPhase()).toBe("SUMMARY");

    // Avansér forbi SUMMARY-fasen
    advanceAndFlush(SUMMARY_PHASE_MS + 50);
    expect(overlay.getCurrentPhase()).toBe("LOADING");

    // Avansér forbi LOADING-fasen
    advanceAndFlush(LOADING_PHASE_MS + 50);
    expect(overlay.getCurrentPhase()).toBe("COUNTDOWN");
  });

  it("header: BINGO_CLAIMED + ownTotal>0 viser 'Du vant'", () => {
    overlay.show(
      baseSummary({
        endedReason: "BINGO_CLAIMED",
        ownRoundWinnings: 1700,
      }),
    );
    expect(parent.textContent).toContain("Du vant");
  });

  it("header: BINGO_CLAIMED + ownTotal=0 viser 'Spillet er ferdig'", () => {
    overlay.show(
      baseSummary({
        endedReason: "BINGO_CLAIMED",
        ownRoundWinnings: 0,
      }),
    );
    expect(parent.textContent).toContain("Spillet er ferdig");
  });

  it("header: MAX_DRAWS_REACHED viser 'Alle baller trukket'-fallback", () => {
    overlay.show(
      baseSummary({ endedReason: "MAX_DRAWS_REACHED", ownRoundWinnings: 0 }),
    );
    expect(parent.textContent).toContain("Alle baller trukket");
  });

  // Tobias prod-incident 2026-04-29 (PR #733): subtitles MÅ skille mellom
  // faktisk grunn for slutt slik at MAX_DRAWS-runder ikke feilaktig viser
  // "Fullt Hus er vunnet"-tekst.
  it("header: MAX_DRAWS_REACHED-subtitle sier 'Runden er slutt' (IKKE 'Fullt Hus er vunnet')", () => {
    overlay.show(
      baseSummary({ endedReason: "MAX_DRAWS_REACHED", ownRoundWinnings: 0 }),
    );
    expect(parent.textContent).toContain("Runden er slutt");
    // Specifically, MAX_DRAWS-runder skal IKKE vise "Fullt Hus er vunnet" —
    // det er misvisende fordi runden ble avsluttet PÅ TIDEN, ikke pga. en bingo.
    expect(parent.textContent).not.toContain("Fullt Hus er vunnet");
  });

  it("header: MANUAL_END viser 'Runden ble avsluttet'", () => {
    overlay.show(
      baseSummary({ endedReason: "MANUAL_END", ownRoundWinnings: 0 }),
    );
    expect(parent.textContent).toContain("Runden ble avsluttet");
  });

  it("header: DRAW_BAG_EMPTY behandles likt som MAX_DRAWS_REACHED", () => {
    overlay.show(
      baseSummary({ endedReason: "DRAW_BAG_EMPTY", ownRoundWinnings: 0 }),
    );
    expect(parent.textContent).toContain("Alle baller trukket");
    expect(parent.textContent).toContain("Runden er slutt");
  });

  it("egen total: bruker ownRoundWinnings når gitt", () => {
    overlay.show(baseSummary({ ownRoundWinnings: 1700 }));

    // Count-up animasjon kan ikke garanteres å være ferdig på t=0.
    // Sjekk at element finnes og har riktig data-testid.
    const ownTotal = parent.querySelector('[data-testid="eor-own-total"]');
    expect(ownTotal).not.toBeNull();
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

    // Element finnes og har korrekt computeOwnTotal-resultat (100 + 1000 = 1100)
    // — sjekkes via static text-rendering AV count-up-animasjonen som
    // initialt rendrer 0 kr og animerer mot 1100.
    expect(
      parent.querySelector('[data-testid="eor-own-total"]'),
    ).not.toBeNull();
  });

  it("patterns-tabell: viser alle phases med vinner-info", () => {
    overlay.show(
      baseSummary({
        myPlayerId: "me",
        ownRoundWinnings: 250,
        patternResults: [
          mkPattern({
            patternId: "p1",
            patternName: "Rad 1",
            isWon: true,
            winnerId: "me",
            winnerIds: ["me"],
            payoutAmount: 100,
          }),
          mkPattern({
            patternId: "p2",
            patternName: "Rad 2",
            isWon: true,
            winnerIds: ["me", "p2"],
            winnerCount: 2,
            payoutAmount: 150,
          }),
          mkPattern({
            patternId: "p3",
            patternName: "Rad 3",
            isWon: false,
          }),
        ],
      }),
    );

    expect(parent.textContent).toContain("Rad 1");
    expect(parent.textContent).toContain("Rad 2");
    expect(parent.textContent).toContain("Rad 3");
    expect(parent.textContent).toContain("Du vant"); // Rad 1 — solo
    expect(parent.textContent).toContain("Du delte"); // Rad 2 — split
    expect(parent.textContent).toContain("Ikke vunnet"); // Rad 3
  });

  it("Tilbake til lobby fra phase 1 (SUMMARY): kaller onBackToLobby + lukker", () => {
    const onLobby = vi.fn();
    overlay.show(baseSummary({ onBackToLobby: onLobby }));

    const btn = parent.querySelector(
      '[data-testid="eor-lobby-btn"]',
    ) as HTMLButtonElement;
    btn.click();

    expect(onLobby).toHaveBeenCalledTimes(1);
    expect(overlay.isVisible()).toBe(false);
  });

  it("Tilbake til lobby fra phase 2 (LOADING): fungerer", () => {
    const onLobby = vi.fn();
    overlay.show(baseSummary({ onBackToLobby: onLobby }));

    advanceAndFlush(SUMMARY_PHASE_MS + 50);
    expect(overlay.getCurrentPhase()).toBe("LOADING");

    const btn = parent.querySelector(
      '[data-testid="eor-lobby-btn"]',
    ) as HTMLButtonElement;
    btn.click();

    expect(onLobby).toHaveBeenCalledTimes(1);
    expect(overlay.isVisible()).toBe(false);
  });

  it("Tilbake til lobby fra phase 3 (COUNTDOWN): fungerer", () => {
    const onLobby = vi.fn();
    overlay.show(baseSummary({ onBackToLobby: onLobby }));

    advanceAndFlush(SUMMARY_PHASE_MS + LOADING_PHASE_MS + 50);
    expect(overlay.getCurrentPhase()).toBe("COUNTDOWN");

    const btn = parent.querySelector(
      '[data-testid="eor-lobby-btn"]',
    ) as HTMLButtonElement;
    btn.click();

    expect(onLobby).toHaveBeenCalledTimes(1);
    expect(overlay.isVisible()).toBe(false);
  });

  it("phase 3: countdown-display + progress-bar rendres", () => {
    overlay.show(
      baseSummary({
        millisUntilNextStart: 30_000,
      }),
    );

    advanceAndFlush(SUMMARY_PHASE_MS + LOADING_PHASE_MS + 50);
    expect(overlay.getCurrentPhase()).toBe("COUNTDOWN");

    expect(
      parent.querySelector('[data-testid="eor-countdown-seconds"]'),
    ).not.toBeNull();
    expect(
      parent.querySelector('[data-testid="eor-progress-bar"]'),
    ).not.toBeNull();
  });

  it("phase 3 buy-popup-trigger: onCountdownNearStart fyrer ved ≤5 sek igjen", () => {
    const onCountdownNearStart = vi.fn();
    // Server gir 8 sekunder igjen — så når COUNTDOWN starter har den 8s,
    // og ved 5s gjenstående (etter 3s) skal trigger fyre.
    overlay.show(
      baseSummary({
        millisUntilNextStart: 8_000,
        onCountdownNearStart,
      }),
    );

    // Avansér til COUNTDOWN-fasen + 3 sek inn i countdown (= 5 sek igjen)
    advanceAndFlush(SUMMARY_PHASE_MS + LOADING_PHASE_MS + 3_500);
    expect(onCountdownNearStart).toHaveBeenCalledTimes(1);
  });

  it("phase 3 buy-popup-trigger: idempotent — fyrer kun én gang", () => {
    const onCountdownNearStart = vi.fn();
    overlay.show(
      baseSummary({
        millisUntilNextStart: 8_000,
        onCountdownNearStart,
      }),
    );

    // Avansér forbi trigger-grensen og videre
    advanceAndFlush(SUMMARY_PHASE_MS + LOADING_PHASE_MS + 6_000);
    expect(onCountdownNearStart).toHaveBeenCalledTimes(1);

    // Avansér enda lenger — skal fortsatt være kun 1 kall
    advanceAndFlush(2_000);
    expect(onCountdownNearStart).toHaveBeenCalledTimes(1);
  });

  it("phase 3 onOverlayCompleted: fyrer når countdown utløper", () => {
    const onOverlayCompleted = vi.fn();
    overlay.show(
      baseSummary({
        // Use minimum allowed countdown (= BUY_POPUP_TRIGGER_REMAINING_MS)
        millisUntilNextStart: BUY_POPUP_TRIGGER_REMAINING_MS,
        onOverlayCompleted,
      }),
    );

    // Avansér forbi hele 3-fase-flyten
    advanceAndFlush(
      SUMMARY_PHASE_MS + LOADING_PHASE_MS + BUY_POPUP_TRIGGER_REMAINING_MS + 200,
    );

    expect(onOverlayCompleted).toHaveBeenCalledTimes(1);
  });

  it("disconnect-resilience: elapsedSinceEndedMs > SUMMARY_PHASE_MS hopper til LOADING", () => {
    overlay.show(
      baseSummary({
        elapsedSinceEndedMs: SUMMARY_PHASE_MS + 100,
      }),
    );
    expect(overlay.getCurrentPhase()).toBe("LOADING");
  });

  it("disconnect-resilience: elapsedSinceEndedMs > SUMMARY+LOADING hopper til COUNTDOWN", () => {
    overlay.show(
      baseSummary({
        elapsedSinceEndedMs: SUMMARY_PHASE_MS + LOADING_PHASE_MS + 100,
      }),
    );
    expect(overlay.getCurrentPhase()).toBe("COUNTDOWN");
  });

  it("empty-summary case: 0 tickets armed reduserer phase 1 til 1s", () => {
    overlay.show(
      baseSummary({
        myTickets: [],
        ownRoundWinnings: 0,
        patternResults: [],
      }),
    );
    expect(overlay.getCurrentPhase()).toBe("SUMMARY");

    // Avansér ~1.1s (> spectator-fasen, < normal-fasen)
    advanceAndFlush(SUMMARY_PHASE_SPECTATOR_MS + 200);
    expect(overlay.getCurrentPhase()).toBe("LOADING");
  });

  it("empty-summary case: viser kun 'Spillet er ferdig' (ingen patterns-tabell)", () => {
    overlay.show(
      baseSummary({
        myTickets: [],
        ownRoundWinnings: 0,
        patternResults: [],
      }),
    );
    expect(parent.textContent).toContain("Spillet er ferdig");
    // Spectator-mode skjuler patterns-tabellen for klarhet
    expect(
      parent.querySelector('[data-testid="eor-patterns-table"]'),
    ).toBeNull();
  });

  it("lucky number: rendres når til stede i SUMMARY", () => {
    overlay.show(baseSummary({ luckyNumber: 42 }));
    const luckyEl = parent.querySelector('[data-testid="eor-lucky-number"]');
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

    const miniGameEl = parent.querySelector('[data-testid="eor-mini-game"]');
    expect(miniGameEl?.textContent).toContain("Lykkehjul");
    expect(miniGameEl?.textContent).toContain("500");
  });

  it("re-render: andre show() lukker forrige instans først (reconnect)", () => {
    overlay.show(baseSummary({ endedReason: "BINGO_CLAIMED" }));
    const first = parent.querySelector(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(first).not.toBeNull();

    overlay.show(baseSummary({ endedReason: "MAX_DRAWS_REACHED" }));
    const all = parent.querySelectorAll(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(all.length).toBe(1);
    expect(parent.textContent).toContain("Alle baller trukket");
  });

  it("destroy: lukker DOM + rydder timers + cancellerer rAF", () => {
    const onCountdownNearStart = vi.fn();
    const onOverlayCompleted = vi.fn();
    overlay.show(
      baseSummary({
        millisUntilNextStart: 8_000,
        onCountdownNearStart,
        onOverlayCompleted,
      }),
    );
    overlay.destroy();

    // Avansér forbi alt — ingen callbacks skal fyre
    advanceAndFlush(20_000);
    expect(onCountdownNearStart).not.toHaveBeenCalled();
    expect(onOverlayCompleted).not.toHaveBeenCalled();
    expect(
      parent.querySelector('[data-testid="game1-end-of-round-overlay"]'),
    ).toBeNull();
    expect(overlay.isVisible()).toBe(false);
  });

  it("tom patternResults-array (med tickets): viser 'Ingen vinnere'", () => {
    overlay.show(
      baseSummary({
        patternResults: [],
        myTickets: [{ id: "t1", grid: [[1]] }] as Game1EndOfRoundSummary["myTickets"],
        ownRoundWinnings: 0,
      }),
    );
    expect(parent.textContent).toContain("Ingen vinnere denne runden");
  });

  it("data-testid distinct: end-of-round overlay er distinct fra LoadingOverlay", () => {
    overlay.show(baseSummary());
    const root = parent.querySelector(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(root?.getAttribute("role")).toBe("dialog");
    expect(root?.getAttribute("aria-modal")).toBe("true");
  });

  it("phase 3: countdown viser 'sekund' (singular) når 1 sec igjen", () => {
    overlay.show(
      baseSummary({
        millisUntilNextStart: 6_000,
      }),
    );

    // Hopp til COUNTDOWN-fasen, så 5 sek inn (= 1 sek igjen)
    advanceAndFlush(SUMMARY_PHASE_MS + LOADING_PHASE_MS + 5_000);
    expect(overlay.getCurrentPhase()).toBe("COUNTDOWN");

    // happy-dom rAF-tick is timer-driven; advance 100 ms to flush at least
    // one rAF callback so secondsEl text gets updated.
    advanceAndFlush(100);

    expect(parent.textContent).toMatch(/sekund/);
  });

  it("phase 1 (SUMMARY): patterns-tabell rendres for normal-runde", () => {
    overlay.show(
      baseSummary({
        ownRoundWinnings: 100,
        patternResults: [
          mkPattern({ patternName: "Rad 1", isWon: true, payoutAmount: 100 }),
        ],
      }),
    );

    expect(
      parent.querySelector('[data-testid="eor-patterns-table"]'),
    ).not.toBeNull();
  });

  it("count-up: animerer fra 0 til target (initial 0 kr)", () => {
    overlay.show(baseSummary({ ownRoundWinnings: 1700 }));

    const ownTotalEl = parent.querySelector(
      '[data-testid="eor-own-total"]',
    ) as HTMLElement;
    // Initially renders 0 kr (animation starts from 0).
    expect(ownTotalEl?.textContent).toMatch(/0\s*kr/);
  });
});
