/**
 * @vitest-environment happy-dom
 *
 * BIN-MYSTERY M6: MysteryGameOverlay tests.
 *
 * Dekning:
 *   - show() rendrer 5 middle-balls + prize-ladder.
 *   - getDigitAt-helper returnerer rightmost-first (legacy 1:1).
 *   - onChoice fyrer med korrekt directions-array etter 5 klikk.
 *   - Joker terminerer tidlig (færre enn 5 directions).
 *   - animateResult viser final prize/joker/0-kr korrekt.
 *   - Auto-turn timer fyrer og velger default "down".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MysteryGameOverlay,
  __Mystery_AUTO_DISMISS_AFTER_RESULT_SECONDS__,
  __Mystery_getDigitAt,
} from "./MysteryGameOverlay.js";

describe("MysteryGameOverlay — getDigitAt helper", () => {
  it("index 0 er ones-siffer (rightmost)", () => {
    expect(__Mystery_getDigitAt(12345, 0)).toBe(5);
    expect(__Mystery_getDigitAt(12345, 4)).toBe(1);
  });
  it("padder < 5-sifrede tall med leading zeros", () => {
    expect(__Mystery_getDigitAt(42, 0)).toBe(2);
    expect(__Mystery_getDigitAt(42, 4)).toBe(0);
  });
});

describe("MysteryGameOverlay — trigger rendering", () => {
  it("rendrer 5 middle-balls og 6 prize-ladder-steps", () => {
    const overlay = new MysteryGameOverlay(800, 600);
    overlay.show({
      middleNumber: 12345,
      resultNumber: 67890,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
      autoTurnFirstMoveSec: 20,
      autoTurnOtherMoveSec: 10,
    });
    // @ts-expect-error — private.
    expect(overlay.middleBalls.length).toBe(5);
    // @ts-expect-error — private.
    expect(overlay.prizeLadderSteps.length).toBe(6);
    overlay.destroy();
  });

  it("faller tilbake til defaults når felter mangler", () => {
    const overlay = new MysteryGameOverlay(800, 600);
    overlay.show({});
    // @ts-expect-error — private.
    expect(overlay.middleBalls.length).toBe(5);
    // @ts-expect-error — private.
    expect(overlay.maxRounds).toBe(5);
    // @ts-expect-error — private.
    expect(overlay.prizeListNok).toEqual([50, 100, 200, 400, 800, 1500]);
    overlay.destroy();
  });
});

describe("MysteryGameOverlay — auto-turn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-timeout velger default 'down' etter autoTurnFirstMoveSec", () => {
    const overlay = new MysteryGameOverlay(800, 600);
    overlay.show({
      middleNumber: 50000,
      resultNumber: 90000,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
      autoTurnFirstMoveSec: 3,
      autoTurnOtherMoveSec: 2,
    });
    // Step through 3 seconds of timer.
    vi.advanceTimersByTime(3100);
    // @ts-expect-error — private.
    const dirs = overlay.collectedDirections;
    expect(dirs.length).toBeGreaterThanOrEqual(1);
    expect(dirs[0]).toBe("down");
    overlay.destroy();
  });
});

describe("MysteryGameOverlay — onChoice dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("joker-treff på runde 0 terminerer tidlig (1 direction sendt)", async () => {
    const overlay = new MysteryGameOverlay(800, 600);
    const onChoice = vi.fn();
    overlay.setOnChoice(onChoice);
    // middleNumber og resultNumber har samme ones-siffer (5) → joker på runde 0.
    overlay.show({
      middleNumber: 12345,
      resultNumber: 67895,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
      autoTurnFirstMoveSec: 20,
      autoTurnOtherMoveSec: 10,
    });
    // Trykk UP på runde 0 (joker fyrer uansett retning).
    // @ts-expect-error — private.
    overlay.selectDirection("up");
    // Advanse past the 800ms delay before onChoice fires.
    vi.advanceTimersByTime(1000);
    expect(onChoice).toHaveBeenCalledTimes(1);
    const payload = onChoice.mock.calls[0]![0];
    expect(payload).toHaveProperty("directions");
    expect((payload as { directions: unknown[] }).directions.length).toBe(1);
    overlay.destroy();
  });

  it("5 runder uten joker → sender 5 directions", async () => {
    const overlay = new MysteryGameOverlay(800, 600);
    const onChoice = vi.fn();
    overlay.setOnChoice(onChoice);
    // middleNumber = 12345, resultNumber = 67890 — ingen equal digits.
    // Digit 0: 5 vs 0 → result < middle → DOWN correct.
    // Digit 1: 4 vs 9 → result > middle → UP correct.
    // Digit 2: 3 vs 8 → result > middle → UP correct.
    // Digit 3: 2 vs 7 → result > middle → UP correct.
    // Digit 4: 1 vs 6 → result > middle → UP correct.
    overlay.show({
      middleNumber: 12345,
      resultNumber: 67890,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
      autoTurnFirstMoveSec: 20,
      autoTurnOtherMoveSec: 10,
    });

    // Rund 0: DOWN
    // @ts-expect-error — private.
    overlay.selectDirection("down");
    vi.advanceTimersByTime(700);
    // Rund 1: UP
    // @ts-expect-error — private.
    overlay.selectDirection("up");
    vi.advanceTimersByTime(700);
    // Rund 2: UP
    // @ts-expect-error — private.
    overlay.selectDirection("up");
    vi.advanceTimersByTime(700);
    // Rund 3: UP
    // @ts-expect-error — private.
    overlay.selectDirection("up");
    vi.advanceTimersByTime(700);
    // Rund 4: UP (final)
    // @ts-expect-error — private.
    overlay.selectDirection("up");
    vi.advanceTimersByTime(1000);

    expect(onChoice).toHaveBeenCalledTimes(1);
    const payload = onChoice.mock.calls[0]![0];
    expect((payload as { directions: string[] }).directions).toEqual([
      "down",
      "up",
      "up",
      "up",
      "up",
    ]);
    overlay.destroy();
  });
});

describe("MysteryGameOverlay — animateResult", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismiss etter resultat-visning", () => {
    const overlay = new MysteryGameOverlay(800, 600);
    const onDismiss = vi.fn();
    overlay.setOnDismiss(onDismiss);
    overlay.show({
      middleNumber: 12345,
      resultNumber: 67890,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
    });
    overlay.animateResult(
      {
        middleNumber: 12345,
        resultNumber: 67890,
        rounds: [],
        finalPriceIndex: 5,
        prizeAmountKroner: 1500,
        jokerTriggered: false,
      },
      1500 * 100,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(
      __Mystery_AUTO_DISMISS_AFTER_RESULT_SECONDS__ * 1000 + 100,
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
    overlay.destroy();
  });

  it("resultatvisning — joker viser 'JOKER'-tekst", () => {
    const overlay = new MysteryGameOverlay(800, 600);
    overlay.show({
      middleNumber: 12345,
      resultNumber: 67895,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
    });
    overlay.animateResult(
      {
        middleNumber: 12345,
        resultNumber: 67895,
        rounds: [],
        finalPriceIndex: 5,
        prizeAmountKroner: 1500,
        jokerTriggered: true,
      },
      150000,
    );
    // @ts-expect-error — private.
    const txt: { text: string; visible: boolean } = overlay.resultText;
    expect(txt.visible).toBe(true);
    expect(txt.text).toContain("JOKER");
    overlay.destroy();
  });

  it("resultatvisning — 0 premie viser 'Ingen premie'", () => {
    const overlay = new MysteryGameOverlay(800, 600);
    overlay.show({
      middleNumber: 12345,
      resultNumber: 67890,
      prizeListNok: [0, 100, 200, 400, 800, 1500],
      maxRounds: 5,
    });
    overlay.animateResult(
      {
        middleNumber: 12345,
        resultNumber: 67890,
        rounds: [],
        finalPriceIndex: 0,
        prizeAmountKroner: 0,
        jokerTriggered: false,
      },
      0,
    );
    // @ts-expect-error — private.
    const txt: { text: string } = overlay.resultText;
    expect(txt.text).toContain("Ingen premie");
    overlay.destroy();
  });
});

describe("MysteryGameOverlay — error handling", () => {
  it("showChoiceError viser feilmelding", () => {
    const overlay = new MysteryGameOverlay(800, 600);
    overlay.show({
      middleNumber: 12345,
      resultNumber: 67890,
      prizeListNok: [50, 100, 200, 400, 800, 1500],
      maxRounds: 5,
    });
    overlay.showChoiceError({ code: "E_TEST", message: "dummy-feil" });
    // @ts-expect-error — private.
    const errTxt: { text: string; visible: boolean } = overlay.errorText;
    expect(errTxt.visible).toBe(true);
    expect(errTxt.text).toContain("dummy-feil");
    overlay.destroy();
  });
});
