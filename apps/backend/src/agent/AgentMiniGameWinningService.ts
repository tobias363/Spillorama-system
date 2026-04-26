/**
 * REQ-146 (PDF 17 §17.23 / BIR-294-298): agent-input for mini-game winnings.
 *
 * Spec:
 *   docs/architecture/WIREFRAME_CATALOG.md § "17.23 View Sub Game Details"
 *   docs/architecture/WIREFRAME_BACKEND_REQUIREMENTS_2026-04-25.md REQ-146
 *
 * Use-case:
 *   Når Spill 1 spiller en mini-game (Wheel of Fortune, Treasure Chest,
 *   Mystery, ColorDraft) og en spiller vinner — særlig for unique-ID-
 *   spillere uten klient-flow, eller walk-in-spillere — skal bingovert
 *   kunne legge inn vinst-tall manuelt på vegne av spilleren.
 *
 *   Wireframe 17.23 viser tabell-kolonnene:
 *     Spin Wheel Winnings (input), Treasure Chest Winnings (input),
 *     Mystery Winnings (input), ColorDraft Winnings (input)
 *   Disse er agent-redigerbare for vinnere.
 *
 * Skiller seg fra `Game1MiniGameOrchestrator.handleChoice`:
 *   - Orchestrator-flyten er server-autoritativ for online-spillere
 *     (spilleren trykker spin → server beregner resultat).
 *   - Denne servicen er den AGENT-MANUELLE inngangen for spillere uten
 *     klient-flyt (walk-ins / unique-ID i hallen).
 *
 * Compliance-gate (KRITISK):
 *   1. AGENT/HALL_OPERATOR/ADMIN-rolle (caller-laget verifiserer).
 *   2. Hall-scope: agent kan kun registrere for sin shift-hall (caller-
 *      laget verifiserer; servicen sjekker IKKE rolle/hall-token).
 *   3. Spilleren MÅ ha vært i runden (assignment-rad i
 *      `app_game1_ticket_assignments` for samme scheduledGameId), ELLER
 *      være registrert som physical-ticket-vinner. Hvis ingen → AGENT_
 *      MINIGAME_NOT_IN_ROUND.
 *   4. Mini-gamen må være aktivert i runden (config_json.spill1.miniGames
 *      inneholder typen). Hvis ikke → AGENT_MINIGAME_NOT_ACTIVE.
 *   5. Spilleren kan ikke ha allerede en mini-game-result-rad for denne
 *     (game, type) som er completed_at != NULL → AGENT_MINIGAME_ALREADY_
 *     PAID. Idempotent re-call returnerer eksisterende rad.
 *
 * Payout-mønster:
 *   Bruker samme wallet.credit-mønster som Game1MiniGameOrchestrator
 *   (creditPayout) og Game1PayoutService.payoutPhase: `to: "winnings"` +
 *   idempotency-key bundet til mini_game_results-raden. Game-engine er
 *   eneste lovlige kilde til `to: "winnings"` per pengespillforskriften
 *   §11; agent-route er innenfor game-engine-konteksten siden den
 *   stammer fra mini-game som spilleren faktisk vant.
 *
 * Compliance-ledger:
 *   Soft-fail PRIZE-entry til ComplianceLedgerPort (samme mønster som
 *   Game1PayoutService). En compliance-feil ruller IKKE tilbake payout.
 *
 * Audit-log:
 *   Caller (route-laget) skriver "agent.minigame_winning.recorded".
 *   Servicen logger med pino men eier ikke audit-laget.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import {
  NoopComplianceLedgerPort,
  type ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import { DomainError } from "../game/BingoEngine.js";
import { IdempotencyKeys } from "../game/idempotency.js";
import {
  MINI_GAME_TYPES,
  type MiniGameType,
} from "../game/minigames/types.js";
import { extractActiveMiniGameTypes } from "../game/minigames/Game1MiniGameOrchestrator.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-mini-game-winning-service" });

export interface AgentMiniGameWinningInput {
  /** scheduled_game_id (Spill 1-runde mini-gamen var del av). */
  gameId: string;
  /** Spilleren som vant. Må ha assignment + være eligible (compliance-gate). */
  playerId: string;
  /** Type mini-game agenten registrerer winning for. */
  miniGameType: MiniGameType | string;
  /** Vinnerbeløp i øre (kroner * 100). Må være > 0. */
  amountCents: number;
  /** Fri-form audit-tekst — typisk "walk-in winner" / "unique-ID 13343". */
  reason: string;
  /** Bruker-ID på agent som registrerer (audit + recorded_by). */
  agentUserId: string;
  /**
   * Hall-ID agent legger inn fra. Brukes for compliance-ledger PRIZE-entry
   * (skal være vinnerens hall, ikke master-hall). Caller-laget skal
   * resolve denne til agent.shift.hallId før kall.
   */
  hallId: string;
}

