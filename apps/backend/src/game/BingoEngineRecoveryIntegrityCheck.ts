/**
 * HIGH-4 (Casino Review): post-recovery integrity-check.
 *
 * Etter en Render-restart (eller pod-eviction) kjører `BingoEngine`-
 * gjenoppretting i to faser:
 *   1. {@link RoomStateStore.loadAll} laster `RoomState` fra Redis.
 *   2. `index.ts` itererer `findIncompleteGames()` og kaller
 *      `restoreRoomFromSnapshot` per rom — som overskriver
 *      `currentGame` med data fra siste PG-checkpoint.
 *
 * Hvis Redis-state og PG-checkpoint divergerer (typisk fordi en eldre
 * Redis-write aldri ble ryddet opp etter en interrupted shutdown),
 * starter prosessen med inkonsistent in-memory state. Dette er en
 * stille klasse av wallet/draw-bug — ledger og spill-state kan komme
 * ut av synk uten at noe kaster.
 *
 * Denne modulen er en best-effort sjekker som kjøres ETTER
 * `restoreRoomFromSnapshot` har overskrevet alle rom. Den verifiserer
 * at de feltene som er enklest å sammenligne — `drawnNumbers` og
 * `tickets`-set — matcher siste PG-checkpoint. Mismatcher logges som
 * WARN og inkrementerer `wallet_room_drift_total` per rom.
 *
 * **Hva sjekken IKKE gjør:**
 *   - Korrigerer ikke automatisk drift — det er for risky uten manuell
 *     vurdering. Ops må undersøke loggen og evt. force-end runden.
 *   - Sjekker ikke wallet-ledger-konsistens — det dekkes av
 *     `Game1RecoveryService` og separate compliance-jobs.
 *   - Erstatter ikke `restoreRoomFromSnapshot` — kjøres som ekstra
 *     defensive layer.
 */

import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import { logger as rootLogger } from "../util/logger.js";
import { metrics } from "../util/metrics.js";
import type { RoomStateStore } from "../store/RoomStateStore.js";
import type { GameSnapshot } from "./types.js";

const logger = rootLogger.child({ module: "engine.recovery.integrity" });

export interface IntegrityCheckResult {
  /** Antall rom inspisert. */
  inspected: number;
  /** Antall rom uten in-progress runde (skipped). */
  skipped: number;
  /** Antall rom som passerte sjekken uten avvik. */
  ok: number;
  /** Antall rom med minst ett detected avvik. */
  drift: number;
  /** Detaljer per rom som hadde drift — for test-assertions. */
  driftRooms: Array<{
    roomCode: string;
    fields: string[];
  }>;
  /** Antall rom hvor sjekken feilet (DB-feil, parse-feil osv.). */
  failures: number;
}

/**
 * Kjør integritetssjekk over alle in-memory rom og siste PG-checkpoint.
 *
 * Kall denne ETTER `BingoEngine.restoreRoomFromSnapshot` har kjørt for
 * alle incomplete games (typisk på slutten av crash-recovery-blokken i
 * `index.ts`).
 *
 * Returnerer aldri en throw — alle feil swallowes og logges. Caller
 * kan inspect `IntegrityCheckResult.failures` om ønskelig.
 */
