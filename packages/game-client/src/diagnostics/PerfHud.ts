/**
 * Dev-only performance HUD for Spill 1 (and the broader game-client).
 *
 * Renders a ~200x120 px semi-transparent overlay in the top-right of the
 * viewport showing live runtime metrics:
 *
 *   FPS              — current + 1-second moving average
 *   Paints/s         — PerformanceObserver 'paint' entries
 *   RAF calls/s      — monkey-patched requestAnimationFrame counter
 *   BF count         — elements with backdrop-filter != 'none'
 *   Active anims     — elements with animation-name != 'none'
 *   Tweens           — GSAP globalTimeline tween count (if window.gsap exposed)
 *   Layers           — rough compositor-layer heuristic (promoted elements)
 *
 * Thresholds (from CI perf-budget, PR #469):
 *   FPS   < 55       → red
 *   Paints > 30/s    → red
 *   RAF   > 130/s    → yellow (possible multiple rAF loops)
 *   BF count > 3     → red (blink root cause — see game1/ARCHITECTURE.md)
 *   Anims > 10       → yellow
 *   Tweens > 15      → yellow
 *   Layers > 20      → yellow
 *
 * Activation:
 *   - Only in dev (`import.meta.env.DEV === true`); stripped from prod bundle.
 *   - URL-param `?perfhud=1` turns it on (default off even in dev).
 *   - Hotkey Ctrl+Alt+P (or Cmd+Alt+P on macOS) toggles visibility.
 *
 * The HUD monkey-patches `window.requestAnimationFrame` while mounted and
 * restores the original on unmount — always pair `mount()` with `unmount()`
 * to avoid leaking the counter across hot-reloads.
 */

/** Threshold values — kept inline so PerfHud has no external deps. */
export const PERF_HUD_THRESHOLDS = {
  fpsMin: 55,
  paintsPerSecMax: 30,
  rafPerSecWarn: 130,
  bfCountMax: 3,
  animsWarn: 10,
  tweensWarn: 15,
  layersWarn: 20,
} as const;

type Metrics = {
  fps: number;
  fpsAvg: number;
  paintsPerSec: number;
  rafPerSec: number;
  bfCount: number;
  anims: number;
  tweens: number;
  layers: number;
};

type Severity = "ok" | "warn" | "bad";

type Row = {
  label: string;
  value: string;
  severity: Severity;
};

type GsapLike = {
  globalTimeline?: {
    getChildren?: (
      nested?: boolean,
      tweens?: boolean,
      timelines?: boolean,
    ) => unknown[];
  };
};

/**
 * Read `window.gsap.globalTimeline.getChildren(true, true, false).length`
 * defensively — GSAP may or may not be exposed on window depending on the
 * bundle. Returns -1 when GSAP isn't detectable, which we render as "n/a".
 */
function readGsapTweens(): number {
  try {
    const g = (window as unknown as { gsap?: GsapLike }).gsap;
    const tl = g?.globalTimeline;
    if (!tl || typeof tl.getChildren !== "function") return -1;
    const children = tl.getChildren(true, true, false);
    return Array.isArray(children) ? children.length : -1;
  } catch {
    return -1;
  }
}

/**
 * Count DOM elements with `backdrop-filter != none`. This is the single
 * most important metric for Spill 1 — PR #468 removed 12 such elements;
 * regression detection is a primary HUD use case.
 *
 * `getComputedStyle` can throw on some detached nodes; wrap defensively.
 */
function countBackdropFilter(doc: Document = document): number {
  let count = 0;
  const all = doc.querySelectorAll<HTMLElement>("*");
  for (const el of Array.from(all)) {
    try {
      const bf = getComputedStyle(el).backdropFilter;
      if (bf && bf !== "none") count++;
    } catch {
      /* ignore — detached or cross-origin shadow root */
    }
  }
  return count;
}

/** Count elements with an active CSS animation (animation-name != none). */
function countAnimations(doc: Document = document): number {
  let count = 0;
  const all = doc.querySelectorAll<HTMLElement>("*");
  for (const el of Array.from(all)) {
    try {
      const name = getComputedStyle(el).animationName;
      if (name && name !== "none") count++;
    } catch {
      /* ignore */
    }
  }
  return count;
}

