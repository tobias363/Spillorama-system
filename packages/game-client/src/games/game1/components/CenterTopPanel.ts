import gsap from "gsap";
import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import { PatternMiniGrid } from "./PatternMiniGrid.js";
import type { PatternListView, PatternListViewFactory } from "./PatternListView.js";

/**
 * BIN-blink-permanent-fix 2026-04-24: all visual state for prize-piller
 * (idle / active / completed / won-flash) flyttes til CSS-klasser slik at
 * bytte av state kun muterer `class`-attributtet, ikke `style`. Dette
 * eliminerer 30+ style-mutasjoner per sekund som tidligere trigget
 * transitionstart:background-color + box-shadow for hele `g1-center-top`.
 *
 * Regelen: ALL prize-rad visuell-styling defineres her. Ingen
 * inline-style skrives til raden fra JS etter initial build (bortsett fra
 * GSAP transform-animasjoner som er isolert til `<span>`-etterkommeren).
 *
 * Premietabell-redesign 2026-05-14 (Tobias-direktiv): pillene erstattes
 * av et 5×3 grid (Rad 1-4 + Full Hus × Hvit/Gul/Lilla bong-farger) slik at
 * spilleren ser premien for ALLE bong-farger uten å regne i hodet.
 * Beholder `.prize-pill`-klassen i CSS-en med dummy-regel for
 * backwards-compat (no-backdrop-filter regression-test forventer
 * fortsatt en `.prize-pill`-class), men selve render-en bruker
 * `.premie-row` + `.premie-cell` (5×3 grid). Auto-multiplikator-regel
 * fra `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §3.2 brukes til å
 * beregne Gul (×2) og Lilla (×3) fra Hvit-base (×1).
 */
function ensurePatternWonStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("pattern-won-flash-styles")) return;
  const s = document.createElement("style");
  s.id = "pattern-won-flash-styles";
  s.textContent = `
@keyframes pattern-won-flash {
  0%   { background: rgba(76, 175, 80, 0.55); box-shadow: 0 0 24px rgba(76, 175, 80, 0.8), 0 4px 10px rgba(0,0,0,0.5); transform: scale(1.03); }
  60%  { background: rgba(76, 175, 80, 0.25); box-shadow: 0 0 12px rgba(76, 175, 80, 0.4), 0 4px 10px rgba(0,0,0,0.5); transform: scale(1.01); }
  100% { transform: scale(1); }
}
/* Legacy .prize-pill-klasse — kun beholdt for at den eksterne no-
 * backdrop-filter-regression-testen kan fortsette aa selektere noen
 * elementer aa sjekke. Inneholder INGEN visuell styling (raden bruker
 * .premie-row). KRITISK: aldri legg backdrop-filter her (PR #468). */
.prize-pill { background: none; backdrop-filter: none; }
.premie-table {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
}
.premie-header {
  display: grid;
  grid-template-columns: minmax(64px, 1fr) repeat(3, 1fr);
  gap: 6px;
  padding: 0 10px;
  font-size: 9px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.premie-header .col-label { text-align: left; }
.premie-header .col-color {
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.premie-header .swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.4);
  display: inline-block;
}
.premie-header .swatch.hvit { background: #f5f5f5; }
.premie-header .swatch.gul { background: #f1c40f; }
.premie-header .swatch.lilla { background: #9b59b6; }
.premie-row {
  /* KRITISK: Ingen backdrop-filter (PR #468) — raden ligger over
   * Pixi-canvas og tvinger GPU til å re-kjøre blur-shader per frame.
   * Bruker solid bakgrunn istf rgba+blur for samme visuelle effekt. */
  background: rgba(30, 12, 12, 0.92);
  border: 1px solid rgba(255, 100, 100, 0.2);
  box-shadow: 0 4px 8px rgba(0,0,0,0.4);
  border-radius: 12px;
  padding: 6px 10px;
  display: grid;
  grid-template-columns: minmax(64px, 1fr) repeat(3, 1fr);
  gap: 6px;
  align-items: center;
  color: #c1c1c1;
  /* VIKTIG: ingen CSS-transitions på background/box-shadow/border —
   * de ville trigget transitionstart-events ved hver class-toggle og
   * forårsake blink. State-endringer skal være instant. */
}
.premie-row .pattern-label {
  font-size: 11px;
  font-weight: 700;
  color: inherit;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.premie-row .premie-cell {
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  padding: 4px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
/* Bong-fargede solide bakgrunner (Tobias-direktiv 2026-05-14, bilde-paritet).
 * Tekst-farge tilpasses for kontrast: mørk på hvit/gul, mørk-lilla på lys-lilla. */
.premie-row .premie-cell.col-hvit {
  background: #efefef;
  color: #1a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.4);
}
.premie-row .premie-cell.col-gul {
  background: #f1c40f;
  color: #1a0a0a;
  border: 1px solid rgba(255, 220, 100, 0.6);
}
.premie-row .premie-cell.col-lilla {
  background: #c8b3e0;
  color: #2a0a3a;
  border: 1px solid rgba(180, 150, 220, 0.6);
}
.premie-row.active {
  border: 1.5px solid #ffcc00;
  color: #fff;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5), inset 0 0 6px rgba(255,200,0,0.2);
}
/* Active-state beholder bong-fargede celler — kun raden får gul ramme + glow.
 * (Tobias-direktiv 2026-05-14: hvert celle beholder sin solid bong-farge.) */
.premie-row.completed {
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  opacity: 0.5;
}
.premie-row.pattern-won-flash {
  animation: pattern-won-flash 0.9s ease-out;
}
`;
  document.head.appendChild(s);
}

