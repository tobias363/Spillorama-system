/**
 * GAME1_SCHEDULE PR 4c integrasjons-tester (4c-services-coverage hull 5).
 *
 * Minimal service-integrasjon: Game1JackpotService + Game1PayoutService
 * wire'd sammen slik de gjøres av Game1DrawEngineService.evaluateAndPayoutPhase.
 * Dekker:
 *
 *   1. Fullt Hus + jackpot-ball aktiv: JackpotService.evaluate returnerer
 *      amountCents → PayoutService.payoutPhase mottar dette som
 *      `jackpotAmountCentsPerWinner` → wallet.credit får totalt
 *      (phasePrize + jackpot) i kroner.
 *
 *   2. 2 vinnere på Fullt Hus med ULIKE farger: BUG 2-FIX (2026-04-22):
 *      DrawEngine evaluerer nå jackpot per vinners egen ticketColor — ikke
 *      kun `winners[0].ticketColor`. Hver vinner får derfor jackpot matchet
 *      med sin egen farge. Testen speiler ny flat-path-atferd der
 *      `Game1DrawEngineService.payoutFlatPathWithPerWinnerJackpot`
 *      itererer unik-jackpot-grupper.
 *
 * Scope-gate: 2 tester per PM-direktiv. Ikke en erstatning for
 * payoutWire.test.ts (som tester DB-level integrasjon).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1PayoutService,
  type Game1WinningAssignment,
} from "./Game1PayoutService.js";
import {
  Game1JackpotService,
  type Game1JackpotConfig,
} from "./Game1JackpotService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Felles stubs ────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function makeFakeClient(): {
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
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

function makeCreditCapturingWallet(): {
  adapter: WalletAdapter;
  credits: Array<{ walletId: string; amountKroner: number }>;
} {
  const credits: Array<{ walletId: string; amountKroner: number }> = [];
  let txCounter = 0;
  const adapter: WalletAdapter = {
    async createAccount() { throw new Error("n/a"); },
    async ensureAccount() { throw new Error("n/a"); },
    async getAccount() { throw new Error("n/a"); },
    async listAccounts() { return []; },
    async getBalance() { return 0; },
    async debit() { throw new Error("n/a"); },
    async credit(walletId, amount, reason) {
      credits.push({ walletId, amountKroner: amount });
      const tx: WalletTransaction = {
        id: `wtx-${++txCounter}`, accountId: walletId, type: "CREDIT",
        amount, reason, createdAt: new Date().toISOString(),
      };
      return tx;
    },
    async topUp() { throw new Error("n/a"); },
    async withdraw() { throw new Error("n/a"); },
    async transfer() { throw new Error("n/a"); },
    async listTransactions() { return []; },
  };
  return { adapter, credits };
}

/** Fullt Hus-kontekst + PayoutService + JackpotService wire'd sammen. */
async function runFullHusPayoutIntegration(input: {
  winners: Array<Game1WinningAssignment>;
  totalPhasePrizeCents: number;
  drawSequenceAtWin: number;
  jackpotConfig: Game1JackpotConfig;
  /** Hvilken vinners farge brukes for jackpot-oppslag — dagens kode bruker winners[0]. */
  jackpotLookupColorFromFirstWinner: boolean;
}): Promise<{
  credits: Array<{ walletId: string; amountKroner: number }>;
  queries: RecordedQuery[];
  resolvedJackpotAmountCents: number;
}> {
  const walletCtx = makeCreditCapturingWallet();
  const auditLog = new AuditLogService(new InMemoryAuditLogStore());

  // Wire 1: JackpotService evaluerer — samme path som DrawEngine:903.
  const jackpotService = new Game1JackpotService();
  const lookupWinner = input.winners[0]!;
  const j = jackpotService.evaluate({
    phase: 5,
    drawSequenceAtWin: input.drawSequenceAtWin,
    ticketColor: lookupWinner.ticketColor,
    jackpotConfig: input.jackpotConfig,
  });
  const resolvedJackpotAmountCents = j.triggered ? j.amountCents : 0;
  void input.jackpotLookupColorFromFirstWinner; // markør for leserskap av testen

  // Wire 2: PayoutService mottar den beregnede jackpot-verdien.
  const payoutService = new Game1PayoutService({
    walletAdapter: walletCtx.adapter,
    auditLogService: auditLog,
  });
  const { client, queries } = makeFakeClient();

  await payoutService.payoutPhase(client as never, {
    scheduledGameId: "g-integration",
    phase: 5,
    drawSequenceAtWin: input.drawSequenceAtWin,
    roomCode: "",
    totalPhasePrizeCents: input.totalPhasePrizeCents,
    winners: input.winners,
    jackpotAmountCentsPerWinner: resolvedJackpotAmountCents,
    phaseName: "Fullt Hus",
  });

  return {
    credits: walletCtx.credits,
    queries,
    resolvedJackpotAmountCents,
  };
}

