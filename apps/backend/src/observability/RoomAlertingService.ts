/**
 * BIN-815 / R8 — Alerting for live-rom-helse (Spill 1/2/3).
 *
 * Mandat-ref: `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
 * §3.4 R8. Bygger på R7 (BIN-814) `publicGameHealth.ts` — denne servicen
 * poller samme data via en injisert `HealthCheckPort` og varsler ops via
 * Slack-webhook eller PagerDuty Events API v2 når noe er galt.
 *
 * Designprinsipper:
 *   - Fail-soft: hvis Slack/PD/Postgres er nede skal IKKE polling-loopen
 *     krasje. Alle eksterne kall er try/catch + log.warn, slik at neste
 *     tick fortsatt kjører. R8 må ikke kunne ta backenden ned.
 *   - Pure-compute der mulig: `evaluateAlerts()` er testbar uten DB,
 *     uten fetch og uten klokke (klokke er injisert).
 *   - Kanal-DI: `AlertChannel`-interface gjør at vi kan stub-e Slack og
 *     PD i tester. Service vet ikke om implementasjons-detaljer.
 *   - De-dup-vindu: én alert per (game, hallId, scenario) per N minutter
 *     — minimerer spam under hendelser uten å miste persistent-down-signal.
 *   - Hash-chain audit-log: hver alert som sendes får en rad i
 *     `app_alert_log` med SHA-256-link til forrige rad (BIN-764-mønster).
 *
 * Alert-scenarier (per BIN-815):
 *   1. `status_down`              — health.status === "down" i > N sekunder
 *      (vedvarende — én blip skal ikke trigge).
 *   2. `draw_stale`               — `lastDrawAge > 2 × ball-intervall`
 *      (Spill 1: ~10s ball-intervall → > 20s draw-stale).
 *   3. `redis_unhealthy`          — `redisHealthy === false`.
 *   4. `db_unhealthy`             — `dbHealthy === false`.
 *   5. `wallet_reconciliation_mismatch` — eksisterende
 *      `wallet_reconciliation_alerts`-tabell har åpne rader.
 *
 * Kanal-prioritet (alle som er konfigurert kalles i parallel):
 *   - Slack-webhook: enkel POST med `{ text: "..." }`. Default for warning.
 *   - PagerDuty Events API v2: POST til `events.pagerduty.com/v2/enqueue`
 *     med `routing_key` + `event_action: "trigger"` + `dedup_key`.
 *     Default for critical.
 *   - Console: alltid på som fallback hvis ingen webhook konfigurert.
 *
 * Persistent-down-deteksjon (#1):
 *   Vi holder en in-memory map `lastSeenDownSinceMs[scenarioKey]` som
 *   settes første gang vi observerer status="down". Alert trigges først
 *   når `now - lastSeenDownSinceMs > PERSISTENT_DOWN_THRESHOLD_MS`. Når
 *   status flipper tilbake til "ok"/"degraded" tørkes mappen.
 *
 * Konfigurasjon (env-vars):
 *   - `SLACK_ALERT_WEBHOOK_URL`         : Slack incoming-webhook-URL.
 *   - `PAGERDUTY_INTEGRATION_KEY`       : PD Events API v2 routing-key.
 *   - `ROOM_ALERTING_POLL_INTERVAL_MS`  : tick-frekvens (default 30 000).
 *   - `ROOM_ALERTING_DEDUP_MINUTES`     : de-dup-vindu (default 15 min).
 *   - `ROOM_ALERTING_PERSISTENT_DOWN_MS`: hvor lenge "down" må vedvare før
 *                                          vi alarmerer (default 30 000).
 *   - `ROOM_ALERTING_DRAW_STALE_MS`     : draw-stale-grense (default 20 000).
 *   - `ROOM_ALERTING_HALL_IDS`          : komma-separert liste av hall-ID-er
 *                                          å polle. Default = scan'es fra DB.
 *   - `ROOM_ALERTING_ENABLED`           : master kill-switch (default true).
 */

import { createHash } from "node:crypto";
import type { Pool } from "pg";

import { logger as rootLogger, type Logger } from "../util/logger.js";

const log = rootLogger.child({ module: "room-alerting" });

// ── Constants ──────────────────────────────────────────────────────────────

