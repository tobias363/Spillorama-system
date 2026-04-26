import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { BingoSystemAdapter, CheckpointInput, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import {
  type CreateWalletAccountInput,
  type WalletAccount,
  type WalletAccountSide,
  type WalletAdapter,
  type WalletTransaction,
  type WalletTransactionSplit,
  type TransferOptions,
  WalletError,
  type WalletTransferResult
} from "../adapters/WalletAdapter.js";
import type { ClaimRecord, Ticket } from "./types.js";
import { BingoEngine, DomainError } from "./BingoEngine.js";

export class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private readonly transactions: WalletTransaction[] = [];
  private txCounter = 0;

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const initialBalance = Number(input?.initialBalance ?? 0);
    const allowExisting = Boolean(input?.allowExisting);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new WalletError("INVALID_AMOUNT", "initialBalance må være 0 eller større.");
    }

    const existing = this.accounts.get(accountId);
    if (existing) {
      if (!allowExisting) {
        throw new WalletError("ACCOUNT_EXISTS", "Konto finnes allerede.");
      }
      return this.cloneAccount(existing);
    }

    const now = new Date().toISOString();
    const account: WalletAccount = {
      id: accountId,
      balance: initialBalance,
      depositBalance: initialBalance,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now
    };
    this.accounts.set(accountId, account);
    return this.cloneAccount(account);
  }

  async getDepositBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).depositBalance;
  }
  async getWinningsBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).winningsBalance;
  }
  async getBothBalances(accountId: string): Promise<{ deposit: number; winnings: number; total: number }> {
    const a = await this.getAccount(accountId);
    return { deposit: a.depositBalance, winnings: a.winningsBalance, total: a.balance };
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const normalized = accountId.trim();
    if (!normalized) {
      throw new WalletError("INVALID_ACCOUNT_ID", "accountId mangler.");
    }
    if (this.accounts.has(normalized)) {
      return this.getAccount(normalized);
    }
    return this.createAccount({
      accountId: normalized,
      initialBalance: 1000,
      allowExisting: true
    });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const normalized = accountId.trim();
    const account = this.accounts.get(normalized);
    if (!account) {
      throw new WalletError("ACCOUNT_NOT_FOUND", "Konto finnes ikke.");
    }
    return this.cloneAccount(account);
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return [...this.accounts.values()].map((account) => this.cloneAccount(account));
  }

  async getBalance(accountId: string): Promise<number> {
    const account = await this.getAccount(accountId);
    return account.balance;
  }

  async debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, -Math.abs(amount), "DEBIT", reason);
  }

  async credit(accountId: string, amount: number, reason: string, _options?: { idempotencyKey?: string; to?: "deposit" | "winnings" }): Promise<WalletTransaction> {
    // PR-W1: `to`-parameter ignoreres i denne test-mocken (hele saldo holdes i
    // deposit-feltet). BingoEngine test-dekning trenger ikke split-oppførsel.
    return this.adjustBalance(accountId, Math.abs(amount), "CREDIT", reason);
  }

  /**
   * CRIT-5 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): test-mock for
   * tx-aware credit. InMemory har ingen reelle tx-grenser, så vi bare
   * delegerer til `credit`. Client-parameteren ignoreres.
   */
  async creditWithClient(
    accountId: string,
    amount: number,
    reason: string,
    options: { client: unknown; idempotencyKey?: string; to?: "deposit" | "winnings" },
  ): Promise<WalletTransaction> {
    return this.credit(accountId, amount, reason, options);
  }

  async topUp(accountId: string, amount: number, reason = "Top-up"): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, Math.abs(amount), "TOPUP", reason);
  }

  async withdraw(accountId: string, amount: number, reason = "Withdrawal"): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, -Math.abs(amount), "WITHDRAWAL", reason);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Transfer",
    options?: TransferOptions
  ): Promise<WalletTransferResult> {
    const normalizedAmount = Math.abs(amount);
    // PR-W4: winnings-first debit-split på avsender (som Postgres/InMemory-
    // adapter ellers gjør). Vi beregner split FØR adjustBalance slik at
    // TRANSFER_OUT får korrekt split-metadata — viktig for loss-limit-fix.
    const fromAccount = await this.ensureAccount(fromAccountId.trim());
    const fromSplit = this.splitDebit(fromAccount, normalizedAmount);
    const fromTx = await this.adjustBalance(
      fromAccountId,
      -normalizedAmount,
      "TRANSFER_OUT",
      reason,
      toAccountId,
      { fromDeposit: fromSplit.fromDeposit, fromWinnings: fromSplit.fromWinnings },
      options?.targetSide
    );
    const toTx = await this.adjustBalance(
      toAccountId,
      normalizedAmount,
      "TRANSFER_IN",
      reason,
      fromAccountId,
      // Mottaker-side: bruk targetSide (default deposit — W3-semantikk).
      options?.targetSide === "winnings"
        ? { fromDeposit: 0, fromWinnings: normalizedAmount }
        : { fromDeposit: normalizedAmount, fromWinnings: 0 },
      options?.targetSide
    );
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    return this.transactions
      .filter((tx) => tx.accountId === accountId.trim())
      .slice(-Math.max(0, limit))
      .map((tx) => ({ ...tx }));
  }

  /**
   * PR-W4: winnings-first-split for debit/transfer-avsender. Matcher
   * PostgresWalletAdapter-semantikken. Brukes for å fylle `WalletTransaction.split`
   * så loss-limit-logikken i BingoEngine kan identifisere deposit-delen.
   */
  private splitDebit(account: WalletAccount, amount: number): WalletTransactionSplit {
    const fromWinnings = Math.min(account.winningsBalance ?? 0, amount);
    const fromDeposit = amount - fromWinnings;
    return { fromWinnings, fromDeposit };
  }

  private async adjustBalance(
    accountId: string,
    delta: number,
    type: WalletTransaction["type"],
    reason: string,
    relatedAccountId?: string,
    split?: WalletTransactionSplit,
    targetSide?: WalletAccountSide
  ): Promise<WalletTransaction> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      throw new WalletError("INVALID_ACCOUNT_ID", "accountId mangler.");
    }
    if (!Number.isFinite(delta) || delta === 0) {
      throw new WalletError("INVALID_AMOUNT", "amount må være større enn 0.");
    }

    const account = await this.ensureAccount(normalizedAccountId);
    const nextBalance = account.balance + delta;
    if (nextBalance < 0) {
      throw new WalletError("INSUFFICIENT_FUNDS", "Ikke nok saldo.");
    }

    // PR-W4: oppdater deposit/winnings-kolonner korrekt slik at split-aware tester
    // kan verifisere post-kjøps-saldo. `delta < 0` er en debit/transfer-out —
    // trekk split fra deposit/winnings. `delta > 0` er credit/transfer-in —
    // målkonto via targetSide (default deposit).
    let nextDeposit = account.depositBalance ?? nextBalance;
    let nextWinnings = account.winningsBalance ?? 0;
    if (delta < 0 && split) {
      nextDeposit = Math.max(0, nextDeposit - split.fromDeposit);
      nextWinnings = Math.max(0, nextWinnings - split.fromWinnings);
    } else if (delta > 0) {
      const absDelta = Math.abs(delta);
      if (targetSide === "winnings") {
        nextWinnings += absDelta;
      } else {
        nextDeposit += absDelta;
      }
    } else if (delta < 0) {
      // Debit uten split (legacy-path) — trekk alt fra deposit for bakoverkompat.
      nextDeposit = Math.max(0, nextDeposit + delta);
    }

    const updated: WalletAccount = {
      ...account,
      balance: nextDeposit + nextWinnings,
      depositBalance: nextDeposit,
      winningsBalance: nextWinnings,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedAccountId, updated);

    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`,
      accountId: normalizedAccountId,
      type,
      amount: Math.abs(delta),
      reason,
      createdAt: new Date().toISOString(),
      relatedAccountId,
      split
    };
    this.transactions.push(tx);
    return { ...tx };
  }

  private cloneAccount(account: WalletAccount): WalletAccount {
    return { ...account };
  }
}

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53]
      ]
    };
  }
}

async function makeEngineWithRoom(): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostPlayerId: string;
}> {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });
  return {
    engine,
    roomCode,
    hostPlayerId: playerId
  };
}

async function createRoomWithTwoPlayers(input: {
  engine: BingoEngine;
  hallId: string;
  hostName: string;
  hostWalletId: string;
  guestName: string;
  guestWalletId: string;
}): Promise<{ roomCode: string; hostPlayerId: string }> {
  const { roomCode, playerId } = await input.engine.createRoom({
    hallId: input.hallId,
    playerName: input.hostName,
    walletId: input.hostWalletId
  });
  await input.engine.joinRoom({
    roomCode,
    hallId: input.hallId,
    playerName: input.guestName,
    walletId: input.guestWalletId
  });
  return {
    roomCode,
    hostPlayerId: playerId
  };
}

function prioritizeDrawNumbers(
  engine: BingoEngine,
  roomCode: string,
  preferredNumbers: readonly number[]
): void {
  const internalRoomState = (
    engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }
  ).rooms.get(roomCode);
  const drawBag = internalRoomState?.currentGame?.drawBag;
  if (!drawBag || drawBag.length === 0) {
    return;
  }

  const prioritized = preferredNumbers.filter((value) => drawBag.includes(value));
  if (prioritized.length === 0) {
    return;
  }

  const remainder = drawBag.filter((value) => !prioritized.includes(value));
  internalRoomState!.currentGame!.drawBag = [...prioritized, ...remainder];
}

test("startGame rejects ticketsPerPlayer below 1", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await assert.rejects(
    async () => engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 0, payoutPercent: 80 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TICKETS_PER_PLAYER"
  );
});

test("startGame rejects ticketsPerPlayer above 30", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await assert.rejects(
    async () => engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 31, payoutPercent: 80 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TICKETS_PER_PLAYER"
  );
});

test("startGame accepts ticketsPerPlayer equal to 1", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 1, payoutPercent: 80 });
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.ticketsPerPlayer, 1);
});

test("startGame accepts ticketsPerPlayer equal to 30", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 30, payoutPercent: 80 });
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.ticketsPerPlayer, 30);
});

test("startGame rejects payoutPercent outside 0-100", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await assert.rejects(
    async () => engine.startGame({ roomCode, actorPlayerId: hostPlayerId, payoutPercent: -1 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_PAYOUT_PERCENT"
  );
  await assert.rejects(
    async () => engine.startGame({ roomCode, actorPlayerId: hostPlayerId, payoutPercent: 101 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_PAYOUT_PERCENT"
  );
});

test("rtp payout budget caps total payouts across line and bingo claims", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
    dailyLossLimit: 10000,
    monthlyLossLimit: 10000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0
  });

  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 50,
    // Explicit patterns so test is self-documenting about payout percentages
    patterns: [
      { id: "1-rad", name: "1 Rad", claimType: "LINE" as const, prizePercent: 30, order: 1, design: 1 },
      { id: "full-plate", name: "Full Plate", claimType: "BINGO" as const, prizePercent: 70, order: 2, design: 2 },
    ]
  });

  const lineNumbers = new Set([1, 2, 3, 4, 5]);
  const bingoNumbers = new Set([
    1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 25, 26, 27, 28, 37, 38, 39, 40, 41, 49, 50, 51, 52, 53
  ]);
  prioritizeDrawNumbers(engine, roomCode, [...bingoNumbers]);

  let drawGuard = 0;
  while (lineNumbers.size > 0 && drawGuard < 60) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostPlayerId
    });
    if (!bingoNumbers.has(number)) {
      drawGuard += 1;
      continue;
    }
    await engine.markNumber({
      roomCode,
      playerId: hostPlayerId,
      number
    });
    lineNumbers.delete(number);
    bingoNumbers.delete(number);
    drawGuard += 1;
  }
  assert.equal(lineNumbers.size, 0);

  const lineClaim = await engine.submitClaim({
    roomCode,
    playerId: hostPlayerId,
    type: "LINE"
  });
  assert.equal(lineClaim.valid, true);
  assert.equal(lineClaim.winningPatternIndex, 0);
  assert.equal(lineClaim.patternIndex, 0);
  assert.equal(lineClaim.bonusTriggered, false);
  assert.equal(lineClaim.bonusAmount, undefined);
  assert.equal(lineClaim.payoutAmount, 60); // 30% of prizePool 200
  assert.equal(lineClaim.payoutWasCapped, false);
  assert.equal(lineClaim.rtpBudgetBefore, 100);
  assert.equal(lineClaim.rtpBudgetAfter, 40);
  assert.equal(lineClaim.rtpCapped, false);

  while (bingoNumbers.size > 0 && drawGuard < 150) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostPlayerId
    });
    if (!bingoNumbers.has(number)) {
      drawGuard += 1;
      continue;
    }
    await engine.markNumber({
      roomCode,
      playerId: hostPlayerId,
      number
    });
    bingoNumbers.delete(number);
    drawGuard += 1;
  }
  assert.equal(bingoNumbers.size, 0);

  const bingoClaim = await engine.submitClaim({
    roomCode,
    playerId: hostPlayerId,
    type: "BINGO"
  });
  assert.equal(bingoClaim.valid, true);
  assert.equal(bingoClaim.payoutAmount, 40);
  assert.equal(bingoClaim.payoutWasCapped, true);
  assert.equal(bingoClaim.rtpBudgetBefore, 40);
  assert.equal(bingoClaim.rtpBudgetAfter, 0);
  assert.equal(bingoClaim.rtpCapped, true);

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.payoutPercent, 50);
  assert.equal(snapshot.currentGame?.maxPayoutBudget, 100);
  assert.equal(snapshot.currentGame?.remainingPayoutBudget, 0);
  assert.equal((lineClaim.payoutAmount ?? 0) + (bingoClaim.payoutAmount ?? 0), 100);
});

test("line claim includes deterministic backend bonus contract fields in claim and snapshot", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0
  });
  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 80
  });

  const secondRow = new Set([13, 14, 15, 16, 17]);
  prioritizeDrawNumbers(engine, roomCode, [...secondRow]);
  let drawGuard = 0;
  while (secondRow.size > 0 && drawGuard < 60) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostPlayerId
    });
    if (!secondRow.has(number)) {
      drawGuard += 1;
      continue;
    }
    await engine.markNumber({
      roomCode,
      playerId: hostPlayerId,
      number
    });
    secondRow.delete(number);
    drawGuard += 1;
  }
  assert.equal(secondRow.size, 0);

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostPlayerId,
    type: "LINE"
  });
  assert.equal(claim.valid, true);
  assert.equal(claim.winningPatternIndex, 1);
  assert.equal(claim.patternIndex, 1);
  assert.equal(claim.bonusTriggered, true);
  assert.equal(claim.bonusAmount, claim.payoutAmount);

  const snapshot = engine.getRoomSnapshot(roomCode);
  const claimFromSnapshot = snapshot.currentGame?.claims.find((entry) => entry.id === claim.id);
  assert.ok(claimFromSnapshot);
  assert.equal(claimFromSnapshot?.winningPatternIndex, 1);
  assert.equal(claimFromSnapshot?.patternIndex, 1);
  assert.equal(claimFromSnapshot?.bonusTriggered, true);
  assert.equal(claimFromSnapshot?.bonusAmount, claim.payoutAmount);
});

test("round ends automatically when max draws is reached", async () => {
  const limitedEngine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    maxDrawsPerRound: 3,
    minDrawIntervalMs: 0
  });
  const { roomCode: limitedRoomCode, playerId: limitedHostPlayerId } = await limitedEngine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await limitedEngine.joinRoom({
    roomCode: limitedRoomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });

  await limitedEngine.startGame({
    roomCode: limitedRoomCode,
    actorPlayerId: limitedHostPlayerId,
    ticketsPerPlayer: 1,
    payoutPercent: 80
  });

  await limitedEngine.drawNextNumber({ roomCode: limitedRoomCode, actorPlayerId: limitedHostPlayerId });
  await limitedEngine.drawNextNumber({ roomCode: limitedRoomCode, actorPlayerId: limitedHostPlayerId });
  const thirdDraw = await limitedEngine.drawNextNumber({
    roomCode: limitedRoomCode,
    actorPlayerId: limitedHostPlayerId
  });
  assert.ok(Number.isFinite(thirdDraw.number));

  const snapshotAfterThirdDraw = limitedEngine.getRoomSnapshot(limitedRoomCode);
  assert.equal(snapshotAfterThirdDraw.currentGame?.drawnNumbers.length, 3);
  assert.equal(snapshotAfterThirdDraw.currentGame?.status, "ENDED");
  assert.equal(snapshotAfterThirdDraw.currentGame?.endedReason, "MAX_DRAWS_REACHED");

  await assert.rejects(
    async () =>
      limitedEngine.drawNextNumber({
        roomCode: limitedRoomCode,
        actorPlayerId: limitedHostPlayerId
      }),
    (error: unknown) => error instanceof DomainError && error.code === "GAME_NOT_RUNNING"
  );
});

test("BIN-520: engine allows all 75 draws when maxDrawsPerRound=75 (databingo75)", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    maxDrawsPerRound: 75,
    minDrawIntervalMs: 0,
  });
  // gameSlug "bingo" is a 75-ball variant (BINGO75_SLUGS) — required so the
  // engine seeds the draw bag with 75 balls, not 60.
  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
    gameSlug: "bingo",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-1", playerName: "Guest", walletId: "wallet-guest" });
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 1, payoutPercent: 80 });

  // Drain the whole bag — all 75 draws must succeed with no early NO_MORE_NUMBERS.
  for (let i = 1; i <= 75; i += 1) {
    const result = await engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId });
    assert.ok(Number.isFinite(result.number), `draw #${i} must return a finite number`);
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.drawnNumbers.length, 75, "all 75 numbers must be drawn");
  assert.equal(snapshot.currentGame?.status, "ENDED", "game ends exactly at 75 (not before)");
  assert.equal(snapshot.currentGame?.endedReason, "MAX_DRAWS_REACHED");

  // 76th draw must reject cleanly, not silently drop.
  await assert.rejects(
    async () => engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_RUNNING",
    "draw #76 must reject because the game already ended at the 75-cap",
  );
});

