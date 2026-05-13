/**
 * Debug-suite installer.
 *
 * Wires up all 10 components, monkey-patches the SpilloramaSocket emit/
 * dispatch path so we capture wire-frames + latency, mounts the HUD,
 * and exposes the public API on `window.spillorama.debug`.
 *
 * Idempotent — calling twice in the same window is a no-op (returns the
 * existing instance). The host (e.g. a Game Controller) can call `unmount`
 * to tear down.
 *
 * Production-safety: when `isDebugEnabled()` returns false, the installer
 * returns null immediately and NOTHING is patched. No HUD, no buffer, no
 * monkey-patch overhead.
 */

import type { SpilloramaSocket, SpilloramaSocketListeners, ConnectionState } from "../net/SpilloramaSocket.js";
import { DebugHud, type HudHost } from "./DebugHud.js";
import { DebugLogger } from "./debugLogger.js";
import { EdgeCaseSimulator } from "./EdgeCaseSimulator.js";
import { EventBuffer, makeEventBufferAPI } from "./EventBuffer.js";
import { NetworkTap } from "./NetworkTap.js";
import { PerformanceProfiler } from "./PerformanceProfiler.js";
import { SnapshotManager, decorateSnapshotForExport } from "./SnapshotManager.js";
import { SocketInjector } from "./SocketInjector.js";
import { StateInspector } from "./StateInspector.js";
import { StressTester } from "./StressTester.js";
import { isDebugEnabled, persistDebugEnabled } from "./activation.js";
// Tobias-direktiv 2026-05-13: Rrweb DOM session-replay. Vi starter recorderen
// herfra (observer-pattern) slik at Game1Controller forblir uberørt. Lazy-
// loader rrweb fra node_modules — prod-bundle uten ?debug=1 får ikke ekstra
// ~80 KB.
import { setupRrwebRecorder, resetRrwebRecorder } from "./RrwebRecorder.js";
import type { DebugSuiteAPI, InstallOptions, LogLevel } from "./types.js";

/** Suite version — bumped when public API changes shape. */
export const DEBUG_SUITE_VERSION = "0.1.0-fase-2b-2026-05-05";

interface InstalledSuite {
  api: DebugSuiteAPI;
  unmount: () => void;
}

/** Singleton — set on first install, returned for subsequent calls. */
let installed: InstalledSuite | null = null;

/**
 * Install the suite into the page. Returns the public API object plus an
 * unmount function. When the activation gate is closed, returns null and
 * does nothing.
 */
