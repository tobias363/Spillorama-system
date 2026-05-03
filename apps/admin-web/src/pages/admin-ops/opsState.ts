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
//
// Drill-down (feat/admin-ops-group-drilldown-v2):
//  - Top-level vy lister Group of Halls som primær-cards.
//  - Klikk på en GoH-card setter `state.view = "halls"` +
//    `state.selectedGroupId`, som filtrerer hallsGrid til kun den gruppens
//    haller. Tilbake-knapp resetter til "groups".
//  - Haller uten `groupOfHallsId` samles i en synthetic UNGROUPED-bucket
//    så ADMIN aldri "mister" haller når group-tilordning er ufullstendig.

import type {
  OpsAlert,
  OpsGroupAggregate,
  OpsHall,
  OpsMetrics,
  OpsOverviewDelta,
  OpsOverviewResponse,
  OpsRoom,
} from "../../api/admin-ops.js";

/**
 * UI-view-modus for ops-console.
 *
 * - `groups`: top-level — én card per Group of Halls (drill-down inngangsport).
 * - `halls`:  drill-down — viser hallene som tilhører `selectedGroupId`.
 *
 * Synthetic group-id for haller uten `groupOfHallsId`: bruk
 * {@link UNGROUPED_GROUP_ID} som constant placeholder.
 */
export type OpsView = "groups" | "halls";

/**
 * Synthetic id brukt for haller uten `groupOfHallsId`. Vises som
 * "Andre haller" på top-level. Constant så test/UI kan deles ut samme key.
 */
export const UNGROUPED_GROUP_ID = "__ungrouped__";

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
  /** Drill-down state — top-level groups vs. halls under selected group. */
  view: OpsView;
  /** Set when `view === "halls"`. Null on top-level. */
  selectedGroupId: string | null;
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
    view: "groups",
    selectedGroupId: null,
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
  // view + selectedGroupId bevares — operatøren kan f.eks. ha drillet inn
  // i en gruppe og vente på socket-snapshot. Ny snapshot endrer ikke vy.
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
 * Per-group-of-halls aggregat brukt på top-level "groups"-vy. Slår sammen
 * `OpsGroupAggregate` (backend-level totalPayoutToday + readyAggregate) med
 * runtime-tall fra `halls` + `rooms` + `alerts` slik at UI-et viser
 * status-her-og-nå uten å vente på neste delta.
 *
 * Halls uten `groupOfHallsId` samles i en synthetic-gruppe med
 * id = {@link UNGROUPED_GROUP_ID}.
 */
export interface OpsGroupSummary {
  id: string;
  name: string;
  hallCount: number;
  hallIds: string[];
  /** Master-hall navn for visning på card; null om ikke definert. */
  masterHallName: string | null;
  totalPlayersOnline: number;
  /** Antall rom i RUNNING-status på tvers av gruppens haller. */
  runningRoomsCount: number;
  /** Antall ikke-acknowledgede alerts knyttet til gruppens haller. */
  openAlertsCount: number;
  /** Antall haller i denne gruppen som er aktive (isActive=true). */
  activeHallCount: number;
  /**
   * Aggregert ready-state, eks "4/4". Hentet fra backend-aggregat når
   * tilgjengelig. Null hvis ikke definert.
   */
  readyAggregate: string | null;
  /** Total NOK-payout i dag. Null for synthetic ungrouped (ikke aggregert). */
  totalPayoutToday: number | null;
  /** True hvis dette er ungrouped-bucket. */
  isUngrouped: boolean;
}

/**
 * Slå sammen state.groups (backend-aggregat) + halls + rooms + alerts til
 * en flat liste av {@link OpsGroupSummary} brukt av top-level "groups"-vy.
 *
 * Haller uten `groupOfHallsId` samles i UNGROUPED-bucketen, som kun vises
 * når den faktisk inneholder haller.
 *
 * Pure function — ingen state-mutasjon. Trygg å kalle på hvert render.
 */
export function buildGroupSummaries(state: OpsState): OpsGroupSummary[] {
  const aggregateById = new Map<string, OpsGroupAggregate>();
  for (const group of state.groups) {
    aggregateById.set(group.id, group);
  }

  const hallsByGroup = new Map<string, OpsHall[]>();
  for (const hall of state.halls) {
    const key = hall.groupOfHallsId ?? UNGROUPED_GROUP_ID;
    let bucket = hallsByGroup.get(key);
    if (!bucket) {
      bucket = [];
      hallsByGroup.set(key, bucket);
    }
    bucket.push(hall);
  }

  const summaries: OpsGroupSummary[] = [];
  for (const [groupId, halls] of hallsByGroup) {
    const aggregate = aggregateById.get(groupId);
    const isUngrouped = groupId === UNGROUPED_GROUP_ID;
    const hallIds = halls.map((h) => h.id);
    const hallIdSet = new Set(hallIds);

    let totalPlayers = 0;
    let activeHallCount = 0;
    for (const hall of halls) {
      totalPlayers += hall.playersOnline;
      if (hall.isActive) activeHallCount += 1;
    }

    let runningRooms = 0;
    for (const room of state.rooms) {
      if (!hallIdSet.has(room.hallId)) continue;
      if (room.currentGame?.status === "RUNNING") {
        runningRooms += 1;
      }
    }

    let openAlerts = 0;
    for (const alert of state.alerts) {
      if (alert.acknowledgedAt !== null) continue;
      if (alert.hallId && hallIdSet.has(alert.hallId)) {
        openAlerts += 1;
      }
    }

    // Master-hall name: prefer the hall flagged as master in `halls[]`. We
    // pick the first hall whose `masterHallId` points to another hall in
    // the same group. For pilot the id is consistent within the group so
    // the first match is sufficient.
    let masterHallName: string | null = null;
    for (const hall of halls) {
      if (hall.masterHallId && hallIdSet.has(hall.masterHallId)) {
        const master = halls.find((h) => h.id === hall.masterHallId);
        if (master) {
          masterHallName = master.name;
          break;
        }
      }
    }

    const groupName =
      aggregate?.name ??
      halls.find((h) => h.groupName)?.groupName ??
      (isUngrouped ? "" : groupId);

    summaries.push({
      id: groupId,
      name: groupName,
      hallCount: halls.length,
      hallIds,
      masterHallName,
      totalPlayersOnline: totalPlayers,
      runningRoomsCount: runningRooms,
      openAlertsCount: openAlerts,
      activeHallCount,
      readyAggregate: aggregate?.readyAggregate ?? null,
      totalPayoutToday: isUngrouped ? null : aggregate?.totalPayoutToday ?? 0,
      isUngrouped,
    });
  }

  // Sort: real groups first (alpha by name), ungrouped last.
  summaries.sort((a, b) => {
    if (a.isUngrouped !== b.isUngrouped) return a.isUngrouped ? 1 : -1;
    return a.name.localeCompare(b.name, "nb");
  });

  return summaries;
}

/**
 * Filter halls to those belonging to a given group-id. Honors the synthetic
 * UNGROUPED-bucket (matches halls with `groupOfHallsId === null`).
 */
export function hallsInGroup(state: OpsState, groupId: string): OpsHall[] {
  if (groupId === UNGROUPED_GROUP_ID) {
    return state.halls.filter((h) => h.groupOfHallsId === null);
  }
  return state.halls.filter((h) => h.groupOfHallsId === groupId);
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
