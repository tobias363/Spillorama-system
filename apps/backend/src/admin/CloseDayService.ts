/**
 * BIN-623 + BIN-700: CloseDay-service — regulatorisk dagsavslutning per
 * GameManagement med 3-mode-støtte (Single / Consecutive / Random).
 *
 * Ansvar:
 *   1) Aggregere et summary-snapshot for et spill (totalSold / totalEarning /
 *      winners / payouts / jackpots / tickets). I første iterasjon kommer
 *      feltene fra `app_game_management`-raden direkte; når BIN-622+
 *      normaliserer tickets/wins/jackpots til egne tabeller utvides
 *      kildene (se PR-body for design-valg).
 *   2) Lukke dagen (idempotent): én rad per (game_management_id, close_date).
 *      Unique-indeks i DB gir fail-fast på dobbel-lukking og service mapper
 *      feilen til `GAME_CLOSE_DAY_ALREADY_CLOSED`. Router gjør denne om til
 *      HTTP 409.
 *   3) Lukke flere dager i én operasjon (BIN-700):
 *        - Consecutive: start-23:59 første dag, 00:00-23:59 mellomdager,
 *          00:00-endTime siste dag (matcher legacy:10166-10186).
 *        - Random: liste av frittstående datoer; hver dato bruker default-
 *          vindu (00:00–23:59) eller per-dato-overstyring.
 *      `closeMany` er idempotent: re-run med samme datoer → ingen duplikater
 *      (eksisterende rader returneres uendret, nye persisteres).
 *   4) Per-dato oppdatering/sletting: `updateDate` + `deleteDate` lar hall-
 *      drifter justere tids-vinduet eller fjerne én bestemt dato uten å
 *      slette hele rangen.
 *
 * Merknader:
 *   - Audit-log-skriving ligger i router-laget (samme mønster som BIN-622
 *     GameManagement + BIN-665 HallGroup) slik at IP/UA er tilgjengelig.
 *     Service returnerer den persisterte entry-en inkl. summary slik at
 *     routerens audit-details matcher 1:1.
 *   - `closeDate` er YYYY-MM-DD (streng, validert). Vi lagrer som DATE i
 *     Postgres og konverterer ved utgangen for stabil wire-shape.
 *   - `startTime`/`endTime` er HH:MM (00:00-23:59). NULL betyr "hele dagen".
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  GameManagementService,
  GameManagement,
} from "./GameManagementService.js";

const logger = rootLogger.child({ module: "close-day-service" });

/** Snapshot-felter aggregert på lukketidspunkt. */
export interface CloseDaySummary {
  /** ID for spillet (matches input). */
  gameManagementId: string;
  /** ISO-dato (YYYY-MM-DD) summaryen gjelder for. */
  closeDate: string;
  /** `true` hvis spillet allerede er lukket for denne datoen. */
  alreadyClosed: boolean;
  /** Når allerede lukket: closedAt fra loggen. */
  closedAt: string | null;
  /** Når allerede lukket: closedBy fra loggen. */
  closedBy: string | null;
  /** GameManagement.totalSold (kopiert for stabilitet ved senere oppdatering). */
  totalSold: number;
  /** GameManagement.totalEarning. */
  totalEarning: number;
  /** Antall solgte billetter (v1: speil av totalSold til egne tabeller finnes). */
  ticketsSold: number;
  /** Antall vinnere (v1: 0 til vinner-tabell er normalisert). */
  winnersCount: number;
  /** Sum utbetalinger (v1: 0 til payout-tabell er normalisert). */
  payoutsTotal: number;
  /** Sum jackpot-utbetalinger (v1: 0 til jackpot-logg er normalisert). */
  jackpotsTotal: number;
  /** Når snapshot ble tatt (ISO-timestamp). */
  capturedAt: string;
}

/** Persistert close-day-rad. Summary-snapshot er inkludert. */
export interface CloseDayEntry {
  id: string;
  gameManagementId: string;
  closeDate: string;
  closedBy: string | null;
  closedAt: string;
  /** HH:MM (24t) — starten på lukke-vinduet. NULL = hele dagen. */
  startTime: string | null;
  /** HH:MM (24t) — slutten på lukke-vinduet. NULL = hele dagen. */
  endTime: string | null;
  /** Hall-operatør-notater (jul, påske, etc.). */
  notes: string | null;
  summary: CloseDaySummary;
}

