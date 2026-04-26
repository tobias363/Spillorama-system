/**
 * Loading overlay — matches Unity's UtilityLoaderPanel.
 *
 * Shows a centered spinner + message. Now driven by a typed state-machine
 * (BIN-673) that covers the full mount → play flow:
 *   - CONNECTING:   pre-socket handshake
 *   - JOINING_ROOM: post-connect, pre-room-ack
 *   - LOADING_ASSETS: Pixi assets + audio preload
 *   - SYNCING:      waiting for first post-snapshot live event (late-join)
 *   - RECONNECTING: socket dropped, attempting reconnect
 *   - RESYNCING:    reconnected, waiting for fresh state snapshot (BIN-682)
 *   - DISCONNECTED: dropped with no auto-recovery in flight
 *   - READY:        hidden
 *
 * Each state has a default message but can be overridden. If a state lingers
 * more than `stuckThresholdMs` (default 5s), a "Last siden på nytt" reload
 * button appears so the user can escape.
 *
 *   - UtilityLoaderPanel.ShowLoader() / HideLoader()
 *   - Game1GamePlayPanel.DisplayLoader(true/false)
 */

export type LoadingState =
  | "CONNECTING"
  | "JOINING_ROOM"
  | "LOADING_ASSETS"
  | "SYNCING"
  | "RECONNECTING"
  | "RESYNCING"
  | "DISCONNECTED"
  | "READY";

const DEFAULT_MESSAGES: Record<Exclude<LoadingState, "READY">, string> = {
  CONNECTING: "Kobler til...",
  JOINING_ROOM: "Finner runden...",
  LOADING_ASSETS: "Laster spill...",
  SYNCING: "Henter rundedata...",
  RECONNECTING: "Kobler til igjen...",
  RESYNCING: "Oppdaterer spillet...",
  DISCONNECTED: "Frakoblet — prøver igjen...",
};

export interface LoadingOverlayOptions {
  /** Show the reload button if a state stays active this long. Default 5000ms. */
  stuckThresholdMs?: number;
  /** Override onClick for the reload button (testing). Default: `location.reload()`. */
  onReload?: () => void;
}

export class LoadingOverlay {
  private backdrop: HTMLDivElement;
  private messageEl: HTMLDivElement;
  private reloadBtn: HTMLButtonElement;
  private state: LoadingState = "READY";
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stuckThresholdMs: number;
  private readonly onReload: () => void;

  constructor(container: HTMLElement, opts: LoadingOverlayOptions = {}) {
    this.stuckThresholdMs = opts.stuckThresholdMs ?? 5000;
    this.onReload = opts.onReload ?? (() => window.location.reload());

    this.backdrop = document.createElement("div");
    // Live-region so screen-readers announce loading-state changes.
    this.backdrop.setAttribute("role", "status");
    this.backdrop.setAttribute("aria-live", "polite");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.7)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: "16px",
      zIndex: "100",
      pointerEvents: "auto",
    });
    container.appendChild(this.backdrop);

    // Spinner
    const spinner = document.createElement("div");
    spinner.setAttribute("aria-hidden", "true");
    spinner.style.cssText = `
      width:48px;height:48px;
      border:4px solid rgba(255,255,255,0.2);
      border-top-color:#ffe83d;
      border-radius:50%;
      animation:loader-spin 0.8s linear infinite;
    `;
    this.backdrop.appendChild(spinner);

    // Message text
    this.messageEl = document.createElement("div");
    this.messageEl.style.cssText = "color:#ccc;font-size:16px;font-weight:500;text-align:center;max-width:400px;";
    this.messageEl.textContent = "Laster...";
    this.backdrop.appendChild(this.messageEl);

    // Reload button — hidden by default, appears after stuckThresholdMs
    this.reloadBtn = document.createElement("button");
    this.reloadBtn.type = "button";
    this.reloadBtn.textContent = "Last siden på nytt";
    this.reloadBtn.style.cssText = `
      display:none;
      margin-top:12px;
      background:linear-gradient(180deg,#c41030,#8a0020);
      border:none;
      border-radius:8px;
      padding:10px 24px;
      color:#fff;
      font-size:14px;
      font-weight:600;
      cursor:pointer;
      font-family:inherit;
    `;
    this.reloadBtn.addEventListener("click", () => this.onReload());
    this.backdrop.appendChild(this.reloadBtn);

    // Inject keyframe (once)
    if (!document.getElementById("loader-spin-style")) {
      const style = document.createElement("style");
      style.id = "loader-spin-style";
      style.textContent = `@keyframes loader-spin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }
  }

  /**
   * BIN-673: Set the loading state. This drives the message, visibility, and
   * stuck-timer. Preferred over raw show()/hide() for semantic clarity and
   * unit-testability.
   *
   * Calling setState("READY") hides the overlay and cancels any stuck timer.
   * Calling with a custom message overrides the default for the state.
   */
  setState(state: LoadingState, customMessage?: string): void {
    this.state = state;
    this.cancelStuckTimer();
    this.reloadBtn.style.display = "none";

    if (state === "READY") {
      this.backdrop.style.display = "none";
      return;
    }

    this.messageEl.textContent = customMessage ?? DEFAULT_MESSAGES[state];
    this.backdrop.style.display = "flex";

    // Start stuck-timer for recoverable states. DISCONNECTED shows reload
    // immediately — there's no auto-recovery to wait for.
    if (state === "DISCONNECTED") {
      this.reloadBtn.style.display = "inline-block";
    } else {
      this.stuckTimer = setTimeout(() => {
        this.reloadBtn.style.display = "inline-block";
      }, this.stuckThresholdMs);
    }
  }

  /** Current state — useful for tests and transition-guards. */
  getState(): LoadingState {
    return this.state;
  }

  /**
   * Legacy API — prefer setState(). Kept for backward-compatibility with
   * call-sites that pass arbitrary messages.
   */
  show(message = "Laster..."): void {
    // Map to SYNCING with custom message — semantically this was the closest
    // match, and the stuck-timer behaves the same.
    this.setState("SYNCING", message);
  }

  /** Legacy API — prefer setState("READY"). */
  hide(): void {
    this.setState("READY");
  }

  isShowing(): boolean {
    return this.state !== "READY";
  }

  destroy(): void {
    this.cancelStuckTimer();
    this.backdrop.remove();
  }

  private cancelStuckTimer(): void {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
  }
}
