/**
 * DrawScheduler callback factory and pending-settings logic.
 * Extracted from index.ts. Stateless — all mutable data is passed as arguments.
 */
import type { Server } from "socket.io";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { DrawScheduler, SchedulerSettings } from "../draw-engine/DrawScheduler.js";
import type { BingoSchedulerSettings } from "./bingoSettings.js";
import type { RoomUpdatePayload } from "./roomHelpers.js";
import type { RoomSnapshot } from "../game/types.js";

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
      for (const roomCode of activeRoomCodes) {
        deps.io.to(roomCode).emit("room:update", {
          ...deps.buildRoomUpdatePayload(deps.engine.getRoomSnapshot(roomCode)),
          serverRestarting: true
        });
      }
    },
    onAutoStart: async (roomCode: string, hostPlayerId: string): Promise<{ firstDrawAtMs: number | null }> => {
      let firstDrawAtMs: number | null = null;
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
        deps.disarmAllPlayers(roomCode);
        deps.clearReservationIdsForRoom?.(roomCode);
        deps.clearDisplayTicketCache(roomCode);
      } catch (error) {
        if (error instanceof DomainError && (
          error.code === "PLAYER_ALREADY_IN_RUNNING_GAME" ||
          error.code === "ROUND_START_TOO_SOON" ||
          error.code === "NOT_ENOUGH_PLAYERS"
        )) return { firstDrawAtMs };
        throw error;
      }
      await deps.emitRoomUpdate(roomCode);
      if (!deps.runtimeBingoSettings.autoDrawEnabled) return { firstDrawAtMs };
      try {
        const { number, drawIndex, gameId } = await deps.engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId });
        deps.io.to(roomCode).emit("draw:new", { number, source: "auto", drawIndex, gameId });
        firstDrawAtMs = Date.now();
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
      try {
        const { number, drawIndex, gameId } = await deps.engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId });
        deps.io.to(roomCode).emit("draw:new", { number, source: "auto", drawIndex, gameId });
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
      if (postDrawSnapshot.currentGame?.status !== "RUNNING") roundEnded = true;
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
}

export function createDailyReportScheduler(deps: DailyReportSchedulerDeps): { start: () => void; stop: () => void } {
  let lastDateKey = "";
  let handle: NodeJS.Timeout | null = null;

  async function tick(nowMs: number): Promise<void> {
    const d = new Date(nowMs);
    const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    const dateKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    if (dateKey === lastDateKey) return;
    const report = await deps.engine.runDailyReportJob({ date: dateKey });
    lastDateKey = dateKey;
    console.log(`[daily-report] generated date=${report.date} rows=${report.rows.length} turnover=${report.totals.grossTurnover} prizes=${report.totals.prizesPaid}`);
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
