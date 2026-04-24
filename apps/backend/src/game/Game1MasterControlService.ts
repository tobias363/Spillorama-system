/**
 * GAME1_SCHEDULE PR 3: master-control service for Game 1.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.3 + §3.5 + §3.9.
 *
 * Ansvar:
 *   1) startGame({ gameId, confirmExcludedHalls?, actor })
 *      - Pre-cond: game.status IN ('purchase_open' med allReady, 'ready_to_start')
 *      - Validerer at actor er master (actor.id må være fra master_hall_id
 *        eller være ADMIN).
 *      - Validerer ingen ikke-bekreftet ekskludert hall.
 *      - UPDATE status='running', actual_start_time=NOW(), started_by_user_id.
 *      - AuditLog: 'start' med halls_ready_snapshot.
 *   2) excludeHall({ gameId, hallId, reason, actor })
 *      - Gyldig i status='purchase_open' eller 'ready_to_start'.
 *      - Master kan ikke ekskludere master-hallen selv.
 *      - UPDATE app_game1_hall_ready_status: excluded_from_game=true.
 *      - Side-effekt: rullerer 'ready_to_start' tilbake til 'purchase_open'.
 *      - AuditLog: 'exclude_hall' med hallId + reason i metadata.
 *   3) includeHall({ gameId, hallId, actor })
 *      - Reverser exclusion. Kun gyldig i 'purchase_open'.
 *      - AuditLog: 'include_hall'.
 *   4) pauseGame({ gameId, reason?, actor }) — status='running' → 'paused'.
 *   5) resumeGame({ gameId, actor }) — status='paused' → 'running'.
 *   6) stopGame({ gameId, reason, actor })
 *      - Gyldig i status IN ('purchase_open', 'ready_to_start', 'running', 'paused').
 *      - UPDATE status='cancelled', stopped_by_user_id, stop_reason.
 *      - AuditLog: 'stop' med reason i metadata.
 *
 * Design:
 *   - Service er DB-only: oppdaterer app_game1_scheduled_games +
 *     app_game1_hall_ready_status + app_game1_master_audit.
 *     BingoEngine-integrasjon (ad-hoc room-basert engine) gjøres IKKE her —
 *     BingoEngine.startGame trenger roomCode + player-setup som er
 *     separat fra scheduled-game-flyten. Spec §3.5 kaller dette "delegate
 *     til BingoEngine" men BingoEngine er room-scoped, ikke scheduled-
 *     game-scoped. PR 3-scope begrenses derfor til scheduled-games-
 *     state-maskin + audit; faktisk draw-engine-wiring kommer i senere
 *     PR når room-code-mapping er definert.
 *   - Hall-scope håndheves i route-laget.
 *   - Audit skrives i samme transaksjon som state-oppdateringen.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";
import type { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import type { AdminGame1Broadcaster } from "./AdminGame1Broadcaster.js";
import { emitAdminResumed } from "./Game1DrawEngineBroadcast.js";
import type {
  Game1TicketPurchaseService,
  Game1RefundAllForGameResult,
} from "./Game1TicketPurchaseService.js";

const log = rootLogger.child({ module: "game1-master-control-service" });

export type MasterAuditAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "exclude_hall"
  | "include_hall"
  | "timeout_detected"
  | "start_game_with_unready_override";

export const MASTER_AUDIT_ACTIONS: readonly MasterAuditAction[] = [
  "start",
  "pause",
  "resume",
  "stop",
  "exclude_hall",
  "include_hall",
  "timeout_detected",
  "start_game_with_unready_override",
];

export interface MasterActor {
  userId: string;
  hallId: string;
  role: "ADMIN" | "HALL_OPERATOR" | "AGENT" | "SUPPORT";
}

export interface StartGameInput {
  gameId: string;
  confirmExcludedHalls?: string[];
  /**
   * Task 1.5: master-override for "agents not ready"-flyt. Hvis noen deltakende
   * (non-excluded, non-master) haller har `is_ready=false` på start-tidspunktet,
   * kaster `startGame` en `HALLS_NOT_READY`-DomainError med listen i
   * `details.unreadyHalls`. Frontend viser popup "Agents not ready yet: …" med
   * valg [Avbryt] / [Start uansett].
   *
   * Hvis master bekrefter override, kaller klienten `/start` på nytt med
   * samtlige ikke-klare hall-IDer i `confirmUnreadyHalls`. Service ekskluderer
   * da disse hallene (UPSERT excluded_from_game=true, grunn="unready_override")
   * og skriver audit-entry `start_game_with_unready_override` med listen +
   * tidsstempel FØR normal `start`-entry.
   *
   * KUN relevant ved initial start (status='purchase_open'|'ready_to_start').
   * Resume (paused→running) bruker ingen ready-sjekk.
   */
  confirmUnreadyHalls?: string[];
  actor: MasterActor;
}

export interface ExcludeHallInput {
  gameId: string;
  hallId: string;
  reason: string;
  actor: MasterActor;
}

export interface IncludeHallInput {
  gameId: string;
  hallId: string;
  actor: MasterActor;
}

export interface PauseGameInput {
  gameId: string;
  reason?: string;
  actor: MasterActor;
}

export interface ResumeGameInput {
  gameId: string;
  actor: MasterActor;
}

export interface StopGameInput {
  gameId: string;
  reason: string;
  actor: MasterActor;
}

