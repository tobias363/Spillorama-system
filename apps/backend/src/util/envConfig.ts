/**
 * Environment configuration parser.
 * Reads all process.env vars and returns typed config objects.
 * Extracted from index.ts to reduce wiring file size.
 */
import {
  parseBooleanEnv,
  parsePositiveIntEnv,
  parseNonNegativeNumberEnv,
} from "./httpHelpers.js";
import type { BingoSchedulerSettings } from "./bingoSettings.js";

export interface BingoRuntimeConfig {
  // Compliance limits
  bingoMinRoundIntervalMs: number;
  bingoDailyLossLimit: number;
  bingoMonthlyLossLimit: number;
  bingoPlaySessionLimitMs: number;
  bingoPauseDurationMs: number;
  bingoSelfExclusionMinMs: number;
  bingoMaxDrawsPerRound: number;
  // Autoplay
  isProductionRuntime: boolean;
  bingoMinPlayersToStart: number;
  fixedAutoDrawIntervalMs: number;
  allowAutoplayInProduction: boolean;
  forceAutoStart: boolean;
  forceAutoDraw: boolean;
  enforceSingleRoomPerHall: boolean;
  autoplayAllowed: boolean;
  // Scheduler
  schedulerTickMs: number;
  runtimeBingoSettings: BingoSchedulerSettings;
  // Daily report
  dailyReportJobEnabled: boolean;
  dailyReportJobIntervalMs: number;
  // Storage
  usePostgresBingoAdapter: boolean;
  checkpointConnectionString: string;
  roomStateProvider: string;
  redisUrl: string;
  useRedisLock: boolean;
  // KYC
  kycMinAge: number;
  kycProvider: string;
  // DB
  pgSsl: boolean;
  pgSchema: string;
  sessionTtlHours: number;
}