/** Genesis-hash for første rad i kjeden (matcher BIN-764-mønster). */
const GENESIS_HASH = "0".repeat(64);

/** Default de-dup-vindu (minutter). */
const DEFAULT_DEDUP_MINUTES = 15;

/** Default persistent-down-grense (ms). */
const DEFAULT_PERSISTENT_DOWN_MS = 30_000;

/** Default draw-stale-grense (ms). 2× Spill 1 ball-intervall (~10s). */
const DEFAULT_DRAW_STALE_MS = 20_000;

/** Default polling-intervall (ms). */
const DEFAULT_POLL_INTERVAL_MS = 30_000;

/** PagerDuty Events API v2 endpoint. */
const PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";

// ── Domain types ───────────────────────────────────────────────────────────

/**
 * Speiler `HealthResponseData` fra `publicGameHealth.ts`. Vi unngår direkte
 * import for å holde alerting-servicen frittstående og lett-mockbar.
 */
export interface HealthSnapshot {
  status: "ok" | "degraded" | "down";
  lastDrawAge: number | null;
  connectedClients: number;
  currentPhase: "idle" | "running" | "paused" | "finished";
  currentPosition: number | null;
  instanceId: string;
  redisHealthy: boolean;
  dbHealthy: boolean;
  nextScheduledStart: string | null;
  withinOpeningHours: boolean;
  p95SocketRoundtripMs: number | null;
  checkedAt: string;
}

export type GameSlug = "spill1" | "spill2" | "spill3";

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertScenario =
  | "status_down"
  | "draw_stale"
  | "redis_unhealthy"
  | "db_unhealthy"
  | "wallet_reconciliation_mismatch";

export interface RoomAlert {
  game: GameSlug | "global";
  hallId: string | null;
  scenario: AlertScenario;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  /** Stable de-dup-key. Format: "<game>:<hallId>:<scenario>". */
  scenarioKey: string;
}

/**
 * Rene snapshot-input til `evaluateAlerts`. Vi tar imot et felt-pakket
 * objekt slik at testene kan kjøre uten DB / fetch / klokke.
 */
export interface AlertEvaluationContext {
  /** Per-(game, hallId)-snapshot. `null` betyr "kunne ikke hente". */
  rooms: Array<{
    game: GameSlug;
    hallId: string;
    snapshot: HealthSnapshot | null;
    /** Når status først ble observert som "down" for denne nøkkelen. */
    downSinceMs: number | null;
  }>;
  /** Antall åpne wallet-reconciliation-alerts. */
  walletReconciliationOpenCount: number;
  nowMs: number;
  persistentDownThresholdMs: number;
  drawStaleThresholdMs: number;
}

// ── Ports ──────────────────────────────────────────────────────────────────

/**
 * Henter health-snapshot for ett rom. Returnerer `null` hvis kallet feilet —
 * service tolker det som "ukjent" og rapporterer ikke false-positives.
 */
export interface HealthCheckPort {
  fetchHealth(game: GameSlug, hallId: string): Promise<HealthSnapshot | null>;
}

/**
 * Kanal-interface for Slack/PagerDuty/Console. Hver kanal SKAL være
 * fail-soft — kast aldri opp i polling-loopen.
 */
export interface AlertChannel {
  /** Kanal-navn for logging og persistert i `app_alert_log.channels`. */
  name: string;
  /** Send alert. Kast aldri — returnér `false` ved feil. */
  send(alert: RoomAlert): Promise<boolean>;
}

// ── Built-in channels ──────────────────────────────────────────────────────

/**
 * Slack incoming-webhook-kanal. Sender en enkel `{ text }`-payload med
 * severity-prefiks for visuell rangering.
 */
export class SlackAlertChannel implements AlertChannel {
  public readonly name = "slack";
  private readonly webhookUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: Logger;

  constructor(opts: {
    webhookUrl: string;
    fetchFn?: typeof fetch;
    logger?: Logger;
  }) {
    this.webhookUrl = opts.webhookUrl;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.logger = opts.logger ?? log;
  }

