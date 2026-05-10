/**
 * P1-6 / R11 — Bootstrap-hjelper for RoomIsolationGuard.
 *
 * Mandat-ref: `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`
 * §5 R11. ADR-0020.
 *
 * **Hva:** Hjelper-modul som bygger en singleton `RoomIsolationGuard` med
 * R8-alerting-integrasjon ferdig wired. Brukes fra `index.ts` for å
 * sentralisere oppsett.
 *
 * **Hvorfor:** Vi vil at alle kritiske paths skal dele samme breaker-state
 * (én breaker per rom på tvers av draw-tick + master-actions). Hvis vi
 * lager én breaker per service blir state-en spredt og isolasjon brutt.
 *
 * **Designprinsipper:**
 *   - **Singleton-pattern.** Kun én instans per Node-prosess.
 *   - **R8-integrasjon via callback.** Bootstrap mottar en callback
 *     `onIsolationEvent` som routes til R8 RoomAlertingService — vi
 *     unngår direkte koblinger så testene kan stube det.
 *   - **Graceful degradation.** Hvis env disable'r isolation, returnerer
 *     vi en no-op guard som lar alt passere.
 */

import { logger as rootLogger } from "../util/logger.js";
import {
  RoomIsolationGuard,
  type RoomIsolationEvent,
  type RoomIsolationGuardConfig,
} from "./RoomIsolationGuard.js";

const log = rootLogger.child({ module: "room-isolation-bootstrap" });

// ── Configuration via env ──────────────────────────────────────────────────

export interface RoomIsolationBootstrapConfig {
  /**
   * Master kill-switch. Default true (enabled). Sett false for å gå
   * tilbake til pre-R11-oppførsel uten breaker-isolasjon.
   */
  enabled?: boolean;

  /**
   * R8 alerting-callback. Når breaker går OPEN eller p95 over grense,
   * inviteres callback-en med event-payload. R8 RoomAlertingService
   * kan da emit alert til Slack/PagerDuty.
   */
  onIsolationEvent?: (event: RoomIsolationEvent) => void;

  /** Override for breaker / latency tracker config. */
  guardConfig?: RoomIsolationGuardConfig;
}

/**
 * Les konfig fra env-vars. Brukes når caller ikke vil overstyre programmatic.
 */
export function loadIsolationConfigFromEnv(): RoomIsolationBootstrapConfig {
  const enabled = process.env.ROOM_ISOLATION_ENABLED !== "false";

  // Per-environment kan endre threshold for failure / cooldown.
  const failureThreshold = parseIntOrDefault(
    process.env.ROOM_ISOLATION_FAILURE_THRESHOLD,
    5,
  );
  const failureWindowMs = parseIntOrDefault(
    process.env.ROOM_ISOLATION_FAILURE_WINDOW_MS,
    60_000,
  );
  const cooldownMs = parseIntOrDefault(
    process.env.ROOM_ISOLATION_COOLDOWN_MS,
    30_000,
  );
  const p95DegradedThresholdMs = parseIntOrDefault(
    process.env.ROOM_ISOLATION_P95_DEGRADED_THRESHOLD_MS,
    5_000,
  );

  return {
    enabled,
    guardConfig: {
      circuit: {
        failureThreshold,
        failureWindowMs,
        cooldownMs,
      },
    },
  };
}

function parseIntOrDefault(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Singleton ──────────────────────────────────────────────────────────────

let guardSingleton: RoomIsolationGuard | null = null;

/**
 * Hent (eller opprett) singleton RoomIsolationGuard. Første kall MÅ
 * oppgi config — påfølgende kall returnerer eksisterende instans.
 *
 * Hvis `config.enabled === false` returnerer vi en no-op-guard som
 * passer alle kall gjennom uten registrering. Det gir oss en
 * env-styrt rollback-mekanisme uten å endre call-sites.
 */
export function getOrCreateRoomIsolationGuard(
  config?: RoomIsolationBootstrapConfig,
): RoomIsolationGuard {
  if (guardSingleton) return guardSingleton;

  const cfg = config ?? loadIsolationConfigFromEnv();

  if (cfg.enabled === false) {
    log.info("[room-isolation-bootstrap] Disabled via config — using no-op guard");
    guardSingleton = createNoopGuard();
    return guardSingleton;
  }

  const guard = new RoomIsolationGuard(cfg.guardConfig);

  // Default p95-degraded-threshold.
  const p95Threshold = parseIntOrDefault(
    process.env.ROOM_ISOLATION_P95_DEGRADED_THRESHOLD_MS,
    5_000,
  );
  guard.setDegradedThreshold({ thresholdMs: p95Threshold });

  // Wire R8-alerting hvis callback er gitt.
  if (cfg.onIsolationEvent) {
    guard.addListener((event) => {
      try {
        cfg.onIsolationEvent?.(event);
      } catch (err) {
        log.warn(
          { err },
          "[room-isolation-bootstrap] onIsolationEvent listener failed (fail-soft)",
        );
      }
    });
  }

  // Logg alle state-overganger på info-nivå for ops-visibility.
  guard.addListener((event) => {
    if (event.type === "circuit") {
      const c = event.payload;
      switch (c.type) {
        case "circuit_opened":
          log.warn(
            {
              roomCode: c.roomCode,
              consecutiveFailures: c.consecutiveFailures,
              reason: c.reason,
            },
            "[room-isolation] Circuit OPENED",
          );
          break;
        case "circuit_closed":
          log.info(
            { roomCode: c.roomCode },
            "[room-isolation] Circuit CLOSED (recovered)",
          );
          break;
        case "circuit_half_open":
          log.info(
            { roomCode: c.roomCode },
            "[room-isolation] Circuit HALF_OPEN (probing)",
          );
          break;
        case "call_rejected":
          log.debug(
            { roomCode: c.roomCode },
            "[room-isolation] Call rejected (fail-fast)",
          );
          break;
      }
    } else if (event.type === "degraded") {
      const d = event.payload;
      log.warn(
        {
          roomCode: d.roomCode,
          action: d.action,
          p95Ms: d.p95Ms,
          thresholdMs: d.thresholdMs,
          sampleCount: d.sampleCount,
        },
        "[room-isolation] Room DEGRADED (p95 over threshold)",
      );
    }
  });

  guardSingleton = guard;
  log.info(
    {
      circuit: cfg.guardConfig?.circuit ?? "default",
    },
    "[room-isolation-bootstrap] Initialized",
  );
  return guardSingleton;
}

/**
 * @internal Test-only — clear singleton for fresh tester.
 */
export function _resetRoomIsolationGuardSingleton(): void {
  guardSingleton = null;
}

// ── No-op guard ────────────────────────────────────────────────────────────

/**
 * No-op guard — bypass alle kall uten registrering. Brukes når isolation
 * er disabled. Returnerer en RoomIsolationGuard-instans men med en
 * intern state-machine som aldri åpner.
 */
function createNoopGuard(): RoomIsolationGuard {
  // En guard med ekstremt høy threshold = effektivt no-op.
  return new RoomIsolationGuard({
    circuit: {
      failureThreshold: Number.MAX_SAFE_INTEGER,
      failureWindowMs: 1, // veldig kort window — failures blir aldri group'et
      cooldownMs: 1,
    },
    latency: {
      maxSamplesPerKey: 1,
      windowMs: 1,
      gcStaleStateAfterMs: 1,
    },
  });
}
