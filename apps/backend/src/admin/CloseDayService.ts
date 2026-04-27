/**
 * BIN-623 + BIN-700 + REQ-116: CloseDay-service — regulatorisk dagsavslutning
 * per GameManagement med 4-mode-støtte (Single / Consecutive / Random /
 * Recurring).
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
 *   5) REQ-116 — Recurring patterns (PDF 8 §8.4 / BIR-058 / BIR-059):
 *      hall-driver setter opp permanent ukeplan ("alltid stengt mandager",
 *      "stengt første tirsdag i måneden", "stengt 1. juledag hvert år").
 *      Pattern lagres som parent-rad i `app_close_day_recurring_patterns`,
 *      og service expanderer alle individuelle datoer til child-rader i
 *      `app_close_day_log` med `recurring_pattern_id`-peker. DELETE av
 *      pattern soft-deleter parent + alle child-rader.
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
  /** REQ-116: parent-pattern-id hvis raden er expanded fra recurring. NULL ellers. */
  recurringPatternId: string | null;
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

/**
 * REQ-116: Recurring-mode pattern types. Discriminated union — service-laget
 * expanderer pattern til en liste av individuelle datoer.
 *
 *   - weekly:          { type, daysOfWeek }       — 0=Sun .. 6=Sat (eks: [1] = mandager)
 *   - monthly_dates:   { type, dates }            — 1..31 (31. feb hoppes over som no-op)
 *   - monthly_weekday: { type, week, dayOfWeek }  — week=1..4 eller "last", dayOfWeek=0..6
 *   - yearly:          { type, month, day }       — 1..12 + 1..31 (29. feb i ikke-skuddår = no-op)
 *   - daily:           { type }                   — alle dager i tidsrom
 */
export type RecurringPattern =
  | { type: "weekly"; daysOfWeek: number[] }
  | { type: "monthly_dates"; dates: number[] }
  | {
      type: "monthly_weekday";
      week: 1 | 2 | 3 | 4 | "last";
      dayOfWeek: number;
    }
  | { type: "yearly"; month: number; day: number }
  | { type: "daily" };

/**
 * REQ-116: Recurring-mode input. Pattern lagres som parent-rad og expanderes
 * til individuelle datoer som child-rader i `app_close_day_log`. Expansion-
 * vinduet styres av:
 *   - `startDate` (default: i dag)
 *   - `endDate`   (default: i dag + 366 dager)
 *   - `maxOccurrences` (default: 365)
 * Den minste av de tre stopper expansionen.
 */
export interface CloseRecurringInput {
  mode: "recurring";
  gameManagementId: string;
  pattern: RecurringPattern;
  /** YYYY-MM-DD. Default = i dag. */
  startDate?: string;
  /** YYYY-MM-DD. Default = i dag + 366 dager. */
  endDate?: string;
  /** Vindu-start brukt på alle expanderte child-rader. NULL = hele dagen. */
  startTime?: string | null;
  /** Vindu-slutt. NULL = hele dagen. */
  endTime?: string | null;
  notes?: string | null;
  /** Default 365. Cap'ed til 1000 for å unngå ekstrem expansion. */
  maxOccurrences?: number;
  closedBy: string;
}

/** REQ-116: persistert recurring-pattern. */
export interface RecurringPatternEntry {
  id: string;
  gameManagementId: string;
  pattern: RecurringPattern;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

/** REQ-116: resultat av en recurring-lukking — pattern-rad + expansion-resultat. */
export interface CloseRecurringResult extends CloseManyResult {
  pattern: RecurringPatternEntry;
  /** Antall expanderte datoer (= entries.length). */
  expandedCount: number;
}

export type CloseManyInput =
  | CloseSingleInput
  | CloseConsecutiveInput
  | CloseRandomInput
  | CloseRecurringInput;

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
  /** REQ-116: peker til parent-pattern hvis raden er expanded fra recurring. */
  recurring_pattern_id?: string | null;
}

