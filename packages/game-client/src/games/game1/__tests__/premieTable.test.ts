/**
 * @vitest-environment happy-dom
 *
 * Premietabell-redesign 2026-05-14 (Tobias-direktiv)
 * ==================================================
 *
 * Spec:
 *   - 5 rader (Rad 1-4 + Full Hus) × 3 kolonner (Hvit / Gul / Lilla).
 *   - Hvit-celle = pattern.prize1 (kr).
 *   - Gul-celle = pattern.prize1 × 2.
 *   - Lilla-celle = pattern.prize1 × 3.
 *   - Percent-modus: base = round((prizePercent / 100) × prizePool).
 *   - Active-class togles på rad-nivå (premie-row.active) når
 *     gameRunning && i === currentPatternIdx.
 *   - Completed-class togles på rad-nivå når gameRunning && isWon.
 *   - Utenfor aktiv runde (gameRunning=false) skal verken active eller
 *     completed-class være satt — bug-fix 2026-04-26.
 *
 * Auto-multiplikator-regel: docs/architecture/SPILL_REGLER_OG_PAYOUT.md §3.2.
 * Engine bruker samme regel server-side så displayed-amount = paid-out-amount
 * (untatt single-prize-cap for databingo, som IKKE gjelder Spill 1).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CenterTopPanel, PREMIE_BONG_COLORS } from "../components/CenterTopPanel.js";
import { HtmlOverlayManager } from "../components/HtmlOverlayManager.js";
import type {
  PatternDefinition,
  PatternResult,
} from "@spillorama/shared-types/game";

function ensureResizeObserver(): void {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

function buildInnsatsenPatterns(): PatternDefinition[] {
  // Innsatsen-eksempel fra SPILL_REGLER_OG_PAYOUT.md §3.3:
  //   prize1 (Hvit-base i kr): Rad 1 = 100, Rad 2/3/4 = 200, Full Hus = 1000.
  //   Lilla Full Hus = 3000 kr (ingen cap på hovedspill — kun databingo).
  return [
    { id: "p1", name: "Row 1", claimType: "LINE", prizePercent: 0, order: 0, design: 1, winningType: "fixed", prize1: 100 },
    { id: "p2", name: "Row 2", claimType: "LINE", prizePercent: 0, order: 1, design: 2, winningType: "fixed", prize1: 200 },
    { id: "p3", name: "Row 3", claimType: "LINE", prizePercent: 0, order: 2, design: 3, winningType: "fixed", prize1: 200 },
    { id: "p4", name: "Row 4", claimType: "LINE", prizePercent: 0, order: 3, design: 4, winningType: "fixed", prize1: 200 },
    { id: "p5", name: "Full House", claimType: "BINGO", prizePercent: 0, order: 4, design: 5, winningType: "fixed", prize1: 1000 },
  ];
}

function buildPercentPatterns(): PatternDefinition[] {
  // 5×500-eksempel: prizePercent = 2% per rad, 12% Full Hus.
  return [
    { id: "c1", name: "Row 1", claimType: "LINE", prizePercent: 2, order: 0, design: 1, winningType: "percent", prize1: 0 },
    { id: "c2", name: "Row 2", claimType: "LINE", prizePercent: 2, order: 1, design: 2, winningType: "percent", prize1: 0 },
    { id: "c3", name: "Row 3", claimType: "LINE", prizePercent: 2, order: 2, design: 3, winningType: "percent", prize1: 0 },
    { id: "c4", name: "Row 4", claimType: "LINE", prizePercent: 2, order: 3, design: 4, winningType: "percent", prize1: 0 },
    { id: "c5", name: "Full House", claimType: "BINGO", prizePercent: 12, order: 4, design: 5, winningType: "percent", prize1: 0 },
  ];
}

describe("Premietabell-redesign 2026-05-14 — 5×3 grid (Hvit/Gul/Lilla)", () => {
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;
  let panel: CenterTopPanel;

  beforeEach(() => {
    ensureResizeObserver();
    container = document.createElement("div");
    document.body.appendChild(container);
    overlay = new HtmlOverlayManager(container);
    panel = new CenterTopPanel(overlay);
  });

  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  describe("auto-multiplikator-konstant", () => {
    it("eksporterer 3 bong-farger med multiplikator 1/2/3", () => {
      expect(PREMIE_BONG_COLORS).toHaveLength(3);
      expect(PREMIE_BONG_COLORS[0]).toMatchObject({ key: "hvit", multiplier: 1 });
      expect(PREMIE_BONG_COLORS[1]).toMatchObject({ key: "gul", multiplier: 2 });
      expect(PREMIE_BONG_COLORS[2]).toMatchObject({ key: "lilla", multiplier: 3 });
    });
  });

  describe("grid-struktur (5 rader × 3 kolonner)", () => {
    it("rendrer IKKE header-rad (Tobias-direktiv 2026-05-14: header fjernet — bong-fargene vises på cellene)", () => {
      panel.updatePatterns(buildInnsatsenPatterns(), []);
      const header = container.querySelector(".premie-header");
      expect(header).toBeNull();
      // Bong-farger vises nå som solid bakgrunn på `.col-hvit` / `.col-gul`
      // / `.col-lilla`-cellene istedet — header-raden var redundant og
      // tok unødvendig vertikal plass i `g1-center-top`-panelet.
    });

    it("rendrer 5 rader for 5 patterns med pattern-label + 3 celler hver", () => {
      panel.updatePatterns(buildInnsatsenPatterns(), []);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows).toHaveLength(5);
      for (const row of Array.from(rows)) {
        expect(row.querySelector(".pattern-label")).not.toBeNull();
        const cells = row.querySelectorAll(".premie-cell");
        expect(cells).toHaveLength(3);
        // Hver celle har sin unique color-class.
        expect(row.querySelector(".premie-cell.col-hvit")).not.toBeNull();
        expect(row.querySelector(".premie-cell.col-gul")).not.toBeNull();
        expect(row.querySelector(".premie-cell.col-lilla")).not.toBeNull();
      }
    });
  });

  describe("fixed-modus auto-multiplikator", () => {
    it("Rad 1: Hvit=100, Gul=200, Lilla=300", () => {
      panel.updatePatterns(buildInnsatsenPatterns(), []);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows[0]?.querySelector(".col-hvit")?.textContent).toBe("100 kr");
      expect(rows[0]?.querySelector(".col-gul")?.textContent).toBe("200 kr");
      expect(rows[0]?.querySelector(".col-lilla")?.textContent).toBe("300 kr");
    });

    it("Rad 2-4: Hvit=200, Gul=400, Lilla=600 (alle tre rader)", () => {
      panel.updatePatterns(buildInnsatsenPatterns(), []);
      const rows = container.querySelectorAll(".premie-row");
      for (let i = 1; i <= 3; i++) {
        expect(rows[i]?.querySelector(".col-hvit")?.textContent).toBe("200 kr");
        expect(rows[i]?.querySelector(".col-gul")?.textContent).toBe("400 kr");
        expect(rows[i]?.querySelector(".col-lilla")?.textContent).toBe("600 kr");
      }
    });

    it("Full Hus: Hvit=1000, Gul=2000, Lilla=3000 (Lilla > 2500 kr — IKKE cappet)", () => {
      // Cap 2500 kr gjelder KUN databingo (slug=spillorama). Spill 1 er
      // hovedspill og har INGEN cap. Lilla Full Hus = 3000 kr er forventet.
      // Se SPILL_REGLER_OG_PAYOUT.md §3.4.
      panel.updatePatterns(buildInnsatsenPatterns(), []);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows[4]?.querySelector(".col-hvit")?.textContent).toBe("1000 kr");
      expect(rows[4]?.querySelector(".col-gul")?.textContent).toBe("2000 kr");
      expect(rows[4]?.querySelector(".col-lilla")?.textContent).toBe("3000 kr");
    });
  });

  describe("percent-modus auto-multiplikator", () => {
    it("Rad 1 (2% av 50 000): Hvit=1000, Gul=2000, Lilla=3000", () => {
      panel.updatePatterns(buildPercentPatterns(), [], 50000);
      const rows = container.querySelectorAll(".premie-row");
      // 2% × 50 000 = 1000 (base = Hvit). Gul × 2, Lilla × 3.
      expect(rows[0]?.querySelector(".col-hvit")?.textContent).toBe("1000 kr");
      expect(rows[0]?.querySelector(".col-gul")?.textContent).toBe("2000 kr");
      expect(rows[0]?.querySelector(".col-lilla")?.textContent).toBe("3000 kr");
    });

    it("Full Hus (12% av 50 000): Hvit=6000, Gul=12000, Lilla=18000", () => {
      panel.updatePatterns(buildPercentPatterns(), [], 50000);
      const rows = container.querySelectorAll(".premie-row");
      // 12% × 50 000 = 6000. Lilla = 18 000 kr — fortsatt INGEN cap.
      expect(rows[4]?.querySelector(".col-hvit")?.textContent).toBe("6000 kr");
      expect(rows[4]?.querySelector(".col-gul")?.textContent).toBe("12000 kr");
      expect(rows[4]?.querySelector(".col-lilla")?.textContent).toBe("18000 kr");
    });

    it("oppdaterer celler når prizePool øker mid-runde", () => {
      panel.updatePatterns(buildPercentPatterns(), [], 50000);
      let rows = container.querySelectorAll(".premie-row");
      expect(rows[0]?.querySelector(".col-hvit")?.textContent).toBe("1000 kr");

      // PrizePool dobler seg når nye bonger kjøpes (perpetual percent-modus).
      panel.updatePatterns(buildPercentPatterns(), [], 100000);
      rows = container.querySelectorAll(".premie-row");
      expect(rows[0]?.querySelector(".col-hvit")?.textContent).toBe("2000 kr");
      expect(rows[0]?.querySelector(".col-gul")?.textContent).toBe("4000 kr");
      expect(rows[0]?.querySelector(".col-lilla")?.textContent).toBe("6000 kr");
    });
  });

  describe("active-state (current pattern highlight)", () => {
    it("rad 0 (Rad 1) får .active når gameRunning og ingen patterns vunnet", () => {
      const patterns = buildInnsatsenPatterns();
      panel.updatePatterns(patterns, [], 0, true);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows[0]?.classList.contains("active")).toBe(true);
      // Ingen andre rader er active.
      for (let i = 1; i < 5; i++) {
        expect(rows[i]?.classList.contains("active")).toBe(false);
      }
    });

    it("active flytter til neste pattern når currentPatternIdx avanserer", () => {
      const patterns = buildInnsatsenPatterns();
      const results: PatternResult[] = [
        { patternId: "p1", patternName: "Row 1", claimType: "LINE", isWon: true },
        { patternId: "p2", patternName: "Row 2", claimType: "LINE", isWon: false },
        { patternId: "p3", patternName: "Row 3", claimType: "LINE", isWon: false },
        { patternId: "p4", patternName: "Row 4", claimType: "LINE", isWon: false },
        { patternId: "p5", patternName: "Full House", claimType: "BINGO", isWon: false },
      ];
      panel.updatePatterns(patterns, results, 0, true);
      const rows = container.querySelectorAll(".premie-row");
      // Rad 1 vunnet → currentPatternIdx = 1 → Rad 2 er active.
      expect(rows[1]?.classList.contains("active")).toBe(true);
      // Rad 1 har completed (overstrøket).
      expect(rows[0]?.classList.contains("completed")).toBe(true);
    });

    it("INGEN active når gameRunning=false (utenfor aktiv runde)", () => {
      const patterns = buildInnsatsenPatterns();
      panel.updatePatterns(patterns, [], 0, false);
      const rows = container.querySelectorAll(".premie-row");
      for (const row of Array.from(rows)) {
        expect(row.classList.contains("active")).toBe(false);
      }
    });
  });

  describe("completed-state (won pattern strikethrough)", () => {
    it("vunnet pattern får .completed når gameRunning=true", () => {
      const patterns = buildInnsatsenPatterns();
      const results: PatternResult[] = [
        { patternId: "p1", patternName: "Row 1", claimType: "LINE", isWon: true },
      ];
      panel.updatePatterns(patterns, results, 0, true);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows[0]?.classList.contains("completed")).toBe(true);
    });

    it("INGEN .completed når gameRunning=false (selv om server fortsatt sender isWon)", () => {
      // Bug-fix 2026-04-26: server kan sende stale patternResults mellom
      // runder. Pillene/radene skal IKKE vises overstrøket utenfor runde.
      const patterns = buildInnsatsenPatterns();
      const results: PatternResult[] = [
        { patternId: "p1", patternName: "Row 1", claimType: "LINE", isWon: true },
        { patternId: "p2", patternName: "Row 2", claimType: "LINE", isWon: true },
      ];
      panel.updatePatterns(patterns, results, 0, false);
      const rows = container.querySelectorAll(".premie-row");
      for (const row of Array.from(rows)) {
        expect(row.classList.contains("completed")).toBe(false);
        expect(row.classList.contains("active")).toBe(false);
      }
    });
  });

  describe("pattern-label (norsk display-navn)", () => {
    it("'Row N' → 'Rad N'", () => {
      panel.updatePatterns(buildInnsatsenPatterns(), []);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows[0]?.querySelector(".pattern-label")?.textContent).toBe("Rad 1");
      expect(rows[3]?.querySelector(".pattern-label")?.textContent).toBe("Rad 4");
    });

    it("'Full House' → 'Full Hus'", () => {
      panel.updatePatterns(buildInnsatsenPatterns(), []);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows[4]?.querySelector(".pattern-label")?.textContent).toBe("Full Hus");
    });
  });

  describe("placeholder-mode (pre-game / tom patterns-array)", () => {
    it("rendrer 5 placeholder-rader med 0 kr når patterns er tom", () => {
      panel.updatePatterns([], []);
      const rows = container.querySelectorAll(".premie-row");
      expect(rows).toHaveLength(5);
      // Alle rader viser 0 kr × 1/2/3.
      for (const row of Array.from(rows)) {
        expect(row.querySelector(".col-hvit")?.textContent).toBe("0 kr");
        expect(row.querySelector(".col-gul")?.textContent).toBe("0 kr");
        expect(row.querySelector(".col-lilla")?.textContent).toBe("0 kr");
      }
    });
  });

  describe("minimal-diff DOM-writes (blink-permanent-fix)", () => {
    it("re-render med samme state skriver IKKE til DOM på rad-nivå", () => {
      const patterns = buildInnsatsenPatterns();
      panel.updatePatterns(patterns, [], 0, true);
      const firstRow = container.querySelector(".premie-row") as HTMLElement;
      const firstLabel = firstRow.querySelector(".pattern-label") as HTMLElement;

      // Snapshot DOM-noden + tekst.
      const labelBefore = firstLabel.textContent;
      const classBefore = firstRow.className;

      // Re-kjør med IDENTISK input — ingen DOM-writes skal skje (cache hit).
      panel.updatePatterns(patterns, [], 0, true);

      expect(firstLabel.textContent).toBe(labelBefore);
      expect(firstRow.className).toBe(classBefore);
    });
  });
});
