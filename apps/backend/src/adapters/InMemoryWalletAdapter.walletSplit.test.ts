// PR-W1 wallet-split: verifiserer kontrakten på InMemoryWalletAdapter.
//
// InMemoryWalletAdapter bruker samme logikk som PostgresWalletAdapter for
// split-beregning (winnings-first i debit, `to` i credit, topup→deposit).
// Denne testsuite dekker kontrakten uten Postgres-avhengighet, så den kjører
// i alle CI-miljøer. Postgres-spesifikk oppførsel (FOR UPDATE race, CHECK-
// constraints) dekkes i egen DB-integration-test når PG-container er på.

import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

// ── Grunnleggende split-operasjoner ──────────────────────────────────────────

test("createAccount: initial funding lander på deposit-siden (PM-lås)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  const acc = await wallet.createAccount({ accountId: "w1", initialBalance: 500 });
  assert.equal(acc.balance, 500);
  assert.equal(acc.depositBalance, 500);
  assert.equal(acc.winningsBalance, 0);
});

test("topUp: alltid deposit-siden (PM-lås — ikke overstyrbar)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 100 });
  const tx = await wallet.topUp("w1", 200);
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.deposit, 300, "topup lander på deposit");
  assert.equal(balances.winnings, 0, "topup berører ikke winnings");
  assert.equal(balances.total, 300);
  assert.deepEqual(tx.split, { fromDeposit: 200, fromWinnings: 0 });
});

test("credit default: lander på deposit (bakoverkompat med pre-W1)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 0 });
  const tx = await wallet.credit("w1", 300, "Refund");
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.deposit, 300);
  assert.equal(balances.winnings, 0);
  assert.deepEqual(tx.split, { fromDeposit: 300, fromWinnings: 0 });
});

test("credit with {to:'winnings'}: lander kun på winnings-siden", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 0 });
  const tx = await wallet.credit("w1", 500, "Payout", { to: "winnings" });
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.deposit, 0, "deposit uendret av winnings-credit");
  assert.equal(balances.winnings, 500);
  assert.equal(balances.total, 500);
  assert.deepEqual(tx.split, { fromDeposit: 0, fromWinnings: 500 });
});

test("credit med {to:'deposit'} eksplisitt: samme som default", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 0 });
  await wallet.credit("w1", 100, "Topup", { to: "deposit" });
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.deposit, 100);
  assert.equal(balances.winnings, 0);
});

// ── Winnings-first debit-policy ──────────────────────────────────────────────

test("debit: når winnings > amount, trekkes KUN fra winnings", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 100 });
  await wallet.credit("w1", 500, "payout", { to: "winnings" });
  // Før debit: deposit=100, winnings=500, total=600
  const tx = await wallet.debit("w1", 300, "Kjøp billett");
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.winnings, 200, "winnings redusert fra 500 til 200");
  assert.equal(balances.deposit, 100, "deposit uberørt");
  assert.deepEqual(tx.split, { fromWinnings: 300, fromDeposit: 0 });
});

test("debit: når winnings < amount, tom winnings først, rest fra deposit", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 200 });
  await wallet.credit("w1", 50, "small payout", { to: "winnings" });
  // Før debit: deposit=200, winnings=50, total=250
  const tx = await wallet.debit("w1", 150, "Kjøp billett");
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.winnings, 0, "winnings tømt");
  assert.equal(balances.deposit, 100, "deposit trukket med 100 (150-50)");
  assert.deepEqual(tx.split, { fromWinnings: 50, fromDeposit: 100 });
});

test("debit: winnings = 0 → alt trekkes fra deposit (matcher pre-W1-oppførsel)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 500 });
  const tx = await wallet.debit("w1", 200, "Kjøp");
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.deposit, 300);
  assert.equal(balances.winnings, 0);
  assert.deepEqual(tx.split, { fromWinnings: 0, fromDeposit: 200 });
});

test("debit: total < amount → INSUFFICIENT_FUNDS uten endring", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 100 });
  await wallet.credit("w1", 50, "payout", { to: "winnings" });
  await assert.rejects(
    () => wallet.debit("w1", 200, "Kjøp"),
    (err: unknown) => err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS"
  );
  // State uendret etter feil.
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.deposit, 100);
  assert.equal(balances.winnings, 50);
});

// ── Withdraw (winnings-first per PM-lås) ─────────────────────────────────────

