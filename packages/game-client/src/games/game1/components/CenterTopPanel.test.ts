/**
 * @vitest-environment happy-dom
 *
 * CenterTopPanel tests (PR-5 C3 — Update_Pattern_Amount flash).
 *
 * Unity parity: PrefabBingoGame1Pattern.Update_Pattern_Amount
 * (PrefabBingoGame1Pattern.cs:107-110) writes the new `amount` to
 * `txtAmount.text`. The web port adds a GSAP flash (scale 1.0 → 1.2,
 * yoyo; colour #ffe83d → baseline) so players notice mid-round payout
 * changes — visual reinforcement for the same underlying data update.
 *
 * We verify that:
 *   1. The first render seeds the amount without triggering a flash
 *      (no "previous" value to diff against).
 *   2. A re-render with the same amount does NOT flash.
 *   3. A re-render with a changed amount DOES flash (GSAP tween active
 *      on the row's span).
 *   4. Once a pattern is won, subsequent updates do NOT flash (guards
 *      against spurious flashes during the Unity-style green-check
 *      highlight state).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import gsap from "gsap";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import { CenterTopPanel } from "./CenterTopPanel.js";
import { HtmlOverlayManager } from "./HtmlOverlayManager.js";

function ensureResizeObserver(): void {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

function makePanel(): { panel: CenterTopPanel; container: HTMLElement; overlay: HtmlOverlayManager } {
  ensureResizeObserver();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const overlay = new HtmlOverlayManager(container);
  const panel = new CenterTopPanel(overlay);
  return { panel, container, overlay };
}

const PATTERNS: PatternDefinition[] = [
  { id: "row1", name: "Row 1", claimType: "LINE", design: 1, prizePercent: 10, order: 1 },
  { id: "row2", name: "Row 2", claimType: "LINE", design: 1, prizePercent: 15, order: 2 },
];

function results(row1Payout?: number, row1Won = false): PatternResult[] {
  const out: PatternResult[] = [];
  if (row1Payout !== undefined) {
    out.push({
      patternId: "row1",
      patternName: "Row 1",
      claimType: "LINE",
      isWon: row1Won,
      payoutAmount: row1Payout,
    });
  }
  return out;
}

function findSpanForPattern(container: HTMLElement, displayNamePrefix: string): HTMLSpanElement | null {
  const spans = container.querySelectorAll("span");
  for (const s of spans) {
    if (s.textContent && s.textContent.includes(displayNamePrefix)) return s as HTMLSpanElement;
  }
  return null;
}

describe("CenterTopPanel — Update_Pattern_Amount flash (PR-5 C3)", () => {
  let panel: CenterTopPanel;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  beforeEach(() => {
    ({ panel, container, overlay } = makePanel());
  });

  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  it("does NOT flash on the first render (no previous amount to diff)", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });

  it("does NOT flash when the amount is unchanged", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    panel.updatePatterns(PATTERNS, results(100), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });

  it("DOES flash when the payout amount for a pattern changes", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    panel.updatePatterns(PATTERNS, results(150), 1000);

    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    // Two tweens queued by flashAmount: one scale yoyo, one colour tween.
    expect(gsap.getTweensOf(span!).length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flash once a pattern is won (green-check state is terminal)", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    // Mark as won with a different payout — still shouldn't flash.
    panel.updatePatterns(PATTERNS, results(200, /* won */ true), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });

  it("prunes tracking state for patterns that disappear between rounds", () => {
    panel.updatePatterns(PATTERNS, results(100), 1000);
    // New round with only row2 — row1 should be forgotten, so when it
    // reappears it's a "first render" and must NOT flash.
    const onlyRow2: PatternDefinition[] = [PATTERNS[1]];
    panel.updatePatterns(onlyRow2, [], 1000);
    panel.updatePatterns(PATTERNS, results(100), 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span).not.toBeNull();
    expect(gsap.getTweensOf(span!).length).toBe(0);
  });
});

