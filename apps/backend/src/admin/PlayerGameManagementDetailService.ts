/**
 * GAP #4 (BACKEND_1TO1_GAP_AUDIT_2026-04-24): per-spiller game-management
 * detail-list. Aggregat over compliance-ledger-entries for ett wallet,
 * gruppert per gameType. Brukes av admin-spillerprofilen for å vise
 * "hva har spilleren gjort i hvert spill"-rapport (ticket-historikk + win-
 * history aggregert).
 *
 * Legacy reference:
 *   `legacy/unity-backend/App/Controllers/PlayerController.js:1100-1256`
 *   (`viwePlayerGameManagementDetail` + `playerGetGameManagementDetailList`).
 *   Legacy bruker `getPlayerTransactionDataCount` + `getTransactionDataTable`
 *   med Mongo-aggregering på et eget transaksjons-collection.
 *
 *   Ny stack: alle stake/prize-events går til ComplianceLedger
 *   (app_rg_compliance_ledger). Vi aggregerer derfra slik at vi får
 *   regulatorisk-presis sum (samme datakilde som §71-rapport).
 *
 * Stil:
 *   Pure function — ingen I/O. Ingen audit (read-only). Caller (route-laget)
 *   henter ledger-entries via `BingoEngine.listComplianceLedgerEntries`
 *   filtrert på walletId først, sender inn her for aggregering.
 *
 * Aggregat per gameType:
 *   - totalTickets: antall STAKE-events (én per ticket-purchase)
 *   - totalStake: sum av STAKE-amount (innsats)
 *   - totalWinnings: sum av PRIZE + EXTRA_PRIZE (gevinster + manuelle/jackpot)
 *   - winRate: totalWinnings / totalStake (eller 0 hvis stake = 0)
 *   - lastPlayed: max createdAt over alle entries (for sortering i UI)
 *   - prizeCount: antall PRIZE+EXTRA_PRIZE-events
 *   - extraPrizeCount: antall EXTRA_PRIZE-events (manual/jackpot)
 *
 * @see `apps/backend/src/admin/reports/Game1ManagementReport.ts` for
 *   tilsvarende aggregeringsmønster (per-game-session basis).
 */

import type {
  ComplianceLedgerEntry,
  LedgerGameType,
} from "../game/ComplianceLedgerTypes.js";

export interface PlayerGameManagementDetailInput {
  /** Wallet-id — ekko-felt på resultat (caller ser hvilken wallet ble aggregert). */
  walletId: string;
  /**
   * Compliance-ledger-entries for dette wallet, allerede filtrert på
   * walletId av kallesteden (BingoEngine.listComplianceLedgerEntries).
   * Filtrering på dato/gameType skjer der hvis param er satt; her
   * grupperer vi bare det som kommer inn.
   */
  entries: ComplianceLedgerEntry[];
  /** Valgfri filter på enkelt-gameType (f.eks. for å bare se Game 1-historikk). */
  gameType?: LedgerGameType;
  /**
   * Inkluderende nedre ISO-grense for entry.createdAt. Undefined = ingen.
   * Filtreres her igjen som ekstra forsvarslinje (caller bør allerede ha
   * filtrert).
   */
  fromDate?: string;
  /** Inkluderende øvre ISO-grense. Undefined = ingen. */
  toDate?: string;
}

export interface PlayerGameManagementDetailRow {
  gameType: LedgerGameType;
  totalTickets: number;
  totalStake: number;
  totalWinnings: number;
  winRate: number;
  lastPlayed: string | null;
  prizeCount: number;
  extraPrizeCount: number;
  stakeCount: number;
}