  async send(alert: RoomAlert): Promise<boolean> {
    const prefix =
      alert.severity === "critical" ? ":rotating_light:" :
      alert.severity === "warning"  ? ":warning:"        :
      ":information_source:";
    const text =
      `${prefix} *Spillorama R8 alert (${alert.severity})* — ` +
      `${alert.game}${alert.hallId ? ` / ${alert.hallId}` : ""} — ` +
      `${alert.scenario}\n${alert.message}`;
    try {
      const response = await this.fetchFn(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        this.logger.warn(
          { status: response.status, scenario: alert.scenario },
          "[room-alerting] Slack webhook returned non-2xx",
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        { err, scenario: alert.scenario },
        "[room-alerting] Slack webhook failed",
      );
      return false;
    }
  }
}

/**
 * PagerDuty Events API v2 kanal. Bruker `dedup_key` for å unngå duplikate
 * incidents — PD-tjenesten dedup'er på serversiden også, men vi gjør det
 * aktivt for å holde respond-laget rent.
 */
export class PagerDutyAlertChannel implements AlertChannel {
  public readonly name = "pagerduty";
  private readonly routingKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger: Logger;
  private readonly endpoint: string;

  constructor(opts: {
    routingKey: string;
    fetchFn?: typeof fetch;
    logger?: Logger;
    endpoint?: string;
  }) {
    this.routingKey = opts.routingKey;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.logger = opts.logger ?? log;
    this.endpoint = opts.endpoint ?? PAGERDUTY_EVENTS_URL;
  }

  async send(alert: RoomAlert): Promise<boolean> {
    // PD severity-mapping: 'critical' | 'error' | 'warning' | 'info'.
    const pdSeverity =
      alert.severity === "critical" ? "critical" :
      alert.severity === "warning"  ? "warning"  :
      "info";
    const payload = {
      routing_key: this.routingKey,
      event_action: "trigger" as const,
      dedup_key: alert.scenarioKey,
      payload: {
        summary: `Spillorama R8: ${alert.scenario} on ${alert.game}${alert.hallId ? `/${alert.hallId}` : ""}`,
        source: alert.hallId ?? "global",
        severity: pdSeverity,
        component: alert.game,
        group: "spillorama-rooms",
        class: alert.scenario,
        custom_details: {
          message: alert.message,
          ...alert.details,
        },
      },
    };
    try {
      const response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        this.logger.warn(
          { status: response.status, scenario: alert.scenario },
          "[room-alerting] PagerDuty Events API returned non-2xx",
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        { err, scenario: alert.scenario },
        "[room-alerting] PagerDuty Events API failed",
      );
      return false;
    }
  }
}

/**
 * Console-fallback. Kjører alltid (uten avhengighet til ekstern URL),
 * skriver til stderr som `console.error` per oppdraget.
 */
export class ConsoleAlertChannel implements AlertChannel {
  public readonly name = "console";

