import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { RoomSnapshot } from "../game/types.js";
import type { RoomUpdatePayload } from "../util/roomHelpers.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";

interface LeaderboardEntry {
  nickname: string;
  points: number;
}

export interface GameRouterDeps {
  platformService: PlatformService;
  engine: BingoEngine;
  drawScheduler: DrawScheduler;
  emitRoomUpdate: (roomCode: string) => Promise<RoomSnapshot>;
  buildRoomUpdatePayload: (snapshot: RoomSnapshot) => RoomUpdatePayload;
  assertUserCanAccessRoom: (user: PublicAppUser, roomCode: string) => void;
  assertUserCanActAsPlayer: (user: PublicAppUser, roomCode: string, actorPlayerId: string) => void;
}

export function createGameRouter(deps: GameRouterDeps): express.Router {
  const {
    platformService,
    engine,
    drawScheduler,
    emitRoomUpdate,
    buildRoomUpdatePayload,
    assertUserCanAccessRoom,
    assertUserCanActAsPlayer,
  } = deps;

  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.get("/api/games", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      const games = await platformService.listGames({ includeDisabled: false });
      apiSuccess(res, games);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // BIN-266: Live game status per slug — used by web shell lobby to show Open/Closed/Starting badges.
  // Groups active rooms by gameSlug and picks the most "alive" status per game.
  router.get("/api/games/status", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      const summaries = engine.listRoomSummaries();
      type GameStatusEntry = { status: "OPEN" | "STARTING" | "CLOSED"; nextRoundAt: string | null };
      const statusMap = new Map<string, GameStatusEntry>();

      for (const s of summaries) {
        const slug = s.gameSlug ?? "bingo";
        const existing = statusMap.get(slug);
        const nextRoundAtMs = drawScheduler.nextAutoStartAtByRoom.get(s.code);
        const nextRoundAt = nextRoundAtMs ? new Date(nextRoundAtMs).toISOString() : null;
        const status: GameStatusEntry["status"] =
          s.gameStatus === "RUNNING" ? "OPEN"
          : s.gameStatus === "WAITING" ? "STARTING"
          : "CLOSED";

        // Priority: OPEN > STARTING > CLOSED
        if (!existing || status === "OPEN" || (status === "STARTING" && existing.status === "CLOSED")) {
          statusMap.set(slug, { status, nextRoundAt });
        }
      }

      const result: Record<string, GameStatusEntry> = {};
      for (const [slug, info] of statusMap) {
        result[slug] = info;
      }
      apiSuccess(res, result);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Launch external game (e.g. Candy) — calls demo-backend's integration API
  router.post("/api/games/:slug/launch", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const slug = req.params.slug?.trim();
      if (!slug) throw new DomainError("INVALID_INPUT", "Mangler game slug.");

      const game = await platformService.getGame(slug);
      if (!game || !game.isEnabled) {
        throw new DomainError("GAME_NOT_FOUND", `Spillet '${slug}' finnes ikke eller er deaktivert.`);
      }

      const candyBackendUrl = (process.env.CANDY_BACKEND_URL ?? "").trim();
      const candyApiKey = (process.env.CANDY_INTEGRATION_API_KEY ?? "").trim();
      if (!candyBackendUrl || !candyApiKey) {
        throw new DomainError("INTEGRATION_NOT_CONFIGURED", "Candy-integrasjon er ikke konfigurert.");
      }

      const hallId = typeof req.body?.hallId === "string" ? req.body.hallId.trim() : "hall-default";
      const returnUrl = typeof req.body?.returnUrl === "string"
        ? req.body.returnUrl.trim()
        : `${req.protocol}://${req.get("host") ?? "localhost"}/`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`${candyBackendUrl}/api/integration/launch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": candyApiKey
          },
          body: JSON.stringify({
            sessionToken: getAccessTokenFromRequest(req),
            playerId: user.walletId,
            currency: (process.env.WALLET_CURRENCY ?? "NOK").trim().toUpperCase(),
            language: (process.env.APP_LANGUAGE ?? "nb-NO").trim(),
            returnUrl
          }),
          signal: controller.signal
        });

        const body = await response.json() as { ok?: boolean; data?: { embedUrl?: string; expiresAt?: string }; error?: unknown };
        if (!response.ok || !body.ok || !body.data?.embedUrl) {
          throw new DomainError("LAUNCH_FAILED", "Kunne ikke starte spillet.");
        }

        apiSuccess(res, {
          embedUrl: body.data.embedUrl,
          expiresAt: body.data.expiresAt
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/halls", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      const halls = await platformService.listHalls({ includeInactive: false });
      apiSuccess(res, halls);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // BIN-540: public — used by the web shell at game-mount time to decide
  // which client engine to load. No auth so a new (unauthenticated) shell
  // can read the flag before the user has picked a hall. Fail-safes to
  // 'unity' inside PlatformService on any DB error.
  router.get("/api/halls/:hallReference/client-variant", async (req, res) => {
    try {
      const hallReference = mustBeNonEmptyString(req.params.hallReference, "hallReference");
      const variant = await platformService.getHallClientVariant(hallReference);
      apiSuccess(res, { hallReference, clientVariant: variant });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Spilleplan — public (§ 64) ────────────────────────────────────────────

  // Public: today's schedule for a hall (filtered by day of week)
  router.get("/api/halls/:hallId/schedule", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
      const todayDow = new Date().getDay(); // 0=Sun..6=Sat
      const slots = await platformService.listScheduleSlots(hallId, {
        dayOfWeek: todayDow,
        activeOnly: true
      });
      apiSuccess(res, slots);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Rooms (public) ────────────────────────────────────────────────────────

  router.get("/api/rooms", (req, res) => {
    try {
      const hallIdFilter = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      let summaries = engine.listRoomSummaries();
      if (hallIdFilter) {
        summaries = summaries.filter((s) => s.hallId === hallIdFilter);
      }
      const enriched = summaries.map((s) => ({
        ...s,
        roomCode: s.code,
        status: s.gameStatus === "RUNNING" ? "PLAYING" : s.gameStatus === "NONE" ? "OPEN" : s.gameStatus,
        gameName: s.gameSlug ?? "bingo",
        gameSlug: s.gameSlug ?? "bingo",
        nextRoundAt: drawScheduler.nextAutoStartAtByRoom.get(s.code)
          ? new Date(drawScheduler.nextAutoStartAtByRoom.get(s.code)!).toISOString()
          : null,
      }));
      apiSuccess(res, enriched);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.get("/api/rooms/:roomCode", (req, res) => {
    try {
      const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(req.params.roomCode));
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/rooms/:roomCode/game/end", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
      const actorPlayerId = mustBeNonEmptyString(req.body?.actorPlayerId, "actorPlayerId");
      assertUserCanActAsPlayer(user, roomCode, actorPlayerId);
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      await engine.endGame({ roomCode, actorPlayerId, reason });
      const snapshot = await emitRoomUpdate(roomCode);
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/rooms/:roomCode/game/extra-draw", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
      const actorPlayerId = mustBeNonEmptyString(req.body?.actorPlayerId, "actorPlayerId");
      assertUserCanActAsPlayer(user, roomCode, actorPlayerId);
      engine.rejectExtraDrawPurchase({
        source: "API",
        roomCode,
        playerId: actorPlayerId,
        metadata: {
          requestedCount:
            req.body?.requestedCount === undefined ? undefined : Number(req.body?.requestedCount),
          packageId: typeof req.body?.packageId === "string" ? req.body.packageId : undefined
        }
      });
      apiSuccess(res, { ok: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Leaderboard ──────────────────────────────────────────────────────────────

  router.get("/api/leaderboard", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
      const period = typeof req.query.period === "string" ? req.query.period.trim() : "week";

      const now = Date.now();
      let dateFrom: string | undefined;
      if (period === "today") {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        dateFrom = d.toISOString();
      } else if (period === "week") {
        dateFrom = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (period === "month") {
        dateFrom = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const entries = engine.listComplianceLedgerEntries({
        limit: 10_000,
        hallId: hallId || undefined,
        dateFrom,
      });

      // Aggregate prizes per walletId
      const prizeByWallet = new Map<string, number>();
      for (const entry of entries) {
        if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
          prizeByWallet.set(entry.walletId ?? "", (prizeByWallet.get(entry.walletId ?? "") ?? 0) + entry.amount);
        }
      }

      // Resolve display names from active room players
      const nameByWallet = new Map<string, string>();
      for (const room of engine.listRoomSummaries()) {
        try {
          const snapshot = engine.getRoomSnapshot(room.code);
          for (const player of snapshot.players) {
            if (player.walletId && player.name) {
              nameByWallet.set(player.walletId, player.name);
            }
          }
        } catch {
          // Room may have been destroyed between list and snapshot
        }
      }

      const leaderboard = [...prizeByWallet.entries()]
        .filter(([walletId]) => walletId)
        .map(([walletId, points]) => ({
          nickname: nameByWallet.get(walletId) ?? "Spiller",
          displayName: nameByWallet.get(walletId) ?? "Spiller",
          points: Math.round(points * 100) / 100,
        }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 50);

      apiSuccess(res, leaderboard);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Notifications (stub — V1 returns empty array) ────────────────────────────

  router.get("/api/notifications", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      apiSuccess(res, []);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  router.post("/api/notifications/read", async (req, res) => {
    try {
      await getAuthenticatedUser(req);
      apiSuccess(res, { ok: true });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
