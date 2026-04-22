/**
 * GAME1_SCHEDULE PR 4d.3: `/admin-game1` socket-namespace.
 *
 * Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.4/§3.5.
 *
 * Admin-konsoll abonnerer på sanntids-events for schedulerte Spill 1-økter i
 * stedet for REST-polling. Namespace-isolasjon fra default `/`:
 *   - Egen JWT-handshake-auth (ikke payload-token per event)
 *   - Kun GAME1_MASTER_WRITE-rolle slipper inn (ADMIN + HALL_OPERATOR + AGENT)
 *   - Events ut er read-only fan-out; ingen events inn påvirker state
 *
 * Events (kun server → client):
 *   - game1:status-update    — ved master-action (start/pause/resume/stop osv)
 *   - game1:draw-progressed  — ved drawNext() i engine
 *   - game1:phase-won        — utsatt til 4d.4
 *
 * Klient flyt:
 *   1. Connect med auth.token = admin-JWT (via accessToken-mekanikk som
 *      eksisterende admin-routes bruker).
 *   2. Emit `game1:subscribe { gameId }` → server kaller `socket.join` med
 *      `game1:<gameId>` room-key.
 *   3. Lytt på events.
 */

import type { Namespace, Server as SocketServer, Socket } from "socket.io";
import { DomainError, toPublicError } from "../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import { assertAdminPermission } from "../platform/AdminAccessPolicy.js";
import {
  Game1AdminSubscribePayloadSchema,
  type Game1AdminStatusUpdatePayload,
  type Game1AdminDrawProgressedPayload,
  type Game1AdminPhaseWonPayload,
  type Game1AdminPhysicalTicketWonPayload,
} from "@spillorama/shared-types/socket-events";
import type {
  AdminGame1Broadcaster,
  AdminGame1StatusChangeEvent,
  AdminGame1DrawProgressedEvent,
  AdminGame1PhaseWonEvent,
  AdminGame1PhysicalTicketWonEvent,
} from "../game/AdminGame1Broadcaster.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "admin-game1-namespace" });

/** Room-key-konvensjon: ett rom per gameId. */
function gameRoomKey(gameId: string): string {
  return `game1:${gameId}`;
}

export interface AdminGame1NamespaceDeps {
  io: SocketServer;
  platformService: PlatformService;
}

export interface AdminGame1NamespaceHandle {
  broadcaster: AdminGame1Broadcaster;
  namespace: Namespace;
}

/**
 * Registrer `/admin-game1`-namespacet og returner både namespace-referansen
 * (for test-introspection) og en broadcaster-port som service-laget bruker
 * for å pushe events.
 */