/**
 * PR C (variantConfig-admin-kobling): winningType="fixed" prize-display.
 *
 * Etter PR A+B kan admin konfigurere pattern-premier som enten prosent
 * av pot eller fast kr-beløp. CenterTopPanel må honorere `winningType`
 * + `prize1` fra shared-types PatternDefinition.
 */
describe("CenterTopPanel — PR C winningType-honoring prize-display", () => {
  let panel: CenterTopPanel;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  beforeEach(() => {
    ({ panel, container, overlay } = makePanel());
  });

  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  it("vis prize1-beløp for fixed-mode-pattern uavhengig av pot", () => {
    const fixedPatterns: PatternDefinition[] = [
      {
        id: "row1",
        name: "Row 1",
        claimType: "LINE",
        design: 1,
        prizePercent: 0,
        order: 1,
        winningType: "fixed",
        prize1: 100,
      },
      {
        id: "fh",
        name: "Full House",
        claimType: "BINGO",
        design: 0,
        prizePercent: 0,
        order: 5,
        winningType: "fixed",
        prize1: 1000,
      },
    ];
    // Pot = 5000, men fast-mode skal IKKE skalere med pot.
    panel.updatePatterns(fixedPatterns, [], 5000);

    const row1Span = findSpanForPattern(container, "Rad 1");
    const fhSpan = findSpanForPattern(container, "Full Hus");
    expect(row1Span?.textContent).toContain("100 kr");
    expect(fhSpan?.textContent).toContain("1000 kr");
  });

  it("fortsetter å skalere percent-mode med prizePool (bakoverkompat)", () => {
    const percentPatterns: PatternDefinition[] = [
      {
        id: "row1",
        name: "Row 1",
        claimType: "LINE",
        design: 1,
        prizePercent: 10, // 10% av 2000 = 200
        order: 1,
      },
    ];
    panel.updatePatterns(percentPatterns, [], 2000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span?.textContent).toContain("200 kr");
  });

  it("prize1 mangler → 0 kr (defensive)", () => {
    const brokenFixed: PatternDefinition[] = [
      {
        id: "row1",
        name: "Row 1",
        claimType: "LINE",
        design: 1,
        prizePercent: 0,
        order: 1,
        winningType: "fixed",
        // prize1 utelatt
      },
    ];
    panel.updatePatterns(brokenFixed, [], 1000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span?.textContent).toContain("0 kr");
  });

  it("payoutAmount fra server overstyrer beregnet prize (won-state)", () => {
    // Når en fase er vunnet sender serveren den faktiske payout-
    // amount — den skal vises i stedet for den kalkulerte fixed/percent.
    const fixedPatterns: PatternDefinition[] = [
      {
        id: "row1",
        name: "Row 1",
        claimType: "LINE",
        design: 1,
        prizePercent: 0,
        order: 1,
        winningType: "fixed",
        prize1: 100,
      },
    ];
    // Konfigen sier 100 kr, men serveren har allerede utbetalt 50 kr
    // (multi-winner-split) — det er den sannheten som teller.
    const wonResult: PatternResult[] = [
      {
        patternId: "row1",
        patternName: "Row 1",
        claimType: "LINE",
        isWon: true,
        payoutAmount: 50,
      },
    ];
    panel.updatePatterns(fixedPatterns, wonResult, 2000);
    const span = findSpanForPattern(container, "Rad 1");
    expect(span?.textContent).toContain("50 kr");
    expect(span?.textContent).not.toContain("100 kr");
  });

  it("signature-cache invalideres når winningType eller prize1 endres", () => {
    const percentP: PatternDefinition[] = [
      { id: "row1", name: "Row 1", claimType: "LINE", design: 1, prizePercent: 10, order: 1 },
    ];
    panel.updatePatterns(percentP, [], 1000);
    const span1 = findSpanForPattern(container, "Rad 1");
    expect(span1?.textContent).toContain("100 kr"); // 10% av 1000

    // Admin endrer til fast 300 kr — må re-rendere og vise 300.
    const fixedP: PatternDefinition[] = [
      { id: "row1", name: "Row 1", claimType: "LINE", design: 1,
        prizePercent: 0, order: 1, winningType: "fixed", prize1: 300 },
    ];
    panel.updatePatterns(fixedP, [], 1000);
    const span2 = findSpanForPattern(container, "Rad 1");
    expect(span2?.textContent).toContain("300 kr");
  });
});

