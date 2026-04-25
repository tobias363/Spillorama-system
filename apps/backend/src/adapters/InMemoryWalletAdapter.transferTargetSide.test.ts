// PR-W3 wallet-split: verifiserer `transfer()` med `targetSide`-option.
//
// Dette supplerer InMemoryWalletAdapter.walletSplit.test.ts (PR-W1) — denne
// fokuserer kun på den nye `TransferOptions.targetSide`-kontrakten.
// Postgres-spesifikk oppførsel (system-konto som mottaker) dekkes i
// PostgresWalletAdapter.walletSplit.test.ts (opt-in DB-integration).

import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

// ── Basic targetSide contract ────────────────────────────────────────────────

test("transfer default (ingen targetSide): mottaker får beløp på deposit (bakoverkompat)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 500 });
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  await wallet.transfer("from", "to", 200, "refund");

  const fromBalances = await wallet.getBothBalances("from");
  const toBalances = await wallet.getBothBalances("to");
  assert.equal(fromBalances.deposit, 300, "avsender: deposit trukket 200");
  assert.equal(fromBalances.winnings, 0);
  assert.equal(toBalances.deposit, 200, "mottaker: deposit +200 (default)");
  assert.equal(toBalances.winnings, 0, "mottaker: winnings uendret");
});

test("transfer med { targetSide: 'deposit' } eksplisitt: samme som default", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 500 });
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  await wallet.transfer("from", "to", 150, "refund", { targetSide: "deposit" });

  const toBalances = await wallet.getBothBalances("to");
  assert.equal(toBalances.deposit, 150);
  assert.equal(toBalances.winnings, 0);
});

test("transfer med { targetSide: 'winnings' }: mottaker får beløp på winnings", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 1000 });
  await wallet.createAccount({ accountId: "to", initialBalance: 100 });

  const result = await wallet.transfer("from", "to", 500, "Spill 2 jackpot prize", {
    targetSide: "winnings",
  });

  const toBalances = await wallet.getBothBalances("to");
  assert.equal(toBalances.deposit, 100, "mottaker deposit uendret");
  assert.equal(toBalances.winnings, 500, "mottaker winnings +500");
  assert.equal(toBalances.total, 600);
  // toTx.split skal reflektere winnings-side.
  assert.deepEqual(result.toTx.split, { fromDeposit: 0, fromWinnings: 500 });
  assert.equal(result.toTx.type, "TRANSFER_IN");
});

// ── fromTx split (avsender-siden, uavhengig av targetSide) ──────────────────

test("transfer med targetSide='winnings': avsender følger fortsatt winnings-first-policy", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  // Avsender har både deposit og winnings
  await wallet.createAccount({ accountId: "from", initialBalance: 300 });
  await wallet.credit("from", 200, "prior payout", { to: "winnings" });
  // Før transfer: from.deposit=300, from.winnings=200, total=500
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  const result = await wallet.transfer("from", "to", 250, "next payout", {
    targetSide: "winnings",
  });

  // Winnings-first på avsender: 200 fra winnings, 50 fra deposit.
  const fromBalances = await wallet.getBothBalances("from");
  assert.equal(fromBalances.winnings, 0, "avsender winnings tømt");
  assert.equal(fromBalances.deposit, 250, "avsender deposit redusert med 50");
  assert.deepEqual(result.fromTx.split, { fromWinnings: 200, fromDeposit: 50 });

  // Mottaker får ALT på winnings (uavhengig av avsenders split).
  const toBalances = await wallet.getBothBalances("to");
  assert.equal(toBalances.winnings, 250);
  assert.equal(toBalances.deposit, 0);
});

// ── Idempotency med targetSide ───────────────────────────────────────────────

test("transfer idempotencyKey: gjentatt transfer returnerer samme tx (deposit)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 500 });
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  const r1 = await wallet.transfer("from", "to", 100, "retry-me", { idempotencyKey: "xfer-1" });
  const r2 = await wallet.transfer("from", "to", 100, "retry-me", { idempotencyKey: "xfer-1" });

  assert.equal(r1.fromTx.id, r2.fromTx.id, "samme fromTx.id returneres");
  assert.equal(r1.toTx.id, r2.toTx.id, "samme toTx.id returneres");

  // Saldo skal bare være trukket én gang.
  const toBalances = await wallet.getBothBalances("to");
  assert.equal(toBalances.deposit, 100);
  assert.equal(toBalances.winnings, 0);
});

