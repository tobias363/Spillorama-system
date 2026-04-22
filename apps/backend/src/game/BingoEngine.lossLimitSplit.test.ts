// PR-W4 wallet-split: regresjonstester for loss-limit-fix.
//
// Regelen fra pengespillforskriften §11 + WALLET_SPLIT_DESIGN §3.4:
// kun deposit-delen av et buy-in-trekk skal telle mot loss-limit.
// Gevinst-konto-bruk skal IKKE øke netto-tap.
//
// Testen bruker en spy-adapter som simulerer winnings-first-debit-splitten
// fra PostgresWalletAdapter/InMemoryWalletAdapter (PR-W1/W3). Vi kjører
// BingoEngine gjennom buy-in og asserterer at compliance-entries bruker
// `split.fromDeposit` i stedet for full amount.

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BingoEngine, lossLimitAmountFromTransfer } from "./BingoEngine.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type {
  CreateWalletAccountInput,
  CreditOptions,
  TransferOptions,
  WalletAccount,
  WalletAdapter,
  WalletTransaction,
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { Ticket } from "./types.js";

// ── Split-aware spy-adapter ─────────────────────────────────────────────────

/**
 * Full in-memory wallet-adapter med winnings-first-debit-policy, matcher
 * PostgresWalletAdapter-semantikken. Forskjellig fra InMemoryWalletAdapter i
 * BingoEngine.test.ts som kun bruker én balance-kolonne.
 */
class SplitAwareWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private readonly transactions: WalletTransaction[] = [];
  private txCounter = 0;

  /** Test-helper: sett eksplisitt deposit/winnings på en wallet. */
  async seed(accountId: string, depositBalance: number, winningsBalance: number): Promise<void> {
    const now = new Date().toISOString();
    this.accounts.set(accountId, {
      id: accountId,
      balance: depositBalance + winningsBalance,
      depositBalance,
      winningsBalance,
      createdAt: now,
      updatedAt: now,
    });
  }

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const id = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const initial = Number(input?.initialBalance ?? 0);
    if (this.accounts.has(id) && !input?.allowExisting) {
      throw new WalletError("ACCOUNT_EXISTS", "Konto finnes allerede.");
    }
    const now = new Date().toISOString();
    const account: WalletAccount = {
      id,
      balance: initial,
      depositBalance: initial,
      winningsBalance: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(id, account);
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
    const acc = this.accounts.get(accountId.trim());
    if (!acc) throw new WalletError("ACCOUNT_NOT_FOUND", "Konto finnes ikke.");
    return { ...acc };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }

  async getBalance(id: string): Promise<number> {
    return (await this.getAccount(id)).balance;
  }
  async getDepositBalance(id: string): Promise<number> {
    return (await this.getAccount(id)).depositBalance;
  }
  async getWinningsBalance(id: string): Promise<number> {
    return (await this.getAccount(id)).winningsBalance;
  }
  async getBothBalances(id: string): Promise<{ deposit: number; winnings: number; total: number }> {
    const a = await this.getAccount(id);
    return { deposit: a.depositBalance, winnings: a.winningsBalance, total: a.balance };
  }

  async debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    // Ikke brukt i BingoEngine buy-in-flyt (som bruker transfer), men implementert
    // for fullstendighet.
    const acc = await this.ensureAccount(accountId);
    if (acc.balance < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", "Ikke nok saldo.");
    }
    const fromWinnings = Math.min(acc.winningsBalance, amount);
    const fromDeposit = amount - fromWinnings;
    this.accounts.set(acc.id, {
      ...acc,
      depositBalance: acc.depositBalance - fromDeposit,
      winningsBalance: acc.winningsBalance - fromWinnings,
      balance: acc.balance - amount,
      updatedAt: new Date().toISOString(),
    });
    return this.pushTx(acc.id, "DEBIT", amount, reason, undefined, { fromDeposit, fromWinnings });
  }

  async credit(
    accountId: string,
    amount: number,
    reason: string,
    options?: CreditOptions
  ): Promise<WalletTransaction> {
    const acc = await this.ensureAccount(accountId);
    const targetSide = options?.to ?? "deposit";
    this.accounts.set(acc.id, {
      ...acc,
      depositBalance: targetSide === "deposit" ? acc.depositBalance + amount : acc.depositBalance,
      winningsBalance: targetSide === "winnings" ? acc.winningsBalance + amount : acc.winningsBalance,
      balance: acc.balance + amount,
      updatedAt: new Date().toISOString(),
    });
    return this.pushTx(
      acc.id,
      "CREDIT",
      amount,
      reason,
      undefined,
      targetSide === "winnings"
        ? { fromDeposit: 0, fromWinnings: amount }
        : { fromDeposit: amount, fromWinnings: 0 }
    );
  }

  async topUp(accountId: string, amount: number, reason = "Top-up"): Promise<WalletTransaction> {
    const acc = await this.ensureAccount(accountId);
    this.accounts.set(acc.id, {
      ...acc,
      depositBalance: acc.depositBalance + amount,
      balance: acc.balance + amount,
      updatedAt: new Date().toISOString(),
    });
    return this.pushTx(acc.id, "TOPUP", amount, reason, undefined, { fromDeposit: amount, fromWinnings: 0 });
  }

  async withdraw(accountId: string, amount: number, reason = "Withdraw"): Promise<WalletTransaction> {
    const acc = await this.ensureAccount(accountId);
    if (acc.balance < amount) throw new WalletError("INSUFFICIENT_FUNDS", "Ikke nok saldo.");
    const fromWinnings = Math.min(acc.winningsBalance, amount);
    const fromDeposit = amount - fromWinnings;
    this.accounts.set(acc.id, {
      ...acc,
      depositBalance: acc.depositBalance - fromDeposit,
      winningsBalance: acc.winningsBalance - fromWinnings,
      balance: acc.balance - amount,
      updatedAt: new Date().toISOString(),
    });
    return this.pushTx(acc.id, "WITHDRAWAL", amount, reason, undefined, { fromDeposit, fromWinnings });
  }

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Transfer",
    options?: TransferOptions
  ): Promise<WalletTransferResult> {
    const from = await this.ensureAccount(fromAccountId);
    const to = await this.ensureAccount(toAccountId);
    if (from.balance < amount) {
      throw new WalletError("INSUFFICIENT_FUNDS", "Ikke nok saldo.");
    }
    // Winnings-first-split på avsender (PR-W1).
    const fromWinnings = Math.min(from.winningsBalance, amount);
    const fromDeposit = amount - fromWinnings;
    this.accounts.set(from.id, {
      ...from,
      depositBalance: from.depositBalance - fromDeposit,
      winningsBalance: from.winningsBalance - fromWinnings,
      balance: from.balance - amount,
      updatedAt: new Date().toISOString(),
    });
    // Mottaker-side: targetSide (default deposit).
    const targetSide = options?.targetSide ?? "deposit";
    this.accounts.set(to.id, {
      ...to,
      depositBalance: targetSide === "deposit" ? to.depositBalance + amount : to.depositBalance,
      winningsBalance: targetSide === "winnings" ? to.winningsBalance + amount : to.winningsBalance,
      balance: to.balance + amount,
      updatedAt: new Date().toISOString(),
    });
    const fromTx = this.pushTx(from.id, "TRANSFER_OUT", amount, reason, to.id, { fromDeposit, fromWinnings });
    const toTx = this.pushTx(
      to.id,
      "TRANSFER_IN",
      amount,
      reason,
      from.id,
      targetSide === "winnings"
        ? { fromDeposit: 0, fromWinnings: amount }
        : { fromDeposit: amount, fromWinnings: 0 }
    );
    return { fromTx, toTx };
  }

  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    return this.transactions
      .filter((tx) => tx.accountId === accountId.trim())
      .slice(-limit)
      .map((tx) => ({ ...tx }));
  }

  private pushTx(
    accountId: string,
    type: WalletTransaction["type"],
    amount: number,
    reason: string,
    relatedAccountId: string | undefined,
    split: { fromDeposit: number; fromWinnings: number }
  ): WalletTransaction {
    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`,
      accountId,
      type,
      amount,
      reason,
      createdAt: new Date().toISOString(),
      relatedAccountId,
      split,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

interface LossEntry {
  type: "BUYIN" | "PAYOUT";
  amount: number;
  createdAtMs: number;
}

async function makeEngineWithPlayer(
  wallet: SplitAwareWalletAdapter,
  deposit: number,
  winnings: number
): Promise<{ engine: BingoEngine; roomCode: string; playerId: string; walletId: string }> {
  const walletId = `wallet-player-${randomUUID()}`;
  await wallet.seed(walletId, deposit, winnings);

  // Guest-spiller (minst 2 krevd av startGame); ingen relevant saldo — vi
  // asserterer kun på playerId-walletens loss-entries.
  const guestWalletId = `wallet-guest-${randomUUID()}`;
  await wallet.seed(guestWalletId, 1000, 0);

  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Player",
    walletId,
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: guestWalletId,
  });
  return { engine, roomCode, playerId, walletId };
}

/** Les compliance loss-entries fra private state for assertion. */
function getLossEntries(engine: BingoEngine, walletId: string, hallId: string): LossEntry[] {
  // Cast til unknown først for å omgå privat synlighet — kun i testkontekst.
  const compliance = (
    engine as unknown as {
      compliance: {
        makeLossScopeKey: (walletId: string, hallId: string) => string;
        lossEntriesByScope: Map<string, LossEntry[]>;
      };
    }
  ).compliance;
  const key = compliance.makeLossScopeKey(walletId, hallId);
  return [...(compliance.lossEntriesByScope.get(key) ?? [])];
}

// ── Testene ─────────────────────────────────────────────────────────────────

test("PR-W4: 100% deposit-kjøp — BUYIN-entry får full amount (bakoverkompat)", async () => {
  const wallet = new SplitAwareWalletAdapter();
  const { engine, roomCode, playerId, walletId } = await makeEngineWithPlayer(
    wallet,
    200, // 200 kr deposit
    0 // 0 winnings — alt kjøpes fra deposit
  );

  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 50,
    ticketsPerPlayer: 2, // 2 × 50 = 100 kr buyIn
    payoutPercent: 50,
  });

  const entries = getLossEntries(engine, walletId, "hall-1");
  const buyIns = entries.filter((e) => e.type === "BUYIN");
  assert.equal(buyIns.length, 1, "skal ha én BUYIN-entry");
  assert.equal(buyIns[0]!.amount, 100, "full 100 kr skal være registrert (alt deposit)");

  // Verifiser saldo etter: deposit 100, winnings 0
  const bal = await wallet.getBothBalances(walletId);
  assert.equal(bal.deposit, 100);
  assert.equal(bal.winnings, 0);
});

test("PR-W4: blandet deposit + winnings — kun deposit-delen logges som BUYIN", async () => {
  const wallet = new SplitAwareWalletAdapter();
  const { engine, roomCode, playerId, walletId } = await makeEngineWithPlayer(
    wallet,
    100, // 100 kr deposit
    50 // 50 kr winnings
  );

  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 50,
    ticketsPerPlayer: 3, // 3 × 50 = 150 kr buyIn (>= 150)
    payoutPercent: 50,
  });

  const entries = getLossEntries(engine, walletId, "hall-1");
  const buyIns = entries.filter((e) => e.type === "BUYIN");
  assert.equal(buyIns.length, 1, "skal ha én BUYIN-entry");
  // Winnings-first: 50 fra winnings + 100 fra deposit → BUYIN.amount = 100 (kun deposit)
  assert.equal(
    buyIns[0]!.amount,
    100,
    `kun deposit-del skal telle — forventet 100, fikk ${buyIns[0]!.amount}`
  );

  // Saldo: deposit 0, winnings 0
  const bal = await wallet.getBothBalances(walletId);
  assert.equal(bal.deposit, 0);
  assert.equal(bal.winnings, 0);
});

test("PR-W4: 100% winnings-kjøp — BUYIN = 0 (netto-loss påvirkes ikke av gevinst-bruk)", async () => {
  const wallet = new SplitAwareWalletAdapter();
  const { engine, roomCode, playerId, walletId } = await makeEngineWithPlayer(
    wallet,
    0, // 0 deposit
    200 // 200 winnings — nok til kjøp
  );

  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 50,
    ticketsPerPlayer: 2, // 2 × 50 = 100 kr — alt fra winnings
    payoutPercent: 50,
  });

  const entries = getLossEntries(engine, walletId, "hall-1");
  const buyIns = entries.filter((e) => e.type === "BUYIN");
  assert.equal(buyIns.length, 1, "skal ha én BUYIN-entry");
  assert.equal(
    buyIns[0]!.amount,
    0,
    "100% winnings-kjøp skal gi BUYIN = 0 — gevinst-bruk ikke skal telle mot loss-limit"
  );

  // Netto-tap skal ikke bevege seg
  const netLoss = (
    engine as unknown as {
      compliance: { calculateNetLoss: (w: string, now: number, h: string) => { daily: number; monthly: number } };
    }
  ).compliance.calculateNetLoss(walletId, Date.now(), "hall-1");
  assert.equal(netLoss.daily, 0, "daily netto-tap skal være 0 når kun winnings brukes");
});

test("PR-W4: netto-beregning — 100 deposit buy-in + 80 payout → netto 20", async () => {
  // Scenario: spiller setter inn 100 kr, kjøper bong for 100, vinner 80.
  // Netto-tap = 100 (BUYIN) - 80 (PAYOUT) = 20. Ekte regresjon — eksisterende
  // formel skal fortsette å gi riktig resultat med nye W4-entries.
  const wallet = new SplitAwareWalletAdapter();
  const walletId = `wallet-${randomUUID()}`;
  const hallId = "hall-1";
  await wallet.seed(walletId, 100, 0);
  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    maxDrawsPerRound: 60,
    minDrawIntervalMs: 0,
  });

  // Simuler BUYIN-entry via recordLossEntry (med W4-semantikk: amount = deposit-del).
  const compliance = (
    engine as unknown as {
      compliance: {
        recordLossEntry: (w: string, h: string, e: LossEntry) => Promise<void>;
        calculateNetLoss: (w: string, now: number, h: string) => { daily: number; monthly: number };
      };
    }
  ).compliance;

  const nowMs = Date.now();
  await compliance.recordLossEntry(walletId, hallId, {
    type: "BUYIN",
    amount: 100, // deposit-del
    createdAtMs: nowMs,
  });
  await compliance.recordLossEntry(walletId, hallId, {
    type: "PAYOUT",
    amount: 80,
    createdAtMs: nowMs + 1,
  });

  const netLoss = compliance.calculateNetLoss(walletId, nowMs + 2, hallId);
  assert.equal(netLoss.daily, 20, "netto-tap = 100 BUYIN - 80 PAYOUT = 20 kr");
});

test("PR-W4: chargeTicketReplacement — blandet winnings+deposit logger kun deposit-delen", async () => {
  const wallet = new SplitAwareWalletAdapter();
  const { engine, roomCode, playerId, walletId } = await makeEngineWithPlayer(
    wallet,
    60, // 60 deposit
    40 // 40 winnings
  );
  // chargeTicketReplacement krever at ingen RUNNING game — så vi kjører den
  // FØR startGame. Spiller har 100 kr saldo totalt.

  // Replace 50: winnings-first → 40 fra winnings + 10 fra deposit → BUYIN-amount = 10
  await engine.chargeTicketReplacement(roomCode, playerId, 50, `replace-test-${randomUUID()}`);

  const entries = getLossEntries(engine, walletId, "hall-1");
  assert.equal(entries.length, 1, "skal ha én BUYIN-entry fra replace");
  assert.equal(entries[0]!.type, "BUYIN");
  assert.equal(
    entries[0]!.amount,
    10,
    "kun deposit-del (10 kr) skal telle mot loss-limit (winnings 40 spent, deposit 10 spent)"
  );

  // Post-state: winnings 0, deposit 50
  const bal = await wallet.getBothBalances(walletId);
  assert.equal(bal.winnings, 0, "winnings skulle være 0 etter winnings-first");
  assert.equal(bal.deposit, 50, "deposit skulle være 50 (60-10)");
});

// ── Direct unit-tests av helper-funksjonen ─────────────────────────────────

test("PR-W4: lossLimitAmountFromTransfer — tx uten split returnerer full total (fallback)", () => {
  const tx: WalletTransaction = {
    id: "legacy-tx-1",
    accountId: "w1",
    type: "TRANSFER_OUT",
    amount: 150,
    reason: "Legacy buy-in",
    createdAt: new Date().toISOString(),
    // ingen `split`-felt — legacy-path
  };
  assert.equal(lossLimitAmountFromTransfer(tx, 150), 150, "fallback = total amount");
});

test("PR-W4: lossLimitAmountFromTransfer — tx med split returnerer kun deposit-delen", () => {
  const tx: WalletTransaction = {
    id: "tx-split",
    accountId: "w1",
    type: "TRANSFER_OUT",
    amount: 150,
    reason: "Buy-in",
    createdAt: new Date().toISOString(),
    split: { fromDeposit: 100, fromWinnings: 50 },
  };
  assert.equal(lossLimitAmountFromTransfer(tx, 150), 100, "kun fromDeposit teller");
});

test("PR-W4: lossLimitAmountFromTransfer — 100% winnings-tx returnerer 0", () => {
  const tx: WalletTransaction = {
    id: "tx-all-winnings",
    accountId: "w1",
    type: "TRANSFER_OUT",
    amount: 100,
    reason: "Buy-in",
    createdAt: new Date().toISOString(),
    split: { fromDeposit: 0, fromWinnings: 100 },
  };
  assert.equal(lossLimitAmountFromTransfer(tx, 100), 0);
});

test("PR-W4: lossLimitAmountFromTransfer — negative/NaN fromDeposit håndteres trygt", () => {
  const tx: WalletTransaction = {
    id: "tx-bad",
    accountId: "w1",
    type: "TRANSFER_OUT",
    amount: 100,
    reason: "Buy-in",
    createdAt: new Date().toISOString(),
    split: { fromDeposit: Number.NaN, fromWinnings: 0 },
  };
  assert.equal(lossLimitAmountFromTransfer(tx, 100), 0, "NaN → 0 (fail-safe)");
});
