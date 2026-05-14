/**
 * Synthetic bingo-round-test — Socket.IO client wrapper.
 *
 * Thin wrapper around `socket.io-client` that:
 *   1. Connects with `Authorization: Bearer <token>` (matches backend
 *      `apps/backend/src/sockets/...` auth-middleware).
 *   2. Joins the player to a room (`room:join`).
 *   3. Records `draw:new` + `room:update` + `pattern:won` events for
 *      later invariant evaluation.
 *   4. Emits `ticket:mark` events with `clientRequestId` for R5
 *      idempotency.
 *
 * The wrapper exposes a SMALL interface to make mocking trivial in unit
 * tests. The actual socket.io-client import is dynamic (deferred) so the
 * unit tests can run without resolving the package — they inject a mock.
 *
 * Why dynamic-import? The worktree-runner-pattern means we may run tests
 * in environments where `socket.io-client` is only available via
 * `apps/backend/node_modules`. We use the same fallback-pattern as
 * `scripts/dev/mock-players.mjs:resolveDep`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Minimal subset of the socket.io-client `Socket` interface we use. Real
 * impl in @types/socket.io-client is much broader.
 */
export interface SyntheticSocketLike {
  connected: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  disconnect(): void;
}

/**
 * Factory used by the bot to create a socket. Tests inject a mock; the
 * default factory loads `socket.io-client` via the dual-resolution path
 * (root node_modules or apps/backend/node_modules) used by other dev
 * scripts.
 */
export type SocketFactory = (opts: {
  url: string;
  token: string;
}) => SyntheticSocketLike;

export function defaultSocketFactory(opts: {
  url: string;
  token: string;
}): SyntheticSocketLike {
  // We don't take a top-level dep on socket.io-client in this script
  // because vitest unit-tests inject a mock factory. Production usage
  // (runner) requires `socket.io-client` to be installed at the repo
  // root or in `apps/backend`.
  const req = createRequire(import.meta.url);
  const candidates = [
    path.join(REPO_ROOT, "node_modules", "socket.io-client"),
    path.join(REPO_ROOT, "apps/backend/node_modules/socket.io-client"),
  ];
  let mod: unknown;
  for (const p of candidates) {
    try {
      mod = req(p);
      break;
    } catch {
      // Fall through to next candidate.
    }
  }
  if (!mod) {
    throw new Error(
      "Could not load 'socket.io-client'. Run `npm install` at repo root or `npm --prefix apps/backend install`."
    );
  }
  const ioFn = (mod as { io?: unknown }).io;
  if (typeof ioFn !== "function") {
    throw new Error("socket.io-client did not export `io` function.");
  }
  const socket = (ioFn as (url: string, opts: unknown) => SyntheticSocketLike)(
    opts.url,
    {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 5,
      auth: { token: opts.token },
      extraHeaders: { Authorization: `Bearer ${opts.token}` },
    }
  );
  return socket;
}

/**
 * Record of one observed event. Captured by the bot during the round and
 * fed into invariant evaluators.
 */
export interface RecordedEvent {
  event: string;
  payload: unknown;
  receivedAt: number;
}

export interface SocketObserver {
  socket: SyntheticSocketLike;
  drawnNumbers: number[];
  receivedEvents: RecordedEvent[];
  gameEnded: boolean;
  endedReason: string | null;
  /** Disconnect and prevent reconnect. */
  close(): void;
}

/**
 * Attach event-listeners to a socket and start recording. Returns an
 * `SocketObserver` that the bot can read after the round completes.
 *
 * Events recorded:
 *   - `draw:new`        → drawnNumbers.push(number)
 *   - `room:update`     → receivedEvents (full payload)
 *   - `pattern:won`     → receivedEvents
 *   - `wallet:state`    → receivedEvents
 */
export function attachObserver(socket: SyntheticSocketLike): SocketObserver {
  const observer: SocketObserver = {
    socket,
    drawnNumbers: [],
    receivedEvents: [],
    gameEnded: false,
    endedReason: null,
    close: () => {
      try {
        socket.disconnect();
      } catch {
        /* ignore */
      }
    },
  };

  socket.on("draw:new", (payload: unknown) => {
    observer.receivedEvents.push({
      event: "draw:new",
      payload,
      receivedAt: Date.now(),
    });
    const num = (payload as { number?: unknown })?.number;
    if (typeof num === "number") {
      observer.drawnNumbers.push(num);
    }
  });

  socket.on("room:update", (payload: unknown) => {
    observer.receivedEvents.push({
      event: "room:update",
      payload,
      receivedAt: Date.now(),
    });
    // Check the snapshot for status === ENDED (engine emits this when
    // the round finishes). Note: payload structure is `RoomSnapshot` —
    // we accept any shape so the bot doesn't depend on shared-types
    // build output.
    const p = payload as
      | { currentGame?: { status?: unknown; endedReason?: unknown } }
      | undefined;
    const status = p?.currentGame?.status;
    if (status === "ENDED") {
      observer.gameEnded = true;
      const reason = p?.currentGame?.endedReason;
      observer.endedReason = typeof reason === "string" ? reason : null;
    }
  });

  socket.on("pattern:won", (payload: unknown) => {
    observer.receivedEvents.push({
      event: "pattern:won",
      payload,
      receivedAt: Date.now(),
    });
  });

  socket.on("wallet:state", (payload: unknown) => {
    observer.receivedEvents.push({
      event: "wallet:state",
      payload,
      receivedAt: Date.now(),
    });
  });

  return observer;
}

/**
 * Emit `room:join` with a Promise-wrapped ack. Used by the bot at start-of-
 * round before purchases begin.
 *
 * Times out after `timeoutMs` to prevent hanging if backend doesn't ack
 * (defaults to 5 seconds).
 *
 * **accessToken er PÅKREVD i payload** — backend `getAccessTokenFromSocketPayload`
 * (apps/backend/src/util/httpHelpers.ts:277) krever det. Handshake-auth via
 * `extraHeaders.Authorization` er IKKE nok for `room:join`-event.
 */
export async function joinRoom(
  socket: SyntheticSocketLike,
  payload: {
    accessToken: string;
    roomCode: string;
    gameSlug?: string;
    hallId?: string;
  },
  timeoutMs = 5_000
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "TIMEOUT" });
    }, timeoutMs);
    socket.emit("room:join", payload, (ack: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ackObj = ack as { ok?: unknown; error?: { message?: unknown } };
      if (ackObj?.ok === true) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error:
            typeof ackObj?.error?.message === "string"
              ? ackObj.error.message
              : "JOIN_FAILED",
        });
      }
    });
  });
}
