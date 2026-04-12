import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { createWalletAdapter } from "./adapters/createWalletAdapter.js";
import { LocalBingoSystemAdapter } from "./adapters/LocalBingoSystemAdapter.js";
import { PostgresBingoSystemAdapter } from "./adapters/PostgresBingoSystemAdapter.js";
import { LocalKycAdapter } from "./adapters/LocalKycAdapter.js";
import { BankIdKycAdapter } from "./adapters/BankIdKycAdapter.js";
import { assertTicketsPerPlayerWithinHallLimit } from "./game/compliance.js";
import { BingoEngine, DomainError, toPublicError } from "./game/BingoEngine.js";
import { PostgresResponsibleGamingStore } from "./game/PostgresResponsibleGamingStore.js";
import { generateDatabingo60Ticket } from "./game/ticket.js";
import type { ClaimType, GameSnapshot, Player, RoomSnapshot, RoomSummary, Ticket } from "./game/types.js";
import {
  ADMIN_ACCESS_POLICY,
  assertAdminPermission,
  canAccessAdminPermission,
  getAdminPermissionMap,
  listAdminPermissionsForRole,
  type AdminPermission
} from "./platform/AdminAccessPolicy.js";
import {
  APP_USER_ROLES,
  PlatformService,
  type GameDefinition,
  type HallDefinition,
  type PublicAppUser,
  type UserRole
} from "./platform/PlatformService.js";
import { SwedbankPayService } from "./payments/SwedbankPayService.js";
import { buildPlayerReport, resolvePlayerReportRange, type PlayerReportPeriod } from "./spillevett/playerReport.js";
import { emailPlayerReport, generatePlayerReportPdf } from "./spillevett/reportExport.js";
import {
  buildBingoSettingsDefinition,
  buildDefaultGameSettingsDefinition,
  type AdminSettingsCatalog,
  type GameSettingsDefinition
} from "./admin/settingsCatalog.js";
import { DrawScheduler, type SchedulerSettings } from "./draw-engine/DrawScheduler.js";
import { SocketRateLimiter } from "./middleware/socketRateLimit.js";
import { HttpRateLimiter } from "./middleware/httpRateLimit.js";
import { register as promRegister, metrics as promMetrics } from "./util/metrics.js";
import { createExternalGameWalletRouter } from "./integration/externalGameWallet.js";

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
  // For non-admin users we resolve the playerId from the access token's walletId.
  // Admins can still provide playerId explicitly.
  playerId?: string;
}

interface CreateRoomPayload extends AuthenticatedSocketPayload {
  playerName?: string;
  walletId?: string;
  hallId?: string;
  gameSlug?: string;
}

interface JoinRoomPayload extends CreateRoomPayload {
  roomCode: string;
}

interface ResumeRoomPayload extends RoomActionPayload {}

interface StartGamePayload extends RoomActionPayload {
  entryFee?: number;
  ticketsPerPlayer?: number;
}

interface ConfigureRoomPayload extends RoomActionPayload {
  entryFee?: number;
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

interface ChatSendPayload extends RoomActionPayload {
  message: string;
  emojiId?: number;
}

interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
}

interface LuckyNumberPayload extends RoomActionPayload {
  luckyNumber: number;
}

interface LeaderboardPayload extends AuthenticatedSocketPayload {
  roomCode?: string; // optional — if omitted, aggregates across all rooms
}

interface LeaderboardEntry {
  nickname: string;
  points: number;
}

interface BingoSchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoRoundTicketsPerPlayer: number;
  autoRoundEntryFee: number;
  payoutPercent: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
}

interface PendingBingoSettingsUpdate {
  effectiveFromMs: number;
  settings: BingoSchedulerSettings;
}

interface PersistBingoSettingsOptions {
  changedBy?: {
    userId: string;
    displayName: string;
    role: UserRole;
  };
  source?: string;
  effectiveFromMs?: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const frontendDir = path.resolve(__dirname, "../../frontend");
const publicDir = path.resolve(__dirname, "../public");
const adminFrontendFile = path.resolve(frontendDir, "admin/index.html");
const projectDir = path.resolve(__dirname, "../..");

const app = express();

// BIN-49: CORS — require explicit origins in production, never allow wildcard "*"
const corsAllowedOriginsRaw = (process.env.CORS_ALLOWED_ORIGINS ?? "").trim();
const isProduction = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
if (isProduction && !corsAllowedOriginsRaw) {
  console.error(
    "FATAL: CORS_ALLOWED_ORIGINS must be set in production. Refusing to start with wildcard CORS."
  );
  process.exit(1);
}
const corsOrigins: string[] | "*" = corsAllowedOriginsRaw
  ? corsAllowedOriginsRaw.split(",").map((o) => o.trim()).filter(Boolean)
  : "*";
app.use(cors({ origin: corsOrigins, credentials: true }));
// LAV-3: 100 KB for all endpoints, except registration which carries compressed photo IDs (~2 * 100KB base64)
app.use((req, _res, next) => {
  const limit = req.path === "/api/auth/register" ? "5mb" : "100kb";
  express.json({ limit })(req, _res, next);
});

// BIN-277: REST API rate limiting — sliding-window per IP per route tier
const httpRateLimiter = new HttpRateLimiter();
httpRateLimiter.start();
app.use(httpRateLimiter.middleware());

// BIN-278: Root redirects to web shell (must be before express.static)
app.get(["/", "/index.html"], (_req, res) => {
  res.redirect(302, "/web/");
});

// Admin panel served from frontend/admin/
app.use("/admin", express.static(path.join(frontendDir, "admin")));
app.use(express.static(publicDir));

const server = http.createServer(app);
const io = new Server(server, {
  allowEIO3: true,
  cors: {
    origin: corsOrigins,
    credentials: true
  },
  maxHttpBufferSize: 100 * 1024 // LAV-3: 100 KB — prevents oversized payloads
});

const walletRuntime = createWalletAdapter(projectDir);
const walletAdapter = walletRuntime.adapter;

// External game wallet bridge (Candy/demo-backend calls these)
const extGameWalletApiKey = (process.env.EXT_GAME_WALLET_API_KEY ?? "").trim();
if (extGameWalletApiKey) {
  app.use("/api/ext-wallet", createExternalGameWalletRouter({
    walletAdapter,
    apiKey: extGameWalletApiKey
  }));
}

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
const bingoMaxDrawsPerRound = Math.min(
  60,
  Math.max(1, parsePositiveIntEnv(process.env.BINGO_MAX_DRAWS_PER_ROUND, 30))
);

const isProductionRuntime = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
const minPlayersFloor = 1;
const bingoMinPlayersToStart = minPlayersFloor;
const requestedAutoRoundStartEnabled = parseBooleanEnv(process.env.AUTO_ROUND_START_ENABLED, true);
const requestedAutoDrawEnabled = parseBooleanEnv(process.env.AUTO_DRAW_ENABLED, true);
const fixedAutoDrawIntervalMs = 2000;
// BIN-47: Default to false in production — autoplay must be explicitly enabled
const allowAutoplayInProduction = parseBooleanEnv(process.env.BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION, false);
// BIN-47: Never force autostart — respect the autoplayAllowed guard
const forceAutoStart = false;
const forceAutoDraw = false;
if (isProductionRuntime && !allowAutoplayInProduction && requestedAutoRoundStartEnabled) {
  console.warn(
    "WARNING: AUTO_ROUND_START_ENABLED=true ignored in production. Set BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true to override."
  );
}
const enforceSingleRoomPerHall = parseBooleanEnv(
  process.env.BINGO_SINGLE_ACTIVE_ROOM_PER_HALL,
  true
);
const autoplayAllowed = !isProductionRuntime || allowAutoplayInProduction;
const runtimeBingoSettings: BingoSchedulerSettings = {
  autoRoundStartEnabled: forceAutoStart
    ? true
    : autoplayAllowed
      ? requestedAutoRoundStartEnabled
      : false,
  autoRoundStartIntervalMs: Math.max(
    bingoMinRoundIntervalMs,
    parsePositiveIntEnv(process.env.AUTO_ROUND_START_INTERVAL_MS, 3 * 60 * 1000)
  ),
  autoRoundEntryFee: parseNonNegativeNumberEnv(process.env.AUTO_ROUND_ENTRY_FEE, 0),
  autoRoundMinPlayers: Math.max(
    bingoMinPlayersToStart,
    parsePositiveIntEnv(process.env.AUTO_ROUND_MIN_PLAYERS, bingoMinPlayersToStart)
  ),
  autoRoundTicketsPerPlayer: Math.min(
    5,
    Math.max(1, parsePositiveIntEnv(process.env.AUTO_ROUND_TICKETS_PER_PLAYER, 4))
  ),
  payoutPercent: Math.round(
    Math.min(100, Math.max(0, parseNonNegativeNumberEnv(process.env.BINGO_PAYOUT_PERCENT, 80))) * 100
  ) / 100,
  autoDrawEnabled: forceAutoDraw ? true : autoplayAllowed ? requestedAutoDrawEnabled : false,
  autoDrawIntervalMs: fixedAutoDrawIntervalMs
};
let bingoSettingsEffectiveFromMs = Date.now();
let pendingBingoSettingsUpdate: PendingBingoSettingsUpdate | null = null;
const schedulerTickMs = parsePositiveIntEnv(process.env.AUTO_ROUND_SCHEDULER_TICK_MS, 250);
const dailyReportJobEnabled = parseBooleanEnv(process.env.DAILY_REPORT_JOB_ENABLED, true);
const dailyReportJobIntervalMs = Math.max(
  60_000,
  parsePositiveIntEnv(process.env.DAILY_REPORT_JOB_INTERVAL_MS, 60 * 60 * 1000)
);
if (isProductionRuntime && !autoplayAllowed && (requestedAutoRoundStartEnabled || requestedAutoDrawEnabled)) {
  console.warn(
    "[scheduler] Autoplay er deaktivert i production (sett BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true for aa tillate AUTO_ROUND_START_ENABLED/AUTO_DRAW_ENABLED)."
  );
}

// BIN-159: Use PostgreSQL adapter for game checkpointing when a DB connection is available
const checkpointConnectionString = process.env.APP_PG_CONNECTION_STRING?.trim() || process.env.WALLET_PG_CONNECTION_STRING?.trim() || "";
// BIN-240: Default to true — checkpointing must be on in production to prevent
// loss of game state on restart. Override with BINGO_CHECKPOINT_ENABLED=false only in dev/test.
const usePostgresBingoAdapter = parseBooleanEnv(process.env.BINGO_CHECKPOINT_ENABLED, true) && checkpointConnectionString.length > 0;

const localBingoAdapter = usePostgresBingoAdapter
  ? new PostgresBingoSystemAdapter({
      connectionString: checkpointConnectionString,
      schema: process.env.APP_PG_SCHEMA?.trim() || process.env.WALLET_PG_SCHEMA?.trim() || "public",
      ssl: parseBooleanEnv(process.env.WALLET_PG_SSL, false)
    })
  : new LocalBingoSystemAdapter();

if (usePostgresBingoAdapter) {
  console.log("[BIN-159] Game state checkpointing enabled (PostgreSQL)");
} else {
  const reason = !checkpointConnectionString
    ? "No database connection string configured (APP_PG_CONNECTION_STRING / WALLET_PG_CONNECTION_STRING)"
    : "BINGO_CHECKPOINT_ENABLED is explicitly set to false";
  console.warn(`[CHECKPOINT] WARNING: Game checkpointing is DISABLED. Reason: ${reason}. Game state will NOT survive server restarts.`);
  if (process.env.NODE_ENV === "production") {
    console.error("[CHECKPOINT] CRITICAL: Running production WITHOUT checkpointing. Set BINGO_CHECKPOINT_ENABLED=true and provide a database connection string.");
  }
}

// BIN-170/171: Room state store and scheduler lock provider
import { InMemoryRoomStateStore, type RoomStateStore } from "./store/RoomStateStore.js";
import { RedisRoomStateStore } from "./store/RedisRoomStateStore.js";
import { RedisSchedulerLock } from "./store/RedisSchedulerLock.js";

const roomStateProvider = process.env.ROOM_STATE_PROVIDER?.trim().toLowerCase() ?? "memory";
const redisUrl = process.env.REDIS_URL?.trim() || "redis://localhost:6379";

const roomStateStore: RoomStateStore = roomStateProvider === "redis"
  ? new RedisRoomStateStore({ url: redisUrl })
  : new InMemoryRoomStateStore();

const useRedisLock = process.env.SCHEDULER_LOCK_PROVIDER?.trim().toLowerCase() === "redis";
const redisSchedulerLock = useRedisLock ? new RedisSchedulerLock({ url: redisUrl }) : null;

if (roomStateProvider === "redis") {
  console.log("[BIN-170] Room state store: Redis");
}
if (useRedisLock) {
  console.log("[BIN-171] Scheduler lock: Redis (distributed)");
}
const responsibleGamingStore =
  platformConnectionString.length > 0
    ? new PostgresResponsibleGamingStore({
        connectionString: platformConnectionString,
        schema: process.env.APP_PG_SCHEMA?.trim() || process.env.WALLET_PG_SCHEMA?.trim() || "public",
        ssl: parseBooleanEnv(process.env.WALLET_PG_SSL, false)
      })
    : undefined;

const engine = new BingoEngine(localBingoAdapter, walletAdapter, {
  minRoundIntervalMs: bingoMinRoundIntervalMs,
  minPlayersToStart: bingoMinPlayersToStart,
  dailyLossLimit: bingoDailyLossLimit,
  monthlyLossLimit: bingoMonthlyLossLimit,
  playSessionLimitMs: bingoPlaySessionLimitMs,
  pauseDurationMs: bingoPauseDurationMs,
  selfExclusionMinMs: bingoSelfExclusionMinMs,
  maxDrawsPerRound: bingoMaxDrawsPerRound,
  persistence: responsibleGamingStore,
  roomStateStore // BIN-251: sync room structural mutations to Redis when enabled
});

// BIN-274: Configurable KYC provider
const kycMinAge = Math.max(18, parsePositiveIntEnv(process.env.KYC_MIN_AGE_YEARS, 18));
const kycProvider = process.env.KYC_PROVIDER?.trim().toLowerCase() ?? "local";
const bankIdAdapter = kycProvider === "bankid"
  ? new BankIdKycAdapter({
      clientId: process.env.BANKID_CLIENT_ID ?? "",
      clientSecret: process.env.BANKID_CLIENT_SECRET ?? "",
      authority: process.env.BANKID_AUTHORITY ?? "https://login.bankid.no",
      redirectUri: process.env.BANKID_REDIRECT_URI ?? "",
      minAgeYears: kycMinAge,
    })
  : null;
const kycAdapter = bankIdAdapter ?? new LocalKycAdapter({ minAgeYears: kycMinAge });

const platformService = new PlatformService(walletAdapter, {
  connectionString: platformConnectionString,
  schema: process.env.APP_PG_SCHEMA?.trim() || process.env.WALLET_PG_SCHEMA?.trim() || "public",
  sessionTtlHours: parsePositiveIntEnv(process.env.AUTH_SESSION_TTL_HOURS, 24 * 7),
  minAgeYears: kycMinAge,
  kycAdapter,
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

function parseOptionalLedgerGameType(value: unknown): "MAIN_GAME" | "DATABINGO" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME eller DATABINGO.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized !== "MAIN_GAME" && normalized !== "DATABINGO") {
    throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME eller DATABINGO.");
  }
  return normalized;
}

function parseOptionalLedgerChannel(value: unknown): "HALL" | "INTERNET" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "channel må være HALL eller INTERNET.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized !== "HALL" && normalized !== "INTERNET") {
    throw new DomainError("INVALID_INPUT", "channel må være HALL eller INTERNET.");
  }
  return normalized;
}