/** REQ-116: rad-shape fra `app_close_day_recurring_patterns`. */
interface RecurringPatternRow {
  id: string;
  game_management_id: string;
  pattern_json: Record<string, unknown> | null;
  start_date: Date | string;
  end_date: Date | string | null;
  max_occurrences: number | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
  deleted_by: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 366; // bevisst grense for feilbruk; ett år dekker alle pilot-cases.
const MAX_RANDOM_DATES = 100;
const MAX_NOTES_LEN = 500;
// REQ-116: expansion-grenser. Default-cap er 365, hard cap (mot
// konfigurasjonsfeil) er 1000. End-date-default er startDate + 366 dager.
const RECURRING_DEFAULT_MAX_OCCURRENCES = 365;
const RECURRING_HARD_CAP_OCCURRENCES = 1000;
const RECURRING_DEFAULT_END_DATE_DAYS = 366;

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

/** REQ-116: pattern-id kommer fra route-param, må være ikke-tom og rimelig. */
function mustBePatternId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "patternId er påkrevd.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError(
      "INVALID_INPUT",
      "patternId kan maksimalt være 200 tegn."
    );
  }
  return trimmed;
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

/** REQ-116: legg til N dager til en YYYY-MM-DD-dato (UTC, inga DST-drift). */
function addDaysIso(dateIso: string, days: number): string {
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new DomainError("INVALID_INPUT", `Ugyldig dato: ${dateIso}.`);
  }
  return isoDateFromUtcMs(ms + days * 24 * 60 * 60 * 1000);
}

/**
 * REQ-116: dagens dato som YYYY-MM-DD (UTC). Brukes som default for
 * recurring-startDate. Hall-tidssone er ikke konfigurerbar pt. — UTC ≈
 * norsk vintertid (off by 1h i sommertid). Dokumentert som kjent avvik
 * (samme behandling som BIN-700 router-laget).
 */
function todayIsoUtc(): string {
  return isoDateFromUtcMs(Date.now());
}

/** REQ-116: hent ukedag (0=Sun .. 6=Sat) for en YYYY-MM-DD-dato i UTC. */
function dayOfWeekUtc(dateIso: string): number {
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new DomainError("INVALID_INPUT", `Ugyldig dato: ${dateIso}.`);
  }
  return new Date(ms).getUTCDay();
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

// ── REQ-116: Recurring pattern validation + expansion ────────────────────

/**
 * Strict-validate en RecurringPattern-input. Service-laget gjør deepvalidering
 * (avviser ugyldige felter, range-checker tall, krever non-tom array). Vi
 * casts ikke til typen før alle felter er sjekket — `unknown`-input fra
 * router-laget kan ikke krasje noen JS-runtime-eksepsjon.
 */