export function installDebugSuite(
  socket: SpilloramaSocket,
  options: InstallOptions = {},
): InstalledSuite | null {
  if (!isDebugEnabled()) {
    return null;
  }
  if (installed) {
    return installed;
  }

  const logger = new DebugLogger(options.gameSlug ?? "client");
  const buffer = new EventBuffer(500);
  const network = new NetworkTap();
  const profiler = new PerformanceProfiler();
  const inspector = new StateInspector();
  const injector = new SocketInjector(socket, logger);
  const simulator = new EdgeCaseSimulator();
  simulator.setSocket(socket);
  simulator.setLogger(logger);
  const stress = new StressTester();
  stress.setSocket(socket);
  stress.setLogger(logger);
  stress.setProfiler(profiler);
  const snapshots = new SnapshotManager(buffer);

  inspector.setLogger(logger);

  // Pipe every logger entry into the buffer — the buffer is the system-of-
  // record and other components read from it.
  logger.subscribe((event) => {
    buffer.record(event);
  });

  // Initialise IDB-backed snapshot store. Don't await — the API is usable
  // before history loads.
  void snapshots.init();

  // Wire up auto-snapshot on uncaught errors. The handler is intentionally
  // attached at install time so we capture issues that happen before the
  // operator opens DevTools.
  const errHandler = (ev: ErrorEvent) => {
    logger.error("error", "window.error", { message: ev.message, source: ev.filename });
    void snapshots.maybeAutoCapture(`window.error: ${ev.message ?? "unknown"}`);
  };
  const rejHandler = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason ?? "");
    logger.error("error", "unhandledrejection", { reason });
    void snapshots.maybeAutoCapture(`unhandledrejection: ${reason}`);
  };
  window.addEventListener("error", errHandler);
  window.addEventListener("unhandledrejection", rejHandler);

  // Connection-state telemetry — keeps HUD & buffer in sync.
  let lastConnState: ConnectionState = socket.getConnectionState();
  let lastConnAt = Date.now();
  const unsubConn = socket.on("connectionStateChanged", (state) => {
    if (state !== lastConnState) {
      logger.info("system", "connectionStateChanged", { from: lastConnState, to: state });
      lastConnState = state;
      lastConnAt = Date.now();
    }
  });

  // Tap incoming socket-events through the listener-API. This is the
  // forensic feed: every server broadcast is logged + recorded with size.
  const channels: Array<keyof SpilloramaSocketListeners> = [
    "roomUpdate",
    "drawNew",
    "patternWon",
    "chatMessage",
    "jackpotActivated",
    "minigameActivated",
    "miniGameTrigger",
    "miniGameResult",
    "walletState",
    "betRejected",
    "walletLossState",
    "g2JackpotListUpdate",
  ];
  const unsubChannels: Array<() => void> = [];
  for (const ch of channels) {
    const unsub = socket.on(ch, ((payload: unknown) => {
      logger.info("socket-in", String(ch), payload, { dataPath: `socket.${String(ch)}` });
      network.record("received", String(ch), payload);
      // After dispatch the bridge will mutate state; let the inspector
      // sample it.
      try {
        inspector.recordSnapshot();
      } catch {
        /* ignore */
      }
    }) as SpilloramaSocketListeners[typeof ch]);
    unsubChannels.push(unsub);
  }

  // Monkey-patch the socket's emit path so we capture outgoing events +
  // ack RTT. We add a `__emitForDebug` hook the injector can call without
  // bypassing latency/packet-loss simulators.
  const sockAny = socket as unknown as {
    emit?: (...args: unknown[]) => unknown;
    __spilloramaDebugEmitPatched?: boolean;
    __emitForDebug?: (event: string, payload: unknown) => Promise<unknown>;
  };
  // Wrap the public ack-emit. We deliberately use the existing `emit`
  // surface that returns Promise<AckResponse>.
  const ackEmits: Array<keyof SpilloramaSocket> = [
    "createRoom",
    "joinRoom",
    "armBet",
    "startGame",
    "drawNext",
    "markTicket",
    "submitClaim",
    "sendChat",
    "spinJackpot",
  ];
  const originalAcks = new Map<string, (payload: unknown) => Promise<unknown>>();
  for (const name of ackEmits) {
    const orig = (socket as unknown as Record<string, unknown>)[name];
    if (typeof orig !== "function") continue;
    originalAcks.set(String(name), orig.bind(socket) as (payload: unknown) => Promise<unknown>);
    (socket as unknown as Record<string, unknown>)[name] = async (payload: unknown) => {
      const t0 = performance.now();
      // Honour latency/packet-loss simulators.
      const delay = simulator.getLatency();
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (simulator.shouldDrop()) {
        const dropped = network.record("sent", String(name), payload, { dropped: true });
        logger.warn("socket-out", `${String(name)}.dropped`, { frame: dropped });
        // Resolve with a synthetic "drop" response so callers don't hang.
        return { ok: false, error: { code: "SIMULATED_DROP", message: "Dropped by debug simulator" } };
      }
      network.record("sent", String(name), payload);
      logger.info("socket-out", String(name), payload);
      try {
        const result = await originalAcks.get(String(name))?.(payload);
        const dur = performance.now() - t0;
        profiler.recordEventLatency(`emit:${String(name)}`, dur);
        return result;
      } catch (err) {
        logger.error("socket-out", `${String(name)}.threw`, { err: String(err) });
        throw err;
      }
    };
  }

  // Add `__emitForDebug` so the injector can fire arbitrary event names
  // without us having to whitelist them at build time.
  sockAny.__emitForDebug = async (event: string, payload: unknown) => {
    network.record("sent", `inject:${event}`, payload);
    logger.info("socket-out", `inject.${event}`, payload);
    // Use the underlying socket.io socket if exposed, else fall back to a
    // no-op response.
    const internal = (socket as unknown as { socket?: { emit: (e: string, p: unknown, cb: (a: unknown) => void) => void; connected?: boolean } })
      .socket;
    if (!internal?.connected) {
      return { ok: false, error: { code: "NOT_CONNECTED" } };
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: { code: "TIMEOUT" } });
      }, 15000);
      try {
        internal.emit(event, payload, (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          profiler.recordEventLatency(`inject:${event}`, performance.now() - t0);
          resolve(response);
        });
      } catch (err) {
        clearTimeout(timer);
        resolve({ ok: false, error: { code: "INJECT_FAILED", message: String(err) } });
      }
    });
  };
  sockAny.__spilloramaDebugEmitPatched = true;

  // Mount HUD.
  const hud = new DebugHud();
  hud.setNetwork(network);
  hud.setBuffer(buffer);
  // Latency proxy — measure the roundtrip of the most recent ack-emit.
  // We expose a setter the host can override.
  let recentLatencyMs: number | null = null;
  const profilerReport = profiler.report.bind(profiler);
  // Crude but effective: pull p50 from the most recent emit-bucket.
  const latencyGetter = (): number | null => {
    const reports = profilerReport();
    const emits = reports.find((r) => r.label.startsWith("emit:") || r.label.startsWith("event:"));
    if (!emits) return recentLatencyMs;
    return emits.p50;
  };

  let lastAutoDrawTick: number | null = null;
  let drawsTriggered = 0;
  // Tap drawNew through subscriber to populate auto-draw counter for HUD.
  const unsubDraw = socket.on("drawNew", () => {
    lastAutoDrawTick = Date.now();
    drawsTriggered++;
  });

  const ident = {
    playerId: options.playerId,
    walletId: options.walletId,
    hallId: options.hallId,
    gameSlug: options.gameSlug,
  };

  const host: HudHost = {
    getState: () => {
      try {
        return inspector.state();
      } catch {
        return null;
      }
    },
    getConnectionState: () => lastConnState,
    getLatencyMs: latencyGetter,
    getLastAutoDrawTick: () => lastAutoDrawTick,
    getDrawsTriggered: () => drawsTriggered,
    getIdentity: () => ident,
  };
  hud.setHost(host);
  if (options.hudParent) {
    hud.mount(options.hudParent);
  } else {
    hud.mount();
  }

  // Build public API.
  const api: DebugSuiteAPI = {
    events: makeEventBufferAPI(buffer),
    state: () => inspector.state(),
    diff: (sinceMs, untilMs) => inspector.diff(sinceMs, untilMs),
    watch: (path, listener) => inspector.watch(path, listener),
    emit: (name, payload) => injector.emit(name, payload),
    simulateRecv: (name, payload) =>
      injector.simulateRecv(name as keyof SpilloramaSocketListeners, payload as Parameters<SpilloramaSocketListeners[keyof SpilloramaSocketListeners]>[0]),
    simulateOffline: (ms) => simulator.simulateOffline(ms),
    simulateLatency: (ms) => simulator.setLatency(ms),
    simulatePacketLoss: (percent) => simulator.setPacketLoss(percent),
    simulateRaceCondition: (config) => simulator.simulateRaceCondition(config),
    profile: {
      start: (label, key) => profiler.start(label, key),
      end: (label, key) => profiler.end(label, key),
      recordEventLatency: (eventType, durationMs) =>
        profiler.recordEventLatency(eventType, durationMs),
      report: () => profiler.report(),
      reset: () => profiler.reset(),
    },
    stress: (config) => stress.run(config),
    network: {
      frames: () => network.frames(),
      window: (ms) => network.window(ms),
      throughput: (ms) => network.throughput(ms),
      clear: () => network.clear(),
    },
    snapshots: () => snapshots.list().map(decorateSnapshotForExport),
    snapshot: (id) => {
      const s = snapshots.get(id);
      return s ? decorateSnapshotForExport(s) : null;
    },
    takeSnapshot: (reason) => snapshots.takeSnapshot(reason),
    setLogLevel: (level: LogLevel) => logger.setLevel(level),
    toggleHud: () => hud.toggle(),
    installed: true,
    version: DEBUG_SUITE_VERSION,
  };

  // Bind to the host getter so `installDebugSuite` callers can register a
  // state-getter post-mount.
  (api as unknown as { __setStateGetter: (getter: (() => unknown) | null) => void }).__setStateGetter = (getter) => {
    inspector.setStateGetter(getter);
    snapshots.setStateGetter(getter);
  };

  // Mount on window.
  const winAny = window as unknown as { spillorama?: { debug?: DebugSuiteAPI } };
  winAny.spillorama = { ...(winAny.spillorama ?? {}), debug: api };

  // Persist activation so reload keeps the suite up.
  persistDebugEnabled(true);

  // Tobias-direktiv 2026-05-13: Rrweb DOM session-replay. Start automatisk
  // når debug-suite installeres. Lazy-load rrweb fra node_modules; fail-soft
  // hvis modulen mangler eller backend er nede. Token resolves via samme
  // logikk som EventStreamer (URL ?debugToken= / localStorage / default).
  try {
    const recorder = setupRrwebRecorder({
      token: resolveDebugTokenForRrweb(),
      // Default endpoint /api/_dev/debug/rrweb-events
      // Default flushIntervalMs 2000
      // Default recordCanvas true (fange Pixi.js)
    });
    void recorder.start().catch((err: unknown) => {
      logger.warn("system", "rrweb.start.failed", { err: String(err) });
    });
  } catch (err) {
    logger.warn("system", "rrweb.setup.failed", { err: String(err) });
  }

  logger.success("system", "debug.installed", {
    version: DEBUG_SUITE_VERSION,
    options: { ...options, hudParent: options.hudParent ? "[element]" : undefined },
  });
  // Initial baseline snapshot so the first watcher immediately has a
  // reference point.
  try {
    inspector.recordSnapshot();
  } catch {
    /* ignore */
  }

  void lastConnAt; // future feature: emit "stuck-disconnect" alert after N ms

  installed = {
    api,
    unmount: () => {
      window.removeEventListener("error", errHandler);
      window.removeEventListener("unhandledrejection", rejHandler);
      unsubConn();
      for (const u of unsubChannels) u();
      unsubDraw();
      hud.unmount();
      // Restore patched ack-emits.
      for (const [name, orig] of originalAcks) {
        (socket as unknown as Record<string, unknown>)[name] = orig;
      }
      sockAny.__emitForDebug = undefined;
      sockAny.__spilloramaDebugEmitPatched = false;
      // Tobias-direktiv 2026-05-13: stop Rrweb-recorder + clear singleton
      // ved unmount.
      try {
        resetRrwebRecorder();
      } catch {
        /* best-effort */
      }
      const w = window as unknown as { spillorama?: { debug?: DebugSuiteAPI } };
      if (w.spillorama) {
        w.spillorama.debug = undefined;
      }
      installed = null;
    },
  };
  return installed;
}

