import { io, type Socket } from "socket.io-client";
import type {
  AckResponse,
  CandyCreateRoomPayload,
  CandyDrawNewPayload,
  RealtimeRoomSnapshot,
  RealtimeRoomStateAck,
  RealtimeSession,
} from "@/domain/realtime/contracts";

interface RealtimeClientHandlers {
  onConnect: () => void;
  onConnectError: (message: string) => void;
  onDisconnect: (reason: string) => void;
  onDrawNew: (payload: CandyDrawNewPayload) => void;
  onRoomUpdate: (snapshot: RealtimeRoomSnapshot) => void;
}

let socket: Socket | null = null;
let socketBaseUrl = "";

export function getRealtimeSocket(session: RealtimeSession, handlers: RealtimeClientHandlers): Socket {
  if (socket && socketBaseUrl === session.baseUrl) {
    socket.off("connect");
    socket.off("connect_error");
    socket.off("disconnect");
    socket.off("draw:new");
    socket.off("room:update");
    bindHandlers(socket, handlers);
    return socket;
  }

  disposeRealtimeSocket();

  socket = io(session.baseUrl, {
    autoConnect: false,
  });
  socketBaseUrl = session.baseUrl;
  bindHandlers(socket, handlers);
  return socket;
}

export function connectRealtimeSocket(currentSocket: Socket): void {
  if (!currentSocket.connected) {
    currentSocket.connect();
  }
}

export function disposeRealtimeSocket(): void {
  if (!socket) {
    return;
  }

  socket.off("connect");
  socket.off("connect_error");
  socket.off("disconnect");
  socket.off("draw:new");
  socket.off("room:update");
  socket.disconnect();
  socket = null;
  socketBaseUrl = "";
}

export async function requestRoomState(
  currentSocket: Socket,
  session: RealtimeSession,
): Promise<AckResponse<RealtimeRoomStateAck>> {
  return emitWithAck<RealtimeRoomStateAck>(currentSocket, "room:state", {
    roomCode: session.roomCode,
    accessToken: session.accessToken || undefined,
  });
}

export async function requestRoomResume(
  currentSocket: Socket,
  session: RealtimeSession,
): Promise<AckResponse<{ snapshot: RealtimeRoomSnapshot }>> {
  return emitWithAck<{ snapshot: RealtimeRoomSnapshot }>(
    currentSocket,
    "room:resume",
    {
      roomCode: session.roomCode,
      playerId: session.playerId,
      accessToken: session.accessToken || undefined,
    },
  );
}

export async function requestRoomCreate(
  currentSocket: Socket,
  session: RealtimeSession,
): Promise<
  AckResponse<{
    roomCode: string;
    playerId: string;
    snapshot: RealtimeRoomSnapshot;
  }>
> {
  const payload: CandyCreateRoomPayload = {
    hallId: session.hallId || undefined,
    accessToken: session.accessToken || undefined,
  };

  return emitWithAck<{
    roomCode: string;
    playerId: string;
    snapshot: RealtimeRoomSnapshot;
  }>(currentSocket, "room:create", { ...payload });
}

export async function requestRoomConfigure(
  currentSocket: Socket,
  session: RealtimeSession,
  entryFee: number,
): Promise<AckResponse<{ snapshot: RealtimeRoomSnapshot; entryFee: number }>> {
  return emitWithAck<{ snapshot: RealtimeRoomSnapshot; entryFee: number }>(
    currentSocket,
    "room:configure",
    {
      roomCode: session.roomCode,
      playerId: session.playerId,
      entryFee,
      accessToken: session.accessToken || undefined,
    },
  );
}

export async function requestBetArm(
  currentSocket: Socket,
  session: RealtimeSession,
  armed: boolean,
): Promise<
  AckResponse<{ snapshot: RealtimeRoomSnapshot; armed: boolean; armedPlayerIds: string[] }>
> {
  return emitWithAck<{
    snapshot: RealtimeRoomSnapshot;
    armed: boolean;
    armedPlayerIds: string[];
  }>(currentSocket, "bet:arm", {
    roomCode: session.roomCode,
    playerId: session.playerId,
    armed,
    accessToken: session.accessToken || undefined,
  });
}

export async function requestTicketReroll(
  currentSocket: Socket,
  session: RealtimeSession,
  input: {
    ticketsPerPlayer?: number;
    ticketIndex?: number;
  } = {},
): Promise<
  AckResponse<{
    snapshot: RealtimeRoomSnapshot;
    ticketsPerPlayer: number;
    ticketCount: number;
    rerolledTicketIndexes: number[];
  }>
> {
  return emitWithAck<{
    snapshot: RealtimeRoomSnapshot;
    ticketsPerPlayer: number;
    ticketCount: number;
    rerolledTicketIndexes: number[];
  }>(currentSocket, "ticket:reroll", {
    roomCode: session.roomCode,
    playerId: session.playerId,
    ticketsPerPlayer: input.ticketsPerPlayer,
    ticketIndex: input.ticketIndex,
    accessToken: session.accessToken || undefined,
  });
}

function bindHandlers(currentSocket: Socket, handlers: RealtimeClientHandlers): void {
  currentSocket.on("connect", handlers.onConnect);
  currentSocket.on("connect_error", (error: Error) => {
    handlers.onConnectError(error.message);
  });
  currentSocket.on("disconnect", handlers.onDisconnect);
  currentSocket.on("draw:new", handlers.onDrawNew);
  currentSocket.on("room:update", handlers.onRoomUpdate);
}

const EMIT_ACK_TIMEOUT_MS = 10_000;

export function emitWithAck<T>(
  currentSocket: Socket,
  eventName: string,
  payload: Record<string, unknown>,
  timeoutMs: number = EMIT_ACK_TIMEOUT_MS,
): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        error: {
          code: "TIMEOUT",
          message: `Server did not respond to "${eventName}" within ${timeoutMs}ms`,
        },
      } as AckResponse<T>);
    }, timeoutMs);

    currentSocket.emit(eventName, payload, (response: AckResponse<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
  });
}
