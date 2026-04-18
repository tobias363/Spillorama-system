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
 * HTML overlay for game info (badge, prize rows) and action buttons.
 *
 * Positioned in the center-top of the play area. Shows the current game's
 * pattern prizes and provides quick-action buttons.
 *
 * Button behaviour (matching Unity):
 * - "Se oppleste tall" — toggles CalledNumbersOverlay
 * - "Forhåndskjøp" — arms bet for next round (bet:arm)
 * - "Bytt bakgrunn" — background change (placeholder)
 * - "Kjøp flere brett" — arms bet for next round (bet:arm), same as Unity
 */
export class CenterTopPanel {
  private root: HTMLDivElement;
  private badgeEl: HTMLDivElement;
  private prizeRowsEl: HTMLDivElement;
  private callbacks: CenterTopCallbacks;
  private buyMoreBtn: HTMLButtonElement | null = null;
  private preBuyBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  /** A6: Host manual start button — visible only when canStartNow === true. */
  private startGameBtn: HTMLButtonElement;

  constructor(overlay: HtmlOverlayManager, callbacks: CenterTopCallbacks = {}) {
    this.callbacks = callbacks;

    this.root = overlay.createElement("center-top", {
      flex: "1",
      display: "flex",
      flexDirection: "column",
      padding: "18px 0",
      marginLeft: "40px",
      marginRight: "40px",
    });

    // Top row: game info + action buttons
    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;flex-direction:row;align-items:flex-start;gap:40px;";

    // Game info column
    const gameInfo = document.createElement("div");
    gameInfo.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    this.badgeEl = document.createElement("div");
    Object.assign(this.badgeEl.style, {
      display: "inline-block",
      background: "#b06010",
      color: "#fff",
      fontSize: "13px",
      fontWeight: "700",
      padding: "5px 16px",
      borderRadius: "6px",
      marginBottom: "10px",
      width: "fit-content",
    });
    this.badgeEl.textContent = "Bingo";
    gameInfo.appendChild(this.badgeEl);

    this.prizeRowsEl = document.createElement("div");
    this.prizeRowsEl.style.cssText = "font-size:16px;color:#ddd;line-height:2;";
    gameInfo.appendChild(this.prizeRowsEl);

    topRow.appendChild(gameInfo);

    // Action buttons (2x2 grid)
    const actionsGrid = document.createElement("div");
    actionsGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:2px;";

    const buttons: { label: string; key: keyof CenterTopCallbacks; ref?: "buyMore" | "preBuy" | "cancel" }[] = [
      { label: "Se oppleste tall", key: "onShowCalledNumbers" },
      { label: "Forhåndskjøp", key: "onPreBuy", ref: "preBuy" },
      { label: "Heldig tall", key: "onSelectLuckyNumber" },
      { label: "Kjøp flere brett", key: "onBuyMoreTickets", ref: "buyMore" },
      { label: "Markør/bakgrunn", key: "onOpenMarkerBg" },
      { label: "Innstillinger", key: "onOpenSettings" },
      { label: "Avbestill bonger", key: "onCancelTickets", ref: "cancel" },
    ];

    for (const { label, key, ref } of buttons) {
      const btn = document.createElement("button");
      btn.textContent = label;
      Object.assign(btn.style, {
        background: "rgba(0,0,0,0.25)",
        border: "1.5px solid rgba(255,255,255,0.5)",
        borderRadius: "22px",
        padding: "9px 22px",
        fontSize: "14px",
        color: "#eee",
        cursor: "pointer",
        whiteSpace: "nowrap",
        backdropFilter: "blur(2px)",
        width: "100%",
        textAlign: "center",
        fontFamily: "inherit",
      });
      btn.addEventListener("mouseenter", () => {
        if (!btn.disabled) btn.style.background = "rgba(255,255,255,0.1)";
      });
      btn.addEventListener("mouseleave", () => {
        if (!btn.disabled) btn.style.background = "rgba(0,0,0,0.25)";
      });
      btn.addEventListener("click", () => {
        this.callbacks[key]?.();
      });
      actionsGrid.appendChild(btn);

      if (ref === "buyMore") this.buyMoreBtn = btn;
      if (ref === "preBuy") this.preBuyBtn = btn;
      if (ref === "cancel") { this.cancelBtn = btn; btn.style.borderColor = "rgba(239,83,80,0.6)"; btn.style.color = "#ef5350"; }
    }

    topRow.appendChild(actionsGrid);

    // A6: Host manual start button — prominent action button, hidden by default
    this.startGameBtn = document.createElement("button");
    this.startGameBtn.textContent = "Start spill";
    Object.assign(this.startGameBtn.style, {
      display: "none",
      background: "linear-gradient(180deg, #2e7d32, #1b5e20)",
      border: "2px solid #4caf50",
      borderRadius: "10px",
      padding: "12px 32px",
      fontSize: "16px",
      fontWeight: "700",
      color: "#fff",
      cursor: "pointer",
      fontFamily: "inherit",
      marginTop: "12px",
      alignSelf: "flex-start",
      boxShadow: "0 2px 8px rgba(76,175,80,0.4)",
    });
    this.startGameBtn.addEventListener("mouseenter", () => {
      this.startGameBtn.style.background = "linear-gradient(180deg, #388e3c, #2e7d32)";
    });
    this.startGameBtn.addEventListener("mouseleave", () => {
      this.startGameBtn.style.background = "linear-gradient(180deg, #2e7d32, #1b5e20)";
    });
    this.startGameBtn.addEventListener("click", () => {
      this.callbacks.onStartGame?.();
    });

    this.root.appendChild(topRow);
    this.root.appendChild(this.startGameBtn);
  }

