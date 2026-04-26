// PR-W3 wallet-split: verifiserer at BingoEngine-payout-paths sender
// `targetSide: "winnings"` til walletAdapter.transfer for prize-transfers.
//
// Tilnærming: en spy-adapter fanger alle transfer-kall og lagrer options,
// slik at vi kan assertere på targetSide uten å bytte ut hele
// InMemory-wallet-et i BingoEngine.test.ts.

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BingoEngine } from "./BingoEngine.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type {
  CreateWalletAccountInput,
  TransferOptions,
  WalletAccount,
  WalletAdapter,
  WalletTransaction,
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { Ticket } from "./types.js";

interface CapturedTransfer {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  reason: string;
  options?: TransferOptions;
}

class SpyWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private readonly transactions: WalletTransaction[] = [];
  private txCounter = 0;

  public readonly transfers: CapturedTransfer[] = [];

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const initialBalance = Number(input?.initialBalance ?? 0);
    if (this.accounts.has(accountId)) {
      if (input?.allowExisting) return { ...this.accounts.get(accountId)! };
      throw new WalletError("ACCOUNT_EXISTS", "Account exists");
    }
    const now = new Date().toISOString();
    const account: WalletAccount = {
      id: accountId,
      balance: initialBalance,
      depositBalance: initialBalance,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(accountId, account);
    return { ...account };
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    const id = accountId.trim();
    if (!this.accounts.has(id)) {
      await this.createAccount({ accountId: id, initialBalance: 1000, allowExisting: true });
    }
    return { ...this.accounts.get(id)! };
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const id = accountId.trim();
    const account = this.accounts.get(id);
    if (!account) throw new WalletError("ACCOUNT_NOT_FOUND", "Not found");
    return { ...account };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }

  async getBalance(accountId: string): Promise<number> {
    return (await this.getAccount(accountId)).balance;
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

  async debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(accountId, -Math.abs(amount), "DEBIT", reason);
  }
  async credit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjust(accountId, Math.abs(amount), "CREDIT", reason);
  }
  async topUp(accountId: string, amount: number, reason = "Top-up"): Promise<WalletTransaction> {
    return this.adjust(accountId, Math.abs(amount), "TOPUP", reason);
  }
  async withdraw(accountId: string, amount: number, reason = "Withdraw"): Promise<WalletTransaction> {
    return this.adjust(accountId, -Math.abs(amount), "WITHDRAWAL", reason);
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Transfer",
    options?: TransferOptions
  ): Promise<WalletTransferResult> {
    this.transfers.push({ fromAccountId, toAccountId, amount, reason, options });
    const amt = Math.abs(amount);
    const fromTx = await this.adjust(fromAccountId, -amt, "TRANSFER_OUT", reason, toAccountId);
    const toTx = await this.adjust(toAccountId, amt, "TRANSFER_IN", reason, fromAccountId);
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string): Promise<WalletTransaction[]> {
    return this.transactions
      .filter((tx) => tx.accountId === accountId.trim())
      .map((tx) => ({ ...tx }));
  }

  private async adjust(
    accountId: string,
    delta: number,
    type: WalletTransaction["type"],
    reason: string,
    relatedAccountId?: string
  ): Promise<WalletTransaction> {
    const id = accountId.trim();
    const account = await this.ensureAccount(id);
    const next = account.balance + delta;
    if (next < 0) throw new WalletError("INSUFFICIENT_FUNDS", "No funds");
    this.accounts.set(id, {
      ...account,
      balance: next,
      depositBalance: next,
      winningsBalance: 0,
      updatedAt: new Date().toISOString(),
    });
    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`,
      accountId: id,
      type,
      amount: Math.abs(delta),
      reason,
      createdAt: new Date().toISOString(),
      relatedAccountId,
    };
    this.transactions.push(tx);
    return { ...tx };
  }
}

class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53],
      ],
    };
  }
}

function prioritizeDrawNumbers(
  engine: BingoEngine,
  roomCode: string,
  preferred: readonly number[]
): void {
  const internal = (
    engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }
  ).rooms.get(roomCode);
  const drawBag = internal?.currentGame?.drawBag;
  if (!drawBag) return;
  const hit = preferred.filter((v) => drawBag.includes(v));
  if (hit.length === 0) return;
  const rest = drawBag.filter((v) => !hit.includes(v));
  internal!.currentGame!.drawBag = [...hit, ...rest];
}

function payoutTransfers(spy: SpyWalletAdapter, reasonSubstring: string): CapturedTransfer[] {
  return spy.transfers.filter((t) => t.reason.includes(reasonSubstring));
}

// ── Testene ─────────────────────────────────────────────────────────────────

test("BingoEngine: LINE prize-payout sender targetSide='winnings'", async () => {
  const spy = new SpyWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), spy, {
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    patterns: [
      { id: "1-rad", name: "1 Rad", claimType: "LINE" as const, prizePercent: 30, order: 1, design: 1 },
      { id: "full-plate", name: "Full Plate", claimType: "BINGO" as const, prizePercent: 70, order: 2, design: 2 },
    ],
  });

  const lineNumbers = new Set([1, 2, 3, 4, 5]);
  prioritizeDrawNumbers(engine, roomCode, [...lineNumbers]);
  let drawGuard = 0;
  while (lineNumbers.size > 0 && drawGuard < 60) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostId,
    });
    if (!lineNumbers.has(number)) {
      drawGuard += 1;
      continue;
    }
    await engine.markNumber({
      roomCode,
      playerId: hostId,
      number,
    });
    lineNumbers.delete(number);
    drawGuard += 1;
  }
  assert.equal(lineNumbers.size, 0);

  const lineClaim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });
  assert.equal(lineClaim.valid, true);
  assert.ok((lineClaim.payoutAmount ?? 0) > 0, "payout-beløp > 0");

  const linePayouts = payoutTransfers(spy, "Line prize");
  assert.equal(linePayouts.length, 1, "én LINE-payout registrert");
  assert.equal(
    linePayouts[0]!.options?.targetSide,
    "winnings",
    "LINE-prize skal sende targetSide='winnings'"
  );
  assert.ok(linePayouts[0]!.options?.idempotencyKey, "idempotencyKey beholdt");

  // BUYIN-transfers skal IKKE ha targetSide='winnings'
  const buyIns = payoutTransfers(spy, "Bingo buy-in");
  assert.ok(buyIns.length > 0, "buy-in skal eksistere");
  for (const b of buyIns) {
    assert.notEqual(
      b.options?.targetSide,
      "winnings",
      "buy-in skal aldri sende targetSide='winnings'"
    );
  }
});

test("BingoEngine: BINGO prize-payout sender targetSide='winnings'", async () => {
  const spy = new SpyWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), spy, {
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    patterns: [
      { id: "1-rad", name: "1 Rad", claimType: "LINE" as const, prizePercent: 30, order: 1, design: 1 },
      { id: "full-plate", name: "Full Plate", claimType: "BINGO" as const, prizePercent: 70, order: 2, design: 2 },
    ],
  });

  // Få alle ticket-numrene markert for full bingo.
  const bingoNumbers = new Set([
    1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 25, 26, 27, 28, 37, 38, 39, 40, 41, 49, 50, 51, 52, 53,
  ]);
  prioritizeDrawNumbers(engine, roomCode, [...bingoNumbers]);

  let drawGuard = 0;
  const lineSet = new Set([1, 2, 3, 4, 5]);
  // Først fullfør rad (LINE må claimes før BINGO)
  while (lineSet.size > 0 && drawGuard < 60) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostId,
    });
    if (bingoNumbers.has(number)) {
      await engine.markNumber({ roomCode, playerId: hostId, number });
      bingoNumbers.delete(number);
      lineSet.delete(number);
    }
    drawGuard += 1;
  }
  await engine.submitClaim({ roomCode, playerId: hostId, type: "LINE" });

  // Fortsett å trekke resten
  while (bingoNumbers.size > 0 && drawGuard < 150) {
    const { number } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: hostId,
    });
    if (bingoNumbers.has(number)) {
      await engine.markNumber({ roomCode, playerId: hostId, number });
      bingoNumbers.delete(number);
    }
    drawGuard += 1;
  }

  const bingoClaim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "BINGO",
  });
  assert.equal(bingoClaim.valid, true);

  const bingoPayouts = payoutTransfers(spy, "Bingo prize");
  assert.equal(bingoPayouts.length, 1, "én BINGO-payout registrert");
  assert.equal(
    bingoPayouts[0]!.options?.targetSide,
    "winnings",
    "BINGO-prize skal sende targetSide='winnings'"
  );
});

test("BingoEngine: awardExtraPrize bruker targetSide='winnings' (prize-mekanisme)", async () => {
  const spy = new SpyWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), spy);

  // Sørg for at house har saldo + spiller eksisterer.
  const hallId = "hall-1";
  const houseAccountId = `house-${hallId}-databingo-internet`;
  await spy.createAccount({ accountId: houseAccountId, initialBalance: 5000, allowExisting: true });
  await spy.createAccount({
    accountId: "wallet-bonus-player",
    initialBalance: 100,
    allowExisting: true,
  });

  // Oppdater policy for å tillate ekstrapremie
  await engine.upsertPrizePolicy({
    hallId,
    linkId: hallId,
    effectiveFrom: new Date(Date.now() - 1000).toISOString(),
    singlePrizeCap: 5000,
    dailyExtraPrizeCap: 5000,
  });

  spy.transfers.length = 0;

  await engine.awardExtraPrize({
    walletId: "wallet-bonus-player",
    hallId,
    linkId: hallId,
    amount: 500,
    reason: "PR-W3 test — ekstrapremie som payout",
  });

  const extras = spy.transfers.filter((t) => t.reason.includes("ekstrapremie"));
  assert.equal(extras.length, 1, "én ekstrapremie-transfer");
  assert.equal(
    extras[0]!.options?.targetSide,
    "winnings",
    "awardExtraPrize skal sende targetSide='winnings' (gameplay prize)"
  );
  assert.ok(
    extras[0]!.options?.idempotencyKey,
    "idempotencyKey (extra-prize-*) skal beholdes"
  );
});

test("BingoEngine: buy-in + ticket replace (player → house) bruker IKKE targetSide='winnings'", async () => {
  const spy = new SpyWalletAdapter();
  const engine = new BingoEngine(new FixedTicketAdapter(), spy, {
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 100,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });

  // Buy-in transfers har player som from og house som to.
  const buyIns = spy.transfers.filter((t) => t.reason.includes("buy-in"));
  assert.ok(buyIns.length >= 2, "to buy-ins (host + guest)");
  for (const b of buyIns) {
    // K2-A CRIT-1: default gameSlug "bingo" → MAIN_GAME, så house-account
    // er nå "house-hall-1-main_game-internet" (Spill 1 = hovedspill 15%).
    assert.equal(b.toAccountId, "house-hall-1-main_game-internet");
    // BUY-INs skal IKKE sende targetSide='winnings' (target er system-house
    // uansett, og default deposit er trygt).
    assert.notEqual(
      b.options?.targetSide,
      "winnings",
      "buy-in skal aldri targetSide='winnings'"
    );
  }
});
