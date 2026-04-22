/**
 * PT2 — Agent (bingovert) range-registrering.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 2: Vakt-start + range-registrering", linje 48-69)
 *
 * Eier `app_agent_ticket_ranges`-tabellen (migrasjon 20260417000003 +
 * 20260607000000 PT2-utvidelser). Bygger ovenpå `StaticTicketService` (PT1):
 * en range reserverer en sekvens av usolgte fysiske bonger i samme hall +
 * farge. PT3 (batch-salg) dekrementerer `current_top_serial` når bonger
 * faktisk selges; PT5 (handover) kopierer usolgte bonger til ny range.
 *
 * Scope PT2:
 *   - `registerRange(input)` — validér scan → reservér bonger atomisk.
 *   - `closeRange(rangeId, agentId)` — sett closed_at. Eier-validering.
 *   - `listActiveRangesByAgent(agentId)` + `listActiveRangesByHall(hallId)`
 *     for admin-UI + PT5-handover-oppslag.
 *
 * Fail-closed: alle validerings- eller DB-feil kaster DomainError.
 * Ingen retry, ingen delvis suksess — caller ser enten full range eller
 * null (med feilmelding som forteller hvorfor).
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";
import type { StaticTicketColor } from "./StaticTicketService.js";

const logger = rootLogger.child({ module: "agent-ticket-range-service" });

const VALID_COLORS: readonly StaticTicketColor[] = [
  "small",
  "large",
  "traffic-light",
] as const;

/** Minimum antall bonger per range — legacy-default er 1. */
const MIN_RANGE_COUNT = 1;

/** Maksimum antall bonger per range — stopper "hele hallen på én gang". */
const MAX_RANGE_COUNT = 5000;

export interface AgentTicketRange {
  id: string;
  agentId: string;
  hallId: string;
  ticketColor: StaticTicketColor;
  /** Scannet topp-bong = høyeste serial i rangen (eksisterende kolonne). */
  initialSerial: string;
  /** Laveste serial i rangen. */
  finalSerial: string;
  /** Alle serials i rangen (DESC-sortert topp → bunn). */
  serials: string[];
  /** Peker på toppen av usolgte bonger. Starter lik `initialSerial`. */
  currentTopSerial: string | null;
  /** Legacy-felt: 0 = alt usolgt. PT3 inkrementerer; ikke brukt i PT2. */
  nextAvailableIndex: number;
  registeredAt: string;
  closedAt: string | null;
  handoverFromRangeId: string | null;
}

export interface RegisterRangeInput {
  agentId: string;
  hallId: string;
  ticketColor: StaticTicketColor;
  /** Fysisk barcode scannet fra øverste bong i stabelen. */
  firstScannedSerial: string;
  /** Hvor mange bonger bingoverten plukker ut. */
  count: number;
}

export interface RegisterRangeResult {
  rangeId: string;
  initialTopSerial: string;
  finalSerial: string;
  reservedCount: number;
}

export interface CloseRangeResult {
  rangeId: string;
  closedAt: string;
}

export interface RecordBatchSaleInput {
  /** ID på rangen (åpen). */
  rangeId: string;
  /**
   * Barcode/serial på nye top-bongen — scannet av bingovert når han kommer
   * tilbake til stativet. Alle bonger mellom (newTopSerial, currentTopSerial]
   * registreres som solgt.
   */
  newTopSerial: string;
  /** Bingoverten som utfører batch-oppdateringen. */
  userId: string;
  /**
   * ADMIN kan utføre batch-salg på vegne av en bingovert. Default false.
   * Hvis true må caller først ha verifisert ADMIN-rolle på route-laget.
   */
  adminOverride?: boolean;
  /**
   * Planlagt spill bongene selges inn til. Hvis undefined finner tjenesten
   * neste spill for rangens hall automatisk (fra `app_game1_scheduled_games`).
   */
  scheduledGameId?: string;
}

