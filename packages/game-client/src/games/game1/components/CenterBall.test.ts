/**
 * @vitest-environment happy-dom
 *
 * CenterBall tests (BIN-420 G23 — scheduler pause-bug).
 *
 * Unity-refs:
 *   - `Game1GamePlayPanel.SocketFlow.cs:672-696` — scheduler is server-authoritative.
 *     When the room is paused, the scheduler emits a frozen `millisUntilNextStart`
 *     and no decrement happens until resume. The client mirrors this by NOT
 *     ticking down the displayed countdown while `state.isPaused === true`.
 *
 * We assert that:
 *   1. While `isPaused === true`, the displayed number does not change.
 *   2. While not paused, the countdown ticks down normally.
 *   3. Toggling pause → resume resumes ticking.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import gsap from "gsap";
import { CenterBall } from "./CenterBall.js";

function getDisplayedText(ball: CenterBall): string {
  // The last child is the numberText Text (Sprite child is added after async
  // load, so in happy-dom we only ever have [numberText]).
  // Access via private — safe for test.
  // @ts-expect-error — private field access for assertion only.
  return ball.numberText.text as string;
}

describe("CenterBall.startCountdown — pause-hook (Unity scheduler 672-696)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks down when not paused", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.startCountdown(5_000);
    // Initial display is 5 (ceil).
    expect(getDisplayedText(ball)).toBe("5");

    vi.advanceTimersByTime(1_100);
    // Should have ticked down by ~1 s.
    const after1s = Number(getDisplayedText(ball));
    expect(after1s).toBeLessThanOrEqual(4);
    expect(after1s).toBeGreaterThanOrEqual(3);

    ball.stopCountdown();
    ball.destroy();
  });

  it("does NOT tick down while bridge.isPaused === true", () => {
    const bridgeState = { isPaused: true };
    const ball = new CenterBall({ getState: () => bridgeState });
    ball.startCountdown(5_000);
    const initial = getDisplayedText(ball);

    // Advance 3 seconds of "wall clock" — but paused, so display must hold.
    vi.advanceTimersByTime(3_000);
    expect(getDisplayedText(ball)).toBe(initial);

    ball.stopCountdown();
    ball.destroy();
  });

  it("resumes ticking after pause → resume", () => {
    const bridgeState = { isPaused: true };
    const ball = new CenterBall({ getState: () => bridgeState });
    ball.startCountdown(10_000);
    const initial = getDisplayedText(ball);

    // Paused 4s — no change.
    vi.advanceTimersByTime(4_000);
    expect(getDisplayedText(ball)).toBe(initial);

    // Un-pause — ticking resumes.
    bridgeState.isPaused = false;
    vi.advanceTimersByTime(2_100);
    const afterResume = Number(getDisplayedText(ball));
    expect(afterResume).toBeLessThan(Number(initial));

    ball.stopCountdown();
    ball.destroy();
  });

  it("stopCountdown clears the interval", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.startCountdown(5_000);
    ball.stopCountdown();
    // After stopCountdown, advancing timers does not throw and text stays
    // stable (interval was cleared).
    const snapshot = getDisplayedText(ball);
    vi.advanceTimersByTime(5_000);
    expect(getDisplayedText(ball)).toBe(snapshot);
    ball.destroy();
  });
});

describe("CenterBall idle-tween-kontrakt (round 4 Pixi blink-fiks)", () => {
  // Tidligere kjørte CenterBall en infinite yoyo-tween på `.y` (4px opp/ned,
  // `repeat: -1, yoyo: true`) fra første swapTexture og for hver state-
  // overgang. Det ga per-frame Pixi-redraw på containeren konstant — selv
  // når spillet ikke skjedde noe. Nå: idle = statisk. Bob kjøres kun som
  // én-shot etter showNumber (4px yoyo, repeat: 1 → ~2.4s totalt).
  //
  // Vi bruker vitest' fake timers IKKE her — gsap har egen Ticker som
  // leser performance.now(). Testen asserter at etter mount + state-
  // overganger (ikke showNumber), er ingen gsap-tween aktiv på CenterBall.

  it("nymountet CenterBall har ingen aktiv tween på y etter initial load", async () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    // Vent én microtask så swapTexture-promise settles i happy-dom.
    await Promise.resolve();
    await Promise.resolve();
    const tweens = gsap.getTweensOf(ball);
    const active = tweens.filter((t) => t.isActive());
    expect(active).toHaveLength(0);
    ball.destroy();
  });

  it("setBaseY uten forutgående showNumber starter IKKE en tween", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.setBaseY(100);
    const active = gsap.getTweensOf(ball).filter((t) => t.isActive());
    expect(active).toHaveLength(0);
    ball.destroy();
  });

  it("showWaiting starter IKKE en tween (idle må være statisk)", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.setBaseY(100);
    ball.showWaiting();
    const active = gsap.getTweensOf(ball).filter((t) => t.isActive());
    expect(active).toHaveLength(0);
    ball.destroy();
  });

  it("setNumber (state-restore) starter IKKE en tween", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.setBaseY(100);
    ball.setNumber(42);
    const active = gsap.getTweensOf(ball).filter((t) => t.isActive());
    expect(active).toHaveLength(0);
    ball.destroy();
  });

  it("startCountdown starter IKKE en tween på y (bare interval-tikking)", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.setBaseY(100);
    ball.startCountdown(5_000);
    const active = gsap.getTweensOf(ball).filter((t) => t.isActive());
    expect(active).toHaveLength(0);
    ball.stopCountdown();
    ball.destroy();
  });

  it("showNumber trigger bob-tween, men den dør naturlig (repeat: 1, ikke -1)", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.setBaseY(100);
    ball.showNumber(7);
    // Tween(s) skal være aktive umiddelbart etter showNumber (scale + alpha +
    // senere bob). Ingen av dem har `repeat: -1` → de avslutter seg selv.
    const all = gsap.getTweensOf(ball).concat(gsap.getTweensOf(ball.scale));
    for (const t of all) {
      // vars.repeat er GSAP's kanoniske felt for repeat-count. -1 = infinite.
      expect(t.vars.repeat === -1).toBe(false);
    }
    ball.destroy();
  });
});

describe("CenterBall idle-text-modus (2026-05-11, Tobias-direktiv)", () => {
  // Idle-text-modus erstatter `WaitingForMasterOverlay`. Når runden ikke
  // er aktiv viser CenterBall to linjer:
  //   Linje 1: "Neste spill: {displayName}"
  //   Linje 2: "Kjøp bonger for å være med i trekningen"
  // og skjuler ball-sprite + number-text. Mutating-handlinger
  // (showNumber/setNumber/startCountdown) skjuler idle-text automatisk.

  function readIdleHeadline(ball: CenterBall): string {
    // @ts-expect-error — privat felt-access for assert.
    return ball.idleHeadline.text as string;
  }
  function readIdleBody(ball: CenterBall): string {
    // @ts-expect-error — privat felt-access for assert.
    return ball.idleBody.text as string;
  }
  function isIdleHeadlineVisible(ball: CenterBall): boolean {
    // @ts-expect-error — privat felt-access for assert.
    return ball.idleHeadline.visible as boolean;
  }
  function isNumberTextVisible(ball: CenterBall): boolean {
    // @ts-expect-error — privat felt-access for assert.
    return ball.numberText.visible as boolean;
  }

  it("setIdleText + showIdleText rendrer 'Neste spill: Bingo' + 'Kjøp bonger ...'", () => {
    const ball = new CenterBall();
    ball.setIdleText("Bingo");
    ball.showIdleText();

    expect(ball.isIdleTextVisible()).toBe(true);
    expect(readIdleHeadline(ball)).toBe("Neste spill: Bingo");
    expect(readIdleBody(ball)).toBe("Kjøp bonger for å være med i trekningen");
    expect(isIdleHeadlineVisible(ball)).toBe(true);
    expect(isNumberTextVisible(ball)).toBe(false);

    ball.destroy();
  });

  it("setIdleText(null) faller tilbake til 'Bingo' (Tobias-default)", () => {
    const ball = new CenterBall();
    ball.setIdleText(null);
    ball.showIdleText();
    expect(readIdleHeadline(ball)).toBe("Neste spill: Bingo");
    ball.destroy();
  });

  it("setIdleText('') (tom streng) faller tilbake til 'Bingo'", () => {
    const ball = new CenterBall();
    ball.setIdleText("");
    ball.showIdleText();
    expect(readIdleHeadline(ball)).toBe("Neste spill: Bingo");
    ball.destroy();
  });

  it("setIdleText oppdaterer headline live når idle-mode allerede er synlig", () => {
    const ball = new CenterBall();
    ball.setIdleText("Bingo");
    ball.showIdleText();
    expect(readIdleHeadline(ball)).toBe("Neste spill: Bingo");

    // Master advancer plan-item — display-name oppdateres.
    ball.setIdleText("Innsatsen");
    expect(readIdleHeadline(ball)).toBe("Neste spill: Innsatsen");

    ball.destroy();
  });

  it("showIdleText er idempotent (gjentatte kall er no-op)", () => {
    const ball = new CenterBall();
    ball.setIdleText("Bingo");
    ball.showIdleText();
    ball.showIdleText();
    ball.showIdleText();
    expect(ball.isIdleTextVisible()).toBe(true);
    ball.destroy();
  });

  // ── Hall-isolation fix (Tobias 2026-05-11): setIdleMode("closed") ────
  // Default-hall som ikke er medlem av en GoH med aktiv plan skal IKKE vise
  // "Neste spill: Bingo" — den skal vise "Stengt / Ingen aktiv plan".

  it("setIdleMode default er 'next-game' (legacy-modus)", () => {
    const ball = new CenterBall();
    expect(ball.getIdleMode()).toBe("next-game");
    ball.destroy();
  });

  it("setIdleMode('closed') + showIdleText rendrer 'Stengt' + 'Ingen aktiv plan ...'", () => {
    const ball = new CenterBall();
    ball.setIdleMode("closed");
    ball.showIdleText();

    expect(ball.isIdleTextVisible()).toBe(true);
    expect(ball.getIdleMode()).toBe("closed");
    expect(readIdleHeadline(ball)).toBe("Stengt");
    expect(readIdleBody(ball)).toBe("Ingen aktiv plan i hallen akkurat nå");

    ball.destroy();
  });

  it("setIdleMode('closed') ignorerer setIdleText-displayName (Bingo skjules)", () => {
    const ball = new CenterBall();
    ball.setIdleText("Innsatsen");
    ball.setIdleMode("closed");
    ball.showIdleText();

    // Selv om displayName er satt til "Innsatsen", skal closed-mode
    // overstyre med "Stengt"-tekst.
    expect(readIdleHeadline(ball)).toBe("Stengt");
    expect(readIdleHeadline(ball)).not.toContain("Innsatsen");

    ball.destroy();
  });

  it("setIdleMode switching live oppdaterer rendret tekst", () => {
    const ball = new CenterBall();
    ball.setIdleText("Bingo");
    ball.showIdleText();
    expect(readIdleHeadline(ball)).toBe("Neste spill: Bingo");

    // Hall-state endres til closed (eks. plan utløpte midt i kveld).
    ball.setIdleMode("closed");
    expect(readIdleHeadline(ball)).toBe("Stengt");

    // Hall-state åpnes igjen.
    ball.setIdleMode("next-game");
    expect(readIdleHeadline(ball)).toBe("Neste spill: Bingo");

    ball.destroy();
  });

  it("setIdleMode er idempotent — gjentatte kall med samme mode er no-op", () => {
    const ball = new CenterBall();
    ball.setIdleMode("closed");
    ball.setIdleMode("closed");
    ball.setIdleMode("closed");
    expect(ball.getIdleMode()).toBe("closed");
    ball.destroy();
  });

  it("hideIdleText restore ball-sprite + number-text-visibilitet", () => {
    const ball = new CenterBall();
    ball.setIdleText("Bingo");
    ball.showIdleText();
    expect(isNumberTextVisible(ball)).toBe(false);

    ball.hideIdleText();
    expect(ball.isIdleTextVisible()).toBe(false);
    expect(isIdleHeadlineVisible(ball)).toBe(false);
    expect(isNumberTextVisible(ball)).toBe(true);

    ball.destroy();
  });

  it("hideIdleText er idempotent", () => {
    const ball = new CenterBall();
    ball.hideIdleText();
    ball.hideIdleText();
    expect(ball.isIdleTextVisible()).toBe(false);
    ball.destroy();
  });

  it("showNumber auto-skjuler idle-text", () => {
    const ball = new CenterBall();
    ball.setIdleText("Bingo");
    ball.showIdleText();
    expect(ball.isIdleTextVisible()).toBe(true);

    ball.showNumber(42);
    expect(ball.isIdleTextVisible()).toBe(false);
    expect(isNumberTextVisible(ball)).toBe(true);
    ball.destroy();
  });

  it("setNumber auto-skjuler idle-text", () => {
    const ball = new CenterBall();
    ball.setIdleText("Bingo");
    ball.showIdleText();

    ball.setNumber(7);
    expect(ball.isIdleTextVisible()).toBe(false);
    ball.destroy();
  });

  it("startCountdown auto-skjuler idle-text", () => {
    const ball = new CenterBall({ getState: () => ({ isPaused: false }) });
    ball.setIdleText("Bingo");
    ball.showIdleText();

    ball.startCountdown(5_000);
    expect(ball.isIdleTextVisible()).toBe(false);
    ball.stopCountdown();
    ball.destroy();
  });

  it("showWaiting i idle-mode bevarer idle-state (ingen flicker til '...')", () => {
    const ball = new CenterBall();
    ball.setIdleText("Innsatsen");
    ball.showIdleText();

    ball.showWaiting();
    // Idle-mode må fortsatt være synlig, ikke fallback til "..."
    expect(ball.isIdleTextVisible()).toBe(true);
    expect(readIdleHeadline(ball)).toBe("Neste spill: Innsatsen");

    ball.destroy();
  });

  it("showWaiting uten aktiv idle-mode setter '...' som før (legacy-fallback)", () => {
    const ball = new CenterBall();
    ball.showWaiting();
    expect(ball.isIdleTextVisible()).toBe(false);
    // @ts-expect-error — privat felt-access.
    expect(ball.numberText.text as string).toBe("...");
    ball.destroy();
  });
});
