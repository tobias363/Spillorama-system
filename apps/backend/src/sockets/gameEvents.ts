/**
 * PR-R4: fasade for socket-event-handlerne.
 *
 * Denne filen er igang med å splittes per event-cluster under
 * `sockets/gameEvents/`. Offentlige eksporter (`createGameEventHandlers`,
 * `GameEventsDeps`, `BingoSchedulerSettings`, `emitG3DrawEvents`) bevares
 * for bakoverkompatibilitet — eksisterende importer i
 * `apps/backend/src/index.ts` og `__tests__/` påvirkes ikke.
 */
import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import {
  ClaimSubmitPayloadSchema,
  TicketReplacePayloadSchema,
  TicketSwapPayloadSchema,
  TicketCancelPayloadSchema,
} from "@spillorama/shared-types/socket-events";
import { DomainError, toPublicError } from "./../game/BingoEngine.js";
import { addBreadcrumb } from "./../observability/sentry.js";
import { metrics as promMetrics } from "./../util/metrics.js";
import { Game2Engine } from "./../game/Game2Engine.js";
import { Game3Engine } from "./../game/Game3Engine.js";
import type { RoomSnapshot } from "./../game/types.js";
import {
  mustBeNonEmptyString,
  parseOptionalNonNegativeNumber,
  parseTicketsPerPlayerInput,
} from "./../util/httpHelpers.js";
import { assertTicketsPerPlayerWithinHallLimit } from "./../game/compliance.js";
import { buildRegistryContext, buildSocketContext } from "./gameEvents/context.js";
import { emitG2DrawEvents, emitG3DrawEvents } from "./gameEvents/drawEmits.js";
import type {
  AckResponse,
  ChatMessage,
  ChatSendPayload,
  ClaimPayload,
  ConfigureRoomPayload,
  CreateRoomPayload,
  EndGamePayload,
  ExtraDrawPayload,
  JoinRoomPayload,
  LeaderboardEntry,
  LeaderboardPayload,
  LuckyNumberPayload,
  MarkPayload,
  ResumeRoomPayload,
  RoomActionPayload,
  RoomStatePayload,
  StartGamePayload,
} from "./gameEvents/types.js";
import type { BingoSchedulerSettings, GameEventsDeps } from "./gameEvents/deps.js";