export interface RecordBatchSaleResult {
  rangeId: string;
  /** Serials som ble oppdatert til is_purchased = true. */
  soldSerials: string[];
  soldCount: number;
  /** Scheduled game bongene ble bundet til. */
  scheduledGameId: string;
  /** ISO-timestamp for scheduled-game-start. */
  gameStartTime: string;
  /** Nye `current_top_serial` etter oppdatering. */
  newTopSerial: string;
  /** Forrige `current_top_serial` (før oppdatering) — for audit/UI. */
  previousTopSerial: string;
}

export interface AgentTicketRangeServiceOptions {
  connectionString: string;
  schema?: string;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function assertPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et positivt heltall.`,
    );
  }
  return value;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  return value.trim();
}

export class AgentTicketRangeService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: AgentTicketRangeServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for AgentTicketRangeService.",
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): AgentTicketRangeService {
    const svc = Object.create(AgentTicketRangeService.prototype) as AgentTicketRangeService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    return svc;
  }

  private rangesTable(): string {
    return `"${this.schema}"."app_agent_ticket_ranges"`;
  }

  private staticTicketsTable(): string {
    return `"${this.schema}"."app_static_tickets"`;
  }

  /**
   * Registrerer en ny range for en bingovert. Atomisk:
   *   1) Slår opp scannet barcode i `app_static_tickets`.
   *   2) Validerer hall-tilhørighet (TICKET_WRONG_HALL ved avvik).
   *   3) Validerer farge matcher valg (TICKET_WRONG_COLOR).
   *   4) Validerer bongen er ikke solgt og ikke reservert av en åpen range.
   *   5) Finner de `count` øverste tilgjengelige serials ≤ scannet top (DESC).
   *   6) INSERT range + UPDATE alle bonger sin `reserved_by_range_id` — én
   *      transaksjon. Ved race mellom to parallelle kall sikrer vi at kun én
   *      kommer gjennom via `FOR UPDATE` på bongene under SELECT-fasen.
   *
   * Hvis færre enn `count` tilgjengelige serials finnes → INSUFFICIENT_INVENTORY.
   */
  async registerRange(input: RegisterRangeInput): Promise<RegisterRangeResult> {
    const agentId = assertNonEmpty(input.agentId, "agentId");
    const hallId = assertNonEmpty(input.hallId, "hallId");
    const firstScannedSerial = assertNonEmpty(
      input.firstScannedSerial,
      "firstScannedSerial",
    );
    if (!VALID_COLORS.includes(input.ticketColor)) {
      throw new DomainError(
        "INVALID_INPUT",
        `ticketColor må være en av ${VALID_COLORS.join(", ")}.`,
      );
    }
    const count = assertPositiveInt(input.count, "count");
    if (count < MIN_RANGE_COUNT) {
      throw new DomainError(
        "INVALID_INPUT",
        `count må være minst ${MIN_RANGE_COUNT}.`,
      );
    }
    if (count > MAX_RANGE_COUNT) {
      throw new DomainError(
        "INVALID_INPUT",
        `count = ${count}, maks ${MAX_RANGE_COUNT} per range.`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Slå opp scannet bong via (hall_id, serial, color) — kombinasjonen er
      // unik (UNIQUE-indeks idx_app_static_tickets_hall_serial_color). Vi
      // bruker FOR UPDATE for å blokkere parallelle kall på samme bong.
      const { rows: scannedRows } = await client.query<{
        id: string;
        hall_id: string;
        ticket_color: StaticTicketColor;
        ticket_serial: string;
        is_purchased: boolean;
        reserved_by_range_id: string | null;
      }>(
        `SELECT id, hall_id, ticket_color, ticket_serial,
                is_purchased, reserved_by_range_id
         FROM ${this.staticTicketsTable()}
         WHERE ticket_serial = $1
         ORDER BY hall_id ASC, ticket_color ASC
         FOR UPDATE`,
        [firstScannedSerial],
      );

      if (scannedRows.length === 0) {
        throw new DomainError(
          "TICKET_NOT_FOUND",
          `Ingen fysisk bong funnet for barcode '${firstScannedSerial}'.`,
        );
      }

      // Finn bongen som matcher bingoverts hall. Den scannede bongen MÅ
      // tilhøre bingoverts hall — ikke bare "finnes noensteds".
      const hallMatch = scannedRows.find((r) => r.hall_id === hallId);
      if (!hallMatch) {
        throw new DomainError(
          "TICKET_WRONG_HALL",
          `Bong '${firstScannedSerial}' tilhører ikke hall '${hallId}'.`,
        );
      }

      // 2. Farge-validering: den scannede bongen må matche valgt farge.
      if (hallMatch.ticket_color !== input.ticketColor) {
        throw new DomainError(
          "TICKET_WRONG_COLOR",
          `Bong '${firstScannedSerial}' har farge '${hallMatch.ticket_color}', forventet '${input.ticketColor}'.`,
        );
      }

      // 3. Solgt-sjekk + reservert-sjekk. En reservert bong er blokkert kun
      // hvis rangen som reserverte den fortsatt er åpen (closed_at IS NULL).
      if (hallMatch.is_purchased) {
        throw new DomainError(
          "TICKET_ALREADY_SOLD",
          `Bong '${firstScannedSerial}' er allerede solgt.`,
        );
      }
      if (hallMatch.reserved_by_range_id) {
        const { rows: openReservation } = await client.query<{ id: string }>(
          `SELECT id FROM ${this.rangesTable()}
           WHERE id = $1 AND closed_at IS NULL
           LIMIT 1`,
          [hallMatch.reserved_by_range_id],
        );
        if (openReservation.length > 0) {
          throw new DomainError(
            "TICKET_ALREADY_RESERVED",
            `Bong '${firstScannedSerial}' er allerede reservert av en åpen range.`,
          );
        }
      }

      // 4. Finn de `count` høyest tilgjengelige serials ≤ firstScannedSerial
      // i samme (hall, farge) som ikke er solgt og ikke reservert av en åpen
      // range. Sortert DESC på serial → første er toppen.
      const { rows: availableRows } = await client.query<{
        id: string;
        ticket_serial: string;
        reserved_by_range_id: string | null;
      }>(
        `SELECT s.id, s.ticket_serial, s.reserved_by_range_id
         FROM ${this.staticTicketsTable()} s
         LEFT JOIN ${this.rangesTable()} r
           ON r.id = s.reserved_by_range_id AND r.closed_at IS NULL
         WHERE s.hall_id = $1
           AND s.ticket_color = $2
           AND s.is_purchased = false
           AND s.ticket_serial <= $3
           AND (s.reserved_by_range_id IS NULL OR r.id IS NULL)
         ORDER BY s.ticket_serial DESC
         LIMIT $4
         FOR UPDATE OF s`,
        [hallId, input.ticketColor, firstScannedSerial, count],
      );

      if (availableRows.length < count) {
        throw new DomainError(
          "INSUFFICIENT_INVENTORY",
          `Fant ${availableRows.length} tilgjengelige bonger ≤ '${firstScannedSerial}' i hall+farge, trenger ${count}.`,
        );
      }

      // Invariant: den scannede bongen MÅ være med i listen (den er tilgjengelig,
      // sortert DESC, og ≤ seg selv → første rad).
      if (availableRows[0]!.ticket_serial !== firstScannedSerial) {
        throw new DomainError(
          "INTERNAL_ERROR",
          `Invariant brutt: scannet top '${firstScannedSerial}' er ikke første i tilgjengelig DESC-listen (fikk '${availableRows[0]!.ticket_serial}').`,
        );
      }

      const serials = availableRows.map((r) => r.ticket_serial);
      const ticketIds = availableRows.map((r) => r.id);
      const initialSerial = serials[0]!;
      const finalSerial = serials[serials.length - 1]!;
      const rangeId = randomUUID();

      // 5. INSERT range-rad.
      const { rows: inserted } = await client.query<{
        registered_at: string;
      }>(
        `INSERT INTO ${this.rangesTable()}
           (id, agent_id, hall_id, ticket_color,
            initial_serial, final_serial, serials,
            next_available_index, current_top_serial,
            registered_at, closed_at, handover_from_range_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 0, $5, now(), NULL, NULL)
         RETURNING registered_at`,
        [
          rangeId,
          agentId,
          hallId,
          input.ticketColor,
          initialSerial,
          finalSerial,
          JSON.stringify(serials),
        ],
      );
      if (inserted.length === 0) {
        throw new DomainError(
          "INTERNAL_ERROR",
          "Kunne ikke opprette range-rad (ingen RETURNING).",
        );
      }

      // 6. Reservér alle bonger i rangen.
      const { rowCount: reservedCount } = await client.query(
        `UPDATE ${this.staticTicketsTable()}
            SET reserved_by_range_id = $1
          WHERE id = ANY($2::text[])
            AND is_purchased = false`,
        [rangeId, ticketIds],
      );

      // Reservering må treffe alle (vi holdt FOR UPDATE-lås på dem).
      if ((reservedCount ?? 0) !== ticketIds.length) {
        throw new DomainError(
          "INTERNAL_ERROR",
          `Reservation-mismatch: forventet ${ticketIds.length} oppdateringer, fikk ${reservedCount ?? 0}.`,
        );
      }

      await client.query("COMMIT");

      logger.info(
        {
          rangeId,
          agentId,
          hallId,
          ticketColor: input.ticketColor,
          initialSerial,
          finalSerial,
          count: serials.length,
        },
        "[PT2] range registrert",
      );

      return {
        rangeId,
        initialTopSerial: initialSerial,
        finalSerial,
        reservedCount: serials.length,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Lukker en range — setter `closed_at = now()`. Kun rangens eier-agent
   * eller en ADMIN (håndteres på route-laget) kan lukke. Her tar vi userId
   * og validerer ownership for å holde service-lag-authz eksplisitt.
   *
   * Dobbelt-lukking er idempotent: hvis `closed_at` allerede er satt,
   * kastes RANGE_ALREADY_CLOSED.
   */
  async closeRange(rangeId: string, userId: string): Promise<CloseRangeResult> {
    const id = assertNonEmpty(rangeId, "rangeId");
    const uid = assertNonEmpty(userId, "userId");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{
        id: string;
        agent_id: string;
        closed_at: Date | string | null;
      }>(
        `SELECT id, agent_id, closed_at
         FROM ${this.rangesTable()}
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      if (rows.length === 0) {
        throw new DomainError("RANGE_NOT_FOUND", `Range '${id}' finnes ikke.`);
      }
      const row = rows[0]!;
      if (row.agent_id !== uid) {
        throw new DomainError(
          "FORBIDDEN",
          `Bruker '${uid}' eier ikke range '${id}'.`,
        );
      }
      if (row.closed_at !== null) {
        throw new DomainError(
          "RANGE_ALREADY_CLOSED",
          `Range '${id}' er allerede lukket.`,
        );
      }

