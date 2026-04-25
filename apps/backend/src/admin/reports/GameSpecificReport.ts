/**
 * GAP #28 — Per-spilltype-spesifikke rapport-shapes.
 *
 * Legacy reference:
 *   - `legacy/unity-backend/App/Routes/backend.js:201-218`
 *     `GET /reportGame2`, `/reportGame3`, `/reportGame4`, `/reportGame5`
 *     (+ tilhørende `/getReportGame{N}` data-endpoints).
 *   - `legacy/unity-backend/App/Controllers/ReportsController.js:878-2478`
 *     (per-spill aggregat-pipelines).
 *
 * Per `docs/architecture/SPILLKATALOG.md` (oppdatert 2026-04-25):
 *   | Slug          | Spill                | Type        | Source ledger-fingerprint  |
 *   |---------------|----------------------|-------------|----------------------------|
 *   | `bingo`       | Spill 1 (game1)      | Hovedspill  | metadata.gameSlug='bingo'  |
 *   | `rocket`      | Spill 2 (game2)      | Hovedspill  | metadata.gameSlug='rocket' |
 *   | `monsterbingo`| Spill 3 (game3)      | Hovedspill  | …='monsterbingo'           |
 *   | `spillorama`  | SpinnGo (game5)      | Databingo   | …='spillorama'             |
 *
 * Game 4 (legacy `themebingo`) ble permanent avviklet per BIN-496 (2026-04-17).
 * Endpoint avviser `themebingo` / `game4` med INVALID_INPUT.
 *
 * Hver spilltype har sine egne KPI-er (per BACKEND_1TO1_GAP_AUDIT §6 #28):
 *
 * - **bingo** (Spill 1): sub-game-rotation (Wheel/Chest/Mystery/ColorDraft),
 *   Lucky Number-payouts, Game1-jackpot-utdelinger, mini-game-utfall.
 *   ⇒ `subGameKindBreakdown`, `luckyNumberPayouts`, `jackpotPayouts`.
 *
 * - **rocket** (Spill 2): rocket-stacking-progress, blind-ticket-buy,
 *   Lucky Number.
 *   ⇒ `rocketStackingRounds`, `blindTicketBuys`, `luckyNumberPayouts`.
 *
 * - **monsterbingo** (Spill 3): mønster-evaluering-utfall, ball-FIFO-stats.
 *   ⇒ `patternsEvaluated`, `ballFifoEvents`.
 *
 * - **spillorama** (SpinnGo / Databingo): rulett-utfall, Free Spin Jackpot,
 *   SwapTicket-bruk.
 *   ⇒ `rouletteOutcomes`, `freeSpinJackpotPayouts`, `swapTicketUses`.
 *
 * Fellesfelter for alle spilltyper:
 *   - rounds, distinctPlayers, totalStakes, totalPrizes, net, payoutPct
 *   - per-hall + per-channel breakdown
 *
 * Ren funksjon — ingen DB I/O. Ruten plumber inn ledger-entries via
 * `engine.listComplianceLedgerEntries` + halls via `platformService`.
 */

import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import type { HallDefinition } from "../../platform/PlatformService.js";

// ── Slug-mapping ───────────────────────────────────────────────────────────

/**
 * Slug-er som er gyldige for game-specific rapporter. Speiler
 * SPILLKATALOG.md (2026-04-25). Game 4 / `themebingo` er IKKE gyldig.
 *
 * - `bingo` = Spill 1
 * - `rocket` = Spill 2
 * - `monsterbingo` = Spill 3
 * - `spillorama` = SpinnGo / Databingo
 */
export const SUPPORTED_GAME_SPECIFIC_SLUGS = [
  "bingo",
  "rocket",
  "monsterbingo",
  "spillorama",
] as const;
export type GameSpecificSlug = (typeof SUPPORTED_GAME_SPECIFIC_SLUGS)[number];

/** BIN-496: Game 4 ("themebingo") ble permanent avviklet 2026-04-17. */
export const DEPRECATED_GAME_SLUGS = ["themebingo", "game4"] as const;

