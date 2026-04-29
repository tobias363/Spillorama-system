/**
 * PT1 — Fysisk-bong inventar (papirbong) admin-service.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *
 * Eier `app_static_tickets`-tabellen (migrasjon 20260417000002 + 20260606000000
 * PT1-utvidelser). Hver rad = én fysisk bong med pre-trykt (serial, color,
 * card_matrix) + hall-tilknytning.
 *
 * Forskjell fra `PhysicalTicketService` (BIN-587 B4a):
 *   - `PhysicalTicketService` eier `app_physical_tickets` (range-basert batch,
 *      POS-salg, cashout). Admin genererer range → billetter materialiseres.
 *   - `StaticTicketService` eier `app_static_tickets` (fysiske bonger med
 *      pre-trykte numre og pre-generert bingo-matrise). Bonger importeres
 *      en-bloc fra leverandør-CSV.
 *
 * Sammen dekker de pilotmodellen: PhysicalTicketService for moderne POS-salg,
 * StaticTicketService for legacy-port med range-basert vakt-flyt.
 *
 * PT1-scope:
 *   - `importFromCSV(csvContent, hallId)` — atomisk CSV-import
 *   - `findByBarcode(barcode)` — enkelt-bong-oppslag
 *   - `listAvailableByHallAndColor(hallId, color, limit)` — tilgjengelig inventar
 *   - `bulkMarkSold(serials[], saleData)` — batch-salg (brukes av PT3)
 *
 * PT2-PT6 bygger videre på dette uten å endre signaturer.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "static-ticket-service" });

/** `ticket_color`-kolonnen er en av tre familie-koder (gruppe, ikke variant). */
export type StaticTicketColor = "small" | "large" | "traffic-light";

const VALID_COLORS: readonly StaticTicketColor[] = ["small", "large", "traffic-light"] as const;

/** Max rader per CSV-import — ops-beskyttelse mot utilsiktet mega-fil. */
export const MAX_CSV_ROWS = 50_000;

/** Bingo-kortet: 25 tall (5×5 row-major); ingen gratis-senter i `card_matrix` (legacy-format). */
export const CARD_MATRIX_CELLS = 25;

/** Gyldig tall-range på bingo-kortet (1-75). */
const MIN_NUMBER = 1;
const MAX_NUMBER = 75;

export interface StaticTicket {
  id: string;
  hallId: string;
  ticketSerial: string;
  ticketColor: StaticTicketColor;
  ticketType: string;
  /** 25 tall, row-major rekkefølge. Matcher `Ticket.grid` i spill-motoren. */
  cardMatrix: number[];
  isPurchased: boolean;
  purchasedAt: string | null;
  importedAt: string;

  // ── PT1-utvidelser (20260606000000_static_tickets_pt1_extensions.sql)
  soldByUserId: string | null;
  soldFromRangeId: string | null;
  responsibleUserId: string | null;
  soldToScheduledGameId: string | null;
  reservedByRangeId: string | null;
  paidOutAt: string | null;
  paidOutAmountCents: number | null;
  paidOutByUserId: string | null;
}

export interface ImportResult {
  hallId: string;
  inserted: number;
  skipped: number;
  totalRows: number;
}

/** Én rad i parseResult — returneres av valider-helperen, skrives av importer. */
export interface ParsedCsvRow {
  lineNumber: number;
  ticketId: string;
  ticketType: string;
  ticketColor: StaticTicketColor;
  cardMatrix: number[];
  hallNameInCsv: string;
}

export interface BulkMarkSoldInput {
  hallId: string;
  ticketSerials: string[];
  ticketColor: StaticTicketColor;
  soldByUserId: string;
  soldFromRangeId: string;
  responsibleUserId: string;
  soldToScheduledGameId: string | null;
}

export interface BulkMarkSoldResult {
  matched: number;
  updated: number;
  alreadySold: string[];
}

export interface StaticTicketServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
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

/**
 * Utleder `ticket_color`-familie-enum fra en variant-streng. Legacy CSV kan
 * bruke både underscore og hyphen (`small_yellow` / `small-yellow`); begge
 * normaliseres. Ukjente varianter rejectes (fail-closed).
 */
