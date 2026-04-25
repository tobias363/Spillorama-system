import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
import type { Player } from "@spillorama/shared-types/game";

/** Bridge-state shape kept for API parity — countdown logic now lives in CenterBall. */
interface PauseAwareBridge {
  getState(): { isPaused: boolean };
}

/**
 * Player-info column from the 2026-04-23 redesign (mockup `.col-player`).
 *  - Row 1: person-icon + 2-digit zero-padded player count (e.g. "02").
 *  - Row 2: "Innsats: X kr" + "Gevinst: Y kr" on two lines.
 *
 * The old "number ring + progress" column has been removed — the big ring
 * is now owned by CenterBall (Pixi) per the mockup's `.game-number-ring`.
 * Countdown methods are preserved as no-ops so PlayScreen's existing call
 * sites keep working; the countdown display itself is rendered by CenterBall.
 */
export class LeftInfoPanel {
  private root: HTMLDivElement;
  private playerCountEl: HTMLSpanElement;
  private entryFeeEl: HTMLSpanElement;
  private prizeEl: HTMLSpanElement;
  /**
   * Round-state-isolation (Tobias 2026-04-25): "Forhåndskjøp"-rad vises kun
   * når myPendingStake > 0 (mid-round arm for neste runde). Skjult ellers
   * for å unngå støy mellom runder hvor pre-round IS aktiv-stake.
   */
  private pendingStakeRow: HTMLDivElement;
  private pendingStakeEl: HTMLSpanElement;
  private bridge: PauseAwareBridge | null = null;

  constructor(overlay: HtmlOverlayManager, bridge?: PauseAwareBridge) {
    this.bridge = bridge ?? null;
    this.root = overlay.createElement("left-panel", {
      pointerEvents: "auto",
      flexShrink: "0",
      alignSelf: "flex-start",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      paddingTop: "35px",
      paddingRight: "21px",
      minWidth: "120px",
      marginLeft: "20px",
    });

    // Row 1: icon + count
    const playerRow = document.createElement("div");
    playerRow.className = "player-info";
    playerRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#fff;";
    playerRow.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`;
    this.playerCountEl = document.createElement("span");
    this.playerCountEl.textContent = "00";
    playerRow.appendChild(this.playerCountEl);
    this.root.appendChild(playerRow);

    // Row 2: bet info
    const betInfo = document.createElement("div");
    betInfo.className = "bet-info";
    betInfo.style.cssText = "font-size:16px;color:#bbb;line-height:1.6;";
    this.entryFeeEl = document.createElement("span");
    this.entryFeeEl.textContent = "Innsats: 0 kr";
    this.prizeEl = document.createElement("span");
    this.prizeEl.textContent = "Gevinst: 0 kr";
    betInfo.appendChild(this.entryFeeEl);
    betInfo.appendChild(document.createElement("br"));
    betInfo.appendChild(this.prizeEl);
    this.root.appendChild(betInfo);

    // Row 3: forhåndskjøp (next-round commitment, hidden by default).
    // Round-state-isolation: when a player has armed pre-round tickets DURING
    // a running round, the money is reserved but the brett play in the NEXT
    // round. Vises som egen rad så bruker forstår at dette er separat fra
    // aktiv-rundens innsats.
    this.pendingStakeRow = document.createElement("div");
    this.pendingStakeRow.className = "pending-stake-info";
    this.pendingStakeRow.style.cssText =
      "font-size:13px;color:#9bd49b;line-height:1.4;display:none;margin-top:2px;";
    this.pendingStakeEl = document.createElement("span");
    this.pendingStakeEl.textContent = "Forhåndskjøp: 0 kr";
    this.pendingStakeRow.appendChild(this.pendingStakeEl);
    this.root.appendChild(this.pendingStakeRow);
  }

  // BIN-blink-permanent-fix: memoize text-writes. `.textContent = X` erstatter
  // alltid text-noden selv om strengen er lik (spec'd oppførsel), så hver
  // state-update (ofte ~5/sek) genererte 3 childList-mutasjoner på dette
  // panelet uten at noe faktisk endret seg. Cache forrige verdi og skipp
  // DOM-writes når ingen endring.
  private lastPlayerCount = "";
  private lastEntryFee = "";
  private lastPrize = "";
  private lastPendingStake = -1;

  update(
    playerCount: number,
    totalStake: number,
    myWinnings: number,
    _lastDrawnNumber: number | null,
    _drawCount: number,
    _totalDrawCapacity: number,
    players?: Player[],
    pendingStake: number = 0,
  ): void {
    // G2/G3: multi-hall labelling.
    let hallCount = 0;
    if (players && players.length > 0) {
      const halls = new Set<string>();
      for (const p of players) {
        if (p.hallId) halls.add(p.hallId);
      }
      hallCount = halls.size;
    }

    const countStr = String(playerCount).padStart(2, "0");
    const nextPlayerCount = hallCount > 1
      ? `${countStr} (${hallCount} haller)`
      : countStr;
    if (nextPlayerCount !== this.lastPlayerCount) {
      this.playerCountEl.textContent = nextPlayerCount;
      this.lastPlayerCount = nextPlayerCount;
    }

    const nextEntryFee = `Innsats: ${totalStake} kr`;
    if (nextEntryFee !== this.lastEntryFee) {
      this.entryFeeEl.textContent = nextEntryFee;
      this.lastEntryFee = nextEntryFee;
    }

    // "Gevinst" = this player's accumulated winnings this round (see PlayScreen
    // summation) — not the full prize pool (2026-04-21 Tobias-report).
    const nextPrize = `Gevinst: ${myWinnings} kr`;
    if (nextPrize !== this.lastPrize) {
      this.prizeEl.textContent = nextPrize;
      this.lastPrize = nextPrize;
    }

    // Forhåndskjøp: kun vis når > 0 (mid-round arm for neste runde). Mellom
    // runder havner pre-round-arm i totalStake/Innsats, så vi unngår dobbel-
    // visning ved å skjule denne raden helt når 0.
    if (pendingStake !== this.lastPendingStake) {
      if (pendingStake > 0) {
        this.pendingStakeEl.textContent = `Forhåndskjøp: ${pendingStake} kr`;
        this.pendingStakeRow.style.display = "block";
      } else {
        this.pendingStakeRow.style.display = "none";
      }
      this.lastPendingStake = pendingStake;
    }
  }

  /** Expose the root element so PlayScreen can re-parent it into the
   *  shared top-row wrapper (player-info + combo-panel). */
  get rootEl(): HTMLDivElement {
    return this.root;
  }

  /** No-op — CenterBall owns the countdown display in the new design. */
  startCountdown(_millisUntilStart: number): void {}

  /** No-op — matches startCountdown. */
  stopCountdown(): void {}

  setBridge(bridge: PauseAwareBridge): void {
    this.bridge = bridge;
  }

  destroy(): void {
    this.root.remove();
  }
}
