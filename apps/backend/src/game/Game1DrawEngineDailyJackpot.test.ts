/**
 * ADR-0017 (2026-05-10) — tester for runDailyJackpotEvaluation hooken etter
 * refactor til plan-run-overrides.
 *
 * Dekker:
 *   - NO_WINNERS når winners-array er tomt → no-op
 *   - NO_PLAN_RUN_BINDING når scheduled-game mangler plan_run_id → no-op
 *   - NO_OVERRIDE_FOR_POSITION når plan-run.jackpot_overrides_json ikke har
 *     entry for posisjonen → no-op
 *   - ABOVE_THRESHOLD når drawSequenceAtWin > override.draw → no-op
 *   - NO_PRIZE_FOR_COLOR når vinnerens bongfarge ikke gjenkjennes → no-op
 *   - happy path: én vinner får sin bongfarges prize-beløp
 *   - happy path: flere vinnere med samme bongfarge → pot delt likt + floor
 *   - happy path: flere bongfarger → hver farge får sin pott
 *   - skip ukonfigurerte bongfarger (override mangler farge for vinner)
 *   - wallet.credit-feil → propagerer (caller ruller tilbake draw)
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import {
  runDailyJackpotEvaluation,
  type DailyJackpotWinner,
} from "./Game1DrawEngineDailyJackpot.js";

// ── Mocks ─────────────────────────────────────────────────────────────────

interface ClientMockOpts {
  /** scheduled-game-rad. Returner null/undefined-felter for å simulere
   *  manglende plan-binding. Når undefined returneres ingen rad. */
  scheduledGame?:
    | { plan_run_id: string | null; plan_position: number | null }
    | undefined;
  /** plan-run-rad. Når undefined returneres ingen rad (= NO_OVERRIDE_FOR_POSITION). */
  planRun?:
    | {
        plan_run_id: string;
        plan_position: number;
        jackpot_overrides_json: unknown;
      }
    | undefined;
}

function makeClient(opts: ClientMockOpts): PoolClient {
  const scheduledGameRow = opts.scheduledGame;
  const planRunRow = opts.planRun;
  return {
    query: async (sql: string) => {
      if (sql.includes("app_game1_scheduled_games")) {
        if (!scheduledGameRow) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [scheduledGameRow], rowCount: 1 };
      }
      if (sql.includes("app_game_plan_run")) {
        if (!planRunRow) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [planRunRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
}

interface WalletMockOpts {
  failOnCallCount?: number;
}

function makeWallet(opts: WalletMockOpts = {}): {
  wallet: WalletAdapter;
  credits: Array<{
    accountId: string;
    amount: number;
    idempotencyKey?: string;
    to?: string;
  }>;
} {
  const credits: Array<{
    accountId: string;
    amount: number;
    idempotencyKey?: string;
    to?: string;
  }> = [];
  const wallet = {
    async credit(
      accountId: string,
      amount: number,
      _reason: string,
      options?: { idempotencyKey?: string; to?: string },
    ): Promise<WalletTransaction> {
      credits.push({
        accountId,
        amount,
        idempotencyKey: options?.idempotencyKey,
        to: options?.to,
      });
      if (opts.failOnCallCount && credits.length === opts.failOnCallCount) {
        throw new Error(`simulated wallet failure on call ${opts.failOnCallCount}`);
      }
      return {
        id: `tx-${credits.length}`,
        amount,
      } as unknown as WalletTransaction;
    },
  } as unknown as WalletAdapter;
  return { wallet, credits };
}

function makeDeps(args: {
  walletMock: ReturnType<typeof makeWallet>;
  client: PoolClient;
}) {
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  return {
    audit,
    auditStore,
    common: {
      client: args.client,
      schema: "public",
      walletAdapter: args.walletMock.wallet,
      audit,
    },
  };
}

function defaultWinners(
  count = 1,
  ticketColor = "small_yellow",
): DailyJackpotWinner[] {
  const out: DailyJackpotWinner[] = [];
  for (let i = 1; i <= count; i++) {
    out.push({
      assignmentId: `asg-${i}`,
      walletId: `w-${i}`,
      userId: `u-${i}`,
      hallId: `hall-${i}`,
      ticketColor,
    });
  }
  return out;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("runDailyJackpotEvaluation: NO_WINNERS → no-op", async () => {
  const wallet = makeWallet();
  const client = makeClient({});
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 30,
    winners: [],
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "NO_WINNERS");
  assert.equal(wallet.credits.length, 0);
});

test("runDailyJackpotEvaluation: NO_PLAN_RUN_BINDING når scheduled-game mangler plan_run_id → no-op", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: null, plan_position: null },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 30,
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "NO_PLAN_RUN_BINDING");
  assert.equal(wallet.credits.length, 0);
});

test("runDailyJackpotEvaluation: NO_OVERRIDE_FOR_POSITION når plan-run mangler entry → no-op", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {}, // tom override
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 30,
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "NO_OVERRIDE_FOR_POSITION");
  assert.equal(result.planRunId, "pr-1");
  assert.equal(result.planPosition, 7);
  assert.equal(wallet.credits.length, 0);
});

test("runDailyJackpotEvaluation: ABOVE_THRESHOLD når draw > override.draw → no-op", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          prizesCents: { gul: 100_000 },
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 51, // over override.draw=50
    winners: defaultWinners(1, "small_yellow"),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "ABOVE_THRESHOLD");
  assert.equal(result.triggerDraw, 50);
  assert.equal(wallet.credits.length, 0);
});

