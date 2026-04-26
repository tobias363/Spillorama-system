/**
 * MASTER_PLAN §2.3 — tester for runDailyJackpotEvaluation hooken.
 *
 * Dekker:
 *   - NO_HALL_GROUP når scheduled-game ikke har gruppe → no-op
 *   - ZERO_BALANCE når state.currentAmountCents=0 → no-op
 *   - ABOVE_THRESHOLD når drawSequenceAtWin > drawThresholds[0] → no-op
 *   - happy path: én vinner får full saldo, state debiteres
 *   - happy path: tre vinnere → split likt floor + house retainer
 *   - perWinnerCents=0 (mer vinnere enn awarded) → award skjer men ingen credit
 *   - wallet.credit-feil etter award-debit → propagerer (caller ruller tilbake draw)
 *   - idempotent service-respons → audit + ingen feil (allerede awarded)
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import type {
  AwardJackpotInput,
  AwardJackpotResult,
  Game1JackpotState,
  Game1JackpotStateService,
} from "./Game1JackpotStateService.js";
import {
  runDailyJackpotEvaluation,
  type DailyJackpotWinner,
} from "./Game1DrawEngineDailyJackpot.js";

// ── Mocks ─────────────────────────────────────────────────────────────────

interface JackpotSvcMockOpts {
  state?: Game1JackpotState;
  awardImpl?: (input: AwardJackpotInput) => Promise<AwardJackpotResult>;
}

function makeJackpotServiceMock(opts: JackpotSvcMockOpts = {}): {
  service: Game1JackpotStateService;
  awardCalls: AwardJackpotInput[];
} {
  const awardCalls: AwardJackpotInput[] = [];
  const defaultState: Game1JackpotState = {
    hallGroupId: "grp-1",
    currentAmountCents: 1_000_000, // 10 000 kr
    lastAccumulationDate: "2026-04-26",
    maxCapCents: 3_000_000,
    dailyIncrementCents: 400_000,
    drawThresholds: [50, 55, 56, 57],
    updatedAt: new Date().toISOString(),
  };
  const service = {
    async getStateForGroup(_id: string): Promise<Game1JackpotState> {
      return opts.state ?? defaultState;
    },
    async awardJackpot(input: AwardJackpotInput): Promise<AwardJackpotResult> {
      awardCalls.push(input);
      if (opts.awardImpl) return opts.awardImpl(input);
      return {
        awardId: "g1ja-test-1",
        hallGroupId: input.hallGroupId,
        awardedAmountCents: 1_000_000,
        previousAmountCents: 1_000_000,
        newAmountCents: 200_000,
        idempotent: false,
        noopZeroBalance: false,
      };
    },
  } as unknown as Game1JackpotStateService;
  return { service, awardCalls };
}

interface ClientMockOpts {
  /** Hva SELECT group_hall_id returnerer. */
  groupHallId?: string | null;
}

function makeClient(opts: ClientMockOpts = {}): PoolClient {
  return {
    query: async () => ({
      rows: opts.groupHallId === undefined
        ? []
        : [{ group_hall_id: opts.groupHallId }],
      rowCount: opts.groupHallId === undefined ? 0 : 1,
    }),
  } as unknown as PoolClient;
}

interface WalletMockOpts {
  failOnCallCount?: number;
}

