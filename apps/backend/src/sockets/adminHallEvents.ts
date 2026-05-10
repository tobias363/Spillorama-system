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
import { canAccessAdminPermission, assertUserHallScope } from "../platform/AdminAccessPolicy.js";
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
 * Mirrors `ComplianceLedger.makeHouseAccountId`.
 *
 * K2-A CRIT-1: Spill 1 (slug `bingo`) er hovedspill og skriver til
 * MAIN_GAME-house-account. Vi MÅ derfor også summere MAIN_GAME-balansene
 * for at admin:hall-balance skal vise korrekt total etter slug-fixen.
 * SpinnGo og legacy ad-hoc-spill bruker fortsatt DATABINGO.
 */
const HALL_BALANCE_ACCOUNT_PAIRS: ReadonlyArray<{
  gameType: "DATABINGO" | "MAIN_GAME";
  channel: "HALL" | "INTERNET";
}> = [
  { gameType: "DATABINGO", channel: "HALL" },
  { gameType: "DATABINGO", channel: "INTERNET" },
  { gameType: "MAIN_GAME", channel: "HALL" },
  { gameType: "MAIN_GAME", channel: "INTERNET" },
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
    /**
     * SEC-P0-001 (Bølge 2A 2026-04-28): hall-scope for HALL_OPERATOR. Mirrors
     * `AppUser.hallId` and is used by `assertUserHallScope` in every
     * hall-mutating event handler. `null` for ADMIN/SUPPORT (global scope)
     * and for an unassigned HALL_OPERATOR (fail-closed at the per-event
     * check). Without this, an operator from hall A could pause/end games
     * in hall B via Socket.IO — the cross-hall control bypass closed by
     * Bølge 2A. See FIN-P0-01 in docs/audit/SECURITY_AUDIT_2026-04-28.md.
     */
    hallId: string | null;
  };
}

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface AdminLoginPayload { accessToken?: string }
interface RoomReadyPayload { roomCode?: string; countdownSeconds?: number; message?: string }
/**
 * MED-11: utvidet med valgfri `pauseUntil` (estimert resume-tidspunkt, ISO 8601)
 * og `pauseReason` (maskinlesbar grunn — `AWAITING_OPERATOR`, `MANUAL_PAUSE_5MIN`,
 * etc.). Begge brukes av klient til å vise countdown / kontekst-tekst i stedet
 * for den åpne "Spillet er pauset"-meldingen.
 */
interface PauseGamePayload {
  roomCode?: string;
  message?: string;
  pauseUntil?: string;
  pauseReason?: string;
  /**
   * MED-11: alternativt til `pauseUntil` — antall minutter pausen forventes
   * å vare. Backend regner ut `pauseUntil = now + minutes*60_000` hvis
   * `pauseUntil` ikke er satt direkte. Begrenset til 0 < minutes <= 60 for
   * å unngå at en typo i UI gir 24t pause-display.
   */
  pauseEstimatedMinutes?: number;
}
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

/**
 * MED-11: Avled `pauseUntil` (ISO) og normalisert `pauseReason` fra payload.
 *
 * Eksportert for unit-test. Returnerer `undefined` for begge felter når
 * payload ikke gir nok info, slik at klient faller tilbake til
 * "Venter på hall-operatør".
 *
 * Regler:
 *   - Hvis `pauseUntil` er en gyldig ISO-streng som er i fremtiden, brukes den.
 *   - Ellers: hvis `pauseEstimatedMinutes` er et tall i (0, 60], regn ut
 *     `pauseUntil = now + minutes*60_000`.
 *   - `pauseReason` clampes til 64 tegn for å unngå at klient får en
 *     uhåndterlig streng å vise.
 */