test("transfer idempotencyKey: gjentatt transfer returnerer samme tx (winnings)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 500 });
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  const r1 = await wallet.transfer("from", "to", 100, "prize", {
    idempotencyKey: "payout-1",
    targetSide: "winnings",
  });
  const r2 = await wallet.transfer("from", "to", 100, "prize", {
    idempotencyKey: "payout-1",
    targetSide: "winnings",
  });

  assert.equal(r1.fromTx.id, r2.fromTx.id);
  assert.equal(r1.toTx.id, r2.toTx.id);
  assert.deepEqual(r1.toTx.split, r2.toTx.split);

  const toBalances = await wallet.getBothBalances("to");
  assert.equal(toBalances.winnings, 100, "prize kun kreditert én gang");
  assert.equal(toBalances.deposit, 0);
});

// Regresjonstest mot tidligere flaky-bug (PR #465, #472):
// Replay-lookupen for idempotens brukte `tx.createdAt === existing.createdAt`
// for å finne partner-tx. På trege CI-runnere ga separate `new Date()`-kall
// for fromTx/toTx ulike ms — partner-lookup feilet, code falt gjennom og
// utførte en ny dobbel transfer. Vi forcer her ulike timestamps per Date()-kall
// for å sikre at fixen bruker én delt `now` for begge tx-radene.
test("transfer idempotencyKey: deterministisk under clock-skew (regresjon mot CI flake)", async () => {
  const realToISO = Date.prototype.toISOString;
  let counter = 0;
  // Hver `new Date().toISOString()`-kall får unik monotont økende ms.
  Date.prototype.toISOString = function () {
    counter++;
    return realToISO.call(new Date(Date.UTC(2030, 0, 1, 0, 0, 0, counter)));
  };

  try {
    const wallet = new InMemoryWalletAdapter(0);
    await wallet.createAccount({ accountId: "from", initialBalance: 500 });
    await wallet.createAccount({ accountId: "to", initialBalance: 0 });

    const r1 = await wallet.transfer("from", "to", 100, "retry-me", {
      idempotencyKey: "xfer-skew",
    });
    const r2 = await wallet.transfer("from", "to", 100, "retry-me", {
      idempotencyKey: "xfer-skew",
    });

    assert.equal(r1.fromTx.id, r2.fromTx.id, "samme fromTx.id under clock-skew");
    assert.equal(r1.toTx.id, r2.toTx.id, "samme toTx.id under clock-skew");
    assert.equal(
      r1.fromTx.createdAt,
      r1.toTx.createdAt,
      "fromTx og toTx må ha identisk createdAt for at partner-lookup skal være deterministisk",
    );

    const toBalances = await wallet.getBothBalances("to");
    assert.equal(toBalances.deposit, 100, "deposit kreditert kun én gang (ikke dobbelt)");
    assert.equal(toBalances.winnings, 0);
    const fromBalances = await wallet.getBothBalances("from");
    assert.equal(fromBalances.deposit, 400, "from-deposit trukket kun én gang");
  } finally {
    Date.prototype.toISOString = realToISO;
  }
});

// ── Scenarios som speiler BingoEngine/Game2/Game3 payout-flows ──────────────