/**
 * Heuristic compositor-layer estimate. Chrome doesn't expose the real layer
 * tree to scripts, so we approximate by counting elements with a property
 * combination that commonly promotes to a compositor layer:
 *   - transform != none
 *   - will-change with a composited hint (transform/opacity/filter)
 *   - position: fixed
 *   - a z-index > 0 with transform/opacity
 * This is *not* a precise Blink layer count but tracks the same growth
 * direction — good enough for "did I just promote 50 new things" signal.
 */
function countLayerPromotedElements(doc: Document = document): number {
  let count = 0;
  const all = doc.querySelectorAll<HTMLElement>("*");
  for (const el of Array.from(all)) {
    try {
      const s = getComputedStyle(el);
      const willChange = (s.willChange || "").toLowerCase();
      const promotesViaWillChange =
        willChange.includes("transform") ||
        willChange.includes("opacity") ||
        willChange.includes("filter");
      const hasTransform = s.transform && s.transform !== "none";
      const isFixed = s.position === "fixed";
      if (promotesViaWillChange || hasTransform || isFixed) count++;
    } catch {
      /* ignore */
    }
  }
  return count;
}

/**
 * Shared environment guard used by auto-mount to decide whether the HUD
 * should be installed. Exported so tests can invoke it without touching
 * window.location.
 */
export function shouldAutoMountPerfHud(
  env: { DEV?: boolean },
  search: string,
): boolean {
  if (!env.DEV) return false;
  try {
    return new URLSearchParams(search).get("perfhud") === "1";
  } catch {
    return false;
  }
}

export class PerfHud {
  private root: HTMLDivElement | null = null;
  private tableBody: HTMLDivElement | null = null;
  private metrics: Metrics = {
    fps: 0,
    fpsAvg: 0,
    paintsPerSec: 0,
    rafPerSec: 0,
    bfCount: 0,
    anims: 0,
    tweens: 0,
    layers: 0,
  };
  private rafId: number | null = null;
  private frameTimes: number[] = [];
  private paintObserver: PerformanceObserver | null = null;
  private paintsThisWindow = 0;
  private rafCallsThisWindow = 0;
  private lastSampleTime = 0;
  private originalRaf: typeof window.requestAnimationFrame | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  private hidden = false;
  private mounted = false;

