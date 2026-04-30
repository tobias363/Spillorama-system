/**
 * Excel Player Import — pure parser + validation logic.
 *
 * Used by `scripts/import-players-from-excel.ts` as a one-shot migration of
 * the ~6000 legacy players Tobias provides as an Excel file. Living in
 * `src/admin/` so the logic is type-checked by `npm run check` and unit-
 * tested by `tsx --test 'src/**\/*.test.ts'`.
 *
 * Background:
 *   docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md §22 / §9 +
 *   docs/architecture/WIREFRAME_CATALOG.md §16.1 (PDF 16). Tobias-decision
 *   2026-04-23: this is engangs-migrering, not a permanent admin upload UI.
 *
 * Two-mode design:
 *   - Mode 1 (THIS): one-shot CLI script (primær use-case).
 *   - Mode 2 (FUTURE): permanent admin upload UI — out-of-scope for now,
 *     but the parser interfaces are stable so the UI can re-use them.
 *
 * Required columns (case-insensitive header matching):
 *   Username        — display_name (no @ allowed)
 *   Email           — email (RFC-ish, optional if Phone is present)
 *   Phone Number    — Norwegian phone (optional if Email is present)
 *   Hall Number     — legacy hall number (matches app_halls.hall_number)
 *   Birth Date      — DD.MM.YYYY (Norwegian) or YYYY-MM-DD; optional.
 *
 * Optional columns:
 *   Surname / First Name / Last Name — surname; if missing, parsed from
 *   the username (legacy stored "Firstname Middle Lastname" combined).
 *
 * Validation rules (per WIREFRAME_CATALOG.md §16.1 Business Rules):
 *   - Email must be valid format if present.
 *   - Phone OR email must be present (one of them).
 *   - Duplicate detection: by email AND phone (both checked against DB).
 *   - Header row must include all required columns.
 *   - Photo ID is NOT required (legacy systems often had blanks).
 *   - Hall Number → app_halls.hall_number lookup; 0/blank → mainHallId
 *     (passed in via context). Unknown numbers → row error.
 */

import { normalizeNorwegianPhone } from "../auth/phoneValidation.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Header label set we look for. Matched case-insensitively after trim. */
export const COLUMN_ALIASES = {
  username: ["username", "brukernavn", "name", "navn", "full name"],
  email: ["email", "email address", "e-post", "epost", "mail"],
  phone: ["phone", "phone number", "telefon", "telefonnummer", "mobile"],
  hallNumber: ["hall number", "hall no", "hall id", "hall", "hallnummer"],
  surname: ["surname", "last name", "etternavn", "lastname"],
  firstName: ["first name", "firstname", "fornavn"],
  birthDate: ["birth date", "birthdate", "dob", "fødselsdato", "fodselsdato", "birthday"],
  customerNumber: ["customer number", "customer no", "kundenummer", "customer id"],
} as const;

export type ColumnKey = keyof typeof COLUMN_ALIASES;

/**
 * Header → column-key mapping after header detection.
 * Index = position of column in source row; value = canonical key.
 */
export type HeaderMap = ReadonlyMap<number, ColumnKey>;

/** Untyped Excel row as read from xlsx (string-coerced). */
export type RawRow = ReadonlyArray<string | number | null | undefined>;

/** A successfully parsed input row, ready for DB insert (after dup-check). */
export interface ParsedPlayerRow {
  rowNumber: number; // 1-indexed source row (header = row 1)
  email: string | null;
  phone: string | null; // normalized to +47XXXXXXXX
  displayName: string;
  surname: string | null;
  birthDate: string | null; // YYYY-MM-DD or null
  hallId: string | null; // resolved app_halls.id, null = unassigned
  customerNumber: string | null;
}

/** Per-row error from parser. The script writes these to a CSV report. */
export interface RowError {
  rowNumber: number;
  reason: string;
  rawValues: Record<string, string | number | null | undefined>;
}

export interface ParserContext {
  /**
   * Lookup table from legacy hall_number → app_halls.id.
   * Caller queries DB once, hands us the map.
   */
  hallNumberToId: ReadonlyMap<number, string>;
  /**
   * Fallback hall id when Hall Number is 0, blank, or null.
   * If null, blank Hall Number is rejected as INVALID_HALL_NUMBER.
   */
  mainHallId: string | null;
}