test("BIN-520: envConfig clamp — BINGO_MAX_DRAWS_PER_ROUND=75 is preserved (not capped at 60)", async () => {
  // Spawn loadBingoRuntimeConfig via a fresh dynamic import so the env mutation
  // is scoped to this test. Other tests may already have cached an import; that
  // is fine — loadBingoRuntimeConfig reads process.env each call.
  const originalMax = process.env.BINGO_MAX_DRAWS_PER_ROUND;
  process.env.BINGO_MAX_DRAWS_PER_ROUND = "75";
  try {
    const { loadBingoRuntimeConfig } = await import("../util/envConfig.js");
    const cfg = loadBingoRuntimeConfig();
    assert.equal(cfg.bingoMaxDrawsPerRound, 75, "clamp upper bound is 75, not 60");
  } finally {
    if (originalMax === undefined) delete process.env.BINGO_MAX_DRAWS_PER_ROUND;
    else process.env.BINGO_MAX_DRAWS_PER_ROUND = originalMax;
  }
});

test("BIN-520: envConfig clamp — values above 75 are still capped at 75", async () => {
  const originalMax = process.env.BINGO_MAX_DRAWS_PER_ROUND;
  process.env.BINGO_MAX_DRAWS_PER_ROUND = "999";
  try {
    const { loadBingoRuntimeConfig } = await import("../util/envConfig.js");
    const cfg = loadBingoRuntimeConfig();
    assert.equal(cfg.bingoMaxDrawsPerRound, 75, "out-of-range values must clamp to 75");
  } finally {
    if (originalMax === undefined) delete process.env.BINGO_MAX_DRAWS_PER_ROUND;
    else process.env.BINGO_MAX_DRAWS_PER_ROUND = originalMax;
  }
});

