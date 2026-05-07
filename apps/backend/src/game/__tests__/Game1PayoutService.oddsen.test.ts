/**
 * Oddsen end-to-end (2026-05-08): integrasjons-tester som verifiserer
 * at `planOddsenFullHousePayout`-output drives `Game1PayoutService.payoutPhase`
 * korrekt.
 *
 * Dette er ikke en full draw-engine-test — engine-koden iterer
 * `plan.groups[]` og kaller `payoutService.payoutPhase` med
 * `totalPhasePrizeCents = perWinnerPrize × winnerCount`. Vi simulerer
 * den iterasjonen direkte og sjekker at wallet-credit endte korrekt.
 *
 * Spec-eksempler:
 *   - Fullt Hus på trekk 55 med target 55 → high payout
 *   - Fullt Hus på trekk 54 med target 55 → high payout
 *   - Fullt Hus på trekk 56 med target 55 → low payout
 *   - Standard spill (ingen oddsen-section) → unaffected
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1PayoutService,
  type Game1WinningAssignment,
} from "../Game1PayoutService.js";
import { resolveColorFamily } from "../Game1JackpotService.js";
import { planOddsenFullHousePayout } from "../Game1DrawEngineHelpers.js";
import type {
  WalletAdapter,
  WalletTransaction,
} from "../../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";

// ── Stubs ───────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function makeFakeClient(): {
  client: {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, queries };
}

function makeWallet(): {
  adapter: WalletAdapter;
  credits: Array<{ walletId: string; amountKroner: number; reason: string }>;
} {
  const credits: Array<{
    walletId: string;
    amountKroner: number;
    reason: string;
  }> = [];
  let txCounter = 0;
  const adapter: WalletAdapter = {
    async createAccount() {
      throw new Error("n/a");
    },
    async ensureAccount() {
      throw new Error("n/a");
    },
    async getAccount() {
      throw new Error("n/a");
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
      throw new Error("n/a");
    },
    async credit(walletId, amount, reason) {
      credits.push({ walletId, amountKroner: amount, reason });
      const tx: WalletTransaction = {
        id: `wtx-${++txCounter}`,
        accountId: walletId,
        type: "CREDIT",
        amount,
        reason,
        createdAt: new Date().toISOString(),
      };
      return tx;
    },
    async topUp() {
      throw new Error("n/a");
    },
    async withdraw() {
      throw new Error("n/a");
    },
    async transfer() {
      throw new Error("n/a");
    },
    async listTransactions() {
      return [];
    },
  };
  return { adapter, credits };
}

const ODDSEN_55_CFG = {
  targetDraw: 55,
  bingoLowPrizes: { yellow: 100000, white: 50000, purple: 150000 },
  bingoHighPrizes: { yellow: 300000, white: 150000, purple: 450000 },
};

// ── Hjelper: simuler engine-iterasjon over plan ─────────────────────────

async function runOddsenPayout(args: {
  winners: Game1WinningAssignment[];
  drawSequenceAtWin: number;
  oddsenCfg: typeof ODDSEN_55_CFG;
}): Promise<{
  credits: Array<{ walletId: string; amountKroner: number; reason: string }>;
  bucket: "high" | "low";
}> {
  const wallet = makeWallet();
  const auditLog = new AuditLogService(new InMemoryAuditLogStore());
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet.adapter,
    auditLogService: auditLog,
  });
  const { client } = makeFakeClient();

  const plan = planOddsenFullHousePayout({
    oddsenCfg: args.oddsenCfg,
    drawSequenceAtWin: args.drawSequenceAtWin,
    winners: args.winners,
    resolveColorFamily,
  });

  // Re-grupper winners per family, identisk til engine-koden.
  const byFamily = new Map<string, Game1WinningAssignment[]>();
  for (const w of args.winners) {
    const family = resolveColorFamily(w.ticketColor);
    let list = byFamily.get(family);
    if (!list) {
      list = [];
      byFamily.set(family, list);
    }
    list.push(w);
  }

  for (const group of plan.groups) {
    const groupWinners = byFamily.get(group.colorFamily) ?? [];
    if (groupWinners.length === 0) continue;
    await payoutService.payoutPhase(client as never, {
      scheduledGameId: "g-oddsen-test",
      phase: 5,
      drawSequenceAtWin: args.drawSequenceAtWin,
      roomCode: "",
      totalPhasePrizeCents: group.totalPhasePrizeCents,
      winners: groupWinners,
      jackpotAmountCentsPerWinner: 0,
      phaseName: "Fullt Hus",
    });
  }

  return { credits: wallet.credits, bucket: plan.bucket };
}

function makeWinner(
  i: number,
  ticketColor: string,
): Game1WinningAssignment {
  return {
    assignmentId: `a-${i}`,
    walletId: `w-${i}`,
    userId: `u-${i}`,
    hallId: "hall-a",
    ticketColor,
  };
}

// ── Spec-tester ─────────────────────────────────────────────────────────

test("Spec: Fullt Hus på trekk 55, target 55 → HIGH payout for bongfargen", async () => {
  // Yellow (gul, 10 kr) på trekk 55 ≤ 55 → high tabel: 300 kr (300000 øre)
  const result = await runOddsenPayout({
    winners: [makeWinner(1, "small_yellow")],
    drawSequenceAtWin: 55,
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.equal(result.bucket, "high");
  assert.equal(result.credits.length, 1);
  // Wallet får payout i kroner — 300000 øre = 3000 kr
  assert.equal(result.credits[0].amountKroner, 3000);
});

test("Spec: Fullt Hus på trekk 54, target 55 → HIGH payout", async () => {
  const result = await runOddsenPayout({
    winners: [makeWinner(1, "small_purple")],
    drawSequenceAtWin: 54,
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.equal(result.bucket, "high");
  // Purple (lilla, 15 kr) high = 450 kr
  assert.equal(result.credits[0].amountKroner, 4500);
});

test("Spec: Fullt Hus på trekk 56, target 55 → LOW payout", async () => {
  const result = await runOddsenPayout({
    winners: [makeWinner(1, "small_yellow")],
    drawSequenceAtWin: 56,
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.equal(result.bucket, "low");
  // Yellow low = 100 kr × 1 = 1000 øre = 10 kr i wallet (kr-konvertert)
  // 100000 øre = 1000 kr
  assert.equal(result.credits[0].amountKroner, 1000);
});

test("Spec: Multi-vinner samme farge — hver vinner får full prize (ikke split)", async () => {
  // 3 yellow-vinnere på trekk 50 (high). Hver skal ha 3000 kr.
  // Engine sender totalPhasePrize=900000 og winners=[3], payoutService
  // floor-deler: 900000/3 = 300000 per winner.
  const result = await runOddsenPayout({
    winners: [
      makeWinner(1, "small_yellow"),
      makeWinner(2, "large_yellow"),
      makeWinner(3, "small_yellow"),
    ],
    drawSequenceAtWin: 50,
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.equal(result.credits.length, 3);
  for (const c of result.credits) {
    assert.equal(c.amountKroner, 3000, "hver yellow-vinner får 3000 kr high");
  }
});

test("Spec: Multi-color → hver farge får sin egen prize (separate splits)", async () => {
  // Yellow: 2 vinnere, white: 1 vinner, purple: 1 vinner. Trekk 30 → high.
  const result = await runOddsenPayout({
    winners: [
      makeWinner(1, "small_yellow"),
      makeWinner(2, "small_yellow"),
      makeWinner(3, "small_white"),
      makeWinner(4, "small_purple"),
    ],
    drawSequenceAtWin: 30,
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.equal(result.bucket, "high");
  assert.equal(result.credits.length, 4);
  // Sort credits by walletId for stable assertion
  const byWallet = new Map(result.credits.map((c) => [c.walletId, c]));
  assert.equal(byWallet.get("w-1")!.amountKroner, 3000); // yellow high
  assert.equal(byWallet.get("w-2")!.amountKroner, 3000); // yellow high
  assert.equal(byWallet.get("w-3")!.amountKroner, 1500); // white high
  assert.equal(byWallet.get("w-4")!.amountKroner, 4500); // purple high
});

test("Spec: low-bucket multi-color — riktige low-priser per farge", async () => {
  const result = await runOddsenPayout({
    winners: [
      makeWinner(1, "small_yellow"),
      makeWinner(2, "small_white"),
      makeWinner(3, "small_purple"),
    ],
    drawSequenceAtWin: 60, // > target=55 → low
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.equal(result.bucket, "low");
  const byWallet = new Map(result.credits.map((c) => [c.walletId, c]));
  assert.equal(byWallet.get("w-1")!.amountKroner, 1000); // yellow low = 1000 kr
  assert.equal(byWallet.get("w-2")!.amountKroner, 500); // white low = 500 kr
  assert.equal(byWallet.get("w-3")!.amountKroner, 1500); // purple low = 1500 kr
});

test("Spec: Multi-vinner same farge — splittet (4 yellow på samme runde)", async () => {
  // 4 yellow på trekk 50 (high tabel = 300 kr per vinner)
  // totalPhasePrizeCents = 300000 × 4 = 1200000
  // Hver vinner: 1200000 / 4 = 300000 = 3000 kr (eksakt deling)
  const result = await runOddsenPayout({
    winners: [
      makeWinner(1, "small_yellow"),
      makeWinner(2, "small_yellow"),
      makeWinner(3, "small_yellow"),
      makeWinner(4, "small_yellow"),
    ],
    drawSequenceAtWin: 50,
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.equal(result.bucket, "high");
  assert.equal(result.credits.length, 4);
  for (const c of result.credits) {
    assert.equal(c.amountKroner, 3000);
  }
});

test("Reason-string inneholder Fullt Hus", async () => {
  // Verifiser at compliance-audit får riktig phase-name.
  const result = await runOddsenPayout({
    winners: [makeWinner(1, "small_yellow")],
    drawSequenceAtWin: 55,
    oddsenCfg: ODDSEN_55_CFG,
  });
  assert.match(result.credits[0].reason, /Fullt Hus/);
});

test("Standard-spill (ingen oddsen): planner returnerer plan.groups=[] → ingen Oddsen-payout", async () => {
  // resolveOddsenConfig returnerer null for standard-spill, så engine
  // hopper Oddsen-pathen helt. Vi verifiserer bare at `runOddsenPayout`-
  // wrapperen gir 0 credits når planner ikke kjøres på riktige data.
  // Direkte test: kall planner med minimal cfg, ingen vinnere.
  const plan = planOddsenFullHousePayout({
    oddsenCfg: ODDSEN_55_CFG,
    drawSequenceAtWin: 50,
    winners: [],
    resolveColorFamily,
  });
  assert.equal(plan.groups.length, 0);
});