// ── Felles aggregater ──────────────────────────────────────────────────────

interface BaseAggregates {
  rounds: number;
  distinctPlayers: number;
  totalStakes: number;
  totalPrizes: number;
  net: number;
  /** (totalPrizes * 100) / totalStakes; 0 hvis stakes==0. */
  payoutPct: number;
}

interface ChannelBucket {
  hallChannel: BaseAggregates;
  internetChannel: BaseAggregates;
}

interface PerHallRow extends BaseAggregates {
  hallId: string;
  hallName: string;
}

// ── Per-slug spesifikke shapes ─────────────────────────────────────────────

/**
 * Spill 1 (bingo) — sub-game-rotation + Lucky Number + jackpot.
 *
 * `subGameKindBreakdown` mapper kjent kind→count. Kjente kinds:
 *   - "wheel" (Wheel of Fortune)
 *   - "chest" (Treasure Chest)
 *   - "mystery" (Mystery)
 *   - "colordraft" (ColorDraft)
 *   - "standard" (vanlig 5x5 uten mini-game)
 *   - "unknown" (ledger-entries uten kind-tagging)
 */
export interface BingoSpecificFields {
  subGameKindBreakdown: Record<string, number>;
  luckyNumberPayouts: { count: number; total: number };
  jackpotPayouts: { count: number; total: number };
  miniGamePayouts: { count: number; total: number };
}

/** Spill 2 (rocket) — rocket-stacking + blind-ticket-buy + Lucky Number. */
export interface RocketSpecificFields {
  rocketStackingRounds: number;
  blindTicketBuys: { count: number; total: number };
  luckyNumberPayouts: { count: number; total: number };
}

/** Spill 3 (monsterbingo) — pattern-evaluering + ball-FIFO. */
export interface MonsterbingoSpecificFields {
  patternsEvaluated: number;
  ballFifoEvents: number;
  patternBreakdown: Record<string, number>;
}

/** SpinnGo (spillorama) — rulett + Free Spin Jackpot + SwapTicket. */
export interface SpilloramaSpecificFields {
  rouletteOutcomes: { count: number; total: number };
  freeSpinJackpotPayouts: { count: number; total: number };
  swapTicketUses: number;
}

export type GameSpecificFields =
  | { slug: "bingo"; specifics: BingoSpecificFields }
  | { slug: "rocket"; specifics: RocketSpecificFields }
  | { slug: "monsterbingo"; specifics: MonsterbingoSpecificFields }
  | { slug: "spillorama"; specifics: SpilloramaSpecificFields };

// ── Result ─────────────────────────────────────────────────────────────────

export interface GameSpecificReportResult {
  /** ISO-window for raporten. */
  from: string;
  to: string;
  generatedAt: string;
  slug: GameSpecificSlug;
  /** Hovedspill | Databingo. */
  category: "Hovedspill" | "Databingo";
  /** Filtre brukt. */
  filters: {
    hallId?: string;
  };
  /** Aggregater for hele rapporten (alle haller, alle kanaler). */
  totals: BaseAggregates;
  /** Channel-split (for hovedspill: hall vs internet; for databingo: kun internet). */
  channelBreakdown: ChannelBucket;
  /** Per-hall rader. */
  rows: PerHallRow[];
  /** Spilltype-spesifikke felter (per slug). */
  gameSpecific: GameSpecificFields;
}

// ── Inputs ─────────────────────────────────────────────────────────────────

