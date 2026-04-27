// ADMIN Super-User Operations Console — pure-function helsestatus.
//
// Inputs: hall + (valgfritt) det aktive rommet for hallen.
// Output: badge med farge ("green" | "yellow" | "red" | "inactive"),
// kort label-key og en mer detaljert reason-streng.
//
// Badge-tilstander:
//  - 🟢 GREEN: room.status="RUNNING" + last-draw < 30s + ingen recent errors
//  - 🟡 YELLOW: status="PAUSED", last-draw 30–60s, settlement-warning,
//    eller venter på ready ("WAITING")
//  - 🔴 RED: status="ENDED" uten følgende start ELLER stuck-draw
//    (>60s siden last-draw med RUNNING)
//  - ⚫ INACTIVE: hall.is_active=false eller ingen rom i drift
//
// Beholdt som ren funksjon for å gjøre badge-logikken enhetstestbar uten
// DOM/sockets. UI bruker `computeHealthBadge` direkte; tester sjekker
// alle grenseverdier (29s/30s/59s/60s) for å fange off-by-one feil.

import type { OpsHall, OpsRoom } from "../../api/admin-ops.js";

export type HealthColor = "green" | "yellow" | "red" | "inactive";

export interface HealthBadge {
  color: HealthColor;
  /** Short label for the badge, e.g. "Running R12/75", "Paused", "Stuck". */
  label: string;
  /** Human-readable explanation for hover/tooltip. */
  reason: string;
}

const STUCK_THRESHOLD_MS = 60_000;
const SLOW_THRESHOLD_MS = 30_000;

export function computeHealthBadge(
  hall: OpsHall,
  room: OpsRoom | null,
  now: number = Date.now()
): HealthBadge {
  if (!hall.isActive) {
    return {
      color: "inactive",
      label: "Inactive",
      reason: "Hall is disabled.",
    };
  }

  if (!room || !room.currentGame) {
    return {
      color: "inactive",
      label: "Idle",
      reason: "No active room.",
    };
  }

  const game = room.currentGame;
  const status = game.status;

  if (status === "ENDED") {
    return {
      color: "red",
      label: "Ended",
      reason: game.endedReason
        ? `Round ended: ${game.endedReason}`
        : "Round has ended without follow-up start.",
    };
  }

  // PAUSED / WAITING are yellow regardless of draw timing — operator
  // attention needed, but not red.
  if (status === "PAUSED" || game.isPaused) {
    return {
      color: "yellow",
      label: "Paused",
      reason: "Round paused — awaiting operator action.",
    };
  }

  if (status === "WAITING" || status === "NONE") {
    return {
      color: "yellow",
      label: "Waiting",
      reason: "Awaiting hall ready / round start.",
    };
  }

  // RUNNING — gate on last-draw timing.
  if (status === "RUNNING") {
    const lastDrawAtMs = room.lastDrawAt
      ? Date.parse(room.lastDrawAt)
      : Number.NaN;
    if (!Number.isFinite(lastDrawAtMs)) {
      // No draws yet but RUNNING — fresh start, treat as healthy.
      return {
        color: "green",
        label: drawProgressLabel(game),
        reason: "Round just started.",
      };
    }
    const sinceLastDrawMs = now - lastDrawAtMs;
    if (sinceLastDrawMs >= STUCK_THRESHOLD_MS) {
      return {
        color: "red",
        label: "Stuck",
        reason: `No draw progress for ${Math.round(sinceLastDrawMs / 1000)}s.`,
      };
    }
    if (sinceLastDrawMs >= SLOW_THRESHOLD_MS) {
      return {
        color: "yellow",
        label: drawProgressLabel(game),
        reason: `Slow draw (${Math.round(sinceLastDrawMs / 1000)}s since last ball).`,
      };
    }
    return {
      color: "green",
      label: drawProgressLabel(game),
      reason: `Last draw ${Math.round(sinceLastDrawMs / 1000)}s ago.`,
    };
  }

  // Should not reach here — exhaustive on OpsRoomStatus.
  return {
    color: "yellow",
    label: status,
    reason: `Unknown status: ${status}`,
  };
}

function drawProgressLabel(game: {
  drawnNumbersCount: number;
  maxDraws: number;
}): string {
  const max = game.maxDraws > 0 ? game.maxDraws : 75;
  return `R${game.drawnNumbersCount}/${max}`;
}
