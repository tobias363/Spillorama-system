/**
 * AdminOpsService — backend for ADMIN Super-User Operations Console
 * (`/admin/ops`).
 *
 * Bakgrunn (Tobias 2026-04-27):
 *   «jeg må være superbruker som kan raskt få oversikt over alle haller og
 *   alle pågående trekninger. er det feks en group og halls som har
 *   problemer, må jeg raskt kunne gå inn der for å begynne å feilsøke å
 *   hjelpe til».
 *
 * Tjenesten aggregerer state fra eksisterende services (HallService via
 * PlatformService, BingoEngine for rom-summary, HallGroupService for
 * grupperinger, WalletReconciliationService + PaymentRequestService for
 * alert-feed) og legger ny `app_ops_alerts`-tabell på toppen for
 * ops-spesifikke alerts (hall offline, stuck rooms, pre-flight-feil,
 * settlement-diff).
 *
 * Designprinsipper:
 *   - Aggregat-only: ingen mutasjon av source-state. Force-actions ruter
 *     gjennom eksisterende engine/hall-services i route-laget.
 *   - Pure compute: `computeHallHealth` er testbar uten DB.
 *   - Single-responsibility: tjenesten samler data; route-laget bruker den.
 */

import type { Pool } from "pg";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, HallDefinition } from "../platform/PlatformService.js";
import type { HallGroupService, HallGroup } from "./HallGroupService.js";
import type { WalletReconciliationService } from "../jobs/walletReconciliation.js";
import type { PaymentRequestService } from "../payments/PaymentRequestService.js";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "admin-ops-service" });

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * Health-status per hall — fargekode for ops-konsollet. Pengespillforskriften
 * krever at ADMIN raskt kan oppdage drift-problemer; fargen skal mappes 1:1
 * til en synlig indikator i UI.
 *   - GREEN  : alt OK (rom kjører, draws-rate normalt, ingen alerts)
 *   - YELLOW : warning (treg draws > 30s mellom, agent not-ready, partial-disconnect)
 *   - RED    : error (hall inaktiv, stuck-room > 60s uten draw, kritisk alert)
 */
export type HallHealthColor = "GREEN" | "YELLOW" | "RED";

export interface HealthInputForHall {
  /** Hallen som vurderes. */
  hall: HallDefinition;
  /** Aktive rom som er bundet til denne hallen (hallId match). */
  rooms: HallRoomSummary[];
  /** Tid akkurat nå i epoch ms (test-injekteres). */
  nowMs: number;
  /** Antall ÅPNE alerts som peker på denne hallen. */
  unacknowledgedAlertCount: number;
  /** Maks-severity blant åpne alerts (null hvis ingen). */
  maxAlertSeverity: AlertSeverity | null;
}

/**
 * Per-rom payload for ops-konsollet. Slankere enn full RoomSnapshot —
 * inneholder kun feltene UI trenger for live-oversikt + drill-down.
 */
export interface HallRoomSummary {
  code: string;
  hallId: string;
  gameSlug: string;
  playerCount: number;
  /**
   * `gameStatus` er enten en GameStatus ("WAITING"/"RUNNING"/"ENDED") eller
   * "NONE" når rommet ikke har et aktivt spill. Kommer direkte fra
   * `engine.listRoomSummaries`.
   */
  gameStatus: string;
  /**
   * Antall trukne baller i pågående runde. 0 hvis ingen runde eller før
   * første ball. Avledet fra getRoomSnapshot.currentGame.drawnNumbers.length.
   */
  drawnCount: number;
  /**
   * Maks-trekk i pågående runde (engine.maxDrawsPerRound default 75 for
   * 75-ball, 60 for 60-ball). Fra GameSnapshot via getRoomSnapshot.
   * `null` hvis ingen aktiv runde.
   */
  maxDraws: number | null;
  /** True hvis admin/host har pauset spillet. */
  isPaused: boolean;
  /** "MANUAL_END", "MAX_DRAWS_REACHED", osv. fra siste avsluttede runde. */
  endedReason: string | null;
  /** Sist trukne ball epoch ms. `null` hvis aldri trukket. */
  lastDrawAtMs: number | null;
  /** Rommet ble opprettet (ISO). */
  createdAt: string;
}