export interface GameSpecificReportInput {
  slug: GameSpecificSlug;
  /** Compliance-ledger-entries (allerede hall-scope-filtrert i ruten). */
  entries: ComplianceLedgerEntry[];
  /** Hall-definisjoner for navn-lookup. */
  halls: HallDefinition[];
  /** Inclusive ISO window. */
  from: string;
  to: string;
  /** Optional hall-filter. */
  hallId?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function emptyAggregates(): BaseAggregates {
  return {
    rounds: 0,
    distinctPlayers: 0,
    totalStakes: 0,
    totalPrizes: 0,
    net: 0,
    payoutPct: 0,
  };
}

function finaliseAggregates(
  raw: { stakes: number; prizes: number; gameIds: Set<string>; players: Set<string> },
): BaseAggregates {
  const totalStakes = roundCurrency(raw.stakes);
  const totalPrizes = roundCurrency(raw.prizes);
  const net = roundCurrency(totalStakes - totalPrizes);
  const payoutPct = totalStakes > 0 ? roundCurrency((totalPrizes * 100) / totalStakes) : 0;
  return {
    rounds: raw.gameIds.size,
    distinctPlayers: raw.players.size,
    totalStakes,
    totalPrizes,
    net,
    payoutPct,
  };
}

function assertIsoWindow(from: string, to: string): { fromMs: number; toMs: number } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs)) {
    throw new Error(`[gap-28-game-report] Ugyldig 'from': ${from}`);
  }
  if (!Number.isFinite(toMs)) {
    throw new Error(`[gap-28-game-report] Ugyldig 'to': ${to}`);
  }
  if (fromMs > toMs) {
    throw new Error(`[gap-28-game-report] 'from' må være <= 'to' (${from} > ${to}).`);
  }
  return { fromMs, toMs };
}

/**
 * Heuristikk: trekk slug fra ledger-entry-metadata.
 *
 * Prioritet:
 *   1. `metadata.gameSlug` (eksplisitt — skrevet av engine + Game1*Service-er
 *      etter GAP #28-fix i denne PRen).
 *   2. `metadata.reason` med `GAME1_*`-prefix → bingo.
 *   3. Fallback: undefined (entry teller ikke for noen slug).
 */
function extractSlugFromEntry(entry: ComplianceLedgerEntry): string | undefined {
  const meta = entry.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const slug = (meta as Record<string, unknown>).gameSlug;
  if (typeof slug === "string" && slug.length > 0) return slug;
  const reason = (meta as Record<string, unknown>).reason;
  if (typeof reason === "string") {
    if (reason.startsWith("GAME1_")) return "bingo";
  }
  return undefined;
}

function readMetaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!meta) return undefined;
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readMetaBoolean(meta: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!meta) return undefined;
  const v = meta[key];
  return typeof v === "boolean" ? v : undefined;
}

// ── Per-slug specifics-builders ────────────────────────────────────────────

function buildBingoSpecifics(matched: ComplianceLedgerEntry[]): BingoSpecificFields {
  const subGameKindBreakdown: Record<string, number> = {};
  let luckyNumberCount = 0;
  let luckyNumberTotal = 0;
  let jackpotCount = 0;
  let jackpotTotal = 0;
  let miniGameCount = 0;
  let miniGameTotal = 0;
  for (const entry of matched) {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (entry.eventType === "STAKE") {
      const kind = readMetaString(meta, "subGameKind") ?? readMetaString(meta, "kind") ?? "standard";
      subGameKindBreakdown[kind] = (subGameKindBreakdown[kind] ?? 0) + 1;
    }
    const reason = readMetaString(meta, "reason");
    if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      if (reason === "GAME1_JACKPOT") {
        jackpotCount += 1;
        jackpotTotal += entry.amount;
      } else if (
        readMetaBoolean(meta, "isLuckyNumber") === true ||
        readMetaString(meta, "luckyNumberReason") !== undefined
      ) {
        luckyNumberCount += 1;
        luckyNumberTotal += entry.amount;
      } else if (
        reason === "GAME1_PHASE_PAYOUT" ||
        readMetaString(meta, "miniGame") !== undefined ||
        readMetaString(meta, "phaseName") !== undefined
      ) {
        miniGameCount += 1;
        miniGameTotal += entry.amount;
      }
    }
  }
  return {
    subGameKindBreakdown,
    luckyNumberPayouts: { count: luckyNumberCount, total: roundCurrency(luckyNumberTotal) },
    jackpotPayouts: { count: jackpotCount, total: roundCurrency(jackpotTotal) },
    miniGamePayouts: { count: miniGameCount, total: roundCurrency(miniGameTotal) },
  };
}