      const { rows: updated } = await client.query<{ closed_at: string }>(
        `UPDATE ${this.rangesTable()}
            SET closed_at = now()
          WHERE id = $1
          RETURNING closed_at`,
        [id],
      );
      await client.query("COMMIT");

      logger.info({ rangeId: id, agentId: uid }, "[PT2] range lukket");
      return { rangeId: id, closedAt: asIso(updated[0]!.closed_at) };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * PT3 — Batch-salg: bingovert scanner nye top-bong etter å ha solgt N bonger.
   *
   * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
   *       (§ "Fase 4: Batch-oppdatering", linje 76-104)
   *
   * Flyt (atomisk transaksjon + FOR UPDATE-lås):
   *   1. Hent rangen med FOR UPDATE (blokkerer parallelle batch-salg).
   *   2. Valider at den ikke er lukket (RANGE_ALREADY_CLOSED).
   *   3. Valider eierskap (userId = range.agent_id, med mindre adminOverride).
   *   4. Valider at newTopSerial er innenfor rangen (SERIAL_NOT_IN_RANGE).
   *   5. Valider at newTopSerial < currentTopSerial (topp har beveget seg ned).
   *      - newTopSerial == currentTopSerial → NO_TICKETS_SOLD (idempotent-safe).
   *      - newTopSerial > currentTopSerial → INVALID_NEW_TOP.
   *   6. Beregn soldSerials = alle i rangen mellom (newTop, currentTop].
   *   7. Finn scheduledGameId hvis ikke oppgitt (neste planlagte spill for
   *      rangens hall i status 'scheduled'/'purchase_open'/'ready_to_start').
   *      Ingen treff → NO_UPCOMING_GAME_FOR_HALL.
   *   8. Batch-UPDATE `app_static_tickets`: is_purchased=true, sold_*-felter.
   *      Kun rader som fortsatt har `reserved_by_range_id = rangeId` og
   *      `is_purchased = false` oppdateres — sikrer idempotens.
   *   9. Oppdater `range.current_top_serial = newTopSerial`.
   *  10. COMMIT. Retur: { soldCount, soldSerials, scheduledGameId, ... }.
   *
   * Fail-closed: enhver feil → ROLLBACK, ingen partial updates.
   *
   * Audit-log skrives IKKE her — caller (route-laget) ansvarlig for å skrive
   * `physical_ticket.batch_sold` med `{ count, fromSerial, toSerial, rangeId,
   * scheduledGameId }` etter vellykket retur.
   */
  async recordBatchSale(input: RecordBatchSaleInput): Promise<RecordBatchSaleResult> {
    const rangeId = assertNonEmpty(input.rangeId, "rangeId");
    const newTopSerial = assertNonEmpty(input.newTopSerial, "newTopSerial");
    const userId = assertNonEmpty(input.userId, "userId");
    const adminOverride = input.adminOverride === true;
    const explicitScheduledGameId = input.scheduledGameId?.trim() || null;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Hent rangen med FOR UPDATE-lås.
      const { rows: rangeRows } = await client.query<{
        id: string;
        agent_id: string;
        hall_id: string;
        ticket_color: StaticTicketColor;
        initial_serial: string;
        final_serial: string;
        serials: string[] | string;
        current_top_serial: string | null;
        closed_at: Date | string | null;
      }>(
        `SELECT id, agent_id, hall_id, ticket_color,
                initial_serial, final_serial, serials,
                current_top_serial, closed_at
         FROM ${this.rangesTable()}
         WHERE id = $1
         FOR UPDATE`,
        [rangeId],
      );
      if (rangeRows.length === 0) {
        throw new DomainError(
          "RANGE_NOT_FOUND",
          `Range '${rangeId}' finnes ikke.`,
        );
      }
      const range = rangeRows[0]!;

      // 2. Lukket?
      if (range.closed_at !== null) {
        throw new DomainError(
          "RANGE_ALREADY_CLOSED",
          `Range '${rangeId}' er lukket — kan ikke registrere nytt batch-salg.`,
        );
      }

      // 3. Eierskap.
      if (!adminOverride && range.agent_id !== userId) {
        throw new DomainError(
          "FORBIDDEN",
          `Bruker '${userId}' eier ikke range '${rangeId}'.`,
        );
      }

      // Parse serials fra JSONB.
      const rangeSerials = Array.isArray(range.serials)
        ? (range.serials as string[])
        : typeof range.serials === "string"
          ? (JSON.parse(range.serials) as string[])
          : [];
      if (rangeSerials.length === 0) {
        throw new DomainError(
          "INTERNAL_ERROR",
          `Range '${rangeId}' har ingen serials registrert.`,
        );
      }

      const currentTopSerial = range.current_top_serial ?? range.initial_serial;

      // 4. SERIAL_NOT_IN_RANGE — newTopSerial må være en del av rangen.
      // Merk: "newTop" betyr etter salget, dvs. ny topp av usolgte bonger.
      // Siden rangen har serials DESC, må newTopSerial finnes i arrayet.
      // Edge-case: hele rangen er solgt → newTop kan være "under" final_serial,
      // men da støter vi mot rangens siste bong. Vi krever at newTopSerial
      // enten er i rangens serials ELLER er < final_serial (for å tillate
      // "hele rangen er solgt" — men da må soldCount = resterende).
      const newTopIndex = rangeSerials.indexOf(newTopSerial);
      if (newTopIndex === -1) {
        throw new DomainError(
          "SERIAL_NOT_IN_RANGE",
          `Serial '${newTopSerial}' er ikke en del av range '${rangeId}'.`,
        );
      }

      // 5. Top-progression.
      const currentTopIndex = rangeSerials.indexOf(currentTopSerial);
      if (currentTopIndex === -1) {
        throw new DomainError(
          "INTERNAL_ERROR",
          `Range '${rangeId}' har current_top_serial '${currentTopSerial}' utenfor serials.`,
        );
      }
      if (newTopIndex === currentTopIndex) {
        throw new DomainError(
          "NO_TICKETS_SOLD",
          `newTopSerial '${newTopSerial}' er lik nåværende top — ingen bonger å selge.`,
        );
      }
      if (newTopIndex < currentTopIndex) {
        // newTop er høyere opp i DESC-listen enn currentTop → newTop > currentTop.
        throw new DomainError(
          "INVALID_NEW_TOP",
          `newTopSerial '${newTopSerial}' er høyere enn nåværende top '${currentTopSerial}'. Top må bevege seg nedover.`,
        );
      }

      // 6. soldSerials = alle i rangen mellom (currentTopIndex, newTopIndex]
      // (dvs. indekser currentTopIndex .. newTopIndex - 1, pga. DESC-orden).
      // serials[0] er høyest, serials[length-1] er lavest.
      // Eksempel: serials = ["100","99","98","97","96","95"],
      //   currentTop = "100" (idx 0), newTop = "95" (idx 5)
      //   soldSerials = ["100","99","98","97","96"] (indekser 0-4).
      const soldSerials = rangeSerials.slice(currentTopIndex, newTopIndex);
      if (soldSerials.length === 0) {
        // Skal ikke skje pga. NO_TICKETS_SOLD-sjekken over, men defensivt.
        throw new DomainError(
          "NO_TICKETS_SOLD",
          "Ingen bonger å selge i beregnet intervall.",
        );
      }

      // 7. Finn scheduledGameId + gameStartTime.
      let scheduledGameId: string;
      let gameStartTime: string;
      if (explicitScheduledGameId) {
        const resolved = await this.findScheduledGameById(
          client,
          explicitScheduledGameId,
          range.hall_id,
        );
        scheduledGameId = resolved.id;
        gameStartTime = resolved.scheduledStartTime;
      } else {
        const next = await this.findNextScheduledGameForHall(client, range.hall_id);
        if (!next) {
          throw new DomainError(
            "NO_UPCOMING_GAME_FOR_HALL",
            `Ingen planlagte spill funnet for hall '${range.hall_id}'.`,
          );
        }
        scheduledGameId = next.id;
        gameStartTime = next.scheduledStartTime;
      }

      // 8. Batch-UPDATE app_static_tickets.
      // Merk: `purchased_at` er PT1-kolonnen som fyller rollen til spec'ens
      // "sold_at" på `app_static_tickets`. `sold_at`-kolonnen eksisterer kun
      // på `app_physical_tickets` (separate tabell).
      const { rowCount: updatedCount } = await client.query(
        `UPDATE ${this.staticTicketsTable()}
            SET is_purchased = true,
                purchased_at = now(),
                sold_to_scheduled_game_id = $1,
                sold_by_user_id = $2,
                sold_from_range_id = $3,
                responsible_user_id = $2
          WHERE hall_id = $4
            AND ticket_serial = ANY($5::text[])
            AND reserved_by_range_id = $3
            AND is_purchased = false`,
        [
          scheduledGameId,
          userId,
          rangeId,
          range.hall_id,
          soldSerials,
        ],
      );

      if ((updatedCount ?? 0) !== soldSerials.length) {
        // Uventet avvik — bonger har mistet sin reservasjon eller er solgt
        // utenfor normal flyt. Rull tilbake for å unngå partial update.
        throw new DomainError(
          "INTERNAL_ERROR",
          `Batch-salg forventet ${soldSerials.length} oppdateringer, fikk ${updatedCount ?? 0}. Ruller tilbake.`,
        );
      }

      // 9. Oppdater range.current_top_serial.
      const { rowCount: rangeUpdated } = await client.query(
        `UPDATE ${this.rangesTable()}
            SET current_top_serial = $1
          WHERE id = $2`,
        [newTopSerial, rangeId],
      );
      if ((rangeUpdated ?? 0) !== 1) {
        throw new DomainError(
          "INTERNAL_ERROR",
          `Kunne ikke oppdatere range current_top_serial (rowCount=${rangeUpdated ?? 0}).`,
        );
      }

      await client.query("COMMIT");

      logger.info(
        {
          rangeId,
          userId,
          soldCount: soldSerials.length,
          fromSerial: soldSerials[0],
          toSerial: soldSerials[soldSerials.length - 1],
          previousTopSerial: currentTopSerial,
          newTopSerial,
          scheduledGameId,
          adminOverride,
        },
        "[PT3] batch-salg registrert",
      );

      return {
        rangeId,
        soldSerials,
        soldCount: soldSerials.length,
        scheduledGameId,
        gameStartTime,
        newTopSerial,
        previousTopSerial: currentTopSerial,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Finner neste planlagte Spill 1-instans for en gitt hall. En hall deltar
   * hvis den er `master_hall_id` eller forekommer i `participating_halls_json`.
   *
   * Brukes av `recordBatchSale` når caller ikke spesifiserer scheduledGameId.
   * Returnerer `null` hvis ingen passende spill finnes.
   *
   * "Neste" = status ∈ {scheduled, purchase_open, ready_to_start, running,
   * paused} AND scheduled_end_time > now(), sortert på scheduled_start_time ASC
   * (eldste først — dvs. det som starter snarest/allerede pågår).
   */
  private async findNextScheduledGameForHall(
    client: { query: Pool["query"] } | Pool,
    hallId: string,
  ): Promise<{ id: string; scheduledStartTime: string } | null> {
    const { rows } = await client.query<{
      id: string;
      scheduled_start_time: Date | string;
    }>(
      `SELECT id, scheduled_start_time
       FROM "${this.schema}"."app_game1_scheduled_games"
       WHERE status IN ('scheduled','purchase_open','ready_to_start','running','paused')
         AND scheduled_end_time > now()
         AND (master_hall_id = $1
              OR participating_halls_json @> to_jsonb($1::text))
       ORDER BY scheduled_start_time ASC
       LIMIT 1`,
      [hallId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      scheduledStartTime: asIso(row.scheduled_start_time),
    };
  }

  /**
   * Validerer at en eksplisitt oppgitt scheduledGameId finnes, er joinable,
   * og at rangens hall er med i deltaker-listen. Kaster hvis ikke.
   */
  private async findScheduledGameById(
    client: { query: Pool["query"] } | Pool,
    scheduledGameId: string,
    hallId: string,
  ): Promise<{ id: string; scheduledStartTime: string }> {
    const { rows } = await client.query<{
      id: string;
      status: string;
      scheduled_start_time: Date | string;
      scheduled_end_time: Date | string;
      master_hall_id: string;
      participating_halls_json: unknown;
    }>(
      `SELECT id, status, scheduled_start_time, scheduled_end_time,
              master_hall_id, participating_halls_json
       FROM "${this.schema}"."app_game1_scheduled_games"
       WHERE id = $1`,
      [scheduledGameId],
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "SCHEDULED_GAME_NOT_FOUND",
        `Planlagt spill '${scheduledGameId}' finnes ikke.`,
      );
    }
    // Hallen må være med — enten som master eller i participating-listen.
    const halls = Array.isArray(row.participating_halls_json)
      ? (row.participating_halls_json as unknown[])
      : [];
    const hallMatches = row.master_hall_id === hallId
      || halls.some((h) => typeof h === "string" && h === hallId);
    if (!hallMatches) {
      throw new DomainError(
        "SCHEDULED_GAME_HALL_MISMATCH",
        `Planlagt spill '${scheduledGameId}' inkluderer ikke hall '${hallId}'.`,
      );
    }
    // Status må være levende (ikke avsluttet).
    const validStatuses = new Set([
      "scheduled",
      "purchase_open",
      "ready_to_start",
      "running",
      "paused",
    ]);
    if (!validStatuses.has(row.status)) {
      throw new DomainError(
        "SCHEDULED_GAME_NOT_JOINABLE",
        `Planlagt spill '${scheduledGameId}' har status '${row.status}' — ikke tilgjengelig for batch-salg.`,
      );
    }
    return {
      id: row.id,
      scheduledStartTime: asIso(row.scheduled_start_time),
    };
  }

  /**
   * Liste åpne ranges for en gitt agent. Sortert nyest først.
   */
  async listActiveRangesByAgent(agentId: string): Promise<AgentTicketRange[]> {
    const id = assertNonEmpty(agentId, "agentId");
    const { rows } = await this.pool.query<RangeRow>(
      `SELECT id, agent_id, hall_id, ticket_color,
              initial_serial, final_serial, serials,
              next_available_index, current_top_serial,
              registered_at, closed_at, handover_from_range_id
       FROM ${this.rangesTable()}
       WHERE agent_id = $1 AND closed_at IS NULL
       ORDER BY registered_at DESC`,
      [id],
    );
    return rows.map((r) => this.map(r));
  }

  /**
   * Liste åpne ranges for en gitt hall. Sortert nyest først. Brukes av
   * admin-UI ("hvem jobber i denne hallen akkurat nå?") og PT5-handover.
   */
  async listActiveRangesByHall(hallId: string): Promise<AgentTicketRange[]> {
    const id = assertNonEmpty(hallId, "hallId");
    const { rows } = await this.pool.query<RangeRow>(
      `SELECT id, agent_id, hall_id, ticket_color,
              initial_serial, final_serial, serials,
              next_available_index, current_top_serial,
              registered_at, closed_at, handover_from_range_id
       FROM ${this.rangesTable()}
       WHERE hall_id = $1 AND closed_at IS NULL
       ORDER BY registered_at DESC`,
      [id],
    );
    return rows.map((r) => this.map(r));
  }

  /**
   * Henter én range via ID. Brukes av route-laget for scope-validering før
   * `closeRange` kalles (for å kunne sjekke hall-tilhørighet i middleware).
   */
  async getRangeById(rangeId: string): Promise<AgentTicketRange | null> {
    const id = assertNonEmpty(rangeId, "rangeId");
    const { rows } = await this.pool.query<RangeRow>(
      `SELECT id, agent_id, hall_id, ticket_color,
              initial_serial, final_serial, serials,
              next_available_index, current_top_serial,
              registered_at, closed_at, handover_from_range_id
       FROM ${this.rangesTable()}
       WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? this.map(row) : null;
  }

  // ── Mapping ──────────────────────────────────────────────────────────────

  private map(r: RangeRow): AgentTicketRange {
    const serials = Array.isArray(r.serials)
      ? (r.serials as string[])
      : typeof r.serials === "string"
        ? (JSON.parse(r.serials) as string[])
        : [];
    return {
      id: r.id,
      agentId: r.agent_id,
      hallId: r.hall_id,
      ticketColor: r.ticket_color,
      initialSerial: r.initial_serial,
      finalSerial: r.final_serial,
      serials,
      currentTopSerial: r.current_top_serial,
      nextAvailableIndex: r.next_available_index,
      registeredAt: asIso(r.registered_at),
      closedAt: asIsoOrNull(r.closed_at),
      handoverFromRangeId: r.handover_from_range_id,
    };
  }
}

interface RangeRow {
  id: string;
  agent_id: string;
  hall_id: string;
  ticket_color: StaticTicketColor;
  initial_serial: string;
  final_serial: string;
  serials: string[] | string;
  next_available_index: number;
  current_top_serial: string | null;
  registered_at: Date | string;
  closed_at: Date | string | null;
  handover_from_range_id: string | null;
}

