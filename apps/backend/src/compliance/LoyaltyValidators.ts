/**
 * BIN-700: pure validators + helpers for LoyaltyService.
 *
 * Utskilt fra LoyaltyService.ts som del av loyalty-service-split-refactor.
 * Alle funksjoner er rene (ingen klasse-state-avhengighet) — brukes av
 * service-klassen for input-validering, date-helpers og row-normalisering.
 */

import { DomainError } from "../game/BingoEngine.js";

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

export function assertNonEmptyString(
  value: unknown,
  field: string,
  max = 200
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} kan maksimalt være ${max} tegn.`
    );
  }
  return trimmed;
}

export function assertPositiveInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et positivt heltall.`
    );
  }
  return n;
}

export function assertNonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et ikke-negativt heltall.`
    );
  }
  return n;
}

export function assertIntOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et ikke-negativt heltall eller null.`
    );
  }
  return n;
}

export function assertInteger(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et heltall.`);
  }
  return n;
}

export function assertObject(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", `${field} må være et objekt.`);
  }
  return value as Record<string, unknown>;
}

export function monthKeyFromDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code: unknown }).code === "23505";
  }
  return false;
}