function assertRecurringPattern(value: unknown): RecurringPattern {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError(
      "INVALID_INPUT",
      "pattern må være et objekt med discriminator-felt 'type'."
    );
  }
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  switch (type) {
    case "weekly": {
      const days = obj.daysOfWeek;
      if (!Array.isArray(days) || days.length === 0) {
        throw new DomainError(
          "INVALID_INPUT",
          "weekly-pattern krever en ikke-tom daysOfWeek-array (0=Sun..6=Sat)."
        );
      }
      const seen = new Set<number>();
      const out: number[] = [];
      for (const d of days) {
        if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) {
          throw new DomainError(
            "INVALID_INPUT",
            "daysOfWeek må være integer 0..6 (0=Sun, 6=Sat)."
          );
        }
        if (seen.has(d)) {
          throw new DomainError(
            "INVALID_INPUT",
            `daysOfWeek inneholder duplisert verdi: ${d}.`
          );
        }
        seen.add(d);
        out.push(d);
      }
      return { type: "weekly", daysOfWeek: out.sort((a, b) => a - b) };
    }
    case "monthly_dates": {
      const dates = obj.dates;
      if (!Array.isArray(dates) || dates.length === 0) {
        throw new DomainError(
          "INVALID_INPUT",
          "monthly_dates-pattern krever en ikke-tom dates-array (1..31)."
        );
      }
      const seen = new Set<number>();
      const out: number[] = [];
      for (const d of dates) {
        if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 31) {
          throw new DomainError(
            "INVALID_INPUT",
            "monthly_dates: hvert element må være integer 1..31."
          );
        }
        if (seen.has(d)) {
          throw new DomainError(
            "INVALID_INPUT",
            `monthly_dates inneholder duplisert dato: ${d}.`
          );
        }
        seen.add(d);
        out.push(d);
      }
      return { type: "monthly_dates", dates: out.sort((a, b) => a - b) };
    }
    case "monthly_weekday": {
      const week = obj.week;
      const day = obj.dayOfWeek;
      if (week !== "last" && (typeof week !== "number" || ![1, 2, 3, 4].includes(week))) {
        throw new DomainError(
          "INVALID_INPUT",
          "monthly_weekday.week må være 1, 2, 3, 4 eller 'last'."
        );
      }
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
        throw new DomainError(
          "INVALID_INPUT",
          "monthly_weekday.dayOfWeek må være integer 0..6."
        );
      }
      return {
        type: "monthly_weekday",
        week: week as 1 | 2 | 3 | 4 | "last",
        dayOfWeek: day,
      };
    }
    case "yearly": {
      const month = obj.month;
      const day = obj.day;
      if (
        typeof month !== "number" ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "yearly.month må være integer 1..12."
        );
      }
      if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 31) {
        throw new DomainError(
          "INVALID_INPUT",
          "yearly.day må være integer 1..31."
        );
      }
      return { type: "yearly", month, day };
    }
    case "daily":
      return { type: "daily" };
    default:
      throw new DomainError(
        "INVALID_INPUT",
        `Ukjent recurring-pattern.type: ${String(type)}.`
      );
  }
}

/**
 * REQ-116: returner en stabil "kanonisk" pattern-JSON for persistering.
 * Sorterer arrays slik at lik input gir lik bytes-representasjon.
 */
function canonicalPatternJson(pattern: RecurringPattern): string {
  // assertRecurringPattern sorterer allerede arrays. Vi bygger objektet
  // manuelt for å få stabil property-rekkefølge.
  switch (pattern.type) {
    case "weekly":
      return JSON.stringify({ type: "weekly", daysOfWeek: pattern.daysOfWeek });
    case "monthly_dates":
      return JSON.stringify({ type: "monthly_dates", dates: pattern.dates });
    case "monthly_weekday":
      return JSON.stringify({
        type: "monthly_weekday",
        week: pattern.week,
        dayOfWeek: pattern.dayOfWeek,
      });
    case "yearly":
      return JSON.stringify({
        type: "yearly",
        month: pattern.month,
        day: pattern.day,
      });
    case "daily":
      return JSON.stringify({ type: "daily" });
    default: {
      const exhaustive: never = pattern;
      void exhaustive;
      throw new DomainError("INVALID_INPUT", "Ukjent pattern.type.");
    }
  }
}

/**
 * REQ-116: expansion-edge cases.
 *
 * monthly_dates: hvis dato 31 brukes, måneder med færre dager hopper over
 * (29. feb i ikke-skuddår, 30/31. apr etc.) — ingen "rolle over" til neste
 * måned. Dette matcher hall-driverens forventning ("30. hver måned, men
 * februar har ikke 30. så hopp over").
 *
 * monthly_weekday: "første mandag" = den 1. dagen i måneden av angitt
 * ukedag, regnet fra dato 1..7 i hver måned. "last fredag" = siste
 * forekomst av angitt ukedag i måneden (regnet fra siste dag i måned
 * og bakover, maks 7 dager tilbake).
 *
 * yearly: hvis pattern er { month: 2, day: 29 } i ikke-skuddår hopper
 * vi over.
 *
 * Alle datoer som passer pattern OG ligger i [start, end] returneres,
 * ascending sortert. Cap'es til `maxOccurrences`.
 */
