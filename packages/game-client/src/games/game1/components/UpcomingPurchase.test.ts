/**
 * @vitest-environment happy-dom
 *
 * UpcomingPurchase (BIN-410 D3) — inline side-panel for preRound arming.
 *
 * Unity-referanser:
 *   - `Game1GamePlayPanel.UpcomingGames.cs:9-19` (hovedmetode)
 *   - `Game1GamePlayPanel.UpcomingGames.cs:26-95` (layout)
 *   - `Game1UpcomingGameTicketData.cs:29-60`      (data-holder)
 *   - Lukk-trigger: `.SocketFlow.cs:127, :192` + D2-trigger i PlayScreen.
 *
 * 30-vektet-cap: `BingoTemplates.cs:86` + `Game1PurchaseTicket.cs:67-93`
 * (samme regel som Game1BuyPopup, gjenbrukt pattern fra PR-3).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UpcomingPurchase } from "./UpcomingPurchase.js";
import { HtmlOverlayManager } from "./HtmlOverlayManager.js";

const ENTRY_FEE = 10;
const TYPES = [
  { name: "Small", type: "small-yellow", priceMultiplier: 1, ticketCount: 1 },
  { name: "Large Elvis", type: "elvis", priceMultiplier: 3, ticketCount: 3 },
];

function ensureResizeObserver(): void {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

function makePanel(
  armSpy: Array<Array<{ type: string; qty: number; name: string }>> = [],
): { panel: UpcomingPurchase; container: HTMLElement; overlay: HtmlOverlayManager; armSpy: Array<Array<{ type: string; qty: number; name: string }>> } {
  ensureResizeObserver();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const overlay = new HtmlOverlayManager(container);
  const panel = new UpcomingPurchase({
    overlay,
    onArm: (selections) => {
      armSpy.push(selections);
    },
  });
  return { panel, container, overlay, armSpy };
}

/** Panelet er det siste child i overlay-root (vår komponent appender direkte til root). */
function getRoot(container: HTMLElement): HTMLDivElement {
  const overlayRoot = container.querySelector(".g1-overlay-root") as HTMLElement;
  // Siste direkte child som har display:none/flex og vår border.
  const children = Array.from(overlayRoot.children) as HTMLElement[];
  return children[children.length - 1] as HTMLDivElement;
}

function getTypeRows(root: HTMLDivElement): HTMLElement[] {
  // Struktur: [header, typesContainer, sep, totalLabel, statusMsg, armBtn]
  const typesContainer = root.children[1] as HTMLElement;
  return Array.from(typesContainer.children) as HTMLElement[];
}

function getPlusBtn(row: HTMLElement): HTMLButtonElement {
  // row: [info, qtyRow]. qtyRow: [minus, qtyLabel, plus]
  const qtyRow = row.lastElementChild as HTMLElement;
  return qtyRow.children[2] as HTMLButtonElement;
}

function getMinusBtn(row: HTMLElement): HTMLButtonElement {
  const qtyRow = row.lastElementChild as HTMLElement;
  return qtyRow.children[0] as HTMLButtonElement;
}

function getQtyLabel(row: HTMLElement): HTMLSpanElement {
  const qtyRow = row.lastElementChild as HTMLElement;
  return qtyRow.children[1] as HTMLSpanElement;
}

function getArmBtn(root: HTMLDivElement): HTMLButtonElement {
  return root.lastElementChild as HTMLButtonElement;
}

function getTotalLabel(root: HTMLDivElement): HTMLElement {
  return root.children[3] as HTMLElement;
}

function getStatusMsg(root: HTMLDivElement): HTMLElement {
  return root.children[4] as HTMLElement;
}

function getHeaderSubtitle(root: HTMLDivElement): HTMLElement {
  const header = root.children[0] as HTMLElement;
  return header.children[1] as HTMLElement;
}