function buildRocketSpecifics(matched: ComplianceLedgerEntry[]): RocketSpecificFields {
  let rocketStackingRounds = 0;
  let blindTicketCount = 0;
  let blindTicketTotal = 0;
  let luckyNumberCount = 0;
  let luckyNumberTotal = 0;
  const seenStackingGameIds = new Set<string>();
  for (const entry of matched) {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (
      entry.eventType === "STAKE" &&
      readMetaBoolean(meta, "blindBuy") === true
    ) {
      blindTicketCount += 1;
      blindTicketTotal += entry.amount;
    }
    if (
      entry.gameId &&
      readMetaBoolean(meta, "rocketStacking") === true &&
      !seenStackingGameIds.has(entry.gameId)
    ) {
      seenStackingGameIds.add(entry.gameId);
      rocketStackingRounds += 1;
    }
    if (
      (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") &&
      (readMetaBoolean(meta, "isLuckyNumber") === true ||
        readMetaString(meta, "luckyNumberReason") !== undefined)
    ) {
      luckyNumberCount += 1;
      luckyNumberTotal += entry.amount;
    }
  }
  return {
    rocketStackingRounds,
    blindTicketBuys: { count: blindTicketCount, total: roundCurrency(blindTicketTotal) },
    luckyNumberPayouts: { count: luckyNumberCount, total: roundCurrency(luckyNumberTotal) },
  };
}

function buildMonsterbingoSpecifics(matched: ComplianceLedgerEntry[]): MonsterbingoSpecificFields {
  let patternsEvaluated = 0;
  let ballFifoEvents = 0;
  const patternBreakdown: Record<string, number> = {};
  for (const entry of matched) {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    const pattern = readMetaString(meta, "patternEvaluated") ?? readMetaString(meta, "pattern");
    if (pattern) {
      patternsEvaluated += 1;
      patternBreakdown[pattern] = (patternBreakdown[pattern] ?? 0) + 1;
    }
    if (readMetaBoolean(meta, "ballFifoEvent") === true) {
      ballFifoEvents += 1;
    }
  }
  return { patternsEvaluated, ballFifoEvents, patternBreakdown };
}

function buildSpilloramaSpecifics(matched: ComplianceLedgerEntry[]): SpilloramaSpecificFields {
  let rouletteCount = 0;
  let rouletteTotal = 0;
  let freeSpinJackpotCount = 0;
  let freeSpinJackpotTotal = 0;
  let swapTicketUses = 0;
  for (const entry of matched) {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (
      (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") &&
      readMetaBoolean(meta, "rouletteOutcome") === true
    ) {
      rouletteCount += 1;
      rouletteTotal += entry.amount;
    }
    if (
      (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") &&
      readMetaBoolean(meta, "freeSpinJackpot") === true
    ) {
      freeSpinJackpotCount += 1;
      freeSpinJackpotTotal += entry.amount;
    }
    if (entry.eventType === "STAKE" && readMetaBoolean(meta, "swapTicket") === true) {
      swapTicketUses += 1;
    }
  }
  return {
    rouletteOutcomes: { count: rouletteCount, total: roundCurrency(rouletteTotal) },
    freeSpinJackpotPayouts: { count: freeSpinJackpotCount, total: roundCurrency(freeSpinJackpotTotal) },
    swapTicketUses,
  };
}

// ── Top-level builder ──────────────────────────────────────────────────────

/**
 * Bygg per-slug rapport.
 *
 * Tom hall / ingen sessions ⇒ `totals`, `channelBreakdown` og `rows` returnerer
 * 0/empty (ingen kasting). Wireframe forventer at inaktive haller ikke
 * krasjer rapporten.
 */
export function buildGameSpecificReport(
  input: GameSpecificReportInput,
): GameSpecificReportResult {
  const { fromMs, toMs } = assertIsoWindow(input.from, input.to);
  const slug = input.slug;
  const hallFilter = input.hallId?.trim() || undefined;

  const hallsById = new Map<string, HallDefinition>();
  for (const h of input.halls) hallsById.set(h.id, h);

  // Filter entries → matched by slug + window + hall.
  const matched: ComplianceLedgerEntry[] = [];
  for (const entry of input.entries) {
    if (entry.createdAtMs < fromMs || entry.createdAtMs > toMs) continue;
    if (hallFilter && entry.hallId !== hallFilter) continue;
    if (extractSlugFromEntry(entry) !== slug) continue;
    matched.push(entry);
  }

  // Aggregate buckets.
  interface RawBucket {
    stakes: number;
    prizes: number;
    gameIds: Set<string>;
    players: Set<string>;
  }
  function emptyRaw(): RawBucket {
    return { stakes: 0, prizes: 0, gameIds: new Set(), players: new Set() };
  }
  const totalsRaw = emptyRaw();
  const hallChannelRaw = emptyRaw();
  const internetChannelRaw = emptyRaw();
  const perHallRaw = new Map<string, RawBucket>();

  function add(raw: RawBucket, entry: ComplianceLedgerEntry): void {
    if (entry.gameId) raw.gameIds.add(entry.gameId);
    if (entry.eventType === "STAKE") {
      raw.stakes += entry.amount;
      if (entry.playerId) raw.players.add(entry.playerId);
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      raw.prizes += entry.amount;
    }
  }

  for (const entry of matched) {
    add(totalsRaw, entry);
    if (entry.channel === "HALL") add(hallChannelRaw, entry);
    else if (entry.channel === "INTERNET") add(internetChannelRaw, entry);
    let perHall = perHallRaw.get(entry.hallId);
    if (!perHall) {
      perHall = emptyRaw();
      perHallRaw.set(entry.hallId, perHall);
    }
    add(perHall, entry);
  }

  const rows: PerHallRow[] = [...perHallRaw.entries()]
    .map(([hallId, raw]) => {
      const agg = finaliseAggregates(raw);
      const hall = hallsById.get(hallId);
      return {
        hallId,
        hallName: hall?.name ?? hallId,
        ...agg,
      };
    })
    .sort((a, b) => a.hallName.localeCompare(b.hallName));

  // Per-slug game-specific.
  let gameSpecific: GameSpecificFields;
  if (slug === "bingo") {
    gameSpecific = { slug, specifics: buildBingoSpecifics(matched) };
  } else if (slug === "rocket") {
    gameSpecific = { slug, specifics: buildRocketSpecifics(matched) };
  } else if (slug === "monsterbingo") {
    gameSpecific = { slug, specifics: buildMonsterbingoSpecifics(matched) };
  } else {
    gameSpecific = { slug: "spillorama", specifics: buildSpilloramaSpecifics(matched) };
  }

  const category: "Hovedspill" | "Databingo" =
    slug === "spillorama" ? "Databingo" : "Hovedspill";

  return {
    from: input.from,
    to: input.to,
    generatedAt: new Date().toISOString(),
    slug,
    category,
    filters: {
      ...(hallFilter ? { hallId: hallFilter } : {}),
    },
    totals: finaliseAggregates(totalsRaw),
    channelBreakdown: {
      hallChannel: finaliseAggregates(hallChannelRaw),
      internetChannel: finaliseAggregates(internetChannelRaw),
    },
    rows,
    gameSpecific,
  };
}

// ── CSV-export ─────────────────────────────────────────────────────────────

/**
 * CSV-eksport av per-slug-rapport. Felles header + summary-row,
 * og en egen seksjon med spilltype-spesifikke metrikker.
 *
 * Format:
 *   Section 1: per-hall rader (én linje per hall med standard KPI-er)
 *   Summary row: ALL halls (totals)
 *   Section 2: channel-breakdown (HALL + INTERNET)
 *   Section 3: game-specific metrikker (per slug)
 */
export function exportGameSpecificReportCsv(report: GameSpecificReportResult): string {
  const lines: string[] = [];
  // ── Section 1: per-hall ──
  lines.push(
    [
      "section",
      "hall_id",
      "hall_name",
      "rounds",
      "distinct_players",
      "total_stakes",
      "total_prizes",
      "net",
      "payout_pct",
    ].join(","),
  );
  for (const row of report.rows) {
    lines.push(
      [
        "per_hall",
        row.hallId,
        csvEscape(row.hallName),
        row.rounds,
        row.distinctPlayers,
        row.totalStakes,
        row.totalPrizes,
        row.net,
        row.payoutPct,
      ].join(","),
    );
  }
  // Summary
  lines.push(
    [
      "totals",
      "ALL",
      "ALL",
      report.totals.rounds,
      report.totals.distinctPlayers,
      report.totals.totalStakes,
      report.totals.totalPrizes,
      report.totals.net,
      report.totals.payoutPct,
    ].join(","),
  );
  // ── Section 2: channel ──
  lines.push("");
  lines.push(
    ["section", "channel", "rounds", "distinct_players", "total_stakes", "total_prizes", "net", "payout_pct"].join(","),
  );
  for (const [name, agg] of [
    ["HALL", report.channelBreakdown.hallChannel],
    ["INTERNET", report.channelBreakdown.internetChannel],
  ] as const) {
    lines.push(
      [
        "channel",
        name,
        agg.rounds,
        agg.distinctPlayers,
        agg.totalStakes,
        agg.totalPrizes,
        agg.net,
        agg.payoutPct,
      ].join(","),
    );
  }
  // ── Section 3: game-specific ──
  lines.push("");
  lines.push(["section", "metric", "value"].join(","));
  appendGameSpecificCsv(lines, report.gameSpecific);
  return lines.join("\n");
}

function appendGameSpecificCsv(lines: string[], spec: GameSpecificFields): void {
  if (spec.slug === "bingo") {
    const s = spec.specifics;
    for (const [kind, count] of Object.entries(s.subGameKindBreakdown)) {
      lines.push(["game_specific", `subgame_kind_${kind}`, count].join(","));
    }
    lines.push(["game_specific", "lucky_number_count", s.luckyNumberPayouts.count].join(","));
    lines.push(["game_specific", "lucky_number_total", s.luckyNumberPayouts.total].join(","));
    lines.push(["game_specific", "jackpot_count", s.jackpotPayouts.count].join(","));
    lines.push(["game_specific", "jackpot_total", s.jackpotPayouts.total].join(","));
    lines.push(["game_specific", "minigame_count", s.miniGamePayouts.count].join(","));
    lines.push(["game_specific", "minigame_total", s.miniGamePayouts.total].join(","));
  } else if (spec.slug === "rocket") {
    const s = spec.specifics;
    lines.push(["game_specific", "rocket_stacking_rounds", s.rocketStackingRounds].join(","));
    lines.push(["game_specific", "blind_ticket_count", s.blindTicketBuys.count].join(","));
    lines.push(["game_specific", "blind_ticket_total", s.blindTicketBuys.total].join(","));
    lines.push(["game_specific", "lucky_number_count", s.luckyNumberPayouts.count].join(","));
    lines.push(["game_specific", "lucky_number_total", s.luckyNumberPayouts.total].join(","));
  } else if (spec.slug === "monsterbingo") {
    const s = spec.specifics;
    lines.push(["game_specific", "patterns_evaluated", s.patternsEvaluated].join(","));
    lines.push(["game_specific", "ball_fifo_events", s.ballFifoEvents].join(","));
    for (const [pattern, count] of Object.entries(s.patternBreakdown)) {
      lines.push(["game_specific", `pattern_${pattern}`, count].join(","));
    }
  } else {
    const s = spec.specifics;
    lines.push(["game_specific", "roulette_count", s.rouletteOutcomes.count].join(","));
    lines.push(["game_specific", "roulette_total", s.rouletteOutcomes.total].join(","));
    lines.push(["game_specific", "free_spin_jackpot_count", s.freeSpinJackpotPayouts.count].join(","));
    lines.push(["game_specific", "free_spin_jackpot_total", s.freeSpinJackpotPayouts.total].join(","));
    lines.push(["game_specific", "swap_ticket_uses", s.swapTicketUses].join(","));
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
