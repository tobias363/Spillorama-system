/**
 * Unit-tester for error-code-registry (Fase 2A — 2026-05-05).
 *
 * Verifiserer at registry er well-formed og at API-en oppfører seg som
 * forventet. Disse testene er ikke om Spill 2/3-logikk, kun om registry-
 * infrastrukturen i seg selv.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ERROR_CODES,
  isErrorCode,
  listErrorCodes,
  lookupErrorCode,
  type ErrorCode,
} from "../errorCodes.js";

test("ERROR_CODES: alle koder følger BIN-XXX-NNN format", () => {
  const pattern = /^BIN-[A-Z]{3}-\d{3}$/;
  for (const code of Object.keys(ERROR_CODES)) {
    assert.match(code, pattern, `Code "${code}" matcher ikke BIN-XXX-NNN`);
  }
});

test("ERROR_CODES: alle koder har påkrevde metadata-felter", () => {
  for (const [code, meta] of Object.entries(ERROR_CODES)) {
    assert.equal(typeof meta.title, "string", `${code} mangler title`);
    assert.ok(meta.title.length > 0, `${code} har tom title`);
    assert.ok(
      ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(meta.severity),
      `${code} har ugyldig severity: ${meta.severity}`,
    );
    assert.equal(typeof meta.category, "string", `${code} mangler category`);
    assert.equal(typeof meta.retryable, "boolean", `${code} mangler retryable`);
    assert.ok(
      ["immediate", "rate-threshold", "none"].includes(meta.alertRule),
      `${code} har ugyldig alertRule: ${meta.alertRule}`,
    );
    assert.equal(typeof meta.runbook, "string", `${code} mangler runbook`);
    assert.equal(typeof meta.introduced, "string", `${code} mangler introduced`);
  }
});

test("ERROR_CODES: ingen duplikater (Map-konstruksjon ville fanget det compile-time, men sanity)", () => {
  const codes = Object.keys(ERROR_CODES);
  const set = new Set(codes);
  assert.equal(set.size, codes.length, "Duplikate koder funnet");
});

test("ERROR_CODES: minst én kode per kjent modul (RKT, MON, DRW, RUM, WLT, SCK, CMP)", () => {
  const expectedModules = ["RKT", "MON", "DRW", "RUM", "WLT", "SCK", "CMP"];
  const seenModules = new Set(
    Object.keys(ERROR_CODES).map((code) => code.split("-")[1]),
  );
  for (const mod of expectedModules) {
    assert.ok(
      seenModules.has(mod),
      `Forventet minst én kode for modul ${mod}`,
    );
  }
});

test("lookupErrorCode: returnerer metadata for kjent code", () => {
  const meta = lookupErrorCode("BIN-RKT-001");
  assert.ok(meta, "Forventet metadata for BIN-RKT-001");
  assert.equal(meta?.severity, "MEDIUM");
  assert.equal(meta?.category, "recovery");
});

test("lookupErrorCode: returnerer undefined for ukjent code", () => {
  assert.equal(lookupErrorCode("BIN-XYZ-999"), undefined);
  assert.equal(lookupErrorCode(""), undefined);
  assert.equal(lookupErrorCode("not-a-code"), undefined);
});

test("isErrorCode: type-narrower for kjent code", () => {
  const value: unknown = "BIN-RKT-001";
  assert.equal(isErrorCode(value), true);

  if (isErrorCode(value)) {
    // Compile-time: value er nå ErrorCode (registry-key).
    const code: ErrorCode = value;
    assert.equal(code, "BIN-RKT-001");
  }
});

test("isErrorCode: returnerer false for non-string og ukjent code", () => {
  assert.equal(isErrorCode(123), false);
  assert.equal(isErrorCode(null), false);
  assert.equal(isErrorCode(undefined), false);
  assert.equal(isErrorCode("BIN-XYZ-999"), false);
});

test("listErrorCodes: returnerer alle codes med metadata", () => {
  const list = listErrorCodes();
  assert.ok(list.length > 0);
  assert.equal(list.length, Object.keys(ERROR_CODES).length);

  for (const entry of list) {
    assert.equal(typeof entry.code, "string");
    assert.ok(entry.meta);
    assert.equal(typeof entry.meta.severity, "string");
  }
});

test("ERROR_CODES: CRITICAL severity koder har alertRule=immediate", () => {
  // CRITICAL betyr pilot-blokker, så alert-regel skal alltid være immediate.
  // Hvis denne assertet noen gang slår, bør CRITICAL bytter til HIGH.
  for (const [code, meta] of Object.entries(ERROR_CODES)) {
    if (meta.severity === "CRITICAL") {
      assert.equal(
        meta.alertRule,
        "immediate",
        `${code}: CRITICAL bør ha alertRule=immediate, har "${meta.alertRule}"`,
      );
    }
  }
});

test("ERROR_CODES: LOW severity koder har alertRule=none", () => {
  // LOW betyr telemetri-only, ingen alert. Ellers ville vi kalt det MEDIUM.
  for (const [code, meta] of Object.entries(ERROR_CODES)) {
    if (meta.severity === "LOW") {
      assert.equal(
        meta.alertRule,
        "none",
        `${code}: LOW bør ha alertRule=none, har "${meta.alertRule}"`,
      );
    }
  }
});
