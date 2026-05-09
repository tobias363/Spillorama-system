/**
 * DrawScheduler callback factory and pending-settings logic.
 * Extracted from index.ts. Stateless — all mutable data is passed as arguments.
 */
import type { Server } from "socket.io";
import { DomainError } from "../errors/DomainError.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { DrawScheduler, SchedulerSettings } from "../draw-engine/DrawScheduler.js";
import type { BingoSchedulerSettings } from "./bingoSettings.js";
import { yesterdayOsloKey } from "./osloTimezone.js";
import { logger as rootLogger } from "./logger.js";
import { logRoomEvent } from "./roomLogVerbose.js";
import type { RoomUpdatePayload } from "./roomHelpers.js";
import type { RoomSnapshot } from "../game/types.js";
import { walletRoomKey } from "../sockets/walletStatePusher.js";

const schedulerLogger = rootLogger.child({ module: "scheduler" });

export interface SchedulerCallbackDeps {
  engine: BingoEngine;
  io: Server;
  drawScheduler: DrawScheduler;
  runtimeBingoSettings: BingoSchedulerSettings;
  /**
   * Bug 1 fix: når `false`, krever scheduleren minst én armed
   * spiller (via `getArmedPlayerIds`) før runde starter — legacy-
   * modus. Default `true` (matcher dagens implementerte oppførsel).
   * Eksponert som env-var `BINGO_LIVE_ROUNDS_INDEPENDENT_OF_BET`.
   */
  liveRoundsIndependentOfBet?: boolean;
  getArmedPlayerIds: (roomCode: string) => string[];
  getArmedPlayerTicketCounts: (roomCode: string) => Record<string, number>;
  getArmedPlayerSelections: (roomCode: string) => Record<string, Array<{ type: string; qty: number }>>;
  getRoomConfiguredEntryFee: (roomCode: string) => number;
  disarmAllPlayers: (roomCode: string) => void;
  clearDisplayTicketCache: (roomCode: string) => void;
  buildRoomUpdatePayload: (snapshot: RoomSnapshot, nowMs?: number) => RoomUpdatePayload;
  emitRoomUpdate: (roomCode: string) => Promise<RoomUpdatePayload>;
  emitManyRoomUpdates: (roomCodes: Iterable<string>) => Promise<void>;
  persistBingoSettingsToCatalog: () => Promise<void>;
  getPendingBingoSettingsUpdate: () => PendingBingoSettingsUpdate | null;
  setPendingBingoSettingsUpdate: (update: PendingBingoSettingsUpdate | null) => void;
  getBingoSettingsEffectiveFromMs: () => number;
  setBingoSettingsEffectiveFromMs: (ms: number) => void;
  /** BIN-445: Get active variant config for a room. */
  getVariantConfig?: (roomCode: string) => { gameType: string; config: import("../game/variantConfig.js").GameVariantConfig } | null;
  /** BIN-693: reservation-id per player in room (for commit at startGame). */
  getReservationIdsByPlayer?: (roomCode: string) => Record<string, string>;
  /** BIN-693: clear reservation-mapping after game starts (committed) or aborts (released). */
  clearReservationIdsForRoom?: (roomCode: string) => void;
}

export interface PendingBingoSettingsUpdate {
  effectiveFromMs: number;
  settings: BingoSchedulerSettings;
}

export function toDrawSchedulerSettings(
  s: BingoSchedulerSettings,
  liveRoundsIndependentOfBet?: boolean,
): SchedulerSettings {
  return {
    autoRoundStartEnabled: s.autoRoundStartEnabled,
    autoRoundStartIntervalMs: s.autoRoundStartIntervalMs,
    autoRoundMinPlayers: s.autoRoundMinPlayers,
    autoDrawEnabled: s.autoDrawEnabled,
    autoDrawIntervalMs: s.autoDrawIntervalMs,
    // Bug 1 fix: default `true` (matcher hardkodet
    // `liveRoundsIndependentOfBet: true` i `roomHelpers.ts:74`).
    // Sett env-var `BINGO_LIVE_ROUNDS_INDEPENDENT_OF_BET=false` for
    // legacy-oppførsel hvor scheduleren venter på armed spiller.
    liveRoundsIndependentOfBet: liveRoundsIndependentOfBet ?? true,
  };
}

