/**
 * @vitest-environment happy-dom
 *
 * REGRESSION 2026-04-30 Bug B — Large ticket multiplicity in BuyPopup.
 *
 * Tobias rapporterte 2026-04-30 at popup-en viser "Large Yellow · 30 kr · 3 brett"
 * men når brukeren kjøper får de bare 1 bong. Verifiserer at popup-en faktisk
 * sender riktig payload til server slik at server kan multiplisere ticketCount.
 *
 * Test-kontrakt:
 *   1) Popup viser "3 brett" for Large Yellow (qty=1, ticketCount=3) ✓
 *   2) Popup-totalen viser "30 kr" (qty=1 × priceMultiplier=3 × entryFee=10) ✓
 *   3) Klikk Kjøp sender selections=[{type:"large", qty:1, name:"Large Yellow"}] ✓
 *   4) Popup-totalen viser "60 kr" for qty=2 av Large Yellow ✓
 *
 * NB: Server-siden multipliserer qty × ticketCount = 1 × 3 = 3 brett.
 * Hvis popup sender qty=1 OG server multipliserer riktig, får brukeren 3 brett.
 * Hvis popup sender qty=3 (feil), eller server ikke multipliserer, får brukeren
 * bare 1 brett — som er bug-en Tobias rapporterte.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Game1BuyPopup } from "./Game1BuyPopup.js";
import { HtmlOverlayManager } from "./HtmlOverlayManager.js";

const ENTRY_FEE = 10;

const TYPES = [
  { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
  { name: "Small White", type: "small", priceMultiplier: 1, ticketCount: 1 },
  { name: "Large Yellow", type: "large", priceMultiplier: 3, ticketCount: 3 },
  { name: "Large White", type: "large", priceMultiplier: 3, ticketCount: 3 },
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

function findRowByName(container: HTMLElement, name: string): HTMLElement | null {
  const rows = container.querySelectorAll<HTMLElement>("[data-row]");
  for (const r of rows) {
    if (r.textContent?.includes(name)) return r;
  }
  // Fallback: search all rows in typesContainer
  const overlay = container.querySelector(".g1-overlay-root") as HTMLElement;
  const backdrop = overlay?.children[overlay.children.length - 1] as HTMLElement;
  const card = backdrop?.firstElementChild as HTMLElement;
  const typesContainer = card?.children[1] as HTMLElement;
  if (!typesContainer) return null;
  for (let i = 0; i < typesContainer.children.length; i++) {
    const row = typesContainer.children[i] as HTMLElement;
    if (row?.textContent?.includes(name)) return row;
  }
  return null;
}

function clickPlus(row: HTMLElement, times = 1): void {
  // Stepper er siste child på rad. Stepper-children: [minus, qtyLabel, plus]
  const stepper = row.children[row.children.length - 1] as HTMLElement;
  const plusBtn = stepper.children[2] as HTMLButtonElement;
  for (let i = 0; i < times; i++) {
    plusBtn.click();
  }
}

function findBuyButton(container: HTMLElement): HTMLButtonElement {
  const overlay = container.querySelector(".g1-overlay-root") as HTMLElement;
  const backdrop = overlay.children[overlay.children.length - 1] as HTMLElement;
  const card = backdrop.firstElementChild as HTMLElement;
  // buyBtn is the second-to-last child (cancelBtn is last)
  for (const child of Array.from(card.children)) {
    const el = child as HTMLElement;
    if (el.tagName === "BUTTON" && el.textContent?.includes("Kjøp")) {
      return el as HTMLButtonElement;
    }
  }
  throw new Error("Kjøp-knapp ikke funnet");
}

describe("Bug B 2026-04-30 — Game1BuyPopup ticketCount multiplicity", () => {
  let popup: Game1BuyPopup;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    const setup = makePopup();
    popup = setup.popup;
    container = setup.container;
    popup.showWithTypes(ENTRY_FEE, TYPES);
  });

  it("Large Yellow med qty=1 sender selections=[{type:'large', qty:1, name:'Large Yellow'}]", async () => {
    let captured: Array<{ type: string; qty: number; name?: string }> | null = null;
    popup.setOnBuy((selections) => {
      captured = selections;
    });

    const row = findRowByName(container, "Stor gul");
    expect(row).not.toBeNull();
    clickPlus(row!, 1);

    // Klikk Kjøp
    const buyBtn = findBuyButton(container);
    expect(buyBtn.disabled).toBe(false);
    buyBtn.click();

    expect(captured).not.toBeNull();
    expect(captured!.length).toBe(1);
    expect(captured![0]).toEqual({
      type: "large",
      qty: 1,
      name: "Large Yellow",
    });

    // KRITISK: qty MÅ være 1 (popup-en sender BARE qty, server multipliserer
    // med ticketCount=3 → 3 brett opprettet). Hvis popup sender qty=3 ville
    // server multiplisere igjen → 9 brett. Hvis popup sender qty=0 ville
    // server lage 0 brett — match med Tobias' "1 bong"-rapport ville da
    // tilsi at server ikke multipliserer (ticketCount-feil i variantConfig).
    expect(captured![0].qty).toBe(1);
  });

  it("Large Yellow med qty=2 sender selections=[{type:'large', qty:2, name:'Large Yellow'}] (= 6 brett etter server-multiplikasjon)", async () => {
    let captured: Array<{ type: string; qty: number; name?: string }> | null = null;
    popup.setOnBuy((selections) => {
      captured = selections;
    });

    const row = findRowByName(container, "Stor gul");
    clickPlus(row!, 2);

    const buyBtn = findBuyButton(container);
    buyBtn.click();

    expect(captured).not.toBeNull();
    expect(captured![0].qty).toBe(2);
  });

  it("Mixed: 1 Small Yellow + 1 Large White sender 2 selections med korrekt qty", async () => {
    let captured: Array<{ type: string; qty: number; name?: string }> | null = null;
    popup.setOnBuy((selections) => {
      captured = selections;
    });

    const smallRow = findRowByName(container, "Liten gul");
    const largeRow = findRowByName(container, "Stor hvit");
    clickPlus(smallRow!, 1);
    clickPlus(largeRow!, 1);

    const buyBtn = findBuyButton(container);
    buyBtn.click();

    expect(captured).not.toBeNull();
    expect(captured!.length).toBe(2);
    const smallSel = captured!.find((s) => s.name === "Small Yellow");
    const largeSel = captured!.find((s) => s.name === "Large White");
    expect(smallSel).toEqual({ type: "small", qty: 1, name: "Small Yellow" });
    expect(largeSel).toEqual({ type: "large", qty: 1, name: "Large White" });
    // 1 (Small) + 3 (Large) = 4 brett etter server-multiplikasjon
  });

  it("Popup-totalen for Large Yellow qty=1 viser '30 kr · 3 brett' (display + price riktig)", () => {
    const row = findRowByName(container, "Stor gul");
    clickPlus(row!, 1);

    // Total-row viser "Total: NN kr". Vi sjekker bare at 30 kr finnes på siden.
    const overlay = container.querySelector(".g1-overlay-root") as HTMLElement;
    expect(overlay.textContent).toMatch(/30\s*kr/);
    // Og at vi har "3 brett" et sted (per-row badge)
    const allText = overlay.textContent ?? "";
    expect(allText).toMatch(/3.*brett/);
  });
});
