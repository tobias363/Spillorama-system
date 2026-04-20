/**
 * BIN-630: pure aggregate-builder for spiller-chips-historikk.
 *
 * Legacy reference:
 *   `legacy/unity-backend/App/Controllers/PlayerController.js` —
 *   external-transactions-API'et (linje ~1260) viste spillerens wallet-
 *   transaksjoner (innskudd/uttak/gevinst/innsats/bonus) med saldo-effekt
 *   per rad. Vi rekonstruerer samme list-shape fra moderne `wallet_transactions`.
 *
 * Input-model:
 *   - Hele wallet-transaksjonslisten for spillerens wallet-konto, sortert
 *     DESC på createdAt (`WalletAdapter.listTransactions`-mønster).
 *   - Aktuell saldo (balance) på samme konto — brukes som utgangspunkt for
 *     å regne balanceAfter bakover.
 *
 * Stil:
 *   Pure function, ingen I/O, ingen audit. Cursor-pagination følger BIN-647
 *   / BIN-651 (opaque base64url offset). Service-filen holder forretnings-
 *   logikken ut av route-laget så tester er isolerte fra Express.
 */

import type { WalletTransaction } from "../adapters/WalletAdapter.js";
import type { ChipsHistoryEntry } from "@spillorama/shared-types";

export interface ChipsHistoryInput {
  /** Wallet-konto id — ekko-felt på resultat. */
  walletId: string;
  /**
   * Alle wallet-transaksjoner for kontoen, DESC-sortert på createdAt
   * (nyeste først). Kalleren (route-laget) henter hele settet før
   * filtrering så balanceAfter kan regnes korrekt i perioder som starter
   * midt i historikken.
   */
  transactions: WalletTransaction[];
  /**
   * Aktuell saldo på wallet-kontoen (dvs. saldo _etter_ siste tx i listen).
   * Vi spiller av saldoen bakover for å finne balanceAfter per rad.
   */
  currentBalance: number;
  /** Inkluderende nedre ISO-grense for tx.createdAt. Undefined = ingen. */
  from?: string;
  /** Inkluderende øvre ISO-grense for tx.createdAt. Undefined = ingen. */
  to?: string;
  /** Opaque offset-cursor. Undefined = start fra 0. */
  cursor?: string;
  /** Page size; default 50, min 1, max 500. */
  pageSize?: number;
}

export interface ChipsHistoryResult {
  walletId: string;
  from: string | null;
  to: string | null;
  items: ChipsHistoryEntry[];
  nextCursor: string | null;
}

// ── Cursor helpers (offset-basert, samme som BIN-647 / BIN-651) ────────────

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
    throw new Error(`[BIN-630] ${field} må være ISO-8601: ${value}`);
  }
  return ms;
}

/**
 * Regn ut signert saldo-endring for en wallet-transaksjon fra wallet-kontoens
 * ståsted.
 *
 * Matcher ledger-logikken i `PostgresWalletAdapter.singleAccountMovement`:
 *   - CREDIT / TOPUP / TRANSFER_IN → saldo øker med `amount`.
 *   - DEBIT / WITHDRAWAL / TRANSFER_OUT → saldo reduseres med `amount`.
 *
 * `amount` på tx-raden er alltid positiv (CHECK i SQL-schema); fortegnet
 * leses utelukkende fra `type`.
 */
function signedDelta(tx: WalletTransaction): number {
  switch (tx.type) {
    case "CREDIT":
    case "TOPUP":
    case "TRANSFER_IN":
      return tx.amount;
    case "DEBIT":
    case "WITHDRAWAL":
    case "TRANSFER_OUT":
      return -tx.amount;
    default:
      // Defensive: ukjent type → beregn som 0 så balanceAfter ikke drifter.
      return 0;
  }
}

/**
 * Bygg chips-historikk. Pure function — ingen DB-I/O, ingen audit.
 *
 * Algoritme:
 *   1. Kopier alle tx'er (DESC på createdAt) og regn balanceAfter per rad.
 *      Siden input allerede er DESC og vi kjenner `currentBalance` etter
 *      siste tx, kan vi spille av bakover:
 *        balanceAfter[0] = currentBalance
 *        balanceAfter[i] = balanceAfter[i-1] - delta(tx[i-1])
 *      (dvs. «før den ferskere tx'en ble bokført»)
 *   2. Filtrer [from, to]-vinduet — behold bare tx'er hvis createdAt ligger
 *      innenfor. balanceAfter er allerede korrekt fordi den ble regnet ut
 *      over hele historikken.
 *   3. Pagin på filtrert liste (offset + pageSize).
 */
export function buildChipsHistory(input: ChipsHistoryInput): ChipsHistoryResult {
  const pageSize = Math.max(1, Math.min(500, Math.floor(input.pageSize ?? 50)));
  const cursorOffset = input.cursor ? decodeCursor(input.cursor) : 0;

  const fromMs = input.from ? parseIsoMs(input.from, "from") : null;
  const toMs = input.to ? parseIsoMs(input.to, "to") : null;
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    throw new Error(`[BIN-630] 'from' må være <= 'to' (${input.from} > ${input.to}).`);
  }

  if (!Number.isFinite(input.currentBalance)) {
    throw new Error(`[BIN-630] currentBalance må være et tall: ${input.currentBalance}`);
  }

  // 1. Regn balanceAfter per rad over hele historikken (DESC).
  //    balanceAfter[i] = saldo _etter_ at tx[i] ble bokført.
  const entriesAll: ChipsHistoryEntry[] = [];
  let rollingBalance = input.currentBalance;
  for (const tx of input.transactions) {
    const entry: ChipsHistoryEntry = {
      id: tx.id,
      timestamp: tx.createdAt,
      type: tx.type,
      amount: roundCurrency(tx.amount),
      balanceAfter: roundCurrency(rollingBalance),
      description: tx.reason,
      // Future-proof — felter er reservert i wire-shape; wallet_transactions
      // har ikke direkte kobling til game_id eller refund-tidspunkt så vi
      // eksponerer null nå. Kan fylles av compliance-ledger-join senere.
      sourceGameId: null,
      refundedAt: null,
    };
    entriesAll.push(entry);
    rollingBalance -= signedDelta(tx);
  }

  // 2. Filtrer vindu.
  const filtered: ChipsHistoryEntry[] = [];
  for (const entry of entriesAll) {
    if (fromMs !== null || toMs !== null) {
      const ms = Date.parse(entry.timestamp);
      if (!Number.isFinite(ms)) continue;
      if (fromMs !== null && ms < fromMs) continue;
      if (toMs !== null && ms > toMs) continue;
    }
    filtered.push(entry);
  }

  // 3. Pagin.
  const paged = filtered.slice(cursorOffset, cursorOffset + pageSize);
  const nextOffset = cursorOffset + paged.length;
  const nextCursor = nextOffset < filtered.length ? encodeCursor(nextOffset) : null;

  return {
    walletId: input.walletId,
    from: input.from ?? null,
    to: input.to ?? null,
    items: paged,
    nextCursor,
  };
}
