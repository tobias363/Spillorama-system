/**
 * Task 1.7 (2026-04-24): socket-wrapper for TV-skjerm.
 *
 * Kobler til default-namespace via socket.io-client og abonnerer på:
 *   - `game1:hall-status-update` → TV oppdaterer badge-farge for hall
 *   - `game1:phase-won`          → TV viser "BINGO! Rad N"-banner i 3s
 *
 * Serveren forventer at TVen joiner `hall:<hallId>:display`-rommet.
 * I produksjon skjer dette via `admin-display:subscribe`-handshaket
 * (BIN-498). TVen sender først `admin-display:login { token }` og deretter
 * `admin-display:subscribe` — begge ack-bundet.
 *
 * Fallback: polling-loopen i TVScreenPage fortsetter å kjøre uavhengig av
 * socket-status; socket er "push-optimization", ikke kritisk path. Hvis
 * socket er disconnected, fanger neste poll (2s) opp endringer.
 *
 * NOTE: Denne TVen har ikke gyldig tvToken tilgjengelig som
 * `admin-display:login`-token i dette trinnet — vi bruker tvToken (fra URL)
 * som login-token. PlatformService.verifyHallTvToken validerer samme token
 * for REST-endpoint, så gjenbruk er trygg. Hvis servers validering feiler,
 * disconnecter vi uten å feile TV-rendering — pollingen dekker state.
 */

import { io, type Socket } from "socket.io-client";

export interface TvScreenSocketHandlers {
  onHallStatusUpdate: (payload: {
    gameId?: string;
    hallId: string;
    color?: "red" | "orange" | "green";
    playerCount?: number;
    isReady?: boolean;
    excludedFromGame?: boolean;
    at?: number;
  }) => void;
  onPhaseWon: (payload: {
    gameId: string;
    patternName: string;
    phase: number;
    winnerCount?: number;
    drawIndex?: number;
    at?: number;
  }) => void;
  /** Kalles ved connect/disconnect-overganger (debug only). */
  onConnectionChange?: (connected: boolean) => void;
}

export interface TvScreenSocketHandle {
  dispose: () => void;
  isConnected: () => boolean;
}

export interface TvScreenSocketOptions {
  hallId: string;
  tvToken: string;
  handlers: TvScreenSocketHandlers;
  /** Testing-hook: bytte ut socket.io-client for unit-tests. */
  _ioFactory?: typeof io;
  /** Testing-hook: base-URL (default = window.location.origin). */
  baseUrl?: string;
}

export function connectTvScreenSocket(
  opts: TvScreenSocketOptions
): TvScreenSocketHandle {
  const ioFactory = opts._ioFactory ?? io;
  const baseUrl =
    opts.baseUrl ??
    (typeof window !== "undefined" ? window.location.origin : "http://localhost");

  let disposed = false;

  const socket: Socket = ioFactory(baseUrl, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
  });

  /**
   * Handshake-flyt:
   *   1. admin-display:login  { token: tvToken }
   *   2. admin-display:subscribe { hallId }
   * Hvis noen av disse feiler, logger vi og fortsetter — pollingen dekker.
   */
  async function bindDisplay(): Promise<void> {
    await new Promise<void>((resolve) => {
      socket.emit("admin-display:login", { token: opts.tvToken }, (ack: unknown) => {
        const ok = typeof ack === "object" && ack !== null && (ack as { ok?: unknown }).ok === true;
        if (!ok && typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn("[tv-socket] admin-display:login failed — polling-only mode");
        }
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      socket.emit(
        "admin-display:subscribe",
        { hallId: opts.hallId },
        (ack: unknown) => {
          const ok =
            typeof ack === "object" && ack !== null && (ack as { ok?: unknown }).ok === true;
          if (!ok && typeof console !== "undefined") {
            // eslint-disable-next-line no-console
            console.warn("[tv-socket] admin-display:subscribe failed — polling-only mode");
          }
          resolve();
        }
      );
    });
  }

  socket.on("connect", () => {
    if (disposed) return;
    opts.handlers.onConnectionChange?.(true);
    void bindDisplay();
  });

  socket.on("disconnect", () => {
    if (disposed) return;
    opts.handlers.onConnectionChange?.(false);
  });

  socket.on("game1:hall-status-update", (payload: unknown) => {
    if (disposed) return;
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    if (typeof p.hallId !== "string" || !p.hallId) return;
    opts.handlers.onHallStatusUpdate({
      gameId: typeof p.gameId === "string" ? p.gameId : undefined,
      hallId: p.hallId,
      color:
        p.color === "red" || p.color === "orange" || p.color === "green"
          ? p.color
          : undefined,
      playerCount: typeof p.playerCount === "number" ? p.playerCount : undefined,
      isReady: typeof p.isReady === "boolean" ? p.isReady : undefined,
      excludedFromGame:
        typeof p.excludedFromGame === "boolean" ? p.excludedFromGame : undefined,
      at: typeof p.at === "number" ? p.at : undefined,
    });
  });

  socket.on("game1:phase-won", (payload: unknown) => {
    if (disposed) return;
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    if (
      typeof p.gameId !== "string" ||
      typeof p.patternName !== "string" ||
      typeof p.phase !== "number"
    ) {
      return;
    }
    opts.handlers.onPhaseWon({
      gameId: p.gameId,
      patternName: p.patternName,
      phase: p.phase,
      winnerCount: typeof p.winnerCount === "number" ? p.winnerCount : undefined,
      drawIndex: typeof p.drawIndex === "number" ? p.drawIndex : undefined,
      at: typeof p.at === "number" ? p.at : undefined,
    });
  });

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        // Ikke kritisk — la socket.io rydde selv.
      }
    },
    isConnected: () => socket.connected,
  };
}
