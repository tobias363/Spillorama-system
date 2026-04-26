// BIN-764: Pure unit-test for hash-chain helpers — INGEN DB-avhengighet.
//
// Dekker:
//   1. Genesis-konstanten er 64-hex-zeros (SHA-256-bredde).
//   2. canonicalJsonForEntry sorterer keys deterministisk.
//   3. computeEntryHash er deterministisk og endrer seg ved enhver feltendring.
//   4. previousHash inngår i hashen (kjede-kobling).
//   5. NULL-felter (transaction_id) håndteres uten å bryte determinismen.

import assert from "node:assert/strict";
import test from "node:test";
import {
  WALLET_HASH_CHAIN_GENESIS,
  canonicalJsonForEntry,
  computeEntryHash,
  type WalletEntryHashInput,
} from "./PostgresWalletAdapter.js";

const sample: WalletEntryHashInput = {
  id: "42",
  operation_id: "op-abc",
  account_id: "wallet-xyz",
  side: "DEBIT",
  amount: "100.000000",
  transaction_id: "tx-123",
  account_side: "deposit",
  created_at: "2026-04-26T10:00:00.000Z",
};

test("hashChain: genesis er 64 hex-zeros (SHA-256-bredde)", () => {
  assert.equal(WALLET_HASH_CHAIN_GENESIS.length, 64);
  assert.match(WALLET_HASH_CHAIN_GENESIS, /^0+$/);
});

test("hashChain: canonicalJson er deterministisk uavhengig av key-rekkefølge", () => {
  const reordered: WalletEntryHashInput = {
    side: sample.side,
    amount: sample.amount,
    account_side: sample.account_side,
    id: sample.id,
    transaction_id: sample.transaction_id,
    operation_id: sample.operation_id,
    account_id: sample.account_id,
    created_at: sample.created_at,
  };
  // Begge skal produsere identisk canonical-output (sortert nøkkel-rekkefølge).
  assert.equal(canonicalJsonForEntry(sample), canonicalJsonForEntry(reordered));
});

test("hashChain: computeEntryHash er deterministisk for samme input", () => {
  const h1 = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, sample);
  const h2 = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, sample);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("hashChain: enhver feltendring gir ny hash", () => {
  const baseline = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, sample);
  const fields: Array<keyof WalletEntryHashInput> = [
    "id",
    "operation_id",
    "account_id",
    "side",
    "amount",
    "transaction_id",
    "account_side",
    "created_at",
  ];
  for (const field of fields) {
    const tampered: WalletEntryHashInput = { ...sample };
    if (field === "side") {
      tampered.side = "CREDIT";
    } else if (field === "account_side") {
      tampered.account_side = "winnings";
    } else if (field === "transaction_id") {
      tampered.transaction_id = null;
    } else {
      (tampered as unknown as Record<string, unknown>)[field] = `${tampered[field]}-tampered`;
    }
    const altered = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, tampered);
    assert.notEqual(altered, baseline, `endring av ${field} må gi ny hash`);
  }
});

test("hashChain: previousHash inngår i hashen — kjede-kobling fungerer", () => {
  const h1 = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, sample);
  const h2 = computeEntryHash(h1, sample); // samme entry, men annerledes prev
  assert.notEqual(h1, h2, "samme input-data men forskjellig prev gir forskjellig hash");
});

test("hashChain: NULL transaction_id håndteres uten å feile", () => {
  const noTx: WalletEntryHashInput = { ...sample, transaction_id: null };
  const hash = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, noTx);
  assert.equal(hash.length, 64);
  // Skal være forskjellig fra den ikke-null variant.
  const withTx = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, sample);
  assert.notEqual(hash, withTx);
});

test("hashChain: kjede-walking — partial-chain-recovery fra GENESIS", () => {
  // Simuler en 3-rad kjede der vi rebygger hashen for hver:
  const rowA: WalletEntryHashInput = { ...sample, id: "1" };
  const hashA = computeEntryHash(WALLET_HASH_CHAIN_GENESIS, rowA);

  const rowB: WalletEntryHashInput = { ...sample, id: "2", operation_id: "op-B" };
  const hashB = computeEntryHash(hashA, rowB);

  const rowC: WalletEntryHashInput = { ...sample, id: "3", operation_id: "op-C" };
  const hashC = computeEntryHash(hashB, rowC);

  // Reverify: gitt at vi vet hashA, kan vi reberegne hashB og hashC.
  assert.equal(computeEntryHash(hashA, rowB), hashB);
  assert.equal(computeEntryHash(hashB, rowC), hashC);

  // Hvis vi tukler med rowB (endrer amount), bryter både hashB og hashC.
  const tamperedB: WalletEntryHashInput = { ...rowB, amount: "999.000000" };
  const tamperedHashB = computeEntryHash(hashA, tamperedB);
  assert.notEqual(tamperedHashB, hashB);
  // Og dermed blir hashC også mismatch hvis kjeden re-walkes:
  const downstreamC = computeEntryHash(tamperedHashB, rowC);
  assert.notEqual(downstreamC, hashC, "tampering propagerer nedover kjeden");
});
