/**
 * SocketEmitInstrument — proxy/wrapper for SpilloramaSocket som logger
 * emit-kall til EventTracker (Tobias-direktiv 2026-05-13).
 *
 * Bakgrunn:
 *   "vi må nå bygge slik at test agenten får alt av mulig tilgjengelig
 *   informasjon" — Tobias 2026-05-13.
 *
 *   FetchInstrument dekker REST-kall. Denne dekker socket-emits. Sammen
 *   gir de PM-agenten 100% nettverks-synlighet uten å edite forretnings-
 *   logikk.
 *
 * Designvalg:
 *   - Wrapper-pattern: vi proxy-er public-metodene på SpilloramaSocket-
 *     instansen og legger inn track-kall før/etter den originale calle.
 *   - Idempotent — instrumentert socket merkes med en sentinel-flag.
 *   - Fail-soft — hvis tracker eller wrapping kaster, lar vi originalen
 *     passere.
 *   - Recursion-safe — vi triggerer ikke track innenfor en annen track-
 *     callback (guard flag).
 *
 * Personvern:
 *   - Payload sanitiseres allerede av EventTracker (`SENSITIVE_KEYS`)
 *   - `accessToken` på toppnivå redactes av EventTracker
 *   - For room:join/room:create-payloads vises kun key-list pluss noen
 *     få trygge felter
 */

import { getEventTracker } from "./EventTracker.js";

const INSTRUMENT_SOCKET_KEY = "__spilloramaSocketInstrumented";

/**
 * Liste over kjente emit-metoder på SpilloramaSocket. Disse er metodene
 * vi proxy-er. Hver av dem returnerer en Promise<AckResponse<T>>.
 *
 * Hvis SpilloramaSocket utvides med nye public-emit-metoder, må de
 * legges til her for å bli logget.
 */
const EMIT_METHODS: readonly string[] = [
  "createRoom",
  "joinRoom",
  "leaveRoom",
  "resumeRoom",
  "subscribeSpill1Lobby",
  "unsubscribeSpill1Lobby",
  "buyTickets",
  "buyExtraDraws",
  "armBet",
  "markCell",
  "submitClaim",
  "submitClaimWithIdempotency",
  "drawNext",
  "endGame",
  "startGame",
  "pauseGame",
  "resumeGame",
  "transferHallAccess",
  "setReady",
  "unsetReady",
  "setLuckyNumber",
];

/** Sentinel for å unngå rekursjon hvis en wrapped-metode logger via console. */
let reentrancyGuard = false;

type AckLike = { ok: boolean; error?: { code?: string; message?: string } };

/**
 * Instrumenter en SpilloramaSocket-instans (eller annet objekt som
 * eksponerer EMIT_METHODS). Idempotent.
 *
 * Strategi:
 *   For hver metode i EMIT_METHODS:
 *     1. Hent original method-binding.
 *     2. Erstatt med wrapper som:
 *        - track `socket.emit` med metode-navn + payload-keys
 *        - kaller original
 *        - track `socket.recv` med ack-status (ok + evt error-code)
 *     3. Beholder this-binding via .bind(socket).
 *
 * Returnerer uninstall-funksjon (restorer originaler).
 */
export function installSocketEmitInstrument<T extends object>(
  socket: T,
): () => void {
  if (!socket || typeof socket !== "object") return () => {};

  const target = socket as Record<string, unknown> & {
    [INSTRUMENT_SOCKET_KEY]?: boolean;
  };

  if (target[INSTRUMENT_SOCKET_KEY] === true) {
    return () => {};
  }

  const originals: Record<string, (...args: unknown[]) => unknown> = {};

  for (const methodName of EMIT_METHODS) {
    const original = target[methodName];
    if (typeof original !== "function") continue;
    originals[methodName] = original as (...args: unknown[]) => unknown;

    const wrapped = async (...args: unknown[]): Promise<unknown> => {
      const startMs = Date.now();
      // Track emit (fail-soft)
      let correlationId: string | undefined;
      if (!reentrancyGuard) {
        try {
          reentrancyGuard = true;
          const tracker = getEventTracker();
          const payload = args[0];
          const payloadKeys =
            typeof payload === "object" && payload !== null
              ? Object.keys(payload as Record<string, unknown>)
              : [];
          // Plukk ut roomCode hvis den finnes (trygt felt for korrelasjon)
          const roomCode =
            typeof payload === "object" &&
            payload !== null &&
            typeof (payload as Record<string, unknown>)["roomCode"] === "string"
              ? (payload as Record<string, string>)["roomCode"]
              : undefined;
          correlationId = tracker.track("socket.emit", {
            method: methodName,
            payloadKeys,
            roomCode,
            startMs,
          });
        } catch {
          /* fail-soft */
        } finally {
          reentrancyGuard = false;
        }
      }

      // Kall original
      let response: unknown;
      try {
        response = await originals[methodName].apply(socket, args);
      } catch (err) {
        if (!reentrancyGuard) {
          try {
            reentrancyGuard = true;
            const tracker = getEventTracker();
            tracker.track(
              "socket.recv",
              {
                method: methodName,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - startMs,
              },
              { correlationId },
            );
          } catch {
            /* fail-soft */
          } finally {
            reentrancyGuard = false;
          }
        }
        throw err;
      }

      // Track ack-response
      if (!reentrancyGuard) {
        try {
          reentrancyGuard = true;
          const tracker = getEventTracker();
          const ack = response as AckLike | undefined;
          tracker.track(
            "socket.recv",
            {
              method: methodName,
              ok: ack?.ok === true,
              errorCode: ack?.error?.code,
              errorMessage: ack?.error?.message,
              durationMs: Date.now() - startMs,
            },
            { correlationId },
          );
        } catch {
          /* fail-soft */
        } finally {
          reentrancyGuard = false;
        }
      }

      return response;
    };

    target[methodName] = wrapped;
  }

  target[INSTRUMENT_SOCKET_KEY] = true;

  return () => {
    for (const [name, fn] of Object.entries(originals)) {
      target[name] = fn;
    }
    delete target[INSTRUMENT_SOCKET_KEY];
  };
}

// Test-exports
export const __TEST_ONLY__ = {
  EMIT_METHODS,
};
