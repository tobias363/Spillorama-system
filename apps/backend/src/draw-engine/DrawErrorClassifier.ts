/**
 * DrawErrorClassifier — categorizes errors from the draw/scheduler pipeline.
 *
 * Three categories:
 * - PERMANENT: Expected domain outcomes (round ended, not enough players).
 *   These are normal — log at info level, don't retry.
 * - TRANSIENT: Temporary failures that may resolve on the next tick
 *   (DB timeout, network hiccup). Log at warn level, retry automatically.
 * - FATAL: Unexpected errors (nullpointer, unknown exception).
 *   Log at error level, don't retry (watchdog will detect if room stalls).
 *
 * Design: the classifier never swallows errors — it returns metadata so
 * the caller decides how to handle. Metrics are tracked per category and
 * per room for the health endpoint.
 */

import { DomainError } from "../game/BingoEngine.js";

// ── Types ─────────────────────────────────────────────────────

export type DrawErrorCategory = "PERMANENT" | "TRANSIENT" | "FATAL";

export interface DrawErrorClassification {
  category: DrawErrorCategory;
  /** Whether the scheduler should retry this room on the next tick. */
  shouldRetry: boolean;
  /** Suggested log level. */
  logLevel: "info" | "warn" | "error";
  /** Human-readable reason for the classification. */
  reason: string;
}

export interface DrawErrorMetrics {
  permanent: number;
  transient: number;
  fatal: number;
  byRoom: Map<string, { permanent: number; transient: number; fatal: number }>;
}

// ── Known DomainError codes ───────────────────────────────────

/**
 * DomainError codes that indicate the round ended normally or that
 * a precondition wasn't met. These are expected during normal operation.
 */
const PERMANENT_CODES = new Set([
  "NO_MORE_NUMBERS",
  "GAME_NOT_RUNNING",
  "GAME_ALREADY_RUNNING",
  "ROUND_START_TOO_SOON",
  "NOT_ENOUGH_PLAYERS",
  "PLAYER_ALREADY_IN_RUNNING_GAME",
  "ROOM_NOT_FOUND",
]);

/**
 * DomainError codes that may resolve on retry (e.g. player state changed
 * between checks, or a wallet was temporarily unavailable).
 */
const TRANSIENT_CODES = new Set([
  "PLAYER_NOT_FOUND",
  "WALLET_ERROR",
  "INSUFFICIENT_BALANCE",
]);

// ── Classifier ────────────────────────────────────────────────

export function classifyDrawError(error: unknown): DrawErrorClassification {
  if (error instanceof DomainError) {
    if (PERMANENT_CODES.has(error.code)) {
      return {
        category: "PERMANENT",
        shouldRetry: false,
        logLevel: "info",
        reason: `DomainError.${error.code}: ${error.message}`,
      };
    }
    if (TRANSIENT_CODES.has(error.code)) {
      return {
        category: "TRANSIENT",
        shouldRetry: true,
        logLevel: "warn",
        reason: `DomainError.${error.code}: ${error.message}`,
      };
    }
    // Unknown DomainError code — treat as fatal (we should add it above).
    return {
      category: "FATAL",
      shouldRetry: false,
      logLevel: "error",
      reason: `Unknown DomainError.${error.code}: ${error.message}`,
    };
  }

  // Non-DomainError — always fatal.
  const msg = error instanceof Error ? error.message : String(error);
  return {
    category: "FATAL",
    shouldRetry: false,
    logLevel: "error",
    reason: `Unexpected: ${msg}`,
  };
}

// ── Metrics Tracker ───────────────────────────────────────────

export class DrawErrorTracker {
  private _permanent = 0;
  private _transient = 0;
  private _fatal = 0;
  private _byRoom = new Map<string, { permanent: number; transient: number; fatal: number }>();

  /** Record a classified error for a specific room. */
  record(roomCode: string, classification: DrawErrorClassification): void {
    switch (classification.category) {
      case "PERMANENT":
        this._permanent++;
        break;
      case "TRANSIENT":
        this._transient++;
        break;
      case "FATAL":
        this._fatal++;
        break;
    }

    let room = this._byRoom.get(roomCode);
    if (!room) {
      room = { permanent: 0, transient: 0, fatal: 0 };
      this._byRoom.set(roomCode, room);
    }
    room[classification.category.toLowerCase() as "permanent" | "transient" | "fatal"]++;
  }

  /** Get aggregate metrics. */
  get metrics(): DrawErrorMetrics {
    return {
      permanent: this._permanent,
      transient: this._transient,
      fatal: this._fatal,
      byRoom: new Map(this._byRoom),
    };
  }

  /** Summary for JSON serialization (health endpoint). */
  toJSON(): { permanent: number; transient: number; fatal: number } {
    return {
      permanent: this._permanent,
      transient: this._transient,
      fatal: this._fatal,
    };
  }

  /** Remove metrics for rooms that no longer exist. */
  cleanup(activeRoomCodes: Set<string>): void {
    for (const code of this._byRoom.keys()) {
      if (!activeRoomCodes.has(code)) {
        this._byRoom.delete(code);
      }
    }
  }
}
