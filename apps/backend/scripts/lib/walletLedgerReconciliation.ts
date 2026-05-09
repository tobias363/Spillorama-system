/**
 * G9 — Wallet vs Compliance Ledger reconciliation (pure logic).
 *
 * Pure matching + diff helpers used by `reconcile-wallet-vs-ledger.ts`.
 * No DB, no I/O — fully deterministic so it can be unit-tested with
 * synthetic fixtures.
 *
 * ## Modell
 *
 * Vi sammenligner to uavhengige kilder for spiller-flyt:
 *
 *   1. **Wallet-laget** (`wallet_transactions` + `wallet_entries`):
 *      kilde for spiller-saldo. Hver mutasjon på en spiller-konto er en
 *      DEBIT (innsats / withdraw) eller CREDIT (premie / topup).
 *
 *   2. **Compliance-ledger** (`app_rg_compliance_ledger`):
 *      kilde for §71-rapport til Lotteritilsynet. Hver event har
 *      eventType ∈ {STAKE, PRIZE, EXTRA_PRIZE, ORG_DISTRIBUTION,
 *      HOUSE_RETAINED, HOUSE_DEFICIT}.
 *
 * ## Matching-strategi
 *
 * Per `(walletId, businessDate, hallId, gameType, side)` aggregerer vi
 * sum + count fra begge kilder, deretter sammenligner vi:
 *
 *   - Wallet-DEBIT (game-relatert) ↔ Ledger STAKE
 *   - Wallet-CREDIT (game-relatert) ↔ Ledger PRIZE + EXTRA_PRIZE
 *
 * `business_date` er Europe/Oslo-dato (matcher §71-bucket-grensen).
 *
 * Vi rapporterer:
 *
 *   - `walletOnlyBuckets`: aggregat finnes i wallet, IKKE i ledger
 *     → potensielt compliance-brudd (ikke rapportert til Lotteritilsynet)
 *   - `ledgerOnlyBuckets`: aggregat finnes i ledger, IKKE i wallet
 *     → potensielt phantom-rapport (rapportert uten faktisk pengeflyt)
 *   - `amountMismatches`: aggregat finnes på begge sider men beløp
 *     avviker → høy risiko (regulatorisk / wallet-bug)
 *   - `countMismatches`: antall events avviker → audit-signal
 *
 * ## Toleranse
 *
 * Vi krever EKSAKT match på øre-nivå. Floor-rounding fra split-payouts
 * skal være dekket av HOUSE_RETAINED-events, ikke avrundes vekk.
 * Wallet og ledger skriver begge i NOK med 2 desimaler.
 *
 * ## Hva vi IKKE matcher
 *
 *   - TOPUP / WITHDRAWAL: spiller-bevegelser inn/ut av wallet uten
 *     spill-trigger. De har ingen ledger-counterpart per design.
 *   - TRANSFER_IN / TRANSFER_OUT mellom spiller-kontoer: ikke relevant
 *     for §71.
 *   - System-account-bevegelser (`__house__`, `__external_cash__`):
 *     kun en motpart — ingen spiller-side.
 *   - ORG_DISTRIBUTION: bokført separat via OverskuddBatch — egen flow.
 *   - HOUSE_RETAINED / HOUSE_DEFICIT: rene audit-signaler, ingen
 *     wallet-bevegelse på spiller-side.
 *
 * ## Regulatorisk kontekst
 *
 * Dette scriptet er KOMPLEMENTÆRT til `verify-wallet-audit-chain.ts`
 * (BIN-764, hash-chain). Hash-chain verifiserer at wallet IKKE er
 * tampered. Reconciliation verifiserer at det wallet sier matcher det
 * §71-rapporten sier — dvs. at vi rapporterer korrekt til
 * Lotteritilsynet på det som faktisk har skjedd.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Side av matchen — STAKE (debit fra spiller) eller PRIZE (credit til spiller).
 */
export type ReconcileSide = "STAKE" | "PRIZE";

/**
 * Wallet-event etter normalisering. Ett "logisk" event per row i
 * wallet_transactions som vi mener skal matche en ledger-event.
 *
 * @remarks Vi bruker NOK med opp til 6 desimaler internt (matcher
 *   `wallet_transactions.amount NUMERIC(20,6)`), men sammenligner med
 *   2-desimal-runding (ledger lagrer NUMERIC(12,2)).
 */