/**
 * Per-hall payload for ops-konsollet.
 */
export interface HallOpsRow {
  id: string;
  name: string;
  hallNumber: number | null;
  region: string;
  isActive: boolean;
  isTestHall: boolean;
  /** Hall-gruppen denne hallen er medlem i (første aktive). `null` hvis ingen. */
  groupId: string | null;
  groupName: string | null;
  /** ISO `app_halls.updated_at`. */
  updatedAt: string;
  /** Antall aktive rom (gameStatus !== "NONE" eller minst én spiller). */
  activeRoomCount: number;
  /** Sum av playerCount på tvers av hallens rom (proxy for "online players"). */
  totalPlayerCount: number;
  health: HallHealthColor;
  /** Kort menneskelesbar grunn til health-status (kun for YELLOW/RED). */
  healthReason: string | null;
  unacknowledgedAlertCount: number;
}

/**
 * Per-gruppe aggregat. ALL_READY/PARTIAL/NONE er heuristikk for "kan vi
 * starte spill nå?" — basert på antall haller med aktive rom.
 */
export type GroupReadyAggregate = "ALL_READY" | "PARTIAL" | "NONE";

export interface GroupOpsRow {
  groupId: string;
  groupName: string;
  hallCount: number;
  hallIds: string[];
  /** Antall haller i gruppen som har minst ett rom aktivt. */
  hallsWithActiveRoom: number;
  readyAggregate: GroupReadyAggregate;
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

/**
 * Kanonisert alert-shape uavhengig av kilde (ops-tabell, wallet-recon,
 * payment-request-pending, stop-game-vote osv.). Hver kilde mapper sine
 * rader til denne shape før de eksporteres til UI.
 */
export interface AdminOpsAlert {
  id: string;
  severity: AlertSeverity;
  /**
   * Maskinlesbar type, eks. "hall.offline", "room.stuck.no_draws",
   * "wallet.reconciliation.divergence", "payment_request.stale",
   * "settlement.diff.force_required".
   */
  type: string;
  hallId: string | null;
  message: string;
  details: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  createdAt: string;
  /** Kilde — for UI-filter og audit. "ops_alerts", "wallet_recon", "payment_request". */
  source: AdminOpsAlertSource;
}

export type AdminOpsAlertSource =
  | "ops_alerts"
  | "wallet_reconciliation"
  | "payment_request_pending";

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Port for "siste draw-tidspunkt per rom (epoch ms, eller null)".
 * Index.ts injecter en tynn adapter over `BingoEngine` sin lastDrawAt-map
 * når den er eksponert. Ellers gir vi en no-op-port (returnerer alltid
 * null = "ikke stuck") — fail-open siden stuck-detection er en advisory
 * funksjon og falske RED er verre enn falske GREEN.
 */
export type LastDrawAtPort = (roomCode: string) => number | null;

export interface AdminOpsServiceDeps {
  pool: Pool;
  schema?: string;
  platformService: PlatformService;
  engine: BingoEngine;
  /**
   * Optional — fall-back returnerer null (alle rom regnes som ikke-stuck).
   * Eksisterende BingoEngine eksponerer `lastDrawAtByRoom` som privat;
   * når en accessor lander vil index.ts injecte en tynn adapter.
   */
  lastDrawAtPort?: LastDrawAtPort;
  hallGroupService: HallGroupService;
  reconciliationService: WalletReconciliationService;
  paymentRequestService: PaymentRequestService;
  /**
   * Threshold for "stuck room": hvor mange ms siden siste draw før vi flagger.
   * Default 60 000ms (60s). Konfigurerbart for test-injeksjon og fremtidig
   * env-overstyring.
   */
  stuckRoomThresholdMs?: number;
  /**
   * Threshold for "slow draw": hvor mange ms siden siste draw før vi flagger
   * YELLOW. Default 30 000ms (30s).
   */
  slowDrawThresholdMs?: number;
  /** Threshold for "stale payment request": ms siden submitted. Default 30 min. */
  stalePaymentRequestThresholdMs?: number;
  /** Klokke (test-injekteres). */
  now?: () => number;
}

const DEFAULT_STUCK_ROOM_MS = 60_000;
const DEFAULT_SLOW_DRAW_MS = 30_000;
const DEFAULT_STALE_PAYMENT_MS = 30 * 60 * 1000;

const SCHEMA_RX = /^[a-z_][a-z0-9_]*$/i;

function assertSchemaName(schema: string): string {
  if (!SCHEMA_RX.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn for AdminOpsService.");
  }
  return schema;
}

/**
 * Pure compute-funksjon for hall-health. Test-injeksjon via
 * `HealthInputForHall`. Brukes både fra `aggregateOverview` (per-hall) og
 * direkte fra unit-tests.
 *
 * Reglene (i prioritert rekkefølge):
 *   1. Hallen er inaktiv (`!isActive`)         → RED  ("Hall inaktiv")
 *   2. CRITICAL-alert mot hallen               → RED  ("Kritisk alert: <type>")
 *   3. Stuck-room (RUNNING, ingen draw > 60s)  → RED  ("Stuck draw i rom X")
 *   4. WARNING-alert mot hallen                → YELLOW ("Alert: <type>")
 *   5. Slow-draw (RUNNING, ingen draw 30-60s)  → YELLOW ("Treg draw i rom X")
 *   6. Ellers                                   → GREEN
 *
 * `healthReason` er `null` for GREEN, kort tekst for YELLOW/RED.
 */
export function computeHallHealth(input: HealthInputForHall): {
  color: HallHealthColor;
  reason: string | null;
} {
  if (!input.hall.isActive) {
    return { color: "RED", reason: "Hall inaktiv" };
  }
  if (input.maxAlertSeverity === "CRITICAL") {
    return { color: "RED", reason: "Kritisk alert" };
  }

  // Inspect running rooms — først stuck (>= stuck threshold), så slow.
  const stuckRoom = input.rooms.find(
    (r) =>
      r.gameStatus === "RUNNING" &&
      r.lastDrawAtMs !== null &&
      input.nowMs - r.lastDrawAtMs >= DEFAULT_STUCK_ROOM_MS,
  );
  if (stuckRoom) {
    return {
      color: "RED",
      reason: `Stuck draw i rom ${stuckRoom.code} (${Math.floor(
        (input.nowMs - (stuckRoom.lastDrawAtMs ?? input.nowMs)) / 1000,
      )}s siden siste ball)`,
    };
  }

  if (input.maxAlertSeverity === "WARNING") {
    return { color: "YELLOW", reason: "Aktiv advarsel" };
  }

  const slowRoom = input.rooms.find(
    (r) =>
      r.gameStatus === "RUNNING" &&
      r.lastDrawAtMs !== null &&
      input.nowMs - r.lastDrawAtMs >= DEFAULT_SLOW_DRAW_MS,
  );
  if (slowRoom) {
    return {
      color: "YELLOW",
      reason: `Treg draw i rom ${slowRoom.code}`,
    };
  }

  return { color: "GREEN", reason: null };
}

/**
 * Beregn group-aggregat fra haller. Brukes både i overview og kan kalles
 * frittstående.
 */
export function computeGroupAggregate(input: {
  group: { id: string; name: string; hallIds: string[] };
  hallsById: Map<string, HallOpsRow>;
}): GroupOpsRow {
  const hallsWithActiveRoom = input.group.hallIds.filter((hallId) => {
    const hall = input.hallsById.get(hallId);
    return hall ? hall.activeRoomCount > 0 : false;
  }).length;

  let readyAggregate: GroupReadyAggregate;
  if (hallsWithActiveRoom === 0) readyAggregate = "NONE";
  else if (hallsWithActiveRoom === input.group.hallIds.length)
    readyAggregate = "ALL_READY";
  else readyAggregate = "PARTIAL";

  return {
    groupId: input.group.id,
    groupName: input.group.name,
    hallCount: input.group.hallIds.length,
    hallIds: input.group.hallIds,
    hallsWithActiveRoom,
    readyAggregate,
  };
}

interface OpsAlertRow {
  id: string;
  severity: AlertSeverity;
  type: string;
  hall_id: string | null;
  message: string;
  details: Record<string, unknown> | null;
  acknowledged_at: Date | string | null;
  acknowledged_by_user_id: string | null;
  created_at: Date | string;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return asIso(value);
}

/**
 * Returnerer maks-severity (CRITICAL > WARNING > INFO) blant et alert-sett.
 */
function maxSeverity(alerts: AdminOpsAlert[]): AlertSeverity | null {
  if (alerts.some((a) => a.severity === "CRITICAL")) return "CRITICAL";
  if (alerts.some((a) => a.severity === "WARNING")) return "WARNING";
  if (alerts.some((a) => a.severity === "INFO")) return "INFO";
  return null;
}

export class AdminOpsService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly platformService: PlatformService;
  private readonly engine: BingoEngine;
  private readonly lastDrawAtPort: LastDrawAtPort;
  private readonly hallGroupService: HallGroupService;
  private readonly reconciliationService: WalletReconciliationService;
  private readonly paymentRequestService: PaymentRequestService;
  private readonly stuckRoomMs: number;
  private readonly slowDrawMs: number;
  private readonly stalePaymentMs: number;
  private readonly now: () => number;

