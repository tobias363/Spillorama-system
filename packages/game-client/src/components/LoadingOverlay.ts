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
 *   - Connection-error fallback: when state goes to DISCONNECTED, overlay bytter
 *     tekst til "Får ikke koblet til rom. Trykk her" og HELE overlayet blir
 *     klikkbart → window.location.reload().
 *
 * Tobias-bug 2026-05-14 (BUG-A defense-in-depth — frontend-side):
 *   "Når runden er over så står det bare å laster. Rommet lastes ikke inn og
 *   man er nødt til å laste inn siden på nytt."
 *
 *   Event-stream-trace 07:40:07-07:43 viste at klient transitioner LOADING →
 *   WAITING, åpner buy-popup gate (willOpen=true gameStatus=NONE), så blir
 *   det 4+ min stillhet. Backend hadde stuck plan-run og emittet aldri ny
 *   room:update. Tidligere overlay-policy var: 5s stuck-timer → harsh
 *   "Få ikke koblet til rom. Trykk her" (whole-overlay-click reload).
 *
 *   Problem: full sidereload er invasivt og bryter aktive socket-state +
 *   pre-armed bonger. Spilleren ser også "Laster spill"-spinner i hele
 *   denne perioden uten klart actionable alternativ.
 *
 *   Fix: legg inn en SOFT fallback ved 8s som viser "Venter på neste spill"
 *   + "Prøv igjen"-knapp. Knappen kaller `onRetry`-callback (typisk
 *   `socket.resumeRoom`) i stedet for full reload. Den eksisterende harsh
 *   fallback ("Trykk her for å laste på nytt") trigges fortsatt eksplisitt
 *   via `setError()` eller `setState("DISCONNECTED")` — den auto-firing-
 *   atferden er nå soft fallback i stedet.
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

/**
 * Tobias-direktiv 2026-05-03: alle loading-states viser samme tekst —
 * "Laster spill". Tidligere state-spesifikke meldinger (Kobler til /
 * Finner runden / Henter rundedata / Syncer / etc.) er fjernet for å
 * gi spilleren én enhetlig opplevelse uavhengig av underliggende
 * socket/room/asset-fase.
 */
const LOADING_LABEL = "Laster spill";
const DEFAULT_MESSAGES: Record<Exclude<LoadingState, "READY">, string> = {
  CONNECTING: LOADING_LABEL,
  JOINING_ROOM: LOADING_LABEL,
  LOADING_ASSETS: LOADING_LABEL,
  SYNCING: LOADING_LABEL,
  RECONNECTING: LOADING_LABEL,
  RESYNCING: LOADING_LABEL,
  DISCONNECTED: LOADING_LABEL,
};

/**
 * Tobias-direktiv 2026-05-03: copy used for connection-error fallback.
 * Hele overlayet er klikkbart i denne tilstanden.
 */
const ERROR_MESSAGE_DEFAULT = "Får ikke koblet til rom. Trykk her";

/**
 * Tobias-bug 2026-05-14 (BUG-A defense-in-depth): soft fallback copy + retry-
 * button label. Shown ved 8s stuck-timeout — mer beskrivende enn "Laster
 * spill" og signaliserer at klient venter på server-state (ikke at klient
 * selv har hengt seg).
 */
export const SOFT_FALLBACK_HEADLINE = "Venter på neste spill";
export const SOFT_FALLBACK_BODY = "Spillerommet er klart — venter på at neste runde starter.";
export const SOFT_FALLBACK_RETRY_LABEL = "Prøv igjen";

/**
 * Tobias-bug 2026-05-14: default soft-fallback-grense. 8s er valgt fordi:
 *   - Normal initial-join (connect + create-room + snapshot) er typisk < 2s
 *     på sane nettverk. 8s gir 4× buffer.
 *   - 5s var for kort — flaky connections trigger fallback mens reell
 *     recovery er pågående.
 *   - 10s+ er for lenge — kunden mister tillit hvis intet skjer på skjermen.
 *
 * Konfigurerbar via `LoadingOverlayOptions.softFallbackMs`. Sett til 0 for
 * å disable soft fallback (eks. visual harness eller test som bare vil ha
 * harsh fallback).
 */
export const DEFAULT_SOFT_FALLBACK_MS = 8000;

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

