/**
 * @vitest-environment happy-dom
 *
 * BIN-688: Elvis-bilde-rendering i BingoTicketHtml.
 *
 * Dekker:
 *   - 5 snapshot-lignende tester, én per Elvis-variant (elvis1..elvis5):
 *     verifiserer at riktig bilde-URL + label rendres i banner-elementet
 *   - Negativ-test: non-Elvis-bonger (small_yellow) rendrer IKKE banner
 *   - Fallback-test: ukjent Elvis-variant ("elvis9") rendrer banner men uten
 *     `<img>` (tekst-bare fallback) — ingen crash, ingen broken-image
 *   - Case/format-robusthet: "Elvis 1", "ELVIS1", "Small Elvis 2" gir samme
 *     bilde-URL som "elvis1"/"elvis2"
 *   - loadTicket swap: Elvis → non-Elvis fjerner banner; non-Elvis → Elvis
 *     legger det til; Elvis → Elvis bytter bilde.
 */
import { describe, it, expect } from "vitest";
import { BingoTicketHtml } from "./BingoTicketHtml.js";
import type { Ticket } from "@spillorama/shared-types/game";

function makeTicket(override: Partial<Ticket> = {}): Ticket {
  return {
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
    ...override,
  };
}

function makeElvisTicket(color: string): BingoTicketHtml {
  const t = new BingoTicketHtml({
    ticket: makeTicket({ color }),
    price: 30,
    rows: 5,
    cols: 5,
    cancelable: false,
  });
  document.body.appendChild(t.root);
  return t;
}

function getBanner(t: BingoTicketHtml): HTMLDivElement | null {
  return t.root.querySelector(".ticket-elvis-banner");
}

function getBannerImg(t: BingoTicketHtml): HTMLImageElement | null {
  return t.root.querySelector(".ticket-elvis-image");
}

function getBannerLabel(t: BingoTicketHtml): string {
  const el = t.root.querySelector(".ticket-elvis-label") as HTMLDivElement | null;
  return el?.textContent ?? "";
}

function getHeaderText(t: BingoTicketHtml): string {
  const el = t.root.querySelector(".ticket-header-name") as HTMLDivElement;
  return el.textContent ?? "";
}

/**
 * Normaliser asset-URL til en identifier som er robust mot Vite-modusene:
 *   - Dev/test: fil-URL med `/elvis1.svg` (substring-match virker direkte)
 *   - Prod build: base64 data-URL (dekodes tilbake til SVG-kildekode, som
 *     inneholder "Elvis N placeholder"-tittel + svg-payload)
 *
 * Returnerer en streng som garantert inneholder variant-tall for en gyldig
 * asset. Tom streng hvis img mangler src.
 */
function imgVariantMarker(img: HTMLImageElement | null): string {
  if (!img) return "";
  const src = img.src;
  if (src.startsWith("data:image/svg+xml;base64,")) {
    try {
      return atob(src.substring("data:image/svg+xml;base64,".length));
    } catch {
      return src;
    }
  }
  return src;
}

// ── 5 snapshot-lignende tester per variant ───────────────────────────────────

