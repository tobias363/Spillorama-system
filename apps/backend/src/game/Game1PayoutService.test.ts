/**
 * GAME1_SCHEDULE PR 4c Bolk 2: Tester for Game1PayoutService.
 *
 * Dekker:
 *   - Single winner: wallet.credit + phase_winners INSERT + audit
 *   - Multi-winner split-rounding: floor(total/N), rest audites
 *   - Jackpot-beløp: lagres men kaller ikke loyalty-hook separat
 *   - Wallet.credit-feil → DomainError(PAYOUT_WALLET_CREDIT_FAILED)
 *   - Ingen vinnere → DomainError(PAYOUT_NO_WINNERS)
 *   - Ugyldig fase → DomainError(PAYOUT_INVALID_PHASE)
 *   - Loyalty-hook-feil påvirker ikke payout (fire-and-forget)
 *   - Split-rounding audit-event har korrekt amount + kroner-konvertering
 *   - Zero prize (jackpot=0, totalPhasePrize=0) hopper wallet.credit
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1PayoutService, type Game1WinningAssignment } from "./Game1PayoutService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type {
  LoyaltyPointsHookPort,
  LoyaltyHookInput,
} from "../adapters/LoyaltyPointsHookPort.js";
import type {
  SplitRoundingAuditPort,
  SplitRoundingHouseRetainedEvent,
} from "../adapters/SplitRoundingAuditPort.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// ── Stubs ───────────────────────────────────────────────────────────────────

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

function makeFakeWallet(opts: { failWithCode?: string; failReason?: "wallet-error" | "plain-error" } = {}): {
  adapter: WalletAdapter;
  credits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }>;
} {
  const credits: Array<{ accountId: string; amount: number; reason: string; idempotencyKey?: string }> = [];
  let txCounter = 0;
  const adapter: WalletAdapter = {
    async createAccount() {
      throw new Error("not implemented");
    },
    async ensureAccount() {
      throw new Error("not implemented");
    },
    async getAccount() {
      throw new Error("not implemented");
    },
    async listAccounts() {
      return [];
    },
    async getBalance() {
      return 0;
    },
    async debit() {
      throw new Error("not implemented");
    },
    async credit(accountId, amount, reason, options) {
      credits.push({
        accountId,
        amount,
        reason,
        idempotencyKey: options?.idempotencyKey,
      });
      if (opts.failWithCode) {
        if (opts.failReason === "plain-error") {
          throw new Error("simulated plain error");
        }
        throw new WalletError(opts.failWithCode, "simulated wallet failure");
      }
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
      throw new Error("not implemented");
    },
    async withdraw() {
      throw new Error("not implemented");
    },
    async transfer() {
      throw new Error("not implemented");
    },
    async listTransactions() {
      return [];
    },
  };
  return { adapter, credits };
}

function makeFakeLoyalty(opts: { throwOnWin?: boolean } = {}): {
  port: LoyaltyPointsHookPort;
  events: LoyaltyHookInput[];
} {
  const events: LoyaltyHookInput[] = [];
  const port: LoyaltyPointsHookPort = {
    async onLoyaltyEvent(input) {
      events.push(input);
      if (opts.throwOnWin && input.kind === "game.win") {
        throw new Error("simulated loyalty outage");
      }
    },
  };
  return { port, events };
}

function makeFakeSplitAudit(): {
  port: SplitRoundingAuditPort;
  events: SplitRoundingHouseRetainedEvent[];
} {
  const events: SplitRoundingHouseRetainedEvent[] = [];
  const port: SplitRoundingAuditPort = {
    async onSplitRoundingHouseRetained(event) {
      events.push(event);
    },
  };
  return { port, events };
}

function makeService(opts: {
  walletOpts?: Parameters<typeof makeFakeWallet>[0];
  loyaltyOpts?: Parameters<typeof makeFakeLoyalty>[0];
} = {}) {
  const wallet = makeFakeWallet(opts.walletOpts);
  const loyalty = makeFakeLoyalty(opts.loyaltyOpts);
  const splitAudit = makeFakeSplitAudit();
  const auditStore = new InMemoryAuditLogStore();
  const auditLog = new AuditLogService(auditStore);
  const service = new Game1PayoutService({
    walletAdapter: wallet.adapter,
    auditLogService: auditLog,
    loyaltyHook: loyalty.port,
    splitRoundingAudit: splitAudit.port,
  });
  return { service, wallet, loyalty, splitAudit, auditStore };
}

function winner(overrides: Partial<Game1WinningAssignment> = {}): Game1WinningAssignment {
  return {
    assignmentId: "a-1",
    walletId: "w-1",
    userId: "u-1",
    hallId: "hall-a",
    ticketColor: "yellow",
    ...overrides,
  };
}

// ── Happy-path tester ──────────────────────────────────────────────────────

test("payoutPhase: single winner får hele potten", async () => {
  const { service, wallet, loyalty, splitAudit, auditStore } = makeService();
  const { client, queries } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 50000, // 500 kr
    winners: [winner()],
    phaseName: "1 Rad",
  });

  assert.equal(result.totalWinners, 1);
  assert.equal(result.prizePerWinnerCents, 50000);
  assert.equal(result.houseRetainedCents, 0);
  assert.equal(result.winnerRecords.length, 1);
  assert.equal(result.winnerRecords[0]!.prizeCents, 50000);
  assert.equal(result.winnerRecords[0]!.jackpotCents, 0);
  assert.ok(result.winnerRecords[0]!.walletTransactionId);

  // wallet.credit ble kalt med 500 (kroner, ikke øre).
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 500);
  assert.equal(wallet.credits[0]!.accountId, "w-1");
  assert.ok(wallet.credits[0]!.idempotencyKey?.includes("g1"));

  // phase_winners INSERT skjedde.
  const phaseInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners")
  );
  assert.ok(phaseInsert, "INSERT phase_winners skal skje");
  // params[6] = phase = 1, params[7] = prize_amount_cents = 50000
  assert.equal(phaseInsert!.params[5], 1);
  assert.equal(phaseInsert!.params[7], 50000);

  // Loyalty-hook fired with kroner amount.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(loyalty.events.length, 1);
  assert.equal(loyalty.events[0]!.kind, "game.win");
  assert.equal(loyalty.events[0]!.amount, 500);

  // Ingen split-rounding-audit (0 rest).
  assert.equal(splitAudit.events.length, 0);

  // Audit-event skrevet.
  const audit = await auditStore.list();
  assert.ok(audit.some((e) => e.action === "game1_payout.phase_winner"));
});

test("payoutPhase: multi-winner split-rounding med rest", async () => {
  const { service, wallet, splitAudit } = makeService();
  const { client } = makeFakeClient();

  // 3 vinnere, totalt 100 kr (10000 øre) — split = 3333 øre pr., rest = 1 øre.
  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 2,
    drawSequenceAtWin: 30,
    roomCode: "",
    totalPhasePrizeCents: 10000,
    winners: [
      winner({ assignmentId: "a-1", walletId: "w-1", userId: "u-1" }),
      winner({ assignmentId: "a-2", walletId: "w-2", userId: "u-2" }),
      winner({ assignmentId: "a-3", walletId: "w-3", userId: "u-3" }),
    ],
    phaseName: "2 Rader",
  });

  assert.equal(result.totalWinners, 3);
  assert.equal(result.prizePerWinnerCents, 3333);
  assert.equal(result.houseRetainedCents, 1);
  assert.equal(wallet.credits.length, 3);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 33.33); // kroner med desimaler
  }

  // Split-rounding audit kalt med kroner-verdier.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(splitAudit.events.length, 1);
  assert.equal(splitAudit.events[0]!.amount, 0.01);
  assert.equal(splitAudit.events[0]!.winnerCount, 3);
  assert.equal(splitAudit.events[0]!.totalPhasePrize, 100);
  assert.equal(splitAudit.events[0]!.prizePerWinner, 33.33);
});

test("payoutPhase: jackpot-tillegg krediteres sammen med prize", async () => {
  const { service, wallet } = makeService();
  const { client, queries } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 5,
    drawSequenceAtWin: 50,
    roomCode: "",
    totalPhasePrizeCents: 100000, // 1000 kr
    winners: [winner()],
    jackpotAmountCentsPerWinner: 500000, // 5000 kr jackpot
    phaseName: "Fullt Hus",
  });

  // wallet.credit skal ha 1000 + 5000 = 6000 kr.
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 6000);

  // phase_winners har jackpot_amount_cents = 500000.
  const phaseInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners")
  );
  assert.ok(phaseInsert);
  assert.equal(phaseInsert!.params[12], 500000);
});

// ── Error-paths ────────────────────────────────────────────────────────────

test("payoutPhase: wallet.credit-feil → DomainError PAYOUT_WALLET_CREDIT_FAILED", async () => {
  const { service } = makeService({
    walletOpts: { failWithCode: "INSUFFICIENT_FUNDS" },
  });
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: 50000,
      winners: [winner()],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PAYOUT_WALLET_CREDIT_FAILED"
  );
});

test("payoutPhase: plain Error fra wallet → wrappes også som PAYOUT_WALLET_CREDIT_FAILED", async () => {
  const { service } = makeService({
    walletOpts: { failWithCode: "whatever", failReason: "plain-error" },
  });
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: 50000,
      winners: [winner()],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PAYOUT_WALLET_CREDIT_FAILED"
  );
});

test("payoutPhase: ingen vinnere → DomainError PAYOUT_NO_WINNERS", async () => {
  const { service } = makeService();
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: 0,
      winners: [],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PAYOUT_NO_WINNERS"
  );
});

test("payoutPhase: ugyldig fase → DomainError PAYOUT_INVALID_PHASE", async () => {
  const { service } = makeService();
  const { client } = makeFakeClient();

  for (const bad of [0, 6, -1, 3.5]) {
    await assert.rejects(
      service.payoutPhase(client as never, {
        scheduledGameId: "g1",
        phase: bad,
        drawSequenceAtWin: 25,
        roomCode: "",
        totalPhasePrizeCents: 100,
        winners: [winner()],
        phaseName: "x",
      }),
      (err) =>
        err instanceof DomainError && err.code === "PAYOUT_INVALID_PHASE"
    );
  }
});

test("payoutPhase: negativ totalPhasePrizeCents → DomainError PAYOUT_INVALID_PRIZE", async () => {
  const { service } = makeService();
  const { client } = makeFakeClient();

  await assert.rejects(
    service.payoutPhase(client as never, {
      scheduledGameId: "g1",
      phase: 1,
      drawSequenceAtWin: 25,
      roomCode: "",
      totalPhasePrizeCents: -1,
      winners: [winner()],
      phaseName: "1 Rad",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PAYOUT_INVALID_PRIZE"
  );
});

// ── Fire-and-forget semantikk ──────────────────────────────────────────────

test("payoutPhase: loyalty-hook-feil blokkerer ikke payout (fire-and-forget)", async () => {
  const { service, wallet } = makeService({
    loyaltyOpts: { throwOnWin: true },
  });
  const { client } = makeFakeClient();

  // Skal ikke kaste.
  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 50000,
    winners: [winner()],
    phaseName: "1 Rad",
  });

  assert.equal(result.totalWinners, 1);
  assert.equal(wallet.credits.length, 1);
});

test("payoutPhase: zero-prize + zero-jackpot hopper wallet.credit", async () => {
  const { service, wallet } = makeService();
  const { client, queries } = makeFakeClient();

  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 0,
    winners: [winner()],
    phaseName: "1 Rad",
  });

  // Ingen wallet-tx.
  assert.equal(wallet.credits.length, 0);
  assert.equal(result.winnerRecords[0]!.walletTransactionId, null);
  assert.equal(result.winnerRecords[0]!.prizeCents, 0);

  // phase_winners-rad skrives likevel (audit-trail).
  const phaseInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_phase_winners")
  );
  assert.ok(phaseInsert);
});
