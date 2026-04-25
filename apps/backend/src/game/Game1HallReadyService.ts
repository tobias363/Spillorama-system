/**
 * GAME1_SCHEDULE PR 2: per-hall ready-service for Game 1.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.2 + §3.4.
 *
 * Ansvar:
 *   1) markReady: bingovert trykker "klar" for sin hall. UPSERT
 *      is_ready=true, ready_at=NOW(), snapshot digital + physical ticket-
 *      sales-counts. AuditLog `hall.sales.closed`. Purchase lukkes for
 *      hallen via sjekk i ticket-purchase-endepunkt (se
 *      assertPurchaseOpenForHall).
 *   2) unmarkReady: bingovert angrer "klar" — kun mulig så lenge spillet
 *      fortsatt er i status='purchase_open'. UPDATE is_ready=false,
 *      ready_at=NULL. AuditLog `hall.sales.reopened`.
 *   3) getReadyStatusForGame: alle deltakende haller med ready-flagg +
 *      snapshot. Brukes av master-UI og socket-broadcasts.
 *   4) allParticipatingHallsReady: true hvis alle non-excluded haller
 *      har is_ready=true. Brukt av scheduler-tick for å flippe status
 *      'purchase_open' → 'ready_to_start'.
 *   5) assertPurchaseOpenForHall: purchase-cutoff-helper som
 *      ticket-purchase-endepunkter kaller før salg godtas. Kaster
 *      PURCHASE_CLOSED_FOR_HALL hvis hallen har trykket klar.
 *
 * Validering i markReady:
 *   - gameId må være i status='purchase_open' (ikke scheduled, running, …)
 *   - hallId må være i participating_halls_json for spillet
 *   - Bingovert-user (rolle AGENT/HALL_OPERATOR/ADMIN) enforced i
 *     route-laget; service antar userId er validert.
 *
 * Design:
 *   - Purchase-cutoff-helper eksporteres som fri funksjon mot service-
 *     state slik at adminPhysicalTickets og agent-POS-routen kan kalle
 *     direkte med minimal coupling. Digital ticket-purchase-path
 *     er TBD (eksisterende `/api/games/*` bruker BingoEngine, ikke
 *     game1_scheduled_games) — vi integrerer på physical-siden først
 *     og logger en gap-note for digital.
 *   - Sales-count-snapshot: digital_tickets_sold settes fra caller
 *     (PR 3+ vil koble BingoEngine-tickets til gameId); physical
 *     hentes fra app_physical_tickets WHERE assigned_game_id=$1 AND
 *     hall_id=$2 AND status='SOLD'.
 *
 * AuditLog-actions:
 *   - hall.sales.closed        — markReady
 *   - hall.sales.reopened      — unmarkReady
 */

import type { Pool } from "pg";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-hall-ready-service" });

export interface HallReadyStatusRow {
  gameId: string;
  hallId: string;
  isReady: boolean;
  readyAt: string | null;
  readyByUserId: string | null;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
  excludedFromGame: boolean;
  excludedReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** TASK HS: scan-data (NULL inntil scan er utført). */
  startTicketId: string | null;
  startScannedAt: string | null;
  finalScanTicketId: string | null;
  finalScannedAt: string | null;
}

/**
 * TASK HS: beriket per-hall-status for master-dashboard.
 * Farge-semantikk (låst av Tobias 2026-04-24):
 *   - red     : playerCount === 0  (ekskluderes auto)
 *   - orange  : playerCount > 0 && (!finalScanDone || !readyConfirmed)
 *   - green   : alle spillere telt + slutt-scan gjort + Klar trykket
 */
export type HallStatusColor = "red" | "orange" | "green";

