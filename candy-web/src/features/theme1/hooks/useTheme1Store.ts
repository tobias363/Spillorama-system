import { create } from "zustand";
import type { CandyDrawNewPayload, RealtimeRoomSnapshot, RealtimeSession } from "@/domain/realtime/contracts";
import {
  connectRealtimeSocket,
  disposeRealtimeSocket,
  getRealtimeSocket,
  requestBetArm,
  requestRoomCreate,
  requestRoomConfigure,
  requestRoomResume,
  requestRoomState,
  requestTicketReroll,
} from "@/domain/realtime/client";
import { mapRoomSnapshotToTheme1 } from "@/domain/theme1/mappers/mapRoomSnapshotToTheme1";
import { applyTheme1DrawPresentation } from "@/domain/theme1/applyTheme1DrawPresentation";
import { extractNewTheme1Celebrations } from "@/domain/theme1/theme1ClaimCelebrations";
import { extractNewTheme1NearCallouts } from "@/domain/theme1/theme1NearCallouts";
import { resolveTheme1CelebrationLeadDelay } from "@/domain/theme1/theme1PresentationSequence";
import { extractTheme1RoundSummary } from "@/domain/theme1/theme1RoundSummary";
import {
  createIdleTheme1BonusState,
  createTheme1BonusRound,
  createTheme1WinningBonusRound,
  selectTheme1BonusSlot,
} from "@/domain/theme1/theme1Bonus";
import type {
  Theme1BonusState,
  Theme1CelebrationState,
  Theme1ConnectionPhase,
  Theme1DataSource,
  Theme1RoundRenderModel,
} from "@/domain/theme1/renderModel";
import { THEME1_DRAW_PRESENTATION_MS } from "@/domain/theme1/theme1MachineAnimation";
import { validateRealtimeRoomSnapshot } from "@/domain/realtime/validateRealtimeRoomSnapshot";
import {
  rerollTheme1MockBoards,
  theme1MockSnapshot,
} from "@/features/theme1/data/theme1MockSnapshot";
import {
  buildTheme1SessionKey,
  freezeBoardsFromPreviousModel,
  isSnapshotForActiveRoom,
  preservePendingPresentationVisuals,
  resolvePendingDrawNumberForSnapshot,
  shouldHoldPendingPresentationVisuals,
  shouldPromoteStateSnapshotToResume,
  shouldApplySyncResponse,
  shouldFreezeBoardsForUnarmedPlayer,
  shouldPreservePreviousViewOnTicketGap,
  type Theme1LiveRuntimeState,
  type Theme1SyncSource,
  type Theme1TicketSource,
} from "@/features/theme1/hooks/theme1LiveSync";

interface Theme1ConnectionState {
  phase: Theme1ConnectionPhase;
  label: string;
  message: string;
}

