/**
 * Loading overlay — Spillorama-branded full-screen loader (Tobias-direktiv 2026-05-03).
 *
 * Replaces the legacy spinner with the design from Claude Design (Loading.html):
 *   - Burgundy background image (loading-bg.png)
 *   - Centered Spillorama wheel-logo with breathe + bounce + glow animations
 *   - "LASTER SPILL..." caption with animated dots (Outfit-font, gold-tinted)
 *   - Radial vignette overlay for depth
 *
 * Driven by a typed state-machine (BIN-673) covering the full mount → play flow:
 *   - CONNECTING:   pre-socket handshake
 *   - JOINING_ROOM: post-connect, pre-room-ack
 *   - LOADING_ASSETS: Pixi assets + audio preload
 *   - SYNCING:      waiting for first post-snapshot live event (late-join)
 *   - RECONNECTING: socket dropped, attempting reconnect
 *   - RESYNCING:    reconnected, waiting for fresh state snapshot (BIN-682)
 *   - DISCONNECTED: dropped with no auto-recovery in flight → error-state
 *   - READY:        hidden
 *
 * Tobias-direktiv 2026-05-03 (Spill 1, 2, 3):
 *   - "Skal ALLTID vises når noe laster" — overlay covers the canvas anytime
 *     a controller is between mount and ready (kunden skal aldri se en hvit/svart skjerm).
 *   - Connection-error fallback: when state goes to DISCONNECTED (eller stuck-timer
 *     utløper), overlay bytter tekst til "Får ikke koblet til rom. Trykk her" og
 *     HELE overlayet blir klikkbart → window.location.reload().
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
  CONNECTING: "Kobler til",
  JOINING_ROOM: "Finner runden",
  LOADING_ASSETS: "Laster spill",
  SYNCING: "Henter rundedata",
  RECONNECTING: "Kobler til igjen",
  RESYNCING: "Oppdaterer spillet",
  DISCONNECTED: "Frakoblet",
};

/**
 * Tobias-direktiv 2026-05-03: copy used for connection-error fallback.
 * Hele overlayet er klikkbart i denne tilstanden.
 */
const ERROR_MESSAGE_DEFAULT = "Får ikke koblet til rom. Trykk her";

/** Asset path under express.static — see vite.config.ts base="/web/games/". */
const ASSET_BASE = "/web/games/assets/loading";
const BG_URL = `${ASSET_BASE}/loading-bg.png`;
const LOGO_URL = `${ASSET_BASE}/spillorama-wheel-logo.png`;

/**
 * One-shot stylesheet injection. Keyed by id so multiple instances share
 * the same `<style>` tag in the head.
 */
const STYLE_ELEMENT_ID = "spillorama-loading-overlay-style";