export function createAdminGame1Namespace(
  deps: AdminGame1NamespaceDeps
): AdminGame1NamespaceHandle {
  const { io, platformService } = deps;
  const namespace = io.of("/admin-game1");

  // JWT-handshake-auth: accessToken i socket.handshake.auth.token (eller
  // `.accessToken` for test-kompat). Må være GAME1_MASTER_WRITE.
  namespace.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth ?? {};
      const token =
        (typeof auth.token === "string" && auth.token) ||
        (typeof auth.accessToken === "string" && auth.accessToken) ||
        "";
      if (!token) {
        return next(new Error("UNAUTHORIZED"));
      }
      const user = await platformService.getUserFromAccessToken(token);
      assertAdminPermission(user.role, "GAME1_MASTER_WRITE");
      socket.data.user = user;
      return next();
    } catch (err) {
      log.debug(
        { err, code: (err as Record<string, unknown>).code },
        "admin-game1 handshake rejected"
      );
      const publicErr = toPublicError(err);
      const e = new Error(publicErr.message);
      (e as Error & { data?: unknown }).data = publicErr;
      return next(e);
    }
  });

  namespace.on("connection", (socket: Socket) => {
    const user = socket.data.user as PublicAppUser;
    log.debug({ userId: user?.id, role: user?.role }, "admin-game1 connected");

    socket.on(
      "game1:subscribe",
      (raw: unknown, ack?: (resp: { ok: boolean; error?: { code: string; message: string } }) => void) => {
        try {
          const parsed = Game1AdminSubscribePayloadSchema.safeParse(raw);
          if (!parsed.success) {
            throw new DomainError(
              "INVALID_INPUT",
              "Ugyldig payload for game1:subscribe."
            );
          }
          const { gameId } = parsed.data;
          socket.join(gameRoomKey(gameId));
          ack?.({ ok: true });
        } catch (err) {
          log.warn(
            { err, event: "game1:subscribe" },
            "admin subscribe failed"
          );
          ack?.({ ok: false, error: toPublicError(err) });
        }
      }
    );

    socket.on(
      "game1:unsubscribe",
      (raw: unknown, ack?: (resp: { ok: boolean; error?: { code: string; message: string } }) => void) => {
        try {
          const parsed = Game1AdminSubscribePayloadSchema.safeParse(raw);
          if (!parsed.success) {
            throw new DomainError(
              "INVALID_INPUT",
              "Ugyldig payload for game1:unsubscribe."
            );
          }
          socket.leave(gameRoomKey(parsed.data.gameId));
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: toPublicError(err) });
        }
      }
    );
  });

  const broadcaster: AdminGame1Broadcaster = {
    onStatusChange(event: AdminGame1StatusChangeEvent): void {
      try {
        const payload: Game1AdminStatusUpdatePayload = {
          gameId: event.gameId,
          status: event.status,
          action: event.action,
          auditId: event.auditId,
          actorUserId: event.actorUserId,
          at: event.at,
        };
        namespace
          .to(gameRoomKey(event.gameId))
          .emit("game1:status-update", payload);
      } catch (err) {
        log.warn(
          { err, event: "game1:status-update", gameId: event.gameId },
          "admin broadcast failed — service fortsetter uansett"
        );
      }
    },
    onDrawProgressed(event: AdminGame1DrawProgressedEvent): void {
      try {
        const payload: Game1AdminDrawProgressedPayload = {
          gameId: event.gameId,
          ballNumber: event.ballNumber,
          drawIndex: event.drawIndex,
          currentPhase: event.currentPhase,
          at: event.at,
        };
        namespace
          .to(gameRoomKey(event.gameId))
          .emit("game1:draw-progressed", payload);
      } catch (err) {
        log.warn(
          {
            err,
            event: "game1:draw-progressed",
            gameId: event.gameId,
          },
          "admin broadcast failed — service fortsetter uansett"
        );
      }
    },
    onPhaseWon(event: AdminGame1PhaseWonEvent): void {
      try {
        const payload: Game1AdminPhaseWonPayload = {
          gameId: event.gameId,
          patternName: event.patternName,
          phase: event.phase,
          winnerIds: event.winnerIds,
          winnerCount: event.winnerCount,
          drawIndex: event.drawIndex,
          at: event.at,
        };
        namespace
          .to(gameRoomKey(event.gameId))
          .emit("game1:phase-won", payload);
      } catch (err) {
        log.warn(
          { err, event: "game1:phase-won", gameId: event.gameId },
          "admin broadcast failed — service fortsetter uansett"
        );
      }
    },
    /**
     * PT4: fysisk-bong vinn-broadcast (én per bong). Bingovert-skjerm
     * bruker eventet for å varsle om at fysisk bong må kontrolleres før
     * kontant-utbetaling.
     */
    onPhysicalTicketWon(event: AdminGame1PhysicalTicketWonEvent): void {
      try {
        const payload: Game1AdminPhysicalTicketWonPayload = {
          gameId: event.gameId,
          phase: event.phase,
          patternName: event.patternName,
          pendingPayoutId: event.pendingPayoutId,
          ticketId: event.ticketId,
          hallId: event.hallId,
          responsibleUserId: event.responsibleUserId,
          expectedPayoutCents: event.expectedPayoutCents,
          color: event.color,
          adminApprovalRequired: event.adminApprovalRequired,
          at: event.at,
        };
        namespace
          .to(gameRoomKey(event.gameId))
          .emit("game1:physical-ticket-won", payload);
      } catch (err) {
        log.warn(
          {
            err,
            event: "game1:physical-ticket-won",
            gameId: event.gameId,
            ticketId: event.ticketId,
          },
          "admin broadcast failed — service fortsetter uansett"
        );
      }
    },
  };

  return { broadcaster, namespace };
}
