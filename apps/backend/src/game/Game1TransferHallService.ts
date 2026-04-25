/**
 * Task 1.6: `transferHallAccess` runtime master-overføring for Spill 1.
 *
 * Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md Appendix B.3 +
 * B.10. Legacy-referanse: legacy/unity-backend/Game/AdminEvents/AdminController/
 * AdminController.js linje 253-522 (`checkTransferHallAccess`, `transferHallAccess`,
 * `approveTransferHallAccess`).
 *
 * Ansvar:
 *   1. requestTransfer({gameId, fromHallId, toHallId, initiatedByUserId})
 *      - Validér at fromHallId er nåværende master-hall
 *      - Validér at toHallId er i participating_halls_json og ikke ekskludert
 *      - Kanseller tidligere pending requests for dette gameId
 *      - INSERT ny request med valid_till = NOW() + 60s (TTL)
 *      - Skriv audit `transfer_request`
 *      - Returner request (broadcast gjøres av route-laget)
 *   2. approveTransfer({requestId, respondedByUserId, respondedByHallId})
 *      - Validér request pending + valid_till > NOW()
 *      - Validér respondedByHallId == to_hall_id
 *      - UPDATE app_game1_scheduled_games.master_hall_id = to_hall_id
 *      - UPDATE request → status='approved'
 *      - Skriv audit `transfer_approved`
 *   3. rejectTransfer({requestId, respondedByUserId, respondedByHallId, reason?})
 *      - Samme validering som approve (må være target-hall)
 *      - UPDATE request → status='rejected'
 *      - Skriv audit `transfer_rejected`
 *   4. expireStaleTasks()
 *      - Kjøres periodisk fra tick-service (default 5s-intervall)
 *      - UPDATE alle pending + valid_till < NOW() → status='expired'
 *      - Skriv audit `transfer_expired` per rad
 *      - Returnerer liste over expired requests (for broadcast)
 *   5. getActiveRequestForGame(gameId)
 *      - Returner én pending request (hvis noen) for polling/initial state
 *
 * Design:
 *   - Service er DB-only; socket-broadcast er route-lagets ansvar (matcher
 *     mønster i Game1MasterControlService).
 *   - Audit-type `transfer_request | transfer_approved | transfer_rejected |
 *     transfer_expired` — utvider app_game1_master_audit.action-whitelist.
 *   - `SYSTEM`-actor brukes for expired-audits (tick-service genererer dem).
 *   - Idempotens: dobbel approve → andre returnerer `ALREADY_APPROVED`.
 */

import type { Pool, PoolClient } from "pg";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-transfer-hall-service" });

/** TTL for transfer-requests. Produkt-krav: 60 sekunder. */
export const TRANSFER_REQUEST_TTL_SECONDS = 60;

export type TransferRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export const TRANSFER_REQUEST_STATUSES: readonly TransferRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "expired",
];

export interface TransferRequest {
  id: string;
  gameId: string;
  fromHallId: string;
  toHallId: string;
  initiatedByUserId: string;
  initiatedAt: string; // ISO
  validTill: string; // ISO
  status: TransferRequestStatus;
  respondedByUserId: string | null;
  respondedAt: string | null; // ISO
  rejectReason: string | null;
}

export interface RequestTransferInput {
  gameId: string;
  fromHallId: string;
  toHallId: string;
  initiatedByUserId: string;
}

export interface ApproveTransferInput {
  requestId: string;
  respondedByUserId: string;
  respondedByHallId: string;
}

export interface RejectTransferInput {
  requestId: string;
  respondedByUserId: string;
  respondedByHallId: string;
  reason?: string;
}

export interface Game1TransferHallServiceOptions {
  pool: Pool;
  schema?: string;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
}

