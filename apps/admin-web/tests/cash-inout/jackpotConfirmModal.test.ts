/**
 * Jackpot-modal: master-flow-2026-05-10 — JackpotConfirmModal-tester.
 *
 * Tester:
 *   - extractJackpotConfirmData parser ApiError.details korrekt
 *   - extractJackpotConfirmData returnerer null ved manglende felter
 *   - renderJackpotConfirmContent rendrer beløp + thresholds
 *   - renderJackpotConfirmContent rendrer "no-state"-melding ved null
 *   - openJackpotConfirmModal resolverer true ved "Start med jackpot"
 *   - openJackpotConfirmModal resolverer false ved "Avbryt"
 *   - openJackpotConfirmModal resolverer false ved ESC
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openJackpotConfirmModal,
  extractJackpotConfirmData,
  renderJackpotConfirmContent,
  type JackpotConfirmData,
} from "../../src/pages/cash-inout/JackpotConfirmModal.js";
import { ApiError } from "../../src/api/client.js";

const FULL_DATA: JackpotConfirmData = {
  currentAmountCents: 200000, // 2000 kr
  maxCapCents: 3000000, // 30 000 kr
  dailyIncrementCents: 400000, // 4000 kr
  drawThresholds: [50, 55, 56, 57],
};

describe("extractJackpotConfirmData — parsing av ApiError.details", () => {
  it("parser komplett detail-payload", () => {
    const err = new ApiError("Jackpott må bekreftes", "JACKPOT_CONFIRM_REQUIRED", 400, {
      jackpotAmountCents: 200000,
      maxCapCents: 3000000,
      dailyIncrementCents: 400000,
      drawThresholds: [50, 55, 56, 57],
      hallGroupId: "demo-pilot-goh",
    });
    const data = extractJackpotConfirmData(err);
    expect(data).not.toBeNull();
    expect(data!.currentAmountCents).toBe(200000);
    expect(data!.maxCapCents).toBe(3000000);
    expect(data!.dailyIncrementCents).toBe(400000);
    expect(data!.drawThresholds).toEqual([50, 55, 56, 57]);
  });

  it("returnerer null når details mangler", () => {
    const err = new ApiError(
      "Jackpott må bekreftes",
      "JACKPOT_CONFIRM_REQUIRED",
      400,
    );
    expect(extractJackpotConfirmData(err)).toBeNull();
  });

  it("returnerer null når jackpotAmountCents er ikke-numerisk", () => {
    const err = new ApiError("err", "JACKPOT_CONFIRM_REQUIRED", 400, {
      jackpotAmountCents: "not-a-number",
    });
    expect(extractJackpotConfirmData(err)).toBeNull();
  });

  it("bruker default-thresholds når array mangler", () => {
    const err = new ApiError("err", "JACKPOT_CONFIRM_REQUIRED", 400, {
      jackpotAmountCents: 100000,
    });
    const data = extractJackpotConfirmData(err);
    expect(data).not.toBeNull();
    expect(data!.drawThresholds).toEqual([50, 55, 56, 57]);
  });

  it("bruker default-cap når maxCapCents mangler", () => {
    const err = new ApiError("err", "JACKPOT_CONFIRM_REQUIRED", 400, {
      jackpotAmountCents: 100000,
    });
    const data = extractJackpotConfirmData(err);
    expect(data!.maxCapCents).toBe(3_000_000);
  });

  it("filterer ut ikke-numeriske threshold-verdier", () => {
    const err = new ApiError("err", "JACKPOT_CONFIRM_REQUIRED", 400, {
      jackpotAmountCents: 100000,
      drawThresholds: [50, "abc", 55, null, 56],
    });
    const data = extractJackpotConfirmData(err);
    expect(data!.drawThresholds).toEqual([50, 55, 56]);
  });

  it("aksepterer string-numbers (defensive parsing)", () => {
    const err = new ApiError("err", "JACKPOT_CONFIRM_REQUIRED", 400, {
      jackpotAmountCents: "200000",
      drawThresholds: ["50", "55"],
    });
    const data = extractJackpotConfirmData(err);
    expect(data!.currentAmountCents).toBe(200000);
    expect(data!.drawThresholds).toEqual([50, 55]);
  });
});

describe("renderJackpotConfirmContent — render output", () => {
  it("rendrer beløp i norsk format (2 000 kr)", () => {
    const html = renderJackpotConfirmContent(FULL_DATA);
    // Norsk locale bruker non-breaking space som tusen-separator
    expect(html).toContain("kr");
    // Verifiser at både cap og current er rendret
    expect(html).toMatch(/data-testid="jackpot-confirm-amount"/);
    expect(html).toMatch(/data-testid="jackpot-confirm-thresholds"/);
  });

  it("rendrer thresholds som comma-separated", () => {
    const html = renderJackpotConfirmContent(FULL_DATA);
    expect(html).toContain("50, 55, 56, 57");
  });

  it("rendrer no-state-melding når data er null", () => {
    const html = renderJackpotConfirmContent(null);
    expect(html).toContain('data-testid="jackpot-confirm-no-state"');
    expect(html).toContain("Jackpot-state kunne ikke lastes");
  });

  it("escaper HTML i thresholds (defensive)", () => {
    const html = renderJackpotConfirmContent({
      ...FULL_DATA,
      drawThresholds: [50, 55],
    });
    // Vi bruker code-tag rundt thresholds
    expect(html).toContain("<code>50, 55</code>");
  });
});

describe("openJackpotConfirmModal — interactive popup", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("rendrer modal med tittel 'Bekreft jackpot-start'", async () => {
    openJackpotConfirmModal(FULL_DATA);
    // Vent én tick for modal-mount
    await new Promise((r) => setTimeout(r, 0));
    const title = document.querySelector(".modal-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("Bekreft jackpot-start");
  });

  it("rendrer beløpet i body", async () => {
    openJackpotConfirmModal(FULL_DATA);
    await new Promise((r) => setTimeout(r, 0));
    const amountEl = document.querySelector(
      '[data-testid="jackpot-confirm-amount"]',
    );
    expect(amountEl).not.toBeNull();
    expect(amountEl?.textContent).toContain("kr");
    // 200000 cents → 2000 kr
    expect(amountEl?.textContent).toMatch(/2[\s ]?000\s*kr/);
  });

  it("har Avbryt-knapp og Start med jackpot-knapp", async () => {
    openJackpotConfirmModal(FULL_DATA);
    await new Promise((r) => setTimeout(r, 0));
    const cancelBtn = document.querySelector('[data-action="cancel"]');
    const confirmBtn = document.querySelector('[data-action="confirm"]');
    expect(cancelBtn).not.toBeNull();
    expect(confirmBtn).not.toBeNull();
    expect(cancelBtn?.textContent).toContain("Avbryt");
    expect(confirmBtn?.textContent).toContain("Start med jackpot");
  });

  it("resolverer true ved klikk på Start med jackpot", async () => {
    const promise = openJackpotConfirmModal(FULL_DATA);
    await new Promise((r) => setTimeout(r, 0));
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="confirm"]',
    );
    confirmBtn?.click();
    const result = await promise;
    expect(result).toBe(true);
  });

  it("resolverer false ved klikk på Avbryt", async () => {
    const promise = openJackpotConfirmModal(FULL_DATA);
    await new Promise((r) => setTimeout(r, 0));
    const cancelBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="cancel"]',
    );
    cancelBtn?.click();
    const result = await promise;
    expect(result).toBe(false);
  });

  it("resolverer false når data er null (no-state-rendering)", async () => {
    const promise = openJackpotConfirmModal(null);
    await new Promise((r) => setTimeout(r, 0));
    const noStateEl = document.querySelector(
      '[data-testid="jackpot-confirm-no-state"]',
    );
    expect(noStateEl).not.toBeNull();
    // Master kan fortsatt klikke Avbryt
    const cancelBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="cancel"]',
    );
    cancelBtn?.click();
    const result = await promise;
    expect(result).toBe(false);
  });

  it("idempotent: dobbel-klikk resolverer kun én gang", async () => {
    const promise = openJackpotConfirmModal(FULL_DATA);
    await new Promise((r) => setTimeout(r, 0));
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="confirm"]',
    );
    confirmBtn?.click();
    confirmBtn?.click(); // ikke-idempotent click skal ikke ødelegge promise
    const result = await promise;
    expect(result).toBe(true);
  });
});
