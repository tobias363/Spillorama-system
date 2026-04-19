/**
 * BIN-628: admin track-spending aggregat.
 *
 * Norwegian pengespillforskriften §11 forebyggende tiltak: admin må ha
 * en oversikt over spend per hall i perioder, sammen med hallens
 * Spillvett-tak, for å vurdere om preventiv kontakt med spillere er
 * nødvendig.
 *
 * Per-spiller-aggregatet eksisterer allerede i `playerReport.ts`.
 * Denne filen legger et aggregat-lag oppå: grupper på hall + periode,
 * summér stake/prize/netSpend, regn unique-player-count og gjennomsnitt,
 * fest hallens Spillvett-limits til hver rad.
 *
 * Regulatoriske hard-krav (PR-beskrivelsens sjekkliste):
 *   - Fail-closed: Hvis data-cache er stale (>MAX_ALLOWED_STALE_MS), eller
 *     DB-kallet feiler, returner `dataStale: true` slik at router-laget kan
 *     mappe til HTTP 503. Aldri vis tom data uten eksplisitt 503.
 *   - Per-hall limits: Hver aggregate-rad inkluderer dailyLimit/monthlyLimit
 *     fra hallGameConfig (hall_override) eller regulatory defaults.
 *   - Ingen mandatorisk pause-felt: Norway har voluntary pause + self-
 *     exclusion 1 år, IKKE automatisk mandatory pause. Se `user-memory:
 *     Spillvett implementation`.
 *   - AuditLog-integrasjon skjer i router-laget (denne tjenesten er ren
 *     aggregat-compute — ingen side-effekter mot audit-log).
 *
 * Gjenbruk:
 *   - `playerReport.ts` eier per-spiller-breakdown. Vi re-bruker IKKE
 *     `buildPlayerReport()` direkte her fordi den komputerer dag-arrays
 *     og plays-detaljer vi ikke trenger. Vi leser samme kilde
 *     (`ComplianceLedgerEntry[]`) og gjør vårt eget gruppe-pass.
 */

import type { ComplianceLedgerEntry } from "../game/ComplianceLedger.js";
import type { HallDefinition } from "../platform/PlatformService.js";
import type { LossLimits } from "../game/ComplianceManager.js";

/** Fail-closed grense. Data fra mer enn 15 min tilbake = 503. */
export const TRACK_SPENDING_MAX_STALE_MS = 15 * 60 * 1000;

export interface TrackSpendingHallLimits {
  hallId: string;
  hallName: string;
  dailyLimit: number;
  monthlyLimit: number;
  source: "regulatory" | "hall_override";
}

export interface TrackSpendingAggregateRow {
  hallId: string;
  hallName: string;
  periodStart: string;
  periodEnd: string;
  totalStake: number;
  totalPrize: number;
  netSpend: number;
  uniquePlayerCount: number;
  averageSpendPerPlayer: number;
  stakeEventCount: number;
  limits: TrackSpendingHallLimits;
}

export interface TrackSpendingTotals {
  totalStake: number;
  totalPrize: number;
  netSpend: number;
  uniquePlayerCount: number;
  stakeEventCount: number;
}

export interface TrackSpendingDataFreshness {
  computedAt: string;
  staleMs: number;
  maxAllowedStaleMs: number;
}

export interface TrackSpendingAggregateResult {
  generatedAt: string;
  from: string;
  to: string;
  hallId: string | null;
  rows: TrackSpendingAggregateRow[];
  totals: TrackSpendingTotals;
  nextCursor: string | null;
  dataFreshness: TrackSpendingDataFreshness;
}

export interface TrackSpendingTransactionRow {
  id: string;
  createdAt: string;
  hallId: string;
  hallName: string;
  playerId: string | null;
  walletId: string | null;
  gameType: ComplianceLedgerEntry["gameType"];
  channel: ComplianceLedgerEntry["channel"];
  eventType: "STAKE" | "PRIZE" | "EXTRA_PRIZE";
  amount: number;
  currency: "NOK";
  roomCode?: string;
  gameId?: string;
}

export interface TrackSpendingTransactionsResult {
  generatedAt: string;
  from: string;
  to: string;
  hallId: string | null;
  playerId: string | null;
  transactions: TrackSpendingTransactionRow[];
  nextCursor: string | null;
  dataFreshness: TrackSpendingDataFreshness;
}

/**
 * Per-hall overrides for Spillvett-tak. I BingoEngine finnes kun
 * `regulatoryLossLimits` (system-wide) p.t., men denne typen gir oss et
 * entry-point for fremtidig per-hall-konfig uten å endre signaturen.
 */
