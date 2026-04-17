/**
 * BIN-515: Admin hall-event socket handlers.
 *
 * Gives hall operators a live socket channel for the controls that used
 * to live in the Unity admin client:
 *   - `admin:login`      — authenticates the socket via JWT access-token.
 *                          Pins the socket to the admin user and their
 *                          ROOM_CONTROL_WRITE permission. Must be called
 *                          before any hall-event emits are accepted.
 *   - `admin:room-ready` — broadcasts a host-ready signal to everyone in
 *                          the room code (matches legacy
 *                          Game1RoomReady). No engine state change —
 *                          this is a pure notification so clients can
 *                          start a countdown or flash a "klart"-banner.
 *   - `admin:pause-game` — wraps `engine.pauseGame` (regulatorisk
 *                          emergency-stop mellom draws).
 *   - `admin:resume-game` — wraps `engine.resumeGame`.
 *   - `admin:force-end`  — wraps `engine.endGame` (Lotteritilsynet
 *                          teknisk-feil-path) and also broadcasts an
 *                          `admin:hall-event` with reason so spectator
 *                          clients can react.
 *
 * Why a socket channel rather than HTTP-only: the existing HTTP
 * endpoints (BIN-460) already do the state change, but an operator
 * running the hall wants (a) zero-latency acks, (b) event push for the
 * sibling TV-display without a reload, (c) one persistent connection
 * per shift. The HTTP endpoints stay for parity and automation; this
 * handler is the live-operator path.
 *
 * Auth scoping: the socket's admin context is used as the actor for
 * each event. If the user lacks ROOM_CONTROL_WRITE, the login still
 * succeeds but every hall-event call fails with FORBIDDEN. This makes
 * it safe to let anyone with a valid session attach — the damage gate
 * is at the per-event check.
 */
import type { Server, Socket } from "socket.io";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { RoomSnapshot } from "../game/types.js";
import type { RoomUpdatePayload } from "../util/roomHelpers.js";
import { canAccessAdminPermission } from "../platform/AdminAccessPolicy.js";

export interface AdminHallDeps {
  engine: BingoEngine;
  platformService: PlatformService;
  io: Server;
  /** Re-used from index.ts so the same room:update payload shape is broadcast. */
  emitRoomUpdate: (roomCode: string) => Promise<RoomUpdatePayload>;
}

interface AdminSocketData {
  /** BIN-515: populated once admin:login succeeds. */
  adminUser?: {
    id: string;
    email: string;
    displayName: string;
    role: PublicAppUser["role"];
  };
}

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface AdminLoginPayload { accessToken?: string }
interface RoomReadyPayload { roomCode?: string; countdownSeconds?: number; message?: string }
interface PauseGamePayload { roomCode?: string; message?: string }
interface ResumeGamePayload { roomCode?: string }
interface ForceEndPayload { roomCode?: string; reason?: string }

/**
 * Event broadcast on admin:hall-event so spectators / TV-displays / host
 * clients can react without subscribing to four separate events.
 */
export interface AdminHallEventBroadcast {
  kind: "room-ready" | "paused" | "resumed" | "force-ended";
  roomCode: string;
  hallId: string | null;
  at: number;
  /** Populated for room-ready; optional UI hint for countdown display. */
  countdownSeconds?: number;
  /** Operator-supplied human message (pause reason / force-end reason). */
  message?: string;
  /** Audit trail — admin who triggered the event. */
  actor: { id: string; displayName: string };
}

