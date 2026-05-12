/**
 * BIN-814 / R7 — Per-room health endpoints for Spill 1, 2 og 3.
 *
 * Mandat-ref: `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
 * §3.4 R7. Alerting (R8) bygger på dette grunnlaget — ops, monitoring og
 * admin-UI skal alltid kunne se sann live-state for hvert rom uten gjetting.
 *
 * Endepunkter:
 *   GET /api/games/spill1/health?hallId=...   → Spill 1 (bingo)
 *   GET /api/games/spill2/health?hallId=...   → Spill 2 (rocket, perpetual loop)
 *   GET /api/games/spill3/health?hallId=...   → Spill 3 (monsterbingo singleton)
 *
 * Sikkerhetsmodell:
 *   - INGEN auth (offentlige observerbarhets-endpoints).
 *   - Rate-limit 60/min per IP (router-lokal sliding-window). Settes
 *     strammere enn `/api/`-tieren (120/min) i `httpRateLimit.ts` for å
 *     beskytte mot støy under hendelser samtidig som monitoring-systemer
 *     med ~10s polling per rom har god margin.
 *   - Cache-Control: `no-cache, max-age=0` — kallere skal alltid se
 *     fersk state. Vi cacher hverken klient- eller proxy-side.
 *
 * Status-mapping (per BIN-814):
 *   - "ok"        : komponentene er friske og rommet/lobbyen oppfører seg
 *                   normalt. Lobby-rom uten aktiv runde innenfor åpningstid
 *                   regnes som `ok` (venter på neste planlagte spill).
 *   - "degraded"  : aktiv runde men minst én underliggende komponent svikter
 *                   (Redis nede, draw-stale, DB-feil mens vi fortsatt har
 *                   tilkoblede klienter, etc.).
 *   - "down"      : rom forventes lukket (utenfor åpningstid + ingen aktiv
 *                   runde) eller hovedavhengighet (DB) svikter helt.
 *
 * Output-shape (lik på alle 3 endepunkter):
 *   ```json
 *   {
 *     "ok": true,
 *     "data": {
 *       "status": "ok"|"degraded"|"down",
 *       "lastDrawAge": <sek siden siste trekning, eller null>,
 *       "connectedClients": <antall socket-clients>,
 *       "currentPhase": "idle"|"running"|"paused"|"finished",
 *       "currentPosition": <plan-position, eller null>,
 *       "authority": "scheduled-db"|"perpetual-engine",
 *       "expectedRoomCode": "<kanonisk rom-kode, eller null>",
 *       "engineRoomExists": <bool>,
 *       "scheduledGameId": "<scheduled DB-id, eller null>",
 *       "currentGameId": "<engine currentGame.id, eller null>",
 *       "drawIndex": <0-basert indeks for siste trekk, eller null>,
 *       "schedulerOwner": "scheduled"|"perpetual",
 *       "mismatchStatus": "ok"|"...",
 *       "instanceId": "<backend-instans-id>",
 *       "redisHealthy": <bool>,
 *       "dbHealthy": <bool>,
 *       "nextScheduledStart": "<ISO-time, eller null>",
 *       "withinOpeningHours": <bool>,
 *       "p95SocketRoundtripMs": <ms eller null>,
 *       "checkedAt": "<ISO>"
 *     }
 *   }
 *   ```
 *
 * Implementasjonsnotat:
 *   - `Game1LobbyService` (PR #1018) er IKKE merget til main ennå. Spill 1-
 *     pathen leser direkte fra `app_game1_scheduled_games` + engine room-
 *     state for å unngå avhengighet på en ikke-eksisterende fil. Når PR
 *     #1018 lander kan vi forenkle ved å delegere til `Game1LobbyService`.
 *   - `p95SocketRoundtripMs` returneres som `null` fordi vi ikke har en
 *     tilstrekkelig metric-backend i dag. R5/R8 kan fylle dette inn senere.
 *   - Lavt `lastDrawAge`-tall ved `currentPhase === "idle"` betyr at vi
 *     nettopp har avsluttet en runde og venter på neste — dette er ikke
 *     `degraded`.
 */

import express from "express";
import os from "node:os";
import type { Pool } from "pg";
import type { Server as IoServer } from "socket.io";