export interface HallStatusForGame {
  hallId: string;
  playerCount: number;
  /**
   * `true` hvis hallen har utført start-scan, eller er en digital-only-hall
   * (ingen fysiske bonger — ingen scan nødvendig).
   */
  startScanDone: boolean;
  /**
   * `true` hvis hallen har utført slutt-scan, eller er en digital-only-hall.
   * Påkrevd for `markReady` i fysisk-bong-scenarioet.
   */
  finalScanDone: boolean;
  readyConfirmed: boolean;
  excludedFromGame: boolean;
  excludedReason: string | null;
  color: HallStatusColor;
  /** TASK HS: eksakt antall solgte fysiske bonger (final_id - start_id). */
  soldCount: number;
  startTicketId: string | null;
  finalScanTicketId: string | null;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
}

export interface MarkReadyInput {
  gameId: string;
  hallId: string;
  userId: string;
  /** Optional pre-computed digital-sales count (tests inject). */
  digitalTicketsSold?: number;
}

export interface UnmarkReadyInput {
  gameId: string;
  hallId: string;
  userId: string;
}

export interface RecordScanInput {
  gameId: string;
  hallId: string;
  ticketId: string;
}

export interface Game1HallReadyServiceOptions {
  pool: Pool;
  schema?: string;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  participating_halls_json: unknown;
  group_hall_id: string;
  master_hall_id: string;
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

export class Game1HallReadyService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: Game1HallReadyServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
  }

  /** @internal test helper. */
  static forTesting(pool: Pool, schema = "public"): Game1HallReadyService {
    return new Game1HallReadyService({ pool, schema });
  }

  private hallReadyTable(): string {
    return `"${this.schema}"."app_game1_hall_ready_status"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  private physicalTicketsTable(): string {
    return `"${this.schema}"."app_physical_tickets"`;
  }

  /**
   * Mark a hall as ready for a specific game. Idempotent — UPSERT via
   * INSERT ... ON CONFLICT DO UPDATE. Kaster VALIDATION_FAILED hvis
   * spillet ikke finnes, er i feil status, eller hallen ikke deltar.
   *
   * TASK HS: hvis hallen har fysisk-bong-salg (physical_tickets_sold > 0
   * eller start_ticket_id satt), må slutt-scan være utført før markReady
   * tillates — ellers kaster `FINAL_SCAN_REQUIRED`. Digital-only-haller
   * (ingen start-scan + 0 fysiske) slipper gjennom.
   */
  async markReady(input: MarkReadyInput): Promise<HallReadyStatusRow> {
    const game = await this.loadScheduledGame(input.gameId);
    if (game.status !== "purchase_open") {
      throw new DomainError(
        "GAME_NOT_READY_ELIGIBLE",
        `Kan kun markere klar for spill i status 'purchase_open' (nåværende: '${game.status}').`
      );
    }
    const participating = parseHallIdsArray(game.participating_halls_json);
    // Master-hall er alltid deltaker selv om den ikke er i participating-listen.
    if (!participating.includes(input.hallId) && game.master_hall_id !== input.hallId) {
      throw new DomainError(
        "HALL_NOT_PARTICIPATING",
        "Hallen deltar ikke i dette spillet."
      );
    }

    const physicalSold = await this.countPhysicalSoldForHall(input.gameId, input.hallId);
    const digitalSold = Math.max(0, Math.floor(input.digitalTicketsSold ?? 0));

    // TASK HS: FINAL_SCAN_REQUIRED-guard for fysisk-bong-haller.
    // Henter eksisterende rad for å vite om start-scan er utført.
    const existing = await this.loadExistingRow(input.gameId, input.hallId);
    const hasPhysicalFlow =
      (existing?.startTicketId != null && existing.startTicketId !== "") ||
      physicalSold > 0;
    if (hasPhysicalFlow) {
      const finalScanDone =
        existing?.finalScanTicketId != null && existing.finalScanTicketId !== "";
      if (!finalScanDone) {
        throw new DomainError(
          "FINAL_SCAN_REQUIRED",
          "Skann øverste bong etter salg før du bekrefter klar."
        );
      }
    }

    // UPSERT + returnerer rad. `updated_at` settes eksplisitt for ON CONFLICT-
    // grenen så vi ikke stoler på trigger.
    const { rows } = await this.pool.query(
      `INSERT INTO ${this.hallReadyTable()}
         (game_id, hall_id, is_ready, ready_at, ready_by_user_id,
          digital_tickets_sold, physical_tickets_sold)
       VALUES ($1, $2, true, now(), $3, $4, $5)
       ON CONFLICT (game_id, hall_id) DO UPDATE
         SET is_ready              = true,
             ready_at              = now(),
             ready_by_user_id      = EXCLUDED.ready_by_user_id,
             digital_tickets_sold  = EXCLUDED.digital_tickets_sold,
             physical_tickets_sold = EXCLUDED.physical_tickets_sold,
             updated_at            = now()
       RETURNING game_id, hall_id, is_ready, ready_at, ready_by_user_id,
                 digital_tickets_sold, physical_tickets_sold,
                 excluded_from_game, excluded_reason, created_at, updated_at,
                 start_ticket_id, start_scanned_at,
                 final_scan_ticket_id, final_scanned_at`,
      [input.gameId, input.hallId, input.userId, digitalSold, physicalSold]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("MARK_READY_FAILED", "Kunne ikke oppdatere ready-status.");
    }
    return mapRowToStatus(row);
  }

  /**
   * Unmark ready (angre). Kun tillatt så lenge spillet fortsatt er i
   * status='purchase_open'; etter 'ready_to_start' eller 'running' kan
   * ikke bingovert angre via denne flyten (master kan ekskludere
   * hall via egen endpoint i PR 3).
   */
  async unmarkReady(input: UnmarkReadyInput): Promise<HallReadyStatusRow> {
    const game = await this.loadScheduledGame(input.gameId);
    if (game.status !== "purchase_open") {
      throw new DomainError(
        "GAME_NOT_READY_ELIGIBLE",
        `Kan kun angre klar for spill i status 'purchase_open' (nåværende: '${game.status}').`
      );
    }

    const { rows } = await this.pool.query(
      `UPDATE ${this.hallReadyTable()}
         SET is_ready   = false,
             ready_at   = NULL,
             updated_at = now()
       WHERE game_id = $1 AND hall_id = $2
       RETURNING game_id, hall_id, is_ready, ready_at, ready_by_user_id,
                 digital_tickets_sold, physical_tickets_sold,
                 excluded_from_game, excluded_reason, created_at, updated_at,
                 start_ticket_id, start_scanned_at,
                 final_scan_ticket_id, final_scanned_at`,
      [input.gameId, input.hallId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "READY_STATUS_NOT_FOUND",
        "Hallen har ingen ready-status å angre."
      );
    }
    return mapRowToStatus(row);
  }

  /**
   * Hent ready-status for alle deltakende haller i et spill. Returnerer én
   * rad per participating hall — også haller som ennå ikke har trykket
   * klar (fylt ut med defaults).
   */
  async getReadyStatusForGame(gameId: string): Promise<HallReadyStatusRow[]> {
    const game = await this.loadScheduledGame(gameId);
    const participating = parseHallIdsArray(game.participating_halls_json);
    // Sørg for at master-hall er med i listen (idempotent merge).
    const allHalls = new Set<string>(participating);
    allHalls.add(game.master_hall_id);
    const hallIds = Array.from(allHalls);

    const { rows } = await this.pool.query(
      `SELECT game_id, hall_id, is_ready, ready_at, ready_by_user_id,
              digital_tickets_sold, physical_tickets_sold,
              excluded_from_game, excluded_reason, created_at, updated_at,
              start_ticket_id, start_scanned_at,
              final_scan_ticket_id, final_scanned_at
         FROM ${this.hallReadyTable()}
         WHERE game_id = $1`,
      [gameId]
    );
    const byHall = new Map<string, HallReadyStatusRow>();
    for (const row of rows) {
      const mapped = mapRowToStatus(row);
      byHall.set(mapped.hallId, mapped);
    }
    // Fyll ut defaults for haller som ennå ikke har rad.
    const result: HallReadyStatusRow[] = [];
    for (const hallId of hallIds) {
      const existing = byHall.get(hallId);
      if (existing) {
        result.push(existing);
      } else {
        result.push({
          gameId,
          hallId,
          isReady: false,
          readyAt: null,
          readyByUserId: null,
          digitalTicketsSold: 0,
          physicalTicketsSold: 0,
          excludedFromGame: false,
          excludedReason: null,
          createdAt: "",
          updatedAt: "",
          startTicketId: null,
          startScannedAt: null,
          finalScanTicketId: null,
          finalScannedAt: null,
        });
      }
    }
    return result;
  }

  /**
   * Sjekker om alle participating non-excluded haller har is_ready=true.
   * Brukes av scheduler-tick til å flippe 'purchase_open' → 'ready_to_start'.
   *
   * Rule:
   *   - Master-hall SKAL være ready (ikke kan ekskluderes).
   *   - Andre haller: hvis excluded_from_game=true teller ikke.
   *   - Minst én non-excluded hall må være ready (ikke null-case).
   */
  async allParticipatingHallsReady(gameId: string): Promise<boolean> {
    const statuses = await this.getReadyStatusForGame(gameId);
    const candidates = statuses.filter((s) => !s.excludedFromGame);
    if (candidates.length === 0) return false;
    return candidates.every((s) => s.isReady);
  }

  /**
   * Purchase-cutoff guard: kaster PURCHASE_CLOSED_FOR_HALL hvis hallen har
   * en game i status='purchase_open' hvor is_ready=true. Kalles av
   * ticket-purchase-endepunktene (physical + digital).
   *
   * Matcher game via assignedGameId direkte hvis tilgjengelig, eller
   * fallback på "alle purchase_open-games som denne hallen deltar i".
   * I praksis kjenner caller som regel gameId (fra ticket-batch /
   * game-session), og bruker den direkte-varianten.
   */
  async assertPurchaseOpenForHall(
    gameId: string,
    hallId: string
  ): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT r.is_ready, g.status
         FROM ${this.scheduledGamesTable()} g
         LEFT JOIN ${this.hallReadyTable()} r
           ON r.game_id = g.id AND r.hall_id = $2
         WHERE g.id = $1`,
      [gameId, hallId]
    );
    const row = rows[0];
    if (!row) {
      // Ukjent game — lar caller håndtere (kan være legacy game uten
      // schedule). Vi lukker ikke purchase for rader vi ikke kjenner.
      return;
    }
    if (row.status === "purchase_open" && row.is_ready === true) {
      throw new DomainError(
        "PURCHASE_CLOSED_FOR_HALL",
        "Billettsalget er lukket for denne hallen (bingovert har trykket klar)."
      );
    }
    // Spill som har forlatt 'purchase_open' (ready_to_start/running/…) skal
    // uansett ikke godta nye kjøp — men det enforces også av game-session-
    // logikken. Vi kaster kun for purchase_open+ready-kombinasjonen her, så
    // PR 3 (master-start) kan utvide med sine egne feilkoder.
  }

  /**
   * TASK HS: lagrer start-scan-ticketId for hallen. Idempotent — re-scan
   * oppdaterer `start_scanned_at`.
   *
   * Kaster:
   *   - `GAME_NOT_READY_ELIGIBLE` hvis spillet ikke er i `purchase_open`.
   *   - `HALL_NOT_PARTICIPATING` hvis hallen ikke deltar.
   *   - `INVALID_INPUT` hvis ticketId er tomt/whitespace.
   */
  async recordStartScan(input: RecordScanInput): Promise<HallReadyStatusRow> {
    const ticketId = input.ticketId.trim();
    if (!ticketId) {
      throw new DomainError("INVALID_INPUT", "ticketId kan ikke være tomt.");
    }
    await this.assertGameAndHallForScan(input.gameId, input.hallId);

    const physicalSold = await this.countPhysicalSoldForHall(input.gameId, input.hallId);
    const { rows } = await this.pool.query(
      `INSERT INTO ${this.hallReadyTable()}
         (game_id, hall_id, is_ready, start_ticket_id, start_scanned_at,
          physical_tickets_sold)
       VALUES ($1, $2, false, $3, now(), $4)
       ON CONFLICT (game_id, hall_id) DO UPDATE
         SET start_ticket_id      = EXCLUDED.start_ticket_id,
             start_scanned_at     = now(),
             physical_tickets_sold = EXCLUDED.physical_tickets_sold,
             updated_at           = now()
       RETURNING game_id, hall_id, is_ready, ready_at, ready_by_user_id,
                 digital_tickets_sold, physical_tickets_sold,
                 excluded_from_game, excluded_reason, created_at, updated_at,
                 start_ticket_id, start_scanned_at,
                 final_scan_ticket_id, final_scanned_at`,
      [input.gameId, input.hallId, ticketId, physicalSold]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SCAN_FAILED", "Kunne ikke lagre start-scan.");
    }
    return mapRowToStatus(row);
  }

  /**
   * TASK HS: lagrer slutt-scan-ticketId. Validerer at `ticketId >= start_ticket_id`
   * (ellers `INVALID_SCAN_RANGE`). Oppdaterer `physical_tickets_sold` eksakt
   * basert på `final_id - start_id` når begge er numeriske — ellers faller vi
   * tilbake til `countPhysicalSoldForHall`-databasetelling.
   */
  async recordFinalScan(input: RecordScanInput): Promise<HallReadyStatusRow> {
    const ticketId = input.ticketId.trim();
    if (!ticketId) {
      throw new DomainError("INVALID_INPUT", "ticketId kan ikke være tomt.");
    }
    await this.assertGameAndHallForScan(input.gameId, input.hallId);

    const existing = await this.loadExistingRow(input.gameId, input.hallId);
    const startId = existing?.startTicketId?.trim() ?? "";
    if (!startId) {
      throw new DomainError(
        "START_SCAN_REQUIRED",
        "Skann første bong før slutt-scan."
      );
    }

    // Range-validering: numerisk sammenligning hvis begge er parsbare
    // (vanlig case — bongnumre er sekvensielle heltall). Ellers lexikografisk
    // fallback for strenger. `final >= start` kreves — lik betyr 0 solgte.
    const startNum = Number(startId);
    const finalNum = Number(ticketId);
    if (Number.isFinite(startNum) && Number.isFinite(finalNum)) {
      if (finalNum < startNum) {
        throw new DomainError(
          "INVALID_SCAN_RANGE",
          `Slutt-scan (${ticketId}) må være >= start-scan (${startId}).`
        );
      }
    } else if (ticketId < startId) {
      throw new DomainError(
        "INVALID_SCAN_RANGE",
        `Slutt-scan (${ticketId}) må være >= start-scan (${startId}).`
      );
    }

    // Eksakt solgt-antall: final_id - start_id når numerisk. Ellers fallback
    // til DB-count. Lagres i physical_tickets_sold slik at master-UI og audit
    // ser samme tall.
    let physicalSold: number;
    if (Number.isFinite(startNum) && Number.isFinite(finalNum)) {
      physicalSold = Math.max(0, Math.floor(finalNum - startNum));
    } else {
      physicalSold = await this.countPhysicalSoldForHall(input.gameId, input.hallId);
    }

    const { rows } = await this.pool.query(
      `UPDATE ${this.hallReadyTable()}
          SET final_scan_ticket_id = $3,
              final_scanned_at     = now(),
              physical_tickets_sold = $4,
              updated_at           = now()
        WHERE game_id = $1 AND hall_id = $2
        RETURNING game_id, hall_id, is_ready, ready_at, ready_by_user_id,
                  digital_tickets_sold, physical_tickets_sold,
                  excluded_from_game, excluded_reason, created_at, updated_at,
                  start_ticket_id, start_scanned_at,
                  final_scan_ticket_id, final_scanned_at`,
      [input.gameId, input.hallId, ticketId, physicalSold]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("SCAN_FAILED", "Kunne ikke lagre slutt-scan.");
    }
    return mapRowToStatus(row);
  }

  /**
   * TASK HS: beriket hall-status-liste for master-dashboard. Beregner
   * `color` per hall basert på låst farge-semantikk.
   *
   * Edge-case: digital-only hall (ingen start_ticket_id + physical_tickets_sold=0)
   * regnes som `finalScanDone=true` automatisk slik at hallen kan gå grønn
   * alene på `readyConfirmed`.
   *
   * `playerCount = digital_tickets_sold + physical_tickets_sold` — dette er
   * den samme modellen som scheduler-tick-en og master-audit bruker.
   */
  async getHallStatusForGame(gameId: string): Promise<HallStatusForGame[]> {
    const rows = await this.getReadyStatusForGame(gameId);
    return rows.map((r) => computeHallStatus(r));
  }

  /**
   * TASK HS: hent group_hall_id for et spill. Brukes av route-laget for å
   * velge broadcast-rom (`group:<groupId>`).
   */
  async getGameGroupId(gameId: string): Promise<string> {
    const game = await this.loadScheduledGame(gameId);
    return game.group_hall_id;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * TASK HS: felles validering for scan-endepunkter. Kaster samme
   * DomainError-koder som markReady så admin-UI kan dele feilhåndtering.
   */
  private async assertGameAndHallForScan(
    gameId: string,
    hallId: string
  ): Promise<void> {
    const game = await this.loadScheduledGame(gameId);
    if (game.status !== "purchase_open") {
      throw new DomainError(
        "GAME_NOT_READY_ELIGIBLE",
        `Kan kun scanne i status 'purchase_open' (nåværende: '${game.status}').`
      );
    }
    const participating = parseHallIdsArray(game.participating_halls_json);
    if (!participating.includes(hallId) && game.master_hall_id !== hallId) {
      throw new DomainError(
        "HALL_NOT_PARTICIPATING",
        "Hallen deltar ikke i dette spillet."
      );
    }
  }

  /**
   * TASK HS: hent eksisterende rad uten å populere default for fravær. Brukes
   * av scan-flyten og markReady-guarden for å sjekke om start-scan er utført.
   */
  private async loadExistingRow(
    gameId: string,
    hallId: string
  ): Promise<HallReadyStatusRow | null> {
    const { rows } = await this.pool.query(
      `SELECT game_id, hall_id, is_ready, ready_at, ready_by_user_id,
              digital_tickets_sold, physical_tickets_sold,
              excluded_from_game, excluded_reason, created_at, updated_at,
              start_ticket_id, start_scanned_at,
              final_scan_ticket_id, final_scanned_at
         FROM ${this.hallReadyTable()}
         WHERE game_id = $1 AND hall_id = $2`,
      [gameId, hallId]
    );
    const row = rows[0];
    if (!row) return null;
    return mapRowToStatus(row);
  }

  private async loadScheduledGame(gameId: string): Promise<ScheduledGameRow> {
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, status, participating_halls_json, group_hall_id, master_hall_id
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1`,
      [gameId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
    }
    return row;
  }

  private async countPhysicalSoldForHall(
    gameId: string,
    hallId: string
  ): Promise<number> {
    try {
      const { rows } = await this.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
           FROM ${this.physicalTicketsTable()}
           WHERE assigned_game_id = $1
             AND hall_id = $2
             AND status = 'SOLD'`,
        [gameId, hallId]
      );
      const n = Number(rows[0]?.cnt ?? "0");
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        // Tabellen mangler (dev uten migrasjon) — returner 0 uten å kaste.
        log.debug({ gameId, hallId }, "physical tickets table missing; counting as 0");
        return 0;
      }
      throw err;
    }
  }
}

