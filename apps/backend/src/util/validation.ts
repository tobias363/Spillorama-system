/**
 * BIN-167: Shared request validation helpers extracted from index.ts.
 */

import { DomainError } from "../game/BingoEngine.js";

export function mustBeNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
  }
  return value.trim();
}

export function mustBePositiveAmount(value: unknown, fieldName = "amount"): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} ma vaere storre enn 0.`);
  }
  return amount;
}

export function parseOptionalNonNegativeAmount(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new DomainError("INVALID_INPUT", "initialBalance ma vaere 0 eller storre.");
  }
  return amount;
}

export function parseOptionalNonNegativeNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} ma vaere 0 eller storre.`);
  }
  return parsed;
}

export function parseOptionalInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} ma vaere et heltall.`);
  }
  return parsed;
}

export function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = parseOptionalInteger(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed <= 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} ma vaere storre enn 0.`);
  }
  return parsed;
}

export function parseLimit(value: unknown, fallback = 100): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DomainError("INVALID_INPUT", "limit ma vaere et positivt tall.");
  }
  return Math.min(500, Math.floor(parsed));
}

export function parseTicketsPerPlayerInput(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
    throw new DomainError("INVALID_TICKETS_PER_PLAYER", "ticketsPerPlayer må være et heltall mellom 1 og 30.");
  }
  return parsed;
}

export function parseBooleanQueryValue(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on" ? true : fallback;
}

export function parseOptionalLedgerGameType(value: unknown): "MAIN_GAME" | "DATABINGO" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "gameType ma vaere MAIN_GAME eller DATABINGO.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized !== "MAIN_GAME" && normalized !== "DATABINGO") {
    throw new DomainError("INVALID_INPUT", "gameType ma vaere MAIN_GAME eller DATABINGO.");
  }
  return normalized;
}

export function parseOptionalLedgerChannel(value: unknown): "HALL" | "INTERNET" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "channel ma vaere HALL eller INTERNET.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized !== "HALL" && normalized !== "INTERNET") {
    throw new DomainError("INVALID_INPUT", "channel ma vaere HALL eller INTERNET.");
  }
  return normalized;
}