import type { BingoEngine } from "../game/BingoEngine.js";
import type { Spill2ConfigService } from "../game/Spill2ConfigService.js";
import { isWithinOpeningHours as isWithinSpill2OpeningHours } from "../game/Spill2ConfigService.js";
import type { Spill3ConfigService } from "../game/Spill3ConfigService.js";
import { isWithinOpeningWindow as isWithinSpill3OpeningWindow } from "../game/Spill3ConfigService.js";
import { apiSuccess, apiFailure } from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "public-game-health" });

/**
 * Cache-Control header — vi vil aldri at klient eller mellom-cache skal
 * bevare svaret. Endepunktet er per BIN-814-spec begrenset til 200ms
 * respons-tid, men data må aldri være mer enn 5 sek gammel.
 */
const CACHE_CONTROL_HEADER = "no-cache, max-age=0, must-revalidate";

/**
 * Per-IP rate-limit for health-endpointet (60 req/min). Over global
 * `/api/`-tier (120/min) for å gi monitoring-systemer plass til
 * polling, men fortsatt beskyttet mot støy.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

/** Stale-draw-terskel — over denne regnes en aktiv runde som degraded. */
const DRAW_STALE_THRESHOLD_SEC = 30;

/**
 * Faste game-slugs per Spill — matcher samme verdier som `RoomState.gameSlug`
 * og admin-side enums. Kun disse tre er gyldige for R7.
 */
const SPILL1_SLUG = "bingo";
const SPILL2_SLUG = "rocket";
const SPILL3_SLUG = "monsterbingo";
const SPILL2_EXPECTED_ROOM_CODE = "ROCKET";
const SPILL3_EXPECTED_ROOM_CODE = "MONSTERBINGO";

/**
 * Faste plan-faser. Speiler `currentPhase`-feltet i mandatet — `idle` =
 * ingen aktiv runde, `running` = aktivt trekk pågår, `paused` = manuell
 * pause, `finished` = runde nettopp avsluttet.
 */
type HealthPhase = "idle" | "running" | "paused" | "finished";

/** Status-rangering per mandatet. */
type HealthStatus = "ok" | "degraded" | "down";
type HealthAuthority = "scheduled-db" | "perpetual-engine";
type SchedulerOwner = "scheduled" | "perpetual";
type MismatchStatus =
  | "ok"
  | "missing_engine_room"
  | "unexpected_engine_room"
  | "duplicate_engine_rooms"
  | "scheduled_game_mismatch";

interface HealthResponseData {
  status: HealthStatus;
  /** Sekunder siden siste trekning. `null` hvis ingen runde har kjørt enda. */
  lastDrawAge: number | null;
  connectedClients: number;
  currentPhase: HealthPhase;
  /** Plan-position (Spill 1 — pos i game-plan-runen). `null` for Spill 2/3. */
  currentPosition: number | null;
  /** Hvilket kontrollplan som er autoritativt for rom/runde. */
  authority: HealthAuthority;
  /** Forventet kanonisk engine-room. Spill 1: fra schedule.room_code hvis satt. */
  expectedRoomCode: string | null;
  /** Finnes forventet engine-room, eller minst ett relevant rom hvis ingen forventet kode. */
  engineRoomExists: boolean;
  /** Spill 1 scheduled-game-id fra DB. Spill 2/3 er perpetual og returnerer null. */
  scheduledGameId: string | null;
  /** Nåværende engine-game-id fra valgt live room. */
  currentGameId: string | null;
  /** 0-basert drawIndex for siste draw på wire; null før første draw. */
  drawIndex: number | null;
  /** Eier av scheduler/tick-loop for dette spillet. */
  schedulerOwner: SchedulerOwner;
  /** Maskinlesbar indikasjon på schedule/engine/romkode-avvik. */
  mismatchStatus: MismatchStatus;
  instanceId: string;
  redisHealthy: boolean;
  dbHealthy: boolean;
  /** ISO-tid for neste planlagte runde. `null` hvis ingen er planlagt. */
  nextScheduledStart: string | null;
  withinOpeningHours: boolean;
  /**
   * P95-socket-roundtrip i ms (over siste 5 min). Returneres som `null`
   * inntil R5/R8-metrikker er på plass.
   */
  p95SocketRoundtripMs: number | null;
  checkedAt: string;
}

