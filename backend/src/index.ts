import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { createWalletAdapter } from "./adapters/createWalletAdapter.js";
import { LocalBingoSystemAdapter } from "./adapters/LocalBingoSystemAdapter.js";
import { LocalKycAdapter } from "./adapters/LocalKycAdapter.js";
import { assertTicketsPerPlayerWithinHallLimit } from "./game/compliance.js";
import { BingoEngine, DomainError, toPublicError } from "./game/BingoEngine.js";
import type { ClaimType, RoomSnapshot, RoomSummary, Ticket } from "./game/types.js";
import { GameCheckpointStore } from "./game/GameCheckpointStore.js";
import { CandyLaunchTokenStore } from "./launch/CandyLaunchTokenStore.js";
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
  type PublicAppUser,
  type UserRole
} from "./platform/PlatformService.js";
import { SwedbankPayService } from "./payments/SwedbankPayService.js";
import {
  buildCandySettingsDefinition,
  buildDefaultGameSettingsDefinition,
  type AdminSettingsCatalog,
  type GameSettingsDefinition
} from "./admin/settingsCatalog.js";

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

interface BetArmPayload extends RoomActionPayload {
  armed?: boolean;
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

interface TicketRerollPayload extends RoomActionPayload {
  ticketsPerPlayer?: number;
  ticketIndex?: number;
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

interface CandyOpeningHoursDaySchedule {
  open: string;
  close: string;
  enabled: boolean;
}

interface CandyOpeningHoursSchedule {
  monday: CandyOpeningHoursDaySchedule;
  tuesday: CandyOpeningHoursDaySchedule;
  wednesday: CandyOpeningHoursDaySchedule;
  thursday: CandyOpeningHoursDaySchedule;
  friday: CandyOpeningHoursDaySchedule;
  saturday: CandyOpeningHoursDaySchedule;
  sunday: CandyOpeningHoursDaySchedule;
}

interface CandyManiaSchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoRoundTicketsPerPlayer: number;
  autoRoundEntryFee: number;
  payoutPercent: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
  openingHoursEnabled: boolean;
  openingHoursSchedule: CandyOpeningHoursSchedule;
}

interface PendingCandyManiaSettingsUpdate {
  effectiveFromMs: number;
  settings: CandyManiaSchedulerSettings;
}

interface PersistCandySettingsOptions {
  changedBy?: {
    userId: string;
    displayName: string;
    role: UserRole;
  };
  source?: string;
  effectiveFromMs?: number;
}

interface CandyLaunchSettings {
  launchUrl?: string;
  apiBaseUrl?: string;
}

interface NormalizeGameSettingsOptions {
  requireCandyLaunchUrl?: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const projectDir = path.resolve(__dirname, "../..");
const legacyFrontendDir = path.resolve(projectDir, "frontend");
const candyWebFrontendDir = path.resolve(projectDir, "candy-web/dist");
const hasCandyWebFrontend = fs.existsSync(path.join(candyWebFrontendDir, "index.html"));
const frontendDir = legacyFrontendDir;
const frontendIndexFile = path.resolve(frontendDir, "index.html");
const candyFrontendIndexFile = path.resolve(candyWebFrontendDir, "index.html");
const adminFrontendFile = path.resolve(legacyFrontendDir, "admin/index.html");
const adminFrontendDir = path.resolve(legacyFrontendDir, "admin");

const app = express();
const allowedCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors(
  allowedCorsOrigins.length > 0
    ? { origin: allowedCorsOrigins, credentials: true }
    : undefined
));
app.use(express.json());
app.use(
  "/admin",
  express.static(adminFrontendDir, {
    setHeaders: (res, filePath) => {
      // Avoid stale admin UI JS/HTML after deploys.
      if (filePath.endsWith(".html") || filePath.endsWith(".js")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");
      }
    }
  })
);
app.use(express.static(frontendDir));
if (hasCandyWebFrontend) {
  app.use(
    "/candy",
    express.static(candyWebFrontendDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html") || filePath.endsWith(".js")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.setHeader("Surrogate-Control", "no-store");
        }
      }
    })
  );
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: allowedCorsOrigins.length > 0
    ? { origin: allowedCorsOrigins, credentials: true }
    : { origin: "*" },
  maxHttpBufferSize: 64 * 1024, // 64KB max payload per message
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

const gameCheckpointStore = new GameCheckpointStore(
  platformConnectionString,
  platformConnectionString.includes("render.com") || platformConnectionString.includes("ssl=true"),
);

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

function parseRatioEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 1) {
    return Math.max(0, Math.min(1, parsed));
  }
  return Math.max(0, Math.min(1, parsed / 100));
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
const bingoRtpRollingWindowSize = Math.max(10, parsePositiveIntEnv(process.env.BINGO_RTP_ROLLING_WINDOW_SIZE, 1000));
const bingoRtpControllerGain = Math.min(
  2,
  Math.max(0, parseNonNegativeNumberEnv(process.env.BINGO_RTP_CONTROLLER_GAIN, 0.5))
);
const bingoNearMissBiasEnabled = parseBooleanEnv(process.env.BINGO_NEAR_MISS_BIAS_ENABLED, false);
const bingoNearMissTargetRate = parseRatioEnv(process.env.BINGO_NEAR_MISS_TARGET_RATE, 0.15);
const bingoNearMissCalibrationFactor = parseRatioEnv(process.env.BINGO_NEAR_MISS_CALIBRATION_FACTOR, 0.92);
const candyProductionApiBaseHost = "bingosystem-3.onrender.com";
const allowProductionCandyApiBaseUrl = parseBooleanEnv(process.env.CANDY_ALLOW_PRODUCTION_API_BASE_URL, false);

const isProductionRuntime = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
const minPlayersFloor = 1;
const bingoMinPlayersToStart = minPlayersFloor;
const requestedAutoRoundStartEnabled = parseBooleanEnv(process.env.AUTO_ROUND_START_ENABLED, true);
const requestedAutoDrawEnabled = parseBooleanEnv(process.env.AUTO_DRAW_ENABLED, true);
const allowAutoplayInProduction = parseBooleanEnv(process.env.BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION, true);
const forceCandyAutoStart = true;
const forceCandyAutoDraw = true;
const enforceSingleCandyGlobalRoom = parseBooleanEnv(
  process.env.CANDY_SINGLE_ACTIVE_ROOM_GLOBAL ??
    process.env.CANDY_SINGLE_ACTIVE_ROOM ??
    process.env.CANDY_ENFORCE_SINGLE_ROOM,
  true
);
const autoplayAllowed = !isProductionRuntime || allowAutoplayInProduction;
const runtimeCandyManiaSettings: CandyManiaSchedulerSettings = {
  autoRoundStartEnabled: forceCandyAutoStart
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
    Math.min(100, Math.max(0, parseNonNegativeNumberEnv(process.env.CANDY_PAYOUT_PERCENT, 75))) * 100
  ) / 100,
  autoDrawEnabled: forceCandyAutoDraw ? true : autoplayAllowed ? requestedAutoDrawEnabled : false,
  autoDrawIntervalMs: parsePositiveIntEnv(process.env.AUTO_DRAW_INTERVAL_MS, 2000),
  openingHoursEnabled: false,
  openingHoursSchedule: {
    monday:    { open: "08:00", close: "22:00", enabled: true },
    tuesday:   { open: "08:00", close: "22:00", enabled: true },
    wednesday: { open: "08:00", close: "22:00", enabled: true },
    thursday:  { open: "08:00", close: "22:00", enabled: true },
    friday:    { open: "08:00", close: "22:00", enabled: true },
    saturday:  { open: "10:00", close: "20:00", enabled: true },
    sunday:    { open: "00:00", close: "00:00", enabled: false },
  },
};
let candyManiaSettingsEffectiveFromMs = Date.now();
let pendingCandyManiaSettingsUpdate: PendingCandyManiaSettingsUpdate | null = null;
const schedulerTickMs = parsePositiveIntEnv(process.env.AUTO_ROUND_SCHEDULER_TICK_MS, 250);
const candyEndedRoundCleanupDelayMs = 5000;
const dailyReportJobEnabled = parseBooleanEnv(process.env.DAILY_REPORT_JOB_ENABLED, true);
const dailyReportJobIntervalMs = Math.max(
  60_000,
  parsePositiveIntEnv(process.env.DAILY_REPORT_JOB_INTERVAL_MS, 60 * 60 * 1000)
);
const candyLaunchTokenTtlMs = Math.max(
  15_000,
  parsePositiveIntEnv(process.env.CANDY_LAUNCH_TOKEN_TTL_SECONDS, 120) * 1000
);

if (isProductionRuntime && !autoplayAllowed && (requestedAutoRoundStartEnabled || requestedAutoDrawEnabled)) {
  console.warn(
    "[scheduler] Autoplay er deaktivert i production (sett BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true for aa tillate AUTO_ROUND_START_ENABLED/AUTO_DRAW_ENABLED)."
  );
}