  private patternGrids: PatternMiniGrid[] = [];
  /**
   * Previous payout amount per patternId — used to detect payout changes
   * and trigger the flash animation on the `txtAmount` span. Mirrors
   * Unity's `PrefabBingoGame1Pattern.Update_Pattern_Amount` (PrefabBingoGame1Pattern.cs:107-110)
   * which writes `txtAmount.text = $"{amount} kr"`. Unity only updates text,
   * but product-side wants an animated flash to signal the change to
   * players — we add that here (PR-5 C3).
   */
  private lastAmountByPatternId = new Map<string, number>();

  updatePatterns(patterns: PatternDefinition[], patternResults: PatternResult[], prizePool = 0): void {
    // Destroy old pattern grids
    for (const g of this.patternGrids) g.destroy();
    this.patternGrids = [];
    this.prizeRowsEl.innerHTML = "";

    // Find first unwon pattern (Unity: currentPatternRow)
    let currentPatternIdx = 0;
    for (let i = 0; i < patternResults.length; i++) {
      if (patternResults[i]?.isWon) currentPatternIdx = i + 1;
    }

    const seenIds = new Set<string>();

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const result = patternResults.find((r) => r.patternId === pattern.id);

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.15);padding:4px 0;";

      // Mini-grid for the current (active) pattern only (matches Unity: only show one pattern at a time)
      if (i === currentPatternIdx) {
        const miniGrid = new PatternMiniGrid();
        miniGrid.setDesign(pattern.design);
        this.patternGrids.push(miniGrid);
        row.appendChild(miniGrid.root);
      }

      // Pattern text
      const span = document.createElement("span");
      span.style.cssText = "font-size:16px;color:#ddd;flex:1;";

      const prize = result?.payoutAmount ?? Math.round((pattern.prizePercent / 100) * prizePool);
      const won = result?.isWon;

      // Display name mapping (Unity: FormatRowText)
      let displayName = pattern.name;
      if (pattern.name === "Full House") displayName = "Full Hus";
      else if (pattern.name === "Picture" || pattern.name === "picture") displayName = "Bilde";
      else if (pattern.name === "Frame" || pattern.name === "frame") displayName = "Ramme";
      else if (/^Row \d/.test(pattern.name)) displayName = pattern.name.replace("Row", "Rad");

