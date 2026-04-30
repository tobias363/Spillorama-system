/**
 * F2-A unit tests for PhasePayoutService — extracted cap-and-transfer flow.
 *
 * These tests pin the behavior the service inherited from BingoEngine.ts so
 * future refactors can't drift the cap chain or wallet-transfer ordering.
 *
 * Existing BingoEngine integration tests (BingoEngine.rtpCap.test.ts,
 * BingoEngine.phaseProgressionWithZeroBudget.test.ts, etc) still cover the
 * end-to-end behavior — these tests are unit-level for the service itself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { PhasePayoutService } from "../PhasePayoutService.js";
import { PrizePolicyManager } from "../PrizePolicyManager.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";

/**
 * Build a fresh PrizePolicyManager + 2500-cap default policy so the service
 * can resolve a policy for any hallId. Mirrors the `getDefaultPolicies()`
 * shape that BingoEngine wires in production hydrate-path.
 */
function makePolicyManager(): PrizePolicyManager {
  const mgr = new PrizePolicyManager({});
  mgr.hydrateFromSnapshot({
    prizePolicies: mgr.getDefaultPolicies().map((p) => mgr.toPersistedPrizePolicy(p)),
    extraPrizeEntries: [],
  });
  return mgr;
}

const HALL_ID = "hall-test";
const HOUSE_ACCOUNT = "house-test";
const PLAYER_WALLET = "wallet-test";
const PHASE_KEY = "phase-key-test";

async function setupWallet(seedHouseBalance: number): Promise<InMemoryWalletAdapter> {
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: HOUSE_ACCOUNT, initialBalance: seedHouseBalance });
  await wallet.createAccount({ accountId: PLAYER_WALLET, initialBalance: 0 });
  return wallet;
}

test("computeAndPayPhase pays full amount when caps not binding", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "percent", name: "1 Rad" },
    prizePerWinner: 200,
    remainingPrizePool: 1000,
    remainingPayoutBudget: 800,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "1 Rad prize",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 200);
  assert.equal(result.payoutSkipped, false);
  assert.equal(result.payoutSkippedReason, undefined);
  assert.equal(result.rtpCapped, false);
  assert.equal(result.requestedAfterPolicyAndPool, 200);
  assert.notEqual(result.walletTransfer, null);
  assert.equal(result.houseDeficit, 0);
});

test("computeAndPayPhase skips with budget-exhausted when remainingPayoutBudget=0", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "percent", name: "Phase" },
    prizePerWinner: 100,
    remainingPrizePool: 1000,
    remainingPayoutBudget: 0,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 0);
  assert.equal(result.payoutSkipped, true);
  assert.equal(result.payoutSkippedReason, "budget-exhausted");
  assert.equal(result.rtpCapped, true, "rtpCapped should fire when payout < requestedAfterPolicyAndPool");
  assert.equal(result.walletTransfer, null, "no wallet transfer when payout=0");
});

test("computeAndPayPhase skips with house-balance-low when budget OK but house empty", async () => {
  const wallet = await setupWallet(0);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "Phase" },
    prizePerWinner: 50,
    remainingPrizePool: 1000,
    remainingPayoutBudget: 800,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 0);
  assert.equal(result.payoutSkipped, true);
  assert.equal(
    result.payoutSkippedReason,
    "house-balance-low",
    "budgetCappedPayout > 0 but houseAvailableBalance=0 → house-balance-low",
  );
  assert.equal(result.walletTransfer, null);
});

test("computeAndPayPhase caps to remainingPayoutBudget for variable patterns", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  // Variable: face=200, but remainingPayoutBudget=80 → payout should cap to 80.
  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "percent", name: "VarPhase" },
    prizePerWinner: 200,
    remainingPrizePool: 200,
    remainingPayoutBudget: 80,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 80);
  assert.equal(result.rtpCapped, true);
  assert.equal(result.payoutSkipped, false);
  assert.equal(result.requestedAfterPolicyAndPool, 200, "pool=200 ≥ 200 so requestedAfterPolicyAndPool=200");
  assert.equal(result.houseDeficit, 0, "variable patterns never have house-deficit");
});

test("computeAndPayPhase fixed-prize bypasses pool-cap but obeys RTP-budget", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  // Fixed face=100, pool=20 (drained), budget=80. Pool-cap is bypassed for
  // fixed but RTP-budget cap is regulatorisk absolute — payout=80.
  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "1 Rad" },
    prizePerWinner: 100,
    remainingPrizePool: 20,
    remainingPayoutBudget: 80,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 80, "RTP-budget cap fires even for fixed prizes");
  assert.equal(result.rtpCapped, true);
  // House-deficit = payout - pool = 80 - 20 = 60 (fixed-prize hus-garanti).
  assert.equal(result.houseDeficit, 60);
  assert.equal(result.requestedAfterPolicyAndPool, 100, "fixed bypasses pool, so requested=100");
});

