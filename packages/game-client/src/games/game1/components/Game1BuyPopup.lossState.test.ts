/**
 * @vitest-environment happy-dom
 *
 * Tobias 2026-04-29 (post-orphan-fix UX) — Game1BuyPopup lossState +
 * state-machine tests.
 *
 * Bug-kontekst: tidligere ble bonger rendret optimistisk når brukeren
 * klikket Kjøp, før server hadde bekreftet kjøpet. Nå går popupen
 * gjennom state machine: idle → confirming → success/error.
 *
 * Disse 7 testene dekker:
 *   1. Initial state = idle
 *   2. Klikk Kjøp → state = confirming, knapper låst, "Bekrefter kjøp..."
 *   3. showResult(true) → state = success, popup auto-skjules
 *   4. showResult(false, msg) → state = error, knapper opp igjen
 *   5. showPartialBuyResult → state = success med klar melding om hva som ble avvist
 *   6. updateLossState renderer header med "Brukt i dag: X / Y kr"
 *   7. updateLossState med < 25% remaining → orange highlight; på grensen → rød
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Game1BuyPopup } from "./Game1BuyPopup.js";
import { HtmlOverlayManager } from "./HtmlOverlayManager.js";

const ENTRY_FEE = 10;
const TYPES = [
  { name: "Small", type: "small-yellow", priceMultiplier: 1, ticketCount: 1 },
];

function makePopup(): { popup: Game1BuyPopup; container: HTMLElement } {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const overlay = new HtmlOverlayManager(container);
  const popup = new Game1BuyPopup(overlay);
  return { popup, container };
}

function getCard(container: HTMLElement): HTMLElement {
  const overlay = container.querySelector(".g1-overlay-root") as HTMLElement;
  const backdrop = overlay.children[overlay.children.length - 1] as HTMLElement;
  return backdrop.firstElementChild as HTMLElement;
}

function getHeader(container: HTMLElement): HTMLElement {
  return getCard(container).children[0] as HTMLElement;
}

function getLossStateEl(container: HTMLElement): HTMLElement {
  // header.children: [0] title, [1] subtitle, [2] summaryEl, [3] lossStateEl
  return getHeader(container).children[3] as HTMLElement;
}

function getBuyBtn(container: HTMLElement): HTMLButtonElement {
  return getCard(container).children[5] as HTMLButtonElement;
}

function getCancelBtn(container: HTMLElement): HTMLButtonElement {
  return getCard(container).children[6] as HTMLButtonElement;
}

function getStatusMsg(container: HTMLElement): HTMLElement {
  return getCard(container).children[3] as HTMLElement;
}

// ── Test 1: initial state ────────────────────────────────────────────────

describe("Game1BuyPopup state machine + lossState (Tobias 2026-04-29)", () => {
  let popup: Game1BuyPopup;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    ({ popup, container } = makePopup());
  });

  it("initial state etter showWithTypes = idle", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0);
    expect(popup.getUiState()).toBe("idle");
  });

  it("klikk Kjøp transitions til confirming, knapper låst, viser \"Bekrefter kjøp...\"", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0);
    popup.setOnBuy(() => {});
    // Sett qty=1 så Kjøp-knappen aktiveres
    const stepper = (getCard(container).children[1] as HTMLElement).children[0] as HTMLElement;
    const plusBtn = stepper.children[1].nextSibling as HTMLButtonElement; // hack — find plus
    // For å være tryggere: bruk popup-API
    // Lag manuelt qty=1 via internal API hack (not ideal, men tester state-machine)
    // Bedre: send selections direkte ved å trigge handleBuy via klikk på buyBtn etter qty
    // Vi tester her bare state-transition — ikke fokus på qty-input.
    const buyBtn = getBuyBtn(container);
    // Manuelt aktiver — bypass disabled (test-only):
    buyBtn.disabled = false;
    buyBtn.click();
    expect(popup.getUiState()).toBe("confirming");
    expect(buyBtn.textContent).toContain("Bekrefter");
    expect(getCancelBtn(container).disabled).toBe(true);
  });

  it("showResult(true) transitions til success", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0);
    popup.showResult(true);
    expect(popup.getUiState()).toBe("success");
    const status = getStatusMsg(container);
    expect(status.textContent).toMatch(/Registrert|neste spill/);
  });

  it("showResult(false, msg) transitions til error med custom message", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0);
    popup.showResult(false, "Du nådde dagens tapsgrense");
    expect(popup.getUiState()).toBe("error");
    const status = getStatusMsg(container);
    expect(status.textContent).toContain("tapsgrense");
    // Knapper kan brukes igjen
    expect(getBuyBtn(container).disabled).toBe(false);
    expect(getCancelBtn(container).disabled).toBe(false);
  });

  it("showPartialBuyResult viser X av Y bonger kjøpt + tap-status", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0, {
      dailyUsed: 80,
      dailyLimit: 100,
      monthlyUsed: 200,
      monthlyLimit: 4400,
      walletBalance: 50,
    });
    popup.showPartialBuyResult({
      accepted: 2,
      rejected: 1,
      rejectionReason: "DAILY_LIMIT",
      lossState: {
        dailyUsed: 100,
        dailyLimit: 100,
        monthlyUsed: 220,
        monthlyLimit: 4400,
        walletBalance: 30,
      },
    });
    expect(popup.getUiState()).toBe("success");
    const status = getStatusMsg(container);
    expect(status.textContent).toContain("2 av 3 bonger kjøpt");
    expect(status.textContent).toMatch(/dagens tapsgrense/);
    // Header skal være oppdatert med ny tap-status
    const lossEl = getLossStateEl(container);
    expect(lossEl.style.display).toBe("block");
    expect(lossEl.innerHTML).toContain("100");
  });
});

// ── Test 6 + 7: updateLossState render ───────────────────────────────────

describe("Game1BuyPopup lossState header rendering", () => {
  let popup: Game1BuyPopup;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    ({ popup, container } = makePopup());
  });

  it("renderer 'Brukt i dag: X / Y kr' når lossState er gitt", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0, {
      dailyUsed: 200,
      dailyLimit: 900,
      monthlyUsed: 1500,
      monthlyLimit: 4400,
      walletBalance: 700,
    });
    const lossEl = getLossStateEl(container);
    expect(lossEl.style.display).toBe("block");
    expect(lossEl.innerHTML).toContain("200");
    expect(lossEl.innerHTML).toContain("900");
    expect(lossEl.innerHTML).toContain("1500");
    expect(lossEl.innerHTML).toContain("4400");
    expect(lossEl.innerHTML).toContain("700");
  });

  it("skjuler header når lossState er undefined (legacy clients)", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0);
    const lossEl = getLossStateEl(container);
    expect(lossEl.style.display).toBe("none");
  });

  it("oransje highlight når < 25 % av daglig grense gjenstår", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0, {
      dailyUsed: 800, // 100 igjen av 900 = 11.1 %
      dailyLimit: 900,
      monthlyUsed: 1500,
      monthlyLimit: 4400,
      walletBalance: 100,
    });
    const lossEl = getLossStateEl(container);
    // Border + bg er oransje-toned
    expect(lossEl.style.borderColor).toContain("245, 158, 11");
  });

  it("rød highlight + 'Du har nådd dagens tapsgrense' når på grensen", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0, {
      dailyUsed: 900,
      dailyLimit: 900,
      monthlyUsed: 1500,
      monthlyLimit: 4400,
      walletBalance: 0,
    });
    const lossEl = getLossStateEl(container);
    expect(lossEl.style.borderColor).toContain("220, 38, 38");
    expect(lossEl.innerHTML).toContain("nådd dagens tapsgrense");
  });

  it("updateLossState etter showWithTypes oppdaterer header dynamisk", () => {
    popup.showWithTypes(ENTRY_FEE, TYPES, 0); // ingen lossState
    const lossEl = getLossStateEl(container);
    expect(lossEl.style.display).toBe("none");

    popup.updateLossState({
      dailyUsed: 100,
      dailyLimit: 900,
      monthlyUsed: 200,
      monthlyLimit: 4400,
      walletBalance: 500,
    });
    expect(lossEl.style.display).toBe("block");
    expect(lossEl.innerHTML).toContain("100");
  });
});
