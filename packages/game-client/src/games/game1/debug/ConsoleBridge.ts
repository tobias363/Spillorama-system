/**
 * ConsoleBridge — pipe relevant client-side `console.*`-output til
 * EventTracker så server-side live-monitor kan SE samme data som Tobias
 * ser i devtools.
 *
 * Tobias-direktiv 2026-05-13: "Er det ikke mulig å sette opp at agenten
 * som overvåker hva som skjer får tilgang til konsoll?"
 *
 * Mekanisme:
 *   1. Wrap window.console.log/warn/error/info/debug
 *   2. For meldinger som matcher relevante patterns ([BUY-DEBUG], [ROOM],
 *      [CLI-BINGO], [blink], [test], etc.), kall ALSO
 *      `getEventTracker().track("console.<level>", { message, args })`
 *   3. Resten passerer uendret til original console
 *   4. Recursion-safe: når vi pusher event blir det IKKE re-loggred
 *      gjennom bridge-en (vi setter en flag inn-til-ut)
 *
 * Gate på `?debug=1` eller `localStorage.DEBUG_SPILL1_DRAWS=true` så
 * inert i produksjon.
 */

import { getEventTracker } from "./EventTracker.js";

/**
 * Regex som matcher relevante log-prefikser. Hold listen kort så vi ikke
 * spammer event-bufferen med uvedkommende loggs.
 *
 * MERK: Hvis vi vil utvide, legg til mønster her — IKKE catch-all (`.*`).
 * Catch-all ville pushed Pixi-warnings, Service Worker-meldinger, etc.,
 * og fylt monitor-bufferen med støy.
 */
const RELEVANT_PATTERNS: readonly RegExp[] = [
  /^\[BUY-DEBUG\]/,
  /^\[ROOM\]/,
  /^\[CLI-BINGO/, // matches both `[CLI-BINGO-NNNN]` and `[CLI-BINGO]`
  /^\[blink\]/,
  /^\[test\]/,
  /^\[client/,
  /^\[buy-api\]/,
  /^\[ws/,
  /^\[ws\./,
  /^\[wallet/,
  /^\[ledger/,
  /^\[ROOM\]/,
];

const ORIGINAL_CONSOLE_KEY = "__spilloramaConsoleBridgeInstalled";

interface ConsoleLevel {
  level: "log" | "warn" | "error" | "info" | "debug";
  method: (...args: unknown[]) => void;
}

let installed = false;
let reentrancyGuard = false;

function shouldBridgeMessage(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first !== "string") return false;
  return RELEVANT_PATTERNS.some((pattern) => pattern.test(first));
}

/**
 * Tobias-direktiv 2026-05-13: `console.error` og `console.warn` skal ALLTID
 * bridges, uavhengig av RELEVANT_PATTERNS. Dette gjør at PM-agenten ser
 * runtime-issues som biblioteks-warnings og generelle errors.
 *
 * `.log/.info/.debug` beholder pattern-match (ellers fyller vi bufferen
 * med Pixi/Vite/Service-Worker-støy).
 */
function shouldAlwaysBridgeLevel(level: ConsoleLevel["level"]): boolean {
  return level === "error" || level === "warn";
}

function safeSerialize(args: unknown[]): unknown[] {
  // Bedre å sende objekter som JSON-serialiserbare versjoner enn å
  // risikere circular-reference-errors i EventTracker.
  return args.map((arg) => {
    if (arg === null || arg === undefined) return arg;
    if (typeof arg === "string" || typeof arg === "number" || typeof arg === "boolean") {
      return arg;
    }
    try {
      return JSON.parse(JSON.stringify(arg));
    } catch {
      return String(arg);
    }
  });
}

/**
 * Installer ConsoleBridge på globalt `window.console`. Idempotent —
 * gjentatte kall er trygge.
 *
 * Returnerer `uninstall`-funksjon hvis test trenger å reverse.
 */
export function installConsoleBridge(): () => void {
  if (typeof window === "undefined" || typeof console === "undefined") {
    return () => {};
  }

  // Sjekk om allerede installert (idempotent)
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[ORIGINAL_CONSOLE_KEY] === true || installed) {
    return () => {};
  }

  // Gate på debug-flagg så vi ikke pålegger overhead i prod
  const enabled = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") return true;
      if (params.get("debug") === "true") return true;
      const ls = window.localStorage?.getItem("DEBUG_SPILL1_DRAWS");
      return ls?.trim().toLowerCase() === "true";
    } catch {
      return false;
    }
  })();
  if (!enabled) return () => {};

  const originals: ConsoleLevel[] = [
    { level: "log",   method: console.log.bind(console) },
    { level: "warn",  method: console.warn.bind(console) },
    { level: "error", method: console.error.bind(console) },
    { level: "info",  method: console.info.bind(console) },
    { level: "debug", method: console.debug.bind(console) },
  ];

  for (const { level, method } of originals) {
    (console as unknown as Record<string, (...args: unknown[]) => void>)[level] =
      (...args: unknown[]): void => {
        // ALLTID kall original så Tobias fortsatt ser i devtools
        try {
          method(...args);
        } catch {
          /* original console feiler aldri normalt */
        }

        // Hvis recursion-guard er på, ikke re-emit (forhindrer
        // infinite-loop hvis EventTracker selv logger via console).
        if (reentrancyGuard) return;
        // Tobias-direktiv 2026-05-13: error/warn skal ALLTID bridges,
        // andre nivåer trenger pattern-match for å unngå Pixi/Vite-støy.
        const alwaysBridge = shouldAlwaysBridgeLevel(level);
        if (!alwaysBridge && !shouldBridgeMessage(args)) return;

        reentrancyGuard = true;
        try {
          const tracker = getEventTracker();
          const firstArg = args[0];
          const firstArgStr =
            typeof firstArg === "string" ? firstArg : String(firstArg);
          // Strip leading [TAG] for å lage stable event-subtype
          const tagMatch = firstArgStr.match(
            /^\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?)\]/,
          );
          const tag = tagMatch ? tagMatch[1] : "untagged";
          tracker.track(`console.${level}`, {
            tag,
            message: firstArgStr.slice(0, 1000),
            extra: safeSerialize(args.slice(1)),
          });
        } catch {
          /* EventTracker kan kaste hvis singleton ikke initialisert
           * ennå — safe to skip; klient er fortsatt i pre-mount-fase */
        } finally {
          reentrancyGuard = false;
        }
      };
  }

  w[ORIGINAL_CONSOLE_KEY] = true;
  installed = true;

  // Returnér uninstall for test-isolation
  return () => {
    for (const { level, method } of originals) {
      (console as unknown as Record<string, (...args: unknown[]) => void>)[level] =
        method;
    }
    w[ORIGINAL_CONSOLE_KEY] = undefined;
    installed = false;
  };
}
