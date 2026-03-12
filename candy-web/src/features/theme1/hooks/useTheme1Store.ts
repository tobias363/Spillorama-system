import { create } from "zustand";
import type { RealtimeRoomSnapshot, RealtimeSession } from "@/domain/realtime/contracts";
import { connectRealtimeSocket, disposeRealtimeSocket, getRealtimeSocket, requestRoomState } from "@/domain/realtime/client";
import { mapRoomSnapshotToTheme1 } from "@/domain/theme1/mappers/mapRoomSnapshotToTheme1";
import type { Theme1ConnectionPhase, Theme1DataSource, Theme1RoundRenderModel } from "@/domain/theme1/renderModel";
import { theme1MockSnapshot } from "@/features/theme1/data/theme1MockSnapshot";

interface Theme1ConnectionState {
  phase: Theme1ConnectionPhase;
  label: string;
  message: string;
}

interface Theme1State {
  mode: Theme1DataSource;
  snapshot: Theme1RoundRenderModel;
  roomSnapshot: RealtimeRoomSnapshot | null;
  session: RealtimeSession;
  connection: Theme1ConnectionState;
  setSessionField: (field: keyof RealtimeSession, value: string) => void;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  useMockMode: () => void;
}

const STORAGE_KEY = "candy-web.realtime-session";
const DEFAULT_BACKEND_URL = "http://127.0.0.1:4000";

export const useTheme1Store = create<Theme1State>((set, get) => ({
  mode: "mock",
  snapshot: theme1MockSnapshot,
  roomSnapshot: null,
  session: readInitialSession(),
  connection: {
    phase: "mock",
    label: "Mock",
    message: "Ingen live room tilkoblet ennå.",
  },
  setSessionField: (field, value) => {
    const nextSession = { ...get().session, [field]: value };
    writeSession(nextSession);
    set({ session: nextSession });
  },
  connect: async () => {
    const session = normalizeSession(get().session);
    writeSession(session);
    set({
      session,
      connection: {
        phase: "connecting",
        label: "Kobler til",
        message: "Henter room state fra backend...",
      },
    });

    if (!session.roomCode) {
      set({
        mode: "mock",
        connection: {
          phase: "error",
          label: "Feil",
          message: "Room code mangler. Fortsetter i mock-modus til du fyller inn en romkode.",
        },
      });
      return;
    }

    const socket = getRealtimeSocket(session, {
      onConnect: () => {
        set({
          connection: {
            phase: "connected",
            label: "Live",
            message: "Tilkoblet backend. Synkroniserer room state.",
          },
        });
        void get().refresh();
      },
      onDisconnect: (reason) => {
        set({
          connection: {
            phase: "disconnected",
            label: "Frakoblet",
            message: `Socket frakoblet: ${reason}`,
          },
        });
      },
      onRoomUpdate: (snapshot) => {
        applyLiveSnapshot(snapshot, set, get);
      },
    });

    connectRealtimeSocket(socket);
    if (socket.connected) {
      await get().refresh();
    }
  },
  refresh: async () => {
    const session = normalizeSession(get().session);
    if (!session.roomCode) {
      return;
    }

    const socket = getRealtimeSocket(session, {
      onConnect: () => undefined,
      onDisconnect: (reason) => {
        set({
          connection: {
            phase: "disconnected",
            label: "Frakoblet",
            message: `Socket frakoblet: ${reason}`,
          },
        });
      },
      onRoomUpdate: (snapshot) => {
        applyLiveSnapshot(snapshot, set, get);
      },
    });

    const response = await requestRoomState(socket, session);
    if (!response.ok || !response.data?.snapshot) {
      set({
        connection: {
          phase: "error",
          label: "Feil",
          message: response.error?.message || "Klarte ikke hente room state fra backend.",
        },
      });
      return;
    }

    applyLiveSnapshot(response.data.snapshot, set, get);
  },
  useMockMode: () => {
    disposeRealtimeSocket();
    set({
      mode: "mock",
      roomSnapshot: null,
      snapshot: {
        ...theme1MockSnapshot,
        meta: {
          ...theme1MockSnapshot.meta,
          backendUrl: normalizeSession(get().session).baseUrl,
        },
      },
      connection: {
        phase: "mock",
        label: "Mock",
        message: "Bruker lokal mock-state. Koble til igjen når du vil hente ekte room data.",
      },
    });
  },
}));

function applyLiveSnapshot(
  snapshot: RealtimeRoomSnapshot,
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
): void {
  const result = mapRoomSnapshotToTheme1(snapshot, {
    session: normalizeSession(get().session),
    connectionPhase: "connected",
  });

  const nextSession =
    get().session.playerId || !result.resolvedPlayerId
      ? get().session
      : { ...get().session, playerId: result.resolvedPlayerId };

  writeSession(nextSession);
  set({
    mode: "live",
    roomSnapshot: snapshot,
    session: nextSession,
    snapshot: result.model,
    connection: {
      phase: "connected",
      label: "Live",
      message: `Live room lastet: ${snapshot.code} (${snapshot.players.length} spillere).`,
    },
  });
}

function readInitialSession(): RealtimeSession {
  const stored = readStoredSession();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

  return normalizeSession({
    baseUrl: params?.get("backendUrl") || stored.baseUrl || DEFAULT_BACKEND_URL,
    roomCode: params?.get("roomCode") || stored.roomCode || "",
    playerId: params?.get("playerId") || stored.playerId || "",
    accessToken: params?.get("accessToken") || stored.accessToken || "",
  });
}

function readStoredSession(): Partial<RealtimeSession> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<RealtimeSession>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSession(session: RealtimeSession): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function normalizeSession(session: RealtimeSession): RealtimeSession {
  return {
    baseUrl: session.baseUrl.trim() || DEFAULT_BACKEND_URL,
    roomCode: session.roomCode.trim(),
    playerId: session.playerId.trim(),
    accessToken: session.accessToken.trim(),
  };
}
