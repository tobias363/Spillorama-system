import express from "express";
import { URL } from "node:url";
import { DomainError, toPublicError } from "../game/BingoEngine.js";
import type { PlayerReportPeriod } from "../spillevett/playerReport.js";

// ── Environment parsing helpers ───────────────────────────────────────────────

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function parseNonNegativeNumberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

// ── Request validation helpers ────────────────────────────────────────────────

export function mustBeNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
  }
  return value.trim();
}

export function mustBePositiveAmount(value: unknown, fieldName = "amount"): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være større enn 0.`);
  }
  return amount;
}

export function parseOptionalNonNegativeAmount(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new DomainError("INVALID_INPUT", "initialBalance må være 0 eller større.");
  }
  return amount;
}

export function parseOptionalNonNegativeNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
  }
  return parsed;
}

export function parseOptionalInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være et heltall.`);
  }
  return parsed;
}

export function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = parseOptionalInteger(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed <= 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være større enn 0.`);
  }
  return parsed;
}

export function parseOptionalLedgerGameType(value: unknown): "MAIN_GAME" | "DATABINGO" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME eller DATABINGO.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized !== "MAIN_GAME" && normalized !== "DATABINGO") {
    throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME eller DATABINGO.");
  }
  return normalized;
}

export function parseOptionalLedgerChannel(value: unknown): "HALL" | "INTERNET" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "channel må være HALL eller INTERNET.");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized !== "HALL" && normalized !== "INTERNET") {
    throw new DomainError("INVALID_INPUT", "channel må være HALL eller INTERNET.");
  }
  return normalized;
}

export function parsePlayerReportPeriod(value: unknown, fallback: PlayerReportPeriod = "last7"): PlayerReportPeriod {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "period må være today, last7, last30, last365, week, month eller year.");
  }
  const normalized = value.trim().toLowerCase();
  const valid: string[] = ["today", "last7", "last30", "last365", "week", "month", "year"];
  if (!valid.includes(normalized)) {
    throw new DomainError("INVALID_INPUT", "period må være today, last7, last30, last365, week, month eller year.");
  }
  return normalized as PlayerReportPeriod;
}

export function parseBooleanQueryValue(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  return parseBooleanEnv(value, fallback);
}

export function parseLimit(value: unknown, fallback = 100): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DomainError("INVALID_INPUT", "limit må være et positivt tall.");
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

export function parseOptionalTicketsPerPlayerInput(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parseTicketsPerPlayerInput(value);
}

export function normalizeAbsoluteHttpUrl(rawValue: string, fieldName: string, errorCode: string): string {
  const candidate = rawValue.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new DomainError(errorCode, `${fieldName} må være en gyldig http/https URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DomainError(errorCode, `${fieldName} må starte med http:// eller https://.`);
  }

  return parsed.toString();
}

export function parseOptionalAbsoluteHttpUrl(
  value: unknown,
  fieldName: string,
  errorCode: string
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError(errorCode, `${fieldName} må være tekst.`);
  }
  if (!value.trim()) {
    return undefined;
  }
  return normalizeAbsoluteHttpUrl(value, fieldName, errorCode);
}

export function parseOptionalBooleanInput(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  throw new DomainError("INVALID_INPUT", `${fieldName} må være true/false.`);
}

export function parseOptionalIsoTimestampMs(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  const parsed = Date.parse(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være en ISO-8601 dato/tid.`);
  }
  return parsed;
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── HTTP response helpers ─────────────────────────────────────────────────────

export function apiSuccess<T>(res: express.Response, data: T): void {
  res.json({ ok: true, data });
}

export function apiFailure(res: express.Response, error: unknown): void {
  const publicError = toPublicError(error);
  res.status(400).json({ ok: false, error: publicError });
}

// ── Token extraction ──────────────────────────────────────────────────────────

export function getAccessTokenFromRequest(req: express.Request): string {
  const header = req.headers.authorization;
  if (!header) {
    throw new DomainError("UNAUTHORIZED", "Mangler Authorization-header.");
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token?.trim()) {
    throw new DomainError("UNAUTHORIZED", "Authorization må være Bearer token.");
  }
  return token.trim();
}

export function getAccessTokenFromSocketPayload(payload: { accessToken?: string } | undefined): string {
  const token = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
  if (!token) {
    throw new DomainError("UNAUTHORIZED", "Mangler accessToken i socket-payload.");
  }
  return token;
}
