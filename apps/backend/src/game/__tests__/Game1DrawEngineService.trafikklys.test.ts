/**
 * End-to-end engine-test for Trafikklys-runtime (Spill 1 spesialvariant).
 *
 * **STATUS PER 2026-05-08:** Trafikklys-runtime er IKKE implementert i
 * `Game1DrawEngineService` eller `Game1DrawEngineHelpers`. Denne test-
 * suiten dokumenterer derfor BÅDE:
 *
 *   - Kategori A — eksisterende oppførsel som faktisk er pilot-klar
 *     (katalog-data + bridge-output). Disse passerer.
 *   - Kategori B — kontrakt-tester for runtime-pathen som skal
 *     implementeres. Disse er markert med `test.todo` slik at de blir
 *     synlige i CI uten å feile annen utvikling.
 *
 * Når Trafikklys-runtime implementeres: fjern `todo`-markeringen og
 * tester skal passe uten å endre asserts. Hvis de feiler, ER det runtime-
 * pathen som er feil-implementert — ikke testen.
 *
 * Komplett gap-analyse:
 *   `docs/architecture/TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md`
 *
 * Kanonisk regel-kilde:
 *   `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §5 + §9.4
 *
 * Trafikklys-mekanikk (sammendrag):
 *   - Bongpris: flat 15 kr alle bonger
 *   - Premier styres av RAD-FARGE (rød/grønn/gul) — IKKE bongfarge
 *   - Master eller systemet trekker rad-farge ved spill-start
 *   - Premie-tabell:
 *     | Rad-farge | Rad-premie | Fullt Hus |
 *     |-----------|------------|-----------|
 *     | Rød       | 50 kr      | 500 kr    |
 *     | Grønn     | 100 kr     | 1000 kr   |
 *     | Gul       | 150 kr     | 1500 kr   |
 *   - Multi-vinner: alle vinnere på samme rad får samme prize delt likt
 *     (ikke vektet — alle bonger har samme pris)
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTicketConfigFromCatalog,
} from "../GamePlanEngineBridge.js";
import {
  buildVariantConfigFromGameConfigJson,
  pickTrafikklysRowColor,
  resolveOddsenVariantConfig,
  resolveTrafikklysVariantConfig,
} from "../Game1DrawEngineHelpers.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";
import { Game1DrawEngineService } from "../Game1DrawEngineService.js";
import { Game1JackpotService } from "../Game1JackpotService.js";
import { Game1PayoutService } from "../Game1PayoutService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  WalletAdapter,
  WalletTransaction,
} from "../../adapters/WalletAdapter.js";
import type { Game1TicketPurchaseService } from "../Game1TicketPurchaseService.js";
import type { ComplianceLedgerPort } from "../../adapters/ComplianceLedgerPort.js";

// ── Trafikklys-katalog-fixture (matcher SPILL_REGLER §5.3) ─────────────────

/**
 * Kanonisk Trafikklys-katalog-rad. Per docs §5.3:
 *   - rules.gameVariant: "trafikklys"
 *   - rules.ticketPriceCents: 1500 (flat 15 kr)
 *   - rules.rowColors: ["grønn", "gul", "rød"]
 *   - rules.prizesPerRowColor: { grønn: 10000, gul: 15000, rød: 5000 } (øre)
 *   - rules.bingoPerRowColor: { grønn: 100000, gul: 150000, rød: 50000 } (øre)
 */
