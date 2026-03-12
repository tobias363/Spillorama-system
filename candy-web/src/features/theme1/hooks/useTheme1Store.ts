import { create } from "zustand";
import type { RealtimeRoomSnapshot, RealtimeSession } from "@/domain/realtime/contracts";
import { connectRealtimeSocket, disposeRealtimeSocket, getRealtimeSocket, requestRoomResume, requestRoomState } from "@/domain/realtime/client";
import { mapRoomSnapshotToTheme1 } from "@/domain/theme1/mappers/mapRoomSnapshotToTheme1";
import type { Theme1ConnectionPhase, Theme1DataSource, Theme1RoundRenderModel } from "@/domain/theme1/renderModel";
import { theme1MockSnapshot } from "@/features/theme1/data/theme1MockSnapshot";

interface Theme1ConnectionState {
  phase: Theme1ConnectionPhase;
  label: string;
  message: string;
}

type Theme1TicketSource = "currentGame" | "preRoundTickets" | "empty";
type Theme1SyncSource = "mock" | "room:resume" | "room:state" | "room:update";

interface Theme1RuntimeSyncState {
  lastTicketSource: Theme1TicketSource;
  lastSyncSource: Theme1SyncSource;
  syncInFlight: boolean;
}

interface Theme1State {
  mode: Theme1DataSource;
  snapshot: Theme1RoundRenderModel;
  roomSnapshot: RealtimeRoomSnapshot | null;
  session: RealtimeSession;
  connection: Theme1ConnectionState;
  runtime: Theme1RuntimeSyncState;
  setSessionField: (field: keyof RealtimeSession, value: string) => void;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  disconnect: () => void;
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
  runtime: {
    lastTicketSource: "empty",
    lastSyncSource: "mock",
    syncInFlight: false,
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

    const socket = getBoundRealtimeSocket(set, get, session);

    connectRealtimeSocket(socket);
    if (socket.connected) {
      await syncLiveSnapshot(set, get, "manual-connect");
    }
  },
  refresh: async () => {
    const session = normalizeSession(get().session);
    if (!session.roomCode) {
      return;
    }

    const socket = getBoundRealtimeSocket(set, get, session);
    if (!socket.connected) {
      set({
        connection: {
          phase: "connecting",
          label: "Kobler til",
          message: "Socket er ikke tilkoblet. Prover a koble opp pa nytt.",
        },
      });
      connectRealtimeSocket(socket);
      return;
    }

    await syncLiveSnapshot(set, get, "manual-refresh");
  },
  disconnect: () => {
    disposeRealtimeSocket();
    set({
      connection: {
        phase: "disconnected",
        label: "Frakoblet",
        message: "Live socket er koblet fra. Bruk Koble til for a starte sync igjen.",
      },
      runtime: {
        ...get().runtime,
        syncInFlight: false,
      },
    });
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
      runtime: {
        lastTicketSource: "empty",
        lastSyncSource: "mock",
        syncInFlight: false,
      },
    });
  },
}));

function getBoundRealtimeSocket(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  session: RealtimeSession,
) {
  return getRealtimeSocket(session, {
    onConnect: () => {
      set({
        connection: {
          phase: "connected",
          label: "Live",
          message: "Tilkoblet backend. Synkroniserer live-state.",
        },
      });
      void syncLiveSnapshot(set, get, "socket-connect");
    },
    onConnectError: (message) => {
      set({
        connection: {
          phase: "error",
          label: "Feil",
          message: `Socket-feil: ${message}`,
        },
        runtime: {
          ...get().runtime,
          syncInFlight: false,
        },
      });
    },
    onDisconnect: (reason) => {
      set({
        connection: {
          phase: "disconnected",
          label: "Frakoblet",
          message: `Socket frakoblet: ${reason}`,
        },
        runtime: {
          ...get().runtime,
          syncInFlight: false,
        },
      });
    },
    onRoomUpdate: (snapshot) => {
      applyLiveSnapshot(snapshot, "room:update", set, get);
    },
  });
}

