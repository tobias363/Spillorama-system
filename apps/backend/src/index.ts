import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { createWalletAdapter } from "./adapters/createWalletAdapter.js";
import { WalletStateNotifyingAdapter } from "./adapters/walletStateNotifyingAdapter.js";
import { createWalletStatePusher, walletRoomKey } from "./sockets/walletStatePusher.js";
import { LocalBingoSystemAdapter } from "./adapters/LocalBingoSystemAdapter.js";
import { PostgresBingoSystemAdapter } from "./adapters/PostgresBingoSystemAdapter.js";
import { LocalKycAdapter } from "./adapters/LocalKycAdapter.js";
import { BankIdKycAdapter } from "./adapters/BankIdKycAdapter.js";
import { BingoEngine } from "./game/BingoEngine.js";
import { DomainError } from "./errors/DomainError.js";
import { runRecoveryIntegrityCheck } from "./game/BingoEngineRecoveryIntegrityCheck.js";
import { Game3Engine } from "./game/Game3Engine.js";
import { PerpetualRoundService } from "./game/PerpetualRoundService.js";
import { PostgresResponsibleGamingStore } from "./game/PostgresResponsibleGamingStore.js";
import type { GameSnapshot, Player, RoomSnapshot } from "./game/types.js";
import { PlatformService } from "./platform/PlatformService.js";
import { SwedbankPayService } from "./payments/SwedbankPayService.js";
import { PaymentRequestService } from "./payments/PaymentRequestService.js";
import { HallCashWithdrawalCapService } from "./agent/HallCashWithdrawalCapService.js";
import { AuthTokenService } from "./auth/AuthTokenService.js";
import { UserPinService } from "./auth/UserPinService.js";
import { TwoFactorService } from "./auth/TwoFactorService.js";
import { SessionService } from "./auth/SessionService.js";
import { PasswordRotationService } from "./auth/PasswordRotationService.js";
import { EmailService } from "./integration/EmailService.js";
import { EmailQueue } from "./integration/EmailQueue.js";
import { SveveSmsService } from "./integration/SveveSmsService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  PostgresAuditLogStore,
  type AuditLogStore,
} from "./compliance/AuditLogService.js";
import { Spill1StopVoteService } from "./spillevett/Spill1StopVoteService.js";
import { initSharedPool } from "./util/sharedPool.js";
import { DrawScheduler } from "./draw-engine/DrawScheduler.js";
import { SocketRateLimiter } from "./middleware/socketRateLimit.js";
import { HttpRateLimiter } from "./middleware/httpRateLimit.js";
import { register as promRegister, metrics as promMetrics } from "./util/metrics.js";
import { createExternalGameWalletRouter } from "./integration/externalGameWallet.js";
import { InMemoryRoomStateStore, type RoomStateStore } from "./store/RoomStateStore.js";
import { RedisRoomStateStore } from "./store/RedisRoomStateStore.js";
import { RedisSchedulerLock } from "./store/RedisSchedulerLock.js";
import {
  apiSuccess,
  apiFailure,
  mustBeNonEmptyString,
  parseBooleanEnv,
  parsePositiveIntEnv,
} from "./util/httpHelpers.js";
import { parseBingoSettingsPatch, normalizeBingoSchedulerSettings } from "./util/bingoSettings.js";
import { getPrimaryRoomForHall, findPlayerInRoomByWallet, buildRoomUpdatePayload as buildRoomUpdatePayloadHelper, buildLeaderboard as buildLeaderboardHelper, type RoomUpdatePayload } from "./util/roomHelpers.js";
import { RoomStateManager } from "./util/roomState.js";
import {
  buildRoomLifecycleStoreSync,
  connectRoomLifecycleStore,
  shutdownRoomLifecycleStore,
} from "./util/createRoomLifecycleStore.js";
import { toDrawSchedulerSettings, createSchedulerCallbacks, createDailyReportScheduler, type PendingBingoSettingsUpdate } from "./util/schedulerSetup.js";
import { WalletReservationExpiryService } from "./wallet/WalletReservationExpiryService.js";
import { WalletOutboxRepo } from "./wallet/WalletOutboxRepo.js";
import { WalletOutboxWorker } from "./wallet/WalletOutboxWorker.js";
import { ComplianceOutboxRepo } from "./compliance/ComplianceOutboxRepo.js";
import { ComplianceOutboxWorker } from "./compliance/ComplianceOutboxWorker.js";
import { ComplianceOutboxComplianceLedgerPort } from "./compliance/ComplianceOutboxComplianceLedgerPort.js";
import { PostgresWalletAdapter } from "./adapters/PostgresWalletAdapter.js";
import { WalletAuditVerifier } from "./wallet/WalletAuditVerifier.js";
import { createWalletAuditVerifyJob } from "./jobs/walletAuditVerify.js";
import { loadBingoRuntimeConfig } from "./util/envConfig.js";
import { createJobScheduler } from "./jobs/JobScheduler.js";
import { createSwedbankPaymentSyncJob } from "./jobs/swedbankPaymentSync.js";
import { createBankIdExpiryReminderJob } from "./jobs/bankIdExpiryReminder.js";
import { createUniqueIdExpiryJob } from "./jobs/uniqueIdExpiry.js";
import { createSelfExclusionCleanupJob } from "./jobs/selfExclusionCleanup.js";
import { createProfilePendingLossLimitFlushJob } from "./jobs/profilePendingLossLimitFlush.js";
import { createMachineTicketAutoCloseJob } from "./jobs/machineTicketAutoClose.js";
import { createLoyaltyMonthlyResetJob } from "./jobs/loyaltyMonthlyReset.js";
import { createGame1ScheduleTickJob } from "./jobs/game1ScheduleTick.js";
import { Game1RecoveryService } from "./game/Game1RecoveryService.js";
import { Game1ScheduleTickService } from "./game/Game1ScheduleTickService.js";
import { Game1PayoutService } from "./game/Game1PayoutService.js";
import { Game1JackpotService } from "./game/Game1JackpotService.js";
import { Game1JackpotStateService } from "./game/Game1JackpotStateService.js";
// HV2-B4: per-hall Spill 1 prize-floor service. Wired post-construction
// inn i ScheduleService for å håndheve `subVariant.minPrize ≥ hall-default`
// ved schedule-create/update. Servicen leverer DB-backed lookup og caches
// per hall-id; ScheduleService duck-typer mot Spill1PrizeDefaultsLookup.
import { Spill1PrizeDefaultsService } from "./game/Spill1PrizeDefaultsService.js";
import { Game1AutoDrawTickService } from "./game/Game1AutoDrawTickService.js";
import { Game2AutoDrawTickService } from "./game/Game2AutoDrawTickService.js";
import { Game3AutoDrawTickService } from "./game/Game3AutoDrawTickService.js";
import { Game1TransferHallService } from "./game/Game1TransferHallService.js";
import { Game1TransferExpiryTickService } from "./game/Game1TransferExpiryTickService.js";
import { createGame1TransferExpiryTickJob } from "./jobs/game1TransferExpiryTick.js";
import { createGame1AutoDrawTickJob } from "./jobs/game1AutoDrawTick.js";
import { createGame2AutoDrawTickJob } from "./jobs/game2AutoDrawTick.js";
import { createGame3AutoDrawTickJob } from "./jobs/game3AutoDrawTick.js";
import { createJackpotDailyTickJob } from "./jobs/jackpotDailyTick.js";
import { createIdempotencyKeyCleanupJob } from "./jobs/idempotencyKeyCleanup.js";
import { FcmPushService } from "./notifications/FcmPushService.js";
import { createGameStartNotificationsJob } from "./jobs/gameStartNotifications.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createAdminNotificationsRouter } from "./routes/adminNotifications.js";
import { createAdminSmsBroadcastRouter } from "./routes/adminSmsBroadcast.js";
import { LoyaltyPointsHookAdapter } from "./adapters/LoyaltyPointsHookAdapter.js";
import { Game1HallReadyService } from "./game/Game1HallReadyService.js";
import { Game1MasterControlService } from "./game/Game1MasterControlService.js";
import { Game1TicketPurchaseService } from "./game/Game1TicketPurchaseService.js";
import { Game1DrawEngineService } from "./game/Game1DrawEngineService.js";
import { Game1PotService } from "./game/pot/Game1PotService.js";
import { Game1MiniGameOrchestrator } from "./game/minigames/Game1MiniGameOrchestrator.js";
import { MiniGameWheelEngine } from "./game/minigames/MiniGameWheelEngine.js";
import { MiniGameChestEngine } from "./game/minigames/MiniGameChestEngine.js";
import { MiniGameColordraftEngine } from "./game/minigames/MiniGameColordraftEngine.js";
import { MiniGameOddsenEngine } from "./game/minigames/MiniGameOddsenEngine.js";
import { MiniGameMysteryEngine } from "./game/minigames/MiniGameMysteryEngine.js";
import { Game1TicketPurchasePortAdapter } from "./game/Game1TicketPurchasePortAdapter.js";
import { createAdminGame1ReadyRouter } from "./routes/adminGame1Ready.js";
import { createAdminGame1MasterRouter } from "./routes/adminGame1Master.js";
import { createAdminGameReplayRouter } from "./routes/adminGameReplay.js";
import { Game1ReplayService } from "./game/Game1ReplayService.js";
import { createAgentGame1Router } from "./routes/agentGame1.js";
import { createAgentGame1MiniGameRouter } from "./routes/agentGame1MiniGame.js";
import { createAgentGame2ChooseTicketsRouter } from "./routes/agentGame2ChooseTickets.js";
import { Game2TicketPoolService } from "./game/Game2TicketPoolService.js";
import { createAdminGame1MasterTransferRouter } from "./routes/adminGame1MasterTransfer.js";
import { createGame1PurchaseRouter } from "./routes/game1Purchase.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAdminRouter } from "./routes/admin.js";
import { RoomStartPreFlightValidator } from "./game/RoomStartPreFlightValidator.js";
import { createWalletRouter } from "./routes/wallet.js";
import { createAdminWalletRouter } from "./routes/adminWallet.js";
import { createAdminWalletReconciliationRouter } from "./routes/adminWalletReconciliation.js";
import {
  WalletReconciliationService,
  createWalletReconciliationJob,
} from "./jobs/walletReconciliation.js";
import { AdminOpsService } from "./admin/AdminOpsService.js";
import {
  createAdminOpsRouter,
  type AdminOpsBroadcastKind,
} from "./routes/adminOps.js";
import { createAdminOpsEvents } from "./sockets/adminOpsEvents.js";
import { createPaymentsRouter } from "./routes/payments.js";
import { createPaymentRequestsRouter } from "./routes/paymentRequests.js";
import { createPlayersRouter } from "./routes/players.js";
import { createUserProfileRouter } from "./routes/userProfile.js";
import { createPlayerProfileImageRouter } from "./routes/playerProfileImage.js";
import { createValidateGameViewRouter } from "./routes/validateGameView.js";
import { LocalImageStorageAdapter } from "./media/ImageStorageService.js";
import { ProfileSettingsService } from "./compliance/ProfileSettingsService.js";
import { createAdminPlayersRouter } from "./routes/adminPlayers.js";
import { createAdminAmlRouter } from "./routes/adminAml.js";
import { AmlService } from "./compliance/AmlService.js";
import { createAdminSecurityRouter } from "./routes/adminSecurity.js";
import { SecurityService } from "./compliance/SecurityService.js";
import { createAdminWithdrawXmlRouter } from "./routes/adminWithdrawXml.js";
import { WithdrawXmlExportService } from "./admin/WithdrawXmlExportService.js";
import { AccountingEmailService } from "./admin/AccountingEmailService.js";
import { createXmlExportDailyTickJob } from "./jobs/xmlExportDailyTick.js";
import { createAgentRouter } from "./routes/agent.js";
import { createAdminAgentsRouter } from "./routes/adminAgents.js";
import { createAdminAgentPermissionsRouter } from "./routes/adminAgentPermissions.js";
import { AgentPermissionService } from "./platform/AgentPermissionService.js";
import { createAgentTransactionsRouter } from "./routes/agentTransactions.js";
import { createAgentDashboardRouter } from "./routes/agentDashboard.js";
import { createAgentContextRouter } from "./routes/agentContext.js";
import { createAgentSettlementRouter } from "./routes/agentSettlement.js";
import { createAdminProductsRouter } from "./routes/adminProducts.js";
import { createAgentProductsRouter } from "./routes/agentProducts.js";
import { ProductService } from "./agent/ProductService.js";
import { AgentProductSaleService } from "./agent/AgentProductSaleService.js";
import { createAgentMetroniaRouter } from "./routes/agentMetronia.js";
import { MetroniaTicketService } from "./agent/MetroniaTicketService.js";
import { PostgresMachineTicketStore } from "./agent/MachineTicketStore.js";
import { HttpMetroniaApiClient } from "./integration/metronia/HttpMetroniaApiClient.js";
import { StubMetroniaApiClient } from "./integration/metronia/StubMetroniaApiClient.js";
import type { MetroniaApiClient } from "./integration/metronia/MetroniaApiClient.js";
import { createAgentOpenDayRouter } from "./routes/agentOpenDay.js";
import { createAdminHallReportsRouter } from "./routes/adminHallReports.js";
import { createAdminGroupHallReportsRouter } from "./routes/adminGroupHallReports.js";
import { AgentOpenDayService } from "./agent/AgentOpenDayService.js";
import { HallAccountReportService } from "./compliance/HallAccountReportService.js";
import { createAgentOkBingoRouter } from "./routes/agentOkBingo.js";
import { createAgentBingoRouter } from "./routes/agentBingo.js";
import { createAgentTicketRegistrationRouter } from "./routes/agentTicketRegistration.js";
import { TicketRegistrationService } from "./agent/TicketRegistrationService.js";
// REQ-101 (PDF 17 §17.24): inline Add Physical Ticket popup-flyt fra Sub Game Details.
import { createAgentPhysicalTicketsInlineRouter } from "./routes/agentPhysicalTicketsInline.js";
import { AgentPhysicalTicketInlineService } from "./agent/AgentPhysicalTicketInlineService.js";
// REQ-146 (PDF 17 §17.23): agent-input for Spin/Chest/Mystery/ColorDraft mini-game-vinst.
import { createAgentMiniGameWinningRouter } from "./routes/agentMiniGameWinning.js";
import { AgentMiniGameWinningService } from "./agent/AgentMiniGameWinningService.js";
import { createAgentUniqueIdsRouter } from "./routes/agentUniqueIds.js";
import { UniqueIdService } from "./agent/UniqueIdService.js";
import { PostgresUniqueIdStore } from "./agent/UniqueIdStore.js";
import { OkBingoTicketService } from "./agent/OkBingoTicketService.js";
import { SqlServerOkBingoApiClient } from "./integration/okbingo/SqlServerOkBingoApiClient.js";
import { StubOkBingoApiClient } from "./integration/okbingo/StubOkBingoApiClient.js";
import type { OkBingoApiClient } from "./integration/okbingo/OkBingoApiClient.js";
import { PostgresAgentStore } from "./agent/AgentStore.js";
import { AgentService } from "./agent/AgentService.js";
import { AgentShiftService } from "./agent/AgentShiftService.js";
import {
  PostgresShiftPendingPayoutPort,
  PostgresShiftTicketRangePort,
} from "./agent/ports/ShiftLogoutPorts.js";
import { AgentTransactionService } from "./agent/AgentTransactionService.js";
import { PostgresAgentTransactionStore } from "./agent/AgentTransactionStore.js";
import { AgentSettlementService } from "./agent/AgentSettlementService.js";
import { PostgresAgentSettlementStore } from "./agent/AgentSettlementStore.js";
import { PostgresHallCashLedger } from "./agent/HallCashLedger.js";
import { NotImplementedTicketPurchasePort } from "./agent/ports/TicketPurchasePort.js";
import { PostgresPhysicalTicketReadPort } from "./agent/ports/PhysicalTicketReadPort.js";
import { createAdminPhysicalTicketsRouter } from "./routes/adminPhysicalTickets.js";
import { createAdminPhysicalTicketCheckBingoRouter } from "./routes/adminPhysicalTicketCheckBingo.js";
import { createAdminPhysicalTicketsRewardAllRouter } from "./routes/adminPhysicalTicketsRewardAll.js";
import { createAdminStaticTicketsRouter } from "./routes/adminStaticTickets.js";
import { createAdminAgentTicketRangesRouter } from "./routes/adminAgentTicketRanges.js";
import { createAdminPhysicalTicketPayoutsRouter } from "./routes/adminPhysicalTicketPayouts.js";
import { PhysicalTicketService } from "./compliance/PhysicalTicketService.js";
import { StaticTicketService } from "./compliance/StaticTicketService.js";
import { AgentTicketRangeService } from "./compliance/AgentTicketRangeService.js";
import { PhysicalTicketPayoutService } from "./compliance/PhysicalTicketPayoutService.js";
import { createAdminReportsPhysicalTicketsRouter } from "./routes/adminReportsPhysicalTickets.js";
import { createAdminReportsRedFlagCategoriesRouter } from "./routes/adminReportsRedFlagCategories.js";
import { PhysicalTicketsAggregateService } from "./admin/PhysicalTicketsAggregate.js";
import { createAdminPhysicalTicketsGamesInHallRouter } from "./routes/adminPhysicalTicketsGamesInHall.js";
import { PhysicalTicketsGamesInHallService } from "./admin/PhysicalTicketsGamesInHall.js";
import { createAdminGameManagementRouter } from "./routes/adminGameManagement.js";
import { GameManagementService } from "./admin/GameManagementService.js";
import { createAdminCloseDayRouter } from "./routes/adminCloseDay.js";
import { CloseDayService } from "./admin/CloseDayService.js";
import { createAdminDailySchedulesRouter } from "./routes/adminDailySchedules.js";
import { DailyScheduleService } from "./admin/DailyScheduleService.js";
import { createAdminSchedulesRouter } from "./routes/adminSchedules.js";
import { ScheduleService } from "./admin/ScheduleService.js";
import { createAdminPatternsRouter } from "./routes/adminPatterns.js";
import { PatternService } from "./admin/PatternService.js";
import { createAdminHallGroupsRouter } from "./routes/adminHallGroups.js";
import { HallGroupService } from "./admin/HallGroupService.js";
import { createAdminGameTypesRouter } from "./routes/adminGameTypes.js";
import { GameTypeService } from "./admin/GameTypeService.js";
import { createAdminSubGamesRouter } from "./routes/adminSubGames.js";
import { SubGameService } from "./admin/SubGameService.js";
import { createAdminGame1PotsRouter } from "./routes/adminGame1Pots.js";
import { createAdminLeaderboardTiersRouter } from "./routes/adminLeaderboardTiers.js";
import { LeaderboardTierService } from "./admin/LeaderboardTierService.js";
import { createAdminLoyaltyRouter } from "./routes/adminLoyalty.js";
import { LoyaltyService } from "./compliance/LoyaltyService.js";
import { createAdminSettingsRouter } from "./routes/adminSettings.js";
import { SettingsService } from "./admin/SettingsService.js";
import { createAdminScreenSaverRouter } from "./routes/adminScreenSaver.js";
import { ScreenSaverService } from "./admin/ScreenSaverService.js";
import { createAdminMaintenanceRouter } from "./routes/adminMaintenance.js";
import { MaintenanceService } from "./admin/MaintenanceService.js";
import { createAdminSystemInfoRouter } from "./routes/adminSystemInfo.js";
import { createAdminTransactionsRouter } from "./routes/adminTransactions.js";
import { createAdminAuditLogRouter } from "./routes/adminAuditLog.js";
import { createAdminChatModerationRouter } from "./routes/adminChatModeration.js";
import { createAdminMiniGamesRouter } from "./routes/adminMiniGames.js";
import { MiniGamesConfigService } from "./admin/MiniGamesConfigService.js";
import { createAdminSavedGamesRouter } from "./routes/adminSavedGames.js";
import { SavedGameService } from "./admin/SavedGameService.js";
import { createAdminCmsRouter } from "./routes/adminCms.js";
import { createPublicCmsRouter } from "./routes/publicCms.js";
import { createPublicStatusRouter } from "./routes/publicStatus.js";
import { bootstrapStatusPage } from "./observability/statusBootstrap.js";
import { CmsService } from "./admin/CmsService.js";
import { createAdminTrackSpendingRouter } from "./routes/adminTrackSpending.js";
import { createAdminReportsSubgameDrillDownRouter } from "./routes/adminReportsSubgameDrillDown.js";
import { createAdminReportsGame1ManagementRouter } from "./routes/adminReportsGame1Management.js";
import { createAdminReportsGameSpecificRouter } from "./routes/adminReportsGameSpecific.js";
import { createAdminReportsHallSpecificRouter } from "./routes/adminReportsHallSpecific.js";
import { createAgentReportsPastWinningRouter } from "./routes/agentReportsPastWinning.js";
import { createAgentHistoryListsRouter } from "./routes/agentHistoryLists.js";
import { createAdminReportsRedFlagPlayersRouter } from "./routes/adminReportsRedFlagPlayers.js";
import { createAdminPlayersTopRouter } from "./routes/adminPlayersTop.js";
import { createAdminVouchersRouter } from "./routes/adminVouchers.js";
import { VoucherService } from "./compliance/VoucherService.js";
import { VoucherRedemptionService } from "./compliance/VoucherRedemptionService.js";
import { createVoucherRouter } from "./routes/voucher.js";
import { createAdminUniqueIdsAndPayoutsRouter } from "./routes/adminUniqueIdsAndPayouts.js";
import { createAdminUsersRouter } from "./routes/adminUsers.js";
import { createAdminPlayerActivityRouter } from "./routes/adminPlayerActivity.js";
import { createAdminGameOversightRouter } from "./routes/adminGameOversight.js";
import { createGameRouter } from "./routes/game.js";
import { createGameEventHandlers } from "./sockets/gameEvents.js";
import { createGame1ScheduledEventHandlers } from "./sockets/game1ScheduledEvents.js";
import { createAdminGame1Namespace } from "./sockets/adminGame1Namespace.js";
import { createGame1PlayerBroadcaster } from "./sockets/game1PlayerBroadcasterAdapter.js";
import { createMiniGameSocketWire } from "./sockets/miniGameSocketWire.js";
import { initSentry, setSocketSentryContext, addBreadcrumb, captureError, flushSentry } from "./observability/sentry.js";
import { errorReporter } from "./middleware/errorReporter.js";
import { traceIdMiddleware } from "./middleware/traceId.js";
import { securityHeadersMiddleware } from "./middleware/securityHeaders.js";
import { socketTraceMiddleware, wrapSocketEventHandlers } from "./middleware/socketTraceId.js";
import { createCspReportRouter } from "./routes/cspReport.js";
import { setTraceField } from "./util/traceContext.js";
import { sweepStaleNonCanonicalRooms } from "./util/staleRoomBootSweep.js";
import { StaleRoomBootSweepService } from "./game/StaleRoomBootSweepService.js";
import { bootstrapHallGroupRooms } from "./boot/bootstrapHallGroupRooms.js";
import { resetTestPlayers } from "./scripts/resetTestPlayers.js";
import { PostgresChatMessageStore, type ChatMessageStore } from "./store/ChatMessageStore.js";
import { createAdminDisplayHandlers } from "./sockets/adminDisplayEvents.js";
import { createAdminHallHandlers } from "./sockets/adminHallEvents.js";
import { TvScreenService } from "./game/TvScreenService.js";
import { createTvScreenRouter } from "./routes/tvScreen.js";
import { createTvVoiceAssetsRouter } from "./routes/tvVoiceAssets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
// BIN-614: Admin web shell is a Vite SPA. `dist/` is produced by
// `npm --prefix apps/admin-web run build`. We serve from `dist/` if it exists,
// otherwise fall back to the pre-Vite flat `apps/admin-web/` layout so local
// dev without a build still boots. Legacy v1 iframe-shell ble fjernet
// 2026-04-27 — alle features er nå native i admin-Vite-bundlen.
const adminWebDistDir = path.resolve(__dirname, "../../admin-web/dist");
const adminWebLegacyDir = path.resolve(__dirname, "../../admin-web");
const adminWebDir = fs.existsSync(adminWebDistDir) ? adminWebDistDir : adminWebLegacyDir;
if (adminWebDir === adminWebLegacyDir) {
  console.warn("[BIN-614] admin-web/dist not found — serving pre-build fallback. Run `npm --prefix apps/admin-web run build`.");
}
const publicDir = path.resolve(__dirname, "../public");
const adminFrontendFile = path.resolve(adminWebDir, "index.html");
const projectDir = path.resolve(__dirname, "../..");

