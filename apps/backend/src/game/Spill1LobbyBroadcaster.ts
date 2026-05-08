/**
 * Spill 1 lobby broadcaster (R1, BIN-822) — 2026-05-08.
 *
 * Bakgrunn:
 *   PR #1018 lever lobby-foundation:
 *     - `Game1LobbyService.getLobbyState(hallId)` (read-only state-aggregat)
 *     - `GET /api/games/spill1/lobby?hallId=X` (public HTTP endpoint)
 *     - Socket.IO-rom `spill1:lobby:{hallId}` med subscribe/unsubscribe
 *     - Eksportert `broadcastLobbyStateUpdate(io, hallId, state)`-helper
 *
 *   Denne broadcaster-en er final-step i R1: når master-handlinger endrer
 *   plan- eller scheduled-game-state, henter vi oppdatert lobby-state per
 *   relevant hall og broadcaster til hallens lobby-rom. Klient som er
 *   subscribed mottar `lobby:state-update` og bytter mellom lobby-modus
 *   og runde-modus uten å vente på poll-tick (10s).
 *
 * Bevisst design-valg:
 *   - **Route-laget kaller broadcaster** istedenfor å injisere callback i
 *     service-internals. Holder service-API rene; lobby-broadcast er en
 *     UI-hint som ikke er kritisk-sti for state-overgangen.
 *   - **Best-effort**: feil i broadcast logges men kaster ikke. Klient
 *     poller HTTP-endepunktet hvert 10s uansett (Cache-Control: no-store)
 *     så missed broadcast = max 10s forsinkelse.
 *   - **Fan-out til participating halls**: scheduled-game kan ha master-
 *     hall + N deltager-haller. Alle får broadcast.
 *   - **Plan-run binding**: `app_game_plan_run` har 1 hall per row, så
 *     plan-run-broadcasts er 1-til-1 (ikke fan-out).
 */

import type { Server } from "socket.io";
import type { Pool } from "pg";

import type { Game1LobbyService } from "./Game1LobbyService.js";
import { broadcastLobbyStateUpdate } from "../sockets/spill1LobbyEvents.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "spill1-lobby-broadcaster" });

export interface Spill1LobbyBroadcasterOptions {
  io: Server;
  lobbyService: Game1LobbyService;
  pool: Pool;
  schema?: string;
}

export class Spill1LobbyBroadcaster {
  private readonly io: Server;
  private readonly lobbyService: Game1LobbyService;
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(opts: Spill1LobbyBroadcasterOptions) {
    this.io = opts.io;
    this.lobbyService = opts.lobbyService;
    this.pool = opts.pool;
    this.schema = opts.schema ?? "public";
  }

  /**
   * Broadcast oppdatert lobby-state til ÉN spesifikk hall. Best-effort.
   *
   * Henter ferskt state fra `Game1LobbyService.getLobbyState(hallId)` og
   * emit-er `lobby:state-update` til Socket.IO-rommet `spill1:lobby:{hallId}`.
   */
  async broadcastForHall(hallId: string): Promise<void> {
    if (typeof hallId !== "string" || hallId.trim().length === 0) {
      log.warn({ hallId }, "broadcastForHall: ugyldig hallId, hopper over");
      return;
    }
    const trimmed = hallId.trim();
    try {
      const state = await this.lobbyService.getLobbyState(trimmed);
      broadcastLobbyStateUpdate(this.io, trimmed, state);
      log.debug(
        { hallId: trimmed, status: state.overallStatus },
        "[lobby] broadcast sendt",
      );
    } catch (err) {
      log.warn(
        { err, hallId: trimmed },
        "[lobby] broadcastForHall feilet — best-effort, fortsetter",
      );
    }
  }

  /**
   * Broadcast for alle haller knyttet til en `app_game1_scheduled_games`-rad.
   * Fan-out: master_hall_id + alle haller i `participating_halls_json`.
   */
  async broadcastForScheduledGame(scheduledGameId: string): Promise<void> {
    if (
      typeof scheduledGameId !== "string" ||
      scheduledGameId.trim().length === 0
    ) {
      log.warn({ scheduledGameId }, "broadcastForScheduledGame: ugyldig id");
      return;
    }
    const id = scheduledGameId.trim();
    let halls: string[] = [];
    try {
      const { rows } = await this.pool.query<{
        master_hall_id: string;
        participating_halls_json: unknown;
      }>(
        `SELECT master_hall_id, participating_halls_json
         FROM "${this.schema}"."app_game1_scheduled_games"
         WHERE id = $1
         LIMIT 1`,
        [id],
      );
      if (rows.length === 0) {
        log.warn(
          { scheduledGameId: id },
          "broadcastForScheduledGame: rad ikke funnet",
        );
        return;
      }
      halls = collectParticipatingHalls(
        rows[0].master_hall_id,
        rows[0].participating_halls_json,
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        log.debug(
          { scheduledGameId: id },
          "[lobby] scheduled-games-tabell mangler, hopper over",
        );
        return;
      }
      log.warn(
        { err, scheduledGameId: id },
        "[lobby] broadcastForScheduledGame query feilet",
      );
      return;
    }

    await Promise.all(halls.map((hallId) => this.broadcastForHall(hallId)));
  }

  /**
   * Broadcast for hallen knyttet til en `app_game_plan_run`-rad.
   * Plan-run har 1 hall per rad (UNIQUE per (hall_id, business_date)).
   */
  async broadcastForPlanRun(runId: string): Promise<void> {
    if (typeof runId !== "string" || runId.trim().length === 0) {
      log.warn({ runId }, "broadcastForPlanRun: ugyldig runId");
      return;
    }
    const id = runId.trim();
    try {
      const { rows } = await this.pool.query<{ hall_id: string }>(
        `SELECT hall_id
         FROM "${this.schema}"."app_game_plan_run"
         WHERE id = $1
         LIMIT 1`,
        [id],
      );
      if (rows.length === 0) {
        log.warn({ runId: id }, "broadcastForPlanRun: rad ikke funnet");
        return;
      }
      await this.broadcastForHall(rows[0].hall_id);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        log.debug(
          { runId: id },
          "[lobby] plan-run-tabell mangler, hopper over",
        );
        return;
      }
      log.warn(
        { err, runId: id },
        "[lobby] broadcastForPlanRun query feilet",
      );
    }
  }
}

function collectParticipatingHalls(
  masterHallId: string | null,
  participatingJson: unknown,
): string[] {
  const halls = new Set<string>();
  if (typeof masterHallId === "string" && masterHallId.trim().length > 0) {
    halls.add(masterHallId.trim());
  }
  let participating: unknown = participatingJson;
  if (typeof participating === "string") {
    try {
      participating = JSON.parse(participating);
    } catch {
      participating = null;
    }
  }
  if (Array.isArray(participating)) {
    for (const item of participating) {
      if (typeof item === "string" && item.trim().length > 0) {
        halls.add(item.trim());
      }
    }
  }
  return Array.from(halls);
}