test("joinRoom rejects duplicate wallet in same room", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());
  const { roomCode } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });

  await assert.rejects(
    async () =>
      engine.joinRoom({
        roomCode,
        hallId: "hall-1",
        playerName: "Host Duplicate",
        walletId: "wallet-host"
      }),
    (error: unknown) => error instanceof DomainError && error.code === "PLAYER_ALREADY_IN_ROOM"
  );
});

test("createRoom rejects wallet already in running game", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 1, payoutPercent: 80 });

  await assert.rejects(
    async () =>
      engine.createRoom({
        hallId: "hall-2",
        playerName: "Guest Again",
        walletId: "wallet-guest"
      }),
    (error: unknown) => error instanceof DomainError && error.code === "PLAYER_ALREADY_IN_RUNNING_GAME"
  );
});

test("joinRoom rejects wallet already in running game in another room", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 1, payoutPercent: 80 });

  const { roomCode: secondRoomCode } = await engine.createRoom({
    hallId: "hall-2",
    playerName: "Second Host",
    walletId: "wallet-second-host"
  });

  await assert.rejects(
    async () =>
      engine.joinRoom({
        roomCode: secondRoomCode,
        hallId: "hall-2",
        playerName: "Guest Again",
        walletId: "wallet-guest"
      }),
    (error: unknown) => error instanceof DomainError && error.code === "PLAYER_ALREADY_IN_RUNNING_GAME"
  );
});

test("daily hard limit is enforced per hall scope", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 100,
    monthlyLossLimit: 1000
  });

  const firstRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-1",
    hostName: "Host A",
    hostWalletId: "wallet-host-a",
    guestName: "Guest A",
    guestWalletId: "wallet-guest-a"
  });
  await engine.startGame({
    roomCode: firstRoom.roomCode,
    actorPlayerId: firstRoom.hostPlayerId,
    entryFee: 90,
    ticketsPerPlayer: 1,
    payoutPercent: 80
  });
  await engine.endGame({
    roomCode: firstRoom.roomCode,
    actorPlayerId: firstRoom.hostPlayerId,
    reason: "test-end"
  });

  const secondRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-2",
    hostName: "Host A",
    hostWalletId: "wallet-host-a",
    guestName: "Guest B",
    guestWalletId: "wallet-guest-b"
  });

  await assert.doesNotReject(async () =>
    engine.startGame({
      roomCode: secondRoom.roomCode,
      actorPlayerId: secondRoom.hostPlayerId,
      entryFee: 90,
      ticketsPerPlayer: 1,
      payoutPercent: 80
    })
  );
});

test("personal loss limits are hall-specific", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 900,
    monthlyLossLimit: 4400
  });

  await engine.setPlayerLossLimits({
    walletId: "wallet-host-a",
    hallId: "hall-1",
    daily: 50,
    monthly: 200
  });

  const hallOneRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-1",
    hostName: "Host A",
    hostWalletId: "wallet-host-a",
    guestName: "Guest A",
    guestWalletId: "wallet-guest-a"
  });
  // Player exceeding loss limit is excluded — game starts without them.
  await engine.startGame({
    roomCode: hallOneRoom.roomCode,
    actorPlayerId: hallOneRoom.hostPlayerId,
    entryFee: 60,
    ticketsPerPlayer: 1,
    payoutPercent: 80
  });
  const snapshot = engine.getRoomSnapshot(hallOneRoom.roomCode);
  const ticketKeys = Object.keys(snapshot?.currentGame?.tickets ?? {});
  assert.ok(!ticketKeys.includes(hallOneRoom.hostPlayerId), "loss-limited player should not have tickets");

});

async function withFakeNow<T>(nowMs: number, work: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    return await work();
  } finally {
    Date.now = originalNow;
  }
}

