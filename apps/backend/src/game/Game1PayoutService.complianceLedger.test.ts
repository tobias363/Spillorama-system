/**
 * K1 compliance-fix: ComplianceLedger PRIZE/EXTRA_PRIZE-tester for Game1PayoutService.
 *
 * Verifiserer at `payoutPhase()` kaller `complianceLedgerPort.recordComplianceLedgerEvent`
 * med VINNERENS kjøpe-hall (winner.hallId), IKKE master-hallen. Parallelt til
 * STAKE-bindingen i Game1TicketPurchaseService er PRIZE-bindingen også per-hall
 * — en vinner i hall B får sin PRIZE-entry bundet til hall B sitt house-account,
 * selv om master-hallen er hall A.
 *
 * Test-matrise:
 *   1) Single-hall: PRIZE-entry bundet til hall-a.
 *   2) Multi-hall, vinner i hall-b mens master = hall-a: PRIZE bundet til hall-b.
 *   3) Multi-hall, flere vinnere fra ulike haller: hver får egen PRIZE-entry
 *      bundet til sin hall.
 *   4) Jackpot ≠ 0 → både PRIZE og EXTRA_PRIZE-entry per vinner.
 *   5) Zero-prize → ingen PRIZE-entry (amount=0, skip).
 *   6) Port kaster → payout lykkes (soft-fail).
 *   7) Default Noop → payout fungerer uten port.
 *
 * Relatert: winner.hallId kommer fra `app_game1_ticket_purchases.hall_id`
 * som allerede lagrer kjøpe-hallen (ikke master-hallen).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1PayoutService,
  type Game1WinningAssignment,
} from "./Game1PayoutService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type {
  ComplianceLedgerEventInput,
  ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";

// ── Stubs ───────────────────────────────────────────────────────────────────

function makeFakeClient(): {
  client: {
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
} {
  const client = {
    async query(_sql: string, _params: unknown[] = []) {
      return { rows: [], rowCount: 0 };
    },
  };
  return { client };
}

function makeFakeWallet(): WalletAdapter {
  let txCounter = 0;
  return {
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
      throw new Error("not implemented");
    },
    async credit(accountId, amount, reason): Promise<WalletTransaction> {
      return {
        id: `wtx-${++txCounter}`,
        accountId,
        type: "CREDIT",
        amount,
        reason,
        createdAt: new Date().toISOString(),
      };
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
}

function makeRecordingLedgerPort(opts?: {
  throwOnPrize?: boolean;
}): { port: ComplianceLedgerPort; calls: ComplianceLedgerEventInput[] } {
  const calls: ComplianceLedgerEventInput[] = [];
  const port: ComplianceLedgerPort = {
    async recordComplianceLedgerEvent(input) {
      if (opts?.throwOnPrize && input.eventType === "PRIZE") {
        throw new Error("simulated ledger failure for PRIZE");
      }
      calls.push(input);
    },
  };
  return { port, calls };
}

function winner(
  overrides: Partial<Game1WinningAssignment> = {}
): Game1WinningAssignment {
  return {
    assignmentId: "a-1",
    walletId: "w-1",
    userId: "u-1",
    hallId: "hall-a",
    ticketColor: "yellow",
    ...overrides,
  };
}

function makeService(
  complianceLedgerPort?: ComplianceLedgerPort
): Game1PayoutService {
  return new Game1PayoutService({
    walletAdapter: makeFakeWallet(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    ...(complianceLedgerPort ? { complianceLedgerPort } : {}),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("K1: single-winner → PRIZE-entry bundet til winner.hallId", async () => {
  const { port, calls } = makeRecordingLedgerPort();
  const service = makeService(port);
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 50000, // 500 kr
    winners: [winner({ hallId: "hall-a" })],
    phaseName: "1 Rad",
  });

  const prizeCalls = calls.filter((c) => c.eventType === "PRIZE");
  assert.equal(prizeCalls.length, 1, "én PRIZE-entry");
  assert.equal(prizeCalls[0]!.hallId, "hall-a");
  assert.equal(prizeCalls[0]!.amount, 500); // øre → kroner
  // K2-A CRIT-1: Spill 1 er hovedspill → MAIN_GAME (15%), ikke DATABINGO (30%).
  assert.equal(prizeCalls[0]!.gameType, "MAIN_GAME");
  assert.equal(prizeCalls[0]!.playerId, "u-1");
  assert.equal(prizeCalls[0]!.walletId, "w-1");
  assert.equal(prizeCalls[0]!.gameId, "g1");
});

test("K1 REGULATORISK: multi-hall, vinner i hall-b → PRIZE bundet til hall-b (ikke master hall-a)", async () => {
  // Selv om master-hall er hall-a, vant en spiller som kjøpte i hall-b.
  // Payout-compliance-entry skal bindes til hall-b (vinnerens kjøpe-hall),
  // slik at §71-rapport for hall-b reflekterer utbetalingen — ikke master-
  // hallens rapport.
  const { port, calls } = makeRecordingLedgerPort();
  const service = makeService(port);
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 2,
    drawSequenceAtWin: 30,
    roomCode: "",
    totalPhasePrizeCents: 100000, // 1000 kr
    winners: [winner({ hallId: "hall-b", assignmentId: "a-b" })],
    phaseName: "2 Rader",
  });

  const prizeCalls = calls.filter((c) => c.eventType === "PRIZE");
  assert.equal(prizeCalls.length, 1);
  assert.equal(
    prizeCalls[0]!.hallId,
    "hall-b",
    "PRIZE-entry MÅ bindes til vinnerens kjøpe-hall, ikke master"
  );
  assert.notEqual(prizeCalls[0]!.hallId, "hall-a");
});

test("K1 REGULATORISK: multi-hall, vinnere fra 3 ulike haller → 3 PRIZE-entries, én per hall", async () => {
  // Split-rounding: 3 vinnere, hver får 1000/3 = 333 kr (rest 1 øre til hus).
  const { port, calls } = makeRecordingLedgerPort();
  const service = makeService(port);
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 3,
    drawSequenceAtWin: 40,
    roomCode: "",
    totalPhasePrizeCents: 100000, // 1000 kr, split 3-veis: floor(100000/3)=33333 per winner
    winners: [
      winner({ hallId: "hall-a", assignmentId: "a-a", walletId: "w-a", userId: "u-a" }),
      winner({ hallId: "hall-b", assignmentId: "a-b", walletId: "w-b", userId: "u-b" }),
      winner({ hallId: "hall-c", assignmentId: "a-c", walletId: "w-c", userId: "u-c" }),
    ],
    phaseName: "3 Rader",
  });

  const prizeCalls = calls.filter((c) => c.eventType === "PRIZE");
  assert.equal(prizeCalls.length, 3);
  const hallIdsByWinner = new Map(
    prizeCalls.map((c) => [c.walletId, c.hallId] as [string | undefined, string])
  );
  assert.equal(hallIdsByWinner.get("w-a"), "hall-a");
  assert.equal(hallIdsByWinner.get("w-b"), "hall-b");
  assert.equal(hallIdsByWinner.get("w-c"), "hall-c");
});

test("K1: jackpot > 0 → EXTRA_PRIZE-entry i tillegg til PRIZE (samme hall)", async () => {
  const { port, calls } = makeRecordingLedgerPort();
  const service = makeService(port);
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 5, // Fullt Hus
    drawSequenceAtWin: 52,
    roomCode: "",
    totalPhasePrizeCents: 200000, // 2000 kr
    winners: [winner({ hallId: "hall-b" })],
    jackpotAmountCentsPerWinner: 500000, // 5000 kr jackpot
    phaseName: "Fullt Hus",
  });

  assert.equal(calls.length, 2, "både PRIZE og EXTRA_PRIZE");
  const prize = calls.find((c) => c.eventType === "PRIZE");
  const extra = calls.find((c) => c.eventType === "EXTRA_PRIZE");
  assert.ok(prize, "PRIZE må skrives");
  assert.ok(extra, "EXTRA_PRIZE må skrives for jackpot");
  assert.equal(prize!.hallId, "hall-b");
  assert.equal(extra!.hallId, "hall-b", "jackpot-entry også til vinnerens hall");
  assert.equal(prize!.amount, 2000);
  assert.equal(extra!.amount, 5000);
});

test("K1: zero-prize + jackpot > 0 → kun EXTRA_PRIZE (ingen PRIZE-entry)", async () => {
  const { port, calls } = makeRecordingLedgerPort();
  const service = makeService(port);
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 5,
    drawSequenceAtWin: 52,
    roomCode: "",
    totalPhasePrizeCents: 0,
    winners: [winner({ hallId: "hall-a" })],
    jackpotAmountCentsPerWinner: 100000,
    phaseName: "Fullt Hus",
  });

  const prizeCalls = calls.filter((c) => c.eventType === "PRIZE");
  const extraCalls = calls.filter((c) => c.eventType === "EXTRA_PRIZE");
  assert.equal(prizeCalls.length, 0, "ingen PRIZE ved zero-prize");
  assert.equal(extraCalls.length, 1);
  assert.equal(extraCalls[0]!.hallId, "hall-a");
  assert.equal(extraCalls[0]!.amount, 1000);
});

test("K1: zero-prize + zero-jackpot → ingen entries", async () => {
  const { port, calls } = makeRecordingLedgerPort();
  const service = makeService(port);
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 10,
    roomCode: "",
    totalPhasePrizeCents: 0,
    winners: [winner()],
    phaseName: "1 Rad",
  });

  assert.equal(calls.length, 0);
});

test("K1: ledger-port kaster på PRIZE → payout fortsetter (soft-fail)", async () => {
  const { port } = makeRecordingLedgerPort({ throwOnPrize: true });
  const service = makeService(port);
  const { client } = makeFakeClient();

  // Skal IKKE kaste — wallet-credit + phase_winners-INSERT er committed,
  // compliance er audit-logging.
  const result = await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 1,
    drawSequenceAtWin: 25,
    roomCode: "",
    totalPhasePrizeCents: 50000,
    winners: [winner({ hallId: "hall-a" })],
    phaseName: "1 Rad",
  });

  assert.equal(result.totalWinners, 1);
  assert.equal(result.prizePerWinnerCents, 50000);
});

test("K1: default NoopComplianceLedgerPort → payout fungerer uten port", async () => {
  // Ingen port satt → service bruker Noop.
  const service = new Game1PayoutService({
    walletAdapter: makeFakeWallet(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const { client } = makeFakeClient();

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
  assert.equal(result.winnerRecords[0]!.prizeCents, 50000);
});

test("K1: PRIZE-entry inneholder phase, phaseName + ticketColor i metadata", async () => {
  const { port, calls } = makeRecordingLedgerPort();
  const service = makeService(port);
  const { client } = makeFakeClient();

  await service.payoutPhase(client as never, {
    scheduledGameId: "g1",
    phase: 4,
    drawSequenceAtWin: 45,
    roomCode: "",
    totalPhasePrizeCents: 30000,
    winners: [winner({ hallId: "hall-c", ticketColor: "purple" })],
    phaseName: "4 Rader",
  });

  const prize = calls.find((c) => c.eventType === "PRIZE");
  assert.ok(prize);
  const meta = prize!.metadata ?? {};
  assert.equal(meta.reason, "GAME1_PHASE_PAYOUT");
  assert.equal(meta.phase, 4);
  assert.equal(meta.phaseName, "4 Rader");
  assert.equal(meta.ticketColor, "purple");
  assert.equal(meta.assignmentId, "a-1");
  assert.equal(meta.winnerCount, 1);
});