/* Soft-fallback state (Tobias-bug 2026-05-14 BUG-A defense-in-depth) —
 * vises ved 8s timeout. Logo-animasjon dempes til pulsering så brukeren
 * ser at det er en bevisst ventende tilstand, ikke en frys. Retry-knapp
 * er klikkbar, men overlay selv er IKKE whole-overlay-click (forhindrer
 * utilsiktet reload). */
.spillorama-loading-overlay--soft-fallback {
  cursor: default;
}
.spillorama-loading-overlay--soft-fallback .spillorama-loading-overlay__dots {
  display: none;
}
.spillorama-loading-overlay--soft-fallback .spillorama-loading-overlay__logo-img {
  /* Behold bounce, men dempet glow så det signaliserer "bevisst venting" */
  animation: spillorama-loading-bounce 2.2s ease-in-out infinite;
  filter:
    drop-shadow(0 10px 28px rgba(0,0,0,0.55))
    drop-shadow(0 0 22px rgba(255, 200, 90, 0.20));
}
.spillorama-loading-overlay__soft-body {
  font-family: 'Outfit', system-ui, sans-serif;
  font-size: clamp(14px, 1.8vh, 17px);
  font-weight: 400;
  color: #C0B9BE;
  text-align: center;
  max-width: 90vw;
  margin-top: 4px;
  letter-spacing: 0.02em;
  animation: spillorama-loading-soft-fade-in 400ms ease-out;
}
.spillorama-loading-overlay__soft-retry {
  margin-top: clamp(14px, 2.2vh, 22px);
  padding: 12px 28px;
  border-radius: 999px;
  border: 1.5px solid rgba(255, 210, 120, 0.55);
  background: linear-gradient(135deg, rgba(255, 200, 90, 0.18), rgba(255, 220, 130, 0.08));
  color: #FFE9C2;
  font-family: 'Outfit', system-ui, sans-serif;
  font-weight: 600;
  font-size: clamp(15px, 1.9vh, 18px);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;
  transition: transform 120ms ease, background 200ms ease, border-color 200ms ease;
  animation: spillorama-loading-soft-fade-in 400ms ease-out;
}
.spillorama-loading-overlay__soft-retry:hover {
  background: linear-gradient(135deg, rgba(255, 200, 90, 0.32), rgba(255, 220, 130, 0.18));
  border-color: rgba(255, 220, 140, 0.85);
  transform: translateY(-1px);
}
.spillorama-loading-overlay__soft-retry:active {
  transform: translateY(0);
}
.spillorama-loading-overlay__soft-retry[disabled] {
  opacity: 0.55;
  cursor: progress;
}
@keyframes spillorama-loading-soft-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
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

/**
 * Tobias-bug 2026-05-14: payload som sendes til soft-fallback-listeners
 * (Sentry / EventTracker / debug-HUD). Lar caller-en korrelere fallback-
 * events med samtidig server-state.
 */
export interface SoftFallbackInfo {
  /** Loader-state when the soft-fallback timer fired. */
  triggeredState: LoadingState;
  /** `Date.now()` when fallback became active. */
  triggeredAt: number;
  /** Milliseconds the loader sat in this state before fallback fired. */
  timeSinceLastUpdate: number;
}

export interface LoadingOverlayOptions {
  /**
   * Tobias-bug 2026-05-14 (BUG-A defense-in-depth): soft-fallback-grense.
   * Etter denne tida i en recoverable state vises "Venter på neste spill"
   * + retry-knapp. Default {@link DEFAULT_SOFT_FALLBACK_MS} (8000ms).
   * Sett 0 for å disable soft fallback.
   */
  softFallbackMs?: number;
  /**
   * @deprecated 2026-05-14 — Tobias BUG-A defense-in-depth. Tidligere drev
   * dette auto-firing av harsh "Får ikke koblet til rom"-fallback. Nå er
   * den harsh fallback eksklusivt for `setError()` + `setState("DISCONNECTED")`.
   *
   * Beholdes som alias for `softFallbackMs` så eksisterende tester ikke
   * brekker — verdien styrer nå soft-fallback-timer-en i stedet for harsh.
   * Hvis BÅDE `softFallbackMs` og `stuckThresholdMs` er satt vinner
   * `softFallbackMs`.
   */
  stuckThresholdMs?: number;
  /**
   * Override onClick for the harsh-error fallback. Default:
   * `location.reload()`. Trigges fra `setError()`,
   * `setState("DISCONNECTED")`, eller om brukeren klikker på selve overlay-
   * et når det er i harsh error-state.
   */
  onReload?: () => void;
  /**
   * Tobias-bug 2026-05-14: callback når soft-fallback retry-knapp trykkes.
   * Hvis ikke satt, faller knappen tilbake til `onReload`. Typisk wirer
   * caller dette til `socket.resumeRoom()` eller en lobby-refetch som
   * IKKE laster siden på nytt. Kan returnere `void` eller `Promise<void>` —
   * knappen disable-er seg mens callback er in-flight og re-enable-er
   * etter at promisen resolver.
   */
  onRetry?: () => void | Promise<void>;
  /**
   * Tobias-bug 2026-05-14: observability-hook. Kalles ETTER at soft-
   * fallback har aktivert seg (DOM oppdatert, retry-knapp synlig). Brukes
   * av Game1Controller til å skrive `screen.timeout-fallback`-event til
   * EventTracker + sende Sentry-breadcrumb. Best-effort: exceptions fra
   * listener fanges, så observability-feil tar ikke ned overlay-en.
   */
  onSoftFallback?: (info: SoftFallbackInfo) => void;
}

