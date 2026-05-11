/**
 * ADR-0022 Lag 4: socket-event-handler for `master:heartbeat`.
 *
 * Emit-source: admin-web `Spill1HallStatusBox` på cash-inout-siden, hvert
 * `GAME1_MASTER_HEARTBEAT_INTERVAL_MS` (default 30s) så lenge master har
 * konsollet åpent.
 *
 * Handler:
 *   1. Auth via accessToken (samme mønster som game1:join-scheduled).
 *   2. Slå opp aktivt plan-run for (hallId, today-Oslo-businessDate).
 *   3. UPDATE app_game_plan_run SET master_last_seen_at=now(),
 *      master_last_seen_socket_id=socket.id.
 *   4. ACK { acceptedAt, planRunUpdated }.
 *
 * Fail-soft: heartbeat skal aldri kaste til klient — vi svelger feil og
 * returnerer ack { planRunUpdated: false } så klient bare retrier neste runde.
 * Hvis vi kaster, ville klient se ack-feil og logge i konsoll — støy uten
 * effekt.
 *
 * No-op-tilfeller (alle gir planRunUpdated=false):
 *   - Ingen plan-run finnes for (hallId, today)
 *   - Master har ikke startet plan-run ennå
 *   - Plan-run er allerede `finished`
 *
 * Idempotent: kan emittes flere ganger samme tick. Siste timestamp vinner.
 */

import type { Pool } from "pg";
import type { Socket } from "socket.io";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { SocketRateLimiter } from "../middleware/socketRateLimit.js";
import type {
  MasterHeartbeatPayload,
  MasterHeartbeatAckPayload,
} from "@spillorama/shared-types/socket-events";
import { getAccessTokenFromSocketPayload } from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "master-heartbeat-events" });

export interface MasterHeartbeatEventsDeps {
  pool: Pool;
  platformService: PlatformService;
  socketRateLimiter: SocketRateLimiter;
  /**
   * Schema-prefix for DB-queries. Default "public".
   */
  schema?: string;
  /**
   * Clock-injection for tester. Default `() => new Date()`.
   */
  clock?: () => Date;
  /**
   * Oslo-business-date-resolver. Default bruker `todayOsloKey()`-stil.
   * Injection så tester kan freeze dato.
   */
  todayBusinessDate?: () => string;
}

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Returnerer Oslo-business-date (YYYY-MM-DD) for nåværende klokke.
 */
function defaultTodayBusinessDate(clock: () => Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(clock());
}

export function createMasterHeartbeatEventHandlers(
  deps: MasterHeartbeatEventsDeps
) {
  const schema = deps.schema ?? "public";
  const clock = deps.clock ?? (() => new Date());
  const todayBusinessDate =
    deps.todayBusinessDate ?? (() => defaultTodayBusinessDate(clock));

  /**
   * Authenticate socket payload — samme mønster som game1:join-scheduled.
   * Returnerer user eller null hvis auth feiler.
   */
  async function authenticate(
    payload: MasterHeartbeatPayload
  ): Promise<PublicAppUser | null> {
    try {
      const token = getAccessTokenFromSocketPayload(payload);
      if (!token) return null;
      return await deps.platformService.getUserFromAccessToken(token);
    } catch {
      return null;
    }
  }

  /**
   * Hovedflyt: oppdater master_last_seen_at på aktivt plan-run.
   */
  async function handleHeartbeat(
    socketId: string,
    payload: MasterHeartbeatPayload
  ): Promise<{ planRunUpdated: boolean }> {
    const hallId = payload.hallId;
    if (typeof hallId !== "string" || hallId.length === 0) {
      return { planRunUpdated: false };
    }

    const businessDate = todayBusinessDate();

    // Vi oppdaterer kun plan-runs som er aktive (idle / running / paused).
    // `finished` plan-runs ekskluderes — master er ikke aktivt for dem.
    const { rowCount } = await deps.pool.query(
      `UPDATE "${schema}"."app_game_plan_run"
          SET master_last_seen_at        = now(),
              master_last_seen_socket_id = $3,
              updated_at                 = now()
        WHERE hall_id        = $1
          AND business_date  = $2
          AND status IN ('idle','running','paused')`,
      [hallId, businessDate, socketId]
    );

    return { planRunUpdated: (rowCount ?? 0) > 0 };
  }

  /**
   * Registrer event-handler på en autentisert socket-tilkobling.
   * Kalles fra index.ts under socket.on("connection")-blokken.
   */
  return function register(socket: Socket): void {
    socket.on(
      "master:heartbeat",
      async (
        raw: unknown,
        callback?: (response: AckResponse<MasterHeartbeatAckPayload>) => void
      ) => {
        // Rate-limit (default per socketRateLimiter-config). Hvis over
        // limit, returner ack ok=false silently — klient prøver neste 30s.
        if (!deps.socketRateLimiter.check(socket.id, "master:heartbeat")) {
          callback?.({
            ok: false,
            error: { code: "RATE_LIMITED", message: "For ofte heartbeat." },
          });
          return;
        }

        const payload = raw as MasterHeartbeatPayload | undefined;
        if (!payload || typeof payload.hallId !== "string") {
          callback?.({
            ok: false,
            error: { code: "INVALID_INPUT", message: "Ugyldig hallId." },
          });
          return;
        }

        // Fail-soft auth: ugyldig token → ack ok=false uten exception.
        const user = await authenticate(payload);
        if (!user) {
          callback?.({
            ok: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Innlogging er utløpt eller ugyldig.",
            },
          });
          return;
        }

        try {
          const result = await handleHeartbeat(socket.id, payload);
          const acceptedAt = clock().toISOString();
          callback?.({
            ok: true,
            data: {
              acceptedAt,
              planRunUpdated: result.planRunUpdated,
            },
          });
        } catch (err) {
          // Fail-soft: log debug, return ok=true men planRunUpdated=false.
          // Klient skal IKKE retry'e umiddelbart bare fordi DB hadde et
          // hikk — neste 30s-heartbeat fanger det.
          log.debug(
            { err, hallId: payload.hallId, socketId: socket.id },
            "master:heartbeat handler error — soft-fail"
          );
          callback?.({
            ok: true,
            data: {
              acceptedAt: clock().toISOString(),
              planRunUpdated: false,
            },
          });
        }
      }
    );
  };
}

export type MasterHeartbeatEventRegister = ReturnType<
  typeof createMasterHeartbeatEventHandlers
>;
