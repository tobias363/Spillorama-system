import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import {
  type CreateWalletAccountInput,
  type WalletAccount,
  type WalletAdapter,
  type WalletTransaction,
  WalletError,
  type WalletTransferResult
} from "../adapters/WalletAdapter.js";
import type { Ticket } from "./types.js";
import { BingoEngine, DomainError } from "./BingoEngine.js";

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
        [16, 17, 18, 19, 20],
        [31, 32, 0, 33, 34],
        [46, 47, 48, 49, 50],
        [61, 62, 63, 64, 65]
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

test("startGame rejects ticketsPerPlayer below 1", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await assert.rejects(
    async () => engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 0 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TICKETS_PER_PLAYER"
  );
});

test("startGame rejects ticketsPerPlayer above 5", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await assert.rejects(
    async () => engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 6 }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TICKETS_PER_PLAYER"
  );
});

test("startGame accepts ticketsPerPlayer equal to 1", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 1 });
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.ticketsPerPlayer, 1);
});

test("startGame accepts ticketsPerPlayer equal to 5", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngineWithRoom();
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 5 });
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.ticketsPerPlayer, 5);
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
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 1 });

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
  await engine.startGame({ roomCode, actorPlayerId: hostPlayerId, ticketsPerPlayer: 1 });

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
    ticketsPerPlayer: 1
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
      ticketsPerPlayer: 1
    })
  );
});

test("personal loss limits are hall-specific", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter(), {
    dailyLossLimit: 900,
    monthlyLossLimit: 4400
  });

  engine.setPlayerLossLimits({
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
  await assert.rejects(
    async () =>
      engine.startGame({
        roomCode: hallOneRoom.roomCode,
        actorPlayerId: hallOneRoom.hostPlayerId,
        entryFee: 60,
        ticketsPerPlayer: 1
      }),
    (error: unknown) => error instanceof DomainError && error.code === "DAILY_LOSS_LIMIT_EXCEEDED"
  );

  const hallTwoRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-2",
    hostName: "Host A",
    hostWalletId: "wallet-host-a",
    guestName: "Guest B",
    guestWalletId: "wallet-guest-b"
  });
  await assert.doesNotReject(async () =>
    engine.startGame({
      roomCode: hallTwoRoom.roomCode,
      actorPlayerId: hallTwoRoom.hostPlayerId,
      entryFee: 60,
      ticketsPerPlayer: 1
    })
  );
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

test("mandatory pause is enforced after play session limit and includes break summary", async () => {
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
      ticketsPerPlayer: 1
    });
  });

  await withFakeNow(2501, async () => {
    await engine.endGame({
      roomCode: firstRoom.roomCode,
      actorPlayerId: firstRoom.hostPlayerId,
      reason: "test"
    });
  });

  const secondRoom = await createRoomWithTwoPlayers({
    engine,
    hallId: "hall-1",
    hostName: "Host",
    hostWalletId: "wallet-host",
    guestName: "Guest 2",
    guestWalletId: "wallet-guest-2"
  });

  await withFakeNow(3000, async () => {
    await assert.rejects(
      async () =>
        engine.startGame({
          roomCode: secondRoom.roomCode,
          actorPlayerId: secondRoom.hostPlayerId,
          entryFee: 0,
          ticketsPerPlayer: 1
        }),
      (error: unknown) => error instanceof DomainError && error.code === "PLAYER_ON_REQUIRED_PAUSE"
    );
  });

  const compliance = engine.getPlayerCompliance("wallet-host", "hall-1");
  assert.equal(compliance.pause.isOnPause, true);
  assert.ok(compliance.pause.lastMandatoryBreak);
  assert.equal(compliance.pause.lastMandatoryBreak?.hallId, "hall-1");
});

test("timed pause cannot be cancelled early and blocks gameplay actions", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());

  await withFakeNow(10_000, async () => {
    engine.setTimedPause({
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

    assert.throws(
      () => engine.clearTimedPause("wallet-paused"),
      (error: unknown) => error instanceof DomainError && error.code === "TIMED_PAUSE_LOCKED"
    );
  });

  await withFakeNow(2_000_000, async () => {
    const compliance = engine.clearTimedPause("wallet-paused");
    assert.equal(compliance.restrictions.timedPause.isActive, false);
  });
});

test("self-exclusion cannot be lifted before one year and is checked on gameplay actions", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());

  await withFakeNow(1_000, async () => {
    engine.setSelfExclusion("wallet-host");
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

    assert.throws(
      () => engine.clearSelfExclusion("wallet-host"),
      (error: unknown) => error instanceof DomainError && error.code === "SELF_EXCLUSION_LOCKED"
    );
  });

  const oneYearAndOneMinuteMs = 365 * 24 * 60 * 60 * 1000 + 60_000;
  await withFakeNow(1_000 + oneYearAndOneMinuteMs, async () => {
    const compliance = engine.clearSelfExclusion("wallet-host");
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
    monthlyLossLimit: 20000
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
    ticketsPerPlayer: 1
  });

  const needed = new Set([1, 2, 3, 4, 5]);
  let safety = 0;
  while (needed.size > 0 && safety < 75) {
    const number = await engine.drawNextNumber({
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
  assert.equal(claim.payoutAmount, 2500);
  assert.equal(claim.payoutWasCapped, true);
  assert.ok(claim.payoutPolicyVersion);
});

test("prize policy supports hall/link effective dates and extra-prize daily cap", async () => {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());
  const baseline = Date.UTC(2026, 0, 1, 0, 0, 0);
  const nextDay = baseline + 24 * 60 * 60 * 1000;

  const activeBefore = engine.getActivePrizePolicy({
    hallId: "hall-2",
    linkId: "hall-2",
    at: new Date(baseline).toISOString()
  });
  assert.equal(activeBefore.singlePrizeCap, 2500);

  engine.upsertPrizePolicy({
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
