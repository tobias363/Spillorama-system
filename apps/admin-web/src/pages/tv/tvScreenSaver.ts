/**
 * Fase 1 MVP §24 — Screen Saver overlay for TV-skjerm.
 *
 * Ansvar:
 *   - Periodisk hente screensaver-konfig fra
 *     `/api/tv/:hallId/:tvToken/screen-saver`
 *   - Tracke idle-time (siste user-interaction OG siste relevante TV-event)
 *   - Vise fullscreen overlay med cykling av bilder når idle > timeout
 *   - Skjule overlay umiddelbart ved aktivitet
 *
 * Sikkerhet:
 *   - Overlay ligger over alt annet TV-innhold (z-index: 10000) men
 *     blokkerer ikke spill-ticking — backend fortsetter normalt.
 *   - Klikk eller tastatur-input lukker overlay og resetter timer.
 *   - Hvis screensaver-fetch feiler eller bilder mangler, vises ikke noe.
 *
 * Scope-avgrensning:
 *   - Vi viser screensaver kun på TV-skjermen, ikke spiller-mobil
 *     (per Tobias' beslutning og dokumentert i WIREFRAME_CATALOG §PDF 14).
 */

import {
  fetchTvScreenSaver,
  type TvScreenSaverConfig,
} from "../../api/tv-screen.js";

const CONFIG_REFRESH_MS = 60_000; // refresh-konfig hvert minutt
const IDLE_CHECK_MS = 5_000; // sjekk idle-tilstand hvert 5. sek

interface InternalState {
  hallId: string;
  tvToken: string;
  destroyed: boolean;
  config: TvScreenSaverConfig | null;
  /** Timestamp (ms) siste aktivitet — input, ny ball, fokus, etc. */
  lastActivityAt: number;
  /** Index i config.images for nåværende vist bilde. */
  currentImageIdx: number;
  /** ID-en til cycling-timer (window.setTimeout). */
  cycleTimer: number | null;
  /** ID-en til config-refresh-timer. */
  configTimer: number | null;
  /** ID-en til idle-check-timer. */
  idleTimer: number | null;
  /** Overlay-element (lazy-opprettet ved første aktivering). */
  overlay: HTMLElement | null;
  /** True når screensaver er synlig. */
  isShowing: boolean;
  /** Lyttere som må fjernes ved unmount. */
  listeners: Array<{ target: EventTarget; type: string; listener: EventListener }>;
}

let active: InternalState | null = null;

/**
 * Mount screen-saver-overlay for et TV-host. Kall ved samme tidspunkt som
 * `mountTvScreenPage` har laget DOM-en. Trygt å kalle flere ganger — gammel
 * instance unmountes først.
 */
export function mountTvScreenSaver(
  hallId: string,
  tvToken: string
): void {
  unmountTvScreenSaver();
  const state: InternalState = {
    hallId,
    tvToken,
    destroyed: false,
    config: null,
    lastActivityAt: Date.now(),
    currentImageIdx: 0,
    cycleTimer: null,
    configTimer: null,
    idleTimer: null,
    overlay: null,
    isShowing: false,
    listeners: [],
  };
  active = state;

  void refreshConfig(state);
  state.configTimer = window.setInterval(
    () => void refreshConfig(state),
    CONFIG_REFRESH_MS
  );

  state.idleTimer = window.setInterval(() => evaluateIdle(state), IDLE_CHECK_MS);

  // Brukeraktivitet — alle disse markerer som "ikke idle". `mousemove`-listener
  // bruker passive=true for ikke å blokkere scroll/touch.
  const ACTIVITY_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
    "mousemove",
    "mousedown",
    "keydown",
    "wheel",
    "touchstart",
  ];
  for (const ev of ACTIVITY_EVENTS) {
    const listener: EventListener = () => markActive(state);
    window.addEventListener(ev, listener, { passive: true });
    state.listeners.push({ target: window, type: ev, listener });
  }

  // Visibility-API: når TV-skjermen kommer tilbake i fokus, marker som aktiv
  // for å unngå at en bakgrunnsskjerm popper screensaver kort etter focus.
  const visListener: EventListener = () => {
    if (!document.hidden) markActive(state);
  };
  document.addEventListener("visibilitychange", visListener);
  state.listeners.push({ target: document, type: "visibilitychange", listener: visListener });
}

/** Ekstern: kall ved nye baller / spillstatus-endringer for å resette idle. */
export function notifyTvActivity(): void {
  if (active) markActive(active);
}

