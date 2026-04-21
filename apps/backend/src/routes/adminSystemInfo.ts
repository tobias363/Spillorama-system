/**
 * BIN-678: admin-router for system-info (diagnostikk).
 *
 * Endepunkt:
 *   GET /api/admin/system/info
 *
 * Returnerer runtime-diagnostikk for ops-team:
 *   - `version`     : npm-pakke-versjon (fra package.json)
 *   - `buildSha`    : siste git-SHA (fra GIT_SHA env eller git rev-parse ved boot)
 *   - `buildTime`   : ISO-timestamp for siste build (fra BUILD_TIME env eller boot)
 *   - `nodeVersion` : process.version
 *   - `env`         : NODE_ENV
 *   - `uptime`      : sekunder siden server-start
 *   - `features`    : feature-flag map (BIN-678: kun flaggene som er
 *     eksplisitt konfigurert via env; verdien er `true`/`false` basert på
 *     parseBooleanEnv).
 *
 * Rolle-krav: SETTINGS_READ (ADMIN + HALL_OPERATOR + SUPPORT) — samme som
 * andre diagnostiske/ops-read endepunkter. Read-only, ingen audit-log.
 *
 * Designvalg:
 *   - buildSha og buildTime snappes ved server-start (ikke per request) så
 *     hvert kall er O(1) og uten shell-invokasjon. Prod-deploys setter
 *     `GIT_SHA` og `BUILD_TIME` env-vars; dev-fallback kaller `git rev-parse
 *     HEAD` én gang og cacher resultatet.
 *   - Ingen PII/audit-data eksponeres — dette er rene build-metadata.
 */

import express from "express";
import { execFileSync } from "node:child_process";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import {
  assertAdminPermission,
  type AdminPermission,
} from "../platform/AdminAccessPolicy.js";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "admin-system-info" });

export interface SystemInfoSnapshot {
  version: string;
  buildSha: string;
  buildTime: string;
  nodeVersion: string;
  env: string;
  uptime: number;
  features: Record<string, boolean>;
}

export interface AdminSystemInfoRouterDeps {
  platformService: PlatformService;
  /**
   * Optional snapshot overrides. Tests inject deterministic values; prod
   * leaves this empty and relies on env + git + process.
   */
  overrides?: {
    version?: string;
    buildSha?: string;
    buildTime?: string;
    nodeVersion?: string;
    env?: string;
    now?: () => number;
    startTimeMs?: number;
    features?: Record<string, boolean>;
  };
}

/** Load the feature-flag map from env. Only keys present in env are surfaced. */
function loadFeatureFlagsFromEnv(): Record<string, boolean> {
  const entries: Array<[string, boolean]> = [];
  for (const [key, raw] of Object.entries(process.env)) {
    if (!key.startsWith("FEATURE_")) continue;
    if (typeof raw !== "string") continue;
    const flagKey = key.slice("FEATURE_".length).toLowerCase();
    if (!flagKey) continue;
    const parsed = parseBoolean(raw);
    entries.push([flagKey, parsed]);
  }
  return Object.fromEntries(entries);
}

function parseBoolean(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

/**
 * Resolve the build-SHA. Prefers env (set by deploy pipeline), falls back
 * to `git rev-parse HEAD` from the process CWD, otherwise "unknown".
 */
function resolveBuildSha(): string {
  const fromEnv = process.env.GIT_SHA ?? process.env.RENDER_GIT_COMMIT;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    return out.trim();
  } catch {
    return "unknown";
  }
}

function resolveBuildTime(): string {
  const fromEnv = process.env.BUILD_TIME;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    const ms = Date.parse(fromEnv.trim());
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  // Fallback: boot-time of current process (rough approximation of build-time
  // for single-deploy environments).
  return new Date().toISOString();
}

function resolveVersion(): string {
  const fromEnv = process.env.APP_VERSION ?? process.env.npm_package_version;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return "0.0.0";
}

export function createAdminSystemInfoRouter(
  deps: AdminSystemInfoRouterDeps
): express.Router {
  const { platformService, overrides = {} } = deps;
  const router = express.Router();

  // Snap build-metadata once at router-wiring time — subsequent requests
  // read from these locals and never re-invoke git / process.
  const cachedVersion = overrides.version ?? resolveVersion();
  const cachedBuildSha = overrides.buildSha ?? resolveBuildSha();
  const cachedBuildTime = overrides.buildTime ?? resolveBuildTime();
  const cachedNodeVersion = overrides.nodeVersion ?? process.version;
  const cachedEnv =
    overrides.env ?? process.env.NODE_ENV ?? "development";
  const cachedFeatures = overrides.features ?? loadFeatureFlagsFromEnv();
  const startTimeMs = overrides.startTimeMs ?? Date.now();
  const nowFn = overrides.now ?? (() => Date.now());

  async function requirePermission(
    req: express.Request,
    permission: AdminPermission
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    assertAdminPermission(user.role, permission);
    return user;
  }

  router.get("/api/admin/system/info", async (req, res) => {
    try {
      await requirePermission(req, "SETTINGS_READ");
      const uptime = Math.max(0, Math.floor((nowFn() - startTimeMs) / 1000));
      const snapshot: SystemInfoSnapshot = {
        version: cachedVersion,
        buildSha: cachedBuildSha,
        buildTime: cachedBuildTime,
        nodeVersion: cachedNodeVersion,
        env: cachedEnv,
        uptime,
        features: { ...cachedFeatures },
      };
      apiSuccess(res, snapshot);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // Log wiring info once — helpful for post-deploy sanity-check of SHA.
  logger.info(
    {
      version: cachedVersion,
      buildSha: cachedBuildSha,
      env: cachedEnv,
      nodeVersion: cachedNodeVersion,
    },
    "[BIN-678] admin-system-info router wired"
  );

  return router;
}