export class LoadingOverlay {
  private backdrop: HTMLDivElement;
  private inner: HTMLDivElement;
  private logoWrap: HTMLDivElement;
  private logoImg: HTMLImageElement;
  private labelEl: HTMLDivElement;
  private labelText: HTMLSpanElement;
  private dotsEl: HTMLSpanElement;
  /**
   * Tobias-bug 2026-05-14: soft-fallback DOM-elementer. Lazy-mountes første
   * gang fallback aktiveres for å holde initial paint lett.
   */
  private softBodyEl: HTMLDivElement | null = null;
  private softRetryBtn: HTMLButtonElement | null = null;
  private state: LoadingState = "READY";
  /** Tobias-bug 2026-05-14: `Date.now()` ved siste `setState()`-kall. Brukes
   * for å beregne `timeSinceLastUpdate` i soft-fallback-payloaden. */
  private stateChangedAt = Date.now();
  private isErrorState = false;
  /**
   * Tobias-bug 2026-05-14 (BUG-A defense-in-depth): soft-fallback aktiv-
   * flag. Idempotent — flere `enterSoftFallback`-kall fra timer + manual
   * `triggerSoftFallback` skal kun rendre ÉN ganger.
   */
  private isSoftFallbackActive = false;
  /** Soft-fallback timer (8s default). Pre-fires harsh error fallback. */
  private softFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly softFallbackMs: number;
  private readonly onReload: () => void;
  private onRetry: (() => void | Promise<void>) | null;
  private readonly onSoftFallback: ((info: SoftFallbackInfo) => void) | null;
  private readonly handleErrorClick: () => void;
  private readonly handleRetryClick: () => void;