function parsePlayerReportPeriod(value: unknown, fallback: PlayerReportPeriod = "last7"): PlayerReportPeriod {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "period må være today, last7, last30 eller last365.");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized !== "today" && normalized !== "last7" && normalized !== "last30" && normalized !== "last365") {
    throw new DomainError("INVALID_INPUT", "period må være today, last7, last30 eller last365.");
  }
  return normalized;
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

function normalizeAbsoluteHttpUrl(rawValue: string, fieldName: string, errorCode: string): string {
  const candidate = rawValue.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new DomainError(errorCode, `${fieldName} må være en gyldig http/https URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DomainError(errorCode, `${fieldName} må starte med http:// eller https://.`);
  }

  return parsed.toString();
}

function parseOptionalAbsoluteHttpUrl(
  value: unknown,
  fieldName: string,
  errorCode: string
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError(errorCode, `${fieldName} må være tekst.`);
  }
  if (!value.trim()) {
    return undefined;
  }
  return normalizeAbsoluteHttpUrl(value, fieldName, errorCode);
}

function normalizeGameSettingsForUpdate(
  gameSlug: string,
  settings: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  void gameSlug;
  if (!settings) {
    return undefined;
  }
  return settings;
}

function parseOptionalBooleanInput(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  throw new DomainError("INVALID_INPUT", `${fieldName} må være true/false.`);
}

function parseOptionalIsoTimestampMs(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  const parsed = Date.parse(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  return parsed;
}

function parseBingoSettingsPatch(value: unknown): Partial<BingoSchedulerSettings> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
  }

  const payload = value as Record<string, unknown>;
  const patch: Partial<BingoSchedulerSettings> = {};

  const autoRoundStartEnabled = parseOptionalBooleanInput(payload.autoRoundStartEnabled, "autoRoundStartEnabled");
  if (autoRoundStartEnabled !== undefined) {
    patch.autoRoundStartEnabled = autoRoundStartEnabled;
  }

  const autoRoundStartIntervalMs = parseOptionalPositiveInteger(
    payload.autoRoundStartIntervalMs,
    "autoRoundStartIntervalMs"
  );
  if (autoRoundStartIntervalMs !== undefined) {
    patch.autoRoundStartIntervalMs = autoRoundStartIntervalMs;
  }

  const autoRoundMinPlayers = parseOptionalPositiveInteger(payload.autoRoundMinPlayers, "autoRoundMinPlayers");
  if (autoRoundMinPlayers !== undefined) {
    patch.autoRoundMinPlayers = autoRoundMinPlayers;
  }

  const autoRoundTicketsPerPlayer = parseOptionalPositiveInteger(
    payload.autoRoundTicketsPerPlayer,
    "autoRoundTicketsPerPlayer"
  );
  if (autoRoundTicketsPerPlayer !== undefined) {
    patch.autoRoundTicketsPerPlayer = autoRoundTicketsPerPlayer;
  }

  const autoRoundEntryFee = parseOptionalNonNegativeNumber(payload.autoRoundEntryFee, "autoRoundEntryFee");
  if (autoRoundEntryFee !== undefined) {
    patch.autoRoundEntryFee = autoRoundEntryFee;
  }

  const payoutPercent = parseOptionalNonNegativeNumber(payload.payoutPercent, "payoutPercent");
  if (payoutPercent !== undefined) {
    if (payoutPercent > 100) {
      throw new DomainError("INVALID_INPUT", "payoutPercent må være mellom 0 og 100.");
    }
    patch.payoutPercent = payoutPercent;
  }

  const autoDrawEnabled = parseOptionalBooleanInput(payload.autoDrawEnabled, "autoDrawEnabled");
  if (autoDrawEnabled !== undefined) {
    patch.autoDrawEnabled = autoDrawEnabled;
  }

  const autoDrawIntervalMs = parseOptionalPositiveInteger(payload.autoDrawIntervalMs, "autoDrawIntervalMs");
  if (autoDrawIntervalMs !== undefined && autoDrawIntervalMs !== fixedAutoDrawIntervalMs) {
    throw new DomainError(
      "INVALID_INPUT",
      `autoDrawIntervalMs er låst til ${fixedAutoDrawIntervalMs} ms.`
    );
  }
  if (autoDrawIntervalMs !== undefined) {
    patch.autoDrawIntervalMs = fixedAutoDrawIntervalMs;
  }

  return patch;
}

function normalizeBingoSchedulerSettings(
  current: BingoSchedulerSettings,
  patch: Partial<BingoSchedulerSettings>
): BingoSchedulerSettings {
  const next: BingoSchedulerSettings = {
    autoRoundStartEnabled:
      patch.autoRoundStartEnabled !== undefined
        ? patch.autoRoundStartEnabled
        : current.autoRoundStartEnabled,
    autoRoundStartIntervalMs:
      patch.autoRoundStartIntervalMs !== undefined
        ? patch.autoRoundStartIntervalMs
        : current.autoRoundStartIntervalMs,
    autoRoundMinPlayers:
      patch.autoRoundMinPlayers !== undefined ? patch.autoRoundMinPlayers : current.autoRoundMinPlayers,
    autoRoundTicketsPerPlayer:
      patch.autoRoundTicketsPerPlayer !== undefined
        ? patch.autoRoundTicketsPerPlayer
        : current.autoRoundTicketsPerPlayer,
    autoRoundEntryFee:
      patch.autoRoundEntryFee !== undefined ? patch.autoRoundEntryFee : current.autoRoundEntryFee,
    payoutPercent: patch.payoutPercent !== undefined ? patch.payoutPercent : current.payoutPercent,
    autoDrawEnabled: patch.autoDrawEnabled !== undefined ? patch.autoDrawEnabled : current.autoDrawEnabled,
    autoDrawIntervalMs:
      patch.autoDrawIntervalMs !== undefined ? patch.autoDrawIntervalMs : current.autoDrawIntervalMs
  };

  next.autoRoundStartIntervalMs = Math.max(
    bingoMinRoundIntervalMs,
    Math.floor(next.autoRoundStartIntervalMs)
  );
  if (forceAutoStart) {
    next.autoRoundStartEnabled = true;
  }
  if (forceAutoDraw) {
    next.autoDrawEnabled = true;
  }
  next.autoRoundMinPlayers = Math.max(bingoMinPlayersToStart, Math.floor(next.autoRoundMinPlayers));
  next.autoRoundTicketsPerPlayer = Math.min(5, Math.max(1, Math.floor(next.autoRoundTicketsPerPlayer)));
  next.autoRoundEntryFee = Math.max(0, Math.round(next.autoRoundEntryFee * 100) / 100);
  next.payoutPercent = Math.min(100, Math.max(0, Math.round(next.payoutPercent * 100) / 100));
  next.autoDrawIntervalMs = fixedAutoDrawIntervalMs;

  if (
    !autoplayAllowed &&
    ((next.autoRoundStartEnabled && !forceAutoStart) || (next.autoDrawEnabled && !forceAutoDraw))
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Autoplay er deaktivert i production. Sett BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true for aa aktivere autoStart/autoDraw."
    );
  }

  return next;
}

function bingoSettingsCoreToRecord(settings: BingoSchedulerSettings): Record<string, unknown> {
  return {
    autoRoundStartEnabled: settings.autoRoundStartEnabled,
    autoRoundStartIntervalMs: settings.autoRoundStartIntervalMs,
    autoRoundMinPlayers: settings.autoRoundMinPlayers,
    autoRoundTicketsPerPlayer: settings.autoRoundTicketsPerPlayer,
    autoRoundEntryFee: settings.autoRoundEntryFee,
    payoutPercent: settings.payoutPercent,
    autoDrawEnabled: settings.autoDrawEnabled,
    autoDrawIntervalMs: settings.autoDrawIntervalMs
  };
}

