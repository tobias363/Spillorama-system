import cors from "cors";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { createWalletAdapter } from "./adapters/createWalletAdapter.js";
import { LocalBingoSystemAdapter } from "./adapters/LocalBingoSystemAdapter.js";
import { LocalKycAdapter } from "./adapters/LocalKycAdapter.js";
import { assertTicketsPerPlayerWithinHallLimit } from "./game/compliance.js";
import { BingoEngine, DomainError, toPublicError } from "./game/BingoEngine.js";
import type { ClaimType, RoomSnapshot } from "./game/types.js";
import { PlatformService, type PublicAppUser } from "./platform/PlatformService.js";
import { SwedbankPayService } from "./payments/SwedbankPayService.js";

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface AuthenticatedSocketPayload {
  accessToken?: string;
}

interface RoomActionPayload extends AuthenticatedSocketPayload {
  roomCode: string;
  playerId: string;
}

interface CreateRoomPayload extends AuthenticatedSocketPayload {
  playerName?: string;
  walletId?: string;
  hallId?: string;
}

interface JoinRoomPayload extends CreateRoomPayload {
  roomCode: string;
}

interface ResumeRoomPayload extends RoomActionPayload {}

interface StartGamePayload extends RoomActionPayload {
  entryFee?: number;
  ticketsPerPlayer?: number;
}

interface EndGamePayload extends RoomActionPayload {
  reason?: string;
}

interface MarkPayload extends RoomActionPayload {
  number: number;
}

interface ClaimPayload extends RoomActionPayload {
  type: ClaimType;
}

interface RoomStatePayload extends AuthenticatedSocketPayload {
  roomCode: string;
}

interface ExtraDrawPayload extends RoomActionPayload {
  requestedCount?: number;
  packageId?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "../../frontend");
const projectDir = path.resolve(__dirname, "../..");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(frontendDir));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const walletRuntime = createWalletAdapter(projectDir);
const walletAdapter = walletRuntime.adapter;
const platformConnectionString =
  process.env.APP_PG_CONNECTION_STRING?.trim() || process.env.WALLET_PG_CONNECTION_STRING?.trim();
if (!platformConnectionString) {
  throw new DomainError(
    "INVALID_CONFIG",
    "Mangler APP_PG_CONNECTION_STRING (eller WALLET_PG_CONNECTION_STRING) for auth/plattform."
  );
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseNonNegativeNumberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

const bingoMinRoundIntervalMs = Math.max(
  30000,
  parsePositiveIntEnv(process.env.BINGO_MIN_ROUND_INTERVAL_MS, 30000)
);
const bingoDailyLossLimit = parseNonNegativeNumberEnv(process.env.BINGO_DAILY_LOSS_LIMIT, 900);
const bingoMonthlyLossLimit = parseNonNegativeNumberEnv(process.env.BINGO_MONTHLY_LOSS_LIMIT, 4400);
const bingoPlaySessionLimitMs = parsePositiveIntEnv(
  process.env.BINGO_PLAY_SESSION_LIMIT_MS,
  60 * 60 * 1000
);
const bingoPauseDurationMs = parsePositiveIntEnv(process.env.BINGO_PAUSE_DURATION_MS, 5 * 60 * 1000);
const bingoSelfExclusionMinMs = Math.max(
  365 * 24 * 60 * 60 * 1000,
  parsePositiveIntEnv(process.env.BINGO_SELF_EXCLUSION_MIN_MS, 365 * 24 * 60 * 60 * 1000)
);

const isProductionRuntime = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
const requestedAutoRoundStartEnabled = parseBooleanEnv(process.env.AUTO_ROUND_START_ENABLED, true);
const requestedAutoDrawEnabled = parseBooleanEnv(process.env.AUTO_DRAW_ENABLED, true);
const autoRoundStartEnabled = isProductionRuntime ? false : requestedAutoRoundStartEnabled;
const autoRoundStartIntervalMs = Math.max(
  bingoMinRoundIntervalMs,
  parsePositiveIntEnv(process.env.AUTO_ROUND_START_INTERVAL_MS, bingoMinRoundIntervalMs)
);
const autoRoundEntryFee = parseNonNegativeNumberEnv(process.env.AUTO_ROUND_ENTRY_FEE, 0);
const autoRoundMinPlayers = Math.max(2, parsePositiveIntEnv(process.env.AUTO_ROUND_MIN_PLAYERS, 2));
const autoRoundTicketsPerPlayer = Math.min(
  5,
  Math.max(1, parsePositiveIntEnv(process.env.AUTO_ROUND_TICKETS_PER_PLAYER, 4))
);
const autoDrawEnabled = isProductionRuntime ? false : requestedAutoDrawEnabled;
const autoDrawIntervalMs = parsePositiveIntEnv(process.env.AUTO_DRAW_INTERVAL_MS, 1200);
const schedulerTickMs = parsePositiveIntEnv(process.env.AUTO_ROUND_SCHEDULER_TICK_MS, 250);

if (isProductionRuntime && (requestedAutoRoundStartEnabled || requestedAutoDrawEnabled)) {
  console.warn("[scheduler] Autoplay er deaktivert i production (AUTO_ROUND_START_ENABLED/AUTO_DRAW_ENABLED ignoreres).");
}

const engine = new BingoEngine(new LocalBingoSystemAdapter(), walletAdapter, {
  minRoundIntervalMs: bingoMinRoundIntervalMs,
  dailyLossLimit: bingoDailyLossLimit,
  monthlyLossLimit: bingoMonthlyLossLimit,
  playSessionLimitMs: bingoPlaySessionLimitMs,
  pauseDurationMs: bingoPauseDurationMs,
  selfExclusionMinMs: bingoSelfExclusionMinMs
});

const platformService = new PlatformService(walletAdapter, {
  connectionString: platformConnectionString,
  schema: process.env.APP_PG_SCHEMA?.trim() || process.env.WALLET_PG_SCHEMA?.trim() || "public",
  sessionTtlHours: parsePositiveIntEnv(process.env.AUTH_SESSION_TTL_HOURS, 24 * 7),
  minAgeYears: Math.max(18, parsePositiveIntEnv(process.env.KYC_MIN_AGE_YEARS, 18)),
  kycAdapter: new LocalKycAdapter({
    minAgeYears: Math.max(18, parsePositiveIntEnv(process.env.KYC_MIN_AGE_YEARS, 18))
  })
});

const swedbankPayService = new SwedbankPayService(walletAdapter, {
  connectionString: platformConnectionString,
  schema: process.env.APP_PG_SCHEMA?.trim() || process.env.WALLET_PG_SCHEMA?.trim() || "public",
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
  requestTimeoutMs: parsePositiveIntEnv(process.env.SWEDBANK_PAY_REQUEST_TIMEOUT_MS, 10000)
});

function ackSuccess<T>(callback: (response: AckResponse<T>) => void, data: T): void {
  callback({ ok: true, data });
}

function ackFailure<T>(callback: (response: AckResponse<T>) => void, error: unknown): void {
  callback({
    ok: false,
    error: toPublicError(error)
  });
}

function mustBeNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
  }
  return value.trim();
}

