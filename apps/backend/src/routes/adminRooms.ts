import express from "express";
import { DomainError } from "../errors/DomainError.js";
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
import {
  getCanonicalRoomCode,
  isCanonicalRoomCode,
} from "../util/canonicalRoomCode.js";
import { walletRoomKey } from "../sockets/walletStatePusher.js";

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
    getHallGroupIdForHall,
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
  //
  // 2026-05-02 (Tobias UX): for shared rooms (én rom per group-of-halls)
  // godtas tilgang hvis bruker-hallens kanoniske kode matcher rom-koden,
  // selv om snapshot.hallId tilhører en annen hall i samme gruppe. Dette
  // unngår FORBIDDEN når master-hall opprettet rommet og slave-agent prøver
  // å se det.
  async function requireRoomHallScope(
    adminUser: PublicAppUser,
    roomCodeRaw: string
  ): Promise<{ roomCode: string; hallId: string }> {
    const roomCode = mustBeNonEmptyString(roomCodeRaw, "roomCode").toUpperCase();
    const snapshot = engine.getRoomSnapshot(roomCode);
    if (!snapshot.hallId) {
      throw new DomainError(
        "ROOM_MISSING_HALL",
        "Rommet er ikke knyttet til en hall — kan ikke hall-scope-sjekkes."
      );
    }
    // ADMIN/SUPPORT bypass; HALL_OPERATOR/AGENT må sjekkes.
    if (adminUser.role === "ADMIN" || adminUser.role === "SUPPORT") {
      return { roomCode, hallId: snapshot.hallId };
    }
    if (!adminUser.hallId) {
      throw new DomainError(
        "FORBIDDEN",
        "Din bruker er ikke tildelt en hall — kontakt admin."
      );
    }
    // Direkte hall-match (legacy per-hall-rom).
    if (snapshot.hallId === adminUser.hallId) {
      return { roomCode, hallId: snapshot.hallId };
    }
    // Shared room (Spill 1 per-link, Spill 2/3 globalt) — sjekk at user-
    // hallens kanoniske kode matcher rom-koden.
    if (getHallGroupIdForHall) {
      try {
        const userGroupId = await getHallGroupIdForHall(adminUser.hallId);
        const userCanonical = getCanonicalRoomCode(
          snapshot.gameSlug ?? "bingo",
          adminUser.hallId,
          userGroupId,
        );
        if (userCanonical.roomCode === roomCode) {
          return { roomCode, hallId: snapshot.hallId };
        }
      } catch {
        // fall through til assertUserHallScope nedenfor — vil kaste FORBIDDEN
      }
    }
    // Fall-back til strict hall-scope (kaster FORBIDDEN hvis mismatch).
    assertUserHallScope(adminUser, snapshot.hallId);
    return { roomCode, hallId: snapshot.hallId };
  }

  router.get("/api/admin/rooms", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
      const includeSnapshots = parseBooleanQueryValue(req.query.includeSnapshots, false);
      const rooms = engine.listRoomSummaries();
      // BIN-591: filter list to user's hall when HALL_OPERATOR / AGENT.
      // 2026-05-02 (Tobias UX): inkluder shared rooms hvor user-hallens
      // kanoniske kode matcher rom-koden — slik at slave-hall-agenter
      // ser master-hallens shared rom uten å være "owner".
      const scopeHallId = resolveHallScopeFilter(adminUser);
      let scopedRooms = rooms;
      if (scopeHallId) {
        const userGroupId = getHallGroupIdForHall
          ? await getHallGroupIdForHall(scopeHallId)
          : null;
        scopedRooms = rooms.filter((r) => {
          if (r.hallId === scopeHallId) return true;
          if (!r.isHallShared) return false;
          // Shared room: sjekk om user-hallens kanoniske kode matcher.
          const userCanonical = getCanonicalRoomCode(
            r.gameSlug ?? "bingo",
            scopeHallId,
            userGroupId,
          );
          return userCanonical.roomCode === r.code;
        });
      }
      if (!includeSnapshots) {
        // Tobias 2026-04-27 (pilot-test feedback): inkluder lett `currentGame`-
        // fragment (status + endedReason + id) i listen så agent-portal kan
        // vise "Klar for ny runde"-affordance ved ENDED uten ekstra round-trip.
        // Full snapshot er fortsatt bak `?includeSnapshots=true`.
        const enriched = scopedRooms.map((room) => {
          try {
            const snap = engine.getRoomSnapshot(room.code);
            const cg = snap.currentGame;
            return {
              ...room,
              currentGame: cg
                ? {
                    id: cg.id,
                    status: cg.status,
                    endedAt: cg.endedAt ?? null,
                    endedReason: cg.endedReason ?? null,
                    isPaused: cg.isPaused ?? false,
                  }
                : null,
            };
          } catch {
            return { ...room, currentGame: null };
          }
        });
        apiSuccess(res, enriched);
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
      if (raw.hallId) {
        // 2026-05-02: bruker requireRoomHallScope-helper for shared-room-tilgang.
        await requireRoomHallScope(adminUser, roomCode);
      }
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

      // 2026-05-02 (Tobias UX): én rom per group-of-halls. Vi deriverer
      // kanonisk rom-kode fra hallens gruppe (BINGO_<groupId>) — alle
      // haller i samme link deler ETT BingoEngine-rom. Hvis hallen ikke
      // er i en gruppe faller vi tilbake til BINGO_<hallId> så
      // enkeltståendel-haller fortsatt får deterministisk kode.
      const groupId = getHallGroupIdForHall
        ? await getHallGroupIdForHall(hallId)
        : null;
      const canonical = getCanonicalRoomCode("bingo", hallId, groupId);

      // Idempotens (multi-hall sharing): hvis kanonisk rom allerede
      // eksisterer, returner det i stedet for å kaste SINGLE_ROOM_ONLY.
      // Dette er forskjellen fra gammel per-hall-enforcement: nå er
      // "samme rom" forventet adferd når en annen hall i gruppen har
      // opprettet det først.
      let roomCode: string;
      let playerId: string;
      try {
        const existing = engine.getRoomSnapshot(canonical.roomCode);
        if (existing) {
          // Re-bekreft hall-scope mot existing room (kun for paranoia
          // — assertUserHallScope kjørte allerede over input-hallId).
          roomCode = existing.code;
          playerId = existing.hostPlayerId;
          const snapshot = await emitRoomUpdate(roomCode);
          auditAdmin(req, adminUser, "room.create.idempotent", "room", roomCode, {
            hallId,
            groupId,
            sharedExistingHostPlayerId: existing.hostPlayerId,
          });
          apiSuccess(res, { roomCode, playerId, snapshot });
          return;
        }
        // existing er sannsynligvis aldri null — men hvis det er det,
        // fall gjennom til create.
      } catch (err) {
        // ROOM_NOT_FOUND er forventet ved første kall — fortsett til create.
        const code = (err as { code?: string } | null)?.code ?? "";
        if (code !== "ROOM_NOT_FOUND") {
          throw err;
        }
      }

      const requestedHostName =
        typeof req.body?.hostName === "string" && req.body.hostName.trim().length > 0
          ? req.body.hostName.trim()
          : `${adminUser.displayName} (Host)`;
      const requestedHostWalletId =
        typeof req.body?.hostWalletId === "string" && req.body.hostWalletId.trim().length > 0
          ? req.body.hostWalletId.trim()
          : `admin-host-${canonical.roomCode.toLowerCase()}-${Date.now().toString(36)}`;
      const created = await engine.createRoom({
        hallId,
        playerName: requestedHostName,
        walletId: requestedHostWalletId,
        roomCode: canonical.roomCode,
        ...(canonical.effectiveHallId === null
          ? { effectiveHallId: null }
          : {}),
      });
      roomCode = created.roomCode;
      playerId = created.playerId;
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
      const { roomCode, hallId } = await requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
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
      const { roomCode, hallId } = await requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      // Tobias 2026-04-27 (pilot-test feedback): pre-flight validation.
      // Sikrer at hallen tilhører en aktiv link/group + at det finnes
      // minst én aktiv spilleplan før engine.startGame kjøres. Skipper
      // hvis validator ikke er injisert (test-stier).
      if (deps.roomStartPreFlightValidator) {
        await deps.roomStartPreFlightValidator.validate(hallId);
      }
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
      const { roomCode } = await requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
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
      const { roomCode } = await requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
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
      const { roomCode } = await requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
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
      const { roomCode } = await requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
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
      const { roomCode } = await requireRoomHallScope(adminUser, req.params.roomCode); // BIN-591
      engine.resumeGame(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, { roomCode, isPaused: false, snapshot });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── PILOT-EMERGENCY 2026-04-28: clear-stuck-room (Tobias) ────────────────
  //
  // POST /api/admin/players/:userId/clear-stuck-room
  //
  // Akutt-rydding for spillere som er stuck pga pre-#677 4RCQSX-style
  // legacy-rom (eller annen stale wallet-binding). Endepunktet:
  //   1) Slår opp brukerens walletId
  //   2) Fjerner ALLE player-records med den walletId fra ALLE non-canonical
  //      rom (uansett runde-status — RUNNING legacy-rom inkludert).
  //   3) Rydder også IDLE/ENDED canonical rom (ENDED leftovers blokkerer
  //      reconnect via assertWalletNotAlreadyInRoom).
  //   4) Force-disconnecter alle aktive sockets i wallet-rommet.
  //   5) Returnerer ny canonical-room-mapping for brukerens hall (slug "bingo").
  //   6) Audit-logger `admin.player.clear_stuck_room` med detaljer.
  //
  // ADMIN-only (PLAYER_KYC_OVERRIDE — destruktiv path som bypasser normal
  // wallet-binding-flyt og krever bevisst inngrep). HALL_OPERATOR/SUPPORT
  // kan ikke kalle dette — de må eskalere.
  router.post("/api/admin/players/:userId/clear-stuck-room", async (req, res) => {
    try {
      const adminUser = await requireAdminPermissionUser(
        req,
        "PLAYER_KYC_OVERRIDE",
      );
      const userId = mustBeNonEmptyString(req.params.userId, "userId");

      // Slå opp brukeren — gir USER_NOT_FOUND ved ukjent ID.
      const targetUser = await platformService.getUserById(userId);
      const walletId = targetUser.walletId;
      if (!walletId) {
        throw new DomainError(
          "USER_HAS_NO_WALLET",
          `Bruker ${userId} har ingen wallet — kan ikke rydde room-binding.`,
        );
      }

      // Steg 2: rydd alle non-canonical rom for denne walleten.
      const nonCanonicalCleared = engine.cleanupStaleWalletInNonCanonicalRooms(
        walletId,
        isCanonicalRoomCode,
      );

      // Steg 3: rydd IDLE/ENDED canonical rom (ENDED leftovers blokker også
      // reconnect via assertWalletNotAlreadyInRoom). Vi ekskluderer ingen
      // ved å ikke sende exceptRoomCode.
      const idleCleared = engine.cleanupStaleWalletInIdleRooms(walletId);

      // Steg 4: force-disconnect alle aktive sockets for wallet-rommet.
      // socket.io v4: io.in(roomKey).fetchSockets() henter alle sockets som
      // har joinet rommet, og s.disconnect(true) sparker hver enkelt slik
      // at klienten må re-handshake fra null. Best-effort — feiler ikke
      // endepunktet om io ikke er fullt operasjonelt.
      let disconnected = 0;
      try {
        const targetRoom = walletRoomKey(walletId);
        const sockets = await io.in(targetRoom).fetchSockets();
        disconnected = sockets.length;
        for (const s of sockets) {
          try {
            s.disconnect(true);
          } catch {
            /* best-effort */
          }
        }
      } catch (err) {
        console.warn(
          "[admin.clear_stuck_room] socket-disconnect failed (non-blocking)",
          { walletId, err: err instanceof Error ? err.message : String(err) },
        );
      }

      // Steg 5: beregn ny canonical-room-mapping for brukerens hall (default
      // slug = "bingo" siden Spill 1 er hva pilot-emergencyen handler om).
      // hall-group lookup gjøres ikke her — caller får hallId-fallback-koden,
      // som matcher hva room:join-handlerne også returnerer for haller uten
      // gruppe. Hvis brukeren faktisk er i en gruppe, vil neste room:join
      // resolve canonical via getHallGroupIdForHall der.
      const hallId = targetUser.hallId ?? null;
      const canonicalMapping = hallId
        ? getCanonicalRoomCode("bingo", hallId, null)
        : null;

      // Steg 6: audit-log.
      auditAdmin(
        req,
        adminUser,
        "admin.player.clear_stuck_room",
        "user",
        userId,
        {
          walletId,
          hallId,
          nonCanonicalCleared,
          idleCleared,
          disconnectedSockets: disconnected,
          canonicalRoomCode: canonicalMapping?.roomCode ?? null,
        },
      );

      apiSuccess(res, {
        userId,
        walletId,
        hallId,
        cleared: {
          nonCanonicalRooms: nonCanonicalCleared,
          idleCanonicalRooms: idleCleared,
          disconnectedSockets: disconnected,
        },
        canonical: canonicalMapping
          ? {
              roomCode: canonicalMapping.roomCode,
              effectiveHallId: canonicalMapping.effectiveHallId,
              isHallShared: canonicalMapping.isHallShared,
            }
          : null,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
