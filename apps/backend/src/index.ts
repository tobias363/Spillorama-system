import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { createWalletAdapter } from "./adapters/createWalletAdapter.js";
import { LocalBingoSystemAdapter } from "./adapters/LocalBingoSystemAdapter.js";
import { PostgresBingoSystemAdapter } from "./adapters/PostgresBingoSystemAdapter.js";
import { LocalKycAdapter } from "./adapters/LocalKycAdapter.js";
import { BankIdKycAdapter } from "./adapters/BankIdKycAdapter.js";
import { BingoEngine, DomainError } from "./game/BingoEngine.js";
import { PostgresResponsibleGamingStore } from "./game/PostgresResponsibleGamingStore.js";
import type { GameSnapshot, Player, RoomSnapshot } from "./game/types.js";
import { PlatformService } from "./platform/PlatformService.js";
import { SwedbankPayService } from "./payments/SwedbankPayService.js";
import { DrawScheduler } from "./draw-engine/DrawScheduler.js";
import { SocketRateLimiter } from "./middleware/socketRateLimit.js";
import { HttpRateLimiter } from "./middleware/httpRateLimit.js";
import { register as promRegister, metrics as promMetrics } from "./util/metrics.js";
import { createExternalGameWalletRouter } from "./integration/externalGameWallet.js";
import { InMemoryRoomStateStore, type RoomStateStore } from "./store/RoomStateStore.js";
import { RedisRoomStateStore } from "./store/RedisRoomStateStore.js";
import { RedisSchedulerLock } from "./store/RedisSchedulerLock.js";
import { apiSuccess, apiFailure, mustBeNonEmptyString } from "./util/httpHelpers.js";
import { parseBingoSettingsPatch, normalizeBingoSchedulerSettings } from "./util/bingoSettings.js";
import { getPrimaryRoomForHall, findPlayerInRoomByWallet, buildRoomUpdatePayload as buildRoomUpdatePayloadHelper, buildLeaderboard as buildLeaderboardHelper, type RoomUpdatePayload } from "./util/roomHelpers.js";
import { RoomStateManager } from "./util/roomState.js";
import { toDrawSchedulerSettings, createSchedulerCallbacks, createDailyReportScheduler, type PendingBingoSettingsUpdate } from "./util/schedulerSetup.js";
import { loadBingoRuntimeConfig } from "./util/envConfig.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAdminRouter } from "./routes/admin.js";
import { createWalletRouter } from "./routes/wallet.js";
import { createPaymentsRouter } from "./routes/payments.js";
import { createGameRouter } from "./routes/game.js";
import { createGameEventHandlers } from "./sockets/gameEvents.js";
import { initSentry, setSocketSentryContext, addBreadcrumb, captureError, flushSentry } from "./observability/sentry.js";
import { errorReporter } from "./middleware/errorReporter.js";
import { PostgresChatMessageStore, type ChatMessageStore } from "./store/ChatMessageStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const frontendDir = path.resolve(__dirname, "../../frontend");
const publicDir = path.resolve(__dirname, "../public");
const adminFrontendFile = path.resolve(frontendDir, "admin/index.html");
const projectDir = path.resolve(__dirname, "../..");

// BIN-539: Sentry — init before the HTTP server exists so the error reporter
// is wired from the first request. No-op if SENTRY_DSN is unset.
void initSentry();

const app = express();

// BIN-49: CORS — require explicit origins in production, never allow wildcard "*"
const corsAllowedOriginsRaw = (process.env.CORS_ALLOWED_ORIGINS ?? "").trim();
const isProduction = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
if (isProduction && !corsAllowedOriginsRaw) {
  console.error("FATAL: CORS_ALLOWED_ORIGINS must be set in production. Refusing to start with wildcard CORS.");
  process.exit(1);
}
const corsOrigins: string[] | "*" = corsAllowedOriginsRaw
  ? corsAllowedOriginsRaw.split(",").map((o) => o.trim()).filter(Boolean)
  : "*";
app.use(cors({ origin: corsOrigins, credentials: true }));
// LAV-3: 100 KB for all endpoints, except registration which carries compressed photo IDs (~2 * 100KB base64)
app.use((req, _res, next) => {
  express.json({ limit: req.path === "/api/auth/register" ? "5mb" : "100kb" })(req, _res, next);
});