export interface PublicGameHealthRouterDeps {
  pool: Pool;
  schema: string;
  engine: BingoEngine;
  io: IoServer;
  spill2ConfigService: Spill2ConfigService;
  spill3ConfigService: Spill3ConfigService;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mini sliding-window rate-limiter. Per-IP, in-memory. */
class HealthRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  check(ip: string, nowMs: number = Date.now()): {
    allowed: boolean;
    retryAfterMs: number;
  } {
    const bucket = this.buckets.get(ip) ?? [];
    const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
    while (bucket.length > 0 && bucket[0] <= cutoff) bucket.shift();
    if (bucket.length >= RATE_LIMIT_MAX_REQUESTS) {
      const oldest = bucket[0];
      const retryAfterMs = oldest + RATE_LIMIT_WINDOW_MS - nowMs;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
    }
    bucket.push(nowMs);
    this.buckets.set(ip, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Periodic GC to prevent memory leak under sustained traffic. */
  gc(nowMs: number = Date.now()): void {
    const cutoff = nowMs - RATE_LIMIT_WINDOW_MS * 2;
    for (const [ip, bucket] of this.buckets) {
      while (bucket.length > 0 && bucket[0] <= cutoff) bucket.shift();
      if (bucket.length === 0) this.buckets.delete(ip);
    }
  }
}

/** Quick `SELECT 1` to verify Postgres connectivity. */
async function checkDatabaseHealthy(pool: Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    log.warn({ err }, "[health] DB SELECT 1 failed");
    return false;
  }
}

/**
 * Try to verify Redis connectivity via the socket.io adapter. Socket.io's
 * Redis adapter exposes the Pub/Sub clients via `io.of('/').adapter`. If
 * we can't read `.serverCount()` or it throws, we treat Redis as down.
 *
 * For in-memory adapter (no Redis configured), we always return `true`
 * since "no Redis configured" ≠ "Redis unhealthy". Mandate R7 assumes
 * Redis is the source of truth in prod; dev/test with in-memory is OK.
 */
async function checkRedisHealthy(io: IoServer): Promise<boolean> {
  try {
    const adapter = io.of("/").adapter as unknown as {
      serverCount?: () => Promise<number>;
    };
    if (typeof adapter.serverCount !== "function") {
      // In-memory adapter — Redis not configured. Treat as healthy.
      return true;
    }
    await adapter.serverCount();
    return true;
  } catch (err) {
    log.warn({ err }, "[health] Redis serverCount failed");
    return false;
  }
}

/**
 * Count socket.io clients currently joined to any of the given room codes.
 * For Spill 2/3 there is typically one global room; for Spill 1 lobby
 * there can be several (one per scheduled game). Returns 0 if the room
 * is not known to the adapter.
 */
function countClientsInRooms(io: IoServer, roomCodes: string[]): number {
  if (roomCodes.length === 0) return 0;
  const adapter = io.of("/").adapter as unknown as {
    rooms?: Map<string, Set<string>>;
  };
  if (!adapter.rooms) return 0;
  let total = 0;
  for (const code of roomCodes) {
    total += adapter.rooms.get(code)?.size ?? 0;
  }
  return total;
}

/** Map BingoEngine room status → public health-phase. */
function phaseFromRoomStatus(
  status: "WAITING" | "RUNNING" | "ENDED" | "NONE",
  isPaused: boolean,
): HealthPhase {
  if (isPaused) return "paused";
  switch (status) {
    case "RUNNING":
      return "running";
    case "ENDED":
      return "finished";
    case "WAITING":
    case "NONE":
    default:
      return "idle";
  }
}

interface RoomLiveSnapshot {
  /** Socket-room-koder å summere connected-clients fra. */
  roomCodes: string[];
  /** ms siden siste draw, eller null hvis ingen pågående runde. */
  lastDrawAgeMs: number | null;
  phase: HealthPhase;
  currentGameId: string | null;
  drawIndex: number | null;
}

interface Spill1ScheduleInfo {
  scheduledGameId: string | null;
  expectedRoomCode: string | null;
  currentPosition: number | null;
  nextScheduledStart: string | null;
}

/**
 * Aggregate live state across all rooms with the given gameSlug + hallId.
 * Spill 1 is per-hall; Spill 2/3 are global (`isHallShared=true`).
 *
 * For shared rooms vi summerer alle rom med matching slug uavhengig av hall.
 */
function aggregateLiveState(
  engine: BingoEngine,
  gameSlug: string,
  hallId: string,
  isShared: boolean,
): RoomLiveSnapshot {
  const summaries = engine.listRoomSummaries();
  const matched = summaries.filter((s) => {
    if (s.gameSlug !== gameSlug) return false;
    if (isShared) return Boolean(s.isHallShared);
    return s.hallId === hallId && !s.isHallShared;
  });

  if (matched.length === 0) {
    return {
      roomCodes: [],
      lastDrawAgeMs: null,
      phase: "idle",
      currentGameId: null,
      drawIndex: null,
    };
  }

  // Velg det "mest aktive" rommet for fase-rapport — RUNNING > WAITING > ENDED.
  const priority: Record<string, number> = {
    RUNNING: 3,
    WAITING: 2,
    NONE: 1,
    ENDED: 0,
  };
  matched.sort(
    (a, b) => (priority[b.gameStatus] ?? 0) - (priority[a.gameStatus] ?? 0),
  );
  const top = matched[0];

  // Inspect snapshot for paused-flag + draw-timing.
  let phase: HealthPhase = "idle";
  let lastDrawAgeMs: number | null = null;
  let currentGameId: string | null = null;
  let drawIndex: number | null = null;
  try {
    const snap = engine.getRoomSnapshot(top.code);
    const game = snap.currentGame;
    if (game) {
      currentGameId = game.id;
      drawIndex =
        game.drawnNumbers.length > 0 ? game.drawnNumbers.length - 1 : null;
      phase = phaseFromRoomStatus(game.status, Boolean(game.isPaused));
      // BingoEngine sin DrawOrchestrationService eksponerer __getLastDrawAt.
      // Vi når den via the protected drawOrchestrationService-felt — bruk
      // public hook hvis tilgjengelig, ellers fall back til startedAt.
      const orch = (engine as unknown as {
        drawOrchestrationService?: { __getLastDrawAt?: (code: string) => number | undefined };
      }).drawOrchestrationService;
      const lastDrawTs =
        typeof orch?.__getLastDrawAt === "function"
          ? orch.__getLastDrawAt(top.code)
          : undefined;
      if (typeof lastDrawTs === "number") {
        lastDrawAgeMs = Date.now() - lastDrawTs;
      } else if (game.startedAt) {
        lastDrawAgeMs = Date.now() - new Date(game.startedAt).getTime();
      }
    }
  } catch (err) {
    // Room kan være borte mellom listRoomSummaries og getRoomSnapshot pga
    // race med destroyRoom — log og rapporter idle.
    log.warn({ err, code: top.code }, "[health] getRoomSnapshot raced");
  }

  return {
    roomCodes: matched.map((s) => s.code),
    lastDrawAgeMs,
    phase,
    currentGameId,
    drawIndex,
  };
}

/** Hent control-plane metadata for neste/aktive Spill 1-runde for en gitt hall. */
async function fetchSpill1ScheduleInfo(
  pool: Pool,
  schema: string,
  hallId: string,
): Promise<Spill1ScheduleInfo> {
  // Validér schema-navnet for å unngå SQL-injeksjon (samme guard som
  // eksisterende services). Rådata mappes som ISO-string.
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error("Invalid schema name");
  }
  try {
    const result = await pool.query(
      `SELECT id, room_code, plan_position, scheduled_start_time
         FROM "${schema}"."app_game1_scheduled_games"
        WHERE master_hall_id = $1
          AND status IN ('scheduled','purchase_open','ready_to_start','running','paused')
        ORDER BY scheduled_start_time ASC
        LIMIT 1`,
      [hallId],
    );
    const row = result.rows[0];
    if (!row) {
      return {
        scheduledGameId: null,
        expectedRoomCode: null,
        currentPosition: null,
        nextScheduledStart: null,
      };
    }
    const ts =
      row.scheduled_start_time instanceof Date
        ? row.scheduled_start_time
        : new Date(String(row.scheduled_start_time));
    return {
      scheduledGameId:
        typeof row.id === "string" && row.id.trim() ? row.id.trim() : null,
      expectedRoomCode:
        typeof row.room_code === "string" && row.room_code.trim()
          ? row.room_code.trim().toUpperCase()
          : null,
      currentPosition:
        typeof row.plan_position === "number" ? row.plan_position : null,
      nextScheduledStart: ts.toISOString(),
    };
  } catch (err) {
    log.warn({ err, hallId }, "[health] fetchSpill1ScheduleInfo failed");
    return {
      scheduledGameId: null,
      expectedRoomCode: null,
      currentPosition: null,
      nextScheduledStart: null,
    };
  }
}