interface Theme1AuthSessionResponse {
  ok: boolean;
  data?: {
    accessToken: string;
    expiresAt: string;
    user: {
      id: string;
      displayName: string;
      walletId: string;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

type Theme1AccessTokenSource =
  | "url"
  | "storage"
  | "portal-storage"
  | "launch-token"
  | "manual"
  | "none";

interface CandyLaunchResolvePayload {
  accessToken: string;
  hallId: string;
  playerName: string;
  walletId: string;
  apiBaseUrl: string;
  issuedAt: string;
  expiresAt: string;
}

interface CandyLaunchResolveResponse {
  ok: boolean;
  data?: CandyLaunchResolvePayload;
  error?: {
    code: string;
    message: string;
  };
}

type Theme1RuntimeSyncState = Theme1LiveRuntimeState;

interface Theme1State {
  mode: Theme1DataSource;
  snapshot: Theme1RoundRenderModel;
  celebration: Theme1CelebrationState | null;
  celebrationQueue: Theme1CelebrationState[];
  topperPulses: Record<number, "near" | "win">;
  roomSnapshot: RealtimeRoomSnapshot | null;
  bonus: Theme1BonusState;
  session: RealtimeSession;
  accessTokenSource: Theme1AccessTokenSource;
  connection: Theme1ConnectionState;
  runtime: Theme1RuntimeSyncState;
  mockBetArmed: boolean;
  controlsBusy: boolean;
  stakeBusy: boolean;
  betBusy: boolean;
  rerollBusy: boolean;
  setSessionField: (field: keyof RealtimeSession, value: string) => void;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  disconnect: () => void;
  useMockMode: () => void;
  changeStake: (delta: number) => Promise<void>;
  toggleBetArm: () => Promise<void>;
  rerollTickets: () => Promise<void>;
  triggerMockDraw: () => void;
  startLocalLiveSession: () => Promise<void>;
  openBonusTest: () => void;
  openWinningBonusTest: () => void;
  selectBonusSlot: (slotId: string) => void;
  resetBonusTest: () => void;
  closeBonusTest: () => void;
}

const STORAGE_KEY = "candy-web.realtime-session";
const PORTAL_AUTH_STORAGE_KEY = "bingo.portal.auth";
const DEFAULT_BACKEND_URL = resolveDefaultBackendUrl();
const DEFAULT_CANDY_HALL_ID = "default-hall";
const DEFAULT_CANDY_ROOM_CODE = "CANDY1";
const LOCAL_LIVE_DEMO_HALL_ID = DEFAULT_CANDY_HALL_ID;
const INITIAL_SESSION_SEED = readInitialSessionSeed();
export const THEME1_STAKE_STEP_KR = 4;
export const THEME1_MAX_TOTAL_STAKE_KR = 20;
const THEME1_MIN_ARMABLE_TOTAL_STAKE_KR = 4;
const THEME1_RECOVERABLE_SYNC_ERROR_CODES = new Set([
  "FORBIDDEN",
  "PLAYER_NOT_FOUND",
  "ROOM_NOT_FOUND",
  "ROOM_BLOCKED_NON_CANONICAL",
  "SINGLE_ROOM_ONLY",
]);
let pendingDrawTimer: ReturnType<typeof setTimeout> | null = null;
let celebrationTimer: ReturnType<typeof setTimeout> | null = null;
let celebrationLeadTimer: ReturnType<typeof setTimeout> | null = null;
let queuedRoomUpdateSnapshot: RealtimeRoomSnapshot | null = null;
const THEME1_CELEBRATION_PRESENTATION_MS = 2400;
const THEME1_TOPPER_NEAR_PULSE_MS = 950;
const THEME1_TOPPER_WIN_PULSE_MS = 1600;
const topperPulseTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function shouldRedirectTheme1ToPortalOnLiveHost(input: {
  hostname: string;
  accessToken: string;
}): boolean {
  if (isLocalTheme1RuntimeHost(input.hostname)) {
    return false;
  }

  return input.accessToken.trim().length === 0;
}

export function canonicalizeTheme1LiveSession(
  session: RealtimeSession,
  hostname: string,
): RealtimeSession {
  const normalizedSession = normalizeSession(session);
  if (isLocalTheme1RuntimeHost(hostname)) {
    return normalizedSession;
  }

  return normalizeSession({
    ...normalizedSession,
    roomCode: DEFAULT_CANDY_ROOM_CODE,
    playerId: "",
    hallId: normalizedSession.hallId || DEFAULT_CANDY_HALL_ID,
  });
}

function resolveTheme1PortalUrl(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  return new URL("/", window.location.href).toString();
}

function redirectTheme1ToPortal(): void {
  if (typeof window === "undefined") {
    return;
  }

  const targetUrl = resolveTheme1PortalUrl();
  if (window.location.href !== targetUrl) {
    window.location.replace(targetUrl);
  }
}

function resolveTheme1LiveConnectionErrorMessage(message: string, hostname: string): string {
  if (isLocalTheme1RuntimeHost(hostname)) {
    return message;
  }

  const normalized = message.trim().toLowerCase();
  if (
    normalized.includes("accesstoken") ||
    normalized.includes("authorization") ||
    normalized.includes("unauthorized")
  ) {
    return "Logg inn i portalen for å åpne Candy.";
  }

  return message;
}

export const useTheme1Store = create<Theme1State>((set, get) => ({
  mode: "mock",
  snapshot: theme1MockSnapshot,
  celebration: null,
  celebrationQueue: [],
  topperPulses: {},
  roomSnapshot: null,
  bonus: createIdleTheme1BonusState(),
  session: INITIAL_SESSION_SEED.session,
  accessTokenSource: INITIAL_SESSION_SEED.accessTokenSource,
  connection: {
    phase: "mock",
    label: "Mock",
    message: "Ingen live room tilkoblet ennå.",
  },
  runtime: {
    lastTicketSource: "empty",
    lastSyncSource: "mock",
    syncInFlight: false,
    pendingDrawNumber: null,
    activeGameId: "",
    seenClaimIds: [],
    activeSessionKey: "",
    activeRoomCode: "",
    nextSyncRequestId: 0,
    inFlightSyncRequestId: null,
  },
  mockBetArmed: false,
  controlsBusy: false,
  stakeBusy: false,
  betBusy: false,
  rerollBusy: false,
  setSessionField: (field, value) => {
    const nextSession = { ...get().session, [field]: value };
    writeSession(nextSession);
    set({
      session: nextSession,
      accessTokenSource:
        field === "accessToken"
          ? nextSession.accessToken.trim().length > 0
            ? "manual"
            : "none"
          : get().accessTokenSource,
    });
  },
  connect: async () => {
    const currentHostname =
      typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
    const currentSearch = typeof window !== "undefined" ? window.location.search : "";
    console.log("[BIN-134] connect() start", { currentHostname, currentSearch: currentSearch.substring(0, 80) });
    const rehydratedSession = resolveTheme1InitialSessionSeed({
      storedSession: normalizeSession(get().session),
      search: currentSearch,
      hostname: currentHostname,
      portalAuthAccessToken: readPortalAuthAccessToken(),
    }).session;
    console.log("[BIN-134] rehydratedSession: accessToken=" + (rehydratedSession.accessToken ? "SET(" + rehydratedSession.accessToken.length + ")" : "EMPTY") + " roomCode=" + rehydratedSession.roomCode + " hallId=" + rehydratedSession.hallId);
    const hydrated = await hydrateSessionFromLaunchToken(rehydratedSession, set);
    console.log("[BIN-134] hydrated: accessToken=" + (hydrated.session.accessToken ? "SET(" + hydrated.session.accessToken.length + ")" : "EMPTY") + " roomCode=" + hydrated.session.roomCode + " hallId=" + hydrated.session.hallId + " source=" + hydrated.accessTokenSource);
    const session = canonicalizeTheme1LiveSession(hydrated.session, currentHostname);
    console.log("[BIN-134] canonicalized: accessToken=" + (session.accessToken ? "SET(" + session.accessToken.length + ")" : "EMPTY") + " roomCode=" + session.roomCode + " hallId=" + session.hallId + " playerId=" + session.playerId);

    if (
      shouldRedirectTheme1ToPortalOnLiveHost({
        hostname: currentHostname,
        accessToken: session.accessToken,
      })
    ) {
      console.error("[BIN-134] WOULD REDIRECT TO PORTAL — accessToken empty on live host. BLOCKED for debug.");
      // redirectTheme1ToPortal();  // BIN-134 DEBUG: disabled to capture logs
      // return;
    }
    console.log("[BIN-134] redirect check passed — continuing to connect");

    writeSession(session);
    set({
      session,
      accessTokenSource: hydrated.accessTokenSource ?? get().accessTokenSource,
      connection: {
        phase: "connecting",
        label: "Kobler til",
        message: "Henter room state fra backend...",
      },
    });

    if (!session.roomCode && !canAutoCreateRoom(session)) {
      if (
        shouldAutoBootstrapDefaultLiveSession(session, {
          hasLaunchToken: readLaunchTokenFromLocation().length > 0,
        })
      ) {
        await get().startLocalLiveSession();
        return;
      }

      set({
        connection: {
          phase: "error",
          label: "Feil",
          message: isLocalTheme1RuntimeHost(currentHostname)
            ? "Room code mangler og ingen launch-session ble funnet. Fortsetter i mock-modus til du starter fra portalen eller fyller inn room code."
            : "Portal-innlogging mangler eller kunne ikke leses. Logg inn i portalen og åpne Candy på nytt.",
        },
      });
      if (isLocalTheme1RuntimeHost(currentHostname)) {
        set({
          mode: "mock",
          connection: {
            phase: "mock",
            label: "Mock",
            message:
              "Room code mangler og ingen launch-session ble funnet. Fortsetter i mock-modus til du starter fra portalen eller fyller inn room code.",
          },
        });
      } else {
        redirectTheme1ToPortal();
      }
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
    if (!session.roomCode && !canAutoCreateRoom(session)) {
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
    clearPendingDrawTimer();
    clearCelebrationTimer();
    clearCelebrationLeadTimer();
    set({
      snapshot: applyTheme1DrawPresentation(get().snapshot, null),
      celebration: null,
      celebrationQueue: [],
      topperPulses: {},
      bonus: createIdleTheme1BonusState(),
      connection: {
        phase: "disconnected",
        label: "Frakoblet",
        message: "Live socket er koblet fra. Bruk Koble til for a starte sync igjen.",
      },
      runtime: {
        ...get().runtime,
        syncInFlight: false,
        pendingDrawNumber: null,
        activeGameId: "",
        seenClaimIds: [],
        activeSessionKey: "",
        activeRoomCode: "",
        nextSyncRequestId: 0,
        inFlightSyncRequestId: null,
      },
      controlsBusy: false,
      stakeBusy: false,
      betBusy: false,
      rerollBusy: false,
    });
  },
  useMockMode: () => {
    disposeRealtimeSocket();
    clearPendingDrawTimer();
    clearCelebrationTimer();
    clearCelebrationLeadTimer();
    clearAllTopperPulseTimers();
    set({
      mode: "mock",
      roomSnapshot: null,
      celebration: null,
      celebrationQueue: [],
      topperPulses: {},
      bonus: createIdleTheme1BonusState(),
      snapshot: {
        ...theme1MockSnapshot,
        meta: {
          ...theme1MockSnapshot.meta,
          backendUrl: normalizeSession(get().session).baseUrl,
        },
      },
      accessTokenSource: get().session.accessToken.trim().length > 0 ? get().accessTokenSource : "none",
      connection: {
        phase: "mock",
        label: "Mock",
        message: "Bruker lokal mock-state. Koble til igjen når du vil hente ekte room data.",
      },
      runtime: {
        lastTicketSource: "empty",
        lastSyncSource: "mock",
        syncInFlight: false,
        pendingDrawNumber: null,
        activeGameId: "",
        seenClaimIds: [],
        activeSessionKey: "",
        activeRoomCode: "",
        nextSyncRequestId: 0,
        inFlightSyncRequestId: null,
      },
      mockBetArmed: false,
      controlsBusy: false,
      stakeBusy: false,
      betBusy: false,
      rerollBusy: false,
    });
  },
  changeStake: async (delta) => {
    const currentState = get();
    const currentStake = resolveCurrentStakeAmount(currentState);
    const nextStake = resolveAdjustedStakeAmount(currentStake, delta);
    if (nextStake === currentStake) {
      return;
    }

    if (currentState.mode !== "live") {
      set({
        snapshot: {
          ...currentState.snapshot,
          hud: {
            ...currentState.snapshot.hud,
            innsats: formatStakeAmount(nextStake),
          },
        },
      });
      return;
    }

    const socket = getLiveSocketOrFail(set, get);
    if (!socket) {
      return;
    }

    set({ controlsBusy: true, stakeBusy: true });

    try {
      const response = await requestRoomConfigure(socket, currentState.session, nextStake);
      if (!response.ok || !response.data?.snapshot) {
        throw new Error(response.error?.message || "Klarte ikke oppdatere innsats.");
      }

      const validatedSnapshot = validateRealtimeRoomSnapshot(response.data.snapshot);
      if (!validatedSnapshot.ok) {
        throw new Error(`Ugyldig room:configure fra backend: ${validatedSnapshot.error}`);
      }

      applyLiveSnapshot(validatedSnapshot.value, "room:state", set, get);
    } catch (error) {
      setControlError(set, get, error, "Klarte ikke oppdatere innsats.");
    } finally {
      set({ controlsBusy: false, stakeBusy: false });
    }
  },
  toggleBetArm: async () => {
    const currentState = get();
    const nextStakeToArm = resolveStakeAmountBeforeArming(resolveCurrentStakeAmount(currentState));

    if (currentState.mode !== "live") {
      set({
        mockBetArmed: !currentState.mockBetArmed,
        snapshot: !currentState.mockBetArmed
          ? {
              ...currentState.snapshot,
              hud: {
                ...currentState.snapshot.hud,
                innsats: formatStakeAmount(nextStakeToArm),
              },
            }
          : currentState.snapshot,
      });
      return;
    }

    const socket = getLiveSocketOrFail(set, get);
    if (!socket) {
      return;
    }

    set({ controlsBusy: true, betBusy: true });

    try {
      const currentlyArmed = isCurrentPlayerArmed(currentState);
      if (!currentlyArmed && nextStakeToArm !== resolveCurrentStakeAmount(currentState)) {
        const configureResponse = await requestRoomConfigure(
          socket,
          currentState.session,
          nextStakeToArm,
        );
        if (!configureResponse.ok || !configureResponse.data?.snapshot) {
          throw new Error(configureResponse.error?.message || "Klarte ikke oppdatere innsats.");
        }

        const validatedConfigureSnapshot = validateRealtimeRoomSnapshot(configureResponse.data.snapshot);
        if (!validatedConfigureSnapshot.ok) {
          throw new Error(`Ugyldig room:configure fra backend: ${validatedConfigureSnapshot.error}`);
        }

        applyLiveSnapshot(validatedConfigureSnapshot.value, "room:state", set, get);
      }

      const response = await requestBetArm(
        socket,
        currentState.session,
        !currentlyArmed,
      );
      if (!response.ok || !response.data?.snapshot) {
        throw new Error(response.error?.message || "Klarte ikke plassere innsats.");
      }

      const validatedSnapshot = validateRealtimeRoomSnapshot(response.data.snapshot);
      if (!validatedSnapshot.ok) {
        throw new Error(`Ugyldig bet:arm fra backend: ${validatedSnapshot.error}`);
      }

      applyLiveSnapshot(validatedSnapshot.value, "room:state", set, get);
    } catch (error) {
      setControlError(set, get, error, "Klarte ikke plassere innsats.");
    } finally {
      set({ controlsBusy: false, betBusy: false });
    }
  },
  rerollTickets: async () => {
    const currentState = get();

    if (currentState.mode !== "live") {
      set({
        snapshot: {
          ...currentState.snapshot,
          boards: rerollTheme1MockBoards(currentState.snapshot.boards),
        },
        connection: {
          phase: "mock",
          label: "Mock",
          message: "Tallene på bongene ble byttet lokalt i mock-modus.",
        },
      });
      return;
    }

    const socket = getLiveSocketOrFail(set, get);
    if (!socket) {
      return;
    }

    set({ controlsBusy: true, rerollBusy: true });

    try {
      const response = await requestTicketReroll(socket, currentState.session, {
        ticketsPerPlayer: Math.max(1, currentState.snapshot.boards.length),
      });
      if (!response.ok || !response.data?.snapshot) {
        throw new Error(response.error?.message || "Klarte ikke shuffle bonger.");
      }

      const validatedSnapshot = validateRealtimeRoomSnapshot(response.data.snapshot);
      if (!validatedSnapshot.ok) {
        throw new Error(`Ugyldig ticket:reroll fra backend: ${validatedSnapshot.error}`);
      }

      applyLiveSnapshot(validatedSnapshot.value, "room:state", set, get);
    } catch (error) {
      setControlError(set, get, error, "Klarte ikke shuffle bonger.");
    } finally {
      set({ controlsBusy: false, rerollBusy: false });
    }
  },
  triggerMockDraw: () => {
    disposeRealtimeSocket();
    clearPendingDrawTimer();
    clearCelebrationTimer();
    clearCelebrationLeadTimer();
    clearAllTopperPulseTimers();

    const currentState = get();
    const normalizedSession = normalizeSession(currentState.session);
    const availableNumbers = resolveAvailableMockDrawNumbers(currentState.snapshot.recentBalls);
    const nextDrawNumber =
      availableNumbers[Math.floor(Math.random() * availableNumbers.length)] ?? null;
    const baseSnapshot = buildMockDrawSeedSnapshot(currentState, normalizedSession);

    set({
      mode: "mock",
      roomSnapshot: null,
      celebration: null,
      celebrationQueue: [],
      topperPulses: {},
      bonus: createIdleTheme1BonusState(),
      snapshot: baseSnapshot,
      connection: {
        phase: "mock",
        label: "Mock",
        message:
          nextDrawNumber === null
            ? "Lokal trekning nullstilte demoen. Trykk igjen for neste ball."
            : `Lokal trekning trigget: ${nextDrawNumber}. Backend er koblet ut for denne testen.`,
      },
      runtime: {
        lastTicketSource: "empty",
        lastSyncSource: "mock",
        syncInFlight: false,
        pendingDrawNumber: null,
        activeGameId: "",
        seenClaimIds: [],
        activeSessionKey: "",
        activeRoomCode: "",
        nextSyncRequestId: 0,
        inFlightSyncRequestId: null,
      },
      mockBetArmed: true,
      controlsBusy: false,
      stakeBusy: false,
      betBusy: false,
      rerollBusy: false,
    });

    if (nextDrawNumber !== null) {
      applyPendingDrawPresentation(set, get, nextDrawNumber);
    }
  },
  startLocalLiveSession: async () => {
    const currentState = get();
    const baseUrl = normalizeSession({
      ...currentState.session,
      baseUrl: currentState.session.baseUrl || DEFAULT_BACKEND_URL,
    }).baseUrl;
    const isLocalBackend = isLocalTheme1RuntimeHost(resolveHostnameFromBaseUrl(baseUrl));

    clearPendingDrawTimer();
    clearCelebrationTimer();
    clearCelebrationLeadTimer();
    clearAllTopperPulseTimers();
    disposeRealtimeSocket();

    set({
      controlsBusy: true,
      connection: {
        phase: "connecting",
        label: "Kobler til",
        message: isLocalBackend
          ? "Oppretter lokal live-bruker og verifiserer KYC..."
          : "Oppretter standard live-visning og verifiserer KYC...",
      },
    });

    try {
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: `candy.local.${nonce}@example.com`,
          password: "codex-local-pass-123",
          displayName: "Local Candy",
        }),
      });
      const registerPayload = (await registerResponse.json()) as Theme1AuthSessionResponse;
      if (!registerResponse.ok || !registerPayload.ok || !registerPayload.data?.accessToken) {
        throw new Error(registerPayload.error?.message || "Klarte ikke opprette lokal testbruker.");
      }

      const accessToken = registerPayload.data.accessToken;
      const kycResponse = await fetch(`${baseUrl}/api/kyc/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          birthDate: "1990-01-01",
        }),
      });
      const kycPayload = (await kycResponse.json()) as {
        ok: boolean;
        error?: { message: string };
      };
      if (!kycResponse.ok || !kycPayload.ok) {
        throw new Error(kycPayload.error?.message || "Klarte ikke KYC-verifisere lokal testbruker.");
      }

      const nextSession = normalizeSession({
        baseUrl,
        roomCode: "",
        playerId: "",
        accessToken,
        hallId: LOCAL_LIVE_DEMO_HALL_ID,
      });

      writeSession(nextSession);
      set({
        session: nextSession,
        accessTokenSource: "manual",
        mode: "mock",
        roomSnapshot: null,
        mockBetArmed: false,
        controlsBusy: false,
        connection: {
          phase: "connecting",
          label: "Kobler til",
          message: isLocalBackend
            ? "Lokal live-bruker er klar. Oppretter Candy-rom og henter nedtelling..."
            : "Live-visning er klar. Kobler til standard Candy-rom og henter nedtelling...",
        },
      });

      await get().connect();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Klarte ikke starte lokal live-okt.";
      set({
        controlsBusy: false,
        connection: {
          phase: "error",
          label: "Feil",
          message,
        },
      });
    }
  },
  openBonusTest: () => {
    set({ bonus: createTheme1BonusRound() });
  },
  openWinningBonusTest: () => {
    set({ bonus: createTheme1WinningBonusRound({ winningSymbolId: "asset-7" }) });
  },
  selectBonusSlot: (slotId) => {
    set((currentState) => ({
      bonus: selectTheme1BonusSlot(currentState.bonus, slotId),
    }));
  },
  resetBonusTest: () => {
    set({ bonus: createTheme1BonusRound() });
  },
  closeBonusTest: () => {
    set({ bonus: createIdleTheme1BonusState() });
  },
}));

function getBoundRealtimeSocket(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  session: RealtimeSession,
) {
  return getRealtimeSocket(session, {
    onConnect: () => {
      clearPendingDrawTimer();
      queuedRoomUpdateSnapshot = null;
      const activeRuntime = get().runtime;
      set({
        connection: {
          phase: "connected",
          label: "Live",
          message: "Tilkoblet backend. Synkroniserer live-state.",
        },
        runtime: {
          ...activeRuntime,
          pendingDrawNumber: null,
          activeSessionKey: buildTheme1SessionKey(session),
          activeRoomCode: session.roomCode,
        },
      });
      if (!session.roomCode && canAutoCreateRoom(session)) {
        void autoCreateLiveRoom(set, get, session);
        return;
      }
      void syncLiveSnapshot(set, get, "socket-connect");
    },
    onConnectError: (message) => {
      const hostname =
        typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
      if (shouldRedirectTheme1ToPortalOnLiveHost({ hostname, accessToken: get().session.accessToken })) {
        redirectTheme1ToPortal();
        return;
      }
      set({
        connection: {
          phase: "error",
          label: "Feil",
          message: `Socket-feil: ${resolveTheme1LiveConnectionErrorMessage(message, hostname)}`,
        },
        runtime: {
          ...get().runtime,
          syncInFlight: false,
          inFlightSyncRequestId: null,
        },
      });
    },
    onDisconnect: (reason) => {
  clearPendingDrawTimer();
  clearCelebrationTimer();
  clearCelebrationLeadTimer();
  clearAllTopperPulseTimers();
  queuedRoomUpdateSnapshot = null;
  set({
    snapshot: applyTheme1DrawPresentation(get().snapshot, null),
    celebration: null,
    celebrationQueue: [],
    topperPulses: {},
    bonus: createIdleTheme1BonusState(),
    connection: {
          phase: "disconnected",
          label: "Frakoblet",
          message: `Socket frakoblet: ${reason}`,
        },
        runtime: {
          ...get().runtime,
          syncInFlight: false,
          pendingDrawNumber: null,
          activeGameId: "",
          seenClaimIds: [],
          activeSessionKey: "",
          activeRoomCode: "",
          nextSyncRequestId: 0,
          inFlightSyncRequestId: null,
        },
        controlsBusy: false,
        stakeBusy: false,
        betBusy: false,
        rerollBusy: false,
      });
    },
    onDrawNew: (payload) => {
      try {
        const nextNumber = validateDrawNewPayload(payload);
        if (nextNumber === null) {
          return;
        }

        // Skip draws that already appear in the latest snapshot to avoid
        // replaying stale events after reconnect.
        const currentSnapshot = get().roomSnapshot;
        const drawnNumbers = currentSnapshot?.currentGame?.drawnNumbers ?? [];
        if (drawnNumbers.includes(nextNumber)) {
          return;
        }

        applyPendingDrawPresentation(set, get, nextNumber);
      } catch (error) {
        console.error("[candy-web] onDrawNew handler error:", error);
      }
    },
    onRoomUpdate: (snapshot) => {
      try {
        const validatedSnapshot = validateRealtimeRoomSnapshot(snapshot);
        if (!validatedSnapshot.ok) {
          setSnapshotValidationError(
            set,
            get,
            `Ugyldig room:update fra backend: ${validatedSnapshot.error}`,
          );
          return;
        }

        if (!isSnapshotForActiveRoom(validatedSnapshot.value, get().runtime.activeRoomCode)) {
          return;
        }

        if (get().runtime.syncInFlight) {
          queuedRoomUpdateSnapshot = validatedSnapshot.value;
          return;
        }

        applyLiveSnapshot(validatedSnapshot.value, "room:update", set, get);
      } catch (error) {
        console.error("[candy-web] onRoomUpdate handler error:", error);
      }
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
    if (canAutoCreateRoom(session)) {
      const socket = getBoundRealtimeSocket(set, get, session);
      if (!socket.connected) {
        connectRealtimeSocket(socket);
        return;
      }

      await autoCreateLiveRoom(set, get, session);
    }
    return;
  }

  const socket = getBoundRealtimeSocket(set, get, session);
  if (!socket.connected) {
    connectRealtimeSocket(socket);
    return;
  }

  const sessionKey = buildTheme1SessionKey(session);
  const requestId = currentState.runtime.nextSyncRequestId + 1;

  set({
    session,
    runtime: {
      ...currentState.runtime,
      syncInFlight: true,
      activeSessionKey: sessionKey,
      activeRoomCode: session.roomCode,
      nextSyncRequestId: requestId,
      inFlightSyncRequestId: requestId,
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
    console.log("[BIN-134] syncLiveSnapshot", { roomCode: session.roomCode, playerId: session.playerId, hasAccessToken: !!session.accessToken, reason });
    let response =
      session.playerId.trim().length > 0
        ? await requestRoomResume(socket, session)
        : undefined;

    const resumeFailed = response !== undefined && !response.ok;
    const resumeErrorCode = resumeFailed ? response?.error?.code : undefined;
    console.log("[BIN-134] resume result", { attempted: session.playerId.trim().length > 0, ok: response?.ok, errorCode: resumeErrorCode });

    if (!response?.ok || !response.data?.snapshot) {
      console.log("[BIN-134] trying room:state", { roomCode: session.roomCode });
      response = await requestRoomState(socket, session);
      syncSource = "room:state";
      console.log("[BIN-134] room:state result", { ok: response.ok, errorCode: response.error?.code, hasSnapshot: !!response.data?.snapshot });
    } else {
      syncSource = "room:resume";
    }

    // If room:resume failed with PLAYER_NOT_FOUND but room:state succeeded,
    // the player's session expired (e.g. backend restart). Re-create the
    // player in the room so boards, bets, and tickets work again.
    if (
      resumeErrorCode === "PLAYER_NOT_FOUND" &&
      response.ok &&
      response.data?.snapshot &&
      canAutoCreateRoom(session)
    ) {
      console.log("[BIN-134] PLAYER_NOT_FOUND recovery");
      const recovered = await attemptLiveRoomRecovery(set, get, session, resumeErrorCode);
      if (recovered) {
        return;
      }
    }

    if (!response.ok || !response.data?.snapshot) {
      console.log("[BIN-134] sync failed, attempting recovery", { errorCode: response.error?.code, canAutoCreate: canAutoCreateRoom(session) });
      const recovered = await attemptLiveRoomRecovery(set, get, session, response.error?.code);
      if (recovered) {
        return;
      }
      const hostname =
        typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
      if (shouldRedirectTheme1ToPortalOnLiveHost({ hostname, accessToken: session.accessToken })) {
        redirectTheme1ToPortal();
        return;
      }
      set({
        connection: {
          phase: "error",
          label: "Feil",
          message: resolveTheme1LiveConnectionErrorMessage(
            response.error?.message || "Klarte ikke hente room state fra backend.",
            hostname,
          ),
        },
        runtime: {
          ...get().runtime,
          syncInFlight: false,
          inFlightSyncRequestId: null,
        },
      });
      drainQueuedRoomUpdate(set, get);
      return;
    }

    const validatedSnapshot = validateRealtimeRoomSnapshot(response.data.snapshot);
    if (!validatedSnapshot.ok) {
      setSnapshotValidationError(
        set,
        get,
        `Ugyldig ${syncSource} fra backend: ${validatedSnapshot.error}`,
      );
      return;
    }

    if (
      !shouldApplySyncResponse({
        runtime: get().runtime,
        expectedSessionKey: sessionKey,
        requestId,
      })
    ) {
      return;
    }

    applyLiveSnapshot(validatedSnapshot.value, syncSource, set, get);
  } catch (error) {
    const hostname =
      typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
    if (shouldRedirectTheme1ToPortalOnLiveHost({ hostname, accessToken: session.accessToken })) {
      redirectTheme1ToPortal();
      return;
    }
    const message =
      error instanceof Error ? error.message : "Ukjent feil under live sync.";
    set({
      connection: {
        phase: "error",
        label: "Feil",
        message: resolveTheme1LiveConnectionErrorMessage(message, hostname),
      },
      runtime: {
        ...get().runtime,
        syncInFlight: false,
        inFlightSyncRequestId: null,
      },
    });
    drainQueuedRoomUpdate(set, get);
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
  const shouldHoldPendingVisuals = shouldHoldPendingPresentationVisuals({
    snapshot,
    pendingDrawNumber: currentState.runtime.pendingDrawNumber,
  });
  const result = mapRoomSnapshotToTheme1(snapshot, {
    session,
    connectionPhase: "connected",
  });

  const nextSession =
    result.resolvedPlayerId && result.resolvedPlayerId !== session.playerId
      ? { ...session, playerId: result.resolvedPlayerId }
      : session;
  const shouldPreservePreviousView = shouldPreservePreviousViewOnTicketGap({
    syncSource,
    resultTicketSource: result.ticketSource,
    currentMode: currentState.mode,
    lastTicketSource: currentState.runtime.lastTicketSource,
    gameStatus: snapshot.currentGame?.status,
  });
  const nextPendingDrawNumber = shouldHoldPendingVisuals
    ? currentState.runtime.pendingDrawNumber
    : resolvePendingDrawNumberForSnapshot(
        snapshot,
        currentState.runtime.pendingDrawNumber,
      );
  const celebrationResolution =
    nextSession.playerId.trim().length > 0
      ? extractNewTheme1Celebrations(snapshot, {
          playerId: nextSession.playerId,
          knownClaimIds: currentState.runtime.seenClaimIds,
          previousGameId: currentState.runtime.activeGameId,
        })
      : {
          nextGameId: snapshot.currentGame?.id ?? "",
          nextKnownClaimIds: [],
          celebrations: [],
        };

  writeSession(nextSession);
  if (!shouldHoldPendingVisuals &&
    currentState.runtime.pendingDrawNumber !== null &&
    nextPendingDrawNumber === null
  ) {
    clearPendingDrawTimer();
  }
  const nextModelWithPendingDraw = applyTheme1DrawPresentation(
    result.model,
    nextPendingDrawNumber,
    {
      markBoards: result.ticketSource === "currentGame",
    },
  );
  const shouldFreezeBoards = shouldFreezeBoardsForUnarmedPlayer({
    previousModel: currentState.snapshot,
    snapshot,
    playerId: nextSession.playerId,
  });
  // For room:update events, ALWAYS use client's recentBalls. Balls must
  // only enter the rail through draw:new → applyTheme1DrawPresentation,
  // because the Playfield animation requires single-ball appends
  // (resolveSingleAppendedBall). Adding multiple balls at once from a
  // room:update snapshot bypasses the flight animation entirely.
  //
  // Exceptions (use server's list):
  //   1. Not a room:update (initial sync)
  //   2. Client has no balls yet (initial load)
  //   3. Game ID changed (new round started)
  //   4. Server has no drawn balls (game ended / waiting)
  const nextModelWithBallRailGuard = (() => {
    if (syncSource !== "room:update") {
      return nextModelWithPendingDraw;
    }
    const clientBalls = currentState.snapshot.recentBalls;
    const serverBalls = nextModelWithPendingDraw.recentBalls;
    const currentGameId = snapshot.currentGame?.id ?? "";
    const previousGameId = currentState.runtime.activeGameId;

    // Initial load: client has no balls, use server's list
    if (clientBalls.length === 0) {
      return nextModelWithPendingDraw;
    }

    // New round: server has significantly fewer balls than client.
    // This catches the transition from a completed round (30 balls) to
    // a new round with only a few balls. A difference of 3+ balls rules
    // out normal timing lag (where client is 1-2 balls ahead of server).
    // We can't use game ID because activeGameId is set AFTER this guard.
    if (clientBalls.length - serverBalls.length >= 3) {
      return nextModelWithPendingDraw;
    }

    // Game ended / waiting: server has no balls, clear client's list
    if (serverBalls.length === 0) {
      return { ...nextModelWithPendingDraw, recentBalls: [] };
    }

    // During active round: keep client's list exactly as-is
    return { ...nextModelWithPendingDraw, recentBalls: clientBalls };
  })();
  const nextModelPreserved = shouldHoldPendingVisuals
    ? preservePendingPresentationVisuals(currentState.snapshot, nextModelWithBallRailGuard)
    : shouldFreezeBoards
      ? freezeBoardsFromPreviousModel(currentState.snapshot, nextModelWithBallRailGuard)
      : nextModelWithBallRailGuard;
  // preservePendingPresentationVisuals overwrites recentBalls with the
  // previous model's balls. Restore the ball guard's decision so that
  // new-round clearing is not undone.
  const nextModel = nextModelPreserved.recentBalls !== nextModelWithBallRailGuard.recentBalls
    ? { ...nextModelPreserved, recentBalls: nextModelWithBallRailGuard.recentBalls }
    : nextModelPreserved;
  const nearCallouts =
    syncSource === "room:update" && !shouldFreezeBoards
      ? extractNewTheme1NearCallouts({
          previousModel: currentState.snapshot,
          nextModel,
        })
      : [];
  const roundSummary =
    syncSource === "room:update" && !shouldFreezeBoards && nextSession.playerId.trim().length > 0
      ? extractTheme1RoundSummary(snapshot, {
          playerId: nextSession.playerId,
          previousModel: currentState.snapshot,
        })
      : null;

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
        pendingDrawNumber: nextPendingDrawNumber,
        activeGameId: celebrationResolution.nextGameId,
        seenClaimIds: celebrationResolution.nextKnownClaimIds,
        activeSessionKey:
          currentState.runtime.activeSessionKey || buildTheme1SessionKey(nextSession),
        activeRoomCode: currentState.runtime.activeRoomCode || snapshot.code,
        nextSyncRequestId: currentState.runtime.nextSyncRequestId,
        inFlightSyncRequestId: null,
      },
    });
    void syncLiveSnapshot(set, get, "missing-local-tickets");
    return;
  }

  set({
    mode: "live",
    roomSnapshot: snapshot,
    session: nextSession,
    snapshot: nextModel,
    connection: {
      phase: "connected",
      label: "Live",
      message: buildLiveConnectionMessage(snapshot, result.ticketSource, syncSource),
    },
    runtime: {
      lastTicketSource: result.ticketSource,
      lastSyncSource: syncSource,
      syncInFlight: false,
      pendingDrawNumber: nextPendingDrawNumber,
      activeGameId: celebrationResolution.nextGameId,
      seenClaimIds: celebrationResolution.nextKnownClaimIds,
      activeSessionKey:
        currentState.runtime.activeSessionKey || buildTheme1SessionKey(nextSession),
      activeRoomCode: currentState.runtime.activeRoomCode || snapshot.code,
      nextSyncRequestId: currentState.runtime.nextSyncRequestId,
      inFlightSyncRequestId: null,
    },
  });

  if (
    syncSource === "room:update" &&
    (celebrationResolution.celebrations.length > 0 || nearCallouts.length > 0 || roundSummary)
  ) {
    const nextCelebrations = [
      ...celebrationResolution.celebrations,
      ...nearCallouts,
      ...(roundSummary ? [roundSummary] : []),
    ];
    const leadDelay = resolveTheme1CelebrationLeadDelay(
      nextPendingDrawNumber,
      nextCelebrations,
    );
    enqueueCelebrations(set, get, nextCelebrations, leadDelay);
  }

  if (
    shouldPromoteStateSnapshotToResume({
      syncSource,
      previousPlayerId: session.playerId,
      resolvedPlayerId: nextSession.playerId,
    })
  ) {
    void syncLiveSnapshot(set, get, "manual-refresh");
  }

  if (syncSource !== "room:update") {
    drainQueuedRoomUpdate(set, get);
  }
}

function drainQueuedRoomUpdate(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
): void {
  const queued = queuedRoomUpdateSnapshot;
  queuedRoomUpdateSnapshot = null;
  if (queued && isSnapshotForActiveRoom(queued, get().runtime.activeRoomCode)) {
    applyLiveSnapshot(queued, "room:update", set, get);
  }
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

async function hydrateSessionFromLaunchToken(
  session: RealtimeSession,
  set: (partial: Partial<Theme1State>) => void,
): Promise<{
  session: RealtimeSession;
  accessTokenSource: Theme1AccessTokenSource | null;
}> {
  console.log("[BIN-134] hydrateSessionFromLaunchToken: accessToken=" + (session.accessToken ? "SET(" + session.accessToken.length + ")" : "EMPTY") + " roomCode=" + session.roomCode + " hallId=" + session.hallId);
  if (session.accessToken && (session.roomCode || session.hallId)) {
    console.log("[BIN-134] hydrate SKIP — already has accessToken + roomCode/hallId");
    return {
      session,
      accessTokenSource: null,
    };
  }

  const launchToken = readLaunchTokenFromLocation();
  console.log("[BIN-134] launchToken from URL: " + (launchToken ? "SET(" + launchToken.length + ")" : "EMPTY") + " search=" + (typeof window !== "undefined" ? window.location.search.substring(0, 60) : "n/a"));
  if (!launchToken) {
    console.log("[BIN-134] hydrate SKIP — no launch token in URL");
    return {
      session,
      accessTokenSource: null,
    };
  }

  const baseUrl = resolveLaunchBaseUrl(session);
  console.log("[BIN-134] calling launch-resolve at " + baseUrl);
  set({
    connection: {
      phase: "connecting",
      label: "Kobler til",
      message: "Loser Candy launch-token fra portalen...",
    },
  });

  try {
    const response = await fetch(`${baseUrl}/api/games/candy/launch-resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ launchToken }),
    });

    const payload = (await response.json()) as CandyLaunchResolveResponse;
    if (!response.ok || !payload.ok || !payload.data?.accessToken) {
      throw new Error(
        payload.error?.message ||
          "Klarte ikke lose Candy launch-token. Start spillet pa nytt fra portalen.",
      );
    }

    const nextSession = normalizeSession({
      ...session,
      baseUrl: payload.data.apiBaseUrl || baseUrl,
      accessToken: payload.data.accessToken,
      hallId: payload.data.hallId || session.hallId,
    });
    clearLaunchTokenFromLocation();
    writeSession(nextSession);
    set({ session: nextSession });
    return {
      session: nextSession,
      accessTokenSource: "launch-token",
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Klarte ikke lose Candy launch-token. Start spillet pa nytt fra portalen.";
    set({
      connection: {
        phase: "error",
        label: "Feil",
        message,
      },
    });
    return {
      session: normalizeSession({ ...session, baseUrl }),
      accessTokenSource: null,
    };
  }
}

function readInitialSessionSeed(): {
  session: RealtimeSession;
  accessTokenSource: Theme1AccessTokenSource;
} {
  if (typeof window === "undefined") {
    return {
      session: normalizeSession({
        baseUrl: DEFAULT_BACKEND_URL,
        roomCode: "",
        playerId: "",
        accessToken: "",
        hallId: "",
      }),
      accessTokenSource: "none",
    };
  }

  const stored = readStoredSession();
  const seed = resolveTheme1InitialSessionSeed({
    storedSession: stored,
    search: window.location.search,
    hostname: window.location.hostname,
    portalAuthAccessToken: readPortalAuthAccessToken(),
  });

  if (seed.accessTokenSource === "url" || seed.accessTokenSource === "portal-storage") {
    writeSession(seed.session);
  }

  return {
    session: seed.session,
    accessTokenSource: seed.accessTokenSource,
  };
}

export function resolveTheme1InitialSessionSeed(input: {
  storedSession: Partial<RealtimeSession>;
  search: string;
  hostname: string;
  portalAuthAccessToken?: string;
}): {
  session: RealtimeSession;
  accessTokenSource: Theme1AccessTokenSource;
} {
  const params = new URLSearchParams(input.search);
  const urlAccessToken = params.get("accessToken")?.trim() || "";
  const storedAccessToken =
    typeof input.storedSession.accessToken === "string"
      ? input.storedSession.accessToken.trim()
      : "";
  const portalAccessToken = (input.portalAuthAccessToken || "").trim();
  const isLocalRuntimeHost = isLocalTheme1RuntimeHost(input.hostname);
  const fallbackHallId = isLocalRuntimeHost ? "" : DEFAULT_CANDY_HALL_ID;
  const resolvedAccessToken = isLocalRuntimeHost
    ? urlAccessToken || storedAccessToken || portalAccessToken
    : urlAccessToken || portalAccessToken;

  const session = canonicalizeTheme1LiveSession(
    isLocalRuntimeHost
      ? {
          baseUrl: params.get("backendUrl") || input.storedSession.baseUrl || DEFAULT_BACKEND_URL,
          roomCode: params.get("roomCode") || input.storedSession.roomCode || "",
          playerId: params.get("playerId") || input.storedSession.playerId || "",
          accessToken: resolvedAccessToken,
          hallId:
            params.get("hallId") ||
            input.storedSession.hallId ||
            (resolvedAccessToken ? fallbackHallId : ""),
        }
      : {
          baseUrl: params.get("backendUrl") || input.storedSession.baseUrl || DEFAULT_BACKEND_URL,
          roomCode: params.get("roomCode") || DEFAULT_CANDY_ROOM_CODE,
          playerId: params.get("playerId") || "",
          accessToken: resolvedAccessToken,
          hallId: params.get("hallId") || fallbackHallId,
        },
    input.hostname,
  );

  if (urlAccessToken) {
    return {
      session,
      accessTokenSource: "url",
    };
  }

  return {
    session,
    accessTokenSource: !isLocalRuntimeHost
      ? portalAccessToken
        ? "portal-storage"
        : "none"
      : storedAccessToken
        ? "storage"
        : portalAccessToken
          ? "portal-storage"
          : "none",
  };
}

function readPortalAuthAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.localStorage.getItem(PORTAL_AUTH_STORAGE_KEY);
    if (!raw) {
      return "";
    }

    const parsed = JSON.parse(raw) as { accessToken?: unknown };
    return typeof parsed?.accessToken === "string" ? parsed.accessToken.trim() : "";
  } catch {
    return "";
  }
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
    hallId: session.hallId.trim(),
  };
}