export interface AgentMiniGameWinningResult {
  /** UUID på mini-game-result-raden (matcher app_game1_mini_game_results.id). */
  resultId: string;
  /** True hvis raden ble opprettet i dette kallet, false hvis idempotent re-call. */
  created: boolean;
  /** True hvis kallet matchet eksisterende completed-rad — ingen ny payout. */
  idempotent: boolean;
  miniGameType: MiniGameType;
  payoutCents: number;
  walletTransactionId: string | null;
}

export interface AgentMiniGameWinningServiceOptions {
  pool: Pool;
  schema?: string;
  walletAdapter: WalletAdapter;
  /** ComplianceLedgerPort for PRIZE-entries. Default no-op. */
  complianceLedgerPort?: ComplianceLedgerPort;
  /** Standard channel for PRIZE-entries — agent-input er HALL-kanal. */
  defaultLedgerChannel?: "HALL" | "INTERNET";
}

interface MiniGameRow {
  id: string;
  scheduled_game_id: string;
  mini_game_type: string;
  winner_user_id: string;
  config_snapshot_json: Record<string, unknown> | null;
  choice_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  payout_cents: number;
  triggered_at: Date | string;
  completed_at: Date | string | null;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  return value.trim();
}

function assertPositiveInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et positivt heltall.`,
    );
  }
  return n;
}

function isMiniGameType(value: unknown): value is MiniGameType {
  return (
    typeof value === "string"
    && (MINI_GAME_TYPES as readonly string[]).includes(value)
  );
}

function centsToKroner(cents: number): number {
  return cents / 100;
}

export class AgentMiniGameWinningService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly walletAdapter: WalletAdapter;
  private readonly complianceLedgerPort: ComplianceLedgerPort;
  private readonly defaultLedgerChannel: "HALL" | "INTERNET";

  constructor(options: AgentMiniGameWinningServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.walletAdapter = options.walletAdapter;
    this.complianceLedgerPort =
      options.complianceLedgerPort ?? new NoopComplianceLedgerPort();
    this.defaultLedgerChannel = options.defaultLedgerChannel ?? "HALL";
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    walletAdapter: WalletAdapter,
    schema = "public",
    complianceLedgerPort?: ComplianceLedgerPort,
  ): AgentMiniGameWinningService {
    const opts: AgentMiniGameWinningServiceOptions = {
      pool,
      schema,
      walletAdapter,
    };
    if (complianceLedgerPort) {
      opts.complianceLedgerPort = complianceLedgerPort;
    }
    return new AgentMiniGameWinningService(opts);
  }

  private resultsTable(): string {
    return `"${this.schema}"."app_game1_mini_game_results"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private assignmentsTable(): string {
    return `"${this.schema}"."app_game1_ticket_assignments"`;
  }

  private usersTable(): string {
    return `"${this.schema}"."app_users"`;
  }

  /**
   * Registrer en mini-game-vinning manuelt på vegne av spilleren.
   *
   * Returnerer existierende rad ved idempotent re-call (matchet
   * (gameId, playerId, miniGameType, amountCents)).
   */
  async recordMiniGameWinning(
    input: AgentMiniGameWinningInput,
  ): Promise<AgentMiniGameWinningResult> {
    const gameId = assertNonEmpty(input.gameId, "gameId");
    const playerId = assertNonEmpty(input.playerId, "playerId");
    const reason = assertNonEmpty(input.reason, "reason");
    const agentUserId = assertNonEmpty(input.agentUserId, "agentUserId");
    const hallId = assertNonEmpty(input.hallId, "hallId");
    const amountCents = assertPositiveInt(input.amountCents, "amountCents");
    const typeInput = assertNonEmpty(input.miniGameType, "miniGameType");
    if (!isMiniGameType(typeInput)) {
      throw new DomainError(
        "INVALID_MINIGAME_TYPE",
        `Ugyldig miniGameType '${typeInput}'. Gyldig: ${MINI_GAME_TYPES.join(", ")}.`,
      );
    }
    const miniGameType = typeInput;

    // ── Compliance-gate steps ──────────────────────────────────────────
    // Vi gjør alle pre-checks i en transaksjon med FOR UPDATE-lock på
    // mini-game-result-raden hvis den finnes.

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Step 1: hent + valider scheduled_game finnes + plukk gameConfigJson.
      const { rows: gameRows } = await client.query<{
        id: string;
        status: string;
        game_config_json: Record<string, unknown> | null;
      }>(
        `SELECT id, status, game_config_json
           FROM ${this.scheduledGamesTable()}
          WHERE id = $1
          FOR UPDATE`,
        [gameId],
      );
      if (gameRows.length === 0) {
        throw new DomainError(
          "GAME_NOT_FOUND",
          `Spillet '${gameId}' finnes ikke.`,
        );
      }
      const game = gameRows[0]!;

      // Step 2: mini-gamen må være aktivert i runden (compliance-gate).
      const activeTypes = extractActiveMiniGameTypes(game.game_config_json);
      if (!activeTypes.includes(miniGameType)) {
        throw new DomainError(
          "AGENT_MINIGAME_NOT_ACTIVE",
          `Mini-gamen '${miniGameType}' er ikke aktivert for runden '${gameId}'.`,
        );
      }

      // Step 3: spilleren MÅ ha vært i runden (compliance-gate).
      const wasInRound = await this.playerWasInRound(client, gameId, playerId);
      if (!wasInRound) {
        throw new DomainError(
          "AGENT_MINIGAME_NOT_IN_ROUND",
          `Spilleren '${playerId}' var ikke registrert i runden '${gameId}'.`,
        );
      }

      // Step 4: hent walletId for spilleren — påkrevd for credit.
      const { rows: userRows } = await client.query<{ wallet_id: string | null }>(
        `SELECT wallet_id FROM ${this.usersTable()} WHERE id = $1 LIMIT 1`,
        [playerId],
      );
      if (userRows.length === 0) {
        throw new DomainError(
          "PLAYER_NOT_FOUND",
          `Spilleren '${playerId}' finnes ikke.`,
        );
      }
      const walletId = userRows[0]!.wallet_id;
      if (!walletId) {
        throw new DomainError(
          "PLAYER_HAS_NO_WALLET",
          `Spilleren '${playerId}' har ingen wallet — kan ikke utbetale.`,
        );
      }

      // Step 5: idempotens — er det allerede en mini-game-result-rad for
      // (gameId, playerId)? UNIQUE-constraint = (scheduled_game_id, winner_
      // user_id), så kun én rad per spiller per spill — uavhengig av type.
      // Hvis raden finnes:
      //   - completed_at = NULL: orchestrator har trigget men ikke fullført.
      //     Agenten overstyrer manuelt → vi UPDATE-er + utbetaler.
      //   - completed_at != NULL og samme type/amount: idempotent ack.
      //   - completed_at != NULL men annen type/amount: AGENT_MINIGAME_
      //     ALREADY_PAID (defensivt).
      const { rows: existingRows } = await client.query<MiniGameRow>(
        `SELECT id, scheduled_game_id, mini_game_type, winner_user_id,
                config_snapshot_json, choice_json, result_json, payout_cents,
                triggered_at, completed_at
           FROM ${this.resultsTable()}
          WHERE scheduled_game_id = $1 AND winner_user_id = $2
          FOR UPDATE`,
        [gameId, playerId],
      );
      const existing = existingRows[0] ?? null;

      if (
        existing
        && existing.completed_at != null
        && existing.mini_game_type === miniGameType
        && Number(existing.payout_cents) === amountCents
      ) {
        // Idempotent re-call: samme type + samme beløp → no-op.
        await client.query("COMMIT");
        return {
          resultId: existing.id,
          created: false,
          idempotent: true,
          miniGameType,
          payoutCents: Number(existing.payout_cents),
          walletTransactionId: this.extractTxIdFromResultJson(existing.result_json),
        };
      }

      if (
        existing
        && existing.completed_at != null
        && (
          existing.mini_game_type !== miniGameType
          || Number(existing.payout_cents) !== amountCents
        )
      ) {
        throw new DomainError(
          "AGENT_MINIGAME_ALREADY_PAID",
          `Spiller '${playerId}' har allerede mottatt mini-game-vinning '${existing.mini_game_type}' (${existing.payout_cents} øre) for runde '${gameId}' — kan ikke overskrive.`,
        );
      }

      // Step 6: utfør wallet-credit. `to: "winnings"` siden dette er
      // mini-game-premie (gevinst fra spill, ikke innskudd). Idempotency-
      // key bundet til mini-game-result-raden; gjenbruk samme nøkkel ved
      // retry slik at wallet-laget kan dedupe.
      const resultId = existing?.id ?? `mgr-${randomUUID()}`;
      let walletTxId: string | null = null;
      try {
        const tx = await this.walletAdapter.credit(
          walletId,
          centsToKroner(amountCents),
          `Spill 1 mini-game ${miniGameType} (agent-input) — ${reason}`,
          {
            idempotencyKey: IdempotencyKeys.game1MiniGame({ resultId }),
            to: "winnings",
          },
        );
        walletTxId = tx.id;
      } catch (err) {
        if (err instanceof WalletError) {
          throw new DomainError(
            "AGENT_MINIGAME_WALLET_CREDIT_FAILED",
            `Wallet-credit feilet for spiller ${playerId}: ${err.message} (code=${err.code})`,
          );
        }
        throw new DomainError(
          "AGENT_MINIGAME_WALLET_CREDIT_FAILED",
          `Wallet-credit feilet for spiller ${playerId}: ${(err as Error).message ?? "ukjent"}`,
        );
      }

      // Step 7: persistér / oppdater mini-game-result-raden.
      const resultJson: Record<string, unknown> = {
        source: "AGENT_MANUAL_INPUT",
        reason,
        recordedByAgentId: agentUserId,
        recordedFromHallId: hallId,
        recordedAt: new Date().toISOString(),
        walletTransactionId: walletTxId,
      };
      const choiceJson: Record<string, unknown> = {
        source: "AGENT_MANUAL_INPUT",
      };
      const configSnapshot: Record<string, unknown> = {
        source: "AGENT_MANUAL_INPUT_NO_SNAPSHOT",
      };

      if (existing) {
        await client.query(
          `UPDATE ${this.resultsTable()}
              SET mini_game_type = $2,
                  choice_json    = $3::jsonb,
                  result_json    = $4::jsonb,
                  payout_cents   = $5,
                  completed_at   = now()
            WHERE id = $1`,
          [
            existing.id,
            miniGameType,
            JSON.stringify(choiceJson),
            JSON.stringify(resultJson),
            amountCents,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO ${this.resultsTable()}
             (id, scheduled_game_id, mini_game_type, winner_user_id,
              config_snapshot_json, choice_json, result_json, payout_cents,
              triggered_at, completed_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, now(), now())`,
          [
            resultId,
            gameId,
            miniGameType,
            playerId,
            JSON.stringify(configSnapshot),
            JSON.stringify(choiceJson),
            JSON.stringify(resultJson),
            amountCents,
          ],
        );
      }

      await client.query("COMMIT");

      // Step 8: post-commit compliance-ledger PRIZE-entry (soft-fail).
      try {
        await this.complianceLedgerPort.recordComplianceLedgerEvent({
          hallId,
          gameType: "DATABINGO",
          channel: this.defaultLedgerChannel,
          eventType: "PRIZE",
          amount: centsToKroner(amountCents),
          gameId,
          claimId: resultId,
          playerId,
          walletId,
          metadata: {
            reason: "AGENT_MINIGAME_WINNING",
            miniGameType,
            recordedByAgentId: agentUserId,
            agentReason: reason,
          },
        });
      } catch (err) {
        logger.warn(
          {
            err,
            gameId,
            playerId,
            miniGameType,
            amountCents,
            hallId,
          },
          "[REQ-146] complianceLedger.recordComplianceLedgerEvent feilet — payout fortsetter",
        );
      }

      logger.info(
        {
          gameId,
          playerId,
          miniGameType,
          amountCents,
          agentUserId,
          hallId,
          resultId,
          created: !existing,
        },
        "[REQ-146] agent recorded mini-game winning",
      );

      return {
        resultId,
        created: !existing,
        idempotent: false,
        miniGameType,
        payoutCents: amountCents,
        walletTransactionId: walletTxId,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Sjekk om spilleren var registrert i runden. Vi godtar to kilder:
   *   1. assignment i `app_game1_ticket_assignments` (digital ticket)
   *   2. SOLD physical ticket bundet til `assigned_game_id = gameId` med
   *      `buyer_user_id = playerId` (walk-in unique-ID kjøpte fysisk
   *      ticket). Se `app_physical_tickets`.
   */
  private async playerWasInRound(
    client: PoolClient,
    gameId: string,
    playerId: string,
  ): Promise<boolean> {
    const { rows: assignmentRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM ${this.assignmentsTable()}
        WHERE scheduled_game_id = $1 AND buyer_user_id = $2`,
      [gameId, playerId],
    );
    const assignCount = Number(assignmentRows[0]?.count ?? "0");
    if (assignCount > 0) return true;

    // Fallback: physical ticket på samme spill med kjøper = playerId.
    // app_physical_tickets-tabellen er forberedt på dette via buyer_user_id.
    try {
      const { rows: physicalRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM "${this.schema}"."app_physical_tickets"
          WHERE assigned_game_id = $1 AND buyer_user_id = $2 AND status = 'SOLD'`,
        [gameId, playerId],
      );
      return Number(physicalRows[0]?.count ?? "0") > 0;
    } catch (err) {
      // Tabellen kan mangle i dev-miljø — fallback til false.
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01" || code === "42703") {
        return false;
      }
      throw err;
    }
  }

  private extractTxIdFromResultJson(
    resultJson: Record<string, unknown> | null,
  ): string | null {
    if (!resultJson) return null;
    const v = resultJson["walletTransactionId"];
    return typeof v === "string" ? v : null;
  }
}
