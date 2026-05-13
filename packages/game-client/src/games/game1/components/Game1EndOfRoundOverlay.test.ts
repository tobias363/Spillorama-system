/**
 * @vitest-environment happy-dom
 *
 * Tobias UX-mandate 2026-04-29 (revised post-PR #734): combined Summary +
 * Loading overlay uten countdown-fase. Tester dekker:
 *
 *   1. Mount + initial DOM-shape (SUMMARY phase med spinner).
 *   2. Header copy reagerer på endedReason + ownTotal ("Du vant" vs
 *      "Spillet er ferdig", "Alle baller trukket", "Runden ble avsluttet").
 *   3. Patterns-tabell rendres med riktig vinner-tekst.
 *   4. Lucky number + mini-game-result vises i SUMMARY.
 *   5. markRoomReady() alene dismisser ikke før min-display-tid passert.
 *   6. min-display-tid alene dismisser ikke før markRoomReady kalt.
 *   7. Begge betingelser møtt → onOverlayCompleted fyrer.
 *   8. Spectator-runde har min-display = 1s (ikke 3s).
 *   9. "Tilbake til lobby" fyrer onBackToLobby + lukker overlay.
 *  10. Re-render via show() lukker forrige instans først (reconnect).
 *  11. Disconnect-resilience: elapsedSinceEndedMs > min-display setter
 *      `minDisplayElapsed=true` umiddelbart.
 *  12. Distinct DOM-marker (data-testid) — kan skjelnes fra LoadingOverlay.
 *  13. Tobias regulatorisk subtitle — MAX_DRAWS-runder skal IKKE feilaktig
 *      vise "Fullt Hus er vunnet" (PR #733-mandat bevart).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  Game1EndOfRoundOverlay,
  MIN_DISPLAY_MS,
  MIN_DISPLAY_MS_SPECTATOR,
  WAITING_FOR_MASTER_TIMEOUT_MS,
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
    ...over,
  };
}

describe("Game1EndOfRoundOverlay (Summary + Loading combined)", () => {
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

  it("mount: SUMMARY-fasen er aktiv initially", () => {
    overlay.show(baseSummary());
    expect(overlay.isVisible()).toBe(true);
    expect(overlay.getCurrentPhase()).toBe("SUMMARY");
  });

  it("mount: 'Tilbake til lobby'-knapp er synlig", () => {
    overlay.show(baseSummary());
    const btn = parent.querySelector('[data-testid="eor-lobby-btn"]');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Tilbake til lobby");
  });

  it("mount: persistent loading-spinner-indikator er synlig i SUMMARY", () => {
    overlay.show(baseSummary());
    const loading = parent.querySelector(
      '[data-testid="eor-loading-indicator"]',
    );
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain("Forbereder rommet");
  });

  it("header: BINGO_CLAIMED + ownTotal>0 viser 'Du vant'", () => {
    overlay.show(
      baseSummary({
        endedReason: "BINGO_CLAIMED",
        ownRoundWinnings: 100,
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
    expect(parent.textContent).not.toContain("Fullt Hus er vunnet");
  });

  it("header: MANUAL_END viser 'Runden ble avsluttet'", () => {
    overlay.show(
      baseSummary({ endedReason: "MANUAL_END", ownRoundWinnings: 0 }),
    );
    expect(parent.textContent).toContain("Runden ble avsluttet");
  });

  it("egen total: rendrer beløp-element", () => {
    overlay.show(baseSummary({ ownRoundWinnings: 1700 }));
    const ownTotal = parent.querySelector('[data-testid="eor-own-total"]');
    expect(ownTotal).not.toBeNull();
  });

  it("patterns-tabell: rendrer alle phases med vinner-info", () => {
    const winnerId = "winner-1";
    const myId = "me";
    overlay.show(
      baseSummary({
        myPlayerId: myId,
        patternResults: [
          mkPattern({
            patternId: "p1",
            patternName: "Rad 1",
            isWon: true,
            winnerId,
            payoutAmount: 100,
            wonAtDraw: 5,
          }),
          mkPattern({
            patternId: "p2",
            patternName: "Rad 2",
            isWon: false,
          }),
        ],
      }),
    );
    expect(parent.textContent).toContain("Rad 1");
    expect(parent.textContent).toContain("Rad 2");
  });

  it("dismiss: markRoomReady alene dismisser IKKE før min-display passert", () => {
    const onCompleted = vi.fn();
    overlay.show(
      baseSummary({
        ownRoundWinnings: 100,
        onOverlayCompleted: onCompleted,
      }),
    );
    overlay.markRoomReady();
    // Min-display ikke passert ennå (3s)
    vi.advanceTimersByTime(1_000);
    expect(onCompleted).not.toHaveBeenCalled();
    expect(overlay.isVisible()).toBe(true);
  });

  it("dismiss: min-display alene dismisser IKKE før markRoomReady kalt", () => {
    const onCompleted = vi.fn();
    overlay.show(
      baseSummary({
        ownRoundWinnings: 100,
        onOverlayCompleted: onCompleted,
      }),
    );
    // Passer min-display-tid uten å kalle markRoomReady
    vi.advanceTimersByTime(MIN_DISPLAY_MS + 100);
    expect(onCompleted).not.toHaveBeenCalled();
    expect(overlay.isVisible()).toBe(true);
  });

  it("dismiss: når BÅDE markRoomReady OG min-display er møtt → onOverlayCompleted fyrer", () => {
    const onCompleted = vi.fn();
    overlay.show(
      baseSummary({
        ownRoundWinnings: 100,
        onOverlayCompleted: onCompleted,
      }),
    );
    // Først min-display
    vi.advanceTimersByTime(MIN_DISPLAY_MS + 100);
    expect(onCompleted).not.toHaveBeenCalled();
    // Så ready → tryDismiss → fade ut
    overlay.markRoomReady();
    // Etter PHASE_FADE_MS (300ms) skal completion ha firet
    vi.advanceTimersByTime(400);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("dismiss: rekkefølgen ready-først, så min-display, gir samme resultat", () => {
    const onCompleted = vi.fn();
    overlay.show(
      baseSummary({
        ownRoundWinnings: 100,
        onOverlayCompleted: onCompleted,
      }),
    );
    overlay.markRoomReady();
    expect(onCompleted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIN_DISPLAY_MS + 400);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("dismiss: idempotent — flere markRoomReady-call gir én onOverlayCompleted", () => {
    const onCompleted = vi.fn();
    overlay.show(
      baseSummary({
        ownRoundWinnings: 100,
        onOverlayCompleted: onCompleted,
      }),
    );
    vi.advanceTimersByTime(MIN_DISPLAY_MS + 100);
    overlay.markRoomReady();
    overlay.markRoomReady();
    overlay.markRoomReady();
    vi.advanceTimersByTime(400);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("spectator (0 tickets, ownTotal=0): min-display reduseres til 1s", () => {
    const onCompleted = vi.fn();
    overlay.show(
      baseSummary({
        myTickets: [],
        ownRoundWinnings: 0,
        endedReason: "BINGO_CLAIMED",
        onOverlayCompleted: onCompleted,
      }),
    );
    overlay.markRoomReady();
    // Etter 500ms: spectator min ikke møtt ennå
    vi.advanceTimersByTime(500);
    expect(onCompleted).not.toHaveBeenCalled();
    // Etter 1s + fade: completion fyrer
    vi.advanceTimersByTime(MIN_DISPLAY_MS_SPECTATOR + 400);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("Tilbake til lobby: kaller onBackToLobby + lukker overlay", () => {
    const onBack = vi.fn();
    overlay.show(baseSummary({ onBackToLobby: onBack }));
    const btn = parent.querySelector(
      '[data-testid="eor-lobby-btn"]',
    ) as HTMLButtonElement | null;
    btn?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(overlay.isVisible()).toBe(false);
  });

  it("re-render: andre show() lukker forrige instans først (reconnect)", () => {
    overlay.show(baseSummary({ ownRoundWinnings: 100 }));
    overlay.show(baseSummary({ ownRoundWinnings: 250 }));
    // Skal være kun ÉN overlay-rot i DOM
    const overlays = parent.querySelectorAll(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(overlays.length).toBe(1);
  });

  it("disconnect-resilience: elapsedSinceEndedMs > MIN_DISPLAY → markRoomReady dismisser umiddelbart", () => {
    const onCompleted = vi.fn();
    overlay.show(
      baseSummary({
        ownRoundWinnings: 100,
        elapsedSinceEndedMs: MIN_DISPLAY_MS + 5_000, // 8s allerede gått
        onOverlayCompleted: onCompleted,
      }),
    );
    // markRoomReady kalles umiddelbart (controller har stale state cached)
    overlay.markRoomReady();
    vi.advanceTimersByTime(400); // bare fade-tid
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("destroy: lukker DOM + resetter state", () => {
    overlay.show(baseSummary());
    expect(overlay.isVisible()).toBe(true);
    overlay.destroy();
    expect(overlay.isVisible()).toBe(false);
  });

  it("data-testid distinct fra LoadingOverlay", () => {
    overlay.show(baseSummary());
    const eor = parent.querySelector(
      '[data-testid="game1-end-of-round-overlay"]',
    );
    expect(eor).not.toBeNull();
    // LoadingOverlay bruker en annen data-testid (hva enn det måtte være)
    // — denne testen vokter mot at vi ved et uhell deler testid.
    expect(eor?.getAttribute("data-testid")).toBe(
      "game1-end-of-round-overlay",
    );
  });

  it("lucky number: rendres når til stede", () => {
    overlay.show(baseSummary({ luckyNumber: 42, ownRoundWinnings: 100 }));
    const lucky = parent.querySelector('[data-testid="eor-lucky-number"]');
    expect(lucky).not.toBeNull();
    expect(lucky?.textContent).toContain("42");
  });

  it("lucky number: rendres ikke når null", () => {
    overlay.show(baseSummary({ luckyNumber: null, ownRoundWinnings: 100 }));
    const lucky = parent.querySelector('[data-testid="eor-lucky-number"]');
    expect(lucky).toBeNull();
  });

  it("mini-game-result: rendres med type-spesifikk label", () => {
    const miniGameResult: MiniGameResultPayload = {
      resultId: "r1",
      miniGameType: "wheel",
      payoutCents: 25_000,
      resultJson: {
        winningBucketIndex: 3,
        prizeGroupIndex: 1,
        amountKroner: 250,
        totalBuckets: 8,
        animationSeed: 1,
      },
    };
    overlay.show(
      baseSummary({
        miniGameResult,
        ownRoundWinnings: 350,
      }),
    );
    const mg = parent.querySelector('[data-testid="eor-mini-game"]');
    expect(mg).not.toBeNull();
    expect(mg?.textContent).toContain("Lykkehjul");
  });

  it("empty-summary case (0 tickets, ownTotal=0): viser kun 'Spillet er ferdig'", () => {
    overlay.show(
      baseSummary({
        myTickets: [],
        ownRoundWinnings: 0,
        patternResults: [],
      }),
    );
    expect(parent.textContent).toContain("Spillet er ferdig");
  });

  it("hide() er idempotent — kan kalles før show() uten exception", () => {
    expect(() => overlay.hide()).not.toThrow();
    expect(overlay.isVisible()).toBe(false);
  });

  it("markRoomReady() før show() er no-op", () => {
    expect(() => overlay.markRoomReady()).not.toThrow();
  });

  // ── Tobias prod-incident 2026-05-13 (root cause #3) ─────────────────
  // "Forbereder rommet..."-spinner henger evig fordi backend ikke
  // emitter ny `room:update` etter round-end før master har klikket
  // "Start neste spill". Fix: etter 30s, bytt loading-tekst til "Venter
  // på master — runden er slutt" og dempe spinneren, slik at lobby-
  // knappen er primary action.
  describe("waiting-for-master fallback (Tobias 2026-05-13)", () => {
    it("etter timeout uten markRoomReady: loading-tekst byttes til 'Venter på master'", () => {
      overlay.show(baseSummary({ ownRoundWinnings: 100 }));

      // Initial: "Forbereder rommet..."
      const loadingBefore = parent.querySelector(
        '[data-testid="eor-loading-indicator"]',
      );
      expect(loadingBefore?.textContent).toContain("Forbereder rommet");
      expect(loadingBefore?.getAttribute("data-state")).toBe("preparing");

      // Tikk over timeout-grensen uten å kalle markRoomReady
      vi.advanceTimersByTime(WAITING_FOR_MASTER_TIMEOUT_MS + 100);

      // Loading-tekst skal nå si "Venter på master ..."
      const loadingAfter = parent.querySelector(
        '[data-testid="eor-loading-indicator"]',
      );
      expect(loadingAfter?.textContent).toContain("Venter på master");
      expect(loadingAfter?.textContent).not.toContain("Forbereder rommet");
      expect(loadingAfter?.getAttribute("data-state")).toBe(
        "waiting-for-master",
      );
    });

    it("etter timeout: lobby-knappen styling oppjusteres og er fortsatt klikkbar", () => {
      const onBack = vi.fn();
      overlay.show(baseSummary({ ownRoundWinnings: 100, onBackToLobby: onBack }));

      // Tikk over timeout-grensen
      vi.advanceTimersByTime(WAITING_FOR_MASTER_TIMEOUT_MS + 100);

      const btn = parent.querySelector(
        '[data-testid="eor-lobby-btn"]',
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("data-state")).toBe("waiting-for-master");

      // Klikk skal fortsatt fungere og kalle onBackToLobby + lukke overlay
      btn?.click();
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(overlay.isVisible()).toBe(false);
    });

    it("markRoomReady() FØR timeout cancelt waiting-fallback", () => {
      const onCompleted = vi.fn();
      overlay.show(
        baseSummary({
          ownRoundWinnings: 100,
          onOverlayCompleted: onCompleted,
        }),
      );

      // Wait past min-display, kall markRoomReady → tryDismiss → fade
      vi.advanceTimersByTime(MIN_DISPLAY_MS + 100);
      overlay.markRoomReady();
      vi.advanceTimersByTime(400);
      expect(onCompleted).toHaveBeenCalledTimes(1);

      // Overlay er nå skjult — vi skal IKKE se "Venter på master"-tekst
      // dukke opp etter 30s (timeren ble cancelet av markRoomReady).
      vi.advanceTimersByTime(WAITING_FOR_MASTER_TIMEOUT_MS + 1_000);
      const stillVisible = parent.querySelector(
        '[data-testid="game1-end-of-round-overlay"]',
      );
      expect(stillVisible).toBeNull();
    });

    it("reconnect: elapsedSinceEndedMs > timeout slår fallback inn umiddelbart", () => {
      // Bruker har vært borte i 35s — master har aldri startet neste runde.
      overlay.show(
        baseSummary({
          ownRoundWinnings: 100,
          elapsedSinceEndedMs: WAITING_FOR_MASTER_TIMEOUT_MS + 5_000,
        }),
      );

      // Umiddelbart etter show: fallback er allerede applikert (ingen
      // setTimeout-vente).
      const loading = parent.querySelector(
        '[data-testid="eor-loading-indicator"]',
      );
      expect(loading?.textContent).toContain("Venter på master");
      expect(loading?.getAttribute("data-state")).toBe("waiting-for-master");
    });

    it("fallback er idempotent — timeren fyrer ikke etter manuell apply", () => {
      overlay.show(
        baseSummary({
          ownRoundWinnings: 100,
          elapsedSinceEndedMs: WAITING_FOR_MASTER_TIMEOUT_MS + 5_000,
        }),
      );

      // Initial: fallback applikert umiddelbart (reconnect-path)
      const loading = parent.querySelector(
        '[data-testid="eor-loading-indicator"]',
      );
      expect(loading?.getAttribute("data-state")).toBe("waiting-for-master");

      // Tikk videre — tekst skal forbli "Venter på master" (ingen idempotens-
      // bug der den dobbel-applieres).
      vi.advanceTimersByTime(WAITING_FOR_MASTER_TIMEOUT_MS * 2);
      const loadingLater = parent.querySelector(
        '[data-testid="eor-loading-indicator"]',
      );
      expect(loadingLater?.textContent).toContain("Venter på master");
    });
  });
});