function canAutoCreateRoom(session: RealtimeSession): boolean {
  return session.accessToken.trim().length > 0 && session.hallId.trim().length > 0;
}

export function shouldAttemptLiveRoomRecoveryFromSyncFailure(
  session: RealtimeSession,
  errorCode?: string,
): boolean {
  const normalizedSession = normalizeSession(session);
  if (!normalizedSession.roomCode && !normalizedSession.playerId) {
    return false;
  }

  if (!canAutoCreateRoom(normalizedSession)) {
    return false;
  }

  return Boolean(errorCode && THEME1_RECOVERABLE_SYNC_ERROR_CODES.has(errorCode));
}

async function attemptLiveRoomRecovery(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  session: RealtimeSession,
  errorCode?: string,
): Promise<boolean> {
  if (!shouldAttemptLiveRoomRecoveryFromSyncFailure(session, errorCode)) {
    return false;
  }

  const currentHostname =
    typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
  const recoverySession = canonicalizeTheme1LiveSession({
    ...session,
    roomCode: "",
    playerId: "",
  }, currentHostname);

  clearPendingDrawTimer();
  clearCelebrationTimer();
  clearCelebrationLeadTimer();
  clearAllTopperPulseTimers();
  writeSession(recoverySession);
  set({
    session: recoverySession,
    roomSnapshot: null,
    celebration: null,
    celebrationQueue: [],
    topperPulses: {},
    bonus: createIdleTheme1BonusState(),
    connection: {
      phase: "connecting",
      label: "Kobler til",
      message: "Lagret Candy-session var utgått. Kobler til canonical live-rom på nytt...",
    },
    runtime: {
      ...get().runtime,
      syncInFlight: false,
      pendingDrawNumber: null,
      activeGameId: "",
      seenClaimIds: [],
      activeSessionKey: buildTheme1SessionKey(recoverySession),
      activeRoomCode: "",
      inFlightSyncRequestId: null,
    },
  });

  await autoCreateLiveRoom(set, get, recoverySession);
  return true;
}

