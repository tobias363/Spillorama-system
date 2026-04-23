import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * Jackpot header — redesign (2026-04-23) moves the jackpot display INTO the
 * CenterTopPanel combo-panel (mockup `.jackpot-display`). This class is kept
 * as a no-op stub so PlayScreen's construction + lifecycle contract is
 * preserved without a ripple-refactor. The ChatPanelV2 resize integration
 * test (G17 BIN-431) still drives `setOffsetX` — we accept the calls and
 * apply the transform to a hidden element so the test keeps its structure.
 *
 * When the topnav-driven jackpot design stabilises, this class can be
 * deleted along with its test and the PlayScreen callers.
 */
export class HeaderBar {
  private root: HTMLDivElement;
  private labelEl: HTMLSpanElement;
  private offsetX = 0;

  constructor(overlay: HtmlOverlayManager) {
    this.root = overlay.createElement("jackpot-header", {
      display: "none",
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      height: "0",
      pointerEvents: "none",
      zIndex: "1",
    });
    this.labelEl = document.createElement("span");
    this.root.appendChild(this.labelEl);
  }

  /**
   * No-op render. Jackpot visning er flyttet til CenterTopPanel i nytt
   * design; vi holder labelEl-teksten oppdatert slik at tester som leser
   * textContent fortsatt ser data.
   */
  update(jackpot: { drawThreshold: number; prize: number; isDisplay: boolean } | null | undefined): void {
    if (!jackpot || !jackpot.isDisplay) {
      this.labelEl.textContent = "";
      return;
    }
    this.labelEl.textContent = `${jackpot.drawThreshold} Jackpot : ${jackpot.prize} kr`;
  }

  setOffsetX(px: number): void {
    this.offsetX = px;
    this.root.style.transform = `translateX(${px}px)`;
  }

  get container(): HTMLDivElement {
    return this.root;
  }

  get currentOffsetX(): number {
    return this.offsetX;
  }

  isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  destroy(): void {
    this.root.remove();
  }
}