function bingoSettingsToRecord(): Record<string, unknown> {
  return {
    ...bingoSettingsCoreToRecord(runtimeBingoSettings),
    schedulerCurrentEffectiveFrom: new Date(bingoSettingsEffectiveFromMs).toISOString(),
    schedulerPending: pendingBingoSettingsUpdate
      ? {
          effectiveFrom: new Date(pendingBingoSettingsUpdate.effectiveFromMs).toISOString(),
          settings: bingoSettingsCoreToRecord(pendingBingoSettingsUpdate.settings)
        }
      : null
  };
}

function readBingoSettingsFromRecord(settings: Record<string, unknown> | undefined): Partial<BingoSchedulerSettings> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  return parseBingoSettingsPatch(settings);
}

function readPendingBingoSettingsFromRecord(
  settings: Record<string, unknown> | undefined
): PendingBingoSettingsUpdate | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null;
  }
  const pendingRaw = settings.schedulerPending;
  if (pendingRaw === undefined || pendingRaw === null) {
    return null;
  }
  if (typeof pendingRaw !== "object" || Array.isArray(pendingRaw)) {
    throw new DomainError("INVALID_INPUT", "Ugyldig schedulerPending i bingo settings.");
  }
  const pending = pendingRaw as Record<string, unknown>;
  const effectiveFromMs = parseOptionalIsoTimestampMs(pending.effectiveFrom, "schedulerPending.effectiveFrom");
  if (effectiveFromMs === undefined) {
    return null;
  }
  const patch = parseBingoSettingsPatch(pending.settings);
  const normalizedSettings = normalizeBingoSchedulerSettings(runtimeBingoSettings, patch);
  return {
    effectiveFromMs,
    settings: normalizedSettings
  };
}

function hasAnyRunningBingoRound(summaries?: ReturnType<typeof engine.listRoomSummaries>): boolean {
  const roomSummaries = summaries ?? engine.listRoomSummaries();
  return roomSummaries.some((summary) => summary.gameStatus === "RUNNING");
}