export function deriveColorFamily(ticketType: string): StaticTicketColor {
  const normalized = ticketType.trim().toLowerCase().replace(/_/g, "-");
  if (normalized.startsWith("small")) return "small";
  if (normalized.startsWith("large")) return "large";
  if (normalized.startsWith("traffic") || normalized.startsWith("trafficlight")) {
    return "traffic-light";
  }
  // Elvis er en "large"-variant i legacy — samme 5×5 kortformat.
  if (normalized === "elvis") return "large";
  throw new DomainError(
    "INVALID_INPUT",
    `Ukjent ticket_color/ticket_type '${ticketType}'. Støttede prefikser: small, large, traffic-light, elvis.`,
  );
}

/**
 * Parser en CSV-streng i legacy-format:
 *
 *   hall_name,ticket_id,ticket_color,num1,num2,...,num25
 *   Notodden,01-1001,small_yellow,3,18,32,...
 *
 * Første rad kan være header (heuristikk: hvis "hall_name" eller "ticket_id"
 * som tekst i første celle → header, ellers data).
 *
 * Kaster DomainError ved ugyldig rad. Returnerer alle parsed rader når hele
 * filen er valid — importer kjører atomisk transaksjon basert på dette.
 */
export function parseStaticTicketCsv(csvContent: string): ParsedCsvRow[] {
  if (typeof csvContent !== "string" || !csvContent.trim()) {
    throw new DomainError("INVALID_INPUT", "CSV-filen er tom.");
  }
  const lines = csvContent
    .split(/\r?\n/)
    .map((l, idx) => ({ raw: l, lineNumber: idx + 1 }))
    .filter((l) => l.raw.trim().length > 0);

  if (lines.length === 0) {
    throw new DomainError("INVALID_INPUT", "CSV-filen har ingen data-rader.");
  }

  // Heuristikk: første celle i første rad = "hall_name" eller "hall" eller
  // "ticket_id" → header-rad, hopp over. Case-insensitivt.
  const firstCellLower = lines[0]!.raw.split(/[,;\t]/)[0]!.trim().toLowerCase();
  const hasHeader = firstCellLower === "hall_name"
    || firstCellLower === "hall"
    || firstCellLower === "hallname"
    || firstCellLower === "ticket_id";
  const dataLines = hasHeader ? lines.slice(1) : lines;

  if (dataLines.length === 0) {
    throw new DomainError("INVALID_INPUT", "CSV-filen har kun header, ingen data-rader.");
  }

  if (dataLines.length > MAX_CSV_ROWS) {
    throw new DomainError(
      "INVALID_INPUT",
      `CSV-filen har ${dataLines.length} rader, maks ${MAX_CSV_ROWS} er tillatt per import.`,
    );
  }

  const parsed: ParsedCsvRow[] = [];
  const seenSerials = new Set<string>();

  for (const { raw, lineNumber } of dataLines) {
    // Støtt komma, semikolon og tab som delimiter — legacy brukte tab.
    const cells = raw.split(/[,;\t]/).map((c) => c.trim());
    // Forventet: hall_name, ticket_id, ticket_color, num1..num25 = 28 felt.
    if (cells.length !== 28) {
      throw new DomainError(
        "INVALID_INPUT",
        `Linje ${lineNumber}: forventet 28 kolonner (hall_name, ticket_id, ticket_color, 25 tall), fikk ${cells.length}.`,
      );
    }

    const hallName = cells[0]!;
    const ticketId = cells[1]!;
    const ticketColorRaw = cells[2]!;

    if (!hallName) {
      throw new DomainError("INVALID_INPUT", `Linje ${lineNumber}: hall_name er tom.`);
    }
    if (!ticketId) {
      throw new DomainError("INVALID_INPUT", `Linje ${lineNumber}: ticket_id er tom.`);
    }
    if (ticketId.length > 100) {
      throw new DomainError(
        "INVALID_INPUT",
        `Linje ${lineNumber}: ticket_id er for lang (maks 100 tegn).`,
      );
    }
    if (seenSerials.has(ticketId)) {
      throw new DomainError(
        "INVALID_INPUT",
        `Linje ${lineNumber}: duplicate ticket_id '${ticketId}' innen samme CSV-fil.`,
      );
    }
    seenSerials.add(ticketId);

    if (!ticketColorRaw) {
      throw new DomainError("INVALID_INPUT", `Linje ${lineNumber}: ticket_color er tom.`);
    }
    const colorFamily = deriveColorFamily(ticketColorRaw);

    const numbers: number[] = [];
    for (let i = 0; i < CARD_MATRIX_CELLS; i += 1) {
      const cell = cells[3 + i]!;
      const n = Number(cell);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new DomainError(
          "INVALID_INPUT",
          `Linje ${lineNumber}: num${i + 1} '${cell}' er ikke et heltall.`,
        );
      }
      if (n < MIN_NUMBER || n > MAX_NUMBER) {
        throw new DomainError(
          "INVALID_INPUT",
          `Linje ${lineNumber}: num${i + 1} = ${n}, må være ${MIN_NUMBER}-${MAX_NUMBER}.`,
        );
      }
      numbers.push(n);
    }

    parsed.push({
      lineNumber,
      ticketId,
      ticketType: ticketColorRaw.trim(),
      ticketColor: colorFamily,
      cardMatrix: numbers,
      hallNameInCsv: hallName,
    });
  }

  return parsed;
}