// BIN-277: REST API rate limiting — sliding-window per IP per route tier
const httpRateLimiter = new HttpRateLimiter();
httpRateLimiter.start();
app.use(httpRateLimiter.middleware());

// BIN-278: Root redirects to web shell (must be before express.static)
app.get(["/", "/index.html"], (_req, res) => { res.redirect(302, "/web/"); });
app.use("/admin", express.static(path.join(frontendDir, "admin")));
app.use(express.static(publicDir));

const server = http.createServer(app);
const io = new Server(server, {
  allowEIO3: true,
  cors: { origin: corsOrigins, credentials: true },
  maxHttpBufferSize: 100 * 1024, // LAV-3: 100 KB — prevents oversized payloads
  pingInterval: 60000,  // 60s — Unity WebGL WebSocket needs longer heartbeat window
  pingTimeout: 60000,   // 60s — total 120s before disconnect
});

const walletRuntime = createWalletAdapter(projectDir);
const walletAdapter = walletRuntime.adapter;

// External game wallet bridge (Candy/demo-backend calls these)
const extGameWalletApiKey = (process.env.EXT_GAME_WALLET_API_KEY ?? "").trim();
if (extGameWalletApiKey) {
  app.use("/api/ext-wallet", createExternalGameWalletRouter({ walletAdapter, apiKey: extGameWalletApiKey }));
}

const platformConnectionString =
  process.env.APP_PG_CONNECTION_STRING?.trim() || process.env.WALLET_PG_CONNECTION_STRING?.trim();
if (!platformConnectionString) {
  throw new DomainError("INVALID_CONFIG", "Mangler APP_PG_CONNECTION_STRING (eller WALLET_PG_CONNECTION_STRING) for auth/plattform.");
}

// ── Load env config ───────────────────────────────────────────────────────────

const cfg = loadBingoRuntimeConfig();
const {
  bingoMinRoundIntervalMs, bingoDailyLossLimit, bingoMonthlyLossLimit, bingoPlaySessionLimitMs,
  bingoPauseDurationMs, bingoSelfExclusionMinMs, bingoMaxDrawsPerRound,
  isProductionRuntime, bingoMinPlayersToStart, fixedAutoDrawIntervalMs,
  allowAutoplayInProduction, forceAutoStart, forceAutoDraw, enforceSingleRoomPerHall,
  autoplayAllowed, schedulerTickMs, dailyReportJobEnabled, dailyReportJobIntervalMs,
  usePostgresBingoAdapter, checkpointConnectionString, roomStateProvider, redisUrl, useRedisLock,
  kycMinAge, kycProvider, pgSsl, pgSchema, sessionTtlHours,
} = cfg;

// runtimeBingoSettings is mutable — Object.assign is used to update it in-place
const runtimeBingoSettings = cfg.runtimeBingoSettings;
let bingoSettingsEffectiveFromMs = Date.now();
let pendingBingoSettingsUpdate: PendingBingoSettingsUpdate | null = null;
const bingoSettingsConstraints = { fixedAutoDrawIntervalMs, bingoMinRoundIntervalMs, bingoMinPlayersToStart, autoplayAllowed, forceAutoStart, forceAutoDraw };

// ── Infrastructure ────────────────────────────────────────────────────────────

const localBingoAdapter = usePostgresBingoAdapter
  ? new PostgresBingoSystemAdapter({ connectionString: checkpointConnectionString, schema: pgSchema, ssl: pgSsl })
  : new LocalBingoSystemAdapter();

const roomStateStore: RoomStateStore = roomStateProvider === "redis" ? new RedisRoomStateStore({ url: redisUrl }) : new InMemoryRoomStateStore();
const redisSchedulerLock = useRedisLock ? new RedisSchedulerLock({ url: redisUrl }) : null;

const responsibleGamingStore = platformConnectionString.length > 0
  ? new PostgresResponsibleGamingStore({ connectionString: platformConnectionString, schema: pgSchema, ssl: pgSsl })
  : undefined;

const engine = new BingoEngine(localBingoAdapter, walletAdapter, {
  minRoundIntervalMs: bingoMinRoundIntervalMs, minPlayersToStart: bingoMinPlayersToStart,
  dailyLossLimit: bingoDailyLossLimit, monthlyLossLimit: bingoMonthlyLossLimit,
  playSessionLimitMs: bingoPlaySessionLimitMs, pauseDurationMs: bingoPauseDurationMs,
  selfExclusionMinMs: bingoSelfExclusionMinMs, maxDrawsPerRound: bingoMaxDrawsPerRound,
  persistence: responsibleGamingStore, roomStateStore
});