  /**
   * Mount the HUD. Safe to call only once per instance.
   *
   * @param parent Where to attach the overlay; defaults to `document.body`.
   */
  mount(parent: HTMLElement = document.body): void {
    if (this.mounted) return;
    this.mounted = true;

    this.root = document.createElement("div");
    this.root.className = "perf-hud-root";
    this.root.setAttribute("data-testid", "perf-hud");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "8px",
      right: "8px",
      width: "210px",
      zIndex: "999999",
      padding: "8px 10px",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "11px",
      lineHeight: "1.4",
      color: "#e0e0e0",
      background: "rgba(12, 14, 18, 0.88)",
      border: "1px solid rgba(120, 20, 20, 0.6)",
      borderRadius: "6px",
      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
      pointerEvents: "none",
      userSelect: "none",
    });

    const title = document.createElement("div");
    Object.assign(title.style, {
      fontWeight: "700",
      fontSize: "10px",
      letterSpacing: "0.05em",
      color: "#ff9494",
      marginBottom: "4px",
      textTransform: "uppercase",
    });
    title.textContent = "PERF HUD (?perfhud=1)";
    this.root.appendChild(title);

    this.tableBody = document.createElement("div");
    this.root.appendChild(this.tableBody);

    parent.appendChild(this.root);

    this.installRafCounter();
    this.installPaintObserver();
    this.installHotkey();

    // Kick off the measurement loop using the ORIGINAL rAF (not the
    // monkey-patched one) to avoid polluting our own counter.
    this.lastSampleTime = performance.now();
    this.measureLoop();

    // Initial render so the HUD isn't blank while we wait for the first
    // 1-second sample boundary.
    this.render();
  }

  /**
   * Tear down the HUD: remove DOM, disconnect observers, restore the
   * original `window.requestAnimationFrame`. Idempotent.
   */
  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;

    if (this.rafId !== null) {
      // Use the patched rAF's counterpart; `cancelAnimationFrame` works
      // on both patched and original.
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.paintObserver?.disconnect();
    this.paintObserver = null;

    this.restoreRaf();

    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }

    this.root?.remove();
    this.root = null;
    this.tableBody = null;
  }

  /** Test hook: return the current metrics snapshot. */
  getMetricsSnapshot(): Metrics {
    return { ...this.metrics };
  }

  /** Visible? Exposed for hotkey-toggle tests. */
  isVisible(): boolean {
    return this.mounted && !this.hidden;
  }

  /** Toggle visibility without unmounting (Ctrl+Alt+P hotkey). */
  toggle(): void {
    if (!this.root) return;
    this.hidden = !this.hidden;
    this.root.style.display = this.hidden ? "none" : "block";
  }

  // ----- internal ---------------------------------------------------------

  /**
   * Monkey-patch `window.requestAnimationFrame` to count calls.
   *
   * Remember the ORIGINAL function reference (not a bound copy) so
   * `unmount()` can restore it strictly — strict equality after unmount
   * is a documented invariant so callers can assert the patch is gone.
   */
  private installRafCounter(): void {
    if (this.originalRaf) return;
    this.originalRaf = window.requestAnimationFrame;
    const original = this.originalRaf;
    const counter = (cb: FrameRequestCallback): number => {
      this.rafCallsThisWindow++;
      // Call via window binding — native rAF requires a window-bound `this`,
      // but we kept the original reference un-bound so restore is strict.
      return original.call(window, cb);
    };
    window.requestAnimationFrame = counter as typeof window.requestAnimationFrame;
  }

  private restoreRaf(): void {
    if (!this.originalRaf) return;
    window.requestAnimationFrame = this.originalRaf;
    this.originalRaf = null;
  }

  /**
   * Observe `paint` entries from PerformanceObserver. Not all environments
   * emit paint timing (notably happy-dom in unit tests), so observation
   * failures are swallowed — the HUD just reports 0 paints/s there.
   */
  private installPaintObserver(): void {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.paintObserver = new PerformanceObserver((list) => {
        this.paintsThisWindow += list.getEntries().length;
      });
      // `buffered: false` — we only care about paints from now onward.
      this.paintObserver.observe({ type: "paint", buffered: false });
    } catch {
      this.paintObserver = null;
    }
  }

  private installHotkey(): void {
    this.keyHandler = (ev: KeyboardEvent) => {
      // Ctrl+Alt+P on Windows/Linux, Cmd+Alt+P on macOS.
      const metaOrCtrl = ev.ctrlKey || ev.metaKey;
      if (metaOrCtrl && ev.altKey && ev.key.toLowerCase() === "p") {
        ev.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  /**
   * Measurement loop — runs once per animation frame using the ORIGINAL
   * rAF so our own samples don't count toward the rAF/s metric.
   *
   * Once a second has elapsed since the last sample, we aggregate
   * everything into `this.metrics`, reset the windows, and render.
   */
  private measureLoop = (): void => {
    if (!this.mounted) return;
    const now = performance.now();
    this.frameTimes.push(now);

    // Keep only frames from the last second for the FPS-avg calculation.
    const oneSecondAgo = now - 1000;
    while (this.frameTimes.length > 0 && this.frameTimes[0] < oneSecondAgo) {
      this.frameTimes.shift();
    }

    const elapsed = now - this.lastSampleTime;
    if (elapsed >= 1000) {
      // Instantaneous FPS = frame count in the last second.
      this.metrics.fps = this.frameTimes.length;

      // Rolling average over the last 5 seconds (bounded history).
      if (!Number.isFinite(this.metrics.fpsAvg) || this.metrics.fpsAvg === 0) {
        this.metrics.fpsAvg = this.metrics.fps;
      } else {
        this.metrics.fpsAvg = Math.round(
          this.metrics.fpsAvg * 0.8 + this.metrics.fps * 0.2,
        );
      }

      this.metrics.paintsPerSec = this.paintsThisWindow;
      this.metrics.rafPerSec = this.rafCallsThisWindow;
      this.metrics.bfCount = countBackdropFilter();
      this.metrics.anims = countAnimations();
      this.metrics.tweens = readGsapTweens();
      this.metrics.layers = countLayerPromotedElements();

      this.paintsThisWindow = 0;
      this.rafCallsThisWindow = 0;
      this.lastSampleTime = now;

      this.render();
    }

    // Schedule next tick via the ORIGINAL rAF so measurement loop itself
    // doesn't count toward the rafPerSec metric. We invoke with `.call`
    // because we stored the un-bound reference (see installRafCounter).
    const raf = this.originalRaf ?? window.requestAnimationFrame;
    this.rafId = raf.call(window, this.measureLoop);
  };

  /** Build the full row list with severity-based colouring. */
  private computeRows(): Row[] {
    const m = this.metrics;
    const t = PERF_HUD_THRESHOLDS;

    return [
      {
        label: "FPS",
        value: `${m.fps} (${m.fpsAvg} avg)`,
        severity: m.fps > 0 && m.fps < t.fpsMin ? "bad" : "ok",
      },
      {
        label: "Paints",
        value: `${m.paintsPerSec}/s`,
        severity: m.paintsPerSec > t.paintsPerSecMax ? "bad" : "ok",
      },
      {
        label: "RAF",
        value: `${m.rafPerSec} calls/s`,
        severity: m.rafPerSec > t.rafPerSecWarn ? "warn" : "ok",
      },
      {
        label: "BF count",
        value: `${m.bfCount}`,
        severity: m.bfCount > t.bfCountMax ? "bad" : "ok",
      },
      {
        label: "Active anims",
        value: `${m.anims}`,
        severity: m.anims > t.animsWarn ? "warn" : "ok",
      },
      {
        label: "Tweens",
        value: m.tweens < 0 ? "n/a" : `${m.tweens}`,
        severity: m.tweens > t.tweensWarn ? "warn" : "ok",
      },
      {
        label: "Layers",
        value: `${m.layers}`,
        severity: m.layers > t.layersWarn ? "warn" : "ok",
      },
    ];
  }

  /** Map severity → hex colour (readable on dark background). */
  private colourFor(sev: Severity): string {
    switch (sev) {
      case "bad":
        return "#ff6666";
      case "warn":
        return "#ffd166";
      default:
        return "#88ff88";
    }
  }

  /**
   * Re-render the HUD body. Uses a single `textContent` replacement per
   * row to keep the DOM-mutation count low (important — the HUD itself
   * would otherwise inflate the paints/s metric it's trying to measure).
   */
  private render(): void {
    if (!this.tableBody) return;
    const rows = this.computeRows();

    // Reuse existing row nodes if the row count hasn't changed (it never
    // does in practice, but this keeps the DOM stable across ticks).
    if (this.tableBody.childElementCount !== rows.length) {
      this.tableBody.textContent = "";
      for (const _row of rows) {
        const line = document.createElement("div");
        Object.assign(line.style, {
          display: "flex",
          justifyContent: "space-between",
          gap: "8px",
        });
        const label = document.createElement("span");
        label.setAttribute("data-role", "label");
        Object.assign(label.style, { color: "#9aa0a6" });
        const value = document.createElement("span");
        value.setAttribute("data-role", "value");
        Object.assign(value.style, { fontWeight: "600" });
        line.appendChild(label);
        line.appendChild(value);
        this.tableBody.appendChild(line);
      }
    }

    const lines = this.tableBody.children;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = lines[i] as HTMLElement | undefined;
      if (!line) continue;
      const labelEl = line.querySelector<HTMLElement>('[data-role="label"]');
      const valueEl = line.querySelector<HTMLElement>('[data-role="value"]');
      if (labelEl && labelEl.textContent !== `${row.label}:`) {
        labelEl.textContent = `${row.label}:`;
      }
      const prefix = row.severity === "bad" ? "\u26a0 " : "";
      const nextVal = `${prefix}${row.value}`;
      if (valueEl && valueEl.textContent !== nextVal) {
        valueEl.textContent = nextVal;
      }
      if (valueEl) {
        const colour = this.colourFor(row.severity);
        if (valueEl.style.color !== colour) {
          valueEl.style.color = colour;
        }
        const weight = row.severity === "bad" ? "700" : "600";
        if (valueEl.style.fontWeight !== weight) {
          valueEl.style.fontWeight = weight;
        }
      }
    }
  }
}