export class StaticTicketService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: StaticTicketServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "StaticTicketService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): StaticTicketService {
    const svc = Object.create(StaticTicketService.prototype) as StaticTicketService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_static_tickets"`;
  }

  private hallsTable(): string {
    return `"${this.schema}"."app_halls"`;
  }

  /**
   * Parser CSV-innhold, validerer alle rader, og gjør atomisk batch-insert
   * innen én transaksjon. Hvis én rad feiler valideringen, rulles hele
   * transaksjonen tilbake (all-or-nothing).
   *
   * Idempotens: eksisterende rader med samme (hall_id, ticket_serial,
   * ticket_color) overlever (ON CONFLICT DO NOTHING). Returneres som
   * `skipped` i resultatet.
   */
  async importFromCSV(csvContent: string, hallId: string): Promise<ImportResult> {
    if (!hallId?.trim()) {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    }
    const trimmedHallId = hallId.trim();

    // Valider hall eksisterer før vi parser — bedre feilmelding.
    const { rows: hallRows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM ${this.hallsTable()} WHERE id = $1`,
      [trimmedHallId],
    );
    if (hallRows.length === 0) {
      throw new DomainError(
        "HALL_NOT_FOUND",
        `Hall '${trimmedHallId}' finnes ikke.`,
      );
    }

    const parsedRows = parseStaticTicketCsv(csvContent);
    const totalRows = parsedRows.length;

    // Atomisk: BEGIN → INSERT alle → COMMIT. Ved feil rulles tilbake.
    const client = await this.pool.connect();
    let inserted = 0;
    let skipped = 0;
    try {
      await client.query("BEGIN");

      for (const row of parsedRows) {
        try {
          const result = await client.query<{ id: string }>(
            `INSERT INTO ${this.table()}
               (id, hall_id, ticket_serial, ticket_color, ticket_type, card_matrix)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT ON CONSTRAINT idx_app_static_tickets_hall_serial_color
               DO NOTHING
             RETURNING id`,
            [
              randomUUID(),
              trimmedHallId,
              row.ticketId,
              row.ticketColor,
              row.ticketType,
              JSON.stringify(row.cardMatrix),
            ],
          );
          if (result.rows.length > 0) {
            inserted += 1;
          } else {
            skipped += 1;
          }
        } catch (err) {
          // Kaster inne i transaksjonen → fanges under, rollback.
          throw new DomainError(
            "IMPORT_FAILED",
            `Linje ${row.lineNumber}: databasefeil ved innsetting (${(err as Error).message}).`,
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }

    logger.info(
      { hallId: trimmedHallId, totalRows, inserted, skipped },
      "[PT1] CSV-import fullført",
    );

    return {
      hallId: trimmedHallId,
      inserted,
      skipped,
      totalRows,
    };
  }

  /**
   * Finn én bong via fysisk barcode (ticket_serial). Merk: samme serial kan
   * eksistere for ulike farger og/eller haller — denne metoden søker *globalt*
   * fordi scan-situasjonen ikke vet hall-kontekst før oppslag. PT2+
   * validerer hall_id etterpå.
   *
   * Hvis mer enn én rad matcher serial (f.eks. samme serial i to haller),
   * returneres første treff sortert på (hall_id, ticket_color). Caller er
   * ansvarlig for å validere hall-scope. Dette matcher legacy-oppførsel.
   */
  async findByBarcode(barcode: string): Promise<StaticTicket | null> {
    if (!barcode?.trim()) {
      throw new DomainError("INVALID_INPUT", "barcode er påkrevd.");
    }
    const { rows } = await this.pool.query<StaticTicketRow>(
      `SELECT id, hall_id, ticket_serial, ticket_color, ticket_type, card_matrix,
              is_purchased, purchased_at, imported_at,
              sold_by_user_id, sold_from_range_id, responsible_user_id,
              sold_to_scheduled_game_id, reserved_by_range_id,
              paid_out_at, paid_out_amount_cents, paid_out_by_user_id
       FROM ${this.table()}
       WHERE ticket_serial = $1
       ORDER BY hall_id ASC, ticket_color ASC
       LIMIT 1`,
      [barcode.trim()],
    );
    const row = rows[0];
    return row ? this.map(row) : null;
  }

  /**
   * List tilgjengelige (usolgte, ikke-reserverte) bonger for (hall, color)
   * sortert på ticket_serial DESC. Brukes av PT2-range-registrering og
   * PT8-range-påfylling for å vite "hvilke serials er ledige fra toppen?".
   */
  async listAvailableByHallAndColor(
    hallId: string,
    color: StaticTicketColor,
    limit = 500,
  ): Promise<StaticTicket[]> {
    if (!hallId?.trim()) {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    }
    if (!VALID_COLORS.includes(color)) {
      throw new DomainError(
        "INVALID_INPUT",
        `color må være en av ${VALID_COLORS.join(", ")}.`,
      );
    }
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 5000));

    const { rows } = await this.pool.query<StaticTicketRow>(
      `SELECT id, hall_id, ticket_serial, ticket_color, ticket_type, card_matrix,
              is_purchased, purchased_at, imported_at,
              sold_by_user_id, sold_from_range_id, responsible_user_id,
              sold_to_scheduled_game_id, reserved_by_range_id,
              paid_out_at, paid_out_amount_cents, paid_out_by_user_id
       FROM ${this.table()}
       WHERE hall_id = $1
         AND ticket_color = $2
         AND is_purchased = false
         AND reserved_by_range_id IS NULL
       ORDER BY ticket_serial DESC
       LIMIT $3`,
      [hallId.trim(), color, safeLimit],
    );
    return rows.map((r) => this.map(r));
  }

  /**
   * Batch-oppdaterer bonger til is_purchased=true med tilhørende audit-felter.
   * Brukes av PT3 batch-salg. Kun bonger som:
   *   - tilhører oppgitt hall + farge, OG
   *   - matcher `reserved_by_range_id = soldFromRangeId`, OG
   *   - fortsatt har `is_purchased = false`
   * oppdateres. Dobbelsalg-beskyttelse: allerede solgte bonger inkluderes i
   * `alreadySold` i retursvaret slik at caller kan vise varsel.
   *
   * Transaksjonelt innen én statement (UPDATE ... RETURNING).
   */
  async bulkMarkSold(input: BulkMarkSoldInput): Promise<BulkMarkSoldResult> {
    if (!input.hallId?.trim()) {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    }
    if (!VALID_COLORS.includes(input.ticketColor)) {
      throw new DomainError(
        "INVALID_INPUT",
        `ticketColor må være en av ${VALID_COLORS.join(", ")}.`,
      );
    }
    if (!Array.isArray(input.ticketSerials) || input.ticketSerials.length === 0) {
      throw new DomainError("INVALID_INPUT", "ticketSerials må inneholde minst én serial.");
    }
    if (!input.soldByUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "soldByUserId er påkrevd.");
    }
    if (!input.soldFromRangeId?.trim()) {
      throw new DomainError("INVALID_INPUT", "soldFromRangeId er påkrevd.");
    }
    if (!input.responsibleUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "responsibleUserId er påkrevd.");
    }

    const hallId = input.hallId.trim();
    const serials = input.ticketSerials.map((s) => s.trim()).filter((s) => s.length > 0);
    if (serials.length === 0) {
      throw new DomainError("INVALID_INPUT", "ticketSerials inneholder kun tomme strenger.");
    }
    const scheduledGameId = input.soldToScheduledGameId?.trim() || null;

    // Finn evt. allerede solgte i listen (for varsel til caller).
    const { rows: existing } = await this.pool.query<{
      ticket_serial: string;
      is_purchased: boolean;
    }>(
      `SELECT ticket_serial, is_purchased
       FROM ${this.table()}
       WHERE hall_id = $1
         AND ticket_color = $2
         AND ticket_serial = ANY($3::text[])`,
      [hallId, input.ticketColor, serials],
    );
    const alreadySold = existing.filter((r) => r.is_purchased).map((r) => r.ticket_serial);
    const matched = existing.length;

    const { rows: updated } = await this.pool.query<{ id: string }>(
      `UPDATE ${this.table()}
          SET is_purchased = true,
              purchased_at = now(),
              sold_by_user_id = $4,
              sold_from_range_id = $5,
              responsible_user_id = $6,
              sold_to_scheduled_game_id = $7
       WHERE hall_id = $1
         AND ticket_color = $2
         AND ticket_serial = ANY($3::text[])
         AND is_purchased = false
         AND reserved_by_range_id = $5
       RETURNING id`,
      [
        hallId,
        input.ticketColor,
        serials,
        input.soldByUserId.trim(),
        input.soldFromRangeId.trim(),
        input.responsibleUserId.trim(),
        scheduledGameId,
      ],
    );

    return {
      matched,
      updated: updated.length,
      alreadySold,
    };
  }

  /**
   * BIN-17.32 "Past Game Winning History":
   * Lister billetter som er utbetalt (paid_out_at != NULL) innenfor et
   * dato-vindu, valgfritt filtrert på hall + ticket-serial-prefix.
   *
   * Merk:
   *   - Returnerer pre-trimmet liste; callsite (routes/agentReportsPastWinning.ts)
   *     kjører den videre gjennom `buildPastWinningHistory` for sortering +
   *     pagination. Grunnen er å holde DB-queryen rask og legge forretnings-
   *     logikken i en pure funksjon for testbarhet.
   *   - Max 5000 rader per oppslag — tunge perioder bør spesifisere en
   *     ticketId-prefix (vanlig agent-flow: fra daglig receipt-scan).
   */
  async listPaidOutInRange(filter: {
    hallId?: string;
    from: string;
    to: string;
    ticketIdPrefix?: string;
  }): Promise<StaticTicket[]> {
    if (!filter.from?.trim()) {
      throw new DomainError("INVALID_INPUT", "from er påkrevd.");
    }
    if (!filter.to?.trim()) {
      throw new DomainError("INVALID_INPUT", "to er påkrevd.");
    }
    const conditions: string[] = [
      "paid_out_at IS NOT NULL",
      "paid_out_at >= $1",
      "paid_out_at <= $2",
    ];
    const params: unknown[] = [filter.from, filter.to];
    if (filter.hallId?.trim()) {
      params.push(filter.hallId.trim());
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.ticketIdPrefix?.trim()) {
      params.push(`%${filter.ticketIdPrefix.trim()}%`);
      conditions.push(`ticket_serial ILIKE $${params.length}`);
    }
    const { rows } = await this.pool.query<StaticTicketRow>(
      `SELECT id, hall_id, ticket_serial, ticket_color, ticket_type, card_matrix,
              is_purchased, purchased_at, imported_at,
              sold_by_user_id, sold_from_range_id, responsible_user_id,
              sold_to_scheduled_game_id, reserved_by_range_id,
              paid_out_at, paid_out_amount_cents, paid_out_by_user_id
       FROM ${this.table()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY paid_out_at DESC
       LIMIT 5000`,
      params,
    );
    return rows.map((r) => this.map(r));
  }

  /**
   * PDF 17 §17.31 "Sold Ticket UI":
   * Lister billetter som er solgt (is_purchased=true, purchased_at i vinduet),
   * valgfritt filtrert på hall + ticket-serial-prefix.
   *
   * Forskjell fra `listPaidOutInRange`:
   *   - Inkluderer alle solgte (uavhengig av om de er utbetalt eller ikke).
   *   - Sortert på `purchased_at DESC` så agent ser nyeste salg først.
   *
   * Static-tickets representerer kun "Physical"-typen i wireframe-sammenheng.
   * "Terminal"/"Web" mappes til `app_physical_tickets` + online-flow og kan
   * legges til i en utvidelse hvis det blir aktuelt.
   *
   * Max 5000 rader per oppslag — samme ops-beskyttelse som listPaidOutInRange.
   */
  async listSoldInRange(filter: {
    hallId?: string;
    from: string;
    to: string;
    ticketIdPrefix?: string;
  }): Promise<StaticTicket[]> {
    if (!filter.from?.trim()) {
      throw new DomainError("INVALID_INPUT", "from er påkrevd.");
    }
    if (!filter.to?.trim()) {
      throw new DomainError("INVALID_INPUT", "to er påkrevd.");
    }
    const conditions: string[] = [
      "is_purchased = true",
      "purchased_at IS NOT NULL",
      "purchased_at >= $1",
      "purchased_at <= $2",
    ];
    const params: unknown[] = [filter.from, filter.to];
    if (filter.hallId?.trim()) {
      params.push(filter.hallId.trim());
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.ticketIdPrefix?.trim()) {
      params.push(`%${filter.ticketIdPrefix.trim()}%`);
      conditions.push(`ticket_serial ILIKE $${params.length}`);
    }
    const { rows } = await this.pool.query<StaticTicketRow>(
      `SELECT id, hall_id, ticket_serial, ticket_color, ticket_type, card_matrix,
              is_purchased, purchased_at, imported_at,
              sold_by_user_id, sold_from_range_id, responsible_user_id,
              sold_to_scheduled_game_id, reserved_by_range_id,
              paid_out_at, paid_out_amount_cents, paid_out_by_user_id
       FROM ${this.table()}
       WHERE ${conditions.join(" AND ")}
       ORDER BY purchased_at DESC
       LIMIT 5000`,
      params,
    );
    return rows.map((r) => this.map(r));
  }

  // ── Mapping ──────────────────────────────────────────────────────────────

  private map(r: StaticTicketRow): StaticTicket {
    // card_matrix kommer som JSONB — pg returnerer allerede parsed array.
    const matrix = Array.isArray(r.card_matrix) ? r.card_matrix : [];
    return {
      id: r.id,
      hallId: r.hall_id,
      ticketSerial: r.ticket_serial,
      ticketColor: r.ticket_color,
      ticketType: r.ticket_type,
      cardMatrix: matrix,
      isPurchased: r.is_purchased,
      purchasedAt: asIsoOrNull(r.purchased_at),
      importedAt: asIso(r.imported_at),
      soldByUserId: r.sold_by_user_id,
      soldFromRangeId: r.sold_from_range_id,
      responsibleUserId: r.responsible_user_id,
      soldToScheduledGameId: r.sold_to_scheduled_game_id,
      reservedByRangeId: r.reserved_by_range_id,
      paidOutAt: asIsoOrNull(r.paid_out_at),
      paidOutAmountCents: r.paid_out_amount_cents,
      paidOutByUserId: r.paid_out_by_user_id,
    };
  }
}

interface StaticTicketRow {
  id: string;
  hall_id: string;
  ticket_serial: string;
  ticket_color: StaticTicketColor;
  ticket_type: string;
  card_matrix: number[] | string;
  is_purchased: boolean;
  purchased_at: Date | string | null;
  imported_at: Date | string;
  sold_by_user_id: string | null;
  sold_from_range_id: string | null;
  responsible_user_id: string | null;
  sold_to_scheduled_game_id: string | null;
  reserved_by_range_id: string | null;
  paid_out_at: Date | string | null;
  paid_out_amount_cents: number | null;
  paid_out_by_user_id: string | null;
}
