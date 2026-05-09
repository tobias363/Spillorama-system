/**
 * Unit-tests for §71 hash-chain helpers (G2 + G3).
 *
 * No DB. Pure-function tests of canonical-JSON + SHA-256 + GENESIS handling.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REGULATORY_LEDGER_GENESIS,
  canonicalJsonForLedgerEntry,
  canonicalJsonForDailyReport,
  computeLedgerEventHash,
  computeDailyReportSignedHash,
  type RegulatoryLedgerHashInput,
  type DailyRegulatoryReportHashInput,
} from "./RegulatoryLedgerHash.js";

describe("RegulatoryLedgerHash — canonical JSON for ledger entry", () => {
  const sample: RegulatoryLedgerHashInput = {
    id: "00000000-0000-4000-8000-000000000001",
    event_date: "2026-05-09",
    channel: "INTERNET",
    hall_id: "b18b7928-3469-4b71-a34d-3f81a1b09a88",
    transaction_type: "TICKET_SALE",
    amount_nok: "100.00",
    ticket_ref: "TK-00001",
    created_at: "2026-05-09T10:30:00.000Z",
  };

  it("sorts keys alphabetically — output is deterministic regardless of input order", () => {
    // Build the same logical input with shuffled key-order and verify
    // canonical-JSON yields identical bytes.
    const reversed: RegulatoryLedgerHashInput = {
      created_at: sample.created_at,
      ticket_ref: sample.ticket_ref,
      amount_nok: sample.amount_nok,
      transaction_type: sample.transaction_type,
      hall_id: sample.hall_id,
      channel: sample.channel,
      event_date: sample.event_date,
      id: sample.id,
    };
    assert.equal(canonicalJsonForLedgerEntry(sample), canonicalJsonForLedgerEntry(reversed));
  });

  it("first key in canonical-JSON is alphabetic (amount_nok)", () => {
    const json = canonicalJsonForLedgerEntry(sample);
    assert.match(json, /^\{"amount_nok"/);
  });

  it("preserves NULL ticket_ref as JSON null (not omitted)", () => {
    const withNullRef: RegulatoryLedgerHashInput = { ...sample, ticket_ref: null };
    const json = canonicalJsonForLedgerEntry(withNullRef);
    assert.match(json, /"ticket_ref":null/);
  });

  it("amount_nok serialized as STRING not number (avoids JS float jitter)", () => {
    const json = canonicalJsonForLedgerEntry(sample);
    assert.match(json, /"amount_nok":"100\.00"/);
  });
});

describe("RegulatoryLedgerHash — computeLedgerEventHash", () => {
  const sample: RegulatoryLedgerHashInput = {
    id: "00000000-0000-4000-8000-000000000001",
    event_date: "2026-05-09",
    channel: "INTERNET",
    hall_id: "hall-1",
    transaction_type: "TICKET_SALE",
    amount_nok: "100.00",
    ticket_ref: null,
    created_at: "2026-05-09T10:30:00.000Z",
  };

  it("produces 64 hex chars (SHA-256 width)", () => {
    const hash = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, sample);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it("GENESIS sentinel is 64 hex zeros", () => {
    assert.equal(REGULATORY_LEDGER_GENESIS, "0".repeat(64));
  });

  it("identical input + same prev_hash → identical hash (deterministic)", () => {
    const a = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, sample);
    const b = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, sample);
    assert.equal(a, b);
  });

  it("different prev_hash → different output hash (chains correctly)", () => {
    const fromGenesis = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, sample);
    const fromOther = computeLedgerEventHash("a".repeat(64), sample);
    assert.notEqual(fromGenesis, fromOther);
  });

  it("different amount → different hash (tamper-detection)", () => {
    const original = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, sample);
    const tampered = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, {
      ...sample,
      amount_nok: "200.00",
    });
    assert.notEqual(original, tampered);
  });

  it("different ticket_ref → different hash", () => {
    const a = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, sample);
    const b = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, {
      ...sample,
      ticket_ref: "TK-99999",
    });
    assert.notEqual(a, b);
  });

  it("hash is reproducible from stored row + stored prev_hash", () => {
    // Simulate: row R1 stored with hash H1 (chain-start, prev_hash=NULL).
    // Reproduce H1 from stored fields + GENESIS.
    const h1 = computeLedgerEventHash(REGULATORY_LEDGER_GENESIS, sample);
    const r2: RegulatoryLedgerHashInput = {
      ...sample,
      id: "00000000-0000-4000-8000-000000000002",
      amount_nok: "50.00",
      created_at: "2026-05-09T10:31:00.000Z",
    };
    const h2 = computeLedgerEventHash(h1, r2);
    // Verifier walks: h2 must reproduce from h1 + r2.
    const reproduced = computeLedgerEventHash(h1, r2);
    assert.equal(reproduced, h2);
  });
});

describe("RegulatoryLedgerHash — daily-report chain (G3)", () => {
  const sample: DailyRegulatoryReportHashInput = {
    report_date: "2026-05-09",
    hall_id: "hall-1",
    channel: "INTERNET",
    ticket_turnover_nok: "10000.00",
    prizes_paid_nok: "5500.00",
    tickets_sold_count: 100,
    unique_players: 25,
    ledger_first_sequence: "1234",
    ledger_last_sequence: "1290",
  };

  it("canonical JSON is alphabetic", () => {
    const json = canonicalJsonForDailyReport(sample);
    assert.match(json, /^\{"channel"/);
  });

  it("amounts are STRING, not number", () => {
    const json = canonicalJsonForDailyReport(sample);
    assert.match(json, /"ticket_turnover_nok":"10000\.00"/);
    assert.match(json, /"prizes_paid_nok":"5500\.00"/);
  });

  it("counts are NUMBER (per migration schema — INTEGER columns)", () => {
    const json = canonicalJsonForDailyReport(sample);
    assert.match(json, /"tickets_sold_count":100/);
    assert.match(json, /"unique_players":25/);
  });

  it("computeDailyReportSignedHash produces 64 hex chars", () => {
    const hash = computeDailyReportSignedHash(REGULATORY_LEDGER_GENESIS, sample);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it("changing any field breaks the chain (tamper-detection)", () => {
    const original = computeDailyReportSignedHash(REGULATORY_LEDGER_GENESIS, sample);
    // Try each field in turn — every one of them must change the hash.
    const variants: Array<Partial<DailyRegulatoryReportHashInput>> = [
      { ticket_turnover_nok: "10001.00" },
      { prizes_paid_nok: "5501.00" },
      { tickets_sold_count: 101 },
      { unique_players: 26 },
      { ledger_first_sequence: "1235" },
      { ledger_last_sequence: "1291" },
      { hall_id: "hall-2" },
      { channel: "HALL" },
      { report_date: "2026-05-10" },
    ];
    for (const v of variants) {
      const tampered = computeDailyReportSignedHash(REGULATORY_LEDGER_GENESIS, {
        ...sample,
        ...v,
      });
      assert.notEqual(original, tampered, `field ${Object.keys(v)[0]} did not change hash`);
    }
  });

  it("same input + GENESIS prev_hash → reproducible hash", () => {
    const a = computeDailyReportSignedHash(REGULATORY_LEDGER_GENESIS, sample);
    const b = computeDailyReportSignedHash(REGULATORY_LEDGER_GENESIS, sample);
    assert.equal(a, b);
  });

  it("chain links day-to-day correctly", () => {
    const day1Hash = computeDailyReportSignedHash(REGULATORY_LEDGER_GENESIS, sample);
    const day2Input: DailyRegulatoryReportHashInput = {
      ...sample,
      report_date: "2026-05-10",
      ticket_turnover_nok: "8000.00",
      prizes_paid_nok: "4500.00",
      tickets_sold_count: 80,
      unique_players: 20,
      ledger_first_sequence: "1291",
      ledger_last_sequence: "1340",
    };
    const day2Hash = computeDailyReportSignedHash(day1Hash, day2Input);
    // Verifier walk: re-compute day2 from stored prev_hash (= day1Hash) +
    // day2 stored fields. Must match what we stored.
    const reproduced = computeDailyReportSignedHash(day1Hash, day2Input);
    assert.equal(reproduced, day2Hash);
    // And it differs from a chain that pretended day1 didn't exist.
    const altPath = computeDailyReportSignedHash(REGULATORY_LEDGER_GENESIS, day2Input);
    assert.notEqual(altPath, day2Hash);
  });
});
