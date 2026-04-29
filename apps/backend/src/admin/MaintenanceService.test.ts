/**
 * BIN-677: unit-tester for MaintenanceService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminMaintenance.test.ts) stubber ut
 * service. Denne filen verifiserer at service-laget avviser ugyldig input
 * før det når Postgres. Object.create-pattern.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MaintenanceService } from "./MaintenanceService.js";
import { DomainError } from "../errors/DomainError.js";

function makeValidatingService(): MaintenanceService {
  const svc = Object.create(MaintenanceService.prototype) as MaintenanceService;
  const stubPool = {
    query: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her"
      );
    },
    connect: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her"
      );
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
  return svc;
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    if (expectedCode) {
      assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
    }
  }
}

// ── create-validering ───────────────────────────────────────────────────────

test("BIN-677 maintenance: create() avviser manglende createdByUserId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "missing createdByUserId",
    () =>
      svc.create({
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        createdByUserId: "",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() avviser ugyldig start-dato", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "invalid start",
    () =>
      svc.create({
        maintenanceStart: "not-a-date",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() avviser ugyldig end-dato", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "invalid end",
    () =>
      svc.create({
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "ikke-en-dato",
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() avviser end < start", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "end before start",
    () =>
      svc.create({
        maintenanceStart: "2026-05-01T12:00:00Z",
        maintenanceEnd: "2026-05-01T10:00:00Z",
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() avviser negativ showBeforeMinutes", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative showBefore",
    () =>
      svc.create({
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        showBeforeMinutes: -5,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() avviser showBeforeMinutes over 10080 (1 uke)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "showBefore too large",
    () =>
      svc.create({
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        showBeforeMinutes: 99_999,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        status: "pending" as unknown as "active",
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() avviser for lang message", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "message too long",
    () =>
      svc.create({
        maintenanceStart: "2026-05-01T10:00:00Z",
        maintenanceEnd: "2026-05-01T12:00:00Z",
        message: "x".repeat(2001),
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-677 maintenance: create() tillater gyldige felter (når pool)", async () => {
  const svc = makeValidatingService();
  // Validering skal ikke kaste — forventer at vi når pool (som stubs Error).
  try {
    await svc.create({
      maintenanceStart: "2026-05-01T10:00:00Z",
      maintenanceEnd: "2026-05-01T12:00:00Z",
      message: "Kort vedlikehold",
      showBeforeMinutes: 30,
      status: "inactive",
      createdByUserId: "u-1",
    });
    assert.fail("forventet feil fra stubbet pool");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof DomainError));
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

// ── get-validering ──────────────────────────────────────────────────────────

test("BIN-677 maintenance: get() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError("empty id", () => svc.get(""), "INVALID_INPUT");
});

// ── setStatus-validering ────────────────────────────────────────────────────

test("BIN-677 maintenance: setStatus() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () => svc.setStatus("m-1", "bogus" as unknown as "active"),
    "INVALID_INPUT"
  );
});
