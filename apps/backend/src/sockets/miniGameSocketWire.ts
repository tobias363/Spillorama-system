/**
 * BIN-MYSTERY Gap D: socket-wire for Game 1 mini-games (alle 5: wheel, chest,
 * colordraft, oddsen, mystery).
 *
 * Problem som løses:
 *   Før denne PR-en var `Game1MiniGameOrchestrator.setBroadcaster()` aldri kalt
 *   i composition-root, slik at default `NoopMiniGameBroadcaster` var i bruk.
 *   Konsekvens: `mini_game:trigger`/`mini_game:result` ble aldri emittet til
 *   spiller-klient, og `mini_game:choice` ble aldri lyttet på server-siden.
 *
 * Design (matcher AdminGame1Broadcaster-mønsteret):
 *   - `createMiniGameSocketWire(io, orchestrator, platformService)` returnerer
 *     en `MiniGameBroadcaster` + en `register(socket)`-funksjon.
 *   - Broadcaster emitter til et user-private rom: `mini-game:user:<userId>`.
 *     Klienten joiner dette rommet idempotent ved `mini_game:join`-event etter
 *     auth (eller automatisk hvis auth-payload er gyldig). Ingen risiko for
 *     fan-out til feil bruker.
 *   - `mini_game:choice` lyttes i default-namespace:
 *       Klient → `{ accessToken, resultId, choice }` med ack-callback.
 *       Server validerer auth → kaller `orchestrator.handleChoice()` →
 *       returnerer resultatet via ack. Broadcasten av `mini_game:result` skjer
 *       internt i orchestrator.handleChoice → broadcaster.onResult.
 *   - Fail-safe: broadcaster wrapper i try/catch — feil her skal IKKE påvirke
 *     orchestrator-state (samme prinsipp som AdminGame1Broadcaster).
 *
 * Auth-modell:
 *   - Mini-games er per-vinner (én spiller per resultId). Klienten sender
 *     accessToken i `mini_game:join` + `mini_game:choice` payloads — samme
 *     mønster som eksisterende voucher/chat/claim-handlere.
 *   - `mini_game:choice` validerer at `socket.data.user.id === resultRow.winner_user_id`
 *     gjennom orchestrator.handleChoice (som har MINIGAME_NOT_OWNER-sjekk).
 *
 * Wireframe-paritet:
 *   Spiller-klient bygger på `mini_game:trigger { type, resultId, payload, ... }`
 *   for å vise mini-game-UI, og `mini_game:result { resultId, payoutCents,
 *   resultJson }` for å vise utfallet. Mellomstegget er `mini_game:choice`-emit
 *   med ack — alt er server-autoritativt (klient kan ikke spoofe payout).
 */

import type { Server as SocketServer, Socket } from "socket.io";
import type {
  Game1MiniGameOrchestrator,
  MiniGameBroadcaster,
  MiniGameTriggerBroadcast,
  MiniGameResultBroadcast,
} from "../game/minigames/Game1MiniGameOrchestrator.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { SocketRateLimiter } from "../middleware/socketRateLimit.js";
import { DomainError, toPublicError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "mini-game-socket-wire" });

/**
 * Bølge D Issue 1 (HØY): rate-limits for `mini_game:*`-events.
 *
 * Mini-games har wallet-impact (handleChoice → prize-payout via
 * Game1MiniGameOrchestrator). Uten rate-limit kan en spam-klient eller en
 * misbruks-account flomme orchestrator-flyten og trigge race-conditions
 * mot pending-payout-kontoen. Limits:
 *   - `mini_game:choice`: 5/s — matcher menneskelig interaksjons-rate
 *     (UI-knappetrykk på wheel/oddsen-direction-velg).
 *   - `mini_game:join`   : 2/s — join er idempotent men auth-tunge (DB-
 *     oppslag mot getUserFromAccessToken). 2/s tåler reconnect-storm
 *     uten å flomme platform-service.
 *
 * Begge kontrolleres BÅDE per-socket OG per-walletId (samme mønster som
 * gameEvents/context.ts BIN-247) slik at reconnect ikke nullstiller bucketet.
 */
export const MINI_GAME_RATE_LIMITS = {
  "mini_game:choice": { windowMs: 1_000, maxEvents: 5 },
  "mini_game:join":   { windowMs: 1_000, maxEvents: 2 },
} as const;