  async send(alert: RoomAlert): Promise<boolean> {
    // Bevisst console.error per oppdraget — strukturert log går via pino,
    // men console.error sikrer synlighet i Render-loggen ved kritisk avvik.
    // eslint-disable-next-line no-console
    console.error(
      `[room-alerting] ${alert.severity.toUpperCase()} ` +
        `${alert.game}${alert.hallId ? `/${alert.hallId}` : ""} ` +
        `${alert.scenario}: ${alert.message}`,
      alert.details,
    );
    return true;
  }
}

// ── Pure compute ───────────────────────────────────────────────────────────

/**
 * Evaluér alle alert-scenarier mot input-state. Pure funksjon — ingen DB,
 * ingen fetch, ingen klokke. Testbar i isolasjon.
 */
export function evaluateAlerts(ctx: AlertEvaluationContext): RoomAlert[] {
  const alerts: RoomAlert[] = [];
  const { rooms, walletReconciliationOpenCount, nowMs } = ctx;

  for (const room of rooms) {
    const { game, hallId, snapshot } = room;

    // Hvis vi ikke fikk snapshot — vi fail-soft og rapporterer ikke. R8
    // må ikke alarmere på "kunne ikke hente helse-data" siden det enten
    // er en transient DB-feil eller en konfigurasjonsfeil. Logger nivået
    // tar det.
    if (!snapshot) continue;

    // Scenario #1: Persistent down. Down må ha vart > terskel.
    if (snapshot.status === "down" && room.downSinceMs !== null) {
      const downForMs = nowMs - room.downSinceMs;
      if (downForMs >= ctx.persistentDownThresholdMs) {
        alerts.push({
          game,
          hallId,
          scenario: "status_down",
          severity: "critical",
          message:
            `Spill ${game.replace("spill", "")} hall ${hallId} er nede ` +
            `(${Math.round(downForMs / 1000)}s) — phase=${snapshot.currentPhase}, ` +
            `db=${snapshot.dbHealthy}, redis=${snapshot.redisHealthy}.`,
          details: {
            downForSec: Math.round(downForMs / 1000),
            currentPhase: snapshot.currentPhase,
            redisHealthy: snapshot.redisHealthy,
            dbHealthy: snapshot.dbHealthy,
            connectedClients: snapshot.connectedClients,
            nextScheduledStart: snapshot.nextScheduledStart,
            withinOpeningHours: snapshot.withinOpeningHours,
          },
          scenarioKey: `${game}:${hallId}:status_down`,
        });
      }
    }

    // Scenario #2: Draw stale (kun ved aktiv runde).
    // `lastDrawAge` er sekunder — vi sammenligner mot ms-grensen.
    if (
      snapshot.currentPhase === "running" &&
      snapshot.lastDrawAge !== null &&
      snapshot.lastDrawAge * 1000 > ctx.drawStaleThresholdMs
    ) {
      alerts.push({
        game,
        hallId,
        scenario: "draw_stale",
        severity: "critical",
        message:
          `Spill ${game.replace("spill", "")} hall ${hallId} har ikke ` +
          `trukket ny ball på ${snapshot.lastDrawAge}s (terskel ` +
          `${Math.round(ctx.drawStaleThresholdMs / 1000)}s).`,
        details: {
          lastDrawAgeSec: snapshot.lastDrawAge,
          drawStaleThresholdSec: Math.round(ctx.drawStaleThresholdMs / 1000),
          currentPhase: snapshot.currentPhase,
          connectedClients: snapshot.connectedClients,
        },
        scenarioKey: `${game}:${hallId}:draw_stale`,
      });
    }

    // Scenario #3: Redis unhealthy. Bare alert hvis det faktisk er aktiv
    // bruk — utenfor åpningstid uten aktiv runde gir vi mindre vekting.
    if (!snapshot.redisHealthy) {
      const isHigh =
        snapshot.currentPhase === "running" ||
        snapshot.currentPhase === "paused" ||
        snapshot.connectedClients > 0;
      alerts.push({
        game,
        hallId,
        scenario: "redis_unhealthy",
        severity: isHigh ? "critical" : "warning",
        message:
          `Redis er nede for spill ${game.replace("spill", "")} ` +
          `hall ${hallId}. ${isHigh ? "Aktive klienter rammet — kritisk." : "Ingen aktiv runde — varsel."}`,
        details: {
          currentPhase: snapshot.currentPhase,
          connectedClients: snapshot.connectedClients,
          dbHealthy: snapshot.dbHealthy,
        },
        scenarioKey: `${game}:${hallId}:redis_unhealthy`,
      });
    }

    // Scenario #4: DB unhealthy. Alltid critical — DB er hovedavhengighet.
    if (!snapshot.dbHealthy) {
      alerts.push({
        game,
        hallId,
        scenario: "db_unhealthy",
        severity: "critical",
        message:
          `Postgres er nede for spill ${game.replace("spill", "")} ` +
          `hall ${hallId}. Wallet og compliance lammet.`,
        details: {
          currentPhase: snapshot.currentPhase,
          connectedClients: snapshot.connectedClients,
          redisHealthy: snapshot.redisHealthy,
        },
        scenarioKey: `${game}:${hallId}:db_unhealthy`,
      });
    }
  }

  // Scenario #5: Wallet reconciliation mismatch (global, ikke per rom).
  // Trigges hvis BIN-763 har skrevet åpne alerts som ikke er resolved.
  if (walletReconciliationOpenCount > 0) {
    alerts.push({
      game: "global",
      hallId: null,
      scenario: "wallet_reconciliation_mismatch",
      severity: "critical",
      message:
        `Wallet-reconciliation har ${walletReconciliationOpenCount} åpne ` +
        `divergens-alerts. Manuell undersøkelse kreves.`,
      details: {
        openAlertCount: walletReconciliationOpenCount,
      },
      scenarioKey: `global::wallet_reconciliation_mismatch`,
    });
  }

  return alerts;
}

// ── De-dup tracking ────────────────────────────────────────────────────────

/**
 * In-memory de-dup-tracker. Holder siste sendt-tidspunkt per scenarioKey.
 * Persisteres IKKE — etter en redeploy starter vi friskt og DB-en har
 * fortsatt full audit-historikk.
 *
 * Som tilleggslag kan service spørre `app_alert_log` for siste alert
 * per key innenfor de-dup-vinduet (se `loadDedupStateFromDb`). Default
 * er in-memory only siden polling-frekvens er ~30s og en redeploy varer
 * sjelden mer enn 1-2 min.
 */
export class AlertDedupTracker {
  private readonly lastSentByKey = new Map<string, number>();