const STYLESHEET = `
@keyframes spillorama-loading-bounce {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-14px); }
}
@keyframes spillorama-loading-breathe {
  0%, 100% { transform: scale(0.95) translateY(8px); opacity: 0.7; }
  50%      { transform: scale(1.10) translateY(0);   opacity: 1; }
}
@keyframes spillorama-loading-glow {
  0%, 100% {
    filter:
      drop-shadow(0 10px 28px rgba(0,0,0,0.55))
      drop-shadow(0 0 18px rgba(255, 200, 90, 0.18));
  }
  50% {
    filter:
      drop-shadow(0 18px 22px rgba(0,0,0,0.45))
      drop-shadow(0 0 36px rgba(255, 220, 130, 0.6));
  }
}
@keyframes spillorama-loading-dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}

.spillorama-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: none;
  background: #2a070d url('${BG_URL}') center / cover no-repeat;
  font-family: 'Outfit', 'Inter', system-ui, sans-serif;
  color: #fff;
  overflow: hidden;
  user-select: none;
  pointer-events: auto;
}

/* Vignette */
.spillorama-loading-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.65) 100%);
}

.spillorama-loading-overlay__inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(8px, 1.5vh, 18px);
  padding: 0 6vw;
  z-index: 1;
}

.spillorama-loading-overlay__logo-wrap {
  position: relative;
  width: min(46vh, 360px);
  aspect-ratio: 1 / 1;
}

.spillorama-loading-overlay__logo-wrap::before {
  content: '';
  position: absolute;
  inset: -8%;
  border-radius: 50%;
  background: radial-gradient(circle at center, rgba(255, 210, 120, 0.35), rgba(255, 210, 120, 0) 62%);
  z-index: 1;
  animation: spillorama-loading-breathe 1.6s ease-in-out infinite;
  pointer-events: none;
}

.spillorama-loading-overlay__logo-img {
  width: 100%;
  height: 100%;
  display: block;
  position: relative;
  z-index: 2;
  filter:
    drop-shadow(0 10px 28px rgba(0,0,0,0.55))
    drop-shadow(0 0 26px rgba(255, 200, 90, 0.28));
  animation:
    spillorama-loading-bounce 1.6s ease-in-out infinite,
    spillorama-loading-glow 1.6s ease-in-out infinite;
  -webkit-user-drag: none;
}

.spillorama-loading-overlay__label {
  font-family: 'Outfit', system-ui, sans-serif;
  font-weight: 600;
  font-size: clamp(20px, 2.6vh, 30px);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #E8E3E7;
  text-shadow: 0 2px 6px rgba(0,0,0,0.45);
  text-align: center;
  max-width: 90vw;
}

.spillorama-loading-overlay__dots {
  display: inline-block;
  width: 1.4em;
  text-align: left;
  color: #E8E3E7;
}
.spillorama-loading-overlay__dots::after {
  content: '';
  animation: spillorama-loading-dots 1.4s steps(4, end) infinite;
}

/* Error-state — clickable, no dots animation */
.spillorama-loading-overlay--error {
  cursor: pointer;
}
.spillorama-loading-overlay--error .spillorama-loading-overlay__dots {
  display: none;
}
.spillorama-loading-overlay--error .spillorama-loading-overlay__logo-img {
  /* Settle the bounce/glow to a calm steady-state — error is not "still loading" */
  animation: none;
  filter:
    drop-shadow(0 10px 28px rgba(0,0,0,0.55))
    drop-shadow(0 0 18px rgba(255, 200, 90, 0.22));
}
.spillorama-loading-overlay--error .spillorama-loading-overlay__logo-wrap::before {
  animation: none;
  opacity: 0.7;
  transform: scale(1.0);
}
`;

function ensureStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = STYLESHEET;
  document.head.appendChild(style);
}

export interface LoadingOverlayOptions {
  /** Show the error fallback if a state stays active this long. Default 5000ms. */
  stuckThresholdMs?: number;
  /** Override onClick for the error fallback (testing). Default: `location.reload()`. */
  onReload?: () => void;
}

export class LoadingOverlay {
  private backdrop: HTMLDivElement;
  private inner: HTMLDivElement;
  private logoWrap: HTMLDivElement;
  private logoImg: HTMLImageElement;
  private labelEl: HTMLDivElement;
  private labelText: HTMLSpanElement;
  private dotsEl: HTMLSpanElement;
  private state: LoadingState = "READY";
  private isErrorState = false;
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stuckThresholdMs: number;
  private readonly onReload: () => void;
  private readonly handleErrorClick: () => void;

  constructor(container: HTMLElement, opts: LoadingOverlayOptions = {}) {
    this.stuckThresholdMs = opts.stuckThresholdMs ?? 5000;
    this.onReload = opts.onReload ?? (() => window.location.reload());
    this.handleErrorClick = () => this.onReload();

    ensureStylesheet();

    this.backdrop = document.createElement("div");
    this.backdrop.className = "spillorama-loading-overlay";
    // Live-region so screen-readers announce loading-state changes.
    this.backdrop.setAttribute("role", "status");
    this.backdrop.setAttribute("aria-live", "polite");

    this.inner = document.createElement("div");
    this.inner.className = "spillorama-loading-overlay__inner";

    this.logoWrap = document.createElement("div");
    this.logoWrap.className = "spillorama-loading-overlay__logo-wrap";

    this.logoImg = document.createElement("img");
    this.logoImg.className = "spillorama-loading-overlay__logo-img";
    this.logoImg.src = LOGO_URL;
    this.logoImg.alt = "Spillorama";
    this.logoImg.draggable = false;
    this.logoWrap.appendChild(this.logoImg);

    this.labelEl = document.createElement("div");
    this.labelEl.className = "spillorama-loading-overlay__label";

    this.labelText = document.createElement("span");
    this.labelText.textContent = DEFAULT_MESSAGES.CONNECTING;

    this.dotsEl = document.createElement("span");
    this.dotsEl.className = "spillorama-loading-overlay__dots";

    this.labelEl.appendChild(this.labelText);
    this.labelEl.appendChild(this.dotsEl);

    this.inner.appendChild(this.logoWrap);
    this.inner.appendChild(this.labelEl);
    this.backdrop.appendChild(this.inner);

    container.appendChild(this.backdrop);
  }

