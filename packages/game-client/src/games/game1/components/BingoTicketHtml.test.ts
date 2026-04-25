/**
 * @vitest-environment happy-dom
 *
 * BingoTicketHtml tests — replaces TicketCard/TicketGroup for Game 1.
 * Covers rendering, marking, flip, cancel button.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { BingoTicketHtml } from "./BingoTicketHtml.js";
import type { PatternDefinition, Ticket } from "@spillorama/shared-types/game";

function makeTicket(override: Partial<Ticket> = {}): Ticket {
  return {
    id: "tkt-0",
    grid: [
      [1, 16, 31, 46, 61],
      [2, 17, 32, 47, 62],
      [3, 18, 0, 48, 63], // free centre
      [4, 19, 33, 49, 64],
      [5, 20, 34, 50, 65],
    ],
    color: "Small Yellow",
    type: "small",
    ...override,
  };
}

describe("BingoTicketHtml", () => {
  let ticket: BingoTicketHtml;

  beforeEach(() => {
    ticket = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(ticket.root);
  });

  it("renders 25 cells for a 5x5 grid", () => {
    const cells = ticket.root.querySelectorAll(".ticket-grid > div");
    expect(cells.length).toBe(25);
  });

  it("shows the ticket colour in the header", () => {
    const header = ticket.root.querySelector(".ticket-header-name") as HTMLDivElement;
    expect(header.textContent).toBe("Small Yellow");
  });

  it("shows the price in the header", () => {
    const price = ticket.root.querySelector(".ticket-header-price") as HTMLDivElement;
    expect(price.textContent).toBe("10 kr");
  });

  it("marks the free centre cell by default", () => {
    const cells = ticket.root.querySelectorAll(".ticket-grid > div");
    const centre = cells[12] as HTMLDivElement;
    // Bong.jsx-port (2026-04-24): free cell renders en grønn "FREE"-pill
    // inne i hvit celle-ramme. Verifiser via dataset-marker + at inner-
    // divens tekst er "FREE".
    expect(centre.dataset.number).toBe("0");
    const freeInner = centre.querySelector("div") as HTMLDivElement | null;
    expect(freeInner).not.toBeNull();
    expect(freeInner!.textContent).toBe("FREE");
    // Free cell is always considered marked — remaining only counts non-free.
    expect(ticket.getRemainingCount()).toBe(24);
  });

  it("marks a drawn number that exists on the ticket", () => {
    const matched = ticket.markNumber(17);
    expect(matched).toBe(true);
    expect(ticket.getRemainingCount()).toBe(23);
  });

  it("returns false for a number not on the ticket", () => {
    const matched = ticket.markNumber(99);
    expect(matched).toBe(false);
    expect(ticket.getRemainingCount()).toBe(24);
  });

  it("re-marking the same number is idempotent", () => {
    ticket.markNumber(17);
    ticket.markNumber(17);
    expect(ticket.getRemainingCount()).toBe(23);
  });

  it("marks many numbers in batch", () => {
    ticket.markNumbers([1, 16, 31, 46, 61]); // whole first row
    expect(ticket.getRemainingCount()).toBe(19);
  });

  it("reset clears every mark but keeps the free centre marked", () => {
    ticket.markNumbers([1, 17, 33, 49, 65]);
    expect(ticket.getRemainingCount()).toBeLessThan(24);
    ticket.reset();
    expect(ticket.getRemainingCount()).toBe(24);
  });

  it("toggles flip state on click (front → back)", () => {
    const inner = ticket.root.firstChild as HTMLDivElement;
    expect(inner.style.transform).toBe("rotateY(0deg)");
    ticket.root.click();
    expect(inner.style.transform).toBe("rotateY(180deg)");
  });

  it("flips back on second click", () => {
    const inner = ticket.root.firstChild as HTMLDivElement;
    ticket.root.click();
    ticket.root.click();
    expect(inner.style.transform).toBe("rotateY(0deg)");
  });
});

describe("BingoTicketHtml — cancel button", () => {
  it("renders the × button when cancelable=true", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: true,
      onCancel: () => {},
    });
    document.body.appendChild(t.root);
    const btn = t.root.querySelector("button[aria-label='Avbestill brett']");
    expect(btn).not.toBeNull();
  });

  it("does NOT render the × button when cancelable=false", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    const btn = t.root.querySelector("button[aria-label='Avbestill brett']");
    expect(btn).toBeNull();
  });

  it("invokes onCancel with ticket id when × is clicked", () => {
    let cancelledId: string | null = null;
    const t = new BingoTicketHtml({
      ticket: makeTicket({ id: "tkt-abc" }),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: true,
      onCancel: (id) => { cancelledId = id; },
    });
    document.body.appendChild(t.root);
    const btn = t.root.querySelector("button[aria-label='Avbestill brett']") as HTMLButtonElement;
    btn.click();
    expect(cancelledId).toBe("tkt-abc");
  });

  it("× click does NOT also trigger a flip (stopPropagation)", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: true,
      onCancel: () => {},
    });
    document.body.appendChild(t.root);
    const inner = t.root.firstChild as HTMLDivElement;
    const btn = t.root.querySelector("button[aria-label='Avbestill brett']") as HTMLButtonElement;
    btn.click();
    expect(inner.style.transform).toBe("rotateY(0deg)");
  });
});

describe("BingoTicketHtml — loadTicket replaces grid", () => {
  it("rebuilds cells when called with a new ticket shape", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket({ grid: [[1, 2, 3, 4, 5]], id: "a", color: "Small Yellow" }),
      price: 10,
      rows: 1,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    expect(t.root.querySelectorAll(".ticket-grid > div").length).toBe(5);

    t.loadTicket(makeTicket({
      id: "b",
      color: "Small Red",
      grid: [[10, 11, 12, 13, 14]],
    }));
    const firstCell = t.root.querySelector(".ticket-grid > div") as HTMLDivElement;
    expect(firstCell.textContent).toBe("10");
    const header = t.root.querySelector(".ticket-header-name") as HTMLDivElement;
    expect(header.textContent).toBe("Small Red");
  });
});

// ── setActivePattern / "igjen til <fase>"-teller ───────────────────────────

const PATTERN_1_RAD: PatternDefinition = {
  id: "p-1", name: "1 Rad", claimType: "LINE", prizePercent: 0, order: 1, design: 1,
};
const PATTERN_2_RADER: PatternDefinition = {
  id: "p-2", name: "2 Rader", claimType: "LINE", prizePercent: 0, order: 2, design: 2,
};
const PATTERN_FULLT_HUS: PatternDefinition = {
  id: "p-5", name: "Fullt Hus", claimType: "BINGO", prizePercent: 0, order: 5, design: 0,
};
const PATTERN_UKJENT: PatternDefinition = {
  id: "p-x", name: "Stjerne", claimType: "LINE", prizePercent: 0, order: 99, design: 9,
};

function getToGoText(t: BingoTicketHtml): string {
  return (t.root.querySelector(".ticket-togo") as HTMLDivElement).textContent ?? "";
}

describe("BingoTicketHtml — setActivePattern", () => {
  let t: BingoTicketHtml;

  beforeEach(() => {
    t = new BingoTicketHtml({ ticket: makeTicket(), price: 10, rows: 5, cols: 5, cancelable: false });
    document.body.appendChild(t.root);
  });

  it("whole-card default (ingen activePattern): 24 igjen", () => {
    expect(getToGoText(t)).toBe("24 igjen");
  });

  it('activePattern "1 Rad" tomt kort → "4 igjen til 1 Rad"', () => {
    t.setActivePattern(PATTERN_1_RAD);
    expect(getToGoText(t)).toBe("4 igjen til 1 Rad");
  });

  it('activePattern "1 Rad" + full kolonne 2 minus free → "1 Rad — klar!"', () => {
    t.setActivePattern(PATTERN_1_RAD);
    // Kol 2 av GRID: 31, 32, 0 (free), 33, 34 — markér 4 tall.
    t.markNumbers([31, 32, 33, 34]);
    expect(getToGoText(t)).toBe("1 Rad — klar!");
  });

  it('bytte fra "1 Rad" til "2 Rader" oppdaterer teller', () => {
    t.setActivePattern(PATTERN_1_RAD);
    expect(getToGoText(t)).toBe("4 igjen til 1 Rad");
    t.setActivePattern(PATTERN_2_RADER);
    expect(getToGoText(t)).toBe("9 igjen til 2 Rader");
  });

  it('activePattern "Fullt Hus" tomt kort → "24 igjen til Fullt Hus"', () => {
    t.setActivePattern(PATTERN_FULLT_HUS);
    expect(getToGoText(t)).toBe("24 igjen til Fullt Hus");
  });

  it("ukjent pattern → fallback til whole-card-telling", () => {
    t.setActivePattern(PATTERN_UKJENT);
    expect(getToGoText(t)).toBe("24 igjen");
  });

  it("null-pattern rydder tilbake til whole-card", () => {
    t.setActivePattern(PATTERN_1_RAD);
    expect(getToGoText(t)).toBe("4 igjen til 1 Rad");
    t.setActivePattern(null);
    expect(getToGoText(t)).toBe("24 igjen");
  });

  it("markNumber oppdaterer teller mot aktivt pattern", () => {
    t.setActivePattern(PATTERN_1_RAD);
    t.markNumber(31); // Én i kol 2
    expect(getToGoText(t)).toBe("3 igjen til 1 Rad");
    t.markNumber(32);
    expect(getToGoText(t)).toBe("2 igjen til 1 Rad");
  });
});

describe("BingoTicketHtml — BLINK-FIX (round 3) regressions", () => {
  it("default-state har INGEN perspective på root (ingen permanent composite-layer per bong)", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    // perspective skal kun aktiveres under flip — default må være tom string.
    expect(t.root.style.perspective).toBe("");
  });

  it("flip aktiverer perspective på root", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    t.root.click();
    expect(t.root.style.perspective).toBe("1000px");
  });

  it("bong-pulse-ring keyframe er IKKE definert (4-lags box-shadow infinite fjernet)", () => {
    new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    const styleEl = document.getElementById("bong-ticket-styles") as HTMLStyleElement | null;
    expect(styleEl).not.toBeNull();
    const css = styleEl!.textContent ?? "";
    // Sjekk at den gamle box-shadow-infinite-keyframen er borte
    expect(css).not.toContain("@keyframes bong-pulse-ring");
    // Sjekk at .bong-pulse-klassen ikke refererer bong-pulse-ring i sin animation
    const bongPulseClass = css.match(/\.bong-pulse\s*\{[^}]+\}/);
    expect(bongPulseClass).not.toBeNull();
    expect(bongPulseClass![0]).not.toContain("bong-pulse-ring");
    expect(bongPulseClass![0]).not.toContain("box-shadow");
    // Sjekk at bong-pulse-cell ikke lenger animerer background (kun transform)
    const cellKeyframe = css.match(/@keyframes bong-pulse-cell\s*\{([^}]+(?:\{[^}]*\}[^}]*)*?)\}/);
    expect(cellKeyframe).not.toBeNull();
    expect(cellKeyframe![0]).not.toContain("background");
    expect(cellKeyframe![0]).toContain("transform");
  });
});