export interface MasterActionResult {
  gameId: string;
  status: string;
  actualStartTime: string | null;
  actualEndTime: string | null;
  auditId: string;
  /**
   * PR 4d.4: kun satt etter `stopGame`. Inneholder sammendrag av
   * automatisk refund-loop. Null hvis ticketPurchaseService ikke er
   * injisert (legacy-modus).
   */
  refundSummary?: Game1RefundAllForGameResult | null;
}

export interface TimeoutDetectedInput {
  gameId: string;
}

export interface Game1MasterControlServiceOptions {
  pool: Pool;
  schema?: string;
  /**
   * GAME1_SCHEDULE PR 4b: valgfri draw-engine som orkestreres av master-
   * control. Når satt: startGame delegerer til engine.startGame() etter
   * DB-state-update, og pauseGame/resumeGame/stopGame delegerer tilsvarende.
   * Hvis engine-kall feiler, rulles DB-endringen tilbake og feilen kastes.
   *
   * Valgfri for bakoverkompatibilitet (eksisterende tester + legacy kjøre-
   * moduser). Produksjonssetup injisierer alltid engine via index.ts.
   */
  drawEngine?: Game1DrawEngineService;
  /**
   * GAME1_SCHEDULE PR 4d.3: valgfri broadcaster for admin-namespace.
   * Fire-and-forget — service-metoder kaller broadcaster.onStatusChange
   * etter DB-commit. Feil i broadcaster loggres men påvirker ikke
   * service-flyten.
   */
  adminBroadcaster?: AdminGame1Broadcaster;
  /**
   * GAME1_SCHEDULE PR 4d.4: valgfri ticket-purchase-service. Når satt
   * utløser stopGame automatisk `refundAllForGame` POST-commit + engine.
   * Feilet refund per rad isoleres (fail-closed), summary loggres. Null
   * = legacy-mode uten automatisk refund (eksisterende tester passerer).
   */
  ticketPurchaseService?: Game1TicketPurchaseService;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
}

interface HallReadySnapshotRow {
  hall_id: string;
  is_ready: boolean;
  excluded_from_game: boolean;
}

function parseHallIdsArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((x: unknown): x is string => typeof x === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

export class Game1MasterControlService {
  private readonly pool: Pool;
  private readonly schema: string;
  private drawEngine: Game1DrawEngineService | null;
  private adminBroadcaster: AdminGame1Broadcaster | null;
  private ticketPurchaseService: Game1TicketPurchaseService | null;

  constructor(options: Game1MasterControlServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    this.drawEngine = options.drawEngine ?? null;
    this.adminBroadcaster = options.adminBroadcaster ?? null;
    this.ticketPurchaseService = options.ticketPurchaseService ?? null;
  }

  /**
   * PR 4d.3: late-binding for admin-broadcaster. Brukes av index.ts etter
   * at `/admin-game1`-namespace er opprettet (io må finnes før).
   */
  setAdminBroadcaster(broadcaster: AdminGame1Broadcaster): void {
    this.adminBroadcaster = broadcaster;
  }

  /**
   * PR 4d.4: late-binding for ticket-purchase-service. Brukes av index.ts
   * for å unngå circular import — ticketPurchase konstrueres senere enn
   * masterControl.
   */
  setTicketPurchaseService(
    ticketPurchaseService: Game1TicketPurchaseService
  ): void {
    this.ticketPurchaseService = ticketPurchaseService;
  }

  /**
   * PR 4d.3: fire-and-forget admin-broadcast etter DB-commit. Wrap i try/catch
   * slik at en eventuell broadcaster-feil aldri kan krasje action-responsen.
   */
  private notifyStatusChange(
    result: MasterActionResult,
    action: MasterAuditAction,
    actorUserId: string
  ): void {
    if (!this.adminBroadcaster) return;
    try {
      this.adminBroadcaster.onStatusChange({
        gameId: result.gameId,
        status: result.status,
        action,
        auditId: result.auditId,
        actorUserId,
        at: Date.now(),
      });
    } catch (err) {
      log.warn(
        { err, gameId: result.gameId, action },
        "adminBroadcaster.onStatusChange kastet — ignorert for å ikke påvirke action-responsen"
      );
    }
  }

  /** @internal test helper. */
  static forTesting(pool: Pool, schema = "public"): Game1MasterControlService {
    return new Game1MasterControlService({ pool, schema });
  }

  /**
   * GAME1_SCHEDULE PR 4b: setter draw-engine etter konstruksjon (brukes av
   * DI-wiring i index.ts der master-control-servicen opprettes før engine
   * for å unngå sirkulær avhengighet).
   */
  setDrawEngine(drawEngine: Game1DrawEngineService): void {
    (this as unknown as { drawEngine: Game1DrawEngineService }).drawEngine =
      drawEngine;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private hallReadyTable(): string {
    return `"${this.schema}"."app_game1_hall_ready_status"`;
  }

  private masterAuditTable(): string {
    return `"${this.schema}"."app_game1_master_audit"`;
  }

  /**
   * Task 1.1: tabell-referanse for engine-state. Brukes av `resumeGame` for
   * å håndtere auto-pause-sidestate (paused=true + paused_at_phase !=
   * null) samtidig som `scheduled_games.status` håndteres.
   */
  private gameStateTable(): string {
    return `"${this.schema}"."app_game1_game_state"`;
  }

  /**
   * Task 1.1: fire-and-forget admin-broadcast av `game1:resumed` etter
   * DB-commit. Wrap i try/catch slik at en eventuell broadcaster-feil
   * aldri kan krasje action-responsen.
   */
  private notifyResumed(
    gameId: string,
    actorUserId: string,
    phase: number,
    resumeType: "auto" | "manual"
  ): void {
    emitAdminResumed(
      this.adminBroadcaster,
      gameId,
      actorUserId,
      phase,
      resumeType
    );
  }

  async startGame(input: StartGameInput): Promise<MasterActionResult> {
    const result = await this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);
      this.assertActorIsMaster(input.actor, game);

      if (game.status !== "ready_to_start" && game.status !== "purchase_open") {
        throw new DomainError(
          "GAME_NOT_STARTABLE",
          `Kan ikke starte spill i status '${game.status}'.`
        );
      }

      const readyRows = await this.loadReadySnapshot(client, input.gameId);

      // Task 1.5: compute orange (unready) halls BEFORE status-guard so
      // `HALLS_NOT_READY` kan returneres med strukturert liste (via
      // DomainError.details). Orange = not-ready, not-excluded, not master —
      // master kan ikke være orange (master er alltid klar per definisjon i
      // state-maskinen; kastes i purchase_open-gren under).
      const confirmedUnready = new Set(input.confirmUnreadyHalls ?? []);
      const unreadyHalls = readyRows
        .filter(
          (r) =>
            !r.excluded_from_game &&
            !r.is_ready &&
            r.hall_id !== game.master_hall_id
        )
        .map((r) => r.hall_id);
      const uncoveredUnready = unreadyHalls.filter(
        (h) => !confirmedUnready.has(h)
      );

      if (game.status === "purchase_open") {
        const nonExcluded = readyRows.filter((r) => !r.excluded_from_game);
        if (nonExcluded.length === 0) {
          throw new DomainError(
            "NO_READY_HALLS",
            "Ingen deltakende haller er klare."
          );
        }

        // Master-hall er alltid deltaker og må være klar (kan ikke
        // ekskluderes). Håndteres som blocking feil før unready-override.
        const masterRow = readyRows.find(
          (r) => r.hall_id === game.master_hall_id
        );
        if (masterRow && !masterRow.is_ready) {
          throw new DomainError(
            "HALLS_NOT_READY",
            "Master-hallen er ikke klar.",
            { unreadyHalls: [game.master_hall_id] }
          );
        }

        // Task 1.5: tilsvar `confirmExcludedHalls` — hvis orange-listen
        // ikke er fullstendig dekket av `confirmUnreadyHalls`, kast
        // HALLS_NOT_READY med listen slik at frontend kan vise popup.
        if (uncoveredUnready.length > 0) {
          throw new DomainError(
            "HALLS_NOT_READY",
            `Haller er ikke klare: ${uncoveredUnready.join(", ")}.`,
            { unreadyHalls: uncoveredUnready }
          );
        }
      }

      // Task 1.5: hvis master har bekreftet override, marker de gjeldende
      // hallene som excluded_from_game=true (med grunn="unready_override")
      // FØR start-transisjonen slik at runde-beregning ikke inkluderer
      // dem. Idempotent: hvis en hall allerede er ekskludert, gjør UPDATE
      // ingen ting (ON CONFLICT DO UPDATE).
      const overrideExcluded: string[] = [];
      if (input.confirmUnreadyHalls && input.confirmUnreadyHalls.length > 0) {
        for (const hallId of input.confirmUnreadyHalls) {
          // Bare flytt haller som faktisk var orange (unready) til excluded.
          // Dersom en hall ikke var i listen (f.eks. pga. race) ignoreres
          // den stille — override-audit logger samtlige IDer klient sendte.
          if (!unreadyHalls.includes(hallId)) continue;
          if (hallId === game.master_hall_id) continue;
          await client.query(
            `INSERT INTO ${this.hallReadyTable()}
               (game_id, hall_id, is_ready, excluded_from_game, excluded_reason)
             VALUES ($1, $2, false, true, $3)
             ON CONFLICT (game_id, hall_id) DO UPDATE
               SET excluded_from_game = true,
                   excluded_reason    = EXCLUDED.excluded_reason,
                   updated_at         = now()`,
            [input.gameId, hallId, "unready_override"]
          );
          overrideExcluded.push(hallId);
        }

        // Skriv override-audit FØR normal start-audit slik at det er
        // sporbart i hvilken rekkefølge hendelsene skjedde. `unreadyHalls`
        // = IDer klient sendte; `applied` = faktisk ekskluderte.
        const overrideAuditId = await this.writeAudit(client, {
          gameId: input.gameId,
          action: "start_game_with_unready_override",
          actor: input.actor,
          groupHallId: game.group_hall_id,
          snapshot: this.snapshotReadyRows(readyRows),
          metadata: {
            confirmUnreadyHalls: input.confirmUnreadyHalls,
            appliedExcludedHalls: overrideExcluded,
            overriddenAt: new Date().toISOString(),
          },
        });
        log.info(
          {
            gameId: input.gameId,
            actorId: input.actor.userId,
            auditId: overrideAuditId,
            overrideExcluded,
          },
          "master.start.unready_override"
        );
      }

      // Re-compute excluded hall-IDs ETTER override-applikering slik at
      // `confirmExcludedHalls`-sjekken inkluderer nyekskluderte. Unngå
      // ekstra DB-round-trip hvis ingen override ble kjørt: da er pre-
      // snapshot (readyRows) fortsatt gyldig.
      const postRows =
        overrideExcluded.length > 0
          ? await this.loadReadySnapshot(client, input.gameId)
          : readyRows;
      const excludedHallIds = postRows
        .filter((r) => r.excluded_from_game)
        .map((r) => r.hall_id);
      const confirmed = new Set([
        ...(input.confirmExcludedHalls ?? []),
        // Task 1.5: override-ekskluderte haller er implisitt bekreftet via
        // `confirmUnreadyHalls`; kaller trenger ikke sende dem dobbelt.
        ...overrideExcluded,
      ]);
      const unconfirmed = excludedHallIds.filter((h) => !confirmed.has(h));
      if (unconfirmed.length > 0) {
        throw new DomainError(
          "EXCLUDED_HALLS_NOT_CONFIRMED",
          `Master må bekrefte ekskluderte haller: ${unconfirmed.join(", ")}.`
        );
      }

      const { rows: updated } = await client.query<ScheduledGameRow>(
        `UPDATE ${this.scheduledGamesTable()}
            SET status              = 'running',
                actual_start_time   = now(),
                started_by_user_id  = $2,
                updated_at          = now()
          WHERE id = $1
          RETURNING id, status, master_hall_id, group_hall_id,
                    participating_halls_json, actual_start_time, actual_end_time`,
        [input.gameId, input.actor.userId]
      );
      const row = updated[0];
      if (!row) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke lenger.");
      }

      const auditId = await this.writeAudit(client, {
        gameId: input.gameId,
        action: "start",
        actor: input.actor,
        groupHallId: game.group_hall_id,
        snapshot: this.snapshotReadyRows(readyRows),
        metadata: {
          confirmExcludedHalls: input.confirmExcludedHalls ?? [],
          confirmUnreadyHalls: input.confirmUnreadyHalls ?? [],
          excludedHallIds,
          overrideExcluded,
        },
      });

      log.info(
        { gameId: input.gameId, actorId: input.actor.userId, auditId },
        "master.start"
      );

      return {
        gameId: row.id,
        status: row.status,
        actualStartTime: toIso(row.actual_start_time),
        actualEndTime: toIso(row.actual_end_time),
        auditId,
      };
    });

    // GAME1_SCHEDULE PR 4b: delegér til draw-engine POST-commit (engine
    // bruker egen transaksjon og er idempotent — retry etter feil gir samme
    // netto-effekt). Hvis engine kaster, propagerer vi feilen; DB-state er
    // allerede committed men ny kall til startGame vil short-circuit i
    // engine (idempotent) og kaste om det er reelle pre-cond-feil.
    if (this.drawEngine) {
      await this.drawEngine.startGame(input.gameId, input.actor.userId);
    }

    this.notifyStatusChange(result, "start", input.actor.userId);
    return result;
  }

  async excludeHall(input: ExcludeHallInput): Promise<MasterActionResult> {
    const reason = input.reason.trim();
    if (!reason) {
      throw new DomainError("INVALID_INPUT", "reason kreves ved eksklusjon.");
    }
    return this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);
      this.assertActorIsMaster(input.actor, game);

      if (game.status !== "purchase_open" && game.status !== "ready_to_start") {
        throw new DomainError(
          "EXCLUDE_NOT_ALLOWED",
          `Kan ikke ekskludere hall når spillet er i status '${game.status}'.`
        );
      }

      if (input.hallId === game.master_hall_id) {
        throw new DomainError(
          "CANNOT_EXCLUDE_MASTER_HALL",
          "Master-hallen kan ikke ekskluderes."
        );
      }

      const participating = parseHallIdsArray(game.participating_halls_json);
      if (!participating.includes(input.hallId) && input.hallId !== game.master_hall_id) {
        throw new DomainError(
          "HALL_NOT_PARTICIPATING",
          "Hallen deltar ikke i dette spillet."
        );
      }

      await client.query(
        `INSERT INTO ${this.hallReadyTable()}
           (game_id, hall_id, is_ready, excluded_from_game, excluded_reason)
         VALUES ($1, $2, false, true, $3)
         ON CONFLICT (game_id, hall_id) DO UPDATE
           SET excluded_from_game = true,
               excluded_reason    = EXCLUDED.excluded_reason,
               updated_at         = now()`,
        [input.gameId, input.hallId, reason]
      );

      if (game.status === "ready_to_start") {
        await client.query(
          `UPDATE ${this.scheduledGamesTable()}
              SET status     = 'purchase_open',
                  updated_at = now()
            WHERE id = $1 AND status = 'ready_to_start'`,
          [input.gameId]
        );
      }

      const readyRows = await this.loadReadySnapshot(client, input.gameId);
      const updatedStatus = await this.readGameStatus(client, input.gameId);

      const auditId = await this.writeAudit(client, {
        gameId: input.gameId,
        action: "exclude_hall",
        actor: input.actor,
        groupHallId: game.group_hall_id,
        snapshot: this.snapshotReadyRows(readyRows),
        metadata: { hallId: input.hallId, reason },
      });

      log.info(
        { gameId: input.gameId, hallId: input.hallId, actorId: input.actor.userId, auditId },
        "master.exclude_hall"
      );

      return {
        gameId: input.gameId,
        status: updatedStatus,
        actualStartTime: null,
        actualEndTime: null,
        auditId,
      };
    }).then((result) => {
      this.notifyStatusChange(result, "exclude_hall", input.actor.userId);
      return result;
    });
  }

  async includeHall(input: IncludeHallInput): Promise<MasterActionResult> {
    return this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);
      this.assertActorIsMaster(input.actor, game);

      if (game.status !== "purchase_open") {
        throw new DomainError(
          "INCLUDE_NOT_ALLOWED",
          `Kan kun inkludere hall i status 'purchase_open' (nåværende: '${game.status}').`
        );
      }

      const { rowCount } = await client.query(
        `UPDATE ${this.hallReadyTable()}
            SET excluded_from_game = false,
                excluded_reason    = NULL,
                updated_at         = now()
          WHERE game_id = $1 AND hall_id = $2 AND excluded_from_game = true`,
        [input.gameId, input.hallId]
      );
      if ((rowCount ?? 0) === 0) {
        throw new DomainError(
          "HALL_NOT_EXCLUDED",
          "Hallen er ikke ekskludert, eller har ingen ready-rad å revertere."
        );
      }

      const readyRows = await this.loadReadySnapshot(client, input.gameId);
      const auditId = await this.writeAudit(client, {
        gameId: input.gameId,
        action: "include_hall",
        actor: input.actor,
        groupHallId: game.group_hall_id,
        snapshot: this.snapshotReadyRows(readyRows),
        metadata: { hallId: input.hallId },
      });

      log.info(
        { gameId: input.gameId, hallId: input.hallId, actorId: input.actor.userId, auditId },
        "master.include_hall"
      );

      return {
        gameId: input.gameId,
        status: game.status,
        actualStartTime: toIso(game.actual_start_time),
        actualEndTime: toIso(game.actual_end_time),
        auditId,
      };
    }).then((result) => {
      this.notifyStatusChange(result, "include_hall", input.actor.userId);
      return result;
    });
  }

  async pauseGame(input: PauseGameInput): Promise<MasterActionResult> {
    const result = await this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);
      this.assertActorIsMaster(input.actor, game);

      if (game.status !== "running") {
        throw new DomainError(
          "GAME_NOT_RUNNING",
          `Kan kun pause et kjørende spill (nåværende status: '${game.status}').`
        );
      }

      const { rows: updated } = await client.query<ScheduledGameRow>(
        `UPDATE ${this.scheduledGamesTable()}
            SET status     = 'paused',
                updated_at = now()
          WHERE id = $1
          RETURNING id, status, master_hall_id, group_hall_id,
                    participating_halls_json, actual_start_time, actual_end_time`,
        [input.gameId]
      );
      const row = updated[0];
      if (!row) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke lenger.");
      }

      const readyRows = await this.loadReadySnapshot(client, input.gameId);
      const auditId = await this.writeAudit(client, {
        gameId: input.gameId,
        action: "pause",
        actor: input.actor,
        groupHallId: game.group_hall_id,
        snapshot: this.snapshotReadyRows(readyRows),
        metadata: { reason: input.reason?.trim() ?? null },
      });

      log.info(
        { gameId: input.gameId, actorId: input.actor.userId, auditId },
        "master.pause"
      );

      return {
        gameId: row.id,
        status: row.status,
        actualStartTime: toIso(row.actual_start_time),
        actualEndTime: toIso(row.actual_end_time),
        auditId,
      };
    });

    // GAME1_SCHEDULE PR 4b: delegér til draw-engine POST-commit.
    if (this.drawEngine) {
      await this.drawEngine.pauseGame(input.gameId, input.actor.userId);
    }
    this.notifyStatusChange(result, "pause", input.actor.userId);
    return result;
  }

  async resumeGame(input: ResumeGameInput): Promise<MasterActionResult> {
    // Task 1.1: Resume støtter nå to sidestate-varianter (Gap #1 i
    // MASTER_HALL_DASHBOARD_GAP_2026-04-24.md):
    //   (a) Manuell master-pause: scheduled_game.status='paused'. Flipp
    //       tilbake til 'running'.
    //   (b) Auto-pause etter phase-won: status='running' MEN
    //       app_game1_game_state.paused=true + paused_at_phase != null.
    //       Flipp paused-feltene tilbake; status forblir 'running'.
    //
    // Denne semantikken beholder eksisterende kontrakt for (a) samtidig som
    // den låser opp den nye auto-pause-flyten. `resumeType` skilles i
    // response-eventet for UI-konsistens.
    let capturedResumeType: "manual" | "auto" | null = null;
    let capturedPhaseForEvent: number = 1;
    const result = await this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);
      this.assertActorIsMaster(input.actor, game);

      // Sjekk auto-pause-state PER SCHEDULED_GAME (samme transaksjon, FOR
      // UPDATE unødvendig på game_state her siden vi kun skriver paused-
      // feltet atomisk — men vi trenger å vite om auto-pause gjelder).
      const { rows: gameStateRows } = await client.query<{
        paused: boolean;
        paused_at_phase: number | null;
        current_phase: number;
      }>(
        `SELECT paused, paused_at_phase, current_phase
           FROM ${this.gameStateTable()}
           WHERE scheduled_game_id = $1
           FOR UPDATE`,
        [input.gameId]
      );
      const gsRow = gameStateRows[0];

      const isManualPaused = game.status === "paused";
      const isAutoPaused =
        game.status === "running" &&
        gsRow !== undefined &&
        gsRow.paused === true;

      if (!isManualPaused && !isAutoPaused) {
        throw new DomainError(
          "GAME_NOT_PAUSED",
          `Kan kun resume et pauset spill (nåværende status: '${game.status}', engine-paused: ${gsRow?.paused ?? false}).`
        );
      }

      capturedResumeType = isManualPaused ? "manual" : "auto";
      capturedPhaseForEvent = gsRow?.current_phase ?? 1;

      let row: ScheduledGameRow;
      if (isManualPaused) {
        // Case (a): status='paused' → 'running'. Også nullstill auto-pause-
        // feltene defensivt (normalt er de allerede NULL/false for manuell
        // pause, men en combined paused-state bør uansett ende i ren
        // running).
        const { rows: updated } = await client.query<ScheduledGameRow>(
          `UPDATE ${this.scheduledGamesTable()}
              SET status     = 'running',
                  updated_at = now()
            WHERE id = $1
            RETURNING id, status, master_hall_id, group_hall_id,
                      participating_halls_json, actual_start_time, actual_end_time`,
          [input.gameId]
        );
        row = updated[0]!;
        if (gsRow !== undefined) {
          await client.query(
            `UPDATE ${this.gameStateTable()}
                SET paused          = false,
                    paused_at_phase = NULL
              WHERE scheduled_game_id = $1`,
            [input.gameId]
          );
        }
      } else {
        // Case (b): status forblir 'running'. Flipp paused=false +
        // paused_at_phase=NULL i game_state. last_drawn_at beholdes slik
        // at auto-tick naturlig trigger neste draw når seconds har passert
        // (ingen umiddelbar draw-spike når agent trykker Resume).
        await client.query(
          `UPDATE ${this.gameStateTable()}
              SET paused          = false,
                  paused_at_phase = NULL
            WHERE scheduled_game_id = $1`,
          [input.gameId]
        );
        // Hent fresh scheduled_game-rad for audit (status er uendret).
        const { rows: fresh } = await client.query<ScheduledGameRow>(
          `SELECT id, status, master_hall_id, group_hall_id,
                  participating_halls_json, actual_start_time, actual_end_time
             FROM ${this.scheduledGamesTable()}
             WHERE id = $1`,
          [input.gameId]
        );
        row = fresh[0]!;
      }
      if (!row) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke lenger.");
      }

      const readyRows = await this.loadReadySnapshot(client, input.gameId);
      const auditId = await this.writeAudit(client, {
        gameId: input.gameId,
        action: "resume",
        actor: input.actor,
        groupHallId: game.group_hall_id,
        snapshot: this.snapshotReadyRows(readyRows),
        metadata: {
          resumeType: capturedResumeType,
          phase: capturedPhaseForEvent,
        },
      });

      log.info(
        {
          gameId: input.gameId,
          actorId: input.actor.userId,
          auditId,
          resumeType: capturedResumeType,
        },
        "master.resume"
      );

      return {
        gameId: row.id,
        status: row.status,
        actualStartTime: toIso(row.actual_start_time),
        actualEndTime: toIso(row.actual_end_time),
        auditId,
      };
    });

    // GAME1_SCHEDULE PR 4b: delegér til draw-engine POST-commit. Bare
    // aktuelt for manuell pause (draw-engine har ikke separat state for
    // auto-pause utover paused-feltet vi nettopp nullstilte).
    if (this.drawEngine && capturedResumeType === "manual") {
      await this.drawEngine.resumeGame(input.gameId, input.actor.userId);
    }
    this.notifyStatusChange(result, "resume", input.actor.userId);
    // Task 1.1: emit `game1:resumed` slik at admin-UI og agent-portal kan
    // skjule Resume-knapp umiddelbart uten å vente på polling/fresh fetch.
    this.notifyResumed(
      result.gameId,
      input.actor.userId,
      capturedPhaseForEvent,
      capturedResumeType ?? "manual"
    );
    return result;
  }

  async stopGame(input: StopGameInput): Promise<MasterActionResult> {
    const reason = input.reason.trim();
    if (!reason) {
      throw new DomainError("INVALID_INPUT", "reason kreves ved stop.");
    }
    let priorStatus: string | null = null;
    const result = await this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);
      this.assertActorIsMaster(input.actor, game);

      const validStatuses = new Set([
        "purchase_open",
        "ready_to_start",
        "running",
        "paused",
      ]);
      if (!validStatuses.has(game.status)) {
        throw new DomainError(
          "GAME_NOT_STOPPABLE",
          `Kan ikke stoppe spill i status '${game.status}'.`
        );
      }

      const { rows: updated } = await client.query<ScheduledGameRow>(
        `UPDATE ${this.scheduledGamesTable()}
            SET status              = 'cancelled',
                stopped_by_user_id  = $2,
                stop_reason         = $3,
                actual_end_time     = now(),
                updated_at          = now()
          WHERE id = $1
          RETURNING id, status, master_hall_id, group_hall_id,
                    participating_halls_json, actual_start_time, actual_end_time`,
        [input.gameId, input.actor.userId, reason]
      );
      const row = updated[0];
      if (!row) {
        throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke lenger.");
      }

      const readyRows = await this.loadReadySnapshot(client, input.gameId);
      const auditId = await this.writeAudit(client, {
        gameId: input.gameId,
        action: "stop",
        actor: input.actor,
        groupHallId: game.group_hall_id,
        snapshot: this.snapshotReadyRows(readyRows),
        metadata: { reason, priorStatus: game.status },
      });

      log.info(
        { gameId: input.gameId, actorId: input.actor.userId, auditId, reason },
        "master.stop"
      );

      priorStatus = game.status;

      return {
        gameId: row.id,
        status: row.status,
        actualStartTime: toIso(row.actual_start_time),
        actualEndTime: toIso(row.actual_end_time),
        auditId,
      };
    });

    // GAME1_SCHEDULE PR 4b: delegér til draw-engine POST-commit hvis engine
    // har blitt startet for dette spillet (pre-running-stop har ingen engine-
    // state, men engine.stopGame er idempotent ved fravær av state).
    if (
      this.drawEngine &&
      (priorStatus === "running" || priorStatus === "paused")
    ) {
      await this.drawEngine.stopGame(input.gameId, reason, input.actor.userId);
    } else if (this.drawEngine) {
      // PR-C1b: cancel-before-start (priorStatus ∈ {purchase_open,
      // ready_to_start}) kjører IKKE engine.stopGame, men et BingoEngine-
      // rom kan allerede være opprettet av `game1:join-scheduled`
      // (purchase_open er joinable). Rydd det eksplisitt POST-commit.
      // Fail-closed — se destroyRoomForScheduledGameSafe.
      await this.drawEngine.destroyRoomForScheduledGameSafe(
        input.gameId,
        "cancellation"
      );
    }

    // PR 4d.4: automatisk refund av alle purchases POST-commit. Feilet
    // refund per rad isoleres (regulatorisk fail-closed per rad, ikke
    // per batch). Sammendrag returneres til caller og loggres; MasterUI
    // viser partial failure slik at operations kan følge opp manuelt.
    if (this.ticketPurchaseService) {
      const refundSummary = await this.ticketPurchaseService.refundAllForGame({
        scheduledGameId: input.gameId,
        reason: `master_stop: ${reason}`,
        refundedByUserId: input.actor.userId,
        refundedByActorType:
          input.actor.role === "ADMIN" ? "ADMIN" : "HALL_OPERATOR",
      });
      if (refundSummary.failed.length > 0) {
        log.warn(
          {
            gameId: input.gameId,
            failedCount: refundSummary.failed.length,
            succeededCount: refundSummary.succeeded.length,
          },
          "[PR 4d.4] master.stop — partial refund failure, krever manuell oppfølging"
        );
      }
      (result as MasterActionResult).refundSummary = refundSummary;
    }

    this.notifyStatusChange(result, "stop", input.actor.userId);
    return result;
  }

  /**
   * Skriv timeout_detected-audit (system-generert). Idempotent for en gitt
   * game-stateovergang.
   */
  async recordTimeoutDetected(
    input: TimeoutDetectedInput
  ): Promise<{ auditId: string | null }> {
    return this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);

      const { rows: existing } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM ${this.masterAuditTable()}
           WHERE game_id = $1
             AND action  = 'timeout_detected'
             AND created_at >= (SELECT updated_at - INTERVAL '1 minute'
                                  FROM ${this.scheduledGamesTable()}
                                 WHERE id = $1)`,
        [input.gameId]
      );
      const count = Number(existing[0]?.count ?? "0");
      if (count > 0) {
        return { auditId: null };
      }

      const readyRows = await this.loadReadySnapshot(client, input.gameId);
      const auditId = await this.writeAudit(client, {
        gameId: input.gameId,
        action: "timeout_detected",
        actor: {
          userId: "SYSTEM",
          hallId: game.master_hall_id,
          role: "ADMIN",
        },
        groupHallId: game.group_hall_id,
        snapshot: this.snapshotReadyRows(readyRows),
        metadata: {
          detectedAt: new Date().toISOString(),
          priorStatus: game.status,
        },
      });

      log.info({ gameId: input.gameId, auditId }, "master.timeout_detected");
      return { auditId };
    });
  }

  async getGameDetail(gameId: string): Promise<{
    game: {
      id: string;
      status: string;
      scheduledStartTime: string | null;
      scheduledEndTime: string | null;
      actualStartTime: string | null;
      actualEndTime: string | null;
      masterHallId: string;
      groupHallId: string;
      participatingHallIds: string[];
      subGameName: string;
      customGameName: string | null;
      startedByUserId: string | null;
      stoppedByUserId: string | null;
      stopReason: string | null;
    };
    halls: Array<{
      hallId: string;
      isReady: boolean;
      readyAt: string | null;
      readyByUserId: string | null;
      digitalTicketsSold: number;
      physicalTicketsSold: number;
      excludedFromGame: boolean;
      excludedReason: string | null;
    }>;
    auditRecent: Array<{
      id: string;
      action: MasterAuditAction;
      actorUserId: string;
      actorHallId: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;
  }> {
    const { rows: gameRows } = await this.pool.query<{
      id: string;
      status: string;
      scheduled_start_time: Date | string;
      scheduled_end_time: Date | string;
      actual_start_time: Date | string | null;
      actual_end_time: Date | string | null;
      master_hall_id: string;
      group_hall_id: string;
      participating_halls_json: unknown;
      sub_game_name: string;
      custom_game_name: string | null;
      started_by_user_id: string | null;
      stopped_by_user_id: string | null;
      stop_reason: string | null;
    }>(
      `SELECT id, status, scheduled_start_time, scheduled_end_time,
              actual_start_time, actual_end_time, master_hall_id,
              group_hall_id, participating_halls_json, sub_game_name,
              custom_game_name, started_by_user_id, stopped_by_user_id,
              stop_reason
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1`,
      [gameId]
    );
    const g = gameRows[0];
    if (!g) {
      throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
    }

    const participating = parseHallIdsArray(g.participating_halls_json);
    const allHalls = new Set<string>(participating);
    allHalls.add(g.master_hall_id);

    const { rows: readyRows } = await this.pool.query<{
      hall_id: string;
      is_ready: boolean;
      ready_at: Date | string | null;
      ready_by_user_id: string | null;
      digital_tickets_sold: number;
      physical_tickets_sold: number;
      excluded_from_game: boolean;
      excluded_reason: string | null;
    }>(
      `SELECT hall_id, is_ready, ready_at, ready_by_user_id,
              digital_tickets_sold, physical_tickets_sold,
              excluded_from_game, excluded_reason
         FROM ${this.hallReadyTable()}
         WHERE game_id = $1`,
      [gameId]
    );
    const readyByHall = new Map<string, (typeof readyRows)[number]>();
    for (const r of readyRows) readyByHall.set(r.hall_id, r);

    const halls = Array.from(allHalls).map((hallId) => {
      const r = readyByHall.get(hallId);
      return {
        hallId,
        isReady: Boolean(r?.is_ready ?? false),
        readyAt: r?.ready_at != null ? toIso(r.ready_at) : null,
        readyByUserId: r?.ready_by_user_id ?? null,
        digitalTicketsSold: Number(r?.digital_tickets_sold ?? 0),
        physicalTicketsSold: Number(r?.physical_tickets_sold ?? 0),
        excludedFromGame: Boolean(r?.excluded_from_game ?? false),
        excludedReason: r?.excluded_reason ?? null,
      };
    });

    const { rows: auditRows } = await this.pool.query<{
      id: string;
      action: string;
      actor_user_id: string;
      actor_hall_id: string;
      metadata_json: unknown;
      created_at: Date | string;
    }>(
      `SELECT id, action, actor_user_id, actor_hall_id, metadata_json, created_at
         FROM ${this.masterAuditTable()}
         WHERE game_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
      [gameId]
    );

    return {
      game: {
        id: g.id,
        status: g.status,
        scheduledStartTime: toIso(g.scheduled_start_time),
        scheduledEndTime: toIso(g.scheduled_end_time),
        actualStartTime: toIso(g.actual_start_time),
        actualEndTime: toIso(g.actual_end_time),
        masterHallId: g.master_hall_id,
        groupHallId: g.group_hall_id,
        participatingHallIds: Array.from(allHalls),
        subGameName: g.sub_game_name,
        customGameName: g.custom_game_name,
        startedByUserId: g.started_by_user_id,
        stoppedByUserId: g.stopped_by_user_id,
        stopReason: g.stop_reason,
      },
      halls,
      auditRecent: auditRows.map((a) => ({
        id: a.id,
        action: a.action as MasterAuditAction,
        actorUserId: a.actor_user_id,
        actorHallId: a.actor_hall_id,
        metadata: (a.metadata_json as Record<string, unknown>) ?? {},
        createdAt: toIso(a.created_at) ?? "",
      })),
    };
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private assertActorIsMaster(actor: MasterActor, game: ScheduledGameRow): void {
    if (actor.role === "ADMIN") return;
    if (actor.role === "SUPPORT") {
      throw new DomainError(
        "FORBIDDEN",
        "SUPPORT-rollen har ikke tilgang til master-actions."
      );
    }
    if (actor.hallId !== game.master_hall_id) {
      throw new DomainError(
        "FORBIDDEN",
        `Kun master-hallens operatør kan utføre denne handlingen (krever hall ${game.master_hall_id}).`
      );
    }
  }

  private async runInTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // swallow rollback error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async loadGameForUpdate(
    client: PoolClient,
    gameId: string
  ): Promise<ScheduledGameRow> {
    const { rows } = await client.query<ScheduledGameRow>(
      `SELECT id, status, master_hall_id, group_hall_id,
              participating_halls_json, actual_start_time, actual_end_time
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1
         FOR UPDATE`,
      [gameId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
    }
    return row;
  }

  private async readGameStatus(
    client: PoolClient,
    gameId: string
  ): Promise<string> {
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM ${this.scheduledGamesTable()} WHERE id = $1`,
      [gameId]
    );
    return rows[0]?.status ?? "unknown";
  }

  private async loadReadySnapshot(
    client: PoolClient,
    gameId: string
  ): Promise<HallReadySnapshotRow[]> {
    const { rows } = await client.query<HallReadySnapshotRow>(
      `SELECT hall_id, is_ready, excluded_from_game
         FROM ${this.hallReadyTable()}
         WHERE game_id = $1`,
      [gameId]
    );
    return rows;
  }

  private snapshotReadyRows(
    rows: HallReadySnapshotRow[]
  ): Record<string, { isReady: boolean; excluded: boolean }> {
    const snapshot: Record<string, { isReady: boolean; excluded: boolean }> = {};
    for (const r of rows) {
      snapshot[r.hall_id] = {
        isReady: Boolean(r.is_ready),
        excluded: Boolean(r.excluded_from_game),
      };
    }
    return snapshot;
  }

  private async writeAudit(
    client: PoolClient,
    input: {
      gameId: string;
      action: MasterAuditAction;
      actor: MasterActor;
      groupHallId: string;
      snapshot: Record<string, { isReady: boolean; excluded: boolean }>;
      metadata: Record<string, unknown>;
    }
  ): Promise<string> {
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO ${this.masterAuditTable()}
         (id, game_id, action, actor_user_id, actor_hall_id, group_hall_id,
          halls_ready_snapshot, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        auditId,
        input.gameId,
        input.action,
        input.actor.userId,
        input.actor.hallId,
        input.groupHallId,
        JSON.stringify(input.snapshot),
        JSON.stringify(input.metadata),
      ]
    );
    return auditId;
  }
}
