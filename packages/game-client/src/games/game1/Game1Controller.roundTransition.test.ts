/**
 * @vitest-environment happy-dom
 *
 * Tobias 2026-04-27: Round-transition-fix.
 *
 * Bug: etter at en Spill 1-runde ender (Fullt Hus eller MAX_DRAWS),
 * transitionerer klient til EndScreen og setter `endScreenTimer` (5s).
 * Hvis `gameStarted`-event for ny runde fyrer FØR de 5 sekundene har gått,
 * vil klient sitte fast i ENDED-fase og IKKE bytte til PLAYING/SPECTATING
 * for ny runde — bruker må refreshe nettleseren.
 *
 * To fixes i Game1Controller.ts:
 *   2A — `onGameStarted` canceller endScreenTimer før transition.
 *   2B — `onStateChanged` defensiv recovery: hvis ENDED + RUNNING-state
 *        observert, force-transition direkte til PLAYING/SPECTATING.
 *
 * Speiler logikken i en lettvekts-harness-pattern (samme stil som
 * Game1Controller.miniGameQueue.test.ts).
 */
import { describe, it, expect, vi } from "vitest";

type Phase = "LOADING" | "WAITING" | "PLAYING" | "SPECTATING" | "ENDED";

interface MiniState {
  gameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED";
  myTickets: unknown[];
}

class Harness {
  phase: Phase = "PLAYING";
  endScreenTimer: ReturnType<typeof setTimeout> | null = null;
  transitionTo = vi.fn((phase: Phase, _state: MiniState) => {
    this.phase = phase;
  });

  /** Speil av Game1Controller.onGameStarted (2A). */
  onGameStarted(state: MiniState): void {
    if (this.endScreenTimer) {
      clearTimeout(this.endScreenTimer);
      this.endScreenTimer = null;
    }
    if (state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      this.transitionTo("SPECTATING", state);
    }
  }

  /** Speil av Game1Controller.onGameEnded sin ENDED-gren. */
  onGameEnded(state: MiniState): void {
    if (this.phase === "PLAYING") {
      this.transitionTo("ENDED", state);
      this.endScreenTimer = setTimeout(() => {
        this.endScreenTimer = null;
        if (this.phase === "ENDED") {
          this.transitionTo("WAITING", state);
        }
      }, 5000);
    } else {
      this.transitionTo("WAITING", state);
    }
  }

  /** Speil av Game1Controller.onStateChanged sin defensive recovery (2B). */
  onStateChanged(state: MiniState): void {
    if (this.phase === "ENDED" && state.gameStatus === "RUNNING") {
      if (this.endScreenTimer) {
        clearTimeout(this.endScreenTimer);
        this.endScreenTimer = null;
      }
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
    }
  }
}

describe("Spill 1 round-transition (live-sync uten refresh)", () => {
  it("2A: onGameStarted canceller endScreenTimer", () => {
    const h = new Harness();
    // Simuler runde-slutt → 5s endScreenTimer satt
    h.onGameEnded({ gameStatus: "ENDED", myTickets: [] });
    expect(h.phase).toBe("ENDED");
    expect(h.endScreenTimer).not.toBeNull();

    // Server fyrer gameStarted FØR 5s er ute
    h.onGameStarted({ gameStatus: "RUNNING", myTickets: [{ id: "t1" }] });

    // Timer ryddet og ny phase satt
    expect(h.endScreenTimer).toBeNull();
    expect(h.phase).toBe("PLAYING");
    expect(h.transitionTo).toHaveBeenLastCalledWith(
      "PLAYING",
      expect.objectContaining({ gameStatus: "RUNNING" }),
    );
  });

  it("2A: onGameStarted går til SPECTATING når spiller ikke har tickets", () => {
    const h = new Harness();
    h.onGameEnded({ gameStatus: "ENDED", myTickets: [] });
    expect(h.endScreenTimer).not.toBeNull();

    h.onGameStarted({ gameStatus: "RUNNING", myTickets: [] });

    expect(h.endScreenTimer).toBeNull();
    expect(h.phase).toBe("SPECTATING");
  });

  it("2B: onStateChanged force-transition fra ENDED til PLAYING ved RUNNING-state", () => {
    const h = new Harness();
    // Sett opp ENDED-fase med aktiv timer
    h.onGameEnded({ gameStatus: "ENDED", myTickets: [{ id: "t1" }] });
    expect(h.phase).toBe("ENDED");
    expect(h.endScreenTimer).not.toBeNull();

    // gameStarted-event ble droppet — vi får kun en stateChanged-tick
    // med RUNNING + tickets. Defensiv recovery skal hoppe direkte.
    h.onStateChanged({ gameStatus: "RUNNING", myTickets: [{ id: "t1" }] });

    expect(h.endScreenTimer).toBeNull();
    expect(h.phase).toBe("PLAYING");
  });

  it("2B: onStateChanged force-transition fra ENDED til SPECTATING uten tickets", () => {
    const h = new Harness();
    h.onGameEnded({ gameStatus: "ENDED", myTickets: [] });
    // Manuelt force-set ENDED siden onGameEnded(WAITING-grenen) ikke setter ENDED
    h.phase = "ENDED";
    h.endScreenTimer = setTimeout(() => {}, 5000);

    h.onStateChanged({ gameStatus: "RUNNING", myTickets: [] });

    expect(h.endScreenTimer).toBeNull();
    expect(h.phase).toBe("SPECTATING");
  });

  it("2B: onStateChanged er no-op når phase ikke er ENDED", () => {
    const h = new Harness();
    h.phase = "PLAYING";
    h.onStateChanged({ gameStatus: "RUNNING", myTickets: [{ id: "t1" }] });
    // transitionTo skal IKKE være kalt fra recovery-grenen
    expect(h.transitionTo).not.toHaveBeenCalled();
  });

  it("2B: onStateChanged er no-op når gameStatus ikke er RUNNING", () => {
    const h = new Harness();
    h.phase = "ENDED";
    h.onStateChanged({ gameStatus: "WAITING", myTickets: [{ id: "t1" }] });
    expect(h.transitionTo).not.toHaveBeenCalled();
  });
});