export interface PlayerGameManagementDetailResult {
  walletId: string;
  rows: PlayerGameManagementDetailRow[];
  /** Aggregat på tvers av alle gameTypes — "totals"-rad i UI. */
  totals: {
    totalTickets: number;
    totalStake: number;
    totalWinnings: number;
    winRate: number;
    prizeCount: number;
    extraPrizeCount: number;
    stakeCount: number;
  };
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseIsoMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

interface BucketAccumulator {
  totalStake: number;
  totalWinnings: number;
  stakeCount: number;
  prizeCount: number;
  extraPrizeCount: number;
  lastPlayedMs: number;
  lastPlayedIso: string | null;
}

function newBucket(): BucketAccumulator {
  return {
    totalStake: 0,
    totalWinnings: 0,
    stakeCount: 0,
    prizeCount: 0,
    extraPrizeCount: 0,
    lastPlayedMs: 0,
    lastPlayedIso: null,
  };
}

/**
 * Kjør per-gameType-aggregering. Pure function, deterministisk gitt input.
 *
 * Sortering: gameType alfabetisk (DATABINGO før MAIN_GAME, etc.). Caller
 * kan re-sortere i UI hvis ønsket, men deterministisk ordning her gjør
 * tester reproduserbare.
 */
export function buildPlayerGameManagementDetail(
  input: PlayerGameManagementDetailInput
): PlayerGameManagementDetailResult {
  const fromMs =
    input.fromDate && input.fromDate.trim()
      ? parseIsoMs(input.fromDate)
      : null;
  const toMs =
    input.toDate && input.toDate.trim() ? parseIsoMs(input.toDate) : null;

  const buckets = new Map<LedgerGameType, BucketAccumulator>();

  for (const entry of input.entries) {
    if (input.gameType && entry.gameType !== input.gameType) continue;
    if (fromMs !== null && entry.createdAtMs < fromMs) continue;
    if (toMs !== null && entry.createdAtMs > toMs) continue;

    let bucket = buckets.get(entry.gameType);
    if (!bucket) {
      bucket = newBucket();
      buckets.set(entry.gameType, bucket);
    }

    if (entry.eventType === "STAKE") {
      bucket.totalStake += entry.amount;
      bucket.stakeCount += 1;
    } else if (entry.eventType === "PRIZE") {
      bucket.totalWinnings += entry.amount;
      bucket.prizeCount += 1;
    } else if (entry.eventType === "EXTRA_PRIZE") {
      bucket.totalWinnings += entry.amount;
      bucket.extraPrizeCount += 1;
    }

    if (entry.createdAtMs > bucket.lastPlayedMs) {
      bucket.lastPlayedMs = entry.createdAtMs;
      bucket.lastPlayedIso = entry.createdAt;
    }
  }

  const rows: PlayerGameManagementDetailRow[] = [];
  let totalStake = 0;
  let totalWinnings = 0;
  let stakeCount = 0;
  let prizeCount = 0;
  let extraPrizeCount = 0;

  for (const [gameType, bucket] of buckets.entries()) {
    const stake = roundCurrency(bucket.totalStake);
    const winnings = roundCurrency(bucket.totalWinnings);
    rows.push({
      gameType,
      // legacy-paritet: én STAKE-entry = én ticket purchased.
      totalTickets: bucket.stakeCount,
      totalStake: stake,
      totalWinnings: winnings,
      winRate: stake > 0 ? roundCurrency(winnings / stake) : 0,
      lastPlayed: bucket.lastPlayedIso,
      prizeCount: bucket.prizeCount,
      extraPrizeCount: bucket.extraPrizeCount,
      stakeCount: bucket.stakeCount,
    });

    totalStake += bucket.totalStake;
    totalWinnings += bucket.totalWinnings;
    stakeCount += bucket.stakeCount;
    prizeCount += bucket.prizeCount;
    extraPrizeCount += bucket.extraPrizeCount;
  }

  rows.sort((a, b) => a.gameType.localeCompare(b.gameType));

  const totalStakeRounded = roundCurrency(totalStake);
  const totalWinningsRounded = roundCurrency(totalWinnings);

  return {
    walletId: input.walletId,
    rows,
    totals: {
      totalTickets: stakeCount,
      totalStake: totalStakeRounded,
      totalWinnings: totalWinningsRounded,
      winRate:
        totalStakeRounded > 0
          ? roundCurrency(totalWinningsRounded / totalStakeRounded)
          : 0,
      stakeCount,
      prizeCount,
      extraPrizeCount,
    },
  };
}