/**
 * Bong-farger og auto-multiplikator (Tobias-direktiv 2026-05-14 +
 * `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §3.2).
 *
 * Spill 1 har 3 bong-priser med fast multiplikator:
 *   - Hvit  (5 kr) × 1
 *   - Gul   (10 kr) × 2
 *   - Lilla (15 kr) × 3
 *
 * `pattern.prize1` (eller `Math.round((prizePercent / 100) * prizePool)`)
 * er ALLTID base-prisen for Hvit-bong. Gul/Lilla beregnes ved å
 * multiplisere med 2 og 3 respektivt — engine gjør samme beregning
 * server-side.
 *
 * Eksportert som `const` for å gjøre testbarhet enkel + dokumentere
 * regelen i koden.
 */
export const PREMIE_BONG_COLORS: ReadonlyArray<{
  readonly key: "hvit" | "gul" | "lilla";
  readonly label: string;
  readonly multiplier: 1 | 2 | 3;
}> = [
  { key: "hvit", label: "Hvit", multiplier: 1 },
  { key: "gul", label: "Gul", multiplier: 2 },
  { key: "lilla", label: "Lilla", multiplier: 3 },
];

export interface CenterTopCallbacks {
  onShowCalledNumbers?: () => void;
  onPreBuy?: () => void;
  onCancelTickets?: () => void;
  onBuyMoreTickets?: () => void;
  onSelectLuckyNumber?: () => void;
  onOpenSettings?: () => void;
  onOpenMarkerBg?: () => void;
  /** A6: Host/admin manual game start. */
  onStartGame?: () => void;
}

/**
 * Konfigurasjon for combo-panelets pattern-visning.
 *
 * Default (utelatt): Spill 1-style — én aktiv mini-grid + kolonne med
 * tekst-pills ("Rad 1 - 100 kr").
 *
 * Med `patternListViewFactory` satt: combo-bodyet bygges på nytt med kun
 * den injiserte visningen (Spill 3 bruker dette til å vise 4 mini-grids
 * side om side i stedet for tekst-pills).
 */
export interface CenterTopOptions {
  patternListViewFactory?: PatternListViewFactory;
}

/**
 * Redesign 2026-04-23 — mockup `.center-top`:
 *   [combo-panel: 5×5 mini-grid | prize pills]  [action-buttons-panel]
 *
 * - One active pattern mini-grid (not one per row — simpler, matches mockup).
 * - Prize pills for each pattern: completed (strikethrough, dim), active
 *   (yellow border), and inactive (muted).
 * - Jackpot display moved into this panel (mockup `.jackpot-display`).
 * - Primary actions kept: Forhåndskjøp + Kjøp flere brett.
 * - Secondary callbacks (lucky-number, settings, marker-bg, cancel-tickets,
 *   show-called-numbers) are PRESERVED in the interface but don't render
 *   visible buttons — Se oppleste tall + Bytt bakgrunn belong in the
 *   web-shell topnav in the new design. Callback shape stays so PlayScreen
 *   can rewire them later without another API break.
 *
 * Also: A6 "Start spill" host button — visible only when canStartNow.
 */
export class CenterTopPanel {
  private root: HTMLDivElement;
  private gameNameEl: HTMLDivElement;
  private jackpotEl: HTMLDivElement;
  private jackpotPrizeEl: HTMLSpanElement;
  private gridHostEl: HTMLDivElement;
  private prizeListEl: HTMLDivElement;
  private callbacks: CenterTopCallbacks;
  private buyMoreBtn: HTMLButtonElement;
  private preBuyBtn: HTMLButtonElement;
  private startGameBtn: HTMLButtonElement;

  private activeGrid: PatternMiniGrid | null = null;
  private activePatternId: string | null = null;

  /**
   * Injisert pattern-listevisning fra `CenterTopOptions.patternListViewFactory`
   * (Spill 3). Når satt, brukes denne i stedet for default tekst-pill-rad
   * + active mini-grid. `null` = default-mode (Spill 1 / Spill 2).
   */
  private readonly customPatternListView: PatternListView | null;

