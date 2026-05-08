/**
 * Spill 1 lobby-rom socket-events (2026-05-08, Tobias-direktiv).
 *
 * Bakgrunn:
 *   Klient subscriber til "lobby-rom" per hall ved hall-valg. Lobby-rom-en
 *   eksisterer uavhengig av om master har spawnet en runde — den lever
 *   så lenge `now ∈ [plan.startTime, plan.endTime]`. Når master starter
 *   en runde broadcaster server `lobby:state-update` så klient kan flytte
 *   over til runde-modus.
 *
 * Socket.IO-rom: `spill1:lobby:{hallId}`. Server broadcaster:
 *   - `lobby:state-update` ved scheduled-game status-overganger
 *     (`purchase_open` → `ready_to_start` → `running` → `finished`).
 *
 * Klient-events:
 *   - `spill1:lobby:subscribe` { hallId } → ack { ok, lobbyState }
 *   - `spill1:lobby:unsubscribe` { hallId } → ack { ok }
 *
 * Auth: ingen krav. Lobby-state er public read-only — vi lar uautentiserte
 * klienter subscribe så de kan se "Stengt"-state før login.
 *
 * Rate-limit: subscribes telles via `socketRateLimiter` for å unngå
 * connection-spam.
 *
 * Server → klient broadcast-shape:
 *   ```
 *   { hallId, state: Spill1LobbyState }
 *   ```
 *
 * Av-stilte broadcasts emit-es av `Game1MasterControlService` /
 * `GamePlanRunService` ved status-overganger (krever wireup i Phase 2 —
 * denne første implementeringen leverer kun subscribe/unsubscribe slik at
 * klient kan begynne å motta events når wireup lander).
 */

import type { Server, Socket } from "socket.io";

import { DomainError } from "../errors/DomainError.js";
import type { Game1LobbyService } from "../game/Game1LobbyService.js";
import type { SocketRateLimiter } from "../middleware/socketRateLimit.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "spill1-lobby-events" });

export interface Spill1LobbyEventsDeps {
  io: Server;
  lobbyService: Game1LobbyService;
  socketRateLimiter: SocketRateLimiter;
}

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/** Bygg rom-navn for hall — sentralisert så broadcasters bruker samme nøkkel. */
export function spill1LobbyRoomName(hallId: string): string {
  return `spill1:lobby:${hallId}`;
}

/**
 * Broadcast lobby-state-update til alle klienter som har subscribed til
 * hallens lobby-rom. Eksportert som named function så øvrige moduler
 * (Game1MasterControlService, GamePlanRunService) kan ringe når master-
 * handlinger endrer state.
 *
 * Best-effort: feiler aldri, kun logger warnings. Lobby-broadcasts er
 * UI-hint, ikke critical state — klient poller endepunktet hvert 10s
 * uansett.
 */
export function broadcastLobbyStateUpdate(
  io: Server,
  hallId: string,
  state: unknown,
): void {
  try {
    io.to(spill1LobbyRoomName(hallId)).emit("lobby:state-update", {
      hallId,
      state,
    });
  } catch (err) {
    log.warn({ err, hallId }, "[lobby] broadcastLobbyStateUpdate feilet");
  }
}

export function createSpill1LobbyEventHandlers(deps: Spill1LobbyEventsDeps) {
  const { lobbyService, socketRateLimiter } = deps;

  function ackSuccess<T>(
    callback: ((response: AckResponse<T>) => void) | undefined,
    data: T,
  ): void {
    if (typeof callback === "function") callback({ ok: true, data });
  }

  function ackFailure<T>(
    callback: ((response: AckResponse<T>) => void) | undefined,
    code: string,
    message: string,
  ): void {
    if (typeof callback === "function") {
      callback({ ok: false, error: { code, message } });
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function readHallId(payload: unknown): string {
    if (!isRecord(payload)) {
      throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
    }
    const raw = payload.hallId;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    }
    return raw.trim();
  }

  return function registerHandlers(socket: Socket): void {
    socket.on(
      "spill1:lobby:subscribe",
      async (
        raw: unknown,
        callback?: (response: AckResponse<{ state: unknown }>) => void,
      ) => {
        try {
          if (!socketRateLimiter.check(socket.id, "spill1:lobby:subscribe")) {
            ackFailure(
              callback,
              "RATE_LIMITED",
              "For mange foresporsler. Vent litt.",
            );
            return;
          }
          const hallId = readHallId(raw);
          const room = spill1LobbyRoomName(hallId);
          await socket.join(room);
          // Returner umiddelbart en current snapshot så klient ikke trenger
          // en separat HTTP-fetch ved subscribe (sparer en round-trip).
          // Hvis getLobbyState feiler returnerer vi success uten state —
          // klient kan polle HTTP-endepunktet for å hente initial state.
          let state: unknown = null;
          try {
            state = await lobbyService.getLobbyState(hallId);
          } catch (err) {
            log.warn(
              { err, hallId },
              "[lobby] subscribe: getLobbyState feilet — returnerer subscribe uten state",
            );
          }
          ackSuccess(callback, { state });
        } catch (err) {
          if (err instanceof DomainError) {
            ackFailure(callback, err.code, err.message);
          } else {
            log.warn({ err }, "[lobby] subscribe-handler kastet uventet feil");
            ackFailure(callback, "INTERNAL_ERROR", "Kunne ikke subscribe.");
          }
        }
      },
    );

    socket.on(
      "spill1:lobby:unsubscribe",
      async (
        raw: unknown,
        callback?: (response: AckResponse<{ unsubscribed: true }>) => void,
      ) => {
        try {
          const hallId = readHallId(raw);
          const room = spill1LobbyRoomName(hallId);
          await socket.leave(room);
          ackSuccess(callback, { unsubscribed: true });
        } catch (err) {
          if (err instanceof DomainError) {
            ackFailure(callback, err.code, err.message);
          } else {
            log.warn({ err }, "[lobby] unsubscribe-handler kastet uventet feil");
            ackFailure(callback, "INTERNAL_ERROR", "Kunne ikke unsubscribe.");
          }
        }
      },
    );
  };
}