function mapRowToStatus(row: Record<string, unknown>): HallReadyStatusRow {
  return {
    gameId: String(row.game_id),
    hallId: String(row.hall_id),
    isReady: Boolean(row.is_ready),
    readyAt: row.ready_at == null ? null : toIso(row.ready_at),
    readyByUserId: row.ready_by_user_id == null ? null : String(row.ready_by_user_id),
    digitalTicketsSold: Number(row.digital_tickets_sold ?? 0),
    physicalTicketsSold: Number(row.physical_tickets_sold ?? 0),
    excludedFromGame: Boolean(row.excluded_from_game),
    excludedReason:
      row.excluded_reason == null ? null : String(row.excluded_reason),
    createdAt: row.created_at == null ? "" : toIso(row.created_at),
    updatedAt: row.updated_at == null ? "" : toIso(row.updated_at),
    startTicketId: row.start_ticket_id == null ? null : String(row.start_ticket_id),
    startScannedAt:
      row.start_scanned_at == null ? null : toIso(row.start_scanned_at),
    finalScanTicketId:
      row.final_scan_ticket_id == null ? null : String(row.final_scan_ticket_id),
    finalScannedAt:
      row.final_scanned_at == null ? null : toIso(row.final_scanned_at),
  };
}

/**
 * TASK HS: beregn farge-kode for en hall. Eksporteres fra modulen (ikke
 * klassen) slik at tester kan unit-teste logikken uten DB-stub.
 *
 * Regler (låst):
 *   - `red`     hvis `playerCount === 0`
 *   - `orange`  hvis `playerCount > 0` og (`!finalScanDone` eller `!readyConfirmed`)
 *   - `green`   hvis alle betingelser oppfylt
 *
 * Digital-only-haller (ingen start-scan + 0 fysiske) regnes som
 * `finalScanDone=true` automatisk — de kan gå grønn uten å scanne.
 */
