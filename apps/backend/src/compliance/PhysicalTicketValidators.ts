/**
 * BIN-587 B4a: pure validators + parsers for PhysicalTicketService.
 *
 * Utskilt fra PhysicalTicketService.ts som del av S2-refactor. Alle funksjoner
 * er rene (ingen klasse-state-avhengighet) — brukes av service-klassen for
 * input-validering og row-parsing.
 */

import { DomainError } from "../errors/DomainError.js";
import {
  VALID_BATCH_STATUSES,
  VALID_PHYSICAL_TICKET_PATTERNS,
  type PhysicalBatchStatus,
  type PhysicalTicketPattern,
} from "./PhysicalTicketTypes.js";

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * BIN-698: parse `numbers_json` fra DB (JSONB → parsed array). Returnerer
 * null hvis verdien ikke er en array av 25 heltall (defense-in-depth).
 * pg-driver returnerer JSONB som allerede-parsed JS-objekt; eldre driver-
 * versjoner kan returnere string — begge støttes.
 */
export function parseNumbersJson(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  if (value.length !== 25) return null;
  const out: number[] = [];
  for (const v of value) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    out.push(n);
  }
  return out;
}

/** BIN-698: validér pattern-tekst fra DB mot whitelist. */
export function parsePattern(raw: string | null): PhysicalTicketPattern | null {
  if (raw === null) return null;
  return (VALID_PHYSICAL_TICKET_PATTERNS as readonly string[]).includes(raw)
    ? (raw as PhysicalTicketPattern)
    : null;
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

export function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

export function assertBatchStatus(value: unknown): PhysicalBatchStatus {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "status må være en streng.");
  }
  const upper = value.trim().toUpperCase() as PhysicalBatchStatus;
  if (!VALID_BATCH_STATUSES.includes(upper)) {
    throw new DomainError("INVALID_INPUT", `status må være én av ${VALID_BATCH_STATUSES.join(", ")}.`);
  }
  return upper;
}

export function assertPositiveInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et ikke-negativt heltall.`);
  }
  return n;
}

export function assertBatchName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "batchName er påkrevd.");
  }
  const trimmed = value.trim();
  if (trimmed.length > 120) {
    throw new DomainError("INVALID_INPUT", "batchName er for lang (maks 120 tegn).");
  }
  return trimmed;
}
