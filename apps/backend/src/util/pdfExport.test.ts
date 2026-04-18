/**
 * BIN-588: pdfExport tests.
 *
 * We don't parse the PDF output (would need a separate reader dep);
 * instead we verify:
 *   - each generator returns a non-empty Buffer that starts with %PDF-
 *   - formatter helpers produce the expected Norwegian strings
 *   - input edge cases (empty lists, missing email) don't crash
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  fit,
  formatCurrency,
  formatDate,
  formatDateTime,
  generateDailyCashSettlementPdf,
  generatePlayerHistoryPdf,
  generateTransactionReceiptPdf,
} from "./pdfExport.js";

function isPdfBuffer(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  return buf.slice(0, 5).toString("ascii") === "%PDF-";
}

// ── Formatters ─────────────────────────────────────────────────────────────

test("BIN-588 pdf.formatCurrency: renders nb-NO locale with 2 decimals", () => {
  // Different builds of libicu render spaces vs. non-breaking-space, so
  // we normalise before comparing — the contract is "nb-NO group
  // separator + comma decimal + 2 decimals".
  const out = formatCurrency(1234.5).replace(/\s/g, "");
  assert.equal(out, "1234,50");
});

test("BIN-588 pdf.formatCurrency: handles 0 and negative", () => {
  assert.match(formatCurrency(0), /^0,00$/);
  // Intl in nb-NO uses Unicode minus (U+2212), not ASCII hyphen.
  const neg = formatCurrency(-42.1).replace(/\s/g, "");
  assert.match(neg, /^[−-]42,10$/);
});

test("BIN-588 pdf.formatCurrency: NaN/Infinity → 0,00", () => {
  assert.equal(formatCurrency(Number.NaN), "0,00");
  assert.equal(formatCurrency(Number.POSITIVE_INFINITY), "0,00");
});

test("BIN-588 pdf.formatDateTime: returns - for null/undefined/invalid", () => {
  assert.equal(formatDateTime(null), "-");
  assert.equal(formatDateTime(undefined), "-");
  assert.equal(formatDateTime("not a date"), "-");
});

test("BIN-588 pdf.formatDate: accepts Date and ISO string", () => {
  assert.match(formatDate(new Date("2026-04-18T10:00:00Z")), /\d/);
  assert.match(formatDate("2026-04-18T10:00:00Z"), /\d/);
});

test("BIN-588 pdf.fit: truncates with ellipsis", () => {
  assert.equal(fit("hello", 10), "hello");
  assert.equal(fit("hello world", 7), "hello …"); // 6 chars + ellipsis
  // exact boundary: maxLength === text.length → no truncation
  assert.equal(fit("abc", 3), "abc");
});

// ── Transaction receipt ────────────────────────────────────────────────────

test("BIN-588 generateTransactionReceiptPdf: emits a valid PDF with transactions", async () => {
  const pdf = await generateTransactionReceiptPdf({
    playerId: "p-1",
    playerName: "Kari Nordmann",
    playerEmail: "kari@example.no",
    rangeLabel: "April 2026",
    generatedAt: "2026-04-18T10:00:00Z",
    openingBalance: 100,
    closingBalance: 250,
    transactions: [
      { id: "t1", createdAt: "2026-04-17T12:00:00Z", type: "DEPOSIT", amount: 200, reason: "Swedbank" },
      { id: "t2", createdAt: "2026-04-17T13:00:00Z", type: "STAKE", amount: -50, reason: "Bingo ROOM-A" },
    ],
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 500);
  assert.ok(isPdfBuffer(pdf), "starts with %PDF-");
});

test("BIN-588 generateTransactionReceiptPdf: empty transaction list still renders", async () => {
  const pdf = await generateTransactionReceiptPdf({
    playerId: "p-2",
    playerName: "Ole",
    playerEmail: null,
    rangeLabel: "Uke 16",
    generatedAt: new Date(),
    openingBalance: 0,
    closingBalance: 0,
    transactions: [],
  });
  assert.ok(isPdfBuffer(pdf));
});

// ── Player history ─────────────────────────────────────────────────────────

test("BIN-588 generatePlayerHistoryPdf: renders per-hall breakdown", async () => {
  const pdf = await generatePlayerHistoryPdf({
    playerId: "p-9",
    playerName: "Kari",
    playerEmail: "kari@example.no",
    rangeLabel: "Q1 2026",
    generatedAt: new Date(),
    totals: { stakeTotal: 2000, prizeTotal: 1500, netResult: -500, sessions: 12 },
    halls: [
      {
        hallId: "hall-a", hallName: "Oslo Sentrum",
        sessions: 8, stakeTotal: 1400, prizeTotal: 1100, netResult: -300,
        lastPlayAt: "2026-03-25T18:30:00Z",
      },
      {
        hallId: "hall-b", hallName: "Bergen Kjøpesenter",
        sessions: 4, stakeTotal: 600, prizeTotal: 400, netResult: -200,
        lastPlayAt: null,
      },
    ],
  });
  assert.ok(isPdfBuffer(pdf));
  assert.ok(pdf.length > 500);
});

test("BIN-588 generatePlayerHistoryPdf: empty halls list still renders", async () => {
  const pdf = await generatePlayerHistoryPdf({
    playerId: "p-10",
    playerName: "Inaktiv Spiller",
    playerEmail: null,
    rangeLabel: "2026",
    generatedAt: new Date(),
    totals: { stakeTotal: 0, prizeTotal: 0, netResult: 0, sessions: 0 },
    halls: [],
  });
  assert.ok(isPdfBuffer(pdf));
});

// ── Daily cash settlement ──────────────────────────────────────────────────

test("BIN-588 generateDailyCashSettlementPdf: renders totals + per-hall sections", async () => {
  const pdf = await generateDailyCashSettlementPdf({
    businessDate: "2026-04-18",
    generatedAt: new Date(),
    generatedBy: "operator-1",
    halls: [
      {
        hallId: "hall-a", hallName: "Oslo",
        cashIn: 10_000, cashOut: 8_500, net: 1_500,
        lineItems: [
          { label: "Bingo-innkjøp", amount: 7_000 },
          { label: "Ticket-salg", amount: 3_000 },
          { label: "Premier utbetalt", amount: -8_500 },
        ],
      },
    ],
    totals: { cashIn: 10_000, cashOut: 8_500, net: 1_500 },
    signatoryName: "Hall-ansvarlig",
  });
  assert.ok(isPdfBuffer(pdf));
  assert.ok(pdf.length > 800);
});

test("BIN-588 generateDailyCashSettlementPdf: missing halls + no signatory still renders", async () => {
  const pdf = await generateDailyCashSettlementPdf({
    businessDate: new Date(),
    generatedAt: new Date(),
    generatedBy: "system",
    halls: [],
    totals: { cashIn: 0, cashOut: 0, net: 0 },
  });
  assert.ok(isPdfBuffer(pdf));
});