  constructor(deps: AdminOpsServiceDeps) {
    this.pool = deps.pool;
    this.schema = assertSchemaName(deps.schema ?? "public");
    this.platformService = deps.platformService;
    this.engine = deps.engine;
    // Fall-back: alle rom regnes som ikke-stuck (null lastDrawAt → ingen RED)
    // hvis port ikke er konfigurert.
    this.lastDrawAtPort = deps.lastDrawAtPort ?? (() => null);
    this.hallGroupService = deps.hallGroupService;
    this.reconciliationService = deps.reconciliationService;
    this.paymentRequestService = deps.paymentRequestService;
    this.stuckRoomMs = deps.stuckRoomThresholdMs ?? DEFAULT_STUCK_ROOM_MS;
    this.slowDrawMs = deps.slowDrawThresholdMs ?? DEFAULT_SLOW_DRAW_MS;
    this.stalePaymentMs =
      deps.stalePaymentRequestThresholdMs ?? DEFAULT_STALE_PAYMENT_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Kjernekall — bygger global ops-overview.
   *
   * Ytelse: tre paralleliserbare lese-kilder (DB-listHalls, DB-listGroups,
   * in-memory engine-rooms) + alerts-aggregat. Minne-bruk er O(haller +
   * rom + alerts) — typisk < 1MB selv for 100 haller med 10 rom hver.
   */
  async aggregateOverview(): Promise<{
    halls: HallOpsRow[];
    rooms: HallRoomSummary[];
    groups: GroupOpsRow[];
    alerts: AdminOpsAlert[];
    metrics: {
      totalHalls: number;
      activeHalls: number;
      totalRooms: number;
      runningRooms: number;
      totalPlayersOnline: number;
      totalAlerts: number;
      criticalAlerts: number;
      warningAlerts: number;
    };
  }> {
    const nowMs = this.now();

    // Parallel reads.
    const [halls, hallGroups, alerts] = await Promise.all([
      this.platformService.listHalls({ includeInactive: true }),
      this.hallGroupService.list({ status: "active" }),
      this.listActiveAlerts({ limit: 200 }),
    ]);

    // Engine-rom: in-memory, fast. Berik med drawn/maxDraws/lastDrawAt fra
    // getRoomSnapshot — for å unngå N kall per rom over engine-snapshot
    // gjør vi en lookup når vi bygger HallRoomSummary.
    const summaries = this.engine.listRoomSummaries();
    const rooms: HallRoomSummary[] = summaries.map((s) => {
      let drawnCount = 0;
      let maxDraws: number | null = null;
      let isPaused = false;
      let endedReason: string | null = null;
      try {
        const snap = this.engine.getRoomSnapshot(s.code);
        if (snap.currentGame) {
          drawnCount = snap.currentGame.drawnNumbers.length;
          // maxDraws er ikke direkte i GameSnapshot; vi henter remaining +
          // drawn for å approksimere. Fall-back null hvis ikke tilgjengelig.
          maxDraws = snap.currentGame.drawBag.length + drawnCount;
          isPaused = Boolean(snap.currentGame.isPaused);
          endedReason = snap.currentGame.endedReason ?? null;
        }
      } catch (err) {
        // Hvis snapshot feiler (eks. rom ble destroy mellom listRoomSummaries
        // og getRoomSnapshot) — fall-back til defaults og logg warning.
        log.warn(
          { err, code: s.code },
          "snapshot failed during aggregateOverview — using defaults",
        );
      }
      return {
        code: s.code,
        hallId: s.hallId,
        gameSlug: s.gameSlug,
        playerCount: s.playerCount,
        gameStatus: s.gameStatus,
        drawnCount,
        maxDraws,
        isPaused,
        endedReason,
        lastDrawAtMs: this.lastDrawAtPort(s.code),
        createdAt: s.createdAt,
      };
    });

    // Bygg alerts-by-hall map for health-compute.
    const alertsByHall = new Map<string | null, AdminOpsAlert[]>();
    for (const a of alerts) {
      if (a.acknowledged) continue;
      const arr = alertsByHall.get(a.hallId) ?? [];
      arr.push(a);
      alertsByHall.set(a.hallId, arr);
    }

    // Bygg per-hall row.
    const hallRows: HallOpsRow[] = halls.map((hall) => {
      const hallRooms = rooms.filter((r) => r.hallId === hall.id);
      const activeRoomCount = hallRooms.filter(
        (r) => r.gameStatus !== "NONE" && r.gameStatus !== "ENDED",
      ).length;
      const totalPlayerCount = hallRooms.reduce(
        (sum, r) => sum + r.playerCount,
        0,
      );
      const hallAlerts = alertsByHall.get(hall.id) ?? [];
      const sev = maxSeverity(hallAlerts);

      const health = computeHallHealth({
        hall,
        rooms: hallRooms,
        nowMs,
        unacknowledgedAlertCount: hallAlerts.length,
        maxAlertSeverity: sev,
      });

      // Slå opp gruppen via hallGroups-listen (allerede hentet) — unngå
      // round-trip per hall.
      const group = findGroupForHall(hallGroups, hall.id);

      return {
        id: hall.id,
        name: hall.name,
        hallNumber: hall.hallNumber ?? null,
        region: hall.region,
        isActive: hall.isActive,
        isTestHall: Boolean(hall.isTestHall),
        groupId: group?.id ?? null,
        groupName: group?.name ?? null,
        updatedAt: hall.updatedAt,
        activeRoomCount,
        totalPlayerCount,
        health: health.color,
        healthReason: health.reason,
        unacknowledgedAlertCount: hallAlerts.length,
      };
    });

    // Build group rows.
    const hallsById = new Map(hallRows.map((h) => [h.id, h]));
    const groupRows: GroupOpsRow[] = hallGroups.map((g) =>
      computeGroupAggregate({
        group: {
          id: g.id,
          name: g.name,
          hallIds: g.members.map((m) => m.hallId),
        },
        hallsById,
      }),
    );

    const totalRooms = rooms.length;
    const runningRooms = rooms.filter((r) => r.gameStatus === "RUNNING").length;
    const totalPlayersOnline = rooms.reduce(
      (sum, r) => sum + r.playerCount,
      0,
    );
    const criticalAlerts = alerts.filter(
      (a) => !a.acknowledged && a.severity === "CRITICAL",
    ).length;
    const warningAlerts = alerts.filter(
      (a) => !a.acknowledged && a.severity === "WARNING",
    ).length;

    return {
      halls: hallRows,
      rooms,
      groups: groupRows,
      alerts,
      metrics: {
        totalHalls: hallRows.length,
        activeHalls: hallRows.filter((h) => h.isActive).length,
        totalRooms,
        runningRooms,
        totalPlayersOnline,
        totalAlerts: alerts.filter((a) => !a.acknowledged).length,
        criticalAlerts,
        warningAlerts,
      },
    };
  }

  /**
   * Liste alle aktive alerts på tvers av kilder.
   * Sortert nyeste først, capped på `limit` (default 200).
   *
   * Kilder:
   *   1. `app_ops_alerts` (ops-spesifikke — vi eier disse)
   *   2. `wallet_reconciliation_alerts` (mappet til wallet.reconciliation.divergence)
   *   3. PaymentRequestService — pending requests > 30min (mappet til payment_request.stale)
   */
  async listActiveAlerts(
    options: { limit?: number } = {},
  ): Promise<AdminOpsAlert[]> {
    const limit = Math.max(1, Math.min(500, options.limit ?? 200));

    const [opsAlerts, walletAlerts, stalePaymentAlerts] = await Promise.all([
      this.listOpsAlerts(limit),
      this.listWalletReconciliationAsAlerts(),
      this.listStalePaymentRequestsAsAlerts(),
    ]);

    const all = [...opsAlerts, ...walletAlerts, ...stalePaymentAlerts];
    all.sort((a, b) => {
      // Acked siste; nyeste først.
      if (a.acknowledged !== b.acknowledged) {
        return a.acknowledged ? 1 : -1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
    return all.slice(0, limit);
  }

  /**
   * Insert ny ops-alert. Idempotent på (type, hall_id) når alert er åpen.
   * Returnerer eksisterende rad hvis det allerede finnes en åpen alert
   * med samme (type, hall_id).
   */
  async createAlert(input: {
    severity: AlertSeverity;
    type: string;
    hallId: string | null;
    message: string;
    details?: Record<string, unknown>;
  }): Promise<AdminOpsAlert> {
    const { rows } = await this.pool.query<OpsAlertRow>(
      `INSERT INTO "${this.schema}"."app_ops_alerts"
         (severity, type, hall_id, message, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (type, COALESCE(hall_id, '')) WHERE acknowledged_at IS NULL
       DO UPDATE SET details = EXCLUDED.details, message = EXCLUDED.message
       RETURNING id, severity, type, hall_id, message, details,
                 acknowledged_at, acknowledged_by_user_id, created_at`,
      [
        input.severity,
        input.type,
        input.hallId,
        input.message,
        JSON.stringify(input.details ?? {}),
      ],
    );
    const row = rows[0]!;
    return this.mapOpsAlert(row);
  }

  /**
   * Marker en ops-alert som acknowledged. Returnerer true hvis raden ble
   * oppdatert, false hvis ikke funnet eller allerede ack-et.
   * Wallet-recon og payment-stale-alerts kan IKKE ack-es her — de har egne
   * resolve-ruter (wallet) eller blir borte automatisk når underliggende
   * tilstand endrer seg (payment).
   */
  async acknowledgeAlert(
    id: string,
    acknowledgedByUserId: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE "${this.schema}"."app_ops_alerts"
          SET acknowledged_at = now(),
              acknowledged_by_user_id = $2
        WHERE id = $1 AND acknowledged_at IS NULL`,
      [id, acknowledgedByUserId],
    );
    return (rowCount ?? 0) > 0;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async listOpsAlerts(limit: number): Promise<AdminOpsAlert[]> {
    const { rows } = await this.pool.query<OpsAlertRow>(
      `SELECT id, severity, type, hall_id, message, details,
              acknowledged_at, acknowledged_by_user_id, created_at
         FROM "${this.schema}"."app_ops_alerts"
         WHERE acknowledged_at IS NULL
         ORDER BY
           CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
           created_at DESC
         LIMIT $1`,
      [limit],
    );
    return rows.map((r) => this.mapOpsAlert(r));
  }

  private async listWalletReconciliationAsAlerts(): Promise<AdminOpsAlert[]> {
    const rows = await this.reconciliationService.listOpenAlerts(100);
    return rows.map((r) => ({
      id: `wallet-recon:${r.id}`,
      severity: "CRITICAL" as AlertSeverity,
      type: "wallet.reconciliation.divergence",
      hallId: null,
      message: `Wallet-divergens: konto ${r.accountId} (${r.accountSide}) — forventet ${r.expectedBalance.toFixed(2)}, faktisk ${r.actualBalance.toFixed(2)}, diff ${r.divergence.toFixed(2)}`,
      details: {
        accountId: r.accountId,
        accountSide: r.accountSide,
        expectedBalance: r.expectedBalance,
        actualBalance: r.actualBalance,
        divergence: r.divergence,
      },
      acknowledged: false,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      createdAt: r.detectedAt,
      source: "wallet_reconciliation" as AdminOpsAlertSource,
    }));
  }

  private async listStalePaymentRequestsAsAlerts(): Promise<AdminOpsAlert[]> {
    // PaymentRequestService eksponerer listPending(); vi filtrerer her
    // siden tjenesten ikke har egen "stale"-API.
    let pending: Awaited<ReturnType<PaymentRequestService["listPending"]>> = [];
    try {
      pending = await this.paymentRequestService.listPending({ limit: 200 });
    } catch (err) {
      log.warn({ err }, "listPending payment-requests failed");
      return [];
    }
    const now = this.now();
    return pending
      .filter((r) => {
        const submittedMs = new Date(r.createdAt).getTime();
        return Number.isFinite(submittedMs) && now - submittedMs >= this.stalePaymentMs;
      })
      .map((r) => {
        const submittedMs = new Date(r.createdAt).getTime();
        const ageMin = Math.floor((now - submittedMs) / 60000);
        return {
          id: `payment-stale:${r.id}`,
          severity: "WARNING" as AlertSeverity,
          type: "payment_request.stale",
          hallId: r.hallId ?? null,
          message: `${r.kind === "deposit" ? "Innskudd" : "Uttak"}-forespørsel ${r.id.slice(0, 8)} har ventet ${ageMin}min på godkjenning`,
          details: {
            paymentRequestId: r.id,
            kind: r.kind,
            amountCents: r.amountCents,
            ageMin,
            userId: r.userId,
          },
          acknowledged: false,
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          createdAt: r.createdAt,
          source: "payment_request_pending" as AdminOpsAlertSource,
        };
      });
  }

  private mapOpsAlert(row: OpsAlertRow): AdminOpsAlert {
    return {
      id: row.id,
      severity: row.severity,
      type: row.type,
      hallId: row.hall_id,
      message: row.message,
      details: row.details ?? {},
      acknowledged: row.acknowledged_at !== null,
      acknowledgedAt: asIsoOrNull(row.acknowledged_at),
      acknowledgedByUserId: row.acknowledged_by_user_id,
      createdAt: asIso(row.created_at),
      source: "ops_alerts",
    };
  }
}

function findGroupForHall(
  groups: HallGroup[],
  hallId: string,
): { id: string; name: string } | null {
  for (const g of groups) {
    if (g.members.some((m) => m.hallId === hallId)) {
      return { id: g.id, name: g.name };
    }
  }
  return null;
}
