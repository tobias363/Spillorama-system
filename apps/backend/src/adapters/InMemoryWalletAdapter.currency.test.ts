// BIN-766 wallet casino-grade review: multi-currency-readiness.
//
// Verifiserer at WalletAccount og WalletTransaction returnerer `currency: "NOK"`
// som default fra adapter-laget. NOK-only nå — fremtidig EUR/SEK-utvidelse
// trenger lemping av DB CHECK-constraint og oppdatert validering.
//
// Postgres-spesifikk oppførsel (CHECK-constraint blokkerer non-NOK,
// migration applied) testes i PostgresWalletAdapter.currency.test.ts.

import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWalletAdapter } from "./InMemoryWalletAdapter.js";

test("createAccount: WalletAccount.currency defaulter til 'NOK'", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  const acc = await wallet.createAccount({ accountId: "w-currency-1", initialBalance: 100 });
  assert.equal(acc.currency, "NOK", "ny konto skal ha currency='NOK' fra adapter");
});

test("getAccount: WalletAccount.currency speiles på read", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w-currency-2", initialBalance: 200 });
  const acc = await wallet.getAccount("w-currency-2");
  assert.equal(acc.currency, "NOK");
});

test("listAccounts: alle returnerte kontoer har currency='NOK'", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w-currency-3a", initialBalance: 50 });
  await wallet.createAccount({ accountId: "w-currency-3b", initialBalance: 75 });
  const accounts = await wallet.listAccounts();
  assert.ok(accounts.length >= 2);
  for (const acc of accounts) {
    assert.equal(acc.currency, "NOK", `account ${acc.id} skal ha currency='NOK'`);
  }
});

test("topUp + debit + credit: alle returnerte WalletTransactions har currency='NOK'", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w-currency-4", initialBalance: 0 });

  const topupTx = await wallet.topUp("w-currency-4", 500);
  assert.equal(topupTx.currency, "NOK", "topUp tx skal ha currency='NOK'");

  const debitTx = await wallet.debit("w-currency-4", 100, "Test debit");
  assert.equal(debitTx.currency, "NOK", "debit tx skal ha currency='NOK'");

  const creditTx = await wallet.credit("w-currency-4", 200, "Test credit");
  assert.equal(creditTx.currency, "NOK", "credit tx skal ha currency='NOK'");
});

test("transfer: begge tx-ene har currency='NOK'", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w-currency-5a", initialBalance: 1000 });
  await wallet.createAccount({ accountId: "w-currency-5b", initialBalance: 0 });

  const result = await wallet.transfer("w-currency-5a", "w-currency-5b", 300, "Test transfer");
  assert.equal(result.fromTx.currency, "NOK");
  assert.equal(result.toTx.currency, "NOK");
});

test("listTransactions: historiske tx-er har currency='NOK'", async () => {
  const wallet = new InMemoryWalletAdapter(0);
  await wallet.createAccount({ accountId: "w-currency-6", initialBalance: 0 });
  await wallet.topUp("w-currency-6", 100);
  await wallet.debit("w-currency-6", 30, "stake");

  const txs = await wallet.listTransactions("w-currency-6");
  assert.ok(txs.length >= 2);
  for (const tx of txs) {
    assert.equal(tx.currency, "NOK", `tx ${tx.id} skal ha currency='NOK'`);
  }
});
