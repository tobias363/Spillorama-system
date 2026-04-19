import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * F3 (BIN-431): Jackpot header bar — lightweight HTML overlay matching Unity's
 * `PanelRowDetails` jackpot row.
 *
 * Unity references:
 *   - Game1GamePlayPanel.SocketFlow.cs:518-520 — populates
 *     `PanelRowDetails.txtJackpotDetails.text = $"{jackPotData.draw} Jackpot : {jackPotData.winningAmount} kr"`
 *     and toggles `PanelRowDetails.JackpotObject.SetActive(jackPotData.isDisplay)`.
 *   - Game1GamePlayPanel.cs:179 — `Panel_Game_Header` is the RectTransform that
 *     slides -80px left when the chat opens (ChatLayout.cs:51-70, :112-125).
 *     G17 animates the container's left/right CSS offsets to mirror that.
 *
 * Scope: render `{drawThreshold} Jackpot : {prize} kr` when `isDisplay === true`.
 * Hidden in all other cases (missing, isDisplay=false).
 */
export class HeaderBar {
  private root: HTMLDivElement;
  private labelEl: HTMLSpanElement;
  /** Current horizontal offset in pixels (G17 animates this at chat-toggle). */
  private offsetX = 0;

  constructor(overlay: HtmlOverlayManager) {
    this.root = overlay.createElement("jackpot-header", {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      height: "40px",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      padding: "6px 16px",
      color: "#ffe83d",
      fontSize: "15px",
      fontWeight: "700",
      background: "linear-gradient(180deg, rgba(120,0,20,0.9), rgba(60,0,10,0.9))",
      borderBottom: "1px solid rgba(255,232,61,0.3)",
      pointerEvents: "none",
      zIndex: "25",
      transition: "transform 0.25s linear",
    });

    this.labelEl = document.createElement("span");
    this.labelEl.style.cssText = "letter-spacing:0.5px;";
    this.root.appendChild(this.labelEl);
  }

  /**
   * Update the header bar from room:update.gameVariant.jackpot.
   * Hides the bar when the value is null or `isDisplay` is falsy — mirroring
   * Unity's `JackpotObject.SetActive(jackPotData.isDisplay)`.
   */
  update(jackpot: { drawThreshold: number; prize: number; isDisplay: boolean } | null | undefined): void {
    if (!jackpot || !jackpot.isDisplay) {
      this.root.style.display = "none";
      return;
    }
    this.labelEl.textContent = `${jackpot.drawThreshold} Jackpot : ${jackpot.prize} kr`;
    this.root.style.display = "flex";
  }

  /**
   * G17 (BIN-431): Animate the header horizontally when the chat opens/closes.
   * Unity: `Panel_Game_Header` slides -80px left on open, +80px (back to 0) on
   * close, GSAP-style 0.25s linear (Unity uses LeanTween default linear).
   * Cancel-in-flight is handled by the CSS transition auto-restarting from the
   * current computed value.
   */
  setOffsetX(px: number): void {
    this.offsetX = px;
    this.root.style.transform = `translateX(${px}px)`;
  }

  /** Expose the container so PlayScreen can drive GSAP or probe for tests. */
  get container(): HTMLDivElement {
    return this.root;
  }

  /** Expose the current offset (for tests and for G17 tween source values). */
  get currentOffsetX(): number {
    return this.offsetX;
  }

  /** Expose visibility state (used by tests). */
  isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  destroy(): void {
    this.root.remove();
  }
}
