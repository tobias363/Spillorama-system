/**
 * ADR-0020 / P1-3 (2026-05-10): Redis-health monitor med alarm-trigger.
 *
 * Why:
 *   `RedisRoomStateStore.persistAsync` og `RedisSchedulerLock` har historisk
 *   logget feil til `logger.error` uten å eskalere. ioredis sin
 *   `maxRetriesPerRequest: 3` gjør at connection-errors etter retry gir
 *   silent fail. Evolution-grade pilot krever < 1 min alert-latency på
 *   Redis-degradering eller utfall.
 *
 * What this monitor does:
 *   1. Periodic ping (default hvert 5s) til en injisert Redis-handle.
 *   2. Sammen med `RedisHealthMetrics`-counters detekterer den to
 *      alarm-typer:
 *        - `redis_outage`        : ping har feilet i > 30s sammenhengende.
 *        - `redis_degraded`      : >5 sammenhengende persist/lock-failures
 *                                   eller > 30s outage.
 *   3. Når en outage starter → publish én `redis_unhealthy`-alarm via
 *      injisert `AlertChannel[]`-array.
 *   4. Når Redis kommer tilbake → publish `redis_recovered`-melding (info-
 *      severity, samme kanaler).
 *   5. Eksponerer `getStatus()` for in-process konsumenter (health-endpoint,
 *      observability-dashboard) — speilet av `RoomAlertingService.HealthCheckPort`-mønster.
 *
 * Design-prinsipper:
 *   - Fail-soft: hvis ping-promise rejecter — tell som failure, ikke kast
 *     opp i polling-loopen.
 *   - Pure-evaluate: `evaluate()` er en testbar pure funksjon som tar en
 *     state-snapshot og returnerer alarm-decisions. Ingen klokke / Redis /
 *     network internt.
 *   - DI for alle eksterne avhengigheter: Redis-pinger, klokke, AlertChannel-
 *     array. Tester bygger uten å koble til ekte Redis.
 *   - Alarm-de-dup på flagg: én outage = én "unhealthy"-alarm + én "recovered"-
 *     alarm. Vi spammer ikke mens outage pågår.
 *   - Reuse `AlertChannel`-interface fra `RoomAlertingService` så driftsteam
 *     ser Redis-alarmer i samme Slack-kanal som rom-helse-alarmer.
 *
 * Konfigurasjon (env-vars):
 *   - `REDIS_HEALTH_MONITOR_ENABLED`      : master kill-switch (default true).
 *   - `REDIS_HEALTH_MONITOR_INTERVAL_MS`  : ping-frekvens (default 5 000).
 *   - `REDIS_HEALTH_OUTAGE_THRESHOLD_MS`  : hvor lenge nede før outage-alarm
 *                                            (default 30 000).
 *   - `REDIS_HEALTH_DEGRADED_PERSIST_FAILURES`: terskel for persist-degraded
 *                                                (default 5).
 *   - `REDIS_HEALTH_PING_TIMEOUT_MS`       : ping-timeout (default 2 000).
 *
 * Wire-effect:
 *   - `RedisRoomStateStore.persistAsync` rapporterer success/failure via
 *     `recordRedisSuccess`/`recordRedisFailure` i `RedisHealthMetrics`.
 *   - `RedisSchedulerLock.tryAcquire`/`release` rapporterer tilsvarende.
 *   - Monitor poller metrics + ping og publiserer alarmer.
 */

import type { Redis } from "ioredis";

import { logger as rootLogger, type Logger } from "../util/logger.js";

import {
  getRedisOperationCounter,
  recordRedisFailure,
  recordRedisSuccess,
} from "./RedisHealthMetrics.js";
import type { AlertChannel, RoomAlert } from "./RoomAlertingService.js";

const log = rootLogger.child({ module: "redis-health-monitor" });

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_OUTAGE_THRESHOLD_MS = 30_000;
const DEFAULT_DEGRADED_PERSIST_FAILURES = 5;
const DEFAULT_PING_TIMEOUT_MS = 2_000;

/** Stable alarm-key for `RoomAlert.scenarioKey`. */
const ALARM_KEY_OUTAGE = "global::redis_outage";
const ALARM_KEY_DEGRADED = "global::redis_degraded";
const ALARM_KEY_RECOVERED = "global::redis_recovered";