function deriveMismatchStatus(args: {
  expectedRoomCode: string | null;
  roomCodes: string[];
  scheduledGameId: string | null;
  currentGameId: string | null;
}): MismatchStatus {
  const { expectedRoomCode, roomCodes, scheduledGameId, currentGameId } = args;
  if (scheduledGameId && currentGameId && scheduledGameId !== currentGameId) {
    return "scheduled_game_mismatch";
  }
  if (!expectedRoomCode) return "ok";
  const expectedExists = roomCodes.includes(expectedRoomCode);
  if (!expectedExists) return "missing_engine_room";
  if (roomCodes.length > 1) return "duplicate_engine_rooms";
  if (roomCodes.some((code) => code !== expectedRoomCode)) {
    return "unexpected_engine_room";
  }
  return "ok";
}

/**
 * Status-mapping logic — kombinér phase, åpningstid og health-flagger
 * til én av "ok" / "degraded" / "down".
 *
 * Beslutninger:
 *   1. dbHealthy=false → "down" (DB er hovedavhengighet).
 *   2. Aktiv runde (running/paused) men redis nede ELLER stale-draw → "degraded".
 *   3. Utenfor åpningstid OG ingen aktiv runde → "down" (forventet stengt).
 *   4. Innenfor åpningstid men ingen aktiv runde → "ok" (venter på neste spill).
 *   5. Aktiv runde uten problemer → "ok".
 */
