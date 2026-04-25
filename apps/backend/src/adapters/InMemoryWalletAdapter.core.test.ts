/**
 * InMemoryWalletAdapter — core path tests.
 *
 * Eksisterende suite (`InMemoryWalletAdapter.reservation.test.ts`,
 * `InMemoryWalletAdapter.walletSplit.test.ts`,
 * `InMemoryWalletAdapter.transferTargetSide.test.ts`) dekker reservasjons-
 * flyt, wallet-split (deposit/winnings), og transfer-target-side. Disse
 * testene fyller hullene:
 *
 *   - createAccount / ensureAccount / getAccount / listAccounts
 *   - listTransactions (filter, limit, ordering)
 *   - Negative paths (ACCOUNT_EXISTS, INVALID_AMOUNT, INVALID_ACCOUNT_ID)
 *   - Idempotency (debit, credit, topUp, withdraw, transfer)
 *   - Boundary-tilfeller (0-saldo, max-amount, leading/trailing whitespace)
 *
 * Ingen kjente bugs som er fanget her — målet er å hindre fremtidig regresjon.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";
import { WalletError } from "./WalletAdapter.js";

// ── createAccount ──────────────────────────────────────────────────────────

test("createAccount: oppretter konto med default initial balance", async () => {
  const adapter = new InMemoryWalletAdapter(500);
  const account = await adapter.createAccount({ accountId: "w-1" });
  assert.equal(account.id, "w-1");
  assert.equal(account.balance, 500);
  assert.equal(account.depositBalance, 500);
  assert.equal(account.winningsBalance, 0);
  assert.match(account.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("createAccount: explicit initialBalance overstyrer default", async () => {
  const adapter = new InMemoryWalletAdapter(1000);
  const account = await adapter.createAccount({ accountId: "w-1", initialBalance: 250 });
  assert.equal(account.depositBalance, 250);
});

test("createAccount: random accountId hvis ikke spesifisert", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  const account = await adapter.createAccount();
  assert.match(account.id, /^wallet-/);
});

test("createAccount: ACCOUNT_EXISTS når kontoen finnes uten allowExisting", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  await assert.rejects(
    () => adapter.createAccount({ accountId: "w-1" }),
    (err: unknown) => err instanceof WalletError && err.code === "ACCOUNT_EXISTS",
  );
});

test("createAccount: allowExisting=true returnerer eksisterende uten å feile", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  const first = await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });
  const second = await adapter.createAccount({ accountId: "w-1", allowExisting: true });
  assert.equal(second.id, first.id);
  assert.equal(second.depositBalance, 200);
});

test("createAccount: avviser negativ initialBalance (INVALID_AMOUNT)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await assert.rejects(
    () => adapter.createAccount({ accountId: "w-1", initialBalance: -1 }),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
});

test("createAccount: 0 initialBalance er OK (boundary)", async () => {
  const adapter = new InMemoryWalletAdapter(100);
  const account = await adapter.createAccount({ accountId: "w-1", initialBalance: 0 });
  assert.equal(account.balance, 0);
  // Ingen TOPUP-tx hvis initialBalance = 0
  const txs = await adapter.listTransactions("w-1");
  assert.equal(txs.length, 0);
});

test("createAccount: trimmer whitespace fra accountId", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  const account = await adapter.createAccount({ accountId: "  w-1  " });
  assert.equal(account.id, "w-1");
});

// ── ensureAccount ──────────────────────────────────────────────────────────

test("ensureAccount: returnerer eksisterende konto", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });
  const ensured = await adapter.ensureAccount("w-1");
  assert.equal(ensured.id, "w-1");
  assert.equal(ensured.depositBalance, 200);
});

test("ensureAccount: oppretter ny konto hvis ikke eksisterer", async () => {
  const adapter = new InMemoryWalletAdapter(750);
  const ensured = await adapter.ensureAccount("w-new");
  assert.equal(ensured.id, "w-new");
  assert.equal(ensured.balance, 750);
});

test("ensureAccount: tom accountId kastes (INVALID_ACCOUNT_ID)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await assert.rejects(
    () => adapter.ensureAccount(""),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_ACCOUNT_ID",
  );
});

// ── getAccount + listAccounts ──────────────────────────────────────────────

test("getAccount: kjent konto returneres", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  const account = await adapter.getAccount("w-1");
  assert.equal(account.id, "w-1");
});

test("getAccount: ukjent konto auto-creates (ensureAccountInternal-pattern)", async () => {
  const adapter = new InMemoryWalletAdapter(50);
  // Note: getAccount kaller ensureAccountInternal som auto-oppretter
  const account = await adapter.getAccount("w-new");
  assert.equal(account.id, "w-new");
  assert.equal(account.balance, 50);
});

test("listAccounts: returnerer alle kontoer sortert på createdAt", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  await new Promise((r) => setTimeout(r, 5));
  await adapter.createAccount({ accountId: "w-2" });
  const accounts = await adapter.listAccounts();
  assert.equal(accounts.length, 2);
  // Sortert eldst → nyest
  assert.ok(accounts[0].createdAt <= accounts[1].createdAt);
});

test("listAccounts: tom adapter → tom liste", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  assert.deepEqual(await adapter.listAccounts(), []);
});

// ── debit / credit / topUp / withdraw — INVALID_AMOUNT ─────────────────────

test("debit: 0-amount avvises (INVALID_AMOUNT)", async () => {
  const adapter = new InMemoryWalletAdapter(100);
  await adapter.createAccount({ accountId: "w-1" });
  await assert.rejects(
    () => adapter.debit("w-1", 0, "test"),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
});

test("debit: negativ avvises", async () => {
  const adapter = new InMemoryWalletAdapter(100);
  await adapter.createAccount({ accountId: "w-1" });
  await assert.rejects(
    () => adapter.debit("w-1", -1, "test"),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
});

test("debit: NaN/Infinity avvises", async () => {
  const adapter = new InMemoryWalletAdapter(100);
  await adapter.createAccount({ accountId: "w-1" });
  await assert.rejects(
    () => adapter.debit("w-1", Number.NaN, "test"),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
  await assert.rejects(
    () => adapter.debit("w-1", Number.POSITIVE_INFINITY, "test"),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
});

test("credit: 0/negativ/NaN avvises", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  await assert.rejects(() => adapter.credit("w-1", 0, "x"), WalletError);
  await assert.rejects(() => adapter.credit("w-1", -1, "x"), WalletError);
  await assert.rejects(() => adapter.credit("w-1", Number.NaN, "x"), WalletError);
});

test("topUp: 0/negativ avvises", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  await assert.rejects(() => adapter.topUp("w-1", 0), WalletError);
  await assert.rejects(() => adapter.topUp("w-1", -1), WalletError);
});

test("withdraw: 0/negativ avvises", async () => {
  const adapter = new InMemoryWalletAdapter(100);
  await adapter.createAccount({ accountId: "w-1" });
  await assert.rejects(() => adapter.withdraw("w-1", 0), WalletError);
  await assert.rejects(() => adapter.withdraw("w-1", -1), WalletError);
});

test("withdraw: INSUFFICIENT_FUNDS når total < amount", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 50 });
  await assert.rejects(
    () => adapter.withdraw("w-1", 100),
    (err: unknown) => err instanceof WalletError && err.code === "INSUFFICIENT_FUNDS",
  );
});

// ── Idempotens ──────────────────────────────────────────────────────────────

test("debit: idempotencyKey returnerer samme transaksjon to ganger", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });
  const first = await adapter.debit("w-1", 50, "test", { idempotencyKey: "key-1" });
  const second = await adapter.debit("w-1", 50, "test", { idempotencyKey: "key-1" });
  assert.equal(first.id, second.id);
  // Saldo bare endret én gang
  const balance = await adapter.getBalance("w-1");
  assert.equal(balance, 150);
});

test("credit: idempotencyKey returnerer samme transaksjon to ganger", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  const first = await adapter.credit("w-1", 100, "x", { idempotencyKey: "k-1" });
  const second = await adapter.credit("w-1", 100, "x", { idempotencyKey: "k-1" });
  assert.equal(first.id, second.id);
});

test("topUp: idempotencyKey returnerer samme transaksjon to ganger", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  const first = await adapter.topUp("w-1", 100, "x", { idempotencyKey: "k-1" });
  const second = await adapter.topUp("w-1", 100, "x", { idempotencyKey: "k-1" });
  assert.equal(first.id, second.id);
  const balance = await adapter.getBalance("w-1");
  assert.equal(balance, 100);
});

test("withdraw: idempotencyKey returnerer samme transaksjon to ganger", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 200 });
  const first = await adapter.withdraw("w-1", 50, "x", { idempotencyKey: "k-1" });
  const second = await adapter.withdraw("w-1", 50, "x", { idempotencyKey: "k-1" });
  assert.equal(first.id, second.id);
  const balance = await adapter.getBalance("w-1");
  assert.equal(balance, 150);
});

// ── transfer ───────────────────────────────────────────────────────────────

test("transfer: avviser tom from-id (INVALID_ACCOUNT_ID)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-2" });
  await assert.rejects(
    () => adapter.transfer("", "w-2", 100),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_ACCOUNT_ID",
  );
});

test("transfer: INVALID_AMOUNT for 0 / negativ", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  await adapter.createAccount({ accountId: "w-2" });
  await assert.rejects(
    () => adapter.transfer("w-1", "w-2", 0),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
  await assert.rejects(
    () => adapter.transfer("w-1", "w-2", -1),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_AMOUNT",
  );
});

// ── listTransactions ───────────────────────────────────────────────────────

test("listTransactions: returnerer transaksjoner i revers (nyest først)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  await adapter.topUp("w-1", 50, "topup-1");
  await adapter.topUp("w-1", 75, "topup-2");
  const txs = await adapter.listTransactions("w-1");
  assert.equal(txs[0].reason, "topup-2");
  assert.equal(txs[1].reason, "topup-1");
});

test("listTransactions: limit avkorter resultat (siste N transaksjoner)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  for (let i = 0; i < 5; i++) await adapter.topUp("w-1", 10, `tx-${i}`);
  const txs = await adapter.listTransactions("w-1", 2);
  assert.equal(txs.length, 2);
});

test("listTransactions: filtrerer per accountId (ingen cross-account leak)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  await adapter.createAccount({ accountId: "w-2" });
  await adapter.topUp("w-1", 100, "w1-tx");
  await adapter.topUp("w-2", 200, "w2-tx");
  const w1 = await adapter.listTransactions("w-1");
  const w2 = await adapter.listTransactions("w-2");
  assert.ok(w1.every((tx) => tx.accountId === "w-1"));
  assert.ok(w2.every((tx) => tx.accountId === "w-2"));
});

test("listTransactions: returnerer kopier (ikke deler intern ledger-state)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1" });
  await adapter.topUp("w-1", 100, "tx-1");
  const txs1 = await adapter.listTransactions("w-1");
  txs1[0].reason = "MUTATED";
  const txs2 = await adapter.listTransactions("w-1");
  assert.equal(txs2[0].reason, "tx-1");
});

// ── debit + credit balance-konsistens ───────────────────────────────────────

test("debit reduserer total-balance med eksakt amount", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 1000 });
  await adapter.debit("w-1", 250, "test");
  const balance = await adapter.getBalance("w-1");
  assert.equal(balance, 750);
});

test("credit deposit øker depositBalance, ikke winnings", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  await adapter.credit("w-1", 50, "x"); // default = deposit
  const balances = await adapter.getBothBalances("w-1");
  assert.equal(balances.deposit, 150);
  assert.equal(balances.winnings, 0);
});

test("credit winnings øker winnings, ikke deposit (regulatorisk-kritisk)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  await adapter.credit("w-1", 75, "payout", { to: "winnings" });
  const balances = await adapter.getBothBalances("w-1");
  assert.equal(balances.deposit, 100);
  assert.equal(balances.winnings, 75);
});

// ── Tomt input på debit/credit/withdraw ─────────────────────────────────────

test("debit: tom accountId via assertAccountId i ensureAccountInternal", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await assert.rejects(
    () => adapter.debit("", 100, "x"),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_ACCOUNT_ID",
  );
});

test("withdraw: tom accountId avvises", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await assert.rejects(
    () => adapter.withdraw("", 100),
    (err: unknown) => err instanceof WalletError && err.code === "INVALID_ACCOUNT_ID",
  );
});

// ── Boundary: store beløp ──────────────────────────────────────────────────

test("debit: maks Number.MAX_SAFE_INTEGER er aksept (ingen overflow innenfor JS-presisjon)", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: Number.MAX_SAFE_INTEGER });
  await adapter.debit("w-1", 1, "x");
  const balance = await adapter.getBalance("w-1");
  assert.equal(balance, Number.MAX_SAFE_INTEGER - 1);
});

// ── Multi-transaksjon scenario ─────────────────────────────────────────────

test("Multi-tx scenario: deposit → debit → credit winnings → withdraw konsistent", async () => {
  const adapter = new InMemoryWalletAdapter(0);
  await adapter.createAccount({ accountId: "w-1", initialBalance: 100 });
  // Topup +50 → deposit 150
  await adapter.topUp("w-1", 50, "topup");
  // Debit 30 → trekkes fra deposit (winnings = 0): deposit 120
  await adapter.debit("w-1", 30, "buyin");
  // Win 80 → winnings 80
  await adapter.credit("w-1", 80, "payout", { to: "winnings" });
  // Total 200, winnings 80, deposit 120
  // Withdraw 50 → winnings-first: trekker 50 fra winnings (igjen 30)
  await adapter.withdraw("w-1", 50, "cashout");

  const balances = await adapter.getBothBalances("w-1");
  assert.equal(balances.deposit, 120);
  assert.equal(balances.winnings, 30);
  assert.equal(balances.total, 150);
});
