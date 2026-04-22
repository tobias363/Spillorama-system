// PR-PT6 — Socket-wrapper for `game1:physical-ticket-won`-events.
//
// Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.5
//       + PhysicalTicketPayoutService (PT4) broadcast.
//
// PendingPayoutsPage bruker denne for å få toast + auto-reload når en fysisk
// bong vinner under live-spill. Wrapper sitter oppå socket.io-client og
// abonnerer på et enkelt gameId (matcher adminGame1Socket-mønsteret brukt i
// master-konsollen).
//
// Exposes en `PhysicalTicketWonSocketHandle` med `dispose()` +
// `onConnectionChange()` så UI kan vise status.

import { io, type Socket } from "socket.io-client";
import { getToken } from "../../api/client.js";

export interface PhysicalTicketWonPayload {
  gameId: string;
  phase: number;
  patternName: string;
  pendingPayoutId: string;
  ticketId: string;
  hallId: string;
  responsibleUserId: string;
  expectedPayoutCents: number;
  color: string;
  adminApprovalRequired: boolean;
  at: number;
}

export interface PhysicalTicketWonSocketHandle {
  dispose: () => void;
  onConnectionChange: (cb: (connected: boolean) => void) => void;
}

/**
 * Kobler til `/admin-game1`-namespace og abonnerer på events for ett gameId.
 * Kaller `onWon` hver gang en bong vinner. Håndterer re-subscribe ved
 * reconnect; dispose rydder socket + listeners.
 */
export function connectPhysicalTicketWonSocket(
  gameId: string,
  onWon: (payload: PhysicalTicketWonPayload) => void,
): PhysicalTicketWonSocketHandle {
  let connectionCb: ((connected: boolean) => void) | null = null;
  let disposed = false;

  const socket: Socket = io(`${window.location.origin}/admin-game1`, {
    auth: { token: getToken() },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
  });

  socket.on("connect", () => {
    if (disposed) return;
    socket.emit("game1:subscribe", { gameId });
    connectionCb?.(true);
  });

  socket.on("disconnect", () => {
    if (disposed) return;
    connectionCb?.(false);
  });

  socket.on("connect_error", () => {
    if (disposed) return;
    connectionCb?.(false);
  });

  socket.on("game1:physical-ticket-won", (payload: PhysicalTicketWonPayload) => {
    if (disposed) return;
    if (!payload || payload.gameId !== gameId) return;
    onWon(payload);
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        socket.emit("game1:unsubscribe", { gameId });
      } catch {
        // socket kan allerede være nede
      }
      socket.removeAllListeners();
      socket.disconnect();
    },
    onConnectionChange(cb: (connected: boolean) => void): void {
      connectionCb = cb;
      if (socket.connected) cb(true);
    },
  };
}
