import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";

/**
 * HTML overlay panel showing player info, number ring, and draw progress.
 *
 * Layout (from mockup):
 * - Column 1: player count icon + number, innsats, gevinst
 * - Column 2: large number ring (90px, red gradient), draw progress text
 *
 * The number ring also supports countdown mode, displaying seconds
 * remaining before the next game starts.
 */
export class LeftInfoPanel {
  private root: HTMLDivElement;
  private playerCountEl: HTMLSpanElement;
  private entryFeeEl: HTMLSpanElement;
  private prizeEl: HTMLSpanElement;
  private progressEl: HTMLDivElement;
  private countdownEl: HTMLDivElement;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private countdownDeadline = 0;

  constructor(overlay: HtmlOverlayManager) {
    this.root = overlay.createElement("left-panel", {
      flexShrink: "0",
      alignSelf: "flex-start",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      padding: "15px 0 18px 0",
      marginLeft: "40px",
    });

    // Player count row
    const playerRow = document.createElement("div");
    playerRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:#ddd;";
    playerRow.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`;
    this.playerCountEl = document.createElement("span");
    this.playerCountEl.textContent = "0";
    playerRow.appendChild(this.playerCountEl);
    this.root.appendChild(playerRow);

    // Entry fee + prize
    const betInfo = document.createElement("div");
    betInfo.style.cssText = "font-size:14px;color:#bbb;line-height:1.8;";
    this.entryFeeEl = document.createElement("span");
    this.entryFeeEl.textContent = "Innsats: 0 kr";
    this.prizeEl = document.createElement("span");
    this.prizeEl.textContent = "Gevinst: 0 kr";
    betInfo.appendChild(this.entryFeeEl);
    betInfo.appendChild(document.createElement("br"));
    betInfo.appendChild(this.prizeEl);
    this.root.appendChild(betInfo);

    // Draw progress (e.g. "11/60")
    this.progressEl = document.createElement("div");
    this.progressEl.style.cssText = "font-size:13px;color:#aaa;margin-top:4px;";
    this.progressEl.textContent = "";
    this.root.appendChild(this.progressEl);

    // Countdown text (shown between games)
    this.countdownEl = document.createElement("div");
    this.countdownEl.style.cssText = "font-size:16px;color:#ffe83d;font-weight:700;margin-top:4px;display:none;";
    this.root.appendChild(this.countdownEl);
  }

  update(
    playerCount: number,
    totalStake: number,
    prizePool: number,
    _lastDrawnNumber: number | null,
    drawCount: number,
    totalDrawCapacity: number,
  ): void {
    this.playerCountEl.textContent = String(playerCount).padStart(2, "0");
    this.entryFeeEl.textContent = totalStake > 0
      ? `Innsats: ${totalStake} kr`
      : "Innsats: —";
    this.prizeEl.textContent = `Gevinst: ${prizePool} kr`;
    // Draw progress — only show when game is running
    if (totalDrawCapacity > 0) {
      this.progressEl.textContent = `Trekk: ${drawCount}/${totalDrawCapacity}`;
    } else {
      this.progressEl.textContent = "";
    }
  }

  /**
   * Start countdown mode — show seconds remaining as text.
   * The main animated countdown is handled by CenterBall (PixiJS).
   */
  startCountdown(millisUntilStart: number): void {
    this.stopCountdown();
    this.countdownEl.style.display = "block";

    if (millisUntilStart <= 0) {
      this.countdownEl.textContent = "Starter snart...";
      return;
    }

    this.countdownDeadline = Date.now() + millisUntilStart;
    this.updateCountdownDisplay();

    this.countdownInterval = setInterval(() => {
      this.updateCountdownDisplay();
    }, 250);
  }

  stopCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.countdownEl.style.display = "none";
  }

  private updateCountdownDisplay(): void {
    const remaining = Math.ceil((this.countdownDeadline - Date.now()) / 1000);
    if (remaining <= 0) {
      this.countdownEl.textContent = "Starter snart...";
      this.stopCountdown();
      this.countdownEl.style.display = "block"; // keep visible after stop
    } else {
      this.countdownEl.textContent = `Neste spill om ${remaining}s`;
    }
  }

  destroy(): void {
    this.stopCountdown();
    this.root.remove();
  }
}
