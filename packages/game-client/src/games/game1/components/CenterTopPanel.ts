import gsap from "gsap";
import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import { PatternMiniGrid } from "./PatternMiniGrid.js";

/** Injisér CSS-animasjon for won-pill-flash én gang per dokument. */
function ensurePatternWonStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("pattern-won-flash-styles")) return;
  const s = document.createElement("style");
  s.id = "pattern-won-flash-styles";
  s.textContent = `
@keyframes pattern-won-flash {
  0%   { background: rgba(76, 175, 80, 0.55); box-shadow: 0 0 24px rgba(76, 175, 80, 0.8), 0 4px 10px rgba(0,0,0,0.5); transform: scale(1.08); }
  60%  { background: rgba(76, 175, 80, 0.25); box-shadow: 0 0 12px rgba(76, 175, 80, 0.4), 0 4px 10px rgba(0,0,0,0.5); transform: scale(1.02); }
  100% { transform: scale(1); }
}
.prize-pill.pattern-won-flash {
  animation: pattern-won-flash 0.9s ease-out;
}
`;
  document.head.appendChild(s);
}

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

  constructor(overlay: HtmlOverlayManager, callbacks: CenterTopCallbacks = {}) {
    ensurePatternWonStyles();
    this.callbacks = callbacks;

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
    comboBody.appendChild(this.gridHostEl);

    // Prize pill list column
    this.prizeListEl = document.createElement("div");
    Object.assign(this.prizeListEl.style, {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "flex-end",
      gap: "8px",
      flex: "1",
    });
    comboBody.appendChild(this.prizeListEl);

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
      transition: "all 0.15s ease-out",
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

  private lastAmountByPatternId = new Map<string, number>();
  private lastPatternsSignature: string | null = null;
  /** Sett med pattern-id-er som var `isWon` i forrige render. Brukes for å
   *  detektere hvilke patterns som akkurat nå transisjonerte fra
   *  ikke-vunnet → vunnet, slik at pillen kan flash-animeres. */
  private prevWonIds = new Set<string>();
  /** Map fra patternId → DOM-pill, populert under rebuild. Brukes av
   *  `animateWinFlash` for å finne riktig pill etter rebuild. */
  private patternPillById = new Map<string, HTMLDivElement>();

  updatePatterns(patterns: PatternDefinition[], patternResults: PatternResult[], prizePool = 0): void {
    // Pre-game (ingen aktiv game) → serverens `patterns` er tom. Vis likevel
    // 5 placeholder-pills (Rad 1-4 + Full Hus, 0 kr) + mini-grid med Rad 1-
    // design, så combo-panelet aldri er tomt mens spilleren venter på start.
    if (patterns.length === 0) {
      patterns = CenterTopPanel.placeholderPatterns();
      patternResults = [];
    }
    const signature = this.computePatternsSignature(patterns, patternResults, prizePool);
    if (signature === this.lastPatternsSignature) return;
    console.debug("[blink] CenterTop.updatePatterns sig-change", {
      prev: this.lastPatternsSignature,
      next: signature,
    });
    this.lastPatternsSignature = signature;

    this.prizeListEl.innerHTML = "";
    this.patternPillById.clear();

    // Find first un-won pattern.
    let currentPatternIdx = 0;
    for (let i = 0; i < patternResults.length; i++) {
      if (patternResults[i]?.isWon) currentPatternIdx = i + 1;
    }
    const currentPattern = patterns[currentPatternIdx] ?? null;

    // Swap the mini-grid to the active pattern's design — animert. Første
    // gang (ingen eksisterende grid): bare fade in. Ved fase-transisjon:
    // scale+fade-out gammelt, destroy, create nytt, scale+fade-in.
    if (currentPattern && currentPattern.id !== this.activePatternId) {
      console.debug("[blink] CenterTop.miniGrid swap", {
        fromId: this.activePatternId,
        toId: currentPattern.id,
        toDesign: currentPattern.design,
      });
      this.swapMiniGrid(currentPattern.design);
      this.activePatternId = currentPattern.id;
    } else if (!currentPattern && this.activeGrid) {
      this.activeGrid.destroy();
      this.activeGrid = null;
      this.activePatternId = null;
      this.gridHostEl.innerHTML = "";
    }

    const seenIds = new Set<string>();

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const result = patternResults.find((r) => r.patternId === pattern.id);

      // PR C (variantConfig-admin-kobling): honor winningType fra PR A/B.
      const computedPrize =
        pattern.winningType === "fixed"
          ? (pattern.prize1 ?? 0)
          : Math.round((pattern.prizePercent / 100) * prizePool);
      const prize = result?.payoutAmount ?? computedPrize;
      const won = result?.isWon === true;

      let displayName = pattern.name;
      if (pattern.name === "Full House") displayName = "Full Hus";
      else if (pattern.name === "Picture" || pattern.name === "picture") displayName = "Bilde";
      else if (pattern.name === "Frame" || pattern.name === "frame") displayName = "Ramme";
      else if (/^Row \d/.test(pattern.name)) displayName = pattern.name.replace("Row", "Rad");

      const pill = document.createElement("div");
      pill.className = "prize-pill";
      Object.assign(pill.style, {
        // KRITISK: Ingen backdrop-filter — `.prize-pill` ligger over Pixi-canvas
        // og tvinger GPU til å re-kjøre blur-shader per frame. Se
        // ARCHITECTURE.md (2026-04-24 blink-regresjon).
        background: "rgba(30, 12, 12, 0.92)",
        border: "1px solid rgba(255, 100, 100, 0.2)",
        boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
        borderRadius: "14px",
        height: "24px",
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "12px",
        fontWeight: "600",
        color: "#c1c1c1",
        width: "85%",
        boxSizing: "border-box",
        whiteSpace: "nowrap",
      });
      // Inner span so tests that probe by tag / flashAmount targeting can
      // keep querying `span` (see CenterTopPanel.test.ts findSpanForPattern).
      const label = document.createElement("span");
      label.textContent = `${displayName} - ${prize} kr`;
      pill.appendChild(label);

      if (won) {
        pill.classList.add("completed");
        pill.style.textDecoration = "line-through";
        pill.style.textDecorationThickness = "1.5px";
        pill.style.opacity = "0.5";
      } else if (i === currentPatternIdx) {
        pill.classList.add("active");
        pill.style.border = "1.5px solid #ffcc00";
        pill.style.color = "#fff";
        pill.style.boxShadow = "0 4px 10px rgba(0, 0, 0, 0.5), inset 0 0 6px rgba(255,200,0,0.2)";
      }

      this.prizeListEl.appendChild(pill);
      this.patternPillById.set(pattern.id, pill);

      // Flash payout changes (PR-5 C3).
      seenIds.add(pattern.id);
      const prev = this.lastAmountByPatternId.get(pattern.id);
      if (prev !== undefined && prev !== prize && !won) {
        this.flashAmount(label);
      }
      this.lastAmountByPatternId.set(pattern.id, prize);
    }

    for (const id of Array.from(this.lastAmountByPatternId.keys())) {
      if (!seenIds.has(id)) this.lastAmountByPatternId.delete(id);
    }

    // Fase-progresjon: detektér patterns som akkurat nå ble vunnet (isWon
    // flippet fra false → true siden forrige render). Animér pillen med en
    // grønn flash som viser "denne fasen er akkurat ferdig, nå går vi videre".
    const currentWonIds = new Set(
      patternResults.filter((r) => r.isWon).map((r) => r.patternId),
    );
    for (const id of currentWonIds) {
      if (this.prevWonIds.has(id)) continue;
      const pill = this.patternPillById.get(id);
      if (pill) this.animateWinFlash(pill);
    }
    this.prevWonIds = currentWonIds;
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

  private flashAmount(span: HTMLSpanElement): void {
    gsap.killTweensOf(span);
    gsap.fromTo(
      span,
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
      span,
      { color: "#ffe83d" },
      { color: "inherit", duration: 0.4, ease: "power2.out" },
    );
  }

  /**
   * Update jackpot display from room:update.gameVariant.jackpot.
   * Hides when missing or isDisplay=false.
   */
  updateJackpot(jackpot: { drawThreshold: number; prize: number; isDisplay: boolean } | null | undefined): void {
    if (!jackpot || !jackpot.isDisplay) {
      this.jackpotEl.style.display = "none";
      return;
    }
    this.jackpotEl.style.display = "block";
    const label = this.jackpotEl.firstChild;
    if (label) label.textContent = `${jackpot.drawThreshold} JACKPOT : `;
    this.jackpotPrizeEl.textContent = `${jackpot.prize} KR`;
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

  /**
   * BIN-409/451 (D2): persistent buy-more disable once server threshold is
   * reached mid-round. Re-enabled at next round start.
   */
  setBuyMoreDisabled(disabled: boolean, reason?: string): void {
    this.buyMoreBtn.disabled = disabled;
    this.buyMoreBtn.style.opacity = disabled ? "0.4" : "1";
    this.buyMoreBtn.style.cursor = disabled ? "not-allowed" : "pointer";
    this.buyMoreBtn.title = disabled ? (reason ?? "") : "";
  }

  setGameRunning(running: boolean): void {
    // "Kjøp flere brett" kjøper bonger til NESTE trekning — vises mellom
    // runder (når ingen trekning pågår). "Forhåndskjøp til dagens spill"
    // kjøper til planlagte spill — vises mens nåværende trekning pågår.
    this.buyMoreBtn.style.display = running ? "none" : "";
    this.preBuyBtn.style.display = running ? "" : "none";
  }

  setCanStartNow(canStart: boolean, gameRunning: boolean): void {
    this.startGameBtn.style.display = canStart && !gameRunning ? "" : "none";
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

  private computePatternsSignature(
    patterns: PatternDefinition[],
    patternResults: PatternResult[],
    prizePool: number,
  ): string {
    const pats = patterns
      .map((p) => `${p.id}:${p.name}:${p.design}:${p.prizePercent}:${p.winningType ?? ""}:${p.prize1 ?? 0}`)
      .join(",");
    const wins = patternResults
      .map((r) => `${r.patternId}:${r.isWon ? 1 : 0}:${r.payoutAmount ?? 0}`)
      .join(",");
    return `${pats}|${wins}|prize=${prizePool}`;
  }

  destroy(): void {
    if (this.activeGrid) this.activeGrid.destroy();
    this.activeGrid = null;
    this.root.remove();
  }
}