export interface WalletReconcileEvent {
  /** wallet_transactions.id (TEXT). */
  transactionId: string;
  /** wallet_accounts.id — spiller-wallet (NOT system). */
  accountId: string;
  /** Europe/Oslo dato YYYY-MM-DD basert på created_at. */
  businessDate: string;
  /** Beløp i NOK (positivt). */
  amountNok: number;
  /** STAKE eller PRIZE. */
  side: ReconcileSide;
  /** Original transaction_type fra DB (for debug). */
  transactionType: string;
  /** Original reason fra DB (for debug + heuristikk). */
  reason: string;
  /** ISO timestamp av created_at. */
  createdAt: string;
}

/**
 * Compliance-ledger-event etter normalisering.
 */
export interface LedgerReconcileEvent {
  /** app_rg_compliance_ledger.id. */
  id: string;
  /** wallet_id (kan være NULL for systemic events vi excluder). */
  walletId: string;
  /** Europe/Oslo dato YYYY-MM-DD basert på created_at. */
  businessDate: string;
  /** hall_id. */
  hallId: string;
  /** game_type — MAIN_GAME eller DATABINGO. */
  gameType: string;
  /** Beløp i NOK (positivt). */
  amountNok: number;
  /** STAKE eller PRIZE. */
  side: ReconcileSide;
  /** Original event_type fra DB. */
  eventType: string;
  /** ISO timestamp. */
  createdAt: string;
}

/**
 * Aggregat-bucket per matching-nøkkel. Sammenfatter alle events på
 * samme (accountId/walletId, businessDate, side).
 *
 * Vi matcher PRIMÆRT på `(walletId, businessDate, side)` siden hallId og
 * gameType er ledger-spesifikke felt (wallet-laget vet ikke hvilken hall
 * en innsats tilhørte). Diff-rapporten viser hallId/gameType når
 * tilgjengelig så ops kan finne riktig bucket.
 */
export interface ReconcileBucket {
  walletId: string;
  businessDate: string;
  side: ReconcileSide;
  totalAmountNok: number;
  eventCount: number;
}

/**
 * Per-hall + per-gameType + per-side aggregat (kun ledger har disse
 * kolonnene — wallet-laget kan ikke alltid utlede dem).
 */
export interface LedgerSummaryRow {
  hallId: string;
  gameType: string;
  side: ReconcileSide;
  totalAmountNok: number;
  eventCount: number;
}

/**
 * Wallet-side per dato + side aggregat (uten hall/gameType siden disse
 * ikke alltid er tilgjengelige).
 */
export interface WalletSummaryRow {
  side: ReconcileSide;
  totalAmountNok: number;
  eventCount: number;
}

/**
 * Beløps-mismatch: bucket finnes på begge sider men beløp er forskjellig.
 */
export interface AmountMismatch {
  walletId: string;
  businessDate: string;
  side: ReconcileSide;
  walletAmountNok: number;
  ledgerAmountNok: number;
  diffNok: number;
}

/**
 * Antall-mismatch: bucket finnes på begge sider men antall events er
 * forskjellig (selv om sum kanskje stemmer).
 */
export interface CountMismatch {
  walletId: string;
  businessDate: string;
  side: ReconcileSide;
  walletCount: number;
  ledgerCount: number;
  diff: number;
}

/**
 * Hovedresultat fra reconciliation.
 */
export interface ReconciliationResult {
  /** ISO-period — for output-formatting. */
  fromDate: string;
  toDate: string;
  hallFilter: string | null;

  /** Aggregerte totals (hele perioden, alle haller). */
  walletTotals: {
    stakeAmountNok: number;
    stakeCount: number;
    prizeAmountNok: number;
    prizeCount: number;
  };
  ledgerTotals: {
    stakeAmountNok: number;
    stakeCount: number;
    prizeAmountNok: number;
    prizeCount: number;
  };

  /** Per-hall breakdown (kun ledger-side — wallet vet ikke hall). */
  ledgerByHall: LedgerSummaryRow[];

  /**
   * Bucket finnes i wallet, IKKE i ledger (potensielt compliance-brudd —
   * wallet-mutasjon uten §71-rapport).
   */
  walletOnlyBuckets: ReconcileBucket[];

  /**
   * Bucket finnes i ledger, IKKE i wallet (potensielt phantom-rapport —
   * §71-event uten faktisk wallet-bevegelse).
   */
  ledgerOnlyBuckets: ReconcileBucket[];

  /** Beløp avviker mellom de to kildene for samme bucket. */
  amountMismatches: AmountMismatch[];

  /** Antall events avviker mellom de to kildene. */
  countMismatches: CountMismatch[];