test("computeAndPayPhase test-hall RTP-bypass pays face value when env-flag is true", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const previous = process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP;
  process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP = "true";

  try {
    // Variable: face=200, budget=50, pool=200, isTestHall=true → bypass
    // RTP cap and pay face=200 (still capped against single-prize-cap and
    // house-balance, both of which are non-binding here).
    const result = await service.computeAndPayPhase({
      hallId: HALL_ID,
      roomCode: "ROOM",
      gameId: "game-1",
      isTestHall: true,
      pattern: { winningType: "percent", name: "Phase" },
      prizePerWinner: 200,
      remainingPrizePool: 200,
      remainingPayoutBudget: 50,
      houseAccountId: HOUSE_ACCOUNT,
      walletId: PLAYER_WALLET,
      transferMemo: "p",
      idempotencyKey: PHASE_KEY,
      phase: "PHASE",
    });

    assert.equal(result.payout, 200);
    assert.equal(result.rtpCapped, false);
  } finally {
    if (previous === undefined) {
      delete process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP;
    } else {
      process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP = previous;
    }
  }
});

test("computeAndPayPhase test-hall RTP-bypass disabled when env-flag='false'", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const previous = process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP;
  process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP = "false";

  try {
    // Same input as previous test; but with bypass disabled, RTP-cap fires.
    const result = await service.computeAndPayPhase({
      hallId: HALL_ID,
      roomCode: "ROOM",
      gameId: "game-1",
      isTestHall: true,
      pattern: { winningType: "percent", name: "Phase" },
      prizePerWinner: 200,
      remainingPrizePool: 200,
      remainingPayoutBudget: 50,
      houseAccountId: HOUSE_ACCOUNT,
      walletId: PLAYER_WALLET,
      transferMemo: "p",
      idempotencyKey: PHASE_KEY,
      phase: "PHASE",
    });

    assert.equal(result.payout, 50);
    assert.equal(result.rtpCapped, true);
  } finally {
    if (previous === undefined) {
      delete process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP;
    } else {
      process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP = previous;
    }
  }
});

test("computeAndPayPhase passes idempotency-key + winnings target-side to wallet", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  let observedIdempotencyKey: string | undefined;
  let observedTargetSide: string | undefined;

  // Wrap transfer to capture the options passed.
  const originalTransfer = wallet.transfer.bind(wallet);
  wallet.transfer = async (from, to, amount, reason, options) => {
    observedIdempotencyKey = options?.idempotencyKey;
    observedTargetSide = options?.targetSide;
    return originalTransfer(from, to, amount, reason, options);
  };

  await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "percent", name: "Phase" },
    prizePerWinner: 50,
    remainingPrizePool: 1000,
    remainingPayoutBudget: 800,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: "custom-key-abc",
    phase: "PHASE",
  });

  assert.equal(observedIdempotencyKey, "custom-key-abc");
  assert.equal(observedTargetSide, "winnings");
});

test("computeAndPayPhase house-balance lookup failure degrades to +Infinity (best-effort)", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  // Force getAvailableBalance/getBalance to throw — service should swallow
  // and continue with houseAvailableBalance = +Infinity. The transfer
  // itself still succeeds because the house has 10_000 in the in-memory
  // adapter.
  //
  // `getAvailableBalance` is optional on the WalletAdapter interface, so
  // assign through `as unknown` to attach it to the in-memory mock.
  (wallet as unknown as { getAvailableBalance: () => Promise<number> }).getAvailableBalance = async () => {
    throw new Error("transient");
  };
  wallet.getBalance = async () => {
    throw new Error("transient");
  };

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "percent", name: "Phase" },
    prizePerWinner: 100,
    remainingPrizePool: 1000,
    remainingPayoutBudget: 800,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 100);
  assert.equal(result.payoutSkipped, false);
  assert.equal(
    result.houseAvailableBalance,
    Number.POSITIVE_INFINITY,
    "lookup failure → +Infinity (defensive)",
  );
});

test("computeAndPayPhase wallet-transfer error propagates (no internal swallow)", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  wallet.transfer = async () => {
    throw new Error("wallet-down");
  };

  await assert.rejects(
    () =>
      service.computeAndPayPhase({
        hallId: HALL_ID,
        roomCode: "ROOM",
        gameId: "game-1",
        isTestHall: false,
        pattern: { winningType: "percent", name: "Phase" },
        prizePerWinner: 100,
        remainingPrizePool: 1000,
        remainingPayoutBudget: 800,
        houseAccountId: HOUSE_ACCOUNT,
        walletId: PLAYER_WALLET,
        transferMemo: "p",
        idempotencyKey: PHASE_KEY,
        phase: "PHASE",
      }),
    /wallet-down/,
  );
});