test("ending a game activates mandatory pause and blocks gameplay until it expires", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    playSessionLimitMs: 1000,
    pauseDurationMs: 10 * 60 * 1000
  });

  const firstRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-1",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest",
    guestWalletId: "wallet-guest"
  });

  await withFakeNow(1000, async () => {
    await engine.startGame({
      roomCode: firstRoom.roomCode,
      actorPlayerId: firstRoom.hostPlayerId,
      entryFee: 100,
      ticketsPerPlayer: 1,
      payoutPercent: 80
    });
  });

  await withFakeNow(2501, async () => {
    await engine.endGame({
      roomCode: firstRoom.roomCode,
      actorPlayerId: firstRoom.hostPlayerId,
      reason: "test"
    });
  });

  await withFakeNow(2501, async () => {
    const compliance = engine.getPlayerCompliance("wallet-host", "hall-1");
    assert.equal(compliance.pause.isOnPause, true);
    assert.equal(compliance.pause.accumulatedPlayMs, 0);
    assert.equal(compliance.pause.lastMandatoryBreak?.hallId, "hall-1");
    assert.equal(compliance.pause.lastMandatoryBreak?.totalPlayMs, 1501);
    assert.equal(compliance.pause.lastMandatoryBreak?.netLoss.daily, 100);
    assert.equal(compliance.pause.lastMandatoryBreak?.netLoss.monthly, 100);
    assert.equal(compliance.restrictions.blockedBy, "MANDATORY_PAUSE");

    await assert.rejects(
      async () =>
        engine.createRoom({
          hallId: "hall-2",
          playerName: "Host Again",
          walletId: "wallet-host"
        }),
      (error: unknown) => error instanceof DomainError && error.code === "PLAYER_REQUIRED_PAUSE"
    );
  });

  await withFakeNow(2501 + 10 * 60 * 1000 + 1, async () => {
    await assert.doesNotReject(async () =>
      engine.createRoom({
        hallId: "hall-2",
        playerName: "Host Again",
        walletId: "wallet-host"
      })
    );
    const compliance = engine.getPlayerCompliance("wallet-host", "hall-1");
    assert.equal(compliance.pause.isOnPause, false);
    assert.equal(compliance.pause.lastMandatoryBreak?.hallId, "hall-1");
  });
});

test("loss limit increases are delayed until next local day and month", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 900,
    monthlyLossLimit: 4400
  });
  const startMs = new Date(2026, 3, 11, 10, 0, 0, 0).getTime();
  const nextDayStartMs = new Date(2026, 3, 12, 0, 0, 0, 0).getTime();
  const nextMonthStartMs = new Date(2026, 4, 1, 0, 0, 0, 0).getTime();

  await withFakeNow(startMs, async () => {
    await engine.setPlayerLossLimits({
      walletId: "wallet-cooldown",
      hallId: "hall-1",
      daily: 400,
      monthly: 1000
    });
  });

  await withFakeNow(startMs + 60_000, async () => {
    const compliance = await engine.setPlayerLossLimits({
      walletId: "wallet-cooldown",
      hallId: "hall-1",
      daily: 500,
      monthly: 1200
    });
    assert.equal(compliance.personalLossLimits.daily, 400);
    assert.equal(compliance.personalLossLimits.monthly, 1000);
    assert.equal(compliance.pendingLossLimits?.daily?.value, 500);
    assert.equal(
      compliance.pendingLossLimits?.daily?.effectiveFrom,
      new Date(nextDayStartMs).toISOString()
    );
    assert.equal(compliance.pendingLossLimits?.monthly?.value, 1200);
    assert.equal(
      compliance.pendingLossLimits?.monthly?.effectiveFrom,
      new Date(nextMonthStartMs).toISOString()
    );
  });

  await withFakeNow(nextDayStartMs + 1, async () => {
    const compliance = engine.getPlayerCompliance("wallet-cooldown", "hall-1");
    assert.equal(compliance.personalLossLimits.daily, 500);
    assert.equal(compliance.personalLossLimits.monthly, 1000);
    assert.equal(compliance.pendingLossLimits?.daily, undefined);
    assert.equal(compliance.pendingLossLimits?.monthly?.value, 1200);
  });

  await withFakeNow(nextMonthStartMs + 1, async () => {
    const compliance = engine.getPlayerCompliance("wallet-cooldown", "hall-1");
    assert.equal(compliance.personalLossLimits.daily, 500);
    assert.equal(compliance.personalLossLimits.monthly, 1200);
    assert.equal(compliance.pendingLossLimits, undefined);
  });
});

test("loss limit decreases apply immediately and clear pending increases for the same field", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 900,
    monthlyLossLimit: 4400
  });
  const startMs = new Date(2026, 3, 11, 10, 0, 0, 0).getTime();

  await withFakeNow(startMs, async () => {
    await engine.setPlayerLossLimits({
      walletId: "wallet-cooldown-2",
      hallId: "hall-1",
      daily: 400,
      monthly: 1000
    });
  });

  await withFakeNow(startMs + 60_000, async () => {
    await engine.setPlayerLossLimits({
      walletId: "wallet-cooldown-2",
      hallId: "hall-1",
      daily: 500,
      monthly: 1200
    });
  });

  await withFakeNow(startMs + 120_000, async () => {
    const compliance = await engine.setPlayerLossLimits({
      walletId: "wallet-cooldown-2",
      hallId: "hall-1",
      daily: 350
    });
    assert.equal(compliance.personalLossLimits.daily, 350);
    assert.equal(compliance.personalLossLimits.monthly, 1000);
    assert.equal(compliance.pendingLossLimits?.daily, undefined);
    assert.equal(compliance.pendingLossLimits?.monthly?.value, 1200);
  });
});

test("timed pause cannot be cancelled early and blocks gameplay actions", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());

  await withFakeNow(10_000, async () => {
    await engine.setTimedPause({
      walletId: "wallet-paused",
      durationMinutes: 30
    });
  });

  await withFakeNow(20_000, async () => {
    await assert.rejects(
      async () =>
        engine.createRoom({
          hallId: "hall-1",
          playerName: "Paused",
          walletId: "wallet-paused"
        }),
      (error: unknown) => error instanceof DomainError && error.code === "PLAYER_TIMED_PAUSE"
    );

    await assert.rejects(
      async () => engine.clearTimedPause("wallet-paused"),
      (error: unknown) => error instanceof DomainError && error.code === "TIMED_PAUSE_LOCKED"
    );
  });

  await withFakeNow(2_000_000, async () => {
    const compliance = await engine.clearTimedPause("wallet-paused");
    assert.equal(compliance.restrictions.timedPause.isActive, false);
  });
});

test("self-exclusion cannot be lifted before one year and is checked on gameplay actions", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());

  await withFakeNow(1_000, async () => {
    await engine.setSelfExclusion("wallet-host");
  });

  await withFakeNow(2_000, async () => {
    await assert.rejects(
      async () =>
        engine.createRoom({
          hallId: "hall-1",
          playerName: "Host",
          walletId: "wallet-host"
        }),
      (error: unknown) => error instanceof DomainError && error.code === "PLAYER_SELF_EXCLUDED"
    );

    await assert.rejects(
      async () => engine.clearSelfExclusion("wallet-host"),
      (error: unknown) => error instanceof DomainError && error.code === "SELF_EXCLUSION_LOCKED"
    );
  });

  const oneYearAndOneMinuteMs = 365 * 24 * 60 * 60 * 1000 + 60_000;
  await withFakeNow(1_000 + oneYearAndOneMinuteMs, async () => {
    const compliance = await engine.clearSelfExclusion("wallet-host");
    assert.equal(compliance.restrictions.selfExclusion.isActive, false);
  });
});

test("extra draw attempts are rejected and audited", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await assert.throws(
    () =>
      engine.rejectExtraDrawPurchase({
        source: "SOCKET",
        roomCode,
        playerId: hostPlayerId,
        metadata: {
          requestedCount: 1
        }
      }),
    (error: unknown) => error instanceof DomainError && error.code === "EXTRA_DRAW_NOT_ALLOWED"
  );

  const audits = engine.listExtraDrawDenials(1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].reasonCode, "EXTRA_DRAW_NOT_ALLOWED");
  assert.equal(audits[0].roomCode, roomCode);
  assert.equal(audits[0].playerId, hostPlayerId);
});