test("payout-simulering: house → player (winnings) — realistisk BingoEngine-flow", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  // House har funding fra buy-ins (i vår test: initial balance)
  await wallet.createAccount({ accountId: "house-hall1", initialBalance: 2000 });
  // Spiller kjøper billett → buy-in fjerner fra deposit
  await wallet.createAccount({ accountId: "player-alpha", initialBalance: 500 });

  // 1) Buy-in (player → house, default deposit-target)
  await wallet.transfer("player-alpha", "house-hall1", 100, "Bingo buy-in ROOM1");
  let p = await wallet.getBothBalances("player-alpha");
  assert.equal(p.deposit, 400, "buy-in trekker fra deposit");
  assert.equal(p.winnings, 0);

  // 2) Prize payout (house → player, targetSide='winnings')
  await wallet.transfer("house-hall1", "player-alpha", 250, "Line prize ROOM1", {
    targetSide: "winnings",
  });
  p = await wallet.getBothBalances("player-alpha");
  assert.equal(p.deposit, 400, "deposit uendret av prize");
  assert.equal(p.winnings, 250, "winnings +250");
  assert.equal(p.total, 650);

  // 3) Ny buy-in med både deposit+winnings (winnings-first-policy)
  await wallet.transfer("player-alpha", "house-hall1", 300, "Bingo buy-in ROOM2");
  p = await wallet.getBothBalances("player-alpha");
  assert.equal(p.winnings, 0, "winnings (250) tømt først");
  assert.equal(p.deposit, 350, "deposit trukket 50 (300-250)");
  assert.equal(p.total, 350);
});

// ── Edge case: samme wallet som from/to ──────────────────────────────────────

test("transfer til samme wallet: INVALID_TRANSFER (også med targetSide)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 100 });

  await assert.rejects(
    () => wallet.transfer("w1", "w1", 50, "self", { targetSide: "winnings" }),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_TRANSFER"
  );
});

// ── Edge case: insufficient funds ────────────────────────────────────────────

test("transfer med targetSide: INSUFFICIENT_FUNDS hvis avsender mangler saldo", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 50 });
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  await assert.rejects(
    () =>
      wallet.transfer("from", "to", 100, "too-much", {
        targetSide: "winnings",
      }),
    (err: unknown) => err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS"
  );

  // State uendret etter feil.
  const fromBalances = await wallet.getBothBalances("from");
  const toBalances = await wallet.getBothBalances("to");
  assert.equal(fromBalances.deposit, 50);
  assert.equal(toBalances.winnings, 0);
});

// ── Totalsjekk: balance = deposit + winnings etter transfer ─────────────────

test("transfer med targetSide='winnings': WalletAccount.balance = deposit + winnings", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 1000 });
  await wallet.createAccount({ accountId: "to", initialBalance: 200 });

  await wallet.transfer("from", "to", 300, "prize", { targetSide: "winnings" });

  const toAcc = await wallet.getAccount("to");
  assert.equal(toAcc.depositBalance, 200);
  assert.equal(toAcc.winningsBalance, 300);
  assert.equal(toAcc.balance, 500, "balance = deposit + winnings");
  assert.equal(toAcc.balance, toAcc.depositBalance + toAcc.winningsBalance);
});

// ── fromTx / toTx type verification ──────────────────────────────────────────

test("transfer med targetSide='winnings': fromTx=TRANSFER_OUT, toTx=TRANSFER_IN", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 500 });
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  const result = await wallet.transfer("from", "to", 100, "prize", { targetSide: "winnings" });

  assert.equal(result.fromTx.type, "TRANSFER_OUT");
  assert.equal(result.fromTx.accountId, "from");
  assert.equal(result.fromTx.relatedAccountId, "to");
  assert.equal(result.toTx.type, "TRANSFER_IN");
  assert.equal(result.toTx.accountId, "to");
  assert.equal(result.toTx.relatedAccountId, "from");
  assert.equal(result.toTx.amount, 100);
});

// ── Backward-compat: eksisterende TransactionOptions-bruk fortsatt fungerer ──

test("transfer med bare idempotencyKey (ingen targetSide): default deposit (bakoverkompat)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "from", initialBalance: 500 });
  await wallet.createAccount({ accountId: "to", initialBalance: 0 });

  const result = await wallet.transfer("from", "to", 75, "refund", {
    idempotencyKey: "legacy-call",
  });

  const toBalances = await wallet.getBothBalances("to");
  assert.equal(toBalances.deposit, 75, "default: alt på deposit");
  assert.equal(toBalances.winnings, 0);
  assert.deepEqual(result.toTx.split, { fromDeposit: 75, fromWinnings: 0 });
});