export interface HallSpillvettOverrides {
  hallId: string;
  dailyLimit?: number;
  monthlyLimit?: number;
}

export interface TrackSpendingAggregateInput {
  entries: ComplianceLedgerEntry[];
  halls: HallDefinition[];
  from: string; // ISO
  to: string;   // ISO
  hallId?: string;
  /** Default regulatoriske Spillvett-tak (system-wide). */
  regulatoryLimits: LossLimits;
  /** Per-hall-overrides; tom liste = ingen overrides. */
  hallOverrides?: HallSpillvettOverrides[];
  /** Hvor lenge siden data ble beregnet (fra cache-lag). 0 = akkurat nå. */
  dataAgeMs?: number;
  /** Cursor for paginering — opaque string mappet internt. */
  cursor?: string;
  /** Page-size. Default 50, max 500. */
  pageSize?: number;
  /** Time-source for deterministisk testing. */
  now?: Date;
  /** Max allowed stale overrides (testing). Default = TRACK_SPENDING_MAX_STALE_MS. */
  maxAllowedStaleMs?: number;
}

export interface TrackSpendingTransactionsInput {
  entries: ComplianceLedgerEntry[];
  halls: HallDefinition[];
  from: string;
  to: string;
  hallId?: string;
  playerId?: string;
  dataAgeMs?: number;
  cursor?: string;
  pageSize?: number;
  now?: Date;
  maxAllowedStaleMs?: number;
}

/** Fail-closed-signalet. Router-laget mapper dette til HTTP 503. */
export class TrackSpendingStaleDataError extends Error {
  readonly code = "TRACK_SPENDING_STALE_DATA";
  constructor(readonly staleMs: number, readonly maxAllowedStaleMs: number) {
    super(
      `Track-spending-data er ${staleMs}ms gammelt, men grensen er ${maxAllowedStaleMs}ms. ` +
      "Regulatorisk fail-closed: admin skal ikke se utdatert Spillvett-aggregat."
    );
    this.name = "TrackSpendingStaleDataError";
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getHallLimits(
  hall: HallDefinition,
  regulatory: LossLimits,
  overridesByHall: Map<string, HallSpillvettOverrides>,
): TrackSpendingHallLimits {
  const override = overridesByHall.get(hall.id);
  const hasDaily = override?.dailyLimit !== undefined;
  const hasMonthly = override?.monthlyLimit !== undefined;
  if (hasDaily || hasMonthly) {
    return {
      hallId: hall.id,
      hallName: hall.name,
      dailyLimit: hasDaily ? override!.dailyLimit! : regulatory.daily,
      monthlyLimit: hasMonthly ? override!.monthlyLimit! : regulatory.monthly,
      source: "hall_override",
    };
  }
  return {
    hallId: hall.id,
    hallName: hall.name,
    dailyLimit: regulatory.daily,
    monthlyLimit: regulatory.monthly,
    source: "regulatory",
  };
}

function filterEntriesInWindow(
  entries: ComplianceLedgerEntry[],
  fromMs: number,
  toMs: number,
  hallId?: string,
): ComplianceLedgerEntry[] {
  return entries.filter((entry) => {
    if (entry.createdAtMs < fromMs) return false;
    if (entry.createdAtMs > toMs) return false;
    if (hallId && entry.hallId !== hallId) return false;
    return true;
  });
}

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

function assertIsoWindow(from: string, to: string): { fromMs: number; toMs: number } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs)) {
    throw new Error(`[BIN-628] Ugyldig 'from': ${from}`);
  }
  if (!Number.isFinite(toMs)) {
    throw new Error(`[BIN-628] Ugyldig 'to': ${to}`);
  }
  if (fromMs > toMs) {
    throw new Error(`[BIN-628] 'from' må være <= 'to' (${from} > ${to}).`);
  }
  return { fromMs, toMs };
}

// ── Aggregat ────────────────────────────────────────────────────────────────

/**
 * Aggregér ledger-entries per (hall) for den oppgitte perioden.
 *
 * Pagineringen er hall-basert (én rad per hall), så cursor-offset
 * refererer til posisjonen i hall-listen, ikke event-listen. Det gir
 * stabil paginering selv om nye events lander underveis.
 */