test("prize policy caps single databingo payouts and stores policy reference", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
    dailyLossLimit: 20000,
    monthlyLossLimit: 20000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0
  });
  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest-1",
    walletId: "wallet-guest-1"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest-2",
    walletId: "wallet-guest-2"
  });

  await wallet.topUp("wallet-host", 5000, "test");
  await wallet.topUp("wallet-guest-1", 5000, "test");
  await wallet.topUp("wallet-guest-2", 5000, "test");

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 3000,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    // Explicit patterns: 30% LINE payout on 9000 pool = 2700, exceeds 2500 singlePrizeCap
    patterns: [
      { id: "1-rad", name: "1 Rad", claimType: "LINE" as const, prizePercent: 30, order: 1, design: 1 },
      { id: "full-plate", name: "Full Plate", claimType: "BINGO" as const, prizePercent: 70, order: 2, design: 2 },
    ]
  });

  const needed = new Set([1, 2, 3, 4, 5]);
  prioritizeDrawNumbers(engine, roomCode, [...needed]);
  let safety = 0;
  while (needed.size > 0 && safety < 60) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostPlayerId
    });
    if (!needed.has(number)) {
      safety += 1;
      continue;
    }
    await engine.markNumber({
      roomCode,
      playerId: hostPlayerId,
      number
    });
    needed.delete(number);
    safety += 1;
  }
  assert.equal(needed.size, 0);

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostPlayerId,
    type: "LINE"
  });

  assert.equal(claim.valid, true);
  // 30% of 9000 prizePool = 2700, capped to singlePrizeCap of 2500
  assert.equal(claim.payoutAmount, 2500);
  assert.equal(claim.payoutWasCapped, true);
  assert.ok(claim.payoutPolicyVersion);
});

test("prize policy supports hall/link effective dates and extra-prize daily cap", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet);
  const baseline = Date.UTC(2026, 0, 1, 0, 0, 0);
  const nextDay = baseline + 24 * 60 * 60 * 1000;

  const activeBefore = engine.getActivePrizePolicy({
    hallId: "hall-2",
    linkId: "hall-2",
    at: new Date(baseline).toISOString()
  });
  assert.equal(activeBefore.singlePrizeCap, 2500);

  await engine.upsertPrizePolicy({
    hallId: "hall-2",
    linkId: "hall-2",
    effectiveFrom: new Date(nextDay).toISOString(),
    singlePrizeCap: 1800,
    dailyExtraPrizeCap: 3000
  });

  const stillOld = engine.getActivePrizePolicy({
    hallId: "hall-2",
    linkId: "hall-2",
    at: new Date(baseline).toISOString()
  });
  assert.equal(stillOld.singlePrizeCap, 2500);

  const nowNew = engine.getActivePrizePolicy({
    hallId: "hall-2",
    linkId: "hall-2",
    at: new Date(nextDay + 1000).toISOString()
  });
  assert.equal(nowNew.singlePrizeCap, 1800);
  assert.equal(nowNew.dailyExtraPrizeCap, 3000);

  await wallet.topUp("house-hall-2-databingo-internet", 5000, "fund prizes");

  await withFakeNow(nextDay + 5_000, async () => {
    const firstAward = await engine.awardExtraPrize({
      walletId: "wallet-prize-1",
      hallId: "hall-2",
      linkId: "hall-2",
      amount: 1700,
      reason: "campaign"
    });
    assert.equal(firstAward.remainingDailyExtraPrizeLimit, 1300);
  });

  await withFakeNow(nextDay + 6_000, async () => {
    await assert.rejects(
      async () =>
        engine.awardExtraPrize({
          walletId: "wallet-prize-2",
          hallId: "hall-2",
          linkId: "hall-2",
          amount: 1500,
          reason: "campaign"
        }),
      (error: unknown) =>
        error instanceof DomainError && error.code === "EXTRA_PRIZE_DAILY_LIMIT_EXCEEDED"
    );
  });
});

test("payout audit trail includes immutable hash chain and payout metadata", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
    dailyLossLimit: 10000,
    monthlyLossLimit: 10000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0
  });

  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-audit",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-audit",
    playerName: "Guest",
    walletId: "wallet-guest"
  });

  await wallet.topUp("wallet-host", 1000, "seed");
  await wallet.topUp("wallet-guest", 1000, "seed");

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 80
  });

  const needed = new Set([1, 2, 3, 4, 5]);
  prioritizeDrawNumbers(engine, roomCode, [...needed]);
  let guard = 0;
  while (needed.size > 0 && guard < 60) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostPlayerId
    });
    if (needed.has(number)) {
      await engine.markNumber({
        roomCode,
        playerId: hostPlayerId,
        number
      });
      needed.delete(number);
    }
    guard += 1;
  }
  assert.equal(needed.size, 0);

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostPlayerId,
    type: "LINE"
  });
  const snapshot = engine.getRoomSnapshot(roomCode);
  const gameId = snapshot.currentGame?.id;
  assert.ok(gameId);
  assert.equal(claim.valid, true);

  const auditEvents = engine.listPayoutAuditTrail({ limit: 10 });
  assert.ok(auditEvents.length >= 1);
  const event = auditEvents[0];
  assert.equal(event.kind, "CLAIM_PRIZE");
  assert.equal(event.claimId, claim.id);
  assert.equal(event.gameId, gameId);
  assert.equal(event.hallId, "hall-audit");
  assert.equal(event.walletId, "wallet-host");
  assert.ok(event.policyVersion);
  assert.equal(event.txIds.length, 2);
  assert.equal(event.chainIndex, 1);
  assert.equal(event.previousHash, "GENESIS");
  assert.ok(event.eventHash.length >= 32);
});

test("daily report separates hall/game/channel ledgers and exports csv", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());
  const reportDate = "2026-03-03";
  const noonMs = Date.parse(`${reportDate}T12:00:00Z`);

  await withFakeNow(noonMs + 1_000, async () => {
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "MAIN_GAME",
      channel: "HALL",
      eventType: "STAKE",
      amount: 1000
    });
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "MAIN_GAME",
      channel: "HALL",
      eventType: "PRIZE",
      amount: 400
    });

    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 500
    });
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "MAIN_GAME",
      channel: "INTERNET",
      eventType: "PRIZE",
      amount: 100
    });

    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "DATABINGO",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 300
    });
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "DATABINGO",
      channel: "INTERNET",
      eventType: "PRIZE",
      amount: 50
    });
  });

  const report = engine.generateDailyReport({ date: reportDate });
  assert.equal(report.rows.length, 3);
  assert.equal(report.totals.grossTurnover, 1800);
  assert.equal(report.totals.prizesPaid, 550);
  assert.equal(report.totals.net, 1250);

  const hallMain = report.rows.find(
    (row) => row.hallId === "hall-1" && row.gameType === "MAIN_GAME" && row.channel === "HALL"
  );
  const internetMain = report.rows.find(
    (row) => row.hallId === "hall-1" && row.gameType === "MAIN_GAME" && row.channel === "INTERNET"
  );
  const databingo = report.rows.find(
    (row) => row.hallId === "hall-1" && row.gameType === "DATABINGO" && row.channel === "INTERNET"
  );
  assert.equal(hallMain?.net, 600);
  assert.equal(internetMain?.net, 400);
  assert.equal(databingo?.net, 250);

  const csv = engine.exportDailyReportCsv({ date: reportDate });
  assert.ok(csv.includes("hall-1,MAIN_GAME,HALL,1000,400,600"));
  assert.ok(csv.includes("hall-1,MAIN_GAME,INTERNET,500,100,400"));
  assert.ok(csv.includes("hall-1,DATABINGO,INTERNET,300,50,250"));

  const archived = await engine.runDailyReportJob({ date: reportDate });
  assert.equal(archived.date, reportDate);
  const fetchedArchive = engine.getArchivedDailyReport(reportDate);
  assert.ok(fetchedArchive);
  assert.equal(fetchedArchive?.totals.net, 1250);
});