function getBingoAdminSettingsResponse(): Record<string, unknown> {
  const lockActive = hasAnyRunningBingoRound();
  return {
    ...runtimeBingoSettings,
    effectiveFrom: new Date(bingoSettingsEffectiveFromMs).toISOString(),
    pendingUpdate: pendingBingoSettingsUpdate
      ? {
          effectiveFrom: new Date(pendingBingoSettingsUpdate.effectiveFromMs).toISOString(),
          settings: { ...pendingBingoSettingsUpdate.settings }
        }
      : null,
    schedulerTickMs,
    constraints: {
      runtime: isProductionRuntime ? "production" : "non-production",
      autoplayAllowed,
      allowAutoplayInProduction,
      forceAutoStart,
      forceAutoDraw,
      minRoundIntervalMs: bingoMinRoundIntervalMs,
      minPlayersToStart: bingoMinPlayersToStart,
      maxDrawsPerRound: bingoMaxDrawsPerRound,
      maxTicketsPerPlayer: 5,
      minPayoutPercent: 0,
      maxPayoutPercent: 100,
      fixedAutoDrawIntervalMs: fixedAutoDrawIntervalMs,
      runningRoundLockActive: lockActive
    },
    locks: {
      runningRoundLockActive: lockActive
    }
  };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAdminGameSettingsPayload(
  body: unknown
): { settings: Record<string, unknown>; effectiveFromMs?: number } {
  if (!isRecordObject(body)) {
    throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
  }
  const effectiveFromMs = parseOptionalIsoTimestampMs(body.effectiveFrom, "effectiveFrom");

  if (body.settings !== undefined) {
    if (!isRecordObject(body.settings)) {
      throw new DomainError("INVALID_INPUT", "settings må være et objekt.");
    }
    return {
      settings: body.settings,
      effectiveFromMs
    };
  }

  const { effectiveFrom: _ignoredEffectiveFrom, ...directSettings } = body;
  return {
    settings: directSettings,
    effectiveFromMs
  };
}

function buildAdminSettingsDefinitionForGame(game: GameDefinition): GameSettingsDefinition {
  if (game.slug === "bingo") {
    return buildBingoSettingsDefinition({
      minRoundIntervalMs: bingoMinRoundIntervalMs,
      minPlayersToStart: bingoMinPlayersToStart,
      maxTicketsPerPlayer: 5,
      fixedAutoDrawIntervalMs: fixedAutoDrawIntervalMs,
      forceAutoStart,
      forceAutoDraw,
      runningRoundLockActive: hasAnyRunningBingoRound()
    });
  }
  return buildDefaultGameSettingsDefinition(game);
}

function buildAdminSettingsCatalogResponse(games: GameDefinition[]): AdminSettingsCatalog {
  return {
    generatedAt: new Date().toISOString(),
    games: games.map((game) => buildAdminSettingsDefinitionForGame(game))
  };
}

function buildAdminGameSettingsResponse(game: GameDefinition): Record<string, unknown> {
  return {
    slug: game.slug,
    title: game.title,
    description: game.description,
    updatedAt: game.updatedAt,
    settings: { ...(game.settings ?? {}) },
    locks: {
      runningRoundLockActive: false
    }
  };
}

async function persistBingoSettingsToCatalog(options?: PersistBingoSettingsOptions): Promise<void> {
  void options;
}

async function hydrateBingoSettingsFromCatalog(): Promise<void> {
  return Promise.resolve();
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

async function requireAdminPermissionUser(
  req: express.Request,
  permission: AdminPermission,
  message?: string
): Promise<PublicAppUser> {
  const user = await getAuthenticatedUser(req);
  assertAdminPermission(user.role, permission, message);
  return user;
}

async function requireAdminPanelUser(req: express.Request, message?: string): Promise<PublicAppUser> {
  const user = await getAuthenticatedUser(req);
  assertAdminPermission(user.role, "ADMIN_PANEL_ACCESS", message);
  return user;
}

function buildAdminPermissionResponse(user: PublicAppUser): Record<string, unknown> {
  return {
    role: user.role,
    permissions: listAdminPermissionsForRole(user.role),
    permissionMap: getAdminPermissionMap(user.role),
    policy: ADMIN_ACCESS_POLICY
  };
}

function parseUserRoleInput(value: unknown): UserRole {
  const role = mustBeNonEmptyString(value, "role").toUpperCase();
  if (!APP_USER_ROLES.includes(role as UserRole)) {
    throw new DomainError(
      "INVALID_INPUT",
      `role må være en av: ${APP_USER_ROLES.join(", ")}.`
    );
  }
  return role as UserRole;
}

function parseOptionalTicketsPerPlayerInput(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parseTicketsPerPlayerInput(value);
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
  let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();

  // BIN-134: SPA sends "BINGO1" as canonical room alias.
  if (roomCode === "BINGO1" && enforceSingleRoomPerHall) {
    const hallId = (payload as any)?.hallId || "default-hall";
    const canonicalRoom = getPrimaryRoomForHall(hallId);
    if (canonicalRoom) {
      roomCode = canonicalRoom.code;
      console.log("[BIN-134] requireAuthenticatedPlayerAction BINGO1 → canonical room", roomCode);
    }
  }

  // BIN-46: Derive playerId from token, NOT from client payload.
  // The player's walletId from the authenticated token is the source of truth.
  // We find the player in the room by matching walletId, preventing spoofing.
  if (user.role !== "ADMIN") {
    const snapshot = engine.getRoomSnapshot(roomCode);
    const player = snapshot.players.find((p) => p.walletId === user.walletId);
    if (!player) {
      throw new DomainError("PLAYER_NOT_FOUND", "Du er ikke med i dette rommet.");
    }
    // Warn if client sent a mismatching playerId (potential spoofing attempt)
    const clientPlayerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
    if (clientPlayerId && clientPlayerId !== player.id) {
      console.warn(
        `SECURITY: playerId mismatch — client sent "${clientPlayerId}" but token resolves to "${player.id}" (user ${user.id}, room ${roomCode})`
      );
    }
    return { roomCode, playerId: player.id };
  }

  // Admin: still accept payload playerId but verify it exists
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

async function buildAuthenticatedPlayerReport(input: {
  walletId: string;
  hallId?: string;
  period: PlayerReportPeriod;
  now?: Date;
}): Promise<ReturnType<typeof buildPlayerReport>> {
  const halls = await platformService.listHalls({ includeInactive: false });
  const normalizedHallId = input.hallId?.trim() || undefined;
  if (normalizedHallId && !halls.some((hall) => hall.id === normalizedHallId)) {
    throw new DomainError("HALL_NOT_FOUND", "Valgt hall finnes ikke.");
  }

  const range = resolvePlayerReportRange(input.period, input.now ?? new Date());
  const entries = engine.listComplianceLedgerEntries({
    limit: 10_000,
    dateFrom: range.from,
    dateTo: range.to,
    hallId: normalizedHallId,
    walletId: input.walletId
  });

  return buildPlayerReport({
    entries,
    halls,
    range,
    hallId: normalizedHallId
  });
}

async function emitRoomUpdate(roomCode: string): Promise<RoomSnapshot> {
  const snapshot = engine.getRoomSnapshot(roomCode);
  const payload = buildRoomUpdatePayload(snapshot);
  io.to(roomCode).emit("room:update", payload);
  return payload;
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

/** In-memory chat history per room. Capped to last 100 messages. */
const chatHistoryByRoom = new Map<string, ChatMessage[]>();
const MAX_CHAT_MESSAGES_PER_ROOM = 100;

function appendChatMessage(roomCode: string, msg: ChatMessage): void {
  let history = chatHistoryByRoom.get(roomCode);
  if (!history) {
    history = [];
    chatHistoryByRoom.set(roomCode, history);
  }
  history.push(msg);
  if (history.length > MAX_CHAT_MESSAGES_PER_ROOM) {
    history.splice(0, history.length - MAX_CHAT_MESSAGES_PER_ROOM);
  }
}

/** Per-room lucky number selections: Map<roomCode, Map<playerId, luckyNumber>> */
const luckyNumbersByRoom = new Map<string, Map<string, number>>();

function setLuckyNumber(roomCode: string, playerId: string, number: number): void {
  let roomMap = luckyNumbersByRoom.get(roomCode);
  if (!roomMap) {
    roomMap = new Map();
    luckyNumbersByRoom.set(roomCode, roomMap);
  }
  roomMap.set(playerId, number);
}

function getLuckyNumbers(roomCode: string): Record<string, number> {
  const roomMap = luckyNumbersByRoom.get(roomCode);
  if (!roomMap) return {};
  return Object.fromEntries(roomMap);
}

/** Build leaderboard from game history across rooms.
 *  Points: LINE win = 1 pt, BINGO win = 2 pts. Sorted descending. */
function buildLeaderboard(roomCode?: string): LeaderboardEntry[] {
  const pointsByPlayer = new Map<string, { name: string; points: number }>();

  const roomCodes = roomCode ? [roomCode] : engine.getAllRoomCodes();
  for (const code of roomCodes) {
    let snapshot: RoomSnapshot;
    try { snapshot = engine.getRoomSnapshot(code); } catch { continue; }

    // Player name lookup
    const nameById = new Map<string, string>();
    for (const p of snapshot.players) nameById.set(p.id, p.name);

    for (const game of snapshot.gameHistory) {
      for (const claim of game.claims) {
        if (!claim.valid) continue;
        const pts = claim.type === "BINGO" ? 2 : 1;
        const existing = pointsByPlayer.get(claim.playerId);
        const name = nameById.get(claim.playerId) ?? claim.playerId;
        if (existing) {
          existing.points += pts;
          if (!existing.name || existing.name === claim.playerId) existing.name = name;
        } else {
          pointsByPlayer.set(claim.playerId, { name, points: pts });
        }
      }
    }
  }

  return [...pointsByPlayer.values()]
    .sort((a, b) => b.points - a.points)
    .slice(0, 50)
    .map(({ name, points }) => ({ nickname: name, points }));
}

const roomConfiguredEntryFeeByRoom = new Map<string, number>();
/** Per-room set of player IDs who have armed their bet for the next round. */
const armedPlayerIdsByRoom = new Map<string, Set<string>>();
/** Cached display tickets for unarmed players — stable until game changes. */
const displayTicketCache = new Map<string, Ticket[]>();

function getOrCreateDisplayTickets(roomCode: string, playerId: string, count: number): Ticket[] {
  const key = `${roomCode}:${playerId}`;
  const cached = displayTicketCache.get(key);
  if (cached && cached.length === count) return cached;
  const tickets: Ticket[] = [];
  for (let i = 0; i < count; i++) {
    tickets.push(generateDatabingo60Ticket());
  }
  displayTicketCache.set(key, tickets);
  return tickets;
}

function clearDisplayTicketCache(roomCode: string): void {
  for (const key of displayTicketCache.keys()) {
    if (key.startsWith(`${roomCode}:`)) {
      displayTicketCache.delete(key);
    }
  }
}
// DrawScheduler is initialized after emitRoomUpdate is defined (see below).
let drawScheduler: DrawScheduler;

function getArmedPlayerIds(roomCode: string): string[] {
  return [...(armedPlayerIdsByRoom.get(roomCode) ?? [])];
}

function armPlayer(roomCode: string, playerId: string): void {
  let set = armedPlayerIdsByRoom.get(roomCode);
  if (!set) {
    set = new Set();
    armedPlayerIdsByRoom.set(roomCode, set);
  }
  set.add(playerId);
}

function disarmPlayer(roomCode: string, playerId: string): void {
  armedPlayerIdsByRoom.get(roomCode)?.delete(playerId);
}

function disarmAllPlayers(roomCode: string): void {
  armedPlayerIdsByRoom.get(roomCode)?.clear();
}
// ── Room priority (used by getPrimaryRoomForHall) ──────────────

function compareRoomPriority(a: RoomSummary, b: RoomSummary): number {
  const runA = a.gameStatus === "RUNNING" ? 1 : 0;
  const runB = b.gameStatus === "RUNNING" ? 1 : 0;
  if (runA !== runB) return runB - runA;
  if (a.playerCount !== b.playerCount) return b.playerCount - a.playerCount;
  const createdA = Date.parse(a.createdAt);
  const createdB = Date.parse(b.createdAt);
  const normA = Number.isFinite(createdA) ? createdA : Number.MAX_SAFE_INTEGER;
  const normB = Number.isFinite(createdB) ? createdB : Number.MAX_SAFE_INTEGER;
  if (normA !== normB) return normA - normB;
  return a.code.localeCompare(b.code);
}

function getPrimaryRoomForHall(hallId: string, summaries = engine.listRoomSummaries()): RoomSummary | null {
  const hallSummaries = summaries.filter((summary) => summary.hallId === hallId);
  if (hallSummaries.length === 0) {
    return null;
  }
  hallSummaries.sort(compareRoomPriority);
  return hallSummaries[0];
}

function findPlayerInRoomByWallet(snapshot: RoomSnapshot, walletId: string): RoomSnapshot["players"][number] | null {
  const normalizedWalletId = walletId.trim();
  if (!normalizedWalletId) {
    return null;
  }
  return snapshot.players.find((player) => player.walletId === normalizedWalletId) ?? null;
}

function getRoomConfiguredEntryFee(roomCode: string): number {
  const configured = roomConfiguredEntryFeeByRoom.get(roomCode);
  if (configured === undefined || !Number.isFinite(configured)) {
    return runtimeBingoSettings.autoRoundEntryFee;
  }
  return configured;
}

function setRoomConfiguredEntryFee(roomCode: string, entryFee: number): number {
  const normalized = Math.max(0, Math.round(entryFee * 100) / 100);
  roomConfiguredEntryFeeByRoom.set(roomCode, normalized);
  return normalized;
}

function buildRoomSchedulerState(snapshot: RoomSnapshot, nowMs: number): Record<string, unknown> {
  const nextStartAtMs = runtimeBingoSettings.autoRoundStartEnabled
    ? drawScheduler.normalizeNextAutoStartAt(snapshot.code, nowMs)
    : null;
  const millisUntilNextStart = nextStartAtMs === null ? null : Math.max(0, nextStartAtMs - nowMs);
  const canStartNow =
    runtimeBingoSettings.autoRoundStartEnabled &&
    snapshot.currentGame?.status !== "RUNNING" &&
    snapshot.players.length >= runtimeBingoSettings.autoRoundMinPlayers &&
    millisUntilNextStart !== null &&
    millisUntilNextStart <= Math.max(1000, schedulerTickMs * 2);

  const currentDrawCount = snapshot.currentGame?.drawnNumbers?.length ?? 0;

  return {
    enabled: runtimeBingoSettings.autoRoundStartEnabled,
    liveRoundsIndependentOfBet: true,
    intervalMs: runtimeBingoSettings.autoRoundStartIntervalMs,
    minPlayers: runtimeBingoSettings.autoRoundMinPlayers,
    playerCount: snapshot.players.length,
    armedPlayerCount: getArmedPlayerIds(snapshot.code).length,
    armedPlayerIds: getArmedPlayerIds(snapshot.code),
    entryFee: getRoomConfiguredEntryFee(snapshot.code),
    payoutPercent: runtimeBingoSettings.payoutPercent,
    drawCapacity: bingoMaxDrawsPerRound,
    currentDrawCount,
    remainingDrawCapacity: Math.max(0, bingoMaxDrawsPerRound - currentDrawCount),
    nextStartAt: nextStartAtMs === null ? null : new Date(nextStartAtMs).toISOString(),
    millisUntilNextStart,
    canStartNow,
    serverTime: new Date(nowMs).toISOString()
  };
}

function buildRoomUpdatePayload(
  snapshot: RoomSnapshot,
  nowMs = Date.now()
): RoomSnapshot & { scheduler: Record<string, unknown>; preRoundTickets: Record<string, Ticket[]>; luckyNumbers: Record<string, number>; serverTimestamp: number } {
  // Generate display tickets for players who are in the room but didn't
  // get game tickets (not armed). This ensures their boards always show
  // numbers — just without marking.
  const preRoundTickets: Record<string, Ticket[]> = {};
  const gameTickets = snapshot.currentGame?.tickets ?? {};
  const ticketsPerPlayer = runtimeBingoSettings.autoRoundTicketsPerPlayer;
  for (const player of snapshot.players) {
    if (gameTickets[player.id] && gameTickets[player.id].length > 0) continue;
    preRoundTickets[player.id] = getOrCreateDisplayTickets(snapshot.code, player.id, ticketsPerPlayer);
  }
  return {
    ...snapshot,
    preRoundTickets,
    luckyNumbers: getLuckyNumbers(snapshot.code),
    scheduler: buildRoomSchedulerState(snapshot, nowMs),
    serverTimestamp: nowMs,
  };
}

function cleanupRoomConfiguredEntryFees(activeRoomCodes: Set<string>): void {
  for (const roomCode of roomConfiguredEntryFeeByRoom.keys()) {
    if (!activeRoomCodes.has(roomCode)) {
      roomConfiguredEntryFeeByRoom.delete(roomCode);
    }
  }
}

/** Convert BingoSchedulerSettings → SchedulerSettings for DrawScheduler. */
function toDrawSchedulerSettings(s: BingoSchedulerSettings): SchedulerSettings {
  return {
    autoRoundStartEnabled: s.autoRoundStartEnabled,
    autoRoundStartIntervalMs: s.autoRoundStartIntervalMs,
    autoRoundMinPlayers: s.autoRoundMinPlayers,
    autoDrawEnabled: s.autoDrawEnabled,
    autoDrawIntervalMs: s.autoDrawIntervalMs,
  };
}

async function applyPendingBingoSettingsIfDue(
  nowMs: number,
  summaries: ReturnType<typeof engine.listRoomSummaries>
): Promise<boolean> {
  if (!pendingBingoSettingsUpdate) {
    return false;
  }
  if (pendingBingoSettingsUpdate.effectiveFromMs > nowMs) {
    return false;
  }
  if (hasAnyRunningBingoRound(summaries)) {
    return false;
  }

  const previous: BingoSchedulerSettings = { ...runtimeBingoSettings };
  const previousEffectiveFromMs = bingoSettingsEffectiveFromMs;
  const pendingToApply = {
    effectiveFromMs: pendingBingoSettingsUpdate.effectiveFromMs,
    settings: { ...pendingBingoSettingsUpdate.settings }
  };
  pendingBingoSettingsUpdate = null;
  Object.assign(runtimeBingoSettings, pendingToApply.settings);
  bingoSettingsEffectiveFromMs = pendingToApply.effectiveFromMs;
  drawScheduler.syncAfterSettingsChange(toDrawSchedulerSettings(previous));

  try {
    await persistBingoSettingsToCatalog({
      source: "BINGO_SETTINGS_AUTO_APPLY",
      effectiveFromMs: pendingToApply.effectiveFromMs
    });
  } catch (error) {
    Object.assign(runtimeBingoSettings, previous);
    bingoSettingsEffectiveFromMs = previousEffectiveFromMs;
    pendingBingoSettingsUpdate = pendingToApply;
    drawScheduler.syncAfterSettingsChange(toDrawSchedulerSettings(pendingToApply.settings));
    throw error;
  }

  await emitManyRoomUpdates(engine.getAllRoomCodes());
  return true;
}

// ── DrawScheduler initialization ──────────────────────────────────────
// All scheduler timing, locking, watchdog, error classification, processAutoStart,
// processAutoDraw and the tick loop live in DrawScheduler. This block wires up the
// business-logic callbacks (onAutoStart / onAutoDraw) that the scheduler invokes
// inside its lock.

drawScheduler = new DrawScheduler({
  tickIntervalMs: schedulerTickMs,
  lockTimeoutMs: 5_000,
  watchdogIntervalMs: 5_000,
  watchdogStuckMultiplier: 3,
  fixedDrawIntervalMs: fixedAutoDrawIntervalMs,
  enforceSingleRoomPerHall: enforceSingleRoomPerHall,
  onRoomRescheduled: async (roomCode) => {
    // Ensure clients receive an updated scheduler state (nextStartAt / millisUntilNextStart)
    // when we reschedule without drawing or starting a new round.
    await emitRoomUpdate(roomCode);
  },

  onRoomExhausted: (roomCode, count) => {
    console.error(
      `[DrawScheduler] Room ${roomCode} exhausted after ${count} consecutive stuck detections. ` +
      `Ending round with SYSTEM_ERROR.`
    );
    try {
      const snapshot = engine.getRoomSnapshot(roomCode);
      if (snapshot.currentGame?.status === "RUNNING") {
        engine.endGame({ roomCode, actorPlayerId: snapshot.hostPlayerId, reason: "SYSTEM_ERROR" });
        void emitRoomUpdate(roomCode);
      }
    } catch (error) {
      console.error(`[DrawScheduler] Failed to end exhausted room ${roomCode}:`, error);
    }
  },

  onShutdown: async (activeRoomCodes) => {
    for (const roomCode of activeRoomCodes) {
      io.to(roomCode).emit("room:update", {
        ...buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode)),
        serverRestarting: true,
      });
    }
  },

  getSettings: () => toDrawSchedulerSettings(runtimeBingoSettings),
  listRoomSummaries: () => engine.listRoomSummaries(),
  getRoomSnapshot: (roomCode) => engine.getRoomSnapshot(roomCode),
  getAllRoomCodes: () => engine.getAllRoomCodes(),

  applyPendingSettings: async (nowMs, summaries) => {
    // Adapter: DrawScheduler passes its own RoomSummary[], but
    // applyPendingBingoSettingsIfDue expects the engine's type.
    // They are structurally compatible.
    return applyPendingBingoSettingsIfDue(nowMs, summaries as ReturnType<typeof engine.listRoomSummaries>);
  },

  onAutoStart: async (roomCode, hostPlayerId) => {
    let firstDrawAtMs: number | null = null;
    try {
      await engine.startGame({
        roomCode,
        actorPlayerId: hostPlayerId,
        entryFee: getRoomConfiguredEntryFee(roomCode),
        ticketsPerPlayer: runtimeBingoSettings.autoRoundTicketsPerPlayer,
        payoutPercent: runtimeBingoSettings.payoutPercent,
        armedPlayerIds: getArmedPlayerIds(roomCode),
      });
      disarmAllPlayers(roomCode);
      clearDisplayTicketCache(roomCode);
    } catch (error) {
      if (
        error instanceof DomainError &&
        (error.code === "PLAYER_ALREADY_IN_RUNNING_GAME" ||
          error.code === "ROUND_START_TOO_SOON" ||
          error.code === "NOT_ENOUGH_PLAYERS")
      ) {
        // Permanent domain errors — scheduler will reschedule the next round.
        return { firstDrawAtMs };
      }
      throw error;
    }

    // Publish the RUNNING snapshot so clients transition UI before the first draw.
    await emitRoomUpdate(roomCode);

    if (!runtimeBingoSettings.autoDrawEnabled) {
      return { firstDrawAtMs };
    }

    // Draw the first ball immediately (no extra 2s gap after countdown).
    try {
      const { number, drawIndex, gameId } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId });
      io.to(roomCode).emit("draw:new", { number, source: "auto", drawIndex, gameId });
      // Anchor the cadence to the actual first draw emission time so draw #2
      // happens intervalMs after draw #1 (no longer 2x interval for the first gap).
      firstDrawAtMs = Date.now();
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NO_MORE_NUMBERS") {
        throw error;
      }
    }

    await emitRoomUpdate(roomCode);
    return { firstDrawAtMs };
  },

  onAutoDraw: async (roomCode, hostPlayerId) => {
    let roundEnded = false;

    try {
      const { number, drawIndex, gameId } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId });
      io.to(roomCode).emit("draw:new", { number, source: "auto", drawIndex, gameId });
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NO_MORE_NUMBERS") {
        throw error;
      }
    }

    // Check if draw ended the round (max draws reached).
    const postDrawSnapshot = engine.getRoomSnapshot(roomCode);
    if (postDrawSnapshot.currentGame?.status !== "RUNNING") {
      roundEnded = true;
    }

    await emitRoomUpdate(roomCode);
    return { roundEnded };
  },
});