test("computeAndPayPhase respects single-prize-cap (2500 kr §11)", async () => {
  const wallet = await setupWallet(100_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  // Face=10000 but single-prize-cap is 2500 by default. Pool/budget are
  // both 100k so neither binds.
  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "Big Prize" },
    prizePerWinner: 10_000,
    remainingPrizePool: 100_000,
    remainingPayoutBudget: 100_000,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 2500);
  assert.equal(result.requestedAfterPolicyAndPool, 2500);
  assert.equal(result.rtpCapped, false, "rtpCapped only fires when payout<requestedAfterPolicyAndPool");
});

test("computeAndPayPhase rtpBudgetBefore mirrors input (rounded, clamped to 0)", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "percent", name: "Phase" },
    prizePerWinner: 50,
    remainingPrizePool: 1000,
    remainingPayoutBudget: 123.456,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  // roundCurrency rounds to 2 decimals.
  assert.equal(result.rtpBudgetBefore, 123.46);
});

test("computeAndPayPhase prizePerWinner=0 → payout=0 + payoutSkipped=false (legitimate zero-prize phase)", async () => {
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  // mode:percent + zero pool/percent → prizePerWinner=0 is legitimate.
  // requestedAfterPolicyAndPool=0 → payoutWasSkipped=false (NOT a skip).
  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "percent", name: "ZeroPhase" },
    prizePerWinner: 0,
    remainingPrizePool: 0,
    remainingPayoutBudget: 800,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 0);
  assert.equal(result.payoutSkipped, false);
  assert.equal(result.payoutSkippedReason, undefined);
  assert.equal(result.walletTransfer, null);
});

// ── HV-2 hall-default floor + house pre-fund gap ────────────────────────────
//
// Tobias 2026-04-30 (HV2_BIR036_SPEC §2): Spill 1 garanterer per-fase-floor
// uavhengig av buy-in-pool. Når pool/budget < floor og huset har balanse,
// finansierer huset differansen og marker `houseFundedGap=true`. Når huset
// ikke har balanse, fail-closed med `house-floor-underfunded` som
// compliance-incident.

test("HV-2: pool dekker floor → behold cap-logikk (ingen pre-fund)", async () => {
  // Floor=100, pool=200, budget=800 → ingen guarantee, payout=100.
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "1 Rad", minPrize: 100 },
    prizePerWinner: 100,
    remainingPrizePool: 200,
    remainingPayoutBudget: 800,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 100);
  assert.equal(result.houseFundedGap, false, "floor allerede dekket av pool/budget");
  assert.equal(result.houseFundedGapAmount, 0);
  assert.equal(result.payoutSkipped, false);
});

test("HV-2: pool < floor + house har balanse → bypass RTP-cap, betal floor", async () => {
  // Floor=100, pool=20, budget=20, house=10000 → pool/budget < floor, men
  // huset har 10k → bypass RTP-cap, payout=100, houseFundedGapAmount=80.
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "1 Rad", minPrize: 100 },
    prizePerWinner: 100,
    remainingPrizePool: 20,
    remainingPayoutBudget: 20,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 100, "house pre-fund kicks in → floor utbetalt fullt");
  assert.equal(result.houseFundedGap, true, "RTP-cap bypassed via hall-floor-guarantee");
  // Gap-amount = floor - budgetCappedPayoutPreHallFloor (20) = 80.
  assert.equal(result.houseFundedGapAmount, 80);
  assert.equal(result.payoutSkipped, false);
  assert.notEqual(result.walletTransfer, null);
});

test("HV-2: pool < floor + house tom → fail-closed (house-floor-underfunded)", async () => {
  // Floor=100, pool=20, budget=20, house=50 (< 100). Compliance-incident:
  // payout=0, ingen wallet-transfer. Caller må surface alert.
  const wallet = await setupWallet(50);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "1 Rad", minPrize: 100 },
    prizePerWinner: 100,
    remainingPrizePool: 20,
    remainingPayoutBudget: 20,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 0, "fail-closed: ingen utbetaling når huset tomt");
  assert.equal(result.houseFundedGap, false, "guarantee aktiverte ikke (huset for lav)");
  assert.equal(result.houseFundedGapAmount, 0);
  assert.equal(result.payoutSkipped, true);
  assert.equal(
    result.payoutSkippedReason,
    "house-floor-underfunded",
    "ny compliance-incident-grunn for fail-closed pre-fund-gap",
  );
  assert.equal(result.walletTransfer, null);
});

