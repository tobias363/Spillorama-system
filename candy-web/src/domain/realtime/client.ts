import { io, type Socket } from "socket.io-client";
import type { AckResponse, RealtimeRoomSnapshot, RealtimeRoomStateAck, RealtimeSession } from "@/domain/realtime/contracts";

interface RealtimeClientHandlers {
  onConnect: () => void;
  onConnectError: (message: string) => void;
  onDisconnect: (reason: string) => void;
  onRoomUpdate: (snapshot: RealtimeRoomSnapshot) => void;
}

let socket: Socket | null = null;
let socketBaseUrl = "";

export function getRealtimeSocket(session: RealtimeSession, handlers: RealtimeClientHandlers): Socket {
  if (socket && socketBaseUrl === session.baseUrl) {
    socket.off("connect");
    socket.off("connect_error");
    socket.off("disconnect");
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

function bindHandlers(currentSocket: Socket, handlers: RealtimeClientHandlers): void {
  currentSocket.on("connect", handlers.onConnect);
  currentSocket.on("connect_error", (error: Error) => {
    handlers.onConnectError(error.message);
  });
  currentSocket.on("disconnect", handlers.onDisconnect);
  currentSocket.on("room:update", handlers.onRoomUpdate);
}

function emitWithAck<T>(
  currentSocket: Socket,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    currentSocket.emit(eventName, payload, (response: AckResponse<T>) => resolve(response));
  });
}