function makeTrafikklysCatalog(): GameCatalogEntry {
  return {
    id: "gc-trafikklys",
    slug: "trafikklys",
    displayName: "Trafikklys",
    description: null,
    rules: {
      gameVariant: "trafikklys",
      ticketPriceCents: 1500,
      rowColors: ["grønn", "gul", "rød"],
      prizesPerRowColor: {
        grønn: 10000,
        gul: 15000,
        rød: 5000,
      },
      bingoPerRowColor: {
        grønn: 100000,
        gul: 150000,
        rød: 50000,
      },
    },
    ticketColors: ["gul", "hvit", "lilla"],
    // Trafikklys: alle 15 kr (flat — ingen skalering)
    ticketPricesCents: { hvit: 1500, gul: 1500, lilla: 1500 },
    prizesCents: {
      // Placeholder-verdier — engine skal IKKE bruke disse for Trafikklys-
      // runtime, men shape krever felter for explicit_per_color-modus.
      // Bridge skriver disse uendret; engine forventes å overstyre i
      // run-time basert på trukket rad-farge.
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 100000, hvit: 100000, lilla: 100000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-08T00:00:00Z",
    updatedAt: "2026-05-08T00:00:00Z",
    createdByUserId: "u-test",
  };
}

// ───────────────────────────────────────────────────────────────────────────
// KATEGORI A — Eksisterende oppførsel (PASSER i dag)
// ───────────────────────────────────────────────────────────────────────────

// ── A1: Katalog-shape ──────────────────────────────────────────────────────

test("[A1] katalog: prizeMultiplierMode === 'explicit_per_color'", () => {
  const catalog = makeTrafikklysCatalog();
  assert.equal(catalog.prizeMultiplierMode, "explicit_per_color");
});

test("[A1] katalog: rules.gameVariant === 'trafikklys'", () => {
  const catalog = makeTrafikklysCatalog();
  assert.equal(
    (catalog.rules as Record<string, unknown>).gameVariant,
    "trafikklys",
  );
});

test("[A1] katalog: ticketPriceCents flat 1500 (alle 15 kr)", () => {
  const catalog = makeTrafikklysCatalog();
  assert.equal(
    (catalog.rules as Record<string, unknown>).ticketPriceCents,
    1500,
  );
  assert.equal(catalog.ticketPricesCents.hvit, 1500);
  assert.equal(catalog.ticketPricesCents.gul, 1500);
  assert.equal(catalog.ticketPricesCents.lilla, 1500);
});

test("[A1] katalog: rules.rowColors whitelist (grønn/gul/rød)", () => {
  const catalog = makeTrafikklysCatalog();
  const rowColors = (catalog.rules as Record<string, unknown>).rowColors as
    | string[]
    | undefined;
  assert.ok(rowColors);
  assert.deepEqual([...rowColors].sort(), ["grønn", "gul", "rød"]);
});

test("[A1] katalog: rules.prizesPerRowColor matcher §5.2 (rød 50/grønn 100/gul 150)", () => {
  const catalog = makeTrafikklysCatalog();
  const prizes = (catalog.rules as Record<string, unknown>)
    .prizesPerRowColor as Record<string, number>;
  assert.equal(prizes["rød"], 5000); // 50 kr
  assert.equal(prizes["grønn"], 10000); // 100 kr
  assert.equal(prizes["gul"], 15000); // 150 kr
});

test("[A1] katalog: rules.bingoPerRowColor matcher §5.2 (rød 500/grønn 1000/gul 1500)", () => {
  const catalog = makeTrafikklysCatalog();
  const bingo = (catalog.rules as Record<string, unknown>)
    .bingoPerRowColor as Record<string, number>;
  assert.equal(bingo["rød"], 50000); // 500 kr
  assert.equal(bingo["grønn"], 100000); // 1000 kr
  assert.equal(bingo["gul"], 150000); // 1500 kr
});

// ── A2: Bridge-output ──────────────────────────────────────────────────────

test("[A2] bridge: spill1.ticketColors[] genereres for Trafikklys", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors?: Array<Record<string, unknown>> };
  assert.ok(spill1, "spill1-blokk må eksistere");
  assert.ok(Array.isArray(spill1.ticketColors));
  // 3 farger × 2 størrelser = 6 entries
  assert.equal(spill1.ticketColors!.length, 6);
});

test("[A2] bridge: rules-objektet videreformidles uendret til config-output", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const rules = cfg.rules as Record<string, unknown>;
  assert.equal(rules.gameVariant, "trafikklys");
  assert.deepEqual(rules.rowColors, ["grønn", "gul", "rød"]);
  // Engine MÅ kunne lese disse for å implementere runtime.
  assert.ok(rules.prizesPerRowColor, "rules.prizesPerRowColor må være med");
  assert.ok(rules.bingoPerRowColor, "rules.bingoPerRowColor må være med");
});

test("[A2] bridge: alle 6 (color, size) får samme rad-pot fordi flat 15 kr-bong", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { ticketColors: Array<Record<string, unknown>> };
  for (const tc of spill1.ticketColors) {
    const ppp = tc.prizePerPattern as Record<
      string,
      { mode: string; amount: number }
    >;
    // Placeholder rad1 = 10000 øre = 100 kr (skal IKKE skaleres for explicit_per_color)
    assert.equal(
      ppp.row_1.amount,
      100,
      `${tc.color} rad1 skal være 100 kr (flat — engine skal overstyre med rad-farge)`,
    );
  }
});

test("[A2] bridge: ingen oddsen-blokk skrives for Trafikklys", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { oddsen?: unknown };
  assert.equal(
    spill1.oddsen,
    undefined,
    "spill1.oddsen skal IKKE være satt for Trafikklys (gameVariant !== oddsen)",
  );
});

// ── A3: Variant-config-resolution ──────────────────────────────────────────

test("[A3] variant-config: buildVariantConfigFromGameConfigJson aksepterer Trafikklys-shape", () => {
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const variantCfg = buildVariantConfigFromGameConfigJson(cfg);
  assert.ok(variantCfg, "variant-config skal kunne bygges fra Trafikklys-config");
});

test("[A3] variant-config: resolveOddsenVariantConfig returnerer null for Trafikklys", () => {
  // Defensiv test: Trafikklys må IKKE plukkes opp som Oddsen-spill.
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const oddsenCfg = resolveOddsenVariantConfig(cfg);
  assert.equal(
    oddsenCfg,
    null,
    "Trafikklys skal IKKE matche Oddsen-resolveren",
  );
});

// ── A4: §9.4 multi-vinner-deling (matematisk regel — uavhengig av runtime) ──

/**
 * Per §9.4: Trafikklys multi-vinner-pot deles LIKT (ikke vektet) fordi alle
 * bonger har samme pris (15 kr). Dette er en ren floor-split-test som er
 * uavhengig av om runtime er implementert eller ikke — den verifiserer den
 * kanoniske regelen.
 */
function splitPot(potCents: number, winnerCount: number): {
  perWinnerCents: number;
  houseRetainedCents: number;
} {
  if (winnerCount <= 0) return { perWinnerCents: 0, houseRetainedCents: 0 };
  const perWinner = Math.floor(potCents / winnerCount);
  const total = perWinner * winnerCount;
  return {
    perWinnerCents: perWinner,
    houseRetainedCents: potCents - total,
  };
}

