import type {
  CandyRoomSchedulerState,
} from "@/domain/realtime/contracts";

export function resolveSchedulerCountdownLabel(
  scheduler: CandyRoomSchedulerState | undefined,
  fallbackLabel: string,
  nowMs: number,
  gameStatus?: string,
): string {
  if (gameStatus === "RUNNING") {
    return "";
  }

  if (!scheduler?.enabled) {
    return fallbackLabel;
  }

  const targetStartMs = resolveSchedulerTargetStartMs(scheduler);
  if (targetStartMs === null) {
    return fallbackLabel;
  }

  return formatCountdownFromMillis(Math.max(0, targetStartMs - nowMs));
}

function resolveSchedulerTargetStartMs(
  scheduler: CandyRoomSchedulerState,
): number | null {
  if (typeof scheduler.nextStartAt === "string" && scheduler.nextStartAt.trim().length > 0) {
    const parsed = Date.parse(scheduler.nextStartAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (
    Number.isFinite(scheduler.millisUntilNextStart) &&
    typeof scheduler.serverTime === "string" &&
    scheduler.serverTime.trim().length > 0
  ) {
    const serverTimeMs = Date.parse(scheduler.serverTime);
    if (Number.isFinite(serverTimeMs)) {
      return serverTimeMs + Math.max(0, scheduler.millisUntilNextStart ?? 0);
    }
  }

  return null;
}

function formatCountdownFromMillis(millis: number): string {
  const totalSeconds = Math.max(0, Math.floor(millis / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
