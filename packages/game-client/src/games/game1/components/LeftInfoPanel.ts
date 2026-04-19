import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
import type { Player } from "@spillorama/shared-types/game";

/** Bridge-state shape used for pause-awareness. */
interface PauseAwareBridge {
  getState(): { isPaused: boolean };
}

/**
 * HTML overlay panel showing player info, number ring, and draw progress.
 *
 * Layout (from mockup):
 * - Column 1: player count icon + number, innsats, gevinst
 * - Column 2: large number ring (90px, red gradient), draw progress text
 *
 * The number ring also supports countdown mode, displaying seconds
 * remaining before the next game starts.
 *
 * Pause-hook (BIN-420 G23): the `setInterval` that drives the countdown
 * display honours `state.isPaused`. While paused, the deadline is pushed
 * forward by the tick interval so the remaining-seconds readout stays frozen
 * — matching Unity's `Game1GamePlayPanel.SocketFlow.cs:672-696` pause
 * behaviour where scheduler updates are suspended.
 */
export class LeftInfoPanel {
  private root: HTMLDivElement;
  private playerCountEl: HTMLSpanElement;
  private entryFeeEl: HTMLSpanElement;
  private prizeEl: HTMLSpanElement;
  private numberRingEl: HTMLDivElement;
  private progressEl: HTMLDivElement;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private countdownDeadline = 0;
  private bridge: PauseAwareBridge | null = null;

  constructor(overlay: HtmlOverlayManager, bridge?: PauseAwareBridge) {
    this.bridge = bridge ?? null;
    this.root = overlay.createElement("left-panel", {
      flexShrink: "0",
      alignSelf: "flex-start",
      display: "grid",
      gridTemplateColumns: "auto auto",
      columnGap: "40px",
      alignItems: "center",
      padding: "15px 0 18px 0",
      marginLeft: "40px",
    });

    // Column 1: Player info
    const colPlayer = document.createElement("div");
    colPlayer.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    const playerRow = document.createElement("div");
    playerRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700;color:#ddd;";
    playerRow.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`;
    this.playerCountEl = document.createElement("span");
    this.playerCountEl.textContent = "0";
    playerRow.appendChild(this.playerCountEl);
    colPlayer.appendChild(playerRow);

    const betInfo = document.createElement("div");
    betInfo.style.cssText = "font-size:14px;color:#bbb;line-height:1.8;";
    this.entryFeeEl = document.createElement("span");
    this.entryFeeEl.textContent = "Innsats: 0 kr";
    this.prizeEl = document.createElement("span");
    this.prizeEl.textContent = "Gevinst: 0 kr";
    betInfo.appendChild(this.entryFeeEl);
    betInfo.appendChild(document.createElement("br"));
    betInfo.appendChild(this.prizeEl);
    colPlayer.appendChild(betInfo);

    this.root.appendChild(colPlayer);

    // Column 2: Number ring + progress
    const colRing = document.createElement("div");
    colRing.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px;";

    this.numberRingEl = document.createElement("div");
    Object.assign(this.numberRingEl.style, {
      width: "90px",
      height: "90px",
      borderRadius: "50%",
      background: "radial-gradient(circle at 38% 32%, #c0392b, #7b1010 70%)",
      border: "3px solid #e53935",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "42px",
      fontWeight: "700",
      color: "#fff",
    });
    this.numberRingEl.textContent = "--";
    colRing.appendChild(this.numberRingEl);

    this.progressEl = document.createElement("div");
    this.progressEl.style.cssText = "font-size:13px;color:#aaa;";
    this.progressEl.textContent = "0/0";
    colRing.appendChild(this.progressEl);

    this.root.appendChild(colRing);
  }

  update(
    playerCount: number,
    totalStake: number,
    prizePool: number,
    lastDrawnNumber: number | null,
    drawCount: number,
    totalDrawCapacity: number,
    players?: Player[],
  ): void {
    // G2/G3: Count unique halls from player data
    let hallCount = 0;
    if (players && players.length > 0) {
      const halls = new Set<string>();
      for (const p of players) {
        if (p.hallId) halls.add(p.hallId);
      }
      hallCount = halls.size;
    }

    const countStr = String(playerCount).padStart(2, "0");
    this.playerCountEl.textContent = hallCount > 1
      ? `${countStr} (${hallCount} haller)`
      : countStr;

    // BIN-686 Bug 2: previously showed "Innsats: —" (em-dash) when stake
    // was 0, which users read as missing/broken. Always show kroner — the
    // 0-case is legitimate UX (bruker har ingen innsats enda) and the
    // dash was a leftover from a placeholder phase.
    this.entryFeeEl.textContent = `Innsats: ${totalStake} kr`;
    this.prizeEl.textContent = `Gevinst: ${prizePool} kr`;
    // Unity: last drawn number is zero-padded 2 digits ("07", "42")
    this.numberRingEl.textContent = lastDrawnNumber !== null
      ? String(lastDrawnNumber).padStart(2, "0")
      : "--";
    this.progressEl.textContent = `${drawCount}/${totalDrawCapacity}`;
  }

  /**
   * Start countdown mode — show seconds remaining in the number ring.
   */
  startCountdown(millisUntilStart: number): void {
    this.stopCountdown();

    if (millisUntilStart <= 0) {
      this.numberRingEl.textContent = "...";
      this.progressEl.textContent = "";
      return;
    }

    this.countdownDeadline = Date.now() + millisUntilStart;
    this.updateCountdownDisplay();

    this.countdownInterval = setInterval(() => {
      // BIN-420 G23: respect server-authoritative pause — freeze display.
      if (this.bridge?.getState().isPaused) {
        this.countdownDeadline += 250;
        return;
      }
      this.updateCountdownDisplay();
    }, 250);
  }

  /** Late-wire bridge (tests use this; controller passes in constructor). */
  setBridge(bridge: PauseAwareBridge): void {
    this.bridge = bridge;
  }

  stopCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private updateCountdownDisplay(): void {
    const remaining = Math.ceil((this.countdownDeadline - Date.now()) / 1000);
    if (remaining <= 0) {
      this.numberRingEl.textContent = "...";
      this.progressEl.textContent = "";
      this.stopCountdown();
    } else {
      const formatted = this.formatCountdown(remaining);
      this.numberRingEl.textContent = formatted;
      this.progressEl.textContent = `Neste spill om ${formatted}`;
    }
  }

  /** Format seconds as MM:SS (e.g. 150 → "02:30", 45 → "00:45"). */
  private formatCountdown(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  destroy(): void {
    this.stopCountdown();
    this.root.remove();
  }
}