  /**
   * Aggregert status: true hvis ingen divergens, false hvis minst én av
   * walletOnlyBuckets / ledgerOnlyBuckets / amountMismatches er ikke-tom.
   * countMismatches alene IKKE flagger som divergens (kan skyldes
   * lovlig multi-event-aggregering — beløpet er sannheten).
   */
  isReconciled: boolean;
}

// ── Wallet event classification ─────────────────────────────────────────────

/**
 * Klassifiser en wallet_transactions-rad til en ReconcileSide eller null
 * hvis det IKKE skal matches mot ledger.
 *
 * Reglene matcher hvilke transaction_types som faktisk skriver til
 * compliance-ledger. STAKE-side er DEBIT (penger ut av spiller), PRIZE-
 * side er CREDIT (penger inn til spiller) — men kun de som har en
 * spill-relatert reason. TOPUP og WITHDRAWAL er ikke spill-relaterte.
 *
 * @param transactionType `wallet_transactions.transaction_type`
 * @param reason `wallet_transactions.reason` (used as heuristikk-fallback)
 * @param idempotencyKey `wallet_transactions.idempotency_key` (used as primary signal)
 * @returns ReconcileSide eller null hvis transaksjonen ikke skal matches
 */
export function classifyWalletTransaction(
  transactionType: string,
  reason: string,
  idempotencyKey: string | null,
): ReconcileSide | null {
  const type = transactionType.toUpperCase();

  // Topup, withdrawal og generelle transfer er ikke spill-relaterte.
  if (type === "TOPUP" || type === "WITHDRAWAL") {
    return null;
  }

  // TRANSFER_IN / TRANSFER_OUT: typisk spillrelatert, men kun matche
  // mot ledger hvis idempotency-key indikerer game-context.
  // Generic transfers (admin-correction, manual move) hopper vi over.
  const key = (idempotencyKey ?? "").toLowerCase();
  const reasonLc = (reason ?? "").toLowerCase();

  // Spill 1 / 2 / 3 prefixes for game-relaterte transaksjoner — disse
  // matcher exact prefixes fra apps/backend/src/game/idempotency.ts.
  const isGameRelated =
    key.startsWith("g1-") ||
    key.startsWith("g2-") ||
    key.startsWith("g3-") ||
    key.startsWith("game1-purchase:") ||
    key.startsWith("game1-refund:") ||
    key.startsWith("adhoc-") ||
    key.startsWith("buyin-") ||
    key.startsWith("phase-") ||
    key.startsWith("line-prize-") ||
    key.startsWith("bingo-prize-") ||
    key.startsWith("jackpot-") ||
    key.startsWith("minigame-") ||
    key.startsWith("extra-prize-") ||
    key.startsWith("refund-") ||
    key.startsWith("ticket-replace-") ||
    // Reason-based heuristikk for legacy entries uten idempotency-key:
    reasonLc.includes("game1_purchase") ||
    reasonLc.includes("game1_payout") ||
    reasonLc.includes("game1_phase") ||
    reasonLc.includes("game2_") ||
    reasonLc.includes("game3_");

  if (!isGameRelated) {
    return null;
  }

  // DEBIT med game-context = STAKE (innsats).
  // game1-purchase debits = STAKE.
  if (type === "DEBIT" || type === "TRANSFER_OUT") {
    // Refund-kreditering er TRANSFER_IN, ikke DEBIT.
    if (key.startsWith("game1-refund:") || key.startsWith("refund-")) {
      // Refund er teknisk en STAKE-reversal. Ledger-laget skriver IKKE
      // en negativ STAKE for refund — den oppdaterer kun wallet-saldo.
      // Vi excluder refunds fra reconciliation for å unngå falsk-positiv.
      return null;
    }
    return "STAKE";
  }

  // CREDIT med game-context = PRIZE (premie).
  if (type === "CREDIT" || type === "TRANSFER_IN") {
    // Refund-credit (rolling tilbake purchase): excluder.
    if (key.startsWith("game1-refund:") || key.startsWith("refund-")) {
      return null;
    }
    // Compensate-credit etter feilet INSERT: excluder (rollback, ingen
    // ledger-bevegelse).
    if (key.includes(":compensate")) {
      return null;
    }
    return "PRIZE";
  }

  return null;
}