test("[A4] §9.4: solo-vinner Rad rød (50 kr-pot) → 50 kr", () => {
  const split = splitPot(5000, 1);
  assert.equal(split.perWinnerCents, 5000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: solo-vinner Rad grønn (100 kr-pot) → 100 kr", () => {
  const split = splitPot(10000, 1);
  assert.equal(split.perWinnerCents, 10000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: solo-vinner Rad gul (150 kr-pot) → 150 kr", () => {
  const split = splitPot(15000, 1);
  assert.equal(split.perWinnerCents, 15000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: 2 vinnere på Rad 1 grønn (100 kr-pot) → 50 kr hver", () => {
  const split = splitPot(10000, 2);
  assert.equal(split.perWinnerCents, 5000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: 3 vinnere på Rad 1 gul (150 kr-pot) → 50 kr hver", () => {
  const split = splitPot(15000, 3);
  assert.equal(split.perWinnerCents, 5000);
  assert.equal(split.houseRetainedCents, 0);
});

test("[A4] §9.4: 3 vinnere på Rad 1 rød (50 kr-pot) → 16 kr hver, rest 2 til hus", () => {
  // 5000 / 3 = 1666 (floor), rest = 5000 - 1666*3 = 2
  const split = splitPot(5000, 3);
  assert.equal(split.perWinnerCents, 1666);
  assert.equal(split.houseRetainedCents, 2);
});

test("[A4] §9.4: solo Fullt Hus rød (500 kr-pot) → 500 kr", () => {
  const split = splitPot(50000, 1);
  assert.equal(split.perWinnerCents, 50000);
});

test("[A4] §9.4: solo Fullt Hus gul (1500 kr-pot) → 1500 kr", () => {
  const split = splitPot(150000, 1);
  assert.equal(split.perWinnerCents, 150000);
});

test("[A4] §9.4: 2 vinnere Fullt Hus grønn (1000 kr-pot) → 500 kr hver", () => {
  const split = splitPot(100000, 2);
  assert.equal(split.perWinnerCents, 50000);
  assert.equal(split.houseRetainedCents, 0);
});

// ───────────────────────────────────────────────────────────────────────────
// KATEGORI B — Runtime-tester (Trafikklys-engine)
//
// Disse driver `Game1DrawEngineService.drawNext` mot stub-pool, samme mønster
// som `Game1DrawEngineService.potPerBongSize.test.ts`. Stub-en simulerer
// scheduled_game-raden med `trafikklys_row_color` satt OG `game_config_json`
// med kanonisk `spill1.trafikklys`-blokk slik bridge skriver i prod.
//
// Engine-pathen forventes da å:
//   - Detektere Trafikklys-config via resolveTrafikklysVariantConfig
//   - Sjekke rad-farge mot rules.rowColors
//   - Bruke prizesPerRowColor[rowColor] for Rad 1-4 (uniform pot, ikke vektet)
//   - Bruke bingoPerRowColor[rowColor] for Fullt Hus
//   - Skrive gameVariant + trafikklysRowColor til ComplianceLedgerPort-metadata
// ───────────────────────────────────────────────────────────────────────────

// ── Stub-pool + wallet-helpers (parallel med potPerBongSize-test) ──────────

interface StubResponse {
  match: (sql: string, params: unknown[]) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
  throwErr?: { code: string; message: string };
}

function createStubPool(responses: StubResponse[]) {
  const queue = responses.slice();
  const runQuery = async (sql: string, params: unknown[] = []) => {
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql, params)) {
        if (r.throwErr) {
          const err = Object.assign(new Error(r.throwErr.message), {
            code: r.throwErr.code,
          });
          if (r.once !== false) queue.splice(i, 1);
          throw err;
        }
        const rows = typeof r.rows === "function" ? r.rows() : r.rows;
        if (r.once !== false) queue.splice(i, 1);
        return { rows, rowCount: r.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    pool: {
      connect: async () => ({ query: runQuery, release: () => undefined }),
      query: runQuery,
    },
  };
}

interface RecordedCredit {
  accountId: string;
  amount: number;
  reason: string;
  idempotencyKey?: string;
  to?: string;
}

function makeFakeWallet(): {
  adapter: WalletAdapter;
  credits: RecordedCredit[];
} {
  const credits: RecordedCredit[] = [];
  let txCounter = 0;
  const adapter: WalletAdapter = {
    async createAccount() {
      throw new Error("ni");
    },
    async ensureAccount() {
      throw new Error("ni");
    },
    async getAccount() {
      throw new Error("ni");
    },
    async listAccounts() {
      return [];
    },
    async getBalance() {
      return 0;
    },
    async getDepositBalance() {
      return 0;
    },
    async getWinningsBalance() {
      return 0;
    },
    async getBothBalances() {
      return { deposit: 0, winnings: 0, total: 0 };
    },
    async debit() {
      throw new Error("ni");
    },
    async credit(accountId, amount, reason, options) {
      credits.push({
        accountId,
        amount,
        reason,
        idempotencyKey: options?.idempotencyKey,
        to: options?.to,
      });
      const tx: WalletTransaction = {
        id: `wtx-${++txCounter}`,
        accountId,
        type: "CREDIT",
        amount,
        reason,
        createdAt: new Date().toISOString(),
      };
      return tx;
    },
    async topUp() {
      throw new Error("ni");
    },
    async withdraw() {
      throw new Error("ni");
    },
    async transfer() {
      throw new Error("ni");
    },
    async listTransactions() {
      return [];
    },
  };
  return { adapter, credits };
}

interface RecordedLedgerEvent {
  hallId: string;
  eventType: string;
  amount: number;
  metadata?: Record<string, unknown>;
}

function makeRecordingLedger(): {
  port: ComplianceLedgerPort;
  events: RecordedLedgerEvent[];
} {
  const events: RecordedLedgerEvent[] = [];
  const port: ComplianceLedgerPort = {
    async recordComplianceLedgerEvent(input) {
      events.push({
        hallId: input.hallId,
        eventType: input.eventType,
        amount: input.amount,
        metadata: input.metadata as Record<string, unknown> | undefined,
      });
    },
  };
  return { port, events };
}

function makeFakeTicketPurchase(): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return [];
    },
  } as unknown as Game1TicketPurchaseService;
}

// Helpers for å bygge Trafikklys-config og winning grid/markings.

/**
 * Kanonisk `game_config_json` for Trafikklys (matcher det
 * `GamePlanEngineBridge.buildTicketConfigFromCatalog` skriver i prod).
 *
 * spill1.ticketColors[] inneholder placeholder-pattern fra bridge — engine
 * skal IKKE bruke disse for Trafikklys, men `patternsByColor`-shape er
 * nødvendig for at engine velger pot-per-bongstørrelse-pathen (som er den
 * eneste pathen som har Trafikklys-overstyringen).
 */
function makeTrafikklysGameConfig(): unknown {
  return {
    spill1: {
      ticketColors: [
        // Alle 6 (color, size)-kombinasjoner får placeholder-pattern.
        // Engine skal overstyre via spill1.trafikklys-blokken nedenfor.
        {
          color: "small_white",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 100 },
            row_3: { mode: "fixed", amount: 100 },
            row_4: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "large_white",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 100 },
            row_3: { mode: "fixed", amount: 100 },
            row_4: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "small_yellow",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 100 },
            row_3: { mode: "fixed", amount: 100 },
            row_4: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "large_yellow",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 100 },
            row_3: { mode: "fixed", amount: 100 },
            row_4: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "small_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 100 },
            row_3: { mode: "fixed", amount: 100 },
            row_4: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "large_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 100 },
            row_3: { mode: "fixed", amount: 100 },
            row_4: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
      ],
      trafikklys: {
        rowColors: ["grønn", "gul", "rød"],
        prizesPerRowColor: {
          grønn: 10000,
          gul: 15000,
          rød: 5000,
        },
        bingoPerRowColor: {
          grønn: 100000,
          gul: 150000,
          rød: 50000,
        },
      },
    },
    // top-level rules-blokk per bridge-konvensjon
    rules: {
      gameVariant: "trafikklys",
      ticketPriceCents: 1500,
      rowColors: ["grønn", "gul", "rød"],
      prizesPerRowColor: {
        grønn: 10000,
        gul: 15000,
        rød: 5000,
      },
      bingoPerRowColor: {
        grønn: 100000,
        gul: 150000,
        rød: 50000,
      },
    },
  };
}