  constructor(container: HTMLElement, opts: LoadingOverlayOptions = {}) {
    // Tobias-bug 2026-05-14: `softFallbackMs` er primær; `stuckThresholdMs`
    // beholdes som deprecated alias. 0 disable-er soft fallback helt.
    const rawSoftMs = opts.softFallbackMs ?? opts.stuckThresholdMs ?? DEFAULT_SOFT_FALLBACK_MS;
    this.softFallbackMs = Math.max(0, rawSoftMs);
    this.onReload = opts.onReload ?? (() => window.location.reload());
    this.onRetry = opts.onRetry ?? null;
    this.onSoftFallback = opts.onSoftFallback ?? null;
    this.handleErrorClick = () => this.onReload();
    this.handleRetryClick = () => {
      void this.invokeRetry();
    };

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
   * soft-fallback timer. Preferred over raw show()/hide() for semantic clarity
   * and unit-testability.
   *
   * Calling setState("READY") hides the overlay and cancels any pending timers.
   * Calling with a custom message overrides the default for the state.
   *
   * Tobias-direktiv 2026-05-03 + BUG-A 2026-05-14:
   *   - DISCONNECTED transitions immediately to the harsh error-fallback
   *     ("Får ikke koblet til rom. Trykk her", whole-overlay-click reloads).
   *   - For all other recoverable states, after `softFallbackMs` (default 8s)
   *     we surface a SOFT fallback ("Venter på neste spill" + retry-knapp)
   *     i stedet for harsh full-reload. Retry-knappen prøver `socket.resumeRoom`
   *     (eller annen ikke-destruktiv recovery-action) via `onRetry`-callback.
   *
   * Hvert nytt setState-kall canceller eksisterende soft-fallback-timer og
   * exiter eventuell aktiv soft-fallback. Det betyr at hver gang controlleren
   * mottar fersk state (RECONNECTING → CONNECTED → READY osv.) starter
   * timer-en på nytt.
   */
  setState(state: LoadingState, customMessage?: string): void {
    this.state = state;
    this.stateChangedAt = Date.now();
    this.cancelSoftFallbackTimer();

    if (state === "READY") {
      this.exitErrorState();
      this.exitSoftFallback();
      this.backdrop.style.display = "none";
      return;
    }

    // DISCONNECTED is terminal — no auto-recovery is in flight, so show the
    // Tobias-direktiv error fallback immediately rather than waiting for the
    // soft-fallback timer. Error-fallback bevarer ERROR_MESSAGE_DEFAULT-teksten
    // (klikkbar reload). customMessage ignoreres — alle loading-states bruker
    // samme tekst per Tobias-direktiv 2026-05-03.
    if (state === "DISCONNECTED") {
      this.exitSoftFallback();
      this.exitErrorState(); // reset before re-entering so role/listener are fresh
      this.labelText.textContent = ERROR_MESSAGE_DEFAULT;
      this.backdrop.style.display = "block";
      this.enterErrorState();
      return;
    }

    // Non-READY recoverable: ensure overlay visible and any error/soft state
    // cleared. customMessage ignoreres — kun "Laster spill" vises (Tobias
    // 2026-05-03).
    this.exitErrorState();
    this.exitSoftFallback();
    this.labelText.textContent = LOADING_LABEL;
    this.backdrop.style.display = "block";
    void customMessage; // explicitly mark as unused

    // Tobias-bug 2026-05-14: soft fallback ved 8s — viser "Venter på neste
    // spill" + retry-knapp. Disable-able ved `softFallbackMs === 0`.
    if (this.softFallbackMs > 0) {
      this.softFallbackTimer = setTimeout(() => {
        this.enterSoftFallback();
      }, this.softFallbackMs);
    }
  }

  /**
   * Tobias-direktiv 2026-05-03: explicitly switch to the error fallback even
   * if no socket-state event fired (e.g. room-join HTTP-error). The whole
   * overlay becomes clickable → reload.
   *
   * Tobias-bug 2026-05-14: canceller også soft-fallback-timer + exit-er
   * soft-fallback hvis aktiv, slik at harsh error tar over.
   */
  setError(message: string = ERROR_MESSAGE_DEFAULT): void {
    this.cancelSoftFallbackTimer();
    this.exitSoftFallback();
    this.labelText.textContent = message;
    this.backdrop.style.display = "block";
    this.enterErrorState();
  }

  /**
   * Tobias-bug 2026-05-14: oppdater retry-handler etter konstruksjon. Brukes
   * av Game1Controller som ofte ikke har socket.resumeRoom-konteksten klar
   * når LoadingOverlay opprettes (typisk i `start()`-faseens første tick).
   * Setter til null for å falle tilbake til onReload.
   */
  setRetryHandler(handler: (() => void | Promise<void>) | null): void {
    this.onRetry = handler;
  }

  /**
   * Tobias-bug 2026-05-14: test-/debug-hook. Tvinger soft fallback til å
   * aktivere seg umiddelbart (uten å vente på timer-en). Brukes av visual
   * harness + integrations-tester for å bekrefte at fallback-UI rendres
   * korrekt uten å mocke tid. Idempotent — flere kall rendrer kun én gang.
   */
  triggerSoftFallback(): void {
    this.cancelSoftFallbackTimer();
    this.enterSoftFallback();
  }

  /** True når soft-fallback har aktivert seg (Tobias-bug 2026-05-14). */
  isInSoftFallback(): boolean {
    return this.isSoftFallbackActive;
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
    this.cancelSoftFallbackTimer();
    if (this.isErrorState) {
      this.backdrop.removeEventListener("click", this.handleErrorClick);
    }
    if (this.softRetryBtn) {
      this.softRetryBtn.removeEventListener("click", this.handleRetryClick);
    }
    this.backdrop.remove();
  }

  /**
   * Switch into the error fallback state. The label text is **not** overwritten
   * here — callers (`setState("DISCONNECTED")`, `setError(msg)`) own the
   * message; this helper only flips the visual state, ARIA role, and
   * click-to-reload listener.
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

  /**
   * Tobias-bug 2026-05-14 (BUG-A defense-in-depth): bytt label-teksten til
   * "Venter på neste spill" + mount body-tekst + retry-knapp under logo-en.
   * IKKE whole-overlay-click — kun knappen er interaktiv. Idempotent.
   */
  private enterSoftFallback(): void {
    if (this.isSoftFallbackActive) return;
    if (this.isErrorState) return; // Harsh fallback har precedence.
    this.isSoftFallbackActive = true;
    this.backdrop.classList.add("spillorama-loading-overlay--soft-fallback");
    this.labelText.textContent = SOFT_FALLBACK_HEADLINE;
    this.ensureSoftFallbackDom();
    if (this.softBodyEl) this.softBodyEl.style.display = "block";
    if (this.softRetryBtn) {
      this.softRetryBtn.style.display = "inline-flex";
      this.softRetryBtn.disabled = false;
    }
    // Fire observability hook last — DOM er klart for screenshot/snapshot.
    if (this.onSoftFallback) {
      try {
        this.onSoftFallback({
          triggeredState: this.state,
          triggeredAt: Date.now(),
          timeSinceLastUpdate: Date.now() - this.stateChangedAt,
        });
      } catch (err) {
        // Observability må aldri ta ned overlayet.
        // eslint-disable-next-line no-console
        console.warn("[LoadingOverlay] onSoftFallback listener kastet:", err);
      }
    }
  }

  private exitSoftFallback(): void {
    if (!this.isSoftFallbackActive) return;
    this.isSoftFallbackActive = false;
    this.backdrop.classList.remove("spillorama-loading-overlay--soft-fallback");
    if (this.softBodyEl) this.softBodyEl.style.display = "none";
    if (this.softRetryBtn) this.softRetryBtn.style.display = "none";
  }

  /**
   * Lazy-mount body + retry-knapp første gang soft fallback aktiveres. Holder
   * initial paint lett — de fleste joins fullfører før 8s og treffer aldri
   * denne kodepathen.
   */
  private ensureSoftFallbackDom(): void {
    if (this.softBodyEl && this.softRetryBtn) return;

    if (!this.softBodyEl) {
      const body = document.createElement("div");
      body.className = "spillorama-loading-overlay__soft-body";
      body.style.display = "none";
      body.textContent = SOFT_FALLBACK_BODY;
      this.inner.appendChild(body);
      this.softBodyEl = body;
    }

    if (!this.softRetryBtn) {
      const btn = document.createElement("button");
      btn.className = "spillorama-loading-overlay__soft-retry";
      btn.type = "button";
      btn.style.display = "none";
      btn.textContent = SOFT_FALLBACK_RETRY_LABEL;
      btn.setAttribute("data-testid", "loading-overlay-retry");
      btn.addEventListener("click", this.handleRetryClick);
      this.inner.appendChild(btn);
      this.softRetryBtn = btn;
    }
  }

  /**
   * Tobias-bug 2026-05-14: kall onRetry hvis satt, fallback til onReload.
   * Disable knappen mens callback kjører så brukeren ikke spam-klikker —
   * re-enabled hvis fallback fortsatt aktiv etter callback (typisk: caller
   * resetter via setState før det blir relevant).
   */
  private async invokeRetry(): Promise<void> {
    if (!this.softRetryBtn) return;
    this.softRetryBtn.disabled = true;
    try {
      if (this.onRetry) {
        await this.onRetry();
      } else {
        // No retry-handler wired — fall back to harsh reload. Matcher
        // legacy-atferden så ingen call-sites må vite om dette.
        this.onReload();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[LoadingOverlay] onRetry kastet:", err);
    } finally {
      // Re-enable kun hvis fallback fortsatt aktiv (caller har ikke kalt
      // setState i mellomtiden).
      if (this.softRetryBtn && this.isSoftFallbackActive) {
        this.softRetryBtn.disabled = false;
      }
    }
  }

  private cancelSoftFallbackTimer(): void {
    if (this.softFallbackTimer) {
      clearTimeout(this.softFallbackTimer);
      this.softFallbackTimer = null;
    }
  }
}