export { emitG3DrawEvents } from "./gameEvents/drawEmits.js";
export type { BingoSchedulerSettings, GameEventsDeps } from "./gameEvents/deps.js";

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGameEventHandlers(deps: GameEventsDeps) {
  const ctx = buildRegistryContext(deps);
  const {
    engine,
    platformService,
    io,
    logger,
    ackSuccess,
    ackFailure,
    appendChatMessage,
    setLuckyNumber,
    getAuthenticatedSocketUser,
    assertUserCanAccessRoom,
  } = ctx;
  const {
    socketRateLimiter: _socketRateLimiter,
    emitRoomUpdate,
    buildRoomUpdatePayload,
    enforceSingleRoomPerHall,
    runtimeBingoSettings,
    chatHistoryByRoom,
    getPrimaryRoomForHall,
    findPlayerInRoomByWallet,
    getRoomConfiguredEntryFee,
    getArmedPlayerIds,
    armPlayer,
    disarmPlayer,
    disarmAllPlayers,
    clearDisplayTicketCache,
    resolveBingoHallGameConfigForRoom,
    buildLeaderboard,
  } = deps;

  return function registerGameEvents(socket: Socket): void {
    const sctx = buildSocketContext(socket, ctx);
    const { rateLimited, requireAuthenticatedPlayerAction, resolveIdentityFromPayload } = sctx;

    socket.on("room:create", rateLimited("room:create", async (payload: CreateRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
      logger.debug({ hallId: payload?.hallId, hasAccessToken: !!payload?.accessToken }, "BIN-134: room:create received");
      try {
        const identity = await resolveIdentityFromPayload(payload);
        logger.debug({ hallId: identity.hallId }, "BIN-134: room:create identity resolved");
        if (enforceSingleRoomPerHall) {
          const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
          if (canonicalRoom) {
            const canonicalSnapshot = engine.getRoomSnapshot(canonicalRoom.code);
            const existingPlayer = findPlayerInRoomByWallet(canonicalSnapshot, identity.walletId);

            let playerId = existingPlayer?.id ?? "";
            if (existingPlayer) {
              engine.attachPlayerSocket(canonicalRoom.code, existingPlayer.id, socket.id);
            } else {
              const joined = await engine.joinRoom({
                roomCode: canonicalRoom.code,
                hallId: identity.hallId,
                playerName: identity.playerName,
                walletId: identity.walletId,
                socketId: socket.id
              });
              playerId = joined.playerId;
            }

            socket.join(canonicalRoom.code);
            const snapshot = await emitRoomUpdate(canonicalRoom.code);
            logger.debug({ roomCode: canonicalRoom.code }, "BIN-134: room:create → existing canonical");
            ackSuccess(callback, { roomCode: canonicalRoom.code, playerId, snapshot });
            return;
          }
        }

        const requestedGameSlug = typeof payload?.gameSlug === "string" ? payload.gameSlug : undefined;
        const { roomCode, playerId } = await engine.createRoom({
          playerName: identity.playerName,
          hallId: identity.hallId,
          walletId: identity.walletId,
          socketId: socket.id,
          // BIN-134: Use "BINGO1" as actual room code so SPA alias = real code
          roomCode: enforceSingleRoomPerHall ? "BINGO1" : undefined,
          gameSlug: requestedGameSlug
        });
        // BIN-694: wire DEFAULT variantConfig (5-fase Norsk bingo for Game 1)
        // immediately after room-creation. Before this, `setVariantConfig`
        // was only called in tests — production rooms had no variant bound,
        // so `meetsPhaseRequirement` fell back to the legacy 1-line rule and
        // triggered every LINE phase on the first completed row. Defaulting
        // the gameSlug to "bingo" matches `BingoEngine.createRoom` which
        // does the same fallback on RoomState.gameSlug.
        // PR C: foretrekk den nye async-binderen som kan lese admin-config
        // fra GameManagement når `gameManagementId` er tilgjengelig. I dag
        // sender ingen caller ID-en — faller gjennom til default-path.
        if (deps.bindVariantConfigForRoom) {
          await deps.bindVariantConfigForRoom(roomCode, {
            gameSlug: requestedGameSlug?.trim() || "bingo",
          });
        } else {
          deps.bindDefaultVariantConfig?.(roomCode, requestedGameSlug?.trim() || "bingo");
        }
        socket.join(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        logger.debug({ roomCode }, "BIN-134: room:create SUCCESS");
        ackSuccess(callback, { roomCode, playerId, snapshot });
      } catch (error) {
        logger.error({ err: error, code: (error as Record<string, unknown>).code }, "BIN-134: room:create FAILED");
        ackFailure(callback, error);
      }
    }));

    socket.on("room:join", rateLimited("room:join", async (payload: JoinRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
      try {
        let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();
        const identity = await resolveIdentityFromPayload(payload);
        if (enforceSingleRoomPerHall) {
          // BIN-134: resolve BINGO1 alias
          if (roomCode === "BINGO1") {
            const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
            if (canonicalRoom) {
              roomCode = canonicalRoom.code;
            } else {
              // Auto-create room for this hall if none exists
              logger.debug({ hallId: identity.hallId }, "room:join auto-creating room for hall");
              const newRoom = await engine.createRoom({
                hallId: identity.hallId,
                playerName: identity.playerName,
                walletId: identity.walletId,
                socketId: socket.id,
              });
              roomCode = newRoom.roomCode;
              // BIN-694 + PR C: wire variantConfig for the auto-created room.
              // Uses new async binder if available (forbereder admin-config
              // wire-up), falls back til default-binder ellers.
              if (deps.bindVariantConfigForRoom) {
                await deps.bindVariantConfigForRoom(roomCode, { gameSlug: "bingo" });
              } else {
                deps.bindDefaultVariantConfig?.(roomCode, "bingo");
              }
            }
          }
          const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
          if (canonicalRoom && canonicalRoom.code !== roomCode) {
            throw new DomainError(
              "SINGLE_ROOM_ONLY",
              `Kun ett bingo-rom er aktivt per hall. Bruk rom ${canonicalRoom.code}.`
            );
          }
        }

        const roomSnapshot = engine.getRoomSnapshot(roomCode);
        const existingPlayer = findPlayerInRoomByWallet(roomSnapshot, identity.walletId);
        if (existingPlayer) {
          engine.attachPlayerSocket(roomCode, existingPlayer.id, socket.id);
          socket.join(roomCode);
          const snapshot = await emitRoomUpdate(roomCode);
          ackSuccess(callback, { roomCode, playerId: existingPlayer.id, snapshot });
          return;
        }

        const { playerId } = await engine.joinRoom({
          roomCode,
          hallId: identity.hallId,
          playerName: identity.playerName,
          walletId: identity.walletId,
          socketId: socket.id
        });
        socket.join(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { roomCode, playerId, snapshot });
      } catch (error) {
        console.error("[room:join] FAILED:", toPublicError(error));
        ackFailure(callback, error);
      }
    }));

    socket.on("room:resume", rateLimited("room:resume", async (payload: ResumeRoomPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        engine.attachPlayerSocket(roomCode, playerId, socket.id);
        socket.join(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("room:configure", rateLimited("room:configure", async (
      payload: ConfigureRoomPayload,
      callback: (response: AckResponse<{ snapshot: RoomSnapshot; entryFee: number }>) => void
    ) => {
      try {
        const { roomCode } = await requireAuthenticatedPlayerAction(payload);
        engine.getRoomSnapshot(roomCode);

        const requestedEntryFee = parseOptionalNonNegativeNumber(payload?.entryFee, "entryFee");
        if (requestedEntryFee === undefined) {
          throw new DomainError("INVALID_INPUT", "entryFee må oppgis.");
        }

        // setRoomConfiguredEntryFee
        const normalized = Math.max(0, Math.round(requestedEntryFee * 100) / 100);
        deps.roomConfiguredEntryFeeByRoom.set(roomCode, normalized);
        const entryFee = normalized;

        const updatedSnapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot: updatedSnapshot, entryFee });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("room:state", rateLimited("room:state", async (payload: RoomStatePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const user = await getAuthenticatedSocketUser(payload);
        let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();

        // BIN-134: SPA sends "BINGO1" as canonical room code.
        // Map it to the actual canonical room for the hall.
        if (roomCode === "BINGO1" && enforceSingleRoomPerHall) {
          const hallId = (payload as unknown as Record<string, unknown>)?.hallId || "default-hall";
          const canonicalRoom = getPrimaryRoomForHall(hallId as string);
          if (canonicalRoom) {
            roomCode = canonicalRoom.code;
            logger.debug({ roomCode }, "BIN-134: room:state BINGO1 → canonical room");
          }
          // If no canonical room exists, fall through — ROOM_NOT_FOUND triggers SPA auto-create
        }

        assertUserCanAccessRoom(user, roomCode);
        const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("bet:arm", rateLimited("bet:arm", async (
      payload: RoomActionPayload & { armed?: boolean; ticketCount?: number; ticketSelections?: Array<{ type: string; qty: number; name?: string }> },
      callback: (response: AckResponse<{ snapshot: RoomSnapshot; armed: boolean }>) => void
    ) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const wantArmed = payload.armed !== false;
        if (wantArmed) {
          // New path: per-type selections
          if (Array.isArray(payload.ticketSelections) && payload.ticketSelections.length > 0) {
            // BIN-688: preserve `name` so pre-round tickets can be coloured
            // per the player's specific pick (Small Yellow vs Small Purple
            // both have type="small").
            const selections = payload.ticketSelections
              .filter((s) => s && typeof s.type === "string" && typeof s.qty === "number" && s.qty > 0)
              .map((s) => ({
                type: s.type,
                qty: Math.max(1, Math.round(s.qty)),
                ...(typeof s.name === "string" && s.name.length > 0 ? { name: s.name } : {}),
              }));

            if (selections.length === 0) {
              throw new DomainError("INVALID_INPUT", "Ingen gyldige billettvalg.");
            }

            // Additive arm: each bet:arm call MERGES the new selections into
            // the player's existing armed set. Reductions happen via `ticket:cancel`
            // (× on individual brett). Product decision 2026-04-20 — the buy
            // popup opens at qty=0 on every re-open, so replace-semantics would
            // mean re-armed brett vanish every time the player clicks Kjøp.
            const existing = deps.getArmedPlayerSelections(roomCode)?.[playerId] ?? [];
            const merged: Array<{ type: string; qty: number; name?: string }> = existing.map((s) => ({
              type: s.type,
              qty: s.qty,
              ...(s.name ? { name: s.name } : {}),
            }));
            for (const incoming of selections) {
              const matchIdx = merged.findIndex((m) =>
                m.type === incoming.type && (m.name ?? null) === (incoming.name ?? null),
              );
              if (matchIdx >= 0) {
                merged[matchIdx] = { ...merged[matchIdx], qty: merged[matchIdx].qty + incoming.qty };
              } else {
                merged.push(incoming);
              }
            }

            // Validate combined total weighted count <= 30.
            const variantInfo = deps.getVariantConfig?.(roomCode);
            const ticketTypes = variantInfo?.config?.ticketTypes ?? [];
            let totalWeighted = 0;
            for (const sel of merged) {
              // BIN-693 lesson: prefer name-match for weight resolution too —
              // two small-typed entries with different names share a weight of
              // 1, but for Large/Elvis (same type, distinct names) the weight
              // lives on the matching row, not the first one.
              const tt =
                (sel.name ? ticketTypes.find((t) => t.name === sel.name) : undefined) ??
                ticketTypes.find((t) => t.type === sel.type);
              const weight = tt?.ticketCount ?? 1;
              totalWeighted += sel.qty * weight;
            }
            if (totalWeighted > 30) {
              throw new DomainError(
                "INVALID_INPUT",
                `Totalt antall brett (${totalWeighted}) overstiger maks 30.`,
              );
            }
            if (totalWeighted < 1) {
              throw new DomainError("INVALID_INPUT", "Du må velge minst 1 brett.");
            }
            armPlayer(roomCode, playerId, totalWeighted, merged);
          } else {
            // Backward compat: flat ticketCount
            const ticketCount = Math.min(30, Math.max(1, Math.round(payload.ticketCount ?? 1)));
            armPlayer(roomCode, playerId, ticketCount);
          }
        } else {
          disarmPlayer(roomCode, playerId);
        }
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot, armed: wantArmed });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("game:start", rateLimited("game:start", async (payload: StartGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const requestedTicketsPerPlayer =
          payload?.ticketsPerPlayer === undefined || payload?.ticketsPerPlayer === null
            ? undefined
            : parseTicketsPerPlayerInput(payload.ticketsPerPlayer);
        const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
        const ticketsPerPlayer =
          requestedTicketsPerPlayer ??
          Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeBingoSettings.autoRoundTicketsPerPlayer);
        assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
        const variantInfo = deps.getVariantConfig?.(roomCode);
        // BIN-690: snapshot the display-ticket cache BEFORE startGame so
        // we can pass it in — the cache is cleared below, and startGame
        // itself pushes `emitRoomUpdate` which would re-populate the
        // cache with new random grids if we read it after.
        const preRoundTicketsByPlayerId = deps.getPreRoundTicketsByPlayerId?.(roomCode);
        await engine.startGame({
          roomCode,
          actorPlayerId: playerId,
          entryFee: payload?.entryFee ?? getRoomConfiguredEntryFee(roomCode),
          ticketsPerPlayer,
          payoutPercent: runtimeBingoSettings.payoutPercent,
          armedPlayerIds: getArmedPlayerIds(roomCode),
          armedPlayerTicketCounts: deps.getArmedPlayerTicketCounts(roomCode),
          armedPlayerSelections: deps.getArmedPlayerSelections(roomCode),
          gameType: variantInfo?.gameType,
          variantConfig: variantInfo?.config,
          preRoundTicketsByPlayerId,
        });
        disarmAllPlayers(roomCode);
        clearDisplayTicketCache(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("game:end", rateLimited("game:end", async (payload: EndGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        await engine.endGame({
          roomCode,
          actorPlayerId: playerId,
          reason: payload?.reason
        });
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("draw:next", rateLimited("draw:next", async (payload: RoomActionPayload, callback: (response: AckResponse<{ number: number; snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);

        // BIN-694: snapshot won-pattern-ids BEFORE draw so we can emit
        // `pattern:won` for each phase auto-claim committed during
        // `drawNextNumber` → `evaluateActivePhase`. Without this emit,
        // clients would only see the new isWon=true via the next
        // room:update — no dedicated event to trigger toast / animation.
        const beforeSnap = engine.getRoomSnapshot(roomCode);
        const wonBefore = new Set(
          (beforeSnap.currentGame?.patternResults ?? [])
            .filter((r) => r.isWon)
            .map((r) => r.patternId),
        );

        const { number, drawIndex, gameId } = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
        io.to(roomCode).emit("draw:new", { number, drawIndex, gameId });

        // BIN-694: emit pattern:won for every phase the draw just closed.
        // BIN-696: include winnerIds + winnerCount for multi-winner popup.
        const afterSnap = engine.getRoomSnapshot(roomCode);
        const afterResults = afterSnap.currentGame?.patternResults ?? [];
        for (const r of afterResults) {
          if (r.isWon && !wonBefore.has(r.patternId)) {
            const winnerIds = r.winnerIds ?? (r.winnerId ? [r.winnerId] : []);
            io.to(roomCode).emit("pattern:won", {
              patternId: r.patternId,
              patternName: r.patternName,
              winnerId: r.winnerId,
              wonAtDraw: r.wonAtDraw,
              payoutAmount: r.payoutAmount,
              claimType: r.claimType,
              gameId: afterSnap.currentGame?.id,
              winnerIds,
              winnerCount: winnerIds.length,
            });
          }
        }

        // BIN-615 / PR-C2: emit Game 2 wire events for any G2 draw effects
        // stashed by Game2Engine.onDrawCompleted. No-op for non-G2 rooms.
        if (engine instanceof Game2Engine) {
          const effects = engine.getG2LastDrawEffects(roomCode);
          if (effects) emitG2DrawEvents(io, effects);
        }
        // BIN-615 / PR-C3b: emit Game 3 wire events for any G3 draw effects
        // stashed by Game3Engine.onDrawCompleted. No-op for non-G3 rooms.
        // Game2Engine and Game3Engine are sibling subclasses of BingoEngine
        // — each `instanceof` branch matches exactly one engine type, and
        // the engine concretely instantiated for a room determines which
        // stash can be non-empty.
        if (engine instanceof Game3Engine) {
          const g3Effects = engine.getG3LastDrawEffects(roomCode);
          if (g3Effects) emitG3DrawEvents(io, g3Effects);
        }

        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { number, snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("draw:extra:purchase", rateLimited("draw:extra:purchase", async (payload: ExtraDrawPayload, callback: (response: AckResponse<{ denied: true }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        engine.rejectExtraDrawPurchase({
          source: "SOCKET",
          roomCode,
          playerId,
          metadata: {
            requestedCount:
              payload?.requestedCount === undefined ? undefined : Number(payload.requestedCount),
            packageId: typeof payload?.packageId === "string" ? payload.packageId : undefined
          }
        });
        ackSuccess(callback, { denied: true });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // BIN-499: ticket:mark is high-frequency. Room-fanout scaled as O(players × marks);
    // at 1000 players × 15 tickets × 20 marks/round = 300k full-snapshot broadcasts per
    // round. Since engine.markNumber does not auto-submit claims, a mark never changes
    // shared room state observable to other players — so the room-fanout is pure waste.
    //
    // New behavior:
    //   - Update the player's marks (engine.markNumber).
    //   - Send a private ticket:marked event to this socket only (optimistic UI hook).
    //   - No room-fanout. Claims (LINE/BINGO) still fanout via the claim:submit handler.
    socket.on("ticket:mark", rateLimited("ticket:mark", async (payload: MarkPayload, callback: (response: AckResponse<{ number: number; playerId: string }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        if (!Number.isFinite(payload?.number)) {
          throw new DomainError("INVALID_INPUT", "number mangler.");
        }
        const number = Number(payload.number);
        await engine.markNumber({ roomCode, playerId, number });
        // Private ack event — no room-fanout.
        socket.emit("ticket:marked", { roomCode, playerId, number });
        ackSuccess(callback, { number, playerId });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // BIN-509: ticket:replace — pre-round swap of a single display ticket,
    // charging gameVariant.replaceAmount. Runtime-validated via Zod (BIN-545).
    // The engine gates on GAME_RUNNING and INSUFFICIENT_FUNDS; the handler
    // looks up the replacement amount from variant config and does the cache
    // swap after the wallet debit succeeds.
    socket.on("ticket:replace", rateLimited("ticket:replace", async (payload: unknown, callback: (response: AckResponse<{ ticketId: string; debitedAmount: number }>) => void) => {
      try {
        const parsed = TicketReplacePayloadSchema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first?.path.join(".") || "payload";
          throw new DomainError("INVALID_INPUT", `ticket:replace payload invalid (${field}: ${first?.message ?? "unknown"}).`);
        }
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
        const ticketId = parsed.data.ticketId;

        // Resolve replaceAmount from the room's active variant config.
        const variantInfo = deps.getVariantConfig?.(roomCode);
        const replaceAmount = variantInfo?.config.replaceAmount ?? 0;
        if (!(replaceAmount > 0)) {
          throw new DomainError("REPLACE_NOT_ALLOWED", "Denne varianten støtter ikke billettbytte.");
        }

        // Idempotency: (room, player, ticket) is the natural key. A retried
        // request with the same ticketId produces the same ledger entry.
        const idempotencyKey = `ticket-replace-${roomCode}-${playerId}-${ticketId}`;
        const { debitedAmount } = await engine.chargeTicketReplacement(
          roomCode,
          playerId,
          replaceAmount,
          idempotencyKey,
        );

        // Swap the display ticket in place only after the charge succeeds.
        const snapshot = engine.getRoomSnapshot(roomCode);
        const newTicket = deps.replaceDisplayTicket?.(roomCode, playerId, ticketId, snapshot.gameSlug) ?? null;
        if (!newTicket) {
          // The player's id is authenticated and the charge already went
          // through, but the cache doesn't know about this ticketId. That's a
          // client bug — report it, don't silently swallow.
          throw new DomainError("TICKET_NOT_FOUND", `Ingen pre-round billett med id=${ticketId}.`);
        }

        await emitRoomUpdate(roomCode);
        ackSuccess(callback, { ticketId, debitedAmount });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // BIN-585: ticket:swap — free pre-round ticket swap for Game 5 (Spillorama).
    // Shares the display-cache mechanic with ticket:replace but skips the wallet
    // debit — Game 5 tickets are slot-style cosmetic, so legacy gives a free
    // re-roll in the Waiting phase. Gated by gameSlug === "spillorama" so paid
    // games continue to use ticket:replace; relaxing the gate later is a
    // one-line change if product wants free swap in other variants.
    socket.on("ticket:swap", rateLimited("ticket:swap", async (payload: unknown, callback: (response: AckResponse<{ ticketId: string }>) => void) => {
      try {
        const parsed = TicketSwapPayloadSchema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first?.path.join(".") || "payload";
          throw new DomainError("INVALID_INPUT", `ticket:swap payload invalid (${field}: ${first?.message ?? "unknown"}).`);
        }
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
        const ticketId = parsed.data.ticketId;

        const snapshot = engine.getRoomSnapshot(roomCode);
        if (snapshot.currentGame?.status === "RUNNING") {
          throw new DomainError("GAME_RUNNING", "Kan ikke bytte billett mens spillet pågår.");
        }
        if (snapshot.gameSlug !== "spillorama") {
          throw new DomainError("SWAP_NOT_ALLOWED", "Gratis billettbytte er kun tilgjengelig i Spillorama.");
        }

        const newTicket = deps.replaceDisplayTicket?.(roomCode, playerId, ticketId, snapshot.gameSlug) ?? null;
        if (!newTicket) {
          throw new DomainError("TICKET_NOT_FOUND", `Ingen pre-round billett med id=${ticketId}.`);
        }

        await emitRoomUpdate(roomCode);
        ackSuccess(callback, { ticketId });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // BIN-692: ticket:cancel — remove a single pre-round ticket (or its
    // whole bundle, for Large/Elvis/Traffic-light types). Pre-round arm
    // is not yet debited, so cancellation is free — no wallet operation.
    //
    // gives the player an in-place × on each ticket that removes the
    // bundle and disarms when the last bundle is dropped.
    socket.on("ticket:cancel", rateLimited("ticket:cancel", async (payload: unknown, callback: (response: AckResponse<{ removedTicketIds: string[]; remainingTicketCount: number; fullyDisarmed: boolean }>) => void) => {
      try {
        const parsed = TicketCancelPayloadSchema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first?.path.join(".") || "payload";
          throw new DomainError("INVALID_INPUT", `ticket:cancel payload invalid (${field}: ${first?.message ?? "unknown"}).`);
        }
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
        const ticketId = parsed.data.ticketId;

        // Gate: never permitted while the round is RUNNING. Cancelling
        // mid-round would require refunding real money already debited
        // at game:start — product decision (Tobias, 2026-04-20) is to
        // forbid it entirely. "Avbestill bonger" cancel-all has the same
        // gate implicitly (disarm is a no-op under RUNNING).
        const snapshot = engine.getRoomSnapshot(roomCode);
        if (snapshot.currentGame?.status === "RUNNING") {
          throw new DomainError("GAME_RUNNING", "Kan ikke avbestille brett mens runden pågår.");
        }

        if (!deps.cancelPreRoundTicket) {
          throw new DomainError("NOT_SUPPORTED", "ticket:cancel ikke konfigurert på serveren.");
        }

        // In production `deps.getVariantConfig` is backed by the engine and
        // always returns a config (default-standard fallback before startGame).
        // The null-branch only fires when a test harness leaves the dep
        // unwired, or from a future regression that drops the fallback.
        // In production `deps.getVariantConfig` is backed by the engine and
        // always returns a config (default-standard fallback before startGame).
        // The null-branch only fires when a test harness leaves the dep
        // unwired, or from a future regression that drops the fallback.
        const variantInfo = deps.getVariantConfig?.(roomCode);
        if (!variantInfo) {
          throw new DomainError("NOT_SUPPORTED", "Ingen variant-config for rommet.");
        }

        const result = deps.cancelPreRoundTicket(
          roomCode,
          playerId,
          ticketId,
          variantInfo.config,
        );
        if (!result) {
          throw new DomainError("TICKET_NOT_FOUND", `Ingen pre-round billett med id=${ticketId}.`);
        }

        await emitRoomUpdate(roomCode);
        ackSuccess(callback, result);
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("claim:submit", rateLimited("claim:submit", async (payload: ClaimPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        // BIN-545: runtime-validate the incoming claim:submit payload against the
        // shared-types Zod schema. `roomCode` and `type` must be present and
        // well-typed before we let the engine act.
        const parsed = ClaimSubmitPayloadSchema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first?.path.join(".") || "payload";
          throw new DomainError("INVALID_INPUT", `claim:submit payload invalid (${field}: ${first?.message ?? "unknown"}).`);
        }
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
        const claim = await engine.submitClaim({
          roomCode,
          playerId,
          type: parsed.data.type
        });
        const snapshot = await emitRoomUpdate(roomCode);
        // BIN-539: Record the claim + payout so operator dashboards can
        // correlate wallet movement with in-game state. `hallId` is taken
        // from the room snapshot because `snapshot.hallId` is the canonical
        // source of truth (client-claimed hall is untrusted).
        const gameLabel = snapshot.gameSlug ?? "unknown";
        const hallLabel = snapshot.hallId ?? "unknown";
        promMetrics.claimSubmitted.inc({ game: gameLabel, hall: hallLabel, type: parsed.data.type });
        if (claim.valid && typeof claim.payoutAmount === "number" && claim.payoutAmount > 0) {
          promMetrics.payoutAmount.observe(
            { game: gameLabel, hall: hallLabel, type: parsed.data.type },
            claim.payoutAmount,
          );
        }
        addBreadcrumb("claim:submit", {
          game: gameLabel,
          hall: hallLabel,
          type: parsed.data.type,
          valid: claim.valid,
          payoutAmount: claim.payoutAmount ?? 0,
        });
        // Emit pattern:won if a pattern was completed by this claim
        if (claim.valid) {
          const wonPattern = snapshot.currentGame?.patternResults?.find(
            (r) => r.claimId === claim.id && r.isWon
          );
          if (wonPattern) {
            io.to(roomCode).emit("pattern:won", {
              patternId: wonPattern.patternId,
              patternName: wonPattern.patternName,
              winnerId: wonPattern.winnerId,
              wonAtDraw: wonPattern.wonAtDraw,
              payoutAmount: wonPattern.payoutAmount,
              claimType: wonPattern.claimType,
              gameId: snapshot.currentGame?.id
            });
          }
          // Game 1 (Classic Bingo): activate mini-game after BINGO win
          if (payload.type === "BINGO" && snapshot.gameSlug === "bingo") {
            const miniGame = engine.activateMiniGame(roomCode, playerId);
            if (miniGame) {
              socket.emit("minigame:activated", {
                gameId: snapshot.currentGame?.id,
                playerId,
                type: miniGame.type,
                prizeList: miniGame.prizeList,
              });
            }
          }
          // Game 5 (Spillorama): activate jackpot after BINGO win
          if (payload.type === "BINGO" && snapshot.gameSlug === "spillorama") {
            const jackpot = engine.activateJackpot(roomCode, playerId);
            if (jackpot) {
              // Send jackpot activation to the winning player only
              socket.emit("jackpot:activated", {
                gameId: snapshot.currentGame?.id,
                playerId,
                prizeList: jackpot.prizeList,
                totalSpins: jackpot.totalSpins,
                playedSpins: jackpot.playedSpins,
                spinHistory: jackpot.spinHistory,
              });
            }
          }
        }
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Lucky number ──────────────────────────────────────────────────────────
    socket.on("lucky:set", rateLimited("lucky:set", async (payload: LuckyNumberPayload, callback: (response: AckResponse<{ luckyNumber: number }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const num = payload?.luckyNumber;
        if (!Number.isInteger(num) || num < 1 || num > 60) {
          throw new DomainError("INVALID_INPUT", "luckyNumber må være mellom 1 og 60.");
        }
        // Only allow setting before game starts or during waiting
        const snapshot = engine.getRoomSnapshot(roomCode);
        if (snapshot.currentGame?.status === "RUNNING") {
          throw new DomainError("GAME_IN_PROGRESS", "Kan ikke endre lykketall mens spillet pågår.");
        }
        setLuckyNumber(roomCode, playerId, num);
        await emitRoomUpdate(roomCode);
        ackSuccess(callback, { luckyNumber: num });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Jackpot (Game 5 Free Spin) ─────────────────────────────────────────
    socket.on("jackpot:spin", rateLimited("jackpot:spin", async (payload: RoomActionPayload, callback: (response: AckResponse<unknown>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const result = await engine.spinJackpot(roomCode, playerId);
        ackSuccess(callback, result);
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Mini-game (Game 1 — Wheel of Fortune / Treasure Chest) ─────────────
    socket.on("minigame:play", rateLimited("minigame:play", async (payload: RoomActionPayload & { selectedIndex?: number }, callback: (response: AckResponse<unknown>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const selectedIndex = typeof payload?.selectedIndex === "number" ? payload.selectedIndex : undefined;
        const result = await engine.playMiniGame(roomCode, playerId, selectedIndex);
        ackSuccess(callback, result);
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Chat ─────────────────────────────────────────────────────────────────
    socket.on("chat:send", rateLimited("chat:send", async (payload: ChatSendPayload, callback: (response: AckResponse<{ message: ChatMessage }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const message = (payload?.message ?? "").trim();
        if (!message && (payload?.emojiId ?? 0) === 0) {
          throw new DomainError("INVALID_INPUT", "Meldingen kan ikke være tom.");
        }
        const snapshot = engine.getRoomSnapshot(roomCode);
        const player = snapshot.players.find((p) => p.id === playerId);
        // BIN-516 hall-scoping: a player must belong to the room's hall to chat
        // in it. Cross-hall chat is a spillevett audit hazard.
        if (player?.hallId && snapshot.hallId && player.hallId !== snapshot.hallId) {
          throw new DomainError("FORBIDDEN", "Spilleren tilhører en annen hall enn rommet.");
        }
        const chatMsg: ChatMessage = {
          id: randomUUID(),
          playerId,
          playerName: player?.name ?? "Ukjent",
          message: message.slice(0, 500),
          emojiId: payload?.emojiId ?? 0,
          createdAt: new Date().toISOString()
        };
        appendChatMessage(roomCode, chatMsg);
        // BIN-516: fire-and-forget persistence. The store implementations log
        // and swallow errors — chat must keep flowing even if the DB is sick.
        if (deps.chatMessageStore) {
          void deps.chatMessageStore.insert({
            hallId: snapshot.hallId,
            roomCode,
            playerId,
            playerName: chatMsg.playerName,
            message: chatMsg.message,
            emojiId: chatMsg.emojiId,
          });
        }
        io.to(roomCode).emit("chat:message", chatMsg);
        ackSuccess(callback, { message: chatMsg });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("chat:history", rateLimited("chat:history", async (payload: RoomActionPayload, callback: (response: AckResponse<{ messages: ChatMessage[] }>) => void) => {
      try {
        const { roomCode } = await requireAuthenticatedPlayerAction(payload);
        // BIN-516: prefer the persistent store when available so a fresh
        // browser session sees pre-load chat history. Fall back to the
        // in-memory window for the dev-without-DB case.
        if (deps.chatMessageStore) {
          const persisted = await deps.chatMessageStore.listRecent(roomCode);
          ackSuccess(callback, { messages: persisted as ChatMessage[] });
          return;
        }
        const messages = chatHistoryByRoom.get(roomCode) ?? [];
        ackSuccess(callback, { messages });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Leaderboard ──────────────────────────────────────────────────────────
    socket.on("leaderboard:get", rateLimited("leaderboard:get", async (payload: LeaderboardPayload, callback: (response: AckResponse<{ leaderboard: LeaderboardEntry[] }>) => void) => {
      try {
        const leaderboard = buildLeaderboard(payload?.roomCode);
        ackSuccess(callback, { leaderboard });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("disconnect", (reason: string) => {
      engine.detachSocket(socket.id);
      _socketRateLimiter.cleanup(socket.id);
      // BIN-539: Every disconnect rolls into reconnect/retry dashboards. The
      // `reason` label is bounded (Socket.IO enumerates it), so cardinality
      // stays safe for Prometheus.
      promMetrics.reconnectTotal.inc({ reason: reason || "unknown" });
      addBreadcrumb("socket.disconnected", { socketId: socket.id, reason }, "warning");
    });
  };
}
