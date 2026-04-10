import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import {
  type CreateWalletAccountInput,
  type WalletAccount,
  type WalletAdapter,
  type WalletTransaction,
  WalletError,
  type WalletTransferResult
} from "../adapters/WalletAdapter.js";
import { BingoEngine, DomainError } from "../game/BingoEngine.js";
import { assertTicketsPerPlayerWithinHallLimit } from "../game/compliance.js";
import type { Ticket } from "../game/types.js";

class InMemoryWalletAdapter implements WalletAdapter {
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
      createdAt: now,
      updatedAt: now
    };
    this.accounts.set(accountId, account);
    return this.cloneAccount(account);
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
    const account = this.accounts.get(accountId.trim());
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

  async credit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, Math.abs(amount), "CREDIT", reason);
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
    reason = "Transfer"
  ): Promise<WalletTransferResult> {
    const normalizedAmount = Math.abs(amount);
    const fromTx = await this.adjustBalance(fromAccountId, -normalizedAmount, "TRANSFER_OUT", reason, toAccountId);
    const toTx = await this.adjustBalance(toAccountId, normalizedAmount, "TRANSFER_IN", reason, fromAccountId);
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    return this.transactions
      .filter((tx) => tx.accountId === accountId.trim())
      .slice(-Math.max(0, limit))
      .map((tx) => ({ ...tx }));
  }

  private async adjustBalance(
    accountId: string,
    delta: number,
    type: WalletTransaction["type"],
    reason: string,
    relatedAccountId?: string
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

    const updated: WalletAccount = {
      ...account,
      balance: nextBalance,
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
      relatedAccountId
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

async function withFakeNow<T>(nowMs: number, work: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    return await work();
  } finally {
    Date.now = originalNow;
  }
}

test("compliance: enforces 30s interval between databingo rounds", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    minRoundIntervalMs: 30_000
  });
  const room = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-interval",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest",
    guestWalletId: "wallet-guest"
  });

  await withFakeNow(1_000, async () => {
    await engine.startGame({
      roomCode: room.roomCode,
      actorPlayerId: room.hostPlayerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 80
    });
  });

  await withFakeNow(2_000, async () => {
    await engine.endGame({
      roomCode: room.roomCode,
      actorPlayerId: room.hostPlayerId,
      reason: "interval-test"
    });
  });

  await withFakeNow(5_000, async () => {
    await assert.rejects(
      async () =>
        engine.startGame({
          roomCode: room.roomCode,
          actorPlayerId: room.hostPlayerId,
          entryFee: 0,
          ticketsPerPlayer: 1,
          payoutPercent: 80
        }),
      (error: unknown) => error instanceof DomainError && error.code === "ROUND_START_TOO_SOON"
    );
  });
});

test("compliance: enforces ticket max and hall ticket cap", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());
  const room = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-ticket",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest",
    guestWalletId: "wallet-guest"
  });

  await assert.rejects(
    async () =>
      engine.startGame({
        roomCode: room.roomCode,
        actorPlayerId: room.hostPlayerId,
        entryFee: 0,
        ticketsPerPlayer: 6,
        payoutPercent: 80
      }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TICKETS_PER_PLAYER"
  );

  assert.throws(
    () => assertTicketsPerPlayerWithinHallLimit(5, 4),
    (error: unknown) => error instanceof DomainError && error.code === "TICKETS_ABOVE_HALL_LIMIT"
  );
});

test("compliance: enforces regulatory and personal loss limits", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 100,
    monthlyLossLimit: 4400
  });
  engine.setPlayerLossLimits({
    walletId: "wallet-host",
    hallId: "hall-1",
    daily: 60,
    monthly: 300
  });

  // Hall-1: host has personal daily limit 60, entryFee 70 exceeds it.
  // The engine soft-filters: game starts but host is excluded from tickets.
  const hallOneRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-1",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest A",
    guestWalletId: "wallet-guest-a"
  });

  await engine.startGame({
    roomCode: hallOneRoom.roomCode,
    actorPlayerId: hallOneRoom.hostPlayerId,
    entryFee: 70,
    ticketsPerPlayer: 1,
    payoutPercent: 80
  });

  const hallOneSnap = engine.getRoomSnapshot(hallOneRoom.roomCode);
  const hallOneTicketPlayerIds = Object.keys(hallOneSnap.currentGame?.tickets ?? {});
  // Host should be filtered out (exceeds daily limit), guest should have tickets.
  assert.ok(
    !hallOneTicketPlayerIds.includes(hallOneRoom.hostPlayerId),
    "Host exceeding daily loss limit should not receive tickets"
  );

  // End the hall-1 game so the host can join hall-2.
  await engine.endGame({
    roomCode: hallOneRoom.roomCode,
    actorPlayerId: hallOneRoom.hostPlayerId,
    reason: "test-cleanup"
  });

  // Hall-2: no personal limits set for hall-2, regulatory limit is 100 > 70.
  // Both players should get tickets.
  const hallTwoRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-2",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest B",
    guestWalletId: "wallet-guest-b"
  });

  await assert.doesNotReject(async () =>
    engine.startGame({
      roomCode: hallTwoRoom.roomCode,
      actorPlayerId: hallTwoRoom.hostPlayerId,
      entryFee: 70,
      ticketsPerPlayer: 1,
      payoutPercent: 80
    })
  );
});