function expandPattern(
  pattern: RecurringPattern,
  startDate: string,
  endDate: string,
  maxOccurrences: number
): string[] {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new DomainError("INVALID_INPUT", "Ugyldig dato i expansion-vindu.");
  }
  if (endMs < startMs) {
    throw new DomainError(
      "INVALID_INPUT",
      "endDate må være lik eller senere enn startDate."
    );
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const out: string[] = [];

  switch (pattern.type) {
    case "daily": {
      // Iterér dag for dag, plukk alt.
      for (let ms = startMs; ms <= endMs; ms += dayMs) {
        out.push(isoDateFromUtcMs(ms));
        if (out.length >= maxOccurrences) return out;
      }
      return out;
    }
    case "weekly": {
      const days = new Set(pattern.daysOfWeek);
      for (let ms = startMs; ms <= endMs; ms += dayMs) {
        const dow = new Date(ms).getUTCDay();
        if (days.has(dow)) {
          out.push(isoDateFromUtcMs(ms));
          if (out.length >= maxOccurrences) return out;
        }
      }
      return out;
    }
    case "monthly_dates": {
      const startDate0 = new Date(startMs);
      const endDate0 = new Date(endMs);
      let year = startDate0.getUTCFullYear();
      let month = startDate0.getUTCMonth(); // 0..11
      const endYear = endDate0.getUTCFullYear();
      const endMonth = endDate0.getUTCMonth();
      while (
        year < endYear ||
        (year === endYear && month <= endMonth)
      ) {
        const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        for (const d of pattern.dates) {
          if (d > lastDayOfMonth) continue; // 31. feb / 31. apr → no-op
          const candidateMs = Date.UTC(year, month, d);
          if (candidateMs >= startMs && candidateMs <= endMs) {
            out.push(isoDateFromUtcMs(candidateMs));
            if (out.length >= maxOccurrences) return out;
          }
        }
        // neste måned
        if (month === 11) {
          month = 0;
          year += 1;
        } else {
          month += 1;
        }
      }
      // monthly_dates kan generere en dato per måned-iterasjon i
      // ikke-monoton rekkefølge hvis brukeren har dates=[5,1] (vi
      // sorterer i validering, men cross-month overlapp er trygt). Sortér
      // for å være eksplisitt.
      out.sort();
      return out;
    }
    case "monthly_weekday": {
      const startDate0 = new Date(startMs);
      const endDate0 = new Date(endMs);
      let year = startDate0.getUTCFullYear();
      let month = startDate0.getUTCMonth();
      const endYear = endDate0.getUTCFullYear();
      const endMonth = endDate0.getUTCMonth();
      while (year < endYear || (year === endYear && month <= endMonth)) {
        let candidateDay: number | null = null;
        if (pattern.week === "last") {
          // Siste forekomst av dayOfWeek i måneden
          const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          for (let d = lastDay; d >= lastDay - 6; d -= 1) {
            const dow = new Date(Date.UTC(year, month, d)).getUTCDay();
            if (dow === pattern.dayOfWeek) {
              candidateDay = d;
              break;
            }
          }
        } else {
          // n-te forekomst (n = 1..4)
          // Finn første forekomst i måneden, legg til (n-1) uker
          const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
          const offset = (pattern.dayOfWeek - firstDow + 7) % 7;
          const firstOccurrenceDay = 1 + offset;
          const candidate = firstOccurrenceDay + (pattern.week - 1) * 7;
          const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          if (candidate <= lastDayOfMonth) candidateDay = candidate;
          // Hvis week=4 men måned ikke har 4 forekomster (kan ikke skje for 28+ dagers
          // måned), candidateDay forblir null → hopp over.
        }
        if (candidateDay !== null) {
          const ms = Date.UTC(year, month, candidateDay);
          if (ms >= startMs && ms <= endMs) {
            out.push(isoDateFromUtcMs(ms));
            if (out.length >= maxOccurrences) return out;
          }
        }
        if (month === 11) {
          month = 0;
          year += 1;
        } else {
          month += 1;
        }
      }
      return out;
    }
    case "yearly": {
      const startDate0 = new Date(startMs);
      const endDate0 = new Date(endMs);
      const startYear = startDate0.getUTCFullYear();
      const endYear = endDate0.getUTCFullYear();
      for (let y = startYear; y <= endYear; y += 1) {
        // Validér at dato finnes i året (29. feb i ikke-skuddår = ugyldig)
        const lastDayOfMonth = new Date(Date.UTC(y, pattern.month, 0)).getUTCDate();
        if (pattern.day > lastDayOfMonth) continue; // 29. feb i ikke-skuddår
        const ms = Date.UTC(y, pattern.month - 1, pattern.day);
        if (ms >= startMs && ms <= endMs) {
          out.push(isoDateFromUtcMs(ms));
          if (out.length >= maxOccurrences) return out;
        }
      }
      return out;
    }
    default: {
      const exhaustive: never = pattern;
      void exhaustive;
      throw new DomainError("INVALID_INPUT", "Ukjent pattern.type.");
    }
  }
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
      notes,
      null
    );
    return entry;
  }

  /**
   * Lukk flere datoer i én operasjon (BIN-700 + REQ-116). Idempotent:
   * eksisterende datoer hopper over (rapporteres i `skippedDates`), nye
   * persisteres. Audit-loggen til router skal skrive én entry per
   * `createdDates`.
   *
   * REQ-116: når `mode = "recurring"` deleger til `closeRecurring` som
   * oppretter en parent-rad (pattern) og expanderer alle individuelle
   * datoer som child-rader. Returnerer da en `CloseRecurringResult`
   * (super-set av CloseManyResult med `pattern` + `expandedCount`).
   */
  async closeMany(
    input: CloseManyInput
  ): Promise<CloseManyResult | CloseRecurringResult> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const closedBy = assertActor(input.closedBy, "closedBy");

    if (input.mode === "recurring") {
      return this.closeRecurring(input);
    }

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
          notes,
          null
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
   * REQ-116: lagre en recurring-pattern + expandér alle individuelle datoer
   * som child-rader i `app_close_day_log`. Idempotent på (gameId, dato) —
   * datoer som allerede er lukket (manuelt eller via en annen pattern)
   * hoppes over i `skippedDates`.
   *
   * Pattern-raden i `app_close_day_recurring_patterns` lagres ALLTID, selv
   * om expansion ga 0 nye child-rader, slik at hall-driveren kan se at
   * pattern eksisterer og slette den senere.
   */
  async closeRecurring(input: CloseRecurringInput): Promise<CloseRecurringResult> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const closedBy = assertActor(input.closedBy, "closedBy");
    const pattern = assertRecurringPattern(input.pattern);

    // Validér start/end-vindu — defaults dokumentert i REQ-116.
    const startDate = input.startDate
      ? assertCloseDate(input.startDate, "startDate")
      : todayIsoUtc();
    const endDate = input.endDate
      ? assertCloseDate(input.endDate, "endDate")
      : addDaysIso(startDate, RECURRING_DEFAULT_END_DATE_DAYS);

    if (Date.parse(`${endDate}T00:00:00Z`) < Date.parse(`${startDate}T00:00:00Z`)) {
      throw new DomainError(
        "INVALID_INPUT",
        "endDate må være lik eller senere enn startDate."
      );
    }

    let maxOccurrences = RECURRING_DEFAULT_MAX_OCCURRENCES;
    if (input.maxOccurrences !== undefined) {
      if (
        typeof input.maxOccurrences !== "number" ||
        !Number.isInteger(input.maxOccurrences) ||
        input.maxOccurrences < 1
      ) {
        throw new DomainError(
          "INVALID_INPUT",
          "maxOccurrences må være positivt heltall."
        );
      }
      if (input.maxOccurrences > RECURRING_HARD_CAP_OCCURRENCES) {
        throw new DomainError(
          "INVALID_INPUT",
          `maxOccurrences kan maks være ${RECURRING_HARD_CAP_OCCURRENCES}.`
        );
      }
      maxOccurrences = input.maxOccurrences;
    }

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

    // 1) Persistér parent-rad. Dette er regulatorisk — selv om expansion
    //    ga 0 datoer skal pattern være synlig i admin-UI.
    const patternId = randomUUID();
    const patternEntry = await this.insertRecurringPattern({
      id: patternId,
      gameManagementId: gameId,
      pattern,
      startDate,
      endDate,
      maxOccurrences,
      startTime,
      endTime,
      notes,
      createdBy: closedBy,
    });

    // 2) Expandér.
    const expandedDates = expandPattern(pattern, startDate, endDate, maxOccurrences);
    if (expandedDates.length === 0) {
      // Ingen datoer matchet — pattern lagret, men ingen child-rader.
      return {
        pattern: patternEntry,
        entries: [],
        createdDates: [],
        skippedDates: [],
        expandedCount: 0,
      };
    }

    // 3) Sjekk eksisterende child-rader (idempotent).
    const existingByDate = await this.findExistingMany(gameId, expandedDates);

    const entries: CloseDayEntry[] = [];
    const createdDates: string[] = [];
    const skippedDates: string[] = [];

    for (const date of expandedDates) {
      const existing = existingByDate.get(date);
      if (existing) {
        entries.push(existing);
        skippedDates.push(date);
        continue;
      }
      try {
        const entry = await this.insertRow(
          game,
          date,
          closedBy,
          startTime,
          endTime,
          notes,
          patternId
        );
        entries.push(entry);
        createdDates.push(date);
      } catch (err) {
        if (
          err instanceof DomainError &&
          err.code === "CLOSE_DAY_ALREADY_CLOSED"
        ) {
          const refreshed = await this.findExisting(gameId, date);
          if (refreshed) {
            entries.push(refreshed);
            skippedDates.push(date);
            continue;
          }
        }
        throw err;
      }
    }

    return {
      pattern: patternEntry,
      entries,
      createdDates,
      skippedDates,
      expandedCount: expandedDates.length,
    };
  }

  /**
   * REQ-116: list aktive recurring-patterns for et spill (deleted_at IS NULL).
   */
  async listRecurringPatterns(gameIdRaw: string): Promise<RecurringPatternEntry[]> {
    await this.ensureInitialized();
    const gameId = assertGameId(gameIdRaw);
    const { rows } = await this.pool.query<RecurringPatternRow>(
      `SELECT id, game_management_id, pattern_json, start_date, end_date,
              max_occurrences, start_time, end_time, notes, created_by,
              created_at, deleted_at, deleted_by
       FROM ${this.recurringTable()}
       WHERE game_management_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [gameId]
    );
    return rows.map((r) => this.mapRecurringPattern(r));
  }

  /**
   * REQ-116: soft-delete pattern + alle expanded child-rader. Returnerer
   * pattern-raden + antall child-rader som ble slettet.
   *
   * Soft-delete på pattern bevarer regulatorisk historikk (hvem opprettet,
   * når, hvilken pattern). Child-rader hard-slettes fordi de ikke har
   * regulatorisk verdi separat fra pattern (lukke-dagen ble jo aldri
   * gjennomført — dette var planlagte fremtidige stengning-dager). Skulle
   * en child-rad allerede ha "operert" (hall var faktisk stengt på dato)
   * skriver hall-driveren manuelt en ny single close-day-rad uten pattern-
   * peker for å beholde sporet — det er allerede regulatorisk dokumentert
   * via audit-loggen.
   */
  async deleteRecurringPattern(input: {
    gameManagementId: string;
    patternId: string;
    deletedBy: string;
  }): Promise<{ pattern: RecurringPatternEntry; deletedChildCount: number }> {
    await this.ensureInitialized();
    const gameId = assertGameId(input.gameManagementId);
    const patternId = mustBePatternId(input.patternId);
    const deletedBy = assertActor(input.deletedBy, "deletedBy");

    // Soft-delete pattern. Idempotent: hvis allerede slettet, returnér uendret.
    const { rows: patternRows } = await this.pool.query<RecurringPatternRow>(
      `UPDATE ${this.recurringTable()}
         SET deleted_at = COALESCE(deleted_at, now()),
             deleted_by = COALESCE(deleted_by, $3)
       WHERE id = $1 AND game_management_id = $2
       RETURNING id, game_management_id, pattern_json, start_date, end_date,
                 max_occurrences, start_time, end_time, notes, created_by,
                 created_at, deleted_at, deleted_by`,
      [patternId, gameId, deletedBy]
    );
    const patternRow = patternRows[0];
    if (!patternRow) {
      throw new DomainError(
        "CLOSE_DAY_RECURRING_NOT_FOUND",
        `Ingen recurring-pattern med id ${patternId} for spill ${gameId}.`
      );
    }

    // Hard-slett child-rader (alle close-day-log-rader med recurring_pattern_id).
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${this.table()}
       WHERE game_management_id = $1 AND recurring_pattern_id = $2`,
      [gameId, patternId]
    );

    return {
      pattern: this.mapRecurringPattern(patternRow),
      deletedChildCount: rowCount ?? 0,
    };
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
                 closed_at, start_time, end_time, notes, recurring_pattern_id`,
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
                 closed_at, start_time, end_time, notes, recurring_pattern_id`,
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
              closed_at, start_time, end_time, notes, recurring_pattern_id
       FROM ${this.table()}
       WHERE game_management_id = $1
       ORDER BY close_date ASC`,
      [gameId]
    );
    return rows.map((r) => this.map(r));
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Insert én rad. Mapper 23505 → CLOSE_DAY_ALREADY_CLOSED.
   * REQ-116: `recurringPatternId` (optional) peker til parent-pattern hvis
   * raden ble generert via recurring-expansion. NULL for manuelle lukkinger.
   */
  private async insertRow(
    game: GameManagement,
    closeDate: string,
    closedBy: string,
    startTime: string | null,
    endTime: string | null,
    notes: string | null,
    recurringPatternId: string | null
  ): Promise<CloseDayEntry> {
    const summary = this.buildSummary(game, closeDate, null);
    const id = randomUUID();
    try {
      const { rows } = await this.pool.query<CloseDayLogRow>(
        `INSERT INTO ${this.table()}
           (id, game_management_id, close_date, closed_by, summary_json,
            start_time, end_time, notes, recurring_pattern_id)
         VALUES ($1, $2, $3::date, $4, $5::jsonb, $6, $7, $8, $9)
         RETURNING id, game_management_id, close_date, closed_by, summary_json,
                   closed_at, start_time, end_time, notes, recurring_pattern_id`,
        [
          id,
          game.id,
          closeDate,
          closedBy,
          JSON.stringify(summary),
          startTime,
          endTime,
          notes,
          recurringPatternId,
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

  // ── REQ-116: recurring pattern helpers ────────────────────────────────

  private recurringTable(): string {
    return `"${this.schema}"."app_close_day_recurring_patterns"`;
  }

  private async insertRecurringPattern(input: {
    id: string;
    gameManagementId: string;
    pattern: RecurringPattern;
    startDate: string;
    endDate: string | null;
    maxOccurrences: number | null;
    startTime: string | null;
    endTime: string | null;
    notes: string | null;
    createdBy: string;
  }): Promise<RecurringPatternEntry> {
    try {
      const { rows } = await this.pool.query<RecurringPatternRow>(
        `INSERT INTO ${this.recurringTable()}
           (id, game_management_id, pattern_json, start_date, end_date,
            max_occurrences, start_time, end_time, notes, created_by)
         VALUES ($1, $2, $3::jsonb, $4::date, $5::date, $6, $7, $8, $9, $10)
         RETURNING id, game_management_id, pattern_json, start_date, end_date,
                   max_occurrences, start_time, end_time, notes, created_by,
                   created_at, deleted_at, deleted_by`,
        [
          input.id,
          input.gameManagementId,
          canonicalPatternJson(input.pattern),
          input.startDate,
          input.endDate,
          input.maxOccurrences,
          input.startTime,
          input.endTime,
          input.notes,
          input.createdBy,
        ]
      );
      const row = rows[0];
      if (!row) {
        throw new DomainError(
          "CLOSE_DAY_RECURRING_INSERT_FAILED",
          "Kunne ikke lagre recurring-pattern."
        );
      }
      return this.mapRecurringPattern(row);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      logger.error(
        { err, gameId: input.gameManagementId },
        "[REQ-116] recurring-pattern insert failed"
      );
      throw new DomainError(
        "CLOSE_DAY_RECURRING_INSERT_FAILED",
        "Kunne ikke lagre recurring-pattern."
      );
    }
  }

  private mapRecurringPattern(row: RecurringPatternRow): RecurringPatternEntry {
    let pattern: RecurringPattern;
    try {
      pattern = assertRecurringPattern(row.pattern_json);
    } catch {
      // Defensiv: hvis DB inneholder en pattern som ikke validerer (eks fra
      // tidligere spec-versjon), behandle som "daily" og logg en advarsel.
      // I praksis vil dette aldri skje fordi vi alltid skriver canonical-form.
      logger.warn(
        { row_id: row.id, pattern_json: row.pattern_json },
        "[REQ-116] recurring-pattern JSON failed validation, falling back to daily"
      );
      pattern = { type: "daily" };
    }
    return {
      id: row.id,
      gameManagementId: row.game_management_id,
      pattern,
      startDate: asIsoDate(row.start_date),
      endDate: row.end_date === null ? null : asIsoDate(row.end_date),
      maxOccurrences: row.max_occurrences,
      startTime: row.start_time,
      endTime: row.end_time,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: asIsoTimestamp(row.created_at),
      deletedAt: row.deleted_at === null ? null : asIsoTimestamp(row.deleted_at),
      deletedBy: row.deleted_by,
    };
  }

  /** Helper: hent siste lukking for (gameId, date) eller null. */
  private async findExisting(
    gameId: string,
    closeDate: string
  ): Promise<CloseDayEntry | null> {
    const { rows } = await this.pool.query<CloseDayLogRow>(
      `SELECT id, game_management_id, close_date, closed_by, summary_json,
              closed_at, start_time, end_time, notes, recurring_pattern_id
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
              closed_at, start_time, end_time, notes, recurring_pattern_id
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
      recurringPatternId: row.recurring_pattern_id ?? null,
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
      // REQ-116: legg til recurring_pattern_id-kolonne (nullable FK).
      await client.query(
        `ALTER TABLE ${this.table()}
           ADD COLUMN IF NOT EXISTS recurring_pattern_id TEXT NULL`
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${this.schema}_close_day_game_date
         ON ${this.table()}(game_management_id, close_date)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_close_day_game_recent
         ON ${this.table()}(game_management_id, closed_at DESC)`
      );
      // REQ-116: parent-tabell for recurring patterns + støttende indekser.
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.recurringTable()} (
          id TEXT PRIMARY KEY,
          game_management_id TEXT NOT NULL,
          pattern_json JSONB NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NULL,
          max_occurrences INTEGER NULL,
          start_time TEXT NULL,
          end_time TEXT NULL,
          notes TEXT NULL,
          created_by TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ NULL,
          deleted_by TEXT NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_close_day_recurring_active
         ON ${this.recurringTable()}(game_management_id)
         WHERE deleted_at IS NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_close_day_log_recurring
         ON ${this.table()}(recurring_pattern_id)
         WHERE recurring_pattern_id IS NOT NULL`
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