export function loadBingoRuntimeConfig(): BingoRuntimeConfig {
  const bingoMinRoundIntervalMs = Math.max(30000, parsePositiveIntEnv(process.env.BINGO_MIN_ROUND_INTERVAL_MS, 30000));
  const bingoDailyLossLimit = parseNonNegativeNumberEnv(process.env.BINGO_DAILY_LOSS_LIMIT, 900);
  const bingoMonthlyLossLimit = parseNonNegativeNumberEnv(process.env.BINGO_MONTHLY_LOSS_LIMIT, 4400);
  const bingoPlaySessionLimitMs = parsePositiveIntEnv(process.env.BINGO_PLAY_SESSION_LIMIT_MS, 60 * 60 * 1000);
  const bingoPauseDurationMs = parsePositiveIntEnv(process.env.BINGO_PAUSE_DURATION_MS, 5 * 60 * 1000);
  const bingoSelfExclusionMinMs = Math.max(365 * 24 * 60 * 60 * 1000, parsePositiveIntEnv(process.env.BINGO_SELF_EXCLUSION_MIN_MS, 365 * 24 * 60 * 60 * 1000));
  // BIN-520: upper bound raised from 60 → 75. Databingo 75-ball needs up to 75
  // draws for a guaranteed BINGO; with the old clamp, long rounds could hang
  // at draw #60 before any player reached a full-card claim.
  const bingoMaxDrawsPerRound = Math.min(75, Math.max(1, parsePositiveIntEnv(process.env.BINGO_MAX_DRAWS_PER_ROUND, 30)));
  const isProductionRuntime = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const bingoMinPlayersToStart = 1;
  const fixedAutoDrawIntervalMs = 2000;
  // BIN-47: Default to false in production — autoplay must be explicitly enabled
  const allowAutoplayInProduction = parseBooleanEnv(process.env.BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION, false);
  const forceAutoStart = false;
  const forceAutoDraw = false;
  const enforceSingleRoomPerHall = parseBooleanEnv(process.env.BINGO_SINGLE_ACTIVE_ROOM_PER_HALL, true);
  const autoplayAllowed = !isProductionRuntime || allowAutoplayInProduction;
  const requestedAutoRoundStartEnabled = parseBooleanEnv(process.env.AUTO_ROUND_START_ENABLED, true);
  const requestedAutoDrawEnabled = parseBooleanEnv(process.env.AUTO_DRAW_ENABLED, true);

  if (isProductionRuntime && !allowAutoplayInProduction && requestedAutoRoundStartEnabled) {
    console.warn("WARNING: AUTO_ROUND_START_ENABLED=true ignored in production. Set BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true to override.");
  }
  if (isProductionRuntime && !autoplayAllowed && (requestedAutoRoundStartEnabled || requestedAutoDrawEnabled)) {
    console.warn("[scheduler] Autoplay er deaktivert i production (sett BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true for aa tillate AUTO_ROUND_START_ENABLED/AUTO_DRAW_ENABLED).");
  }

  const runtimeBingoSettings: BingoSchedulerSettings = {
    autoRoundStartEnabled: forceAutoStart ? true : autoplayAllowed ? requestedAutoRoundStartEnabled : false,
    autoRoundStartIntervalMs: Math.max(bingoMinRoundIntervalMs, parsePositiveIntEnv(process.env.AUTO_ROUND_START_INTERVAL_MS, 3 * 60 * 1000)),
    autoRoundEntryFee: parseNonNegativeNumberEnv(process.env.AUTO_ROUND_ENTRY_FEE, 0),
    autoRoundMinPlayers: Math.max(bingoMinPlayersToStart, parsePositiveIntEnv(process.env.AUTO_ROUND_MIN_PLAYERS, bingoMinPlayersToStart)),
    autoRoundTicketsPerPlayer: Math.min(30, Math.max(1, parsePositiveIntEnv(process.env.AUTO_ROUND_TICKETS_PER_PLAYER, 4))),
    payoutPercent: Math.round(Math.min(100, Math.max(0, parseNonNegativeNumberEnv(process.env.BINGO_PAYOUT_PERCENT, 80))) * 100) / 100,
    autoDrawEnabled: forceAutoDraw ? true : autoplayAllowed ? requestedAutoDrawEnabled : false,
    autoDrawIntervalMs: fixedAutoDrawIntervalMs
  };

  const schedulerTickMs = parsePositiveIntEnv(process.env.AUTO_ROUND_SCHEDULER_TICK_MS, 250);
  const dailyReportJobEnabled = parseBooleanEnv(process.env.DAILY_REPORT_JOB_ENABLED, true);
  const dailyReportJobIntervalMs = Math.max(60_000, parsePositiveIntEnv(process.env.DAILY_REPORT_JOB_INTERVAL_MS, 60 * 60 * 1000));

  // BIN-159/BIN-240: PostgreSQL checkpointing
  const checkpointConnectionString = process.env.APP_PG_CONNECTION_STRING?.trim() || process.env.WALLET_PG_CONNECTION_STRING?.trim() || "";
  const usePostgresBingoAdapter = parseBooleanEnv(process.env.BINGO_CHECKPOINT_ENABLED, true) && checkpointConnectionString.length > 0;
  if (usePostgresBingoAdapter) {
    console.log("[BIN-159] Game state checkpointing enabled (PostgreSQL)");
  } else {
    const reason = !checkpointConnectionString ? "No database connection string configured" : "BINGO_CHECKPOINT_ENABLED is explicitly set to false";
    console.warn(`[CHECKPOINT] WARNING: Game checkpointing is DISABLED. Reason: ${reason}.`);
    if (process.env.NODE_ENV === "production") console.error("[CHECKPOINT] CRITICAL: Running production WITHOUT checkpointing.");
  }

  // BIN-170/171: Room state store and scheduler lock provider
  const roomStateProvider = process.env.ROOM_STATE_PROVIDER?.trim().toLowerCase() ?? "memory";
  const redisUrl = process.env.REDIS_URL?.trim() || "redis://localhost:6379";
  const useRedisLock = process.env.SCHEDULER_LOCK_PROVIDER?.trim().toLowerCase() === "redis";
  if (roomStateProvider === "redis") console.log("[BIN-170] Room state store: Redis");
  if (useRedisLock) console.log("[BIN-171] Scheduler lock: Redis (distributed)");

  // BIN-274: Configurable KYC provider
  const kycMinAge = Math.max(18, parsePositiveIntEnv(process.env.KYC_MIN_AGE_YEARS, 18));
  const kycProvider = process.env.KYC_PROVIDER?.trim().toLowerCase() ?? "local";

  // PostgreSQL
  const pgSsl = parseBooleanEnv(process.env.WALLET_PG_SSL, false);
  const pgSchema = process.env.APP_PG_SCHEMA?.trim() || process.env.WALLET_PG_SCHEMA?.trim() || "public";
  const sessionTtlHours = parsePositiveIntEnv(process.env.AUTH_SESSION_TTL_HOURS, 24 * 7);

  return {
    bingoMinRoundIntervalMs, bingoDailyLossLimit, bingoMonthlyLossLimit, bingoPlaySessionLimitMs,
    bingoPauseDurationMs, bingoSelfExclusionMinMs, bingoMaxDrawsPerRound,
    isProductionRuntime, bingoMinPlayersToStart, fixedAutoDrawIntervalMs,
    allowAutoplayInProduction, forceAutoStart, forceAutoDraw, enforceSingleRoomPerHall,
    autoplayAllowed, schedulerTickMs, runtimeBingoSettings,
    dailyReportJobEnabled, dailyReportJobIntervalMs,
    usePostgresBingoAdapter, checkpointConnectionString,
    roomStateProvider, redisUrl, useRedisLock, kycMinAge, kycProvider,
    pgSsl, pgSchema, sessionTtlHours,
  };
}