// ── Public types ───────────────────────────────────────────────────────────

export type RedisHealthState = "ok" | "degraded" | "down";

export interface RedisHealthSnapshot {
  /** Aggregert helse. `ok` = ping-success + ingen sammenhengende persist-failures. */
  status: RedisHealthState;
  /** Tidspunkt for siste vellykkede ping. */
  lastSuccessfulPingMs: number | null;
  /** Tidspunkt for siste mislykkede ping. */
  lastFailedPingMs: number | null;
  /** Antall sammenhengende mislykkede ping siden siste suksess. */
  consecutivePingFailures: number;
  /** Antall sammenhengende mislykkede persist (fra metrics-laget). */
  consecutivePersistFailures: number;
  /** Antall sammenhengende mislykkede lock-acquire. */
  consecutiveLockAcquireFailures: number;
  /** Tidspunkt da outage startet (for varighet-display). */
  outageStartedAtMs: number | null;
  /** Varighet av nåværende outage (ms). 0 hvis ok. */
  outageDurationMs: number;
  /** Total ping-failures siden process-start. */
  totalPingFailures: number;
  /** Sist sjekket-tid. */
  checkedAtMs: number;
}

/** Pure-evaluate input. Holdes serialiserbar for testing uten DI. */
export interface RedisHealthEvaluationInput {
  /** Nå i ms. */
  nowMs: number;
  /** Resultat av siste ping. */
  pingOk: boolean;
  /** Tid på siste suksess (null hvis aldri ennå). */
  lastSuccessfulPingMs: number | null;
  /** Hvor mange ping-failures sammenhengende. */
  consecutivePingFailures: number;
  /** Sammenhengende persist-failures (fra metrics-laget). */
  consecutivePersistFailures: number;
  /** Sammenhengende lock-acquire-failures. */
  consecutiveLockAcquireFailures: number;
  /** Tidspunkt da outage startet (null = ingen aktiv outage). */
  outageStartedAtMs: number | null;
  /** Tersker for "outage" (ms). */
  outageThresholdMs: number;
  /** Tersker for "degraded" persist-failures. */
  degradedPersistFailureThreshold: number;
}

export interface RedisHealthEvaluationResult {
  /** Ny aggregat-status. */
  status: RedisHealthState;
  /** Outage-startup-tid. Persisteres på state hvis ny. Null hvis ok. */
  outageStartedAtMs: number | null;
  /** Skal outage-alarm publiseres NÅ? (steg fra ok/degraded → down). */
  shouldPublishOutage: boolean;
  /** Skal degraded-alarm publiseres? (overgang ok → degraded). */
  shouldPublishDegraded: boolean;
  /** Skal recovered-alarm publiseres? (overgang down/degraded → ok). */
  shouldPublishRecovered: boolean;
  /** Forklaring brukt i alarm-payload. */
  reason: string;
}

// ── Pure compute ───────────────────────────────────────────────────────────

/**
 * Pure-evaluate basert på input-state og tidligere observert status. Tester
 * bygger denne uten DI for å verifisere overgangs-logikk.
 *
 * `previousStatus` brukes for å detektere overganger (ok → down → ok).
 * Caller mater den inn fra sin egen state.
 */