// ── Test 1: Fullt Hus + jackpot-ball aktiv ──────────────────────────────────

test("integrasjon: Fullt Hus full-house-with-jackpot — både phase-prize og jackpot, grense-check mot jackpot.draw", async () => {
  // Parametrisert: samme single-vinner-setup, varierer drawSequenceAtWin.
  //   - draw 45 ≤ jackpot.draw=50 → jackpot triggerer, credit = phase + jackpot.
  //   - draw 50 ≤ jackpot.draw=50 → grense inclusive, credit = phase + jackpot.
  //   - draw 55 > jackpot.draw=50 → jackpot IKKE trigget, kun phase-prize.
  const phaseKroner = 1000;
  const jackpotKroner = 5000;
  const scenarios = [
    { drawSeq: 45, expectCredit: phaseKroner + jackpotKroner, triggered: true },
    { drawSeq: 50, expectCredit: phaseKroner + jackpotKroner, triggered: true },
    { drawSeq: 55, expectCredit: phaseKroner, triggered: false },
  ];

  for (const s of scenarios) {
    const result = await runFullHusPayoutIntegration({
      winners: [
        {
          assignmentId: "a-1", walletId: "w-1", userId: "u-1",
          hallId: "hall-a", ticketColor: "small_yellow",
        },
      ],
      totalPhasePrizeCents: phaseKroner * 100,
      drawSequenceAtWin: s.drawSeq,
      jackpotConfig: {
        prizeByColor: { yellow: jackpotKroner },
        draw: 50,
      },
      jackpotLookupColorFromFirstWinner: true,
    });

    assert.equal(
      result.resolvedJackpotAmountCents > 0, s.triggered,
      `draw=${s.drawSeq}: jackpot triggered=${s.triggered}`,
    );
    assert.equal(result.credits.length, 1);
    assert.equal(
      result.credits[0]!.amountKroner, s.expectCredit,
      `draw=${s.drawSeq}: credit = ${s.expectCredit} kr`,
    );

    // phase_winners-raden har korrekt jackpot_amount_cents når triggered.
    const phaseInsert = result.queries.find(
      (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners"),
    );
    assert.ok(phaseInsert);
    if (s.triggered) {
      assert.equal(
        phaseInsert!.params[12], jackpotKroner * 100,
        `draw=${s.drawSeq}: jackpot_amount_cents lagret`,
      );
    } else {
      assert.equal(
        phaseInsert!.params[12], null,
        `draw=${s.drawSeq}: jackpot_amount_cents=null når ikke trigget`,
      );
    }
  }
});

// ── Test 2: Multi-winner med ulike farger — Bug 2-fix per-farge-jackpot ────

test("integrasjon: 2 vinnere på Fullt Hus med ulike farger → HVER vinner får jackpot basert på EGEN farge (Bug 2-fix)", async () => {
  // Alice (small_yellow) + Bob (small_white). Fullt Hus på draw 40.
  // Config: yellow=10000 kr, white=3000 kr.
  //
  // Før Bug 2-fix (Game1DrawEngineService.ts:~903):
  //   `jackpotService.evaluate({ ticketColor: firstWinner.ticketColor, ... })`
  // brukte KUN første-vinner's farge. Alle vinnere fikk da samme
  // jackpot (10000 kr).
  //
  // Etter Bug 2-fix (2026-04-22):
  //   `payoutFlatPathWithPerWinnerJackpot` evaluerer jackpotService per
  //   vinners EGEN ticketColor og emitter én payoutPhase-call per unik
  //   jackpot-sats. Hver vinner får derfor matchet sin egen farge.
  //
  // Total split: 2000 kr pool / 2 vinnere = 1000 kr hver (flat-path).
  //   - Alice (yellow): 1000 + 10000 = 11000 kr.
  //   - Bob   (white):  1000 +  3000 =  4000 kr.
  const result = await runFlatPathPerWinnerJackpotIntegration({
    winners: [
      {
        assignmentId: "a-alice", walletId: "w-alice", userId: "u-alice",
        hallId: "hall-a", ticketColor: "small_yellow",
      },
      {
        assignmentId: "a-bob", walletId: "w-bob", userId: "u-bob",
        hallId: "hall-a", ticketColor: "small_white",
      },
    ],
    totalPhasePrizeCents: 200000, // 2000 kr
    drawSequenceAtWin: 40,
    jackpotConfig: {
      prizeByColor: { yellow: 10000, white: 3000 },
      draw: 50,
    },
  });

  assert.equal(result.credits.length, 2);

  // Alice: 1000 (split) + 10000 (jackpot via egen farge yellow) = 11000 kr.
  const alice = result.credits.find((c) => c.walletId === "w-alice");
  assert.ok(alice);
  assert.equal(alice!.amountKroner, 11000, "Alice (yellow): split + yellow jackpot");

  // Bob: 1000 (split) + 3000 (jackpot via EGEN farge white, ikke Alices) = 4000 kr.
  // Dette er Bug 2-fiksen: hver vinner får routet til sin egen farges jackpot.
  const bob = result.credits.find((c) => c.walletId === "w-bob");
  assert.ok(bob);
  assert.equal(
    bob!.amountKroner, 4000,
    "Bob (white) får EGEN farges jackpot (3000 kr), ikke Alices yellow (10000 kr)",
  );

  // phase_winners-rader: én per vinner, med korrekt per-vinner jackpot.
  // params-layout (1-basert i SQL, 0-basert i array): id=[0], scheduledGame=[1],
  // assignmentId=[2], userId=[3], hallId=[4], phase=[5], drawSeq=[6],
  // prize=[7], totalPhase=[8], winnerCount=[9], ticketColor=[10],
  // walletTxId=[11], jackpotCents=[12].
  const phaseInserts = result.queries.filter(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners"),
  );
  assert.equal(phaseInserts.length, 2, "én phase_winners-rad per vinner");
  const aliceRow = phaseInserts.find((q) => q.params[10] === "small_yellow");
  const bobRow = phaseInserts.find((q) => q.params[10] === "small_white");
  assert.ok(aliceRow, "Alice's phase_winner-rad med ticketColor=small_yellow");
  assert.ok(bobRow, "Bob's phase_winner-rad med ticketColor=small_white");
  assert.equal(aliceRow!.params[12], 10000 * 100, "Alice's jackpot_amount_cents=yellow");
  assert.equal(bobRow!.params[12], 3000 * 100, "Bob's jackpot_amount_cents=white");
});

/**
 * Wire'r flat-path-logikken fra `Game1DrawEngineService.payoutFlatPathWithPerWinnerJackpot`:
 * splitter flat-pott likt mellom alle vinnere, grupperer vinnere per unik
 * jackpot-sats (evaluert per vinner's egen farge) og kaller
 * `PayoutService.payoutPhase` én gang per gruppe. Dette er nøyaktig samme
 * kontrakt som DrawEngine bruker ved evaluateAndPayoutPhase.
 */
async function runFlatPathPerWinnerJackpotIntegration(input: {
  winners: Array<Game1WinningAssignment>;
  totalPhasePrizeCents: number;
  drawSequenceAtWin: number;
  jackpotConfig: Game1JackpotConfig;
}): Promise<{
  credits: Array<{ walletId: string; amountKroner: number }>;
  queries: RecordedQuery[];
}> {
  const walletCtx = makeCreditCapturingWallet();
  const auditLog = new AuditLogService(new InMemoryAuditLogStore());
  const payoutService = new Game1PayoutService({
    walletAdapter: walletCtx.adapter,
    auditLogService: auditLog,
  });
  const jackpotService = new Game1JackpotService();
  const { client, queries } = makeFakeClient();

  // Per-vinner-jackpot-grupping (speiler DrawEngine.payoutFlatPathWithPerWinnerJackpot).
  const totalWinners = input.winners.length;
  const perWinnerPrizeFromFlatPot = Math.floor(input.totalPhasePrizeCents / totalWinners);

  const byJackpotAmount = new Map<number, Array<Game1WinningAssignment>>();
  for (const w of input.winners) {
    const j = jackpotService.evaluate({
      phase: 5,
      drawSequenceAtWin: input.drawSequenceAtWin,
      ticketColor: w.ticketColor,
      jackpotConfig: input.jackpotConfig,
    });
    const amount = j.triggered ? j.amountCents : 0;
    let list = byJackpotAmount.get(amount);
    if (!list) {
      list = [];
      byJackpotAmount.set(amount, list);
    }
    list.push(w);
  }

  for (const [jackpotAmount, groupWinners] of byJackpotAmount.entries()) {
    const groupSize = groupWinners.length;
    const groupTotalPrize = perWinnerPrizeFromFlatPot * groupSize;
    await payoutService.payoutPhase(client as never, {
      scheduledGameId: "g-integration",
      phase: 5,
      drawSequenceAtWin: input.drawSequenceAtWin,
      roomCode: "",
      totalPhasePrizeCents: groupTotalPrize,
      winners: groupWinners,
      jackpotAmountCentsPerWinner: jackpotAmount,
      phaseName: "Fullt Hus",
    });
  }

  return { credits: walletCtx.credits, queries };
}