export function buildTrackSpendingAggregate(
  input: TrackSpendingAggregateInput,
): TrackSpendingAggregateResult {
  const now = input.now ?? new Date();
  const maxAllowedStaleMs = input.maxAllowedStaleMs ?? TRACK_SPENDING_MAX_STALE_MS;
  const dataAgeMs = Math.max(0, Math.floor(input.dataAgeMs ?? 0));

  if (dataAgeMs > maxAllowedStaleMs) {
    throw new TrackSpendingStaleDataError(dataAgeMs, maxAllowedStaleMs);
  }

  const { fromMs, toMs } = assertIsoWindow(input.from, input.to);
  const pageSize = Math.max(1, Math.min(500, Math.floor(input.pageSize ?? 50)));
  const cursorOffset = input.cursor ? decodeCursor(input.cursor) : 0;

  const overridesByHall = new Map<string, HallSpillvettOverrides>();
  for (const override of input.hallOverrides ?? []) {
    overridesByHall.set(override.hallId, override);
  }

  const hallsById = new Map<string, HallDefinition>();
  for (const hall of input.halls) {
    hallsById.set(hall.id, hall);
  }

  // Filter entries inside the window + optional hall-scope.
  const scopedEntries = filterEntriesInWindow(input.entries, fromMs, toMs, input.hallId);

  // Build per-hall aggregate.
  interface HallBucket {
    hallId: string;
    totalStake: number;
    totalPrize: number;
    wallets: Set<string>;
    stakeEventCount: number;
  }
  const bucketsByHall = new Map<string, HallBucket>();

  for (const entry of scopedEntries) {
    const bucket = bucketsByHall.get(entry.hallId) ?? {
      hallId: entry.hallId,
      totalStake: 0,
      totalPrize: 0,
      wallets: new Set<string>(),
      stakeEventCount: 0,
    };
    if (entry.eventType === "STAKE") {
      bucket.totalStake += entry.amount;
      bucket.stakeEventCount += 1;
      if (entry.walletId) bucket.wallets.add(entry.walletId);
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      bucket.totalPrize += entry.amount;
    }
    // ORG_DISTRIBUTION ignoreres — ikke spiller-spend.
    bucketsByHall.set(entry.hallId, bucket);
  }

  // Build rows — hallId-scope eller alle haller med aktivitet, sortert etter navn for stabilitet.
  let hallIdsInScope: string[];
  if (input.hallId) {
    hallIdsInScope = hallsById.has(input.hallId) ? [input.hallId] : [];
  } else {
    // Ta med alle aktive haller selv om de ikke har events — admin skal se
    // "0 spend" rad for disse (gir fullstendig oversikt per regulatorisk krav).
    hallIdsInScope = input.halls
      .filter((hall) => hall.isActive)
      .map((hall) => hall.id);
    // Inkluder også inaktive haller som FAKTISK har events i vinduet (feks.
    // hall ble deaktivert midt i perioden — admin må fortsatt se aktiviteten).
    for (const hallId of bucketsByHall.keys()) {
      if (!hallIdsInScope.includes(hallId)) {
        hallIdsInScope.push(hallId);
      }
    }
  }

  const sortedHallIds = hallIdsInScope
    .slice()
    .sort((a, b) => {
      const nameA = hallsById.get(a)?.name ?? a;
      const nameB = hallsById.get(b)?.name ?? b;
      return nameA.localeCompare(nameB, "nb");
    });

  const paged = sortedHallIds.slice(cursorOffset, cursorOffset + pageSize);
  const nextOffset = cursorOffset + paged.length;
  const nextCursor = nextOffset < sortedHallIds.length ? encodeCursor(nextOffset) : null;

  const periodStart = new Date(fromMs).toISOString();
  const periodEnd = new Date(toMs).toISOString();

  const rows: TrackSpendingAggregateRow[] = paged.map((hallId) => {
    const hall = hallsById.get(hallId);
    // Ukjent hallId (kan skje hvis hall ble slettet) — fallback til id som navn.
    const hallName = hall?.name ?? hallId;
    const limits = hall
      ? getHallLimits(hall, input.regulatoryLimits, overridesByHall)
      : {
          hallId,
          hallName,
          dailyLimit: input.regulatoryLimits.daily,
          monthlyLimit: input.regulatoryLimits.monthly,
          source: "regulatory" as const,
        };
    const bucket = bucketsByHall.get(hallId);
    const totalStake = bucket ? roundCurrency(bucket.totalStake) : 0;
    const totalPrize = bucket ? roundCurrency(bucket.totalPrize) : 0;
    const netSpend = roundCurrency(totalStake - totalPrize);
    const uniquePlayerCount = bucket ? bucket.wallets.size : 0;
    const averageSpendPerPlayer =
      uniquePlayerCount > 0 ? roundCurrency(netSpend / uniquePlayerCount) : 0;
    const stakeEventCount = bucket ? bucket.stakeEventCount : 0;
    return {
      hallId,
      hallName,
      periodStart,
      periodEnd,
      totalStake,
      totalPrize,
      netSpend,
      uniquePlayerCount,
      averageSpendPerPlayer,
      stakeEventCount,
      limits,
    };
  });

  // Totals gjelder hele scoped-settet, ikke bare siden vi returnerer,
  // så admin ser fullbildet uansett hvor i paginationen de er.
  const totalsStake = scopedEntries
    .filter((e) => e.eventType === "STAKE")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalsPrize = scopedEntries
    .filter((e) => e.eventType === "PRIZE" || e.eventType === "EXTRA_PRIZE")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalsWallets = new Set<string>();
  let totalsStakeCount = 0;
  for (const entry of scopedEntries) {
    if (entry.eventType === "STAKE") {
      totalsStakeCount += 1;
      if (entry.walletId) totalsWallets.add(entry.walletId);
    }
  }

  return {
    generatedAt: now.toISOString(),
    from: input.from,
    to: input.to,
    hallId: input.hallId ?? null,
    rows,
    totals: {
      totalStake: roundCurrency(totalsStake),
      totalPrize: roundCurrency(totalsPrize),
      netSpend: roundCurrency(totalsStake - totalsPrize),
      uniquePlayerCount: totalsWallets.size,
      stakeEventCount: totalsStakeCount,
    },
    nextCursor,
    dataFreshness: {
      computedAt: new Date(now.getTime() - dataAgeMs).toISOString(),
      staleMs: dataAgeMs,
      maxAllowedStaleMs,
    },
  };
}