/**
 * Resolve token for RrwebRecorder. Samme strategi som
 * Game1Controller.resolveDebugStreamToken:
 *   1. URL `?debugToken=<token>` — ad-hoc override
 *   2. localStorage `SPILL1_DEBUG_STREAM_TOKEN` — vedvarende per browser
 *   3. Default `spillorama-2026-test` — matcher dev-default
 *
 * Recorder håndterer 401/403 fail-soft, så et feil default-token er kun
 * mer støy i devtools, ikke en bug.
 */
function resolveDebugTokenForRrweb(): string {
  try {
    if (typeof window === "undefined") return "spillorama-2026-test";
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("debugToken")?.trim();
    if (fromQuery) return fromQuery;
    const fromLs =
      typeof window.localStorage !== "undefined"
        ? window.localStorage.getItem("SPILL1_DEBUG_STREAM_TOKEN")?.trim()
        : null;
    if (fromLs) return fromLs;
    return "spillorama-2026-test";
  } catch {
    return "spillorama-2026-test";
  }
}

/**
 * Helper that hosts (Game Controllers, visual-harness) call AFTER they
 * have a state-getter ready. Lets us mount the HUD before the engine is
 * fully wired without missing the first state snapshot.
 */
export function setDebugStateGetter(getter: (() => unknown) | null): void {
  if (!installed) return;
  const sym = installed.api as unknown as { __setStateGetter?: (g: (() => unknown) | null) => void };
  sym.__setStateGetter?.(getter);
}

