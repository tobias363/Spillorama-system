/**
 * BIN-498: Hall TV-display socket events.
 *
 * Read-only client (no spiller-interaction). The TV-display in a hall
 * subscribes to live draws, pattern wins, and room updates for that hall.
 *
 * Event flow:
 *   1. `admin-display:login`  — token check; tags socket with hallId.
 *   2. `admin-display:subscribe` — joins the canonical hall room so the
 *      display receives the same draw:new / pattern:won / room:update
 *      broadcasts the players see.
 *   3. `admin-display:state` — server pushes a snapshot on subscribe so
 *      the display has full state without waiting for the next event.
 *
 * Hall-isolation guarantee: each socket can only ever be subscribed to ONE
 * hall (the one it logged in for). Cross-hall sniffing is prevented by the
 * login → subscribe binding.
 */
import type { Server, Socket } from "socket.io";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { RoomSnapshot } from "../game/types.js";

export interface AdminDisplayDeps {
  engine: BingoEngine;
  platformService: PlatformService;
  io: Server;
  /**
   * Validate a display token. Returns the hallId the token is allowed for, or
   * throws. Implementation is injected so tests can stub it without spinning
   * up the real auth module. Production wiring uses a static admin-token-per-
   * hall env-var pair (placeholder in index.ts; full RBAC in BIN-503).
   */
  validateDisplayToken: (token: string) => Promise<{ hallId: string }>;
  /**
   * BIN-585 PR D: screensaver config returned by `admin-display:screensaver`.
   * Static per environment — comes from env vars with sane defaults.
   * Matches legacy `Sys.Setting.{screenSaver, screenSaverTime, imageTime}`.
   */
  screensaverConfig: { enabled: boolean; timeoutMs: number; imageRotationMs: number };
}

interface DisplaySocketData {
  /** BIN-498: bound hall once `admin-display:login` succeeds. */
  displayHallId?: string;
}

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface DisplayLoginPayload { token: string }
interface DisplaySubscribePayload { hallId?: string }
interface DisplayStateSnapshot {
  hallId: string;
  hallName: string;
  tvUrl: string | null;
  activeRoom: {
    code: string;
    gameSlug: string | undefined;
    gameStatus: string;
    currentGame?: {
      drawnNumbers: number[];
      lineWinnerId?: string;
      bingoWinnerId?: string;
    };
  } | null;
  serverTimestamp: number;
}