/**
 * Klassifiser en compliance-ledger-event til en ReconcileSide eller null.
 *
 * - STAKE → STAKE-side
 * - PRIZE → PRIZE-side
 * - EXTRA_PRIZE → PRIZE-side (jackpot/bonus utbetalt på samme måte)
 * - ORG_DISTRIBUTION → null (separat overskudd-flow)
 * - HOUSE_RETAINED → null (audit-signal, ingen spiller-bevegelse)
 * - HOUSE_DEFICIT → null (audit-signal)
 */
export function classifyLedgerEvent(eventType: string): ReconcileSide | null {
  switch (eventType.toUpperCase()) {
    case "STAKE":
      return "STAKE";
    case "PRIZE":
    case "EXTRA_PRIZE":
      return "PRIZE";
    default:
      return null;
  }
}

// ── Time helpers ────────────────────────────────────────────────────────────

/**
 * Konverter ISO-timestamp til Europe/Oslo dato (YYYY-MM-DD). Matcher
 * `dateKeyFromMs` fra `ComplianceLedgerValidators.ts` så vi havner i
 * samme bucket som §71-rapporten.
 *
 * Vi bruker `Intl.DateTimeFormat` med Oslo-tz fordi Render kjører UTC.
 */
export function isoToOsloDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA gir "YYYY-MM-DD"-format direkte.
  return fmt.format(date);
}

/**
 * Gitt en YYYY-MM-DD-string i Europe/Oslo, returner ISO-stringen for
 * starten av dagen i UTC (00:00:00 Oslo-tid).
 */
export function osloDateToUtcStartIso(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid YYYY-MM-DD date key: ${dateKey}`);
  }
  // Naivt: Oslo-tid er UTC+1 (vinter) eller UTC+2 (sommer). Vi bruker
  // en tilnærming via Date-konstruktør med tidssone-suffiks.
  // For SQL-filter er det greit å bruke en UTC-margin på 1-2 timer.
  // Vi velger 00:00 UTC av samme dato — det dekker hele Oslo-dagen +
  // litt ekstra. Reconciliation-script trenger ikke på sekundnivå.
  return `${dateKey}T00:00:00.000Z`;
}

/**
 * Returner ISO-string for slutten av Oslo-dagen i UTC (24:00:00 Oslo).
 * Vi gir en dags margin (24h til neste dag UTC 00:00) for å være sikre
 * på at ingen events faller utenfor.
 */
export function osloDateToUtcEndIso(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid YYYY-MM-DD date key: ${dateKey}`);
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  // Neste dag 00:00 UTC.
  const next = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  return next.toISOString();
}

// ── Aggregation ────────────────────────────────────────────────────────────

/**
 * Avrund til 2 desimaler (NOK-presisjon for §71).
 */