export async function applyPendingBingoSettingsIfDue(
  nowMs: number,
  summaries: ReturnType<BingoEngine["listRoomSummaries"]>,
  deps: SchedulerCallbackDeps
): Promise<boolean> {
  const pending = deps.getPendingBingoSettingsUpdate();
  if (!pending || pending.effectiveFromMs > nowMs) return false;
  if (summaries.some((s) => s.gameStatus === "RUNNING")) return false;

  const previous: BingoSchedulerSettings = { ...deps.runtimeBingoSettings };
  const previousEffectiveFromMs = deps.getBingoSettingsEffectiveFromMs();
  const pendingToApply = { effectiveFromMs: pending.effectiveFromMs, settings: { ...pending.settings } };
  deps.setPendingBingoSettingsUpdate(null);
  Object.assign(deps.runtimeBingoSettings, pendingToApply.settings);
  deps.setBingoSettingsEffectiveFromMs(pendingToApply.effectiveFromMs);
  deps.drawScheduler.syncAfterSettingsChange(toDrawSchedulerSettings(previous));

  try {
    await deps.persistBingoSettingsToCatalog();
  } catch (error) {
    Object.assign(deps.runtimeBingoSettings, previous);
    deps.setBingoSettingsEffectiveFromMs(previousEffectiveFromMs);
    deps.setPendingBingoSettingsUpdate(pendingToApply);
    deps.drawScheduler.syncAfterSettingsChange(toDrawSchedulerSettings(pendingToApply.settings));
    throw error;
  }

  await deps.emitManyRoomUpdates(deps.engine.getAllRoomCodes());
  return true;
}

