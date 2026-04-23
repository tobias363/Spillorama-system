// BIN-627: admin-patterns API-wrappers.
//
// Dekker Pattern CRUD + dynamic-menu. Backend-endpoints ligger i
// apps/backend/src/routes/adminPatterns.ts:
//   GET    /api/admin/patterns?gameTypeId=X         (PATTERN_READ)
//   GET    /api/admin/patterns/dynamic-menu         (PATTERN_READ)
//   GET    /api/admin/patterns/:id                  (PATTERN_READ)
//   POST   /api/admin/patterns                      (PATTERN_WRITE)
//   PATCH  /api/admin/patterns/:id                  (PATTERN_WRITE)
//   DELETE /api/admin/patterns/:id                  (PATTERN_WRITE)
//
// Svar-formatet matcher `Pattern` i apps/backend/src/admin/PatternService.ts.

import { apiRequest } from "./client.js";

export type PatternStatus = "active" | "inactive";
export type PatternClaimType = "LINE" | "BINGO";

export interface AdminPattern {
  id: string;
  gameTypeId: string;
  gameName: string;
  patternNumber: string;
  name: string;
  /** 25-bit bitmask (5x5). */
  mask: number;
  claimType: PatternClaimType;
  prizePercent: number;
  orderIndex: number;
  design: number;
  status: PatternStatus;
  isWoF: boolean;
  isTchest: boolean;
  isMys: boolean;
  isRowPr: boolean;
  rowPercentage: number;
  isJackpot: boolean;
  isGameTypeExtra: boolean;
  isLuckyBonus: boolean;
  patternPlace: string | null;
  extra: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListPatternsParams {
  gameTypeId?: string;
  status?: PatternStatus;
  limit?: number;
}

export interface ListPatternsResult {
  patterns: AdminPattern[];
  count: number;
}

export async function listPatterns(
  params: ListPatternsParams = {}
): Promise<ListPatternsResult> {
  const qs = new URLSearchParams();
  if (params.gameTypeId) qs.set("gameTypeId", params.gameTypeId);
  if (params.status) qs.set("status", params.status);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListPatternsResult>(`/api/admin/patterns${suffix}`, {
    auth: true,
  });
}

export async function getPattern(id: string): Promise<AdminPattern> {
  return apiRequest<AdminPattern>(
    `/api/admin/patterns/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export interface CreatePatternInput {
  gameTypeId: string;
  gameName?: string;
  patternNumber?: string;
  name: string;
  mask: number;
  claimType?: PatternClaimType;
  prizePercent?: number;
  orderIndex?: number;
  design?: number;
  status?: PatternStatus;
  rowPercentage?: number;
  isWoF?: boolean;
  isTchest?: boolean;
  isMys?: boolean;
  isRowPr?: boolean;
  isJackpot?: boolean;
  isGameTypeExtra?: boolean;
  isLuckyBonus?: boolean;
  patternPlace?: string | null;
  extra?: Record<string, unknown>;
}

export function createPattern(input: CreatePatternInput): Promise<AdminPattern> {
  return apiRequest<AdminPattern>("/api/admin/patterns", {
    method: "POST",
    body: input,
    auth: true,
  });
}

export interface UpdatePatternInput {
  gameName?: string;
  patternNumber?: string;
  name?: string;
  mask?: number;
  claimType?: PatternClaimType;
  prizePercent?: number;
  orderIndex?: number;
  design?: number;
  status?: PatternStatus;
  rowPercentage?: number;
  isWoF?: boolean;
  isTchest?: boolean;
  isMys?: boolean;
  isRowPr?: boolean;
  isJackpot?: boolean;
  isGameTypeExtra?: boolean;
  isLuckyBonus?: boolean;
  patternPlace?: string | null;
  extra?: Record<string, unknown>;
}

export function updatePattern(
  id: string,
  patch: UpdatePatternInput
): Promise<AdminPattern> {
  return apiRequest<AdminPattern>(
    `/api/admin/patterns/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: patch,
      auth: true,
    }
  );
}

export interface DeletePatternResult {
  softDeleted: boolean;
}

export function deletePattern(
  id: string,
  hard = false
): Promise<DeletePatternResult> {
  const qs = hard ? "?hard=true" : "";
  return apiRequest<DeletePatternResult>(
    `/api/admin/patterns/${encodeURIComponent(id)}${qs}`,
    { method: "DELETE", auth: true }
  );
}
