import { telemetry } from "../telemetry/Telemetry.js";
import { captureClientMessage } from "../telemetry/Sentry.js";

/**
 * BIN-542: Guards against iOS Safari WebGL context loss.
 *
 * iOS Safari frequently drops WebGL context when:
 *  - Tab backgrounds for extended time (>60s)
 *  - Device is locked/unlocked
 *  - Low memory pressure (other tabs compete)
 *  - Too many WebGL contexts open
 *
 * On context-loss, the canvas becomes permanently black unless we
 * explicitly preventDefault() and wait for `webglcontextrestored`.
 *
 * Strategy:
 *  1. preventDefault() on `webglcontextlost` — allows restoration
 *  2. Invoke onContextLost callback to show recovery overlay
 *  3. On `webglcontextrestored`: invoke onRestored — caller is expected
 *     to destroy + re-init the PIXI app + socket. State comes back via
 *     the normal reconnect flow (room:state snapshot + checkpoint).
 *  4. Emit telemetry for pilot observability (expected rare).
 */
export interface WebGLContextGuardOptions {
  canvas: HTMLCanvasElement;
  onContextLost: () => void;
  onContextRestored: () => void;
  /** Context key identifying the game session, for telemetry. */
  gameSlug: string;
  hallId: string;
}

export class WebGLContextGuard {
  private canvas: HTMLCanvasElement;
  private onContextLost: () => void;
  private onContextRestored: () => void;
  private gameSlug: string;
  private hallId: string;
  private lostAt: number | null = null;
  private readonly lostHandler: (e: Event) => void;
  private readonly restoredHandler: () => void;

  constructor(opts: WebGLContextGuardOptions) {
    this.canvas = opts.canvas;
    this.onContextLost = opts.onContextLost;
    this.onContextRestored = opts.onContextRestored;
    this.gameSlug = opts.gameSlug;
    this.hallId = opts.hallId;

    this.lostHandler = (event: Event) => this.handleContextLost(event);
    this.restoredHandler = () => this.handleContextRestored();

    this.canvas.addEventListener("webglcontextlost", this.lostHandler, false);
    this.canvas.addEventListener("webglcontextrestored", this.restoredHandler, false);
  }

  destroy(): void {
    this.canvas.removeEventListener("webglcontextlost", this.lostHandler, false);
    this.canvas.removeEventListener("webglcontextrestored", this.restoredHandler, false);
  }

  private handleContextLost(event: Event): void {
    event.preventDefault();
    this.lostAt = Date.now();

    const payload = {
      gameSlug: this.gameSlug,
      hallId: this.hallId,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    };
    telemetry.trackEvent("webgl_context_lost", payload);
    captureClientMessage(
      `webgl_context_lost: gameSlug=${this.gameSlug} hall=${this.hallId} ua=${payload.userAgent}`,
      "warning",
    );

    try {
      this.onContextLost();
    } catch (err) {
      console.error("[WebGLContextGuard] onContextLost callback threw:", err);
    }
  }

  private handleContextRestored(): void {
    const recoveryMs = this.lostAt != null ? Date.now() - this.lostAt : 0;
    this.lostAt = null;

    telemetry.trackEvent("webgl_context_restored", {
      gameSlug: this.gameSlug,
      hallId: this.hallId,
      recoveryMs,
    });
    captureClientMessage(
      `webgl_context_restored after ${recoveryMs}ms (gameSlug=${this.gameSlug})`,
      "info",
    );

    try {
      this.onContextRestored();
    } catch (err) {
      console.error("[WebGLContextGuard] onContextRestored callback threw:", err);
    }
  }
}