describe("BingoTicketHtml — Elvis-rendering (BIN-688)", () => {
  // Test-cases: (ticket.color, expected variant-number, expected url-substring)
  // URL-substring matcher Vite-transformert asset-import (URL ender på navnet).
  const cases: Array<[string, number]> = [
    ["elvis1", 1],
    ["elvis2", 2],
    ["elvis3", 3],
    ["elvis4", 4],
    ["elvis5", 5],
  ];

  for (const [color, variant] of cases) {
    it(`rendrer riktig bilde + label for ticket.color="${color}"`, () => {
      const t = makeElvisTicket(color);
      const banner = getBanner(t);
      expect(banner, "banner skal finnes på Elvis-bong").not.toBeNull();

      const img = getBannerImg(t);
      expect(img, "banner skal inneholde <img>-element").not.toBeNull();
      // Vite asset-import returnerer enten fil-URL (dev) eller base64 data-
      // URL (prod / small-asset-inline). Bruk imgVariantMarker som dekoder
      // ved behov, så matcher vi mot SVG-innholdet "Elvis <N>" i tittel.
      expect(imgVariantMarker(img)).toContain(`Elvis ${variant}`);
      expect(img!.alt).toBe(`ELVIS ${variant}`);

      // Label under bildet
      expect(getBannerLabel(t)).toBe(`ELVIS ${variant}`);

      // Header-tekst normaliseres også
      expect(getHeaderText(t)).toBe(`ELVIS ${variant}`);
    });
  }

  // ── Negativ: non-Elvis rendrer IKKE Elvis-banner ────────────────────────────

  it("non-Elvis ticket (small_yellow) rendrer IKKE Elvis-banner", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket({ color: "small_yellow" }),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);

    expect(getBanner(t)).toBeNull();
    expect(getBannerImg(t)).toBeNull();
    // Header skal være original fargenavn, ikke "ELVIS"
    expect(getHeaderText(t)).toBe("Gul");
  });

  it("non-Elvis ticket (Large Yellow) rendrer IKKE Elvis-banner", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket({ color: "Large Yellow" }),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);

    expect(getBanner(t)).toBeNull();
    expect(getHeaderText(t)).toBe("Gul - 3 bonger");
  });

  // ── Fallback: ukjent Elvis-variant (nummer utenfor 1-5) ─────────────────────

  it('ukjent Elvis-variant ("elvis9") rendrer banner UTEN <img> (fallback)', () => {
    const t = makeElvisTicket("elvis9");
    const banner = getBanner(t);
    expect(banner, "banner skal finnes for Elvis-prefiks (også ukjent nr.)").not.toBeNull();

    // Ingen img — fordi elvis9 ikke finnes som asset
    expect(getBannerImg(t)).toBeNull();

    // Label: "ELVIS" uten nummer (fallback fra getElvisLabel)
    expect(getBannerLabel(t)).toBe("ELVIS");
    expect(getHeaderText(t)).toBe("ELVIS");
  });

  // ── Case/format-robusthet mot backend-variasjoner ──────────────────────────

  it('godtar "Elvis 1" (Unity-format med space) → samme bilde som "elvis1"', () => {
    const a = makeElvisTicket("elvis1");
    const b = makeElvisTicket("Elvis 1");
    expect(getBannerImg(b)?.src).toBe(getBannerImg(a)?.src);
    expect(getBannerLabel(b)).toBe("ELVIS 1");
  });

  it('godtar "ELVIS1" (uppercase) → samme bilde som "elvis1"', () => {
    const a = makeElvisTicket("elvis1");
    const b = makeElvisTicket("ELVIS1");
    expect(getBannerImg(b)?.src).toBe(getBannerImg(a)?.src);
  });

  it('godtar "Small Elvis 2" (legacy-kompositt) → bilde nr. 2', () => {
    const t = makeElvisTicket("Small Elvis 2");
    expect(imgVariantMarker(getBannerImg(t))).toContain("Elvis 2");
    expect(getBannerLabel(t)).toBe("ELVIS 2");
  });

  // ── loadTicket-swap: banner legges til / fjernes / byttes ───────────────────

  it("loadTicket: non-Elvis → Elvis legger til banner", () => {
    const t = new BingoTicketHtml({
      ticket: makeTicket({ color: "small_yellow" }),
      price: 10,
      rows: 5,
      cols: 5,
      cancelable: false,
    });
    document.body.appendChild(t.root);
    expect(getBanner(t)).toBeNull();

    t.loadTicket(makeTicket({ color: "elvis3" }));
    expect(getBanner(t)).not.toBeNull();
    expect(imgVariantMarker(getBannerImg(t))).toContain("Elvis 3");
  });

  it("loadTicket: Elvis → non-Elvis fjerner banner", () => {
    const t = makeElvisTicket("elvis4");
    expect(getBanner(t)).not.toBeNull();

    t.loadTicket(makeTicket({ color: "small_white" }));
    expect(getBanner(t)).toBeNull();
  });

  it("loadTicket: Elvis → Elvis bytter bilde", () => {
    const t = makeElvisTicket("elvis1");
    expect(imgVariantMarker(getBannerImg(t))).toContain("Elvis 1");

    t.loadTicket(makeTicket({ color: "elvis5" }));
    expect(imgVariantMarker(getBannerImg(t))).toContain("Elvis 5");
    expect(getBannerLabel(t)).toBe("ELVIS 5");
  });
});