test("overskudd distribution enforces minimum percentages and links transfers to batch", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet);
  const date = "2026-03-04";
  const noonMs = Date.parse(`${date}T12:00:00Z`);

  await withFakeNow(noonMs + 1_000, async () => {
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "MAIN_GAME",
      channel: "HALL",
      eventType: "STAKE",
      amount: 1000
    });
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "MAIN_GAME",
      channel: "HALL",
      eventType: "PRIZE",
      amount: 200
    });
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "DATABINGO",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 1000
    });
    await engine.recordAccountingEvent({
      hallId: "hall-1",
      gameType: "DATABINGO",
      channel: "INTERNET",
      eventType: "PRIZE",
      amount: 0.01
    });
  });

  await wallet.topUp("house-hall-1-main_game-hall", 500, "seed main");
  await wallet.topUp("house-hall-1-databingo-internet", 500, "seed databingo");

  const preReport = engine.generateDailyReport({ date });
  assert.equal(preReport.rows.length, 2);
  assert.equal(preReport.totals.grossTurnover, 2000);
  assert.equal(preReport.totals.prizesPaid, 200.01);
  assert.equal(preReport.totals.net, 1799.99);

  const batch = await engine.createOverskuddDistributionBatch({
    date,
    allocations: [
      {
        organizationId: "org-1",
        organizationAccountId: "org-wallet-1",
        sharePercent: 60
      },
      {
        organizationId: "org-2",
        organizationAccountId: "org-wallet-2",
        sharePercent: 40
      }
    ]
  });

  // MAIN_GAME net 800 => min 120. DATABINGO net 999.99 => min 300.
  assert.equal(batch.requiredMinimum, 420);
  assert.equal(batch.distributedAmount, 420);
  assert.ok(batch.transfers.length >= 2);
  for (const transfer of batch.transfers) {
    assert.equal(transfer.batchId, batch.id);
    assert.ok(transfer.organizationAccountId.startsWith("org-wallet-"));
    assert.equal(transfer.txIds.length, 2);
  }

  const orgOne = await wallet.getBalance("org-wallet-1");
  const orgTwo = await wallet.getBalance("org-wallet-2");
  // InMemoryWalletAdapter seeds new ensured accounts with 1000 in these tests.
  assert.equal(Math.round((orgOne + orgTwo - 2000) * 100) / 100, 420);

  const fetchedBatch = engine.getOverskuddDistributionBatch(batch.id);
  assert.equal(fetchedBatch.id, batch.id);
  assert.equal(fetchedBatch.date, date);
});

// ── Fase 4: Security verification tests ─────────────────────────────

test("KRITISK-4: second BINGO claim after game ends is rejected", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
    dailyLossLimit: 10000,
    monthlyLossLimit: 10000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });
  await engine.startGame({ roomCode, actorPlayerId: hostId, payoutPercent: 80, armedPlayerIds: [hostId, guestId] });

  // Draw all numbers needed for bingo on the fixed ticket
  const bingoNumbers = [1,2,3,4,5,13,14,15,16,17,25,26,27,28,37,38,39,40,41,49,50,51,52,53];
  prioritizeDrawNumbers(engine, roomCode, bingoNumbers);

  for (let i = 0; i < bingoNumbers.length; i++) {
    const { number: drawn } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    await engine.markNumber({ roomCode, playerId: hostId, number: drawn });
    await engine.markNumber({ roomCode, playerId: guestId, number: drawn });
  }

  // First BINGO claim should succeed and end the game
  const claim1 = await engine.submitClaim({ roomCode, playerId: hostId, type: "BINGO" });
  assert.equal(claim1.valid, true);
  assert.equal(claim1.type, "BINGO");

  // Game should now be ENDED
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "ENDED");
  assert.equal(snapshot.currentGame?.endedReason, "BINGO_CLAIMED");

  // Second BINGO claim is rejected because game already ended
  await assert.rejects(
    async () => engine.submitClaim({ roomCode, playerId: guestId, type: "BINGO" }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_RUNNING"
  );
});

test("KRITISK-4: BINGO_ALREADY_CLAIMED guard prevents double payout during race", async () => {
  // Use a delayed wallet that yields control between validation and payout
  let transferCount = 0;
  const realWallet = new InMemoryWalletAdapter();
  const delayedWallet: WalletAdapter = {
    createAccount: (input) => realWallet.createAccount(input),
    ensureAccount: (id) => realWallet.ensureAccount(id),
    getAccount: (id) => realWallet.getAccount(id),
    listAccounts: () => realWallet.listAccounts(),
    getBalance: (id) => realWallet.getBalance(id),
    getDepositBalance: (id) => realWallet.getDepositBalance(id),
    getWinningsBalance: (id) => realWallet.getWinningsBalance(id),
    getBothBalances: (id) => realWallet.getBothBalances(id),
    debit: (id, amount, reason) => realWallet.debit(id, amount, reason),
    credit: (id, amount, reason, options) => realWallet.credit(id, amount, reason, options),
    topUp: (id, amount, reason) => realWallet.topUp(id, amount, reason),
    withdraw: (id, amount, reason) => realWallet.withdraw(id, amount, reason),
    transfer: async (from, to, amount, reason) => {
      transferCount++;
      // On prize payout transfers (after buy-ins), yield to event loop
      // to allow the second claim to interleave
      if (transferCount > 2) {
        await new Promise(resolve => setImmediate(resolve));
      }
      return realWallet.transfer(from, to, amount, reason);
    },
    listTransactions: (id, limit) => realWallet.listTransactions(id, limit)
  };

  const engine = new BingoEngine(new FixedTicketBingoAdapter(), delayedWallet, {
    dailyLossLimit: 10000,
    monthlyLossLimit: 10000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });
  await engine.startGame({ roomCode, actorPlayerId: hostId, payoutPercent: 80, armedPlayerIds: [hostId, guestId] });

  const bingoNumbers = [1,2,3,4,5,13,14,15,16,17,25,26,27,28,37,38,39,40,41,49,50,51,52,53];
  prioritizeDrawNumbers(engine, roomCode, bingoNumbers);

  for (let i = 0; i < bingoNumbers.length; i++) {
    const { number: drawn } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    await engine.markNumber({ roomCode, playerId: hostId, number: drawn });
    await engine.markNumber({ roomCode, playerId: guestId, number: drawn });
  }

  // Fire both claims concurrently — the delayed wallet yields control between them
  const results = await Promise.allSettled([
    engine.submitClaim({ roomCode, playerId: hostId, type: "BINGO" }),
    engine.submitClaim({ roomCode, playerId: guestId, type: "BINGO" })
  ]);

  // Collect results: one should succeed, the other should fail or return invalid
  const claims = results
    .filter((r): r is PromiseFulfilledResult<ClaimRecord> => r.status === "fulfilled")
    .map(r => r.value);
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected");

  const validClaims = claims.filter(c => c.valid);
  const invalidClaims = claims.filter(c => !c.valid);

  // At most one valid BINGO claim
  assert.ok(validClaims.length <= 1, `Expected at most 1 valid BINGO, got ${validClaims.length}`);
  // Total: exactly one winner (valid claim) and one loser (invalid claim or error)
  assert.equal(validClaims.length + invalidClaims.length + errors.length, 2);
});

test("KRITISK-8: unarmed player cannot submit claim", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });

  // Only arm the host — guest is a spectator
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    payoutPercent: 80,
    armedPlayerIds: [hostId]
  });

  // Draw a line for host
  prioritizeDrawNumbers(engine, roomCode, [1, 2, 3, 4, 5]);
  for (let i = 0; i < 5; i++) {
    const { number: drawn } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    await engine.markNumber({ roomCode, playerId: hostId, number: drawn });
  }

  // Guest tries to claim — must be rejected as non-participating
  await assert.rejects(
    async () => engine.submitClaim({ roomCode, playerId: guestId, type: "LINE" }),
    (err: unknown) => err instanceof DomainError && err.code === "PLAYER_NOT_PARTICIPATING"
  );

  // Host can claim successfully
  const hostClaim = await engine.submitClaim({ roomCode, playerId: hostId, type: "LINE" });
  assert.equal(hostClaim.valid, true);
});

test("MEDIUM-1: drawNextNumber enforces minimum draw interval", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 5000  // 5 seconds — enough to always trigger in test
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({ roomCode, hallId: "hall-1", playerName: "Guest", walletId: "wallet-guest" });
  await engine.startGame({ roomCode, actorPlayerId: hostId, payoutPercent: 80 });

  // First draw should succeed
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  // Immediate second draw should fail
  await assert.rejects(
    async () => engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) => err instanceof DomainError && err.code === "DRAW_TOO_FAST"
  );
});