drawScheduler.start();

function formatDateKeyLocal(reference: Date): string {
  const year = reference.getFullYear();
  const month = String(reference.getMonth() + 1).padStart(2, "0");
  const day = String(reference.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yesterdayDateKeyLocal(nowMs: number): string {
  const now = new Date(nowMs);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return formatDateKeyLocal(yesterday);
}

let lastDailyReportDateKey = "";
async function runDailyReportSchedulerTick(nowMs: number): Promise<void> {
  const dateKey = yesterdayDateKeyLocal(nowMs);
  if (dateKey === lastDailyReportDateKey) {
    return;
  }
  const report = await engine.runDailyReportJob({ date: dateKey });
  lastDailyReportDateKey = dateKey;
  console.log(
    `[daily-report] generated date=${report.date} rows=${report.rows.length} turnover=${report.totals.grossTurnover} prizes=${report.totals.prizesPaid}`
  );
}

let reportScheduler: NodeJS.Timeout | null = null;
function startDailyReportScheduler(): void {
  if (!dailyReportJobEnabled || reportScheduler) {
    return;
  }
  runDailyReportSchedulerTick(Date.now()).catch((error) => {
    console.error("[daily-report] initial run feilet", error);
  });
  reportScheduler = setInterval(() => {
    runDailyReportSchedulerTick(Date.now()).catch((error) => {
      console.error("[daily-report] scheduler feilet", error);
    });
  }, dailyReportJobIntervalMs);
  reportScheduler.unref();
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = mustBeNonEmptyString(req.body?.email, "email");
    const password = mustBeNonEmptyString(req.body?.password, "password");
    const displayName = mustBeNonEmptyString(req.body?.displayName, "displayName");
    const surname = mustBeNonEmptyString(req.body?.surname, "surname");
    const birthDate = mustBeNonEmptyString(req.body?.birthDate, "birthDate");
    const phone = typeof req.body?.phone === "string" && req.body.phone.trim()
      ? req.body.phone.trim()
      : undefined;
    const complianceData = req.body?.complianceData && typeof req.body.complianceData === "object"
      ? req.body.complianceData as Record<string, unknown>
      : undefined;
    const session = await platformService.register({
      email,
      password,
      displayName,
      surname,
      phone,
      birthDate,
      complianceData
    });
    apiSuccess(res, session);
  } catch (error) {
    apiFailure(res, error);
  }
});