function winningRow0Grid(): Array<number | null> {
  return [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ];
}

function allRow0Marked(): boolean[] {
  return [
    true, true, true, true, true,
    false, false, false, false, false,
    false, false, true, false, false,
    false, false, false, false, false,
    false, false, false, false, false,
  ];
}

function fullGridAllMarked(): {
  grid: Array<number | null>;
  marked: boolean[];
} {
  return {
    grid: [
      1, 2, 3, 4, 5,
      6, 7, 8, 9, 10,
      11, 12, 0, 13, 14,
      15, 16, 17, 18, 19,
      20, 21, 22, 23, 24,
    ],
    marked: Array(25).fill(true),
  };
}

function runningStateRow(overrides: Record<string, unknown> = {}) {
  return {
    scheduled_game_id: "g1",
    draw_bag_json: [5, 11, 22],
    draws_completed: 0,
    current_phase: 1,
    last_drawn_ball: null,
    last_drawn_at: null,
    next_auto_draw_at: null,
    paused: false,
    engine_started_at: "2026-04-21T12:00:00.000Z",
    engine_ended_at: null,
    ...overrides,
  };
}

interface WinnerDef {
  assignmentId: string;
  userId: string;
  walletId: string;
  hallId: string;
  ticketColor: string;
}

/**
 * Bygg stub-respons-pipeline for én Trafikklys drawNext-call. Setup matcher
 * faktiske queries i `Game1DrawEngineService.drawNext` for fase 1 — alle
 * vinner i Rad 1 på første ball.
 *
 * Stub-en setter `trafikklys_row_color` på scheduled_games-raden så engine
 * leser det og overstyrer pot-tabellen.
 */
function buildTrafikklysRow1StubResponses(args: {
  gameConfigJson: unknown;
  winners: WinnerDef[];
  trafikklysRowColor: "rød" | "grønn" | "gul";
  potCents?: number;
}): StubResponse[] {
  const winners = args.winners;
  const drawSeq = 1;

  const walletIdResponses: StubResponse[] = winners.map((w) => ({
    match: (s) => s.includes("wallet_id") && s.includes("app_users"),
    rows: [{ wallet_id: w.walletId }],
    once: true,
  }));

  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq - 1,
          current_phase: 1,
          last_drawn_ball: null,
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: args.gameConfigJson,
          trafikklys_row_color: args.trafikklysRowColor,
        },
      ],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: allRow0Marked() },
      })),
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("markings_json"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.includes(
          "SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id",
        ) && s.includes("app_game1_ticket_assignments"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: allRow0Marked() },
        buyer_user_id: w.userId,
        hall_id: w.hallId,
        ticket_color: w.ticketColor,
      })),
    },
    ...walletIdResponses,
    {
      match: (s) =>
        s.includes("COALESCE(SUM(total_amount_cents)") &&
        s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: args.potCents ?? 0 }],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq,
          last_drawn_ball: 5,
          current_phase: 2,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: drawSeq,
          ball_value: 5,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