function makeWallet(opts: WalletMockOpts = {}): {
  wallet: WalletAdapter;
  credits: Array<{ accountId: string; amount: number; idempotencyKey?: string; to?: string }>;
} {
  const credits: Array<{ accountId: string; amount: number; idempotencyKey?: string; to?: string }> = [];
  const wallet = {
    async credit(accountId: string, amount: number, _reason: string, options?: { idempotencyKey?: string; to?: string }): Promise<WalletTransaction> {
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

function defaultWinners(n = 1): DailyJackpotWinner[] {
  const out: DailyJackpotWinner[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      assignmentId: `asg-${i}`,
      walletId: `w-${i}`,
      userId: `u-${i}`,
      hallId: `hall-${i}`,
    });
  }
  return out;
}

function makeDeps(args: {
  jackpotMock: ReturnType<typeof makeJackpotServiceMock>;
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
      jackpotStateService: args.jackpotMock.service,
      walletAdapter: args.walletMock.wallet,
      audit,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("runDailyJackpotEvaluation: NO_WINNERS → no-op", async () => {
  const jackpot = makeJackpotServiceMock();
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 30,
    winners: [],
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "NO_WINNERS");
  assert.equal(jackpot.awardCalls.length, 0);
  assert.equal(wallet.credits.length, 0);
});

test("runDailyJackpotEvaluation: NO_HALL_GROUP når scheduled-game mangler gruppe → no-op", async () => {
  const jackpot = makeJackpotServiceMock();
  const wallet = makeWallet();
  // groupHallId null
  const client = makeClient({ groupHallId: null });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 30,
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "NO_HALL_GROUP");
  assert.equal(jackpot.awardCalls.length, 0);
});

test("runDailyJackpotEvaluation: ZERO_BALANCE når state har 0 saldo → no-op", async () => {
  const jackpot = makeJackpotServiceMock({
    state: {
      hallGroupId: "grp-1",
      currentAmountCents: 0,
      lastAccumulationDate: "2026-04-26",
      maxCapCents: 3_000_000,
      dailyIncrementCents: 400_000,
      drawThresholds: [50, 55, 56, 57],
      updatedAt: new Date().toISOString(),
    },
  });
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 50,
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "ZERO_BALANCE");
  assert.equal(jackpot.awardCalls.length, 0, "skal ikke debit-prøve på 0 saldo");
});

test("runDailyJackpotEvaluation: ABOVE_THRESHOLD når draw > thresholds[0] → no-op", async () => {
  const jackpot = makeJackpotServiceMock(); // thresholds default [50,55,56,57]
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 51, // over threshold[0]=50
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "ABOVE_THRESHOLD");
  assert.equal(jackpot.awardCalls.length, 0);
});

test("runDailyJackpotEvaluation: happy path én vinner → får full saldo + idempotency-key korrekt", async () => {
  const jackpot = makeJackpotServiceMock();
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "game-abc",
    drawSequenceAtWin: 50,
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, true);
  assert.equal(result.totalAwardedCents, 1_000_000);
  assert.equal(result.hallGroupId, "grp-1");
  assert.equal(jackpot.awardCalls.length, 1);
  assert.equal(jackpot.awardCalls[0]!.idempotencyKey, "g1-jackpot-game-abc-50");
  assert.equal(jackpot.awardCalls[0]!.reason, "FULL_HOUSE_WITHIN_THRESHOLD");
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.accountId, "w-1");
  assert.equal(wallet.credits[0]!.amount, 10_000, "10 000 kr (1_000_000 øre)");
  assert.equal(wallet.credits[0]!.to, "winnings");
  assert.match(wallet.credits[0]!.idempotencyKey ?? "", /^g1-jackpot-credit-/);
});

test("runDailyJackpotEvaluation: tre vinnere → split likt med floor + house retainer", async () => {
  const jackpot = makeJackpotServiceMock({
    awardImpl: async (input) => ({
      awardId: "g1ja-tri",
      hallGroupId: input.hallGroupId,
      awardedAmountCents: 1_000_000, // 10 000 kr
      previousAmountCents: 1_000_000,
      newAmountCents: 200_000,
      idempotent: false,
      noopZeroBalance: false,
    }),
  });
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 49,
    winners: defaultWinners(3),
  });
  // 1_000_000 / 3 = 333_333 (floor) per vinner; 1 øre rest til hus
  assert.equal(result.awarded, true);
  assert.equal(result.totalAwardedCents, 333_333 * 3, "summen er 999_999 — 1 øre til hus");
  assert.equal(wallet.credits.length, 3);
  for (const credit of wallet.credits) {
    assert.equal(credit.amount, 333_333 / 100, "3 333.33 kr per vinner");
    assert.equal(credit.to, "winnings");
  }
  // Idempotency-keys er distinkte per vinner
  const keys = new Set(wallet.credits.map((c) => c.idempotencyKey));
  assert.equal(keys.size, 3, "alle keys må være unike");
});