/**
 * Room-key-konvensjon: ett user-private rom per spiller. Mini-game-events er
 * private (kun vinneren skal motta dem), så vi bruker user-id som diskriminator.
 * Gir én emit per logget-inn-bruker uavhengig av antall enheter/socket-conns.
 */
function userRoomKey(userId: string): string {
  return `mini-game:user:${userId}`;
}

export interface MiniGameSocketWireDeps {
  io: SocketServer;
  orchestrator: Game1MiniGameOrchestrator;
  platformService: PlatformService;
  /**
   * Bølge D Issue 1: rate-limiter for `mini_game:*`-events. Optional så
   * eksisterende test-harnesses kan kjøre uten — handleren faller da
   * tilbake til "no rate-limit" (matcher tidligere adferd).
   *
   * Kallere i prod (composition-root) SKAL alltid gi en limiter slik at
   * spam-events blir avvist. Test-harnesses kan injisere en limiter med
   * relax-config (samme mønster som testServer.ts).
   */
  socketRateLimiter?: SocketRateLimiter;
}

export interface MiniGameSocketWireHandle {
  /** Broadcaster — skal kobles på orchestrator via setBroadcaster(). */
  broadcaster: MiniGameBroadcaster;
  /**
   * Per-socket registrering av `mini_game:choice` + `mini_game:join`-handlers.
   * Kalles fra `io.on("connection", socket => register(socket))` i
   * composition-root.
   */
  register(socket: Socket): void;
}

interface JoinPayload {
  accessToken?: unknown;
}

interface ChoicePayload {
  accessToken?: unknown;
  resultId?: unknown;
  choice?: unknown;
}

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Lager mini-game socket-wire: broadcaster (server → klient via user-rom)
 * + per-socket event-registreringer.
 *
 * Brukes i composition-root slik:
 *   const wire = createMiniGameSocketWire({ io, orchestrator, platformService });
 *   orchestrator.setBroadcaster(wire.broadcaster);
 *   io.on("connection", socket => wire.register(socket));
 */
