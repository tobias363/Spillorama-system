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