export function computeHallStatus(row: HallReadyStatusRow): HallStatusForGame {
  const physical = Number.isFinite(row.physicalTicketsSold)
    ? row.physicalTicketsSold
    : 0;
  const digital = Number.isFinite(row.digitalTicketsSold)
    ? row.digitalTicketsSold
    : 0;
  const playerCount = Math.max(0, physical + digital);

  const hasPhysicalFlow =
    (row.startTicketId != null && row.startTicketId !== "") || physical > 0;

  const startScanDone = !hasPhysicalFlow
    ? true
    : row.startTicketId != null && row.startTicketId !== "";
  const finalScanDone = !hasPhysicalFlow
    ? true
    : row.finalScanTicketId != null && row.finalScanTicketId !== "";

  const readyConfirmed = Boolean(row.isReady);

  let color: HallStatusColor;
  if (playerCount === 0) {
    color = "red";
  } else if (!finalScanDone || !readyConfirmed) {
    color = "orange";
  } else {
    color = "green";
  }

  // Eksakt solgt-antall: final_id - start_id når begge er numeriske;
  // ellers fall tilbake til physical_tickets_sold.
  let soldCount = physical;
  if (row.startTicketId != null && row.finalScanTicketId != null) {
    const startNum = Number(row.startTicketId);
    const finalNum = Number(row.finalScanTicketId);
    if (Number.isFinite(startNum) && Number.isFinite(finalNum)) {
      soldCount = Math.max(0, Math.floor(finalNum - startNum));
    }
  }

  return {
    hallId: row.hallId,
    playerCount,
    startScanDone,
    finalScanDone,
    readyConfirmed,
    excludedFromGame: row.excludedFromGame,
    excludedReason: row.excludedReason,
    color,
    soldCount,
    startTicketId: row.startTicketId,
    finalScanTicketId: row.finalScanTicketId,
    digitalTicketsSold: digital,
    physicalTicketsSold: physical,
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}