export function createAdminHallHandlers(deps: AdminHallDeps) {
  const { engine, platformService, io, emitRoomUpdate } = deps;

  function ackSuccess<T>(cb: ((r: AckResponse<T>) => void) | undefined, data: T): void {
    if (typeof cb === "function") cb({ ok: true, data });
  }
  function ackFailure<T>(cb: ((r: AckResponse<T>) => void) | undefined, code: string, message: string): void {
    if (typeof cb === "function") cb({ ok: false, error: { code, message } });
  }

  /** Extract validated room-code, or throw a format error the event handler can ack. */
  function requireRoomCode(raw: unknown): string {
    if (typeof raw !== "string" || !raw.trim()) {
      throw Object.assign(new Error("roomCode mangler."), { code: "INVALID_INPUT" });
    }
    return raw.trim().toUpperCase();
  }

  function requireAuthenticatedAdmin(socket: Socket): NonNullable<AdminSocketData["adminUser"]> {
    const admin = (socket.data as AdminSocketData).adminUser;
    if (!admin) {
      throw Object.assign(new Error("Kjør admin:login først."), { code: "NOT_AUTHENTICATED" });
    }
    if (!canAccessAdminPermission(admin.role, "ROOM_CONTROL_WRITE")) {
      throw Object.assign(new Error("Mangler rettigheten ROOM_CONTROL_WRITE."), { code: "FORBIDDEN" });
    }
    return admin;
  }

  function resolveHallId(roomCode: string): string | null {
    try {
      return engine.getRoomSnapshot(roomCode).hallId ?? null;
    } catch {
      return null;
    }
  }

  function broadcastHallEvent(event: AdminHallEventBroadcast): void {
    // Room-scoped emit reaches the host + players + any spectators.
    io.to(event.roomCode).emit("admin:hall-event", event);
    // TV-display (BIN-498) joins `hall:<id>:display`; mirror there.
    if (event.hallId) {
      io.to(`hall:${event.hallId}:display`).emit("admin:hall-event", event);
    }
  }

  return function registerAdminHallEvents(socket: Socket): void {
    // ── admin:login ────────────────────────────────────────────────────
    socket.on("admin:login", async (
      payload: AdminLoginPayload,
      callback?: (r: AckResponse<{ userId: string; role: PublicAppUser["role"]; canControlRooms: boolean }>) => void,
    ) => {
      try {
        const token = (payload?.accessToken ?? "").trim();
        if (!token) { ackFailure(callback, "MISSING_TOKEN", "accessToken mangler."); return; }
        const user = await platformService.getUserFromAccessToken(token);
        (socket.data as AdminSocketData).adminUser = {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        };
        ackSuccess(callback, {
          userId: user.id,
          role: user.role,
          canControlRooms: canAccessAdminPermission(user.role, "ROOM_CONTROL_WRITE"),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        ackFailure(callback, "UNAUTHORIZED", message);
      }
    });

    // ── admin:room-ready ───────────────────────────────────────────────
    socket.on("admin:room-ready", async (
      payload: RoomReadyPayload,
      callback?: (r: AckResponse<AdminHallEventBroadcast>) => void,
    ) => {
      try {
        const admin = requireAuthenticatedAdmin(socket);
        const roomCode = requireRoomCode(payload?.roomCode);
        // Confirm the room exists before broadcasting — avoids advertising
        // a ready-state for a room that never came into being.
        const hallId = resolveHallId(roomCode);
        if (hallId === null) {
          ackFailure(callback, "ROOM_NOT_FOUND", "Rommet finnes ikke.");
          return;
        }
        const countdownSeconds = Number.isFinite(Number(payload?.countdownSeconds))
          ? Math.max(0, Math.min(300, Math.floor(Number(payload!.countdownSeconds))))
          : undefined;
        const event: AdminHallEventBroadcast = {
          kind: "room-ready",
          roomCode,
          hallId,
          at: Date.now(),
          countdownSeconds,
          message: typeof payload?.message === "string" ? payload.message.slice(0, 200) : undefined,
          actor: { id: admin.id, displayName: admin.displayName },
        };
        broadcastHallEvent(event);
        ackSuccess(callback, event);
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        const code = (err as { code?: string }).code ?? "ROOM_READY_FAILED";
        ackFailure(callback, code, message);
      }
    });

    // ── admin:pause-game ───────────────────────────────────────────────
    socket.on("admin:pause-game", async (
      payload: PauseGamePayload,
      callback?: (r: AckResponse<{ roomCode: string; snapshot: RoomSnapshot }>) => void,
    ) => {
      try {
        const admin = requireAuthenticatedAdmin(socket);
        const roomCode = requireRoomCode(payload?.roomCode);
        const message = typeof payload?.message === "string" ? payload.message.slice(0, 200) : undefined;
        engine.pauseGame(roomCode, message);
        await emitRoomUpdate(roomCode);
        const snapshot = engine.getRoomSnapshot(roomCode);
        broadcastHallEvent({
          kind: "paused",
          roomCode,
          hallId: snapshot.hallId ?? null,
          at: Date.now(),
          message,
          actor: { id: admin.id, displayName: admin.displayName },
        });
        ackSuccess(callback, { roomCode, snapshot });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        const code = (err as { code?: string }).code ?? "PAUSE_FAILED";
        ackFailure(callback, code, message);
      }
    });

    // ── admin:resume-game ──────────────────────────────────────────────
    socket.on("admin:resume-game", async (
      payload: ResumeGamePayload,
      callback?: (r: AckResponse<{ roomCode: string; snapshot: RoomSnapshot }>) => void,
    ) => {
      try {
        const admin = requireAuthenticatedAdmin(socket);
        const roomCode = requireRoomCode(payload?.roomCode);
        engine.resumeGame(roomCode);
        await emitRoomUpdate(roomCode);
        const snapshot = engine.getRoomSnapshot(roomCode);
        broadcastHallEvent({
          kind: "resumed",
          roomCode,
          hallId: snapshot.hallId ?? null,
          at: Date.now(),
          actor: { id: admin.id, displayName: admin.displayName },
        });
        ackSuccess(callback, { roomCode, snapshot });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        const code = (err as { code?: string }).code ?? "RESUME_FAILED";
        ackFailure(callback, code, message);
      }
    });

    // ── admin:force-end ────────────────────────────────────────────────
    socket.on("admin:force-end", async (
      payload: ForceEndPayload,
      callback?: (r: AckResponse<{ roomCode: string; snapshot: RoomSnapshot }>) => void,
    ) => {
      try {
        const admin = requireAuthenticatedAdmin(socket);
        const roomCode = requireRoomCode(payload?.roomCode);
        const reason = typeof payload?.reason === "string" && payload.reason.trim()
          ? payload.reason.trim().slice(0, 200)
          : "FORCE_END_ADMIN";
        // BingoEngine.endGame is host-scoped — use the current host as
        // actor so audit trail stays consistent with the host-led manual
        // end path, but log the admin as the outer actor.
        const beforeSnapshot = engine.getRoomSnapshot(roomCode);
        await engine.endGame({
          roomCode,
          actorPlayerId: beforeSnapshot.hostPlayerId,
          reason,
        });
        await emitRoomUpdate(roomCode);
        const snapshot = engine.getRoomSnapshot(roomCode);
        // Regulatorisk audit trail: console.info matches the pattern in
        // routes/admin.ts `/api/admin/rooms/:roomCode/end` so log-search
        // on "Admin end game" still surfaces this.
        console.info("[BIN-515] Admin force-end via socket", {
          adminUserId: admin.id,
          roomCode,
          reason,
        });
        broadcastHallEvent({
          kind: "force-ended",
          roomCode,
          hallId: snapshot.hallId ?? null,
          at: Date.now(),
          message: reason,
          actor: { id: admin.id, displayName: admin.displayName },
        });
        ackSuccess(callback, { roomCode, snapshot });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        const code = (err as { code?: string }).code ?? "FORCE_END_FAILED";
        ackFailure(callback, code, message);
      }
    });
  };
}