/**
 * Bygg stub for Fullt Hus-fase (current_phase=5, alle markeringer satt).
 * Brukes for Fullt Hus-runtime-tester.
 */
function buildTrafikklysFullHouseStubResponses(args: {
  gameConfigJson: unknown;
  winners: WinnerDef[];
  trafikklysRowColor: "rød" | "grønn" | "gul";
  drawSequenceAtWin?: number;
}): StubResponse[] {
  const winners = args.winners;
  const drawSeq = args.drawSequenceAtWin ?? 1;
  const { grid, marked } = fullGridAllMarked();

  const walletIdResponses: StubResponse[] = winners.map((w) => ({
    match: (s) => s.includes("wallet_id") && s.includes("app_users"),
    rows: [{ wallet_id: w.walletId }],
    once: true,
  }));

  // draw_bag må ha nok baller. Lag bag med drawSeq + 5 baller.
  const drawBag: number[] = [];
  for (let i = 1; i <= drawSeq + 5; i++) drawBag.push(i);

  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq - 1,
          current_phase: 5,
          draw_bag_json: drawBag,
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: args.gameConfigJson,
          trafikklys_row_color: args.trafikklysRowColor,
        },
      ],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: grid,
        markings_json: { marked },
      })),
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("markings_json"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.includes(
          "SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id",
        ) && s.includes("app_game1_ticket_assignments"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: grid,
        markings_json: { marked },
        buyer_user_id: w.userId,
        hall_id: w.hallId,
        ticket_color: w.ticketColor,
      })),
    },
    ...walletIdResponses,
    {
      match: (s) =>
        s.includes("COALESCE(SUM(total_amount_cents)") &&
        s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 0 }],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq,
          last_drawn_ball: drawSeq,
          current_phase: 5,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: drawSeq,
          ball_value: drawSeq,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

function makeServiceForRow1(
  gameConfigJson: unknown,
  winners: WinnerDef[],
  trafikklysRowColor: "rød" | "grønn" | "gul",
  options: { potCents?: number } = {},
): {
  service: Game1DrawEngineService;
  wallet: ReturnType<typeof makeFakeWallet>;
  ledger: ReturnType<typeof makeRecordingLedger>;
} {
  const wallet = makeFakeWallet();
  const ledger = makeRecordingLedger();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet.adapter,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: ledger.port,
  });
  const jackpotService = new Game1JackpotService();
  const { pool } = createStubPool(
    buildTrafikklysRow1StubResponses({
      gameConfigJson,
      winners,
      trafikklysRowColor,
      potCents: options.potCents,
    }),
  );
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });
  return { service, wallet, ledger };
}

function makeServiceForFullHouse(
  gameConfigJson: unknown,
  winners: WinnerDef[],
  trafikklysRowColor: "rød" | "grønn" | "gul",
  options: { drawSequenceAtWin?: number } = {},
): {
  service: Game1DrawEngineService;
  wallet: ReturnType<typeof makeFakeWallet>;
  ledger: ReturnType<typeof makeRecordingLedger>;
} {
  const wallet = makeFakeWallet();
  const ledger = makeRecordingLedger();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet.adapter,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: ledger.port,
  });
  const jackpotService = new Game1JackpotService();
  const { pool } = createStubPool(
    buildTrafikklysFullHouseStubResponses({
      gameConfigJson,
      winners,
      trafikklysRowColor,
      drawSequenceAtWin: options.drawSequenceAtWin,
    }),
  );
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });
  return { service, wallet, ledger };
}

// ── B1: Rad-farge-trekking ─────────────────────────────────────────────────

test("[B1] runtime: pickTrafikklysRowColor trekker en farge fra rules.rowColors", () => {
  const cfg = resolveTrafikklysVariantConfig({
    rules: {
      gameVariant: "trafikklys",
      rowColors: ["grønn", "gul", "rød"],
      prizesPerRowColor: { grønn: 10000, gul: 15000, rød: 5000 },
      bingoPerRowColor: { grønn: 100000, gul: 150000, rød: 50000 },
    },
  });
  assert.ok(cfg, "config skal kunne parses");
  // Sample 30 trekkinger — alle skal være innenfor whitelist.
  for (let i = 0; i < 30; i++) {
    const c = pickTrafikklysRowColor(cfg!);
    assert.ok(
      ["grønn", "gul", "rød"].includes(c),
      `${c} må være en gyldig rad-farge`,
    );
  }
});

test("[B1] runtime: pickTrafikklysRowColor er deterministisk når pickFn injiseres", () => {
  const cfg = resolveTrafikklysVariantConfig({
    rules: {
      gameVariant: "trafikklys",
      rowColors: ["grønn", "gul", "rød"],
      prizesPerRowColor: { grønn: 10000, gul: 15000, rød: 5000 },
      bingoPerRowColor: { grønn: 100000, gul: 150000, rød: 50000 },
    },
  });
  assert.ok(cfg);
  // Stub pickFn: returner alltid index 0 → grønn (første i listen).
  const c1 = pickTrafikklysRowColor(cfg!, () => 0);
  const c2 = pickTrafikklysRowColor(cfg!, () => 0);
  assert.equal(c1, "grønn");
  assert.equal(c2, "grønn");
  // Stub pickFn: returner index 1 → gul.
  assert.equal(pickTrafikklysRowColor(cfg!, () => 1), "gul");
  // Stub pickFn: returner index 2 → rød.
  assert.equal(pickTrafikklysRowColor(cfg!, () => 2), "rød");
});