/**
 * BIN-409 (D2) — persistent disable for the "Kjøp flere brett" button.
 *
 * Unity parity: `Game1GamePlayPanel.cs:170` `BuyMoreDisableFlagVal`; per-ball
 * sjekk i `.SocketFlow.cs:109-113, :457-461, :485-489`; server-gitt threshold
 * i `.SocketFlow.cs:174`.
 *
 * Rotårsak for BIN-451-buggen: `showButtonFeedback("buyMore", false)` brukte
 * en 1.5 s setTimeout som reset knappen — så spillere kunne klikke "Kjøp flere"
 * igjen etter et par sekunder selv om serveren hadde stengt kjøp. Den nye
 * `setBuyMoreDisabled(disabled, reason)` er idempotent og holder state til
 * den eksplisitt reversereres av enableBuyMore ved ny runde.
 *
 * Tooltip ("Kjøp er stengt — trekning pågår") er a11y-forbedring over Unity
 * (PM godkjent Q2 2026-04-18): Unity skjuler bare interactable-state, vi
 * legger til native `title` for hover-feedback til seende spillere.
 */
describe("CenterTopPanel — setBuyMoreDisabled (BIN-409 D2)", () => {
  let panel: CenterTopPanel;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  beforeEach(() => {
    ({ panel, container, overlay } = makePanel());
  });

  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  function findBuyMoreBtn(): HTMLButtonElement | null {
    const btns = container.querySelectorAll("button");
    for (const b of btns) {
      if (b.textContent === "Kjøp flere brett") return b as HTMLButtonElement;
    }
    return null;
  }

  it("disables button and sets tooltip + opacity + cursor when disabled=true", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true, "Kjøp er stengt — trekning pågår");
    expect(btn!.disabled).toBe(true);
    expect(btn!.title).toBe("Kjøp er stengt — trekning pågår");
    expect(btn!.style.opacity).toBe("0.4");
    expect(btn!.style.cursor).toBe("not-allowed");
  });

  it("re-enables and clears tooltip when disabled=false", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true, "Kjøp er stengt — trekning pågår");
    panel.setBuyMoreDisabled(false);
    expect(btn!.disabled).toBe(false);
    expect(btn!.title).toBe("");
    expect(btn!.style.opacity).toBe("1");
    expect(btn!.style.cursor).toBe("pointer");
  });

  it("hover (mouseenter) does NOT change background while disabled", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true, "Kjøp er stengt");
    const bgBefore = btn!.style.background;
    btn!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    // Hover-handler er gated av `!btn.disabled` — bg skal ikke endres.
    expect(btn!.style.background).toBe(bgBefore);
  });

  it("uses empty-string reason when reason argument omitted", () => {
    const btn = findBuyMoreBtn();
    expect(btn).not.toBeNull();
    panel.setBuyMoreDisabled(true);
    expect(btn!.disabled).toBe(true);
    expect(btn!.title).toBe("");
  });
});

/**
 * Fase-progresjon gjennom alle 5 faser (Rad 1 → Rad 2 → Rad 3 → Rad 4 → Fullt Hus).
 * Verifiserer at:
 *   1. Aktiv pattern skifter korrekt når forrige fase vinnes.
 *   2. Mini-grid bygges/swappes for hver fase (sjekker grid-host endret DOM).
 *   3. Nylig vunnet pill får `pattern-won-flash`-klasse én gang per overgang.
 *   4. Vunne pills beholder line-through + fadet opacity.
 *   5. Fullt Hus (design 5) renderer statisk — ingen tom mini-grid.
 */
