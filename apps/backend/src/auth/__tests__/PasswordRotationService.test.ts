/**
 * REQ-131: tester for 90-dagers rotasjons-policy.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PasswordRotationService } from "../PasswordRotationService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface FakePoolRow {
  password_changed_at: Date | string | null;
}

function fakePool(row: FakePoolRow | null): {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: FakePoolRow[] }>;
} {
  return {
    query: async () => ({ rows: row ? [row] : [] }),
  };
}

const NOW = new Date("2026-04-27T12:00:00Z").getTime();

test("REQ-131: needsRotation=false når password_changed_at er ny (1 dag siden)", async () => {
  const oneDayAgo = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString();
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool({ password_changed_at: oneDayAgo }) as any,
    rotationPeriodDays: 90,
    warningDays: 7,
    nowMs: () => NOW,
  });
  const status = await svc.checkStatus("user-1");
  assert.equal(status.needsRotation, false);
  assert.equal(status.warningDue, false);
  assert.equal(status.daysSinceChange, 1);
  assert.equal(status.daysUntilRotation, 89);
  assert.equal(status.rotationPeriodDays, 90);
});

test("REQ-131: needsRotation=true når > 90 dager", async () => {
  const ninetyOneDaysAgo = new Date(NOW - 91 * 24 * 60 * 60 * 1000).toISOString();
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool({ password_changed_at: ninetyOneDaysAgo }) as any,
    rotationPeriodDays: 90,
    nowMs: () => NOW,
  });
  const status = await svc.checkStatus("user-1");
  assert.equal(status.needsRotation, true);
  assert.equal(status.warningDue, false, "warningDue er false når allerede utløpt");
  assert.equal(status.daysSinceChange, 91);
  assert.equal(status.daysUntilRotation, -1);
});

test("REQ-131: warningDue=true innenfor 7 dager før utløp", async () => {
  const eightyFiveDaysAgo = new Date(NOW - 85 * 24 * 60 * 60 * 1000).toISOString();
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool({ password_changed_at: eightyFiveDaysAgo }) as any,
    rotationPeriodDays: 90,
    warningDays: 7,
    nowMs: () => NOW,
  });
  const status = await svc.checkStatus("user-1");
  assert.equal(status.needsRotation, false);
  assert.equal(status.warningDue, true);
  assert.equal(status.daysUntilRotation, 5);
});

test("REQ-131: rotationPeriodDays=0 deaktiverer policyen", async () => {
  const veryOldDate = new Date(NOW - 365 * 24 * 60 * 60 * 1000).toISOString();
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool({ password_changed_at: veryOldDate }) as any,
    rotationPeriodDays: 0,
    nowMs: () => NOW,
  });
  const status = await svc.checkStatus("user-1");
  assert.equal(status.needsRotation, false);
  assert.equal(status.warningDue, false);
  assert.equal(status.daysSinceChange, null);
  assert.equal(status.passwordChangedAt, null);
});

test("REQ-131: legacy-bruker (password_changed_at IS NULL) får needsRotation=false", async () => {
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool({ password_changed_at: null }) as any,
    rotationPeriodDays: 90,
    nowMs: () => NOW,
  });
  const status = await svc.checkStatus("user-1");
  assert.equal(status.needsRotation, false);
  assert.equal(status.passwordChangedAt, null);
});

test("REQ-131: USER_NOT_FOUND når raden mangler", async () => {
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool(null) as any,
    rotationPeriodDays: 90,
    nowMs: () => NOW,
  });
  await assert.rejects(
    () => svc.checkStatus("missing-user"),
    (err: unknown) => err instanceof DomainError && err.code === "USER_NOT_FOUND"
  );
});

test("REQ-131: INVALID_INPUT for tom userId", async () => {
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: fakePool(null) as any,
    rotationPeriodDays: 90,
    nowMs: () => NOW,
  });
  await assert.rejects(
    () => svc.checkStatus(""),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("REQ-131: fail-open ved DB-feil — returnerer ingen-rotasjon", async () => {
  const failingPool = {
    query: async () => {
      throw new Error("connection lost");
    },
  };
  const svc = new PasswordRotationService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: failingPool as any,
    rotationPeriodDays: 90,
    nowMs: () => NOW,
  });
  const status = await svc.checkStatus("user-1");
  assert.equal(status.needsRotation, false, "fail-open: ikke blokker login pga DB-feil");
  assert.equal(status.passwordChangedAt, null);
});