export function createMiniGameSocketWire(
  deps: MiniGameSocketWireDeps
): MiniGameSocketWireHandle {
  const { io, orchestrator, platformService, socketRateLimiter } = deps;

  /**
   * Bølge D Issue 1: socket.id-bucket-sjekk (pre-auth-fase). Hvert event
   * teller ÉN gang i socket.id-bucketet — incrementeres ved første sjekk.
   * Returnerer false → handler skal avvise med RATE_LIMITED.
   */
  function checkRateLimitBySocket(socket: Socket, eventName: string): boolean {
    if (!socketRateLimiter) return true;
    return socketRateLimiter.check(socket.id, eventName);
  }

  /**
   * Bølge D Issue 1: walletId-bucket-sjekk (post-auth-fase). BIN-247-mønster:
   * en autentisert spiller skal ikke kunne bypass-e limit ved reconnect.
   * Returnerer false → handler skal avvise med RATE_LIMITED.
   *
   * NB: Denne kalles ETTER socket.id-checken har incrementert sin bucket,
   * så hvert event teller ÉN gang i hver bucket (ikke dobbelt-tellinger).
   */
  function checkRateLimitByWallet(socket: Socket, eventName: string): boolean {
    if (!socketRateLimiter) return true;
    const walletId = socket.data.user?.walletId;
    if (!walletId) return true;
    return socketRateLimiter.checkByKey(walletId, eventName);
  }

  const broadcaster: MiniGameBroadcaster = {
    onTrigger(event: MiniGameTriggerBroadcast): void {
      try {
        io.to(userRoomKey(event.winnerUserId)).emit("mini_game:trigger", {
          scheduledGameId: event.scheduledGameId,
          resultId: event.resultId,
          type: event.miniGameType,
          payload: event.payload,
          timeoutSeconds: event.timeoutSeconds,
        });
      } catch (err) {
        log.warn(
          {
            err,
            event: "mini_game:trigger",
            winnerUserId: event.winnerUserId,
            resultId: event.resultId,
          },
          "mini-game broadcast failed — orchestrator-state er intakt"
        );
      }
    },
    onResult(event: MiniGameResultBroadcast): void {
      try {
        io.to(userRoomKey(event.winnerUserId)).emit("mini_game:result", {
          scheduledGameId: event.scheduledGameId,
          resultId: event.resultId,
          type: event.miniGameType,
          payoutCents: event.payoutCents,
          resultJson: event.resultJson,
        });
      } catch (err) {
        log.warn(
          {
            err,
            event: "mini_game:result",
            winnerUserId: event.winnerUserId,
            resultId: event.resultId,
          },
          "mini-game broadcast failed — orchestrator-state er intakt"
        );
      }
    },
  };

  /**
   * Gjør auth fra payload og join user-private rom hvis ikke allerede joinet.
   * Returnerer `userId` for caller-validation.
   */
  async function authAndJoin(
    socket: Socket,
    payload: { accessToken?: unknown }
  ): Promise<string> {
    const token =
      typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
    if (!token) {
      throw new DomainError("UNAUTHORIZED", "accessToken er påkrevd.");
    }
    const user = await platformService.getUserFromAccessToken(token);
    socket.data.user = user;
    socket.join(userRoomKey(user.id));
    return user.id;
  }

  function register(socket: Socket): void {
    socket.on(
      "mini_game:join",
      async (
        rawPayload: JoinPayload,
        ack?: (resp: AckResponse<{ joined: true }>) => void
      ) => {
        try {
          // Bølge D Issue 1: rate-limit FØR auth-tunge platform-kall slik at
          // spam-clients ikke kan flomme getUserFromAccessToken. Sjekker
          // socket.id-bucket først (uavhengig av auth-status). Inkrementerer
          // bucket-en ÉN gang.
          if (!checkRateLimitBySocket(socket, "mini_game:join")) {
            throw new DomainError(
              "RATE_LIMITED",
              "For mange foresporsler. Vent litt."
            );
          }
          const userId = await authAndJoin(socket, rawPayload ?? {});
          // BIN-247: walletId-bucket overlever reconnect → en spam-bot kan
          // ikke bypass-e limit ved å koble til på nytt. Inkrementerer
          // bucket-en ÉN gang etter auth.
          if (!checkRateLimitByWallet(socket, "mini_game:join")) {
            throw new DomainError(
              "RATE_LIMITED",
              "For mange foresporsler. Vent litt."
            );
          }
          log.debug({ userId, socketId: socket.id }, "mini_game:join — joined room");
          ack?.({ ok: true, data: { joined: true } });
        } catch (err) {
          log.debug(
            { err, event: "mini_game:join", socketId: socket.id },
            "mini-game join rejected"
          );
          ack?.({ ok: false, error: toPublicError(err) });
        }
      }
    );

    socket.on(
      "mini_game:choice",
      async (
        rawPayload: ChoicePayload,
        ack?: (
          resp: AckResponse<{
            resultId: string;
            payoutCents: number;
            type: string;
            resultJson: Record<string, unknown>;
          }>
        ) => void
      ) => {
        try {
          // Bølge D Issue 1: rate-limit FØR orchestrator/handleChoice-arbeid.
          // Mini-games har wallet-impact (prize-payout) → spam må stoppes
          // før handleChoice for å unngå race mot pending-payout-tabellen.
          // Sjekker socket.id-bucket (pre-auth) og walletId-bucket (post-auth)
          // hver én gang — ingen dobbelt-tellinger.
          if (!checkRateLimitBySocket(socket, "mini_game:choice")) {
            throw new DomainError(
              "RATE_LIMITED",
              "For mange foresporsler. Vent litt."
            );
          }
          const payload = rawPayload ?? {};
          const userId = await authAndJoin(socket, payload);
          if (!checkRateLimitByWallet(socket, "mini_game:choice")) {
            throw new DomainError(
              "RATE_LIMITED",
              "For mange foresporsler. Vent litt."
            );
          }

          const resultId =
            typeof payload.resultId === "string" ? payload.resultId.trim() : "";
          if (!resultId) {
            throw new DomainError("INVALID_INPUT", "resultId er påkrevd.");
          }
          const choice =
            payload.choice && typeof payload.choice === "object"
              ? (payload.choice as Record<string, unknown>)
              : null;
          if (!choice) {
            throw new DomainError("INVALID_INPUT", "choice må være et objekt.");
          }

          const result = await orchestrator.handleChoice({
            resultId,
            userId,
            choiceJson: choice,
          });

          ack?.({
            ok: true,
            data: {
              resultId: result.resultId,
              payoutCents: result.payoutCents,
              type: result.miniGameType,
              resultJson: result.resultJson as Record<string, unknown>,
            },
          });
        } catch (err) {
          log.debug(
            { err, event: "mini_game:choice", socketId: socket.id },
            "mini-game choice rejected"
          );
          ack?.({ ok: false, error: toPublicError(err) });
        }
      }
    );
  }

  return { broadcaster, register };
}