export function createSchedulerCallbacks(deps: SchedulerCallbackDeps) {
  return {
    onRoomRescheduled: async (roomCode: string) => { await deps.emitRoomUpdate(roomCode); },
    onRoomExhausted: (roomCode: string, count: number) => {
      console.error(`[DrawScheduler] Room ${roomCode} exhausted after ${count} consecutive stuck detections. Ending round with SYSTEM_ERROR.`);
      try {
        const snapshot = deps.engine.getRoomSnapshot(roomCode);
        if (snapshot.currentGame?.status === "RUNNING") {
          deps.engine.endGame({ roomCode, actorPlayerId: snapshot.hostPlayerId, reason: "SYSTEM_ERROR" });
          void deps.emitRoomUpdate(roomCode);
        }
      } catch (error) {
        console.error(`[DrawScheduler] Failed to end exhausted room ${roomCode}:`, error);
      }
    },
    onShutdown: async (activeRoomCodes: string[]) => {
      // §6.1 (Wave 3b, 2026-05-06): shutdown er en sjelden ett-skudd-event.
      // Vi sender full payload her — bandwidth-kost er trivielt vs. et
      // kontrollert deploy-vindu der klienter trenger maks-info for å
      // gjøre en clean reconnect. Per-spiller-stripping er bare verdt
      // å betale for repeterende emits (auto-draw-tick), ikke shutdown.
      for (const roomCode of activeRoomCodes) {
        deps.io.to(roomCode).emit("room:update", {
          ...deps.buildRoomUpdatePayload(deps.engine.getRoomSnapshot(roomCode)),
          serverRestarting: true
        });
      }
    },
    onAutoStart: async (roomCode: string, hostPlayerId: string): Promise<{ firstDrawAtMs: number | null }> => {
      let firstDrawAtMs: number | null = null;
      // 2026-05-09 (Tobias kritisk bug-fix): Spill 1 (`bingo`) skal IKKE
      // auto-startes av DrawScheduler. Per pilot-spec
      // (SPILL1_IMPLEMENTATION_STATUS_2026-05-08 §3.3) er Spill 1 master-
      // styrt — eneste lovlig start-path er `MasterActionService.start`
      // som kalles via `POST /api/agent/game1/master/start` når master
      // klikker "Start neste spill" i cash-inout-dashboardet.
      //
      // Tidligere oppførsel (bug): når en Spill 1-runde endte i et boot-
      // bootstrap-rom (`BINGO_DEMO-PILOT-GOH` osv.) trigget DrawScheduler-
      // en auto-start på neste tick fordi `autoRoundStartEnabled=true` og
      // `liveRoundsIndependentOfBet=true`. Dette ga uendelig kjede av
      // runder som "kjørte selv" — master kunne ikke stoppe dem fra UI
      // siden de ikke var koblet til plan-runtime.
      //
      // Fix: før vi kaller engine.startGame, sjekker vi rommets gameSlug.
      // Hvis det er `bingo` (Spill 1), blokkerer vi auto-start helt og
      // logger blokkering så ops kan se at det skjer.
      // Spill 2 (`rocket`) og Spill 3 (`monsterbingo`) bruker
      // `PerpetualRoundService` — IKKE DrawScheduler — så de er ikke
      // påvirket av denne guarden.
      try {
        const snapshot = deps.engine.getRoomSnapshot(roomCode);
        const slug = (snapshot.gameSlug ?? "").toLowerCase().trim();
        if (slug === "bingo") {
          schedulerLogger.warn(
            {
              roomCode,
              hallId: snapshot.hallId,
              gameSlug: slug,
              hostPlayerId,
              event: "auto.round.tick",
              action: "blocked",
              reason: "spill1_master_only",
            },
            "[scheduler] auto-start blokkert for Spill 1-rom — krever master-trigger via MasterActionService",
          );
          return { firstDrawAtMs };
        }
        // Debug-logging: trigget auto-start (Spill 2/3 og evt. andre).
        schedulerLogger.info(
          {
            roomCode,
            hallId: snapshot.hallId,
            gameSlug: slug,
            hostPlayerId,
            event: "auto.round.tick",
            action: "trigger",
          },
          "[scheduler] auto-start trigget av DrawScheduler",
        );
      } catch (snapshotErr) {
        // Hvis snapshot feiler (rom slettet midt i tick), fortsett til
        // engine.startGame som vil returnere DomainError og logge skip.
        schedulerLogger.debug(
          { roomCode, err: snapshotErr },
          "[scheduler] snapshot-pre-check feilet — lar engine.startGame avgjøre",
        );
      }
      try {
        const variantInfo = deps.getVariantConfig?.(roomCode);
        await deps.engine.startGame({
          roomCode, actorPlayerId: hostPlayerId,
          entryFee: deps.getRoomConfiguredEntryFee(roomCode),
          ticketsPerPlayer: deps.runtimeBingoSettings.autoRoundTicketsPerPlayer,
          payoutPercent: deps.runtimeBingoSettings.payoutPercent,
          armedPlayerIds: deps.getArmedPlayerIds(roomCode),
          armedPlayerTicketCounts: deps.getArmedPlayerTicketCounts(roomCode),
          armedPlayerSelections: deps.getArmedPlayerSelections(roomCode),
          gameType: variantInfo?.gameType,
          variantConfig: variantInfo?.config,
          reservationIdByPlayer: deps.getReservationIdsByPlayer?.(roomCode),
        });
        // K2 (2026-04-29): `disarmAllPlayers` is now atomic across armed-state,
        // ticket-selections, reservation-mapping, AND arm-cycle-id (the store
        // mutates all four state-spaces in one mutex-protected operation).
        // The separate `clearReservationIdsForRoom` call is redundant — kept
        // here as a defensive idempotent fallback so test harnesses that wire
        // a custom store-bypass-path don't regress.
        deps.disarmAllPlayers(roomCode);
        deps.clearReservationIdsForRoom?.(roomCode);
        deps.clearDisplayTicketCache(roomCode);
        // LIVE_ROOM_OBSERVABILITY 2026-04-29: scheduler-tick INFO-event ved
        // hver runde-start. Engine logger `game.started` selv; denne logger
        // beslutningen ovenfor (auto-round-flow valgte å starte runden).
        logRoomEvent(
          schedulerLogger,
          { roomCode, action: "started" },
          "auto.round.tick",
        );
      } catch (error) {
        if (error instanceof DomainError && (
          error.code === "PLAYER_ALREADY_IN_RUNNING_GAME" ||
          error.code === "ROUND_START_TOO_SOON" ||
          error.code === "NOT_ENOUGH_PLAYERS"
        )) {
          logRoomEvent(
            schedulerLogger,
            { roomCode, action: "skipped", reason: error.code },
            "auto.round.tick",
          );
          return { firstDrawAtMs };
        }
        throw error;
      }
      await deps.emitRoomUpdate(roomCode);
      if (!deps.runtimeBingoSettings.autoDrawEnabled) return { firstDrawAtMs };
      try {
        const { number, drawIndex, gameId } = await deps.engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId });
        deps.io.to(roomCode).emit("draw:new", { number, source: "auto", drawIndex, gameId });
        firstDrawAtMs = Date.now();
        logRoomEvent(
          schedulerLogger,
          { roomCode, gameId, action: "drew", number, drawIndex, source: "auto" },
          "auto.round.tick",
        );
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "NO_MORE_NUMBERS") throw error;
      }
      await deps.emitRoomUpdate(roomCode);
      return { firstDrawAtMs };
    },
    onAutoDraw: async (roomCode: string, hostPlayerId: string): Promise<{ roundEnded: boolean }> => {
      let roundEnded = false;
      // BIN-694: snapshot won-pattern ids BEFORE draw so we can emit
      // pattern:won for any phase auto-claim just committed.
      const beforeSnap = deps.engine.getRoomSnapshot(roomCode);
      const wonBefore = new Set(
        (beforeSnap.currentGame?.patternResults ?? [])
          .filter((r) => r.isWon)
          .map((r) => r.patternId),
      );
      // Tobias prod-incident 2026-04-30: snapshot mini-game-state PRE-draw
      // så vi kan detektere at `evaluateActivePhase` aktiverte mini-game
      // (Fullt Hus auto-claim → `onAutoClaimedFullHouse`). Auto-round-flyten
      // mangler denne detection-en (kun `draw:next`-socket-handler hadde
      // den). Resultat: mini-game-state ble mutert i engine men aldri
      // broadcast til klient — så Mystery Joker / Wheel / Chest dukket
      // ikke opp i auto-runder. Symmetrisk løsning som drawEvents.ts:96-110.
      const miniGameBefore = deps.engine.getCurrentMiniGame(roomCode);
      try {
        const { number, drawIndex, gameId } = await deps.engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId });
        deps.io.to(roomCode).emit("draw:new", { number, source: "auto", drawIndex, gameId });
        logRoomEvent(
          schedulerLogger,
          { roomCode, gameId, action: "drew", number, drawIndex, source: "auto" },
          "auto.round.tick",
        );
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "NO_MORE_NUMBERS") throw error;
      }
      const postDrawSnapshot = deps.engine.getRoomSnapshot(roomCode);
      // BIN-694: emit pattern:won for every phase the draw just closed.
      // BIN-696: include winnerIds + winnerCount for multi-winner popup.
      const afterResults = postDrawSnapshot.currentGame?.patternResults ?? [];
      for (const r of afterResults) {
        if (r.isWon && !wonBefore.has(r.patternId)) {
          const winnerIds = r.winnerIds ?? (r.winnerId ? [r.winnerId] : []);
          deps.io.to(roomCode).emit("pattern:won", {
            patternId: r.patternId,
            patternName: r.patternName,
            winnerId: r.winnerId,
            wonAtDraw: r.wonAtDraw,
            payoutAmount: r.payoutAmount,
            claimType: r.claimType,
            gameId: postDrawSnapshot.currentGame?.id,
            winnerIds,
            winnerCount: winnerIds.length,
          });
        }
      }
      // Tobias prod-incident 2026-04-30: emit `minigame:activated` når
      // engine aktiverte mini-game i `evaluateActivePhase` (auto-claim av
      // Fullt Hus). Mirror av drawEvents.ts:84-110 (manuell draw:next-handler).
      // Emit-target: `wallet:<walletId>`-rommet for vinneren — mini-game-popup
      // skal kun vises for vinneren, ikke alle observers.
      const miniGameAfter = deps.engine.getCurrentMiniGame(roomCode);
      if (
        miniGameAfter &&
        (!miniGameBefore || miniGameBefore.playerId !== miniGameAfter.playerId)
      ) {
        const winner = postDrawSnapshot.players.find(
          (p) => p.id === miniGameAfter.playerId,
        );
        if (winner?.walletId) {
          deps.io.to(walletRoomKey(winner.walletId)).emit("minigame:activated", {
            gameId: postDrawSnapshot.currentGame?.id,
            playerId: miniGameAfter.playerId,
            type: miniGameAfter.type,
            prizeList: miniGameAfter.prizeList,
          });
          logRoomEvent(
            schedulerLogger,
            {
              roomCode,
              gameId: postDrawSnapshot.currentGame?.id,
              action: "minigame-activated",
              playerId: miniGameAfter.playerId,
              type: miniGameAfter.type,
            },
            "auto.round.tick",
          );
        }
      }
      if (postDrawSnapshot.currentGame?.status !== "RUNNING") {
        roundEnded = true;
        logRoomEvent(
          schedulerLogger,
          {
            roomCode,
            gameId: postDrawSnapshot.currentGame?.id,
            action: "ended",
            reason: postDrawSnapshot.currentGame?.endedReason ?? "UNKNOWN",
          },
          "auto.round.tick",
        );
      }
      await deps.emitRoomUpdate(roomCode);
      return { roundEnded };
    },
    applyPendingSettings: async (nowMs: number, summaries: unknown): Promise<boolean> => {
      return applyPendingBingoSettingsIfDue(nowMs, summaries as ReturnType<BingoEngine["listRoomSummaries"]>, deps);
    },
  };
}