// BIN-274: Configurable KYC provider
const bankIdAdapter = kycProvider === "bankid"
  ? new BankIdKycAdapter({ clientId: process.env.BANKID_CLIENT_ID ?? "", clientSecret: process.env.BANKID_CLIENT_SECRET ?? "", authority: process.env.BANKID_AUTHORITY ?? "https://login.bankid.no", redirectUri: process.env.BANKID_REDIRECT_URI ?? "", minAgeYears: kycMinAge })
  : null;
const kycAdapter = bankIdAdapter ?? new LocalKycAdapter({ minAgeYears: kycMinAge });

const platformService = new PlatformService(walletAdapter, {
  connectionString: platformConnectionString,
  schema: pgSchema,
  sessionTtlHours,
  minAgeYears: kycMinAge,
  kycAdapter,
});

// BIN-516: chat persistence. Postgres-backed when the platform pool is up,
// in-memory fallback for dev-without-DB so chat:history still works.
const chatMessageStore: ChatMessageStore = new PostgresChatMessageStore({
  pool: platformService.getPool(),
  schema: pgSchema,
});

const swedbankPayService = new SwedbankPayService(walletAdapter, {
  connectionString: platformConnectionString, schema: pgSchema,
  apiBaseUrl: process.env.SWEDBANK_PAY_API_BASE_URL,
  accessToken: process.env.SWEDBANK_PAY_ACCESS_TOKEN,
  payeeId: process.env.SWEDBANK_PAY_PAYEE_ID,
  payeeName: process.env.SWEDBANK_PAY_PAYEE_NAME,
  productName: process.env.SWEDBANK_PAY_PRODUCT_NAME,
  currency: process.env.SWEDBANK_PAY_CURRENCY,
  language: process.env.SWEDBANK_PAY_LANGUAGE,
  merchantBaseUrl: process.env.SWEDBANK_PAY_MERCHANT_BASE_URL,
  callbackUrl: process.env.SWEDBANK_PAY_CALLBACK_URL,
  completeUrl: process.env.SWEDBANK_PAY_COMPLETE_URL,
  cancelUrl: process.env.SWEDBANK_PAY_CANCEL_URL,
  termsOfServiceUrl: process.env.SWEDBANK_PAY_TERMS_URL,
  requestTimeoutMs: Number(process.env.SWEDBANK_PAY_REQUEST_TIMEOUT_MS ?? "10000"),
});

// ── Shared mutable room state ─────────────────────────────────────────────────

const roomState = new RoomStateManager();

// ── Shared helpers ────────────────────────────────────────────────────────────

function getRoomConfiguredEntryFee(roomCode: string): number {
  return roomState.getRoomConfiguredEntryFee(roomCode, runtimeBingoSettings.autoRoundEntryFee);
}

function buildRoomUpdatePayload(snapshot: RoomSnapshot, nowMs = Date.now()): RoomUpdatePayload {
  return buildRoomUpdatePayloadHelper(snapshot, nowMs, {
    runtimeBingoSettings, drawScheduler, bingoMaxDrawsPerRound, schedulerTickMs,
    getArmedPlayerIds: (code) => roomState.getArmedPlayerIds(code),
    getArmedPlayerTicketCounts: (code) => roomState.getArmedPlayerTicketCounts(code),
    getArmedPlayerSelections: (code) => roomState.getArmedPlayerSelections(code),
    getRoomConfiguredEntryFee,
    getOrCreateDisplayTickets: (code, id, count) => roomState.getOrCreateDisplayTickets(code, id, count),
    getLuckyNumbers: (code) => roomState.getLuckyNumbers(code),
    getVariantConfig: (code) => roomState.getVariantConfig(code),
  });
}

async function emitRoomUpdate(roomCode: string): Promise<RoomUpdatePayload> {
  const payload = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
  io.to(roomCode).emit("room:update", payload);
  return payload;
}

async function emitManyRoomUpdates(roomCodes: Iterable<string>): Promise<void> {
  for (const roomCode of roomCodes) await emitRoomUpdate(roomCode);
}

