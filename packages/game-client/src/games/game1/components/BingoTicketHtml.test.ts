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

  it("renders B I N G O-header with 5 letters above the grid (Tobias 2026-05-03)", () => {
    // Header skal eksistere som dedikert .ticket-bingo-header-node.
    const header = ticket.root.querySelector(
      ".ticket-bingo-header",
    ) as HTMLDivElement | null;
    expect(header).not.toBeNull();
    // 5 bokstaver matcher 5 kolonner — én bokstav per grid-kolonne.
    const letters = header!.querySelectorAll(":scope > div");
    expect(letters.length).toBe(5);
    expect(Array.from(letters).map((l) => l.textContent)).toEqual([
      "B",
      "I",
      "N",
      "G",
      "O",
    ]);
    // Header må være plassert FØR grid-noden i DOM-rekkefølge så bokstavene
    // står over første rad av tall.
    const grid = ticket.root.querySelector(".ticket-grid") as HTMLDivElement;
    const headerIdx = Array.from(header!.parentElement!.children).indexOf(header!);
    const gridIdx = Array.from(grid.parentElement!.children).indexOf(grid);
    expect(headerIdx).toBeLessThan(gridIdx);
    // Samme grid-template som grid-noden → kolonne-alignment per skjermbildet.
    expect(header!.style.gridTemplateColumns).toBe(grid.style.gridTemplateColumns);
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
    // Tobias 2026-04-26: free-cellen rendrer nå Spillorama-logo-bilde
    // i stedet for "FREE"-tekst-pille. Verifiser via dataset-marker +
    // at inner-imgen peker til logoen.
    expect(centre.dataset.number).toBe("0");
    const freeImg = centre.querySelector("img") as HTMLImageElement | null;
    expect(freeImg).not.toBeNull();
    expect(freeImg!.src).toContain("spillorama-logo.png");
    expect(freeImg!.alt).toBe("FREE");
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

describe("BingoTicketHtml — BLINK-FIX (round 5) regressions", () => {
  /**
   * Round 5 hazard #1 — `transform-style: preserve-3d` permanent på alle 30
   * bonger har samme layer-promotion-effekt som `perspective`. PR #492 fikset
   * perspective men preserve-3d sto fortsatt permanent → 30 composite-layers
   * gjenstod → 1/90s blink. Default må nå være `flat`.
   */
  it("hazard #1: default-state har transform-style: flat på inner (ingen permanent 3D-context)", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    const inner = t.root.firstChild as HTMLDivElement;
    // Default = "flat". preserve-3d settes kun under flip-animasjonen.
    expect(inner.style.transformStyle).toBe("flat");
  });

  it("hazard #1: flip aktiverer transform-style: preserve-3d på inner", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    const inner = t.root.firstChild as HTMLDivElement;
    t.root.click();
    expect(inner.style.transformStyle).toBe("preserve-3d");
    // Perspective + preserve-3d aktiveres alltid sammen i samme livssyklus.
    expect(t.root.style.perspective).toBe("1000px");
  });

  /**
   * Round 5 hazard #2 — `transition: background 0.12s, color 0.12s` på alle
   * grid-celler. 30 bonger × 25 celler = 750 transitionstart-events per
   * ball-trekk. background/color er paint-properties → re-paint i mellom-
   * frames. Markering må nå være instant (matcher Unity-paritet).
   */
  it("hazard #2: grid-celler har INGEN transition på background/color", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket(),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    const cells = t.root.querySelectorAll<HTMLDivElement>(".ticket-grid > div");
    expect(cells.length).toBe(25);
    for (const cell of Array.from(cells)) {
      const trans = cell.style.transition;
      // Tom string ELLER "none" er OK. background/color SKAL ikke være med.
      expect(
        trans,
        `Celle ${cell.dataset.number} har transition="${trans}" — paint-property-transition er blink-hazard.`,
      ).not.toContain("background");
      expect(trans).not.toContain("color");
    }
  });

  /**
   * Round 5 hazard #3 — `.bong-pulse` `z-index: 1` skapte stacking-context
   * per pulse-celle. Late-game 30 bonger × ~3 one-to-go-celler = 90+
   * stacking-contexts → kandidater for layer-promotion → blink. Pulse-effekten
   * fungerer fint uten z-index (transform: scale + outline er composite-bar).
   */
  it("hazard #3: .bong-pulse-klassen har INGEN z-index (ingen stacking-context per pulse-celle)", () => {
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
    const bongPulseClass = css.match(/\.bong-pulse\s*\{[^}]+\}/);
    expect(bongPulseClass).not.toBeNull();
    expect(
      bongPulseClass![0],
      "z-index på .bong-pulse skaper stacking-context per pulse-celle — blink-hazard.",
    ).not.toContain("z-index");
    // position: relative trengs ikke heller — fjernet sammen med z-index.
    expect(bongPulseClass![0]).not.toContain("position");
  });
});