async function autoCreateLiveRoom(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  session: RealtimeSession,
): Promise<void> {
  const socket = getBoundRealtimeSocket(set, get, session);
  if (!socket.connected) {
    connectRealtimeSocket(socket);
    return;
  }

  set({
    connection: {
      phase: "connecting",
      label: "Kobler til",
      message: "Oppretter eller kobler til Candy-rom automatisk...",
    },
  });

  try {
    console.log("[BIN-134] autoCreateLiveRoom → room:create", { hallId: session.hallId, hasAccessToken: !!session.accessToken });
    const response = await requestRoomCreate(socket, session);
    console.log("[BIN-134] room:create response", { ok: response.ok, roomCode: response.data?.roomCode, playerId: response.data?.playerId, hasSnapshot: !!response.data?.snapshot, errorCode: response.error?.code, errorMsg: response.error?.message });
    if (!response.ok || !response.data?.snapshot || !response.data.roomCode || !response.data.playerId) {
      throw new Error(response.error?.message || "Klarte ikke opprette Candy-rom automatisk.");
    }

    const validatedSnapshot = validateRealtimeRoomSnapshot(response.data.snapshot);
    if (!validatedSnapshot.ok) {
      throw new Error(`Ugyldig room:create fra backend: ${validatedSnapshot.error}`);
    }

    const nextSession = normalizeSession({
      ...session,
      roomCode: response.data.roomCode,
      playerId: response.data.playerId,
    });

    getBoundRealtimeSocket(set, get, nextSession);
    writeSession(nextSession);
    set({
      session: nextSession,
      runtime: {
        ...get().runtime,
        activeSessionKey: buildTheme1SessionKey(nextSession),
        activeRoomCode: nextSession.roomCode,
      },
    });

    applyLiveSnapshot(validatedSnapshot.value, "room:resume", set, get);
    console.log("[BIN-134] autoCreateLiveRoom SUCCESS — game should be visible now");
  } catch (error) {
    console.error("[BIN-134] autoCreateLiveRoom FAILED", error);
    const hostname =
      typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
    if (!isLocalTheme1RuntimeHost(hostname)) {
      console.error("[BIN-134] WOULD REDIRECT from autoCreateLiveRoom catch — BLOCKED for debug");
      // redirectTheme1ToPortal();  // BIN-134 DEBUG: disabled
      // return;
    }
    const message =
      error instanceof Error
        ? error.message
        : "Klarte ikke opprette Candy-rom automatisk.";
    set({
      mode: "mock",
      connection: {
        phase: "error",
        label: "Feil",
        message,
      },
      runtime: {
        ...get().runtime,
        syncInFlight: false,
        inFlightSyncRequestId: null,
      },
    });
  }
}