async function emitWalletRoomUpdates(walletIds: string[]): Promise<void> {
  const affectedRooms = new Set<string>();
  for (const walletId of walletIds) {
    const codes = await engine.refreshPlayerBalancesForWallet(walletId);
    for (const code of codes) affectedRooms.add(code);
  }
  await emitManyRoomUpdates(affectedRooms);
}

async function requireActiveHallIdFromInput(input: unknown): Promise<string> {
  const hall = await platformService.requireActiveHall(mustBeNonEmptyString(input, "hallId"));
  return hall.id;
}

async function resolveBingoHallGameConfigForRoom(roomCode: string): Promise<{ hallId: string; maxTicketsPerPlayer: number }> {
  const snapshot = engine.getRoomSnapshot(roomCode);
  const configs = await platformService.listHallGameConfigs({ hallId: snapshot.hallId, includeDisabled: true });
  const bingoConfig = configs.find((c) => c.gameSlug === "bingo");
  if (!bingoConfig) return { hallId: snapshot.hallId, maxTicketsPerPlayer: 5 };
  if (!bingoConfig.isEnabled) throw new DomainError("GAME_DISABLED_FOR_HALL", "Bingo er deaktivert for valgt hall.");
  return { hallId: snapshot.hallId, maxTicketsPerPlayer: bingoConfig.maxTicketsPerPlayer };
}

function assertUserCanActAsPlayer(user: { role: string; walletId: string }, roomCode: string, playerId: string): void {
  const snapshot = engine.getRoomSnapshot(roomCode);
  const player = snapshot.players.find((e) => e.id === playerId);
  if (!player) throw new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke i rommet.");
  if (user.role === "ADMIN") return;
  if (player.walletId !== user.walletId) throw new DomainError("FORBIDDEN", "Du kan bare utføre handlinger for egen spiller.");
}

function assertUserCanAccessRoom(user: { role: string; walletId: string }, roomCode: string): void {
  if (user.role === "ADMIN") return;
  const snapshot = engine.getRoomSnapshot(roomCode);
  if (!snapshot.players.some((p) => p.walletId === user.walletId)) throw new DomainError("FORBIDDEN", "Du har ikke tilgang til dette rommet.");
}

function buildLeaderboard(roomCode?: string): Array<{ nickname: string; points: number }> {
  const codes = roomCode ? [roomCode] : engine.getAllRoomCodes();
  return buildLeaderboardHelper(codes, (code) => engine.getRoomSnapshot(code));
}

async function persistBingoSettingsToCatalog(): Promise<void> { return Promise.resolve(); }

// ── DrawScheduler ─────────────────────────────────────────────────────────────

let drawScheduler: DrawScheduler;

const schedulerCallbacks = createSchedulerCallbacks({
  engine, io,
  get drawScheduler() { return drawScheduler; },
  runtimeBingoSettings,
  getArmedPlayerIds: (code) => roomState.getArmedPlayerIds(code),
  getArmedPlayerTicketCounts: (code) => roomState.getArmedPlayerTicketCounts(code),
  getArmedPlayerSelections: (code) => roomState.getArmedPlayerSelections(code),
  getRoomConfiguredEntryFee,
  disarmAllPlayers: (code) => roomState.disarmAllPlayers(code),
  clearDisplayTicketCache: (code) => roomState.clearDisplayTicketCache(code),
  buildRoomUpdatePayload,
  emitRoomUpdate,
  emitManyRoomUpdates,
  persistBingoSettingsToCatalog,
  getPendingBingoSettingsUpdate: () => pendingBingoSettingsUpdate,
  setPendingBingoSettingsUpdate: (u) => { pendingBingoSettingsUpdate = u; },
  getBingoSettingsEffectiveFromMs: () => bingoSettingsEffectiveFromMs,
  setBingoSettingsEffectiveFromMs: (ms) => { bingoSettingsEffectiveFromMs = ms; },
});

drawScheduler = new DrawScheduler({
  tickIntervalMs: schedulerTickMs, lockTimeoutMs: 5_000, watchdogIntervalMs: 5_000, watchdogStuckMultiplier: 3,
  fixedDrawIntervalMs: fixedAutoDrawIntervalMs, enforceSingleRoomPerHall,
  getSettings: () => toDrawSchedulerSettings(runtimeBingoSettings),
  listRoomSummaries: () => engine.listRoomSummaries(),
  getRoomSnapshot: (code) => engine.getRoomSnapshot(code),
  getAllRoomCodes: () => engine.getAllRoomCodes(),
  ...schedulerCallbacks,
});
drawScheduler.start();