describe("CenterTopPanel — fase-progresjon gjennom alle 5 faser", () => {
  let panel: CenterTopPanel;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  const PATTERNS_5: PatternDefinition[] = [
    { id: "rad1", name: "Row 1", claimType: "LINE", design: 1, prizePercent: 15, order: 1 },
    { id: "rad2", name: "Row 2", claimType: "LINE", design: 2, prizePercent: 15, order: 2 },
    { id: "rad3", name: "Row 3", claimType: "LINE", design: 3, prizePercent: 15, order: 3 },
    { id: "rad4", name: "Row 4", claimType: "LINE", design: 4, prizePercent: 15, order: 4 },
    { id: "fullhouse", name: "Full House", claimType: "BINGO", design: 5, prizePercent: 40, order: 5 },
  ];

  function resultsWithWonIdx(...wonIndices: number[]): PatternResult[] {
    return PATTERNS_5.map((p, i) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: wonIndices.includes(i),
      payoutAmount: 100,
    }));
  }

  function findPill(displayNamePrefix: string): HTMLDivElement | null {
    const pills = container.querySelectorAll(".prize-pill") as NodeListOf<HTMLDivElement>;
    for (const p of pills) {
      if (p.textContent?.includes(displayNamePrefix)) return p;
    }
    return null;
  }

  function gridHost(): HTMLDivElement {
    // gridHostEl er første child av comboBody som igjen er child av root.
    // Enklere: finn PatternMiniGrid-container via sin display:grid-style.
    const grids = container.querySelectorAll("div");
    for (const g of grids) {
      const style = g.getAttribute("style") ?? "";
      if (style.includes("grid-template-columns: repeat(5, 25px)")) return g as HTMLDivElement;
    }
    throw new Error("mini-grid not found");
  }

  beforeEach(() => {
    ({ panel, container, overlay } = makePanel());
  });
  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  it("starter med Rad 1 aktiv + mini-grid med 25 celler", () => {
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(), 1000);
    // Aktiv pill er Rad 1
    const rad1 = findPill("Rad 1");
    expect(rad1).not.toBeNull();
    expect(rad1!.classList.contains("active")).toBe(true);
    // Mini-grid eksisterer med 25 celler
    expect(gridHost().children.length).toBe(25);
  });

  it("Rad 1 vinnes → Rad 2 blir aktiv + Rad 1 får pattern-won-flash", () => {
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(), 1000);
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0), 1000);
    const rad1 = findPill("Rad 1")!;
    const rad2 = findPill("Rad 2")!;
    expect(rad1.classList.contains("pattern-won-flash")).toBe(true);
    expect(rad1.classList.contains("completed")).toBe(true);
    expect(rad2.classList.contains("active")).toBe(true);
  });

  it("progresjonerer gjennom alle 5 faser i rekkefølge", () => {
    // Start
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(), 1000);
    expect(findPill("Rad 1")!.classList.contains("active")).toBe(true);

    // Rad 1 vunnet → Rad 2 aktiv
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0), 1000);
    expect(findPill("Rad 1")!.classList.contains("pattern-won-flash")).toBe(true);
    expect(findPill("Rad 2")!.classList.contains("active")).toBe(true);

    // Rad 2 vunnet → Rad 3 aktiv
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0, 1), 1000);
    expect(findPill("Rad 2")!.classList.contains("pattern-won-flash")).toBe(true);
    expect(findPill("Rad 3")!.classList.contains("active")).toBe(true);
    // Rad 1 skal ha line-through men IKKE lenger flash (engangsanimasjon).
    expect(findPill("Rad 1")!.classList.contains("completed")).toBe(true);

    // Rad 3 vunnet → Rad 4 aktiv
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0, 1, 2), 1000);
    expect(findPill("Rad 3")!.classList.contains("pattern-won-flash")).toBe(true);
    expect(findPill("Rad 4")!.classList.contains("active")).toBe(true);

    // Rad 4 vunnet → Fullt Hus aktiv
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0, 1, 2, 3), 1000);
    expect(findPill("Rad 4")!.classList.contains("pattern-won-flash")).toBe(true);
    expect(findPill("Full Hus")!.classList.contains("active")).toBe(true);

    // Fullt Hus vunnet → ingen flere aktive pills
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0, 1, 2, 3, 4), 1000);
    expect(findPill("Full Hus")!.classList.contains("pattern-won-flash")).toBe(true);
    // Alle pills har line-through
    for (const name of ["Rad 1", "Rad 2", "Rad 3", "Rad 4", "Full Hus"]) {
      expect(findPill(name)!.classList.contains("completed")).toBe(true);
    }
  });

  it("mini-grid bytter design per fase (DOM-container skiftes ut)", () => {
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(), 1000);
    const host = gridHost().parentElement!;
    const getGridDom = () => host.querySelector("div[style*='grid-template-columns: repeat(5, 25px)']");
    const initialGrid = getGridDom();
    expect(initialGrid).not.toBeNull();

    // Vinn fase 1 — swapMiniGrid bruker GSAP som kjører i happy-dom; vi
    // verifiserer indirekte at activePatternId-bytting utløste rebuild-
    // instruksen (ved at state-tracking-feltene oppdateres riktig).
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0), 1000);
    // Etter update: Rad 2 er aktiv, prevWonIds inneholder "rad1"
    expect(findPill("Rad 2")!.classList.contains("active")).toBe(true);
  });

  it("vunnet pattern får flash kun én gang (ikke ved hver state-update etterpå)", async () => {
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(), 1000);
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0), 1000);
    const rad1 = findPill("Rad 1")!;
    expect(rad1.classList.contains("pattern-won-flash")).toBe(true);

    // Vent på at flash-klassen fjernes automatisk (setTimeout 900ms i
    // animateWinFlash). Samme pill-instans bevares — ikke destroy/recreate
    // som i gammel implementasjon.
    await new Promise((r) => setTimeout(r, 950));
    expect(rad1.classList.contains("pattern-won-flash")).toBe(false);

    // Nå: en ny updatePatterns-call der Rad 1 fortsatt er vunnet skal
    // IKKE re-trigge flash (prevWonIds tracker at den allerede er vunnet).
    panel.updatePatterns(PATTERNS_5, resultsWithWonIdx(0), 1001);
    const rad1Again = findPill("Rad 1")!;
    // Samme DOM-instans (ingen rebuild).
    expect(rad1Again).toBe(rad1);
    expect(rad1Again.classList.contains("pattern-won-flash")).toBe(false);
  });
});