// BIN-539: Sentry — init before the HTTP server exists so the error reporter
// is wired from the first request. No-op if SENTRY_DSN is unset.
void initSentry();

const app = express();

// Behind Render/Cloudflare we sit behind at least one reverse proxy. Without
// trust-proxy Express resolves `req.ip` to the proxy's address, which means
// every client shares one bucket in the HTTP rate-limiter and legitimate admin
// traffic (dashboard polling + navigation) trips a shared 120 req/min cap.
app.set("trust proxy", true);

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
// MED-1: Trace-ID propagation. Must run before any other middleware that
// might log so the traceId is included in every log line for the request.
// Sets the X-Trace-Id response header so clients can correlate.
app.use(traceIdMiddleware());
// BIN-776: Strict security headers (CSP, HSTS, COOP, etc.). Must run BEFORE
// cors() and any router so headers are set on every response, including
// CORS-preflight 204s. Defaults to CSP_MODE=report-only — flip to "enforce"
// in env once the report stream is verified empty in staging.
app.use(securityHeadersMiddleware());
app.use(cors({ origin: corsOrigins, credentials: true }));
// LAV-3: 100 KB for all endpoints, except registration which carries compressed photo IDs (~2 * 100KB base64)
// PT1: static-ticket CSV-import kan ha opptil ~50k rader (~10MB raw), derfor 15mb limit.
//
// BIN-603: also stash the raw UTF-8 body on `req.rawBody` so the Swedbank
// webhook-handler can HMAC-verify the original bytes. JSON re-serialisation
// would desync on whitespace/key-order so we cannot regenerate the signed
// payload after parsing.
app.use((req, _res, next) => {
  const isCsvImport = req.path === "/api/admin/physical-tickets/static/import";
  const isRegister = req.path === "/api/auth/register";
  const limit = isCsvImport ? "15mb" : isRegister ? "5mb" : "100kb";
  express.json({
    limit,
    verify: (rawReq, _rawRes, buf) => {
      (rawReq as unknown as { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  })(req, _res, next);
});

// BIN-776: CSP-violation report endpoint (`POST /api/csp-report`). Mounted
// BEFORE the global rate-limiter — browsers emit reports as a side-effect
// of policy violations, often in bursts, and blocking them with 429s would
// silently drop the visibility we need during the report-only rollout.
// The router owns its own body parser scoped to `application/csp-report`
// + `application/reports+json` content-types.
app.use(createCspReportRouter());

// BIN-277: REST API rate limiting — sliding-window per IP per route tier
const httpRateLimiter = new HttpRateLimiter();
httpRateLimiter.start();
app.use(httpRateLimiter.middleware());

// BIN-278: Root redirects to web shell (must be before express.static)
app.get(["/", "/index.html"], (_req, res) => { res.redirect(302, "/web/"); });
app.use("/admin", express.static(adminWebDir));
app.use(express.static(publicDir));
// TV-voice ball-utrop. express.static-mounten over plukker opp eventuelle
// override-filer i `apps/backend/public/tv-voices/<voice>/<ball>.<ext>` først;
// hvis ingen override finnes, fall vi tilbake til de eksisterende voice-pakkene
// i `packages/game-client/public/assets/game1/audio/`. Se router-modulen for
// mapping voice1/2/3 → no-male/no-female/en.
app.use(createTvVoiceAssetsRouter({ projectDir }));

const server = http.createServer(app);
const io = new Server(server, {
  allowEIO3: true,
  cors: { origin: corsOrigins, credentials: true },
  maxHttpBufferSize: 100 * 1024, // LAV-3: 100 KB — prevents oversized payloads
  // Socket.IO default pingInterval=25s / pingTimeout=20s. Web-klientene tåler
  // hyppigere heartbeats; vi holder oss tett på default-verdiene for rask
  // disconnect-detection mot ustabile TV-displayer og mobil-shells.
  pingInterval: 25000,  // 25s — Socket.IO default
  pingTimeout: 20000,   // 20s — Socket.IO default; total 45s før disconnect
});

const walletRuntime = createWalletAdapter(projectDir);
// BIN-760: Wrap wallet-adapter med notifying-decorator slik at hver mutasjon
// (debit/credit/transfer/reserve/...) trigger en autoritativ `wallet:state`-
// emit til Socket.IO-rommet `wallet:<walletId>`. Pusher-en bygges over IO-
// instansen som finnes ovenfor; underliggende adapter (Postgres/File/Http)
// er uberørt — decorator-en fanger bare retur-veien.
//
// TODO BIN-761 (outbox): pusher emitter direkte etter commit i dag. Server-
// crash mellom commit og emit kan tape én push (klient refetcher på reconnect).
// BIN-761 vil flytte emit-en gjennom en persistent outbox-tabell.
const walletStatePusher = createWalletStatePusher({
  io,
  walletAdapter: walletRuntime.adapter,
});
const walletAdapter = new WalletStateNotifyingAdapter(walletRuntime.adapter, walletStatePusher);

// BIN-761: Wallet outbox-pattern. Når walletAdapter er postgres, opprett
// repo + worker som poller `wallet_outbox`-tabellen og dispatcher events.
// Dispatcher er stub initialt (logger til console); BIN-760 wirer
// socket-pusher inn etter at io-instansen er fullført. Worker er
// backwards-compatible: hvis postgres ikke er valgt, kjøres ingen worker.
let walletOutboxRepo: WalletOutboxRepo | null = null;
let walletOutboxWorker: WalletOutboxWorker | null = null;
if (walletAdapter instanceof PostgresWalletAdapter) {
  walletOutboxRepo = new WalletOutboxRepo({
    pool: walletAdapter.getPool(),
    schema: walletAdapter.getSchema(),
  });
  walletAdapter.setOutboxRepo(walletOutboxRepo);
  const intervalMs = (() => {
    const raw = process.env.WALLET_OUTBOX_TICK_MS?.trim();
    if (!raw) return 1000;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1000;
  })();
  const batchSize = (() => {
    const raw = process.env.WALLET_OUTBOX_BATCH?.trim();
    if (!raw) return 50;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
  })();
  walletOutboxWorker = new WalletOutboxWorker({
    repo: walletOutboxRepo,
    intervalMs,
    batchSize,
  });
  walletOutboxWorker.start();
  console.info(
    `[wallet-outbox] worker started (interval=${intervalMs}ms, batch=${batchSize})`,
  );
}

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
  autoDrawIntervalEnvOverrideMs,
  allowAutoplayInProduction, forceAutoStart, forceAutoDraw, enforceSingleRoomPerHall,
  autoplayAllowed, liveRoundsIndependentOfBet, schedulerTickMs, dailyReportJobEnabled, dailyReportJobIntervalMs,
  jobsEnabled, jobSwedbankEnabled, jobSwedbankIntervalMs,
  jobBankIdEnabled, jobBankIdIntervalMs, jobBankIdRunAtHour,
  jobRgCleanupEnabled, jobRgCleanupIntervalMs, jobRgCleanupRunAtHour,
  jobUniqueIdExpiryEnabled, jobUniqueIdExpiryIntervalMs, jobUniqueIdExpiryRunAtHour,
  jobMachineAutoCloseEnabled, jobMachineAutoCloseIntervalMs,
  jobMachineAutoCloseRunAtHour, jobMachineAutoCloseMaxAgeHours,
  jobLoyaltyMonthlyResetEnabled, jobLoyaltyMonthlyResetIntervalMs,
  jobGame1ScheduleTickEnabled, jobGame1ScheduleTickIntervalMs,
  jobGame1StaleReadySweepEnabled,
  jobGame1AutoDrawEnabled, jobGame1AutoDrawIntervalMs,
  jobGame1TransferExpiryTickEnabled, jobGame1TransferExpiryTickIntervalMs,
  jobGameStartNotificationsEnabled, jobGameStartNotificationsIntervalMs,
  jobXmlExportDailyEnabled, jobXmlExportDailyIntervalMs, jobXmlExportDailyRunAtHour,
  jobJackpotDailyEnabled, jobJackpotDailyIntervalMs, jobJackpotDailyRunAtHour, jobJackpotDailyRunAtMinute,
  jobIdempotencyCleanupEnabled, jobIdempotencyCleanupIntervalMs, jobIdempotencyCleanupRunAtHour,
  jobIdempotencyCleanupRetentionDays, jobIdempotencyCleanupBatchSize,
  jobWalletAuditVerifyEnabled, jobWalletAuditVerifyIntervalMs, jobWalletAuditVerifyRunAtHour,
  perpetualLoopEnabled, perpetualLoopDelayMs, perpetualLoopDisabledSlugs,
  usePostgresBingoAdapter, checkpointConnectionString, roomStateProvider, redisUrl, useRedisLock,
  kycMinAge, kycProvider, pgSsl, pgSchema, sessionTtlHours,
} = cfg;

// runtimeBingoSettings is mutable — Object.assign is used to update it in-place
const runtimeBingoSettings = cfg.runtimeBingoSettings;
let bingoSettingsEffectiveFromMs = Date.now();
let pendingBingoSettingsUpdate: PendingBingoSettingsUpdate | null = null;
const bingoSettingsConstraints = { fixedAutoDrawIntervalMs, bingoMinRoundIntervalMs, bingoMinPlayersToStart, autoplayAllowed, forceAutoStart, forceAutoDraw };

// ── Infrastructure ────────────────────────────────────────────────────────────

// DB-P0-002: process-wide shared Postgres pool. ALL services that previously
// constructed their own `new Pool({ connectionString })` now receive this
// shared instance instead. Reduces theoretical connection count from
// ~75 services × 20 = 1500 down to a single pool of `PG_POOL_MAX` (default 20).
//
// Render Postgres starter plan caps at ~100 connections; sharing one pool
// eliminates the cold-boot connection-storm risk that was identified in
// `docs/audit/DATABASE_AUDIT_2026-04-28.md` (DB-P0-2).
//
// Also installs `statement_timeout = 30s` (default; override via
// PG_STATEMENT_TIMEOUT_MS) on every new connection — closes DB-P1-6.
//
// Note: The wallet adapter still constructs its own pool via `WALLET_PG_*`
// env-vars (constructed before this point in `createWalletAdapter`). That's
// intentional — wallet ops are the most critical path and benefit from
// pool isolation. In production both pools point at the same DB so the
// total pool count is 2, not 75.
const sharedPool = initSharedPool({
  connectionString: platformConnectionString,
  ssl: pgSsl,
});

const localBingoAdapter = usePostgresBingoAdapter
  ? new PostgresBingoSystemAdapter({ pool: sharedPool, schema: pgSchema, ssl: pgSsl })
  : new LocalBingoSystemAdapter();

const roomStateStore: RoomStateStore = roomStateProvider === "redis" ? new RedisRoomStateStore({ url: redisUrl }) : new InMemoryRoomStateStore();
const redisSchedulerLock = useRedisLock ? new RedisSchedulerLock({ url: redisUrl }) : null;

const responsibleGamingStore = platformConnectionString.length > 0
  ? new PostgresResponsibleGamingStore({ pool: sharedPool, schema: pgSchema, ssl: pgSsl })
  : undefined;

// GAME1_SCHEDULE PR 5 (BIN-700 follow-up): LoyaltyService må konstrueres
// FØR engine så LoyaltyPointsHookAdapter kan injiseres via engine-options.
// Hovedregistreringen + singleton-bruken nedenfor refererer til samme
// `loyaltyService`-instans — ikke to forskjellige.
const loyaltyService = new LoyaltyService({
  pool: sharedPool,
  schema: pgSchema,
});
const loyaltyHookAdapter = new LoyaltyPointsHookAdapter({ service: loyaltyService });

// K2 (2026-04-29): Construct RoomStateManager BEFORE the engine so its
// `lifecycleStore` (atomic state owner for armed/reservation/arm-cycle
// state) can be passed into the engine's options. The cleanup helpers in
// the engine route eviction through `lifecycleStore.evictPlayer`, which
// atomically clears in-memory state AND surfaces the orphan reservation
// id so the wallet adapter releases the row.
//
// The same `roomState` instance is referenced again at line ~1123 below
// where the rest of the room-state wiring happens — it's a process-
// singleton, defined here only because the engine needs the lifecycle
// store.
//
// **K4 (2026-04-29):** when `ROOM_STATE_PROVIDER=redis`, swap in the
// Redis-backed lifecycle store via the env-flag factory. The store is
// constructed synchronously (lazyConnect) here so dependencies wire up;
// the boot async-block calls `connectRoomLifecycleStore` to fail fast
// if Redis is unreachable — see §3411 below. When the env-flag is
// `memory` (default for dev/test), `RoomStateManager`'s zero-arg
// constructor builds the in-memory impl with shared Maps the way K2
// shipped — no behavior change for non-redis deployments.
//
// Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.2 + §6 K2/K4.
console.log(`[BIN-K4] RoomLifecycleStore provider: ${roomStateProvider === "redis" ? "redis" : "memory"}`);
const roomState = roomStateProvider === "redis"
  ? new RoomStateManager({
      lifecycleStore: buildRoomLifecycleStoreSync({ provider: "redis", redisUrl }),
    })
  : new RoomStateManager();

// BIN-615 / PR-C3b: Instantiate Game3Engine (subclass of Game2Engine ⊂
// BingoEngine). One engine instance serves G1 / G2 / G3 rooms concurrently:
//   - Game3Engine.onDrawCompleted guards on isGame3Round (slug + patternEvalMode
//     + no jackpotNumberTable) and no-ops otherwise.
//   - super.onDrawCompleted is chained → Game2Engine's hook fires for G2 rounds
//     (jackpotNumberTable present), no-ops otherwise.
//   - Non-G2/G3 rounds fall through to BingoEngine's no-op default, preserving
//     G1 manual-claim semantics untouched.
// Factory rule: one engine class for the whole process; per-variant behaviour
// is composed via guarded hook overrides, not per-room instantiation.
const engine = new Game3Engine(localBingoAdapter, walletAdapter, {
  minRoundIntervalMs: bingoMinRoundIntervalMs, minPlayersToStart: bingoMinPlayersToStart,
  dailyLossLimit: bingoDailyLossLimit, monthlyLossLimit: bingoMonthlyLossLimit,
  playSessionLimitMs: bingoPlaySessionLimitMs, pauseDurationMs: bingoPauseDurationMs,
  selfExclusionMinMs: bingoSelfExclusionMinMs, maxDrawsPerRound: bingoMaxDrawsPerRound,
  persistence: responsibleGamingStore, roomStateStore,
  // GAME1_SCHEDULE PR 5: wire loyalty-hook (fire-and-forget points-award
  // ved ticket.purchase + game.win). Default split-rounding-audit er no-op.
  loyaltyHook: loyaltyHookAdapter,
  // K2: atomic state owner for armed/reservation/arm-cycle. Wired
  // through engine-options so cleanup helpers can evict-with-release
  // atomically (replaces PR #724 isPreserve-callback shim).
  lifecycleStore: roomState.lifecycleStore,
  // K3 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.1): quarantine BingoEngine
  // for Spill 2/3 + Demo Hall/test-haller. Production retail Spill 1
  // (gameSlug=bingo, !isTestHall, !scheduledGameId) blokkeres med
  // USE_SCHEDULED_API — må gå via Game1DrawEngineService. Tester og dev
  // sender NODE_ENV ≠ production og er derfor uberørt av guarden.
  isProductionRuntime,
});

// BIN-274: Configurable KYC provider
const bankIdAdapter = kycProvider === "bankid"
  ? new BankIdKycAdapter({ clientId: process.env.BANKID_CLIENT_ID ?? "", clientSecret: process.env.BANKID_CLIENT_SECRET ?? "", authority: process.env.BANKID_AUTHORITY ?? "https://login.bankid.no", redirectUri: process.env.BANKID_REDIRECT_URI ?? "", minAgeYears: kycMinAge })
  : null;
const kycAdapter = bankIdAdapter ?? new LocalKycAdapter({ minAgeYears: kycMinAge });

const platformService = new PlatformService(walletAdapter, {
  pool: sharedPool,
  schema: pgSchema,
  sessionTtlHours,
  minAgeYears: kycMinAge,
  kycAdapter,
});

// COMP-P0-002: outbox-pattern for compliance-ledger-write (§71-pengespill-
// forskriften). Erstatter direkte port-call med decorator som først
// persisterer event-en til `app_compliance_outbox`, så best-effort inline
// dispatch til underliggende ComplianceLedger. Hvis inline feiler →
// `ComplianceOutboxWorker` retry-er ved neste tick. Garantien: hvis outbox-
// INSERT lykkes, vil §71-rad eventually finnes — selv om inline dispatch
// krasjer eller serveren restarter mellom INSERT og dispatch.
//
// Pattern matcher BIN-761 wallet-outbox men forskjellen er at compliance-
// event ikke kan være i samme tx som wallet-debit (compliance-write skjer
// POST-commit av wallet). Outbox-INSERT lykkes med høy sannsynlighet pga
// minimalt arbeid (én enkel INSERT) — dette er nøkkelen til atomicitets-
// ekvivalent garanti.
//
// Wires INN i 6 services: Game1TicketPurchaseService, Game1PayoutService,
// Game1DrawEngineService, Game1MiniGameOrchestrator, MiniGameOddsenEngine,
// AgentMiniGameWinningService. Alle kall via dette portinstans-en
// gjennom outbox; worker dispatcher direkte til underliggende engine-port.
//
// Backwards-compat: hvis platformService ikke har postgres-pool (test/dev
// uten DB), faller vi tilbake til direkte engine-port (pre-COMP-P0-002-
// atferd). I prod er platformConnectionString alltid satt.
let complianceOutboxRepo: ComplianceOutboxRepo | null = null;
let complianceOutboxWorker: ComplianceOutboxWorker | null = null;
const complianceLedgerPort: import("./adapters/ComplianceLedgerPort.js").ComplianceLedgerPort = (() => {
  const innerPort = engine.getComplianceLedgerPort();
  // Når outbox-tabellen mangler (forsinket migration eller dev-uten-DB)
  // skal vi ikke bryte boot — fall tilbake til pre-COMP-P0-002-atferd.
  // Migration `20260429074303_compliance_outbox.sql` opprettes som del
  // av denne PR-en og kjøres automatisk ved deploy via Render-blueprint.
  try {
    complianceOutboxRepo = new ComplianceOutboxRepo({
      pool: platformService.getPool(),
      schema: pgSchema,
    });
    const intervalMs = (() => {
      const raw = process.env.COMPLIANCE_OUTBOX_TICK_MS?.trim();
      if (!raw) return 1000;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 1000;
    })();
    const batchSize = (() => {
      const raw = process.env.COMPLIANCE_OUTBOX_BATCH?.trim();
      if (!raw) return 50;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
    })();
    complianceOutboxWorker = new ComplianceOutboxWorker({
      repo: complianceOutboxRepo,
      // Worker går DIREKTE til underliggende port — IKKE via decorator-en
      // (det ville gi uendelig løkke gjennom outbox).
      dispatcher: innerPort,
      intervalMs,
      batchSize,
    });
    complianceOutboxWorker.start();
    console.info(
      `[compliance-outbox] worker started (interval=${intervalMs}ms, batch=${batchSize})`,
    );
    return new ComplianceOutboxComplianceLedgerPort({
      outboxRepo: complianceOutboxRepo,
      inner: innerPort,
    });
  } catch (err) {
    // Hvis outbox-init feilet (f.eks. pool ikke tilgjengelig i test-miljø),
    // fall tilbake til direkte engine-port slik at boot ikke krasjer.
    // Worker vil ikke starte, men wallet-debit + compliance-write vil
    // fungere som før COMP-P0-002 (med soft-fail-bug).
    console.warn(
      "[compliance-outbox] init feilet — faller tilbake til direkte engine-port (pre-COMP-P0-002-atferd):",
      err,
    );
    return innerPort;
  }
})();

// BIN-516: chat persistence. Postgres-backed when the platform pool is up,
// in-memory fallback for dev-without-DB so chat:history still works.
const chatMessageStore: ChatMessageStore = new PostgresChatMessageStore({
  pool: platformService.getPool(),
  schema: pgSchema,
});

const swedbankPayService = new SwedbankPayService(walletAdapter, {
  pool: sharedPool, schema: pgSchema,
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

// BIN-586: manuell deposit/withdraw-kø (port fra legacy transactionController
// og WithdrawController). Godkjennings-flyt kjøres av hall-operator/admin.
const paymentRequestService = new PaymentRequestService(walletAdapter, {
  pool: sharedPool,
  schema: pgSchema,
});

// HV2-A / BIR-036: daglig kontant-utbetaling-cap (50 000 kr/dag/hall) for
// `Withdraw in Hall`. Bank-uttak (`Withdraw in Bank`) er IKKE begrenset.
// Spec: docs/architecture/HV2_BIR036_SPEC_2026-04-30.md (Tobias 2026-04-30).
const cashWithdrawalCapService = new HallCashWithdrawalCapService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-587 B2.1: single-use tokens for password-reset + e-post-verify.
const authTokenService = new AuthTokenService({
  pool: sharedPool,
  schema: pgSchema,
});

// REQ-130 (PDF 9 Frontend CR): Phone+PIN-login support.
const userPinService = new UserPinService(platformService.getPool(), {
  schema: pgSchema,
});

// REQ-129: TOTP/2FA. Bruker felles pool fra PlatformService.
const twoFactorService = new TwoFactorService({
  pool: platformService.getPool(),
  schema: pgSchema,
  issuer: process.env.TOTP_ISSUER?.trim() || "Spillorama",
});

// REQ-132: active sessions + 30-min inactivity-timeout. 30 min er
// hardkodet (default) men kan overstyres via env i framtiden.
const sessionService = new SessionService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// REQ-131: 90-day password rotation tracking. Default 90 dager,
// 7 dager warning før utløp. Sett PASSWORD_ROTATION_DAYS=0 for å
// deaktivere policyen helt.
const passwordRotationDaysRaw = (process.env.PASSWORD_ROTATION_DAYS ?? "").trim();
const passwordRotationDays =
  passwordRotationDaysRaw.length === 0
    ? 90
    : Number.isFinite(Number(passwordRotationDaysRaw)) && Number(passwordRotationDaysRaw) >= 0
    ? Math.floor(Number(passwordRotationDaysRaw))
    : 90;
const passwordRotationService = new PasswordRotationService({
  pool: platformService.getPool(),
  schema: pgSchema,
  rotationPeriodDays: passwordRotationDays,
  warningDays: 7,
});

// BIN-587 B3-aml: AML red-flag service. Bruker PaymentRequestService
// for transaksjons-spørringer ved transaction-review.
const amlService = new AmlService({
  pool: sharedPool,
  schema: pgSchema,
  paymentRequestService,
});

// BIN-587 B3-security: sikkerhets-admin (withdraw-emails + risk-countries +
// blocked-IPs). Blocked-IPs har in-memory cache (5 min TTL) som brukes av
// HttpRateLimiter som pre-check.
//
// PR #513 §2.5: SECURITY_PILOT_MODE=true gjør init-failures fatal-på-boot
// i stedet for å la IP-blocking være no-op uten alarm. Defaultes på i prod-
// pilot-konfig; off i dev/test.
const securityPilotMode = (process.env.SECURITY_PILOT_MODE ?? "").trim().toLowerCase() === "true";
const securityService = new SecurityService({
  pool: sharedPool,
  schema: pgSchema,
  pilotMode: securityPilotMode,
});
// Varm cachen asynkront — ikke blokker server-start; første sjekk
// venter på init uansett.
void securityService.warmBlockedIpCache().catch((err) => {
  // PR #513 §2.5: hvis pilot-mode er på vil `initializeSchema` ha kastet
  // og prosessen bør stoppes med samme stack-trace. Logg så crash er
  // åpenbar i ops-feed.
  if (securityPilotMode) {
    console.error("[BIN-587 B3-security] CRITICAL: warm-up failed in pilot-mode — exiting", err);
    // Eksplisitt exit slik at orkestrator restarter pod-en — bedre enn
    // å kjøre med fail-open IP-blocking i pilot.
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
    return;
  }
  console.warn("[BIN-587 B3-security] blocked-IP cache warm-up failed:", err);
});

// Withdraw XML-export-service (wireframe 16.20). Bygger XML-batcher av
// ACCEPTED bank-uttak. `AccountingEmailService` wires til emailService
// senere (etter at emailService er instansiert lengre ned).
const withdrawXmlExportService = new WithdrawXmlExportService({
  pool: sharedPool,
  schema: pgSchema,
  exportDir: (process.env.WITHDRAW_XML_EXPORT_DIR ?? "").trim() || undefined,
});

// BIN-587 B4a: physical papirbillett-admin. Agent-POS-salget (BIN-583)
// oppdaterer samme tabell via agent-endepunkt.
const physicalTicketService = new PhysicalTicketService({
  pool: sharedPool,
  schema: pgSchema,
});

// PT1: fysisk-bong inventar (legacy-port). Eier `app_static_tickets` og
// CSV-import-flyt. Lever parallelt med PhysicalTicketService — de eier
// separate tabeller (app_static_tickets vs app_physical_tickets).
const staticTicketService = new StaticTicketService({
  pool: sharedPool,
  schema: pgSchema,
});

// PT2: agent (bingovert) range-registrering. Eier `app_agent_ticket_ranges`
// og reserverer bonger via `app_static_tickets.reserved_by_range_id`. PT3
// batch-salg vil dekrementere `current_top_serial` når bonger selges.
const agentTicketRangeService = new AgentTicketRangeService({
  pool: sharedPool,
  schema: pgSchema,
});

// PT4: fysisk-bong vinn-flyt. Eier `app_physical_ticket_pending_payouts`
// og håndterer verifisering + utbetaling. Kobles inn i draw-engine via
// `setPhysicalTicketPayoutService` nedenfor.
const physicalTicketPayoutService = new PhysicalTicketPayoutService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-648: read-only aggregat-report over app_physical_tickets ×
// app_agent_transactions. Egen service så SQL-aggregatet lever ved siden av
// PhysicalTicketService (som eier skjema + CRUD).
const physicalTicketsAggregateService = new PhysicalTicketsAggregateService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-638: per-hall per-game aggregat med pending-cashout-count. Samme
// tabell-kilder som BIN-648 men narrowed til én hall og beriket med
// display_name + is_active fra hall_game_schedules (LEFT JOIN).
const physicalTicketsGamesInHallService = new PhysicalTicketsGamesInHallService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-587 B4b: voucher admin-CRUD (redemption-flow i G2/G3 er follow-up).
const voucherService = new VoucherService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-587 B4b follow-up: spiller-side voucher-innløsning. Deler pg-pool med
// PlatformService så schema-init er garantert når første redeem kommer inn.
const voucherRedemptionService = new VoucherRedemptionService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// BIN-622: Game Management (admin-katalog av spill-varianter).
const gameManagementService = new GameManagementService({
  pool: sharedPool,
  schema: pgSchema,
});

// HV2-B1+B2 (Tobias 2026-04-30): Per-hall Spill 1 default gevinst-floors.
// Service eksponeres både til admin-routeren (HV2-B3 CRUD-endpoints) og til
// roomState-binderen (engine-integrasjon via fetchSpill1HallFloors-hook).
// Wildcard-fallback (`hall_id='*'`) seedes ved migration så getDefaults()
// alltid har en baseline selv for haller uten eksplisitte overrides.
const spill1PrizeDefaultsService = new Spill1PrizeDefaultsService({
  pool: sharedPool,
  schema: pgSchema,
});

// PR C (variantConfig-admin-kobling): fetcher-hook som
// `roomState.bindVariantConfigForRoom` bruker når en caller sender
// gameManagementId. Returnerer `GameManagement.config_json` eller null
// hvis ikke funnet. Feil propageres til binderen som fanger + logger
// og faller til default-binding.
async function fetchGameManagementConfigForRoomState(
  id: string,
): Promise<Record<string, unknown> | null> {
  try {
    const gm = await gameManagementService.get(id);
    return gm.config ?? null;
  } catch {
    // Ikke-funnet eller DB-feil → binderen faller til default.
    return null;
  }
}

// HV-2 fetcher-hook: gir roomState floor-defaults per hall ved variant-binding.
// Kalles kun når `gameSlug === "bingo"` og `hallId` er satt; for Spill 2/3
// og SpinnGo bypasser binderen denne hooken (variable-by-ticket-count uberørt).
async function fetchSpill1HallFloorsForRoomState(
  hallId: string,
): Promise<{
  phase1: number;
  phase2: number;
  phase3: number;
  phase4: number;
  phase5: number;
} | null> {
  try {
    const defaults = await spill1PrizeDefaultsService.getDefaults(hallId);
    return defaults;
  } catch {
    // DB-/network-feil → binderen faller til default uten floors.
    return null;
  }
}

// BIN-623: CloseDay (regulatorisk dagslukking per GameManagement). Avhenger
// av gameManagementService for å hente aggregat-felter + validere at spillet
// eksisterer. Unique (game_management_id, close_date) i `app_close_day_log`
// håndhever idempotency; dobbel-lukking returnerer 409.
const closeDayService = new CloseDayService({
  pool: sharedPool,
  schema: pgSchema,
  gameManagementService,
});

// BIN-626: DailySchedule (daglig spill-plan per hall, kobler GameManagement
// til hall + tidspunkt + subgames).
const dailyScheduleService = new DailyScheduleService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-625: Schedule (gjenbrukbar spill-mal / sub-game-bundle). Distinct fra
// DailySchedule (BIN-626) som er kalender-rader; Schedule er oppskrifta.
// Legacy Mongo-schema `schedules` normalisert til `app_schedules` med egne
// kolonner for scheduleName/Number/Type/luckyNumberPrize + sub_games_json
// for fri-form subgame-bundle (normaliseres i BIN-621 SubGame-katalogen).
const scheduleService = new ScheduleService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-627: Pattern CRUD (25-bit bitmask mønstre for Game 1 + Game 3).
// PatternMatcher runtime (apps/backend/src/game/PatternMatcher.ts) leser
// mask-feltet direkte, så admin-katalog og engine deler samme 25-bit-
// representasjon (shared-types PatternMask).
const patternService = new PatternService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-665: HallGroup CRUD (cross-hall spill-grupper for Game 2 + Game 3).
// Lukker BIN-617 dashboard-widget + aktiverer PR-A5 groupHall-placeholder
// (4 sider). Legacy Mongo-schema GroupHall normalisert til
// app_hall_groups + app_hall_group_members. Reference-checker mot
// app_daily_schedules (BIN-626) håndhever at hard-delete blokkeres når
// gruppen er i bruk i en plan.
const hallGroupService = new HallGroupService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-620: GameType CRUD (topp-nivå katalog av spill-typer). Normaliserer
// legacy Mongo-schema `gameType` til app_game_types med egne kolonner for
// aktivt-brukte felter (type_slug, name, pattern, grid-dimensjoner,
// range/tickets/lucky-numbers). Referenced fra app_game_management,
// app_patterns, app_sub_games via stabil type_slug.
const gameTypeService = new GameTypeService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-621: SubGame CRUD (gjenbrukbare pattern-bundles). DailySchedule
// binder inn SubGame-ids via subgames_json. Normaliserer legacy Mongo-
// schema `subGame1` til app_sub_games med JSON-lagret pattern_rows +
// ticket_colors og game_type_id-referanse til GameType.
const subGameService = new SubGameService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-668: LeaderboardTier CRUD (admin-konfig av plass→premie/poeng-
// mapping). Ren admin-katalog — runtime /api/leaderboard (routes/game.ts)
// aggregerer prize-points fra faktiske wins og er uavhengig. Blokkerer
// Leaderboard-admin-sider i PR-B6 (placeholder inntil dette lander).
const leaderboardTierService = new LeaderboardTierService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-700 / GAME1_SCHEDULE PR 5: loyaltyService er konstruert over engine
// (linje ~290) så LoyaltyPointsHookAdapter kan injiseres i engine-options.
// Referansen brukes videre her for admin-CRUD-routes + JobScheduler.

// BIN-679: MiniGames-konfig CRUD (Wheel + Chest + Mystery + Colordraft).
// Fire singleton-rader i app_mini_games_config. Ren ADMIN-konfig — runtime
// i Game 1 bruker i dag hardkodede prize-arrays (BingoEngine.MINIGAME_PRIZES);
// wiring til å lese fra denne tabellen lander som egen PR slik at admin-UI
// kan lande først uten runtime-risk.
const miniGamesConfigService = new MiniGamesConfigService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-624: SavedGame CRUD (gjenbrukbare GameManagement-templates). Admin
// lagrer et komplett GameManagement-oppsett (ticket-farger, priser,
// patterns, subgames, halls, days) som en navngitt mal; load-to-game-
// flyten kopierer config inn i et nytt GameManagement-oppsett. Normaliserer
// legacy Mongo-kolleksjonen `savedGame` til app_saved_games hvor hele
// template-payloaden lever som config_json (ingen normalisering i v1 siden
// malen kopieres i sin helhet).
const savedGameService = new SavedGameService({
  pool: sharedPool,
  schema: pgSchema,
});

// Role Management — per-agent permission-matrix (Admin CR 21.02.2024 side 5 +
// Agent V1.0 permissions). 15 moduler * 4-5 actions, én rad per (agent, modul).
// AGENT_PERMISSION_READ (ADMIN/SUPPORT) / AGENT_PERMISSION_WRITE (ADMIN-only).
const agentPermissionService = new AgentPermissionService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-677: System settings + maintenance-vinduer. SettingsService bruker
// key-value-registry (SYSTEM_SETTING_REGISTRY) — ukjente nøkler avvises.
// MaintenanceService håndhever aktiv-invariant (max ett aktivt vindu av
// gangen). Begge er sentrale ADMIN-only endepunkter; HALL_OPERATOR styrer
// per-hall-Spillvett via adminHalls.ts.
const settingsService = new SettingsService({
  pool: sharedPool,
  schema: pgSchema,
});
// GAP #23: Screen-saver-bilder for hall-TV. Service-laget eier KUN bildelista
// (multi-image carousel + per-image vis-tid + reorder). On/off-toggle og
// global timeout-minutter ligger i SettingsService (`branding.screen_saver_*`).
// Tabell `app_screen_saver_images` kommer fra migration 20260425125008.
const screenSaverService = new ScreenSaverService({
  pool: sharedPool,
  schema: pgSchema,
});
const maintenanceService = new MaintenanceService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-676: CMS content + FAQ. Tekst-CRUD for 5 statiske sider (aboutus,
// terms, support, links, responsible-gaming) pluss full FAQ-CRUD. Service-
// laget eier slug-whitelist og FEATURE_DISABLED-gate for responsible-gaming
// PUT (regulatorisk — versjons-historikk-krav, pengespillforskriften §11,
// blokkert av BIN-680). CMS_WRITE er ADMIN-only; CMS_READ inkluderer
// HALL_OPERATOR + SUPPORT.
const cmsService = new CmsService({
  pool: sharedPool,
  schema: pgSchema,
});

// BIN-588/BIN-587 B2.1: SMTP + audit-log. Begge har graceful fallbacks
// (EmailService blir stub uten SMTP_HOST; audit bruker in-memory uten
// DB-backing). Agent 3 vil wire ADMIN-side audit-kall i påfølgende PR.
const emailService = new EmailService();

// BIN-702: e-post-kø med retry. Moderator-handlinger (KYC-approve/reject
// osv.) bruker `emailQueue.enqueue()` via `adminPlayers`-routeren slik at
// en kortvarig SMTP-feil ikke får varselet til å forsvinne. Kjører et
// enkelt 1s-intervall i prod; i tester wires køen direkte og processNext
// kalles deterministisk.
const emailQueue = new EmailQueue({ emailService });
emailQueue.runLoop();

// Sveve SMS-service (norsk SMS-leverandør). Kjører i stub-mode hvis
// SVEVE_API_USER er tom — dev-miljø starter uten å trenge credentials.
// Brukes til:
//   1) Forgot-password OTP (auth.ts /api/auth/forgot-password) for users
//      som velger phone-flow.
//   2) Admin-broadcast (POST /api/admin/sms/broadcast).
const smsService = new SveveSmsService();

// Accounting email dispatcher for Withdraw XML-batcher (wireframe 16.20).
// Bruker eksisterende `app_withdraw_email_allowlist` (via securityService)
// som regnskaps-CC-liste. PM-beslutning 2026-04-24 — ingen ny tabell.
const accountingEmailService = new AccountingEmailService({
  emailService,
  securityService,
  xmlExportService: withdrawXmlExportService,
});

// BIN-FCM: Firebase Cloud Messaging push-service. Kjører no-op uten
// FIREBASE_CREDENTIALS_JSON (matcher EmailService-mønsteret) — dev-miljø
// kan starte uten Firebase-credentials, mens prod må sette env-var.
const fcmPushService = new FcmPushService({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const auditLogStore: AuditLogStore = platformConnectionString
  ? new PostgresAuditLogStore({
      pool: sharedPool,
      schema: pgSchema,
    })
  : new InMemoryAuditLogStore();
const auditLogService = new AuditLogService(auditLogStore);

// Scenario A (2026-04-26): wire audit-logger into SwedbankPayService so
// every successful online top-up emits payment.online.completed
// (regulatorisk pengespillforskriften-trail).
swedbankPayService.setAuditLogger(auditLogService);

// HV2-B4 (2026-04-30): per-hall Spill 1 prize-floor lookup + ScheduleService
// floor-håndhevelse. `spill1PrizeDefaultsService` (instansiert ovenfor for
// HV2-B1+B2 engine-overlay/fetcher-hook) duck-types inn i
// ScheduleService.setSpill1PrizeDefaults. Wire-up gjøres her — etter
// auditLogService er klar — siden begge injiseres post-construction.
//
// Validering aktiveres kun når Schedule-create/update inneholder
// `subGames[i].spill1Overrides`-felter som mapper til 5-fase-modellen
// (TV Extra fullHouseYellow → phase 5; Spillerness2 minimumPrize → phase 1).
// Override < hall-default → DomainError("MIN_PRIZE_BELOW_HALL_DEFAULT")
// + audit-event `schedule.create_failed.minprize_below_default`.
//
// HV2-B1+B2 leverte service-klassen og engine-overlay; HV2-B3 leverer
// admin-UI for å redigere defaults. HV2-B4 (denne endringen) lukker
// override-grense-håndhevelsen ved schedule-opprettelse/edit.
scheduleService.setSpill1PrizeDefaults(spill1PrizeDefaultsService);
scheduleService.setAuditLogService(auditLogService);

// BIN-720: Profile Settings API — service (router wires mot slutten av
// filen, sammen med andre app.use-kall). Tilgjengelig kun når
// responsibleGamingStore er oppsatt; uten RG-persistence kan pending
// loss-limit-state ikke serialiseres korrekt.
const profileSettingsService = responsibleGamingStore
  ? new ProfileSettingsService({
      pool: platformService.getPool(),
      schema: pgSchema,
      engine,
      rgPersistence: responsibleGamingStore,
      auditLogService,
    })
  : undefined;

// BIN-720 follow-up: wire ProfileSettingsService into PlatformService so
// `assertUserEligibleForGameplay` gates gameplay on time-based block-
// myself (1d/7d/30d via blocked_until). Done after construction to
// break the chicken-and-egg (ProfileSettingsService takes engine, which
// is independent of PlatformService at runtime). When the service is
// undefined (no RG-persistence) the gate is a silent no-op.
if (profileSettingsService) {
  platformService.setProfileSettingsService(profileSettingsService);
}

// BIN-583 B3.1: agent-domene (auth + shift + admin-CRUD). Bruker samme
// Postgres-pool som PlatformService slik at ensureInitialized sikrer
// schema før første spørring.
const agentStore = new PostgresAgentStore({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const agentService = new AgentService({ platformService, agentStore });
// Wireframe Gap #9: Shift Log Out-porter for flagging av pending cashouts
// + ticket-ranges ved logout med checkbox-valg.
const shiftPendingPayoutPort = new PostgresShiftPendingPayoutPort({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const shiftTicketRangePort = new PostgresShiftTicketRangePort({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const agentShiftService = new AgentShiftService({
  agentStore,
  agentService,
  pendingPayoutPort: shiftPendingPayoutPort,
  ticketRangePort: shiftTicketRangePort,
});

// BIN-583 B3.2: agent cash-ops + ticket sale + transaction-log.
// PhysicalTicketService er instansiert litt senere (linje ~267); vi
// wirer opp AgentTransactionService etter at physicalTicketService er
// klar — forward-referanse via closure i route-wiring.
const agentTransactionStore = new PostgresAgentTransactionStore({
  pool: platformService.getPool(),
  schema: pgSchema,
});
// GAME1_SCHEDULE PR 4a: TicketPurchasePort wires til Game1TicketPurchaseService
// via adapter. Selve servicen instansieres lengre ned (trenger
// game1HallReadyService først), så porten peker til en sen-bindet adapter
// som løser service-instansen ved første kall. Dette løser sirkulær-
// initialisering uten å måtte re-bestille hele IoC-grafen.
let game1TicketPurchaseServiceRef: Game1TicketPurchaseService | null = null;
const ticketPurchasePort = {
  async purchase(
    input: import("./agent/ports/TicketPurchasePort.js").DigitalTicketPurchaseInput
  ): Promise<import("./agent/ports/TicketPurchasePort.js").DigitalTicketPurchaseResult> {
    if (!game1TicketPurchaseServiceRef) {
      // Fallback: hvis servicen ikke er satt enda (init-rekkefølge-feil),
      // returner not-implemented så utvikleren ser problemet tydelig.
      return new NotImplementedTicketPurchasePort().purchase(input);
    }
    const adapter = new Game1TicketPurchasePortAdapter({
      service: game1TicketPurchaseServiceRef,
    });
    return adapter.purchase(input);
  },
};

const webBaseUrl =
  (process.env.APP_WEB_BASE_URL?.trim() || "http://localhost:5173").replace(/\/+$/, "");
const supportEmail = process.env.APP_SUPPORT_EMAIL?.trim() || "support@spillorama.no";

// ── Shared mutable room state ─────────────────────────────────────────────────
// K2 (2026-04-29): `roomState` is now constructed at line ~545, BEFORE the
// engine, so its `lifecycleStore` can be passed into the engine for
// atomic-eviction routing. This is the same singleton — referenced here
// for the rest of the wiring below.

// ── Shared helpers ────────────────────────────────────────────────────────────

function getRoomConfiguredEntryFee(roomCode: string): number {
  return roomState.getRoomConfiguredEntryFee(roomCode, runtimeBingoSettings.autoRoundEntryFee);
}

/**
 * G15 (BIN-431): In-memory hall-name cache for sync lookup in
 * buildRoomUpdatePayload. Populated lazily whenever a hall is resolved
 * (room create/join, admin flows). Falls back to hallId when missing.
 */
const hallNameCache = new Map<string, string>();

function getHallNameSync(hallId: string): string | null {
  return hallNameCache.get(hallId) ?? null;
}

function buildRoomUpdatePayload(snapshot: RoomSnapshot, nowMs = Date.now()): RoomUpdatePayload {
  return buildRoomUpdatePayloadHelper(snapshot, nowMs, {
    runtimeBingoSettings, drawScheduler, bingoMaxDrawsPerRound, schedulerTickMs,
    getArmedPlayerIds: (code) => roomState.getArmedPlayerIds(code),
    getArmedPlayerTicketCounts: (code) => roomState.getArmedPlayerTicketCounts(code),
    getArmedPlayerSelections: (code) => roomState.getArmedPlayerSelections(code),
    getRoomConfiguredEntryFee,
    // The 5th parameter (`colorAssignments`) is what carries the player's
    // armed selections into the ticket cache — dropping it means pre-round
    // brett lose their colour, so "Small Purple" armed renders as a default
    // beige/red placeholder and the next round's tickets get a fresh
    // index-cycled colour ("Small Yellow" first). The older wrapper silently
    // truncated this arg, making every buildRoomUpdatePayload call colour-
    // blind in production while the unit tests (which wired all 5 args)
    // stayed green.
    getOrCreateDisplayTickets: (code, id, count, gameSlug, colorAssignments) =>
      roomState.getOrCreateDisplayTickets(code, id, count, gameSlug, colorAssignments),
    getLuckyNumbers: (code) => roomState.getLuckyNumbers(code),
    // BIN-694: roomState.variantByRoom is kept populated by
    // bindDefaultVariantConfig at every room-creation entry point, so the
    // pre-round handlers (ticket:cancel, ticket:replace, colour expansion)
    // always see the correct 5-phase Norsk-bingo config for Game 1.
    getVariantConfig: (code) => roomState.getVariantConfig(code),
    // G15 (BIN-431): hall-name + supplier for ticket-detail flip.
    getHallName: getHallNameSync,
    supplierName: "Spillorama",
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
  // G15 (BIN-431): populate the hall-name cache for sync ticket enrichment.
  hallNameCache.set(hall.id, hall.name);
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
  // BIN-694 (forrige fix): scheduler trenger variantConfig for fase-progresjon.
  getVariantConfig: (code) => roomState.getVariantConfig(code),
  // BIN-693 Option B: pass reservation-mapping til startGame så commit
  // kjøres mot wallet-reservation i stedet for fresh transfer.
  getReservationIdsByPlayer: (code) => roomState.getAllReservationIds(code),
  clearReservationIdsForRoom: (code) => {
    const ids = roomState.reservationIdByPlayerByRoom.get(code);
    if (ids) ids.clear();
  },
});

drawScheduler = new DrawScheduler({
  tickIntervalMs: schedulerTickMs, lockTimeoutMs: 5_000, watchdogIntervalMs: 5_000, watchdogStuckMultiplier: 3,
  fixedDrawIntervalMs: fixedAutoDrawIntervalMs, enforceSingleRoomPerHall,
  // Bug 1 fix: live-rounds-independent-of-bet propageres til scheduler.
  getSettings: () => toDrawSchedulerSettings(runtimeBingoSettings, liveRoundsIndependentOfBet),
  listRoomSummaries: () => engine.listRoomSummaries(),
  getRoomSnapshot: (code) => engine.getRoomSnapshot(code),
  getAllRoomCodes: () => engine.getAllRoomCodes(),
  // Bug 1 fix: armed-count brukt KUN når flagg er false (legacy).
  // I default-modus (true) ignoreres callbacken av scheduleren.
  getArmedPlayerCount: (code) => roomState.getArmedPlayerIds(code).length,
  ...schedulerCallbacks,
});
drawScheduler.start();

const dailyReportScheduler = createDailyReportScheduler({ engine, enabled: dailyReportJobEnabled, intervalMs: dailyReportJobIntervalMs });

// BIN-693 Option B: Wallet-reservasjons-expiry-tick.
const walletReservationExpiryTickMs = Math.max(
  60_000,
  Number(process.env.WALLET_RESERVATION_EXPIRY_TICK_MS ?? 300_000),
);
const walletReservationExpiryService = new WalletReservationExpiryService({
  walletAdapter,
  tickIntervalMs: walletReservationExpiryTickMs,
  onTick: (count) => {
    if (count > 0) console.log(`[wallet-reservation-expiry] expired ${count} stale reservations`);
  },
});

// ── BIN-582: Legacy-cron ports (Swedbank sync, BankID expiry, RG cleanup) ────

const jobScheduler = createJobScheduler({
  enabled: jobsEnabled,
  // Reuse existing Redis scheduler lock when configured, so only one
  // instance runs each tick in a multi-node deploy. In-memory deploys
  // get no lock and run unconditionally (single-node dev).
  lock: redisSchedulerLock,
});

// ── BIN-764: Wallet hash-chain audit-verifier ─────────────────────────────
// Casino-grade tamper-evident audit-trail for wallet_entries. Verifies
// SHA-256 chain pr account_id. Nightly cron + on-demand admin endpoint.
const walletAuditVerifier = new WalletAuditVerifier({
  pool: platformService.getPool(),
  schema: pgSchema,
  // onMismatch: kunne hooke til auditLogService her, men for å unngå
  // sirkulær import før auditLogService er instansiert lar vi
  // verifier-en kun logge til console + Prometheus inntil ops kobler
  // til DB-alarming i en oppfølgings-PR.
});

jobScheduler.register({
  name: "swedbank-payment-sync",
  description: "Reconcile pending Swedbank top-up intents (legacy hourly cron).",
  intervalMs: jobSwedbankIntervalMs,
  enabled: jobSwedbankEnabled,
  run: createSwedbankPaymentSyncJob({
    pool: platformService.getPool(),
    schema: pgSchema,
    swedbankPayService,
  }),
});

jobScheduler.register({
  name: "bankid-expiry-reminder",
  description: "Remind users of imminent BankID/ID expiry and mark expired (legacy daily cron).",
  intervalMs: jobBankIdIntervalMs,
  enabled: jobBankIdEnabled,
  run: createBankIdExpiryReminderJob({
    pool: platformService.getPool(),
    schema: pgSchema,
    runAtHourLocal: jobBankIdRunAtHour,
  }),
});

jobScheduler.register({
  name: "self-exclusion-cleanup",
  description: "Clear expired voluntary pauses + self-exclusion minimums (legacy daily cron).",
  intervalMs: jobRgCleanupIntervalMs,
  enabled: jobRgCleanupEnabled,
  run: createSelfExclusionCleanupJob({
    pool: platformService.getPool(),
    schema: pgSchema,
    runAtHourLocal: jobRgCleanupRunAtHour,
  }),
});

// BIN-764: Nightly wallet hash-chain integrity verifier. Casino-grade
// audit-trail — re-beregner SHA-256-kjeden for alle kontoer og alarmerer
// hvis en tidligere wallet-entry har blitt manipulert. Default ON.
jobScheduler.register({
  name: "wallet-audit-verify",
  description: "Verify SHA-256 hash-chain integrity across all wallet_entries (BIN-764).",
  intervalMs: jobWalletAuditVerifyIntervalMs,
  enabled: jobWalletAuditVerifyEnabled,
  run: createWalletAuditVerifyJob({
    verifier: walletAuditVerifier,
    runAtHourLocal: jobWalletAuditVerifyRunAtHour,
  }),
});

// K1A pilot-blokker follow-up: flip Customer Unique ID cards past
// `expiry_date` to status='EXPIRED'. Runs once per calendar day at the
// configured hour. Skips silently if the migration hasn't been applied yet.
jobScheduler.register({
  name: "unique-id-expiry",
  description: "Mark Customer Unique ID cards as EXPIRED when expiry_date is in the past.",
  intervalMs: jobUniqueIdExpiryIntervalMs,
  enabled: jobUniqueIdExpiryEnabled,
  run: createUniqueIdExpiryJob({
    pool: platformService.getPool(),
    schema: pgSchema,
    runAtHourLocal: jobUniqueIdExpiryRunAtHour,
  }),
});

// BIN-720: Profile Settings 48h-queue flush. Promoterer pending loss-limit-
// endringer → active når effectiveFromMs <= now. Polling-intervall 15 min.
if (profileSettingsService) {
  jobScheduler.register({
    name: "profile-pending-loss-limit-flush",
    description: "Activate pending loss-limit increases when 48h window has passed (BIN-720).",
    intervalMs: 15 * 60 * 1000,
    enabled: true,
    run: createProfilePendingLossLimitFlushJob({ profileSettingsService }),
  });
}

// BIN-700: nullstill month_points for alle spillere ved månedskift. Polling-
// intervall 1 time (default). Idempotent via month_key-sammenligning i
// service-laget — dobbel-kjøring samme måned er no-op.
jobScheduler.register({
  name: "loyalty-monthly-reset",
  description: "Reset month_points on app_loyalty_player_state at month boundaries (BIN-700).",
  intervalMs: jobLoyaltyMonthlyResetIntervalMs,
  enabled: jobLoyaltyMonthlyResetEnabled,
  run: createLoyaltyMonthlyResetJob({ loyaltyService }),
});

// BIN-FCM: sendGameStartNotifications cron (legacy 1min). Finner spill som
// starter innen notification-vinduet og sender push til deltagende halls
// aktive spillere. Dedup via eksisterende 'game-start'-rader i
// app_notifications siste 24t. No-op når FCM er disabled — cron logger
// bare 0 items i så fall.
jobScheduler.register({
  name: "game-start-notifications",
  description: "Send FCM push to players when a scheduled Game 1 is within its notification window (BIN-FCM).",
  intervalMs: jobGameStartNotificationsIntervalMs,
  enabled: jobGameStartNotificationsEnabled,
  run: createGameStartNotificationsJob({
    pool: platformService.getPool(),
    schema: pgSchema,
    fcmPushService,
  }),
});

// Withdraw XML-eksport daglig cron (wireframe 16.20). Genererer én XML
// per agent av ACCEPTED bank-uttak og sender som vedlegg til
// regnskaps-allowlisten. PM-krav 2026-04-24: daglig kl 23:00 lokal tid.
jobScheduler.register({
  name: "xml-export-daily",
  description: "Generate daily withdraw XML batches per agent + email to accounting allowlist (wireframe 16.20).",
  intervalMs: jobXmlExportDailyIntervalMs,
  enabled: jobXmlExportDailyEnabled,
  run: createXmlExportDailyTickJob({
    xmlExportService: withdrawXmlExportService,
    accountingEmailService,
    runAtHourLocal: jobXmlExportDailyRunAtHour,
  }),
});

// GAME1_SCHEDULE PR 2: per-hall ready-flow service. Håndterer bingovert-
// trykker-klar + master-UI getReadyStatusForGame + purchase-cutoff-helper.
// REQ-007: konstrueres FØR scheduler-tick slik at sweepStaleReadyRows kan
// injiseres som dep.
const game1HallReadyService = new Game1HallReadyService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// GAME1_SCHEDULE PR 1+2: 15s-tick som spawner Game 1-rader fra daily_schedules,
// flipper status 'scheduled' → 'purchase_open', 'purchase_open' →
// 'ready_to_start' når alle haller klare, og cancel-er utløpte rader.
// REQ-007: tick sweeper også stale ready-rader (agent-disconnect uten unmark).
// Default OFF — feature-flag aktiveres i staging når PR 2-3 er merget.
const game1ScheduleTickService = new Game1ScheduleTickService({
  pool: platformService.getPool(),
  schema: pgSchema,
});
jobScheduler.register({
  name: "game1-schedule-tick",
  description: "Spawn Game 1 games from daily_schedules + advance state machine (GAME1_SCHEDULE PR 1+2) + REQ-007 stale ready sweep.",
  intervalMs: jobGame1ScheduleTickIntervalMs,
  enabled: jobGame1ScheduleTickEnabled,
  run: createGame1ScheduleTickJob({
    service: game1ScheduleTickService,
    // 2026-05-02 (Tobias UX-decision): stale-ready-sweep er opt-in.
    // Uten heartbeat-endepunkt rever sweepen Klar-flagget etter 60s og
    // bingoverten må re-markere — noe Tobias eksplisitt har sagt nei til.
    // Re-aktiveres ved å sette GAME1_STALE_READY_SWEEP_ENABLED=true når
    // heartbeat er på plass.
    ...(jobGame1StaleReadySweepEnabled
      ? { hallReadyService: game1HallReadyService }
      : {}),
  }),
});

// BIN-GAP#4: Register Sold Tickets scanner (wireframe 15.2/17.15). Per-game
// per-hall per-ticket-type registrering med carry-forward mellom runder.
const ticketRegistrationService = new TicketRegistrationService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// REQ-101 (PDF 17 §17.24): inline Add Physical Ticket popup-flyt. Bruker
// samme `app_ticket_ranges_per_game`-tabell som ticketRegistrationService
// men med én-operasjons-flyt fra Sub Game Details-popup.
const agentPhysicalTicketInlineService = new AgentPhysicalTicketInlineService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// REQ-146 (PDF 17 §17.23): agent-input for mini-game-winnings. Skriver til
// `app_game1_mini_game_results` med samme idempotency-key-mønster som
// Game1MiniGameOrchestrator (game-engine-kontekst). PRIZE-entry til
// ComplianceLedgerPort wired via outbox-decorator (COMP-P0-002) for
// eventual delivery-garanti — agent-input er HALL-kanal.
const agentMiniGameWinningService = new AgentMiniGameWinningService({
  pool: platformService.getPool(),
  schema: pgSchema,
  walletAdapter,
  defaultLedgerChannel: "HALL",
  // COMP-P0-002: routes via outbox slik at PRIZE-entry persisteres selv om
  // inline dispatch feiler. Audit-finding nevnte denne servicen ved navn
  // (`AgentMiniGameWinningService.ts:472` er soft-fail call-site).
  complianceLedgerPort,
});

// GAME1_SCHEDULE PR 3: master-control service. Håndterer master-start/pause/
// resume/stop + hall-exclude/include med regulatorisk audit (app_game1_master_audit).
const game1MasterControlService = new Game1MasterControlService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// MASTER_PLAN §2.3 — daglig-akkumulerende jackpot-state (Appendix B.9).
// Starter 2000 kr, +4000/dag, max 30k. State per hall-gruppe.
const game1JackpotStateService = new Game1JackpotStateService({
  pool: platformService.getPool(),
  schema: pgSchema,
});
// Late-bind slik at master-control kan bruke servicen for pre-start-confirm.
game1MasterControlService.setJackpotStateService(game1JackpotStateService);

// MASTER_PLAN §2.3 / Appendix B.9 — daglig jackpot-akkumulering (+4000/dag).
// Kjøres 00:15 lokal tid for å unngå midnatt-race med andre daglige jobs.
// Default OFF — PM aktiverer i staging via JOB_JACKPOT_DAILY_ENABLED=true.
jobScheduler.register({
  name: "jackpot-daily-tick",
  description: "Daglig +4000 kr akkumulering på Spill 1 Jackpott per hall-gruppe (MASTER_PLAN §2.3).",
  intervalMs: jobJackpotDailyIntervalMs,
  enabled: jobJackpotDailyEnabled,
  run: createJackpotDailyTickJob({
    service: game1JackpotStateService,
    runAtHourLocal: jobJackpotDailyRunAtHour,
    runAtMinuteLocal: jobJackpotDailyRunAtMinute,
  }),
});

// BIN-767: Wallet idempotency-key TTL-cleanup. Industri-standard kasino-
// wallet retention er 90 dager — etter det er klient-retry-vinduer for
// lengst utløpt og UNIQUE-indexen bør ikke holde på radene. Default ON,
// kjøres 04:00 lokal tid (off-peak etter andre daglige cron-jobber).
// Sletter IKKE wallet_transactions-rader; NULL-er kun idempotency_key-
// kolonnen så audit-trail bevares fullt ut.
jobScheduler.register({
  name: "idempotency-key-cleanup",
  description: "TTL-cleanup av wallet_transactions.idempotency_key (90-dager retention, BIN-767).",
  intervalMs: jobIdempotencyCleanupIntervalMs,
  enabled: jobIdempotencyCleanupEnabled,
  run: createIdempotencyKeyCleanupJob({
    pool: platformService.getPool(),
    schema: pgSchema,
    retentionDays: jobIdempotencyCleanupRetentionDays,
    batchSize: jobIdempotencyCleanupBatchSize,
    runAtHourLocal: jobIdempotencyCleanupRunAtHour,
  }),
});

// BIN-763: Nightly wallet reconciliation. Sammenligner wallet_accounts
// mot SUM(wallet_entries) per konto + side, alarmer ved divergens >
// 0.01 NOK. Default 03:00 lokal tid. Polling hvert 15 min.
const walletReconciliationService = new WalletReconciliationService({
  pool: platformService.getPool(),
  schema: pgSchema,
  batchSize: Math.max(1, parsePositiveIntEnv(process.env.WALLET_RECONCILIATION_BATCH_SIZE, 1000)),
  batchPauseMs: Math.max(0, parsePositiveIntEnv(process.env.WALLET_RECONCILIATION_BATCH_PAUSE_MS, 50)),
});
const walletReconciliationEnabled = parseBooleanEnv(
  process.env.JOB_WALLET_RECONCILIATION_ENABLED,
  true,
);
const walletReconciliationIntervalMs = Math.max(
  60_000,
  parsePositiveIntEnv(process.env.JOB_WALLET_RECONCILIATION_INTERVAL_MS, 15 * 60 * 1000),
);
const walletReconciliationRunAtHour = Math.min(
  23,
  Math.max(0, parsePositiveIntEnv(process.env.JOB_WALLET_RECONCILIATION_RUN_AT_HOUR, 3)),
);
const walletReconciliationRunAtMinute = Math.min(
  59,
  Math.max(0, parsePositiveIntEnv(process.env.JOB_WALLET_RECONCILIATION_RUN_AT_MINUTE, 0)),
);
jobScheduler.register({
  name: "wallet-reconciliation",
  description: "Nightly wallet reconciliation — wallet_accounts vs SUM(wallet_entries) per konto + side (BIN-763).",
  intervalMs: walletReconciliationIntervalMs,
  enabled: walletReconciliationEnabled,
  run: createWalletReconciliationJob({
    service: walletReconciliationService,
    runAtHourLocal: walletReconciliationRunAtHour,
    runAtMinuteLocal: walletReconciliationRunAtMinute,
  }),
});

// PR-T1 Spor 4: akkumulerende pot-service (Jackpott + Innsatsen). Konstrueres
// FØR Game1TicketPurchaseService fordi sistnevnte trenger PotSalesHookPort
// for å akkumulere andel av salg etter vellykket kjøp (PR-T3). Service
// håndterer begge pot-typer — draw-engine-evaluatoren diskriminerer på
// `config.potType` når den evaluerer vinn.
const game1PotService = new Game1PotService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// GAME1_SCHEDULE PR 4a: ticket-purchase-foundation. Drifter
// app_game1_ticket_purchases (kjøp + refund). Player-flow bruker servicen
// direkte via createGame1PurchaseRouter; agent-POS-flyten bruker adapteren
// (Game1TicketPurchasePortAdapter) som mapper fra BIN-583-porten.
const game1TicketPurchaseService = new Game1TicketPurchaseService({
  pool: platformService.getPool(),
  schema: pgSchema,
  walletAdapter,
  platformService,
  hallReadyService: game1HallReadyService,
  auditLogService,
  // PR-W5 wallet-split: logg BUYIN mot Spillvett-tapsgrense etter purchase.
  // Kun deposit-delen teller per §11 pengespillforskriften. Engine eier
  // ComplianceManager — vi bruker narrow-port (recordLossEntry) så servicen
  // ikke tar direkte avhengighet til engine-klassen.
  complianceLossPort: engine.getComplianceLossPort(),
  // PR-T3 Spor 4: pot-akkumulering (Innsatsen + Jackpott) via narrow-port.
  // Soft-fail — pot-feil ruller ikke tilbake purchase. Hele kjøpssum teller
  // mot pot (pot er intern akkumulering, ikke loss-ledger-entry).
  potSalesHook: engine.getPotSalesHookPort(game1PotService),
  // K1 compliance-fix: skriv STAKE-entry per kjøp bundet til kjøpe-hallens
  // (input.hallId) house-account. §71 pengespillforskriften krever per-hall-
  // rapport. Eksisterende entries før denne PR manglet — ingen retro-
  // rebalansering. Se Game1TicketPurchaseService K1-kommentar for detaljer.
  // COMP-P0-002: routes via `app_compliance_outbox` slik at compliance-
  // event-en garantert blir persistert selv om inline dispatch feiler.
  complianceLedgerPort,
});
// GAME1_SCHEDULE PR 4a: bind forward-ref slik at `ticketPurchasePort` (opprettet
// tidligere pga. agent-service dependency) kan delegere til den nye servicen.
game1TicketPurchaseServiceRef = game1TicketPurchaseService;

// GAME1_SCHEDULE PR 5 (§3.8): schedule-level crash recovery. Kjører én gang
// ved boot og cancel-er app_game1_scheduled_games-rader som er `running` eller
// `paused` MER enn 2 timer etter scheduled_end_time (overdue). Engine-level
// state håndteres fortsatt av BIN-245-flyten nedenfor.
const game1RecoveryService = new Game1RecoveryService({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// GAME1_SCHEDULE PR 4c Bolk 2+3: payout + jackpot for Spill 1 scheduled-games.
// Payout skjer inne i drawNext-transaksjonen slik at wallet-credit-feil
// rullbaker hele draw-en (§11 fail-closed).
const game1PayoutService = new Game1PayoutService({
  walletAdapter,
  auditLogService,
  schema: pgSchema,
  loyaltyHook: loyaltyHookAdapter,
  // K1 compliance-fix: skriv PRIZE-entry per vinner bundet til VINNERENS
  // kjøpe-hall (winner.hallId — hentet fra app_game1_ticket_purchases.
  // hall_id), ikke master-hallens hall. §71-rapport blir riktig per hall
  // for multi-hall-runder. Soft-fail (payout fortsetter ved ledger-feil).
  // COMP-P0-002: routes via outbox-decorator for eventual delivery-garanti.
  complianceLedgerPort,
});
const game1JackpotService = new Game1JackpotService();

// GAME1_SCHEDULE PR 4b + 4c Bolk 5: draw-engine core. Orkestreres av
// master-control (start/pause/resume/stop). PR 4c wires payoutService +
// jackpotService inn slik at drawNext() evaluerer patterns og utbetaler.
// Kobles inn i master-control via setDrawEngine() for å unngå sirkulær
// konstruksjon.
const game1DrawEngineService = new Game1DrawEngineService({
  pool: platformService.getPool(),
  schema: pgSchema,
  ticketPurchaseService: game1TicketPurchaseService,
  auditLogService,
  payoutService: game1PayoutService,
  jackpotService: game1JackpotService,
  // MASTER_PLAN §2.3 / Appendix B.9: daglig akkumulert jackpot per hall-
  // gruppe. Når wired sammen med walletAdapter (under) vil engine etter
  // Fullt Hus innen drawThresholds[0] (default 50) atomisk debit-and-reset
  // state-pott og distribuere awarded amount til vinnere via wallet.credit.
  jackpotStateService: game1JackpotStateService,
  physicalTicketPayoutService,
  // PR-T3 Spor 4: akkumulerende pot-evaluering etter Fullt Hus. Pot-payout
  // kjører INNE i draw-transaksjonen med samme fail-closed-semantikk som
  // Game1PayoutService (payout-feil → draw rolls back).
  potService: game1PotService,
  walletAdapter,
  // PR-C1b: wire BingoEngine-referansen slik at drawNext/stopGame kan
  // rydde in-memory rom ved completion/cancellation (memory-leak fix).
  // `engine` her er Game3Engine ⊂ BingoEngine, som eksponerer
  // destroyRoom() arvet fra basen. Fail-closed — se destroyRoomIfPresent.
  bingoEngine: engine,
  // K2-A CRIT-2: skriv EXTRA_PRIZE-entries for pot- og lucky-bonus-payouts
  // til §71 ComplianceLedger. Soft-fail-mønster matcher Game1PayoutService.
  // COMP-P0-002: routes via outbox-decorator for eventual delivery-garanti.
  complianceLedgerPort,
  // K2-A CRIT-3: håndhev single-prize-cap (2500 kr) på alle Spill 1
  // payout-paths (pot, lucky-bonus, mini-game). Tidligere kunne Jackpott
  // utbetales til 30 000 kr og mini-game-buckets til 4000 kr — ulovlig
  // per pengespillforskriften §11.
  prizePolicyPort: engine.getPrizePolicyPort(),
});
game1MasterControlService.setDrawEngine(game1DrawEngineService);
// GAME1_SCHEDULE PR 4d.4: inject ticket-purchase-service slik at stopGame()
// kan kalle refundAllForGame() POST-commit for automatisk refund ved master-
// stop. Late-binding fordi ticketPurchaseService konstrueres etter
// masterControl (sirkulær avhengighet ellers).
game1MasterControlService.setTicketPurchaseService(game1TicketPurchaseService);

// BIN-690 M1: mini-game orchestrator (framework-foundation). Ingen konkrete
// spill registrert i M1 — M2-M5 legger dem til via registerMiniGame().
// Late-bound på drawEngine slik at Game1DrawEngineService kan konstrueres
// uten sirkulær avhengighet.
const game1MiniGameOrchestrator = new Game1MiniGameOrchestrator({
  pool: platformService.getPool(),
  schema: pgSchema,
  auditLog: auditLogService,
  walletAdapter,
  // K2-A CRIT-2: skriv EXTRA_PRIZE-entry per mini-game-payout til §71-
  // ledger. Soft-fail (ledger-feil ruller ikke tilbake wallet-credit).
  // COMP-P0-002: routes via outbox-decorator for eventual delivery-garanti.
  complianceLedgerPort,
  // K2-A CRIT-3: håndhev single-prize-cap (2500 kr) før wallet-credit.
  // Mini-game-buckets/luker kan ha config-verdier over 2500 — capen
  // beskytter mot ulovlig utbetaling.
  prizePolicyPort: engine.getPrizePolicyPort(),
});

// BIN-690 M2: registrer Wheel-implementasjon. Orchestrator leser admin-
// config (app_mini_games_config.config_json for game_type='wheel') og
// passer det inn som configSnapshot til MiniGameWheelEngine.trigger/
// handleChoice. Hvis admin ikke har konfigurert → DEFAULT_WHEEL_CONFIG.
game1MiniGameOrchestrator.registerMiniGame(new MiniGameWheelEngine());

// BIN-690 M3: registrer Chest-implementasjon. Samme pattern som M2 — admin
// config (game_type='chest') overstyrer DEFAULT_CHEST_CONFIG (6 luker,
// 400-4000 kr uniform). Chest tar `{ chosenIndex }` i choiceJson og
// returnerer alle lukers verdier i result_json for reveal-all-animasjon.
game1MiniGameOrchestrator.registerMiniGame(new MiniGameChestEngine());

// BIN-690 M4: registrer Colordraft-implementasjon. Admin config
// (game_type='colordraft') overstyrer DEFAULT_COLORDRAFT_CONFIG (12 luker,
// 4 farger, 1000 kr winPrize, 0 consolation). Colordraft tar
// `{ chosenIndex }` i choiceJson. Server trekker target-farge +
// slot-farger deterministisk fra resultId-seed slik at trigger-payload
// (synlig for klient) matcher handleChoice-state EXAKT. Match ⇒ full
// winPrize; mismatch ⇒ consolationPrizeNok (ofte 0).
game1MiniGameOrchestrator.registerMiniGame(new MiniGameColordraftEngine());

// BIN-690 M5: registrer Oddsen-implementasjon. Admin config
// (game_type='oddsen') overstyrer DEFAULT_ODDSEN_CONFIG (validNumbers
// [55,56,57], potSmall 1500, potLarge 3000, resolveAtDraw 57). Oddsen er
// unik fordi payout er CROSS-ROUND: handleChoice persisterer state i
// `app_game1_oddsen_state` med referanse til neste planlagte spill i hallen,
// og payout skjer ved terskel-draw i det neste spillet via resolveForGame().
// Derfor krever Oddsen egen walletAdapter + pool + auditLog (til forskjell
// fra M2/M3/M4 som er stateless og bruker orchestrator.creditPayout).
const miniGameOddsenEngine = new MiniGameOddsenEngine({
  pool: platformService.getPool(),
  schema: pgSchema,
  walletAdapter,
  auditLog: auditLogService,
  // K2-A CRIT-2: skriv EXTRA_PRIZE-entry per Oddsen-resolve-hit til §71-
  // ledger. Soft-fail-mønster matcher Game1PayoutService.
  // COMP-P0-002: routes via outbox-decorator for eventual delivery-garanti.
  complianceLedgerPort,
  // K2-A CRIT-3: håndhev single-prize-cap (2500 kr). Default Oddsen-config
  // har potLarge=3000 kr → vil bli capped til 2500 (forsk. til huset).
  prizePolicyPort: engine.getPrizePolicyPort(),
});
game1MiniGameOrchestrator.registerMiniGame(miniGameOddsenEngine);

// BIN-MYSTERY M6: registrer Mystery Game-implementasjon. Admin config
// (game_type='mystery') overstyrer DEFAULT_MYSTERY_CONFIG (prizeListNok =
// [50, 100, 200, 400, 800, 1500], autoTurnFirstMoveSec=20, otherMoveSec=10).
// Mystery Game er 5-runders opp/ned-gjetting: server trekker middleNumber
// + resultNumber (5-sifrede tall) deterministisk fra resultId-seed;
// spilleren gjetter per-digit om resultDigit er høyere eller lavere enn
// middleDigit. Matchende sifre → joker (auto-win, max-premie). Klient
// sender `{ directions: ["up"|"down", ...] }` samlet til handleChoice.
game1MiniGameOrchestrator.registerMiniGame(new MiniGameMysteryEngine());

game1DrawEngineService.setMiniGameOrchestrator(game1MiniGameOrchestrator);
// BIN-690 M5: late-bind oddsen-engine til draw-engine slik at
// Game1DrawEngineService.drawNext kan kalle resolveForGame() ved terskel-draw
// i spill som har aktiv Oddsen-state fra forrige runde.
game1DrawEngineService.setOddsenEngine(miniGameOddsenEngine);

// GAME1_SCHEDULE PR 4c Bolk 4: auto-draw-tick (global 1s tick, fixed
// seconds-intervall per spill). Default OFF til PR 4d socket-flyt aktiveres.
//
// `forceSecondsOverride` brukes når ops setter `AUTO_DRAW_INTERVAL_MS`
// env-var. Da brukes verdien for ALLE Spill 1-spill, slik at draw-tempoet
// holder seg stabilt på tvers av runder (bug-fix: tidligere kunne runde 1
// se annerledes ut enn runde 2 fordi env-var aldri ble lest av Spill 1-pathen).
// Konvertering ms → sekunder; min 1s for å unngå at floor (Math.floor) gir 0.
const game1AutoDrawTickService = new Game1AutoDrawTickService({
  pool: platformService.getPool(),
  schema: pgSchema,
  drawEngine: game1DrawEngineService,
  forceSecondsOverride:
    autoDrawIntervalEnvOverrideMs !== null
      ? Math.max(1, Math.round(autoDrawIntervalEnvOverrideMs / 1000))
      : undefined,
});
jobScheduler.register({
  name: "game1-auto-draw-tick",
  description: "Trigger drawNext() for running Spill 1-games når fixed seconds-intervall er passert (GAME1_SCHEDULE PR 4c Bolk 4).",
  intervalMs: jobGame1AutoDrawIntervalMs,
  enabled: jobGame1AutoDrawEnabled,
  run: createGame1AutoDrawTickJob({ service: game1AutoDrawTickService }),
});

// Spill 2/3 auto-draw-tick (Tobias-direktiv 2026-05-03):
//   "Spill 2/3 har perpetual auto-restart, men ingen baller ble trukket."
// Game1AutoDrawTickService dekker kun scheduled Spill 1-spill (DB-drevet
// via app_game1_scheduled_games). Spill 2 og 3 kjøres som in-memory
// BingoEngine-rom og hadde ingen tilsvarende cron — så når
// PerpetualRoundService startet en ny runde, sto den stille.
//
// Re-bruker `autoDrawIntervalEnvOverrideMs` (env: AUTO_DRAW_INTERVAL_MS,
// default 30000) som draw-intervall, og samme tick-polling som Game 1
// (`jobGame1AutoDrawIntervalMs`, default 1000 ms) som polling-rate.
// Default ON — Spill 2/3 må trekke baller for å fungere.
const game2AutoDrawTickService = new Game2AutoDrawTickService({
  engine,
  drawIntervalMs: autoDrawIntervalEnvOverrideMs ?? 30_000,
});
const game3AutoDrawTickService = new Game3AutoDrawTickService({
  engine,
  drawIntervalMs: autoDrawIntervalEnvOverrideMs ?? 30_000,
});
jobScheduler.register({
  name: "game2-auto-draw-tick",
  description: "Trigger drawNext() for running Spill 2 (rocket / game_2 / tallspill)-rom. Driver perpetual-loopen.",
  intervalMs: jobGame1AutoDrawIntervalMs,
  enabled: jobGame1AutoDrawEnabled,
  run: createGame2AutoDrawTickJob({ service: game2AutoDrawTickService }),
});
jobScheduler.register({
  name: "game3-auto-draw-tick",
  description: "Trigger drawNext() for running Spill 3 (monsterbingo / mønsterbingo / game_3)-rom. Driver perpetual-loopen.",
  intervalMs: jobGame1AutoDrawIntervalMs,
  enabled: jobGame1AutoDrawEnabled,
  run: createGame3AutoDrawTickJob({ service: game3AutoDrawTickService }),
});

// Task 1.6: runtime master-overføring — service + expiry-tick. Expiry-tick
// default ON (60s TTL må håndheves). Broadcast-hook late-bindes etter at
// adminGame1Handle.broadcaster finnes (se senere i index.ts).
const game1TransferHallService = new Game1TransferHallService({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const game1TransferExpiryTickService = new Game1TransferExpiryTickService({
  service: game1TransferHallService,
});
jobScheduler.register({
  name: "game1-transfer-expiry-tick",
  description: "Utløp pending master-transfer-requests (Task 1.6, 60s TTL).",
  intervalMs: jobGame1TransferExpiryTickIntervalMs,
  enabled: jobGame1TransferExpiryTickEnabled,
  run: createGame1TransferExpiryTickJob({
    service: game1TransferExpiryTickService,
  }),
});

// ── Mount routers ─────────────────────────────────────────────────────────────

const bingoSettingsState = {
  runtimeBingoSettings,
  get effectiveFromMs() { return bingoSettingsEffectiveFromMs; },
  set effectiveFromMs(v) { bingoSettingsEffectiveFromMs = v; },
  get pendingUpdate() { return pendingBingoSettingsUpdate; },
  set pendingUpdate(v) { pendingBingoSettingsUpdate = v; },
};

// BIN-587 B3-security: blocked-IP pre-check — registreres etter rate-
// limiter men før route-handlers. Fail-open ved DB-feil (se
// SecurityService.refreshBlockedIpCache). `/health` og `/metrics` er
// bevisst unntatt så status-probes aldri blokkeres.
const clientIpFromReq = (req: express.Request): string | null => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
};

app.use(async (req, res, next) => {
  if (req.path === "/health" || req.path === "/metrics" || req.path.startsWith("/health/")) {
    next();
    return;
  }
  const ip = clientIpFromReq(req);
  if (ip) {
    try {
      const blocked = await securityService.isIpBlocked(ip);
      if (blocked) {
        res.status(403).json({ ok: false, error: { code: "IP_BLOCKED", message: "IP-adressen er blokkert." } });
        return;
      }
    } catch (err) {
      // Fail-open: logger og lar request passere.
      console.warn("[BIN-587 B3-security] blocked-IP-sjekk feilet:", err);
    }
  }
  next();
});

// TV Screen + Winners public display. Ingen auth-middleware — kun
// tvToken-sjekk i route-handler. Mountes før alle auth-gated routere
// slik at CORS + body-parser er på, men ingen JWT-krav gjelder.
//
// Task 1.7: injiser hall-status-port for `participatingHalls`-badge-stripe.
// Adapteren duck-types `getHallStatusForGame` på `Game1HallReadyService` —
// metoden introduseres av HS-PR #451. Inntil HS-PR er merget er feature-
// detection'en false og servicen returnerer tom array (klient viser da
// ingen badge-stripe, øvrig TV-rendering uendret).
const tvScreenService = new TvScreenService({
  pool: platformService.getPool(),
  schema: pgSchema,
  hallStatusPort: {
    async getHallStatusForGame(gameId: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = game1HallReadyService as unknown as {
        getHallStatusForGame?: (gameId: string) => Promise<Array<{
          hallId: string;
          playerCount: number;
          excludedFromGame: boolean;
          color: "red" | "orange" | "green";
        }>>;
      };
      if (typeof svc.getHallStatusForGame === "function") {
        return svc.getHallStatusForGame(gameId);
      }
      return [];
    },
  },
});
app.use(
  createTvScreenRouter({
    platformService,
    tvScreenService,
    // Fase 1 MVP §24 — Screen Saver-konfig + bilde-carousel for TV-klient.
    screenSaverService,
    settingsService,
  })
);

app.use(createAuthRouter({
  platformService,
  walletAdapter,
  bankIdAdapter,
  authTokenService,
  emailService,
  auditLogService,
  webBaseUrl,
  supportEmail,
  // Sveve-SMS for forgot-password phone-flow. Faller tilbake til log-only
  // hvis SVEVE_API_USER er tom (stub-mode).
  smsService,
  pool: platformService.getPool(),
  schema: pgSchema,
  // REQ-130 (PDF 9 Frontend CR): Phone+PIN-login.
  userPinService,
  // REQ-129 + REQ-132
  twoFactorService,
  sessionService,
  // REQ-131: 90-day password rotation tracking
  passwordRotationService,
}));
app.use(createPlayersRouter({
  platformService,
  auditLogService,
}));

// GAP #5: profile + BankID image upload. Lokal storage som default —
// Cloudinary-bytte er TODO. Mappen serveres via express.static-mounten
// over (publicDir → /uploads/...) så lagrede filer er nedlastbare uten
// ytterligere routes.
const profileImageStorageDir = path.join(publicDir, "uploads", "profile-images");
const profileImageUrlPrefix = "/uploads/profile-images";
app.use(
  createPlayerProfileImageRouter({
    platformService,
    auditLogService,
    imageStorage: new LocalImageStorageAdapter({
      storageDir: profileImageStorageDir,
      urlPrefix: profileImageUrlPrefix,
    }),
  }),
);

// GAP #29: pre-join game-view validation. Player-app kaller dette FØR
// socket-rommet åpnes så feilmodi (HALL_BLOCKED, ROOM_NOT_FOUND, etc.)
// kan rendres som UX uten å rive ned realtime-kanalen.
app.use(
  createValidateGameViewRouter({
    platformService,
    profileSettingsService: profileSettingsService ?? null,
    engine,
    // Entry-fee read-out for INSUFFICIENT_BALANCE-flagg (info-only).
    // Bruker globale auto-round-default — game-spesifikke entry-fees
    // settes per scheduled-game og er ikke alltid synlige uten DB-spørring,
    // så vi defaulterer til 0 her og lar klient-laget håndtere mer
    // detaljert pris-info via game-detail-endpoint.
    getMinEntryFeeForGame: () => 0,
  }),
);

// BIN-720: Profile Settings API (PDF 8 + PDF 9 wireframes). Router wires
// kun når responsibleGamingStore er tilgjengelig (instansen konstrueres
// lenger opp i filen, sammen med job-registrering for 48h-flush-cron).
if (profileSettingsService) {
  app.use(createUserProfileRouter({
    platformService,
    profileSettingsService,
  }));
}
app.use(createAdminPlayersRouter({
  platformService,
  auditLogService,
  emailService,
  emailQueue,
  bankIdAdapter,
  webBaseUrl,
  supportEmail,
  // BIN-702 follow-up: velkomstmail med 7-dagers password-reset-lenke
  // for spillere importert via Excel/CSV (bulk-import).
  authTokenService,
  // REQ-097/098: admin block/unblock skriver til
  // app_user_profile_settings.blocked_until.
  profileSettingsService,
}));
app.use(createAdminAmlRouter({
  platformService,
  auditLogService,
  amlService,
}));
app.use(createAdminSecurityRouter({
  platformService,
  auditLogService,
  securityService,
}));
// Withdraw XML-eksport admin-endepunkter (wireframe 16.20).
app.use(createAdminWithdrawXmlRouter({
  platformService,
  auditLogService,
  xmlExportService: withdrawXmlExportService,
  accountingEmailService,
}));
app.use(createAdminPhysicalTicketsRouter({
  platformService,
  auditLogService,
  physicalTicketService,
}));
// PT1: POST /api/admin/physical-tickets/static/import — CSV-import av fysisk-bong
app.use(createAdminStaticTicketsRouter({
  platformService,
  auditLogService,
  staticTicketService,
}));
// PT2: agent (bingovert) range-registrering:
//   POST /api/admin/physical-tickets/ranges/register
//   POST /api/admin/physical-tickets/ranges/:id/close
//   GET  /api/admin/physical-tickets/ranges?agentId=&hallId=
app.use(createAdminAgentTicketRangesRouter({
  platformService,
  auditLogService,
  agentTicketRangeService,
}));
// PT4: fysisk-bong vinn-verifisering og utbetaling:
//   GET  /api/admin/physical-ticket-payouts/pending?gameId=&userId=
//   POST /api/admin/physical-ticket-payouts/:id/verify
//   POST /api/admin/physical-ticket-payouts/:id/admin-approve
//   POST /api/admin/physical-ticket-payouts/:id/confirm-payout
//   POST /api/admin/physical-ticket-payouts/:id/reject
app.use(createAdminPhysicalTicketPayoutsRouter({
  platformService,
  auditLogService,
  physicalTicketPayoutService,
}));
// BIN-641: POST /api/admin/physical-tickets/:uniqueId/check-bingo
app.use(createAdminPhysicalTicketCheckBingoRouter({
  platformService,
  physicalTicketService,
  engine,
}));
// BIN-639: POST /api/admin/physical-tickets/reward-all
app.use(createAdminPhysicalTicketsRewardAllRouter({
  platformService,
  auditLogService,
  physicalTicketService,
}));
// BIN-648: GET /api/admin/reports/physical-tickets/aggregate
app.use(createAdminReportsPhysicalTicketsRouter({
  platformService,
  physicalTicketsAggregateService,
}));
// BIN-638: GET /api/admin/physical-tickets/games/in-hall
app.use(createAdminPhysicalTicketsGamesInHallRouter({
  platformService,
  physicalTicketsGamesInHallService,
}));
// BIN-650: GET /api/admin/reports/red-flag/categories — AML red-flag
// kategorier aggregert per rule_slug i `[from, to]`-vinduet.
app.use(createAdminReportsRedFlagCategoriesRouter({
  platformService,
  amlService,
}));
app.use(createAdminVouchersRouter({
  platformService,
  auditLogService,
  voucherService,
}));
// BIN-587 B4b follow-up: player-side voucher-innløsning (HTTP fallback).
app.use(createVoucherRouter({
  platformService,
  voucherRedemptionService,
}));
app.use(createAdminGameManagementRouter({
  platformService,
  auditLogService,
  gameManagementService,
}));
// BIN-623: CloseDay — regulatorisk dagslukking per spill.
//   GET  /api/admin/games/:id/close-day-summary
//   POST /api/admin/games/:id/close-day
// POST skriver audit-log (action = "admin.game.close-day") + `app_close_day_log`-
// rad. Dobbel-lukking → 409 med kode CLOSE_DAY_ALREADY_CLOSED.
app.use(createAdminCloseDayRouter({
  platformService,
  auditLogService,
  closeDayService,
}));
// BIN-626: DailySchedule CRUD + special + subgame-details. Embedded
// GameManagement-referansen i /:id/details bruker samme service som over,
// så admin-UI kan rendre slotType/price uten separat round-trip.
app.use(createAdminDailySchedulesRouter({
  platformService,
  auditLogService,
  dailyScheduleService,
  gameManagementService,
  savedGameService,
}));
// BIN-625: Schedule CRUD (gjenbrukbare spill-maler). 4 endepunkter —
// list/detail/create/patch/delete. SCHEDULE_READ / SCHEDULE_WRITE deles
// med DailySchedule (BIN-626). AuditLog: admin.schedule.{create,update,
// delete,hard_delete}.
app.use(createAdminSchedulesRouter({
  platformService,
  auditLogService,
  scheduleService,
}));
// GAME1_SCHEDULE PR 2: per-hall ready-flow i Game 1. 3 endepunkter —
// POST /halls/:hallId/ready, POST /halls/:hallId/unready,
// GET /games/:gameId/ready-status. GAME1_HALL_READY_WRITE (ADMIN +
// HALL_OPERATOR + AGENT) + GAME1_GAME_READ. Broadcaster
// `game1:ready-status-update` til admin-UI + hall-displays.
app.use(createAdminGame1ReadyRouter({
  platformService,
  auditLogService,
  hallReadyService: game1HallReadyService,
  io,
}));
// GAME1_SCHEDULE PR 3: master-control router for Game 1. 7 endepunkter —
// POST /games/:gameId/{start,exclude-hall,include-hall,pause,resume,stop}
// + GET /games/:gameId. GAME1_MASTER_WRITE (ADMIN + HALL_OPERATOR + AGENT)
// for writes. GAME1_GAME_READ for GET.
app.use(createAdminGame1MasterRouter({
  platformService,
  auditLogService,
  masterControlService: game1MasterControlService,
  // Task 1.1 (Gap #1): wire draw-engine slik at GET /games/:gameId kan
  // returnere engineState (paused, paused_at_phase). Master-console
  // bruker feltene til å vise Resume-knapp + auto-pause-banner.
  drawEngine: game1DrawEngineService,
  io,
  jackpotStateService: game1JackpotStateService,
}));
// LOW-1: GET /api/admin/games/:gameId/replay — rekonstruert event-stream
// for Game 1 scheduled_game. Krever GAME1_GAME_READ + PLAYER_KYC_READ.
// PII-redacted i service-laget; audit-trail i admin.game.replay.read.
const game1ReplayService = new Game1ReplayService({
  pool: platformService.getPool(),
  schema: pgSchema,
});
app.use(createAdminGameReplayRouter({
  platformService,
  auditLogService,
  replayService: game1ReplayService,
}));
// Task 1.4 (2026-04-24): foren agent-portal + master-konsoll mot
// scheduled_games-paradigmet. 4 endepunkter under /api/agent/game1/* som
// gir agenten et hall-scoped view over samme state og reuser
// Game1MasterControlService + Game1HallReadyService. Master-hall-agent
// kan starte/resume direkte fra agent-portal; ikke-master-agent får 403.
app.use(createAgentGame1Router({
  platformService,
  masterControlService: game1MasterControlService,
  hallReadyService: game1HallReadyService,
  hallGroupService,
  pool: platformService.getPool(),
}));
// 2026-05-02 (Tobias UX, PDF 17 wireframe side 5): Spill 2 Choose Tickets-side.
// 2026-12-06 (v2/v3): pool persisteres til DB; POST /buy chainer pool → bet:arm
// så engine.startGame henter pool-grids via getPreRoundTicketsByPlayerId-hooken
// nedenfor. Pool slettes på game-end via engine.bingoAdapter.onGameEnded-flow.
const game2TicketPoolService = new Game2TicketPoolService({
  pool: platformService.getPool(),
});
app.use(createAgentGame2ChooseTicketsRouter({
  platformService,
  ticketPoolService: game2TicketPoolService,
  getCurrentGameIdForRoom: (roomCode) => {
    try {
      const snap = engine.getRoomSnapshot(roomCode);
      return snap.currentGame?.id ?? null;
    } catch {
      return null;
    }
  },
  // 2026-12-06 (v2): chain pool → bet:arm. POST /buy speiler purchasedIndices-
  // count inn i armed-state-mapen så `engine.startGame` ser spilleren som
  // armed med rett count. Engine-laget plukker grids via
  // `getPreRoundTicketsByPlayerId`-hooken (se under).
  armRocketPlayerFromPool: (roomCode, playerId, purchasedCount) => {
    try {
      roomState.armPlayer(roomCode, playerId, purchasedCount);
    } catch (err) {
      console.warn("[agent-game2-choose-tickets] armPlayer failed in armRocketPlayerFromPool", err);
    }
  },
}));

// Spill 2/3 perpetual auto-restart (Tobias-direktiv 2026-05-03).
// Service henger på `bingoAdapter.onGameEnded` (chained nedenfor) og
// schedulerer `engine.startGame` i ROCKET / MONSTERBINGO etter en kort
// delay slik at runden "aldri stopper". Spill 1 (`bingo`-slug) er IKKE
// perpetual og påvirkes ikke av tjenesten.
const perpetualRoundService = new PerpetualRoundService({
  enabled: perpetualLoopEnabled,
  delayMs: perpetualLoopDelayMs,
  disabledSlugs: perpetualLoopDisabledSlugs,
  engine,
  variantLookup: roomState,
  defaultTicketsPerPlayer: runtimeBingoSettings.autoRoundTicketsPerPlayer,
  defaultPayoutPercent: runtimeBingoSettings.payoutPercent,
  defaultEntryFee: runtimeBingoSettings.autoRoundEntryFee,
  emitRoomUpdate: async (roomCode) => {
    await emitRoomUpdate(roomCode);
  },
});

// 2026-12-06 (v2): game-end cleanup-hook. Slett pool fra in-memory cache + DB
// når runden er over så vi ikke akkumulerer foreldede pools. Vi monkey-patcher
// `localBingoAdapter.onGameEnded` her (etter pool-service er konstruert) for
// å unngå konstruksjons-rekkefølge-problemer (engine konstrueres på linje 603,
// før poolen finnes). Wrapping bevarer eksisterende adapter-oppførsel
// (game_sessions UPDATE for PostgresBingoSystemAdapter, no-op for Local).
//
// 2026-05-03: chained perpetual-loop-trigger inn samme wrapper. Rekkefølge:
//   1) underlying adapter (game_sessions UPDATE)
//   2) Spill 2 ticket-pool cleanup
//   3) PerpetualRoundService.handleGameEnded (scheduler ny runde for Spill 2/3)
// Alle tre er fail-soft. Perpetual er sist så pool-cleanup skjer FØR vi
// scheduler ny runde — det betyr at spillere som vil delta i neste Spill 2
// runde må besøke Choose Tickets på nytt (forrige pool er borte).
{
  const originalOnGameEnded = localBingoAdapter.onGameEnded?.bind(localBingoAdapter);
  // Always set — vi vil at hooken skal trigge selv om underlying adapter
  // ikke har en egen onGameEnded (LocalBingoSystemAdapter har en no-op,
  // PostgresBingoSystemAdapter har faktisk persistens).
  localBingoAdapter.onGameEnded = async (input) => {
    if (originalOnGameEnded) {
      try {
        await originalOnGameEnded(input);
      } catch (err) {
        console.warn("[bingoAdapter.onGameEnded] underlying adapter failed", err);
      }
    }
    // Best-effort pool cleanup — fail-soft fordi adapter-cleanup ikke skal
    // blokkeres av Spill 2-pool-state.
    try {
      await game2TicketPoolService.deletePoolForGame(input.gameId);
    } catch (err) {
      console.warn("[game2-ticket-pool] deletePoolForGame failed in onGameEnded", err);
    }
    // Perpetual auto-restart for Spill 2/3 — fail-soft synchronous trigger
    // (selve restart-en er asynkron via setTimeout inni servicen).
    try {
      perpetualRoundService.handleGameEnded(input);
    } catch (err) {
      console.warn("[perpetual-round] handleGameEnded failed", err);
    }
  };
}
// REQ-101/146: agent manuell mini-game-trigger (fallback for når
// auto-trigger feilet eller admin endret config midt-runde).
app.use(createAgentGame1MiniGameRouter({
  platformService,
  agentService,
  agentShiftService,
  miniGameOrchestrator: game1MiniGameOrchestrator,
  auditLogService,
  pool: platformService.getPool(),
}));
// Task 1.6: runtime master-overføring — 4 endepunkter (request/approve/
// reject/GET active). Broadcast-hooks wires up nedenfor etter
// adminGame1Handle eksisterer.
const adminGame1MasterTransferBroadcastHooks = {
  onRequestCreated: undefined as
    | ((r: import("./game/Game1TransferHallService.js").TransferRequest) => void)
    | undefined,
  onApproved: undefined as
    | ((p: {
        request: import("./game/Game1TransferHallService.js").TransferRequest;
        previousMasterHallId: string;
        newMasterHallId: string;
      }) => void)
    | undefined,
  onRejected: undefined as
    | ((r: import("./game/Game1TransferHallService.js").TransferRequest) => void)
    | undefined,
};
app.use(createAdminGame1MasterTransferRouter({
  platformService,
  transferService: game1TransferHallService,
  broadcastHooks: adminGame1MasterTransferBroadcastHooks,
}));
// GAME1_SCHEDULE PR 4a: ticket-purchase-router for Game 1. 3 endepunkter —
// POST /api/game1/purchase, POST /api/game1/purchase/:id/refund,
// GET /api/game1/purchase/game/:scheduledGameId. Player-path (digital_wallet)
// og agent-path (cash_agent/card_agent) deler samme handler — auth-route
// differensierer på role + hall-scope.
app.use(createGame1PurchaseRouter({
  platformService,
  purchaseService: game1TicketPurchaseService,
  // PILOT-STOP-SHIP (Code Review #5 P0-1, 2026-04-28): engine brukes til
  // å gate REST-purchase mot self-exclusion / pause / loss-limit FØR
  // wallet-debit. Speiler pattern fra socket-laget.
  engine,
}));
// BIN-627: Pattern CRUD + dynamic-menu. Aktiverer Agent A's
// patternManagement-placeholder-sider fra PR-A3a (3 sider) og brukes av
// Game3Engine runtime pattern-matching (mask-feltet).
app.use(createAdminPatternsRouter({
  platformService,
  auditLogService,
  patternService,
}));
// BIN-665: HallGroup CRUD. 5 endepunkter — list/detail/create/patch/delete.
// Lukker BIN-617 dashboard-widget + aktiverer PR-A5 groupHall-placeholder.
app.use(createAdminHallGroupsRouter({
  platformService,
  auditLogService,
  hallGroupService,
}));
// BIN-620: GameType CRUD. 5 endepunkter — list/detail/create/patch/delete.
// Global admin-katalog av spill-typer. GAME_TYPE_WRITE er ADMIN-only
// (matches GAME_CATALOG_WRITE) fordi spill-typer påvirker hele systemet.
app.use(createAdminGameTypesRouter({
  platformService,
  auditLogService,
  gameTypeService,
}));
// BIN-621: SubGame CRUD. 5 endepunkter — list/detail/create/patch/delete.
// Gjenbrukbare pattern-bundles brukt av DailySchedule. SUB_GAME_WRITE er
// ADMIN + HALL_OPERATOR (matches PATTERN_WRITE / SCHEDULE_WRITE).
app.use(createAdminSubGamesRouter({
  platformService,
  auditLogService,
  subGameService,
}));
// Agent IJ — Innsatsen-jackpot: per-hall pot-administrasjon (Game1PotService).
// 5 endepunkter — list/detail/init/patch-config/reset. HALL_GAME_CONFIG_READ/WRITE.
// Legacy Innsatsen-potten (dailySchedule.innsatsenSales + subGame.jackpotDraw) er
// normalisert til app_game1_accumulating_pots — denne ruteren gir admin-UI
// tilgang til pot-config + manuell reset.
app.use(createAdminGame1PotsRouter({
  platformService,
  auditLogService,
  potService: game1PotService,
}));
// BIN-668: LeaderboardTier CRUD. 5 endepunkter — list/detail/create/patch/
// delete. Admin-konfigurert plass→premie/poeng-mapping.
// LEADERBOARD_TIER_WRITE er ADMIN-only (matches GAME_TYPE_WRITE /
// GAME_CATALOG_WRITE). Uavhengig av runtime /api/leaderboard.
app.use(createAdminLeaderboardTiersRouter({
  platformService,
  auditLogService,
  leaderboardTierService,
}));
// BIN-700: Loyalty-system. 9 endepunkter — tier-CRUD (5) + player-state
// list/detail (2) + points-award + tier-override. Persistent tier-hierarki
// (bronze/silver/gold/platinum) + per-spiller points-aggregat. Uavhengig av
// BIN-668 leaderboard-tier (plass-basert wins → premie). LOYALTY_WRITE er
// ADMIN-only; manuell points-award + tier-override er audit-logget.
app.use(createAdminLoyaltyRouter({
  platformService,
  auditLogService,
  loyaltyService,
}));
// BIN-679: MiniGames config CRUD. 8 endepunkter — GET + PUT for wheel,
// chest, mystery, colordraft. Admin-konfig av Game 1 mini-spillene;
// runtime-integrasjonen i Game 1 bruker hardkodede prize-arrays i dag
// (BingoEngine.MINIGAME_PRIZES) — wiring til denne tabellen er egen PR.
// MINI_GAMES_WRITE er ADMIN-only (matches GAME_CATALOG_WRITE /
// LEADERBOARD_TIER_WRITE). AuditLog-action:
// admin.mini_games.<gameType>.update.
app.use(createAdminMiniGamesRouter({
  platformService,
  auditLogService,
  miniGamesConfigService,
}));
// BIN-624: SavedGame CRUD. 6 endepunkter — list/detail/create/patch/
// delete/load-to-game. Templates for GameManagement-oppsett (kopieres ved
// load-to-game). SAVED_GAME_WRITE er ADMIN + HALL_OPERATOR (matches
// SUB_GAME_WRITE mønsteret). Lukker BIN-624 + aktiverer PR-A3
// savedGame-sidene (placeholder-state i apps/admin-web).
app.use(createAdminSavedGamesRouter({
  platformService,
  auditLogService,
  savedGameService,
  dailyScheduleService,
}));
// BIN-677: System settings + maintenance. To routere — GET/PATCH /api/admin/
// settings (key-value registry-backed) + GET/POST/PUT /api/admin/maintenance
// (vindu-basert). Begge bruker ADMIN-only WRITE (HALL_OPERATOR styrer per-hall
// via adminHalls.ts). AuditLog: admin.settings.update +
// admin.maintenance.{create,activate,deactivate,update}.
app.use(createAdminSettingsRouter({
  platformService,
  auditLogService,
  settingsService,
}));
// GAP #23: Screen-saver bilde-CRUD + reorder. SETTINGS_READ for GET,
// SETTINGS_WRITE (ADMIN-only) for skriving. Image-URL leveres av admin-UI
// (klient-side Cloudinary upload eller manuelt URL-felt). Server-side
// upload-flyt er TODO når CLOUDINARY_*-env er klare.
app.use(createAdminScreenSaverRouter({
  platformService,
  auditLogService,
  screenSaverService,
}));
app.use(createAdminMaintenanceRouter({
  platformService,
  auditLogService,
  maintenanceService,
}));
// BIN-678: system-info (runtime-diagnostikk). Rolle: SETTINGS_READ. Read-only.
app.use(createAdminSystemInfoRouter({ platformService }));
// BIN-655: generisk transaksjons-logg (union over wallet_transactions +
// app_agent_transactions + payment-requests). Rolle: PLAYER_KYC_READ.
// Cursor-paginert (base64url-offset, samme mønster som BIN-647).
app.use(createAdminTransactionsRouter({
  platformService,
  pool: platformService.getPool(),
  schema: pgSchema,
}));
// BIN-655: audit-log UI-endpoint (read-only). Rolle: AUDIT_LOG_READ.
// Wraps AuditLogService.list med cursor-paginering og `resource`/`action`/
// `actorId`/`from`/`to`-filter. Separat fra /api/admin/audit/events (som
// ligger i adminSecurity.ts fra BIN-587 B3) slik at frontend kan lene seg
// på én stabil shape med nextCursor.
app.use(createAdminAuditLogRouter({
  platformService,
  auditLogService,
}));
// HIGH-11: chat-moderasjon — søk + soft-delete av chat-meldinger for
// hall-operator/admin (Casino Review-finding). Pengespillforskriften §13
// + AML-regler krever at moderator kan dokumentere sletting (mobbing,
// hvitvasking, child-exposure). Audit-action: admin.chat.delete.
app.use(createAdminChatModerationRouter({
  platformService,
  auditLogService,
  chatMessageStore,
}));
// BIN-676: CMS content + FAQ. 6 endepunkter — tekst-CRUD for fem slugs +
// FAQ-CRUD. CMS_WRITE er ADMIN-only (CMS er globalt/regulatorisk-sensitivt,
// matches SETTINGS_WRITE / LEADERBOARD_TIER_WRITE). PUT /api/admin/cms/
// responsible-gaming returnerer HTTP 400 + FEATURE_DISABLED inntil BIN-680
// implementerer versjons-historikk (pengespillforskriften §11). Audit-
// actions: admin.cms.update + admin.cms.faq.{create,update,delete}.
app.use(createAdminCmsRouter({
  platformService,
  auditLogService,
  cmsService,
}));
// Public (un-authenticated) CMS endpoints — regulatorisk krav: spillere
// må kunne lese T&C / FAQ / responsible-gaming UTEN konto. Routeren
// håndhever publish-status (regulatoriske slugs trenger live-versjon;
// ikke-regulatoriske trenger ikke-tom innhold) og legger på
// Cache-Control: public, max-age=300 for å avlaste backenden.
app.use(createPublicCmsRouter({ cmsService }));
// BIN-791: Public status page — offentlig /status (HTML) + /api/status*.
// Ingen auth — status-siden må fungere selv når andre tjenester er nede.
const statusBootstrap = bootstrapStatusPage({
  pool: platformService.getPool(),
  schema: pgSchema,
  platformService,
  walletAdapter,
  engine,
});
app.get("/status", (_req, res) => res.sendFile(path.join(publicDir, "status.html")));
app.use(createPublicStatusRouter(statusBootstrap));
// BIN-628: admin track-spending aggregat (regulatorisk P2 — pengespill-
// forskriften §11). Gjenbruker de samme env-var-drevne loss-limitene som
// BingoEngine er konstruert med (`bingoDailyLossLimit` / `bingoMonthlyLossLimit`)
// så regulatorisk tak presentert i UI matcher tak som håndheves per spill.
// `hallOverrides` står tomt p.t. — per-hall-konfig lander som egen PR
// (BIN-661 placeholder). `getDataAgeMs` returnerer 0 inntil cache-lag er
// på plass; fail-closed-mekanikken er verifisert, men triggres ikke i prod
// før cache introduserer staleness.
app.use(createAdminTrackSpendingRouter({
  platformService,
  auditLogService,
  engine,
  regulatoryLimits: {
    daily: bingoDailyLossLimit,
    monthly: bingoMonthlyLossLimit,
  },
  hallOverrides: [],
  getDataAgeMs: () => 0,
}));
app.use(createAdminUniqueIdsAndPayoutsRouter({
  platformService,
  auditLogService,
  physicalTicketService,
  engine,
}));
app.use(createAdminUsersRouter({
  platformService,
  auditLogService,
  authTokenService,
  emailService,
  webBaseUrl,
  supportEmail,
}));
app.use(createAdminPlayerActivityRouter({
  platformService,
  walletAdapter,
  engine,
  auditLogService,
}));

// GAP #16 (BACKEND_1TO1_GAP_AUDIT_2026-04-24): manual-winning admin override.
//   POST /api/admin/games/:gameId/manual-winning
// Strict ADMIN-only via EXTRA_PRIZE_AWARD. Routes through engine.awardExtraPrize
// (legitim payout-flow med EXTRA_PRIZE compliance-entry) — NEVER direct
// admin-credit til winnings (per ADMIN_WINNINGS_CREDIT_FORBIDDEN).
app.use(createAdminGameOversightRouter({
  platformService,
  engine,
  auditLogService,
  emitWalletRoomUpdates,
}));

// BIN-583 B3.1: agent auth/shift + admin agent-CRUD.
//
// P0-2 (REGULATORISK — pengespillforskriften): `createAgentRouter` er flyttet
// ned til etter `agentSettlementService` er konstruert (~100 linjer ned),
// siden /shift/end + /shift/logout nå må kunne sjekke om settlement finnes
// før termination. Søk etter "P0-2-wired createAgentRouter" for det faktiske
// app.use-kallet. Admin-CRUD-routeren ligger her som før.
app.use(createAdminAgentsRouter({
  platformService,
  agentService,
  agentShiftService,
  auditLogService,
}));
// Role Management — per-agent permission-matrix (Admin CR 21.02.2024 side 5).
app.use(createAdminAgentPermissionsRouter({
  platformService,
  agentService,
  agentPermissionService,
  auditLogService,
}));

// BIN-583 B3.2: agent cash-ops + ticket sale + transaction log.
// PhysicalTicketService (B4a) instansieres over — vi bygger opp
// transaction-servicen her slik at alle dependencies er klare.
const physicalTicketReadPort = new PostgresPhysicalTicketReadPort({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const agentTransactionService = new AgentTransactionService({
  platformService,
  walletAdapter,
  physicalTicketService,
  physicalTicketReadPort,
  ticketPurchasePort,
  agentService,
  agentShiftService,
  agentStore,
  transactionStore: agentTransactionStore,
  // GAME1_SCHEDULE PR 2: purchase-cutoff-port. assertPurchaseOpenForHall
  // kaster PURCHASE_CLOSED_FOR_HALL når bingovert har trykket klar for
  // gameId+hallId. Kalles både ved fysisk salg (assignedGameId) og digital
  // register-ticket. Legacy games uten schedule passerer (ingen row).
  game1PurchaseCutoff: {
    assertPurchaseOpenForHall: (gameId: string, hallId: string) =>
      game1HallReadyService.assertPurchaseOpenForHall(gameId, hallId),
  },
});
app.use(createAgentTransactionsRouter({
  platformService,
  agentService,
  agentTransactionService,
  auditLogService,
}));

// Agent dashboard + player-list + CSV-eksport. Samme AGENT_TX_READ-rbac
// som `agentTransactions.ts` — kun AGENT-rollen kan bruke disse endepunktene.
app.use(createAgentDashboardRouter({
  platformService,
  agentService,
  agentShiftService,
  agentTransactionStore,
  auditLogService,
}));

// Agent-portal skeleton (feat/agent-portal-skeleton): /api/agent/context.
// AGENT + HALL_OPERATOR — gir assigned halls + coarse capabilities for
// admin-web's Agent-portal header/side-nav.
app.use(createAgentContextRouter({
  platformService,
  agentService,
}));

// BIN-583 B3.3: agent + admin daily-cash-settlement (close-day, edit, PDF).
const agentSettlementStore = new PostgresAgentSettlementStore({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const hallCashLedger = new PostgresHallCashLedger({
  pool: platformService.getPool(),
  schema: pgSchema,
});

// Tobias 2026-04-27 (pilot-test feedback): pre-flight validator for
// `POST /api/admin/rooms/:roomCode/start`. Sikrer at hallen tilhører en
// aktiv hall-gruppe (link) og at minst én aktiv daily-schedule målretter
// hallen før engine.startGame kjøres. Se RoomStartPreFlightValidator.ts
// for full kontrakt + feilkoder (HALL_NOT_IN_GROUP / NO_SCHEDULE_FOR_HALL_GROUP).
const roomStartPreFlightValidator = new RoomStartPreFlightValidator({
  pool: platformService.getPool(),
  schema: pgSchema,
});

const agentSettlementService = new AgentSettlementService({
  platformService,
  agentService,
  agentShiftService,
  agentStore,
  transactionStore: agentTransactionStore,
  settlementStore: agentSettlementStore,
  hallCashLedger,
});

// P0-2-wired createAgentRouter: passer `agentSettlementService` så
// `/shift/end` og `/shift/logout` blokkerer termination dersom
// settlement-rad mangler for inneværende skift (pengespillforskriften
// krever Settlement Report før termination). Audit-event
// `agent.shift.terminate_blocked_no_settlement` skrives når blokkering
// trer i kraft (Lotteritilsynet-bevis).
app.use(createAgentRouter({
  platformService,
  agentService,
  agentShiftService,
  agentSettlementService,
  auditLogService,
}));

app.use(createAgentSettlementRouter({
  platformService,
  agentService,
  agentSettlementService,
  agentShiftService,
  auditLogService,
}));

// BIN-583 B3.6: produkt-katalog + hall-assignment + agent sale-flyt.
const productService = new ProductService({
  pool: sharedPool,
  schema: pgSchema,
});
const agentProductSaleService = new AgentProductSaleService({
  pool: sharedPool,
  schema: pgSchema,
  platformService,
  walletAdapter,
  agentService,
  agentShiftService,
  agentStore,
  transactionStore: agentTransactionStore,
});
app.use(createAdminProductsRouter({
  platformService,
  auditLogService,
  productService,
}));
app.use(createAgentProductsRouter({
  platformService,
  auditLogService,
  agentService,
  agentShiftService,
  productService,
  productSaleService: agentProductSaleService,
}));

// BIN-583 B3.4: Metronia external-machine integration.
// StubClient default-er når METRONIA_API_URL mangler (lokal-dev/CI uten
// ekte API). Real HttpClient brukes når env er satt.
const metroniaApiUrl = (process.env.METRONIA_API_URL ?? "").trim();
const metroniaClient: MetroniaApiClient = metroniaApiUrl
  ? new HttpMetroniaApiClient({
      baseUrl: metroniaApiUrl,
      apiToken: (process.env.METRONIA_API_TOKEN ?? "").trim(),
      tlsRejectUnauthorized: (process.env.METRONIA_TLS_REJECT_UNAUTHORIZED ?? "true") !== "false",
      timeoutMs: Number.parseInt(process.env.METRONIA_TIMEOUT_MS ?? "10000", 10),
    })
  : new StubMetroniaApiClient();
const machineTicketStore = new PostgresMachineTicketStore({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const metroniaTicketService = new MetroniaTicketService({
  platformService,
  walletAdapter,
  agentService,
  agentShiftService,
  transactionStore: agentTransactionStore,
  machineTicketStore,
  metroniaClient,
});
app.use(createAgentMetroniaRouter({
  platformService,
  agentService,
  metroniaTicketService,
  auditLogService,
}));

// BIN-583 B3.8: agent open-day + admin hall-account-reports.
const agentOpenDayService = new AgentOpenDayService({
  agentService,
  agentShiftService,
  agentStore,
  hallCashLedger,
  settlementStore: agentSettlementStore,
});
const hallAccountReportService = new HallAccountReportService({
  pool: sharedPool,
  schema: pgSchema,
  engine,
});
app.use(createAgentOpenDayRouter({
  platformService,
  auditLogService,
  agentService,
  agentShiftService,
  openDayService: agentOpenDayService,
  reportService: hallAccountReportService,
}));
app.use(createAdminHallReportsRouter({
  platformService,
  auditLogService,
  reportService: hallAccountReportService,
}));
// REQ-143: aggregert per-group-of-hall hall-account-rapport. Multi-hall-
// operatorer (HALL_OPERATOR med medlemskap) ser kun grupper hvor egen hall
// er medlem; ADMIN/SUPPORT ser alle grupper. Aggregerer daily/monthly/balance
// over alle medlemshaller per (date, gameType).
app.use(createAdminGroupHallReportsRouter({
  platformService,
  hallGroupService,
  reportService: hallAccountReportService,
}));
app.use(createAdminReportsSubgameDrillDownRouter({
  platformService,
  engine,
}));
// BIN-BOT-01: "Report Management Game 1" aggregate-rapport (OMS/UTD/Payout%/RES
// per sub-game). Filtre: fra/til dato, group-of-hall, hall, type (player|bot),
// fritekst-søk. HALL_OPERATOR auto-scope til egen hall. Read-only.
app.use(createAdminReportsGame1ManagementRouter({
  platformService,
  engine,
  hallGroupService,
}));
// GAP #28: per-spilltype-spesifikke rapport-shapes
// (Spill 1 bingo / Spill 2 rocket / Spill 3 monsterbingo / SpinnGo
// spillorama). Game 4 (themebingo) avvist — deprecated per BIN-496.
// CSV-export via ?format=csv. HALL_OPERATOR auto-scope.
app.use(createAdminReportsGameSpecificRouter({
  platformService,
  engine,
}));
// BIN-17.36: "Hall Specific Report" (admin) — per-hall aggregat med
// Elvis Replacement (PM-låst Appendix B) + Game 1-5 OMS/UTD/Payout%/RES.
app.use(createAdminReportsHallSpecificRouter({
  platformService,
  engine,
  hallGroupService,
  agentService,
}));
// BIN-17.32: "Past Game Winning History" (agent) — vinner-historikk per hall.
app.use(createAgentReportsPastWinningRouter({
  platformService,
  agentService,
  agentShiftService,
  staticTicketService,
}));
// PDF 17 §17.29-§17.32: Agent history-lists — Order History (product sales),
// Order Detail, Sold Tickets list, Winnings History (alias).
app.use(createAgentHistoryListsRouter({
  platformService,
  agentService,
  agentShiftService,
  productSaleService: agentProductSaleService,
  staticTicketService,
}));
// BIN-651: red-flag players report (AML + regulatorisk AuditLog on view).
// Paginert liste over red-flaggede spillere med flag-årsak + siste aktivitet.
// Skriver `admin.report.red_flag_players.viewed` til AuditLog ved vellykket
// lesning (pengespillforskriften §11).
app.use(createAdminReportsRedFlagPlayersRouter({
  platformService,
  auditLogService,
  amlService,
  engine,
}));
// BIN-618: top-players dashboard-widget (GET /api/admin/players/top).
// Lukker TopPlayersBox-gap i admin-web (rendrer "—" i dag). Ranker
// eligible PLAYER-rader etter gjeldende wallet-balance desc — matcher
// legacy Dashboard.js:120-127. Read-only, ingen AuditLog.
app.use(createAdminPlayersTopRouter({
  platformService,
  walletAdapter,
}));

// BIN-583 B3.5: OK Bingo external-machine integration.
// Real impl bruker SQL Server polling-protokoll (COM3-tabell).
// Stub default-er når OKBINGO_SQL_CONNECTION mangler — lokal-dev/CI.
const okbingoSqlConnection = (process.env.OKBINGO_SQL_CONNECTION ?? "").trim();
const okBingoClient: OkBingoApiClient = okbingoSqlConnection
  ? new SqlServerOkBingoApiClient({
      connectionString: okbingoSqlConnection,
      defaultBingoId: Number.parseInt(process.env.OKBINGO_BINGO_ID ?? "247", 10),
      pollIntervalMs: Number.parseInt(process.env.OKBINGO_POLL_INTERVAL_MS ?? "1000", 10),
      pollMaxAttempts: Number.parseInt(process.env.OKBINGO_POLL_MAX_ATTEMPTS ?? "10", 10),
    })
  : new StubOkBingoApiClient();
const okBingoTicketService = new OkBingoTicketService({
  platformService,
  walletAdapter,
  agentService,
  agentShiftService,
  transactionStore: agentTransactionStore,
  machineTicketStore,
  okBingoClient,
  defaultRoomId: Number.parseInt(process.env.OKBINGO_BINGO_ID ?? "247", 10),
});
app.use(createAgentOkBingoRouter({
  platformService,
  agentService,
  okBingoTicketService,
  auditLogService,
}));

// Agent-portal Check-for-Bingo + Physical Cashout (P0 pilot-blokker).
//   POST /api/agent/bingo/check              — sjekk billett mot game-state
//   GET  /api/agent/physical/pending         — liste stemplede vinnere (ikke utbetalt)
//   POST /api/agent/physical/reward-all      — bulk-utbetaling
//   POST /api/agent/physical/:uniqueId/reward — per-billett utbetaling
app.use(createAgentBingoRouter({
  platformService,
  physicalTicketService,
  agentService,
  agentShiftService,
  auditLogService,
  engine,
}));

// BIN-GAP#4: Register Sold Tickets scanner (wireframe 15.2/17.15).
//   GET  /api/agent/ticket-registration/:gameId/initial-ids
//   POST /api/agent/ticket-registration/:gameId/final-ids
//   GET  /api/agent/ticket-registration/:gameId/summary
app.use(createAgentTicketRegistrationRouter({
  platformService,
  agentService,
  agentShiftService,
  auditLogService,
  ticketRegistrationService,
  game1HallReadyService,
}));

// REQ-101 (PDF 17 §17.24): inline Add Physical Ticket popup.
//   POST /api/agent/physical-tickets/inline-register
app.use(createAgentPhysicalTicketsInlineRouter({
  platformService,
  agentService,
  agentShiftService,
  auditLogService,
  agentPhysicalTicketInlineService,
}));

// REQ-146 (PDF 17 §17.23): agent-input for mini-game-winnings (Spin/Chest/
// Mystery/ColorDraft) på vegne av spilleren.
//   POST /api/agent/games/:gameId/mini-game-winning
app.use(createAgentMiniGameWinningRouter({
  platformService,
  agentService,
  agentShiftService,
  auditLogService,
  agentMiniGameWinningService,
}));

// Wireframe gaps #8/#10/#11 (2026-04-24): Agent Unique ID cards flow.
// Covers V1.0 wireframes 17.9 (Create), 17.10 (Add Money),
// 17.11/17.28 (Withdraw), 17.26 (Details + Re-Generate).
const uniqueIdStore = new PostgresUniqueIdStore({
  pool: platformService.getPool(),
  schema: pgSchema,
});
const uniqueIdService = new UniqueIdService({
  store: uniqueIdStore,
  agentService,
});
app.use(createAgentUniqueIdsRouter({
  platformService,
  agentService,
  uniqueIdService,
  auditLogService,
}));

// BIN-582: Metronia/OK-Bingo auto-close-cron. Registeres her fordi den
// trenger begge ticket-services + machineTicketStore (som ikke er
// konstruert på tidspunktet de andre jobbene registeres på linje ~854).
// JobScheduler.start() kalles etter alle register()-kallene.
jobScheduler.register({
  name: "machine-ticket-auto-close",
  description: "Daily auto-close of hanging Metronia/OK-Bingo tickets (BIN-582 legacy cron port).",
  intervalMs: jobMachineAutoCloseIntervalMs,
  enabled: jobMachineAutoCloseEnabled,
  run: createMachineTicketAutoCloseJob({
    machineTicketStore,
    metroniaService: metroniaTicketService,
    okBingoService: okBingoTicketService,
    auditLogService,
    runAtHourLocal: jobMachineAutoCloseRunAtHour,
    maxTicketAgeHours: jobMachineAutoCloseMaxAgeHours,
  }),
});

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
  // 2026-05-02 (Tobias UX): én rom per group-of-halls — admin-routes
  // bruker dette til å derivere kanonisk rom-kode + filtrere shared rooms.
  getHallGroupIdForHall: async (hallId: string): Promise<string | null> => {
    try {
      const groups = await hallGroupService.list({ hallId, limit: 1, status: "active" });
      return groups[0]?.id ?? null;
    } catch {
      return null;
    }
  },
  resolveBingoHallGameConfigForRoom,
  // BIN-694: wire default variant-config (5-phase Norsk bingo for Game 1)
  // at admin room-create so `meetsPhaseRequirement` gets the correct
  // pattern names instead of falling back to the legacy 1-line rule.
  bindDefaultVariantConfig: (code, slug) => roomState.bindDefaultVariantConfig(code, slug),
  // PR C: async binder som leser admin-UI-config (config.spill1) fra
  // GameManagement når `gameManagementId` sendes inn. Fetcher-hooken
  // holder RoomStateManager fri for service-avhengighet — her kobles
  // den til den faktiske GameManagementService-instansen.
  // HV-2: `fetchSpill1HallFloors` injiseres så binderen kan applisere
  // hall-default floors som baseline `minPrize` på Spill 1-patterns.
  bindVariantConfigForRoom: (code, opts) =>
    roomState.bindVariantConfigForRoom(code, {
      ...opts,
      fetchGameManagementConfig: fetchGameManagementConfigForRoomState,
      fetchSpill1HallFloors: fetchSpill1HallFloorsForRoomState,
    }),
  auditLogService,
  emailService,
  supportEmail,
  hallCashLedger,
  // Tobias 2026-04-27 (pilot-test feedback): pre-flight validator for
  // POST /api/admin/rooms/:roomCode/start.
  roomStartPreFlightValidator,
  // HV2-B3: per-hall Spill 1 default gevinst-floors. Service eksponeres
  // til admin-routeren for CRUD-endpoints. Engine-integrasjonen går
  // via `fetchSpill1HallFloors`-hooken over (samme service-instans).
  spill1PrizeDefaultsService,
}));

app.use(createWalletRouter({ platformService, engine, walletAdapter, swedbankPayService, emitWalletRoomUpdates }));
// PR-W2 wallet-split: admin-correction-endepunkt med regulatorisk gate
// mot winnings-kredit (pengespillforskriften §11).
app.use(createAdminWalletRouter({ platformService, walletAdapter, emitWalletRoomUpdates, walletAuditVerifier }));
// BIN-763: nightly wallet reconciliation admin-endpoints (list/resolve/run-now).
app.use(
  createAdminWalletReconciliationRouter({
    platformService,
    reconciliationService: walletReconciliationService,
    auditLogService,
  }),
);

// Tobias 2026-04-27: ADMIN Super-User Operations Console (`/admin/ops`).
// Live ops-dashboard på tvers av alle haller — overvåking + intervensjon.
//
// HISTORIKK: Route-fil (`apps/backend/src/routes/adminOps.ts`) + service
// (`apps/backend/src/admin/AdminOpsService.ts`) ble merget til main via
// PR #667. Frontend (PR #668) ble merget. Wire-up til index.ts ble glemt
// (var i PR #667-branch men ikke flyttet ved merge) — så endpoint
// /api/admin/ops/overview returnerte SPA-fallback HTML med HTTP 200, og
// klienten viste «Feil: HTTP 200» fordi `response.json()` ikke kunne
// parse HTML. Denne wire-up retter feilen.
const adminOpsService = new AdminOpsService({
  pool: platformService.getPool(),
  schema: pgSchema,
  platformService,
  engine,
  hallGroupService,
  reconciliationService: walletReconciliationService,
  paymentRequestService,
});
app.use(
  createAdminOpsRouter({
    platformService,
    engine,
    adminOpsService,
    auditLogService,
    emitRoomUpdate,
    broadcastOpsUpdate: (
      kind: AdminOpsBroadcastKind,
      payload?: Record<string, unknown>,
    ) => {
      io.to("admin:ops").emit("admin:ops:update", {
        kind,
        payload: payload ?? {},
        at: new Date().toISOString(),
      });
    },
  }),
);

app.use(createPaymentsRouter({
  platformService,
  swedbankPayService,
  emitWalletRoomUpdates,
  // BIN-603: HMAC-verifisering av Swedbank webhook. Tom secret → callback
  // fail-closed med 503 slik at ops merker det med én gang i prod.
  swedbankWebhookSecret: (process.env.SWEDBANK_WEBHOOK_SECRET ?? "").trim(),
}));
app.use(
  createPaymentRequestsRouter({
    platformService,
    paymentRequestService,
    emitWalletRoomUpdates,
    // HV2-A / BIR-036: 50 000 kr/dag/hall kontant-cap.
    cashWithdrawalCapService,
    auditLogService,
  })
);
app.use(createGameRouter({ platformService, engine, drawScheduler, emitRoomUpdate, buildRoomUpdatePayload, assertUserCanAccessRoom, assertUserCanActAsPlayer }));

// BIN-FCM: notifikasjons-endpoints. Player-facing (/api/notifications*)
// + admin-broadcast (/api/admin/notifications/broadcast).
app.use(createNotificationsRouter({ platformService, fcmPushService }));
app.use(createAdminNotificationsRouter({
  platformService,
  fcmPushService,
  auditLogService,
  pool: platformService.getPool(),
  schema: pgSchema,
}));

// Sveve SMS-broadcast for ADMIN — sender SMS til spesifiserte spillere via
// app_users.phone-lookup. Audit-loggen masker telefonnumre + utelater
// melding-innhold (kun lengde) for å unngå PII-lekkasje.
app.use(createAdminSmsBroadcastRouter({
  platformService,
  smsService,
  auditLogService,
  pool: platformService.getPool(),
  schema: pgSchema,
}));

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
  // Per-dependency try/catch so a single failing subsystem doesn't 500 the
  // whole endpoint. Render's health probe only cares about HTTP 200 + reachable;
  // full subsystem-status lives in the JSON body. Failed subsystems get
  // `status: "error"` + message so ops can see what's degraded.
  const checks: Record<string, unknown> = { timestamp: new Date().toISOString() };
  async function safe<T>(name: string, fn: () => Promise<T> | T): Promise<void> {
    try { checks[name] = await fn(); }
    catch (err) {
      console.error(`[/health] ${name} failed:`, err);
      checks[name] = { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }
  await Promise.all([
    safe("wallets", async () => (await walletAdapter.listAccounts()).length),
    safe("games", async () => (await platformService.listGames({ includeDisabled: true })).length),
    safe("halls", async () => (await platformService.listHalls({ includeInactive: true })).length),
    safe("rooms", () => engine.getAllRoomCodes().length),
    safe("drawScheduler", () => drawScheduler.healthSummary()),
  ]);
  checks.walletProvider = walletRuntime.provider;
  checks.swedbankConfigured = swedbankPayService.isConfigured();
  res.json({ ok: true, data: checks });
});

app.get("/health/draw-engine", (_req, res) => {
  const isLocalhost = _req.ip === "127.0.0.1" || _req.ip === "::1" || _req.ip === "::ffff:127.0.0.1";
  const hasToken = _req.headers.authorization === `Bearer ${process.env.ADMIN_API_TOKEN ?? ""}`;
  if (!isLocalhost && !hasToken && process.env.NODE_ENV === "production") { res.status(403).json({ ok: false, error: "Forbidden" }); return; }
  apiSuccess(res, drawScheduler.healthSummary(true));
});

/**
 * 2026-05-03 (Tobias-direktiv) — Manual reset-test-user endpoint.
 *
 * Boot-script via RESET_TEST_PLAYERS=true env-var fungerer ikke på
 * Render-prod (logene kommer ikke ut, og scriptet feiler stille). Denne
 * HTTP-routen lar Tobias trigge reset manuelt og se nøyaktig hva som
 * skjer i HTTP-responsen.
 *
 * Sikkerhet: krever match på POST-body `{token}` mot
 * `RESET_TEST_PLAYERS_TOKEN`-env-var. Kun på prod; ingen rate-limit.
 */
app.post("/api/_dev/reset-test-user", async (req, res) => {
  const expectedToken = process.env.RESET_TEST_PLAYERS_TOKEN ?? "";
  const providedToken = typeof req.body?.token === "string" ? req.body.token : "";
  if (!expectedToken || providedToken !== expectedToken) {
    res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Invalid token" } });
    return;
  }
  try {
    const result = await resetTestPlayers({
      pool: platformService.getPool(),
      schema: pgSchema,
    });
    res.json({
      ok: true,
      data: {
        deleted: result.deletedCount,
        testUser: {
          email: result.testUser.email,
          hallId: result.testUser.hallId,
          deposit: result.testUser.depositKr,
          created: result.testUser.created,
        },
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: {
        code: "RESET_FAILED",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 10) : undefined,
      },
    });
  }
});

/**
 * 2026-05-04 (Tobias): debug-endpoint som returnerer ALT om ROCKET-rommet
 * + forsøker force-end + spawn ny runde manuelt. Gir konkret feilkode
 * hvis noe failer. Token-protected (samme RESET_TEST_PLAYERS_TOKEN).
 */
app.post("/api/_dev/debug-rocket", async (req, res) => {
  const expectedToken = process.env.RESET_TEST_PLAYERS_TOKEN ?? "";
  const providedToken = typeof req.body?.token === "string" ? req.body.token : "";
  if (!expectedToken || providedToken !== expectedToken) {
    res.status(403).json({ ok: false, error: { code: "FORBIDDEN" } });
    return;
  }
  const result: Record<string, unknown> = {};
  try {
    const summaries = engine.listRoomSummaries();
    result.allRoomSummaries = summaries.map((s) => ({
      code: s.code,
      slug: s.gameSlug,
      gameStatus: s.gameStatus,
      hallId: s.hallId,
    }));
  } catch (err) {
    result.summariesError = err instanceof Error ? err.message : String(err);
  }
  try {
    const snap = engine.getRoomSnapshot("ROCKET");
    result.snapshot = {
      code: snap.code,
      gameSlug: snap.gameSlug,
      hostPlayerId: snap.hostPlayerId,
      hallId: snap.hallId,
      playerCount: snap.players?.length,
      currentGame: snap.currentGame ? {
        id: snap.currentGame.id,
        status: snap.currentGame.status,
        drawnCount: snap.currentGame.drawnNumbers?.length,
        endedReason: snap.currentGame.endedReason,
        startedAt: snap.currentGame.startedAt,
        endedAt: snap.currentGame.endedAt,
      } : null,
    };
  } catch (err) {
    result.snapshotError = err instanceof Error ? err.message : String(err);
  }
  if (req.body?.action === "force-end") {
    try {
      const ended = await engine.forceEndStaleRound("ROCKET", "MANUAL_DEBUG_RESET");
      result.forceEndResult = { ended };
    } catch (err) {
      result.forceEndError = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
      };
    }
  }
  if (req.body?.action === "spawn") {
    try {
      const spawned = await perpetualRoundService.spawnFirstRoundIfNeeded("ROCKET");
      result.spawnResult = { spawned };
    } catch (err) {
      result.spawnError = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
      };
    }
  }
  if (req.body?.action === "end-and-spawn") {
    try {
      const ended = await engine.forceEndStaleRound("ROCKET", "MANUAL_DEBUG_RESET");
      result.forceEndResult = { ended };
      const spawned = await perpetualRoundService.spawnFirstRoundIfNeeded("ROCKET");
      result.spawnResult = { spawned };
    } catch (err) {
      result.endSpawnError = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
      };
    }
  }
  res.json({ ok: true, data: result });
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
// MED-1: Stamp a connection-level traceId on socket.data BEFORE any other
// middleware. This ensures auth-failure paths still log with a trace-id.
io.use(socketTraceMiddleware);

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

// GAP #38: Spillvett player-initiated stop-game vote service. Threshold
// is read from BINGO_STOP_VOTE_THRESHOLD_PERCENT env (default 50% of
// players). Service tracks votes per running round, releases armed
// reservations when the threshold is reached, and audits both per-vote
// and threshold-reached events.
const spill1StopVoteService = new Spill1StopVoteService({
  engine,
  auditLogService,
  walletAdapter,
  getReservationId: (code, pid) => roomState.getReservationId(code, pid),
  clearReservationId: (code, pid) => roomState.clearReservationId(code, pid),
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
  getPreRoundTicketsByPlayerId: (code) => {
    // 2026-12-06 (v2): for Spill 2 (rocket) override Game 1's display-cache
    // med pool-grids fra Game2TicketPoolService. Klient har allerede valgt
    // hvilke 3×3-brett han vil spille via Choose Tickets-siden — engine må
    // adoptere de EXACTE tallene, ikke generere nye random.
    //
    // Strategy: hvis room er rocket og pool finnes for current gameId →
    // bygg map fra pool-cache. Ellers fall tilbake til Game 1's display-
    // cache (eksisterende oppførsel for bingo + andre slugs).
    const base = roomState.getPreRoundTicketsByPlayerId(code);
    try {
      const snap = engine.getRoomSnapshot(code);
      if (snap.gameSlug !== "rocket" && snap.gameSlug !== "game_2" && snap.gameSlug !== "tallspill") {
        return base;
      }
      const gameId = snap.currentGame?.id;
      if (!gameId) return base;
      const playerIds = game2TicketPoolService.listPlayersWithPurchasedTickets(code, gameId);
      if (playerIds.length === 0) return base;
      const merged: Record<string, import("./game/types.js").Ticket[]> = { ...base };
      for (const pid of playerIds) {
        const grids = game2TicketPoolService.getPurchasedGridsFromCache(code, pid, gameId);
        if (!grids || grids.length === 0) continue;
        merged[pid] = grids.map((grid) => ({ grid: grid.map((row) => [...row]) }));
      }
      return merged;
    } catch {
      // Fail-soft: hvis snapshot eller pool feiler — bruk eksisterende
      // base-cache så Game 1-spillere ikke regresserer.
      return base;
    }
  },
  replaceDisplayTicket: (code, id, ticketId, slug) => roomState.replaceDisplayTicket(code, id, ticketId, slug),
  cancelPreRoundTicket: (code, id, ticketId, cfg) => roomState.cancelPreRoundTicket(code, id, ticketId, cfg),
  resolveBingoHallGameConfigForRoom, requireActiveHallIdFromInput, buildLeaderboard,
  getVariantConfig: (code) => roomState.getVariantConfig(code),
  // BIN-694: wire default variant-config on room-create + room-join auto-create
  // so Game 1 rooms get DEFAULT_NORSK_BINGO_CONFIG (5-phase progression).
  bindDefaultVariantConfig: (code, slug) => roomState.bindDefaultVariantConfig(code, slug),
  // PR C: async binder som leser admin-UI-config via gameManagementId; faller
  // til default ellers. Socket-callsites (room:create, room:join-auto) bruker
  // denne foretrukne pathen i dag uten gameManagementId — plumbing-en er klar
  // for fremtidig scope der ID-en sendes inn på wire.
  // HV-2: floor-fetcher injiseres her også slik at socket-create-paths får
  // hall-default floors uten å måtte gå via admin-routeren.
  bindVariantConfigForRoom: (code, opts) =>
    roomState.bindVariantConfigForRoom(code, {
      ...opts,
      fetchGameManagementConfig: fetchGameManagementConfigForRoomState,
      fetchSpill1HallFloors: fetchSpill1HallFloorsForRoomState,
    }),
  chatMessageStore,
  // BIN-587 B4b follow-up: dep for socket-event `voucher:redeem`.
  voucherRedemptionService,
  // BIN-693 Option B: wallet-reservasjon-wiring.
  walletAdapter,
  getWalletIdForPlayer: (roomCode, playerId) => {
    try {
      const snap = engine.getRoomSnapshot(roomCode);
      const player = snap.players.find((p) => p.id === playerId);
      return player?.walletId ?? null;
    } catch {
      return null;
    }
  },
  getReservationId: (code, pid) => roomState.getReservationId(code, pid),
  setReservationId: (code, pid, rid) => roomState.setReservationId(code, pid, rid),
  clearReservationId: (code, pid) => roomState.clearReservationId(code, pid),
  // FORHANDSKJOP-ORPHAN-FIX (PR 2, 2026-04-29): wire armed/reservation
  // introspection so `room:create`/`room:join` can preserve in-flight
  // pre-round purchases when calling `engine.cleanupStaleWalletInIdleRooms`.
  // Without this, the cleanup pass would evict disconnected players whose
  // wallet_reservations row is still status='active' — orphaning the
  // forhåndskjøp until the 30-min TTL.
  // Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md §6 PR 2.
  hasArmedOrReservation: (code, pid) => roomState.hasArmedOrReservation(code, pid),
  // Pilot-bug fix 2026-04-27 (Tobias-rapport): per-rom arm-cycle-id.
  getArmCycleId: (code) => roomState.getOrCreateArmCycleId(code),
  // GAP #38: Spillvett stop-game vote service.
  spill1StopVoteService,
  // Tobias 2026-04-27: Spill 1 canonical-room er per-LINK (Group of Halls).
  // Slå opp gruppe-id for hallId via HallGroupService — `list({ hallId })`
  // returnerer grupper hvor hallen er medlem. Vi bruker første aktive gruppe
  // (første treff i name-sortert liste). Fail-soft: returnerer null på feil
  // så canonicalRoomCode faller tilbake til hallId-basert kode.
  getHallGroupIdForHall: async (hallId: string): Promise<string | null> => {
    try {
      const groups = await hallGroupService.list({ hallId, limit: 1, status: "active" });
      return groups[0]?.id ?? null;
    } catch {
      return null;
    }
  },

  // Tobias 2026-04-29 (post-orphan-fix UX): tap-state lookup brukt av
  // bet:arm til å bygge `lossLimit` info i ack. Returnerer null fail-soft
  // hvis adapter mangler getAvailableBalance.
  getLossStateSnapshot: async (walletId, hallId, nowMs) => {
    try {
      const ls = engine.getLossLimitState(walletId, hallId, nowMs);
      let walletBalance: number | null = null;
      if (walletAdapter.getAvailableBalance) {
        try {
          walletBalance = await walletAdapter.getAvailableBalance(walletId);
        } catch {
          walletBalance = null;
        }
      }
      return {
        dailyUsed: ls.dailyUsed,
        dailyLimit: ls.dailyLimit,
        monthlyUsed: ls.monthlyUsed,
        monthlyLimit: ls.monthlyLimit,
        walletBalance,
      };
    } catch {
      return null;
    }
  },

  // Tobias 2026-04-29 (post-orphan-fix UX): emit `bet:rejected` til
  // `wallet:<walletId>`-rommet for spilleren som ble droppet i game-
  // start-filteret. Klient lytter for å fjerne pre-round-bonger og
  // vise klar feilmelding. Eksisterer pga walletStatePusher allerede
  // joiner sockets i wallet:<walletId>-rommet ved auth.
  emitBetRejected: (walletId, payload) => {
    try {
      io.to(walletRoomKey(walletId)).emit("bet:rejected", payload);
    } catch (err) {
      console.warn(
        "[bet:rejected] emit failed — game-start fortsetter, klient kan ikke vise feilmelding",
        { walletId, err },
      );
    }
  },

  // Tobias 2026-04-29 (post-orphan-fix UX): emit `wallet:loss-state` etter
  // committed buy-in (eller partial-buy partial). Klient bruker det til å
  // oppdatere "Brukt i dag: X / Y kr"-headeren i Kjøp Bonger-popup-en.
  emitWalletLossState: (walletId, payload) => {
    try {
      io.to(walletRoomKey(walletId)).emit("wallet:loss-state", payload);
    } catch (err) {
      console.warn(
        "[wallet:loss-state] emit failed — klient ser stale tap-status til neste push",
        { walletId, err },
      );
    }
  },

  // Tobias-direktiv 2026-05-03: Spill 2/3 perpetual auto-spawn første runde
  // ved spiller-join. Reuser PerpetualRoundService som har all idempotens-
  // logikken, slug-filteret og default-konfigurasjonen vi trenger. Spill 1
  // og SpinnGo gir false-return uten effekt — kun rocket / monsterbingo
  // trigges. Fail-soft: hvis spawn kaster, fanger handler-en og logger
  // som warn så join fortsetter normalt.
  spawnFirstRoundIfNeeded: (roomCode) => perpetualRoundService.spawnFirstRoundIfNeeded(roomCode),
});

// BIN-498 + BIN-503: TV-display socket handlers.
//
// Primary validation path is the DB-backed token store
// (`app_hall_display_tokens`, rotated via admin UI). Fallback to the
// env-var `HALL_DISPLAY_TOKEN_<SLUG>` is kept for dev/staging where
// tokens may be seeded outside the admin flow. Tokens are never logged.
const registerAdminDisplayEvents = createAdminDisplayHandlers({
  engine, platformService, io,
  screensaverConfig: cfg.screensaverConfig,
  // Bølge D Issue 2: rate-limit display-events (10/s per socket + per
  // hallId). Beskytter mot bot-spam av subscribe/state-refresh.
  socketRateLimiter,
  validateDisplayToken: async (token) => {
    const colon = token.indexOf(":");
    if (colon <= 0) throw new Error("token format ugyldig (forventer <hallSlug>:<secret>)");
    const hallSlug = token.slice(0, colon).trim();
    const secret = token.slice(colon + 1).trim();
    if (!hallSlug || !secret) throw new Error("token format ugyldig");

    // BIN-503: DB path first.
    try {
      const { hallId } = await platformService.verifyHallDisplayToken(token);
      return { hallId };
    } catch (dbErr) {
      // Fall through to env-var only if the DB path rejected for a
      // reason that looks like "token doesn't exist" — hall-mismatch or
      // format errors must stay failed so env-var can't be used to
      // bypass them.
      const message = (dbErr as Error).message || "";
      if (!message.includes("Ugyldig display-token")) throw dbErr;
    }

    // BIN-498 env-var fallback.
    const envName = `HALL_DISPLAY_TOKEN_${hallSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const expected = (process.env[envName] ?? "").trim();
    if (!expected) throw new Error(`hall ${hallSlug} har ingen display-token konfigurert`);
    if (expected !== secret) throw new Error("token mismatch");
    const hall = await platformService.getHall(hallSlug);
    return { hallId: hall.id };
  },
});

// BIN-515: Admin hall-event socket handlers. Authentication is the
// existing JWT access-token path; the handler itself checks
// ROOM_CONTROL_WRITE per event.
//
// Bølge D Issue 2: rate-limit per event (10/s per admin-socket + per
// admin user.id) — admin-bug eller misbruks-account skal ikke kunne
// flomme system med pause/resume/force-end events.
const registerAdminHallEvents = createAdminHallHandlers({
  engine, platformService, io, emitRoomUpdate, walletAdapter, socketRateLimiter,
});

// GAME1_SCHEDULE PR 4d.2: Spill 1-spesifikk socket-handler — isolert fra
// gameEvents.ts for å skille schedulert-Spill-1-flyt fra ad-hoc-rom.
const registerGame1ScheduledEvents = createGame1ScheduledEventHandlers({
  pool: platformService.getPool(),
  engine,
  game1DrawEngine: game1DrawEngineService,
  platformService,
  socketRateLimiter,
  emitRoomUpdate,
  bindDefaultVariantConfig: (code, slug) => roomState.bindDefaultVariantConfig(code, slug),
});

// BIN-MYSTERY Gap D: socket-wire for alle 5 M6 mini-games (wheel, chest,
// colordraft, oddsen, mystery). Før denne wire-up var setBroadcaster aldri
// kalt → NoopMiniGameBroadcaster i bruk → klient fikk aldri mini_game-events.
// `mini_game:choice` lyttes også her — uten wire ble klient-valg aldri sendt
// til orchestrator.handleChoice().
const miniGameSocketWire = createMiniGameSocketWire({
  io,
  orchestrator: game1MiniGameOrchestrator,
  platformService,
  // Bølge D Issue 1: rate-limit `mini_game:choice` og `mini_game:join`. Uten
  // dette kunne spam-events trigge race mot pending-payout-tabellen. Limits
  // er definert i miniGameSocketWire.MINI_GAME_RATE_LIMITS.
  socketRateLimiter,
});
game1MiniGameOrchestrator.setBroadcaster(miniGameSocketWire.broadcaster);

// Tobias 2026-04-27: ADMIN Ops Console — socket subscribe-handler.
// Klient subscriber via `admin:ops:subscribe` etter `admin:login`.
const registerAdminOpsEvents = createAdminOpsEvents({ socketRateLimiter });

io.on("connection", (socket: Socket) => {
  // MED-1: Patch socket.on so every event handler runs inside an ALS
  // trace-context. Must happen BEFORE the registerXxx() calls below so
  // their listeners get wrapped.
  wrapSocketEventHandlers(socket);

  // MED-1: Surface the resolved walletId on the trace-context so
  // connection-time logs (after wrapping) carry userId. Per-event traces
  // do this themselves, but the connection-handler body itself runs
  // outside any per-event context — falling back here is a safe no-op.
  if (socket.data.user?.walletId) setTraceField("userId", socket.data.user.walletId);

  registerGameEvents(socket);
  registerAdminDisplayEvents(socket);
  registerAdminHallEvents(socket);
  registerGame1ScheduledEvents(socket);
  miniGameSocketWire.register(socket);
  registerAdminOpsEvents(socket);
});

// GAME1_SCHEDULE PR 4d.3: `/admin-game1`-namespace for master-konsoll
// real-time subscribe. Opprettes etter `io` finnes. Broadcaster-porten
// injisieres late via setAdminBroadcaster slik at service-laget kan
// konstrueres tidligere uten å kjenne socket-siden.
//
// Task 1.7: injiser hall-id-oppslagsport slik at phase-won speiles til
// TV-display-rom. Porten er en tynn adapter over
// `Game1HallReadyService.getReadyStatusForGame` som returnerer listen av
// haller for et gitt spill. Fail-open: hvis servicen kaster (HS-tabell
// mangler), logger adapteren warn og returnerer tom array.
const adminGame1Handle = createAdminGame1Namespace({
  io,
  platformService,
  // Bølge D Issue 2: rate-limit `game1:subscribe`/`game1:unsubscribe` på
  // /admin-game1 namespacet (10/s per admin-socket + per admin user.id).
  socketRateLimiter,
  participatingHallIdsPort: {
    async getParticipatingHallIds(gameId: string): Promise<string[]> {
      try {
        const statuses = await game1HallReadyService.getReadyStatusForGame(gameId);
        return statuses.map((s) => s.hallId);
      } catch {
        return [];
      }
    },
  },
});
game1MasterControlService.setAdminBroadcaster(adminGame1Handle.broadcaster);
game1DrawEngineService.setAdminBroadcaster(adminGame1Handle.broadcaster);

// Task 1.6: late-bind transfer-broadcast-hooks etter adminGame1Handle finnes.
// Hook-ene mapper service-responsen til broadcast-event-shape.
const toTransferEvent = (
  r: import("./game/Game1TransferHallService.js").TransferRequest
): import("./game/AdminGame1Broadcaster.js").AdminGame1TransferRequestEvent => ({
  requestId: r.id,
  gameId: r.gameId,
  fromHallId: r.fromHallId,
  toHallId: r.toHallId,
  initiatedByUserId: r.initiatedByUserId,
  initiatedAtMs: new Date(r.initiatedAt).getTime(),
  validTillMs: new Date(r.validTill).getTime(),
  status: r.status,
  respondedByUserId: r.respondedByUserId,
  respondedAtMs: r.respondedAt ? new Date(r.respondedAt).getTime() : null,
  rejectReason: r.rejectReason,
});
adminGame1MasterTransferBroadcastHooks.onRequestCreated = (req) => {
  adminGame1Handle.broadcaster.onTransferRequest(toTransferEvent(req));
};
adminGame1MasterTransferBroadcastHooks.onApproved = (payload) => {
  const event = toTransferEvent(payload.request);
  adminGame1Handle.broadcaster.onTransferApproved(event);
  adminGame1Handle.broadcaster.onMasterChanged({
    gameId: payload.request.gameId,
    previousMasterHallId: payload.previousMasterHallId,
    newMasterHallId: payload.newMasterHallId,
    transferRequestId: payload.request.id,
    at: Date.now(),
  });
};
adminGame1MasterTransferBroadcastHooks.onRejected = (req) => {
  adminGame1Handle.broadcaster.onTransferRejected(toTransferEvent(req));
};
game1TransferExpiryTickService.setBroadcastHook((req) => {
  adminGame1Handle.broadcaster.onTransferExpired(toTransferEvent(req));
});

// PR-C4: spiller-broadcaster for default-namespace. Speiler admin-broadcast
// slik at spiller-klient mottar `draw:new` / `pattern:won` / `room:update`
// POST-commit fra `drawNext()`. Før PR-C4 fikk spiller-UI ingen live-
// oppdatering under scheduled Spill 1 (bare admin-namespace var koblet opp).
const game1PlayerBroadcaster = createGame1PlayerBroadcaster({
  io,
  emitRoomUpdate,
});
game1DrawEngineService.setPlayerBroadcaster(game1PlayerBroadcaster);

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
  // BIN-614: SPA deep-link fallback — every `/admin/*` that isn't a static
  // asset (those are handled by express.static above) boots the shell.
  if (_req.path === "/admin" || _req.path === "/admin/" || _req.path.startsWith("/admin/")) {
    res.sendFile(adminFrontendFile);
    return;
  }
  res.sendFile(path.join(publicDir, "web/index.html"));
});

// BIN-539: Express error reporter — must be registered after all routes.
// Captures any thrown error, forwards to Sentry (when enabled), and sends a
// consistent `{ ok: false, error }` response so clients can rely on shape.
app.use(errorReporter());

// ── Server start ──────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4000);

(async () => {
  // K4 (2026-04-29): connect the Redis-backed lifecycle store BEFORE any
  // boot step that could mutate room state. No-op when provider=memory.
  // Throws on unreachable Redis — surfacing here so the process aborts
  // rather than serving traffic with broken room-state.
  try {
    await connectRoomLifecycleStore(roomState.lifecycleStore);
  } catch (error) {
    console.error("[BIN-K4] RoomLifecycleStore failed to connect", error);
    process.exit(1);
    return;
  }

  try {
    await engine.hydratePersistentState();
    console.log("[responsible-gaming] persisted state hydrated");
  } catch (error) {
    console.error("[responsible-gaming] failed to hydrate persisted state", error);
    process.exit(1);
    return;
  }

  dailyReportScheduler.start();
  jobScheduler.start();
  walletReservationExpiryService.start();

  // BIN-170: Load rooms from Redis on startup (if Redis provider)
  if (roomStateProvider === "redis") {
    try {
      const loaded = await roomStateStore.loadAll();
      if (loaded > 0) console.log(`[BIN-170] Loaded ${loaded} room(s) from Redis`);
      // BIN-694: variant-config is in-memory only (variantByRoom) and isn't
      // persisted in Redis, so Redis-restored rooms need to be re-bound to
      // their default variant. Uses the restored RoomState.gameSlug.
      for (const code of engine.getAllRoomCodes()) {
        try {
          const snap = engine.getRoomSnapshot(code);
          roomState.bindDefaultVariantConfig(code, snap.gameSlug);
        } catch (err) {
          console.warn(`[BIN-694] Failed to bind variant for restored room ${code}:`, err);
        }
      }
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
            // BIN-672: `game.gameSlug` now comes from game_sessions.game_slug
            // column (NOT NULL DEFAULT 'bingo'), persisted at BUY_IN checkpoint
            // time. Supersedes the hardcoded "bingo" stop-gap from PR #246 —
            // every game's format is now authoritative per-row, not guessed.
            engine.restoreRoomFromSnapshot(
              game.roomCode,
              game.hallId ?? "",
              players[0]?.id ?? "recovered",
              players,
              snapshot,
              game.gameSlug,
            );
            // BIN-694: rebind default variant for crash-recovered rooms so the
            // phase-progression runs correctly on the next draw.
            roomState.bindDefaultVariantConfig(game.roomCode, game.gameSlug);
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

  // HIGH-4 (Casino Review): integritetssjekk POST-recovery. Verifiserer at
  // in-memory `currentGame.tickets`/`drawnNumbers`/`status` matcher siste
  // PG-checkpoint. Kjøres ETTER BIN-245 har overskrevet rom slik at
  // mismatch kun forteller om Redis vs PG-divergens, ikke om recovery
  // ennå har kjørt. Drift inkrementerer `wallet_room_drift_total` og
  // logges som WARN.
  if (usePostgresBingoAdapter && localBingoAdapter instanceof PostgresBingoSystemAdapter) {
    try {
      const integrity = await runRecoveryIntegrityCheck({
        roomStateStore,
        bingoAdapter: localBingoAdapter,
      });
      if (integrity.drift > 0) {
        console.warn(
          `[HIGH-4] Recovery integrity: ${integrity.drift}/${integrity.inspected} rom hadde drift mot PG-checkpoint — se logg for detaljer.`,
        );
      } else if (integrity.inspected > 0) {
        console.log(
          `[HIGH-4] Recovery integrity: ${integrity.ok}/${integrity.inspected} rom OK, ${integrity.skipped} skippet, ${integrity.failures} feil.`,
        );
      }
    } catch (err) {
      // Aldri kast — integritetssjekk er best-effort defensiv layer.
      console.error("[HIGH-4] Recovery integrity-check failed:", err);
    }
  }

  // GAME1_SCHEDULE PR 5 (§3.8): Schedule-level crash recovery. Scanner
  // app_game1_scheduled_games for rader i running/paused som har overskredet
  // 2h-vinduet etter scheduled_end_time og auto-kansellerer dem med audit.
  // Kjøres ETTER BIN-245 engine-recovery så runtime-state er restaurert først.
  try {
    const recoveryResult = await game1RecoveryService.runRecoveryPass();
    if (recoveryResult.inspected > 0) {
      console.warn(
        `[game1-recovery] Inspected ${recoveryResult.inspected} scheduled games — ` +
        `cancelled ${recoveryResult.cancelled} overdue, preserved ${recoveryResult.preserved} in-window, ` +
        `${recoveryResult.failures.length} failures.`,
      );
    }
  } catch (err) {
    console.error("[game1-recovery] Schedule-level recovery pass failed:", err);
  }

  // PILOT-EMERGENCY 2026-04-28 (Tobias): boot-sweep for stale non-canonical
  // rooms. Etter PR #677 (canonical-aware lookup) lever rom-koder som
  // 4RCQSX (random `makeRoomCode()` fra pre-fix epoke) fortsatt i Redis +
  // PG-checkpoint og blokkerer reconnect for berørte spillere. Sweepen
  // destroyer kun IDLE/ENDED non-canonical rom; aktive runder rør vi ikke.
  // Kjøres ETTER alle recovery-passene over så vi ser hele rom-tilstanden.
  try {
    const sweepResult = sweepStaleNonCanonicalRooms({
      engine,
      audit: (event) => {
        void auditLogService
          .record({
            actorId: null,
            actorType: "SYSTEM",
            action: event.action,
            resource: event.resource,
            resourceId: event.resourceId,
            details: event.details,
          })
          .catch(() => {
            /* fire-and-forget */
          });
      },
      logger: {
        info: (data, msg) => console.log(msg, JSON.stringify(data)),
        warn: (data, msg) => console.warn(msg, JSON.stringify(data)),
        error: (data, msg) => console.error(msg, JSON.stringify(data)),
      },
    });
    if (sweepResult.destroyed.length > 0) {
      console.warn(
        `[boot-sweep] Destroyed ${sweepResult.destroyed.length} stale non-canonical rooms: ${sweepResult.destroyed.join(", ")}`,
      );
    }
    if (sweepResult.preservedActive.length > 0) {
      console.warn(
        `[boot-sweep] Preserved ${sweepResult.preservedActive.length} active non-canonical rooms (admin must clear): ${sweepResult.preservedActive.join(", ")}`,
      );
    }
  } catch (err) {
    console.error("[boot-sweep] stale-room sweep failed:", err);
  }

  // PILOT-EMERGENCY 2026-05-03 (Tobias): boot-sweep for Spill 2/3-rom som
  // har persistert i `RUNNING + drawnNumbers.length>=maxBalls + endedReason=null`.
  // Bug-rapport: ROCKET henger på "trekk 21/21" uten ny runde, ingen
  // nedtelling, bonger vises ikke. Root cause: prosessen krasjet/restartet
  // ETTER siste draw men FØR engine rakk å fyre game-end. Render-restart
  // loader stale-state tilbake fra Postgres-checkpoint. PR #876 (game-end fix)
  // krever ny draw-event for å trigge — ballbagen er allerede tom så ingen
  // nye draws kommer.
  //
  // Sweepen forcefully ender stale ROCKET/MONSTERBINGO-runder og fyrer
  // `bingoAdapter.onGameEnded` som chain-er til PerpetualRoundService.
  // handleGameEnded — ny runde scheduleres via vanlig perpetual-loop ~5s
  // etter at sweepen kjører. Idempotent + fail-soft per rom.
  //
  // Kjøres ETTER sweepStaleNonCanonicalRooms (legacy-cleanup) men FØR
  // bootstrapHallGroupRooms (Spill 1 hall-group-bootstrap) for å unngå
  // race med rom som kunne bli opprettet under sweepen.
  try {
    const spill23SweepService = new StaleRoomBootSweepService({
      engine,
      logger: {
        info: (msg, meta) => console.log(msg, meta ? JSON.stringify(meta) : ""),
        warn: (msg, meta) => console.warn(msg, meta ? JSON.stringify(meta) : ""),
        error: (msg, meta) => console.error(msg, meta ? JSON.stringify(meta) : ""),
      },
      // 2026-05-03 (Tobias): trigger perpetual-loop-spawn umiddelbart etter
      // boot-sweep ender et stuck-rom. Uten dette må første player-join
      // trigge spawn — som ofte ikke skjer fordi room:join feiler av
      // andre grunner. Med dette spawnes ny ROCKET/MONSTERBINGO-runde
      // umiddelbart ved oppstart.
      spawnAfterEnd: (roomCode) => perpetualRoundService.spawnFirstRoundIfNeeded(roomCode),
    });
    const spill23SweepResult = await spill23SweepService.sweep();
    if (spill23SweepResult.ended.length > 0) {
      console.warn(
        `[boot-sweep] Spill 2/3: forced-end ${spill23SweepResult.ended.length} stale rooms: ${spill23SweepResult.ended.join(", ")}`,
      );
    }
    if (spill23SweepResult.failures.length > 0) {
      console.warn(
        `[boot-sweep] Spill 2/3: ${spill23SweepResult.failures.length} forceEndStaleRound failures (best-effort, see prior logs)`,
      );
    }
  } catch (err) {
    // Aldri kast — boot skal ikke feile pga sweep. StaleRoomBootSweepService
    // er allerede fail-soft per rom; denne ytre catch er en defense-in-depth
    // mot uventet feil i selve service-konstruksjonen.
    console.error("[boot-sweep] Spill 2/3 stale-room sweep failed:", err);
  }

  // 2026-05-02 (Tobias UX): bootstrap kanonisk rom per aktiv group-of-halls.
  // Sikrer at "Pågående spill"-siden viser rommet umiddelbart etter
  // server-restart uten at admin må opprette manuelt. Idempotent + soft-fail.
  try {
    const bootstrapResult = await bootstrapHallGroupRooms({
      engine,
      hallGroupService,
      bindVariantConfigForRoom: (code, opts) =>
        roomState.bindVariantConfigForRoom(code, {
          gameSlug: opts.gameSlug,
          ...(opts.gameManagementId !== undefined
            ? { gameManagementId: opts.gameManagementId }
            : {}),
        }),
      bindDefaultVariantConfig: (code, slug) =>
        roomState.bindDefaultVariantConfig(code, slug),
    });
    if (bootstrapResult.created.length > 0) {
      console.log(
        `[boot-bootstrap] Created ${bootstrapResult.created.length} hall-group rooms: ${bootstrapResult.created.join(", ")}`,
      );
    }
    if (bootstrapResult.skipped.length > 0) {
      console.log(
        `[boot-bootstrap] Skipped ${bootstrapResult.skipped.length} existing rooms`,
      );
    }
    if (bootstrapResult.errors.length > 0) {
      console.warn(
        `[boot-bootstrap] ${bootstrapResult.errors.length} hall-groups failed:`,
        bootstrapResult.errors,
      );
    }
  } catch (err) {
    console.error("[boot-bootstrap] hall-group room bootstrap failed:", err);
  }

  // 2026-05-03 (Tobias-direktiv, Agent EE): clean-slate test-spillere ved
  // boot når env-var er satt. Default no-op. PM aktiverer ved å sette
  // `RESET_TEST_PLAYERS=true` på Render → trigge deploy → fjerne env-var
  // etterpå så scriptet ikke kjører igjen.
  //
  // Sletter ALLE rader med role='PLAYER' (unntatt test@spillorama.no) og
  // oppretter/oppdaterer test@spillorama.no med VERIFIED kyc + 5000 kr
  // balance i hall demo-hall-001. AGENT/ADMIN/HALL_OPERATOR/SUPPORT-rader
  // bevares uendret. Idempotent + fail-soft — feil her skal IKKE krasje
  // boot.
  if ((process.env.RESET_TEST_PLAYERS ?? "").trim().toLowerCase() === "true") {
    try {
      const result = await resetTestPlayers({
        pool: platformService.getPool(),
        schema: pgSchema,
      });
      console.log(
        `[reset-test-players] sletter ${result.deletedCount} player-rader, ${result.testUser.created ? "oppretter" : "oppdaterer"} ${result.testUser.email} med ${result.testUser.depositKr} kr (hall ${result.testUser.hallId})`,
      );
    } catch (err) {
      // Fail-soft: logg men la boot fortsette. Pilot-skjemaet er viktigere
      // enn at script-en alltid lykkes — feilen er sannsynligvis FK-RESTRICT
      // (test-spiller med faktisk compliance-historikk) eller manglende
      // pilot-hall i DB (hvis seed-demo-pilot-day ikke har kjørt ennå).
      console.error("[reset-test-players] script feilet — boot fortsetter:", err);
    }
  }

  server.listen(PORT, () => {
    console.log(`Bingo backend kjører på http://localhost:${PORT}`);
    console.log(`[compliance] minRoundInterval=${bingoMinRoundIntervalMs}ms minPlayersToStart=${bingoMinPlayersToStart} maxDrawsPerRound=${bingoMaxDrawsPerRound} dailyLoss=${bingoDailyLossLimit} monthlyLoss=${bingoMonthlyLossLimit} playSessionLimit=${bingoPlaySessionLimitMs}ms pauseDuration=${bingoPauseDurationMs}ms selfExclusionMin=${bingoSelfExclusionMinMs}ms`);
    console.log(`[scheduler] autoStart=${runtimeBingoSettings.autoRoundStartEnabled} autoDraw=${runtimeBingoSettings.autoDrawEnabled} forceAutoStart=${forceAutoStart} forceAutoDraw=${forceAutoDraw} autoAllowedInProd=${allowAutoplayInProduction} singleRoomPerHall=${enforceSingleRoomPerHall} interval=${runtimeBingoSettings.autoRoundStartIntervalMs}ms minPlayers=${runtimeBingoSettings.autoRoundMinPlayers} ticketsPerPlayer=${runtimeBingoSettings.autoRoundTicketsPerPlayer} entryFee=${runtimeBingoSettings.autoRoundEntryFee} payoutPercent=${runtimeBingoSettings.payoutPercent} liveRoundsIndependentOfBet=${liveRoundsIndependentOfBet}`);
    console.log(`[scheduler] autoDraw=${runtimeBingoSettings.autoDrawEnabled} interval=${runtimeBingoSettings.autoDrawIntervalMs}ms tick=${schedulerTickMs}ms envOverride=${autoDrawIntervalEnvOverrideMs ?? "none"}`);
    console.log(`[daily-report] enabled=${dailyReportJobEnabled} interval=${dailyReportJobIntervalMs}ms`);
    console.log(`[swedbank] configured=${swedbankPayService.isConfigured()}`);
    // K3 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.1): explicit engine-routing
    // log. Auditor reading boot-output må kunne se hvilken engine håndterer
    // hvilken slug. `isProductionRuntime=true` aktiverer assertSpill1NotAdHoc
    // som tvinger retail-Spill-1 over på scheduled-engine; test-haller +
    // dev-runtime kan fortsatt bruke ad-hoc-pathen.
    console.log(
      `[engine-routing] Spill 1 (bingo): ` +
        (isProductionRuntime
          ? "production=Game1DrawEngineService (scheduled), test-hall=BingoEngine (ad-hoc, isTestHall=true)"
          : "dev/test=BingoEngine (ad-hoc) OR Game1DrawEngineService (scheduled), Demo Hall passes through") +
        ` | Spill 2 (rocket): BingoEngine (ad-hoc) | Spill 3 (monsterbingo): BingoEngine (ad-hoc) | ` +
        `quarantine=${isProductionRuntime ? "ENFORCED" : "OFF (NODE_ENV != production)"}`
    );
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
  jobScheduler.stop();
  drawScheduler.gracefulStop()
    .then(async () => {
      // BIN-761: stopp outbox-worker før øvrig rivetning, så pågående tick får
      // tid til å markere claimed-rader processed/failed før shutdown.
      if (walletOutboxWorker) {
        try { await walletOutboxWorker.stop(); }
        catch (err) { console.warn("[shutdown] walletOutboxWorker.stop() failed:", err); }
      }
      // COMP-P0-002: samme graceful-stop for compliance-outbox-worker.
      // Pågående tick får tid til å markere claimed compliance-rader
      // processed/failed før shutdown — verken §71-rad eller outbox-rad
      // kan tapes pga abrupt shutdown.
      if (complianceOutboxWorker) {
        try { await complianceOutboxWorker.stop(); }
        catch (err) { console.warn("[shutdown] complianceOutboxWorker.stop() failed:", err); }
      }
      await roomStateStore.shutdown();
      // K4: disconnect the room-lifecycle Redis client (no-op for memory).
      try { await shutdownRoomLifecycleStore(roomState.lifecycleStore); }
      catch (err) { console.warn("[shutdown] shutdownRoomLifecycleStore() failed:", err); }
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
