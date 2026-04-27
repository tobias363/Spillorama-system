/**
 * Tobias 2026-04-27: ADMIN Ops Console — socket subscribe-handler.
 *
 * Klient flyt:
 *   1. Klient kobler til default Socket.IO-namespace (samme som admin-web
 *      ellers bruker for `admin:login`). Auth via `admin:login`-event
 *      (eksisterende `adminHallEvents.ts`-pattern) → setter
 *      `socket.data.adminUser`.
 *   2. Klient emitter `admin:ops:subscribe` (uten payload). Hvis brukeren
 *      har OPS_CONSOLE_READ → server kaller `socket.join("admin:ops")` og
 *      sender `ack({ ok: true })`.
 *   3. Server pusher `admin:ops:update`-events til alle medlemmer av
 *      "admin:ops"-rommet ved overview-endringer (force-actions, alerts).
 *   4. Klient lytter på `admin:ops:update`. Payload-shape:
 *        { kind: AdminOpsBroadcastKind, payload: Record<string, unknown>, at: ISO }
 *
 * Konvensjon: `"admin:ops"` er rom-key. Holder vi det enkelt — ingen per-
 * hall sub-rooms i denne første versjonen siden ADMIN ser hele systemet.
 */

import type { Socket } from "socket.io";
import { logger as rootLogger } from "../util/logger.js";
import type { UserRole } from "../platform/PlatformService.js";
import type { SocketRateLimiter } from "../middleware/socketRateLimit.js";

const log = rootLogger.child({ module: "admin-ops-events" });

export const ADMIN_OPS_ROOM_KEY = "admin:ops";

/**
 * Inline OPS_CONSOLE_READ-roller. Speiler det parallel ADMIN all-permissions
 * audit-PR setter i AdminAccessPolicy. Følg-opp-PR flytter til policy-import.
 */
const OPS_CONSOLE_READ_ROLES: ReadonlyArray<UserRole> = ["ADMIN", "SUPPORT"];

/**
 * Lokal shape for socket.data.adminUser. Speiles fra adminHallEvents.ts'
 * AdminSocketData uten å importere typen direkte (ikke eksportert per nå).
 */
interface AdminSocketDataLike {
  adminUser?: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
  };
}

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function ackSuccess<T>(cb: ((r: AckResponse<T>) => void) | undefined, data: T): void {
  cb?.({ ok: true, data });
}

function ackFailure<T>(
  cb: ((r: AckResponse<T>) => void) | undefined,
  code: string,
  message: string,
): void {
  cb?.({ ok: false, error: { code, message } });
}

export interface RegisterAdminOpsEventsDeps {
  socketRateLimiter?: SocketRateLimiter;
}

export function createAdminOpsEvents(deps: RegisterAdminOpsEventsDeps = {}) {
  const { socketRateLimiter } = deps;

  function rateLimitOk(socket: Socket, eventName: string): boolean {
    if (!socketRateLimiter) return true;
    if (!socketRateLimiter.check(socket.id, eventName)) return false;
    const adminId = (socket.data as AdminSocketDataLike).adminUser?.id;
    if (adminId && !socketRateLimiter.checkByKey(adminId, eventName)) {
      return false;
    }
    return true;
  }

  return function registerAdminOpsEvents(socket: Socket): void {
    socket.on(
      "admin:ops:subscribe",
      (callback?: (r: AckResponse<{ subscribed: true }>) => void) => {
        try {
          if (!rateLimitOk(socket, "admin:ops:subscribe")) {
            ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
            return;
          }
          const admin = (socket.data as AdminSocketDataLike).adminUser;
          if (!admin) {
            ackFailure(
              callback,
              "UNAUTHORIZED",
              "Du må kjøre admin:login før admin:ops:subscribe.",
            );
            return;
          }
          if (!OPS_CONSOLE_READ_ROLES.includes(admin.role)) {
            ackFailure(
              callback,
              "FORBIDDEN",
              "Du har ikke tilgang til ops-konsollet.",
            );
            return;
          }
          socket.join(ADMIN_OPS_ROOM_KEY);
          log.debug({ adminId: admin.id, role: admin.role }, "admin:ops subscribe");
          ackSuccess(callback, { subscribed: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : "ukjent feil";
          ackFailure(callback, "SUBSCRIBE_FAILED", message);
        }
      },
    );

    socket.on(
      "admin:ops:unsubscribe",
      (callback?: (r: AckResponse<{ unsubscribed: true }>) => void) => {
        try {
          if (!rateLimitOk(socket, "admin:ops:unsubscribe")) {
            ackFailure(callback, "RATE_LIMITED", "For mange foresporsler. Vent litt.");
            return;
          }
          socket.leave(ADMIN_OPS_ROOM_KEY);
          ackSuccess(callback, { unsubscribed: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : "ukjent feil";
          ackFailure(callback, "UNSUBSCRIBE_FAILED", message);
        }
      },
    );
  };
}
