/**
 * BIN-651: red-flag players report — pure aggregate builder.
 *
 * Legacy reference:
 *   legacy/unity-backend/App/Controllers/redFlagCategoryController.js
 *   (`getPlayersRedFlagList`, lines ~261–691). Legacy has 9 flag-types
 *   (1=used-in-day, 2=used-per-week, 3=deposited-in-day, 4=deposited-per-week,
 *   5=lost-in-day, 6=lost-in-month, 7=risk-country, 8=pep,
 *   9=not-bank-id-verified). Legacy returns per-player aggregates over the
 *   last 6 months.
 *
 * Backend data-model difference:
 *   Our backend (BIN-587 B3-aml) persists *real* red-flag records in
 *   `app_aml_red_flags` keyed by `rule_slug`. We expose the same shape the FE
 *   already consumes (`RedFlagPlayerEntry` in shared-types) but the source of
 *   truth is the flag-table — not a live aggregate over transaction history.
 *   The 9 legacy category-slugs are preserved as the canonical category ids so
 *   FE navigation-URLs (`#/redFlagCategory/<id>/players`) stay stable and
 *   BIN-650 can reuse this list when it lands.
 *
 * Regulatorisk kontekst (pengespillforskriften §11):
 *   Selve VIEW-en audit-logges i route-laget (action
 *   `admin.report.red_flag_players.viewed`). Dette modul-et er rent
 *   aggregate-bygging — ingen audit, ingen DB I/O.
 *
 * Cursor-pagination:
 *   Offset-basert base64url, samme mønster som BIN-647 subgame-drill-down
 *   (`SubgameDrillDownReport.ts`).
 */

import type { AmlRedFlag } from "../../compliance/AmlService.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";

// ── Category slugs ──────────────────────────────────────────────────────────
//
// Disse ni slug-ene er kanoniske — eksportert så BIN-650 kan liste dem i
// categories-endepunktet uten å duplisere definisjonen. `legacyId` matcher
// legacy `flagType` (1-9) for migrasjon/URL-bakoverkompatibilitet.

export interface RedFlagCategoryDefinition {
  /** Kanonisk slug — stabil i URL + wire-format. */
  id: string;
  /** Menneske-lesbart navn (norsk). */
  label: string;
  /** Legacy `flagType`-tall (1..9). */
  legacyId: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
}

export const RED_FLAG_CATEGORIES: readonly RedFlagCategoryDefinition[] = [
  { id: "used-in-day", legacyId: 1, label: "Brukt på en dag", severity: "MEDIUM" },
  { id: "used-per-week", legacyId: 2, label: "Brukt per uke", severity: "MEDIUM" },
  { id: "deposited-in-day", legacyId: 3, label: "Innskudd på en dag", severity: "MEDIUM" },
  { id: "deposited-per-week", legacyId: 4, label: "Innskudd per uke", severity: "MEDIUM" },
  { id: "lost-in-day", legacyId: 5, label: "Tapt på en dag", severity: "HIGH" },
  { id: "lost-in-month", legacyId: 6, label: "Tapt per måned", severity: "HIGH" },
  { id: "risk-country", legacyId: 7, label: "Risikoland", severity: "HIGH" },
  { id: "pep", legacyId: 8, label: "Politisk eksponert person", severity: "HIGH" },
  {
    id: "not-bank-id-verified",
    legacyId: 9,
    label: "Ikke verifisert med BankID",
    severity: "LOW",
  },
] as const;

const CATEGORY_IDS = new Set(RED_FLAG_CATEGORIES.map((c) => c.id));

export function isValidRedFlagCategoryId(id: string): boolean {
  return CATEGORY_IDS.has(id);
}

// ── Input/Output shapes ────────────────────────────────────────────────────

/** Minimal user-info som kreves per flagget spiller. */
export interface RedFlagPlayerUserInfo {
  userId: string;
  displayName: string;
  email: string;
}

export interface RedFlagPlayersReportInput {
  /** Alle åpne red-flags i den aktuelle perioden, usortert. */
  flags: AmlRedFlag[];
  /** User-info per userId. Manglende oppføringer → flag utelates. */
  users: Map<string, RedFlagPlayerUserInfo>;
  /** Valgfritt: ledger-entries for å regne ut totalStakes + lastActivity per user. */
  ledgerEntries?: ComplianceLedgerEntry[];
  /** Kategori-filter (slug, f.eks. "lost-in-day"). Undefined = alle. */
  category?: string;
  /** Inkluderende nedre ISO-grense for `flag.createdAt`. */
  from?: string;
  /** Inkluderende øvre ISO-grense for `flag.createdAt`. */
  to?: string;
  /** Opaque offset-cursor. Udefinert = start fra 0. */
  cursor?: string;
  /** Page size; default 50, min 1, max 500. */
  pageSize?: number;
}

export interface RedFlagPlayerRow {
  userId: string;
  displayName: string;
  email: string;
  categoryId: string;
  flaggedAt: string;
  totalStakes: number;
  lastActivity: string;
}

export interface RedFlagPlayersReportResult {
  category: string | null;
  from: string | null;
  to: string | null;
  items: RedFlagPlayerRow[];
  nextCursor: string | null;
  /** Total number of matching flags (før pagination). */
  totalCount: number;
}

// ── Cursor helpers (offset-basert, samme som BIN-647) ──────────────────────

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseIsoMs(value: string, field: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`[BIN-651] ${field} må være ISO-8601: ${value}`);
  }
  return ms;
}