  /** Returnerer true hvis vi SKAL sende (utenfor de-dup-vinduet). */
  shouldSend(scenarioKey: string, nowMs: number, dedupWindowMs: number): boolean {
    const lastSent = this.lastSentByKey.get(scenarioKey);
    if (lastSent === undefined) return true;
    return nowMs - lastSent >= dedupWindowMs;
  }

  /** Marker som sendt. */
  markSent(scenarioKey: string, nowMs: number): void {
    this.lastSentByKey.set(scenarioKey, nowMs);
  }

  /** Hent inn fra DB (for redeploy-recovery). */
  hydrate(entries: Array<{ scenarioKey: string; sentAtMs: number }>): void {
    for (const e of entries) this.lastSentByKey.set(e.scenarioKey, e.sentAtMs);
  }

  /** GC: dropp keys eldre enn 2× window. */
  gc(nowMs: number, dedupWindowMs: number): void {
    const cutoff = nowMs - dedupWindowMs * 2;
    for (const [k, v] of this.lastSentByKey) {
      if (v < cutoff) this.lastSentByKey.delete(k);
    }
  }

  /** @internal For testing. */
  size(): number {
    return this.lastSentByKey.size;
  }
}

// ── Hash-chain helper (BIN-764-mønster) ────────────────────────────────────

/**
 * Bygg `entry_hash` for en alert-rad. Canonical-JSON over rad-payload +
 * forrige hash, SHA-256 hex.
 */
export function computeAlertEntryHash(
  previousHash: string,
  rowPayload: {
    scenarioKey: string;
    game: string;
    hallId: string | null;
    scenario: string;
    severity: string;
    message: string;
    details: Record<string, unknown>;
    channels: string[];
    createdAt: string;
  },
): string {
  // Deterministic key-order via JSON.stringify med sorted keys.
  const canonical = canonicalJsonStringify({
    scenarioKey: rowPayload.scenarioKey,
    game: rowPayload.game,
    hallId: rowPayload.hallId,
    scenario: rowPayload.scenario,
    severity: rowPayload.severity,
    message: rowPayload.message,
    details: rowPayload.details,
    channels: [...rowPayload.channels].sort(),
    createdAt: rowPayload.createdAt,
  });
  return createHash("sha256").update(previousHash + canonical).digest("hex");
}

function canonicalJsonStringify(value: unknown): string {
  // Rekursivt sortér keys i objekter for kanonisk representasjon.
  const replacer = (_key: string, val: unknown): unknown => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
      return sorted;
    }
    return val;
  };
  return JSON.stringify(value, replacer);
}

// ── Alert log writer (DB) ──────────────────────────────────────────────────

export interface AlertLogWriter {
  /**
   * Persistér en alert-rad med hash-chain-link. Returnerer `true` ved
   * suksess, `false` ved feil (fail-soft).
   */
  write(
    alert: RoomAlert,
    channelsAttempted: string[],
    nowMs: number,
  ): Promise<boolean>;

  /**
   * Hent siste sendt-tidspunkt per scenarioKey innenfor de-dup-vinduet.
   * Brukes av tracker.hydrate() ved boot.
   */
  loadRecentDedupState(
    dedupWindowMs: number,
    nowMs: number,
  ): Promise<Array<{ scenarioKey: string; sentAtMs: number }>>;
}