export interface ParseResult {
  rows: ParsedPlayerRow[];
  errors: RowError[];
  totalRowsRead: number;
}

// ── Header detection ─────────────────────────────────────────────────────────

/**
 * Build a column index → ColumnKey map from a header row. Unknown headers
 * are silently dropped. Throws if a required column is missing — required:
 * Username (always), Hall Number (always), and one of Email/Phone.
 */
export function detectHeaders(headerRow: RawRow): HeaderMap {
  const found = new Map<number, ColumnKey>();
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i];
    const label = typeof cell === "string" ? cell.trim().toLowerCase() : null;
    if (!label) continue;
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as [
      ColumnKey,
      readonly string[],
    ][]) {
      if (aliases.includes(label)) {
        // First match wins — so users can have multiple synonyms.
        if (!Array.from(found.values()).includes(key)) {
          found.set(i, key);
        }
      }
    }
  }
  // Required columns
  const presentKeys = new Set(found.values());
  if (!presentKeys.has("username")) {
    throw new Error(
      `Excel-header mangler kolonnen 'Username'. Akseptable navn: ${COLUMN_ALIASES.username.join(", ")}.`
    );
  }
  if (!presentKeys.has("hallNumber")) {
    throw new Error(
      `Excel-header mangler kolonnen 'Hall Number'. Akseptable navn: ${COLUMN_ALIASES.hallNumber.join(", ")}.`
    );
  }
  if (!presentKeys.has("email") && !presentKeys.has("phone")) {
    throw new Error(
      "Excel-header må ha minst én av kolonnene 'Email' og 'Phone Number'."
    );
  }
  return found;
}

// ── Per-row parsing ──────────────────────────────────────────────────────────

/** Read a cell as trimmed string, treating empty/null/'-' as null. */
function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    return String(value).trim() || null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;
  return trimmed;
}

/** Read a cell as integer, returning null if not parseable. */
function readInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    return Number.parseInt(trimmed, 10);
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Loose RFC-ish email validation. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/**
 * Parse a Norwegian birth-date in either YYYY-MM-DD or DD.MM.YYYY (with
 * `.` or `/` or `-` separator) — returns canonical YYYY-MM-DD or null.
 * Excel sometimes hands us a Date object via xlsx's cellDates; we accept
 * raw Date too.
 */