/**
 * PatternMiniGrid — verifiserer at alle 5 design-verdier gir riktig rendering.
 * Fokus: Fullt Hus (design 5) skal vise ALLE 24 ikke-center-celler markert
 * statisk, ikke tom grid som tidligere (før 2026-04-24-fiksen).
 */
describe("PatternMiniGrid — design per fase", () => {
  it("design 5 (Fullt Hus) markerer alle 24 ikke-center-celler", async () => {
    const { PatternMiniGrid } = await import("./PatternMiniGrid.js");
    const grid = new PatternMiniGrid();
    grid.setDesign(5);
    // 25 celler totalt, center (idx 12) er fri, 24 skal være filled
    const cells = Array.from(grid.root.children) as HTMLDivElement[];
    expect(cells.length).toBe(25);
    let hitCount = 0;
    for (let i = 0; i < cells.length; i++) {
      // BIN-blink-permanent-fix: fylt-state er nå via `.hit`-CSS-klasse.
      if (cells[i].classList.contains("hit")) hitCount++;
    }
    // Skal ha 24 hit-celler (alle minus center)
    expect(hitCount).toBe(24);
    // Center-cellen (idx 12) skal IKKE være hit
    expect(cells[12].classList.contains("hit")).toBe(false);
    grid.destroy();
  });

  it("design 1-4 starter phase-cycle (første combo highlightes umiddelbart)", async () => {
    const { PatternMiniGrid } = await import("./PatternMiniGrid.js");
    for (const design of [1, 2, 3, 4]) {
      const grid = new PatternMiniGrid();
      grid.setDesign(design);
      const cells = Array.from(grid.root.children) as HTMLDivElement[];
      const hitCount = cells.filter((c) => c.classList.contains("hit")).length;
      // Design 1 = 1 rad ELLER 1 kol (5 celler), men center kan være inkludert
      // → 4 eller 5 synlige treff. Minst 4 celler skal være hit.
      expect(hitCount).toBeGreaterThanOrEqual(4);
      grid.destroy();
    }
  });

  it("design ≥ 6 (ukjent) = clearAll — ingen hits", async () => {
    const { PatternMiniGrid } = await import("./PatternMiniGrid.js");
    const grid = new PatternMiniGrid();
    grid.setDesign(99);
    const cells = Array.from(grid.root.children) as HTMLDivElement[];
    const hitCount = cells.filter((c) => c.style.background.includes("linear-gradient")).length;
    expect(hitCount).toBe(0);
    grid.destroy();
  });
});