export class PostgresAlertLogWriter implements AlertLogWriter {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly logger: Logger;
  /**
   * In-memory siste-hash-cache for kjede-bygging. Bygges fra siste rad i DB
   * ved første skriv, så hver påfølgende skriv leser fra cache. På krasj
   * leses cachen friskt ved neste skriv.
   */
  private cachedLastHash: string | null = null;

  constructor(opts: { pool: Pool; schema: string; logger?: Logger }) {
    this.pool = opts.pool;
    this.schema = opts.schema;
    this.logger = opts.logger ?? log;
    if (!/^[a-z_][a-z0-9_]*$/i.test(opts.schema)) {
      throw new Error("Invalid schema name");
    }
  }

  async write(
    alert: RoomAlert,
    channelsAttempted: string[],
    nowMs: number,
  ): Promise<boolean> {
    try {
      const previousHash = await this.getLastHash();
      const createdAt = new Date(nowMs).toISOString();
      const entryHash = computeAlertEntryHash(previousHash, {
        scenarioKey: alert.scenarioKey,
        game: alert.game,
        hallId: alert.hallId,
        scenario: alert.scenario,
        severity: alert.severity,
        message: alert.message,
        details: alert.details,
        channels: channelsAttempted,
        createdAt,
      });
      await this.pool.query(
        `INSERT INTO "${this.schema}"."app_alert_log"
           (scenario_key, game, hall_id, scenario, severity, message, details,
            channels, entry_hash, previous_entry_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          alert.scenarioKey,
          alert.game,
          alert.hallId,
          alert.scenario,
          alert.severity,
          alert.message,
          JSON.stringify(alert.details),
          channelsAttempted,
          entryHash,
          previousHash,
          createdAt,
        ],
      );
      this.cachedLastHash = entryHash;
      return true;
    } catch (err) {
      this.logger.warn({ err, scenarioKey: alert.scenarioKey }, "[room-alerting] AlertLog INSERT failed");
      // Reset cache for å unngå korrupt kjede ved neste forsøk.
      this.cachedLastHash = null;
      return false;
    }
  }

  async loadRecentDedupState(
    dedupWindowMs: number,
    nowMs: number,
  ): Promise<Array<{ scenarioKey: string; sentAtMs: number }>> {
    try {
      const cutoff = new Date(nowMs - dedupWindowMs).toISOString();
      const { rows } = await this.pool.query<{
        scenario_key: string;
        most_recent_at: Date | string;
      }>(
        `SELECT scenario_key, MAX(created_at) AS most_recent_at
           FROM "${this.schema}"."app_alert_log"
          WHERE created_at >= $1
          GROUP BY scenario_key`,
        [cutoff],
      );
      return rows.map((r) => ({
        scenarioKey: r.scenario_key,
        sentAtMs:
          r.most_recent_at instanceof Date
            ? r.most_recent_at.getTime()
            : new Date(String(r.most_recent_at)).getTime(),
      }));
    } catch (err) {
      this.logger.warn({ err }, "[room-alerting] loadRecentDedupState failed");
      return [];
    }
  }

  private async getLastHash(): Promise<string> {
    if (this.cachedLastHash !== null) return this.cachedLastHash;
    const { rows } = await this.pool.query<{ entry_hash: string }>(
      `SELECT entry_hash FROM "${this.schema}"."app_alert_log"
         ORDER BY id DESC LIMIT 1`,
    );
    const last = rows[0]?.entry_hash ?? GENESIS_HASH;
    this.cachedLastHash = last;
    return last;
  }
}

// ── Wallet reconciliation port ─────────────────────────────────────────────

/**
 * Tellingen av åpne wallet-reconciliation-alerts (BIN-763). Vi tar dette
 * via en port for å unngå direkte avhengighet på `WalletReconciliationService`.
 */
export interface WalletReconciliationStatusPort {
  countOpenAlerts(): Promise<number>;
}

/**
 * Default-implementasjon som spør tabellen direkte. Brukes av bootstrap-
 * koden. Tester kan stub-e dette med en konstant-funksjon.
 */
export class PostgresWalletReconciliationStatusPort
  implements WalletReconciliationStatusPort
{
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly logger: Logger;

  constructor(opts: { pool: Pool; schema: string; logger?: Logger }) {
    this.pool = opts.pool;
    this.schema = opts.schema;
    this.logger = opts.logger ?? log;
    if (!/^[a-z_][a-z0-9_]*$/i.test(opts.schema)) {
      throw new Error("Invalid schema name");
    }
  }

  async countOpenAlerts(): Promise<number> {
    try {
      const { rows } = await this.pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "${this.schema}"."wallet_reconciliation_alerts"
          WHERE resolved_at IS NULL`,
      );
      return Number(rows[0]?.n ?? 0);
    } catch (err) {
      // 42P01 = tabell mangler (migrasjon ikke kjørt) — soft-no-op.
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") return 0;
      this.logger.warn({ err }, "[room-alerting] countOpenAlerts failed");
      return 0;
    }
  }
}

