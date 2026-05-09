/**
 * G9 — Unit tests for wallet vs ledger reconciliation pure logic.
 *
 * Verifies classification, aggregation, diff and output formatting using
 * synthetic fixtures. No DB required.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWalletTransaction,
  classifyLedgerEvent,
  isoToOsloDate,
  osloDateToUtcStartIso,
  osloDateToUtcEndIso,
  roundNok,
  aggregateWalletBuckets,
  aggregateLedgerBuckets,
  aggregateLedgerByHall,
  diffBuckets,
  computeWalletTotals,
  computeLedgerTotals,
  reconcile,
  formatMarkdown,
  formatJson,
  formatCsv,
  type WalletReconcileEvent,
  type LedgerReconcileEvent,
} from "../lib/walletLedgerReconciliation.js";

// ── classifyWalletTransaction ────────────────────────────────────────────────

test("classifyWalletTransaction: TOPUP returnerer null", () => {
  assert.equal(classifyWalletTransaction("TOPUP", "Initial wallet funding", null), null);
});

test("classifyWalletTransaction: WITHDRAWAL returnerer null", () => {
  assert.equal(
    classifyWalletTransaction("WITHDRAWAL", "Withdrawal to bank", null),
    null,
  );
});

test("classifyWalletTransaction: game1-purchase debit klassifiseres som STAKE", () => {
  assert.equal(
    classifyWalletTransaction("DEBIT", "game1_purchase", "game1-purchase:abc:debit"),
    "STAKE",
  );
});

test("classifyWalletTransaction: g1-phase credit klassifiseres som PRIZE", () => {
  assert.equal(
    classifyWalletTransaction("CREDIT", "GAME1_PHASE_PAYOUT", "g1-phase-game1-row1-w1"),
    "PRIZE",
  );
});

test("classifyWalletTransaction: g2-jackpot credit klassifiseres som PRIZE", () => {
  assert.equal(
    classifyWalletTransaction("CREDIT", "GAME2_JACKPOT", "g2-jackpot-game1-claim1"),
    "PRIZE",
  );
});

test("classifyWalletTransaction: refund credit returnerer null (excludert)", () => {
  assert.equal(
    classifyWalletTransaction("CREDIT", "GAME1_REFUND", "game1-refund:p1:credit"),
    null,
  );
});

test("classifyWalletTransaction: compensate credit returnerer null", () => {
  assert.equal(
    classifyWalletTransaction("CREDIT", "compensate", "game1-purchase:p1:compensate"),
    null,
  );
});

test("classifyWalletTransaction: ukjent reason og key returnerer null", () => {
  assert.equal(classifyWalletTransaction("DEBIT", "manual correction", "some-key"), null);
});

test("classifyWalletTransaction: TRANSFER_OUT med game-context er STAKE", () => {
  assert.equal(
    classifyWalletTransaction("TRANSFER_OUT", "ad-hoc room buyin", "buyin-game1-p1"),
    "STAKE",
  );
});

test("classifyWalletTransaction: case-insensitive transaction type", () => {
  assert.equal(
    classifyWalletTransaction("debit", "game1_purchase", "game1-purchase:k:debit"),
    "STAKE",
  );
});

// ── classifyLedgerEvent ──────────────────────────────────────────────────────

test("classifyLedgerEvent: STAKE → STAKE", () => {
  assert.equal(classifyLedgerEvent("STAKE"), "STAKE");
});

test("classifyLedgerEvent: PRIZE → PRIZE", () => {
  assert.equal(classifyLedgerEvent("PRIZE"), "PRIZE");
});

test("classifyLedgerEvent: EXTRA_PRIZE → PRIZE", () => {
  assert.equal(classifyLedgerEvent("EXTRA_PRIZE"), "PRIZE");
});

test("classifyLedgerEvent: ORG_DISTRIBUTION → null", () => {
  assert.equal(classifyLedgerEvent("ORG_DISTRIBUTION"), null);
});

test("classifyLedgerEvent: HOUSE_RETAINED → null", () => {
  assert.equal(classifyLedgerEvent("HOUSE_RETAINED"), null);
});

test("classifyLedgerEvent: HOUSE_DEFICIT → null", () => {
  assert.equal(classifyLedgerEvent("HOUSE_DEFICIT"), null);
});

test("classifyLedgerEvent: case-insensitive", () => {
  assert.equal(classifyLedgerEvent("stake"), "STAKE");
  assert.equal(classifyLedgerEvent("Prize"), "PRIZE");
});

// ── time helpers ────────────────────────────────────────────────────────────

test("isoToOsloDate: midt-på-dagen UTC blir samme dato i Oslo", () => {
  // 2026-08-15T12:00:00 UTC = 14:00 Oslo (sommertid)
  assert.equal(isoToOsloDate("2026-08-15T12:00:00.000Z"), "2026-08-15");
});

test("isoToOsloDate: midnatt UTC blir samme eller neste dato i Oslo (sommertid)", () => {
  // 2026-08-15T22:30:00 UTC = 00:30 Oslo (sommertid neste dag)
  assert.equal(isoToOsloDate("2026-08-15T22:30:00.000Z"), "2026-08-16");
});

test("isoToOsloDate: vinter UTC+1", () => {
  // 2026-12-15T23:30:00 UTC = 00:30 Oslo (vintertid neste dag)
  assert.equal(isoToOsloDate("2026-12-15T23:30:00.000Z"), "2026-12-16");
});

test("isoToOsloDate: kaster på ugyldig input", () => {
  assert.throws(() => isoToOsloDate("not-a-date"));
});

test("osloDateToUtcStartIso: produserer 00:00 UTC", () => {
  assert.equal(osloDateToUtcStartIso("2026-08-15"), "2026-08-15T00:00:00.000Z");
});

test("osloDateToUtcEndIso: produserer neste dag 00:00 UTC", () => {
  assert.equal(osloDateToUtcEndIso("2026-08-15"), "2026-08-16T00:00:00.000Z");
});

test("osloDateToUtcStartIso: kaster på ugyldig dato", () => {
  assert.throws(() => osloDateToUtcStartIso("2026/08/15"));
});

// ── roundNok ────────────────────────────────────────────────────────────────

test("roundNok: avrunder til 2 desimaler", () => {
  assert.equal(roundNok(1.234), 1.23);
  assert.equal(roundNok(1.235), 1.24);
  assert.equal(roundNok(0.005), 0.01);
});

test("roundNok: håndterer negative beløp", () => {
  assert.equal(roundNok(-1.234), -1.23);
});

test("roundNok: 0 → 0", () => {
  assert.equal(roundNok(0), 0);
});

// ── aggregateWalletBuckets / aggregateLedgerBuckets ─────────────────────────

test("aggregateWalletBuckets: tom liste gir tom array", () => {
  assert.deepEqual(aggregateWalletBuckets([]), []);
});

test("aggregateWalletBuckets: én event gir én bucket", () => {
  const events: WalletReconcileEvent[] = [
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ];
  const buckets = aggregateWalletBuckets(events);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].walletId, "wallet-1");
  assert.equal(buckets[0].totalAmountNok, 50);
  assert.equal(buckets[0].eventCount, 1);
});

test("aggregateWalletBuckets: aggregerer events for samme bucket", () => {
  const events: WalletReconcileEvent[] = [
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 30,
    }),
  ];
  const buckets = aggregateWalletBuckets(events);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].totalAmountNok, 80);
  assert.equal(buckets[0].eventCount, 2);
});

test("aggregateWalletBuckets: separate buckets for forskjellige sider", () => {
  const events: WalletReconcileEvent[] = [
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "PRIZE",
      amountNok: 100,
    }),
  ];
  const buckets = aggregateWalletBuckets(events);
  assert.equal(buckets.length, 2);
  const stake = buckets.find((b) => b.side === "STAKE");
  const prize = buckets.find((b) => b.side === "PRIZE");
  assert.equal(stake?.totalAmountNok, 50);
  assert.equal(prize?.totalAmountNok, 100);
});

test("aggregateWalletBuckets: flytetall avrundes til 2 desimaler", () => {
  const events: WalletReconcileEvent[] = [
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 33.33,
    }),
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 33.33,
    }),
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 33.34,
    }),
  ];
  const buckets = aggregateWalletBuckets(events);
  assert.equal(buckets[0].totalAmountNok, 100);
});

test("aggregateLedgerBuckets: aggregerer på (walletId, businessDate, side)", () => {
  const events: LedgerReconcileEvent[] = [
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
      hallId: "hall-A",
      gameType: "MAIN_GAME",
    }),
    // Samme spiller, samme dato, samme side, men ULIK hall — aggregeres
    // sammen i bucket-aggregat (vi kan ikke matche per hall i wallet).
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 30,
      hallId: "hall-B",
      gameType: "MAIN_GAME",
    }),
  ];
  const buckets = aggregateLedgerBuckets(events);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].totalAmountNok, 80);
  assert.equal(buckets[0].eventCount, 2);
});

test("aggregateLedgerByHall: separate rows per (hall, gameType, side)", () => {
  const events: LedgerReconcileEvent[] = [
    makeLedgerEvent({
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      side: "STAKE",
      amountNok: 50,
    }),
    makeLedgerEvent({
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      side: "STAKE",
      amountNok: 30,
    }),
    makeLedgerEvent({
      hallId: "hall-A",
      gameType: "MAIN_GAME",
      side: "PRIZE",
      amountNok: 100,
    }),
    makeLedgerEvent({
      hallId: "hall-B",
      gameType: "DATABINGO",
      side: "STAKE",
      amountNok: 20,
    }),
  ];
  const rows = aggregateLedgerByHall(events);
  assert.equal(rows.length, 3);
  const hallAStake = rows.find(
    (r) => r.hallId === "hall-A" && r.side === "STAKE" && r.gameType === "MAIN_GAME",
  );
  assert.equal(hallAStake?.totalAmountNok, 80);
  assert.equal(hallAStake?.eventCount, 2);
});

// ── diffBuckets ────────────────────────────────────────────────────────────

test("diffBuckets: ingen divergens når begge sider er identiske", () => {
  const wallet = aggregateWalletBuckets([
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ]);
  const ledger = aggregateLedgerBuckets([
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ]);
  const diff = diffBuckets(wallet, ledger);
  assert.equal(diff.walletOnly.length, 0);
  assert.equal(diff.ledgerOnly.length, 0);
  assert.equal(diff.amountMismatches.length, 0);
  assert.equal(diff.countMismatches.length, 0);
});

test("diffBuckets: walletOnly når bucket mangler i ledger (compliance-brudd)", () => {
  const wallet = aggregateWalletBuckets([
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ]);
  const ledger = aggregateLedgerBuckets([]);
  const diff = diffBuckets(wallet, ledger);
  assert.equal(diff.walletOnly.length, 1);
  assert.equal(diff.walletOnly[0].walletId, "wallet-1");
  assert.equal(diff.ledgerOnly.length, 0);
});

test("diffBuckets: ledgerOnly når bucket mangler i wallet (phantom-rapport)", () => {
  const wallet = aggregateWalletBuckets([]);
  const ledger = aggregateLedgerBuckets([
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ]);
  const diff = diffBuckets(wallet, ledger);
  assert.equal(diff.walletOnly.length, 0);
  assert.equal(diff.ledgerOnly.length, 1);
  assert.equal(diff.ledgerOnly[0].walletId, "wallet-1");
});

test("diffBuckets: amountMismatch når beløp avviker", () => {
  const wallet = aggregateWalletBuckets([
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ]);
  const ledger = aggregateLedgerBuckets([
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 30,
    }),
  ]);
  const diff = diffBuckets(wallet, ledger);
  assert.equal(diff.amountMismatches.length, 1);
  assert.equal(diff.amountMismatches[0].walletAmountNok, 50);
  assert.equal(diff.amountMismatches[0].ledgerAmountNok, 30);
  assert.equal(diff.amountMismatches[0].diffNok, 20);
  assert.equal(diff.walletOnly.length, 0);
  assert.equal(diff.ledgerOnly.length, 0);
});

test("diffBuckets: countMismatch uten amountMismatch (sum stemmer)", () => {
  const wallet = aggregateWalletBuckets([
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ]);
  const ledger = aggregateLedgerBuckets([
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 25,
    }),
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 25,
    }),
  ]);
  const diff = diffBuckets(wallet, ledger);
  assert.equal(diff.amountMismatches.length, 0);
  assert.equal(diff.countMismatches.length, 1);
  assert.equal(diff.countMismatches[0].walletCount, 1);
  assert.equal(diff.countMismatches[0].ledgerCount, 2);
  assert.equal(diff.countMismatches[0].diff, -1);
});

test("diffBuckets: hall-mismatch er ikke direkte synlig (matchet på walletId+date+side)", () => {
  // Spiller har 50 kr stake i hall-A i wallet, men ledger registrerte den
  // som hall-B. Vår matching-strategi (walletId+date+side) klarer ikke å
  // detektere dette siden begge sider har samme aggregat. Det er en
  // begrensning ops bør være klar over — verifiseres her som dokumentert
  // adferd.
  const wallet = aggregateWalletBuckets([
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ]);
  const ledger = aggregateLedgerBuckets([
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
      hallId: "hall-WRONG",
    }),
  ]);
  const diff = diffBuckets(wallet, ledger);
  assert.equal(diff.amountMismatches.length, 0);
  assert.equal(diff.walletOnly.length, 0);
  assert.equal(diff.ledgerOnly.length, 0);
  // Per-hall breakdown viser hall-mismatch separat (ikke matchet her).
});

// ── reconcile ──────────────────────────────────────────────────────────────

test("reconcile: alt OK → isReconciled=true", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [
      makeWalletEvent({
        accountId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 50,
      }),
      makeWalletEvent({
        accountId: "wallet-1",
        businessDate: "2026-08-15",
        side: "PRIZE",
        amountNok: 100,
      }),
    ],
    ledgerEvents: [
      makeLedgerEvent({
        walletId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 50,
      }),
      makeLedgerEvent({
        walletId: "wallet-1",
        businessDate: "2026-08-15",
        side: "PRIZE",
        amountNok: 100,
      }),
    ],
  });
  assert.equal(result.isReconciled, true);
  assert.equal(result.walletTotals.stakeAmountNok, 50);
  assert.equal(result.ledgerTotals.stakeAmountNok, 50);
  assert.equal(result.walletTotals.prizeAmountNok, 100);
  assert.equal(result.ledgerTotals.prizeAmountNok, 100);
  assert.equal(result.walletOnlyBuckets.length, 0);
  assert.equal(result.ledgerOnlyBuckets.length, 0);
});

test("reconcile: walletOnly → isReconciled=false", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [
      makeWalletEvent({
        accountId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 50,
      }),
    ],
    ledgerEvents: [],
  });
  assert.equal(result.isReconciled, false);
  assert.equal(result.walletOnlyBuckets.length, 1);
});

test("reconcile: ledgerOnly → isReconciled=false", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [],
    ledgerEvents: [
      makeLedgerEvent({
        walletId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 50,
      }),
    ],
  });
  assert.equal(result.isReconciled, false);
  assert.equal(result.ledgerOnlyBuckets.length, 1);
});

test("reconcile: countMismatch alene IKKE flagger som divergens", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [
      makeWalletEvent({
        accountId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 50,
      }),
    ],
    ledgerEvents: [
      makeLedgerEvent({
        walletId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 25,
      }),
      makeLedgerEvent({
        walletId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 25,
      }),
    ],
  });
  // Sum stemmer; antall events ulikt → reconciled=true men countMismatches > 0.
  assert.equal(result.isReconciled, true);
  assert.equal(result.countMismatches.length, 1);
});

test("reconcile: tom periode er reconciled", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [],
    ledgerEvents: [],
  });
  assert.equal(result.isReconciled, true);
  assert.equal(result.walletTotals.stakeCount, 0);
  assert.equal(result.ledgerTotals.stakeCount, 0);
});

// ── computeWalletTotals / computeLedgerTotals ──────────────────────────────

test("computeWalletTotals: separerer stake og prize", () => {
  const totals = computeWalletTotals([
    makeWalletEvent({ side: "STAKE", amountNok: 50 }),
    makeWalletEvent({ side: "STAKE", amountNok: 30 }),
    makeWalletEvent({ side: "PRIZE", amountNok: 200 }),
  ]);
  assert.equal(totals.stakeAmountNok, 80);
  assert.equal(totals.stakeCount, 2);
  assert.equal(totals.prizeAmountNok, 200);
  assert.equal(totals.prizeCount, 1);
});

test("computeLedgerTotals: avrunder til 2 desimaler", () => {
  const totals = computeLedgerTotals([
    makeLedgerEvent({ side: "STAKE", amountNok: 33.33 }),
    makeLedgerEvent({ side: "STAKE", amountNok: 33.33 }),
    makeLedgerEvent({ side: "STAKE", amountNok: 33.34 }),
  ]);
  assert.equal(totals.stakeAmountNok, 100);
});

// ── output formatters ──────────────────────────────────────────────────────

test("formatJson: produserer parsbar JSON", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [],
    ledgerEvents: [],
  });
  const json = formatJson(result);
  const parsed = JSON.parse(json);
  assert.equal(parsed.isReconciled, true);
  assert.equal(parsed.fromDate, "2026-08-01");
});

test("formatMarkdown: inneholder hovedseksjoner", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [
      makeWalletEvent({ side: "STAKE", amountNok: 100 }),
    ],
    ledgerEvents: [
      makeLedgerEvent({ side: "STAKE", amountNok: 100 }),
    ],
  });
  const md = formatMarkdown(result);
  assert.match(md, /# Wallet-vs-Ledger Reconciliation/);
  assert.match(md, /## Summary/);
  assert.match(md, /## Per-hall breakdown/);
  assert.match(md, /## Divergens-deteksjon/);
  assert.match(md, /## Status/);
  assert.match(md, /RECONCILED/);
});

test("formatMarkdown: viser DIVERGENS DETEKTERT ved walletOnly", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [makeWalletEvent({ side: "STAKE", amountNok: 50 })],
    ledgerEvents: [],
  });
  const md = formatMarkdown(result);
  assert.match(md, /DIVERGENS DETEKTERT/);
  assert.match(md, /POTENSIELT COMPLIANCE-BRUDD/);
});

test("formatMarkdown: viser POTENSIELT PHANTOM-RAPPORT ved ledgerOnly", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [],
    ledgerEvents: [makeLedgerEvent({ side: "STAKE", amountNok: 50 })],
  });
  const md = formatMarkdown(result);
  assert.match(md, /POTENSIELT PHANTOM-RAPPORT/);
});

test("formatMarkdown: viser HØY RISIKO ved amountMismatch", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [
      makeWalletEvent({
        accountId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 50,
      }),
    ],
    ledgerEvents: [
      makeLedgerEvent({
        walletId: "wallet-1",
        businessDate: "2026-08-15",
        side: "STAKE",
        amountNok: 30,
      }),
    ],
  });
  const md = formatMarkdown(result);
  assert.match(md, /HØY RISIKO/);
});

test("formatCsv: header + rad per divergens", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [
      makeWalletEvent({ side: "STAKE", amountNok: 50, accountId: "w1" }),
    ],
    ledgerEvents: [],
  });
  const csv = formatCsv(result);
  const lines = csv.split("\r\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 2); // header + 1 walletOnly row
  assert.match(lines[0], /^kind,walletId,businessDate,side/);
  assert.match(lines[1], /^wallet_only,w1/);
});

test("formatCsv: escapes quotes og kommaer i wallet-id", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [
      makeWalletEvent({
        side: "STAKE",
        amountNok: 50,
        accountId: 'wallet,with"quotes',
      }),
    ],
    ledgerEvents: [],
  });
  const csv = formatCsv(result);
  assert.match(csv, /"wallet,with""quotes"/);
});

test("formatCsv: bruker CRLF line-endings (Excel-NO)", () => {
  const result = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents: [],
    ledgerEvents: [],
  });
  const csv = formatCsv(result);
  // Header alone + final CRLF.
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(csv.includes("\r\n"));
});

// ── Property-style: idempotency ────────────────────────────────────────────

test("reconcile er idempotent — samme input gir samme output", () => {
  const walletEvents = [
    makeWalletEvent({
      accountId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
    makeWalletEvent({
      accountId: "wallet-2",
      businessDate: "2026-08-16",
      side: "PRIZE",
      amountNok: 200,
    }),
  ];
  const ledgerEvents = [
    makeLedgerEvent({
      walletId: "wallet-1",
      businessDate: "2026-08-15",
      side: "STAKE",
      amountNok: 50,
    }),
  ];
  const result1 = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents,
    ledgerEvents,
  });
  const result2 = reconcile({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    hallFilter: null,
    walletEvents,
    ledgerEvents,
  });
  assert.deepEqual(result1, result2);
});

// ── Test helpers ───────────────────────────────────────────────────────────

let counter = 0;
function makeWalletEvent(
  overrides: Partial<WalletReconcileEvent> = {},
): WalletReconcileEvent {
  counter += 1;
  const id = `tx-${counter}`;
  return {
    transactionId: id,
    accountId: "wallet-1",
    businessDate: "2026-08-15",
    amountNok: 50,
    side: "STAKE",
    transactionType: "DEBIT",
    reason: "game1_purchase",
    createdAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

function makeLedgerEvent(
  overrides: Partial<LedgerReconcileEvent> = {},
): LedgerReconcileEvent {
  counter += 1;
  const id = `lg-${counter}`;
  return {
    id,
    walletId: "wallet-1",
    businessDate: "2026-08-15",
    hallId: "hall-A",
    gameType: "MAIN_GAME",
    amountNok: 50,
    side: "STAKE",
    eventType: "STAKE",
    createdAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}