// ── B2: Rad-farge eksponert i game-state ──────────────────────────────────

test("[B2] runtime: getState eksponerer trafikklysRowColor fra DB-kolonne", async () => {
  // Vi simulerer kun getState — buildStateView blir testet end-to-end via
  // andre tester. Her sjekker vi at state-view-en inneholder rad-fargen
  // når DB-raden har den satt.
  const { pool } = createStubPool([
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          current_phase: 2,
          last_drawn_ball: 5,
        }),
      ],
    },
    {
      match: (s) =>
        s.includes("status") &&
        s.includes("trafikklys_row_color") &&
        s.includes("scheduled_games"),
      rows: [{ status: "running", trafikklys_row_color: "grønn" }],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 5,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
    },
  ]);
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const view = await service.getState("g1");
  assert.ok(view);
  assert.equal(view!.trafikklysRowColor, "grønn");
});

test("[B2] runtime: getState returnerer null trafikklysRowColor for ikke-Trafikklys-spill", async () => {
  const { pool } = createStubPool([
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          current_phase: 2,
        }),
      ],
    },
    {
      match: (s) =>
        s.includes("status") &&
        s.includes("trafikklys_row_color") &&
        s.includes("scheduled_games"),
      rows: [{ status: "running", trafikklys_row_color: null }],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [],
    },
  ]);
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const view = await service.getState("g1");
  assert.ok(view);
  assert.equal(view!.trafikklysRowColor, null);
});

// ── B3: Rad-pot uavhengig av bongfarge ─────────────────────────────────────

test("[B3] runtime: Rad 1 vinner med rad-farge=rød → 50 kr (uavhengig av bongfarge)", async () => {
  const { service, wallet } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white", // hvit-bong, men pot styres av rad-farge
      },
    ],
    "rød",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1, "én credit for solo-vinner");
  // 50 kr-pot solo → 50 kr (= 5000 øre / 100 = 50 kr i wallet-API).
  assert.equal(
    wallet.credits[0]!.amount,
    50,
    "rød Rad 1 = 50 kr (prizesPerRowColor.rød = 5000 øre)",
  );
});

test("[B3] runtime: Rad 1 vinner med rad-farge=grønn → 100 kr", async () => {
  const { service, wallet } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
    ],
    "grønn",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 100, "grønn Rad 1 = 100 kr");
});

test("[B3] runtime: Rad 1 vinner med rad-farge=gul → 150 kr", async () => {
  const { service, wallet } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    "gul",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 150, "gul Rad 1 = 150 kr");
});

test("[B3] runtime: hvit-bong får IKKE vektet pot for Trafikklys", async () => {
  // hvit-bong (small_white) ville fått pot × 1 i standard pot-per-bongstørrelse
  // (multiplier = 1). For Trafikklys er pot uniform — alle bongfarger får
  // samme rad-farge-pot. Vi verifiserer dette ved å sammenligne 1 hvit vs
  // 1 lilla — begge skal få identisk beløp.
  const { service: svcWhite, wallet: wWhite } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
    ],
    "grønn",
  );
  const { service: svcPurple, wallet: wPurple } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-2",
        walletId: "w-2",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    "grønn",
  );
  await svcWhite.drawNext("g1");
  await svcPurple.drawNext("g1");
  assert.equal(wWhite.credits[0]!.amount, 100);
  assert.equal(wPurple.credits[0]!.amount, 100);
  assert.equal(
    wWhite.credits[0]!.amount,
    wPurple.credits[0]!.amount,
    "Trafikklys: hvit og lilla får samme pot — ingen bongMultiplier-vekting",
  );
});

test("[B3] runtime: lilla-bong får IKKE vektet pot for Trafikklys", async () => {
  // Verifisering at large_purple (som ville fått multiplier 6 i standard
  // path) får samme pot som small_white (multiplier 1) for samme rad-farge.
  const { service: svcSmallWhite, wallet: wSmallWhite } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
    ],
    "rød",
  );
  const { service: svcLargePurple, wallet: wLargePurple } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-2",
        walletId: "w-2",
        hallId: "h-a",
        ticketColor: "large_purple",
      },
    ],
    "rød",
  );
  await svcSmallWhite.drawNext("g1");
  await svcLargePurple.drawNext("g1");
  // Begge skal få 50 kr (rød Rad 1 = 5000 øre = 50 kr).
  assert.equal(wSmallWhite.credits[0]!.amount, 50);
  assert.equal(wLargePurple.credits[0]!.amount, 50);
});

// ── B4: Fullt Hus-pot bruker bingoPerRowColor ──────────────────────────────

test("[B4] runtime: Fullt Hus med rad-farge=rød → 500 kr", async () => {
  const { service, wallet } = makeServiceForFullHouse(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
    ],
    "rød",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(
    wallet.credits[0]!.amount,
    500,
    "Fullt Hus rød = 500 kr (bingoPerRowColor.rød = 50000 øre)",
  );
});

test("[B4] runtime: Fullt Hus med rad-farge=grønn → 1000 kr", async () => {
  const { service, wallet } = makeServiceForFullHouse(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
    ],
    "grønn",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 1000, "Fullt Hus grønn = 1000 kr");
});