/**
 * Detalj-liste: én rad per ledger-entry (stake/prize/extra-prize).
 * Paginering er offset-basert over den sorterte event-listen (nyeste først).
 */
export function buildTrackSpendingTransactions(
  input: TrackSpendingTransactionsInput,
): TrackSpendingTransactionsResult {
  const now = input.now ?? new Date();
  const maxAllowedStaleMs = input.maxAllowedStaleMs ?? TRACK_SPENDING_MAX_STALE_MS;
  const dataAgeMs = Math.max(0, Math.floor(input.dataAgeMs ?? 0));

  if (dataAgeMs > maxAllowedStaleMs) {
    throw new TrackSpendingStaleDataError(dataAgeMs, maxAllowedStaleMs);
  }

  const { fromMs, toMs } = assertIsoWindow(input.from, input.to);
  const pageSize = Math.max(1, Math.min(500, Math.floor(input.pageSize ?? 100)));
  const cursorOffset = input.cursor ? decodeCursor(input.cursor) : 0;

  const hallsById = new Map<string, HallDefinition>();
  for (const hall of input.halls) {
    hallsById.set(hall.id, hall);
  }

  // Filter: window + hall-scope + player-scope + event-type (bare spend-events).
  const scoped = input.entries
    .filter((e) => {
      if (e.createdAtMs < fromMs || e.createdAtMs > toMs) return false;
      if (input.hallId && e.hallId !== input.hallId) return false;
      if (input.playerId && e.playerId !== input.playerId) return false;
      if (e.eventType === "ORG_DISTRIBUTION") return false;
      return true;
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  const paged = scoped.slice(cursorOffset, cursorOffset + pageSize);
  const nextOffset = cursorOffset + paged.length;
  const nextCursor = nextOffset < scoped.length ? encodeCursor(nextOffset) : null;

  const transactions: TrackSpendingTransactionRow[] = paged.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    hallId: entry.hallId,
    hallName: hallsById.get(entry.hallId)?.name ?? entry.hallId,
    playerId: entry.playerId ?? null,
    walletId: entry.walletId ?? null,
    gameType: entry.gameType,
    channel: entry.channel,
    eventType: entry.eventType as "STAKE" | "PRIZE" | "EXTRA_PRIZE",
    amount: entry.amount,
    currency: "NOK",
    roomCode: entry.roomCode,
    gameId: entry.gameId,
  }));

  return {
    generatedAt: now.toISOString(),
    from: input.from,
    to: input.to,
    hallId: input.hallId ?? null,
    playerId: input.playerId ?? null,
    transactions,
    nextCursor,
    dataFreshness: {
      computedAt: new Date(now.getTime() - dataAgeMs).toISOString(),
      staleMs: dataAgeMs,
      maxAllowedStaleMs,
    },
  };
}