test("HOEY-4: wallet failure during buy-in refunds already-debited players", async () => {
  // Create a wallet that fails on the second player's buy-in transfer
  let transferCount = 0;
  const realWallet = new InMemoryWalletAdapter();
  const failingWallet: WalletAdapter = {
    createAccount: (input) => realWallet.createAccount(input),
    ensureAccount: (id) => realWallet.ensureAccount(id),
    getAccount: (id) => realWallet.getAccount(id),
    listAccounts: () => realWallet.listAccounts(),
    getBalance: (id) => realWallet.getBalance(id),
    getDepositBalance: (id) => realWallet.getDepositBalance(id),
    getWinningsBalance: (id) => realWallet.getWinningsBalance(id),
    getBothBalances: (id) => realWallet.getBothBalances(id),
    debit: (id, amount, reason) => realWallet.debit(id, amount, reason),
    credit: (id, amount, reason, options) => realWallet.credit(id, amount, reason, options),
    topUp: (id, amount, reason) => realWallet.topUp(id, amount, reason),
    withdraw: (id, amount, reason) => realWallet.withdraw(id, amount, reason),
    transfer: async (from, to, amount, reason) => {
      transferCount++;
      // Fail on the 2nd buy-in transfer (second player)
      if (transferCount === 2) {
        throw new WalletError("NETWORK_ERROR", "Simulated wallet failure");
      }
      return realWallet.transfer(from, to, amount, reason);
    },
    listTransactions: (id, limit) => realWallet.listTransactions(id, limit)
  };

  const engine = new BingoEngine(new FixedTicketBingoAdapter(), failingWallet, {
    minDrawIntervalMs: 0
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest"
  });

  const hostBalanceBefore = await realWallet.getBalance("wallet-host");

  // startGame with all players armed (default) → 2 buy-in transfers.
  // Transfer #1 (host buy-in) succeeds, transfer #2 (guest buy-in) fails.
  // Host should be refunded via compensation flow.
  await assert.rejects(
    async () => engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      entryFee: 50,
      payoutPercent: 80
    }),
    (err: unknown) => err instanceof WalletError && err.code === "NETWORK_ERROR"
  );

  // Host's balance should be restored (refunded after guest's buy-in failed)
  const hostBalanceAfter = await realWallet.getBalance("wallet-host");
  assert.equal(hostBalanceAfter, hostBalanceBefore, "Host should be refunded after failed game start");

  // Room should still exist but without a running game
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame, undefined);
});

test("KRITISK-5/6: checkpoint captures RecoverableGameSnapshot with drawBag and structured marks", async () => {
  const checkpoints: Array<{ reason: string; snapshot?: unknown; players?: unknown[] }> = [];
  const capturingAdapter: BingoSystemAdapter = {
    async createTicket() {
      return {
        grid: [
          [1, 2, 3, 4, 5],
          [13, 14, 15, 16, 17],
          [25, 26, 0, 27, 28],
          [37, 38, 39, 40, 41],
          [49, 50, 51, 52, 53]
        ]
      };
    },
    async onCheckpoint(input) {
      checkpoints.push({
        reason: input.reason,
        snapshot: input.snapshot,
        players: input.players
      });
    }
  };

  const engine = new BingoEngine(capturingAdapter, new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    maxDrawsPerRound: 60
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({ roomCode, hallId: "hall-1", playerName: "Guest", walletId: "wallet-guest" });
  await engine.startGame({ roomCode, actorPlayerId: hostId, payoutPercent: 80 });

  // BUY_IN checkpoint should have been captured
  const buyInCheckpoint = checkpoints.find(c => c.reason === "BUY_IN");
  assert.ok(buyInCheckpoint, "BUY_IN checkpoint should exist");
  const buyInSnap = buyInCheckpoint!.snapshot as Record<string, unknown>;
  assert.ok(Array.isArray(buyInSnap.drawBag), "BUY_IN snapshot should contain drawBag array");
  assert.ok(typeof buyInSnap.structuredMarks === "object", "BUY_IN snapshot should contain structuredMarks");
  // BIN-672: default gameSlug is now "bingo" (75-ball). Pre-BIN-672 tests
  // relied on the implicit 60-ball fallback for rooms that didn't pass a slug.
  assert.equal((buyInSnap.drawBag as number[]).length, 75, "drawBag should have 75 balls at start (bingo default)");

  // Draw a number and mark it
  const { number: drawn } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  const snapshot = engine.getRoomSnapshot(roomCode);
  const somePlayerId = snapshot.players[0].id;
  try {
    await engine.markNumber({ roomCode, playerId: somePlayerId, number: drawn });
  } catch {
    // Number might not be on this player's ticket — that's fine
  }

  // DRAW checkpoint should capture current drawBag state
  const drawCheckpoint = checkpoints.find(c => c.reason === "DRAW");
  assert.ok(drawCheckpoint, "DRAW checkpoint should exist after draw");
  const drawSnap = drawCheckpoint!.snapshot as Record<string, unknown>;
  assert.ok(Array.isArray(drawSnap.drawBag), "DRAW snapshot should contain drawBag");
  assert.equal((drawSnap.drawBag as number[]).length, 74, "drawBag should have 74 balls after 1 draw (bingo default)");
  assert.ok(Array.isArray(drawSnap.drawnNumbers), "DRAW snapshot should contain drawnNumbers");
  assert.equal((drawSnap.drawnNumbers as number[]).length, 1);
  assert.ok(drawCheckpoint!.players, "DRAW checkpoint should include players");
});

test("BIN-505/506: mini-game rotation cycles wheel → chest → mystery → colorDraft", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const types: string[] = [];

  // Five activations to prove the rotation wraps cleanly back to wheelOfFortune.
  for (let i = 0; i < 5; i += 1) {
    const hallId = `hall-rot-${i}`;
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId,
      playerName: `Host${i}`,
      walletId: `wallet-host-${i}`,
      gameSlug: "bingo",
    });
    await engine.joinRoom({ roomCode, hallId, playerName: `Guest${i}`, walletId: `wallet-guest-${i}` });
    await engine.startGame({ roomCode, actorPlayerId: hostId, ticketsPerPlayer: 1, payoutPercent: 80 });
    const mg = engine.activateMiniGame(roomCode, hostId);
    assert.ok(mg, `activation #${i} returned null`);
    types.push(mg!.type);
  }

  // Backport PR #555 (Tobias 2026-04-26): MYSTERY_FORCE_DEFAULT_FOR_TESTING
  // tvinger mysteryGame for ALLE aktiveringer i ad-hoc-engine. Den
  // opprinnelige rotasjons-asserten lever som dokumentasjon i kommentar.
  // Når testing-flagget slås av igjen, skal asserten gå tilbake til:
  //   ["wheelOfFortune", "treasureChest", "mysteryGame", "colorDraft", "wheelOfFortune"]
  assert.deepEqual(
    types,
    ["mysteryGame", "mysteryGame", "mysteryGame", "mysteryGame", "mysteryGame"],
    `rotation mismatch (mystery-force aktivt): ${JSON.stringify(types)}`,
  );
});