/**
 * Backend-less variant for the visual-harness. Mounts the HUD + buffer +
 * inspector + profiler + snapshot store, but skips the socket monkey-patch
 * (since the harness has no live socket). Operators get the same console
 * API + HUD shortcut, scoped to the harness scenario.
 */
export function installDebugSuiteVisualOnly(
  options: InstallOptions = {},
): InstalledSuite | null {
  if (!isDebugEnabled()) return null;
  if (installed) return installed;

  const logger = new DebugLogger(options.gameSlug ?? "harness");
  const buffer = new EventBuffer(500);
  const network = new NetworkTap();
  const profiler = new PerformanceProfiler();
  const inspector = new StateInspector();
  inspector.setLogger(logger);
  const snapshots = new SnapshotManager(buffer);

  logger.subscribe((event) => buffer.record(event));
  void snapshots.init();

  const errHandler = (ev: ErrorEvent) => {
    logger.error("error", "window.error", { message: ev.message, source: ev.filename });
    void snapshots.maybeAutoCapture(`window.error: ${ev.message ?? "unknown"}`);
  };
  window.addEventListener("error", errHandler);

  const hud = new DebugHud();
  hud.setNetwork(network);
  hud.setBuffer(buffer);
  hud.setHost({
    getState: () => inspector.state(),
    getConnectionState: () => "harness",
    getLatencyMs: () => null,
    getLastAutoDrawTick: () => null,
    getDrawsTriggered: () => 0,
    getIdentity: () => ({
      gameSlug: options.gameSlug,
      hallId: options.hallId,
      playerId: options.playerId,
      walletId: options.walletId,
    }),
  });
  if (options.hudParent) hud.mount(options.hudParent); else hud.mount();

  const api: DebugSuiteAPI = {
    events: makeEventBufferAPI(buffer),
    state: () => inspector.state(),
    diff: (sinceMs, untilMs) => inspector.diff(sinceMs, untilMs),
    watch: (path, listener) => inspector.watch(path, listener),
    emit: () => Promise.resolve({ ok: false, error: { code: "NO_SOCKET_IN_HARNESS" } }),
    simulateRecv: () => {
      logger.warn("system", "simulateRecv.no-socket-in-harness");
    },
    simulateOffline: () => Promise.resolve(),
    simulateLatency: () => {
      logger.warn("system", "simulateLatency.no-socket-in-harness");
    },
    simulatePacketLoss: () => {
      logger.warn("system", "simulatePacketLoss.no-socket-in-harness");
    },
    simulateRaceCondition: () => Promise.resolve(),
    profile: {
      start: (label, key) => profiler.start(label, key),
      end: (label, key) => profiler.end(label, key),
      recordEventLatency: (eventType, durationMs) => profiler.recordEventLatency(eventType, durationMs),
      report: () => profiler.report(),
      reset: () => profiler.reset(),
    },
    stress: () => Promise.resolve({ config: { rapidPurchase: 0 }, startedAt: 0, endedAt: 0, durationMs: 0, ok: 0, failed: 0, latencies: [], summary: ["no-socket-in-harness"] }),
    network: {
      frames: () => network.frames(),
      window: (ms) => network.window(ms),
      throughput: (ms) => network.throughput(ms),
      clear: () => network.clear(),
    },
    snapshots: () => snapshots.list().map(decorateSnapshotForExport),
    snapshot: (id) => {
      const s = snapshots.get(id);
      return s ? decorateSnapshotForExport(s) : null;
    },
    takeSnapshot: (reason) => snapshots.takeSnapshot(reason),
    setLogLevel: (level) => logger.setLevel(level),
    toggleHud: () => hud.toggle(),
    installed: true,
    version: DEBUG_SUITE_VERSION,
  };

  (api as unknown as { __setStateGetter: (getter: (() => unknown) | null) => void }).__setStateGetter = (getter) => {
    inspector.setStateGetter(getter);
    snapshots.setStateGetter(getter);
  };

  const winAny = window as unknown as { spillorama?: { debug?: DebugSuiteAPI } };
  winAny.spillorama = { ...(winAny.spillorama ?? {}), debug: api };
  persistDebugEnabled(true);

  logger.success("system", "debug.installed.harness", { version: DEBUG_SUITE_VERSION });

  installed = {
    api,
    unmount: () => {
      window.removeEventListener("error", errHandler);
      hud.unmount();
      const w = window as unknown as { spillorama?: { debug?: DebugSuiteAPI } };
      if (w.spillorama) w.spillorama.debug = undefined;
      installed = null;
    },
  };
  return installed;
}
