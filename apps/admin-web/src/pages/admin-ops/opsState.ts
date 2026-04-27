// ADMIN Super-User Operations Console — pure-state-store + delta-merger.
//
// Holdes utenfor selve AdminOpsConsolePage.ts slik at delta-mergingen kan
// enhetstestes uten å mounte DOM. Backend sender partial deltas over
// `admin:ops:update`; vi merger keyed-by-id (halls/rooms/groups/alerts).
//
// Konvensjoner:
//  - `applyDelta` muterer state in-place og returnerer en `dirtyKeys`-set
//    så UI bare re-rendrer det som faktisk endret seg.
//  - Alerts-listen sorteres alltid newest-first; severity-prioritering
//    skjer i view-laget for å beholde mutate-effektivitet.
//  - `replaceSnapshot` brukes ved full overview-refresh (init eller
//    reconnect-snapshot).

import type {
  OpsAlert,
  OpsGroupAggregate,
  OpsHall,
  OpsMetrics,
  OpsOverviewDelta,
  OpsOverviewResponse,
  OpsRoom,
} from "../../api/admin-ops.js";

export interface OpsState {
  halls: OpsHall[];
  rooms: OpsRoom[];
  groups: OpsGroupAggregate[];
  alerts: OpsAlert[];
  metrics: OpsMetrics;
  snapshotAt: string | null;
  /** True after first successful overview/snapshot. */
  loaded: boolean;
  /** Last error message, if any. UI clears on next successful fetch. */
  lastError: string | null;
}

export type OpsDirtyKey = "halls" | "rooms" | "groups" | "alerts" | "metrics";

export function createInitialState(): OpsState {
  return {
    halls: [],
    rooms: [],
    groups: [],
    alerts: [],
    metrics: { totalActiveRooms: 0, totalPlayersOnline: 0 },
    snapshotAt: null,
    loaded: false,
    lastError: null,
  };
}

export function replaceSnapshot(
  state: OpsState,
  snapshot: OpsOverviewResponse
): void {
  state.halls = snapshot.halls;
  state.rooms = snapshot.rooms;
  state.groups = snapshot.groups;
  state.alerts = sortAlerts(snapshot.alerts);
  state.metrics = snapshot.metrics;
  state.snapshotAt = snapshot.snapshotAt;
  state.loaded = true;
  state.lastError = null;
}

export function applyDelta(
  state: OpsState,
  delta: OpsOverviewDelta
): Set<OpsDirtyKey> {
  const dirty = new Set<OpsDirtyKey>();

  if (delta.halls && delta.halls.length > 0) {
    mergeById(state.halls, delta.halls, (h) => h.id);
    dirty.add("halls");
  }
  if (delta.rooms && delta.rooms.length > 0) {
    mergeById(state.rooms, delta.rooms, (r) => r.code);
    dirty.add("rooms");
  }
  if (delta.groups && delta.groups.length > 0) {
    mergeById(state.groups, delta.groups, (g) => g.id);
    dirty.add("groups");
  }
  if (delta.alerts && delta.alerts.length > 0) {
    mergeById(state.alerts, delta.alerts, (a) => a.id);
    state.alerts = sortAlerts(state.alerts);
    dirty.add("alerts");
  }
  if (delta.alertsRemovedIds && delta.alertsRemovedIds.length > 0) {
    const removeSet = new Set(delta.alertsRemovedIds);
    state.alerts = state.alerts.filter((a) => !removeSet.has(a.id));
    dirty.add("alerts");
  }
  if (delta.metrics) {
    state.metrics = delta.metrics;
    dirty.add("metrics");
  }
  if (delta.snapshotAt) {
    state.snapshotAt = delta.snapshotAt;
  }
  return dirty;
}

function mergeById<T>(
  existing: T[],
  incoming: T[],
  getKey: (item: T) => string
): void {
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < existing.length; i += 1) {
    const item = existing[i];
    if (item !== undefined) {
      indexByKey.set(getKey(item), i);
    }
  }
  for (const item of incoming) {
    const key = getKey(item);
    const idx = indexByKey.get(key);
    if (idx === undefined) {
      existing.push(item);
      indexByKey.set(key, existing.length - 1);
    } else {
      existing[idx] = item;
    }
  }
}

const SEVERITY_ORDER: Record<OpsAlert["severity"], number> = {
  CRITICAL: 0,
  WARN: 1,
  INFO: 2,
};

/**
 * Sort alerts: severity DESC (CRITICAL first), then createdAt DESC. Used
 * both on snapshot-replace and after delta-merge.
 */
export function sortAlerts(alerts: OpsAlert[]): OpsAlert[] {
  return [...alerts].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 99;
    const sb = SEVERITY_ORDER[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    // newest first — Date.parse handles ISO-8601.
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    return 0;
  });
}

/**
 * Group rooms by hallId for quick lookup when rendering hall-cards.
 * Pure function — no side effects on state.
 */
export function roomsByHallId(rooms: OpsRoom[]): Map<string, OpsRoom> {
  // Take the first ACTIVE room per hall — backend sends only active rooms,
  // but if multiple, prefer non-ENDED.
  const map = new Map<string, OpsRoom>();
  for (const room of rooms) {
    const existing = map.get(room.hallId);
    if (!existing) {
      map.set(room.hallId, room);
      continue;
    }
    const existingEnded = existing.currentGame?.status === "ENDED";
    const incomingEnded = room.currentGame?.status === "ENDED";
    if (existingEnded && !incomingEnded) {
      map.set(room.hallId, room);
    }
  }
  return map;
}