export function unmountTvScreenSaver(): void {
  if (!active) return;
  active.destroyed = true;
  if (active.configTimer != null) window.clearInterval(active.configTimer);
  if (active.idleTimer != null) window.clearInterval(active.idleTimer);
  if (active.cycleTimer != null) window.clearTimeout(active.cycleTimer);
  for (const { target, type, listener } of active.listeners) {
    target.removeEventListener(type, listener);
  }
  if (active.overlay) {
    active.overlay.remove();
  }
  active = null;
}

async function refreshConfig(state: InternalState): Promise<void> {
  if (state.destroyed) return;
  try {
    const cfg = await fetchTvScreenSaver(state.hallId, state.tvToken);
    if (state.destroyed) return;
    state.config = cfg;
    // Hvis config nettopp ble disabled mens overlay er synlig, lukk det.
    if (!cfg.enabled && state.isShowing) {
      hide(state);
    }
  } catch {
    // Fail-soft: behold gammel config (eller ingen overlay).
    if (state.destroyed) return;
    if (!state.config) state.config = null;
  }
}

function markActive(state: InternalState): void {
  state.lastActivityAt = Date.now();
  if (state.isShowing) {
    hide(state);
  }
}

function evaluateIdle(state: InternalState): void {
  if (state.destroyed) return;
  const cfg = state.config;
  if (!cfg || !cfg.enabled || cfg.images.length === 0) return;
  const idleMs = Date.now() - state.lastActivityAt;
  const thresholdMs = cfg.timeoutMinutes * 60_000;
  if (idleMs >= thresholdMs && !state.isShowing) {
    show(state);
  }
}

function show(state: InternalState): void {
  if (!state.config || state.config.images.length === 0) return;
  if (!state.overlay) {
    state.overlay = createOverlay();
    document.body.appendChild(state.overlay);
  }
  state.overlay.classList.remove("tv-screen-saver-hidden");
  state.overlay.setAttribute("aria-hidden", "false");
  state.isShowing = true;
  state.currentImageIdx = 0;
  renderCurrentImage(state);
  scheduleNextImage(state);
}

function hide(state: InternalState): void {
  if (!state.isShowing) return;
  state.isShowing = false;
  if (state.overlay) {
    state.overlay.classList.add("tv-screen-saver-hidden");
    state.overlay.setAttribute("aria-hidden", "true");
  }
  if (state.cycleTimer != null) {
    window.clearTimeout(state.cycleTimer);
    state.cycleTimer = null;
  }
}

function renderCurrentImage(state: InternalState): void {
  const cfg = state.config;
  const overlay = state.overlay;
  if (!cfg || !overlay || cfg.images.length === 0) return;
  const img = cfg.images[state.currentImageIdx % cfg.images.length];
  if (!img) return;
  const imgEl = overlay.querySelector<HTMLImageElement>("img.tv-screen-saver-image");
  if (imgEl) {
    // referrerpolicy + crossOrigin for å unngå CDN-CORS-issues
    imgEl.referrerPolicy = "no-referrer";
    imgEl.src = img.imageUrl;
    imgEl.alt = "";
  }
}

function scheduleNextImage(state: InternalState): void {
  const cfg = state.config;
  if (!cfg || cfg.images.length === 0) return;
  if (state.cycleTimer != null) window.clearTimeout(state.cycleTimer);
  const current = cfg.images[state.currentImageIdx % cfg.images.length];
  const delayMs = (current?.displaySeconds ?? 10) * 1000;
  state.cycleTimer = window.setTimeout(() => {
    if (!state.isShowing || state.destroyed) return;
    state.currentImageIdx =
      (state.currentImageIdx + 1) % cfg.images.length;
    renderCurrentImage(state);
    scheduleNextImage(state);
  }, delayMs);
}

function createOverlay(): HTMLElement {
  const div = document.createElement("div");
  div.className = "tv-screen-saver tv-screen-saver-hidden";
  div.setAttribute("data-testid", "tv-screen-saver");
  div.setAttribute("aria-hidden", "true");
  div.innerHTML = `
    <img class="tv-screen-saver-image" src="" alt="" />
  `;
  // Klikk skjuler — bingoverten kan trykke for å gå tilbake til spill.
  div.addEventListener("click", () => {
    if (active) markActive(active);
  });
  return div;
}

/** @internal — for tests only. */
export function __getActiveState(): InternalState | null {
  return active;
}