const engine = new BingoEngine(new LocalBingoSystemAdapter(), walletAdapter, {
  minRoundIntervalMs: bingoMinRoundIntervalMs,
  minPlayersToStart: bingoMinPlayersToStart,
  dailyLossLimit: bingoDailyLossLimit,
  monthlyLossLimit: bingoMonthlyLossLimit,
  playSessionLimitMs: bingoPlaySessionLimitMs,
  pauseDurationMs: bingoPauseDurationMs,
  selfExclusionMinMs: bingoSelfExclusionMinMs,
  maxBallNumber: 60,
  maxDrawsPerRound: bingoMaxDrawsPerRound,
  rtpRollingWindowSize: bingoRtpRollingWindowSize,
  rtpControllerGain: bingoRtpControllerGain,
  nearMissBiasEnabled: bingoNearMissBiasEnabled,
  nearMissTargetRate: bingoNearMissTargetRate,
  nearMissCalibrationFactor: bingoNearMissCalibrationFactor
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
const candyLaunchTokenStore = new CandyLaunchTokenStore({
  ttlMs: candyLaunchTokenTtlMs
});
const canonicalCandyRoomCode =
  process.env.CANDY_CANONICAL_ROOM_CODE?.trim().toUpperCase() || "CANDY1";

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

function enforceCandyApiBasePolicy(value: string | undefined, fieldName: string): void {
  if (!value) {
    return;
  }
  if (allowProductionCandyApiBaseUrl) {
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.host.toLowerCase() === candyProductionApiBaseHost) {
      throw new DomainError(
        "CANDY_PRODUCTION_API_BASE_BLOCKED",
        `${fieldName} kan ikke peke direkte til production (${candyProductionApiBaseHost}) uten CANDY_ALLOW_PRODUCTION_API_BASE_URL=true.`
      );
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw new DomainError("INVALID_CANDY_API_BASE_URL", `${fieldName} er ikke en gyldig URL.`);
  }
}

function deriveRequestOrigin(req: express.Request): string {
  const forwardedProto = readForwardedHeaderValue(req.headers["x-forwarded-proto"]);
  const forwardedHost = readForwardedHeaderValue(req.headers["x-forwarded-host"]);
  const proto = (forwardedProto || req.protocol || "https").trim() || "https";
  const host = (forwardedHost || req.get("host") || "").trim();
  if (!host) {
    throw new DomainError("INVALID_RUNTIME_ORIGIN", "Klarte ikke bestemme runtime origin for Candy.");
  }
  return `${proto}://${host}`;
}

function sanitizeCandyLaunchUrlForRuntime(launchUrl: string, req: express.Request): string {
  try {
    const runtimeOrigin = new URL(deriveRequestOrigin(req));
    const parsed = new URL(launchUrl);
    parsed.protocol = runtimeOrigin.protocol;
    parsed.host = runtimeOrigin.host;
    parsed.searchParams.delete("v");
    parsed.pathname = "/candy/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    try {
      const runtimeOrigin = new URL(deriveRequestOrigin(req));
      runtimeOrigin.pathname = "/candy/";
      runtimeOrigin.search = "";
      runtimeOrigin.hash = "";
      return runtimeOrigin.toString();
    } catch {
      return launchUrl;
    }
  }
}

function readCandyLaunchSettings(
  settings: Record<string, unknown>,
  options: { requireLaunchUrl: boolean }
): CandyLaunchSettings {
  const launchUrl = parseOptionalAbsoluteHttpUrl(
    settings.launchUrl,
    "launchUrl",
    "INVALID_CANDY_LAUNCH_URL"
  );
  const apiBaseUrl = parseOptionalAbsoluteHttpUrl(
    settings.apiBaseUrl,
    "apiBaseUrl",
    "INVALID_CANDY_API_BASE_URL"
  );
  enforceCandyApiBasePolicy(apiBaseUrl, "apiBaseUrl");

  if (options.requireLaunchUrl && !launchUrl) {
    throw new DomainError(
      "INVALID_CANDY_LAUNCH_URL",
      "Candy launchUrl må settes og være en gyldig http/https URL."
    );
  }

  return {
    launchUrl,
    apiBaseUrl
  };
}

function normalizeGameSettingsForUpdate(
  gameSlug: string,
  settings: Record<string, unknown> | undefined,
  options: NormalizeGameSettingsOptions = {}
): Record<string, unknown> | undefined {
  if (!settings) {
    return undefined;
  }

  const normalizedSlug = gameSlug.trim().toLowerCase();
  if (normalizedSlug !== "candy") {
    return settings;
  }

  const nextSettings: Record<string, unknown> = { ...settings };
  const launchSettings = readCandyLaunchSettings(nextSettings, {
    requireLaunchUrl: options.requireCandyLaunchUrl === true
  });
  if (launchSettings.launchUrl) {
    nextSettings.launchUrl = launchSettings.launchUrl;
  } else {
    delete nextSettings.launchUrl;
  }
  if (launchSettings.apiBaseUrl) {
    nextSettings.apiBaseUrl = launchSettings.apiBaseUrl;
  } else {
    delete nextSettings.apiBaseUrl;
  }

  const payoutRaw = nextSettings.payoutPercent;

  if (payoutRaw === undefined || payoutRaw === null || payoutRaw === "") {
    return nextSettings;
  }

  const payoutPercent = Number(payoutRaw);
  if (!Number.isFinite(payoutPercent) || payoutPercent < 0 || payoutPercent > 100) {
    throw new DomainError("INVALID_PAYOUT_PERCENT", "Candy utbetaling (%) må være mellom 0 og 100.");
  }

  nextSettings.payoutPercent = Math.round(payoutPercent * 100) / 100;
  return nextSettings;
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

function parseCandyManiaSettingsPatch(value: unknown): Partial<CandyManiaSchedulerSettings> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
  }

  const payload = value as Record<string, unknown>;
  const patch: Partial<CandyManiaSchedulerSettings> = {};

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
  if (autoDrawIntervalMs !== undefined) {
    patch.autoDrawIntervalMs = autoDrawIntervalMs;
  }

  const openingHoursEnabled = parseOptionalBooleanInput(payload.openingHoursEnabled, "openingHoursEnabled");
  if (openingHoursEnabled !== undefined) {
    patch.openingHoursEnabled = openingHoursEnabled;
  }

  if (payload.openingHoursSchedule !== undefined && payload.openingHoursSchedule !== null) {
    if (typeof payload.openingHoursSchedule !== "object" || Array.isArray(payload.openingHoursSchedule)) {
      throw new DomainError("INVALID_INPUT", "openingHoursSchedule må være et objekt.");
    }
    patch.openingHoursSchedule = payload.openingHoursSchedule as CandyOpeningHoursSchedule;
  }

  return patch;
}

function normalizeCandyManiaSchedulerSettings(
  current: CandyManiaSchedulerSettings,
  patch: Partial<CandyManiaSchedulerSettings>
): CandyManiaSchedulerSettings {
  const next: CandyManiaSchedulerSettings = {
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
      patch.autoDrawIntervalMs !== undefined ? patch.autoDrawIntervalMs : current.autoDrawIntervalMs,
    openingHoursEnabled:
      patch.openingHoursEnabled !== undefined ? patch.openingHoursEnabled : current.openingHoursEnabled,
    openingHoursSchedule:
      patch.openingHoursSchedule !== undefined ? patch.openingHoursSchedule : current.openingHoursSchedule,
  };

  next.autoRoundStartIntervalMs = Math.max(
    bingoMinRoundIntervalMs,
    Math.floor(next.autoRoundStartIntervalMs)
  );
  if (forceCandyAutoStart) {
    next.autoRoundStartEnabled = true;
  }
  if (forceCandyAutoDraw) {
    next.autoDrawEnabled = true;
  }
  next.autoRoundMinPlayers = Math.max(bingoMinPlayersToStart, Math.floor(next.autoRoundMinPlayers));
  next.autoRoundTicketsPerPlayer = Math.min(5, Math.max(1, Math.floor(next.autoRoundTicketsPerPlayer)));
  next.autoRoundEntryFee = Math.max(0, Math.round(next.autoRoundEntryFee * 100) / 100);
  next.payoutPercent = Math.min(100, Math.max(0, Math.round(next.payoutPercent * 100) / 100));
  next.autoDrawIntervalMs = Math.max(250, Math.floor(next.autoDrawIntervalMs));

  if (
    !autoplayAllowed &&
    ((next.autoRoundStartEnabled && !forceCandyAutoStart) || (next.autoDrawEnabled && !forceCandyAutoDraw))
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Autoplay er deaktivert i production. Sett BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true for aa aktivere autoStart/autoDraw."
    );
  }

  return next;
}

function candyManiaSettingsCoreToRecord(settings: CandyManiaSchedulerSettings): Record<string, unknown> {
  return {
    autoRoundStartEnabled: settings.autoRoundStartEnabled,
    autoRoundStartIntervalMs: settings.autoRoundStartIntervalMs,
    autoRoundMinPlayers: settings.autoRoundMinPlayers,
    autoRoundTicketsPerPlayer: settings.autoRoundTicketsPerPlayer,
    autoRoundEntryFee: settings.autoRoundEntryFee,
    payoutPercent: settings.payoutPercent,
    autoDrawEnabled: settings.autoDrawEnabled,
    autoDrawIntervalMs: settings.autoDrawIntervalMs,
    openingHoursEnabled: settings.openingHoursEnabled,
    openingHoursSchedule: settings.openingHoursSchedule,
  };
}

function candyManiaSettingsToRecord(): Record<string, unknown> {
  return {
    ...candyManiaSettingsCoreToRecord(runtimeCandyManiaSettings),
    schedulerCurrentEffectiveFrom: new Date(candyManiaSettingsEffectiveFromMs).toISOString(),
    schedulerPending: pendingCandyManiaSettingsUpdate
      ? {
          effectiveFrom: new Date(pendingCandyManiaSettingsUpdate.effectiveFromMs).toISOString(),
          settings: candyManiaSettingsCoreToRecord(pendingCandyManiaSettingsUpdate.settings)
        }
      : null
  };
}

function readCandyManiaSettingsFromRecord(settings: Record<string, unknown> | undefined): Partial<CandyManiaSchedulerSettings> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  return parseCandyManiaSettingsPatch(settings);
}

function readPendingCandyManiaSettingsFromRecord(
  settings: Record<string, unknown> | undefined
): PendingCandyManiaSettingsUpdate | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null;
  }
  const pendingRaw = settings.schedulerPending;
  if (pendingRaw === undefined || pendingRaw === null) {
    return null;
  }
  if (typeof pendingRaw !== "object" || Array.isArray(pendingRaw)) {
    throw new DomainError("INVALID_INPUT", "Ugyldig schedulerPending i Candy settings.");
  }
  const pending = pendingRaw as Record<string, unknown>;
  const effectiveFromMs = parseOptionalIsoTimestampMs(pending.effectiveFrom, "schedulerPending.effectiveFrom");
  if (effectiveFromMs === undefined) {
    return null;
  }
  const patch = parseCandyManiaSettingsPatch(pending.settings);
  const normalizedSettings = normalizeCandyManiaSchedulerSettings(runtimeCandyManiaSettings, patch);
  return {
    effectiveFromMs,
    settings: normalizedSettings
  };
}

function hasAnyRunningCandyManiaRound(summaries?: ReturnType<typeof engine.listRoomSummaries>): boolean {
  const roomSummaries = summaries ?? engine.listRoomSummaries();
  return roomSummaries.some((summary) => summary.gameStatus === "RUNNING");
}