describe("BingoTicketHtml — BLINK-FIX (round 6) regressions", () => {
  /**
   * Round 6 hazard #7 — `buildElvisBanner` rev hver gang loadTicket(ticket)
   * ble kalt på en eksisterende Elvis-bong. Selv om ticket.color var identisk
   * med forrige snapshot, ble banner-noden revet ned og bygget på nytt
   * (inkluderer img-decoding → kort flash mens browseren mellomlagrer
   * pixel-buffer). Memo via `elvisBannerColorKey` skipper rebuild når farge
   * er uendret — 0 DOM-mutasjoner, 0 img-decoding.
   */
  it("hazard #7: loadTicket med samme Elvis-farge skal ikke re-bygge banner-noden", () => {
    const t = new BingoTicketHtml({
      ticket: {
        id: "tkt-0",
        grid: [
          [1, 16, 31, 46, 61],
          [2, 17, 32, 47, 62],
          [3, 18, 0, 48, 63],
          [4, 19, 33, 49, 64],
          [5, 20, 34, 50, 65],
        ],
        color: "elvis2",
        type: "elvis",
      },
      price: 30,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);

    const bannerBefore = t.root.querySelector(".ticket-elvis-banner");
    expect(bannerBefore).not.toBeNull();

    // loadTicket med samme color — banner-noden skal være SAMME instans
    // (ikke replaced).
    t.loadTicket({
      id: "tkt-1",
      grid: [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 0, 48, 63],
        [4, 19, 33, 49, 64],
        [5, 20, 34, 50, 65],
      ],
      color: "elvis2",
      type: "elvis",
    });

    const bannerAfter = t.root.querySelector(".ticket-elvis-banner");
    expect(
      bannerAfter,
      "banner-node skal være SAMME instans (ikke replaceWith) når color er uendret",
    ).toBe(bannerBefore);
  });

  it("hazard #7: loadTicket med ny Elvis-farge skal fortsatt re-bygge banner", () => {
    const t = new BingoTicketHtml({
      ticket: {
        id: "tkt-0",
        grid: [
          [1, 16, 31, 46, 61],
          [2, 17, 32, 47, 62],
          [3, 18, 0, 48, 63],
          [4, 19, 33, 49, 64],
          [5, 20, 34, 50, 65],
        ],
        color: "elvis1",
        type: "elvis",
      },
      price: 30,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);

    const bannerBefore = t.root.querySelector(".ticket-elvis-banner");
    expect(bannerBefore).not.toBeNull();

    // Ny farge — banner SKAL replaces så img/label oppdateres.
    t.loadTicket({
      id: "tkt-1",
      grid: [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 0, 48, 63],
        [4, 19, 33, 49, 64],
        [5, 20, 34, 50, 65],
      ],
      color: "elvis5",
      type: "elvis",
    });

    const bannerAfter = t.root.querySelector(".ticket-elvis-banner");
    expect(bannerAfter).not.toBeNull();
    expect(
      bannerAfter,
      "banner-node skal være NY instans når color faktisk endres",
    ).not.toBe(bannerBefore);
  });
});