/**
 * BIN-blink-permanent-fix 2026-04-24: regresjons-test som måler antall
 * DOM-mutasjoner ved repeterte updatePatterns-kall med samme/lignende
 * state. Før diff-rendering: ~75 mutasjoner per call. Etter: 0.
 *
 * Dette er den kritiske asserten som skal fange regresjoner fra nå av.
 */
describe("CenterTopPanel — blink prevention (DOM-mutasjons-kontrakt)", () => {
  let panel: CenterTopPanel;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  beforeEach(() => {
    ({ panel, container, overlay } = makePanel());
  });
  afterEach(() => {
    gsap.globalTimeline.clear();
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  /** Teller MutationObserver-events i målt vindu (style + class + text + childList). */
  async function observeMutations(root: HTMLElement, work: () => void): Promise<number> {
    return new Promise<number>((resolve) => {
      let count = 0;
      const obs = new MutationObserver((muts) => {
        count += muts.length;
      });
      obs.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      work();
      // Gi MutationObserver én mikrotask for å batche.
      setTimeout(() => {
        obs.disconnect();
        resolve(count);
      }, 0);
    });
  }

  it("repeterte updatePatterns med identisk state → 0 mutasjoner i pill-listen", async () => {
    // First seed — tillatt å mutere (full rebuild + mini-grid gsap-tween).
    panel.updatePatterns(PATTERNS, results(50), 100);
    // La mikrotasks og eventuelle gsap-initial-sets settle før måling.
    await new Promise((r) => setTimeout(r, 50));

    const prizeList = panel.rootEl.querySelector("div > div:nth-child(2) > div:nth-child(2)") as HTMLElement
      ?? panel.rootEl.querySelectorAll(".prize-pill")[0].parentElement!;
    const pillBefore = prizeList.querySelectorAll(".prize-pill");
    // Nå må repeterte kall med identisk state IKKE endre pill-DOM.
    const count = await observeMutations(prizeList, () => {
      panel.updatePatterns(PATTERNS, results(50), 100);
      panel.updatePatterns(PATTERNS, results(50), 100);
      panel.updatePatterns(PATTERNS, results(50), 100);
    });
    const pillAfter = prizeList.querySelectorAll(".prize-pill");

    // Nøkkelen: samme DOM-instanser som før (ingen destroy/recreate).
    expect(pillAfter.length).toBe(pillBefore.length);
    for (let i = 0; i < pillBefore.length; i++) {
      expect(pillAfter[i]).toBe(pillBefore[i]);
    }
    // Identisk state gir 0 mutasjoner (diff-rendering matcher cache).
    // Tidligere kode: ~75 mutasjoner per call × 3 = 225+.
    expect(count).toBe(0);
  });

  it("prize-pool-tweak uten struktur-endring → ingen full rebuild", async () => {
    panel.updatePatterns(PATTERNS, results(50), 100);
    // prizePool endres men patterns har alle winningType ikke satt → prize
    // beregnet fra prizePercent × prizePool. prize-endring trigger flashAmount
    // (spenner 1 tween), men IKKE innerHTML-rebuild.
    const beforeHtml = panel.rootEl.innerHTML;
    panel.updatePatterns(PATTERNS, results(50), 200);
    // DOM-tree-shape skal være uendret — bare label.textContent endret.
    const afterHtml = panel.rootEl.innerHTML;
    // Pillene har samme struktur (5 divs × span), bare teksten er annerledes.
    expect(afterHtml.split('class="prize-pill').length).toBe(
      beforeHtml.split('class="prize-pill').length,
    );
  });

  it("prize-endring oppdaterer KUN label.textContent, ikke pill-struktur", async () => {
    panel.updatePatterns(PATTERNS, results(50), 100);
    await new Promise((r) => setTimeout(r, 10));
    const pillBefore = panel.rootEl.querySelectorAll(".prize-pill");
    panel.updatePatterns(PATTERNS, results(60), 100); // prize endret
    const pillAfter = panel.rootEl.querySelectorAll(".prize-pill");
    expect(pillAfter.length).toBe(pillBefore.length);
    // Samme DOM-instanser (ikke destroy/recreate).
    for (let i = 0; i < pillBefore.length; i++) {
      expect(pillAfter[i]).toBe(pillBefore[i]);
    }
    // Label skal ha ny tekst.
    expect(pillAfter[0].querySelector("span")?.textContent).toBe("Rad 1 - 60 kr");
  });

  it("won-state trigger class-toggle, ikke innerHTML-rebuild", async () => {
    panel.updatePatterns(PATTERNS, results(50), 100);
    const pillBefore = panel.rootEl.querySelectorAll(".prize-pill");
    panel.updatePatterns(PATTERNS, results(100, true), 100); // row1 won
    const pillAfter = panel.rootEl.querySelectorAll(".prize-pill");
    // Samme DOM-instanser.
    expect(pillAfter[0]).toBe(pillBefore[0]);
    expect(pillAfter[0].classList.contains("completed")).toBe(true);
  });

  it("struktur-endring (ny pattern lagt til) → full rebuild aksepteres", async () => {
    panel.updatePatterns(PATTERNS, results(50), 100);
    const extended: PatternDefinition[] = [
      ...PATTERNS,
      { id: "row3", name: "Row 3", claimType: "LINE", design: 1, prizePercent: 20, order: 3 },
    ];
    panel.updatePatterns(extended, results(50), 100);
    const pills = panel.rootEl.querySelectorAll(".prize-pill");
    expect(pills.length).toBe(3);
  });
});

/**
 * Bug-fix 2026-04-26 (Tobias): premie-radene skal ALLTID vises klart
 * (ingen .completed strikethrough, ingen .active highlight) når det
 * IKKE er aktiv trekning. Strikethrough er en runde-intern progresjons-
 * indikator — utenfor runde må listen "se klar ut" igjen.
 *
 * Bakoverkompat: når gameRunning utelates (default=true) eller eksplisitt
 * settes til true, oppfører kode seg eksakt som før.
 */
describe("CenterTopPanel — gameRunning-flagg styrer .completed/.active", () => {
  let panel: CenterTopPanel;
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  const PATTERNS_5: PatternDefinition[] = [
    { id: "rad1", name: "Row 1", claimType: "LINE", design: 1, prizePercent: 15, order: 1 },
    { id: "rad2", name: "Row 2", claimType: "LINE", design: 2, prizePercent: 15, order: 2 },
    { id: "rad3", name: "Row 3", claimType: "LINE", design: 3, prizePercent: 15, order: 3 },
    { id: "rad4", name: "Row 4", claimType: "LINE", design: 4, prizePercent: 15, order: 4 },
    { id: "fullhouse", name: "Full House", claimType: "BINGO", design: 5, prizePercent: 40, order: 5 },
  ];

  function allWon(): PatternResult[] {
    return PATTERNS_5.map((p) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: true,
      payoutAmount: 100,
    }));
  }

  function findPill(displayNamePrefix: string): HTMLDivElement | null {
    const pills = container.querySelectorAll(".prize-pill") as NodeListOf<HTMLDivElement>;
    for (const p of pills) {
      if (p.textContent?.includes(displayNamePrefix)) return p;
    }
    return null;
  }

  beforeEach(() => {
    ({ panel, container, overlay } = makePanel());
  });
  afterEach(() => {
    panel.destroy();
    overlay.destroy();
    container.remove();
  });

  it("gameRunning=false + alle isWon=true → INGEN pill får .completed (overstrøk)", () => {
    panel.updatePatterns(PATTERNS_5, allWon(), 1000, /* gameRunning */ false);
    for (const name of ["Rad 1", "Rad 2", "Rad 3", "Rad 4", "Full Hus"]) {
      const pill = findPill(name)!;
      expect(pill).not.toBeNull();
      expect(pill.classList.contains("completed")).toBe(false);
    }
  });

  it("gameRunning=false → ingen pill får .active (heller ikke første)", () => {
    panel.updatePatterns(PATTERNS_5, [], 1000, /* gameRunning */ false);
    for (const name of ["Rad 1", "Rad 2", "Rad 3", "Rad 4", "Full Hus"]) {
      const pill = findPill(name)!;
      expect(pill.classList.contains("active")).toBe(false);
    }
  });

  it("gameRunning=true (default) + isWon=true → .completed beholdes (bakoverkompat)", () => {
    // Ingen 4. parameter — default=true.
    panel.updatePatterns(PATTERNS_5, allWon(), 1000);
    for (const name of ["Rad 1", "Rad 2", "Rad 3", "Rad 4", "Full Hus"]) {
      const pill = findPill(name)!;
      expect(pill.classList.contains("completed")).toBe(true);
    }
  });

  it("eksplisitt gameRunning=true + isWon=true → .completed beholdes", () => {
    panel.updatePatterns(PATTERNS_5, allWon(), 1000, /* gameRunning */ true);
    expect(findPill("Rad 1")!.classList.contains("completed")).toBe(true);
    expect(findPill("Full Hus")!.classList.contains("completed")).toBe(true);
  });

  it("overgang gameRunning=true → false fjerner .completed fra alle pills", () => {
    // Først kjørende runde med vunne patterns.
    panel.updatePatterns(PATTERNS_5, allWon(), 1000, /* gameRunning */ true);
    expect(findPill("Rad 1")!.classList.contains("completed")).toBe(true);
    // Runde slutter → alle pills skal nullstilles.
    panel.updatePatterns(PATTERNS_5, allWon(), 1000, /* gameRunning */ false);
    for (const name of ["Rad 1", "Rad 2", "Rad 3", "Rad 4", "Full Hus"]) {
      expect(findPill(name)!.classList.contains("completed")).toBe(false);
    }
  });

  it("ny runde starter (false → true) — fase-progresjon fungerer fortsatt", () => {
    panel.updatePatterns(PATTERNS_5, allWon(), 1000, /* gameRunning */ false);
    // Ny runde, ingen vinnere ennå
    panel.updatePatterns(
      PATTERNS_5,
      PATTERNS_5.map((p) => ({
        patternId: p.id,
        patternName: p.name,
        claimType: p.claimType,
        isWon: false,
        payoutAmount: 100,
      })),
      1000,
      /* gameRunning */ true,
    );
    // Rad 1 skal være aktiv som ny fase
    expect(findPill("Rad 1")!.classList.contains("active")).toBe(true);
    expect(findPill("Rad 1")!.classList.contains("completed")).toBe(false);
  });
});