function resolveDefaultBackendUrl(): string {
  const envValue =
    typeof import.meta !== "undefined" &&
    typeof import.meta.env?.VITE_CANDY_API_BASE_URL === "string"
      ? import.meta.env.VITE_CANDY_API_BASE_URL.trim()
      : "";
  if (envValue) {
    return envValue;
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:4000";
  }

  const host = window.location.hostname.trim().toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:4000";
  }

  return "https://bingosystem-staging.onrender.com";
}

export function isLocalTheme1RuntimeHost(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  return normalizedHostname === "127.0.0.1" || normalizedHostname === "localhost";
}

export function shouldAutoBootstrapDefaultLiveSession(
  _session: RealtimeSession,
  options: {
    hostname?: string;
    hasLaunchToken?: boolean;
  } = {},
): boolean {
  void options;
  return false;
}

function resolveHostnameFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

function readLaunchTokenFromLocation(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const queryToken = new URLSearchParams(window.location.search).get("lt")?.trim();
  if (queryToken) {
    return queryToken;
  }

  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(rawHash).get("lt")?.trim() || "";
}

function resolveLaunchBaseUrl(session: RealtimeSession): string {
  if (typeof window === "undefined") {
    return normalizeSession(session).baseUrl;
  }

  const queryBaseUrl = new URLSearchParams(window.location.search).get("backendUrl")?.trim();
  if (queryBaseUrl) {
    return queryBaseUrl;
  }

  const normalizedSession = normalizeSession(session);
  const hasLaunchToken = readLaunchTokenFromLocation().length > 0;
  if (hasLaunchToken && isLocalhostUrl(normalizedSession.baseUrl)) {
    return "https://bingosystem-staging.onrender.com";
  }

  if (!isLocalhostUrl(normalizedSession.baseUrl) || isRunningLocally()) {
    return normalizedSession.baseUrl;
  }

  return DEFAULT_BACKEND_URL;
}