interface TransferRequestRow {
  id: string;
  game_id: string;
  from_hall_id: string;
  to_hall_id: string;
  initiated_by_user_id: string;
  initiated_at: Date | string;
  valid_till: Date | string;
  status: TransferRequestStatus;
  responded_by_user_id: string | null;
  responded_at: Date | string | null;
  reject_reason: string | null;
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

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function mapRow(row: TransferRequestRow): TransferRequest {
  return {
    id: row.id,
    gameId: row.game_id,
    fromHallId: row.from_hall_id,
    toHallId: row.to_hall_id,
    initiatedByUserId: row.initiated_by_user_id,
    initiatedAt: toIso(row.initiated_at),
    validTill: toIso(row.valid_till),
    status: row.status,
    respondedByUserId: row.responded_by_user_id,
    respondedAt: toIsoOrNull(row.responded_at),
    rejectReason: row.reject_reason,
  };
}

export class Game1TransferHallService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: Game1TransferHallServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
  }

  /** @internal test helper. */
  static forTesting(pool: Pool, schema = "public"): Game1TransferHallService {
    return new Game1TransferHallService({ pool, schema });
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private hallReadyTable(): string {
    return `"${this.schema}"."app_game1_hall_ready_status"`;
  }

  private transferRequestsTable(): string {
    return `"${this.schema}"."app_game1_master_transfer_requests"`;
  }

  private masterAuditTable(): string {
    return `"${this.schema}"."app_game1_master_audit"`;
  }

  /**
   * Agent-initiert: be om master-overføring til `toHallId`.
   *
   * Validering:
   *   - game finnes og er ikke cancelled/completed
   *   - fromHallId == nåværende master_hall_id
   *   - toHallId ≠ fromHallId (kan ikke overføre til seg selv)
   *   - toHallId er i participating_halls_json
   *   - toHallId er ikke ekskludert fra spillet (excluded_from_game=false)
   *   - initiatedByUserId er angitt
   *
   * Én aktiv request per game: tidligere pending-requests for samme gameId
   * kanselleres (status='expired' + audit).
   */
  async requestTransfer(input: RequestTransferInput): Promise<TransferRequest> {
    return this.runInTransaction(async (client) => {
      const game = await this.loadGameForUpdate(client, input.gameId);

      if (game.status === "cancelled" || game.status === "completed") {
        throw new DomainError(
          "GAME_NOT_TRANSFERABLE",
          `Kan ikke overføre master i status '${game.status}'.`
        );
      }

      if (game.master_hall_id !== input.fromHallId) {
        throw new DomainError(
          "NOT_CURRENT_MASTER",
          `Kun nåværende master-hall kan initiere overføring (forventet ${game.master_hall_id}).`
        );
      }

      if (input.toHallId === input.fromHallId) {
        throw new DomainError(
          "TARGET_IS_CURRENT_MASTER",
          "Kan ikke overføre master-rollen til din egen hall."
        );
      }

      const participating = new Set<string>(
        parseHallIdsArray(game.participating_halls_json)
      );
      participating.add(game.master_hall_id);
      if (!participating.has(input.toHallId)) {
        throw new DomainError(
          "TARGET_HALL_NOT_PARTICIPATING",
          `Hallen ${input.toHallId} deltar ikke i dette spillet.`
        );
      }

      // Sjekk ekskludering.
      const { rows: excludedRows } = await client.query<{
        excluded_from_game: boolean;
      }>(
        `SELECT excluded_from_game
           FROM ${this.hallReadyTable()}
           WHERE game_id = $1 AND hall_id = $2`,
        [input.gameId, input.toHallId]
      );
      if (excludedRows[0]?.excluded_from_game === true) {
        throw new DomainError(
          "TARGET_HALL_EXCLUDED",
          `Hallen ${input.toHallId} er ekskludert fra spillet.`
        );
      }

      // Kanseller tidligere pending-requests for dette gameId. Vi bruker
      // status='expired' for å signalere "invalidated by newer request" —
      // alternativet er å legge til en egen 'cancelled'-status, men å
      // gjenbruke 'expired' holder CHECK-constraint enkel og match-er
      // semantikken "ikke lenger gyldig".
      const { rows: cancelled } = await client.query<TransferRequestRow>(
        `UPDATE ${this.transferRequestsTable()}
            SET status      = 'expired',
                responded_at = now(),
                updated_at   = now()
          WHERE game_id = $1 AND status = 'pending'
          RETURNING id, game_id, from_hall_id, to_hall_id,
                    initiated_by_user_id, initiated_at, valid_till, status,
                    responded_by_user_id, responded_at, reject_reason`,
        [input.gameId]
      );
      for (const row of cancelled) {
        await this.writeAudit(client, {
          gameId: input.gameId,
          action: "transfer_expired",
          actorUserId: "SYSTEM",
          actorHallId: row.from_hall_id,
          groupHallId: game.group_hall_id,
          metadata: {
            requestId: row.id,
            reason: "superseded_by_new_request",
            fromHallId: row.from_hall_id,
            toHallId: row.to_hall_id,
          },
        });
      }

      // INSERT ny request.
      const { rows: inserted } = await client.query<TransferRequestRow>(
        `INSERT INTO ${this.transferRequestsTable()}
           (game_id, from_hall_id, to_hall_id, initiated_by_user_id,
            valid_till, status)
         VALUES ($1, $2, $3, $4,
                 now() + ($5 || ' seconds')::interval,
                 'pending')
         RETURNING id, game_id, from_hall_id, to_hall_id,
                   initiated_by_user_id, initiated_at, valid_till, status,
                   responded_by_user_id, responded_at, reject_reason`,
        [
          input.gameId,
          input.fromHallId,
          input.toHallId,
          input.initiatedByUserId,
          String(TRANSFER_REQUEST_TTL_SECONDS),
        ]
      );
      const row = inserted[0];
      if (!row) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Kunne ikke opprette transfer-request."
        );
      }

      await this.writeAudit(client, {
        gameId: input.gameId,
        action: "transfer_request",
        actorUserId: input.initiatedByUserId,
        actorHallId: input.fromHallId,
        groupHallId: game.group_hall_id,
        metadata: {
          requestId: row.id,
          fromHallId: input.fromHallId,
          toHallId: input.toHallId,
          validTill: toIso(row.valid_till),
        },
      });

      log.info(
        {
          gameId: input.gameId,
          requestId: row.id,
          fromHallId: input.fromHallId,
          toHallId: input.toHallId,
        },
        "transfer.request"
      );

      return mapRow(row);
    });
  }

  /**
   * Target-hall aksepterer master-overføringen.
   *
   * Validering:
   *   - request finnes og er pending
   *   - valid_till > NOW() (ikke utløpt)
   *   - respondedByHallId == to_hall_id
   *
   * Effekt: UPDATE master_hall_id på scheduled_game, UPDATE status='approved',
   * skriv audit `transfer_approved`. Broadcast-ansvar ligger i route-laget.
   */
  async approveTransfer(
    input: ApproveTransferInput
  ): Promise<{
    request: TransferRequest;
    previousMasterHallId: string;
    newMasterHallId: string;
  }> {
    return this.runInTransaction(async (client) => {
      const request = await this.loadRequestForUpdate(client, input.requestId);

      if (request.status === "approved") {
        throw new DomainError(
          "ALREADY_APPROVED",
          "Overføringen er allerede godkjent."
        );
      }
      if (request.status === "rejected") {
        throw new DomainError(
          "ALREADY_REJECTED",
          "Overføringen er allerede avvist."
        );
      }
      if (request.status === "expired") {
        throw new DomainError(
          "TRANSFER_EXPIRED",
          "Overføringen er utløpt."
        );
      }
      // status === 'pending'
      const validTillMs = new Date(request.valid_till).getTime();
      if (validTillMs < Date.now()) {
        // Race: TTL ble passert mellom load og handling. Behandle som utløpt.
        throw new DomainError(
          "TRANSFER_EXPIRED",
          "Overføringen er utløpt."
        );
      }

      if (input.respondedByHallId !== request.to_hall_id) {
        throw new DomainError(
          "UNAUTHORIZED",
          "Kun target-hallen kan godta overføringen."
        );
      }

      // Last spillet for å få previous master + group for audit.
      const game = await this.loadGameForUpdate(client, request.game_id);

      // UPDATE master_hall_id.
      await client.query(
        `UPDATE ${this.scheduledGamesTable()}
            SET master_hall_id = $2,
                updated_at     = now()
          WHERE id = $1`,
        [request.game_id, request.to_hall_id]
      );

      // UPDATE request → approved.
      const { rows: updated } = await client.query<TransferRequestRow>(
        `UPDATE ${this.transferRequestsTable()}
            SET status                = 'approved',
                responded_by_user_id  = $2,
                responded_at          = now(),
                updated_at            = now()
          WHERE id = $1
          RETURNING id, game_id, from_hall_id, to_hall_id,
                    initiated_by_user_id, initiated_at, valid_till, status,
                    responded_by_user_id, responded_at, reject_reason`,
        [input.requestId, input.respondedByUserId]
      );
      const row = updated[0];
      if (!row) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Kunne ikke oppdatere transfer-request."
        );
      }

      await this.writeAudit(client, {
        gameId: request.game_id,
        action: "transfer_approved",
        actorUserId: input.respondedByUserId,
        actorHallId: request.to_hall_id,
        groupHallId: game.group_hall_id,
        metadata: {
          requestId: row.id,
          previousMasterHallId: game.master_hall_id,
          newMasterHallId: request.to_hall_id,
          initiatedByUserId: request.initiated_by_user_id,
        },
      });

      log.info(
        {
          gameId: request.game_id,
          requestId: row.id,
          previousMasterHallId: game.master_hall_id,
          newMasterHallId: request.to_hall_id,
        },
        "transfer.approved"
      );

      return {
        request: mapRow(row),
        previousMasterHallId: game.master_hall_id,
        newMasterHallId: request.to_hall_id,
      };
    });
  }

  /** Target-hall avviser overføringen eksplisitt. */
  async rejectTransfer(input: RejectTransferInput): Promise<TransferRequest> {
    return this.runInTransaction(async (client) => {
      const request = await this.loadRequestForUpdate(client, input.requestId);

      if (request.status === "approved") {
        throw new DomainError(
          "ALREADY_APPROVED",
          "Overføringen er allerede godkjent."
        );
      }
      if (request.status === "rejected") {
        throw new DomainError(
          "ALREADY_REJECTED",
          "Overføringen er allerede avvist."
        );
      }
      if (request.status === "expired") {
        throw new DomainError(
          "TRANSFER_EXPIRED",
          "Overføringen er utløpt."
        );
      }

      const validTillMs = new Date(request.valid_till).getTime();
      if (validTillMs < Date.now()) {
        throw new DomainError(
          "TRANSFER_EXPIRED",
          "Overføringen er utløpt."
        );
      }

      if (input.respondedByHallId !== request.to_hall_id) {
        throw new DomainError(
          "UNAUTHORIZED",
          "Kun target-hallen kan avvise overføringen."
        );
      }

      const reason = input.reason?.trim() ?? null;
      const { rows: updated } = await client.query<TransferRequestRow>(
        `UPDATE ${this.transferRequestsTable()}
            SET status                = 'rejected',
                responded_by_user_id  = $2,
                responded_at          = now(),
                reject_reason         = $3,
                updated_at            = now()
          WHERE id = $1
          RETURNING id, game_id, from_hall_id, to_hall_id,
                    initiated_by_user_id, initiated_at, valid_till, status,
                    responded_by_user_id, responded_at, reject_reason`,
        [input.requestId, input.respondedByUserId, reason]
      );
      const row = updated[0];
      if (!row) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Kunne ikke oppdatere transfer-request."
        );
      }

      const game = await this.loadGameForUpdate(client, request.game_id);
      await this.writeAudit(client, {
        gameId: request.game_id,
        action: "transfer_rejected",
        actorUserId: input.respondedByUserId,
        actorHallId: request.to_hall_id,
        groupHallId: game.group_hall_id,
        metadata: {
          requestId: row.id,
          fromHallId: row.from_hall_id,
          toHallId: row.to_hall_id,
          reason,
        },
      });

      log.info(
        {
          gameId: request.game_id,
          requestId: row.id,
          reason,
        },
        "transfer.rejected"
      );

      return mapRow(row);
    });
  }

  /**
   * Periodisk expiry-tick. Kjøres fra Game1TransferExpiryTickService (default
   * 5s-intervall). Returnerer liste over nylig-utløpte requests for
   * broadcast. Idempotent: re-run innen samme tick finner ingen nye.
   */
  async expireStaleTasks(): Promise<TransferRequest[]> {
    return this.runInTransaction(async (client) => {
      const { rows: expired } = await client.query<TransferRequestRow>(
        `UPDATE ${this.transferRequestsTable()}
            SET status       = 'expired',
                responded_at = now(),
                updated_at   = now()
          WHERE status = 'pending' AND valid_till < now()
          RETURNING id, game_id, from_hall_id, to_hall_id,
                    initiated_by_user_id, initiated_at, valid_till, status,
                    responded_by_user_id, responded_at, reject_reason`
      );
      if (expired.length === 0) {
        return [];
      }

      for (const row of expired) {
        // Hent group_hall_id for audit. Vi gjør én query per game for å
        // matche audit-schemaet (group_hall_id NOT NULL). Cache per
        // gameId innenfor denne tick-en.
        const game = await this.loadGameSoft(client, row.game_id);
        await this.writeAudit(client, {
          gameId: row.game_id,
          action: "transfer_expired",
          actorUserId: "SYSTEM",
          actorHallId: row.from_hall_id,
          groupHallId: game?.group_hall_id ?? row.from_hall_id,
          metadata: {
            requestId: row.id,
            fromHallId: row.from_hall_id,
            toHallId: row.to_hall_id,
            reason: "ttl_exceeded",
          },
        });
        log.info(
          { gameId: row.game_id, requestId: row.id },
          "transfer.expired"
        );
      }

      return expired.map(mapRow);
    });
  }

  /** Hent aktiv pending request for et spill (for polling / initial-state). */
  async getActiveRequestForGame(
    gameId: string
  ): Promise<TransferRequest | null> {
    const { rows } = await this.pool.query<TransferRequestRow>(
      `SELECT id, game_id, from_hall_id, to_hall_id,
              initiated_by_user_id, initiated_at, valid_till, status,
              responded_by_user_id, responded_at, reject_reason
         FROM ${this.transferRequestsTable()}
         WHERE game_id = $1 AND status = 'pending'
         ORDER BY initiated_at DESC
         LIMIT 1`,
      [gameId]
    );
    const row = rows[0];
    if (!row) return null;
    // Sikkerhets-sjekk: hvis vi leser en pending med utløpt valid_till
    // (expiry-tick har ikke kjørt ennå), behandle den som ikke-aktiv.
    if (new Date(row.valid_till).getTime() < Date.now()) {
      return null;
    }
    return mapRow(row);
  }

  /** Hent en enkelt request etter id (for broadcast-logikk). */
  async getRequestById(requestId: string): Promise<TransferRequest | null> {
    const { rows } = await this.pool.query<TransferRequestRow>(
      `SELECT id, game_id, from_hall_id, to_hall_id,
              initiated_by_user_id, initiated_at, valid_till, status,
              responded_by_user_id, responded_at, reject_reason
         FROM ${this.transferRequestsTable()}
         WHERE id = $1`,
      [requestId]
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

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
              participating_halls_json
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

  private async loadGameSoft(
    client: PoolClient,
    gameId: string
  ): Promise<ScheduledGameRow | null> {
    const { rows } = await client.query<ScheduledGameRow>(
      `SELECT id, status, master_hall_id, group_hall_id,
              participating_halls_json
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1`,
      [gameId]
    );
    return rows[0] ?? null;
  }

  private async loadRequestForUpdate(
    client: PoolClient,
    requestId: string
  ): Promise<TransferRequestRow> {
    const { rows } = await client.query<TransferRequestRow>(
      `SELECT id, game_id, from_hall_id, to_hall_id,
              initiated_by_user_id, initiated_at, valid_till, status,
              responded_by_user_id, responded_at, reject_reason
         FROM ${this.transferRequestsTable()}
         WHERE id = $1
         FOR UPDATE`,
      [requestId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "TRANSFER_REQUEST_NOT_FOUND",
        "Transfer-request finnes ikke."
      );
    }
    return row;
  }

  /**
   * Skriv audit via samme mønster som Game1MasterControlService, men med
   * en mindre snapshot (vi har ikke ready-rows-sammenheng her). Vi lar
   * `halls_ready_snapshot` være `{}` — Task 1.6 sin audit er primært
   * metadata-drevet (requestId, hallIds, reason).
   */
  private async writeAudit(
    client: PoolClient,
    input: {
      gameId: string;
      action:
        | "transfer_request"
        | "transfer_approved"
        | "transfer_rejected"
        | "transfer_expired";
      actorUserId: string;
      actorHallId: string;
      groupHallId: string;
      metadata: Record<string, unknown>;
    }
  ): Promise<string> {
    // randomUUID via node:crypto — Game1MasterControlService bruker samme.
    const { randomUUID } = await import("node:crypto");
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
        input.actorUserId,
        input.actorHallId,
        input.groupHallId,
        JSON.stringify({}),
        JSON.stringify(input.metadata),
      ]
    );
    return auditId;
  }
}