  /**
   * BIN-673: Set the loading state. This drives the message, visibility, and
   * stuck-timer. Preferred over raw show()/hide() for semantic clarity and
   * unit-testability.
   *
   * Calling setState("READY") hides the overlay and cancels any stuck timer.
   * Calling with a custom message overrides the default for the state.
   *
   * Tobias-direktiv 2026-05-03:
   *   - DISCONNECTED transitions immediately to the error-fallback
   *     ("Får ikke koblet til rom. Trykk her", whole-overlay-click reloads).
   *   - For all other recoverable states, the stuck-timer (default 5s)
   *     surfaces the same error-fallback so the user is never permanently stuck.
   */
  setState(state: LoadingState, customMessage?: string): void {
    this.state = state;
    this.cancelStuckTimer();

    if (state === "READY") {
      this.exitErrorState();
      this.backdrop.style.display = "none";
      return;
    }

    // DISCONNECTED is terminal — no auto-recovery is in flight, so show the
    // Tobias-direktiv error fallback immediately rather than waiting for the
    // stuck timer. A custom message wins over the default error text.
    if (state === "DISCONNECTED") {
      this.exitErrorState(); // reset before re-entering so role/listener are fresh
      this.labelText.textContent = customMessage ?? ERROR_MESSAGE_DEFAULT;
      this.backdrop.style.display = "block";
      this.enterErrorState();
      return;
    }

    // Non-READY recoverable: ensure overlay visible and any error-state cleared.
    this.exitErrorState();
    this.labelText.textContent = customMessage ?? DEFAULT_MESSAGES[state];
    this.backdrop.style.display = "block";

    // For recoverable states, schedule the stuck-timer fallback. When it
    // fires we also swap the label to the explicit error copy so the user
    // sees the same Tobias-direktiv "Trykk her"-affordance.
    this.stuckTimer = setTimeout(() => {
      this.labelText.textContent = ERROR_MESSAGE_DEFAULT;
      this.enterErrorState();
    }, this.stuckThresholdMs);
  }

  /**
   * Tobias-direktiv 2026-05-03: explicitly switch to the error fallback even
   * if no socket-state event fired (e.g. room-join HTTP-error). The whole
   * overlay becomes clickable → reload.
   */
  setError(message: string = ERROR_MESSAGE_DEFAULT): void {
    this.cancelStuckTimer();
    this.labelText.textContent = message;
    this.backdrop.style.display = "block";
    this.enterErrorState();
  }

  /** Current state — useful for tests and transition-guards. */
  getState(): LoadingState {
    return this.state;
  }

  /** True when the overlay is currently in the click-to-reload error state. */
  isInErrorState(): boolean {
    return this.isErrorState;
  }

  /**
   * Legacy API — prefer setState(). Kept for backward-compatibility with
   * call-sites that pass arbitrary messages.
   */
  show(message = "Laster spill"): void {
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
    if (this.isErrorState) {
      this.backdrop.removeEventListener("click", this.handleErrorClick);
    }
    this.backdrop.remove();
  }

  /**
   * Switch into the error fallback state. The label text is **not** overwritten
   * here — callers (`setState("DISCONNECTED")`, `setError(msg)`, the stuck-
   * timer) own the message; this helper only flips the visual state, ARIA
   * role, and click-to-reload listener.
   */
  private enterErrorState(): void {
    if (this.isErrorState) return; // Idempotent — listener already attached.
    this.isErrorState = true;
    this.backdrop.classList.add("spillorama-loading-overlay--error");
    this.backdrop.setAttribute("role", "alert");
    this.backdrop.addEventListener("click", this.handleErrorClick);
  }

  private exitErrorState(): void {
    if (!this.isErrorState) return;
    this.isErrorState = false;
    this.backdrop.classList.remove("spillorama-loading-overlay--error");
    this.backdrop.setAttribute("role", "status");
    this.backdrop.removeEventListener("click", this.handleErrorClick);
  }

  private cancelStuckTimer(): void {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
  }
}