const dailyReportScheduler = createDailyReportScheduler({ engine, enabled: dailyReportJobEnabled, intervalMs: dailyReportJobIntervalMs });

// ── Mount routers ─────────────────────────────────────────────────────────────

const bingoSettingsState = {
  runtimeBingoSettings,
  get effectiveFromMs() { return bingoSettingsEffectiveFromMs; },
  set effectiveFromMs(v) { bingoSettingsEffectiveFromMs = v; },
  get pendingUpdate() { return pendingBingoSettingsUpdate; },
  set pendingUpdate(v) { pendingBingoSettingsUpdate = v; },
};

app.use(createAuthRouter({ platformService, walletAdapter, bankIdAdapter }));

app.use(createAdminRouter({
  platformService, engine, io, drawScheduler, bingoSettingsState, responsibleGamingStore,
  localBingoAdapter: (usePostgresBingoAdapter ? localBingoAdapter : null) as { getGameSession?: (id: string) => Promise<unknown>; getGameTimeline?: (id: string) => Promise<unknown> } | null,
  usePostgresBingoAdapter, enforceSingleRoomPerHall, bingoMinRoundIntervalMs, bingoMinPlayersToStart,
  bingoMaxDrawsPerRound, fixedAutoDrawIntervalMs, forceAutoStart, forceAutoDraw, isProductionRuntime,
  autoplayAllowed, allowAutoplayInProduction, schedulerTickMs,
  emitRoomUpdate, emitManyRoomUpdates, emitWalletRoomUpdates, buildRoomUpdatePayload,
  persistBingoSettingsToCatalog,
  normalizeBingoSchedulerSettings: (current, patch) => normalizeBingoSchedulerSettings(current, patch, bingoSettingsConstraints),
  parseBingoSettingsPatch: (value) => parseBingoSettingsPatch(value, bingoSettingsConstraints),
  getRoomConfiguredEntryFee,
  getArmedPlayerIds: (code) => roomState.getArmedPlayerIds(code),
  disarmAllPlayers: (code) => roomState.disarmAllPlayers(code),
  clearDisplayTicketCache: (code) => roomState.clearDisplayTicketCache(code),
  roomConfiguredEntryFeeByRoom: roomState.roomConfiguredEntryFeeByRoom,
  getPrimaryRoomForHall: (hallId) => getPrimaryRoomForHall(hallId, engine.listRoomSummaries()),
  resolveBingoHallGameConfigForRoom,
}));

app.use(createWalletRouter({ platformService, engine, walletAdapter, swedbankPayService, emitWalletRoomUpdates }));
app.use(createPaymentsRouter({ platformService, swedbankPayService, emitWalletRoomUpdates }));
app.use(createGameRouter({ platformService, engine, drawScheduler, emitRoomUpdate, buildRoomUpdatePayload, assertUserCanAccessRoom, assertUserCanActAsPlayer }));

// ── Prometheus + health ───────────────────────────────────────────────────────

// BIN-172: Prometheus metrics endpoint
app.get("/metrics", async (_req, res) => {
  try {
    const roomSummaries = engine.listRoomSummaries();
    promMetrics.activeRooms.set(roomSummaries.length);
    promMetrics.activePlayers.set(roomSummaries.reduce((sum, r) => sum + r.playerCount, 0));
    promMetrics.stuckRooms.set((drawScheduler.healthSummary().drawWatchdog as { stuckRooms?: number } | undefined)?.stuckRooms ?? 0);
    promMetrics.socketConnections.set(io.engine.clientsCount ?? 0);
    res.set("Content-Type", promRegister.contentType);
    res.end(await promRegister.metrics());
  } catch (err) { res.status(500).end(String(err)); }
});

app.get("/health", async (_req, res) => {
  try {
    const [wallets, games, halls] = await Promise.all([walletAdapter.listAccounts(), platformService.listGames({ includeDisabled: true }), platformService.listHalls({ includeInactive: true })]);
    apiSuccess(res, { rooms: engine.getAllRoomCodes().length, wallets: wallets.length, games: games.length, halls: halls.length, walletProvider: walletRuntime.provider, swedbankConfigured: swedbankPayService.isConfigured(), ...drawScheduler.healthSummary(), timestamp: new Date().toISOString() });
  } catch (error) { apiFailure(res, error); }
});

