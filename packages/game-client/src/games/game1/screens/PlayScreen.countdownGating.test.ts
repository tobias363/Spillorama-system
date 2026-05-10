/**
 * @vitest-environment happy-dom
 *
 * Spillerklient-rebuild Fase 3 (2026-05-10) — countdown-gating-tester.
 *
 * Bakgrunn (Tobias-direktiv 2026-05-09 / PM_ONBOARDING_PLAYBOOK §2.3):
 *   "Det skal aldri være noen andre views i det live rommet en neste
 *    planlagte spill."
 *
 *   Pre-fix: PlayScreen.update() startet centerBall.startCountdown()
 *   så snart `state.millisUntilNextStart > 0`. Det betød at klient kunne
 *   vise en lokal countdown UTEN at master hadde trygget runden — direkte
 *   i strid med direktivet.
 *
 *   Fase 3-fix: PlayScreen.update() gater countdown-init på
 *   `lobbyOverallStatus === "running"`. Denne testen mirror-er
 *   gating-logikken i en pure-funksjon-form (uten Pixi-instansiering)
 *   slik at vi kan verifisere kontrakten i happy-dom.
 *
 * Testene følger samme pattern som `Game1Controller.endOfRoundFlow.test.ts`:
 * vi mirror-er logikken i en harness og sjekker at riktig metode kalles
 * basert på input-state.
 */
import { describe, it, expect } from "vitest";
import type { Spill1LobbyOverallStatus } from "@spillorama/shared-types/api";

type CountdownDecision = "live-ball" | "countdown" | "waiting";

interface CountdownInputs {
  gameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED";
  millisUntilNextStart: number | null;
  lobbyOverallStatus: Spill1LobbyOverallStatus | null;
}

/**
 * Pure-function mirror av countdown-gating-logikken i
 * `PlayScreen.update()`. Hvis production-koden drifter, oppdater også
 * denne — kontrakten er Tobias-direktivet om "ingen lokal countdown
 * før master har trygget".
 */
function decideCountdownState(inputs: CountdownInputs): CountdownDecision {
  const lobbyRunning = inputs.lobbyOverallStatus === "running";
  if (inputs.gameStatus === "RUNNING") {
    return "live-ball";
  } else if (
    lobbyRunning &&
    inputs.millisUntilNextStart !== null &&
    inputs.millisUntilNextStart > 0
  ) {
    return "countdown";
  } else {
    return "waiting";
  }
}

describe("PlayScreen countdown gating (Fase 3)", () => {
  // ── Pre-fix bug: countdown startet uten lobby-running ─────────────────
  it("FIX: lobby=null + millisUntilNextStart>0 → waiting (IKKE countdown)", () => {
    const decision = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 5000,
      lobbyOverallStatus: null,
    });
    expect(decision).toBe("waiting");
  });

  it("FIX: lobby=purchase_open + millisUntilNextStart>0 → waiting", () => {
    const decision = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 5000,
      lobbyOverallStatus: "purchase_open",
    });
    expect(decision).toBe("waiting");
  });

  it("FIX: lobby=ready_to_start + millisUntilNextStart>0 → waiting", () => {
    const decision = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 3000,
      lobbyOverallStatus: "ready_to_start",
    });
    expect(decision).toBe("waiting");
  });

  it("FIX: lobby=idle + millisUntilNextStart>0 → waiting", () => {
    const decision = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 10000,
      lobbyOverallStatus: "idle",
    });
    expect(decision).toBe("waiting");
  });

  // ── Master har trygget: countdown kan kjøre ─────────────────────────
  it("lobby=running + millisUntilNextStart>0 + WAITING → countdown OK", () => {
    const decision = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 5000,
      lobbyOverallStatus: "running",
    });
    expect(decision).toBe("countdown");
  });

  it("lobby=running + millisUntilNextStart=0 → waiting (ikke negative countdown)", () => {
    const decision = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 0,
      lobbyOverallStatus: "running",
    });
    expect(decision).toBe("waiting");
  });

  // ── Live ball overrider alt ─────────────────────────────────────────
  it("gameStatus=RUNNING → live-ball (uavhengig av lobby-status)", () => {
    const decisions = (["running", "purchase_open", "idle", null] as const).map(
      (lobbyStatus) =>
        decideCountdownState({
          gameStatus: "RUNNING",
          millisUntilNextStart: 5000,
          lobbyOverallStatus: lobbyStatus,
        }),
    );
    expect(decisions).toEqual([
      "live-ball",
      "live-ball",
      "live-ball",
      "live-ball",
    ]);
  });

  // ── Paused / closed / finished ──────────────────────────────────────
  it("lobby=paused → waiting (ingen countdown selv med millisUntilNextStart)", () => {
    const decision = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 5000,
      lobbyOverallStatus: "paused",
    });
    expect(decision).toBe("waiting");
  });

  it("lobby=closed → waiting", () => {
    const decision = decideCountdownState({
      gameStatus: "NONE",
      millisUntilNextStart: 5000,
      lobbyOverallStatus: "closed",
    });
    expect(decision).toBe("waiting");
  });

  it("lobby=finished → waiting", () => {
    const decision = decideCountdownState({
      gameStatus: "ENDED",
      millisUntilNextStart: null,
      lobbyOverallStatus: "finished",
    });
    expect(decision).toBe("waiting");
  });

  // ── Master clicks Start (timing-test) ────────────────────────────────
  it("master starter: status purchase_open → running → countdown begynner", () => {
    // Pre-master-trigger
    const before = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: null,
      lobbyOverallStatus: "purchase_open",
    });
    expect(before).toBe("waiting");

    // Master clicks Start, server pusher state-update med ny millisUntilNextStart
    const after = decideCountdownState({
      gameStatus: "WAITING",
      millisUntilNextStart: 2000,
      lobbyOverallStatus: "running",
    });
    expect(after).toBe("countdown");
  });

  // ── ENDED → waiting (ikke gammel countdown) ───────────────────────────
  it("gameStatus=ENDED + lobby=running → waiting (runde slutt)", () => {
    const decision = decideCountdownState({
      gameStatus: "ENDED",
      millisUntilNextStart: null,
      lobbyOverallStatus: "running",
    });
    expect(decision).toBe("waiting");
  });
});