  constructor(
    overlay: HtmlOverlayManager,
    callbacks: CenterTopCallbacks = {},
    options: CenterTopOptions = {},
  ) {
    ensurePatternWonStyles();
    this.callbacks = callbacks;
    this.customPatternListView = options.patternListViewFactory
      ? options.patternListViewFactory()
      : null;

    // Visual styling (border, gradient, shadow) moved to `top-group-wrapper`
    // in PlayScreen so player-info + combo + actions all sit inside one
    // visible container (PM 2026-04-23: "disse er fortsatt ikke et element").
    // This root is now a plain flex row holding combo + actions.
    this.root = overlay.createElement("center-top", {
      display: "flex",
      flexDirection: "row",
      alignItems: "stretch",
      alignSelf: "flex-start",
      pointerEvents: "auto",
    });

    // ── Combo panel (left half: grid + prize pills) ────────────────────────
    const combo = document.createElement("div");
    Object.assign(combo.style, {
      padding: "15px 26px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      width: "376px",
      borderLeft: "1px solid rgba(255, 120, 50, 0.2)",
      boxShadow: "inset 10px 0 20px rgba(0, 0, 0, 0.15)",
    });

    const comboBody = document.createElement("div");
    Object.assign(comboBody.style, {
      display: "flex",
      gap: "20px",
      justifyContent: "space-between",
      alignItems: "stretch",
    });

    // Grid column (PatternMiniGrid is injected in updatePatterns)
    this.gridHostEl = document.createElement("div");
    Object.assign(this.gridHostEl.style, {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      flex: "0 0 auto",
    });

    // Premietabell-redesign 2026-05-14: erstatter tidligere kolonne med
    // tekst-piller med et 5×3 grid (Rad 1-4 + Full Hus × Hvit/Gul/Lilla).
    // `prizeListEl` beholder samme felt-navn så Spill 3-grenen og
    // diff-/swap-logikken kan fortsette å skrive til samme container.
    // Class-navn byttet fra implisitt til `.premie-table` (CSS i
    // ensurePatternWonStyles).
    this.prizeListEl = document.createElement("div");
    this.prizeListEl.className = "premie-table";
    Object.assign(this.prizeListEl.style, {
      flex: "1",
      justifyContent: "center",
      // Override: vis grid-tabellen i full bredde (5×3 grid trenger plass).
      // Tidligere `align-items: flex-end` matchet høyre-justerte piller —
      // her vil grid-tabellen strekke seg fra venstre til høyre.
      alignItems: "stretch",
    });

    if (this.customPatternListView) {
      // Spill 3-mode: erstatt active-grid + pill-kolonne med den injiserte
      // visningen (4 mini-grids horisontalt). gridHostEl/prizeListEl er
      // fortsatt allokert som detached DOM-noder så updatePatterns/
      // swapMiniGrid-koden kan fortsette å skrive til dem uten try/catch
      // — de er bare ikke mountet til comboBody. updatePatterns sjekker
      // customPatternListView og hopper over default-pillens DOM-skriving
      // når faktoryen er aktiv.
      comboBody.appendChild(this.customPatternListView.root);
    } else {
      comboBody.appendChild(this.gridHostEl);
      comboBody.appendChild(this.prizeListEl);
    }

    combo.appendChild(comboBody);
    this.root.appendChild(combo);

    // ── Action buttons panel (right half) ──────────────────────────────────
    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      flexDirection: "column",
      gap: "9px",
      padding: "14px 25px 5px 25px",
      borderLeft: "1px solid rgba(255, 120, 50, 0.2)",
      boxShadow: "inset 10px 0 20px rgba(0, 0, 0, 0.15)",
      justifyContent: "flex-start",
      // Fast bredde så kolonnen ikke krymper når "Forhåndskjøp til dagens
      // spill" byttes ut med kortere "Kjøp flere brett"-tekst.
      width: "245px",
      boxSizing: "border-box",
      flexShrink: "0",
    });

    // Game name (e.g. "GAME 2: KOMBINERTINNSATS")
    this.gameNameEl = document.createElement("div");
    Object.assign(this.gameNameEl.style, {
      fontSize: "11px",
      fontWeight: "700",
      color: "#ffffff",
      padding: "2px 0",
      letterSpacing: "0.5px",
      whiteSpace: "nowrap",
      textAlign: "center",
      marginBottom: "2px",
    });
    this.gameNameEl.textContent = "HOVEDSPILL 1";
    actions.appendChild(this.gameNameEl);

    // Jackpot display
    this.jackpotEl = document.createElement("div");
    Object.assign(this.jackpotEl.style, {
      display: "none",
      fontSize: "11px",
      fontWeight: "800",
      color: "#fff",
      whiteSpace: "nowrap",
      textAlign: "center",
      marginBottom: "6px",
      textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
      letterSpacing: "0.5px",
    });
    const jackpotLabel = document.createElement("span");
    jackpotLabel.textContent = "";
    this.jackpotEl.appendChild(jackpotLabel);
    this.jackpotPrizeEl = document.createElement("span");
    Object.assign(this.jackpotPrizeEl.style, {
      color: "#ffcc00",
      fontSize: "13px",
    });
    this.jackpotEl.appendChild(this.jackpotPrizeEl);
    actions.appendChild(this.jackpotEl);

    this.preBuyBtn = this.createActionButton("Forhåndskjøp til dagens spill", () => this.callbacks.onPreBuy?.());
    actions.appendChild(this.preBuyBtn);

    this.buyMoreBtn = this.createActionButton("Kjøp flere brett", () => this.callbacks.onBuyMoreTickets?.());
    actions.appendChild(this.buyMoreBtn);

    // A6: host-only manual start — hidden until scheduler says canStartNow.
    this.startGameBtn = this.createActionButton("Start spill", () => this.callbacks.onStartGame?.(), {
      background: "linear-gradient(180deg, rgba(46, 125, 50, 0.6), rgba(27, 94, 32, 0.8))",
      borderColor: "rgba(76, 175, 80, 0.6)",
    });
    this.startGameBtn.style.display = "none";
    actions.appendChild(this.startGameBtn);

    this.root.appendChild(actions);
  }

  private createActionButton(
    label: string,
    onClick: () => void,
    overrides?: { background?: string; borderColor?: string },
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
      // KRITISK: Ingen backdrop-filter her — elementet ligger over Pixi-canvas
      // og blur-shader re-kjøres per frame (60-120 fps). Se ARCHITECTURE.md
      // seksjon "Ingen backdrop-filter over Pixi-canvas" (2026-04-24).
      background: overrides?.background ?? "rgba(30, 12, 12, 0.92)",
      border: `1px solid ${overrides?.borderColor ?? "rgba(255, 100, 100, 0.2)"}`,
      borderRadius: "10px",
      padding: "9px 12px",
      color: "#ffffff",
      fontSize: "11px",
      fontWeight: "700",
      whiteSpace: "nowrap",
      cursor: "pointer",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 100, 100, 0.1)",
      // BIN-blink-permanent-fix: `transition: all` trigger transitionstart
      // for enhver property-endring (inkl. display/opacity fra state-setters).
      // Kun hover-endringer trenger transition — bruker CSS pseudo-class
      // via `.g1-center-top button:hover` med target properties isolert.
      transition: "background 0.15s ease-out, box-shadow 0.15s ease-out, transform 0.15s ease-out",
      fontFamily: "inherit",
    });
    btn.addEventListener("mouseenter", () => {
      if (btn.disabled) return;
      btn.style.background = "linear-gradient(180deg, rgba(60,20,20,0.5), rgba(25,5,5,0.7))";
      btn.style.borderColor = "rgba(255,255,255,0.5)";
      btn.style.boxShadow = "0 6px 16px rgba(0,0,0,0.7), inset 0 1px 2px rgba(255,255,255,0.3)";
      btn.style.transform = "translateY(-1px)";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.disabled) return;
      btn.style.background = overrides?.background ?? "rgba(30, 12, 12, 0.92)";
      btn.style.borderColor = overrides?.borderColor ?? "rgba(255, 100, 100, 0.2)";
      btn.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 100, 100, 0.1)";
      btn.style.transform = "";
    });
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** Sist sett base-pris per pattern (cents/kr — samme verdi som
   *  pattern.prize1 eller computedPrize). Brukes til flash-amount-deteksjon.
   *  Note: oppdatering av Gul/Lilla skjer automatisk når base endres (de
   *  er deriverte verdier — `base × multiplier`), så vi cacher kun base. */
  private lastAmountByPatternId = new Map<string, number>();
  /**
   * Struktur-signatur (pattern-id-rekkefølge + design). Endres KUN når
   * pattern-array-en faktisk har ny shape — ikke ved prize-pool-tweaks
   * eller minor result-oppdateringer. En ny struktur trigger full rebuild
   * av rad-DOM; alt annet går via diff-oppdatering.
   */
  private lastStructureSignature: string | null = null;
  /** Sett med pattern-id-er som var `isWon` i forrige render. Brukes for å
   *  detektere hvilke patterns som akkurat nå transisjonerte fra
   *  ikke-vunnet → vunnet, slik at raden kan flash-animeres. */
  private prevWonIds = new Set<string>();
  /** Map fra patternId → rad + label + per-bong-celle refs. Gjenbrukes
   *  mellom updatePatterns-kall så class-/tekst-diff kan gjøres uten å
   *  rive DOM. `cells` mappes til samme rekkefølge som `PREMIE_BONG_COLORS`. */
  private patternPillById = new Map<
    string,
    {
      pill: HTMLDivElement;
      label: HTMLSpanElement;
      cells: Record<"hvit" | "gul" | "lilla", HTMLDivElement>;
    }
  >();
  /** Per-rad cache av sist sett state — hopper over DOM-writes når
   *  verdien er uendret (0 mutasjoner hvis state er stabil). `prize`
   *  er Hvit-base (Gul/Lilla deriveres deterministisk fra denne).
   *  `displayName` cachet separat slik at label-text kun re-skrives
   *  ved faktisk pattern-name-endring. */
  private pillCache = new Map<
    string,
    { displayName: string; prize: number; active: boolean; completed: boolean }
  >();

  updatePatterns(
    patterns: PatternDefinition[],
    patternResults: PatternResult[],
    prizePool = 0,
    gameRunning = true,
  ): void {
    // Spill 3-mode: delegér til den injiserte visningen og hopp over
    // default-pillens DOM-oppdatering. Visningen eier sin egen placeholder-
    // logikk og diff-state.
    if (this.customPatternListView) {
      this.customPatternListView.update(patterns, patternResults, prizePool, gameRunning);
      return;
    }

    // Pre-game (ingen aktiv game) → serverens `patterns` er tom. Vis likevel
    // 5 placeholder-pills (Rad 1-4 + Full Hus, 0 kr) + mini-grid med Rad 1-
    // design, så combo-panelet aldri er tomt mens spilleren venter på start.
    if (patterns.length === 0) {
      patterns = CenterTopPanel.placeholderPatterns();
      patternResults = [];
    }

    // Bug 2026-04-26 (Tobias): når ingen aktiv trekning kjører — server kan
    // fortsatt sende patternResults der alle er isWon=true fra forrige runde,
    // eller mid-state mellom runder. Pillene skal IKKE vises som overstrøket
    // (.completed) når det ikke er aktiv trekning. Vinst-strikethrough skal
    // KUN gjelde innen pågående runde. Vi bruker `gameRunning`-flagg under
    // pill-rendering for å undertrykke completed/active-state utenfor runde.
    // Merk: vi muterer ikke patternResults — currentPatternIdx-beregningen
    // beholder sin opprinnelige logikk for konsistens med fase-progresjon.

    // Struktur-signatur: kun pattern-id-rekkefølge + design. prizePool
    // og patternResults håndteres via diff-oppdatering — de skal IKKE
    // trigge full rebuild.
    const structureSignature = patterns.map((p) => `${p.id}:${p.design}`).join("|");
    const structureChanged = structureSignature !== this.lastStructureSignature;

    // Find first un-won pattern (for active-highlight).
    let currentPatternIdx = 0;
    for (let i = 0; i < patternResults.length; i++) {
      if (patternResults[i]?.isWon) currentPatternIdx = i + 1;
    }
    const currentPattern = patterns[currentPatternIdx] ?? null;

    // Mini-grid swap kun ved faktisk fase-overgang (id-change).
    if (currentPattern && currentPattern.id !== this.activePatternId) {
      this.swapMiniGrid(currentPattern.design);
      this.activePatternId = currentPattern.id;
    } else if (!currentPattern && this.activeGrid) {
      this.activeGrid.destroy();
      this.activeGrid = null;
      this.activePatternId = null;
      this.gridHostEl.innerHTML = "";
    }

    // ── Struktur-rebuild kun når pattern-array-shape endres ───────────────
    if (structureChanged) {
      this.lastStructureSignature = structureSignature;
      this.rebuildPills(patterns);
    }

    // ── Diff-oppdatering per pill ─────────────────────────────────────────
    const seenIds = new Set<string>();
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const result = patternResults.find((r) => r.patternId === pattern.id);
      const computedPrize =
        pattern.winningType === "fixed"
          ? (pattern.prize1 ?? 0)
          : Math.round((pattern.prizePercent / 100) * prizePool);
      const prize = result?.payoutAmount ?? computedPrize;
      const wonRaw = result?.isWon === true;
      // Bug-fix 2026-04-26: utenfor aktiv trekning skal pillene vises klare
      // (ikke .completed strikethrough, ikke .active highlight) — selv om
      // serveren fortsatt sender patternResults med isWon=true fra forrige
      // runde. Strikethrough er en runde-intern progresjons-indikator.
      const won = gameRunning && wonRaw;
      const displayName = CenterTopPanel.displayNameFor(pattern.name);
      const isActive = gameRunning && !won && i === currentPatternIdx;
      this.applyPillState(pattern.id, displayName, prize, won, isActive);
      seenIds.add(pattern.id);

      // Flash payout changes (KUN ved faktisk prize-endring og ikke won).
      // Premietabell-redesign 2026-05-14: prize-endring i percent-modus
      // (når prizePool øker mid-runde) trigger flash på alle 3 celler
      // samtidig — deriverte Gul/Lilla-verdier endrer seg sammen med Hvit.
      const prev = this.lastAmountByPatternId.get(pattern.id);
      if (prev !== undefined && prev !== prize && !won) {
        const entry = this.patternPillById.get(pattern.id);
        if (entry) {
          for (const color of PREMIE_BONG_COLORS) {
            this.flashAmount(entry.cells[color.key]);
          }
        }
      }
      this.lastAmountByPatternId.set(pattern.id, prize);
    }
    for (const id of Array.from(this.lastAmountByPatternId.keys())) {
      if (!seenIds.has(id)) this.lastAmountByPatternId.delete(id);
    }

    // Fase-vinn-flash: kun patterns som flippet false → true siden sist.
    // Bug-fix 2026-04-26: Når runde ikke kjører, behandler vi alle som
    // ikke-vunnet (jf. logikken over). Tom prevWonIds-set sikrer at neste
    // runde-start trigger flash på de patterns som faktisk vinnes på nytt.
    const currentWonIds = gameRunning
      ? new Set(patternResults.filter((r) => r.isWon).map((r) => r.patternId))
      : new Set<string>();
    for (const id of currentWonIds) {
      if (this.prevWonIds.has(id)) continue;
      const entry = this.patternPillById.get(id);
      if (entry) this.animateWinFlash(entry.pill);
    }
    this.prevWonIds = currentWonIds;
  }

  private static displayNameFor(name: string): string {
    if (name === "Full House") return "Full Hus";
    if (name === "Picture" || name === "picture") return "Bilde";
    if (name === "Frame" || name === "frame") return "Ramme";
    if (/^Row \d/.test(name)) return name.replace("Row", "Rad");
    return name;
  }

  /**
   * Full DOM-rebuild av premietabell-grid. Kalles KUN når pattern-array-
   * shape faktisk endres (nytt antall patterns eller ny id-rekkefølge).
   * Andre oppdateringer (prize, isWon, active-index) går via
   * `applyPillState`.
   *
   * Layout (Tobias-direktiv 2026-05-14): 5 rader × 3 kolonner.
   *   - Header: [Pattern | Hvit 5kr | Gul 10kr | Lilla 15kr]
   *   - Per rad (én per pattern): [pattern-label | Hvit-pris | Gul-pris | Lilla-pris]
   * Hver rad får class `premie-row` så active/completed/won-flash kan
   * settes på rad-nivå (én class-toggle, ikke per celle).
   *
   * `.prize-pill`-klassen er beholdt som dummy-marker på raden så den
   * eksterne `no-backdrop-filter-regression.test.ts` fortsatt finner
   * elementer å sjekke. Faktisk styling kommer fra `.premie-row` /
   * `.premie-cell` (CSS i `ensurePatternWonStyles`).
   */
  private rebuildPills(patterns: PatternDefinition[]): void {
    this.prizeListEl.innerHTML = "";
    this.patternPillById.clear();
    this.pillCache.clear();

    // Header med swatch-prikker. Statisk — bygges én gang per rebuild.
    const header = document.createElement("div");
    header.className = "premie-header";
    header.innerHTML = `
      <div class="col-label">Premie</div>
      <div class="col-color"><span class="swatch hvit"></span>Hvit</div>
      <div class="col-color"><span class="swatch gul"></span>Gul</div>
      <div class="col-color"><span class="swatch lilla"></span>Lilla</div>
    `;
    this.prizeListEl.appendChild(header);

    for (const pattern of patterns) {
      const pill = document.createElement("div");
      // `.prize-pill` beholdes for backwards-compat med regression-testen
      // (`no-backdrop-filter-regression.test.ts` selekterer på `.prize-pill`).
      // Visuell styling kommer fra `.premie-row`.
      pill.className = "prize-pill premie-row";

      const label = document.createElement("span");
      label.className = "pattern-label";
      pill.appendChild(label);

      const cells: Record<"hvit" | "gul" | "lilla", HTMLDivElement> = {
        hvit: document.createElement("div"),
        gul: document.createElement("div"),
        lilla: document.createElement("div"),
      };
      for (const color of PREMIE_BONG_COLORS) {
        const cell = cells[color.key];
        cell.className = `premie-cell col-${color.key}`;
        pill.appendChild(cell);
      }

      this.prizeListEl.appendChild(pill);
      this.patternPillById.set(pattern.id, { pill, label, cells });
    }
  }

  /**
   * Minimal-diff oppdatering for én rad. Skriver KUN til DOM hvis verdien
   * faktisk endret seg sammenlignet med `pillCache` — 0 mutasjoner per
   * rad ved stabil state.
   *
   * Premietabell-redesign 2026-05-14: `prize` er ALLTID Hvit-base.
   * Gul (× 2) og Lilla (× 3) beregnes deterministisk her — de er ikke
   * separate input-felt. Tobias-direktiv: auto-multiplikator-regel fra
   * SPILL_REGLER_OG_PAYOUT.md §3.2.
   */
  private applyPillState(
    patternId: string,
    displayName: string,
    prize: number,
    won: boolean,
    active: boolean,
  ): void {
    const entry = this.patternPillById.get(patternId);
    if (!entry) return;
    const cache = this.pillCache.get(patternId);
    if (
      cache &&
      cache.displayName === displayName &&
      cache.prize === prize &&
      cache.active === active &&
      cache.completed === won
    ) {
      return; // Ingen endring — 0 DOM-writes.
    }
    if (!cache || cache.displayName !== displayName) {
      entry.label.textContent = displayName;
    }
    if (!cache || cache.prize !== prize) {
      for (const color of PREMIE_BONG_COLORS) {
        // Auto-multiplikator (Hvit ×1, Gul ×2, Lilla ×3). Engine bruker
        // samme regel server-side, så displayed-amount = paid-out-amount
        // (untatt single-prize-cap som KUN gjelder databingo, ikke
        // hovedspill Spill 1).
        const value = prize * color.multiplier;
        entry.cells[color.key].textContent = `${value} kr`;
      }
    }
    if (!cache || cache.active !== active) {
      entry.pill.classList.toggle("active", active);
    }
    if (!cache || cache.completed !== won) {
      entry.pill.classList.toggle("completed", won);
    }
    this.pillCache.set(patternId, { displayName, prize, active, completed: won });
  }

  /** Animér overgang fra gammel mini-grid til ny: scale+fade-out, destroy,
   *  create nytt, scale+fade-in. Første gang (ingen eksisterende grid):
   *  bare fade-in det nye. */
  private swapMiniGrid(newDesign: number): void {
    const old = this.activeGrid;
    const buildAndShow = (): void => {
      const next = new PatternMiniGrid();
      next.setDesign(newDesign);
      this.gridHostEl.innerHTML = "";
      this.gridHostEl.appendChild(next.root);
      this.activeGrid = next;
      gsap.fromTo(
        next.root,
        { opacity: 0, scale: 0.82 },
        { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.6)" },
      );
    };
    if (!old) {
      buildAndShow();
      return;
    }
    gsap.killTweensOf(old.root);
    gsap.to(old.root, {
      opacity: 0,
      scale: 0.82,
      duration: 0.22,
      ease: "power2.in",
      onComplete: () => {
        old.destroy();
        buildAndShow();
      },
    });
  }

  /** Grønn flash-animasjon på en pill som akkurat ble vunnet (fase-overgang).
   *  Bruker CSS keyframe `pattern-won-flash` (0.9s). */
  private animateWinFlash(pill: HTMLDivElement): void {
    pill.classList.remove("pattern-won-flash");
    // Reflow for å re-trigge animasjonen hvis klassen allerede var på pillen.
    void pill.offsetWidth;
    pill.classList.add("pattern-won-flash");
    setTimeout(() => pill.classList.remove("pattern-won-flash"), 900);
  }

  private flashAmount(target: HTMLElement): void {
    gsap.killTweensOf(target);
    gsap.fromTo(
      target,
      { scale: 1 },
      {
        scale: 1.12,
        duration: 0.15,
        ease: "power2.out",
        yoyo: true,
        repeat: 1,
        transformOrigin: "center",
      },
    );
    gsap.fromTo(
      target,
      { color: "#ffe83d" },
      { color: "inherit", duration: 0.4, ease: "power2.out" },
    );
  }

  // BIN-blink-permanent-fix: memoize jackpot-state så display + textContent
  // kun skrives når verdien faktisk endrer seg.
  private lastJackpotState: { display: string; label: string; prize: string } | null = null;

  /**
   * Update jackpot display from room:update.gameVariant.jackpot.
   * Hides when missing or isDisplay=false.
   */
  updateJackpot(jackpot: { drawThreshold: number; prize: number; isDisplay: boolean } | null | undefined): void {
    if (!jackpot || !jackpot.isDisplay) {
      if (this.lastJackpotState?.display === "none") return;
      this.jackpotEl.style.display = "none";
      this.lastJackpotState = { display: "none", label: "", prize: "" };
      return;
    }
    const nextLabel = `${jackpot.drawThreshold} JACKPOT : `;
    const nextPrize = `${jackpot.prize} KR`;
    if (
      this.lastJackpotState?.display === "block" &&
      this.lastJackpotState.label === nextLabel &&
      this.lastJackpotState.prize === nextPrize
    ) {
      return; // no-op: 0 mutations
    }
    if (this.lastJackpotState?.display !== "block") {
      this.jackpotEl.style.display = "block";
    }
    if (this.lastJackpotState?.label !== nextLabel) {
      const label = this.jackpotEl.firstChild;
      if (label) label.textContent = nextLabel;
    }
    if (this.lastJackpotState?.prize !== nextPrize) {
      this.jackpotPrizeEl.textContent = nextPrize;
    }
    this.lastJackpotState = { display: "block", label: nextLabel, prize: nextPrize };
  }

  showButtonFeedback(button: "buyMore" | "preBuy", success: boolean): void {
    const btn = button === "buyMore" ? this.buyMoreBtn : this.preBuyBtn;
    const originalText = btn.textContent;
    btn.textContent = success ? "Registrert!" : "Feil";
    btn.style.background = success ? "rgba(46,125,50,0.5)" : "rgba(183,28,28,0.5)";
    btn.disabled = true;
    btn.style.cursor = "default";
    btn.style.opacity = "0.7";

    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = "rgba(30, 12, 12, 0.92)";
      btn.disabled = false;
      btn.style.cursor = "pointer";
      btn.style.opacity = "1";
    }, 2000);
  }

  // ── Memoized state for button setters ─────────────────────────────────
  // BIN-blink-permanent-fix: hver update(state) kjører setBuyMoreDisabled
  // + setGameRunning + setCanStartNow, ofte med samme verdi. Skriv til DOM
  // kun hvis verdien faktisk endret, ellers blir det ~9 style-mutasjoner
  // per update × 5 updates/sec = 45 unødvendige mutasjoner.
  private lastBuyMoreDisabled: boolean | null = null;
  private lastPreBuyDisabled: boolean | null = null;
  private lastPreBuyLabel = "Forhåndskjøp til dagens spill";
  private lastGameRunning: boolean | null = null;
  private lastCanStart: boolean | null = null;

  /**
   * BIN-409/451 (D2): persistent buy-more disable once server threshold is
   * reached mid-round. Re-enabled at next round start.
   */
  setBuyMoreDisabled(disabled: boolean, reason?: string): void {
    if (this.lastBuyMoreDisabled === disabled) return; // no-op: 0 mutations
    this.lastBuyMoreDisabled = disabled;
    this.buyMoreBtn.disabled = disabled;
    this.buyMoreBtn.style.opacity = disabled ? "0.4" : "1";
    this.buyMoreBtn.style.cursor = disabled ? "not-allowed" : "pointer";
    this.buyMoreBtn.title = disabled ? (reason ?? "") : "";
  }

  /**
   * Wait-on-master-fix (Agent B, 2026-05-12): disable "Forhåndskjøp til
   * dagens spill"-knappen når scheduled-game ennå ikke er spawnet av
   * bridge. Pre-fix-bug: klient kunne arme bonger via `bet:arm` (in-memory
   * armed-state) før master klikket Start, og når bridge senere spawnet
   * scheduled-game ble armed-state ikke konvertert til DB-persistert
   * `app_game1_ticket_purchases`-rader → "bongene forsvant".
   *
   * Alternativ B per Tobias-direktiv 2026-05-12: klient venter med kjøp
   * til scheduled-game er spawnet (vis "Venter på master, kjøp åpner
   * snart" i lobby). UX-mønster identisk med `setBuyMoreDisabled` —
   * disable + opacity + cursor + title. Tekst byttes også slik at
   * spilleren ser STATUS uten å trykke (tooltip-only var ikke nok per
   * Tobias-direktiv "tydelig venter-state").
   */
  setPreBuyDisabled(disabled: boolean, reason?: string): void {
    if (this.lastPreBuyDisabled === disabled) return; // no-op: 0 mutations
    this.lastPreBuyDisabled = disabled;
    this.preBuyBtn.disabled = disabled;
    this.preBuyBtn.style.opacity = disabled ? "0.4" : "1";
    this.preBuyBtn.style.cursor = disabled ? "not-allowed" : "pointer";
    this.preBuyBtn.title = disabled ? (reason ?? "") : "";
    // Byttet label ved disabled-state slik at spilleren ser status uten
    // tooltip. `lastPreBuyLabel` cache-er normal-tekst slik at re-enable
    // ikke trenger hardkodet streng. Sync med createActionButton (linje
    // ~270): default-label er "Forhåndskjøp til dagens spill".
    const nextLabel = disabled
      ? "Venter på master — kjøp åpner snart"
      : this.lastPreBuyLabel;
    if (this.preBuyBtn.textContent !== nextLabel) {
      this.preBuyBtn.textContent = nextLabel;
    }
  }

  setGameRunning(running: boolean): void {
    if (this.lastGameRunning === running) return; // no-op: 0 mutations
    this.lastGameRunning = running;
    // "Kjøp flere brett" kjøper bonger til NESTE trekning — vises mellom
    // runder (når ingen trekning pågår). "Forhåndskjøp til dagens spill"
    // kjøper til planlagte spill — vises mens nåværende trekning pågår.
    this.buyMoreBtn.style.display = running ? "none" : "";
    this.preBuyBtn.style.display = running ? "" : "none";
  }

  setCanStartNow(canStart: boolean, gameRunning: boolean): void {
    const shouldShow = canStart && !gameRunning;
    if (this.lastCanStart === shouldShow) return; // no-op: 0 mutations
    this.lastCanStart = shouldShow;
    this.startGameBtn.style.display = shouldShow ? "" : "none";
  }

  /** Expose the root element so PlayScreen can re-parent it into the
   *  shared top-row wrapper (player-info + combo-panel). */
  get rootEl(): HTMLDivElement {
    return this.root;
  }

  /** Game-name header text — e.g. "HOVEDSPILL 1". */
  setBadge(text: string): void {
    this.gameNameEl.textContent = text.toUpperCase();
  }

  /** Pre-game placeholder — 5 dummy-patterns så combo-panelet alltid viser
   *  Rad 1-4 + Full Hus (0 kr) + mini-grid med Rad 1-design. */
  private static placeholderPatterns(): PatternDefinition[] {
    const base = { claimType: "LINE" as const, prizePercent: 0, winningType: "fixed" as const, prize1: 0 };
    return [
      { id: "placeholder-rad1", name: "Rad 1", order: 0, design: 1, ...base },
      { id: "placeholder-rad2", name: "Rad 2", order: 1, design: 2, ...base },
      { id: "placeholder-rad3", name: "Rad 3", order: 2, design: 3, ...base },
      { id: "placeholder-rad4", name: "Rad 4", order: 3, design: 4, ...base },
      { id: "placeholder-fullhus", name: "Full House", order: 4, design: 5, claimType: "BINGO" as const, prizePercent: 0, winningType: "fixed" as const, prize1: 0 },
    ];
  }

  destroy(): void {
    // BIN-blink-permanent-fix: kill alle pågående GSAP-tweens på våre egne
    // DOM-elementer FØR remove(). Zombie-tweens som fortsetter å mutere
    // style på destroyed elementer er klassisk blink-kilde (GSAP holder
    // referanse til noden, ticker fortsetter å oppdatere style).
    //
    // Killing by target ramme inn alle fromTo/to-tweens startet av
    // flashAmount (span inni pill) og swapMiniGrid (next.root/old.root).
    // Vi dekker root-subtree med én kjøring på hver pill + grid-host.
    gsap.killTweensOf(this.root);
    for (const { pill, label, cells } of this.patternPillById.values()) {
      gsap.killTweensOf(pill);
      gsap.killTweensOf(label);
      // Premietabell-redesign 2026-05-14: flashAmount-tweens kjøres nå
      // på alle 3 bong-celler (Hvit/Gul/Lilla). Må killes for å unngå
      // zombie-tweens etter destroy.
      for (const color of PREMIE_BONG_COLORS) {
        gsap.killTweensOf(cells[color.key]);
      }
    }
    gsap.killTweensOf(this.gridHostEl);
    if (this.activeGrid) {
      gsap.killTweensOf(this.activeGrid.root);
      this.activeGrid.destroy();
    }
    this.activeGrid = null;
    // Spill 3-mode: rydd opp injisert pattern-listevisning (eier egen DOM
    // + diff-state). Trygt å kalle uten condition fordi destroy er
    // idempotent på vår side.
    if (this.customPatternListView) {
      this.customPatternListView.destroy();
    }
    this.root.remove();
  }
}