test("BIN-505/506: mystery + colorDraft prizes flow through playMiniGame same as wheel/chest", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });

  // Backport PR #555: MYSTERY_FORCE_DEFAULT_FOR_TESTING gjør at alle
  // aktiveringer returnerer mysteryGame. Vi beholder testen for å
  // sikre at playMiniGame-payout-flyten fortsatt fungerer for type
  // mysteryGame; colorDraft-grenen verifiseres når flagget slås av.
  for (let i = 0; i < 2; i += 1) {
    const hallId = `hall-burn-${i}`;
    const { roomCode, playerId: hostId } = await engine.createRoom({ hallId, playerName: "H", walletId: `w-burn-${i}` });
    await engine.joinRoom({ roomCode, hallId, playerName: "G", walletId: `w-burn-g-${i}` });
    await engine.startGame({ roomCode, actorPlayerId: hostId, ticketsPerPlayer: 1, payoutPercent: 80 });
    engine.activateMiniGame(roomCode, hostId);
  }

  // Third room: expect mysteryGame (force-flag aktivt — ville vært
  // mysteryGame uansett pga rotasjons-posisjon).
  const hallMystery = "hall-mystery";
  const { roomCode: mysteryRoom, playerId: mysteryHost } = await engine.createRoom({
    hallId: hallMystery, playerName: "MHost", walletId: "wallet-m-host",
  });
  await engine.joinRoom({ roomCode: mysteryRoom, hallId: hallMystery, playerName: "MGuest", walletId: "wallet-m-guest" });
  await engine.startGame({ roomCode: mysteryRoom, actorPlayerId: mysteryHost, ticketsPerPlayer: 1, payoutPercent: 80 });
  const mysteryState = engine.activateMiniGame(mysteryRoom, mysteryHost);
  assert.equal(mysteryState?.type, "mysteryGame");
  const mysteryResult = await engine.playMiniGame(mysteryRoom, mysteryHost, 3);
  assert.equal(mysteryResult.type, "mysteryGame");
  assert.ok(mysteryResult.prizeAmount >= 0, "prizeAmount must be non-negative");
  assert.ok(mysteryResult.prizeList.length > 0, "prizeList must be populated");

  // Fourth room: med MYSTERY_FORCE_DEFAULT_FOR_TESTING aktivt overstyres
  // rotasjonen — mysteryGame igjen i stedet for colorDraft. Testen
  // verifiserer at mystery-force er konsekvent på tvers av rom og
  // rotasjons-posisjoner. Når flagget slås av: forvent colorDraft her.
  const hallColor = "hall-color";
  const { roomCode: colorRoom, playerId: colorHost } = await engine.createRoom({
    hallId: hallColor, playerName: "CHost", walletId: "wallet-c-host",
  });
  await engine.joinRoom({ roomCode: colorRoom, hallId: hallColor, playerName: "CGuest", walletId: "wallet-c-guest" });
  await engine.startGame({ roomCode: colorRoom, actorPlayerId: colorHost, ticketsPerPlayer: 1, payoutPercent: 80 });
  const colorState = engine.activateMiniGame(colorRoom, colorHost);
  assert.equal(colorState?.type, "mysteryGame");
  const colorResult = await engine.playMiniGame(colorRoom, colorHost, 1);
  assert.equal(colorResult.type, "mysteryGame");
  assert.ok(colorResult.prizeAmount >= 0);
});

// ── BIN-615 / PR-C3: lucky-number hook & state-machine ────────────────────────
// Hook was lifted from Game2Engine → BingoEngine so any variant with
// luckyNumberPrize > 0 can opt in. Game 1 (no luckyNumberPrize) must never
// see the hook; Game 2 keeps its inline coupling (not exercised here, see
// Game2Engine.test.ts). These tests exercise the base-class state+hook
// contract directly via a probe subclass.

interface LuckyCallArgs {
  roomCode: string;
  playerId: string;
  luckyNumber: number;
  lastBall: number;
  drawIndex: number;
  luckyPrize: number;
}

class LuckyProbeEngine extends BingoEngine {
  public readonly luckyCalls: LuckyCallArgs[] = [];

  protected async onLuckyNumberDrawn(ctx: {
    room: import("./types.js").RoomState;
    game: import("./types.js").GameState;
    player: import("./types.js").Player;
    luckyNumber: number;
    lastBall: number;
    drawIndex: number;
    variantConfig: import("./variantConfig.js").GameVariantConfig;
  }): Promise<void> {
    this.luckyCalls.push({
      roomCode: ctx.room.code,
      playerId: ctx.player.id,
      luckyNumber: ctx.luckyNumber,
      lastBall: ctx.lastBall,
      drawIndex: ctx.drawIndex,
      luckyPrize: ctx.variantConfig.luckyNumberPrize ?? 0,
    });
  }

  public readLucky(roomCode: string, playerId: string): number | undefined {
    return this.getLuckyNumber(roomCode, playerId);
  }
}

test("BIN-615 PR-C3: onLuckyNumberDrawn fires when luckyNumberPrize > 0 and ball matches", async () => {
  const engine = new LuckyProbeEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-lucky-1", playerName: "Host", walletId: "wallet-host-lucky",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-lucky-1", playerName: "Guest", walletId: "wallet-guest-lucky" });
  // Variant opts into the hook by setting luckyNumberPrize > 0.
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    variantConfig: {
      ticketTypes: [{ name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 }],
      patterns: [],
      luckyNumberPrize: 100,
    },
  });
  engine.setLuckyNumber(roomCode, hostId, 7);
  prioritizeDrawNumbers(engine, roomCode, [7]);
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(engine.luckyCalls.length, 1, "hook should fire once when drawn ball matches");
  assert.equal(engine.luckyCalls[0].playerId, hostId);
  assert.equal(engine.luckyCalls[0].luckyNumber, 7);
  assert.equal(engine.luckyCalls[0].lastBall, 7);
  assert.equal(engine.luckyCalls[0].luckyPrize, 100);
});

test("BIN-615 PR-C3: onLuckyNumberDrawn does NOT fire when luckyNumberPrize is 0 (Game 1)", async () => {
  const engine = new LuckyProbeEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-lucky-2", playerName: "Host", walletId: "wallet-host-lucky-2",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-lucky-2", playerName: "Guest", walletId: "wallet-guest-lucky-2" });
  // Default Game 1 style: no luckyNumberPrize set → treated as 0.
  await engine.startGame({ roomCode, actorPlayerId: hostId, ticketsPerPlayer: 1, payoutPercent: 80 });
  engine.setLuckyNumber(roomCode, hostId, 3);
  prioritizeDrawNumbers(engine, roomCode, [3]);
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(engine.luckyCalls.length, 0, "hook must never fire for Game 1 (no luckyNumberPrize)");
});

test("BIN-615 PR-C3: onLuckyNumberDrawn does NOT fire when drawn ball differs from lucky number", async () => {
  const engine = new LuckyProbeEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-lucky-3", playerName: "Host", walletId: "wallet-host-lucky-3",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-lucky-3", playerName: "Guest", walletId: "wallet-guest-lucky-3" });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    variantConfig: {
      ticketTypes: [{ name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 }],
      patterns: [],
      luckyNumberPrize: 50,
    },
  });
  engine.setLuckyNumber(roomCode, hostId, 42);
  prioritizeDrawNumbers(engine, roomCode, [11]);
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(engine.luckyCalls.length, 0, "hook only fires when lastBall === luckyNumber");
});

test("BIN-615 PR-C3: luckyNumbersByPlayer state-machine — add, read, destroyRoom clears", async () => {
  const engine = new LuckyProbeEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-lucky-4", playerName: "Host", walletId: "wallet-host-lucky-4",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-lucky-4", playerName: "Guest", walletId: "wallet-guest-lucky-4" });
  // Read before add → undefined
  assert.equal(engine.readLucky(roomCode, hostId), undefined, "no lucky set initially");
  // Add
  engine.setLuckyNumber(roomCode, hostId, 17);
  assert.equal(engine.readLucky(roomCode, hostId), 17, "readLucky after setLuckyNumber");
  // Overwrite (legacy behaviour: last-write-wins)
  engine.setLuckyNumber(roomCode, hostId, 23);
  assert.equal(engine.readLucky(roomCode, hostId), 23, "last-write-wins");
  // destroyRoom should clear the per-room state
  engine.destroyRoom(roomCode);
  assert.equal(engine.readLucky(roomCode, hostId), undefined, "destroyRoom clears luckyNumbersByPlayer");
});

test("BIN-615 PR-C3: setLuckyNumber validates against variantConfig.maxBallValue (defaults to 60 for G1)", async () => {
  const engine = new LuckyProbeEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-lucky-5", playerName: "Host", walletId: "wallet-host-lucky-5",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-lucky-5", playerName: "Guest", walletId: "wallet-guest-lucky-5" });
  // Before startGame no variantConfig cached → maxBall default 60.
  assert.throws(() => engine.setLuckyNumber(roomCode, hostId, 0), /mellom 1 og 60/);
  assert.throws(() => engine.setLuckyNumber(roomCode, hostId, 61), /mellom 1 og 60/);
  assert.throws(() => engine.setLuckyNumber(roomCode, hostId, 1.5), /mellom 1 og 60/);
  engine.setLuckyNumber(roomCode, hostId, 1);
  engine.setLuckyNumber(roomCode, hostId, 60);
});