async function syncLiveSnapshot(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  reason: "manual-connect" | "manual-refresh" | "socket-connect" | "missing-local-tickets",
): Promise<void> {
  const currentState = get();
  if (currentState.runtime.syncInFlight) {
    return;
  }

  const session = normalizeSession(currentState.session);
  if (!session.roomCode) {
    return;
  }

  const socket = getBoundRealtimeSocket(set, get, session);
  if (!socket.connected) {
    connectRealtimeSocket(socket);
    return;
  }

  set({
    session,
    runtime: {
      ...currentState.runtime,
      syncInFlight: true,
    },
    connection: {
      phase: "connected",
      label: "Live",
      message:
        reason === "missing-local-tickets"
          ? "Push-update manglet lokale bonger. Prover en eksplisitt resync."
          : "Henter siste room-state fra backend.",
    },
  });
  writeSession(session);

  try {
    let syncSource: Theme1SyncSource = "room:state";
    let response =
      session.playerId.trim().length > 0
        ? await requestRoomResume(socket, session)
        : undefined;

    if (!response?.ok || !response.data?.snapshot) {
      response = await requestRoomState(socket, session);
      syncSource = "room:state";
    } else {
      syncSource = "room:resume";
    }

    if (!response.ok || !response.data?.snapshot) {
      set({
        connection: {
          phase: "error",
          label: "Feil",
          message:
            response.error?.message ||
            "Klarte ikke hente room state fra backend.",
        },
        runtime: {
          ...get().runtime,
          syncInFlight: false,
        },
      });
      return;
    }

    applyLiveSnapshot(response.data.snapshot, syncSource, set, get);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Ukjent feil under live sync.";
    set({
      connection: {
        phase: "error",
        label: "Feil",
        message,
      },
      runtime: {
        ...get().runtime,
        syncInFlight: false,
      },
    });
  }
}

function applyLiveSnapshot(
  snapshot: RealtimeRoomSnapshot,
  syncSource: Extract<Theme1SyncSource, "room:resume" | "room:state" | "room:update">,
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
): void {
  const currentState = get();
  const session = normalizeSession(currentState.session);
  const result = mapRoomSnapshotToTheme1(snapshot, {
    session,
    connectionPhase: "connected",
  });

  const nextSession =
    result.resolvedPlayerId && result.resolvedPlayerId !== session.playerId
      ? { ...session, playerId: result.resolvedPlayerId }
      : session;
  const shouldPreservePreviousView =
    syncSource === "room:update" &&
    result.ticketSource === "empty" &&
    currentState.mode === "live" &&
    currentState.runtime.lastTicketSource !== "empty" &&
    !isRunningGame(snapshot);

  writeSession(nextSession);

  if (shouldPreservePreviousView) {
    set({
      roomSnapshot: snapshot,
      session: nextSession,
      connection: {
        phase: "connected",
        label: "Live",
        message:
          "room:update manglet lokale pre-round-bonger. Beholder forrige view og ber om resync.",
      },
      runtime: {
        lastTicketSource: currentState.runtime.lastTicketSource,
        lastSyncSource: syncSource,
        syncInFlight: false,
      },
    });
    void syncLiveSnapshot(set, get, "missing-local-tickets");
    return;
  }

  set({
    mode: "live",
    roomSnapshot: snapshot,
    session: nextSession,
    snapshot: result.model,
    connection: {
      phase: "connected",
      label: "Live",
      message: buildLiveConnectionMessage(snapshot, result.ticketSource, syncSource),
    },
    runtime: {
      lastTicketSource: result.ticketSource,
      lastSyncSource: syncSource,
      syncInFlight: false,
    },
  });
}

function buildLiveConnectionMessage(
  snapshot: RealtimeRoomSnapshot,
  ticketSource: Theme1TicketSource,
  syncSource: Extract<Theme1SyncSource, "room:resume" | "room:state" | "room:update">,
): string {
  const syncLabel =
    syncSource === "room:update"
      ? "push-update"
      : syncSource === "room:resume"
        ? "room:resume"
        : "room:state";
  const ticketLabel =
    ticketSource === "currentGame"
      ? "viser tickets fra currentGame"
      : ticketSource === "preRoundTickets"
        ? "viser lokale pre-round tickets"
        : "ingen lokale bonger i snapshotet";

  return `Live room lastet via ${syncLabel}: ${snapshot.code} (${snapshot.players.length} spillere), ${ticketLabel}.`;
}

function isRunningGame(snapshot: RealtimeRoomSnapshot): boolean {
  return snapshot.currentGame?.status === "RUNNING";
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