// ── Service ────────────────────────────────────────────────────────────────

export interface RoomAlertingServiceOptions {
  /** Helsesjekk-kilden (R7-endepunkt eller direkte service-call). */
  healthCheck: HealthCheckPort;
  /** Tellingen av åpne wallet-recon-alerts. */
  walletReconciliationStatus: WalletReconciliationStatusPort;
  /** Persistent audit-log writer (kan være no-op for tester). */
  alertLog: AlertLogWriter;
  /** Liste av alert-kanaler (Slack, PD, Console). Tom liste = console-fallback. */
  channels: AlertChannel[];
  /** Hall-ID-er å polle for hvert spill. Spill 2/3 er globale men forventer hallId. */
  hallIdsByGame: { spill1: string[]; spill2: string[]; spill3: string[] };
  /** Polling-intervall (ms). Default 30 000. */
  pollIntervalMs?: number;
  /** De-dup-vindu (minutter). Default 15. */
  dedupMinutes?: number;
  /** Persistent-down-grense (ms). Default 30 000. */
  persistentDownThresholdMs?: number;
  /** Draw-stale-grense (ms). Default 20 000. */
  drawStaleThresholdMs?: number;
  /** Klokke (test-injekteres). */
  now?: () => number;
  logger?: Logger;
}

export class RoomAlertingService {
  private readonly opts: Required<
    Omit<
      RoomAlertingServiceOptions,
      "logger" | "now" | "channels"
    >
  > & {
    logger: Logger;
    now: () => number;
    channels: AlertChannel[];
  };
  private readonly tracker = new AlertDedupTracker();
  /**
   * Per-(game, hallId)-tilstand: når status først ble observert som "down".
   * Brukes av evaluateAlerts for vedvarende-down-deteksjon (#1 i scenario-listen).
   */
  private readonly downSinceByKey = new Map<string, number>();

  constructor(options: RoomAlertingServiceOptions) {
    this.opts = {
      healthCheck: options.healthCheck,
      walletReconciliationStatus: options.walletReconciliationStatus,
      alertLog: options.alertLog,
      channels:
        options.channels.length > 0
          ? options.channels
          : [new ConsoleAlertChannel()],
      hallIdsByGame: options.hallIdsByGame,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      dedupMinutes: options.dedupMinutes ?? DEFAULT_DEDUP_MINUTES,
      persistentDownThresholdMs:
        options.persistentDownThresholdMs ?? DEFAULT_PERSISTENT_DOWN_MS,
      drawStaleThresholdMs:
        options.drawStaleThresholdMs ?? DEFAULT_DRAW_STALE_MS,
      logger: options.logger ?? log,
      now: options.now ?? (() => Date.now()),
    };
  }

  /**
   * Hydrér de-dup-tracker fra DB (kalles ved boot). Bare nyttig på
   * single-instance — multi-instance bør bruke felles Redis-tracker
   * (post-pilot R11).
   */
  async hydrate(): Promise<void> {
    const dedupWindowMs = this.opts.dedupMinutes * 60 * 1000;
    const recent = await this.opts.alertLog.loadRecentDedupState(
      dedupWindowMs,
      this.opts.now(),
    );
    this.tracker.hydrate(recent);
  }