export function createAdminDisplayHandlers(deps: AdminDisplayDeps) {
  const { engine, platformService, io, validateDisplayToken, screensaverConfig } = deps;

  function ackSuccess<T>(callback: ((response: AckResponse<T>) => void) | undefined, data: T): void {
    if (typeof callback === "function") callback({ ok: true, data });
  }
  function ackFailure<T>(callback: ((response: AckResponse<T>) => void) | undefined, code: string, message: string): void {
    if (typeof callback === "function") callback({ ok: false, error: { code, message } });
  }

  /** Resolve the canonical (single) active room for a hall, if any. */
  function resolveActiveRoomForHall(hallId: string): RoomSnapshot | null {
    const summaries = engine.listRoomSummaries().filter((s) => s.hallId === hallId);
    if (summaries.length === 0) return null;
    // Prefer a RUNNING room, else the most recent.
    const running = summaries.find((s) => s.gameStatus === "RUNNING");
    const pick = running ?? summaries[summaries.length - 1];
    try { return engine.getRoomSnapshot(pick.code); } catch { return null; }
  }

  function buildSnapshot(hallId: string, hallName: string, tvUrl: string | null): DisplaySocketHandlerSnapshot {
    const room = resolveActiveRoomForHall(hallId);
    return {
      hallId,
      hallName,
      tvUrl,
      activeRoom: room ? {
        code: room.code,
        gameSlug: room.gameSlug,
        gameStatus: room.currentGame?.status ?? "NONE",
        currentGame: room.currentGame ? {
          drawnNumbers: [...room.currentGame.drawnNumbers],
          lineWinnerId: room.currentGame.lineWinnerId,
          bingoWinnerId: room.currentGame.bingoWinnerId,
        } : undefined,
      } : null,
      serverTimestamp: Date.now(),
    };
  }

  return function registerAdminDisplayEvents(socket: Socket): void {
    // ── Step 1: login. ────────────────────────────────────────────────
    socket.on("admin-display:login", async (
      payload: DisplayLoginPayload,
      callback?: (response: AckResponse<{ hallId: string }>) => void,
    ) => {
      try {
        const token = (payload?.token ?? "").trim();
        if (!token) { ackFailure(callback, "MISSING_TOKEN", "token mangler."); return; }
        const { hallId } = await validateDisplayToken(token);
        (socket.data as DisplaySocketData).displayHallId = hallId;
        ackSuccess(callback, { hallId });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        ackFailure(callback, "UNAUTHORIZED", message);
      }
    });

    // ── Step 2: subscribe. ────────────────────────────────────────────
    socket.on("admin-display:subscribe", async (
      _payload: DisplaySubscribePayload,
      callback?: (response: AckResponse<DisplaySocketHandlerSnapshot>) => void,
    ) => {
      try {
        const data = socket.data as DisplaySocketData;
        if (!data.displayHallId) { ackFailure(callback, "NOT_LOGGED_IN", "kjør admin-display:login først."); return; }
        const hall = await platformService.getHall(data.displayHallId);

        // Join the canonical hall display room so future hall-scoped emits
        // (mirroring done in index.ts) reach this socket. Also join the
        // currently-active game room so existing draw/pattern/room broadcasts
        // are received transparently — no event-name change needed.
        const displayRoom = `hall:${hall.id}:display`;
        socket.join(displayRoom);
        const active = resolveActiveRoomForHall(hall.id);
        if (active) socket.join(active.code);

        const snapshot = buildSnapshot(hall.id, hall.name, hall.tvUrl ?? null);
        ackSuccess(callback, snapshot);
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        ackFailure(callback, "SUBSCRIBE_FAILED", message);
      }
    });

    // ── Step 3: ad-hoc state refresh. ─────────────────────────────────
    socket.on("admin-display:state", async (
      _payload: unknown,
      callback?: (response: AckResponse<DisplaySocketHandlerSnapshot>) => void,
    ) => {
      try {
        const data = socket.data as DisplaySocketData;
        if (!data.displayHallId) { ackFailure(callback, "NOT_LOGGED_IN", "kjør admin-display:login først."); return; }
        const hall = await platformService.getHall(data.displayHallId);
        const snapshot = buildSnapshot(hall.id, hall.name, hall.tvUrl ?? null);
        ackSuccess(callback, snapshot);
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        ackFailure(callback, "STATE_FAILED", message);
      }
    });

    // ── admin-display:screensaver (BIN-585 PR D) ──────────────────────
    // Legacy parity with `ScreenSaver` (common.js:549 → PlayerController
    // returns Sys.Setting.{screenSaver, screenSaverTime, imageTime}). The
    // new backend has no Sys.Setting table; config comes from env vars
    // (HALL_SCREENSAVER_* in envConfig.ts) with sane pilot defaults. No
    // auth — the hall-display TV calls this before admin-display:login to
    // know how long to wait before dimming.
    socket.on("admin-display:screensaver", (
      _payload: unknown,
      callback?: (response: AckResponse<{ enabled: boolean; timeoutMs: number; imageRotationMs: number }>) => void,
    ) => {
      ackSuccess(callback, { ...screensaverConfig });
    });
  };
}

/** Helper: emit a hall-scoped TV-URL broadcast to all displays in a hall. */
export function emitHallTvUrl(io: Server, hallId: string, tvUrl: string | null): void {
  io.to(`hall:${hallId}:display`).emit("hall:tv-url", { hallId, tvUrl });
}

/**
 * Task 1.7: TV-fan-out for `game1:phase-won`.
 *
 * `/admin-game1`-namespace sender eventet til master-konsollen i `game1:<id>`-
 * rom (se `adminGame1Namespace.onPhaseWon`). TV-skjermer er koblet til
 * DEFAULT-namespace via `admin-display:subscribe` og sitter i rom
 * `hall:<hallId>:display`. For at banner "BINGO! Rad 1" skal dukke opp på
 * alle TVer i deltakende haller, speiler vi derfor eventet til hvert hall-
 * display-rom her. Payload er uendret — klient-kontrakt matcher samme
 * `Game1AdminPhaseWonPayload`-schema.
 */
export function emitPhaseWonToHallDisplays(
  io: Server,
  hallIds: readonly string[],
  payload: unknown
): void {
  for (const hallId of hallIds) {
    if (!hallId) continue;
    io.to(`hall:${hallId}:display`).emit("game1:phase-won", payload);
  }
}

/**
 * Task 1.7: TV-fan-out for `game1:hall-status-update` (fra HS-PR #451).
 * Samme idé som `emitPhaseWonToHallDisplays`: eventet er master-UI-sentrert,
 * men TVene skal også reagere på fargeendringer (🔴/🟠/🟢) slik at badge-
 * stripen oppdaterer seg live uten å vente på neste poll.
 *
 * HS-PR bruker allerede `io.to('hall:<id>:display').emit('game1:ready-status-update', …)`
 * for den legacy-event-navnet. Dette eventet er den nye Task-HS-varianten
 * (se HS Agent-rapport); emittes fra HS-routeren når scan/ready endrer
 * fargen. Denne helperen brukes der.
 */
export function emitHallStatusUpdateToHallDisplay(
  io: Server,
  hallId: string,
  payload: unknown
): void {
  if (!hallId) return;
  io.to(`hall:${hallId}:display`).emit("game1:hall-status-update", payload);
}

type DisplaySocketHandlerSnapshot = DisplayStateSnapshot;