test("runDailyJackpotEvaluation: idempotent service-respons → ingen feil, audit logget", async () => {
  const jackpot = makeJackpotServiceMock({
    awardImpl: async (input) => ({
      awardId: "g1ja-existing",
      hallGroupId: input.hallGroupId,
      awardedAmountCents: 500_000,
      previousAmountCents: 500_000,
      new_amountCents: 200_000,
      newAmountCents: 200_000,
      idempotent: true,
      noopZeroBalance: false,
    } as AwardJackpotResult),
  });
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common, auditStore } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 30,
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, true);
  assert.equal(result.awardId, "g1ja-existing");
  // Wallet.credit kjøres uavhengig av idempotency på state-siden — credit-
  // adapteren håndterer selv via sin egen idempotency-key. Caller forventer
  // at retry-flyt alltid gjør en credit-call.
  assert.equal(wallet.credits.length, 1);
  // Audit-rad skal være logget (fire-and-forget; vent litt)
  await new Promise((r) => setTimeout(r, 20));
  const auditEntries = await auditStore.list();
  const auditEvent = auditEntries.find((e) => e.action === "game1_jackpot.auto_award");
  assert.ok(auditEvent, "skal ha audit-rad");
  assert.equal((auditEvent!.details as Record<string, unknown>).idempotent, true);
});

test("runDailyJackpotEvaluation: wallet.credit feil etter award → propageres (caller ruller tilbake draw)", async () => {
  const jackpot = makeJackpotServiceMock();
  const wallet = makeWallet({ failOnCallCount: 1 });
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  await assert.rejects(
    () => runDailyJackpotEvaluation({
      ...common,
      scheduledGameId: "g1",
      drawSequenceAtWin: 50,
      winners: defaultWinners(2),
    }),
    /simulated wallet failure/
  );
  // Service-award SKJEDDE før wallet feilet → state er debitert, men draw-
  // transaksjonen ruller tilbake i caller.
  assert.equal(jackpot.awardCalls.length, 1);
});

test("runDailyJackpotEvaluation: noopZeroBalance fra service → no-op", async () => {
  const jackpot = makeJackpotServiceMock({
    awardImpl: async (input) => ({
      awardId: "",
      hallGroupId: input.hallGroupId,
      awardedAmountCents: 0,
      previousAmountCents: 0,
      newAmountCents: 0,
      idempotent: false,
      noopZeroBalance: true,
    }),
  });
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 50,
    winners: defaultWinners(1),
  });
  assert.equal(result.awarded, false);
  assert.equal(result.skipReason, "ZERO_BALANCE");
  assert.equal(wallet.credits.length, 0, "ingen credit ved noop");
});

test("runDailyJackpotEvaluation: per-vinner-credit=0 (n>award) → award flagges men ingen credits", async () => {
  // 2 vinnere, kun 1 øre awardet → floor(1/2)=0 per vinner
  const jackpot = makeJackpotServiceMock({
    awardImpl: async (input) => ({
      awardId: "g1ja-tiny",
      hallGroupId: input.hallGroupId,
      awardedAmountCents: 1, // edge: 1 øre, 2 vinnere
      previousAmountCents: 1,
      newAmountCents: 200_000,
      idempotent: false,
      noopZeroBalance: false,
    }),
  });
  const wallet = makeWallet();
  const client = makeClient({ groupHallId: "grp-1" });
  const { common } = makeDeps({ jackpotMock: jackpot, walletMock: wallet, client });

  const result = await runDailyJackpotEvaluation({
    ...common,
    scheduledGameId: "g1",
    drawSequenceAtWin: 50,
    winners: defaultWinners(2),
  });
  assert.equal(result.awarded, true, "award skjedde");
  assert.equal(result.totalAwardedCents, 0, "men ingenting kreditert");
  assert.equal(wallet.credits.length, 0);
});