function getCandyManiaAdminSettingsResponse(): Record<string, unknown> {
  const lockActive = hasAnyRunningCandyManiaRound();
  return {
    ...runtimeCandyManiaSettings,
    effectiveFrom: new Date(candyManiaSettingsEffectiveFromMs).toISOString(),
    pendingUpdate: pendingCandyManiaSettingsUpdate
      ? {
          effectiveFrom: new Date(pendingCandyManiaSettingsUpdate.effectiveFromMs).toISOString(),
          settings: { ...pendingCandyManiaSettingsUpdate.settings }
        }
      : null,
    schedulerTickMs,
    constraints: {
      runtime: isProductionRuntime ? "production" : "non-production",
      autoplayAllowed,
      allowAutoplayInProduction,
      forceCandyAutoStart,
      forceCandyAutoDraw,
      minRoundIntervalMs: bingoMinRoundIntervalMs,
      minPlayersToStart: bingoMinPlayersToStart,
      maxDrawsPerRound: bingoMaxDrawsPerRound,
      maxTicketsPerPlayer: 5,
      minPayoutPercent: 0,
      maxPayoutPercent: 100,
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
  if (game.slug === "candy") {
    return buildCandySettingsDefinition({
      minRoundIntervalMs: bingoMinRoundIntervalMs,
      minPlayersToStart: bingoMinPlayersToStart,
      maxTicketsPerPlayer: 5,
      forceAutoStart: forceCandyAutoStart,
      forceAutoDraw: forceCandyAutoDraw,
      runningRoundLockActive: hasAnyRunningCandyManiaRound()
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
  if (game.slug !== "candy") {
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

  const candySettings = getCandyManiaAdminSettingsResponse();
  const {
    effectiveFrom,
    pendingUpdate,
    constraints,
    locks,
    schedulerTickMs,
    ...typedSettings
  } = candySettings;

  return {
    slug: game.slug,
    title: game.title,
    description: game.description,
    updatedAt: game.updatedAt,
    settings: typedSettings,
    effectiveFrom,
    pendingUpdate,
    schedulerTickMs,
    constraints,
    locks
  };
}

async function persistCandyManiaSettingsToCatalog(options?: PersistCandySettingsOptions): Promise<void> {
  const candyGame = await platformService.getGame("candy");
  const nextSettings = normalizeGameSettingsForUpdate("candy", {
    ...(candyGame.settings ?? {}),
    ...candyManiaSettingsToRecord()
  });
  await platformService.updateGame("candy", {
    settings: nextSettings
  }, {
    changedBy: options?.changedBy,
    source: options?.source ?? "CANDY_SETTINGS_SYNC",
    effectiveFrom:
      options?.effectiveFromMs !== undefined
        ? new Date(options.effectiveFromMs).toISOString()
        : new Date(candyManiaSettingsEffectiveFromMs).toISOString()
  });
}

async function hydrateCandyManiaSettingsFromCatalog(): Promise<void> {
  try {
    const candyGame = await platformService.getGame("candy");
    const patch = readCandyManiaSettingsFromRecord(candyGame.settings);
    const normalized = normalizeCandyManiaSchedulerSettings(runtimeCandyManiaSettings, patch);
    // ENV always wins for autoDrawIntervalMs so deploys take effect
    // regardless of persisted database value
    const envDrawInterval = process.env.AUTO_DRAW_INTERVAL_MS;
    if (envDrawInterval) {
      normalized.autoDrawIntervalMs = Math.max(250, Math.floor(Number(envDrawInterval) || 2000));
    }
    Object.assign(runtimeCandyManiaSettings, normalized);
    const currentEffectiveFromMs = parseOptionalIsoTimestampMs(
      (candyGame.settings as Record<string, unknown> | undefined)?.schedulerCurrentEffectiveFrom,
      "schedulerCurrentEffectiveFrom"
    );
    if (currentEffectiveFromMs !== undefined) {
      candyManiaSettingsEffectiveFromMs = currentEffectiveFromMs;
    }
    pendingCandyManiaSettingsUpdate = readPendingCandyManiaSettingsFromRecord(candyGame.settings);
  } catch (error) {
    console.warn("[candy-mania] Klarte ikke laste scheduler settings fra game-catalog. Bruker env/default.", error);
  }
}

function readForwardedHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : "";
  }
  return typeof value === "string" ? value.split(",")[0].trim() : "";
}

function deriveRequestApiBaseUrl(req: express.Request): string {
  const forwardedProto = readForwardedHeaderValue(req.headers["x-forwarded-proto"]);
  const forwardedHost = readForwardedHeaderValue(req.headers["x-forwarded-host"]);
  const protocolCandidate = (forwardedProto || req.protocol || "https").trim().toLowerCase();
  const protocol = protocolCandidate === "http" || protocolCandidate === "https" ? protocolCandidate : "https";
  const host = (forwardedHost || req.get("host") || "").trim();

  if (!host) {
    throw new DomainError("INVALID_CONFIG", "Kunne ikke utlede apiBaseUrl fra request.");
  }

  return normalizeAbsoluteHttpUrl(`${protocol}://${host}`, "apiBaseUrl", "INVALID_CANDY_API_BASE_URL");
}

async function resolveCandyLaunchHallId(inputHallId: unknown): Promise<string> {
  if (typeof inputHallId === "string" && inputHallId.trim()) {
    const hall = await platformService.requireActiveHall(inputHallId);
    return hall.id;
  }

  const halls = await platformService.listHalls({ includeInactive: false });
  if (halls.length === 0) {
    throw new DomainError("HALL_NOT_FOUND", "Fant ingen aktiv hall for Candy-launch.");
  }

  return halls[0].id;
}

async function getCandyLaunchSettingsForRuntime(requireLaunchUrl = true): Promise<CandyLaunchSettings> {
  const candyGame = await platformService.getGame("candy");
  const settings = normalizeGameSettingsForUpdate("candy", candyGame.settings ?? {}, {
    requireCandyLaunchUrl: requireLaunchUrl
  });
  if (!settings) {
    throw new DomainError("INVALID_CANDY_LAUNCH_URL", "Candy settings mangler.");
  }
  return readCandyLaunchSettings(settings, { requireLaunchUrl });
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

async function emitRoomUpdate(
  roomCode: string,
  playerId?: string
): Promise<RoomSnapshot & { scheduler: Record<string, unknown> }> {
  const payload = await buildRoomUpdatePayloadForPlayer(roomCode, playerId);
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

const nextAutoStartAtByRoom = new Map<string, number>();
const lastAutoDrawAtByRoom = new Map<string, number>();
const roomConfiguredEntryFeeByRoom = new Map<string, number>();
const armedPlayersByRoom = new Map<string, Set<string>>();
const roomSchedulerLocks = new Set<string>();

// Per-room claim mutex: queues concurrent claims so LINE can't be double-awarded.
const roomClaimQueues = new Map<string, Promise<void>>();

async function withRoomClaimLock<T>(roomCode: string, work: () => Promise<T>): Promise<T> {
  const previous = roomClaimQueues.get(roomCode) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  roomClaimQueues.set(roomCode, next);
  await previous;
  try {
    return await work();
  } finally {
    resolve!();
    if (roomClaimQueues.get(roomCode) === next) {
      roomClaimQueues.delete(roomCode);
    }
  }
}
let schedulerTickInProgress = false;

function getOrCreateArmedPlayers(roomCode: string): Set<string> {
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  let armedPlayers = armedPlayersByRoom.get(normalizedRoomCode);
  if (!armedPlayers) {
    armedPlayers = new Set<string>();
    armedPlayersByRoom.set(normalizedRoomCode, armedPlayers);
  }
  return armedPlayers;
}

function clearArmedPlayers(roomCode: string): void {
  armedPlayersByRoom.delete(roomCode.trim().toUpperCase());
}

function setPlayerBetArm(roomCode: string, playerId: string, armed: boolean): void {
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  const normalizedPlayerId = playerId.trim();
  const armedPlayers = getOrCreateArmedPlayers(normalizedRoomCode);
  if (armed) {
    armedPlayers.add(normalizedPlayerId);
    return;
  }

  armedPlayers.delete(normalizedPlayerId);
  if (armedPlayers.size === 0) {
    armedPlayersByRoom.delete(normalizedRoomCode);
  }
}

function getArmedPlayerIdsForSnapshot(snapshot: RoomSnapshot): string[] {
  const armedPlayers = armedPlayersByRoom.get(snapshot.code);
  if (!armedPlayers || armedPlayers.size === 0) {
    return [];
  }

  const roomPlayerIds = new Set(snapshot.players.map((player) => player.id));
  const filteredArmedPlayerIds = [...armedPlayers].filter((playerId) => roomPlayerIds.has(playerId));
  if (filteredArmedPlayerIds.length !== armedPlayers.size) {
    if (filteredArmedPlayerIds.length === 0) {
      armedPlayersByRoom.delete(snapshot.code);
    } else {
      armedPlayersByRoom.set(snapshot.code, new Set(filteredArmedPlayerIds));
    }
  }

  filteredArmedPlayerIds.sort((a, b) => a.localeCompare(b));
  return filteredArmedPlayerIds;
}

function compareCandyRoomPriority(a: RoomSummary, b: RoomSummary): number {
  const canonicalScoreA = a.code === canonicalCandyRoomCode ? 1 : 0;
  const canonicalScoreB = b.code === canonicalCandyRoomCode ? 1 : 0;
  if (canonicalScoreA !== canonicalScoreB) {
    return canonicalScoreB - canonicalScoreA;
  }

  const runningScoreA = a.gameStatus === "RUNNING" ? 1 : 0;
  const runningScoreB = b.gameStatus === "RUNNING" ? 1 : 0;
  if (runningScoreA !== runningScoreB) {
    return runningScoreB - runningScoreA;
  }

  if (a.playerCount !== b.playerCount) {
    return b.playerCount - a.playerCount;
  }

  const createdAtA = Date.parse(a.createdAt);
  const createdAtB = Date.parse(b.createdAt);
  const normalizedCreatedAtA = Number.isFinite(createdAtA) ? createdAtA : Number.MAX_SAFE_INTEGER;
  const normalizedCreatedAtB = Number.isFinite(createdAtB) ? createdAtB : Number.MAX_SAFE_INTEGER;
  if (normalizedCreatedAtA !== normalizedCreatedAtB) {
    return normalizedCreatedAtA - normalizedCreatedAtB;
  }

  return a.code.localeCompare(b.code);
}

function selectCanonicalCandyRoomSummaries(summaries: RoomSummary[]): RoomSummary[] {
  if (!enforceSingleCandyGlobalRoom) {
    return summaries;
  }

  const canonicalRoom = getCanonicalCandyRoom(summaries);
  return canonicalRoom ? [canonicalRoom] : [];
}

function getCanonicalCandyRoom(summaries = engine.listRoomSummaries()): RoomSummary | null {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return null;
  }

  const sorted = [...summaries].sort(compareCandyRoomPriority);
  return sorted[0] ?? null;
}

function isCanonicalCandyRoom(roomCode: string, summaries = engine.listRoomSummaries()): boolean {
  const canonicalRoom = getCanonicalCandyRoom(summaries);
  if (!canonicalRoom) {
    return false;
  }
  return canonicalRoom.code === roomCode.trim().toUpperCase();
}

function assertCanonicalCandyRoomForGameplay(roomCode: string): void {
  if (!enforceSingleCandyGlobalRoom) {
    return;
  }

  const normalizedRoomCode = roomCode.trim().toUpperCase();
  const summaries = engine.listRoomSummaries();
  const canonicalRoom = getCanonicalCandyRoom(summaries);
  if (!canonicalRoom) {
    return;
  }

  if (canonicalRoom.code !== normalizedRoomCode) {
    throw new DomainError(
      "ROOM_BLOCKED_NON_CANONICAL",
      `Rom ${normalizedRoomCode} er låst for gameplay. Bruk canonical rom ${canonicalRoom.code}.`
    );
  }
}

function resolveCanonicalRoomCodeOrThrow(requestedRoomCode: string): string {
  const normalizedRequestedRoomCode = requestedRoomCode.trim().toUpperCase();
  if (!enforceSingleCandyGlobalRoom) {
    return normalizedRequestedRoomCode;
  }

  const canonicalRoom = getCanonicalCandyRoom();
  if (!canonicalRoom) {
    throw new DomainError(
      "SINGLE_ROOM_ONLY",
      "Ingen canonical-rom er opprettet enda. Opprett ett rom først."
    );
  }

  return canonicalRoom.code;
}

async function createCanonicalCandyRoom(input: {
  hallId: string;
  playerName: string;
  walletId: string;
  socketId?: string;
}): Promise<{ roomCode: string; playerId: string }> {
  return engine.createRoom({
    roomCode: canonicalCandyRoomCode,
    hallId: input.hallId,
    playerName: input.playerName,
    walletId: input.walletId,
    socketId: input.socketId,
  });
}

async function ensureCanonicalCandyRoomExists(reason: "scheduler" | "startup"): Promise<string | null> {
  if (!enforceSingleCandyGlobalRoom) {
    return null;
  }

  const existingCanonicalRoom = getCanonicalCandyRoom();
  if (existingCanonicalRoom) {
    return existingCanonicalRoom.code;
  }

  const hallId = await resolveCandyLaunchHallId(undefined);
  const { roomCode, playerId } = await createCanonicalCandyRoom({
    hallId,
    playerName: "Candy System",
    walletId: `candy-system-host-${hallId}`,
  });
  setRoomConfiguredEntryFee(roomCode, runtimeCandyManiaSettings.autoRoundEntryFee);
  setNextRoundForRoom(roomCode, Date.now());
  await emitRoomUpdate(roomCode, playerId);
  logCandyRealtimeEvent("canonical_room_bootstrapped", {
    reason,
    roomCode,
    hallId,
  });
  return roomCode;
}

function findPlayerInRoomByWallet(snapshot: RoomSnapshot, walletId: string): RoomSnapshot["players"][number] | null {
  const normalizedWalletId = walletId.trim();
  if (!normalizedWalletId) {
    return null;
  }
  return snapshot.players.find((player) => player.walletId === normalizedWalletId) ?? null;
}

function getNextRoundBoundaryMs(nowMs: number): number {
  return (
    Math.ceil(nowMs / runtimeCandyManiaSettings.autoRoundStartIntervalMs) *
    runtimeCandyManiaSettings.autoRoundStartIntervalMs
  );
}

function normalizeRoomNextAutoStartAt(roomCode: string, nowMs: number): number {
  if (!runtimeCandyManiaSettings.autoRoundStartEnabled) {
    nextAutoStartAtByRoom.delete(roomCode);
    return nowMs;
  }

  const fallbackNextStartAt = getNextRoundBoundaryMs(nowMs);
  const existing = nextAutoStartAtByRoom.get(roomCode);
  const staleToleranceMs = Math.max(1500, schedulerTickMs * 4);

  if (existing === undefined || !Number.isFinite(existing)) {
    nextAutoStartAtByRoom.set(roomCode, fallbackNextStartAt);
    return fallbackNextStartAt;
  }

  if (existing < nowMs - staleToleranceMs) {
    nextAutoStartAtByRoom.set(roomCode, fallbackNextStartAt);
    return fallbackNextStartAt;
  }

  return existing;
}

function setNextRoundForRoom(roomCode: string, nowMs: number): number {
  const nextStartAt = getNextRoundBoundaryMs(nowMs + 1);
  nextAutoStartAtByRoom.set(roomCode, nextStartAt);
  return nextStartAt;
}

function getRoomConfiguredEntryFee(roomCode: string): number {
  const configured = roomConfiguredEntryFeeByRoom.get(roomCode);
  if (configured === undefined || !Number.isFinite(configured)) {
    return runtimeCandyManiaSettings.autoRoundEntryFee;
  }
  return configured;
}

function setRoomConfiguredEntryFee(roomCode: string, entryFee: number): number {
  const normalized = Math.max(0, Math.round(entryFee * 100) / 100);
  roomConfiguredEntryFeeByRoom.set(roomCode, normalized);
  return normalized;
}

function resolveAdaptivePayoutPercent(hallId: string): number {
  return engine.resolvePayoutPercentForNextRound(runtimeCandyManiaSettings.payoutPercent, hallId);
}

async function resolveDefaultTicketsPerPlayerForRoom(roomCode: string): Promise<number> {
  const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
  return Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeCandyManiaSettings.autoRoundTicketsPerPlayer);
}

function cloneTicketSet(tickets: Ticket[]): Ticket[] {
  return tickets.map((ticket) => ({
    ...ticket,
    numbers: Array.isArray(ticket.numbers) ? [...ticket.numbers] : undefined,
    grid: ticket.grid.map((row) => [...row])
  }));
}

function withPlayerVisiblePreRoundTickets<T extends RoomSnapshot>(
  snapshot: T,
  playerId?: string,
  visibleTickets?: Ticket[]
): T {
  if (!playerId || !Array.isArray(visibleTickets) || visibleTickets.length === 0) {
    return snapshot;
  }

  const existingTickets = snapshot.preRoundTickets?.[playerId];
  if (Array.isArray(existingTickets) && existingTickets.length > 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    preRoundTickets: {
      ...(snapshot.preRoundTickets ?? {}),
      [playerId]: cloneTicketSet(visibleTickets)
    }
  };
}

async function ensurePlayerHasVisiblePreRoundTickets(roomCode: string, playerId: string): Promise<Ticket[]> {
  const ticketsPerPlayer = await resolveDefaultTicketsPerPlayerForRoom(roomCode);
  return await engine.ensurePreRoundTicketsForPlayer({
    roomCode,
    playerId,
    ticketsPerPlayer
  });
}

async function buildRoomUpdatePayloadForPlayer(
  roomCode: string,
  playerId?: string
): Promise<RoomSnapshot & { scheduler: Record<string, unknown> }> {
  const visibleTickets = playerId ? await ensurePlayerHasVisiblePreRoundTickets(roomCode, playerId) : undefined;
  const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
  return withPlayerVisiblePreRoundTickets(snapshot, playerId, visibleTickets);
}

function buildRoomSchedulerState(snapshot: RoomSnapshot, nowMs: number): Record<string, unknown> {
  const nextStartAtMs = runtimeCandyManiaSettings.autoRoundStartEnabled
    ? normalizeRoomNextAutoStartAt(snapshot.code, nowMs)
    : null;
  const millisUntilNextStart = nextStartAtMs === null ? null : Math.max(0, nextStartAtMs - nowMs);
  const currentDrawCount = snapshot.currentGame?.drawnNumbers?.length ?? 0;
  const drawCapacity = Math.max(1, bingoMaxDrawsPerRound);
  const armedPlayerIds = getArmedPlayerIdsForSnapshot(snapshot);
  const armedPlayerCount = armedPlayerIds.length;
  const canStartNow =
    runtimeCandyManiaSettings.autoRoundStartEnabled &&
    snapshot.currentGame == null &&
    millisUntilNextStart !== null &&
    millisUntilNextStart <= Math.max(1000, schedulerTickMs * 2);

  return {
    enabled: runtimeCandyManiaSettings.autoRoundStartEnabled,
    liveRoundsIndependentOfBet: true,
    intervalMs: runtimeCandyManiaSettings.autoRoundStartIntervalMs,
    minPlayers: runtimeCandyManiaSettings.autoRoundMinPlayers,
    playerCount: snapshot.players.length,
    armedPlayerCount,
    armedPlayerIds,
    entryFee: getRoomConfiguredEntryFee(snapshot.code),
    payoutPercent: resolveAdaptivePayoutPercent(snapshot.hallId),
    drawCapacity,
    currentDrawCount,
    remainingDrawCapacity: Math.max(0, drawCapacity - currentDrawCount),
    nextStartAt: nextStartAtMs === null ? null : new Date(nextStartAtMs).toISOString(),
    millisUntilNextStart,
    canStartNow,
    serverTime: new Date(nowMs).toISOString()
  };
}

function buildRoomUpdatePayload(
  snapshot: RoomSnapshot,
  nowMs = Date.now()
): RoomSnapshot & { scheduler: Record<string, unknown> } {
  return {
    ...snapshot,
    scheduler: buildRoomSchedulerState(snapshot, nowMs)
  };
}

// ---------------------------------------------------------------------------
// Game state checkpoints — fire-and-forget writes to Postgres
// ---------------------------------------------------------------------------

function checkpointRoom(roomCode: string): void {
  try {
    const snapshot = engine.getRoomSnapshot(roomCode);
    const players = (snapshot.players ?? []).map((p: { id: string; name: string; walletId?: string }) => ({
      id: p.id,
      name: p.name,
      walletId: p.walletId ?? "",
    }));
    const preRoundTickets: Record<string, number[][]> = {};
    if (snapshot.preRoundTickets) {
      for (const [pid, tickets] of Object.entries(snapshot.preRoundTickets)) {
        preRoundTickets[pid] = (tickets as Array<{ numbers: number[] }>).map((t) => t.numbers);
      }
    }
    gameCheckpointStore.saveRoomCheckpoint({
      roomCode,
      hallId: snapshot.hallId ?? "",
      hostPlayerId: snapshot.hostPlayerId ?? "",
      players,
      preRoundTickets,
      createdAt: snapshot.createdAt ?? new Date().toISOString(),
    }).catch((err) => console.error("[checkpoint] room save error:", err));
  } catch (err) {
    console.error("[checkpoint] room checkpoint error:", err);
  }
}

function checkpointGame(roomCode: string): void {
  try {
    const snapshot = engine.getRoomSnapshot(roomCode);
    const game = snapshot.currentGame;
    if (!game) return;

    const players = (snapshot.players ?? []).map((p: { id: string; name: string; walletId?: string }) => ({
      id: p.id,
      name: p.name,
      walletId: p.walletId ?? "",
    }));
    const tickets: Record<string, number[][]> = {};
    if (game.tickets) {
      for (const [pid, playerTickets] of Object.entries(game.tickets)) {
        tickets[pid] = (playerTickets as Array<{ numbers: number[] }>).map((t) => t.numbers);
      }
    }
    const claims = (game.claims ?? []).map((c: { id: string; playerId: string; type: string; valid: boolean; reason?: string }) => ({
      id: c.id,
      playerId: c.playerId,
      type: c.type,
      valid: c.valid,
      reason: c.reason,
    }));

    gameCheckpointStore.saveGameCheckpoint({
      roomCode,
      gameId: game.id,
      status: game.status,
      hallId: snapshot.hallId ?? "",
      hostPlayerId: snapshot.hostPlayerId ?? "",
      entryFee: game.entryFee ?? 0,
      ticketsPerPlayer: game.ticketsPerPlayer ?? 4,
      payoutPercent: game.payoutPercent ?? 75,
      drawnNumbers: game.drawnNumbers ?? [],
      drawBag: engine.getGameDrawBag(roomCode),
      players,
      tickets,
      claims,
      lineWinnerId: game.lineWinnerId ?? null,
      bingoWinnerId: game.bingoWinnerId ?? null,
      startedAt: game.startedAt ?? null,
      endedAt: game.endedAt ?? null,
    }).catch((err) => console.error("[checkpoint] game save error:", err));
  } catch (err) {
    console.error("[checkpoint] game checkpoint error:", err);
  }
}

function readTelemetryNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTelemetryString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readTelemetryBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function extractSchedulerTelemetry(snapshot: RoomSnapshot | (RoomSnapshot & { scheduler?: unknown })): Record<string, unknown> {
  const schedulerRaw = (snapshot as RoomSnapshot & { scheduler?: unknown }).scheduler;
  if (!isRecordObject(schedulerRaw)) {
    return {};
  }

  return {
    enabled: readTelemetryBoolean(schedulerRaw, "enabled"),
    nextStartAt: readTelemetryString(schedulerRaw, "nextStartAt"),
    armedPlayerCount: readTelemetryNumber(schedulerRaw, "armedPlayerCount"),
    minPlayers: readTelemetryNumber(schedulerRaw, "minPlayers")
  };
}

function logCandyRealtimeEvent(event: string, fields: Record<string, unknown>): void {
  const payload = {
    event,
    at: new Date().toISOString(),
    ...fields
  };
  console.log(`[candy-observe] ${JSON.stringify(payload)}`);
}

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
  for (const roomCode of roomConfiguredEntryFeeByRoom.keys()) {
    if (!activeRoomCodes.has(roomCode)) {
      roomConfiguredEntryFeeByRoom.delete(roomCode);
    }
  }
  for (const roomCode of armedPlayersByRoom.keys()) {
    if (!activeRoomCodes.has(roomCode)) {
      armedPlayersByRoom.delete(roomCode);
    }
  }
}

function syncSchedulerStateAfterCandySettingsChange(previous: CandyManiaSchedulerSettings): void {
  const autoStartToggled =
    previous.autoRoundStartEnabled !== runtimeCandyManiaSettings.autoRoundStartEnabled;
  const roundIntervalChanged =
    previous.autoRoundStartIntervalMs !== runtimeCandyManiaSettings.autoRoundStartIntervalMs;
  const autoDrawToggled =
    previous.autoDrawEnabled !== runtimeCandyManiaSettings.autoDrawEnabled;

  if (!runtimeCandyManiaSettings.autoRoundStartEnabled) {
    nextAutoStartAtByRoom.clear();
  }
  if (!runtimeCandyManiaSettings.autoDrawEnabled) {
    lastAutoDrawAtByRoom.clear();
  }

  if (runtimeCandyManiaSettings.autoRoundStartEnabled && (autoStartToggled || roundIntervalChanged)) {
    const nowMs = Date.now();
    for (const roomCode of engine.getAllRoomCodes()) {
      setNextRoundForRoom(roomCode, nowMs);
    }
  }

  if (autoDrawToggled && runtimeCandyManiaSettings.autoDrawEnabled) {
    lastAutoDrawAtByRoom.clear();
  }
}

async function applyPendingCandyManiaSettingsIfDue(
  nowMs: number,
  summaries: ReturnType<typeof engine.listRoomSummaries>
): Promise<boolean> {
  if (!pendingCandyManiaSettingsUpdate) {
    return false;
  }
  if (pendingCandyManiaSettingsUpdate.effectiveFromMs > nowMs) {
    return false;
  }
  if (hasAnyRunningCandyManiaRound(summaries)) {
    return false;
  }

  const previous: CandyManiaSchedulerSettings = { ...runtimeCandyManiaSettings };
  const previousEffectiveFromMs = candyManiaSettingsEffectiveFromMs;
  const pendingToApply = {
    effectiveFromMs: pendingCandyManiaSettingsUpdate.effectiveFromMs,
    settings: { ...pendingCandyManiaSettingsUpdate.settings }
  };
  pendingCandyManiaSettingsUpdate = null;
  Object.assign(runtimeCandyManiaSettings, pendingToApply.settings);
  candyManiaSettingsEffectiveFromMs = pendingToApply.effectiveFromMs;
  syncSchedulerStateAfterCandySettingsChange(previous);

  try {
    await persistCandyManiaSettingsToCatalog({
      source: "CANDY_SETTINGS_AUTO_APPLY",
      effectiveFromMs: pendingToApply.effectiveFromMs
    });
  } catch (error) {
    Object.assign(runtimeCandyManiaSettings, previous);
    candyManiaSettingsEffectiveFromMs = previousEffectiveFromMs;
    pendingCandyManiaSettingsUpdate = pendingToApply;
    syncSchedulerStateAfterCandySettingsChange(pendingToApply.settings);
    throw error;
  }

  await emitManyRoomUpdates(engine.getAllRoomCodes());
  return true;
}

function isEndedRoundCleanupWindowActive(snapshot: RoomSnapshot, nowMs: number): boolean {
  const endedAtRaw = snapshot.currentGame?.endedAt;
  if (snapshot.currentGame?.status !== "ENDED" || typeof endedAtRaw !== "string" || !endedAtRaw.trim()) {
    return false;
  }

  const endedAtMs = Date.parse(endedAtRaw);
  if (!Number.isFinite(endedAtMs)) {
    return false;
  }

  return nowMs < endedAtMs + candyEndedRoundCleanupDelayMs;
}

async function processEndedRoundCleanup(
  summary: ReturnType<typeof engine.listRoomSummaries>[number],
  now: number
): Promise<boolean> {
  if (summary.gameStatus !== "ENDED") {
    return false;
  }

  const roomCode = summary.code;
  let handled = false;

  await withRoomSchedulerLock(roomCode, async () => {
    const latestSnapshot = engine.getRoomSnapshot(roomCode);
    if (latestSnapshot.currentGame?.status !== "ENDED") {
      return;
    }

    handled = true;
    if (isEndedRoundCleanupWindowActive(latestSnapshot, now)) {
      return;
    }

    if (engine.archiveEndedGameIfReady(roomCode, now, candyEndedRoundCleanupDelayMs)) {
      await emitRoomUpdate(roomCode);
    }
  });

  return handled;
}

function isWithinOpeningHours(settings: CandyManiaSchedulerSettings, now: Date = new Date()): boolean {
  if (!settings.openingHoursEnabled) {
    return true;
  }
  const dayNames: (keyof CandyOpeningHoursSchedule)[] = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  ];
  const dayKey = dayNames[now.getDay()];
  const daySchedule = settings.openingHoursSchedule[dayKey];
  if (!daySchedule.enabled) {
    return false;
  }
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = daySchedule.open.split(":").map(Number);
  const [closeH, closeM] = daySchedule.close.split(":").map(Number);
  const openMinutes = (openH || 0) * 60 + (openM || 0);
  const closeMinutes = (closeH || 0) * 60 + (closeM || 0);
  if (closeMinutes <= openMinutes) {
    return false;
  }
  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

async function processAutoStart(summary: ReturnType<typeof engine.listRoomSummaries>[number], now: number): Promise<void> {
  const roomCode = summary.code;
  if (!runtimeCandyManiaSettings.autoRoundStartEnabled) {
    nextAutoStartAtByRoom.delete(roomCode);
    return;
  }

  // Don't start new rounds outside opening hours (but let running rounds finish)
  if (!isWithinOpeningHours(runtimeCandyManiaSettings) && summary.gameStatus !== "RUNNING") {
    return;
  }

  const scheduledStartAt = normalizeRoomNextAutoStartAt(roomCode, now);

  if (summary.gameStatus === "RUNNING") {
    if (scheduledStartAt <= now) {
      setNextRoundForRoom(roomCode, now);
    }
    return;
  }

  if (now < scheduledStartAt) {
    return;
  }

  await withRoomSchedulerLock(roomCode, async () => {
    const latestSnapshot = engine.getRoomSnapshot(roomCode);
    if (latestSnapshot.currentGame != null) {
      setNextRoundForRoom(roomCode, Date.now());
      return;
    }
    const armedPlayerIds = getArmedPlayerIdsForSnapshot(latestSnapshot);

    try {
      const adaptivePayoutPercent = resolveAdaptivePayoutPercent(summary.hallId);
      await engine.startGame({
        roomCode,
        actorPlayerId: latestSnapshot.hostPlayerId,
        entryFee: getRoomConfiguredEntryFee(roomCode),
        ticketsPerPlayer: runtimeCandyManiaSettings.autoRoundTicketsPerPlayer,
        payoutPercent: adaptivePayoutPercent,
        participantPlayerIds: armedPlayerIds,
        allowEmptyRound: true
      });
    } catch (error) {
      if (
        error instanceof DomainError &&
        (error.code === "PLAYER_ALREADY_IN_RUNNING_GAME" ||
          error.code === "ROUND_START_TOO_SOON" ||
          error.code === "NOT_ENOUGH_PLAYERS" ||
          error.code === "ROUND_CLEANUP_PENDING")
      ) {
        setNextRoundForRoom(roomCode, Date.now());
        return;
      }
      throw error;
    }
    clearArmedPlayers(roomCode);
    setNextRoundForRoom(roomCode, Date.now());
    lastAutoDrawAtByRoom.delete(roomCode);
    await emitRoomUpdate(roomCode);
    checkpointRoom(roomCode);
    checkpointGame(roomCode);
  });
}

async function processAutoDraw(summary: ReturnType<typeof engine.listRoomSummaries>[number], now: number): Promise<void> {
  const roomCode = summary.code;
  if (!runtimeCandyManiaSettings.autoDrawEnabled || summary.gameStatus !== "RUNNING") {
    lastAutoDrawAtByRoom.delete(roomCode);
    return;
  }

  const lastDrawAt = lastAutoDrawAtByRoom.get(roomCode) ?? 0;
  if (now - lastDrawAt < runtimeCandyManiaSettings.autoDrawIntervalMs) {
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
    if (currentNow - refreshedLastDrawAt < runtimeCandyManiaSettings.autoDrawIntervalMs) {
      return;
    }

    try {
      const number = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: latestSnapshot.hostPlayerId,
        autoSettleClaims: true
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
    checkpointGame(roomCode);
  });
}

async function runSchedulerTick(): Promise<void> {
  if (schedulerTickInProgress) {
    return;
  }
  schedulerTickInProgress = true;

  try {
    await ensureCanonicalCandyRoomExists("scheduler");
    const now = Date.now();
    let summaries = engine.listRoomSummaries();
    if (await applyPendingCandyManiaSettingsIfDue(now, summaries)) {
      summaries = engine.listRoomSummaries();
    }
    const schedulerSummaries = selectCanonicalCandyRoomSummaries(summaries);
    cleanupSchedulerState(new Set(schedulerSummaries.map((summary) => summary.code)));

    for (const summary of schedulerSummaries) {
      try {
        const cleanupHandled = await processEndedRoundCleanup(summary, now);
        if (cleanupHandled) {
          continue;
        }
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

const scheduler = setInterval(() => {
  runSchedulerTick().catch((error) => {
    console.error("[scheduler] uventet feil", error);
  });
}, schedulerTickMs);
scheduler.unref();

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
  const report = engine.runDailyReportJob({ date: dateKey });
  lastDailyReportDateKey = dateKey;
  console.log(
    `[daily-report] generated date=${report.date} rows=${report.rows.length} turnover=${report.totals.grossTurnover} prizes=${report.totals.prizesPaid}`
  );
}

if (dailyReportJobEnabled) {
  runDailyReportSchedulerTick(Date.now()).catch((error) => {
    console.error("[daily-report] initial run feilet", error);
  });
  const reportScheduler = setInterval(() => {
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

app.post("/api/games/candy/launch-token", async (req, res) => {
  try {
    const accessToken = getAccessTokenFromRequest(req);
    const user = await platformService.getUserFromAccessToken(accessToken);
    platformService.assertUserEligibleForGameplay(user);
    engine.assertWalletAllowedForGameplay(user.walletId);

    const launchSettings = await getCandyLaunchSettingsForRuntime(true);
    if (!launchSettings.launchUrl) {
      throw new DomainError("INVALID_CANDY_LAUNCH_URL", "Candy launchUrl mangler.");
    }
    const hallId = await resolveCandyLaunchHallId(req.body?.hallId);
    const apiBaseUrl = launchSettings.apiBaseUrl || deriveRequestApiBaseUrl(req);
    enforceCandyApiBasePolicy(apiBaseUrl, "apiBaseUrl");
    const issued = candyLaunchTokenStore.issue({
      accessToken,
      hallId,
      playerName: user.displayName,
      walletId: user.walletId,
      apiBaseUrl
    });
    const runtimeLaunchUrl = sanitizeCandyLaunchUrlForRuntime(launchSettings.launchUrl, req);

    logCandyRealtimeEvent("launch_token_issued", {
      userId: user.id,
      hallId,
      walletId: user.walletId,
      launchTokenExpiresAt: issued.expiresAt,
      apiBaseUrl,
      launchUrl: runtimeLaunchUrl
    });

    apiSuccess(res, {
      launchToken: issued.launchToken,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
      launchUrl: runtimeLaunchUrl
    });
  } catch (error) {
    const publicError = toPublicError(error);
    logCandyRealtimeEvent("launch_token_failed", {
      code: publicError.code,
      message: publicError.message
    });
    apiFailure(res, error);
  }
});

app.post("/api/games/candy/launch-resolve", async (req, res) => {
  try {
    const launchToken = mustBeNonEmptyString(req.body?.launchToken, "launchToken");
    const resolved = candyLaunchTokenStore.consume(launchToken);
    if (!resolved) {
      throw new DomainError(
        "INVALID_LAUNCH_TOKEN",
        "Launch-token er ugyldig eller utløpt. Start spillet på nytt fra portalen."
      );
    }

    logCandyRealtimeEvent("launch_resolve_ok", {
      hallId: resolved.hallId,
      walletId: resolved.walletId,
      apiBaseUrl: resolved.apiBaseUrl
    });

    apiSuccess(res, resolved);
  } catch (error) {
    const publicError = toPublicError(error);
    logCandyRealtimeEvent("launch_resolve_failed", {
      code: publicError.code,
      message: publicError.message
    });
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
    const normalizedSlug = slug.trim().toLowerCase();
    const { settings, effectiveFromMs } = extractAdminGameSettingsPayload(req.body);

    if (normalizedSlug !== "candy") {
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
      return;
    }

    const patch = parseCandyManiaSettingsPatch(settings);
    const nowMs = Date.now();
    const wantsFutureActivation = effectiveFromMs !== undefined && effectiveFromMs > nowMs;
    if (wantsFutureActivation) {
      const baseSettings = pendingCandyManiaSettingsUpdate?.settings ?? runtimeCandyManiaSettings;
      const scheduledSettings = normalizeCandyManiaSchedulerSettings(baseSettings, patch);
      pendingCandyManiaSettingsUpdate = {
        effectiveFromMs,
        settings: scheduledSettings
      };
      await persistCandyManiaSettingsToCatalog({
        changedBy: {
          userId: adminUser.id,
          displayName: adminUser.displayName,
          role: adminUser.role
        },
        source: "ADMIN_TYPED_CANDY_SETTINGS_SCHEDULED",
        effectiveFromMs
      });
      const refreshed = await platformService.getGame("candy");
      apiSuccess(res, buildAdminGameSettingsResponse(refreshed));
      return;
    }

    const runningSummaries = engine.listRoomSummaries();
    if (Object.keys(patch).length > 0 && hasAnyRunningCandyManiaRound(runningSummaries)) {
      throw new DomainError(
        "CANDY_SETTINGS_LOCKED_DURING_RUNNING_GAME",
        "Kan ikke endre Candy-innstillinger mens en runde kjører. Bruk effectiveFrom for planlagt aktivering."
      );
    }

    const previous: CandyManiaSchedulerSettings = { ...runtimeCandyManiaSettings };
    const previousEffectiveFromMs = candyManiaSettingsEffectiveFromMs;
    const previousPending = pendingCandyManiaSettingsUpdate
      ? { ...pendingCandyManiaSettingsUpdate, settings: { ...pendingCandyManiaSettingsUpdate.settings } }
      : null;
    const next = normalizeCandyManiaSchedulerSettings(runtimeCandyManiaSettings, patch);

    pendingCandyManiaSettingsUpdate = null;
    Object.assign(runtimeCandyManiaSettings, next);
    candyManiaSettingsEffectiveFromMs = effectiveFromMs ?? nowMs;
    syncSchedulerStateAfterCandySettingsChange(previous);

    try {
      await persistCandyManiaSettingsToCatalog({
        changedBy: {
          userId: adminUser.id,
          displayName: adminUser.displayName,
          role: adminUser.role
        },
        source: "ADMIN_TYPED_CANDY_SETTINGS_APPLIED",
        effectiveFromMs: candyManiaSettingsEffectiveFromMs
      });
    } catch (error) {
      Object.assign(runtimeCandyManiaSettings, previous);
      candyManiaSettingsEffectiveFromMs = previousEffectiveFromMs;
      pendingCandyManiaSettingsUpdate = previousPending;
      syncSchedulerStateAfterCandySettingsChange(next);
      throw error;
    }

    await emitManyRoomUpdates(engine.getAllRoomCodes());
    const refreshed = await platformService.getGame("candy");
    apiSuccess(res, buildAdminGameSettingsResponse(refreshed));
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
    const normalizedSlug = slug.trim().toLowerCase();
    const rawSettings =
      req.body?.settings && typeof req.body.settings === "object" && !Array.isArray(req.body.settings)
        ? (req.body.settings as Record<string, unknown>)
        : undefined;
    if (normalizedSlug === "candy" && rawSettings) {
      const candySettingsPatch = parseCandyManiaSettingsPatch(rawSettings);
      if (Object.keys(candySettingsPatch).length > 0 && hasAnyRunningCandyManiaRound()) {
        throw new DomainError(
          "CANDY_SETTINGS_LOCKED_DURING_RUNNING_GAME",
          "Kan ikke endre Candy-innstillinger mens en runde kjører. Bruk Candy Mania-panelet med effectiveFrom."
        );
      }
    }
    const updated = await platformService.updateGame(slug, {
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      route: typeof req.body?.route === "string" ? req.body.route : undefined,
      isEnabled: typeof req.body?.isEnabled === "boolean" ? req.body.isEnabled : undefined,
      sortOrder: Number.isFinite(req.body?.sortOrder) ? Number(req.body.sortOrder) : undefined,
      settings: normalizeGameSettingsForUpdate(slug, rawSettings, {
        requireCandyLaunchUrl: normalizedSlug === "candy"
      })
    }, {
      changedBy: {
        userId: adminUser.id,
        displayName: adminUser.displayName,
        role: adminUser.role
      },
      source: "ADMIN_GAME_CATALOG_WRITE",
      effectiveFrom: new Date().toISOString()
    });
    if (normalizedSlug === "candy") {
      const previous: CandyManiaSchedulerSettings = { ...runtimeCandyManiaSettings };
      const patch = readCandyManiaSettingsFromRecord(updated.settings);
      const next = normalizeCandyManiaSchedulerSettings(runtimeCandyManiaSettings, patch);
      pendingCandyManiaSettingsUpdate = null;
      Object.assign(runtimeCandyManiaSettings, next);
      candyManiaSettingsEffectiveFromMs = Date.now();
      syncSchedulerStateAfterCandySettingsChange(previous);
      await persistCandyManiaSettingsToCatalog({
        changedBy: {
          userId: adminUser.id,
          displayName: adminUser.displayName,
          role: adminUser.role
        },
        source: "ADMIN_CANDY_SYNC_AFTER_GAME_WRITE",
        effectiveFromMs: candyManiaSettingsEffectiveFromMs
      });
    }
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

app.get("/api/admin/candy-mania/settings", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
    apiSuccess(res, getCandyManiaAdminSettingsResponse());
  } catch (error) {
    apiFailure(res, error);
  }
});

app.put("/api/admin/candy-mania/settings", async (req, res) => {
  try {
    const adminUser = await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const patch = parseCandyManiaSettingsPatch(req.body);
    const effectiveFromMs = parseOptionalIsoTimestampMs(req.body?.effectiveFrom, "effectiveFrom");
    const nowMs = Date.now();
    const wantsFutureActivation = effectiveFromMs !== undefined && effectiveFromMs > nowMs;

    if (wantsFutureActivation) {
      const baseSettings = pendingCandyManiaSettingsUpdate?.settings ?? runtimeCandyManiaSettings;
      const scheduledSettings = normalizeCandyManiaSchedulerSettings(baseSettings, patch);
      pendingCandyManiaSettingsUpdate = {
        effectiveFromMs,
        settings: scheduledSettings
      };
      await persistCandyManiaSettingsToCatalog({
        changedBy: {
          userId: adminUser.id,
          displayName: adminUser.displayName,
          role: adminUser.role
        },
        source: "ADMIN_CANDY_SETTINGS_SCHEDULED",
        effectiveFromMs
      });
      apiSuccess(res, getCandyManiaAdminSettingsResponse());
      return;
    }

    const runningSummaries = engine.listRoomSummaries();
    if (hasAnyRunningCandyManiaRound(runningSummaries)) {
      throw new DomainError(
        "CANDY_SETTINGS_LOCKED_DURING_RUNNING_GAME",
        "Kan ikke endre Candy-innstillinger mens en runde kjører. Sett effectiveFrom i fremtiden."
      );
    }

    const previous: CandyManiaSchedulerSettings = { ...runtimeCandyManiaSettings };
    const previousEffectiveFromMs = candyManiaSettingsEffectiveFromMs;
    const previousPending = pendingCandyManiaSettingsUpdate
      ? { ...pendingCandyManiaSettingsUpdate, settings: { ...pendingCandyManiaSettingsUpdate.settings } }
      : null;
    const next = normalizeCandyManiaSchedulerSettings(runtimeCandyManiaSettings, patch);

    pendingCandyManiaSettingsUpdate = null;
    Object.assign(runtimeCandyManiaSettings, next);
    candyManiaSettingsEffectiveFromMs = effectiveFromMs ?? nowMs;
    syncSchedulerStateAfterCandySettingsChange(previous);

    try {
      await persistCandyManiaSettingsToCatalog({
        changedBy: {
          userId: adminUser.id,
          displayName: adminUser.displayName,
          role: adminUser.role
        },
        source: "ADMIN_CANDY_SETTINGS_APPLIED",
        effectiveFromMs: candyManiaSettingsEffectiveFromMs
      });
    } catch (error) {
      Object.assign(runtimeCandyManiaSettings, previous);
      candyManiaSettingsEffectiveFromMs = previousEffectiveFromMs;
      pendingCandyManiaSettingsUpdate = previousPending;
      syncSchedulerStateAfterCandySettingsChange(next);
      throw error;
    }

    await emitManyRoomUpdates(engine.getAllRoomCodes());
    apiSuccess(res, getCandyManiaAdminSettingsResponse());
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/admin/rooms", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_READ");
    const includeSnapshots = parseBooleanQueryValue(req.query.includeSnapshots, false);
    const rooms = engine.listRoomSummaries();
    const canonicalRoom = getCanonicalCandyRoom(rooms);
    const withPolicyState = rooms.map((room) => ({
      ...room,
      isCanonical: canonicalRoom ? room.code === canonicalRoom.code : true,
      isBlockedBySingleRoomPolicy:
        enforceSingleCandyGlobalRoom && canonicalRoom ? room.code !== canonicalRoom.code : false
    }));
    if (!includeSnapshots) {
      apiSuccess(res, withPolicyState);
      return;
    }
    const detailed = withPolicyState.map((room) => ({
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
    const canonicalRoom = getCanonicalCandyRoom();
    if (enforceSingleCandyGlobalRoom && canonicalRoom) {
      const snapshot = await emitRoomUpdate(canonicalRoom.code);
      apiSuccess(res, {
        roomCode: canonicalRoom.code,
        playerId: snapshot.hostPlayerId,
        snapshot,
        canonicalReused: true
      });
      return;
    }

    const hallId = await requireActiveHallIdFromInput(req.body?.hallId);
    const requestedHostName =
      typeof req.body?.hostName === "string" && req.body.hostName.trim().length > 0
        ? req.body.hostName.trim()
        : `${adminUser.displayName} (Host)`;
    const requestedHostWalletId =
      typeof req.body?.hostWalletId === "string" && req.body.hostWalletId.trim().length > 0
        ? req.body.hostWalletId.trim()
        : `admin-host-${hallId}-${Date.now().toString(36)}`;
    const { roomCode, playerId } = enforceSingleCandyGlobalRoom
      ? await createCanonicalCandyRoom({
          hallId,
          playerName: requestedHostName,
          walletId: requestedHostWalletId
        })
      : await engine.createRoom({
          hallId,
          playerName: requestedHostName,
          walletId: requestedHostWalletId
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

app.post("/api/admin/rooms/:roomCode/start", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
    const entryFee = parseOptionalNonNegativeNumber(req.body?.entryFee, "entryFee") ?? getRoomConfiguredEntryFee(roomCode);
    const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
    const requestedTicketsPerPlayer = parseOptionalTicketsPerPlayerInput(req.body?.ticketsPerPlayer);
    const ticketsPerPlayer =
      requestedTicketsPerPlayer ??
      Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeCandyManiaSettings.autoRoundTicketsPerPlayer);
    assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
    const beforeStartSnapshot = engine.getRoomSnapshot(roomCode);
    const armedPlayerIds = getArmedPlayerIdsForSnapshot(beforeStartSnapshot);
    const adaptivePayoutPercent = resolveAdaptivePayoutPercent(beforeStartSnapshot.hallId);
    await engine.startGame({
      roomCode,
      actorPlayerId: beforeStartSnapshot.hostPlayerId,
      entryFee,
      ticketsPerPlayer,
      payoutPercent: adaptivePayoutPercent,
      participantPlayerIds: armedPlayerIds,
      allowEmptyRound: true
    });
    clearArmedPlayers(roomCode);
    const snapshot = await emitRoomUpdate(roomCode);
    apiSuccess(res, {
      roomCode,
      snapshot
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/rooms/:roomCode/bet-arm", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
    const playerId = mustBeNonEmptyString(req.body?.playerId, "playerId");
    const shouldArm = req.body?.armed === undefined ? true : Boolean(req.body.armed);
    engine.getRoomSnapshot(roomCode);
    setPlayerBetArm(roomCode, playerId, shouldArm);
    const snapshot = await emitRoomUpdate(roomCode);
    apiSuccess(res, {
      roomCode,
      playerId,
      armed: shouldArm,
      armedPlayerIds: getArmedPlayerIdsForSnapshot(snapshot),
      snapshot
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/rooms/:roomCode/claim", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
    const playerId = mustBeNonEmptyString(req.body?.playerId, "playerId");
    const claimTypeRaw = mustBeNonEmptyString(req.body?.type, "type").toUpperCase();
    if (claimTypeRaw !== "LINE" && claimTypeRaw !== "BINGO") {
      throw new DomainError("INVALID_INPUT", "Claim type må være LINE eller BINGO.");
    }
    const claimType: ClaimType = claimTypeRaw;
    const roomSnapshot = engine.getRoomSnapshot(roomCode);
    const hasPlayer = roomSnapshot.players.some((player) => player.id === playerId);
    if (!hasPlayer) {
      throw new DomainError("PLAYER_NOT_FOUND", `Fant ikke spiller ${playerId} i rom ${roomCode}.`);
    }

    const claim = await engine.submitClaim({
      roomCode,
      playerId,
      type: claimType
    });
    const snapshot = await emitRoomUpdate(roomCode);
    apiSuccess(res, {
      roomCode,
      playerId,
      claim,
      snapshot
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/rooms/:roomCode/draw-next", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
    const snapshot = engine.getRoomSnapshot(roomCode);
    const number = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: snapshot.hostPlayerId,
      autoSettleClaims: true
    });
    const updatedSnapshot = await emitRoomUpdate(roomCode);
    apiSuccess(res, {
      roomCode,
      number,
      snapshot: updatedSnapshot
    });
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/rooms/:roomCode/end", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "ROOM_CONTROL_WRITE");
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
    const beforeEndSnapshot = engine.getRoomSnapshot(roomCode);
    await engine.endGame({
      roomCode,
      actorPlayerId: beforeEndSnapshot.hostPlayerId,
      reason: typeof req.body?.reason === "string" ? req.body.reason : "Manual end from admin"
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
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
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
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = engine.clearTimedPause(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = engine.setSelfExclusion(walletId);
    apiSuccess(res, compliance);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.delete("/api/admin/wallets/:walletId/self-exclusion", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "WALLET_COMPLIANCE_WRITE");
    const walletId = mustBeNonEmptyString(req.params.walletId, "walletId");
    const compliance = engine.clearSelfExclusion(walletId);
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

app.get("/api/admin/candy-mania/rtp-near-miss", async (req, res) => {
  try {
    await requireAdminPermissionUser(req, "PAYOUT_AUDIT_READ");
    const hallId =
      typeof req.query.hallId === "string" && req.query.hallId.trim().length > 0
        ? req.query.hallId.trim()
        : undefined;
    const windowSize = parseOptionalPositiveInteger(req.query.windowSize, "windowSize");
    const includeRecentRounds = parseBooleanQueryValue(req.query.includeRecentRounds, true);
    const telemetry = engine.getRtpNearMissTelemetry({
      hallId,
      windowSize
    });

    if (includeRecentRounds) {
      apiSuccess(res, telemetry);
      return;
    }

    const { recentRounds, ...summary } = telemetry;
    apiSuccess(res, {
      ...summary,
      recentRoundsCount: recentRounds.length
    });
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
    const entry = engine.recordAccountingEvent({
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
    const report = engine.runDailyReportJob({
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
    const rooms = engine.listRoomSummaries();
    if (!enforceSingleCandyGlobalRoom) {
      apiSuccess(res, rooms);
      return;
    }

    const canonicalRoom = getCanonicalCandyRoom(rooms);
    apiSuccess(res, canonicalRoom ? [canonicalRoom] : []);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.get("/api/rooms/:roomCode", (req, res) => {
  try {
    const requestedRoomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    const roomCode = resolveCanonicalRoomCodeOrThrow(requestedRoomCode);
    const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
    apiSuccess(res, snapshot);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/rooms/:roomCode/game/end", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
    const actorPlayerId = mustBeNonEmptyString(req.body?.actorPlayerId, "actorPlayerId");
    assertUserCanActAsPlayer(user, roomCode, actorPlayerId);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    await engine.endGame({ roomCode, actorPlayerId, reason });
    const snapshot = await emitRoomUpdate(roomCode, actorPlayerId);
    apiSuccess(res, snapshot);
  } catch (error) {
    apiFailure(res, error);
  }
});

app.post("/api/rooms/:roomCode/game/extra-draw", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
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

app.post("/api/rooms/:roomCode/bet-arm", async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const roomCode = mustBeNonEmptyString(req.params.roomCode, "roomCode").toUpperCase();
    assertCanonicalCandyRoomForGameplay(roomCode);
    const actorPlayerId = mustBeNonEmptyString(req.body?.actorPlayerId, "actorPlayerId");
    assertUserCanActAsPlayer(user, roomCode, actorPlayerId);
    const shouldArm = req.body?.armed === undefined ? true : Boolean(req.body.armed);
    setPlayerBetArm(roomCode, actorPlayerId, shouldArm);
    const snapshot = await emitRoomUpdate(roomCode, actorPlayerId);
    apiSuccess(res, {
      armed: shouldArm,
      armedPlayerIds: getArmedPlayerIdsForSnapshot(snapshot),
      snapshot
    });
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
  // Per-socket rate limiter: max events per sliding window
  const RATE_LIMIT_WINDOW_MS = 2000;
  const RATE_LIMIT_MAX_EVENTS = 10;
  const socketEventTimestamps: number[] = [];

  function checkSocketRateLimit(): boolean {
    const now = Date.now();
    // Remove timestamps outside window
    while (socketEventTimestamps.length > 0 && socketEventTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
      socketEventTimestamps.shift();
    }
    if (socketEventTimestamps.length >= RATE_LIMIT_MAX_EVENTS) {
      return false;
    }
    socketEventTimestamps.push(now);
    return true;
  }

  // Wrap socket.on to inject rate limiting on player-action events
  const originalOn = socket.on.bind(socket);
  const rateLimitedEvents = new Set([
    "bet:arm", "claim:submit", "ticket:reroll", "room:configure",
    "draw:next", "draw:extra:purchase", "ticket:mark",
  ]);
  socket.on = ((event: string, handler: (...args: unknown[]) => void) => {
    if (rateLimitedEvents.has(event)) {
      return originalOn(event, (...args: unknown[]) => {
        if (!checkSocketRateLimit()) {
          const callback = args[args.length - 1];
          if (typeof callback === "function") {
            (callback as (r: unknown) => void)({
              ok: false,
              error: { code: "RATE_LIMITED", message: "For mange forespørsler. Vent litt." },
            });
          }
          return;
        }
        handler(...args);
      });
    }
    return originalOn(event, handler);
  }) as typeof socket.on;

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
      if (enforceSingleCandyGlobalRoom) {
        const canonicalRoom = getCanonicalCandyRoom();
        if (canonicalRoom) {
          const canonicalSnapshot = engine.getRoomSnapshot(canonicalRoom.code);
          const existingPlayer = findPlayerInRoomByWallet(canonicalSnapshot, identity.walletId);

          let playerId = existingPlayer?.id ?? "";
          if (existingPlayer) {
            engine.attachPlayerSocket(canonicalRoom.code, existingPlayer.id, socket.id);
            await ensurePlayerHasVisiblePreRoundTickets(canonicalRoom.code, existingPlayer.id);
          } else {
            const joined = await engine.joinRoom({
              roomCode: canonicalRoom.code,
              hallId: canonicalRoom.hallId,
              playerName: identity.playerName,
              walletId: identity.walletId,
              socketId: socket.id
            });
            playerId = joined.playerId;
            await ensurePlayerHasVisiblePreRoundTickets(canonicalRoom.code, playerId);
          }

          socket.join(canonicalRoom.code);
          const snapshot = await emitRoomUpdate(canonicalRoom.code, playerId);
          ackSuccess(callback, { roomCode: canonicalRoom.code, playerId, snapshot });
          logCandyRealtimeEvent("room_create_ack", {
            mode: "canonical-room-reuse",
            roomCode: canonicalRoom.code,
            playerId,
            hallId: canonicalRoom.hallId,
            walletId: identity.walletId,
            ...extractSchedulerTelemetry(snapshot)
          });
          return;
        }
      }

      const { roomCode, playerId } = enforceSingleCandyGlobalRoom
        ? await createCanonicalCandyRoom({
            playerName: identity.playerName,
            hallId: identity.hallId,
            walletId: identity.walletId,
            socketId: socket.id
          })
        : await engine.createRoom({
            playerName: identity.playerName,
            hallId: identity.hallId,
            walletId: identity.walletId,
            socketId: socket.id
          });
      await ensurePlayerHasVisiblePreRoundTickets(roomCode, playerId);
      socket.join(roomCode);
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      ackSuccess(callback, { roomCode, playerId, snapshot });
      logCandyRealtimeEvent("room_create_ack", {
        mode: "new-room",
        roomCode,
        playerId,
        hallId: identity.hallId,
        walletId: identity.walletId,
        ...extractSchedulerTelemetry(snapshot)
      });
    } catch (error) {
      const publicError = toPublicError(error);
      logCandyRealtimeEvent("room_create_failed", {
        code: publicError.code,
        message: publicError.message
      });
      ackFailure(callback, error);
    }
  });

  socket.on("room:join", async (payload: JoinRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
    try {
      const identity = await resolveIdentityFromPayload(payload);
      const requestedRoomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();

      let roomCode = requestedRoomCode;
      if (enforceSingleCandyGlobalRoom) {
        const canonicalRoom = getCanonicalCandyRoom();
        if (!canonicalRoom) {
          const created = await createCanonicalCandyRoom({
            playerName: identity.playerName,
            hallId: identity.hallId,
            walletId: identity.walletId,
            socketId: socket.id
          });
          roomCode = created.roomCode;
          await ensurePlayerHasVisiblePreRoundTickets(roomCode, created.playerId);
          socket.join(roomCode);
          const snapshot = await emitRoomUpdate(roomCode, created.playerId);
          ackSuccess(callback, { roomCode, playerId: created.playerId, snapshot });
          logCandyRealtimeEvent("room_join_ack", {
            mode: "canonical-room-created-on-join",
            roomCode,
            playerId: created.playerId,
            hallId: identity.hallId,
            walletId: identity.walletId,
            ...extractSchedulerTelemetry(snapshot)
          });
          return;
        }
        roomCode = canonicalRoom.code;
      }

      const roomSnapshot = engine.getRoomSnapshot(roomCode);
      const existingPlayer = findPlayerInRoomByWallet(roomSnapshot, identity.walletId);
      if (existingPlayer) {
        engine.attachPlayerSocket(roomCode, existingPlayer.id, socket.id);
        await ensurePlayerHasVisiblePreRoundTickets(roomCode, existingPlayer.id);
        socket.join(roomCode);
        const snapshot = await emitRoomUpdate(roomCode, existingPlayer.id);
        ackSuccess(callback, { roomCode, playerId: existingPlayer.id, snapshot });
        logCandyRealtimeEvent("room_join_ack", {
          mode: "existing-player-reconnect",
          roomCode,
          playerId: existingPlayer.id,
          hallId: identity.hallId,
          walletId: identity.walletId,
          ...extractSchedulerTelemetry(snapshot)
        });
        return;
      }

      const { playerId } = await engine.joinRoom({
        roomCode,
        hallId: roomSnapshot.hallId,
        playerName: identity.playerName,
        walletId: identity.walletId,
        socketId: socket.id
      });
      await ensurePlayerHasVisiblePreRoundTickets(roomCode, playerId);
      socket.join(roomCode);
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      ackSuccess(callback, { roomCode, playerId, snapshot });
      logCandyRealtimeEvent("room_join_ack", {
        mode: "join-room",
        roomCode,
        playerId,
        hallId: roomSnapshot.hallId,
        walletId: identity.walletId,
        ...extractSchedulerTelemetry(snapshot)
      });
    } catch (error) {
      const publicError = toPublicError(error);
      logCandyRealtimeEvent("room_join_failed", {
        code: publicError.code,
        message: publicError.message
      });
      ackFailure(callback, error);
    }
  });

  socket.on("room:resume", async (payload: ResumeRoomPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      assertCanonicalCandyRoomForGameplay(roomCode);
      engine.attachPlayerSocket(roomCode, playerId, socket.id);
      await ensurePlayerHasVisiblePreRoundTickets(roomCode, playerId);
      socket.join(roomCode);
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      ackSuccess(callback, { snapshot });
      logCandyRealtimeEvent("room_resume_ack", {
        roomCode,
        playerId,
        ...extractSchedulerTelemetry(snapshot)
      });
    } catch (error) {
      const publicError = toPublicError(error);
      logCandyRealtimeEvent("room_resume_failed", {
        code: publicError.code,
        message: publicError.message
      });
      ackFailure(callback, error);
    }
  });

  socket.on(
    "room:configure",
    async (
      payload: ConfigureRoomPayload,
      callback: (response: AckResponse<{ snapshot: RoomSnapshot; entryFee: number }>) => void
    ) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        assertCanonicalCandyRoomForGameplay(roomCode);
        engine.getRoomSnapshot(roomCode);

        const requestedEntryFee = parseOptionalNonNegativeNumber(payload?.entryFee, "entryFee");
        if (requestedEntryFee === undefined) {
          throw new DomainError("INVALID_INPUT", "entryFee må oppgis.");
        }

        const entryFee = setRoomConfiguredEntryFee(roomCode, requestedEntryFee);
        const updatedSnapshot = await emitRoomUpdate(roomCode, playerId);
        ackSuccess(callback, { snapshot: updatedSnapshot, entryFee });
      } catch (error) {
        ackFailure(callback, error);
      }
    }
  );

  socket.on(
    "bet:arm",
    async (
      payload: BetArmPayload,
      callback: (response: AckResponse<{ snapshot: RoomSnapshot; armed: boolean; armedPlayerIds: string[] }>) => void
    ) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        assertCanonicalCandyRoomForGameplay(roomCode);
        const shouldArm = payload?.armed === undefined ? true : Boolean(payload.armed);
        setPlayerBetArm(roomCode, playerId, shouldArm);
        const snapshot = await emitRoomUpdate(roomCode, playerId);
        const armedPlayerIds = getArmedPlayerIdsForSnapshot(snapshot);
        ackSuccess(callback, { snapshot, armed: shouldArm, armedPlayerIds });
      } catch (error) {
        ackFailure(callback, error);
      }
    }
  );

  socket.on("game:start", async (payload: StartGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      assertCanonicalCandyRoomForGameplay(roomCode);
      const requestedTicketsPerPlayer =
        payload?.ticketsPerPlayer === undefined || payload?.ticketsPerPlayer === null
          ? undefined
          : parseTicketsPerPlayerInput(payload.ticketsPerPlayer);
      const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
      const ticketsPerPlayer =
        requestedTicketsPerPlayer ??
        Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeCandyManiaSettings.autoRoundTicketsPerPlayer);
      assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
      const roomSnapshotForPayout = engine.getRoomSnapshot(roomCode);
      const armedPlayerIds = getArmedPlayerIdsForSnapshot(roomSnapshotForPayout);
      const adaptivePayoutPercent = resolveAdaptivePayoutPercent(roomSnapshotForPayout.hallId);
      await engine.startGame({
        roomCode,
        actorPlayerId: playerId,
        entryFee: payload?.entryFee ?? getRoomConfiguredEntryFee(roomCode),
        ticketsPerPlayer,
        payoutPercent: adaptivePayoutPercent,
        participantPlayerIds: armedPlayerIds,
        allowEmptyRound: true
      });
      clearArmedPlayers(roomCode);
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("game:end", async (payload: EndGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      assertCanonicalCandyRoomForGameplay(roomCode);
      await engine.endGame({
        roomCode,
        actorPlayerId: playerId,
        reason: payload?.reason
      });
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("draw:next", async (payload: RoomActionPayload, callback: (response: AckResponse<{ number: number; snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      assertCanonicalCandyRoomForGameplay(roomCode);
      const number = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: playerId,
        autoSettleClaims: true
      });
      io.to(roomCode).emit("draw:new", { number });
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      ackSuccess(callback, { number, snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("draw:extra:purchase", async (payload: ExtraDrawPayload, callback: (response: AckResponse<{ denied: true }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      assertCanonicalCandyRoomForGameplay(roomCode);
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
      assertCanonicalCandyRoomForGameplay(roomCode);
      if (!Number.isFinite(payload?.number)) {
        throw new DomainError("INVALID_INPUT", "number mangler.");
      }
      await engine.markNumber({
        roomCode,
        playerId,
        number: Number(payload.number)
      });
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on(
    "ticket:reroll",
    async (
      payload: TicketRerollPayload,
      callback: (response: AckResponse<{
        snapshot: RoomSnapshot;
        ticketsPerPlayer: number;
        ticketCount: number;
        rerolledTicketIndexes: number[];
      }>) => void
    ) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        assertCanonicalCandyRoomForGameplay(roomCode);

        const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
        const requestedTicketsPerPlayer =
          payload?.ticketsPerPlayer === undefined || payload?.ticketsPerPlayer === null
            ? undefined
            : parseTicketsPerPlayerInput(payload.ticketsPerPlayer);
        const ticketsPerPlayer =
          requestedTicketsPerPlayer ??
          Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeCandyManiaSettings.autoRoundTicketsPerPlayer);
        assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);

        const rerollResult = await engine.rerollTicketsForPlayer({
          roomCode,
          playerId,
          ticketsPerPlayer,
          ticketIndex:
            payload?.ticketIndex === undefined || payload?.ticketIndex === null
              ? undefined
              : Math.trunc(Number(payload.ticketIndex))
        });
        const snapshot = await emitRoomUpdate(roomCode, playerId);
        ackSuccess(callback, {
          snapshot,
          ticketsPerPlayer,
          ticketCount: rerollResult.tickets.length,
          rerolledTicketIndexes: rerollResult.rerolledTicketIndexes
        });
      } catch (error) {
        ackFailure(callback, error);
      }
    }
  );

  socket.on("claim:submit", async (payload: ClaimPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      assertCanonicalCandyRoomForGameplay(roomCode);
      if (payload?.type !== "LINE" && payload?.type !== "BINGO") {
        throw new DomainError("INVALID_INPUT", "type må være LINE eller BINGO.");
      }
      // Serialize claims per room to prevent double LINE payouts from concurrent requests
      await withRoomClaimLock(roomCode, async () => {
        await engine.submitClaim({
          roomCode,
          playerId,
          type: payload.type
        });
      });
      const snapshot = await emitRoomUpdate(roomCode, playerId);
      checkpointGame(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  });

  socket.on("room:state", async (payload: RoomStatePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const user = await getAuthenticatedSocketUser(payload);
      const requestedRoomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();
      const roomCode = resolveCanonicalRoomCodeOrThrow(requestedRoomCode);
      assertUserCanAccessRoom(user, roomCode);

      const roomSnapshot = engine.getRoomSnapshot(roomCode);
      const existingPlayer = findPlayerInRoomByWallet(roomSnapshot, user.walletId);
      const snapshot = existingPlayer
        ? await buildRoomUpdatePayloadForPlayer(roomCode, existingPlayer.id)
        : buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
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
  if (_req.path === "/admin" || _req.path === "/admin/") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    res.sendFile(adminFrontendFile);
    return;
  }
  if (
    hasCandyWebFrontend &&
    (_req.path === "/candy" || _req.path === "/candy/" || _req.path.startsWith("/candy/"))
  ) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    res.sendFile(candyFrontendIndexFile);
    return;
  }
  res.sendFile(frontendIndexFile);
});

// ---------------------------------------------------------------------------
// Global error handlers — prevent silent crashes in a 24/7 system
// ---------------------------------------------------------------------------
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception — prosessen fortsetter, men tilstanden kan være korrupt:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

const PORT = Number(process.env.PORT ?? 4000);
async function restoreGameStateFromCheckpoints(): Promise<void> {
  try {
    await gameCheckpointStore.ensureSchema();
    const runningGames = await gameCheckpointStore.loadRunningGameCheckpoints();
    if (runningGames.length === 0) {
      console.log("[checkpoint] No running games to restore.");
      return;
    }
    for (const game of runningGames) {
      console.log(
        `[checkpoint] Restoring game ${game.gameId} in room ${game.roomCode} ` +
        `(${game.drawnNumbers.length} draws, ${game.claims.length} claims)`
      );
      try {
        engine.restoreGameFromCheckpoint({
          roomCode: game.roomCode,
          hallId: game.hallId,
          hostPlayerId: game.hostPlayerId,
          gameId: game.gameId,
          entryFee: game.entryFee,
          ticketsPerPlayer: game.ticketsPerPlayer,
          payoutPercent: game.payoutPercent,
          drawnNumbers: game.drawnNumbers,
          drawBag: game.drawBag,
          players: game.players,
          tickets: game.tickets,
          claims: game.claims,
          lineWinnerId: game.lineWinnerId,
          bingoWinnerId: game.bingoWinnerId,
          startedAt: game.startedAt,
        });
        setNextRoundForRoom(game.roomCode, Date.now());
        console.log(`[checkpoint] Restored game ${game.gameId} successfully.`);
      } catch (err) {
        console.error(`[checkpoint] Failed to restore game ${game.gameId}:`, err);
      }
    }
    // Cleanup old ended games
    const cleaned = await gameCheckpointStore.cleanupEndedGames(24);
    if (cleaned > 0) {
      console.log(`[checkpoint] Cleaned up ${cleaned} ended game checkpoints.`);
    }
  } catch (error) {
    console.error("[checkpoint] Failed to restore game state:", error);
  }
}

hydrateCandyManiaSettingsFromCatalog()
  .catch((error) => {
    console.warn("[candy-mania] Oppstart med env/default settings pga last-feil.", error);
  })
  .then(() => restoreGameStateFromCheckpoints())
  .catch((error) => {
    console.error("[checkpoint] Restore feilet, fortsetter uten:", error);
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Bingo backend kjører på http://localhost:${PORT}`);
      console.log(
        `[compliance] minRoundInterval=${bingoMinRoundIntervalMs}ms minPlayersToStart=${bingoMinPlayersToStart} maxDrawsPerRound=${bingoMaxDrawsPerRound} dailyLoss=${bingoDailyLossLimit} monthlyLoss=${bingoMonthlyLossLimit} playSessionLimit=${bingoPlaySessionLimitMs}ms pauseDuration=${bingoPauseDurationMs}ms selfExclusionMin=${bingoSelfExclusionMinMs}ms`
      );
      console.log(
        `[rtp] rollingWindow=${bingoRtpRollingWindowSize} controllerGain=${bingoRtpControllerGain} nearMissBias=${bingoNearMissBiasEnabled} nearMissTargetRate=${bingoNearMissTargetRate} nearMissCalibrationFactor=${bingoNearMissCalibrationFactor}`
      );
      console.log(
        `[candy-launch] allowProductionApiBase=${allowProductionCandyApiBaseUrl} blockedProductionHost=${candyProductionApiBaseHost}`
      );
      console.log(
        `[scheduler] autoStart=${runtimeCandyManiaSettings.autoRoundStartEnabled} autoDraw=${runtimeCandyManiaSettings.autoDrawEnabled} forceAutoStart=${forceCandyAutoStart} forceAutoDraw=${forceCandyAutoDraw} autoAllowedInProd=${allowAutoplayInProduction} singleGlobalRoom=${enforceSingleCandyGlobalRoom} interval=${runtimeCandyManiaSettings.autoRoundStartIntervalMs}ms minPlayers=${runtimeCandyManiaSettings.autoRoundMinPlayers} ticketsPerPlayer=${runtimeCandyManiaSettings.autoRoundTicketsPerPlayer} entryFee=${runtimeCandyManiaSettings.autoRoundEntryFee} payoutPercent=${runtimeCandyManiaSettings.payoutPercent}`
      );
      console.log(
        `[scheduler] autoDraw=${runtimeCandyManiaSettings.autoDrawEnabled} interval=${runtimeCandyManiaSettings.autoDrawIntervalMs}ms tick=${schedulerTickMs}ms`
      );
      ensureCanonicalCandyRoomExists("startup").catch((error) => {
        console.error("[scheduler] klarte ikke bootstrappe canonical Candy-rom ved oppstart", error);
      });
      console.log(
        `[daily-report] enabled=${dailyReportJobEnabled} interval=${dailyReportJobIntervalMs}ms lastDate=${lastDailyReportDateKey || "-"}`
      );
      console.log(`[swedbank] configured=${swedbankPayService.isConfigured()}`);
    });
  });