test("compliance: enforces mandatory break and timed pause", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    playSessionLimitMs: 1000,
    pauseDurationMs: 5 * 60 * 1000
  });

  const firstRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-pause",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest",
    guestWalletId: "wallet-guest"
  });

  await withFakeNow(1000, async () => {
    await engine.startGame({
      roomCode: firstRoom.roomCode,
      actorPlayerId: firstRoom.hostPlayerId,
      entryFee: 10,
      ticketsPerPlayer: 1,
      payoutPercent: 80
    });
  });

  await withFakeNow(2501, async () => {
    await engine.endGame({
      roomCode: firstRoom.roomCode,
      actorPlayerId: firstRoom.hostPlayerId,
      reason: "pause-test"
    });
  });

  const secondRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-pause",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest 2",
    guestWalletId: "wallet-guest-2"
  });

  await withFakeNow(3000, async () => {
    // The engine soft-filters paused players: game starts but host
    // (on required pause) is excluded from tickets.
    await engine.startGame({
      roomCode: secondRoom.roomCode,
      actorPlayerId: secondRoom.hostPlayerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 80
    });

    const snap = engine.getRoomSnapshot(secondRoom.roomCode);
    const ticketPlayerIds = Object.keys(snap.currentGame?.tickets ?? {});
    assert.ok(
      !ticketPlayerIds.includes(secondRoom.hostPlayerId),
      "Host on required pause should not receive tickets"
    );
  });

  await withFakeNow(10_000, async () => {
    engine.setTimedPause({
      walletId: "wallet-timed-pause",
      durationMinutes: 30
    });
    await assert.rejects(
      async () =>
        engine.createRoom({
          hallId: "hall-pause",
          playerName: "Paused",
          walletId: "wallet-timed-pause"
        }),
      (error: unknown) => error instanceof DomainError && error.code === "PLAYER_TIMED_PAUSE"
    );
  });
});

test("compliance: enforces self exclusion minimum period", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());

  await withFakeNow(1_000, async () => {
    engine.setSelfExclusion("wallet-self-excluded");
  });

  await withFakeNow(2_000, async () => {
    await assert.rejects(
      async () =>
        engine.createRoom({
          hallId: "hall-exclusion",
          playerName: "Excluded",
          walletId: "wallet-self-excluded"
        }),
      (error: unknown) => error instanceof DomainError && error.code === "PLAYER_SELF_EXCLUDED"
    );

    assert.throws(
      () => engine.clearSelfExclusion("wallet-self-excluded"),
      (error: unknown) => error instanceof DomainError && error.code === "SELF_EXCLUSION_LOCKED"
    );
  });
});

test("compliance: enforces databingo prize caps and keeps payout audit", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
    dailyLossLimit: 20_000,
    monthlyLossLimit: 20_000,
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0
  });

  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-prize",
    playerName: "Host",
    walletId: "wallet-host"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-prize",
    playerName: "Guest 1",
    walletId: "wallet-guest-1"
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-prize",
    playerName: "Guest 2",
    walletId: "wallet-guest-2"
  });

  await wallet.topUp("wallet-host", 5000, "seed");
  await wallet.topUp("wallet-guest-1", 5000, "seed");
  await wallet.topUp("wallet-guest-2", 5000, "seed");

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 3000,
    ticketsPerPlayer: 1,
    payoutPercent: 80
  });

  // Make draw order deterministic for this test to avoid flakiness where a required
  // line number can be the final ball and the round ends before markNumber().
  const internalRoomState = (engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }).rooms.get(
    roomCode
  );
  const drawBag = internalRoomState?.currentGame?.drawBag;
  if (drawBag) {
    const requiredLineNumbers = [1, 2, 3, 4, 5];
    const prioritized = requiredLineNumbers.filter((value) => drawBag.includes(value));
    const remainder = drawBag.filter((value) => !prioritized.includes(value));
    internalRoomState!.currentGame!.drawBag = [...prioritized, ...remainder];
  }

  const needed = new Set([1, 2, 3, 4, 5]);
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
  assert.equal(claim.valid, true);
  assert.equal(claim.payoutAmount, 2500);
  assert.equal(claim.payoutWasCapped, true);
  assert.ok(claim.payoutPolicyVersion);

  const audits = engine.listPayoutAuditTrail({ limit: 5 });
  assert.ok(audits.length >= 1);
  assert.equal(audits[0].kind, "CLAIM_PRIZE");
  assert.ok(audits[0].eventHash);
  assert.equal(audits[0].policyVersion, claim.payoutPolicyVersion);
});
