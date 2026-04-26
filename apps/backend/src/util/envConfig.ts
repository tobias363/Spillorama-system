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
  /**
   * Råverdien fra `AUTO_DRAW_INTERVAL_MS` env-var hvis spesifikt satt — ellers
   * `null`. Skiller "default 2000" fra "eksplisitt satt 2000" så Spill 1
   * kan velge å override per-game ticket_config kun når env-var er satt.
   */
  autoDrawIntervalEnvOverrideMs: number | null;
  allowAutoplayInProduction: boolean;
  forceAutoStart: boolean;
  forceAutoDraw: boolean;
  enforceSingleRoomPerHall: boolean;
  autoplayAllowed: boolean;
  /**
   * Bug 1 (live-rounds-independent-of-bet): når `true`, starter
   * autoplay-runder så snart `playerCount >= autoRoundMinPlayers` —
   * uavhengig av hvor mange som har armed brett. Spillere som ikke
   * har kjøpt brett kan ikke vinne (compliance), men trekninger
   * (ball-strøm) kjører for "publikum" så folk kan sitte i hallen
   * og se mellom-runder.
   *
   * Default: `true` (matcher hardkoded `liveRoundsIndependentOfBet`
   * i `roomHelpers.ts` som også returneres til klienten i
   * `room:update`-payloaden).
   *
   * Sett `BINGO_LIVE_ROUNDS_INDEPENDENT_OF_BET=false` for legacy-
   * oppførsel hvor scheduler venter på minst én armed spiller før
   * den starter en runde.
   */
  liveRoundsIndependentOfBet: boolean;
  // Scheduler
  schedulerTickMs: number;
  runtimeBingoSettings: BingoSchedulerSettings;
  // Daily report
  dailyReportJobEnabled: boolean;
  dailyReportJobIntervalMs: number;
  // BIN-582: legacy-cron ports (master + per-job toggles)
  jobsEnabled: boolean;
  jobSwedbankEnabled: boolean;
  jobSwedbankIntervalMs: number;
  jobBankIdEnabled: boolean;
  jobBankIdIntervalMs: number;
  jobBankIdRunAtHour: number;
  jobRgCleanupEnabled: boolean;
  jobRgCleanupIntervalMs: number;
  jobRgCleanupRunAtHour: number;
  // BIN-582: Metronia/OK Bingo machine-ticket auto-close (legacy 00:00-cron)
  jobMachineAutoCloseEnabled: boolean;
  jobMachineAutoCloseIntervalMs: number;
  jobMachineAutoCloseRunAtHour: number;
  jobMachineAutoCloseMaxAgeHours: number;
  // BIN-700: loyalty monthly reset
  jobLoyaltyMonthlyResetEnabled: boolean;
  jobLoyaltyMonthlyResetIntervalMs: number;
  // GAME1_SCHEDULE PR 1: auto-scheduler-tick for Game 1
  jobGame1ScheduleTickEnabled: boolean;
  jobGame1ScheduleTickIntervalMs: number;
  // GAME1_SCHEDULE PR 4c: auto-draw-tick for Game 1 (fixed seconds-intervall)
  jobGame1AutoDrawEnabled: boolean;
  jobGame1AutoDrawIntervalMs: number;
  // Task 1.6: master-transfer expiry tick (60s TTL håndheving)
  jobGame1TransferExpiryTickEnabled: boolean;
  jobGame1TransferExpiryTickIntervalMs: number;
  // BIN-FCM: FCM push-notification cron (legacy sendGameStartNotifications)
  jobGameStartNotificationsEnabled: boolean;
  jobGameStartNotificationsIntervalMs: number;
  // Withdraw XML-eksport-cron (wireframe 16.20). Daglig batch av
  // ACCEPTED bank-uttak per agent.
  jobXmlExportDailyEnabled: boolean;
  jobXmlExportDailyIntervalMs: number;
  jobXmlExportDailyRunAtHour: number;
  // MASTER_PLAN §2.3 — daglig jackpot-akkumulering (Appendix B.9).
  // 00:15 lokal tid per PM-spec (unngår midnatt-race med andre daglige jobs).
  jobJackpotDailyEnabled: boolean;
  jobJackpotDailyIntervalMs: number;
  jobJackpotDailyRunAtHour: number;
  jobJackpotDailyRunAtMinute: number;
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
  // BIN-585 PR D: hall-display screensaver config
  screensaverConfig: { enabled: boolean; timeoutMs: number; imageRotationMs: number };
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
  // Default raised to 75 so Game 1 works out of the box without env config —
  // Game 2/3's 60-ball draw bag stops naturally at 60 and ignores the ceiling.
  const bingoMaxDrawsPerRound = Math.min(75, Math.max(1, parsePositiveIntEnv(process.env.BINGO_MAX_DRAWS_PER_ROUND, 75)));
  const isProductionRuntime = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const bingoMinPlayersToStart = 1;
  // AUTO_DRAW_INTERVAL_MS: global override for Bingo-rooms (Spill 2/3) +
  // Spill 1-default. Tidligere hardkodet til 2000ms, noe som gjorde at
  // env-vars som Tobias satte i Render ikke fikk effekt. Default 2000 ms;
  // floor 500 ms for å hindre absurd lave verdier.
  //
  // `autoDrawIntervalEnvOverrideMs` er null når env-var IKKE er satt eller
  // er ugyldig — slik at vi kan skille "default" fra "eksplisitt satt" og
  // kun overstyre Spill 1 per-game ticket_config_json.timing.seconds når
  // ops faktisk har valgt en verdi.
  const rawAutoDrawIntervalEnv = (process.env.AUTO_DRAW_INTERVAL_MS ?? "").trim();
  const parsedAutoDrawIntervalEnv =
    rawAutoDrawIntervalEnv.length > 0
      ? Number.parseInt(rawAutoDrawIntervalEnv, 10)
      : Number.NaN;
  const autoDrawIntervalEnvOverrideMs =
    Number.isFinite(parsedAutoDrawIntervalEnv) && parsedAutoDrawIntervalEnv >= 500
      ? parsedAutoDrawIntervalEnv
      : null;
  const fixedAutoDrawIntervalMs = autoDrawIntervalEnvOverrideMs ?? 2000;
  // BIN-47: Default to false in production — autoplay must be explicitly enabled
  const allowAutoplayInProduction = parseBooleanEnv(process.env.BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION, false);
  const forceAutoStart = false;
  const forceAutoDraw = false;
  const enforceSingleRoomPerHall = parseBooleanEnv(process.env.BINGO_SINGLE_ACTIVE_ROOM_PER_HALL, true);
  const autoplayAllowed = !isProductionRuntime || allowAutoplayInProduction;
  // Bug 1 fix: trekninger starter uavhengig av om noen har kjøpt brett.
  // Default true (matcher dagens implementerte oppførsel: scheduler ser
  // kun på `playerCount`, ikke `armedPlayerCount`). Eksponert som env-
  // var slik at oppstartslogg viser eksplisitt status og ops kan
  // verifisere kontrakten.
  const liveRoundsIndependentOfBet = parseBooleanEnv(
    process.env.BINGO_LIVE_ROUNDS_INDEPENDENT_OF_BET,
    true,
  );
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

  // BIN-582: legacy-cron ports. Each job is individually togglable, with a
  // master `JOBS_ENABLED` kill-switch for ops. Defaults mirror legacy cadence:
  // Swedbank hourly, BankID/RG daily. Daily jobs poll at a shorter interval
  // and guard themselves via a date-key; that matches the existing
  // DailyReport pattern and avoids a hard cron dependency.
  const jobsEnabled = parseBooleanEnv(process.env.JOBS_ENABLED, true);
  const jobSwedbankEnabled = parseBooleanEnv(process.env.JOB_SWEDBANK_ENABLED, true);
  const jobSwedbankIntervalMs = Math.max(60_000, parsePositiveIntEnv(process.env.JOB_SWEDBANK_INTERVAL_MS, 60 * 60 * 1000));
  const jobBankIdEnabled = parseBooleanEnv(process.env.JOB_BANKID_ENABLED, true);
  const jobBankIdIntervalMs = Math.max(60_000, parsePositiveIntEnv(process.env.JOB_BANKID_INTERVAL_MS, 15 * 60 * 1000));
  const jobBankIdRunAtHour = Math.min(23, Math.max(0, Math.floor(parseNonNegativeNumberEnv(process.env.JOB_BANKID_RUN_AT_HOUR, 7))));
  const jobRgCleanupEnabled = parseBooleanEnv(process.env.JOB_RG_CLEANUP_ENABLED, true);
  const jobRgCleanupIntervalMs = Math.max(60_000, parsePositiveIntEnv(process.env.JOB_RG_CLEANUP_INTERVAL_MS, 15 * 60 * 1000));
  const jobRgCleanupRunAtHour = Math.min(23, Math.max(0, Math.floor(parseNonNegativeNumberEnv(process.env.JOB_RG_CLEANUP_RUN_AT_HOUR, 0))));

  // BIN-582: daglig auto-close av hengende Metronia/OK-Bingo-billetter.
  // Legacy kjørte 00:00 for å lukke alt fra forrige driftsdøgn. Bruker
  // samme polling-mønster som RG-cleanup (polling 15 min + date-key);
  // maxAgeHours=24 matcher legacy "siste driftsdøgn".
  const jobMachineAutoCloseEnabled = parseBooleanEnv(process.env.JOB_MACHINE_AUTO_CLOSE_ENABLED, true);
  const jobMachineAutoCloseIntervalMs = Math.max(60_000, parsePositiveIntEnv(process.env.JOB_MACHINE_AUTO_CLOSE_INTERVAL_MS, 15 * 60 * 1000));
  const jobMachineAutoCloseRunAtHour = Math.min(23, Math.max(0, Math.floor(parseNonNegativeNumberEnv(process.env.JOB_MACHINE_AUTO_CLOSE_RUN_AT_HOUR, 0))));
  const jobMachineAutoCloseMaxAgeHours = Math.max(1, Math.floor(parseNonNegativeNumberEnv(process.env.JOB_MACHINE_AUTO_CLOSE_MAX_AGE_HOURS, 24)));

  // BIN-700: loyalty-monthly-reset-job. Nullstiller month_points for alle
  // spillere ved månedskift. Default ON — idempotent, billig (single UPDATE).
  // Polling-intervall 1 time (nok presisjon for "kjør én gang pr måned").
  const jobLoyaltyMonthlyResetEnabled = parseBooleanEnv(process.env.JOB_LOYALTY_MONTHLY_RESET_ENABLED, true);
  const jobLoyaltyMonthlyResetIntervalMs = Math.max(60_000, parsePositiveIntEnv(process.env.JOB_LOYALTY_MONTHLY_RESET_INTERVAL_MS, 60 * 60 * 1000));

  // GAME1_SCHEDULE PR 1: auto-scheduler-tick for Game 1. Default OFF inntil
  // ready-flow + master-start (PR 2-3) er klare, så tick-en ikke spawner
  // "hengende" rader uten håndtering. Aktiveres via env-flag i staging først.
  const jobGame1ScheduleTickEnabled = parseBooleanEnv(process.env.GAME1_SCHEDULE_TICK_ENABLED, false);
  const jobGame1ScheduleTickIntervalMs = Math.max(5_000, parsePositiveIntEnv(process.env.GAME1_SCHEDULE_TICK_INTERVAL_MS, 15_000));
  // GAME1_SCHEDULE PR 4c: auto-draw-tick — default OFF til PR 4d socket-flyt er inne.
  const jobGame1AutoDrawEnabled = parseBooleanEnv(process.env.GAME1_AUTO_DRAW_ENABLED, false);
  // Minimum 500 ms — auto-draw trigges hvert `seconds`-felt fra ticket_config,
  // tick-intervallet bare polles. Default 1000 ms matcher "global 1s tick".
  const jobGame1AutoDrawIntervalMs = Math.max(500, parsePositiveIntEnv(process.env.GAME1_AUTO_DRAW_INTERVAL_MS, 1_000));

  // Task 1.6: transfer-expiry-tick — default ON siden 60s TTL på master-
  // transfer-requests ellers ikke håndheves. Intervall 5s er grovt nok (TTL
  // er 60s) og billig (én UPDATE per tick).
  const jobGame1TransferExpiryTickEnabled = parseBooleanEnv(
    process.env.GAME1_TRANSFER_EXPIRY_TICK_ENABLED,
    true,
  );
  const jobGame1TransferExpiryTickIntervalMs = Math.max(
    1_000,
    parsePositiveIntEnv(process.env.GAME1_TRANSFER_EXPIRY_TICK_INTERVAL_MS, 5_000),
  );

  // BIN-FCM: FCM push-notification cron for pre-game-varsler.
  // Legacy kjørte hver 1min (60s). Default ON når FIREBASE_CREDENTIALS_JSON
  // er satt — service-laget kjører i no-op-modus uten credentials, så
  // cronen spammer ikke pending-rader.
  const jobGameStartNotificationsEnabled = parseBooleanEnv(
    process.env.JOB_GAME_START_NOTIFICATIONS_ENABLED,
    true,
  );
  const jobGameStartNotificationsIntervalMs = Math.max(
    30_000,
    parsePositiveIntEnv(process.env.JOB_GAME_START_NOTIFICATIONS_INTERVAL_MS, 60_000),
  );

  // Withdraw XML-eksport daglig cron. PM-krav 2026-04-24: daglig generering
  // kl 23:00 lokal tid. Default OFF for å unngå oppstartfeil i miljøer uten
  // SMTP eller allowlist — prod må sette JOB_XML_EXPORT_DAILY_ENABLED=true.
  const jobXmlExportDailyEnabled = parseBooleanEnv(
    process.env.JOB_XML_EXPORT_DAILY_ENABLED,
    false,
  );
  // Polling-intervall (jobben selv sjekker klokkeslett + date-key).
  // Default 15 min — balansen mellom responsivitet og DB-belastning.
  const jobXmlExportDailyIntervalMs = Math.max(
    60_000,
    parsePositiveIntEnv(process.env.JOB_XML_EXPORT_DAILY_INTERVAL_MS, 15 * 60 * 1000),
  );
  const jobXmlExportDailyRunAtHour = Math.min(
    23,
    Math.max(0, parsePositiveIntEnv(process.env.JOB_XML_EXPORT_DAILY_RUN_AT_HOUR, 23)),
  );

  // MASTER_PLAN §2.3 — daglig jackpot-akkumulering (Appendix B.9). Default OFF
  // inntil PM har testet i staging. Polling 15 min, kjører faktisk work kl
  // 00:15 lokal tid (service er idempotent via last_accumulation_date).
  const jobJackpotDailyEnabled = parseBooleanEnv(
    process.env.JOB_JACKPOT_DAILY_ENABLED,
    false,
  );
  const jobJackpotDailyIntervalMs = Math.max(
    60_000,
    parsePositiveIntEnv(process.env.JOB_JACKPOT_DAILY_INTERVAL_MS, 15 * 60 * 1000),
  );
  const jobJackpotDailyRunAtHour = Math.min(
    23,
    Math.max(0, parsePositiveIntEnv(process.env.JOB_JACKPOT_DAILY_RUN_AT_HOUR, 0)),
  );
  const jobJackpotDailyRunAtMinute = Math.min(
    59,
    Math.max(0, parsePositiveIntEnv(process.env.JOB_JACKPOT_DAILY_RUN_AT_MINUTE, 15)),
  );

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

  // BIN-585 PR D: hall-display screensaver config (legacy Sys.Setting
  // replacement). Pilot defaults: 5 min idle timeout, 10 s image rotation.
  const screensaverConfig = {
    enabled: parseBooleanEnv(process.env.HALL_SCREENSAVER_ENABLED, true),
    timeoutMs: Math.max(0, parsePositiveIntEnv(process.env.HALL_SCREENSAVER_TIMEOUT_MS, 5 * 60 * 1000)),
    imageRotationMs: parsePositiveIntEnv(process.env.HALL_SCREENSAVER_IMAGE_ROTATION_MS, 10 * 1000),
  };

  return {
    bingoMinRoundIntervalMs, bingoDailyLossLimit, bingoMonthlyLossLimit, bingoPlaySessionLimitMs,
    bingoPauseDurationMs, bingoSelfExclusionMinMs, bingoMaxDrawsPerRound,
    isProductionRuntime, bingoMinPlayersToStart, fixedAutoDrawIntervalMs,
    autoDrawIntervalEnvOverrideMs,
    allowAutoplayInProduction, forceAutoStart, forceAutoDraw, enforceSingleRoomPerHall,
    autoplayAllowed, liveRoundsIndependentOfBet, schedulerTickMs, runtimeBingoSettings,
    dailyReportJobEnabled, dailyReportJobIntervalMs,
    jobsEnabled, jobSwedbankEnabled, jobSwedbankIntervalMs,
    jobBankIdEnabled, jobBankIdIntervalMs, jobBankIdRunAtHour,
    jobRgCleanupEnabled, jobRgCleanupIntervalMs, jobRgCleanupRunAtHour,
    jobMachineAutoCloseEnabled, jobMachineAutoCloseIntervalMs,
    jobMachineAutoCloseRunAtHour, jobMachineAutoCloseMaxAgeHours,
    jobLoyaltyMonthlyResetEnabled, jobLoyaltyMonthlyResetIntervalMs,
    jobGame1ScheduleTickEnabled, jobGame1ScheduleTickIntervalMs,
    jobGame1AutoDrawEnabled, jobGame1AutoDrawIntervalMs,
    jobGame1TransferExpiryTickEnabled, jobGame1TransferExpiryTickIntervalMs,
    jobGameStartNotificationsEnabled, jobGameStartNotificationsIntervalMs,
    jobXmlExportDailyEnabled, jobXmlExportDailyIntervalMs, jobXmlExportDailyRunAtHour,
    jobJackpotDailyEnabled, jobJackpotDailyIntervalMs, jobJackpotDailyRunAtHour, jobJackpotDailyRunAtMinute,
    usePostgresBingoAdapter, checkpointConnectionString,
    roomStateProvider, redisUrl, useRedisLock, kycMinAge, kycProvider,
    pgSsl, pgSchema, sessionTtlHours, screensaverConfig,
  };
}