app.get("/health/draw-engine", (_req, res) => {
  const isLocalhost = _req.ip === "127.0.0.1" || _req.ip === "::1" || _req.ip === "::ffff:127.0.0.1";
  const hasToken = _req.headers.authorization === `Bearer ${process.env.ADMIN_API_TOKEN ?? ""}`;
  if (!isLocalhost && !hasToken && process.env.NODE_ENV === "production") { res.status(403).json({ ok: false, error: "Forbidden" }); return; }
  apiSuccess(res, drawScheduler.healthSummary(true));
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

// BIN-494: Redis adapter for multi-node fanout. Required for horizontal scaling —
// io.to(roomCode).emit(...) does not reach clients on sibling nodes without it.
// Fallback to in-memory when REDIS_URL is unset (single-node dev).
const rawRedisUrl = process.env.REDIS_URL?.trim();
let socketIoPubClient: Redis | null = null;
let socketIoSubClient: Redis | null = null;
if (rawRedisUrl) {
  socketIoPubClient = new Redis(rawRedisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
  socketIoSubClient = socketIoPubClient.duplicate();
  socketIoPubClient.on("error", (err) => console.error("[socket.io] redis pub error", err));
  socketIoSubClient.on("error", (err) => console.error("[socket.io] redis sub error", err));
  io.adapter(createAdapter(socketIoPubClient, socketIoSubClient));
  console.log(`[socket.io] redis-adapter ENABLED (${rawRedisUrl.replace(/\/\/[^@]*@/, "//***@")}) — multi-node fanout active`);
} else {
  console.warn("[socket.io] redis-adapter DISABLED (no REDIS_URL) — multi-node fanout will not work");
}

// BIN-164: Socket.IO rate limiter — prevents event flooding per socket
const socketRateLimiter = new SocketRateLimiter();
socketRateLimiter.start();

// BIN-237/KRITISK-7: Connection-time authentication middleware.
io.use(async (socket, next) => {
  // BIN-303: IP-based connection rate limit
  const xForwardedFor = socket.handshake.headers["x-forwarded-for"];
  const ip = (typeof xForwardedFor === "string" ? xForwardedFor.split(",")[0].trim() : null) ?? socket.handshake.address ?? "unknown";
  if (!socketRateLimiter.checkConnection(ip)) return next(new Error("TOO_MANY_CONNECTIONS: For mange tilkoblinger fra denne adressen. Prøv igjen om litt."));

  const handshakeToken =
    (typeof socket.handshake.auth?.accessToken === "string" ? socket.handshake.auth.accessToken.trim() : "") ||
    (typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token.trim() : "") ||
    (typeof socket.handshake.query?.token === "string" ? (socket.handshake.query.token as string).trim() : "");

  if (handshakeToken) {
    try {
      const user = await platformService.getUserFromAccessToken(handshakeToken);
      socket.data.user = user;
      socket.data.authenticated = true;
      // HOEY-9: Register player identity for player-based rate limiting.
      if (user.walletId) socketRateLimiter.registerPlayer(socket.id, user.walletId);
      // BIN-539: Tag the socket with hashed identifiers for Sentry.
      setSocketSentryContext(socket, { walletId: user.walletId, hallId: (user as { hallId?: string }).hallId });
      addBreadcrumb("socket.connected", { socketId: socket.id, hashedWalletId: socket.data.sentry?.walletIdHash });
    } catch (err) {
      return next(new Error(`UNAUTHORIZED: ${err instanceof DomainError ? err.message : "Autentisering feilet"}`));
    }
  } else {
    socket.data.authenticated = false;
  }
  next();
});

const registerGameEvents = createGameEventHandlers({
  engine, platformService, io, socketRateLimiter,
  emitRoomUpdate, emitManyRoomUpdates, buildRoomUpdatePayload,
  enforceSingleRoomPerHall, runtimeBingoSettings,
  chatHistoryByRoom: roomState.chatHistoryByRoom,
  luckyNumbersByRoom: roomState.luckyNumbersByRoom,
  armedPlayerIdsByRoom: roomState.armedPlayerIdsByRoom,
  roomConfiguredEntryFeeByRoom: roomState.roomConfiguredEntryFeeByRoom,
  displayTicketCache: roomState.displayTicketCache,
  getPrimaryRoomForHall: (hallId) => getPrimaryRoomForHall(hallId, engine.listRoomSummaries()),
  findPlayerInRoomByWallet,
  getRoomConfiguredEntryFee,
  getArmedPlayerIds: (code) => roomState.getArmedPlayerIds(code),
  getArmedPlayerTicketCounts: (code) => roomState.getArmedPlayerTicketCounts(code),
  getArmedPlayerSelections: (code) => roomState.getArmedPlayerSelections(code),
  armPlayer: (code, id, ticketCount, selections) => roomState.armPlayer(code, id, ticketCount, selections),
  disarmPlayer: (code, id) => roomState.disarmPlayer(code, id),
  disarmAllPlayers: (code) => roomState.disarmAllPlayers(code),
  clearDisplayTicketCache: (code) => roomState.clearDisplayTicketCache(code),
  replaceDisplayTicket: (code, id, ticketId, slug) => roomState.replaceDisplayTicket(code, id, ticketId, slug),
  resolveBingoHallGameConfigForRoom, requireActiveHallIdFromInput, buildLeaderboard,
  getVariantConfig: (code) => roomState.getVariantConfig(code),
  chatMessageStore,
});

io.on("connection", (socket: Socket) => { registerGameEvents(socket); });

// ── Debug/test endpoint — room gap detection (localhost-only) ─────────────────
app.get("/api/room-gap/:code", (req, res) => {
  try {
    // Try exact code first, then fall back to auto-discovering any active room
    const tryCode = (code: string) => {
      const snap = engine.getRoomSnapshot(code);
      const gameStatus = snap.currentGame?.status ?? null;
      const isRunning = gameStatus === "RUNNING";
      return { ok: true, hasCurrentGame: !!snap.currentGame, isRunning, gameStatus, gameId: snap.currentGame?.id ?? null, code };
    };
    try { return res.json(tryCode(req.params.code.toUpperCase())); } catch {}
    const codes = engine.getAllRoomCodes();
    if (codes.length > 0) return res.json(tryCode(codes[0]));
    res.json({ ok: false, hasCurrentGame: false, gameId: null, code: null, availableCodes: [] });
  } catch (e: any) { res.json({ ok: false, hasCurrentGame: false, gameId: null, error: e?.message }); }
});

// ── Fallback routes ───────────────────────────────────────────────────────────

app.get("*", (_req, res) => {
  if (_req.path === "/admin" || _req.path === "/admin/") { res.sendFile(adminFrontendFile); return; }
  res.sendFile(path.join(publicDir, "web/index.html"));
});

// BIN-539: Express error reporter — must be registered after all routes.
// Captures any thrown error, forwards to Sentry (when enabled), and sends a
// consistent `{ ok: false, error }` response so clients can rely on shape.
app.use(errorReporter());

// ── Server start ──────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4000);

(async () => {
  try {
    await engine.hydratePersistentState();
    console.log("[responsible-gaming] persisted state hydrated");
  } catch (error) {
    console.error("[responsible-gaming] failed to hydrate persisted state", error);
    process.exit(1);
    return;
  }

  dailyReportScheduler.start();

  // BIN-170: Load rooms from Redis on startup (if Redis provider)
  if (roomStateProvider === "redis") {
    try {
      const loaded = await roomStateStore.loadAll();
      if (loaded > 0) console.log(`[BIN-170] Loaded ${loaded} room(s) from Redis`);
    } catch (err) { console.error("[BIN-170] Failed to load rooms from Redis:", err); }
  }

  // BIN-245: Crash recovery — restore game state from latest checkpoint snapshot.
  if (usePostgresBingoAdapter && localBingoAdapter instanceof PostgresBingoSystemAdapter) {
    try {
      const incompleteGames = await localBingoAdapter.findIncompleteGames();
      let restored = 0; let ended = 0;
      for (const game of incompleteGames) {
        try {
          const checkpointData = await localBingoAdapter.getLatestCheckpointData(game.gameId);
          const snapshot = checkpointData?.snapshot as GameSnapshot | null;
          const players = (Array.isArray(checkpointData?.players) ? checkpointData.players : []) as Player[];
          if (snapshot && Array.isArray(snapshot.drawBag)) {
            engine.restoreRoomFromSnapshot(game.roomCode, game.hallId ?? "", players[0]?.id ?? "recovered", players, snapshot);
            restored++;
          } else {
            console.warn(`[BIN-245] No snapshot for game ${game.gameId} in room ${game.roomCode} — marking ENDED`);
            await localBingoAdapter.markGameEnded(game.gameId, "CRASH_RECOVERY"); ended++;
          }
        } catch (err) {
          console.error(`[BIN-245] Failed to restore game ${game.gameId} in room ${game.roomCode}:`, err);
          try { await localBingoAdapter.markGameEnded(game.gameId, "CRASH_RECOVERY"); } catch { /* best effort */ }
          ended++;
        }
      }
      if (restored + ended > 0) console.warn(`[BIN-245] Recovery complete: ${restored} game(s) restored, ${ended} game(s) ended`);
    } catch (err) { console.error("[BIN-245] Crash recovery failed:", err); }
  }

  server.listen(PORT, () => {
    console.log(`Bingo backend kjører på http://localhost:${PORT}`);
    console.log(`[compliance] minRoundInterval=${bingoMinRoundIntervalMs}ms minPlayersToStart=${bingoMinPlayersToStart} maxDrawsPerRound=${bingoMaxDrawsPerRound} dailyLoss=${bingoDailyLossLimit} monthlyLoss=${bingoMonthlyLossLimit} playSessionLimit=${bingoPlaySessionLimitMs}ms pauseDuration=${bingoPauseDurationMs}ms selfExclusionMin=${bingoSelfExclusionMinMs}ms`);
    console.log(`[scheduler] autoStart=${runtimeBingoSettings.autoRoundStartEnabled} autoDraw=${runtimeBingoSettings.autoDrawEnabled} forceAutoStart=${forceAutoStart} forceAutoDraw=${forceAutoDraw} autoAllowedInProd=${allowAutoplayInProduction} singleRoomPerHall=${enforceSingleRoomPerHall} interval=${runtimeBingoSettings.autoRoundStartIntervalMs}ms minPlayers=${runtimeBingoSettings.autoRoundMinPlayers} ticketsPerPlayer=${runtimeBingoSettings.autoRoundTicketsPerPlayer} entryFee=${runtimeBingoSettings.autoRoundEntryFee} payoutPercent=${runtimeBingoSettings.payoutPercent}`);
    console.log(`[scheduler] autoDraw=${runtimeBingoSettings.autoDrawEnabled} interval=${runtimeBingoSettings.autoDrawIntervalMs}ms tick=${schedulerTickMs}ms`);
    console.log(`[daily-report] enabled=${dailyReportJobEnabled} interval=${dailyReportJobIntervalMs}ms`);
    console.log(`[swedbank] configured=${swedbankPayService.isConfigured()}`);
  });
})();

// ── Graceful shutdown ──────────────────────────────────────────────────────────
let shutdownStarted = false;
function handleShutdown(signal: string) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.info(`[shutdown] Received ${signal}. Starting graceful shutdown...`);
  httpRateLimiter.stop();
  socketRateLimiter.stop();
  dailyReportScheduler.stop();
  drawScheduler.gracefulStop()
    .then(async () => {
      await roomStateStore.shutdown();
      if (redisSchedulerLock) await redisSchedulerLock.shutdown();
      if (responsibleGamingStore) await responsibleGamingStore.shutdown();
      // BIN-494: close Socket.IO Redis adapter clients
      if (socketIoPubClient) { try { await socketIoPubClient.quit(); } catch { /* best effort */ } }
      if (socketIoSubClient) { try { await socketIoSubClient.quit(); } catch { /* best effort */ } }
      server.close(() => { console.info("[shutdown] HTTP server closed. Exiting."); process.exit(0); });
      setTimeout(() => { console.warn("[shutdown] Forced exit after timeout."); process.exit(1); }, 10_000).unref();
    })
    .catch((error) => { console.error("[shutdown] Error during graceful shutdown:", error); process.exit(1); });
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
  captureError(reason, { source: "unhandledRejection" });
  void flushSentry(2000).finally(() => handleShutdown("unhandledRejection"));
});
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
  captureError(error, { source: "uncaughtException" });
  void flushSentry(2000).finally(() => handleShutdown("uncaughtException"));
});
