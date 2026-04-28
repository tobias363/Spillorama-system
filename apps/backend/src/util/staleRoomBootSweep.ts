/**
 * Boot-sweep for stale non-canonical rom (Tobias 2026-04-28).
 *
 * Bakgrunn: Pilot-emergency 2026-04-27. Tobias rapporterte at en spiller
 * (TestBruker81632) fortsatt fikk "Spiller deltar allerede i et annet aktivt
 * spill (rom 4RCQSX)" SELV ETTER PR #677 (canonical-aware lookup) — og selv
 * etter logg-ut/inn. Root cause: `4RCQSX` er en STALE/LEGACY-rom skapt FØR
 * fixen ble deployet. Den lever fortsatt i `engine.rooms` (Redis eller
 * in-memory), og spillerens wallet-id binding peker på den. Reconnect-flyten
 * finner stale player-record og kaster `PLAYER_ALREADY_IN_RUNNING_GAME`/
 * `PLAYER_ALREADY_IN_ROOM` selv om brukeren forsøker en helt ny canonical-rom.
 *
 * Denne sweep-en kjøres ÉN gang ved server-boot, ETTER Redis-load + crash-
 * recovery (BIN-170 + BIN-245), så vi ser hele rom-tilstanden. Den
 * destroyer trygt enhver non-canonical rom som er IDLE/ENDED — `destroyRoom`
 * fjerner alle player-recordene + alle map-entries (drawLocks, variantConfig,
 * luckyNumbersByPlayer, roomStateStore). Det betyr at neste gang spilleren
 * kobler seg til, har vi en fresh canonical-binding å falle tilbake på via
 * `cleanupStaleWalletInIdleRooms` (PR #432-/-655 logikk).
 *
 * Trygghetsregler:
 *   - Vi rør IKKE rom som er RUNNING, PAUSED eller WAITING — selv om koden
 *     er non-canonical. Auto-destroy under aktiv runde ville droppet ekte
 *     spilleres innsatser. Disse logges som warn så ops kan rydde manuelt.
 *   - Canonical rom (BINGO_*, ROCKET, MONSTERBINGO) rør vi aldri — selv om
 *     `cleanupStaleWalletInIdleRooms` evt. kunne ryddet stale player-records,
 *     er rom-koden i seg selv en feature, ikke en bug.
 *   - Vi destroyer maks N rom per boot for å unngå kaskaderende destroy
 *     hvis noe er fundamentalt galt — default 50.
 */

import { isCanonicalRoomCode } from "./canonicalRoomCode.js";

export interface StaleRoomSweepResult {
  /** Total rom inspisert. */
  inspected: number;
  /** Antall rom som matchet canonical-format (uberørt). */
  canonical: number;
  /** Antall non-canonical IDLE/ENDED rom som ble destroyet. */
  destroyed: string[];
  /** Antall non-canonical rom som ble bevart fordi de hadde aktiv runde. */
  preservedActive: string[];
  /** Failures under destroy — best-effort, ikke fatale. */
  failures: Array<{ roomCode: string; error: string }>;
}

export interface StaleRoomSweepDeps {
  /** Engine som eksponerer rom-listing + destroy-API. */
  engine: {
    getAllRoomCodes(): string[];
    getRoomSnapshot(code: string): {
      currentGame?: { status: "WAITING" | "RUNNING" | "PAUSED" | "ENDED" } | undefined;
    };
    destroyRoom(code: string): void;
  };
  /**
   * Audit-log writer. Fire-and-forget — vi blokkerer ikke boot på audit-feil.
   * Optional; hvis ikke wired, sweep logger kun til console.
   */
  audit?: (event: {
    action: string;
    resource: string;
    resourceId: string | null;
    details: Record<string, unknown>;
  }) => void;
  /** Logger med warn/info/error. */
  logger: {
    info: (data: unknown, msg: string) => void;
    warn: (data: unknown, msg: string) => void;
    error: (data: unknown, msg: string) => void;
  };
  /** Maks antall rom å destroye per boot. Default 50. */
  maxDestroyPerBoot?: number;
}

/**
 * Kjør boot-sweep. Returnerer rapport for observability.
 *
 * Idempotent — kan kjøres flere ganger uten skade. Andre+ kjøring vil finne
 * få/ingen non-canonical rom siden alle ENDED-er allerede er ryddet.
 */
export function sweepStaleNonCanonicalRooms(
  deps: StaleRoomSweepDeps,
): StaleRoomSweepResult {
  const { engine, audit, logger, maxDestroyPerBoot = 50 } = deps;

  const result: StaleRoomSweepResult = {
    inspected: 0,
    canonical: 0,
    destroyed: [],
    preservedActive: [],
    failures: [],
  };

  const codes = engine.getAllRoomCodes();
  for (const code of codes) {
    result.inspected += 1;

    if (isCanonicalRoomCode(code)) {
      result.canonical += 1;
      continue;
    }

    // Non-canonical rom funnet. Avgjør basert på currentGame-status.
    let snapshot: { currentGame?: { status: string } | undefined };
    try {
      snapshot = engine.getRoomSnapshot(code);
    } catch (err) {
      result.failures.push({
        roomCode: code,
        error: `getRoomSnapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const status = snapshot.currentGame?.status;
    const isActiveOrWaiting =
      status === "RUNNING" || status === "PAUSED" || status === "WAITING";

    if (isActiveOrWaiting) {
      result.preservedActive.push(code);
      logger.warn(
        { roomCode: code, status },
        "[boot-sweep] non-canonical room with active game preserved — admin must clear manually",
      );
      continue;
    }

    // ENDED, NONE eller no currentGame → trygt å destroye.
    if (result.destroyed.length >= maxDestroyPerBoot) {
      logger.warn(
        { roomCode: code, alreadyDestroyed: result.destroyed.length, max: maxDestroyPerBoot },
        "[boot-sweep] max destroy-per-boot reached — remaining stale rooms preserved",
      );
      break;
    }

    try {
      engine.destroyRoom(code);
      result.destroyed.push(code);
    } catch (err) {
      result.failures.push({
        roomCode: code,
        error: `destroyRoom failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (result.destroyed.length > 0 || result.preservedActive.length > 0) {
    logger.info(
      {
        inspected: result.inspected,
        canonical: result.canonical,
        destroyedCount: result.destroyed.length,
        preservedActiveCount: result.preservedActive.length,
        failureCount: result.failures.length,
        destroyed: result.destroyed,
        preservedActive: result.preservedActive,
      },
      "[boot-sweep] stale non-canonical room cleanup complete",
    );

    if (audit) {
      try {
        audit({
          action: "system.boot.stale_room_cleanup",
          resource: "system",
          resourceId: null,
          details: {
            inspected: result.inspected,
            canonical: result.canonical,
            destroyed: result.destroyed,
            preservedActive: result.preservedActive,
            failures: result.failures,
          },
        });
      } catch (err) {
        // Ikke kritisk — audit er allerede fire-and-forget i caller-laget.
        logger.warn({ err }, "[boot-sweep] audit-log write failed (non-blocking)");
      }
    }
  } else {
    logger.info(
      {
        inspected: result.inspected,
        canonical: result.canonical,
      },
      "[boot-sweep] no stale non-canonical rooms found",
    );
  }

  return result;
}