function deriveStatus(args: {
  phase: HealthPhase;
  withinOpeningHours: boolean;
  redisHealthy: boolean;
  dbHealthy: boolean;
  lastDrawAgeMs: number | null;
}): HealthStatus {
  const { phase, withinOpeningHours, redisHealthy, dbHealthy, lastDrawAgeMs } =
    args;

  if (!dbHealthy) return "down";

  const hasActiveRound = phase === "running" || phase === "paused";

  if (hasActiveRound) {
    if (!redisHealthy) return "degraded";
    if (
      phase === "running" &&
      lastDrawAgeMs !== null &&
      lastDrawAgeMs > DRAW_STALE_THRESHOLD_SEC * 1000
    ) {
      return "degraded";
    }
    return "ok";
  }

  // No active round.
  if (!withinOpeningHours) return "down";
  if (!redisHealthy) return "degraded";
  return "ok";
}

/** Konverter ms → sekunder, eller null hvis input er null. */
function msToSec(ms: number | null): number | null {
  if (ms === null) return null;
  return Math.floor(ms / 1000);
}

/** Validate og parse `?hallId=` — returnér 400 hvis missing/feil. */
function parseHallId(req: express.Request): string | null {
  const raw = req.query.hallId;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  // Maks 120 tegn matchet `assertHallId`-konvensjonen.
  if (raw.length > 120) return null;
  return raw.trim();
}

// ── Router factory ─────────────────────────────────────────────────────────