export function parseBirthDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Excel numeric date — leave null; should have used cellDates:true.
    return null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // ISO YYYY-MM-DD already?
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : trimmed;
  }
  // Norwegian DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const norMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (norMatch) {
    const [, dd, mm, yyyy] = norMatch as [string, string, string, string];
    const day = dd.padStart(2, "0");
    const month = mm.padStart(2, "0");
    const candidate = `${yyyy}-${month}-${day}`;
    const date = new Date(`${candidate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    // Sanity: Date constructor is forgiving (e.g. month=13 rolls over),
    // so verify components round-trip.
    if (
      date.getUTCFullYear() === Number(yyyy) &&
      date.getUTCMonth() + 1 === Number(mm) &&
      date.getUTCDate() === Number(dd)
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Split a legacy combined name (e.g. "Ola Nordmann" or "Ola Mellomnavn
 * Nordmann") into displayName + surname. Per WIREFRAME §16.1:
 *   2 ord → first / last
 *   3 ord → first / mid / last (display = first+mid, surname = last)
 *   4+ ord → first two as display, last two as surname
 */
export function splitLegacyName(combined: string): {
  displayName: string;
  surname: string | null;
} {
  const tokens = combined.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { displayName: "", surname: null };
  }
  if (tokens.length === 1) {
    return { displayName: tokens[0]!, surname: null };
  }
  if (tokens.length === 2) {
    return { displayName: tokens[0]!, surname: tokens[1]! };
  }
  if (tokens.length === 3) {
    return { displayName: `${tokens[0]} ${tokens[1]}`, surname: tokens[2]! };
  }
  // 4 or more: first two = display, last two = surname (per spec)
  const lastTwo = tokens.slice(-2).join(" ");
  const firstRest = tokens.slice(0, -2).join(" ");
  return { displayName: firstRest, surname: lastTwo };
}

/**
 * Parse a single Excel row (after the header row was consumed).
 *
 * Returns either ParsedPlayerRow OR a RowError. Caller separates into two
 * collections.
 */
export function parseRow(
  rawRow: RawRow,
  rowNumber: number,
  headers: HeaderMap,
  ctx: ParserContext
): ParsedPlayerRow | RowError {
  const cells: Record<ColumnKey, unknown> = {
    username: undefined,
    email: undefined,
    phone: undefined,
    hallNumber: undefined,
    surname: undefined,
    firstName: undefined,
    birthDate: undefined,
    customerNumber: undefined,
  };
  for (const [idx, key] of headers) {
    cells[key] = rawRow[idx];
  }

  const rawValues: Record<string, string | number | null | undefined> = {};
  for (const k of Object.keys(cells) as ColumnKey[]) {
    const v = cells[k];
    rawValues[k] = typeof v === "string" || typeof v === "number" || v === null || v === undefined ? v : String(v);
  }

  const rejection = (reason: string): RowError => ({
    rowNumber,
    reason,
    rawValues,
  });

  // 1. Username — required.
  const usernameRaw = readString(cells.username);
  if (!usernameRaw) {
    return rejection("MISSING_USERNAME");
  }

  // 2. Email + phone — at least one required.
  let email: string | null = null;
  const emailRaw = readString(cells.email);
  if (emailRaw) {
    const lower = emailRaw.toLowerCase();
    if (!isValidEmail(lower)) {
      return rejection(`INVALID_EMAIL: '${emailRaw}'`);
    }
    email = lower;
  }

  let phone: string | null = null;
  const phoneRaw = readString(cells.phone);
  if (phoneRaw) {
    try {
      phone = normalizeNorwegianPhone(phoneRaw);
    } catch (err) {
      return rejection(
        `INVALID_PHONE: '${phoneRaw}' (${(err as Error).message})`
      );
    }
  }

  if (!email && !phone) {
    return rejection("MISSING_CONTACT — krever Email eller Phone Number.");
  }

  // 3. Hall Number → hall_id resolution.
  const hallNumberRaw = cells.hallNumber;
  const hallNumberStr = readString(hallNumberRaw);
  let hallId: string | null;
  if (hallNumberStr === null) {
    // Blank → fallback to mainHallId (or reject).
    if (ctx.mainHallId === null) {
      return rejection("MISSING_HALL_NUMBER");
    }
    hallId = ctx.mainHallId;
  } else {
    const hallNumber = readInt(hallNumberStr);
    if (hallNumber === null) {
      return rejection(`INVALID_HALL_NUMBER: '${hallNumberStr}'`);
    }
    if (hallNumber === 0) {
      if (ctx.mainHallId === null) {
        return rejection("HALL_NUMBER_ZERO_NO_MAIN");
      }
      hallId = ctx.mainHallId;
    } else {
      const found = ctx.hallNumberToId.get(hallNumber);
      if (!found) {
        return rejection(`UNKNOWN_HALL_NUMBER: ${hallNumber}`);
      }
      hallId = found;
    }
  }

  // 4. Display name + surname split.
  let displayName: string;
  let surname: string | null;
  const explicitSurname = readString(cells.surname);
  const explicitFirst = readString(cells.firstName);
  if (explicitFirst && explicitSurname) {
    displayName = explicitFirst;
    surname = explicitSurname;
  } else if (explicitSurname) {
    displayName = usernameRaw;
    surname = explicitSurname;
  } else {
    const split = splitLegacyName(usernameRaw);
    displayName = split.displayName;
    surname = split.surname;
  }
  // Cap to safe lengths — assertions in PlatformService also enforce.
  if (!displayName || displayName.length > 40) {
    if (displayName.length > 40) displayName = displayName.slice(0, 40);
    if (!displayName) {
      return rejection("EMPTY_DISPLAY_NAME");
    }
  }
  if (surname && surname.length > 80) {
    surname = surname.slice(0, 80);
  }

  // 5. Birth date — optional; skip if invalid.
  let birthDate: string | null = null;
  const birthRaw = cells.birthDate;
  if (birthRaw !== null && birthRaw !== undefined && birthRaw !== "") {
    const parsed = parseBirthDate(birthRaw);
    if (parsed === null) {
      // Soft-fail: log warning via error but still import (birth date can
      // be filled in later by player). Strict-mode reject would be:
      //   return rejection(`INVALID_BIRTH_DATE: '${String(birthRaw)}'`);
      // Tobias preferred lenient (legacy data is messy), so we just skip.
      birthDate = null;
    } else {
      birthDate = parsed;
    }
  }

  const customerNumber = readString(cells.customerNumber);

  return {
    rowNumber,
    email,
    phone,
    displayName,
    surname,
    birthDate,
    hallId,
    customerNumber,
  };
}

// ── Whole-sheet parsing ──────────────────────────────────────────────────────

/**
 * Parse a complete sheet (header row + data rows).
 *
 * Performs ONLY in-memory validation (format + hall mapping). DB
 * idempotency (dup detection by email/phone) and DB insert happen in
 * the CLI driver — this function stays pure for unit-testability.
 */
export function parseSheet(
  rows: readonly RawRow[],
  ctx: ParserContext
): ParseResult {
  if (rows.length === 0) {
    return { rows: [], errors: [], totalRowsRead: 0 };
  }
  const headerRow = rows[0]!;
  const headers = detectHeaders(headerRow);
  const data = rows.slice(1);

  const parsedRows: ParsedPlayerRow[] = [];
  const errors: RowError[] = [];

  // Track in-batch duplicates so a sheet that mentions the same email twice
  // doesn't cause both inserts to compete in DB; second-occurrence becomes
  // a soft error.
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();

  data.forEach((row, idx) => {
    // Skip entirely-blank rows silently.
    const allBlank = row.every(
      (c) => c === null || c === undefined || (typeof c === "string" && c.trim() === "")
    );
    if (allBlank) return;

    const rowNumber = idx + 2; // header=1, first data=2
    const result = parseRow(row, rowNumber, headers, ctx);
    if ("reason" in result) {
      errors.push(result);
      return;
    }
    if (result.email) {
      if (seenEmails.has(result.email)) {
        errors.push({
          rowNumber,
          reason: `DUPLICATE_IN_BATCH_EMAIL: '${result.email}'`,
          rawValues: { email: result.email },
        });
        return;
      }
      seenEmails.add(result.email);
    }
    if (result.phone) {
      if (seenPhones.has(result.phone)) {
        errors.push({
          rowNumber,
          reason: `DUPLICATE_IN_BATCH_PHONE: '${result.phone}'`,
          rawValues: { phone: result.phone },
        });
        return;
      }
      seenPhones.add(result.phone);
    }
    parsedRows.push(result);
  });

  return { rows: parsedRows, errors, totalRowsRead: data.length };
}

// ── CSV report serializer (used by CLI driver) ───────────────────────────────

/** Excel-NO-friendly: UTF-8 BOM + CRLF, semicolon delimiter. */
const BOM = "﻿";
const CRLF = "\r\n";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[";\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeImportedCsv(rows: ParsedPlayerRow[]): string {
  const header = [
    "rowNumber",
    "displayName",
    "surname",
    "email",
    "phone",
    "birthDate",
    "hallId",
    "customerNumber",
  ];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.rowNumber,
        r.displayName,
        r.surname ?? "",
        r.email ?? "",
        r.phone ?? "",
        r.birthDate ?? "",
        r.hallId ?? "",
        r.customerNumber ?? "",
      ]
        .map(csvEscape)
        .join(";")
    );
  }
  return BOM + lines.join(CRLF) + CRLF;
}

export function serializeErrorsCsv(errors: RowError[]): string {
  const header = ["rowNumber", "reason", "rawValues"];
  const lines = [header.join(";")];
  for (const e of errors) {
    lines.push(
      [e.rowNumber, e.reason, JSON.stringify(e.rawValues)]
        .map(csvEscape)
        .join(";")
    );
  }
  return BOM + lines.join(CRLF) + CRLF;
}