export function evaluateRedisHealth(
  input: RedisHealthEvaluationInput,
  previousStatus: RedisHealthState,
): RedisHealthEvaluationResult {
  const {
    nowMs,
    pingOk,
    consecutivePingFailures,
    consecutivePersistFailures,
    consecutiveLockAcquireFailures,
    outageStartedAtMs,
    outageThresholdMs,
    degradedPersistFailureThreshold,
  } = input;

  // Oppdater outage-start hvis vi har failures men ikke har starttid ennå.
  let nextOutageStartedAtMs = outageStartedAtMs;
  if (!pingOk && nextOutageStartedAtMs === null) {
    nextOutageStartedAtMs = nowMs;
  }

  // Avgjør aggregat-status:
  //  - "down"     : ping har feilet > outage-threshold sammenhengende.
  //  - "degraded" : ping ok men persist eller lock-acquire har sammenhengende
  //                  failures > terskel, eller ping-failure men ikke nok tid
  //                  til outage ennå.
  //  - "ok"       : alt friskt.
  let nextStatus: RedisHealthState = "ok";
  let reason = "All healthy.";

  if (!pingOk) {
    const pingFailedFor =
      nextOutageStartedAtMs !== null ? nowMs - nextOutageStartedAtMs : 0;
    if (pingFailedFor >= outageThresholdMs) {
      nextStatus = "down";
      reason =
        `Redis ping has failed for ${Math.round(pingFailedFor / 1000)}s (` +
        `${consecutivePingFailures} consecutive failures). Threshold ` +
        `${Math.round(outageThresholdMs / 1000)}s.`;
    } else {
      nextStatus = "degraded";
      reason =
        `Redis ping is currently failing (${consecutivePingFailures} ` +
        `consecutive failures, ${Math.round(pingFailedFor / 1000)}s).`;
    }
  } else {
    // Ping is ok. Sjekk metrics-laget.
    if (consecutivePersistFailures >= degradedPersistFailureThreshold) {
      nextStatus = "degraded";
      reason =
        `Persist operations have ${consecutivePersistFailures} consecutive ` +
        `failures (threshold ${degradedPersistFailureThreshold}). Ping ok.`;
    } else if (
      consecutiveLockAcquireFailures >= degradedPersistFailureThreshold
    ) {
      nextStatus = "degraded";
      reason =
        `Lock acquires have ${consecutiveLockAcquireFailures} consecutive ` +
        `failures (threshold ${degradedPersistFailureThreshold}). Ping ok.`;
    }
  }

  // Hvis ping er ok, fjern outage-marker.
  if (pingOk && nextStatus !== "down") {
    nextOutageStartedAtMs = null;
  }

  // Bestem alarm-handlinger basert på overganger.
  // Vi spammer ikke — én alarm per state-overgang. Caller dedup'er via
  // flagg lagret i monitor-state, ikke her.
  const shouldPublishOutage =
    nextStatus === "down" && previousStatus !== "down";
  const shouldPublishDegraded =
    nextStatus === "degraded" && previousStatus === "ok";
  const shouldPublishRecovered =
    nextStatus === "ok" &&
    (previousStatus === "down" || previousStatus === "degraded");

  return {
    status: nextStatus,
    outageStartedAtMs: nextStatus === "ok" ? null : nextOutageStartedAtMs,
    shouldPublishOutage,
    shouldPublishDegraded,
    shouldPublishRecovered,
    reason,
  };
}

// ── Service ────────────────────────────────────────────────────────────────

export interface RedisHealthMonitorOptions {
  /** Redis-handle for ping. Kan være read-only (kun ping-kommando). */
  redis: Redis;
  /** Alarm-kanaler (gjenbrukt fra `RoomAlertingService`). */
  channels: AlertChannel[];
  /** Polling-intervall (ms). Default 5 000. */
  intervalMs?: number;
  /** Outage-threshold (ms). Default 30 000. */
  outageThresholdMs?: number;
  /** Persist-failure terskel for degraded. Default 5. */
  degradedPersistFailureThreshold?: number;
  /** Ping-timeout (ms). Default 2 000. */
  pingTimeoutMs?: number;
  /** Klokke (test-injekteres). */
  now?: () => number;
  /** Logger. */
  logger?: Logger;
}

export class RedisHealthMonitor {
  private readonly redis: Redis;
  private readonly channels: AlertChannel[];
  private readonly intervalMs: number;
  private readonly outageThresholdMs: number;
  private readonly degradedPersistFailureThreshold: number;
  private readonly pingTimeoutMs: number;
  private readonly now: () => number;
  private readonly logger: Logger;

  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /** Sist observert status — drives state-overgangs-deteksjon. */
  private status: RedisHealthState = "ok";
  /** Når outage startet — for varighet-display og threshold-test. */
  private outageStartedAtMs: number | null = null;
  /** Sist vellykket ping (for snapshot). */
  private lastSuccessfulPingMs: number | null = null;
  /** Sist mislykket ping. */
  private lastFailedPingMs: number | null = null;
  /** Sammenhengende ping-failures siden siste suksess. */
  private consecutivePingFailures = 0;
  /** Total ping-failures (audit). */
  private totalPingFailures = 0;