describe("UpcomingPurchase (BIN-410 D3)", () => {
  let panel: UpcomingPurchase;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;
  let armSpy: Array<Array<{ type: string; qty: number; name: string }>>;

  beforeEach(() => {
    document.body.innerHTML = "";
    armSpy = [];
    ({ panel, container, overlay } = makePanel(armSpy));
  });

  it("1. show() renders one row per ticketType", () => {
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 0 });
    const root = getRoot(container);
    expect(root.style.display).toBe("flex");
    const rows = getTypeRows(root);
    expect(rows.length).toBe(2);

    // Each row should have an info block + qtyRow with 3 children
    for (const row of rows) {
      expect(row.children.length).toBe(2); // info + qtyRow
      const qtyRow = row.lastElementChild as HTMLElement;
      expect(qtyRow.children.length).toBe(3); // minus, qtyLabel, plus
    }
  });

  it("2. +/- updates qty label and total price", () => {
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 0 });
    const root = getRoot(container);
    const rows = getTypeRows(root);

    // Add 2× small (price 10), 1× elvis (price 30). Total = 50.
    getPlusBtn(rows[0]).click();
    getPlusBtn(rows[0]).click();
    getPlusBtn(rows[1]).click();

    expect(getQtyLabel(rows[0]).textContent).toBe("2");
    expect(getQtyLabel(rows[1]).textContent).toBe("1");
    expect(getTotalLabel(root).textContent).toBe("Totalt: 50 kr");
    expect(getArmBtn(root).textContent).toBe("Kjøp 50 kr");

    // Minus decrements but won't go below 0.
    getMinusBtn(rows[0]).click();
    expect(getQtyLabel(rows[0]).textContent).toBe("1");
    expect(getTotalLabel(root).textContent).toBe("Totalt: 40 kr");
  });

  it("3. 30-vektet-cap: elvis (3) + 28× small disables elvis plus", () => {
    // alreadyPurchased=0, select 28× small → weighted=28. Elvis ticketCount=3 > remaining=2 → disabled.
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 0 });
    const root = getRoot(container);
    const rows = getTypeRows(root);
    const smallPlus = getPlusBtn(rows[0]);
    const elvisPlus = getPlusBtn(rows[1]);

    for (let i = 0; i < 28; i++) smallPlus.click();
    expect(getQtyLabel(rows[0]).textContent).toBe("28");
    // Elvis plus disabled because ticketCount=3 > remaining=2
    expect(elvisPlus.disabled).toBe(true);
    // Small plus still allowed (1 <= 2)
    expect(smallPlus.disabled).toBe(false);

    // Click small once more → remaining=1 → small disabled, elvis still disabled.
    smallPlus.click();
    expect(getQtyLabel(rows[0]).textContent).toBe("29");
    expect(smallPlus.disabled).toBe(false); // 1 still fits

    smallPlus.click();
    expect(getQtyLabel(rows[0]).textContent).toBe("30");
    expect(smallPlus.disabled).toBe(true); // remaining=0
    expect(elvisPlus.disabled).toBe(true);
  });

  it("4. alreadyPurchased=30 disables all plus + shows maks-melding", () => {
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 30 });
    const root = getRoot(container);
    const rows = getTypeRows(root);

    expect(getPlusBtn(rows[0]).disabled).toBe(true);
    expect(getPlusBtn(rows[1]).disabled).toBe(true);
    expect(getStatusMsg(root).textContent).toBe("Maks 30 brett nådd");
    expect(getArmBtn(root).disabled).toBe(true);
    expect(getArmBtn(root).textContent).toBe("Maks nådd");

    // Header-subtitle viser "Kjøpt: 30"
    expect(getHeaderSubtitle(root).textContent).toContain("Kjøpt: 30");
  });

  it("5. Arm-klikk kaller onArm med selections-array (bare qty>0)", () => {
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 0 });
    const root = getRoot(container);
    const rows = getTypeRows(root);

    // Add 1× small only
    getPlusBtn(rows[0]).click();
    getArmBtn(root).click();

    expect(armSpy.length).toBe(1);
    expect(armSpy[0]).toEqual([{ type: "small-yellow", qty: 1, name: "Small" }]);

    // Add elvis on top, then arm again
    getPlusBtn(rows[1]).click();
    getArmBtn(root).click();
    expect(armSpy.length).toBe(2);
    expect(armSpy[1]).toEqual([
      { type: "small-yellow", qty: 1, name: "Small" },
      { type: "elvis", qty: 1, name: "Large Elvis" },
    ]);
  });

  it("6. update() med ny alreadyPurchased oppdaterer caps uten å rive ned rader", () => {
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 0 });
    const root = getRoot(container);
    const rowsBefore = getTypeRows(root);
    const smallPlusRef = getPlusBtn(rowsBefore[0]);

    // Simuler at serveren sier myTickets.length nå er 29 → remaining=1.
    panel.update({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 29 });

    const rowsAfter = getTypeRows(root);
    // Samme antall rader, samme DOM-noder — ingen full rebuild.
    expect(rowsAfter.length).toBe(2);
    expect(getPlusBtn(rowsAfter[0])).toBe(smallPlusRef);

    // Elvis plus (ticketCount=3) > remaining=1 → disabled
    expect(getPlusBtn(rowsAfter[1]).disabled).toBe(true);
    // Small plus (1) fits → enabled
    expect(getPlusBtn(rowsAfter[0]).disabled).toBe(false);

    // Header-subtitle reflekterer ny kjøpt-count.
    expect(getHeaderSubtitle(root).textContent).toContain("Kjøpt: 29");
  });

  it("hide() skjuler panelet (display:none)", () => {
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: TYPES, alreadyPurchased: 0 });
    const root = getRoot(container);
    expect(root.style.display).toBe("flex");
    panel.hide();
    expect(root.style.display).toBe("none");
    expect(panel.isShowing()).toBe(false);
  });

  it("show() med tom ticketTypes skjuler panelet (ingen empty render)", () => {
    panel.show({ entryFee: ENTRY_FEE, ticketTypes: [], alreadyPurchased: 0 });
    const root = getRoot(container);
    expect(root.style.display).toBe("none");
    expect(panel.isShowing()).toBe(false);
  });

  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });
});
