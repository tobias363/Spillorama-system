/**
 * BIN-618: admin top-players dashboard-widget endpoint.
 *
 *   GET /api/admin/players/top?metric=wallet&limit=5&hallId=...
 *
 * Closes the `TopPlayersBox.ts` gap (admin-web PR #218 renders "—" because
 * the endpoint was never implemented). Replaces the legacy Modular dashboard
 * call `PlayerServices.getAllPlayerDataTableSelected(..., { walletAmount:-1 })`
 * in `legacy/unity-backend/App/Controllers/Dashboard.js:120-127`.
 *
 * Contract (matches admin-web `fetchTopPlayers` in
 * `apps/admin-web/src/api/dashboard.ts:86-102`):
 *   200 { ok: true, data: { players: [{ id, username, avatar?, walletAmount }],
 *                           count, limit, generatedAt } }
 *
 * RBAC: `DAILY_REPORT_READ` — same family as `/api/admin/dashboard/top-players`
 * (ranking by stake over a range) but distinct endpoint because the legacy
 * contract exposed by this widget is "rank by current wallet balance".
 *
 * Hall-scope: HALL_OPERATOR sees only their own hall's players. ADMIN /
 * SUPPORT can optionally scope via `?hallId=`. Unknown-hallId operators
 * fail closed (FORBIDDEN) via `resolveHallScopeFilter`.
 *
 * Read-only: no AuditLog (not AML-scoped).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser, AppUser } from "../platform/PlatformService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import {
  assertAdminPermission,
  resolveHallScopeFilter,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import {
  buildTopPlayers,
  clampLimit,
  TOP_PLAYERS_MAX_LIMIT,
} from "../admin/reports/TopPlayersLookup.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-players-top" });

export interface AdminPlayersTopRouterDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
}

/** How many PLAYER-rows we pull before ranking. Keep this bounded. */
const CANDIDATE_POOL_CAP = 1000;

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createAdminPlayersTopRouter(deps: AdminPlayersTopRouterDeps): express.Router {
  const { platformService, walletAdapter } = deps;
  const router = express.Router();

  async function requireUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, "DAILY_REPORT_READ");
    return user;
  }

  router.get("/api/admin/players/top", async (req, res) => {
    try {
      const user = await requireUser(req);

      // Metric: legacy only supports `wallet` (sort by current balance desc).
      // We accept `?metric=wallet` explicitly for forward-compat, but any
      // other value → 400 so callers can't silently get the wrong ranking.
      const metric = optionalNonEmptyString(req.query.metric) ?? "wallet";
      if (metric !== "wallet") {
        throw new DomainError(
          "INVALID_INPUT",
          `metric '${metric}' er ikke støttet. Kun 'wallet' er tilgjengelig.`,
        );
      }

      // Hall-scope: HALL_OPERATOR tvinges til egen hall; ADMIN/SUPPORT kan
      // velge å filtrere med ?hallId=<id>.
      const hallIdInput = optionalNonEmptyString(req.query.hallId);
      const hallId = resolveHallScopeFilter(user, hallIdInput);

      const limit = clampLimit(req.query.limit);

      // Pull candidate pool. `listPlayersForExport` already filters to
      // role=PLAYER + excludes soft-deleted. Bots-eksklusjon matcher legacy
      // Mongo-query `userType: { $ne: "Bot" }` — PlatformService har ingen
      // Bot-rolle (Bot finnes ikke i app_users i Postgres-schemaet), så
      // role=PLAYER er allerede tilstrekkelig.
      const players = await platformService.listPlayersForExport({
        hallId,
        includeDeleted: false,
        limit: CANDIDATE_POOL_CAP,
      });

      // Parallelle balance-oppslag. Bruker `Promise.allSettled` så én feilet
      // wallet (f.eks. race på soft-delete) ikke dreper hele responsen —
      // builderen tolker ukjente walletIds som 0 og sorterer dem bakerst.
      const balances = new Map<string, number>();
      if (players.length > 0) {
        const results = await Promise.allSettled(
          players.map((p) => walletAdapter.getBalance(p.walletId)),
        );
        results.forEach((result, idx) => {
          const player = players[idx]!;
          if (result.status === "fulfilled") {
            balances.set(player.walletId, result.value);
          } else {
            logger.warn(
              { walletId: player.walletId, userId: player.id, err: result.reason },
              "BIN-618: wallet balance lookup failed — defaulting to 0",
            );
          }
        });
      }

      // Avatars: legacy field is `profilePic` on the player-row. Postgres
      // `app_users` doesn't carry an avatar column today, so we read from
      // `complianceData.profilePic` if populated (best-effort — falsy stays
      // undefined and the admin-web widget falls back to the stock image).
      const avatars = collectAvatars(players);

      const response = buildTopPlayers({
        players,
        balances,
        avatars,
        limit,
      });

      apiSuccess(res, response);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}

function collectAvatars(players: AppUser[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of players) {
    const compliance = p.complianceData;
    if (compliance && typeof compliance === "object") {
      const raw = (compliance as Record<string, unknown>).profilePic;
      if (typeof raw === "string" && raw.trim().length > 0) {
        map.set(p.id, raw.trim());
      }
    }
  }
  return map;
}

/** Exported for reuse by RBAC meta-test. */
export const TOP_PLAYERS_LIMIT_CAP = TOP_PLAYERS_MAX_LIMIT;