  constructor(options: RedisHealthMonitorOptions) {
    this.redis = options.redis;
    this.channels = options.channels;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.outageThresholdMs =
      options.outageThresholdMs ?? DEFAULT_OUTAGE_THRESHOLD_MS;
    this.degradedPersistFailureThreshold =
      options.degradedPersistFailureThreshold ??
      DEFAULT_DEGRADED_PERSIST_FAILURES;
    this.pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? log;
  }

  /**
   * Start periodic monitoring. Idempotent — gjentatte kall er no-op.
   *
   * Vi bruker `setInterval` med `unref()` så at en isolated test-kjøring
   * ikke holder Node-prosessen åpen.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    // Kjør én tick umiddelbart for å detektere ned-state ved boot.
    void this.tick().catch((err) => {
      this.logger.warn(
        { err },
        "[redis-health-monitor] Initial tick threw — continuing",
      );
    });
    const interval = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.warn(
          { err },
          "[redis-health-monitor] Periodic tick threw — continuing",
        );
      });
    }, this.intervalMs);
    if (typeof interval.unref === "function") interval.unref();
    this.timer = interval;
  }

  /** Stop monitoring. Idempotent. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Én tick: gjør én ping, evaluér state, publiser alarm hvis overgang.
   *
   * Returnerer den oppdaterte snapshot — egnet for både tester og
   * health-endpoint som vil ha siste verdi.
   */
  async tick(): Promise<RedisHealthSnapshot> {
    const nowMs = this.now();
    const pingOk = await this.doPing(nowMs);

    const persist = getRedisOperationCounter("persist");
    const lockAcquire = getRedisOperationCounter("lock_acquire");

    const evalResult = evaluateRedisHealth(
      {
        nowMs,
        pingOk,
        lastSuccessfulPingMs: this.lastSuccessfulPingMs,
        consecutivePingFailures: this.consecutivePingFailures,
        consecutivePersistFailures: persist.consecutiveFailures,
        consecutiveLockAcquireFailures: lockAcquire.consecutiveFailures,
        outageStartedAtMs: this.outageStartedAtMs,
        outageThresholdMs: this.outageThresholdMs,
        degradedPersistFailureThreshold: this.degradedPersistFailureThreshold,
      },
      this.status,
    );

    // Trigger alarms for state-overganger. Hver alarm publiseres FØR vi
    // oppdaterer status-state, så hvis publish kaster (det skal det ikke,
    // men sikkerhetsmargin) kan vi retrye neste tick.
    if (evalResult.shouldPublishOutage) {
      await this.publishAlarm({
        scenarioKey: ALARM_KEY_OUTAGE,
        severity: "critical",
        scenario: "redis_unhealthy",
        message: `[Redis OUTAGE] ${evalResult.reason}`,
        details: {
          status: evalResult.status,
          consecutivePingFailures: this.consecutivePingFailures,
          totalPingFailures: this.totalPingFailures,
          consecutivePersistFailures: persist.consecutiveFailures,
          consecutiveLockAcquireFailures: lockAcquire.consecutiveFailures,
          outageStartedAtMs: evalResult.outageStartedAtMs,
        },
      });
    } else if (evalResult.shouldPublishDegraded) {
      await this.publishAlarm({
        scenarioKey: ALARM_KEY_DEGRADED,
        severity: "warning",
        scenario: "redis_unhealthy",
        message: `[Redis DEGRADED] ${evalResult.reason}`,
        details: {
          status: evalResult.status,
          consecutivePingFailures: this.consecutivePingFailures,
          consecutivePersistFailures: persist.consecutiveFailures,
          consecutiveLockAcquireFailures: lockAcquire.consecutiveFailures,
        },
      });
    } else if (evalResult.shouldPublishRecovered) {
      await this.publishAlarm({
        scenarioKey: ALARM_KEY_RECOVERED,
        severity: "info",
        scenario: "redis_unhealthy",
        message: `[Redis RECOVERED] Redis is healthy again. ${evalResult.reason}`,
        details: {
          status: evalResult.status,
          previousStatus: this.status,
          totalPingFailures: this.totalPingFailures,
        },
      });
    }

    // Commit ny state.
    this.status = evalResult.status;
    this.outageStartedAtMs = evalResult.outageStartedAtMs;

    return this.snapshot(nowMs);
  }