function clearLaunchTokenFromLocation(): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("lt");

  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(rawHash);
  hashParams.delete("lt");
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";

  window.history.replaceState({}, document.title, url.toString());
}

function isLocalhostUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function isRunningLocally(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname.trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

function applyPendingDrawPresentation(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  drawNumber: number,
): void {
  const nextPendingDrawNumber = Math.trunc(drawNumber);
  clearPendingDrawTimer();

  // Commit previous AND apply new in a SINGLE set() call to avoid
  // an intermediate render frame where featuredBallNumber is null (blink).
  const currentState = get();
  const previousPending = currentState.runtime.pendingDrawNumber;
  let baseModel = currentState.snapshot;

  if (previousPending !== null && previousPending !== nextPendingDrawNumber) {
    // Commit previous: remap from snapshot if in live mode, but preserve
    // the client's recentBalls so that balls only enter the rail through
    // the draw:new → flight animation pipeline (not dumped from server snapshot).
    if (currentState.mode === "live" && currentState.roomSnapshot) {
      const session = normalizeSession(currentState.session);
      const result = mapRoomSnapshotToTheme1(currentState.roomSnapshot, {
        session,
        connectionPhase: "connected",
      });
      baseModel = {
        ...result.model,
        recentBalls: currentState.snapshot.recentBalls,
      };
    } else {
      baseModel = applyTheme1DrawPresentation(currentState.snapshot, null);
    }
  }

  // Apply new draw presentation on top of the committed base
  set({
    snapshot: applyTheme1DrawPresentation(
      baseModel,
      nextPendingDrawNumber,
      {
        markBoards: currentState.runtime.lastTicketSource === "currentGame",
      },
    ),
    runtime: {
      ...currentState.runtime,
      pendingDrawNumber: nextPendingDrawNumber,
    },
  });

  pendingDrawTimer = setTimeout(() => {
    const latestState = get();
    if (latestState.runtime.pendingDrawNumber !== nextPendingDrawNumber) {
      return;
    }

    if (latestState.mode === "live" && latestState.roomSnapshot) {
      const session = normalizeSession(latestState.session);
      const result = mapRoomSnapshotToTheme1(latestState.roomSnapshot, {
        session,
        connectionPhase: "connected",
      });
      const nextSession =
        result.resolvedPlayerId && result.resolvedPlayerId !== session.playerId
          ? { ...session, playerId: result.resolvedPlayerId }
          : session;

      writeSession(nextSession);

      // Always keep client's recentBalls — balls only enter through draw:new.
      set({
        session: nextSession,
        snapshot: {
          ...result.model,
          recentBalls: latestState.snapshot.recentBalls,
          featuredBallNumber: null,
          featuredBallIsPending: false,
        },
        runtime: {
          ...latestState.runtime,
          pendingDrawNumber: null,
        },
      });
      return;
    }

    set({
      snapshot: applyTheme1DrawPresentation(latestState.snapshot, null),
      runtime: {
        ...latestState.runtime,
        pendingDrawNumber: null,
      },
    });
  }, THEME1_DRAW_PRESENTATION_MS);
}

function commitPreviousPendingDrawPresentation(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  nextPendingDrawNumber: number,
): void {
  const currentState = get();
  const previousPendingDrawNumber = currentState.runtime.pendingDrawNumber;

  if (
    previousPendingDrawNumber === null ||
    previousPendingDrawNumber === nextPendingDrawNumber
  ) {
    return;
  }

  if (currentState.mode === "live" && currentState.roomSnapshot) {
    const session = normalizeSession(currentState.session);
    const result = mapRoomSnapshotToTheme1(currentState.roomSnapshot, {
      session,
      connectionPhase: "connected",
    });
    const nextSession =
      result.resolvedPlayerId && result.resolvedPlayerId !== session.playerId
        ? { ...session, playerId: result.resolvedPlayerId }
        : session;

    writeSession(nextSession);
    set({
      session: nextSession,
      snapshot: result.model,
      runtime: {
        ...currentState.runtime,
        pendingDrawNumber: null,
      },
    });
    return;
  }

  set({
    snapshot: applyTheme1DrawPresentation(currentState.snapshot, null),
    runtime: {
      ...currentState.runtime,
      pendingDrawNumber: null,
    },
  });
}

function clearPendingDrawTimer(): void {
  if (!pendingDrawTimer) {
    return;
  }

  clearTimeout(pendingDrawTimer);
  pendingDrawTimer = null;
}

function enqueueCelebrations(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  celebrations: readonly Theme1CelebrationState[],
  leadDelayMs = 0,
): void {
  if (celebrations.length === 0) {
    return;
  }

  if (leadDelayMs > 0) {
    clearCelebrationLeadTimer();
    celebrationLeadTimer = setTimeout(() => {
      celebrationLeadTimer = null;
      enqueueCelebrations(set, get, celebrations, 0);
    }, leadDelayMs);
    return;
  }

  const currentState = get();
  const nextQueue = [...currentState.celebrationQueue, ...celebrations];

  if (currentState.celebration) {
    set({ celebrationQueue: nextQueue });
    return;
  }

  const [first, ...rest] = nextQueue;
  if (!first) {
    return;
  }

  set({
    celebration: first,
    celebrationQueue: rest,
  });
  activateTopperPulse(set, get, first);
  scheduleNextCelebration(set, get);
}

function scheduleNextCelebration(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
): void {
  clearCelebrationTimer();

  celebrationTimer = setTimeout(() => {
    const currentState = get();
    if (currentState.celebrationQueue.length === 0) {
      set({
        celebration: null,
        celebrationQueue: [],
      });
      celebrationTimer = null;
      return;
    }

    const [nextCelebration, ...rest] = currentState.celebrationQueue;
    if (!nextCelebration) {
      set({
        celebration: null,
        celebrationQueue: [],
      });
      celebrationTimer = null;
      return;
    }

    set({
      celebration: nextCelebration,
      celebrationQueue: rest,
    });
    activateTopperPulse(set, get, nextCelebration);
    scheduleNextCelebration(set, get);
  }, THEME1_CELEBRATION_PRESENTATION_MS);
}

function clearCelebrationTimer(): void {
  if (!celebrationTimer) {
    return;
  }

  clearTimeout(celebrationTimer);
  celebrationTimer = null;
}

function clearCelebrationLeadTimer(): void {
  if (!celebrationLeadTimer) {
    return;
  }

  clearTimeout(celebrationLeadTimer);
  celebrationLeadTimer = null;
}

function activateTopperPulse(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  celebration: Theme1CelebrationState,
): void {
  const topperId =
    typeof celebration.topperId === "number" && celebration.topperId > 0
      ? Math.trunc(celebration.topperId)
      : 0;
  if (topperId <= 0) {
    return;
  }

  const pulseKind = celebration.kind === "win" ? "win" : "near";
  const existingTimer = topperPulseTimers.get(topperId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  set({
    topperPulses: {
      ...get().topperPulses,
      [topperId]: pulseKind,
    },
  });

  const timer = setTimeout(() => {
    topperPulseTimers.delete(topperId);
    const nextPulses = { ...get().topperPulses };
    delete nextPulses[topperId];
    set({ topperPulses: nextPulses });
  }, resolveTopperPulseDurationMs(celebration.kind));

  topperPulseTimers.set(topperId, timer);
}

function resolveTopperPulseDurationMs(kind: Theme1CelebrationState["kind"]): number {
  return kind === "win" ? THEME1_TOPPER_WIN_PULSE_MS : THEME1_TOPPER_NEAR_PULSE_MS;
}

function clearAllTopperPulseTimers(): void {
  for (const timer of topperPulseTimers.values()) {
    clearTimeout(timer);
  }

  topperPulseTimers.clear();
}

function buildMockDrawSeedSnapshot(
  state: Theme1State,
  session: RealtimeSession,
): Theme1RoundRenderModel {
  const shouldResetRound =
    resolveAvailableMockDrawNumbers(state.snapshot.recentBalls).length === 0;
  const sourceModel = shouldResetRound ? theme1MockSnapshot : state.snapshot;
  const nextRecentBalls = shouldResetRound ? [] : [...sourceModel.recentBalls];
  const nextDrawCount = nextRecentBalls.length;

  return {
    ...sourceModel,
    recentBalls: nextRecentBalls,
    featuredBallNumber: nextRecentBalls[nextRecentBalls.length - 1] ?? null,
    featuredBallIsPending: false,
    hud: {
      ...sourceModel.hud,
      roomPlayers: sourceModel.hud.roomPlayers || theme1MockSnapshot.hud.roomPlayers,
      nesteTrekkOm: "00:00",
    },
    meta: {
      ...sourceModel.meta,
      source: "mock",
      roomCode: session.roomCode || sourceModel.meta.roomCode,
      hallId: session.hallId || sourceModel.meta.hallId,
      playerId: session.playerId || sourceModel.meta.playerId,
      hostPlayerId: session.playerId || sourceModel.meta.hostPlayerId,
      gameStatus: "RUNNING",
      drawCount: nextDrawCount,
      remainingNumbers: Math.max(0, 60 - nextDrawCount),
      connectionPhase: "mock",
      connectionLabel: "Mock",
      backendUrl: session.baseUrl,
    },
  };
}

function resolveAvailableMockDrawNumbers(recentBalls: readonly number[]): number[] {
  const seenNumbers = new Set(
    recentBalls
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value)),
  );

  return Array.from({ length: 60 }, (_, index) => index + 1).filter(
    (value) => !seenNumbers.has(value),
  );
}