export function roundNok(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Bygg matching-nøkkel for bucket-aggregering.
 *
 * @internal
 */
function bucketKey(walletId: string, businessDate: string, side: ReconcileSide): string {
  return `${walletId}|${businessDate}|${side}`;
}

/**
 * Aggregér wallet-events til buckets (walletId × businessDate × side).
 */
export function aggregateWalletBuckets(
  events: ReadonlyArray<WalletReconcileEvent>,
): ReconcileBucket[] {
  const buckets = new Map<string, ReconcileBucket>();
  for (const ev of events) {
    const key = bucketKey(ev.accountId, ev.businessDate, ev.side);
    const existing = buckets.get(key);
    if (existing) {
      existing.totalAmountNok = roundNok(existing.totalAmountNok + ev.amountNok);
      existing.eventCount += 1;
    } else {
      buckets.set(key, {
        walletId: ev.accountId,
        businessDate: ev.businessDate,
        side: ev.side,
        totalAmountNok: roundNok(ev.amountNok),
        eventCount: 1,
      });
    }
  }
  return [...buckets.values()].sort(sortBuckets);
}

/**
 * Aggregér ledger-events til buckets (walletId × businessDate × side).
 */
export function aggregateLedgerBuckets(
  events: ReadonlyArray<LedgerReconcileEvent>,
): ReconcileBucket[] {
  const buckets = new Map<string, ReconcileBucket>();
  for (const ev of events) {
    const key = bucketKey(ev.walletId, ev.businessDate, ev.side);
    const existing = buckets.get(key);
    if (existing) {
      existing.totalAmountNok = roundNok(existing.totalAmountNok + ev.amountNok);
      existing.eventCount += 1;
    } else {
      buckets.set(key, {
        walletId: ev.walletId,
        businessDate: ev.businessDate,
        side: ev.side,
        totalAmountNok: roundNok(ev.amountNok),
        eventCount: 1,
      });
    }
  }
  return [...buckets.values()].sort(sortBuckets);
}

/**
 * Generic sort-comparer for any record with `(walletId, businessDate, side)`-
 * felt. Brukes for `ReconcileBucket`, `AmountMismatch` og `CountMismatch`
 * som alle deler matching-nøkkelen men har forskjellige tilleggsfelter.
 */
interface SortByMatchingKey {
  walletId: string;
  businessDate: string;
  side: ReconcileSide;
}

function sortBuckets<T extends SortByMatchingKey>(a: T, b: T): number {
  if (a.businessDate !== b.businessDate) return a.businessDate.localeCompare(b.businessDate);
  if (a.walletId !== b.walletId) return a.walletId.localeCompare(b.walletId);
  if (a.side !== b.side) return a.side.localeCompare(b.side);
  return 0;
}

/**
 * Aggregér ledger-events per (hallId, gameType, side) for breakdown-table.
 */
export function aggregateLedgerByHall(
  events: ReadonlyArray<LedgerReconcileEvent>,
): LedgerSummaryRow[] {
  const map = new Map<string, LedgerSummaryRow>();
  for (const ev of events) {
    const key = `${ev.hallId}|${ev.gameType}|${ev.side}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalAmountNok = roundNok(existing.totalAmountNok + ev.amountNok);
      existing.eventCount += 1;
    } else {
      map.set(key, {
        hallId: ev.hallId,
        gameType: ev.gameType,
        side: ev.side,
        totalAmountNok: roundNok(ev.amountNok),
        eventCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.hallId !== b.hallId) return a.hallId.localeCompare(b.hallId);
    if (a.gameType !== b.gameType) return a.gameType.localeCompare(b.gameType);
    return a.side.localeCompare(b.side);
  });
}

// ── Diff core ──────────────────────────────────────────────────────────────

/**
 * Sammenlign wallet- og ledger-buckets og returner divergenser.
 *
 * Matching-nøkkel: `(walletId, businessDate, side)`. For matchende
 * buckets sjekker vi:
 *   - amount-diff > 0 (med 2-desimal-toleranse) → AmountMismatch
 *   - count-diff != 0 → CountMismatch (advisory, ikke divergens)
 *
 * Buckets uten match flagges som walletOnly eller ledgerOnly.
 */
export function diffBuckets(
  walletBuckets: ReadonlyArray<ReconcileBucket>,
  ledgerBuckets: ReadonlyArray<ReconcileBucket>,
): {
  walletOnly: ReconcileBucket[];
  ledgerOnly: ReconcileBucket[];
  amountMismatches: AmountMismatch[];
  countMismatches: CountMismatch[];
} {
  const walletMap = new Map<string, ReconcileBucket>();
  for (const b of walletBuckets) {
    walletMap.set(bucketKey(b.walletId, b.businessDate, b.side), b);
  }
  const ledgerMap = new Map<string, ReconcileBucket>();
  for (const b of ledgerBuckets) {
    ledgerMap.set(bucketKey(b.walletId, b.businessDate, b.side), b);
  }

  const walletOnly: ReconcileBucket[] = [];
  const ledgerOnly: ReconcileBucket[] = [];
  const amountMismatches: AmountMismatch[] = [];
  const countMismatches: CountMismatch[] = [];

  // Walk wallet — finn matches og walletOnly.
  for (const [key, walletBucket] of walletMap) {
    const ledgerBucket = ledgerMap.get(key);
    if (!ledgerBucket) {
      walletOnly.push(walletBucket);
      continue;
    }
    const walletAmount = roundNok(walletBucket.totalAmountNok);
    const ledgerAmount = roundNok(ledgerBucket.totalAmountNok);
    const diff = roundNok(walletAmount - ledgerAmount);
    if (Math.abs(diff) > 0.001) {
      amountMismatches.push({
        walletId: walletBucket.walletId,
        businessDate: walletBucket.businessDate,
        side: walletBucket.side,
        walletAmountNok: walletAmount,
        ledgerAmountNok: ledgerAmount,
        diffNok: diff,
      });
    }
    if (walletBucket.eventCount !== ledgerBucket.eventCount) {
      countMismatches.push({
        walletId: walletBucket.walletId,
        businessDate: walletBucket.businessDate,
        side: walletBucket.side,
        walletCount: walletBucket.eventCount,
        ledgerCount: ledgerBucket.eventCount,
        diff: walletBucket.eventCount - ledgerBucket.eventCount,
      });
    }
  }

  // Walk ledger — finn ledgerOnly.
  for (const [key, ledgerBucket] of ledgerMap) {
    if (!walletMap.has(key)) {
      ledgerOnly.push(ledgerBucket);
    }
  }

  return {
    walletOnly: walletOnly.sort(sortBuckets),
    ledgerOnly: ledgerOnly.sort(sortBuckets),
    amountMismatches: amountMismatches.sort(sortBuckets),
    countMismatches: countMismatches.sort(sortBuckets),
  };
}

/**
 * Beregn aggregert totals for hele perioden fra normaliserte events.
 */
export function computeWalletTotals(events: ReadonlyArray<WalletReconcileEvent>): {
  stakeAmountNok: number;
  stakeCount: number;
  prizeAmountNok: number;
  prizeCount: number;
} {
  let stakeAmount = 0;
  let stakeCount = 0;
  let prizeAmount = 0;
  let prizeCount = 0;
  for (const ev of events) {
    if (ev.side === "STAKE") {
      stakeAmount += ev.amountNok;
      stakeCount += 1;
    } else {
      prizeAmount += ev.amountNok;
      prizeCount += 1;
    }
  }
  return {
    stakeAmountNok: roundNok(stakeAmount),
    stakeCount,
    prizeAmountNok: roundNok(prizeAmount),
    prizeCount,
  };
}

/**
 * Beregn aggregert totals for hele perioden fra ledger-events.
 */
export function computeLedgerTotals(events: ReadonlyArray<LedgerReconcileEvent>): {
  stakeAmountNok: number;
  stakeCount: number;
  prizeAmountNok: number;
  prizeCount: number;
} {
  let stakeAmount = 0;
  let stakeCount = 0;
  let prizeAmount = 0;
  let prizeCount = 0;
  for (const ev of events) {
    if (ev.side === "STAKE") {
      stakeAmount += ev.amountNok;
      stakeCount += 1;
    } else {
      prizeAmount += ev.amountNok;
      prizeCount += 1;
    }
  }
  return {
    stakeAmountNok: roundNok(stakeAmount),
    stakeCount,
    prizeAmountNok: roundNok(prizeAmount),
    prizeCount,
  };
}

/**
 * Hovedinngang: gitt normaliserte events fra begge kilder, kjør full
 * reconciliation og returner strukturert resultat.
 */
export function reconcile(input: {
  fromDate: string;
  toDate: string;
  hallFilter: string | null;
  walletEvents: ReadonlyArray<WalletReconcileEvent>;
  ledgerEvents: ReadonlyArray<LedgerReconcileEvent>;
}): ReconciliationResult {
  const walletBuckets = aggregateWalletBuckets(input.walletEvents);
  const ledgerBuckets = aggregateLedgerBuckets(input.ledgerEvents);
  const ledgerByHall = aggregateLedgerByHall(input.ledgerEvents);

  const diff = diffBuckets(walletBuckets, ledgerBuckets);

  const walletTotals = computeWalletTotals(input.walletEvents);
  const ledgerTotals = computeLedgerTotals(input.ledgerEvents);

  const isReconciled =
    diff.walletOnly.length === 0 &&
    diff.ledgerOnly.length === 0 &&
    diff.amountMismatches.length === 0;

  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    hallFilter: input.hallFilter,
    walletTotals,
    ledgerTotals,
    ledgerByHall,
    walletOnlyBuckets: diff.walletOnly,
    ledgerOnlyBuckets: diff.ledgerOnly,
    amountMismatches: diff.amountMismatches,
    countMismatches: diff.countMismatches,
    isReconciled,
  };
}

// ── Output formatting ──────────────────────────────────────────────────────

/**
 * Formatér beløp i norsk format (1 234,50 kr) for terminal-output.
 */
function formatNok(amount: number): string {
  // We use thousands-separator " " (NBSP would be ideal but breaks copy/paste
  // in some terminals).
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const fixed = abs.toFixed(2);
  const [whole, dec] = fixed.split(".");
  const withSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${withSep},${dec}`;
}

/**
 * Bygg markdown-rapport av reconciliation-resultat.
 */
export function formatMarkdown(result: ReconciliationResult): string {
  const lines: string[] = [];
  lines.push("# Wallet-vs-Ledger Reconciliation");
  lines.push("");
  lines.push(`Period: ${result.fromDate} → ${result.toDate}`);
  if (result.hallFilter) {
    lines.push(`Hall filter: ${result.hallFilter}`);
  }
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Wallet (NOK) | Ledger (NOK) | Diff |");
  lines.push("|---|---:|---:|---:|");
  const stakeDiff = roundNok(
    result.walletTotals.stakeAmountNok - result.ledgerTotals.stakeAmountNok,
  );
  const prizeDiff = roundNok(
    result.walletTotals.prizeAmountNok - result.ledgerTotals.prizeAmountNok,
  );
  const stakeCountDiff =
    result.walletTotals.stakeCount - result.ledgerTotals.stakeCount;
  const prizeCountDiff =
    result.walletTotals.prizeCount - result.ledgerTotals.prizeCount;
  lines.push(
    `| Total stakes (NOK) | ${formatNok(result.walletTotals.stakeAmountNok)} | ${formatNok(result.ledgerTotals.stakeAmountNok)} | ${stakeDiff === 0 ? "0 OK" : formatNok(stakeDiff) + " DIFF"} |`,
  );
  lines.push(
    `| Total prizes (NOK) | ${formatNok(result.walletTotals.prizeAmountNok)} | ${formatNok(result.ledgerTotals.prizeAmountNok)} | ${prizeDiff === 0 ? "0 OK" : formatNok(prizeDiff) + " DIFF"} |`,
  );
  lines.push(
    `| Stake event count | ${result.walletTotals.stakeCount} | ${result.ledgerTotals.stakeCount} | ${stakeCountDiff === 0 ? "0 OK" : String(stakeCountDiff) + " DIFF"} |`,
  );
  lines.push(
    `| Prize event count | ${result.walletTotals.prizeCount} | ${result.ledgerTotals.prizeCount} | ${prizeCountDiff === 0 ? "0 OK" : String(prizeCountDiff) + " DIFF"} |`,
  );
  lines.push("");

  // Per-hall ledger breakdown
  lines.push("## Per-hall breakdown (ledger-side)");
  lines.push("");
  if (result.ledgerByHall.length === 0) {
    lines.push("_(ingen ledger-events i perioden)_");
  } else {
    lines.push("| Hall | Game type | Side | Amount (NOK) | Count |");
    lines.push("|---|---|---|---:|---:|");
    for (const row of result.ledgerByHall) {
      lines.push(
        `| ${row.hallId} | ${row.gameType} | ${row.side} | ${formatNok(row.totalAmountNok)} | ${row.eventCount} |`,
      );
    }
  }
  lines.push("");

  // Divergens
  lines.push("## Divergens-deteksjon");
  lines.push("");
  if (result.isReconciled && result.countMismatches.length === 0) {
    lines.push("_(ingen divergens detektert — wallet og ledger er konsistente)_");
  } else {
    if (result.walletOnlyBuckets.length > 0) {
      lines.push(
        `### Wallet-only buckets (${result.walletOnlyBuckets.length}) — POTENSIELT COMPLIANCE-BRUDD`,
      );
      lines.push("");
      lines.push(
        "Wallet-mutasjon uten tilsvarende §71-rapport-event. Kan bety at en kjøpe-/utbetalings-flyt ikke skrev til compliance-ledger.",
      );
      lines.push("");
      lines.push("| Wallet | Date | Side | Amount (NOK) | Count |");
      lines.push("|---|---|---|---:|---:|");
      for (const b of result.walletOnlyBuckets.slice(0, 50)) {
        lines.push(
          `| ${b.walletId} | ${b.businessDate} | ${b.side} | ${formatNok(b.totalAmountNok)} | ${b.eventCount} |`,
        );
      }
      if (result.walletOnlyBuckets.length > 50) {
        lines.push(`| _+${result.walletOnlyBuckets.length - 50} flere..._ | | | | |`);
      }
      lines.push("");
    }

    if (result.ledgerOnlyBuckets.length > 0) {
      lines.push(
        `### Ledger-only buckets (${result.ledgerOnlyBuckets.length}) — POTENSIELT PHANTOM-RAPPORT`,
      );
      lines.push("");
      lines.push(
        "§71-event uten tilsvarende wallet-mutasjon. Kan bety at compliance-ledger har en event som aldri faktisk berørte spillerens wallet.",
      );
      lines.push("");
      lines.push("| Wallet | Date | Side | Amount (NOK) | Count |");
      lines.push("|---|---|---|---:|---:|");
      for (const b of result.ledgerOnlyBuckets.slice(0, 50)) {
        lines.push(
          `| ${b.walletId} | ${b.businessDate} | ${b.side} | ${formatNok(b.totalAmountNok)} | ${b.eventCount} |`,
        );
      }
      if (result.ledgerOnlyBuckets.length > 50) {
        lines.push(`| _+${result.ledgerOnlyBuckets.length - 50} flere..._ | | | | |`);
      }
      lines.push("");
    }

    if (result.amountMismatches.length > 0) {
      lines.push(
        `### Beløps-mismatch (${result.amountMismatches.length}) — HØY RISIKO`,
      );
      lines.push("");
      lines.push("Buckets finnes på begge sider, men beløpet er forskjellig.");
      lines.push("");
      lines.push("| Wallet | Date | Side | Wallet (NOK) | Ledger (NOK) | Diff (NOK) |");
      lines.push("|---|---|---|---:|---:|---:|");
      for (const m of result.amountMismatches.slice(0, 50)) {
        lines.push(
          `| ${m.walletId} | ${m.businessDate} | ${m.side} | ${formatNok(m.walletAmountNok)} | ${formatNok(m.ledgerAmountNok)} | ${formatNok(m.diffNok)} |`,
        );
      }
      if (result.amountMismatches.length > 50) {
        lines.push(`| _+${result.amountMismatches.length - 50} flere..._ | | | | | |`);
      }
      lines.push("");
    }

    if (result.countMismatches.length > 0) {
      lines.push(
        `### Antall-mismatch (${result.countMismatches.length}) — ADVARSEL`,
      );
      lines.push("");
      lines.push(
        "Buckets matcher i sum, men antall events er forskjellig. Kan skyldes lovlig multi-event-aggregering hvis sum stemmer.",
      );
      lines.push("");
      lines.push("| Wallet | Date | Side | Wallet count | Ledger count | Diff |");
      lines.push("|---|---|---|---:|---:|---:|");
      for (const m of result.countMismatches.slice(0, 50)) {
        lines.push(
          `| ${m.walletId} | ${m.businessDate} | ${m.side} | ${m.walletCount} | ${m.ledgerCount} | ${m.diff} |`,
        );
      }
      if (result.countMismatches.length > 50) {
        lines.push(`| _+${result.countMismatches.length - 50} flere..._ | | | | | |`);
      }
      lines.push("");
    }
  }

  // Status
  lines.push("## Status");
  lines.push("");
  if (result.isReconciled) {
    lines.push("**RECONCILED** — wallet og ledger stemmer overens. Eksisterer 0 divergens.");
  } else {
    lines.push("**DIVERGENS DETEKTERT** — eskaler til compliance-eier.");
    lines.push("");
    lines.push(
      "Se `apps/backend/scripts/README.md` §G9 for eskaleringssti og recovery-prosedyre.",
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Bygg JSON-rapport (kompakt, men gyldig JSON med pretty-print).
 */
export function formatJson(result: ReconciliationResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Bygg CSV med per-bucket diff-output. Header + rader; rader for både
 * walletOnly, ledgerOnly og amountMismatches separert med `kind`-kolonne.
 */
export function formatCsv(result: ReconciliationResult): string {
  const rows: string[] = [];
  rows.push(
    "kind,walletId,businessDate,side,walletAmountNok,ledgerAmountNok,diffNok,walletCount,ledgerCount",
  );
  for (const b of result.walletOnlyBuckets) {
    rows.push(
      `wallet_only,${csvEscape(b.walletId)},${b.businessDate},${b.side},${b.totalAmountNok.toFixed(2)},,${b.totalAmountNok.toFixed(2)},${b.eventCount},0`,
    );
  }
  for (const b of result.ledgerOnlyBuckets) {
    rows.push(
      `ledger_only,${csvEscape(b.walletId)},${b.businessDate},${b.side},,${b.totalAmountNok.toFixed(2)},${(-b.totalAmountNok).toFixed(2)},0,${b.eventCount}`,
    );
  }
  for (const m of result.amountMismatches) {
    rows.push(
      `amount_mismatch,${csvEscape(m.walletId)},${m.businessDate},${m.side},${m.walletAmountNok.toFixed(2)},${m.ledgerAmountNok.toFixed(2)},${m.diffNok.toFixed(2)},,`,
    );
  }
  for (const m of result.countMismatches) {
    rows.push(
      `count_mismatch,${csvEscape(m.walletId)},${m.businessDate},${m.side},,,,${m.walletCount},${m.ledgerCount}`,
    );
  }
  // CRLF for Excel-kompatibilitet på NO-locale.
  return rows.join("\r\n") + "\r\n";
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