test("[B4] runtime: Fullt Hus med rad-farge=gul → 1500 kr", async () => {
  const { service, wallet } = makeServiceForFullHouse(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    "gul",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 1500, "Fullt Hus gul = 1500 kr");
});

// ── B5: Multi-vinner-aritmetikk ────────────────────────────────────────────

test("[B5] runtime: 2 vinnere på Rad 1 grønn → hver får 50 kr (100 kr-pot delt likt)", async () => {
  const { service, wallet } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
      {
        assignmentId: "a-2",
        userId: "u-2",
        walletId: "w-2",
        hallId: "h-a",
        ticketColor: "large_purple",
      },
    ],
    "grønn",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  for (const c of wallet.credits) {
    assert.equal(
      c.amount,
      50,
      "100 kr-pot / 2 vinnere = 50 kr hver (uniform — uavhengig av bongfarge)",
    );
  }
});

test("[B5] runtime: 3 vinnere på Fullt Hus rød (500 kr-pot) → hver får 166.66 kr, rest til hus", async () => {
  const { service, wallet } = makeServiceForFullHouse(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
      {
        assignmentId: "a-2",
        userId: "u-2",
        walletId: "w-2",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
      {
        assignmentId: "a-3",
        userId: "u-3",
        walletId: "w-3",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    "rød",
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 3);
  // Engine opererer i øre: 50000 / 3 = floor 16666 = 166.66 kr per vinner.
  // Ledger-floor: 50000 - 16666*3 = 2 øre HOUSE_RETAINED.
  for (const c of wallet.credits) {
    assert.equal(
      c.amount,
      166.66,
      "floor((500 × 100)/3)/100 = 166.66 kr per vinner",
    );
  }
  const total = wallet.credits.reduce((sum, c) => sum + c.amount, 0);
  // 3 × 166.66 = 499.98. Rest 0.02 kr til hus.
  assert.ok(
    Math.abs(total - 499.98) < 0.001,
    `total ≈ 499.98, got ${total}`,
  );
});

// ── B6: Multi-bong-per-spiller ─────────────────────────────────────────────

test("[B6] runtime: spiller med 3 bonger som alle vinner Rad 1 grønn → 3 credits, total 100 kr", async () => {
  // §9.4: alle vinner-bonger får én pot-andel hver. Spilleren får summen
  // av sine andeler. 100 kr-pot / 3 bonger = floor 33.33 kr per bong.
  // Spilleren får 3 × 33.33 = 99.99 kr (rest 0.01 kr til hus).
  const { service, wallet } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-solo",
        walletId: "w-solo",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
      {
        assignmentId: "a-2",
        userId: "u-solo",
        walletId: "w-solo",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
      {
        assignmentId: "a-3",
        userId: "u-solo",
        walletId: "w-solo",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
    ],
    "grønn",
  );
  await service.drawNext("g1");
  // 3 credits, alle til samme wallet.
  assert.equal(wallet.credits.length, 3);
  for (const c of wallet.credits) {
    assert.equal(c.accountId, "w-solo");
    assert.equal(
      c.amount,
      33.33,
      "100 kr / 3 = 33.33 kr per bong (engine i øre, floor)",
    );
  }
  const total = wallet.credits.reduce((sum, c) => sum + c.amount, 0);
  // 3 × 33.33 = 99.99. Rest 0.01 til hus.
  assert.ok(
    Math.abs(total - 99.99) < 0.001,
    `total ≈ 99.99, got ${total}`,
  );
});

// ── B7: Compliance-ledger metadata ─────────────────────────────────────────

test("[B7] runtime: payoutTrafikklys skriver gameVariant: 'trafikklys' i potMetadata", async () => {
  const { service, ledger } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
    ],
    "grønn",
  );
  await service.drawNext("g1");
  // Finn PRIZE-eventet for spilleren.
  const prizeEvent = ledger.events.find((e) => e.eventType === "PRIZE");
  assert.ok(prizeEvent, "PRIZE-event må eksistere i ledger");
  assert.equal(
    prizeEvent!.metadata?.gameVariant,
    "trafikklys",
    "metadata.gameVariant === 'trafikklys'",
  );
});

test("[B7] runtime: payoutTrafikklys skriver trafikklysRowColor i potMetadata", async () => {
  const { service, ledger } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    "gul",
  );
  await service.drawNext("g1");
  const prizeEvent = ledger.events.find((e) => e.eventType === "PRIZE");
  assert.ok(prizeEvent);
  assert.equal(
    prizeEvent!.metadata?.trafikklysRowColor,
    "gul",
    "metadata.trafikklysRowColor matcher trukket rad-farge",
  );
});

test("[B7] runtime: bongMultiplier IKKE skrives for Trafikklys (flat-prising)", async () => {
  const { service, ledger } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "large_purple", // ville hatt multiplier=6 i standard path
      },
    ],
    "grønn",
  );
  await service.drawNext("g1");
  const prizeEvent = ledger.events.find((e) => e.eventType === "PRIZE");
  assert.ok(prizeEvent);
  assert.equal(
    prizeEvent!.metadata?.bongMultiplier,
    undefined,
    "bongMultiplier skal ikke skrives — Trafikklys har flat 15 kr-bong, ingen vekting",
  );
});

// ── B8: Multi-rad-progresjon med stabil rad-farge ──────────────────────────