function mustBePositiveAmount(value: unknown, fieldName = "amount"): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være større enn 0.`);
  }
  return amount;
}

function parseOptionalNonNegativeAmount(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new DomainError("INVALID_INPUT", "initialBalance må være 0 eller større.");
  }
  return amount;
}

function parseOptionalNonNegativeNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
  }
  return parsed;
}

function parseOptionalInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være et heltall.`);
  }
  return parsed;
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = parseOptionalInteger(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed <= 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være større enn 0.`);
  }
  return parsed;
}

function parseBooleanQueryValue(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  return parseBooleanEnv(value, fallback);
}

function parseLimit(value: unknown, fallback = 100): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DomainError("INVALID_INPUT", "limit må være et positivt tall.");
  }
  return Math.min(500, Math.floor(parsed));
}

function parseTicketsPerPlayerInput(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new DomainError("INVALID_TICKETS_PER_PLAYER", "ticketsPerPlayer må være et heltall mellom 1 og 5.");
  }
  return parsed;
}

function getAccessTokenFromRequest(req: express.Request): string {
  const header = req.headers.authorization;
  if (!header) {
    throw new DomainError("UNAUTHORIZED", "Mangler Authorization-header.");
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token?.trim()) {
    throw new DomainError("UNAUTHORIZED", "Authorization må være Bearer token.");
  }
  return token.trim();
}

function getAccessTokenFromSocketPayload(payload: AuthenticatedSocketPayload | undefined): string {
  const token = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
  if (!token) {
    throw new DomainError("UNAUTHORIZED", "Mangler accessToken i socket-payload.");
  }
  return token;
}

async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
  const accessToken = getAccessTokenFromRequest(req);
  return platformService.getUserFromAccessToken(accessToken);
}

async function getAuthenticatedSocketUser(payload: AuthenticatedSocketPayload | undefined): Promise<PublicAppUser> {
  const accessToken = getAccessTokenFromSocketPayload(payload);
  return platformService.getUserFromAccessToken(accessToken);
}

async function requireAdminUser(req: express.Request): Promise<PublicAppUser> {
  const user = await getAuthenticatedUser(req);
  if (user.role !== "ADMIN") {
    throw new DomainError("FORBIDDEN", "Kun admin har tilgang til dette endepunktet.");
  }
  return user;
}

function assertUserCanAccessRoom(user: PublicAppUser, roomCode: string): void {
  if (user.role === "ADMIN") {
    return;
  }
  const snapshot = engine.getRoomSnapshot(roomCode);
  const inRoom = snapshot.players.some((player) => player.walletId === user.walletId);
  if (!inRoom) {
    throw new DomainError("FORBIDDEN", "Du har ikke tilgang til dette rommet.");
  }
}

function assertUserCanActAsPlayer(user: PublicAppUser, roomCode: string, playerId: string): void {
  const snapshot = engine.getRoomSnapshot(roomCode);
  const player = snapshot.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke i rommet.");
  }
  if (user.role === "ADMIN") {
    return;
  }
  if (player.walletId !== user.walletId) {
    throw new DomainError("FORBIDDEN", "Du kan bare utføre handlinger for egen spiller.");
  }
}

async function requireAuthenticatedPlayerAction(
  payload: RoomActionPayload
): Promise<{ roomCode: string; playerId: string }> {
  const user = await getAuthenticatedSocketUser(payload);
  platformService.assertUserEligibleForGameplay(user);
  engine.assertWalletAllowedForGameplay(user.walletId);
  const roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();
  const playerId = mustBeNonEmptyString(payload?.playerId, "playerId");
  assertUserCanActAsPlayer(user, roomCode, playerId);
  return { roomCode, playerId };
}

async function requireActiveHallIdFromInput(input: unknown): Promise<string> {
  const hallReference = mustBeNonEmptyString(input, "hallId");
  const hall = await platformService.requireActiveHall(hallReference);
  return hall.id;
}

async function resolveBingoHallGameConfigForRoom(roomCode: string): Promise<{
  hallId: string;
  maxTicketsPerPlayer: number;
}> {
  const snapshot = engine.getRoomSnapshot(roomCode);
  const configs = await platformService.listHallGameConfigs({
    hallId: snapshot.hallId,
    includeDisabled: true
  });
  const bingoConfig = configs.find((config) => config.gameSlug === "bingo");
  if (!bingoConfig) {
    return {
      hallId: snapshot.hallId,
      maxTicketsPerPlayer: 5
    };
  }
  if (!bingoConfig.isEnabled) {
    throw new DomainError("GAME_DISABLED_FOR_HALL", "Bingo er deaktivert for valgt hall.");
  }
  return {
    hallId: snapshot.hallId,
    maxTicketsPerPlayer: bingoConfig.maxTicketsPerPlayer
  };
}

function apiSuccess<T>(res: express.Response, data: T): void {
  res.json({ ok: true, data });
}

function apiFailure(res: express.Response, error: unknown): void {
  const publicError = toPublicError(error);
  res.status(400).json({ ok: false, error: publicError });
}

async function emitRoomUpdate(roomCode: string): Promise<RoomSnapshot> {
  const snapshot = engine.getRoomSnapshot(roomCode);
  io.to(roomCode).emit("room:update", snapshot);
  return snapshot;
}

async function emitManyRoomUpdates(roomCodes: Iterable<string>): Promise<void> {
  for (const roomCode of roomCodes) {
    await emitRoomUpdate(roomCode);
  }
}

async function emitWalletRoomUpdates(walletIds: string[]): Promise<void> {
  const affectedRooms = new Set<string>();
  for (const walletId of walletIds) {
    const roomCodes = await engine.refreshPlayerBalancesForWallet(walletId);
    for (const roomCode of roomCodes) {
      affectedRooms.add(roomCode);
    }
  }
  await emitManyRoomUpdates(affectedRooms);
}

const nextAutoStartAtByRoom = new Map<string, number>();
const lastAutoDrawAtByRoom = new Map<string, number>();
const roomSchedulerLocks = new Set<string>();
let schedulerTickInProgress = false;

async function withRoomSchedulerLock(roomCode: string, work: () => Promise<void>): Promise<void> {
  if (roomSchedulerLocks.has(roomCode)) {
    return;
  }
  roomSchedulerLocks.add(roomCode);
  try {
    await work();
  } finally {
    roomSchedulerLocks.delete(roomCode);
  }
}

function cleanupSchedulerState(activeRoomCodes: Set<string>): void {
  for (const roomCode of nextAutoStartAtByRoom.keys()) {
    if (!activeRoomCodes.has(roomCode)) {
      nextAutoStartAtByRoom.delete(roomCode);
    }
  }
  for (const roomCode of lastAutoDrawAtByRoom.keys()) {
    if (!activeRoomCodes.has(roomCode)) {
      lastAutoDrawAtByRoom.delete(roomCode);
    }
  }
}

async function processAutoStart(summary: ReturnType<typeof engine.listRoomSummaries>[number], now: number): Promise<void> {
  const roomCode = summary.code;
  if (!autoRoundStartEnabled) {
    nextAutoStartAtByRoom.delete(roomCode);
    return;
  }

  if (summary.gameStatus === "RUNNING") {
    nextAutoStartAtByRoom.delete(roomCode);
    return;
  }

  if (summary.playerCount < autoRoundMinPlayers) {
    nextAutoStartAtByRoom.delete(roomCode);
    return;
  }

  const nextStartAt = nextAutoStartAtByRoom.get(roomCode) ?? now + autoRoundStartIntervalMs;
  if (now < nextStartAt) {
    nextAutoStartAtByRoom.set(roomCode, nextStartAt);
    return;
  }

  await withRoomSchedulerLock(roomCode, async () => {
    const latestSnapshot = engine.getRoomSnapshot(roomCode);
    if (latestSnapshot.currentGame?.status === "RUNNING") {
      nextAutoStartAtByRoom.delete(roomCode);
      return;
    }
    if (latestSnapshot.players.length < autoRoundMinPlayers) {
      nextAutoStartAtByRoom.set(roomCode, Date.now() + autoRoundStartIntervalMs);
      return;
    }

    await engine.startGame({
      roomCode,
      actorPlayerId: latestSnapshot.hostPlayerId,
      entryFee: autoRoundEntryFee,
      ticketsPerPlayer: autoRoundTicketsPerPlayer
    });
    nextAutoStartAtByRoom.delete(roomCode);
    lastAutoDrawAtByRoom.delete(roomCode);
    await emitRoomUpdate(roomCode);
  });
}

async function processAutoDraw(summary: ReturnType<typeof engine.listRoomSummaries>[number], now: number): Promise<void> {
  const roomCode = summary.code;
  if (!autoDrawEnabled || summary.gameStatus !== "RUNNING") {
    lastAutoDrawAtByRoom.delete(roomCode);
    return;
  }

  const lastDrawAt = lastAutoDrawAtByRoom.get(roomCode) ?? 0;
  if (now - lastDrawAt < autoDrawIntervalMs) {
    return;
  }

  await withRoomSchedulerLock(roomCode, async () => {
    const latestSnapshot = engine.getRoomSnapshot(roomCode);
    if (latestSnapshot.currentGame?.status !== "RUNNING") {
      lastAutoDrawAtByRoom.delete(roomCode);
      return;
    }

    const refreshedLastDrawAt = lastAutoDrawAtByRoom.get(roomCode) ?? 0;
    const currentNow = Date.now();
    if (currentNow - refreshedLastDrawAt < autoDrawIntervalMs) {
      return;
    }

    try {
      const number = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: latestSnapshot.hostPlayerId
      });
      io.to(roomCode).emit("draw:new", { number, source: "auto" });
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NO_MORE_NUMBERS") {
        throw error;
      }
    } finally {
      lastAutoDrawAtByRoom.set(roomCode, currentNow);
    }

    await emitRoomUpdate(roomCode);
  });
}

async function runSchedulerTick(): Promise<void> {
  if (schedulerTickInProgress) {
    return;
  }
  schedulerTickInProgress = true;

  try {
    const summaries = engine.listRoomSummaries();
    cleanupSchedulerState(new Set(summaries.map((summary) => summary.code)));
    const now = Date.now();

    for (const summary of summaries) {
      try {
        await processAutoStart(summary, now);
        await processAutoDraw(summary, now);
      } catch (error) {
        console.error(`[scheduler] room ${summary.code} feilet`, error);
      }
    }
  } finally {
    schedulerTickInProgress = false;
  }
}

if (autoRoundStartEnabled || autoDrawEnabled) {
  const scheduler = setInterval(() => {
    runSchedulerTick().catch((error) => {
      console.error("[scheduler] uventet feil", error);
    });
  }, schedulerTickMs);
  scheduler.unref();
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = mustBeNonEmptyString(req.body?.email, "email");
    const password = mustBeNonEmptyString(req.body?.password, "password");
    const displayName = mustBeNonEmptyString(req.body?.displayName, "displayName");
    const session = await platformService.register({
      email,
      password,
      displayName
    });
    apiSuccess(res, session);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = mustBeNonEmptyString(req.body?.email, "email");
    const password = mustBeNonEmptyString(req.body?.password, "password");
    const session = await platformService.login({
      email,
      password
    });
    apiSuccess(res, session);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const accessToken = getAccessTokenFromRequest(req);
    await platformService.logout(accessToken);
    apiSuccess(res, { loggedOut: true });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    apiSuccess(res, user);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/kyc/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    apiSuccess(res, {
      userId: user.id,
      status: user.kycStatus,
      birthDate: user.birthDate,
      verifiedAt: user.kycVerifiedAt,
      providerReference: user.kycProviderRef
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/kyc/verify", async (req, res) => {
  try {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    await platformService.submitKycVerification({
      userId: user.id,
      birthDate: mustBeNonEmptyString(req.body?.birthDate, "birthDate"),
      nationalId: typeof req.body?.nationalId === "string" ? req.body.nationalId : undefined
    });
    const refreshedUser = await platformService.getUserFromAccessToken(accessToken);
    apiSuccess(res, {
      user: refreshedUser
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/games", async (req, res) => {
  try {
    await getAuthenticatedUser(req);
    const games = await platformService.listGames({ includeDisabled: false });
    apiSuccess(res, games);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/games", async (req, res) => {
  try {
    await requireAdminUser(req);
    const games = await platformService.listGames({ includeDisabled: true });
    apiSuccess(res, games);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/games/:slug", async (req, res) => {
  try {
    await requireAdminUser(req);
    const slug = mustBeNonEmptyString(req.params.slug, "slug");
    const updated = await platformService.updateGame(slug, {
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      route: typeof req.body?.route === "string" ? req.body.route : undefined,
      isEnabled: typeof req.body?.isEnabled === "boolean" ? req.body.isEnabled : undefined,
      sortOrder: Number.isFinite(req.body?.sortOrder) ? Number(req.body.sortOrder) : undefined,
      settings:
        req.body?.settings && typeof req.body.settings === "object" && !Array.isArray(req.body.settings)
          ? req.body.settings
          : undefined
    });
    apiSuccess(res, updated);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/halls", async (req, res) => {
  try {
    await getAuthenticatedUser(req);
    const halls = await platformService.listHalls({ includeInactive: false });
    apiSuccess(res, halls);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/halls", async (req, res) => {
  try {
    await requireAdminUser(req);
    const includeInactive = parseBooleanQueryValue(req.query.includeInactive, true);
    const halls = await platformService.listHalls({ includeInactive });
    apiSuccess(res, halls);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/halls", async (req, res) => {
  try {
    await requireAdminUser(req);
    const hall = await platformService.createHall({
      slug: mustBeNonEmptyString(req.body?.slug, "slug"),
      name: mustBeNonEmptyString(req.body?.name, "name"),
      region: typeof req.body?.region === "string" ? req.body.region : undefined,
      address: typeof req.body?.address === "string" ? req.body.address : undefined,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined
    });
    apiSuccess(res, hall);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/halls/:hallId", async (req, res) => {
  try {
    await requireAdminUser(req);
    const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
    const hall = await platformService.updateHall(hallId, {
      slug: typeof req.body?.slug === "string" ? req.body.slug : undefined,
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      region: typeof req.body?.region === "string" ? req.body.region : undefined,
      address: typeof req.body?.address === "string" ? req.body.address : undefined,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined
    });
    apiSuccess(res, hall);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/terminals", async (req, res) => {
  try {
    await requireAdminUser(req);
    const includeInactive = parseBooleanQueryValue(req.query.includeInactive, true);
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId : undefined;
    const terminals = await platformService.listTerminals({
      hallId,
      includeInactive
    });
    apiSuccess(res, terminals);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/terminals", async (req, res) => {
  try {
    await requireAdminUser(req);
    const terminalCode = mustBeNonEmptyString(req.body?.terminalCode, "terminalCode");
    const displayName =
      typeof req.body?.displayName === "string" && req.body.displayName.trim()
        ? req.body.displayName
        : terminalCode;
    const terminal = await platformService.createTerminal({
      hallId: mustBeNonEmptyString(req.body?.hallId, "hallId"),
      terminalCode,
      displayName,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined
    });
    apiSuccess(res, terminal);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/terminals/:terminalId", async (req, res) => {
  try {
    await requireAdminUser(req);
    const terminalId = mustBeNonEmptyString(req.params.terminalId, "terminalId");
    const terminal = await platformService.updateTerminal(terminalId, {
      terminalCode: typeof req.body?.terminalCode === "string" ? req.body.terminalCode : undefined,
      displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
      lastSeenAt: typeof req.body?.lastSeenAt === "string" ? req.body.lastSeenAt : undefined
    });
    apiSuccess(res, terminal);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/halls/:hallId/game-config", async (req, res) => {
  try {
    await requireAdminUser(req);
    const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
    const includeDisabled = parseBooleanQueryValue(req.query.includeDisabled, true);
    const configs = await platformService.listHallGameConfigs({
      hallId,
      includeDisabled
    });
    apiSuccess(res, configs);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/halls/:hallId/game-config/:gameSlug", async (req, res) => {
  try {
    await requireAdminUser(req);
    const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
    const gameSlug = mustBeNonEmptyString(req.params.gameSlug, "gameSlug");
    const maxTicketsPerPlayer = parseOptionalInteger(req.body?.maxTicketsPerPlayer, "maxTicketsPerPlayer");
    const minRoundIntervalMs = parseOptionalInteger(req.body?.minRoundIntervalMs, "minRoundIntervalMs");
    const config = await platformService.upsertHallGameConfig({
      hallId,
      gameSlug,
      isEnabled: typeof req.body?.isEnabled === "boolean" ? req.body.isEnabled : undefined,
      maxTicketsPerPlayer: maxTicketsPerPlayer !== undefined ? Number(maxTicketsPerPlayer) : undefined,
      minRoundIntervalMs: minRoundIntervalMs !== undefined ? Number(minRoundIntervalMs) : undefined
    });
    apiSuccess(res, config);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/wallet/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const account = await walletAdapter.getAccount(user.walletId);
    const transactions = await walletAdapter.listTransactions(user.walletId, 20);
    apiSuccess(res, { account, transactions });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/wallet/me/compliance", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const compliance = engine.getPlayerCompliance(user.walletId, hallId || undefined);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallet/me/timed-pause", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
    const compliance = engine.setTimedPause({
      walletId: user.walletId,
      durationMinutes: durationMinutes ?? 15
    });
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/wallet/me/timed-pause", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const compliance = engine.clearTimedPause(user.walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallet/me/self-exclusion", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const compliance = engine.setSelfExclusion(user.walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/wallet/me/self-exclusion", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const compliance = engine.clearSelfExclusion(user.walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/wallet/me/loss-limits", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
    const dailyLossLimit = parseOptionalNonNegativeNumber(req.body?.dailyLossLimit, "dailyLossLimit");
    const monthlyLossLimit = parseOptionalNonNegativeNumber(req.body?.monthlyLossLimit, "monthlyLossLimit");
    if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
      throw new DomainError("INVALID_INPUT", "dailyLossLimit eller monthlyLossLimit må oppgis.");
    }
    const compliance = engine.setPlayerLossLimits({
      walletId: user.walletId,
      hallId,
      daily: dailyLossLimit,
      monthly: monthlyLossLimit
    });
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallet/me/topup", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const amount = mustBePositiveAmount(req.body?.amount);
    const provider =
      typeof req.body?.provider === "string" && req.body.provider.trim()
        ? req.body.provider.trim().toLowerCase()
        : "manual";
    if (provider === "swedbank") {
      throw new DomainError(
        "SWEDBANK_FLOW_REQUIRED",
        "Bruk /api/payments/swedbank/topup-intent for Swedbank-betaling."
      );
    }
    const tx = await walletAdapter.topUp(
      user.walletId,
      amount,
      provider === "swedbank_simulated"
        ? "Swedbank top-up (simulated)"
        : "Manual top-up"
    );
    await emitWalletRoomUpdates([user.walletId]);
    apiSuccess(res, {
      provider,
      transaction: tx
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/wallets/:walletId/compliance", async (req, res) => {
  try {
    await requireAdminUser(req);
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const compliance = engine.getPlayerCompliance(walletId, hallId || undefined);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/wallets/:walletId/loss-limits", async (req, res) => {
  try {
    await requireAdminUser(req);
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
    const dailyLossLimit = parseOptionalNonNegativeNumber(req.body?.dailyLossLimit, "dailyLossLimit");
    const monthlyLossLimit = parseOptionalNonNegativeNumber(req.body?.monthlyLossLimit, "monthlyLossLimit");
    if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
      throw new DomainError("INVALID_INPUT", "dailyLossLimit eller monthlyLossLimit må oppgis.");
    }
    const compliance = engine.setPlayerLossLimits({
      walletId,
      hallId,
      daily: dailyLossLimit,
      monthly: monthlyLossLimit
    });
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/wallets/:walletId/timed-pause", async (req, res) => {
  try {
    await requireAdminUser(req);
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
    const compliance = engine.setTimedPause({
      walletId,
      durationMinutes: durationMinutes ?? 15
    });
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/admin/wallets/:walletId/timed-pause", async (req, res) => {
  try {
    await requireAdminUser(req);
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = engine.clearTimedPause(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
  try {
    await requireAdminUser(req);
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = engine.setSelfExclusion(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
  try {
    await requireAdminUser(req);
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = engine.clearSelfExclusion(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/compliance/extra-draw-denials", async (req, res) => {
  try {
    await requireAdminUser(req);
    const limit = parseLimit(req.query.limit, 100);
    apiSuccess(res, engine.listExtraDrawDenials(limit));
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/prize-policy/active", async (req, res) => {
  try {
    await requireAdminUser(req);
    const hallId = mustBeNonEmptyString(req.query.hallId, "hallId");
    const linkId = typeof req.query.linkId === "string" ? req.query.linkId.trim() : undefined;
    const at = typeof req.query.at === "string" ? req.query.at.trim() : undefined;
    const policy = engine.getActivePrizePolicy({
      hallId,
      linkId,
      gameType: "DATABINGO",
      at
    });
    apiSuccess(res, policy);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/prize-policy", async (req, res) => {
  try {
    await requireAdminUser(req);
    const policy = engine.upsertPrizePolicy({
      gameType: "DATABINGO",
      hallId: typeof req.body?.hallId === "string" ? req.body.hallId : undefined,
      linkId: typeof req.body?.linkId === "string" ? req.body.linkId : undefined,
      effectiveFrom: mustBeNonEmptyString(req.body?.effectiveFrom, "effectiveFrom"),
      singlePrizeCap:
        req.body?.singlePrizeCap === undefined
          ? undefined
          : parseOptionalNonNegativeNumber(req.body?.singlePrizeCap, "singlePrizeCap"),
      dailyExtraPrizeCap:
        req.body?.dailyExtraPrizeCap === undefined
          ? undefined
          : parseOptionalNonNegativeNumber(req.body?.dailyExtraPrizeCap, "dailyExtraPrizeCap")
    });
    apiSuccess(res, policy);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/wallets/:walletId/extra-prize", async (req, res) => {
  try {
    await requireAdminUser(req);
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
    const amount = mustBePositiveAmount(req.body?.amount);
    const linkId = typeof req.body?.linkId === "string" ? req.body.linkId : undefined;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const result = await engine.awardExtraPrize({
      walletId,
      hallId,
      linkId,
      amount,
      reason
    });
    await emitWalletRoomUpdates([walletId]);
    apiSuccess(res, result);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/payments/swedbank/topup-intent", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const amount = mustBePositiveAmount(req.body?.amount);
    const intent = await swedbankPayService.createTopupIntent({
      userId: user.id,
      walletId: user.walletId,
      amountMajor: amount,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined
    });
    apiSuccess(res, intent);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/payments/swedbank/confirm", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const intentId = mustBeNonEmptyString(req.body?.intentId, "intentId");
    const result = await swedbankPayService.reconcileIntentForUser(intentId, user.id);
    if (result.walletCreditedNow) {
      await emitWalletRoomUpdates([user.walletId]);
    }
    apiSuccess(res, result.intent);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/payments/swedbank/intents/:intentId", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const intentId = mustBeNonEmptyString(req.params.intentId, "intentId");
    const shouldRefresh = parseBooleanEnv(
      typeof req.query.refresh === "string" ? req.query.refresh : undefined,
      false
    );
    if (!shouldRefresh) {
      const intent = await swedbankPayService.getIntentForUser(intentId, user.id);
      apiSuccess(res, intent);
      return;
    }

    const result = await swedbankPayService.reconcileIntentForUser(intentId, user.id);
    if (result.walletCreditedNow) {
      await emitWalletRoomUpdates([user.walletId]);
    }
    apiSuccess(res, result.intent);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/payments/swedbank/callback", async (req, res) => {
  try {
    const result = await swedbankPayService.processCallback(req.body);
    if (result.walletCreditedNow) {
      await emitWalletRoomUpdates([result.intent.walletId]);
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[swedbank-callback] failed", error);
    res.status(500).json({
      ok: false,
      error: toPublicError(error)
    });
  }
});

app.get("/health", async (_req, res) => {
  try {
    const wallets = await walletAdapter.listAccounts();
    const games = await platformService.listGames({ includeDisabled: true });
    const halls = await platformService.listHalls({ includeInactive: true });
    apiSuccess(res, {
      rooms: engine.getAllRoomCodes().length,
      wallets: wallets.length,
      games: games.length,
      halls: halls.length,
      walletProvider: walletRuntime.provider,
      swedbankConfigured: swedbankPayService.isConfigured(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/rooms", (_req, res) => {
  try {
    apiSuccess(res, engine.listRoomSummaries());
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/rooms/:roomCode", (req, res) => {
  try {
    const snapshot = engine.getRoomSnapshot(req.params.roomCode);
    apiSuccess(res, snapshot);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/rooms/:roomCode/game/end", async (req, res) => {
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

app.post("/api/rooms/:roomCode/game/extra-draw", async (req, res) => {
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

app.post("/api/wallets", async (req, res) => {
  try {
    const walletId = typeof req.body?.walletId === "string" ? req.body.walletId.trim() : undefined;
    const initialBalance = parseOptionalNonNegativeAmount(req.body?.initialBalance, 1000);
    const account = await walletAdapter.createAccount({
      accountId: walletId || undefined,
      initialBalance,
      allowExisting: false
    });
    apiSuccess(res, account);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/wallets", async (_req, res) => {
  try {
    const accounts = await walletAdapter.listAccounts();
    apiSuccess(res, accounts);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/wallets/:walletId", async (req, res) => {
  try {
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const account = await walletAdapter.getAccount(walletId);
    const transactions = await walletAdapter.listTransactions(walletId, 20);
    apiSuccess(res, { account, transactions });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/wallets/:walletId/transactions", async (req, res) => {
  try {
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const limit = parseLimit(req.query.limit, 100);
    const transactions = await walletAdapter.listTransactions(walletId, limit);
    apiSuccess(res, transactions);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallets/:walletId/topup", async (req, res) => {
  try {
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const amount = mustBePositiveAmount(req.body?.amount);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Manual top-up";
    const tx = await walletAdapter.topUp(walletId, amount, reason);
    await emitWalletRoomUpdates([walletId]);
    apiSuccess(res, tx);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallets/:walletId/withdraw", async (req, res) => {
  try {
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const amount = mustBePositiveAmount(req.body?.amount);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Manual withdrawal";
    const tx = await walletAdapter.withdraw(walletId, amount, reason);
    await emitWalletRoomUpdates([walletId]);
    apiSuccess(res, tx);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallets/transfer", async (req, res) => {
  try {
    const fromWalletId = mustBeNonEmptyString(req.body?.fromWalletId, "fromWalletId");
    const toWalletId = mustBeNonEmptyString(req.body?.toWalletId, "toWalletId");
    const amount = mustBePositiveAmount(req.body?.amount);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Wallet transfer";
    const transfer = await walletAdapter.transfer(fromWalletId, toWalletId, amount, reason);
    await emitWalletRoomUpdates([fromWalletId, toWalletId]);
    apiSuccess(res, transfer);
  } catch (error) {
    apiFailure(res, error);
  }
});

io.on("connection", (socket: Socket) => {
  async function resolveIdentityFromPayload(payload: CreateRoomPayload): Promise<{
    playerName: string;
    walletId: string;
    hallId: string;
  }> {
    const user = await getAuthenticatedSocketUser(payload);
    platformService.assertUserEligibleForGameplay(user);
    engine.assertWalletAllowedForGameplay(user.walletId);
    const hallId = await requireActiveHallIdFromInput(payload?.hallId);
    return {
      playerName: user.displayName,
      walletId: user.walletId,
      hallId
    };
  }

  socket.on("room:create", async (payload: CreateRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
    try {
      const identity = await resolveIdentityFromPayload(payload);
      const { roomCode, playerId } = await engine.createRoom({
        playerName: identity.playerName,
        hallId: identity.hallId,
        walletId: identity.walletId,
        socketId: socket.id
      });
      socket.join(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { roomCode, playerId, snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("room:join", async (payload: JoinRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
    try {
      const roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();
      const identity = await resolveIdentityFromPayload(payload);
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
      ackFailure(callback, error);
    }
  });

  socket.on("room:resume", async (payload: ResumeRoomPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      engine.attachPlayerSocket(roomCode, playerId, socket.id);
      socket.join(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("game:start", async (payload: StartGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const ticketsPerPlayer =
        payload?.ticketsPerPlayer === undefined || payload?.ticketsPerPlayer === null
          ? undefined
          : parseTicketsPerPlayerInput(payload.ticketsPerPlayer);
      const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
      assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
      await engine.startGame({
        roomCode,
        actorPlayerId: playerId,
        entryFee: payload?.entryFee ?? 0,
        ticketsPerPlayer
      });
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("game:end", async (payload: EndGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
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
  });

  socket.on("draw:next", async (payload: RoomActionPayload, callback: (response: AckResponse<{ number: number; snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const number = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
      io.to(roomCode).emit("draw:new", { number });
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { number, snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("draw:extra:purchase", async (payload: ExtraDrawPayload, callback: (response: AckResponse<{ denied: true }>) => void) => {
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
  });

  socket.on("ticket:mark", async (payload: MarkPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      if (!Number.isFinite(payload?.number)) {
        throw new DomainError("INVALID_INPUT", "number mangler.");
      }
      await engine.markNumber({
        roomCode,
        playerId,
        number: Number(payload.number)
      });
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("claim:submit", async (payload: ClaimPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      if (payload?.type !== "LINE" && payload?.type !== "BINGO") {
        throw new DomainError("INVALID_INPUT", "type må være LINE eller BINGO.");
      }
      await engine.submitClaim({
        roomCode,
        playerId,
        type: payload.type
      });
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("room:state", async (payload: RoomStatePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const user = await getAuthenticatedSocketUser(payload);
      const roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();
      assertUserCanAccessRoom(user, roomCode);
      const snapshot = engine.getRoomSnapshot(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("disconnect", () => {
    engine.detachSocket(socket.id);
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

const PORT = Number(process.env.PORT ?? 4000);
server.listen(PORT, () => {
  console.log(`Bingo backend kjører på http://localhost:${PORT}`);
  console.log(
    `[compliance] minRoundInterval=${bingoMinRoundIntervalMs}ms dailyLoss=${bingoDailyLossLimit} monthlyLoss=${bingoMonthlyLossLimit} playSessionLimit=${bingoPlaySessionLimitMs}ms pauseDuration=${bingoPauseDurationMs}ms selfExclusionMin=${bingoSelfExclusionMinMs}ms`
  );
  console.log(
    `[scheduler] autoStart=${autoRoundStartEnabled} interval=${autoRoundStartIntervalMs}ms minPlayers=${autoRoundMinPlayers} ticketsPerPlayer=${autoRoundTicketsPerPlayer} entryFee=${autoRoundEntryFee}`
  );
  console.log(
    `[scheduler] autoDraw=${autoDrawEnabled} interval=${autoDrawIntervalMs}ms tick=${schedulerTickMs}ms`
  );
  console.log(`[swedbank] configured=${swedbankPayService.isConfigured()}`);
});