test("runDailyJackpotEvaluation: NO_PRIZE_FOR_COLOR når vinnerens bongfarge ikke er i override → no-op", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          // Kun gul/hvit/lilla er gyldige farger; "rød" er ikke i mappingen
          prizesCents: { gul: 100_000 },
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 50,
    winners: defaultWinners(1, "unknown_color"),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "NO_PRIZE_FOR_COLOR");
  assert.equal(wallet.credits.length, 0);
});

test("runDailyJackpotEvaluation: happy path én gul-vinner → får full gul-pott", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          prizesCents: { gul: 100_000, hvit: 50_000, lilla: 150_000 },
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "game-abc",
    drawSequenceAtWin: 47,
    winners: defaultWinners(1, "small_yellow"),
  });
  assert.equal(result.awarded, true);
  assert.equal(result.totalAwardedCents, 100_000);
  assert.equal(result.planRunId, "pr-1");
  assert.equal(result.planPosition, 7);
  assert.equal(result.triggerDraw, 50);
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.accountId, "w-1");
  assert.equal(wallet.credits[0]!.amount, 1000); // 100_000 øre = 1000 kr
  assert.equal(wallet.credits[0]!.to, "winnings");
  assert.match(
    wallet.credits[0]!.idempotencyKey ?? "",
    /^g1-jackpot-credit-game-abc-47-/,
  );
});

test("runDailyJackpotEvaluation: tre gul-vinnere → split likt med floor", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          prizesCents: { gul: 100_000 }, // 1000 kr / 3 = 333.33 kr per vinner
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 49,
    winners: defaultWinners(3, "small_yellow"),
  });
  // 100_000 / 3 = 33_333 (floor) per vinner; 1 øre rest til hus
  assert.equal(result.awarded, true);
  assert.equal(result.totalAwardedCents, 33_333 * 3);
  assert.equal(wallet.credits.length, 3);
  for (const credit of wallet.credits) {
    assert.equal(credit.amount, 33_333 / 100);
    assert.equal(credit.to, "winnings");
  }
  // Idempotency-keys er distinkte per vinner
  const keys = new Set(wallet.credits.map((c) => c.idempotencyKey));
  assert.equal(keys.size, 3, "alle keys må være unike");
});

test("runDailyJackpotEvaluation: flere bongfarger → hver farge får sin pott", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          prizesCents: { gul: 100_000, hvit: 50_000, lilla: 150_000 },
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const winners: DailyJackpotWinner[] = [
    { assignmentId: "a-1", walletId: "w-yellow", userId: "u-1", hallId: "h-1", ticketColor: "small_yellow" },
    { assignmentId: "a-2", walletId: "w-white", userId: "u-2", hallId: "h-2", ticketColor: "small_white" },
    { assignmentId: "a-3", walletId: "w-purple", userId: "u-3", hallId: "h-3", ticketColor: "large_purple" },
  ];

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 45,
    winners,
  });
  assert.equal(result.awarded, true);
  // 100_000 + 50_000 + 150_000 = 300_000
  assert.equal(result.totalAwardedCents, 300_000);
  assert.equal(wallet.credits.length, 3);

  const yellowCredit = wallet.credits.find((c) => c.accountId === "w-yellow");
  const whiteCredit = wallet.credits.find((c) => c.accountId === "w-white");
  const purpleCredit = wallet.credits.find((c) => c.accountId === "w-purple");
  assert.ok(yellowCredit && whiteCredit && purpleCredit, "alle 3 vinnere skal få credit");
  assert.equal(yellowCredit!.amount, 1000); // 100_000 øre
  assert.equal(whiteCredit!.amount, 500); // 50_000 øre
  assert.equal(purpleCredit!.amount, 1500); // 150_000 øre
});

test("runDailyJackpotEvaluation: vinner med farge som ikke har prize-config → fail-quiet, fortsetter med andre", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          // KUN gul satt — hvit-vinner får ingen credit
          prizesCents: { gul: 100_000 },
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const winners: DailyJackpotWinner[] = [
    { assignmentId: "a-1", walletId: "w-yellow", userId: "u-1", hallId: "h-1", ticketColor: "small_yellow" },
    { assignmentId: "a-2", walletId: "w-white", userId: "u-2", hallId: "h-2", ticketColor: "small_white" },
  ];

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 45,
    winners,
  });
  assert.equal(result.awarded, true);
  assert.equal(result.totalAwardedCents, 100_000); // KUN gul
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.accountId, "w-yellow");
});

test("runDailyJackpotEvaluation: wallet.credit feiler → propagerer (caller ruller tilbake)", async () => {
  const wallet = makeWallet({ failOnCallCount: 1 });
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          prizesCents: { gul: 100_000 },
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  await assert.rejects(
    () =>
      runDailyJackpotEvaluation({
        ...common,
        scheduledGameId: "g1",
        drawSequenceAtWin: 45,
        winners: defaultWinners(1, "small_yellow"),
      }),
    /simulated wallet failure/,
  );
});

test("runDailyJackpotEvaluation: tolererer snake_case prizes_cents fra DB", async () => {
  const wallet = makeWallet();
  const client = makeClient({
    scheduledGame: { plan_run_id: "pr-1", plan_position: 7 },
    planRun: {
      plan_run_id: "pr-1",
      plan_position: 7,
      jackpot_overrides_json: {
        "7": {
          draw: 50,
          prizes_cents: { gul: 50_000 }, // snake_case-form
        },
      },
    },
  });
  const { common } = makeDeps({ walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 45,
    winners: defaultWinners(1, "small_yellow"),
  });
  assert.equal(result.awarded, true);
  assert.equal(result.totalAwardedCents, 50_000);
});