      span.textContent = `${displayName} – ${prize} kr`;
      let activeColor = "#ddd";
      if (won) {
        // Unity: ActiveColour (green highlight for won patterns)
        activeColor = "#4caf50";
        span.style.color = activeColor;
        span.style.fontWeight = "700";
        span.textContent = `\u2714 ${displayName} – ${prize} kr`;
      } else if (i === currentPatternIdx) {
        // Current active pattern — bright yellow
        activeColor = "#ffe83d";
        span.style.color = activeColor;
        span.style.fontWeight = "700";
      } else {
        // Unity: DeActiveColour (muted gray for pending patterns)
        activeColor = "#888";
        span.style.color = activeColor;
      }
      row.appendChild(span);
      this.prizeRowsEl.appendChild(row);

      // PR-5 C3: flash when the payout amount for this pattern changes.
      // Unity PrefabBingoGame1Pattern.Update_Pattern_Amount only sets text —
      // we add a GSAP scale + colour pulse so players notice mid-round payout
      // updates (e.g. when a partial win re-distributes the pool).
      seenIds.add(pattern.id);
      const prev = this.lastAmountByPatternId.get(pattern.id);
      if (prev !== undefined && prev !== prize && !won) {
        this.flashAmount(span, activeColor);
      }
      this.lastAmountByPatternId.set(pattern.id, prize);
    }

    // Prune memory of patterns that disappeared (new round, pattern list changed)
    for (const id of Array.from(this.lastAmountByPatternId.keys())) {
      if (!seenIds.has(id)) this.lastAmountByPatternId.delete(id);
    }
  }

  /**
   * GSAP flash on a pattern row: quick scale pulse + yellow colour flash
   * back to the row's baseline colour. Matches Unity spec: scale 1.0 → 1.2
   * (0.15s) + colour #ffe83d → baseline (0.4s).
   */
  private flashAmount(span: HTMLSpanElement, baselineColor: string): void {
    gsap.killTweensOf(span);
    gsap.fromTo(
      span,
      { scale: 1 },
      {
        scale: 1.2,
        duration: 0.15,
        ease: "power2.out",
        yoyo: true,
        repeat: 1,
        transformOrigin: "left center",
      },
    );
    gsap.fromTo(
      span,
      { color: "#ffe83d" },
      { color: baselineColor, duration: 0.4, ease: "power2.out" },
    );
  }

  /** Show brief confirmation feedback on a button after action completes. */
  showButtonFeedback(button: "buyMore" | "preBuy", success: boolean): void {
    const btn = button === "buyMore" ? this.buyMoreBtn : this.preBuyBtn;
    if (!btn) return;

    const originalText = btn.textContent;
    btn.textContent = success ? "Registrert!" : "Feil";
    btn.style.background = success ? "rgba(46,125,50,0.5)" : "rgba(183,28,28,0.5)";
    btn.disabled = true;
    btn.style.cursor = "default";
    btn.style.opacity = "0.7";

    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = "rgba(0,0,0,0.25)";
      btn.disabled = false;
      btn.style.cursor = "pointer";
      btn.style.opacity = "1";
    }, 2000);
  }

  /** Hide cancel button during game (Unity: deleteBtn hidden after game start). */
  setGameRunning(running: boolean): void {
    if (this.cancelBtn) this.cancelBtn.style.display = running ? "none" : "";
    if (this.buyMoreBtn) this.buyMoreBtn.style.display = running ? "" : "none";
  }

  /** A6: Show/hide the manual start button based on scheduler.canStartNow + game status. */
  setCanStartNow(canStart: boolean, gameRunning: boolean): void {
    this.startGameBtn.style.display = canStart && !gameRunning ? "block" : "none";
  }

  setBadge(text: string): void {
    this.badgeEl.textContent = text;
  }

  destroy(): void {
    for (const g of this.patternGrids) g.destroy();
    this.patternGrids = [];
    this.root.remove();
  }
}