  /** Hent siste health-snapshot uten å trigge ny ping. */
  getStatus(): RedisHealthSnapshot {
    return this.snapshot(this.now());
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private snapshot(nowMs: number): RedisHealthSnapshot {
    const persist = getRedisOperationCounter("persist");
    const lockAcquire = getRedisOperationCounter("lock_acquire");
    return {
      status: this.status,
      lastSuccessfulPingMs: this.lastSuccessfulPingMs,
      lastFailedPingMs: this.lastFailedPingMs,
      consecutivePingFailures: this.consecutivePingFailures,
      consecutivePersistFailures: persist.consecutiveFailures,
      consecutiveLockAcquireFailures: lockAcquire.consecutiveFailures,
      outageStartedAtMs: this.outageStartedAtMs,
      outageDurationMs:
        this.outageStartedAtMs !== null ? nowMs - this.outageStartedAtMs : 0,
      totalPingFailures: this.totalPingFailures,
      checkedAtMs: nowMs,
    };
  }

  /**
   * Gjør én ping mot Redis med timeout. Returnerer true ved suksess,
   * false ved alle feil-typer (timeout, connection-error, exception).
   *
   * Cleanup-strategi: timeout-timer holdes IKKE `unref`'d. Det fører til at
   * Node's test-runner ("Promise resolution is still pending but the event
   * loop has already resolved") cancellerer testen når `redis.ping()` returnerer
   * en hanger-Promise og ingen andre handles holder event-loopen aktiv. I prod
   * holdes loopen aktiv av andre intervaller (Express server, Socket.IO, osv.)
   * så det er trygt. Vi `clearTimeout` på begge baner (success + reject) slik
   * at vi ikke leaker en pending timer mellom hver `tick()`.
   */
  private async doPing(nowMs: number): Promise<boolean> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      const pingPromise = this.redis.ping();
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Redis ping timeout (${this.pingTimeoutMs}ms)`)),
          this.pingTimeoutMs,
        );
      });
      const result = (await Promise.race([
        pingPromise,
        timeoutPromise,
      ])) as string;
      const ok = result === "PONG";
      if (ok) {
        this.lastSuccessfulPingMs = nowMs;
        this.consecutivePingFailures = 0;
        recordRedisSuccess("ping", nowMs);
        return true;
      }
      this.recordPingFailure(nowMs, new Error(`Unexpected ping reply: ${result}`));
      return false;
    } catch (err) {
      this.recordPingFailure(nowMs, err);
      return false;
    } finally {
      // Frigjør pending timeout-timer hvis vi vant kappløpet via en annen
      // gren (success / explicit reject) — ellers vil timeren holde event-
      // loopen våken til den faktisk avfyrer.
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private recordPingFailure(nowMs: number, err: unknown): void {
    this.lastFailedPingMs = nowMs;
    this.consecutivePingFailures += 1;
    this.totalPingFailures += 1;
    recordRedisFailure("ping", err, nowMs);
  }

  private async publishAlarm(payload: {
    scenarioKey: string;
    severity: "critical" | "warning" | "info";
    scenario: "redis_unhealthy";
    message: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    const alert: RoomAlert = {
      game: "global",
      hallId: null,
      scenario: payload.scenario,
      severity: payload.severity,
      message: payload.message,
      details: payload.details,
      scenarioKey: payload.scenarioKey,
    };
    // Send til alle kanaler i parallell. Hver kanal er fail-soft — vi
    // kaster aldri opp i tick-loopen.
    await Promise.allSettled(
      this.channels.map(async (ch) => {
        try {
          await ch.send(alert);
        } catch (err) {
          this.logger.warn(
            { err, channel: ch.name, scenarioKey: payload.scenarioKey },
            "[redis-health-monitor] channel.send threw",
          );
        }
      }),
    );
  }

  /** @internal For testing. */
  __setStatusForTesting(status: RedisHealthState): void {
    this.status = status;
  }

  /** @internal For testing. */
  __getStatusForTesting(): RedisHealthState {
    return this.status;
  }
}
