import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import {
  assertUserHallScope,
  resolveHallScopeFilter,
} from "../platform/AdminAccessPolicy.js";
import type { PublicAppUser } from "../platform/PlatformService.js";
import {
  apiSuccess,
  apiFailure,
  mustBeNonEmptyString,
  parseBooleanQueryValue,
  parseOptionalNonNegativeNumber,
  parseOptionalTicketsPerPlayerInput,
} from "../util/httpHelpers.js";
import type { AdminSubRouterDeps } from "./adminShared.js";

export function createAdminRoomsRouter(deps: AdminSubRouterDeps): express.Router {
  const {
    platformService,
    engine,
    io,
    drawScheduler,
    bingoSettingsState,
    enforceSingleRoomPerHall,
    emitRoomUpdate,
    buildRoomUpdatePayload,
    getRoomConfiguredEntryFee,
    getArmedPlayerIds,
    disarmAllPlayers,
    clearDisplayTicketCache,
    roomConfiguredEntryFeeByRoom,
    getPrimaryRoomForHall,
    resolveBingoHallGameConfigForRoom,
    helpers,
  } = deps;
  const { auditAdmin, requireAdminPermissionUser } = helpers;
  const router = express.Router();

  async function requireActiveHallIdFromInput(input: unknown): Promise<string> {
    const hallReference = mustBeNonEmptyString(input, "hallId");
    const hall = await platformService.requireActiveHall(hallReference);
    return hall.id;
  }

  // BIN-591: hall-scope guard for room-control endpoints. Loads snapshot,
  // asserts user has access to the room's hall, returns snapshot for reuse.
  function requireRoomHallScope(
    adminUser: PublicAppUser,
    roomCodeRaw: string
  ): { roomCode: string; hallId: string } {
    const roomCode = mustBeNonEmptyString(roomCodeRaw, "roomCode").toUpperCase();
    const snapshot = engine.getRoomSnapshot(roomCode);
    if (!snapshot.hallId) {
      throw new DomainError(
        "ROOM_MISSING_HALL",
        "Rommet er ikke knyttet til en hall — kan ikke hall-scope-sjekkes."
      );
    }
    assertUserHallScope(adminUser, snapshot.hallId);
    return { roomCode, hallId: snapshot.hallId };
  }

  router.get("/api/admin/rooms", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
      const includeSnapshots = parseBooleanQueryValue(req.query.includeSnapshots, false);
      const rooms = engine.listRoomSummaries();
      // BIN-591: filter list to user's hall when HALL_OPERATOR
      const scopeHallId = resolveHallScopeFilter(adminUser);
      const scopedRooms = scopeHallId ? rooms.filter((r) => r.hallId === scopeHallId) : rooms;
      if (!includeSnapshots) {
        apiSuccess(res, scopedRooms);
        return;
      }
      const detailed = scopedRooms.map((room) => ({
        ...room,
        snapshot: buildRoomUpdatePayload(engine.getRoomSnapshot(room.code))
      }));
      apiSuccess(res, detailed);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/admin/rooms/:roomCode", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
      const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
      const raw = engine.getRoomSnapshot(roomCode);
      if (raw.hallId) assertUserHallScope(adminUser, raw.hallId); // BIN-591
      const snapshot = buildRoomUpdatePayload(raw);
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const hallId = await requireActiveHallIdFromInput(req.body?.hallId);
      assertUserHallScope(adminUser, hallId); // BIN-591

      // Enforce single room per hall — block creation if a canonical room already exists
      if (enforceSingleRoomPerHall) {
        const canonicalRoom = getPrimaryRoomForHall(hallId);
        if (canonicalRoom) {
          throw new DomainError(
            "SINGLE_ROOM_ONLY",
            `Kun ett bingo-rom er tillatt per hall. Rom ${canonicalRoom.code} er allerede aktivt.`
          );
        }
      }

      const requestedHostName =
        typeof req.body?.hostName === "string" && req.body.hostName.trim().length > 0
          ? req.body.hostName.trim()
          : `${adminUser.displayName} (Host)`;
      const requestedHostWalletId =
        typeof req.body?.hostWalletId === "string" && req.body.hostWalletId.trim().length > 0
          ? req.body.hostWalletId.trim()
          : `admin-host-${hallId}-${Date.now().toString(36)}`;
      const { roomCode, playerId } = await engine.createRoom({
        hallId,
        playerName: requestedHostName,
        walletId: requestedHostWalletId,
        roomCode: enforceSingleRoomPerHall ? "BINGO1" : undefined
      });
      // BIN-694 + PR C: wire variantConfig for admin-created rooms. Foretrekker
      // ny async binder som kan lese admin-UI-config via gameManagementId;
      // faller til default-binder ellers. I dag har ikke /room/create
      // gameManagementId i body — fremtidig scope legger til den.
      if (deps.bindVariantConfigForRoom) {
        await deps.bindVariantConfigForRoom(roomCode, { gameSlug: "bingo" });
      } else {
        deps.bindDefaultVariantConfig?.(roomCode, "bingo");
      }
      const snapshot = await emitRoomUpdate(roomCode);
      auditAdmin(req, adminUser, "room.create", "room", roomCode, { hallId });
      apiSuccess(res, {
        roomCode,
        playerId,
        snapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.delete("/api/admin/rooms/:roomCode", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode, hallId } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      engine.destroyRoom(roomCode);
      drawScheduler.releaseRoom(roomCode);
      roomConfiguredEntryFeeByRoom.delete(roomCode);
      auditAdmin(req, adminUser, "room.delete", "room", roomCode, { hallId });
      apiSuccess(res, { deleted: roomCode });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/start", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const entryFee = parseOptionalNonNegativeNumber(req.body?.entryFee, "entryFee") ?? getRoomConfiguredEntryFee(roomCode);
      const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
      const requestedTicketsPerPlayer = parseOptionalTicketsPerPlayerInput(req.body?.ticketsPerPlayer);
      const ticketsPerPlayer =
        requestedTicketsPerPlayer ??
        Math.min(hallGameConfig.maxTicketsPerPlayer, bingoSettingsState.runtimeBingoSettings.autoRoundTicketsPerPlayer);
      const { assertTicketsPerPlayerWithinHallLimit } = await import("../game/compliance.js");
      assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
      const beforeStartSnapshot = engine.getRoomSnapshot(roomCode);
      await engine.startGame({
        roomCode,
        actorPlayerId: beforeStartSnapshot.hostPlayerId,
        entryFee,
        ticketsPerPlayer,
        payoutPercent: bingoSettingsState.runtimeBingoSettings.payoutPercent,
        armedPlayerIds: getArmedPlayerIds(roomCode),
      });
      disarmAllPlayers(roomCode);
      clearDisplayTicketCache(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, {
        roomCode,
        snapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/draw-next", async (req, res) => {
    try {
      // BIN-254: Capture actual admin actor for audit log — not just the room host ID
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const snapshot = engine.getRoomSnapshot(roomCode);
      const drawResult = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: snapshot.hostPlayerId
      });
      console.info("[MEDIUM-4/BIN-254] Admin draw", {
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        adminWalletId: adminUser.walletId,
        roomCode,
        gameId: drawResult.gameId,
        number: drawResult.number,
        drawIndex: drawResult.drawIndex
      });
      io.to(roomCode).emit("draw:new", { number: drawResult.number, source: "admin", drawIndex: drawResult.drawIndex, gameId: drawResult.gameId });
      const updatedSnapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, {
        roomCode,
        number: drawResult.number,
        drawIndex: drawResult.drawIndex,
        gameId: drawResult.gameId,
        snapshot: updatedSnapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/end", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "Manual end from admin";
      const beforeEndSnapshot = engine.getRoomSnapshot(roomCode);
      await engine.endGame({
        roomCode,
        actorPlayerId: beforeEndSnapshot.hostPlayerId,
        reason
      });
      console.info("[MEDIUM-4] Admin end game", {
        adminUserId: adminUser.id,
        adminEmail: adminUser.email,
        roomCode,
        reason
      });
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, {
        roomCode,
        snapshot
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-515: Room-ready broadcast (admin) ─────────────────────────────────
  //
  // Mirrors the socket-event `admin:room-ready` for admin-web operators who
  // aren't on a live socket. Fires the same fan-out emit
  // (`admin:hall-event` → room-code + `hall:<id>:display`) so the TV and
  // spectator clients see the signal identically regardless of path.

  router.post("/api/admin/rooms/:roomCode/room-ready", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const countdownRaw = req.body?.countdownSeconds;
      const countdownSeconds = Number.isFinite(Number(countdownRaw))
        ? Math.max(0, Math.min(300, Math.floor(Number(countdownRaw))))
        : undefined;
      const message = typeof req.body?.message === "string"
        ? req.body.message.slice(0, 200)
        : undefined;
      // Confirm the room exists before advertising readiness.
      const snapshot = engine.getRoomSnapshot(roomCode);
      const event = {
        kind: "room-ready" as const,
        roomCode,
        hallId: snapshot.hallId ?? null,
        at: Date.now(),
        countdownSeconds,
        message,
        actor: { id: adminUser.id, displayName: adminUser.displayName },
      };
      io.to(roomCode).emit("admin:hall-event", event);
      if (event.hallId) io.to(`hall:${event.hallId}:display`).emit("admin:hall-event", event);
      apiSuccess(res, event);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── BIN-460: Game pause/resume (admin) ────────────────────────────────────

  router.post("/api/admin/rooms/:roomCode/game/pause", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      const message = typeof req.body?.message === "string" ? req.body.message : undefined;
      engine.pauseGame(roomCode, message);
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, { roomCode, isPaused: true, snapshot });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/admin/rooms/:roomCode/game/resume", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
      const { roomCode } = requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      engine.resumeGame(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, { roomCode, isPaused: false, snapshot });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