// ── BankID verification (BIN-274) ─────────────────────────────────────────
app.post("/api/auth/bankid/init", async (req, res) => {
  try {
    if (!bankIdAdapter) {
      apiSuccess(res, {
        sessionId: `bankid-${Date.now()}`,
        authUrl: null,
        status: "NOT_CONFIGURED",
        message: "BankID-integrasjon er ikke konfigurert. Bruk manuell verifisering."
      });
      return;
    }
    const user = await getAuthenticatedUser(req);
    const { sessionId, authUrl } = bankIdAdapter.createAuthSession(user.id);
    apiSuccess(res, { sessionId, authUrl, status: "PENDING" });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/auth/bankid/callback", async (req, res) => {
  try {
    if (!bankIdAdapter) {
      res.status(501).json({ error: "BankID ikke konfigurert" });
      return;
    }
    const { code, state, session_id } = req.query as Record<string, string>;
    if (!code || !state || !session_id) {
      res.status(400).json({ error: "Mangler code, state eller session_id" });
      return;
    }
    const result = await bankIdAdapter.handleCallback(session_id, code, state);
    if (result.birthDate) {
      await platformService.submitKycVerification({ userId: result.userId, birthDate: result.birthDate, nationalId: result.nationalId ?? undefined });
    }
    // Redirect user back to web shell after BankID verification
    res.redirect("/web/?bankid=complete");
  } catch (error) {
    console.error("[BankID] Callback error:", error);
    res.redirect("/web/?bankid=error");
  }
});

app.get("/api/auth/bankid/status/:sessionId", async (req, res) => {
  try {
    if (!bankIdAdapter) {
      apiSuccess(res, { sessionId: req.params.sessionId, status: "NOT_CONFIGURED", verified: false });
      return;
    }
    // Check user's KYC status directly
    const user = await getAuthenticatedUser(req);
    apiSuccess(res, {
      sessionId: req.params.sessionId,
      status: user.kycStatus === "VERIFIED" ? "COMPLETE" : "PENDING",
      verified: user.kycStatus === "VERIFIED",
    });
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

app.post("/api/admin/auth/login", async (req, res) => {
  try {
    const email = mustBeNonEmptyString(req.body?.email, "email");
    const password = mustBeNonEmptyString(req.body?.password, "password");
    const session = await platformService.login({
      email,
      password
    });
    if (!canAccessAdminPermission(session.user.role, "ADMIN_PANEL_ACCESS")) {
      await platformService.logout(session.accessToken);
      throw new DomainError(
        "FORBIDDEN",
        `Rollen ${session.user.role} har ikke tilgang til admin-panelet.`
      );
    }
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

// BIN-174: Token refresh — issue new token, revoke old one
app.post("/api/auth/refresh", async (req, res) => {
  try {
    const accessToken = getAccessTokenFromRequest(req);
    const session = await platformService.refreshSession(accessToken);
    apiSuccess(res, session);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/auth/logout", async (req, res) => {
  try {
    await requireAdminPanelUser(req);
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

// ── Profile management ────────────────────────────────────────────────────

app.put("/api/auth/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const updated = await platformService.updateProfile(user.id, {
      displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined,
      email: typeof req.body?.email === "string" ? req.body.email : undefined,
      phone: typeof req.body?.phone === "string" ? req.body.phone : undefined
    });
    apiSuccess(res, updated);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/auth/change-password", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const currentPassword = mustBeNonEmptyString(req.body?.currentPassword, "currentPassword");
    const newPassword = mustBeNonEmptyString(req.body?.newPassword, "newPassword");
    await platformService.changePassword(user.id, { currentPassword, newPassword });
    apiSuccess(res, { changed: true });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/auth/me", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    await platformService.deleteAccount(user.id);
    apiSuccess(res, { deleted: true });
  } catch (error) {
    apiFailure(res, error);
  }
});

// ── Forgot password (stub — always returns success to avoid user enumeration) ──

app.post("/api/auth/forgot-password", async (req, res) => {
  // Always return success regardless of whether the email exists.
  // In production, this would send an email with a reset link.
  apiSuccess(res, { sent: true });
});

// ── Transaction history ───────────────────────────────────────────────────

app.get("/api/wallet/me/transactions", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const limit = parseLimit(req.query.limit, 50);
    const transactions = await walletAdapter.listTransactions(user.walletId, limit);
    apiSuccess(res, transactions);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/auth/me", async (req, res) => {
  try {
    const user = await requireAdminPanelUser(req);
    apiSuccess(res, user);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/permissions", async (req, res) => {
  try {
    const user = await requireAdminPanelUser(req);
    apiSuccess(res, buildAdminPermissionResponse(user));
  } catch (error) {
    apiFailure(res, error);
  }
});

// BIN-134: One-time bootstrap endpoint to promote a user to ADMIN when no admin exists.
// Requires ADMIN_BOOTSTRAP_SECRET env var. Remove after first admin is created.
app.post("/api/admin/bootstrap", async (req, res) => {
  try {
    const secret = process.env.ADMIN_BOOTSTRAP_SECRET?.trim();
    if (!secret) {
      throw new DomainError("DISABLED", "Bootstrap er deaktivert (ADMIN_BOOTSTRAP_SECRET ikke satt).");
    }
    if (req.body?.secret !== secret) {
      throw new DomainError("UNAUTHORIZED", "Ugyldig bootstrap-hemmelighet.");
    }
    const email = mustBeNonEmptyString(req.body?.email, "email");
    const password = mustBeNonEmptyString(req.body?.password, "password");
    // Login to get the user, then promote to ADMIN
    const session = await platformService.login({ email, password });
    const updated = await platformService.updateUserRole(session.user.id, "ADMIN");
    apiSuccess(res, { message: `${updated.email} er nå ADMIN.`, role: updated.role });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/users/:userId/role", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "USER_ROLE_WRITE");
    const userId = mustBeNonEmptyString(req.params.userId, "userId");
    const role = parseUserRoleInput(req.body?.role);
    const updated = await platformService.updateUserRole(userId, role);
    apiSuccess(res, updated);
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

// BIN-266: Live game status per slug — used by web shell lobby to show Open/Closed/Starting badges.
// Groups active rooms by gameSlug and picks the most "alive" status per game.
app.get("/api/games/status", async (req, res) => {
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
app.post("/api/games/:slug/launch", async (req, res) => {
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
          currency: "NOK",
          language: "nb-NO",
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

app.get("/api/admin/games", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "GAME_CATALOG_READ");
    const games = await platformService.listGames({ includeDisabled: true });
    apiSuccess(res, games);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/settings/catalog", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "GAME_CATALOG_READ");
    const games = await platformService.listGames({ includeDisabled: true });
    apiSuccess(res, buildAdminSettingsCatalogResponse(games));
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/settings/games/:slug", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "GAME_CATALOG_READ");
    const slug = mustBeNonEmptyString(req.params.slug, "slug");
    const game = await platformService.getGame(slug);
    apiSuccess(res, buildAdminGameSettingsResponse(game));
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/settings/games/:slug", async (req, res) => {
  try {
    const adminUser = await requireAdminPermissionUser(req, "GAME_CATALOG_WRITE");
    const slug = mustBeNonEmptyString(req.params.slug, "slug");
    const { settings, effectiveFromMs } = extractAdminGameSettingsPayload(req.body);
    const updated = await platformService.updateGame(slug, {
      settings: normalizeGameSettingsForUpdate(slug, settings)
    }, {
      changedBy: {
        userId: adminUser.id,
        displayName: adminUser.displayName,
        role: adminUser.role
      },
      source: "ADMIN_TYPED_GAME_SETTINGS_WRITE",
      effectiveFrom:
        effectiveFromMs !== undefined
          ? new Date(effectiveFromMs).toISOString()
          : new Date().toISOString()
    });
    apiSuccess(res, buildAdminGameSettingsResponse(updated));
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/game-settings/change-log", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "GAME_SETTINGS_CHANGELOG_READ");
    const gameSlug = typeof req.query.gameSlug === "string" ? req.query.gameSlug.trim() : undefined;
    const limit = parseLimit(req.query.limit, 50);
    const log = await platformService.listGameSettingsChangeLog({
      gameSlug: gameSlug || undefined,
      limit
    });
    apiSuccess(res, log);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/games/:slug", async (req, res) => {
  try {
    const adminUser = await requireAdminPermissionUser(req, "GAME_CATALOG_WRITE");
    const slug = mustBeNonEmptyString(req.params.slug, "slug");
    const rawSettings =
      req.body?.settings && typeof req.body.settings === "object" && !Array.isArray(req.body.settings)
        ? (req.body.settings as Record<string, unknown>)
        : undefined;
    const updated = await platformService.updateGame(slug, {
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      route: typeof req.body?.route === "string" ? req.body.route : undefined,
      isEnabled: typeof req.body?.isEnabled === "boolean" ? req.body.isEnabled : undefined,
      sortOrder: Number.isFinite(req.body?.sortOrder) ? Number(req.body.sortOrder) : undefined,
      settings: normalizeGameSettingsForUpdate(slug, rawSettings)
    }, {
      changedBy: {
        userId: adminUser.id,
        displayName: adminUser.displayName,
        role: adminUser.role
      },
      source: "ADMIN_GAME_CATALOG_WRITE",
      effectiveFrom: new Date().toISOString()
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
    await requireAdminPermissionUser(req, "HALL_READ");
    const includeInactive = parseBooleanQueryValue(req.query.includeInactive, true);
    const halls = await platformService.listHalls({ includeInactive });
    apiSuccess(res, halls);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/halls", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "HALL_WRITE");
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
    await requireAdminPermissionUser(req, "HALL_WRITE");
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
    await requireAdminPermissionUser(req, "TERMINAL_READ");
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
    await requireAdminPermissionUser(req, "TERMINAL_WRITE");
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
    await requireAdminPermissionUser(req, "TERMINAL_WRITE");
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
    await requireAdminPermissionUser(req, "HALL_GAME_CONFIG_READ");
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
    await requireAdminPermissionUser(req, "HALL_GAME_CONFIG_WRITE");
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

app.get("/api/admin/rooms", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
    const includeSnapshots = parseBooleanQueryValue(req.query.includeSnapshots, false);
    const rooms = engine.listRoomSummaries();
    if (!includeSnapshots) {
      apiSuccess(res, rooms);
      return;
    }
    const detailed = rooms.map((room) => ({
      ...room,
      snapshot: buildRoomUpdatePayload(engine.getRoomSnapshot(room.code))
    }));
    apiSuccess(res, detailed);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/rooms/:roomCode", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
    apiSuccess(res, snapshot);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/rooms", async (req, res) => {
  try {
    const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const hallId = await requireActiveHallIdFromInput(req.body?.hallId);

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
    const snapshot = await emitRoomUpdate(roomCode);
    apiSuccess(res, {
      roomCode,
      playerId,
      snapshot
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/admin/rooms/:roomCode", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    engine.destroyRoom(roomCode);
    drawScheduler.releaseRoom(roomCode);
    roomConfiguredEntryFeeByRoom.delete(roomCode);
    apiSuccess(res, { deleted: roomCode });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/rooms/:roomCode/start", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    const entryFee = parseOptionalNonNegativeNumber(req.body?.entryFee, "entryFee") ?? getRoomConfiguredEntryFee(roomCode);
    const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
    const requestedTicketsPerPlayer = parseOptionalTicketsPerPlayerInput(req.body?.ticketsPerPlayer);
    const ticketsPerPlayer =
      requestedTicketsPerPlayer ??
      Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeBingoSettings.autoRoundTicketsPerPlayer);
    assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
    const beforeStartSnapshot = engine.getRoomSnapshot(roomCode);
    await engine.startGame({
      roomCode,
      actorPlayerId: beforeStartSnapshot.hostPlayerId,
      entryFee,
      ticketsPerPlayer,
      payoutPercent: runtimeBingoSettings.payoutPercent,
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

app.post("/api/admin/rooms/:roomCode/draw-next", async (req, res) => {
  try {
    // BIN-254: Capture actual admin actor for audit log — not just the room host ID
    const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
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

app.post("/api/admin/rooms/:roomCode/end", async (req, res) => {
  try {
    const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
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

app.get("/api/spillevett/report", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const period = parsePlayerReportPeriod(req.query.period, "last7");
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const report = await buildAuthenticatedPlayerReport({
      walletId: user.walletId,
      hallId,
      period
    });
    apiSuccess(res, report);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/spillevett/report/export", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const period = parsePlayerReportPeriod(req.body?.period, "last365");
    const hallId = typeof req.body?.hallId === "string" ? req.body.hallId.trim() : undefined;
    const delivery =
      typeof req.body?.delivery === "string" && req.body.delivery.trim().toLowerCase() === "email"
        ? "email"
        : "download";
    const report = await buildAuthenticatedPlayerReport({
      walletId: user.walletId,
      hallId,
      period
    });
    const pdf = await generatePlayerReportPdf({
      report,
      playerName: user.displayName,
      playerEmail: user.email
    });

    if (delivery === "email") {
      const recipientEmail =
        typeof req.body?.email === "string" && req.body.email.trim().length > 0
          ? req.body.email.trim()
          : user.email;
      const result = await emailPlayerReport({
        report,
        playerName: user.displayName,
        playerEmail: user.email,
        recipientEmail,
        pdf
      });
      apiSuccess(res, {
        delivery: "email",
        recipientEmail: result.recipientEmail,
        period: report.range.period,
        generatedAt: report.generatedAt
      });
      return;
    }

    const filenameBase = report.hallId ? `spillregnskap-${report.hallId}` : "spillregnskap";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}-${report.range.period}.pdf"`);
    res.status(200).send(pdf);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallet/me/timed-pause", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
    const compliance = await engine.setTimedPause({
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
    const compliance = await engine.clearTimedPause(user.walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/wallet/me/self-exclusion", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const compliance = await engine.setSelfExclusion(user.walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/wallet/me/self-exclusion", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const compliance = await engine.clearSelfExclusion(user.walletId);
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
    const compliance = await engine.setPlayerLossLimits({
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
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_READ");
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
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
    const dailyLossLimit = parseOptionalNonNegativeNumber(req.body?.dailyLossLimit, "dailyLossLimit");
    const monthlyLossLimit = parseOptionalNonNegativeNumber(req.body?.monthlyLossLimit, "monthlyLossLimit");
    if (dailyLossLimit === undefined && monthlyLossLimit === undefined) {
      throw new DomainError("INVALID_INPUT", "dailyLossLimit eller monthlyLossLimit må oppgis.");
    }
    const compliance = await engine.setPlayerLossLimits({
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
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const durationMinutes = parseOptionalPositiveInteger(req.body?.durationMinutes, "durationMinutes");
    const compliance = await engine.setTimedPause({
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
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = await engine.clearTimedPause(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = await engine.setSelfExclusion(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = await engine.clearSelfExclusion(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/compliance/extra-draw-denials", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "EXTRA_DRAW_DENIALS_READ");
    const limit = parseLimit(req.query.limit, 100);
    apiSuccess(res, engine.listExtraDrawDenials(limit));
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/prize-policy/active", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "PRIZE_POLICY_READ");
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
    await requireAdminPermissionUser(req, "PRIZE_POLICY_WRITE");
    const policy = await engine.upsertPrizePolicy({
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
    await requireAdminPermissionUser(req, "EXTRA_PRIZE_AWARD");
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

app.get("/api/admin/payout-audit", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "PAYOUT_AUDIT_READ");
    const limit = parseLimit(req.query.limit, 100);
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const gameId = typeof req.query.gameId === "string" ? req.query.gameId.trim() : undefined;
    const walletId = typeof req.query.walletId === "string" ? req.query.walletId.trim() : undefined;
    const events = engine.listPayoutAuditTrail({
      limit,
      hallId,
      gameId,
      walletId
    });
    apiSuccess(res, events);
  } catch (error) {
    apiFailure(res, error);
  }
});

// BIN-173: Game replay endpoint — returns full checkpoint timeline for a game
app.get("/api/admin/games/:gameId/replay", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ADMIN_PANEL_ACCESS");
    const gameId = mustBeNonEmptyString(req.params.gameId, "gameId");

    if (!usePostgresBingoAdapter || !(localBingoAdapter instanceof PostgresBingoSystemAdapter)) {
      apiFailure(res, new DomainError("NOT_CONFIGURED", "Game checkpointing er ikke aktivert."));
      return;
    }

    const session = await localBingoAdapter.getGameSession(gameId);
    if (!session) {
      apiFailure(res, new DomainError("GAME_NOT_FOUND", `Spill ${gameId} finnes ikke.`));
      return;
    }

    const timeline = await localBingoAdapter.getGameTimeline(gameId);
    apiSuccess(res, { session, timeline });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/ledger/entries", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "LEDGER_READ");
    const limit = parseLimit(req.query.limit, 200);
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : undefined;
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const gameType = parseOptionalLedgerGameType(req.query.gameType);
    const channel = parseOptionalLedgerChannel(req.query.channel);
    const entries = engine.listComplianceLedgerEntries({
      limit,
      dateFrom,
      dateTo,
      hallId,
      gameType,
      channel
    });
    apiSuccess(res, entries);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/ledger/entries", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "LEDGER_WRITE");
    const eventTypeRaw = mustBeNonEmptyString(req.body?.eventType, "eventType").toUpperCase();
    if (eventTypeRaw !== "STAKE" && eventTypeRaw !== "PRIZE" && eventTypeRaw !== "EXTRA_PRIZE") {
      throw new DomainError("INVALID_INPUT", "eventType må være STAKE, PRIZE eller EXTRA_PRIZE.");
    }
    const entry = await engine.recordAccountingEvent({
      hallId: mustBeNonEmptyString(req.body?.hallId, "hallId"),
      gameType: parseOptionalLedgerGameType(req.body?.gameType) ?? "DATABINGO",
      channel: parseOptionalLedgerChannel(req.body?.channel) ?? "INTERNET",
      eventType: eventTypeRaw,
      amount: mustBePositiveAmount(req.body?.amount),
      metadata:
        req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : undefined
    });
    apiSuccess(res, entry);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/reports/daily/run", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "DAILY_REPORT_RUN");
    const date = typeof req.body?.date === "string" ? req.body.date.trim() : undefined;
    const hallId = typeof req.body?.hallId === "string" ? req.body.hallId.trim() : undefined;
    const gameType = parseOptionalLedgerGameType(req.body?.gameType);
    const channel = parseOptionalLedgerChannel(req.body?.channel);
    const report = await engine.runDailyReportJob({
      date,
      hallId,
      gameType,
      channel
    });
    apiSuccess(res, report);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/reports/daily", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
    const date = mustBeNonEmptyString(req.query.date, "date");
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const gameType = parseOptionalLedgerGameType(req.query.gameType);
    const channel = parseOptionalLedgerChannel(req.query.channel);
    const format = typeof req.query.format === "string" ? req.query.format.trim().toLowerCase() : "json";
    if (format === "csv") {
      const csv = engine.exportDailyReportCsv({
        date,
        hallId,
        gameType,
        channel
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="daily-report-${date}.csv"`);
      res.status(200).send(csv);
      return;
    }
    const report = engine.generateDailyReport({
      date,
      hallId,
      gameType,
      channel
    });
    apiSuccess(res, report);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/reports/daily/archive/:date", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "DAILY_REPORT_READ");
    const date = mustBeNonEmptyString(req.params.date, "date");
    const report = engine.getArchivedDailyReport(date);
    if (!report) {
      throw new DomainError("REPORT_NOT_FOUND", "Fant ikke arkivert dagsrapport for valgt dato.");
    }
    apiSuccess(res, report);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/overskudd/distributions", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "OVERSKUDD_WRITE");
    const date = mustBeNonEmptyString(req.body?.date, "date");
    if (!Array.isArray(req.body?.allocations) || req.body.allocations.length === 0) {
      throw new DomainError("INVALID_INPUT", "allocations må inneholde minst én rad.");
    }
    const allocations = req.body.allocations.map((allocation: unknown) => {
      const typed = allocation as Record<string, unknown>;
      return {
        organizationId: mustBeNonEmptyString(typed?.organizationId, "organizationId"),
        organizationAccountId: mustBeNonEmptyString(typed?.organizationAccountId, "organizationAccountId"),
        sharePercent: Number(typed?.sharePercent)
      };
    });
    const batch = await engine.createOverskuddDistributionBatch({
      date,
      allocations,
      hallId: typeof req.body?.hallId === "string" ? req.body.hallId : undefined,
      gameType: parseOptionalLedgerGameType(req.body?.gameType),
      channel: parseOptionalLedgerChannel(req.body?.channel)
    });
    apiSuccess(res, batch);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/overskudd/distributions/:batchId", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "OVERSKUDD_READ");
    const batchId = mustBeNonEmptyString(req.params.batchId, "batchId");
    const batch = engine.getOverskuddDistributionBatch(batchId);
    apiSuccess(res, batch);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/overskudd/distributions", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "OVERSKUDD_READ");
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const gameType = parseOptionalLedgerGameType(req.query.gameType);
    const channel = parseOptionalLedgerChannel(req.query.channel);
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : undefined;
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const batches = engine.listOverskuddDistributionBatches({
      hallId,
      gameType,
      channel,
      dateFrom,
      dateTo,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined
    });
    apiSuccess(res, batches);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/overskudd/preview", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "OVERSKUDD_READ");
    const date = mustBeNonEmptyString(req.query.date, "date");
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const gameType = parseOptionalLedgerGameType(req.query.gameType);
    const channel = parseOptionalLedgerChannel(req.query.channel);

    const resolveAllocations = async (): Promise<{ organizationId: string; organizationAccountId: string; sharePercent: number }[]> => {
      if (Array.isArray(req.body?.allocations) && req.body.allocations.length > 0) {
        return req.body.allocations.map((allocation: unknown) => {
          const typed = allocation as Record<string, unknown>;
          return {
            organizationId: mustBeNonEmptyString(typed?.organizationId, "organizationId"),
            organizationAccountId: mustBeNonEmptyString(typed?.organizationAccountId, "organizationAccountId"),
            sharePercent: Number(typed?.sharePercent)
          };
        });
      }
      if (responsibleGamingStore) {
        const stored = await responsibleGamingStore.listHallOrganizationAllocations(hallId);
        const active = stored.filter((alloc) => alloc.isActive);
        if (active.length === 0) {
          throw new DomainError("NO_ALLOCATIONS", "Ingen aktive org-allokeringer funnet. Send allocations i body eller konfigurer dem via POST /api/admin/overskudd/organizations.");
        }
        return active.map((alloc) => ({
          organizationId: alloc.organizationId,
          organizationAccountId: alloc.organizationAccountId,
          sharePercent: alloc.sharePercent
        }));
      }
      throw new DomainError("NO_ALLOCATIONS", "allocations mangler i body og ingen persistence er konfigurert.");
    };

    const allocations = await resolveAllocations();

    const batch = engine.previewOverskuddDistribution({
      date,
      allocations,
      hallId,
      gameType,
      channel
    });
    apiSuccess(res, batch);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/overskudd/organizations", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "OVERSKUDD_READ");
    if (!responsibleGamingStore) {
      apiSuccess(res, []);
      return;
    }
    const hallId = typeof req.query.hallId === "string" ? req.query.hallId.trim() : undefined;
    const allocs = await responsibleGamingStore.listHallOrganizationAllocations(hallId);
    apiSuccess(res, allocs);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/overskudd/organizations", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "OVERSKUDD_WRITE");
    if (!responsibleGamingStore) {
      throw new DomainError("NOT_CONFIGURED", "Persistence er ikke konfigurert.");
    }
    const hallId = mustBeNonEmptyString(req.body?.hallId, "hallId");
    const organizationId = mustBeNonEmptyString(req.body?.organizationId, "organizationId");
    const organizationName = mustBeNonEmptyString(req.body?.organizationName, "organizationName");
    const organizationAccountId = mustBeNonEmptyString(req.body?.organizationAccountId, "organizationAccountId");
    const sharePercent = Number(req.body?.sharePercent);
    if (!Number.isFinite(sharePercent) || sharePercent <= 0) {
      throw new DomainError("INVALID_INPUT", "sharePercent må være større enn 0.");
    }
    const gameTypeRaw = typeof req.body?.gameType === "string" ? req.body.gameType.trim().toUpperCase() : null;
    const channelRaw = typeof req.body?.channel === "string" ? req.body.channel.trim().toUpperCase() : null;
    if (gameTypeRaw !== null && gameTypeRaw !== "MAIN_GAME" && gameTypeRaw !== "DATABINGO") {
      throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME, DATABINGO eller null.");
    }
    if (channelRaw !== null && channelRaw !== "HALL" && channelRaw !== "INTERNET") {
      throw new DomainError("INVALID_INPUT", "channel må være HALL, INTERNET eller null.");
    }
    const now = new Date().toISOString();
    const alloc = {
      id: randomUUID(),
      hallId,
      organizationId,
      organizationName,
      organizationAccountId,
      sharePercent,
      gameType: (gameTypeRaw as "MAIN_GAME" | "DATABINGO" | null),
      channel: (channelRaw as "HALL" | "INTERNET" | null),
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    await responsibleGamingStore.upsertHallOrganizationAllocation(alloc);
    apiSuccess(res, alloc);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/admin/overskudd/organizations/:id", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "OVERSKUDD_WRITE");
    if (!responsibleGamingStore) {
      throw new DomainError("NOT_CONFIGURED", "Persistence er ikke konfigurert.");
    }
    const id = mustBeNonEmptyString(req.params.id, "id");
    await responsibleGamingStore.deleteHallOrganizationAllocation(id);
    apiSuccess(res, { deleted: true });
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

// BIN-172: Prometheus metrics endpoint
app.get("/metrics", async (_req, res) => {
  try {
    // Update gauges with current state before scrape
    const roomSummaries = engine.listRoomSummaries();
    promMetrics.activeRooms.set(roomSummaries.length);
    promMetrics.activePlayers.set(roomSummaries.reduce((sum, r) => sum + r.playerCount, 0));
    if (drawScheduler) {
      const health = drawScheduler.healthSummary();
      const watchdog = health.drawWatchdog as { stuckRooms?: number } | undefined;
      promMetrics.stuckRooms.set(watchdog?.stuckRooms ?? 0);
    }
    promMetrics.socketConnections.set(io.engine.clientsCount ?? 0);

    res.set("Content-Type", promRegister.contentType);
    res.end(await promRegister.metrics());
  } catch (err) {
    res.status(500).end(String(err));
  }
});

app.get("/health", async (_req, res) => {
  try {
    const wallets = await walletAdapter.listAccounts();
    const games = await platformService.listGames({ includeDisabled: true });
    const halls = await platformService.listHalls({ includeInactive: true });
    const schedulerHealth = drawScheduler.healthSummary();
    apiSuccess(res, {
      rooms: engine.getAllRoomCodes().length,
      wallets: wallets.length,
      games: games.length,
      halls: halls.length,
      walletProvider: walletRuntime.provider,
      swedbankConfigured: swedbankPayService.isConfigured(),
      ...schedulerHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/health/draw-engine", (_req, res) => {
  // Basic auth guard: require admin token or localhost.
  const isLocalhost = _req.ip === "127.0.0.1" || _req.ip === "::1" || _req.ip === "::ffff:127.0.0.1";
  const hasToken = _req.headers.authorization === `Bearer ${process.env.ADMIN_API_TOKEN ?? ""}`;
  if (!isLocalhost && !hasToken && process.env.NODE_ENV === "production") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }
  // No DB queries — purely in-memory data for fast response (<50ms).
  const detailed = drawScheduler.healthSummary(true);
  apiSuccess(res, detailed);
});

app.get("/api/rooms", (req, res) => {
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

// ── Leaderboard ──────────────────────────────────────────────────────────────

app.get("/api/leaderboard", async (req, res) => {
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

app.get("/api/notifications", async (req, res) => {
  try {
    await getAuthenticatedUser(req);
    apiSuccess(res, []);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/notifications/read", async (req, res) => {
  try {
    await getAuthenticatedUser(req);
    apiSuccess(res, { ok: true });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/rooms/:roomCode", (req, res) => {
  try {
    const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(req.params.roomCode));
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

// BIN-164: Socket.IO rate limiter — prevents event flooding per socket
const socketRateLimiter = new SocketRateLimiter();
socketRateLimiter.start();

// BIN-237/KRITISK-7: Connection-time authentication middleware.
// Clients that provide a token in the handshake are validated immediately;
// an invalid token causes the connection to be rejected before it is established.
// Unity (BestHTTP/EIO3) clients that don't send a handshake token are allowed to
// connect but must authenticate per-event payload (existing behaviour).
io.use(async (socket, next) => {
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
      if (user.walletId) {
        socketRateLimiter.registerPlayer(socket.id, user.walletId);
      }
    } catch (err) {
      const message = err instanceof DomainError ? err.message : "Autentisering feilet";
      return next(new Error(`UNAUTHORIZED: ${message}`));
    }
  } else {
    // No handshake token — Unity clients authenticate per-payload.
    socket.data.authenticated = false;
  }
  next();
});

io.on("connection", (socket: Socket) => {
  /** BIN-164/BIN-247: Wrap a socket handler with rate limiting.
   * Checks both by socket.id (unauthenticated events) and by walletId when available
   * so reconnects don't reset rate limit counters for authenticated players. */
  function rateLimited<P, R>(
    eventName: string,
    handler: (payload: P, callback: (response: AckResponse<R>) => void) => Promise<void>
  ): (payload: P, callback: (response: AckResponse<R>) => void) => void {
    return (payload, callback) => {
      // Always check by socket.id
      if (!socketRateLimiter.check(socket.id, eventName)) {
        ackFailure(callback, new DomainError("RATE_LIMITED", "For mange foresporsler. Vent litt."));
        return;
      }
      // BIN-247: Also check by walletId when authenticated — reconnects get a new socket.id
      // but must not bypass rate limits by simply reconnecting
      const walletId = socket.data.user?.walletId;
      if (walletId && !socketRateLimiter.checkByKey(walletId, eventName)) {
        ackFailure(callback, new DomainError("RATE_LIMITED", "For mange foresporsler. Vent litt."));
        return;
      }
      handler(payload, callback).catch((err) => {
        console.error(`[socket] unhandled error in ${eventName}:`, err);
      });
    };
  }

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

  socket.on("room:create", rateLimited("room:create", async (payload: CreateRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
    console.log("[BIN-134] room:create received", { hallId: payload?.hallId, hasAccessToken: !!payload?.accessToken });
    try {
      const identity = await resolveIdentityFromPayload(payload);
      console.log("[BIN-134] room:create identity resolved", { playerName: identity.playerName, walletId: identity.walletId, hallId: identity.hallId });
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
          console.log("[BIN-134] room:create → existing canonical", { roomCode: canonicalRoom.code, playerId });
          ackSuccess(callback, { roomCode: canonicalRoom.code, playerId, snapshot });
          return;
        }
      }

      const { roomCode, playerId } = await engine.createRoom({
        playerName: identity.playerName,
        hallId: identity.hallId,
        walletId: identity.walletId,
        socketId: socket.id,
        // BIN-134: Use "BINGO1" as actual room code so SPA alias = real code
        roomCode: enforceSingleRoomPerHall ? "BINGO1" : undefined,
        gameSlug: typeof payload?.gameSlug === "string" ? payload.gameSlug : undefined
      });
      socket.join(roomCode);
      const snapshot = await emitRoomUpdate(roomCode);
      console.log("[BIN-134] room:create SUCCESS", { roomCode, playerId });
      ackSuccess(callback, { roomCode, playerId, snapshot });
    } catch (error) {
      console.error("[BIN-134] room:create FAILED", { error: (error as Error).message, code: (error as any).code });
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

      const entryFee = setRoomConfiguredEntryFee(roomCode, requestedEntryFee);
      const updatedSnapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot: updatedSnapshot, entryFee });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("bet:arm", rateLimited("bet:arm", async (
    payload: RoomActionPayload & { armed?: boolean },
    callback: (response: AckResponse<{ snapshot: RoomSnapshot; armed: boolean }>) => void
  ) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const wantArmed = payload.armed !== false;
      if (wantArmed) {
        armPlayer(roomCode, playerId);
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
      await engine.startGame({
        roomCode,
        actorPlayerId: playerId,
        entryFee: payload?.entryFee ?? getRoomConfiguredEntryFee(roomCode),
        ticketsPerPlayer,
        payoutPercent: runtimeBingoSettings.payoutPercent,
        armedPlayerIds: getArmedPlayerIds(roomCode),
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
      const { number, drawIndex, gameId } = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
      io.to(roomCode).emit("draw:new", { number, drawIndex, gameId });
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

  socket.on("ticket:mark", rateLimited("ticket:mark", async (payload: MarkPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
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
  }));

  socket.on("claim:submit", rateLimited("claim:submit", async (payload: ClaimPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      if (payload?.type !== "LINE" && payload?.type !== "BINGO") {
        throw new DomainError("INVALID_INPUT", "type må være LINE eller BINGO.");
      }
      const claim = await engine.submitClaim({
        roomCode,
        playerId,
        type: payload.type
      });
      const snapshot = await emitRoomUpdate(roomCode);
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
      }
      ackSuccess(callback, { snapshot });
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
        const hallId = (payload as any)?.hallId || "default-hall";
        const canonicalRoom = getPrimaryRoomForHall(hallId);
        if (canonicalRoom) {
          roomCode = canonicalRoom.code;
          console.log("[BIN-134] room:state BINGO1 → canonical room", roomCode);
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
      const chatMsg: ChatMessage = {
        id: randomUUID(),
        playerId,
        playerName: player?.name ?? "Ukjent",
        message: message.slice(0, 500),
        emojiId: payload?.emojiId ?? 0,
        createdAt: new Date().toISOString()
      };
      appendChatMessage(roomCode, chatMsg);
      io.to(roomCode).emit("chat:message", chatMsg);
      ackSuccess(callback, { message: chatMsg });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("chat:history", rateLimited("chat:history", async (payload: RoomActionPayload, callback: (response: AckResponse<{ messages: ChatMessage[] }>) => void) => {
    try {
      const { roomCode } = await requireAuthenticatedPlayerAction(payload);
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

  socket.on("disconnect", () => {
    engine.detachSocket(socket.id);
    socketRateLimiter.cleanup(socket.id);
  });
});

app.get("*", (_req, res) => {
  if (_req.path === "/admin" || _req.path === "/admin/") {
    res.sendFile(adminFrontendFile);
    return;
  }
  // All non-API, non-admin routes serve the web shell (Unity host)
  res.sendFile(path.join(publicDir, "web/index.html"));
});

const PORT = Number(process.env.PORT ?? 4000);
hydrateBingoSettingsFromCatalog()
  .catch((error) => {
    console.warn("[bingo] Oppstart med env/default settings pga last-feil.", error);
  })
  .finally(async () => {
    try {
      await engine.hydratePersistentState();
      console.log("[responsible-gaming] persisted state hydrated");
    } catch (error) {
      console.error("[responsible-gaming] failed to hydrate persisted state", error);
      process.exit(1);
      return;
    }

    startDailyReportScheduler();

    // BIN-170: Load rooms from Redis on startup (if Redis provider)
    if (roomStateProvider === "redis") {
      try {
        const loaded = await roomStateStore.loadAll();
        if (loaded > 0) {
          console.log(`[BIN-170] Loaded ${loaded} room(s) from Redis`);
        }
      } catch (err) {
        console.error("[BIN-170] Failed to load rooms from Redis:", err);
      }
    }

    // BIN-245: Crash recovery — restore game state from latest checkpoint snapshot.
    // Replaces BIN-159 which always marked games ENDED; now we restore RUNNING games
    // from their last checkpoint so draws can resume and players can reconnect.
    if (usePostgresBingoAdapter && localBingoAdapter instanceof PostgresBingoSystemAdapter) {
      try {
        const incompleteGames = await localBingoAdapter.findIncompleteGames();
        let restored = 0;
        let ended = 0;
        for (const game of incompleteGames) {
          try {
            const checkpointData = await localBingoAdapter.getLatestCheckpointData(game.gameId);
            const snapshot = checkpointData?.snapshot as GameSnapshot | null;
            const players = (Array.isArray(checkpointData?.players) ? checkpointData.players : []) as Player[];

            // BIN-245: Restore if snapshot has a valid drawBag (BIN-243 required)
            if (snapshot && Array.isArray(snapshot.drawBag)) {
              const hostPlayerId = players[0]?.id ?? "recovered";
              engine.restoreRoomFromSnapshot(
                game.roomCode,
                game.hallId ?? "",
                hostPlayerId,
                players,
                snapshot
              );
              restored++;
            } else {
              // No valid snapshot — fall back to marking ended
              console.warn(`[BIN-245] No snapshot for game ${game.gameId} in room ${game.roomCode} — marking ENDED`);
              await localBingoAdapter.markGameEnded(game.gameId, "CRASH_RECOVERY");
              ended++;
            }
          } catch (err) {
            console.error(`[BIN-245] Failed to restore game ${game.gameId} in room ${game.roomCode}:`, err);
            try {
              await localBingoAdapter.markGameEnded(game.gameId, "CRASH_RECOVERY");
            } catch {
              // best effort
            }
            ended++;
          }
        }
        if (restored + ended > 0) {
          console.warn(`[BIN-245] Recovery complete: ${restored} game(s) restored, ${ended} game(s) ended`);
        }
      } catch (err) {
        console.error("[BIN-245] Crash recovery failed:", err);
      }
    }

    server.listen(PORT, () => {
      console.log(`Bingo backend kjører på http://localhost:${PORT}`);
      console.log(
        `[compliance] minRoundInterval=${bingoMinRoundIntervalMs}ms minPlayersToStart=${bingoMinPlayersToStart} maxDrawsPerRound=${bingoMaxDrawsPerRound} dailyLoss=${bingoDailyLossLimit} monthlyLoss=${bingoMonthlyLossLimit} playSessionLimit=${bingoPlaySessionLimitMs}ms pauseDuration=${bingoPauseDurationMs}ms selfExclusionMin=${bingoSelfExclusionMinMs}ms`
      );
      console.log(
        `[scheduler] autoStart=${runtimeBingoSettings.autoRoundStartEnabled} autoDraw=${runtimeBingoSettings.autoDrawEnabled} forceAutoStart=${forceAutoStart} forceAutoDraw=${forceAutoDraw} autoAllowedInProd=${allowAutoplayInProduction} singleRoomPerHall=${enforceSingleRoomPerHall} interval=${runtimeBingoSettings.autoRoundStartIntervalMs}ms minPlayers=${runtimeBingoSettings.autoRoundMinPlayers} ticketsPerPlayer=${runtimeBingoSettings.autoRoundTicketsPerPlayer} entryFee=${runtimeBingoSettings.autoRoundEntryFee} payoutPercent=${runtimeBingoSettings.payoutPercent}`
      );
      console.log(
        `[scheduler] autoDraw=${runtimeBingoSettings.autoDrawEnabled} interval=${runtimeBingoSettings.autoDrawIntervalMs}ms tick=${schedulerTickMs}ms`
      );
      console.log(
        `[daily-report] enabled=${dailyReportJobEnabled} interval=${dailyReportJobIntervalMs}ms lastDate=${lastDailyReportDateKey || "-"}`
      );
      console.log(`[swedbank] configured=${swedbankPayService.isConfigured()}`);
    });
  });

// ── Graceful shutdown ──────────────────────────────────────────
let shutdownStarted = false;
function handleShutdown(signal: string) {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  console.info(`[shutdown] Received ${signal}. Starting graceful shutdown...`);

  httpRateLimiter.stop();
  socketRateLimiter.stop();

  drawScheduler.gracefulStop()
    .then(async () => {
      // BIN-170/171: Shutdown Redis stores
      await roomStateStore.shutdown();
      if (redisSchedulerLock) await redisSchedulerLock.shutdown();
      if (responsibleGamingStore) await responsibleGamingStore.shutdown();

      server.close(() => {
        console.info("[shutdown] HTTP server closed. Exiting.");
        process.exit(0);
      });
      // Force exit if server doesn't close within 10s.
      setTimeout(() => {
        console.warn("[shutdown] Forced exit after timeout.");
        process.exit(1);
      }, 10_000).unref();
    })
    .catch((error) => {
      console.error("[shutdown] Error during graceful shutdown:", error);
      process.exit(1);
    });
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
  handleShutdown("unhandledRejection");
});

process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
  handleShutdown("uncaughtException");
});
