/**
 * K1 MachineBreakdownTypes: unit tests for shape-validering og total-beregning.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  MACHINE_ROW_KEYS,
  MAX_BILAG_BYTES,
  computeBreakdownTotals,
  emptyMachineBreakdown,
  validateBilagReceipt,
  validateMachineBreakdown,
} from "../MachineBreakdownTypes.js";

// ── validateMachineBreakdown ───────────────────────────────────────────────

test("validateMachineBreakdown: tomt input gir empty breakdown", () => {
  const b = validateMachineBreakdown(undefined);
  assert.deepEqual(b.rows, {});
  assert.equal(b.kasse_start_skift_cents, 0);
  assert.equal(b.ending_opptall_kassie_cents, 0);
  assert.equal(b.innskudd_drop_safe_cents, 0);
  assert.equal(b.paafyll_ut_kasse_cents, 0);
  assert.equal(b.totalt_dropsafe_paafyll_cents, 0);
  assert.equal(b.difference_in_shifts_cents, 0);
});

test("validateMachineBreakdown: K1-B felter (kasse_start, paafyll, totalt_dropsafe) parses", () => {
  const b = validateMachineBreakdown({
    kasse_start_skift_cents: 1_000_000,
    ending_opptall_kassie_cents: 1_661_300,
    innskudd_drop_safe_cents: 100_000,
    paafyll_ut_kasse_cents: 561_300,
    totalt_dropsafe_paafyll_cents: 661_300,
    difference_in_shifts_cents: 1_100,
  });
  assert.equal(b.kasse_start_skift_cents, 1_000_000);
  assert.equal(b.ending_opptall_kassie_cents, 1_661_300);
  assert.equal(b.paafyll_ut_kasse_cents, 561_300);
  assert.equal(b.totalt_dropsafe_paafyll_cents, 661_300);
});

test("validateMachineBreakdown: paafyll_ut_kasse kan være negativ (uttrekk)", () => {
  const b = validateMachineBreakdown({
    paafyll_ut_kasse_cents: -20_000,
  });
  assert.equal(b.paafyll_ut_kasse_cents, -20_000);
});

test("validateMachineBreakdown: kasse_start_skift må være ikke-negativ", () => {
  assert.throws(
    () => validateMachineBreakdown({ kasse_start_skift_cents: -1 }),
    /ikke-negativt heltall/
  );
});

test("validateMachineBreakdown: legacy K1-A input uten nye felt aksepteres (default 0)", () => {
  // Backwards compat: rader laget før K1-B må fortsatt parses.
  const b = validateMachineBreakdown({
    rows: { metronia: { in_cents: 100, out_cents: 50 } },
    ending_opptall_kassie_cents: 5000,
    innskudd_drop_safe_cents: 2000,
    difference_in_shifts_cents: 0,
    // Mangler: kasse_start_skift_cents, paafyll_ut_kasse_cents,
    //         totalt_dropsafe_paafyll_cents
  });
  assert.equal(b.kasse_start_skift_cents, 0);
  assert.equal(b.paafyll_ut_kasse_cents, 0);
  assert.equal(b.totalt_dropsafe_paafyll_cents, 0);
  assert.equal(b.ending_opptall_kassie_cents, 5000);
});

test("validateMachineBreakdown: full 14-rad input aksepteres", () => {
  const full = {
    rows: Object.fromEntries(
      MACHINE_ROW_KEYS.map((k) => [k, { in_cents: 100, out_cents: 50 }])
    ),
    kasse_start_skift_cents: 1000,
    ending_opptall_kassie_cents: 5000,
    innskudd_drop_safe_cents: 2000,
    paafyll_ut_kasse_cents: 2000,
    totalt_dropsafe_paafyll_cents: 4000,
    difference_in_shifts_cents: 0,
  };
  const b = validateMachineBreakdown(full);
  assert.equal(Object.keys(b.rows).length, MACHINE_ROW_KEYS.length);
  assert.equal(b.rows.metronia!.in_cents, 100);
  assert.equal(b.kasse_start_skift_cents, 1000);
  assert.equal(b.ending_opptall_kassie_cents, 5000);
  assert.equal(b.totalt_dropsafe_paafyll_cents, 4000);
});

test("validateMachineBreakdown: negativt beløp avvises", () => {
  assert.throws(
    () => validateMachineBreakdown({ rows: { metronia: { in_cents: -1, out_cents: 0 } } }),
    /ikke-negativt heltall/
  );
});

test("validateMachineBreakdown: ukjent maskin-nøkkel avvises", () => {
  assert.throws(
    () => validateMachineBreakdown({ rows: { ukjent: { in_cents: 0, out_cents: 0 } } }),
    /Ukjent maskin-nøkkel/
  );
});

test("validateMachineBreakdown: float in_cents avvises", () => {
  assert.throws(
    () => validateMachineBreakdown({ rows: { metronia: { in_cents: 10.5, out_cents: 0 } } }),
    /heltall/
  );
});

test("validateMachineBreakdown: difference_in_shifts kan være negativ", () => {
  const b = validateMachineBreakdown({ difference_in_shifts_cents: -500 });
  assert.equal(b.difference_in_shifts_cents, -500);
});

// ── validateBilagReceipt ───────────────────────────────────────────────────

test("validateBilagReceipt: gyldig PDF aksepteres", () => {
  const valid = {
    mime: "application/pdf",
    filename: "bilag-2026-04-23.pdf",
    dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=",
    sizeBytes: 1024,
    uploadedAt: "2026-04-23T10:00:00.000Z",
    uploadedByUserId: "agent-1",
  };
  const r = validateBilagReceipt(valid);
  assert.equal(r.mime, "application/pdf");
  assert.equal(r.filename, "bilag-2026-04-23.pdf");
});

test("validateBilagReceipt: gyldig JPEG aksepteres", () => {
  const r = validateBilagReceipt({
    mime: "image/jpeg",
    filename: "receipt.jpg",
    dataUrl: "data:image/jpeg;base64,/9j/4AAQ=",
    sizeBytes: 500,
    uploadedAt: "2026-04-23T10:00:00Z",
    uploadedByUserId: "agent-1",
  });
  assert.equal(r.mime, "image/jpeg");
});

test("validateBilagReceipt: uventet MIME avvises", () => {
  assert.throws(
    () => validateBilagReceipt({
      mime: "application/zip",
      filename: "x.zip",
      dataUrl: "data:application/zip;base64,AAAA",
      sizeBytes: 100,
      uploadedAt: "2026-04-23T10:00:00Z",
      uploadedByUserId: "agent-1",
    }),
    /mime/
  );
});

test("validateBilagReceipt: dataUrl som ikke matcher mime avvises", () => {
  assert.throws(
    () => validateBilagReceipt({
      mime: "application/pdf",
      filename: "x.pdf",
      dataUrl: "data:image/jpeg;base64,XYZ", // mime-mismatch
      sizeBytes: 100,
      uploadedAt: "2026-04-23T10:00:00Z",
      uploadedByUserId: "agent-1",
    }),
    /dataUrl/
  );
});

test("validateBilagReceipt: for stor fil avvises", () => {
  assert.throws(
    () => validateBilagReceipt({
      mime: "application/pdf",
      filename: "x.pdf",
      dataUrl: "data:application/pdf;base64,AAAA",
      sizeBytes: MAX_BILAG_BYTES + 1,
      uploadedAt: "2026-04-23T10:00:00Z",
      uploadedByUserId: "agent-1",
    }),
    /max/
  );
});

test("validateBilagReceipt: manglende uploadedByUserId avvises", () => {
  assert.throws(
    () => validateBilagReceipt({
      mime: "application/pdf",
      filename: "x.pdf",
      dataUrl: "data:application/pdf;base64,AAAA",
      sizeBytes: 100,
      uploadedAt: "2026-04-23T10:00:00Z",
      uploadedByUserId: "",
    }),
    /uploadedByUserId/
  );
});

test("validateBilagReceipt: filename trimmes og trunkeres til 200 tegn", () => {
  const longName = "a".repeat(300);
  const r = validateBilagReceipt({
    mime: "application/pdf",
    filename: longName,
    dataUrl: "data:application/pdf;base64,AAAA",
    sizeBytes: 100,
    uploadedAt: "2026-04-23T10:00:00Z",
    uploadedByUserId: "agent-1",
  });
  assert.equal(r.filename.length, 200);
});

// ── computeBreakdownTotals ─────────────────────────────────────────────────

test("computeBreakdownTotals: summer IN/OUT/Sum over alle 14 rader", () => {
  // Wireframe-eksempel fra PDF 15 §15.8:
  //   Metronia:  IN 481000  OUT 174800
  //   OK Bingo:  IN 362000  OUT 162500
  //   Franco:    IN 477000  OUT 184800
  //   Rekvisita: IN   2500  OUT      0
  //   Servering: IN  26000  OUT      0
  //   Bank:      IN  81400  OUT  81400
  //   TOTAL:     IN 1429900 OUT 603500 Sum 826400 (i øre)
  const b = validateMachineBreakdown({
    rows: {
      metronia: { in_cents: 481000, out_cents: 174800 },
      ok_bingo: { in_cents: 362000, out_cents: 162500 },
      franco: { in_cents: 477000, out_cents: 184800 },
      rekvisita: { in_cents: 2500, out_cents: 0 },
      servering: { in_cents: 26000, out_cents: 0 },
      bank: { in_cents: 81400, out_cents: 81400 },
    },
  });
  const t = computeBreakdownTotals(b);
  assert.equal(t.totalInCents, 481000 + 362000 + 477000 + 2500 + 26000 + 81400);
  assert.equal(t.totalOutCents, 174800 + 162500 + 184800 + 0 + 0 + 81400);
  assert.equal(t.totalSumCents, t.totalInCents - t.totalOutCents);
});

test("computeBreakdownTotals: tom breakdown gir 0/0/0", () => {
  const t = computeBreakdownTotals(emptyMachineBreakdown());
  assert.equal(t.totalInCents, 0);
  assert.equal(t.totalOutCents, 0);
  assert.equal(t.totalSumCents, 0);
});

test("MACHINE_ROW_KEYS: inkluderer alle 14 wireframe-maskiner", () => {
  // PDF 15 §15.8 har 15 rader inkl. Total — vi lagrer 14 (Total beregnes).
  assert.equal(MACHINE_ROW_KEYS.length, 14);
  assert.ok(MACHINE_ROW_KEYS.includes("metronia"));
  assert.ok(MACHINE_ROW_KEYS.includes("ok_bingo"));
  assert.ok(MACHINE_ROW_KEYS.includes("franco"));
  assert.ok(MACHINE_ROW_KEYS.includes("otium"));
  assert.ok(MACHINE_ROW_KEYS.includes("norsk_tipping_dag"));
  assert.ok(MACHINE_ROW_KEYS.includes("norsk_tipping_totall"));
  assert.ok(MACHINE_ROW_KEYS.includes("rikstoto_dag"));
  assert.ok(MACHINE_ROW_KEYS.includes("rikstoto_totall"));
  assert.ok(MACHINE_ROW_KEYS.includes("rekvisita"));
  assert.ok(MACHINE_ROW_KEYS.includes("servering"));
  assert.ok(MACHINE_ROW_KEYS.includes("bilag"));
  assert.ok(MACHINE_ROW_KEYS.includes("bank"));
  assert.ok(MACHINE_ROW_KEYS.includes("gevinst_overfoering_bank"));
  assert.ok(MACHINE_ROW_KEYS.includes("annet"));
});
