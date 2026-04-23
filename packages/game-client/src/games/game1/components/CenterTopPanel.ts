import gsap from "gsap";
import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import { PatternMiniGrid } from "./PatternMiniGrid.js";

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
      background: overrides?.background ?? "rgba(120, 20, 20, 0.4)",
      backdropFilter: "blur(6px)",
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
      btn.style.background = overrides?.background ?? "rgba(120, 20, 20, 0.4)";
      btn.style.borderColor = overrides?.borderColor ?? "rgba(255, 100, 100, 0.2)";
      btn.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 100, 100, 0.1)";
      btn.style.transform = "";
    });
    btn.addEventListener("click", onClick);
    return btn;
  }

  private lastAmountByPatternId = new Map<string, number>();
  private lastPatternsSignature: string | null = null;

  updatePatterns(patterns: PatternDefinition[], patternResults: PatternResult[], prizePool = 0): void {
    const signature = this.computePatternsSignature(patterns, patternResults, prizePool);
    if (signature === this.lastPatternsSignature) return;
    this.lastPatternsSignature = signature;

    this.prizeListEl.innerHTML = "";

    // Find first un-won pattern.
    let currentPatternIdx = 0;
    for (let i = 0; i < patternResults.length; i++) {
      if (patternResults[i]?.isWon) currentPatternIdx = i + 1;
    }
    const currentPattern = patterns[currentPatternIdx] ?? null;

    // Swap the mini-grid to the active pattern's design.
    if (currentPattern && currentPattern.id !== this.activePatternId) {
      if (this.activeGrid) this.activeGrid.destroy();
      this.activeGrid = new PatternMiniGrid();
      this.activeGrid.setDesign(currentPattern.design);
      this.gridHostEl.innerHTML = "";
      this.gridHostEl.appendChild(this.activeGrid.root);
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
        background: "rgba(120, 20, 20, 0.4)",
        backdropFilter: "blur(6px)",
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
      btn.style.background = "rgba(120, 20, 20, 0.4)";
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
    // Buy-more only makes sense during a running round; pre-buy only
    // makes sense between rounds.
    this.buyMoreBtn.style.display = running ? "" : "none";
    this.preBuyBtn.style.display = running ? "none" : "";
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