test("[B8] runtime: rad-farge persisteres ved start og brukes uendret gjennom hele runden", async () => {
  // Verifisering: når DB-raden har trafikklys_row_color satt, leser hver
  // drawNext-call samme verdi via loadScheduledGameForUpdate.
  // Vi gjør 2 separate drawNext-calls med samme stub-config (samme row color)
  // og verifiserer at begge utbetaler samme pot.
  const cfg = makeTrafikklysGameConfig();
  const { service: svc1, wallet: w1 } = makeServiceForRow1(
    cfg,
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
    ],
    "grønn",
  );
  await svc1.drawNext("g1");
  assert.equal(w1.credits[0]!.amount, 100, "Rad 1 grønn = 100 kr");

  // Nytt service med samme config men Fullt Hus-stub. Verifiserer at
  // bingoPerRowColor.grønn = 1000 kr brukes i samme runde.
  const { service: svc5, wallet: w5 } = makeServiceForFullHouse(
    cfg,
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_yellow",
      },
    ],
    "grønn",
  );
  await svc5.drawNext("g1");
  assert.equal(w5.credits[0]!.amount, 1000, "Fullt Hus grønn = 1000 kr");
});

test("[B8] runtime: ny scheduled-game kan ha annen rad-farge", async () => {
  // To separate scheduled-games skal kunne ha forskjellig rad-farge —
  // verifisert ved å bygge to services med forskjellige row colors og
  // sjekke at de utbetaler forskjellige pots.
  const { service: svcGreen, wallet: wGreen } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
    ],
    "grønn",
  );
  const { service: svcRed, wallet: wRed } = makeServiceForRow1(
    makeTrafikklysGameConfig(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
    ],
    "rød",
  );
  await svcGreen.drawNext("g1");
  await svcRed.drawNext("g1");
  assert.equal(wGreen.credits[0]!.amount, 100, "scheduled-game A: grønn → 100 kr");
  assert.equal(wRed.credits[0]!.amount, 50, "scheduled-game B: rød → 50 kr");
});

// ── B9: Defensivt — gameVariant-eksklusivitet ──────────────────────────────

test("[B9] runtime: Trafikklys + Oddsen er gjensidig ekskluderende — bridge skriver kun trafikklys-blokk", () => {
  // Bridge-test: når katalog har gameVariant=trafikklys, skal IKKE
  // oddsen-blokk skrives (selv om bridge skulle få Oddsen-felter
  // tilfeldigvis). buildOddsenBlock returnerer null fordi
  // gameVariant !== "oddsen".
  const catalog = makeTrafikklysCatalog();
  const cfg = buildTicketConfigFromCatalog(catalog);
  const spill1 = cfg.spill1 as { trafikklys?: unknown; oddsen?: unknown };
  assert.ok(spill1.trafikklys, "spill1.trafikklys skal være satt");
  assert.equal(
    spill1.oddsen,
    undefined,
    "spill1.oddsen skal IKKE være satt for Trafikklys-katalog",
  );
});

test("[B9] runtime: ukjent rad-farge i DB → fallback til standard pattern", async () => {
  // Hvis trafikklys_row_color har en verdi som ikke er i rules.rowColors
  // (dvs. korrupt DB-data eller admin har endret rules etter spill-start),
  // skal engine logge warning og falle tilbake til standard pot-per-
  // bongstørrelse-pathen. Verifisert ved å sette rad-fargen til en farge
  // som ikke finnes i config (f.eks. via direkte DB-injeksjon).
  //
  // Vi bygger en config der rules.rowColors mangler "rød" så pot-en for
  // rød er udefinert. Engine skal da hoppe Trafikklys-pathen og falle
  // til standard-pathen som bruker placeholder-pattern (100 kr).
  const limitedCfg = {
    spill1: {
      ticketColors: [
        {
          color: "small_white",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
      ],
      trafikklys: {
        rowColors: ["grønn", "gul"], // mangler "rød"
        prizesPerRowColor: {
          grønn: 10000,
          gul: 15000,
        },
        bingoPerRowColor: {
          grønn: 100000,
          gul: 150000,
        },
      },
    },
    rules: {
      gameVariant: "trafikklys",
      rowColors: ["grønn", "gul"],
      prizesPerRowColor: { grønn: 10000, gul: 15000 },
      bingoPerRowColor: { grønn: 100000, gul: 150000 },
    },
  };
  const { service, wallet } = makeServiceForRow1(
    limitedCfg,
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_white",
      },
    ],
    "rød", // ikke i rowColors → engine skal logge + falle tilbake
  );
  await service.drawNext("g1");
  // Standard-fallback bruker placeholder-pattern: 100 kr.
  assert.equal(wallet.credits.length, 1);
  assert.equal(
    wallet.credits[0]!.amount,
    100,
    "fallback til standard-pattern (small_white row_1 = 100 kr)",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// META — sanity-check at gap-dokumentet eksisterer
// ───────────────────────────────────────────────────────────────────────────

test("[META] gap-dokument eksisterer på forventet sti", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  // Test-fil er i apps/backend/src/game/__tests__/
  // Doc-fil er i docs/architecture/
  // Repo-root er 4 nivåer opp fra __tests__/.
  const docPath = path.resolve(
    new URL(import.meta.url).pathname,
    "../../../../../../docs/architecture/TRAFIKKLYS_RUNTIME_GAP_2026-05-08.md",
  );
  const stat = await fs.stat(docPath);
  assert.ok(stat.isFile(), `Gap-dokument må eksistere på ${docPath}`);
});
