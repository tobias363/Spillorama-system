// ── Validators + tidsnøkkel-helpers ──────────────────────────────
//
// Pure funksjoner splittet ut fra ComplianceLedger.ts (PR-S3).
// Brukes av både core ledger og aggregerings-moduler. Ingen state.
//
// KRITISK (§11): Disse validerer input. Endring av semantikk (f.eks.
// akseptere nye gameType-verdier) vil bryte regulatorisk kontrakt.

import { DomainError } from "./BingoEngine.js";
import type { LedgerChannel, LedgerGameType, OrganizationAllocationInput } from "./ComplianceLedgerTypes.js";

export function assertLedgerGameType(value: string): LedgerGameType {
  const normalized = value.trim().toUpperCase();
  if (normalized === "MAIN_GAME" || normalized === "DATABINGO") {
    return normalized;
  }
  throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME eller DATABINGO.");
}

export function assertLedgerChannel(value: string): LedgerChannel {
  const normalized = value.trim().toUpperCase();
  if (normalized === "HALL" || normalized === "INTERNET") {
    return normalized;
  }
  throw new DomainError("INVALID_INPUT", "channel må være HALL eller INTERNET.");
}

export function assertDateKey(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være i format YYYY-MM-DD.`);
  }
  const [yearText, monthText, dayText] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new DomainError("INVALID_INPUT", `${fieldName} er ikke en gyldig dato.`);
  }
  return normalized;
}

export function dayRangeMs(dateKey: string): { startMs: number; endMs: number } {
  const normalized = assertDateKey(dateKey, "date");
  const [yearText, monthText, dayText] = normalized.split("-");
  const startMs = new Date(Number(yearText), Number(monthText) - 1, Number(dayText)).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return { startMs, endMs };
}

export function dateKeyFromMs(referenceMs: number): string {
  const date = new Date(referenceMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function assertHallId(hallId: string): string {
  const normalized = hallId.trim();
  if (!normalized || normalized.length > 120) {
    throw new DomainError("INVALID_HALL_ID", "hallId er ugyldig.");
  }
  return normalized;
}

export function assertIsoTimestampMs(value: string, fieldName: string): number {
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være ISO-8601 dato/tid.`);
  }
  return parsed;
}

export function assertNonNegativeNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
  }
  return value;
}

export function assertOrganizationAllocations(
  allocations: OrganizationAllocationInput[]
): OrganizationAllocationInput[] {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new DomainError("INVALID_INPUT", "allocations må inneholde minst én organisasjon.");
  }

  const normalized = allocations.map((allocation) => {
    const organizationId = allocation.organizationId?.trim();
    const organizationAccountId = allocation.organizationAccountId?.trim();
    const sharePercent = Number(allocation.sharePercent);
    if (!organizationId) {
      throw new DomainError("INVALID_INPUT", "organizationId mangler.");
    }
    if (!organizationAccountId) {
      throw new DomainError("INVALID_INPUT", "organizationAccountId mangler.");
    }
    if (!Number.isFinite(sharePercent) || sharePercent <= 0) {
      throw new DomainError("INVALID_INPUT", "sharePercent må være større enn 0.");
    }
    return {
      organizationId,
      organizationAccountId,
      sharePercent
    };
  });

  const totalShare = normalized.reduce((sum, allocation) => sum + allocation.sharePercent, 0);
  if (Math.abs(totalShare - 100) > 0.0001) {
    throw new DomainError("INVALID_INPUT", "Summen av sharePercent må være 100.");
  }
  return normalized;
}

/**
 * Navnekonvensjon for hall-account IDs som brukes som kilde for
 * overskudd-fordeling. Formaten må være stabil — endring bryter
 * eksisterende transfer-historikk.
 */
export function makeHouseAccountId(hallId: string, gameType: LedgerGameType, channel: LedgerChannel): string {
  return `house-${hallId.trim()}-${gameType.toLowerCase()}-${channel.toLowerCase()}`;
}