function resolveCurrentStakeAmount(state: Theme1State): number {
  const schedulerStake = state.roomSnapshot?.scheduler?.entryFee;
  if (typeof schedulerStake === "number" && Number.isFinite(schedulerStake)) {
    return clampStakeAmount(schedulerStake);
  }

  return parseStakeLabel(state.snapshot.hud.innsats);
}

function parseStakeLabel(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? clampStakeAmount(parsed) : 0;
}

function formatStakeAmount(value: number): string {
  return `${clampStakeAmount(value)} kr`;
}

export function resolveAdjustedStakeAmount(currentStake: number, delta: number): number {
  return clampStakeAmount(currentStake + Math.trunc(delta));
}

export function resolveStakeAmountBeforeArming(currentStake: number): number {
  if (currentStake > 0) {
    return clampStakeAmount(currentStake);
  }

  return THEME1_MIN_ARMABLE_TOTAL_STAKE_KR;
}

export function clampStakeAmount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const truncatedValue = Math.trunc(value);
  if (truncatedValue <= 0) {
    return 0;
  }

  const steppedValue =
    Math.floor(truncatedValue / THEME1_STAKE_STEP_KR) * THEME1_STAKE_STEP_KR;

  return Math.max(0, Math.min(THEME1_MAX_TOTAL_STAKE_KR, steppedValue));
}