export function derivePauseEstimate(
  payload: { pauseUntil?: string; pauseReason?: string; pauseEstimatedMinutes?: number } | null | undefined,
  now: number = Date.now(),
): { pauseUntil?: string; pauseReason?: string } {
  let pauseUntil: string | undefined;
  const rawUntil = payload?.pauseUntil;
  if (typeof rawUntil === "string" && rawUntil.trim() !== "") {
    const ts = Date.parse(rawUntil);
    if (Number.isFinite(ts) && ts > now) {
      pauseUntil = new Date(ts).toISOString();
    }
  }
  if (!pauseUntil) {
    const mins = payload?.pauseEstimatedMinutes;
    if (typeof mins === "number" && Number.isFinite(mins) && mins > 0 && mins <= 60) {
      pauseUntil = new Date(now + Math.floor(mins * 60_000)).toISOString();
    }
  }
  let pauseReason: string | undefined;
  if (typeof payload?.pauseReason === "string" && payload.pauseReason.trim() !== "") {
    pauseReason = payload.pauseReason.trim().slice(0, 64);
  }
  return { pauseUntil, pauseReason };
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

  /**
   * SEC-P0-001 (Bølge 2A 2026-04-28): hall-scope guard for socket-layer
   * admin actions. Mirrors the HTTP-layer pattern in `paymentRequests.ts`
   * (and others) where every hall-mutating route calls
   * `assertUserHallScope(user, existing.hallId)` before touching engine
   * state.
   *
   * Behaviour:
   *   - ADMIN / SUPPORT pass through (global scope by definition).
   *   - HALL_OPERATOR must have `hallId === targetHallId`. An operator
   *     without `hallId` (un-assigned) is fail-closed with FORBIDDEN —
   *     matches `assertUserHallScope` in AdminAccessPolicy.
   *   - Throws a `DomainError("FORBIDDEN", ...)` with `.code === "FORBIDDEN"`
   *     so the surrounding ack-failure path returns the same shape that the
   *     HTTP routes return for the same offence.
   *
   * Why we need this: pre-fix, the only check was `ROOM_CONTROL_WRITE`,
   * which is granted to both ADMIN and HALL_OPERATOR. A hall-operator from
   * hall A could connect, log in, and emit `admin:pause-game` for a
   * `roomCode` belonging to hall B — the engine state-mutates in the wrong
   * hall mid-round. In a 4-hall pilot a single rogue/compromised operator
   * could grief every other hall.
   *
   * Throws if `hallId` cannot be resolved (room not found) — callsite must
   * resolve hallId BEFORE calling this; we don't want to lookup twice.
   */
  function assertAdminCanActOnHall(
    admin: NonNullable<AdminSocketData["adminUser"]>,
    targetHallId: string,
  ): void {
    assertUserHallScope(
      { role: admin.role, hallId: admin.hallId },
      targetHallId,
      "Du har ikke tilgang til denne hallen.",
    );
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
          // SEC-P0-001: capture hallId so subsequent admin:* events can
          // enforce hall-scope (assertAdminCanActOnHall). `hallId` is null
          // for ADMIN/SUPPORT (global scope) and for HALL_OPERATOR until
          // an admin assigns one — which is fail-closed in
          // assertUserHallScope.
          hallId: user.hallId ?? null,
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
        // SEC-P0-001: verify the admin is allowed to act on this hall
        // before we broadcast a hall-event. ADMIN/SUPPORT pass through;
        // HALL_OPERATOR must own this hall.
        assertAdminCanActOnHall(admin, hallId);
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
        // SEC-P0-001: resolve hallId from snapshot and verify scope BEFORE
        // mutating engine state. Fails closed if room doesn't exist
        // (ROOM_NOT_FOUND) or operator from different hall (FORBIDDEN).
        const targetHallId = resolveHallId(roomCode);
        if (targetHallId === null) {
          ackFailure(callback, "ROOM_NOT_FOUND", "Rommet finnes ikke.");
          return;
        }
        assertAdminCanActOnHall(admin, targetHallId);
        const message = typeof payload?.message === "string" ? payload.message.slice(0, 200) : undefined;
        const { pauseUntil, pauseReason } = derivePauseEstimate(payload);
        engine.pauseGame(roomCode, message, { pauseUntil, pauseReason });
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
        // SEC-P0-001: hall-scope check before engine.resumeGame.
        const targetHallId = resolveHallId(roomCode);
        if (targetHallId === null) {
          ackFailure(callback, "ROOM_NOT_FOUND", "Rommet finnes ikke.");
          return;
        }
        assertAdminCanActOnHall(admin, targetHallId);
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
        // SEC-P0-001: hall-scope check before engine.endGame. Use the
        // snapshot we already loaded so we don't double-fetch.
        const targetHallId = beforeSnapshot.hallId ?? null;
        if (targetHallId === null) {
          // A room without a hallId is a legacy state that shouldn't
          // happen post-pilot. Fail closed for HALL_OPERATOR — only
          // ADMIN/SUPPORT may force-end an unscoped room.
          if (admin.role !== "ADMIN" && admin.role !== "SUPPORT") {
            ackFailure(callback, "FORBIDDEN", "Rommet har ingen hall — kun ADMIN kan force-end.");
            return;
          }
        } else {
          assertAdminCanActOnHall(admin, targetHallId);
        }
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
        // SEC-P0-001: hall-scope check before exposing balance data. A
        // HALL_OPERATOR from hall A must not be able to read house-account
        // balances for hall B (operational fingerprinting + competitive
        // intel leak). Mirrors the HTTP-layer pattern in admin reports.
        try {
          assertAdminCanActOnHall(admin, hallId);
        } catch (err) {
          const code = (err as { code?: string }).code ?? "FORBIDDEN";
          const message = err instanceof Error ? err.message : "Du har ikke tilgang til denne hallen.";
          ackFailure(callback, code, message);
          return;
        }
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

    // ── admin:game1:subscribe (ADR-0019 P0-3, Wave 1) ────────────────────
    //
    // Lar agent-portal/master-konsoll på DEFAULT namespace joine
    // `admin:masters:<gameId>` for å motta master-action, transfer-*,
    // master-changed, og ready-status-update events. Tidligere brukte
    // backend bare `io.emit(...)` som lekket til alle ~36k sockets.
    //
    // Master-konsollen som bruker /admin-game1-namespacet trenger IKKE
    // dette eventet (den joiner game1:<gameId> via game1:subscribe på
    // namespacet). Dette eventet er for default-namespace-konsumenter
    // (agent-portal) som ikke er på det dedikerte admin-namespacet.
    socket.on(
      "admin:game1:subscribe",
      async (
        payload: { gameId?: unknown } | undefined,
        callback?: (r: AckResponse<{ gameId: string }>) => void,
      ) => {
        try {
          if (!adminRateLimitOk(socket, "admin:game1:subscribe")) {
            ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
            return;
          }
          const admin = (socket.data as AdminSocketData).adminUser;
          if (!admin) {
            ackFailure(callback, "NOT_AUTHENTICATED", "Kjør admin:login først.");
            return;
          }
          // Bare admin-roller som har lov å se master-actions skal joine.
          // Master-event-konsumenter er ADMIN, HALL_OPERATOR og AGENT (samme
          // sett som GAME1_MASTER_WRITE). SUPPORT er read-only og kan også
          // observere ready-state-events for incident-response.
          if (!canAccessAdminPermission(admin.role, "ROOM_CONTROL_READ")) {
            ackFailure(callback, "FORBIDDEN", "Mangler tilgang til master-events.");
            return;
          }
          const gameId =
            typeof payload?.gameId === "string" ? payload.gameId.trim() : "";
          if (!gameId) {
            ackFailure(callback, "INVALID_INPUT", "gameId mangler.");
            return;
          }
          // Bruk samme rom-konvensjon som backend emitter på (adminMastersRoomKey).
          socket.join(`admin:masters:${gameId}`);
          ackSuccess(callback, { gameId });
        } catch (err) {
          const message = err instanceof Error ? err.message : "ukjent feil";
          ackFailure(callback, "SUBSCRIBE_FAILED", message);
        }
      },
    );

    socket.on(
      "admin:game1:unsubscribe",
      async (
        payload: { gameId?: unknown } | undefined,
        callback?: (r: AckResponse<{ gameId: string }>) => void,
      ) => {
        try {
          if (!adminRateLimitOk(socket, "admin:game1:unsubscribe")) {
            ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
            return;
          }
          const gameId =
            typeof payload?.gameId === "string" ? payload.gameId.trim() : "";
          if (!gameId) {
            ackFailure(callback, "INVALID_INPUT", "gameId mangler.");
            return;
          }
          socket.leave(`admin:masters:${gameId}`);
          ackSuccess(callback, { gameId });
        } catch (err) {
          const message = err instanceof Error ? err.message : "ukjent feil";
          ackFailure(callback, "UNSUBSCRIBE_FAILED", message);
        }
      },
    );

    // ── admin:room:subscribe (ADR-0019 P0-4, Wave 1) ─────────────────────
    //
    // Lar admin/TV-konsumenter joine `<roomCode>:admin` for å motta FULLE
    // room:update-snapshots. Counterpart til per-spiller-strip i index.ts
    // som filtrerer state per mottaker. Uten admin-rom-snapshot ville
    // admin-display + TV se players=[] / tickets={} / marks={} for
    // perpetual-rom (Spill 2/3), som bryter "alle ser samme state".
    //
    // Brukes av admin-display (TV) og master-konsoll-room-view; spillere
    // skal IKKE joine dette rommet — de mottar strippet payload via
    // socket.id-emit.
    socket.on(
      "admin:room:subscribe",
      async (
        payload: { roomCode?: unknown } | undefined,
        callback?: (r: AckResponse<{ roomCode: string }>) => void,
      ) => {
        try {
          if (!adminRateLimitOk(socket, "admin:room:subscribe")) {
            ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
            return;
          }
          const admin = (socket.data as AdminSocketData).adminUser;
          if (!admin) {
            ackFailure(callback, "NOT_AUTHENTICATED", "Kjør admin:login først.");
            return;
          }
          if (!canAccessAdminPermission(admin.role, "ROOM_CONTROL_READ")) {
            ackFailure(callback, "FORBIDDEN", "Mangler tilgang til admin-rom.");
            return;
          }
          const roomCode =
            typeof payload?.roomCode === "string" ? payload.roomCode.trim() : "";
          if (!roomCode) {
            ackFailure(callback, "INVALID_INPUT", "roomCode mangler.");
            return;
          }
          // Hall-scope: HALL_OPERATOR/AGENT må kun kunne se rom i egen hall.
          // ADMIN/SUPPORT er globalt scope.
          const hallId = resolveHallId(roomCode);
          if (hallId === null) {
            ackFailure(callback, "ROOM_NOT_FOUND", "Rommet finnes ikke.");
            return;
          }
          try {
            assertAdminCanActOnHall(admin, hallId);
          } catch (err) {
            const code = (err as { code?: string }).code ?? "FORBIDDEN";
            const message = err instanceof Error ? err.message : "Du har ikke tilgang til denne hallen.";
            ackFailure(callback, code, message);
            return;
          }
          socket.join(`${roomCode}:admin`);
          ackSuccess(callback, { roomCode });
        } catch (err) {
          const message = err instanceof Error ? err.message : "ukjent feil";
          ackFailure(callback, "SUBSCRIBE_FAILED", message);
        }
      },
    );

    socket.on(
      "admin:room:unsubscribe",
      async (
        payload: { roomCode?: unknown } | undefined,
        callback?: (r: AckResponse<{ roomCode: string }>) => void,
      ) => {
        try {
          if (!adminRateLimitOk(socket, "admin:room:unsubscribe")) {
            ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
            return;
          }
          const roomCode =
            typeof payload?.roomCode === "string" ? payload.roomCode.trim() : "";
          if (!roomCode) {
            ackFailure(callback, "INVALID_INPUT", "roomCode mangler.");
            return;
          }
          socket.leave(`${roomCode}:admin`);
          ackSuccess(callback, { roomCode });
        } catch (err) {
          const message = err instanceof Error ? err.message : "ukjent feil";
          ackFailure(callback, "UNSUBSCRIBE_FAILED", message);
        }
      },
    );
  };
}