// ── Daily report scheduler ──────────────────────────────────────────────────

export interface DailyReportSchedulerDeps {
  engine: BingoEngine;
  enabled: boolean;
  intervalMs: number;
  /**
   * G3 (2026-05-09): when set, also generates §71-canonical daily-report
   * rows in `app_daily_regulatory_reports` (with hash-chain) after the
   * legacy `runDailyReportJob` completes. Non-blocking — errors logged
   * but never propagate.
   * See `apps/backend/src/compliance/regulatory/DailyRegulatoryReportService.ts`.
   */
  regulatoryReportService?: {
    generateForDate(input: {
      date: string;
      generatedBy?: string | null;
    }): Promise<{
      rows: ReadonlyArray<{ inserted: boolean }>;
      chainsStartedFromGenesis: ReadonlyArray<unknown>;
    }>;
  };
}

export function createDailyReportScheduler(deps: DailyReportSchedulerDeps): { start: () => void; stop: () => void } {
  let lastDateKey = "";
  let handle: NodeJS.Timeout | null = null;

  async function tick(nowMs: number): Promise<void> {
    // LOW-2-fix 2026-04-26: bruk Oslo-tz, ikke server-lokal tid.
    // I Docker er server-lokal tid UTC, slik at "yesterday" mistolket
    // forrige dag rundt midnatt (en runde over Norge-midnatt mellom
    // 00:00 og 01/02 UTC ble registrert som "i dag" i UTC og rapporten
    // for "i går" inkluderte ikke disse omsetningene).
    const dateKey = yesterdayOsloKey(new Date(nowMs));
    if (dateKey === lastDateKey) return;
    const report = await deps.engine.runDailyReportJob({ date: dateKey });
    lastDateKey = dateKey;
    console.log(`[daily-report] generated date=${report.date} rows=${report.rows.length} turnover=${report.totals.grossTurnover} prizes=${report.totals.prizesPaid}`);

    // G3 (2026-05-09): regulatory daily-report (hash-chained, immutable).
    // Wrapped in a separate try/catch so a §71-store outage doesn't block
    // the legacy report flow.
    if (deps.regulatoryReportService) {
      try {
        const regResult = await deps.regulatoryReportService.generateForDate({
          date: dateKey,
        });
        const inserted = regResult.rows.filter((row) => row.inserted).length;
        const skipped = regResult.rows.length - inserted;
        const genesisCount = regResult.chainsStartedFromGenesis.length;
        console.log(
          `[regulatory-daily-report] date=${dateKey} rows=${regResult.rows.length} ` +
          `inserted=${inserted} skipped=${skipped} chainsFromGenesis=${genesisCount}`,
        );
      } catch (err) {
        console.error("[regulatory-daily-report] generation failed", err);
      }
    }
  }

  return {
    start() {
      if (!deps.enabled || handle) return;
      tick(Date.now()).catch((e) => console.error("[daily-report] initial run feilet", e));
      handle = setInterval(() => { tick(Date.now()).catch((e) => console.error("[daily-report] scheduler feilet", e)); }, deps.intervalMs);
      handle.unref();
    },
    stop() {
      if (handle) { clearInterval(handle); handle = null; }
    },
  };
}