test("HV-2: Demo Hall (isTestHall=true + bypass=true) — floor-overlay irrelevant, fortsatt full payout", async () => {
  // Demo-hall RTP-bypass aktivert → payout = full requestedAfterPolicyAndPool
  // uansett floor. houseFundedGap skal IKKE settes selv om floor er angitt.
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const previous = process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP;
  process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP = "true";

  try {
    const result = await service.computeAndPayPhase({
      hallId: HALL_ID,
      roomCode: "ROOM",
      gameId: "game-1",
      isTestHall: true,
      pattern: { winningType: "fixed", name: "1 Rad", minPrize: 100 },
      prizePerWinner: 200,
      remainingPrizePool: 50,
      remainingPayoutBudget: 50,
      houseAccountId: HOUSE_ACCOUNT,
      walletId: PLAYER_WALLET,
      transferMemo: "p",
      idempotencyKey: PHASE_KEY,
      phase: "PHASE",
    });

    assert.equal(result.payout, 200, "test-hall bypass → face value uendret av floor");
    assert.equal(
      result.houseFundedGap,
      false,
      "HV-2 hall-floor-overlay aktiveres IKKE for test-haller (bypass dekker)",
    );
    assert.equal(result.houseFundedGapAmount, 0);
  } finally {
    if (previous === undefined) {
      delete process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP;
    } else {
      process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP = previous;
    }
  }
});

test("HV-2: multi-phase — Rad 1 finansiert av pool, Rad 2 (større pool) går normalt", async () => {
  // Simulerer to faser i sekvens:
  //   Rad 1: pool=20, budget=20, floor=100 → pre-fund triggers, payout=100, gap=80
  //   Rad 2: pool=500 (større buy-in-runde), budget=500, floor=200 → pool dekker
  //          floor → ingen pre-fund, payout=200.
  // Hver fase kjøres som separat call (caller dekreementerer pool/budget mellom).
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const phase1 = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-multi",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "1 Rad", minPrize: 100 },
    prizePerWinner: 100,
    remainingPrizePool: 20,
    remainingPayoutBudget: 20,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p1",
    idempotencyKey: "phase-1-key",
    phase: "PHASE",
  });

  assert.equal(phase1.payout, 100);
  assert.equal(phase1.houseFundedGap, true);
  assert.equal(phase1.houseFundedGapAmount, 80);

  const phase2 = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-multi",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "2 Rader", minPrize: 200 },
    prizePerWinner: 200,
    remainingPrizePool: 500,
    remainingPayoutBudget: 500,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p2",
    idempotencyKey: "phase-2-key",
    phase: "PHASE",
  });

  assert.equal(phase2.payout, 200);
  assert.equal(phase2.houseFundedGap, false, "floor allerede dekket av pool");
  assert.equal(phase2.houseFundedGapAmount, 0);
});

test("HV-2: minPrize=undefined eller 0 → pre-HV-2-atferd uendret", async () => {
  // Uten minPrize-floor: dagens cap-logikk. payout=80 (RTP-budget cap)
  // og rtpCapped=true. houseFundedGap=false.
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "1 Rad" /* ingen minPrize */ },
    prizePerWinner: 100,
    remainingPrizePool: 20,
    remainingPayoutBudget: 80,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 80, "RTP-budget cap fortsatt aktiv uten floor");
  assert.equal(result.rtpCapped, true);
  assert.equal(result.houseFundedGap, false);
  assert.equal(result.houseFundedGapAmount, 0);
  // Klassisk fixed-prize hus-deficit (payout > pool=20) — uendret oppførsel.
  assert.equal(result.houseDeficit, 60);
});

test("HV-2: minPrize=0 eksplisitt → pre-HV-2-atferd uendret", async () => {
  // Eksplisitt minPrize=0 skal ikke aktivere floor-guarantee.
  const wallet = await setupWallet(10_000);
  const policy = makePolicyManager();
  const service = new PhasePayoutService(wallet, policy);

  const result = await service.computeAndPayPhase({
    hallId: HALL_ID,
    roomCode: "ROOM",
    gameId: "game-1",
    isTestHall: false,
    pattern: { winningType: "fixed", name: "1 Rad", minPrize: 0 },
    prizePerWinner: 100,
    remainingPrizePool: 20,
    remainingPayoutBudget: 80,
    houseAccountId: HOUSE_ACCOUNT,
    walletId: PLAYER_WALLET,
    transferMemo: "p",
    idempotencyKey: PHASE_KEY,
    phase: "PHASE",
  });

  assert.equal(result.payout, 80);
  assert.equal(result.houseFundedGap, false);
  assert.equal(result.houseFundedGapAmount, 0);
});
