/**
 * BIN-515: Admin hall-event socket handlers.
 *
 * Gives hall operators a live socket channel for the controls exposed
 * through the web admin (apps/admin-web):
 *   - `admin:login`      — authenticates the socket via JWT access-token.
 *                          Pins the socket to the admin user and their
 *                          ROOM_CONTROL_WRITE permission. Must be called
 *                          before any hall-event emits are accepted.
 *   - `admin:room-ready` — broadcasts a host-ready signal to everyone in
 *                          the room code. No engine state change — this
 *                          is a pure notification so clients can start a
 *                          countdown or flash a "klart"-banner.
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
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { SocketRateLimiter } from "../middleware/socketRateLimit.js";
import { canAccessAdminPermission } from "../platform/AdminAccessPolicy.js";
import { AdminHallBalancePayloadSchema } from "@spillorama/shared-types/socket-events";

export interface AdminHallDeps {
  engine: BingoEngine;
  platformService: PlatformService;
  io: Server;
  /** Re-used from index.ts so the same room:update payload shape is broadcast. */
  emitRoomUpdate: (roomCode: string) => Promise<RoomUpdatePayload>;
  /** BIN-585 PR D: wired through for `admin:hall-balance`. */
  walletAdapter: WalletAdapter;
  /**
   * Bølge D Issue 2 (MEDIUM): rate-limiter for admin-events. Optional så
   * eksisterende test-harnesses kan kjøre uten — handleren faller da
   * tilbake til "no rate-limit" (matcher tidligere adferd).
   *
   * Admin-actions er sjeldne; pilot-policy er 10/s per admin-socket
   * (config i `DEFAULT_RATE_LIMITS`). Når limiter er satt sjekkes både
   * socket.id og admin user.id (matcher BIN-247-mønsteret).
   */
  socketRateLimiter?: SocketRateLimiter;
}

/**
 * BIN-585 PR D: the (gameType, channel) pairs we query for a hall balance.
 * Mirrors `ComplianceLedger.makeHouseAccountId`. DATABINGO is the primary
 * domain; MAIN_GAME is legacy wording and not populated in new backend.
 * If we later onboard a new game type, add the pair here.
 */
const HALL_BALANCE_ACCOUNT_PAIRS: ReadonlyArray<{ gameType: "DATABINGO"; channel: "HALL" | "INTERNET" }> = [
  { gameType: "DATABINGO", channel: "HALL" },
  { gameType: "DATABINGO", channel: "INTERNET" },
];