export async function runRecoveryIntegrityCheck(deps: {
  roomStateStore: RoomStateStore;
  bingoAdapter: BingoSystemAdapter & {
    /** Optional — kun PostgresBingoSystemAdapter eksponerer denne. */
    getLatestCheckpointData?: (gameId: string) => Promise<{ snapshot: unknown; players: unknown } | null>;
  };
}): Promise<IntegrityCheckResult> {
  const { roomStateStore, bingoAdapter } = deps;
  const result: IntegrityCheckResult = {
    inspected: 0,
    skipped: 0,
    ok: 0,
    drift: 0,
    driftRooms: [],
    failures: 0,
  };

  if (typeof bingoAdapter.getLatestCheckpointData !== "function") {
    logger.info(
      "BingoSystemAdapter har ingen getLatestCheckpointData — hopper over integritetssjekk (ikke-PG-adapter).",
    );
    return result;
  }

  const roomCodes: string[] = [];
  for (const code of roomStateStore.keys()) {
    roomCodes.push(code);
  }

  for (const code of roomCodes) {
    result.inspected += 1;
    const room = roomStateStore.get(code);
    if (!room || !room.currentGame) {
      result.skipped += 1;
      continue;
    }

    const gameId = room.currentGame.id;
    let checkpoint: { snapshot: unknown; players: unknown } | null = null;
    try {
      checkpoint = await bingoAdapter.getLatestCheckpointData(gameId);
    } catch (err) {
      result.failures += 1;
      logger.error(
        { err, roomCode: code, gameId },
        "[HIGH-4] Klarte ikke laste siste checkpoint — kan ikke verifisere integritet.",
      );
      continue;
    }

    if (!checkpoint || !checkpoint.snapshot) {
      // Ingen checkpoint betyr typisk at runden akkurat startet og ingen
      // draw-checkpoint enda er skrevet. Det er ikke drift — bare en
      // tom historikk. Skip uten å logge støy.
      result.skipped += 1;
      continue;
    }

    const snap = checkpoint.snapshot as Partial<GameSnapshot> | null;
    if (!snap || typeof snap !== "object") {
      result.failures += 1;
      logger.warn(
        { roomCode: code, gameId },
        "[HIGH-4] Sist persistert checkpoint har ingen gyldig snapshot — kan ikke verifisere.",
      );
      continue;
    }

    const driftFields: string[] = [];

    // 1) drawnNumbers — enklest å sammenligne.
    const memDrawn = room.currentGame.drawnNumbers ?? [];
    const dbDrawn = Array.isArray(snap.drawnNumbers) ? snap.drawnNumbers : [];
    if (!arrayEquals(memDrawn, dbDrawn)) {
      driftFields.push("drawnNumbers");
      logger.warn(
        {
          roomCode: code,
          gameId,
          memCount: memDrawn.length,
          dbCount: dbDrawn.length,
          memTail: memDrawn.slice(-5),
          dbTail: dbDrawn.slice(-5),
        },
        "[HIGH-4] drift: in-memory drawnNumbers != PG checkpoint",
      );
    }

    // 2) tickets-set per spiller — sjekker bare *playerId-set*, ikke
    // bingo-grids (de er deterministiske fra startGame). Hvis en
    // spiller eksisterer i PG-checkpoint men mangler in-memory (eller
    // omvendt), er det en alvorlig drift.
    const memPlayerIds = new Set(room.currentGame.tickets.keys());
    const dbPlayerIds = new Set(
      snap.tickets && typeof snap.tickets === "object" ? Object.keys(snap.tickets) : [],
    );
    if (!setEquals(memPlayerIds, dbPlayerIds)) {
      driftFields.push("tickets.players");
      logger.warn(
        {
          roomCode: code,
          gameId,
          memOnly: [...memPlayerIds].filter((p) => !dbPlayerIds.has(p)),
          dbOnly: [...dbPlayerIds].filter((p) => !memPlayerIds.has(p)),
        },
        "[HIGH-4] drift: in-memory ticket-spiller-sett != PG checkpoint",
      );
    }

    // 3) status — running vs ended-mismatch betyr at runden ble
    // terminert i DB men ikke i RAM (eller omvendt).
    if (snap.status && snap.status !== room.currentGame.status) {
      driftFields.push("status");
      logger.warn(
        {
          roomCode: code,
          gameId,
          memStatus: room.currentGame.status,
          dbStatus: snap.status,
        },
        "[HIGH-4] drift: in-memory game.status != PG checkpoint",
      );
    }

    if (driftFields.length === 0) {
      result.ok += 1;
      continue;
    }

    result.drift += 1;
    result.driftRooms.push({ roomCode: code, fields: driftFields });
    for (const field of driftFields) {
      try {
        metrics.walletRoomDriftTotal.inc({ room: code, field });
      } catch {
        // Metrics-feil skal aldri stoppe oppstart.
      }
    }
  }

  if (result.drift > 0) {
    logger.warn(
      {
        inspected: result.inspected,
        ok: result.ok,
        drift: result.drift,
        skipped: result.skipped,
        failures: result.failures,
        driftRooms: result.driftRooms,
      },
      `[HIGH-4] Recovery-integritetssjekk: ${result.drift} rom har drift. Manuell vurdering anbefales.`,
    );
  } else if (result.inspected > 0) {
    logger.info(
      {
        inspected: result.inspected,
        ok: result.ok,
        skipped: result.skipped,
        failures: result.failures,
      },
      "[HIGH-4] Recovery-integritetssjekk: ingen drift detektert.",
    );
  }

  return result;
}

function arrayEquals(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}