// ── Aggregate builder ──────────────────────────────────────────────────────

/**
 * Bygg report-rad-liste. Pure function — ingen DB-I/O, ingen audit.
 *
 * Strategi:
 *   1. Filtrer flag på category-slug + [from, to]-vindu på createdAt.
 *   2. Dedupliser per userId — hver spiller får én rad (nyeste flag vinner
 *      på flaggedAt). Tilsvarer legacy som grupperer per `playerId` selv når
 *      en bruker har flere transaksjoner som treffer terskelen.
 *   3. Joine med user-info (users-map). Manglende brukere hoppes over
 *      stille — bruker kan være hard-slettet før flagget leses ut.
 *   4. Valgfritt: summer `STAKE`-ledger-entries per user for totalStakes +
 *      sett lastActivity til siste ledger-event (fallback: flaggedAt).
 *   5. Sorter nyeste-først på flaggedAt (deterministisk breaker: userId).
 *   6. Pagin er offset + page-size; totalCount teller filtrerte flag før paging.
 */
export function buildRedFlagPlayersReport(
  input: RedFlagPlayersReportInput
): RedFlagPlayersReportResult {
  const pageSize = Math.max(1, Math.min(500, Math.floor(input.pageSize ?? 50)));
  const cursorOffset = input.cursor ? decodeCursor(input.cursor) : 0;

  const categoryId = input.category?.trim() || null;
  if (categoryId && !isValidRedFlagCategoryId(categoryId)) {
    throw new Error(`[BIN-651] Ukjent kategori-id: ${categoryId}`);
  }

  const fromMs = input.from ? parseIsoMs(input.from, "from") : null;
  const toMs = input.to ? parseIsoMs(input.to, "to") : null;
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    throw new Error(`[BIN-651] 'from' må være <= 'to' (${input.from} > ${input.to}).`);
  }

  // 1. Filtrer flag.
  const filtered: AmlRedFlag[] = [];
  for (const flag of input.flags) {
    if (categoryId && flag.ruleSlug !== categoryId) continue;
    if (fromMs !== null || toMs !== null) {
      const createdMs = Date.parse(flag.createdAt);
      if (!Number.isFinite(createdMs)) continue;
      if (fromMs !== null && createdMs < fromMs) continue;
      if (toMs !== null && createdMs > toMs) continue;
    }
    filtered.push(flag);
  }

  // 2. Dedupliser per user — behold nyeste flag (høyest createdAt).
  const flagByUser = new Map<string, AmlRedFlag>();
  for (const flag of filtered) {
    const existing = flagByUser.get(flag.userId);
    if (!existing) {
      flagByUser.set(flag.userId, flag);
      continue;
    }
    if (Date.parse(flag.createdAt) > Date.parse(existing.createdAt)) {
      flagByUser.set(flag.userId, flag);
    }
  }

  // 4. Aggreger ledger-entries per user hvis gitt.
  interface PerUserAgg {
    stakeSum: number;
    lastActivityMs: number | null;
  }
  const perUserAgg = new Map<string, PerUserAgg>();
  if (input.ledgerEntries && input.ledgerEntries.length > 0) {
    for (const entry of input.ledgerEntries) {
      if (!entry.walletId) continue;
      // ledger-er keyed by walletId; vi antar walletId = userId når dette
      // kalles fra route-laget (route-laget mapper om nødvendig). For
      // robusthet: aksepter både walletId og playerId.
      const ownerId = entry.playerId ?? entry.walletId;
      let agg = perUserAgg.get(ownerId);
      if (!agg) {
        agg = { stakeSum: 0, lastActivityMs: null };
        perUserAgg.set(ownerId, agg);
      }
      if (entry.eventType === "STAKE") {
        agg.stakeSum += entry.amount;
      }
      if (agg.lastActivityMs === null || entry.createdAtMs > agg.lastActivityMs) {
        agg.lastActivityMs = entry.createdAtMs;
      }
    }
  }

  // 3 + 5. Join med user-info, sorter nyeste først.
  const rows: RedFlagPlayerRow[] = [];
  for (const [userId, flag] of flagByUser) {
    const user = input.users.get(userId);
    if (!user) continue; // slettet bruker — hopp over.
    const agg = perUserAgg.get(userId);
    const lastActivity =
      agg?.lastActivityMs !== null && agg?.lastActivityMs !== undefined
        ? new Date(agg.lastActivityMs).toISOString()
        : flag.createdAt;
    rows.push({
      userId,
      displayName: user.displayName,
      email: user.email,
      categoryId: flag.ruleSlug,
      flaggedAt: flag.createdAt,
      totalStakes: roundCurrency(agg?.stakeSum ?? 0),
      lastActivity,
    });
  }
  rows.sort((a, b) => {
    const diff = Date.parse(b.flaggedAt) - Date.parse(a.flaggedAt);
    if (diff !== 0) return diff;
    return a.userId.localeCompare(b.userId);
  });

  // 6. Pagin.
  const totalCount = rows.length;
  const paged = rows.slice(cursorOffset, cursorOffset + pageSize);
  const nextOffset = cursorOffset + paged.length;
  const nextCursor = nextOffset < totalCount ? encodeCursor(nextOffset) : null;

  return {
    category: categoryId,
    from: input.from ?? null,
    to: input.to ?? null,
    items: paged,
    nextCursor,
    totalCount,
  };
}
