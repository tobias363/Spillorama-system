/**
 * K2-A CRIT-2 + CRIT-3: tester for compliance ledger + single-prize-cap
 * i evaluateAccumulatingPots (PotEvaluator).
 *
 * Verifiserer:
 *   - CRIT-2: pot-payout skriver EXTRA_PRIZE-entry til ComplianceLedger med
 *     korrekt MAIN_GAME-gameType (Spill 1 = hovedspill).
 *   - CRIT-2: Soft-fail — ledger-feil ruller IKKE tilbake pot-payout.
 *   - CRIT-3: Jackpott-payout 30 000 kr → cap til 2500 kr per §11.
 *   - CRIT-3: Innsatsen-payout under cap → ingen trim.
 *   - CRIT-3: capped-payout reflekteres i amountCents og houseRetainedCents.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAccumulatingPots,
  type PotEvaluatorWinner,
} from "./PotEvaluator.js";
import type {
  Game1PotService,
  PotRow,
  TryWinResult,
} from "./Game1PotService.js";
import type {
  WalletAdapter,
  WalletTransaction,
} from "../../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  ComplianceLedgerEventInput,
  ComplianceLedgerPort,
} from "../../adapters/ComplianceLedgerPort.js";
import type {
  PrizePolicyApplyInput,
  PrizePolicyApplyResult,
  PrizePolicyPort,
} from "../../adapters/PrizePolicyPort.js";

// ── Stubs ──────────────────────────────────────────────────────────────────────

function makeFakePotService(opts: {
  pots: PotRow[];
  tryWinResult: TryWinResult;
}): Game1PotService {
  return {
    async listPotsForHall() {
      return opts.pots;
    },
    async tryWin(): Promise<TryWinResult> {
      return opts.tryWinResult;
    },
  } as unknown as Game1PotService;
}

function makeFakeWalletAdapter(): {
  adapter: WalletAdapter;
  credits: Array<{ amount: number; idempotencyKey?: string }>;
} {
  const credits: Array<{ amount: number; idempotencyKey?: string }> = [];
  const adapter = {
    async credit(
      _accountId: string,
      amount: number,
      _description: string,
      opts?: { idempotencyKey?: string },
    ): Promise<WalletTransaction> {
      credits.push({ amount, idempotencyKey: opts?.idempotencyKey });
      return {
        id: `tx-${credits.length}`,
        amount,
      } as unknown as WalletTransaction;
    },
  } as unknown as WalletAdapter;
  return { adapter, credits };
}

function makeRecordingLedgerPort(): {
  port: ComplianceLedgerPort;
  calls: ComplianceLedgerEventInput[];
} {
  const calls: ComplianceLedgerEventInput[] = [];
  return {
    port: {
      async recordComplianceLedgerEvent(input) {
        calls.push(input);
      },
    },
    calls,
  };
}

function makeThrowingLedgerPort(): ComplianceLedgerPort {
  return {
    async recordComplianceLedgerEvent() {
      throw new Error("simulated ledger outage");
    },
  };
}

function makeRecordingPolicyPort(
  cappedAmount?: number,
): {
  port: PrizePolicyPort;
  calls: PrizePolicyApplyInput[];
} {
  const calls: PrizePolicyApplyInput[] = [];
  return {
    port: {
      applySinglePrizeCap(input): PrizePolicyApplyResult {
        calls.push(input);
        const out = cappedAmount ?? input.amount;
        return {
          cappedAmount: out,
          wasCapped: out < input.amount,
          policyId: "test-policy",
        };
      },
    },
    calls,
  };
}

function makeJackpottPot(currentAmountCents: number): PotRow {
  return {
    id: "pot-jp-1",
    hallId: "hall-a",
    potKey: "jackpott",
    displayName: "Jackpott",
    currentAmountCents,
    config: {
      seedAmountCents: 200_000,
      dailyBoostCents: 400_000,
      salePercentBps: 0,
      maxAmountCents: null,
      winRule: {
        kind: "progressive_threshold",
        phase: 5,
        drawThreshold: 57,
        progressiveThresholds: [50, 55, 56, 57],
      },
      ticketColors: [],
      potType: "jackpott",
    },
    lastDailyBoostDate: null,
    lastResetAt: null,
    lastResetReason: null,
    createdAt: "2026-04-22T10:00:00Z",
    updatedAt: "2026-04-22T10:00:00Z",
  } as unknown as PotRow;
}

function defaultWinner(): PotEvaluatorWinner {
  return {
    assignmentId: "assign-1",
    walletId: "wallet-p1",
    userId: "user-p1",
    hallId: "hall-a",
    ticketColor: "yellow",
  };
}

const dummyClient = {} as never;

// ── Tests ──────────────────────────────────────────────────────────────────────

test("K2-A CRIT-2: pot-payout skriver EXTRA_PRIZE til ComplianceLedger med MAIN_GAME", async () => {
  const pot = makeJackpottPot(200_000);
  const service = makeFakePotService({
    pots: [pot],
    tryWinResult: {
      triggered: true,
      amountCents: 200_000, // 2000 kr
      reasonCode: null,
      eventId: "ev-1",
    },
  });
  const { adapter } = makeFakeWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  const { port: policyPort } = makeRecordingPolicyPort();

  await evaluateAccumulatingPots({
    client: dummyClient,
    potService: service,
    walletAdapter: adapter,
    hallId: "hall-a",
    scheduledGameId: "sg-1",
    drawSequenceAtWin: 57,
    firstWinner: defaultWinner(),
    audit,
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });

  assert.equal(ledgerCalls.length, 1, "én EXTRA_PRIZE-entry");
  const entry = ledgerCalls[0]!;
  assert.equal(entry.eventType, "EXTRA_PRIZE");
  assert.equal(entry.gameType, "MAIN_GAME", "Spill 1 = hovedspill (15%)");
  assert.equal(entry.channel, "INTERNET");
  assert.equal(entry.hallId, "hall-a");
  assert.equal(entry.amount, 2000); // 200000 øre = 2000 kr
  assert.equal(entry.playerId, "user-p1");
  assert.equal(entry.walletId, "wallet-p1");
  assert.equal(entry.gameId, "sg-1");
  const meta = entry.metadata!;
  assert.equal(meta.reason, "GAME1_POT_PAYOUT");
  assert.equal(meta.potType, "jackpott");
  assert.equal(meta.potKey, "jackpott");
});

test("K2-A CRIT-2: ledger-feil ruller IKKE tilbake pot-credit (soft-fail)", async () => {
  const pot = makeJackpottPot(200_000);
  const service = makeFakePotService({
    pots: [pot],
    tryWinResult: {
      triggered: true,
      amountCents: 200_000,
      reasonCode: null,
      eventId: "ev-1",
    },
  });
  const { adapter, credits } = makeFakeWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledgerPort = makeThrowingLedgerPort();
  const { port: policyPort } = makeRecordingPolicyPort();

  // Skal IKKE kaste — ledger-feil svelges (matcher Game1PayoutService-mønsteret).
  await evaluateAccumulatingPots({
    client: dummyClient,
    potService: service,
    walletAdapter: adapter,
    hallId: "hall-a",
    scheduledGameId: "sg-1",
    drawSequenceAtWin: 57,
    firstWinner: defaultWinner(),
    audit,
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });

  assert.equal(credits.length, 1, "wallet-credit ble fortsatt utført");
  assert.equal(credits[0]!.amount, 2000);
});

test("K2-A CRIT-3: Jackpott 30 000 kr → cap til 2500 kr per §11", async () => {
  const pot = makeJackpottPot(3_000_000); // 30 000 kr
  const service = makeFakePotService({
    pots: [pot],
    tryWinResult: {
      triggered: true,
      amountCents: 3_000_000, // 30 000 kr
      reasonCode: null,
      eventId: "ev-1",
    },
  });
  const { adapter, credits } = makeFakeWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  // Cap til 2500 kr.
  const { port: policyPort, calls: policyCalls } = makeRecordingPolicyPort(2500);

  const results = await evaluateAccumulatingPots({
    client: dummyClient,
    potService: service,
    walletAdapter: adapter,
    hallId: "hall-a",
    scheduledGameId: "sg-1",
    drawSequenceAtWin: 57,
    firstWinner: defaultWinner(),
    audit,
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });

  // Policy-port ble kalt med kroner.
  assert.equal(policyCalls.length, 1);
  assert.equal(policyCalls[0]!.amount, 30_000);

  // Wallet kreditert med capped (2500), IKKE 30 000.
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.amount, 2500);

  // Resultat reflekterer capped beløp + house-retained-differanse.
  assert.equal(results.length, 1);
  const res = results[0]!;
  assert.equal(res.triggered, true);
  assert.equal(res.amountCents, 250_000); // 2500 kr i øre
  assert.equal(res.potAmountGrossCents, 3_000_000);
  assert.equal(res.houseRetainedCents, 2_750_000); // 27 500 kr beholdt

  // Ledger-entry har capped beløp (faktisk utbetalt).
  assert.equal(ledgerCalls.length, 1);
  assert.equal(ledgerCalls[0]!.amount, 2500);
  const meta = ledgerCalls[0]!.metadata!;
  assert.equal(meta.payoutCents, 250_000);
  assert.equal(meta.houseRetainedCents, 2_750_000);
});

test("K2-A CRIT-3: pot under cap (1500 kr) → ingen trim", async () => {
  const pot = makeJackpottPot(150_000);
  const service = makeFakePotService({
    pots: [pot],
    tryWinResult: {
      triggered: true,
      amountCents: 150_000, // 1500 kr
      reasonCode: null,
      eventId: "ev-1",
    },
  });
  const { adapter, credits } = makeFakeWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  // Policy returnerer input uendret (under cap).
  const { port: policyPort } = makeRecordingPolicyPort();

  const results = await evaluateAccumulatingPots({
    client: dummyClient,
    potService: service,
    walletAdapter: adapter,
    hallId: "hall-a",
    scheduledGameId: "sg-1",
    drawSequenceAtWin: 57,
    firstWinner: defaultWinner(),
    audit,
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });

  // Full pot utbetalt — ingen cap-trimming.
  assert.equal(credits[0]!.amount, 1500);
  assert.equal(results[0]!.amountCents, 150_000);
  assert.equal(results[0]!.houseRetainedCents, 0);
  assert.equal(ledgerCalls[0]!.amount, 1500);
});

test("K2-A CRIT-2: pot ikke triggered → ingen ledger-entry, ingen wallet-credit", async () => {
  const pot = makeJackpottPot(100_000);
  const service = makeFakePotService({
    pots: [pot],
    tryWinResult: {
      triggered: false,
      amountCents: 0,
      reasonCode: "BELOW_TARGET",
      eventId: null,
    },
  });
  const { adapter, credits } = makeFakeWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const { port: ledgerPort, calls: ledgerCalls } = makeRecordingLedgerPort();
  const { port: policyPort } = makeRecordingPolicyPort();

  await evaluateAccumulatingPots({
    client: dummyClient,
    potService: service,
    walletAdapter: adapter,
    hallId: "hall-a",
    scheduledGameId: "sg-1",
    drawSequenceAtWin: 57,
    firstWinner: defaultWinner(),
    audit,
    complianceLedgerPort: ledgerPort,
    prizePolicyPort: policyPort,
  });

  assert.equal(credits.length, 0, "ingen credit når pot ikke trigget");
  assert.equal(ledgerCalls.length, 0, "ingen ledger-entry når pot ikke trigget");
});
