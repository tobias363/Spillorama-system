/**
 * BIN-815 / R8 — Bootstrap-helpers for RoomAlertingService.
 *
 * Konstruerer service-en med riktige porter basert på env og injiserte
 * service-handles. Holdt separat fra index.ts for å holde index.ts lesbar
 * og servicen testbar uten å starte hele backenden.
 */

import type { Pool } from "pg";

import type { JobDefinition, JobResult } from "../jobs/JobScheduler.js";
import { logger as rootLogger } from "../util/logger.js";

import {
  ConsoleAlertChannel,
  PagerDutyAlertChannel,
  PostgresAlertLogWriter,
  PostgresWalletReconciliationStatusPort,
  RoomAlertingService,
  SlackAlertChannel,
  type AlertChannel,
  type GameSlug,
  type HealthCheckPort,
  type HealthSnapshot,
} from "./RoomAlertingService.js";

const log = rootLogger.child({ module: "room-alerting-bootstrap" });

/**
 * Default-port som gjør HTTP-kall mot lokal R7-endepunkt. Brukes når
 * caller IKKE har tilgang til engine + config-services direkte. Kall i
 * eksisterende prosess kan også injisere en in-process-port som leser
 * direkte fra services.
 */
export class HttpHealthCheckPort implements HealthCheckPort {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: { baseUrl: string; fetchFn?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async fetchHealth(
    game: GameSlug,
    hallId: string,
  ): Promise<HealthSnapshot | null> {
    const url = `${this.baseUrl}/api/games/${game}/health?hallId=${encodeURIComponent(hallId)}`;
    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        log.warn({ status: response.status, game, hallId }, "[room-alerting] health endpoint returned non-2xx");
        return null;
      }
      const json = (await response.json()) as { ok?: boolean; data?: HealthSnapshot };
      if (!json.ok || !json.data) return null;
      return json.data;
    } catch (err) {
      log.warn({ err, game, hallId }, "[room-alerting] health endpoint fetch threw");
      return null;
    }
  }
}

/**
 * Bygg standard kanal-liste basert på env. Returneres alltid med minst
 * console-fallback hvis ingen ekstern kanal er konfigurert.
 */
export function buildChannelsFromEnv(): AlertChannel[] {
  const channels: AlertChannel[] = [];
  const slackUrl = process.env.SLACK_ALERT_WEBHOOK_URL?.trim();
  if (slackUrl && /^https?:\/\//.test(slackUrl)) {
    channels.push(new SlackAlertChannel({ webhookUrl: slackUrl }));
  }
  const pdKey = process.env.PAGERDUTY_INTEGRATION_KEY?.trim();
  if (pdKey && pdKey.length > 0) {
    channels.push(new PagerDutyAlertChannel({ routingKey: pdKey }));
  }
  if (channels.length === 0) {
    channels.push(new ConsoleAlertChannel());
  }
  return channels;
}

export interface CreateRoomAlertingJobOptions {
  pool: Pool;
  schema: string;
  healthCheck: HealthCheckPort;
  /** Hall-IDer å polle. Tomme arrayer hopper over det aktuelle spillet. */
  hallIdsByGame: { spill1: string[]; spill2: string[]; spill3: string[] };
  /** For test-injection. */
  channels?: AlertChannel[];
  /** For test-injection. */
  now?: () => number;
}

/**
 * Bygg en `JobDefinition` for `JobScheduler.register(...)`.
 *
 * - `name`: "room-alerting"
 * - `intervalMs`: env `ROOM_ALERTING_POLL_INTERVAL_MS` eller 30 000.
 * - `enabled`: env `ROOM_ALERTING_ENABLED` (default true) AND
 *              `hallIdsByGame` har minst én hall.
 *
 * `run`-implementasjonen kaller `service.tick()`. Lock-handling skjer i
 * `JobScheduler` (Redis-lock per tick når konfigurert).
 */
export function createRoomAlertingJob(
  opts: CreateRoomAlertingJobOptions,
): { definition: JobDefinition; service: RoomAlertingService } {
  const enabledRaw = (process.env.ROOM_ALERTING_ENABLED ?? "true").trim().toLowerCase();
  const enabledEnv = enabledRaw !== "false" && enabledRaw !== "0";
  const totalHalls =
    opts.hallIdsByGame.spill1.length +
    opts.hallIdsByGame.spill2.length +
    opts.hallIdsByGame.spill3.length;
  const enabled = enabledEnv && totalHalls > 0;

  const intervalMs = parsePositiveInt(
    process.env.ROOM_ALERTING_POLL_INTERVAL_MS,
    30_000,
  );
  const dedupMinutes = parsePositiveInt(process.env.ROOM_ALERTING_DEDUP_MINUTES, 15);
  const persistentDownThresholdMs = parsePositiveInt(
    process.env.ROOM_ALERTING_PERSISTENT_DOWN_MS,
    30_000,
  );
  const drawStaleThresholdMs = parsePositiveInt(
    process.env.ROOM_ALERTING_DRAW_STALE_MS,
    20_000,
  );

  const channels = opts.channels ?? buildChannelsFromEnv();
  const channelNames = channels.map((c) => c.name).join(",");
  const service = new RoomAlertingService({
    healthCheck: opts.healthCheck,
    walletReconciliationStatus: new PostgresWalletReconciliationStatusPort({
      pool: opts.pool,
      schema: opts.schema,
    }),
    alertLog: new PostgresAlertLogWriter({
      pool: opts.pool,
      schema: opts.schema,
    }),
    channels,
    hallIdsByGame: opts.hallIdsByGame,
    pollIntervalMs: intervalMs,
    dedupMinutes,
    persistentDownThresholdMs,
    drawStaleThresholdMs,
    now: opts.now,
  });

  const definition: JobDefinition = {
    name: "room-alerting",
    description: `Alerting for live-rom-helse (BIN-815/R8) — kanaler: ${channelNames}.`,
    intervalMs,
    enabled,
    async run(_nowMs: number): Promise<JobResult> {
      const sent = await service.tick();
      return {
        itemsProcessed: sent,
        note: sent === 0 ? "no alerts triggered (or all dedup'd)" : `${sent} alerts sent`,
      };
    },
  };

  return { definition, service };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
  return n;
}