export function createPublicGameHealthRouter(
  deps: PublicGameHealthRouterDeps,
): express.Router {
  const { pool, schema, engine, io, spill2ConfigService, spill3ConfigService } =
    deps;
  const router = express.Router();
  const limiter = new HealthRateLimiter();
  const instanceId = process.env.RENDER_INSTANCE_ID ?? `${os.hostname()}-${process.pid}`;

  // Periodic GC for the rate-limit map.
  const gcTimer = setInterval(() => limiter.gc(), 60_000);
  if (gcTimer.unref) gcTimer.unref();

  // ── Rate-limit middleware (router-local) ─────────────────────────────────
  router.use((req, res, next) => {
    // Tobias-direktiv 2026-05-12: dev-stack må aldri rate-limit-e seg selv.
    // Når NODE_ENV != production → bypass. Rate-limit i dev/staging er mot
    // tester-team, ikke spillere. Prod (Render) setter NODE_ENV=production.
    if ((process.env["NODE_ENV"] ?? "").trim().toLowerCase() !== "production") {
      return next();
    }
    // Path-scope-fix 2026-05-12: router er mounted top-level (uten prefix),
    // så `router.use(...)` fyrte for ALLE paths — også `/api/games`,
    // `/api/wallet`, etc. Det førte til 429 på endpoints som ikke har noen
    // health-endpoint i det hele tatt. Begrens til faktiske health-paths.
    if (!req.path.startsWith("/api/games/spill")) {
      return next();
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const result = limiter.check(ip);
    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      res.set("Retry-After", String(retryAfterSec));
      res.status(429).json({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: `For mange forespørsler. Prøv igjen om ${retryAfterSec} sekunder.`,
        },
      });
      return;
    }
    next();
  });

  // ── GET /api/games/spill1/health ────────────────────────────────────────
  router.get("/api/games/spill1/health", async (req, res) => {
    res.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
    const hallId = parseHallId(req);
    if (!hallId) {
      apiFailure(res, new Error("INVALID_INPUT: hallId query-param mangler."));
      return;
    }
    try {
      // Spill 1 har ikke en sentral "config service" med åpningstider per
      // hall — vi bruker schedule-basert logikk: rommet er innenfor
      // "åpningstid" hvis det er en planlagt runde i kjøretid (today,
      // master_hall_id=hallId). For nå antar vi alltid `true` siden
      // åpningstid styres av schedule-management; alerting (R8) kan
      // raffinere ved behov.
      const withinOpeningHours = true;
      const liveState = aggregateLiveState(engine, SPILL1_SLUG, hallId, false);
      const [dbHealthy, redisHealthy, scheduleInfo] = await Promise.all([
        checkDatabaseHealthy(pool),
        checkRedisHealthy(io),
        fetchSpill1ScheduleInfo(pool, schema, hallId),
      ]);
      const engineRoomExists = scheduleInfo.expectedRoomCode
        ? liveState.roomCodes.includes(scheduleInfo.expectedRoomCode)
        : liveState.roomCodes.length > 0;
      const data: HealthResponseData = {
        status: deriveStatus({
          phase: liveState.phase,
          withinOpeningHours,
          redisHealthy,
          dbHealthy,
          lastDrawAgeMs: liveState.lastDrawAgeMs,
        }),
        lastDrawAge: msToSec(liveState.lastDrawAgeMs),
        connectedClients: countClientsInRooms(io, liveState.roomCodes),
        currentPhase: liveState.phase,
        currentPosition: scheduleInfo.currentPosition,
        authority: "scheduled-db",
        expectedRoomCode: scheduleInfo.expectedRoomCode,
        engineRoomExists,
        scheduledGameId: scheduleInfo.scheduledGameId,
        currentGameId: liveState.currentGameId,
        drawIndex: liveState.drawIndex,
        schedulerOwner: "scheduled",
        mismatchStatus: deriveMismatchStatus({
          expectedRoomCode: scheduleInfo.expectedRoomCode,
          roomCodes: liveState.roomCodes,
          scheduledGameId: scheduleInfo.scheduledGameId,
          currentGameId: liveState.currentGameId,
        }),
        instanceId,
        redisHealthy,
        dbHealthy,
        nextScheduledStart: scheduleInfo.nextScheduledStart,
        withinOpeningHours,
        // TODO(R8): integrer mot socket-roundtrip-metric når R5 lander.
        p95SocketRoundtripMs: null,
        checkedAt: new Date().toISOString(),
      };
      apiSuccess(res, data);
    } catch (err) {
      log.warn({ err, hallId }, "[health] /api/games/spill1/health failed");
      apiFailure(res, err);
    }
  });

  // ── GET /api/games/spill2/health ────────────────────────────────────────
  router.get("/api/games/spill2/health", async (req, res) => {
    res.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
    const hallId = parseHallId(req);
    if (!hallId) {
      apiFailure(res, new Error("INVALID_INPUT: hallId query-param mangler."));
      return;
    }
    try {
      const [config, dbHealthy, redisHealthy] = await Promise.all([
        spill2ConfigService.getActive().catch((err) => {
          log.warn({ err }, "[health] Spill2Config.getActive failed");
          return null;
        }),
        checkDatabaseHealthy(pool),
        checkRedisHealthy(io),
      ]);
      const withinOpeningHours = config
        ? isWithinSpill2OpeningHours(config)
        : false;
      const liveState = aggregateLiveState(engine, SPILL2_SLUG, hallId, true);
      const engineRoomExists = liveState.roomCodes.includes(
        SPILL2_EXPECTED_ROOM_CODE,
      );
      const data: HealthResponseData = {
        status: deriveStatus({
          phase: liveState.phase,
          withinOpeningHours,
          redisHealthy,
          dbHealthy,
          lastDrawAgeMs: liveState.lastDrawAgeMs,
        }),
        lastDrawAge: msToSec(liveState.lastDrawAgeMs),
        connectedClients: countClientsInRooms(io, liveState.roomCodes),
        currentPhase: liveState.phase,
        // Spill 2 har ikke plan-position-konseptet — perpetual loop.
        currentPosition: null,
        authority: "perpetual-engine",
        expectedRoomCode: SPILL2_EXPECTED_ROOM_CODE,
        engineRoomExists,
        scheduledGameId: null,
        currentGameId: liveState.currentGameId,
        drawIndex: liveState.drawIndex,
        schedulerOwner: "perpetual",
        mismatchStatus: deriveMismatchStatus({
          expectedRoomCode: SPILL2_EXPECTED_ROOM_CODE,
          roomCodes: liveState.roomCodes,
          scheduledGameId: null,
          currentGameId: liveState.currentGameId,
        }),
        instanceId,
        redisHealthy,
        dbHealthy,
        // Spill 2 er perpetual (ingen "neste planlagte start" — neste
        // runde spawn'es av PerpetualRoundService når threshold møtes).
        nextScheduledStart: null,
        withinOpeningHours,
        p95SocketRoundtripMs: null,
        checkedAt: new Date().toISOString(),
      };
      apiSuccess(res, data);
    } catch (err) {
      log.warn({ err, hallId }, "[health] /api/games/spill2/health failed");
      apiFailure(res, err);
    }
  });

  // ── GET /api/games/spill3/health ────────────────────────────────────────
  router.get("/api/games/spill3/health", async (req, res) => {
    res.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
    const hallId = parseHallId(req);
    if (!hallId) {
      apiFailure(res, new Error("INVALID_INPUT: hallId query-param mangler."));
      return;
    }
    try {
      const [config, dbHealthy, redisHealthy] = await Promise.all([
        spill3ConfigService.getActive().catch((err) => {
          log.warn({ err }, "[health] Spill3Config.getActive failed");
          return null;
        }),
        checkDatabaseHealthy(pool),
        checkRedisHealthy(io),
      ]);
      const withinOpeningHours = config
        ? isWithinSpill3OpeningWindow(config)
        : false;
      const liveState = aggregateLiveState(engine, SPILL3_SLUG, hallId, true);
      const engineRoomExists = liveState.roomCodes.includes(
        SPILL3_EXPECTED_ROOM_CODE,
      );
      const data: HealthResponseData = {
        status: deriveStatus({
          phase: liveState.phase,
          withinOpeningHours,
          redisHealthy,
          dbHealthy,
          lastDrawAgeMs: liveState.lastDrawAgeMs,
        }),
        lastDrawAge: msToSec(liveState.lastDrawAgeMs),
        connectedClients: countClientsInRooms(io, liveState.roomCodes),
        currentPhase: liveState.phase,
        currentPosition: null,
        authority: "perpetual-engine",
        expectedRoomCode: SPILL3_EXPECTED_ROOM_CODE,
        engineRoomExists,
        scheduledGameId: null,
        currentGameId: liveState.currentGameId,
        drawIndex: liveState.drawIndex,
        schedulerOwner: "perpetual",
        mismatchStatus: deriveMismatchStatus({
          expectedRoomCode: SPILL3_EXPECTED_ROOM_CODE,
          roomCodes: liveState.roomCodes,
          scheduledGameId: null,
          currentGameId: liveState.currentGameId,
        }),
        instanceId,
        redisHealthy,
        dbHealthy,
        nextScheduledStart: null,
        withinOpeningHours,
        p95SocketRoundtripMs: null,
        checkedAt: new Date().toISOString(),
      };
      apiSuccess(res, data);
    } catch (err) {
      log.warn({ err, hallId }, "[health] /api/games/spill3/health failed");
      apiFailure(res, err);
    }
  });

  return router;
}

// ── Test-eksport ───────────────────────────────────────────────────────────
//
// Pure-helper-eksport for unit-tester. Ikke en del av offentlig API —
// signaturene kan endres uten varsel.

/** @internal Visible for testing — pure status-mapping. */
export const __testExports = {
  deriveStatus,
  deriveMismatchStatus,
  phaseFromRoomStatus,
  msToSec,
  DRAW_STALE_THRESHOLD_SEC,
  SPILL2_EXPECTED_ROOM_CODE,
  SPILL3_EXPECTED_ROOM_CODE,
};