/** Resultatet av en multi-dato-lukking. */
export interface CloseManyResult {
  /** Alle påvirkede entries i datostigende rekkefølge. */
  entries: CloseDayEntry[];
  /** Datoene som ble persisterte (nye INSERT'er). */
  createdDates: string[];
  /** Datoene som var lukket fra før (idempotent skip). */
  skippedDates: string[];
}

/** Single-mode: lukk én dato. Default-vindu = 00:00–23:59 hvis ikke spesifisert. */
export interface CloseSingleInput {
  mode: "single";
  gameManagementId: string;
  closeDate: string;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
  closedBy: string;
}

/**
 * Consecutive-mode: lukk dato-range fra startDate til endDate inkluderende.
 * Genererer ett rad per dag. Tids-vinduet bygges per legacy:10166-10186:
 *   - første dag:   startTime → "23:59"
 *   - mellomdager:  "00:00"   → "23:59"
 *   - siste dag:    "00:00"   → endTime
 * Hvis startDate == endDate (én-dags-range): bruk hele {startTime, endTime}.
 */
export interface CloseConsecutiveInput {
  mode: "consecutive";
  gameManagementId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
  closedBy: string;
}

/**
 * Random-mode: lukk en liste av frittstående (ikke-sammenhengende) datoer.
 * Default-vindu per dato = 00:00–23:59 (hele dagen). Per-dato-overstyring
 * mulig via `closeDates`-array av objekter.
 */
export interface CloseRandomInput {
  mode: "random";
  gameManagementId: string;
  closeDates: Array<
    | string
    | {
        closeDate: string;
        startTime?: string | null;
        endTime?: string | null;
      }
  >;
  /** Default-vindu hvis ikke spesifisert per dato. */
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
  closedBy: string;
}

export type CloseManyInput =
  | CloseSingleInput
  | CloseConsecutiveInput
  | CloseRandomInput;

/** Per-dato oppdatering: justér tids-vindu eller notes. */
export interface UpdateDateInput {
  gameManagementId: string;
  closeDate: string;
  /** undefined = ikke endre. NULL eksplisitt = sett til hele dagen. */
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
  /** Hvem som gjorde oppdateringen — for audit-log. */
  updatedBy: string;
}

export interface DeleteDateInput {
  gameManagementId: string;
  closeDate: string;
  /** Hvem som slettet — for audit-log. */
  deletedBy: string;
}

export interface CloseDayServiceOptions {
  connectionString: string;
  schema?: string;
  gameManagementService: GameManagementService;
}

interface CloseDayLogRow {
  id: string;
  game_management_id: string;
  close_date: Date | string;
  closed_by: string | null;
  summary_json: Record<string, unknown> | null;
  closed_at: Date | string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 366; // bevisst grense for feilbruk; ett år dekker alle pilot-cases.
const MAX_RANDOM_DATES = 100;
const MAX_NOTES_LEN = 500;

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertCloseDate(value: unknown, field = "closeDate"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (!DATE_PATTERN.test(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være på formatet YYYY-MM-DD.`
    );
  }
  // Parse-sanity: må være gyldig kalenderdato.
  const parsed = Date.parse(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new DomainError("INVALID_INPUT", `${field} er ikke en gyldig dato.`);
  }
  // Strengere: dato må round-trippe (avviser f.eks. 2026-02-30 som JS aksepterer).
  const round = isoDateFromUtcMs(parsed);
  if (round !== trimmed) {
    throw new DomainError("INVALID_INPUT", `${field} er ikke en gyldig dato.`);
  }
  return trimmed;
}

function assertGameId(value: unknown, field = "gameManagementId"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError("INVALID_INPUT", `${field} kan maksimalt være 200 tegn.`);
  }
  return trimmed;
}

function assertActor(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  return value.trim();
}

/**
 * Tids-streng-validering. NULL betyr "hele dagen". `optional`-flagget brukes
 * for update-flow der `undefined` = ikke endre, `null` = sett til "hele dagen".
 */
function assertTime(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} må være HH:MM eller null.`);
  }
  const trimmed = value.trim();
  if (!TIME_PATTERN.test(trimmed)) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være HH:MM (00:00–23:59).`
    );
  }
  return trimmed;
}

function assertNotes(value: unknown, field = "notes"): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${field} må være tekst eller null.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_NOTES_LEN) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${MAX_NOTES_LEN} tegn.`
    );
  }
  return trimmed;
}

function isoDateFromUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function asIsoDate(value: Date | string): string {
  if (typeof value === "string") {
    // Postgres returnerer DATE som "YYYY-MM-DD" — pass-through.
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  // Unngå tidssone-drift: format YYYY-MM-DD i UTC.
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function asIsoTimestamp(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function parseSummary(value: unknown): Partial<CloseDaySummary> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Partial<CloseDaySummary>;
}

/**
 * Generer alle datoer fra start..end inkluderende, sortert ascending. Bruker
 * UTC-millisekunder for å unngå tidssone-drift i månedsskifter.
 */
function enumerateDates(startDate: string, endDate: string): string[] {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (endMs < startMs) {
    throw new DomainError(
      "INVALID_INPUT",
      "endDate må være lik eller senere enn startDate."
    );
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const count = Math.floor((endMs - startMs) / dayMs) + 1;
  if (count > MAX_RANGE_DAYS) {
    throw new DomainError(
      "INVALID_INPUT",
      `Datoperioden er for lang (maksimalt ${MAX_RANGE_DAYS} dager).`
    );
  }
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(isoDateFromUtcMs(startMs + i * dayMs));
  }
  return out;
}

interface PlanItem {
  closeDate: string;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Bygg liste av {date, startTime, endTime} per legacy-regel for Consecutive.
 * Eneste dag: bruk fullt {startTime, endTime}.
 * Range: første dag → endTime forced "23:59"; siste → startTime forced
 * "00:00"; mellomdager → 00:00–23:59.
 */
function planConsecutive(input: CloseConsecutiveInput): PlanItem[] {
  const startDate = assertCloseDate(input.startDate, "startDate");
  const endDate = assertCloseDate(input.endDate, "endDate");
  const startTime = assertTime(input.startTime, "startTime");
  const endTime = assertTime(input.endTime, "endTime");
  if (startTime === null || endTime === null) {
    throw new DomainError(
      "INVALID_INPUT",
      "Consecutive-mode krever startTime og endTime (HH:MM)."
    );
  }
  const dates = enumerateDates(startDate, endDate);
  return dates.map((date, i) => {
    if (dates.length === 1) {
      return { closeDate: date, startTime, endTime };
    }
    if (i === 0) {
      return { closeDate: date, startTime, endTime: "23:59" };
    }
    if (i === dates.length - 1) {
      return { closeDate: date, startTime: "00:00", endTime };
    }
    return { closeDate: date, startTime: "00:00", endTime: "23:59" };
  });
}

function planRandom(input: CloseRandomInput): PlanItem[] {
  if (!Array.isArray(input.closeDates) || input.closeDates.length === 0) {
    throw new DomainError(
      "INVALID_INPUT",
      "Random-mode krever en ikke-tom closeDates-liste."
    );
  }
  if (input.closeDates.length > MAX_RANDOM_DATES) {
    throw new DomainError(
      "INVALID_INPUT",
      `Random-mode støtter maksimalt ${MAX_RANDOM_DATES} datoer.`
    );
  }
  const defaultStart = assertTime(input.startTime ?? null, "startTime");
  const defaultEnd = assertTime(input.endTime ?? null, "endTime");
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const raw of input.closeDates) {
    let date: string;
    let st: string | null;
    let et: string | null;
    if (typeof raw === "string") {
      date = assertCloseDate(raw, "closeDates[].closeDate");
      st = defaultStart;
      et = defaultEnd;
    } else if (raw && typeof raw === "object") {
      date = assertCloseDate(raw.closeDate, "closeDates[].closeDate");
      st =
        raw.startTime === undefined
          ? defaultStart
          : assertTime(raw.startTime, "closeDates[].startTime");
      et =
        raw.endTime === undefined
          ? defaultEnd
          : assertTime(raw.endTime, "closeDates[].endTime");
    } else {
      throw new DomainError(
        "INVALID_INPUT",
        "Hver closeDates-element må være streng eller objekt med closeDate."
      );
    }
    if (seen.has(date)) {
      throw new DomainError(
        "INVALID_INPUT",
        `Duplisert closeDate i Random-input: ${date}.`
      );
    }
    seen.add(date);
    items.push({ closeDate: date, startTime: st, endTime: et });
  }
  // Sortér ascending så audit + entries-utgang er deterministisk.
  items.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
  return items;
}

function planSingle(input: CloseSingleInput): PlanItem[] {
  const date = assertCloseDate(input.closeDate, "closeDate");
  // For Single-mode bruker vi det vinduet caller har spesifisert; hvis ikke
  // spesifisert (undefined) → null = "hele dagen". Eksplisitt null beholdes
  // som "hele dagen" også.
  const start =
    input.startTime === undefined
      ? null
      : assertTime(input.startTime, "startTime");
  const end =
    input.endTime === undefined ? null : assertTime(input.endTime, "endTime");
  return [{ closeDate: date, startTime: start, endTime: end }];
}

export class CloseDayService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly gameManagementService: GameManagementService;
  private initPromise: Promise<void> | null = null;

  constructor(options: CloseDayServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for CloseDayService."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.gameManagementService = options.gameManagementService;
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    gameManagementService: GameManagementService,
    schema = "public"
  ): CloseDayService {
    const svc = Object.create(CloseDayService.prototype) as CloseDayService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as {
      gameManagementService: GameManagementService;
    }).gameManagementService = gameManagementService;
    (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
    return svc;
  }

  private table(): string {
    return `"${this.schema}"."app_close_day_log"`;
  }

  /**
   * Bygg summary-snapshot for et spill. Inkluderer `alreadyClosed`-flagg
   * slik at admin-UI kan vise "dagen er allerede lukket"-banner før bruker
   * trykker bekreft.
   */
  async summary(gameIdRaw: string, closeDateRaw: string): Promise<CloseDaySummary> {
    await this.ensureInitialized();
    const gameId = assertGameId(gameIdRaw);
    const closeDate = assertCloseDate(closeDateRaw);
    const game = await this.gameManagementService.get(gameId);
    const existing = await this.findExisting(gameId, closeDate);
    return this.buildSummary(game, closeDate, existing);
  }

  /**
   * Lukk én dato (legacy-API, beholdt for backwards-compat). Idempotent-feiler:
   * dobbel-lukking → DomainError("CLOSE_DAY_ALREADY_CLOSED"). Router mapper til
   * 409 — callers som vil ha idempotent semantikk kan bruke `closeMany` eller
   * sjekke `summary().alreadyClosed` først.
   */
  async close(input: {
    gameManagementId: string;
    closeDate: string;
    closedBy: string;
    startTime?: string | null;
    endTime?: string | null;
    notes?: string | null;
  }): Promise<CloseDayEntry> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const closeDate = assertCloseDate(input.closeDate);
    const closedBy = assertActor(input.closedBy, "closedBy");
    const startTime =
      input.startTime === undefined
        ? null
        : assertTime(input.startTime, "startTime");
    const endTime =
      input.endTime === undefined ? null : assertTime(input.endTime, "endTime");
    const notes = assertNotes(input.notes ?? null);
    const game = await this.gameManagementService.get(gameId);
    if (game.deletedAt) {
      throw new DomainError(
        "GAME_MANAGEMENT_DELETED",
        "Kan ikke lukke dagen for et slettet spill."
      );
    }

    const existing = await this.findExisting(gameId, closeDate);
    if (existing) {
      throw new DomainError(
        "CLOSE_DAY_ALREADY_CLOSED",
        `Dagen ${closeDate} er allerede lukket for dette spillet.`
      );
    }

    const entry = await this.insertRow(
      game,
      closeDate,
      closedBy,
      startTime,
      endTime,
      notes
    );
    return entry;
  }

  /**
   * Lukk flere datoer i én operasjon (BIN-700). Idempotent: eksisterende
   * datoer hopper over (rapporteres i `skippedDates`), nye persisteres.
   * Audit-loggen til router skal skrive én entry per `createdDates`.
   */
  async closeMany(input: CloseManyInput): Promise<CloseManyResult> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const closedBy = assertActor(input.closedBy, "closedBy");
    let plan: PlanItem[];
    let notes: string | null;
    switch (input.mode) {
      case "single":
        plan = planSingle(input);
        notes = assertNotes(input.notes ?? null);
        break;
      case "consecutive":
        plan = planConsecutive(input);
        notes = assertNotes(input.notes ?? null);
        break;
      case "random":
        plan = planRandom(input);
        notes = assertNotes(input.notes ?? null);
        break;
      default: {
        // Eksaustivt: TypeScript fanger manglende case her ved kompileringen.
        const exhaustive: never = input;
        void exhaustive;
        throw new DomainError("INVALID_INPUT", "Ugyldig close-day-mode.");
      }
    }
    if (plan.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen datoer å lukke.");
    }

    const game = await this.gameManagementService.get(gameId);
    if (game.deletedAt) {
      throw new DomainError(
        "GAME_MANAGEMENT_DELETED",
        "Kan ikke lukke dagen for et slettet spill."
      );
    }

    // Hent alle eksisterende rader for de planlagte datoene i én query.
    const existingByDate = await this.findExistingMany(
      gameId,
      plan.map((p) => p.closeDate)
    );

    const entries: CloseDayEntry[] = [];
    const createdDates: string[] = [];
    const skippedDates: string[] = [];

    for (const item of plan) {
      const existing = existingByDate.get(item.closeDate);
      if (existing) {
        entries.push(existing);
        skippedDates.push(item.closeDate);
        continue;
      }
      try {
        const entry = await this.insertRow(
          game,
          item.closeDate,
          closedBy,
          item.startTime,
          item.endTime,
          notes
        );
        entries.push(entry);
        createdDates.push(item.closeDate);
      } catch (err) {
        // Race-condition: en parallell request kan ha lukket dagen mellom
        // findExistingMany og insertRow. Re-les og hopp over.
        if (
          err instanceof DomainError &&
          err.code === "CLOSE_DAY_ALREADY_CLOSED"
        ) {
          const refreshed = await this.findExisting(gameId, item.closeDate);
          if (refreshed) {
            entries.push(refreshed);
            skippedDates.push(item.closeDate);
            continue;
          }
        }
        throw err;
      }
    }

    return { entries, createdDates, skippedDates };
  }

  /**
   * Per-dato oppdatering: justér tids-vindu eller notes. Endrer ikke summary
   * eller closedBy/closedAt — disse er regulatorisk historikk.
   */
  async updateDate(input: UpdateDateInput): Promise<CloseDayEntry> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const closeDate = assertCloseDate(input.closeDate);
    assertActor(input.updatedBy, "updatedBy");

    const sets: string[] = [];
    const values: unknown[] = [gameId, closeDate];
    let idx = 3;

    if (input.startTime !== undefined) {
      const v = assertTime(input.startTime, "startTime");
      sets.push(`start_time = $${idx}`);
      values.push(v);
      idx += 1;
    }
    if (input.endTime !== undefined) {
      const v = assertTime(input.endTime, "endTime");
      sets.push(`end_time = $${idx}`);
      values.push(v);
      idx += 1;
    }
    if (input.notes !== undefined) {
      const v = assertNotes(input.notes);
      sets.push(`notes = $${idx}`);
      values.push(v);
      idx += 1;
    }

    if (sets.length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "Minst ett av startTime, endTime eller notes må oppgis."
      );
    }

    const { rows } = await this.pool.query<CloseDayLogRow>(
      `UPDATE ${this.table()}
       SET ${sets.join(", ")}
       WHERE game_management_id = $1 AND close_date = $2::date
       RETURNING id, game_management_id, close_date, closed_by, summary_json,
                 closed_at, start_time, end_time, notes`,
      values
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "CLOSE_DAY_NOT_FOUND",
        `Ingen close-day-rad for spill ${gameId} på dato ${closeDate}.`
      );
    }
    return this.map(row);
  }

  /**
   * Per-dato sletting: fjern én bestemt dato. Audit-loggen i router-laget
   * sørger for at slettet rad er regulatorisk dokumentert.
   */
  async deleteDate(input: DeleteDateInput): Promise<CloseDayEntry> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const closeDate = assertCloseDate(input.closeDate);
    assertActor(input.deletedBy, "deletedBy");

    const { rows } = await this.pool.query<CloseDayLogRow>(
      `DELETE FROM ${this.table()}
       WHERE game_management_id = $1 AND close_date = $2::date
       RETURNING id, game_management_id, close_date, closed_by, summary_json,
                 closed_at, start_time, end_time, notes`,
      [gameId, closeDate]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "CLOSE_DAY_NOT_FOUND",
        `Ingen close-day-rad for spill ${gameId} på dato ${closeDate}.`
      );
    }
    return this.map(row);
  }

  /**
   * List alle close-day-rader for et spill. Returnerer oldest-first så UI
   * kan rendre kalender-visningen direkte.
   */
  async listForGame(gameIdRaw: string): Promise<CloseDayEntry[]> {
    await this.ensureInitialized();
    const gameId = assertGameId(gameIdRaw);
    const { rows } = await this.pool.query<CloseDayLogRow>(
      `SELECT id, game_management_id, close_date, closed_by, summary_json,
              closed_at, start_time, end_time, notes
       FROM ${this.table()}
       WHERE game_management_id = $1
       ORDER BY close_date ASC`,
      [gameId]
    );
    return rows.map((r) => this.map(r));
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Insert én rad. Mapper 23505 → CLOSE_DAY_ALREADY_CLOSED. */
  private async insertRow(
    game: GameManagement,
    closeDate: string,
    closedBy: string,
    startTime: string | null,
    endTime: string | null,
    notes: string | null
  ): Promise<CloseDayEntry> {
    const summary = this.buildSummary(game, closeDate, null);
    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<CloseDayLogRow>(
        `INSERT INTO ${this.table()}
           (id, game_management_id, close_date, closed_by, summary_json,
            start_time, end_time, notes)
         VALUES ($1, $2, $3::date, $4, $5::jsonb, $6, $7, $8)
         RETURNING id, game_management_id, close_date, closed_by, summary_json,
                   closed_at, start_time, end_time, notes`,
        [
          id,
          game.id,
          closeDate,
          closedBy,
          JSON.stringify(summary),
          startTime,
          endTime,
          notes,
        ]
      );
      const row = rows[0];
      if (!row) {
        throw new DomainError(
          "CLOSE_DAY_INSERT_FAILED",
          "Kunne ikke lagre close-day-rad."
        );
      }
      return this.map(row);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      const message =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (message === "23505") {
        throw new DomainError(
          "CLOSE_DAY_ALREADY_CLOSED",
          `Dagen ${closeDate} er allerede lukket for dette spillet.`
        );
      }
      logger.error(
        { err, gameId: game.id, closeDate },
        "[BIN-623] close-day insert failed"
      );
      throw new DomainError(
        "CLOSE_DAY_INSERT_FAILED",
        "Kunne ikke lagre close-day-rad."
      );
    }
  }

  /** Helper: hent siste lukking for (gameId, date) eller null. */
  private async findExisting(
    gameId: string,
    closeDate: string
  ): Promise<CloseDayEntry | null> {
    const { rows } = await this.pool.query<CloseDayLogRow>(
      `SELECT id, game_management_id, close_date, closed_by, summary_json,
              closed_at, start_time, end_time, notes
       FROM ${this.table()}
       WHERE game_management_id = $1 AND close_date = $2::date
       LIMIT 1`,
      [gameId, closeDate]
    );
    return rows[0] ? this.map(rows[0]) : null;
  }

  /** Bulk-helper for closeMany: én SELECT for alle planlagte datoer. */
  private async findExistingMany(
    gameId: string,
    closeDates: string[]
  ): Promise<Map<string, CloseDayEntry>> {
    if (closeDates.length === 0) return new Map();
    const { rows } = await this.pool.query<CloseDayLogRow>(
      `SELECT id, game_management_id, close_date, closed_by, summary_json,
              closed_at, start_time, end_time, notes
       FROM ${this.table()}
       WHERE game_management_id = $1
         AND close_date = ANY($2::date[])`,
      [gameId, closeDates]
    );
    const map = new Map<string, CloseDayEntry>();
    for (const row of rows) {
      const e = this.map(row);
      map.set(e.closeDate, e);
    }
    return map;
  }

  /** Bygg summary fra kilde-data + eksisterende lukking (hvis finnes). */
  private buildSummary(
    game: GameManagement,
    closeDate: string,
    existing: CloseDayEntry | null
  ): CloseDaySummary {
    // Når dagen er lukket fra før: behold snapshotet slik det var på
    // lukketidspunktet (kopier ut fra summary_json) — ellers speiler vi
    // dagens live-tall fra GameManagement.
    if (existing) {
      const prior = existing.summary;
      return {
        gameManagementId: game.id,
        closeDate,
        alreadyClosed: true,
        closedAt: existing.closedAt,
        closedBy: existing.closedBy,
        totalSold: Number(prior.totalSold ?? game.totalSold),
        totalEarning: Number(prior.totalEarning ?? game.totalEarning),
        ticketsSold: Number(prior.ticketsSold ?? game.totalSold),
        winnersCount: Number(prior.winnersCount ?? 0),
        payoutsTotal: Number(prior.payoutsTotal ?? 0),
        jackpotsTotal: Number(prior.jackpotsTotal ?? 0),
        capturedAt: prior.capturedAt ?? existing.closedAt,
      };
    }
    return {
      gameManagementId: game.id,
      closeDate,
      alreadyClosed: false,
      closedAt: null,
      closedBy: null,
      totalSold: game.totalSold,
      totalEarning: game.totalEarning,
      ticketsSold: game.totalSold,
      winnersCount: 0,
      payoutsTotal: 0,
      jackpotsTotal: 0,
      capturedAt: new Date().toISOString(),
    };
  }

  private map(row: CloseDayLogRow): CloseDayEntry {
    const summaryRaw = parseSummary(row.summary_json);
    const closeDate = asIsoDate(row.close_date);
    const closedAt = asIsoTimestamp(row.closed_at);
    const summary: CloseDaySummary = {
      gameManagementId: row.game_management_id,
      closeDate,
      alreadyClosed: true,
      closedAt,
      closedBy: row.closed_by,
      totalSold: Number(summaryRaw.totalSold ?? 0),
      totalEarning: Number(summaryRaw.totalEarning ?? 0),
      ticketsSold: Number(summaryRaw.ticketsSold ?? 0),
      winnersCount: Number(summaryRaw.winnersCount ?? 0),
      payoutsTotal: Number(summaryRaw.payoutsTotal ?? 0),
      jackpotsTotal: Number(summaryRaw.jackpotsTotal ?? 0),
      capturedAt:
        typeof summaryRaw.capturedAt === "string" ? summaryRaw.capturedAt : closedAt,
    };
    return {
      id: row.id,
      gameManagementId: row.game_management_id,
      closeDate,
      closedBy: row.closed_by,
      closedAt,
      startTime: row.start_time,
      endTime: row.end_time,
      notes: row.notes,
      summary,
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.table()} (
          id TEXT PRIMARY KEY,
          game_management_id TEXT NOT NULL,
          close_date DATE NOT NULL,
          closed_by TEXT NULL,
          summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          start_time TEXT NULL,
          end_time TEXT NULL,
          notes TEXT NULL
        )`
      );
      // BIN-700: alter for eldre installasjoner som har den opprinnelige
      // BIN-623-tabellen uten tids-vindu/notes.
      await client.query(
        `ALTER TABLE ${this.table()}
           ADD COLUMN IF NOT EXISTS start_time TEXT NULL,
           ADD COLUMN IF NOT EXISTS end_time   TEXT NULL,
           ADD COLUMN IF NOT EXISTS notes      TEXT NULL`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_close_day_game_date
         ON ${this.table()}(game_management_id, close_date)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_close_day_game_recent
         ON ${this.table()}(game_management_id, closed_at DESC)`
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-623] close-day schema init failed");
      throw new DomainError(
        "CLOSE_DAY_INIT_FAILED",
        "Kunne ikke initialisere close-day-tabell."
      );
    } finally {
      client.release();
    }
  }
}