test("withdraw: winnings-first, så deposit (PM-lås)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 300 });
  await wallet.credit("w1", 200, "payout", { to: "winnings" });
  const tx = await wallet.withdraw("w1", 400, "uttak");
  const balances = await wallet.getBothBalances("w1");
  assert.equal(balances.winnings, 0, "winnings tømt først");
  assert.equal(balances.deposit, 100, "deposit redusert med 200 (400-200)");
  assert.deepEqual(tx.split, { fromWinnings: 200, fromDeposit: 200 });
});

// ── getBothBalances-kontrakt ────────────────────────────────────────────────

test("getBothBalances: returnerer konsistent deposit/winnings/total", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 250 });
  await wallet.credit("w1", 100, "payout", { to: "winnings" });
  const b = await wallet.getBothBalances("w1");
  assert.equal(b.deposit, 250);
  assert.equal(b.winnings, 100);
  assert.equal(b.total, 350);
  assert.equal(b.total, b.deposit + b.winnings, "total == deposit + winnings");
});

// ── Bakoverkompat ─────────────────────────────────────────────────────────────

test("getBalance() returnerer deposit + winnings (bakoverkompat)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 100 });
  await wallet.credit("w1", 250, "payout", { to: "winnings" });
  assert.equal(await wallet.getBalance("w1"), 350);
});

test("WalletAccount.balance matcher deposit + winnings etter ulike operasjoner", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 0 });
  await wallet.topUp("w1", 1000);
  await wallet.credit("w1", 500, "payout", { to: "winnings" });
  await wallet.debit("w1", 200, "kjøp");
  const acc = await wallet.getAccount("w1");
  assert.equal(acc.balance, acc.depositBalance + acc.winningsBalance);
  assert.equal(acc.balance, 1300);
  // Winnings-first på debit: winnings (500) - 200 = 300, deposit uberørt (1000)
  assert.equal(acc.depositBalance, 1000);
  assert.equal(acc.winningsBalance, 300);
});

// ── Idempotency + split-rekonstruksjon ──────────────────────────────────────

test("idempotencyKey: gjentatt debit returnerer samme transaksjon med samme split", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 500 });
  await wallet.credit("w1", 200, "payout", { to: "winnings" });
  const tx1 = await wallet.debit("w1", 300, "kjøp", { idempotencyKey: "buy-1" });
  const tx2 = await wallet.debit("w1", 300, "kjøp", { idempotencyKey: "buy-1" });
  assert.equal(tx1.id, tx2.id, "samme tx returneres");
  assert.deepEqual(tx1.split, tx2.split);
  // Saldo skal bare være trukket én gang.
  const b = await wallet.getBothBalances("w1");
  // Winnings-first: 200 fra winnings, 100 fra deposit → winnings=0, deposit=400.
  assert.equal(b.winnings, 0);
  assert.equal(b.deposit, 400);
});

// ── Simulert race: to parallelle debits ─────────────────────────────────────
//
// InMemoryAdapter er single-threaded (Node event loop), men vi simulerer det
// ved å awaite begge Promisene i samme tick. Den andre skal se post-state av
// den første (winnings-first atomisk).

test("to sekvensielle debits mot delt winnings → andre treffer deposit", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 500 });
  await wallet.credit("w1", 100, "payout", { to: "winnings" });
  // Debit 1: trekk 80 — forventet winnings=20, deposit=500.
  const tx1 = await wallet.debit("w1", 80, "kjøp-1");
  assert.deepEqual(tx1.split, { fromWinnings: 80, fromDeposit: 0 });
  // Debit 2: trekk 80 — forventet winnings=0, deposit=440 (20 fra winnings + 60 fra deposit).
  const tx2 = await wallet.debit("w1", 80, "kjøp-2");
  assert.deepEqual(tx2.split, { fromWinnings: 20, fromDeposit: 60 });
  const b = await wallet.getBothBalances("w1");
  assert.equal(b.winnings, 0);
  assert.equal(b.deposit, 440);
});

// ── Regulatorisk: credit til winnings fra game-engine ───────────────────────
//
// Tesien dokumenterer at interfacet TILLATER `to:"winnings"`. Policy-enforcement
// (at KUN game-engine gjør det) er implementert i PR-W2 via eksplisitt call-site-
// migrering. Admin-routes har ingen credit-endepunkt (verifisert i separat audit).

test("credit {to:'winnings'} lykkes (game-engine må kunne kreditere winnings)", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w1", initialBalance: 0 });
  const tx = await wallet.credit("w1", 1000, "Game1 payout", { to: "winnings" });
  assert.equal(tx.amount, 1000);
  assert.deepEqual(tx.split, { fromDeposit: 0, fromWinnings: 1000 });
  const b = await wallet.getBothBalances("w1");
  assert.equal(b.winnings, 1000);
});
