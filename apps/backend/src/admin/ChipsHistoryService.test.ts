/**
 * BIN-630 unit-tester for chips-history aggregat.
 *
 * Dekker:
 *   - balanceAfter regnes riktig bakover for CREDIT/DEBIT/TOPUP/WITHDRAW/TRANSFER_IN/OUT.
 *   - from/to-vindu filtrerer uten å forskyve balanceAfter.
 *   - Cursor-paginering (offset-basert, stabil).
 *   - Page-size clamp (1..500, default 50).
 *   - Tom tx-liste gir tomt resultat.
 *   - Ugyldig vindu (from > to) kaster.
 *   - Ugyldig ISO kaster.
 *   - Future-proof felter er null.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { WalletTransaction, WalletTransactionType } from "../adapters/WalletAdapter.js";
import { buildChipsHistory } from "./ChipsHistoryService.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function tx(
  id: string,
  type: WalletTransactionType,
  amount: number,
  createdAt: string,
  reason = "test",
): WalletTransaction {
  return {
    id,
    accountId: "wallet-user-1",
    type,
    amount,
    reason,
    createdAt,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("BIN-630: tom tx-liste gir tomt resultat", () => {
  const result = buildChipsHistory({
    walletId: "wallet-user-1",
    transactions: [],
    currentBalance: 0,
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.nextCursor, null);
  assert.equal(result.from, null);
  assert.equal(result.to, null);
  assert.equal(result.walletId, "wallet-user-1");
});

test("BIN-630: balanceAfter regnes bakover gjennom CREDIT/DEBIT", () => {
  // Historie (DESC, nyeste først): DEBIT 50 (saldo 150) → CREDIT 100 (saldo 200) → TOPUP 100 (saldo 100)
  // currentBalance etter siste tx (DEBIT 50) = 150.
  const result = buildChipsHistory({
    walletId: "wallet-user-1",
    transactions: [
      tx("t3", "DEBIT", 50, "2026-04-20T12:00:00Z"),
      tx("t2", "CREDIT", 100, "2026-04-19T12:00:00Z"),
      tx("t1", "TOPUP", 100, "2026-04-18T12:00:00Z"),
    ],
    currentBalance: 150,
  });
  assert.equal(result.items.length, 3);
  // items[0] = nyeste (DEBIT 50) — balanceAfter = 150 (saldo _etter_ tx'en)
  assert.equal(result.items[0].id, "t3");
  assert.equal(result.items[0].type, "DEBIT");
  assert.equal(result.items[0].balanceAfter, 150);
  assert.equal(result.items[0].amount, 50);
  // items[1] = CREDIT 100 — balanceAfter _etter_ = 200 (150 - (-50) bakover)
  assert.equal(result.items[1].id, "t2");
  assert.equal(result.items[1].type, "CREDIT");
  assert.equal(result.items[1].balanceAfter, 200);
  // items[2] = TOPUP 100 — balanceAfter _etter_ = 100 (200 - 100 bakover)
  assert.equal(result.items[2].id, "t1");
  assert.equal(result.items[2].type, "TOPUP");
  assert.equal(result.items[2].balanceAfter, 100);
});

test("BIN-630: TRANSFER_IN/OUT + WITHDRAWAL bidrar riktig", () => {
  // Scenario — DESC:
  //   TRANSFER_OUT 30  — saldo før: X, saldo etter: X-30
  //   WITHDRAWAL   20  — saldo før: X+30, saldo etter: X+30-20 = X+10 (= TRANSFER_OUT sitt "før")
  //   TRANSFER_IN  50  — saldo før: X-40, saldo etter: X+10
  // currentBalance = 100 (saldo etter TRANSFER_OUT).
  // Så gjennom bakover:
  //   t[0] balanceAfter = 100 (TRANSFER_OUT)
  //   t[1] balanceAfter = 130 (WITHDRAWAL bakover: 100 - (-30) = 130)
  //   t[2] balanceAfter = 150 (TRANSFER_IN bakover: 130 - (-20) = 150)
  const result = buildChipsHistory({
    walletId: "wallet-user-1",
    transactions: [
      tx("t3", "TRANSFER_OUT", 30, "2026-04-20T12:00:00Z"),
      tx("t2", "WITHDRAWAL", 20, "2026-04-19T12:00:00Z"),
      tx("t1", "TRANSFER_IN", 50, "2026-04-18T12:00:00Z"),
    ],
    currentBalance: 100,
  });
  assert.equal(result.items[0].balanceAfter, 100);
  assert.equal(result.items[1].balanceAfter, 130);
  assert.equal(result.items[2].balanceAfter, 150);
});

test("BIN-630: from/to filtrerer uten å forskyve balanceAfter", () => {
  // Hele historien må med for balanceAfter, men items filtreres.
  const result = buildChipsHistory({
    walletId: "wallet-user-1",
    transactions: [
      tx("t3", "DEBIT", 50, "2026-04-20T12:00:00Z"),
      tx("t2", "CREDIT", 100, "2026-04-15T12:00:00Z"),
      tx("t1", "TOPUP", 100, "2026-04-10T12:00:00Z"),
    ],
    currentBalance: 150,
    from: "2026-04-14T00:00:00Z",
    to: "2026-04-16T00:00:00Z",
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "t2");
  assert.equal(result.items[0].balanceAfter, 200); // Uavhengig av vindu.
  assert.equal(result.from, "2026-04-14T00:00:00Z");
  assert.equal(result.to, "2026-04-16T00:00:00Z");
});

test("BIN-630: from alene (ingen to) filtrerer bare bunn", () => {
  const result = buildChipsHistory({
    walletId: "wallet-user-1",
    transactions: [
      tx("t3", "DEBIT", 10, "2026-04-20T12:00:00Z"),
      tx("t2", "CREDIT", 20, "2026-04-15T12:00:00Z"),
      tx("t1", "TOPUP", 30, "2026-04-10T12:00:00Z"),
    ],
    currentBalance: 40,
    from: "2026-04-14T00:00:00Z",
  });
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["t3", "t2"],
  );
});

test("BIN-630: to alene (ingen from) filtrerer bare topp", () => {
  const result = buildChipsHistory({
    walletId: "wallet-user-1",
    transactions: [
      tx("t3", "DEBIT", 10, "2026-04-20T12:00:00Z"),
      tx("t2", "CREDIT", 20, "2026-04-15T12:00:00Z"),
      tx("t1", "TOPUP", 30, "2026-04-10T12:00:00Z"),
    ],
    currentBalance: 40,
    to: "2026-04-18T00:00:00Z",
  });
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((i) => i.id),
    ["t2", "t1"],
  );
});

test("BIN-630: cursor-paginering er stabil over sider", () => {
  const transactions: WalletTransaction[] = [];
  for (let i = 9; i >= 0; i -= 1) {
    transactions.push(tx(`t${i}`, "CREDIT", 10, `2026-04-${(i + 10).toString().padStart(2, "0")}T12:00:00Z`));
  }
  // currentBalance etter alle 10 CREDIT-er = 100.
  const page1 = buildChipsHistory({
    walletId: "w",
    transactions,
    currentBalance: 100,
    pageSize: 3,
  });
  assert.equal(page1.items.length, 3);
  assert.notEqual(page1.nextCursor, null);

  const page2 = buildChipsHistory({
    walletId: "w",
    transactions,
    currentBalance: 100,
    pageSize: 3,
    cursor: page1.nextCursor!,
  });
  assert.equal(page2.items.length, 3);
  // Ikke overlapp.
  const ids1 = new Set(page1.items.map((i) => i.id));
  for (const item of page2.items) {
    assert.equal(ids1.has(item.id), false, `overlap: ${item.id}`);
  }

  // BalanceAfter matcher — begge er regnet fra hele historien.
  assert.equal(page1.items[0].balanceAfter, 100); // siste CREDIT
  assert.equal(page1.items[1].balanceAfter, 90);
  assert.equal(page1.items[2].balanceAfter, 80);
  assert.equal(page2.items[0].balanceAfter, 70);
});

test("BIN-630: pageSize klemmes til [1, 500]", () => {
  const transactions: WalletTransaction[] = [];
  for (let i = 0; i < 5; i += 1) {
    transactions.push(tx(`t${i}`, "CREDIT", 1, `2026-04-${(i + 10).toString().padStart(2, "0")}T12:00:00Z`));
  }
  // pageSize 0 → behandlet som default? Math.max(1, ...) gir 1.
  const r0 = buildChipsHistory({
    walletId: "w",
    transactions,
    currentBalance: 5,
    pageSize: 0,
  });
  assert.equal(r0.items.length, 1);

  // pageSize 9999 → 500 maks (men her er det bare 5).
  const rMax = buildChipsHistory({
    walletId: "w",
    transactions,
    currentBalance: 5,
    pageSize: 9999,
  });
  assert.equal(rMax.items.length, 5);
});

test("BIN-630: default pageSize = 50", () => {
  const transactions: WalletTransaction[] = [];
  for (let i = 0; i < 60; i += 1) {
    const day = (i + 1).toString().padStart(2, "0");
    transactions.push(tx(`t${i}`, "CREDIT", 1, `2026-01-${day}T12:00:00Z`));
  }
  const r = buildChipsHistory({
    walletId: "w",
    transactions,
    currentBalance: 60,
  });
  assert.equal(r.items.length, 50);
  assert.notEqual(r.nextCursor, null);
});

test("BIN-630: from > to kaster", () => {
  assert.throws(() =>
    buildChipsHistory({
      walletId: "w",
      transactions: [],
      currentBalance: 0,
      from: "2026-04-20T00:00:00Z",
      to: "2026-04-10T00:00:00Z",
    }),
  );
});

test("BIN-630: ugyldig ISO kaster", () => {
  assert.throws(() =>
    buildChipsHistory({
      walletId: "w",
      transactions: [],
      currentBalance: 0,
      from: "ikke-en-dato",
    }),
  );
});

test("BIN-630: ugyldig currentBalance kaster", () => {
  assert.throws(() =>
    buildChipsHistory({
      walletId: "w",
      transactions: [],
      currentBalance: Number.NaN,
    }),
  );
});

test("BIN-630: sourceGameId og refundedAt er null (future-proof)", () => {
  const r = buildChipsHistory({
    walletId: "w",
    transactions: [tx("t1", "CREDIT", 10, "2026-04-20T12:00:00Z")],
    currentBalance: 10,
  });
  assert.equal(r.items[0].sourceGameId, null);
  assert.equal(r.items[0].refundedAt, null);
});

test("BIN-630: description = reason fra wallet-tx", () => {
  const r = buildChipsHistory({
    walletId: "w",
    transactions: [tx("t1", "TOPUP", 100, "2026-04-20T12:00:00Z", "Manual top-up")],
    currentBalance: 100,
  });
  assert.equal(r.items[0].description, "Manual top-up");
});

test("BIN-630: ugyldig cursor defaulter til offset 0", () => {
  const transactions: WalletTransaction[] = [];
  for (let i = 0; i < 3; i += 1) {
    transactions.push(tx(`t${i}`, "CREDIT", 1, `2026-04-${(i + 10).toString().padStart(2, "0")}T12:00:00Z`));
  }
  const r = buildChipsHistory({
    walletId: "w",
    transactions,
    currentBalance: 3,
    cursor: "xx-not-base64!",
    pageSize: 2,
  });
  // Tolererer — returnerer side 1 (offset 0).
  assert.equal(r.items.length, 2);
});

test("BIN-630: items er DESC på timestamp (input-rekkefølge bevart)", () => {
  const transactions: WalletTransaction[] = [
    tx("tNew", "CREDIT", 10, "2026-04-20T12:00:00Z"),
    tx("tMid", "CREDIT", 10, "2026-04-15T12:00:00Z"),
    tx("tOld", "CREDIT", 10, "2026-04-10T12:00:00Z"),
  ];
  const r = buildChipsHistory({
    walletId: "w",
    transactions,
    currentBalance: 30,
  });
  assert.deepEqual(
    r.items.map((i) => i.id),
    ["tNew", "tMid", "tOld"],
  );
});