  /**
   * Én polling-tick: hent helse for alle (game, hall)-par, evaluer alerts,
   * dedup, send til kanaler, persistér. Aldri kast — alle feil logges.
   *
   * Returnerer antall alerts som faktisk ble sendt (etter dedup) — egnet
   * som `JobResult.itemsProcessed`.
   */
  async tick(): Promise<number> {
    const nowMs = this.opts.now();

    // 1. Hent health-snapshots i parallell.
    const games: GameSlug[] = ["spill1", "spill2", "spill3"];
    const fetchPromises: Array<
      Promise<{ game: GameSlug; hallId: string; snapshot: HealthSnapshot | null }>
    > = [];
    for (const game of games) {
      const halls = this.opts.hallIdsByGame[game] ?? [];
      for (const hallId of halls) {
        fetchPromises.push(
          (async () => {
            try {
              const snap = await this.opts.healthCheck.fetchHealth(game, hallId);
              return { game, hallId, snapshot: snap };
            } catch (err) {
              this.opts.logger.warn(
                { err, game, hallId },
                "[room-alerting] healthCheck.fetchHealth threw",
              );
              return { game, hallId, snapshot: null };
            }
          })(),
        );
      }
    }
    const fetched = await Promise.all(fetchPromises);

    // 2. Oppdater downSince-state og bygg evaluation-context.
    const evalRooms: AlertEvaluationContext["rooms"] = [];
    for (const r of fetched) {
      const key = `${r.game}:${r.hallId}`;
      if (r.snapshot?.status === "down") {
        if (!this.downSinceByKey.has(key)) this.downSinceByKey.set(key, nowMs);
      } else {
        // Restore: status flippet vekk fra "down" → tørk markøren.
        this.downSinceByKey.delete(key);
      }
      evalRooms.push({
        game: r.game,
        hallId: r.hallId,
        snapshot: r.snapshot,
        downSinceMs: this.downSinceByKey.get(key) ?? null,
      });
    }

    // 3. Wallet-recon-status (global).
    let walletReconciliationOpenCount = 0;
    try {
      walletReconciliationOpenCount =
        await this.opts.walletReconciliationStatus.countOpenAlerts();
    } catch (err) {
      this.opts.logger.warn({ err }, "[room-alerting] walletRecon countOpenAlerts failed");
    }

    // 4. Pure evaluation.
    const candidates = evaluateAlerts({
      rooms: evalRooms,
      walletReconciliationOpenCount,
      nowMs,
      persistentDownThresholdMs: this.opts.persistentDownThresholdMs,
      drawStaleThresholdMs: this.opts.drawStaleThresholdMs,
    });

    // 5. De-dup, send til kanaler, persistér.
    const dedupWindowMs = this.opts.dedupMinutes * 60 * 1000;
    let sentCount = 0;
    for (const alert of candidates) {
      if (!this.tracker.shouldSend(alert.scenarioKey, nowMs, dedupWindowMs)) {
        continue;
      }
      const channelsAttempted: string[] = [];
      // Send til alle kanaler i parallell. Console-fallback brukes hvis
      // ingen ekstern kanal er konfigurert (constructor håndterer det).
      const sendResults = await Promise.all(
        this.opts.channels.map(async (ch) => {
          const ok = await ch.send(alert).catch((err) => {
            this.opts.logger.warn(
              { err, channel: ch.name, scenario: alert.scenario },
              "[room-alerting] channel.send threw",
            );
            return false;
          });
          if (ok) channelsAttempted.push(ch.name);
          return ok;
        }),
      );
      const anySent = sendResults.some(Boolean);
      // Persist til audit-log uavhengig — vi vil ha record selv hvis alle
      // kanaler feilet.
      await this.opts.alertLog.write(alert, channelsAttempted, nowMs);
      if (anySent) {
        this.tracker.markSent(alert.scenarioKey, nowMs);
        sentCount += 1;
      }
    }

    // 6. GC.
    this.tracker.gc(nowMs, dedupWindowMs);

    return sentCount;
  }

  /** @internal For testing. */
  __getDedupTracker(): AlertDedupTracker {
    return this.tracker;
  }

  /** @internal For testing. */
  __getDownSinceMap(): Map<string, number> {
    return this.downSinceByKey;
  }
}

// ── No-op log writer (for dev / tests uten DB) ─────────────────────────────

export class NoopAlertLogWriter implements AlertLogWriter {
  async write(): Promise<boolean> {
    return true;
  }
  async loadRecentDedupState(): Promise<
    Array<{ scenarioKey: string; sentAtMs: number }>
  > {
    return [];
  }
}