/** Mirror of `ComplianceLedger.makeHouseAccountId`. */
function makeHouseAccountId(hallId: string, gameType: string, channel: string): string {
  return `house-${hallId.trim()}-${gameType.toLowerCase()}-${channel.toLowerCase()}`;
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
  const { engine, platformService, io, emitRoomUpdate, walletAdapter, socketRateLimiter } = deps;

  function ackSuccess<T>(cb: ((r: AckResponse<T>) => void) | undefined, data: T): void {
    if (typeof cb === "function") cb({ ok: true, data });
  }
  function ackFailure<T>(cb: ((r: AckResponse<T>) => void) | undefined, code: string, message: string): void {
    if (typeof cb === "function") cb({ ok: false, error: { code, message } });
  }

  /**
   * Bølge D Issue 2 (MEDIUM): per-event rate-limit for admin-actions.
   * Sjekker både socket.id (catch-all) og admin user.id (overlever
   * reconnect — admin-portal kan ha bot-script som spammer events). Hvis
   * ingen limiter er satt (test-harness) → tillat alt (matcher tidligere
   * adferd). Returnerer false → callsite må svare RATE_LIMITED i ack.
   */
  function adminRateLimitOk(socket: Socket, eventName: string): boolean {
    if (!socketRateLimiter) return true;
    if (!socketRateLimiter.check(socket.id, eventName)) return false;
    const adminUser = (socket.data as AdminSocketData).adminUser;
    if (adminUser?.id && !socketRateLimiter.checkByKey(adminUser.id, eventName)) {
      return false;
    }
    return true;
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
        // Bølge D Issue 2: rate-limit FØR auth-tunge platformService-kall.
        if (!adminRateLimitOk(socket, "admin:login")) {
          ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
          return;
        }
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
        // Bølge D Issue 2: rate-limit før engine/io-fanout.
        if (!adminRateLimitOk(socket, "admin:room-ready")) {
          ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
          return;
        }
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
        // Bølge D Issue 2: rate-limit før engine.pauseGame (state-mutating).
        if (!adminRateLimitOk(socket, "admin:pause-game")) {
          ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
          return;
        }
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
        // Bølge D Issue 2: rate-limit før engine.resumeGame.
        if (!adminRateLimitOk(socket, "admin:resume-game")) {
          ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
          return;
        }
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
        // Bølge D Issue 2: rate-limit før engine.endGame (regulatorisk path).
        if (!adminRateLimitOk(socket, "admin:force-end")) {
          ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
          return;
        }
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

    // ── admin:hall-balance (BIN-585 PR D) ──────────────────────────────
    // Legacy parity with `getHallBalance` (legacy admnEvents.js:47). The
    // legacy handler joined a shift/agent table to break out cash-in /
    // cash-out / daily-balance; the new backend has no shift table (agent
    // domain → BIN-583), so we return the current house-account balance
    // per (gameType, channel) for the hall. That's the minimum an
    // operator needs for "how much money is held for this hall". When
    // agent/shift tables land, extend this response — not a new event.
    socket.on("admin:hall-balance", async (
      payload: unknown,
      callback?: (r: AckResponse<{
        hallId: string;
        accounts: Array<{ gameType: string; channel: string; accountId: string; balance: number }>;
        totalBalance: number;
        at: number;
      }>) => void,
    ) => {
      try {
        // Bølge D Issue 2: rate-limit før wallet-oppslag.
        if (!adminRateLimitOk(socket, "admin:hall-balance")) {
          ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
          return;
        }
        const parsed = AdminHallBalancePayloadSchema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first?.path.join(".") || "payload";
          ackFailure(callback, "INVALID_INPUT", `admin:hall-balance payload invalid (${field}: ${first?.message ?? "unknown"}).`);
          return;
        }
        const admin = (socket.data as AdminSocketData).adminUser;
        if (!admin) {
          ackFailure(callback, "NOT_AUTHENTICATED", "Kjør admin:login først.");
          return;
        }
        if (!canAccessAdminPermission(admin.role, "ROOM_CONTROL_READ")) {
          ackFailure(callback, "FORBIDDEN", "Mangler rettigheten ROOM_CONTROL_READ.");
          return;
        }
        const hallId = parsed.data.hallId.trim();
        // Verify the hall exists — avoids returning zero-balance for a typo.
        try {
          await platformService.getHall(hallId);
        } catch {
          ackFailure(callback, "HALL_NOT_FOUND", `Hallen "${hallId}" finnes ikke.`);
          return;
        }

        const accounts = await Promise.all(
          HALL_BALANCE_ACCOUNT_PAIRS.map(async ({ gameType, channel }) => {
            const accountId = makeHouseAccountId(hallId, gameType, channel);
            // getBalance throws ACCOUNT_NOT_FOUND for an un-funded account;
            // treat that as zero so the response stays symmetric across
            // halls regardless of which channels have seen activity.
            let balance = 0;
            try {
              balance = await walletAdapter.getBalance(accountId);
            } catch {
              balance = 0;
            }
            return { gameType, channel, accountId, balance };
          }),
        );
        const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

        console.info("[BIN-585] admin:hall-balance", {
          adminUserId: admin.id,
          hallId,
          totalBalance,
        });
        ackSuccess(callback, { hallId, accounts, totalBalance, at: Date.now() });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ukjent feil";
        const code = (err as { code?: string }).code ?? "HALL_BALANCE_FAILED";
        ackFailure(callback, code, message);
      }
    });
  };
}