function isCurrentPlayerArmed(state: Theme1State): boolean {
  if (state.mode !== "live") {
    return state.mockBetArmed;
  }

  const playerId = state.session.playerId.trim();
  return (
    playerId.length > 0 &&
    (state.roomSnapshot?.scheduler?.armedPlayerIds ?? []).includes(playerId)
  );
}

function getLiveSocketOrFail(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
) {
  const state = get();
  const session = normalizeSession(state.session);
  if (!session.roomCode || !session.playerId) {
    set({
      connection: {
        phase: "error",
        label: "Feil",
        message: "Room og player må være satt før kontrollene kan brukes.",
      },
    });
    return null;
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
    return null;
  }

  return socket;
}

function validateDrawNewPayload(payload: CandyDrawNewPayload): number | null {
  if (
    typeof payload?.number !== "number" ||
    !Number.isFinite(payload.number) ||
    payload.number <= 0
  ) {
    return null;
  }

  return Math.trunc(payload.number);
}

function setSnapshotValidationError(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  message: string,
): void {
  set({
    connection: {
      phase: "error",
      label: "Feil",
      message,
    },
    runtime: {
      ...get().runtime,
      syncInFlight: false,
      inFlightSyncRequestId: null,
    },
  });
}

function setControlError(
  set: (partial: Partial<Theme1State>) => void,
  get: () => Theme1State,
  error: unknown,
  fallbackMessage: string,
): void {
  const message = error instanceof Error ? error.message : fallbackMessage;
  set({
    connection: {
      phase: "error",
      label: "Feil",
      message,
    },
    controlsBusy: false,
    stakeBusy: false,
    betBusy: false,
    rerollBusy: false,
    runtime: {
      ...get().runtime,
      syncInFlight: false,
      inFlightSyncRequestId: null,
    },
  });
}
