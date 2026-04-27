/**
 * REQ-130 (PDF 9 Frontend CR): unit-tester for UserPinService.
 *
 * Dekker:
 *   1. setup → verify happy path
 *   2. assertValidPin avviser korte/lange/ikke-numeriske inputs
 *   3. verifyPin med feil PIN → INVALID_CREDENTIALS + failed_attempts++
 *   4. Lockout etter PIN_MAX_FAILED_ATTEMPTS feil → PIN_LOCKED
 *   5. disablePin idempotent + status reflekterer enabled=false
 *   6. setupPin overskriver gammel og nullstiller failed_attempts/locked_until
 *
 * Bruker minimal in-memory pg.Pool-stub.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import {
  UserPinService,
  PIN_MAX_FAILED_ATTEMPTS,
  assertValidPin,
} from "../UserPinService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface PinRow {
  user_id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function makePool(store: Map<string, PinRow>): Pool {
  let initialized = false;
  function runQuery(sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
    const t = sql.trim();
    // Schema-init: BEGIN/COMMIT/ROLLBACK/CREATE — no-op.
    if (
      t.startsWith("BEGIN") ||
      t.startsWith("COMMIT") ||
      t.startsWith("ROLLBACK") ||
      t.startsWith("CREATE SCHEMA") ||
      t.startsWith("CREATE TABLE") ||
      t.startsWith("CREATE INDEX")
    ) {
      initialized = true;
      return { rows: [], rowCount: 0 };
    }

    if (t.startsWith("INSERT INTO")) {
      const [userId, pinHash] = params as [string, string];
      // Simulate ON CONFLICT DO UPDATE.
      const existing = store.get(userId);
      if (existing) {
        existing.pin_hash = pinHash;
        existing.failed_attempts = 0;
        existing.locked_until = null;
        existing.updated_at = new Date();
      } else {
        store.set(userId, {
          user_id: userId,
          pin_hash: pinHash,
          failed_attempts: 0,
          locked_until: null,
          last_used_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (t.startsWith("DELETE FROM")) {
      const [userId] = params as [string];
      const had = store.delete(userId);
      return { rows: [], rowCount: had ? 1 : 0 };
    }
    if (t.startsWith("SELECT")) {
      const [userId] = params as [string];
      const row = store.get(userId);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (t.startsWith("UPDATE")) {
      const [userId, ...rest] = params as unknown[];
      const row = store.get(userId as string);
      if (!row) return { rows: [], rowCount: 0 };
      // Two patterns: success (no extra params after id) reset, mismatch (attempts), lockout (attempts + lockUntil).
      if (rest.length === 0) {
        row.failed_attempts = 0;
        row.locked_until = null;
        row.last_used_at = new Date();
      } else if (rest.length === 1) {
        row.failed_attempts = rest[0] as number;
      } else if (rest.length === 2) {
        row.failed_attempts = rest[0] as number;
        row.locked_until = new Date(rest[1] as string);
      }
      row.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unhandled SQL: ${t.slice(0, 120)}`);
  }
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          return runQuery(sql, params ?? []);
        },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) {
      // Implicitly mark schema initialized for non-init SQL.
      void initialized;
      return runQuery(sql, params ?? []);
    },
  };
  return pool as unknown as Pool;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("REQ-130: setupPin + verifyPin happy path", async () => {
  const store = new Map<string, PinRow>();
  const svc = new UserPinService(makePool(store));
  await svc.setupPin("user-1", "1234");
  // Skal ikke kaste:
  await svc.verifyPin("user-1", "1234");
  const status = await svc.getStatus("user-1");
  assert.equal(status.enabled, true);
  assert.equal(status.locked, false);
  assert.equal(status.failedAttempts, 0);
  assert.ok(status.lastUsedAt !== null, "lastUsedAt skal være satt etter vellykket verify");
});

test("REQ-130: assertValidPin avviser ugyldige verdier", () => {
  // Ikke-streng:
  assert.throws(() => assertValidPin(1234), (err: unknown) => err instanceof DomainError && err.code === "INVALID_PIN");
  // For kort:
  assert.throws(() => assertValidPin("123"), (err: unknown) => err instanceof DomainError && err.code === "INVALID_PIN");
  // For lang:
  assert.throws(() => assertValidPin("1234567"), (err: unknown) => err instanceof DomainError && err.code === "INVALID_PIN");
  // Ikke-tall:
  assert.throws(() => assertValidPin("12a4"), (err: unknown) => err instanceof DomainError && err.code === "INVALID_PIN");
  // Bokstaver:
  assert.throws(() => assertValidPin("abcd"), (err: unknown) => err instanceof DomainError && err.code === "INVALID_PIN");
  // Tomt:
  assert.throws(() => assertValidPin(""), (err: unknown) => err instanceof DomainError && err.code === "INVALID_PIN");
  // Gyldige skal ikke kaste:
  assert.equal(assertValidPin("1234"), "1234");
  assert.equal(assertValidPin("123456"), "123456");
});

test("REQ-130: feil PIN gir INVALID_CREDENTIALS og inkrementerer failed_attempts", async () => {
  const store = new Map<string, PinRow>();
  const svc = new UserPinService(makePool(store));
  await svc.setupPin("user-2", "1111");
  await assert.rejects(
    () => svc.verifyPin("user-2", "9999"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CREDENTIALS"
  );
  const status = await svc.getStatus("user-2");
  assert.equal(status.enabled, true);
  assert.equal(status.failedAttempts, 1);
  assert.equal(status.locked, false);
});

test("REQ-130: lockout etter MAX_FAILED_ATTEMPTS feil", async () => {
  const store = new Map<string, PinRow>();
  const svc = new UserPinService(makePool(store));
  await svc.setupPin("user-3", "5555");
  // Første N-1 feil gir INVALID_CREDENTIALS:
  for (let i = 0; i < PIN_MAX_FAILED_ATTEMPTS - 1; i++) {
    await assert.rejects(
      () => svc.verifyPin("user-3", "0000"),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_CREDENTIALS"
    );
  }
  // Den N-te (5te) feilen skal trigge lockout og kaste PIN_LOCKED:
  await assert.rejects(
    () => svc.verifyPin("user-3", "0000"),
    (err: unknown) => err instanceof DomainError && err.code === "PIN_LOCKED"
  );
  const status = await svc.getStatus("user-3");
  assert.equal(status.locked, true);
  assert.ok(status.lockedUntil !== null);
  // Etter lockout skal selv riktig PIN gi PIN_LOCKED:
  await assert.rejects(
    () => svc.verifyPin("user-3", "5555"),
    (err: unknown) => err instanceof DomainError && err.code === "PIN_LOCKED"
  );
});

test("REQ-130: disablePin sletter raden og getStatus.enabled = false", async () => {
  const store = new Map<string, PinRow>();
  const svc = new UserPinService(makePool(store));
  await svc.setupPin("user-4", "2222");
  await svc.disablePin("user-4");
  const status = await svc.getStatus("user-4");
  assert.equal(status.enabled, false);
  assert.equal(status.locked, false);
  assert.equal(status.failedAttempts, 0);
  // Idempotent:
  await svc.disablePin("user-4"); // skal ikke kaste
});

test("REQ-130: setupPin overskriver gammel og nullstiller failed_attempts", async () => {
  const store = new Map<string, PinRow>();
  const svc = new UserPinService(makePool(store));
  await svc.setupPin("user-5", "3333");
  // Bygg opp én feil:
  await assert.rejects(
    () => svc.verifyPin("user-5", "9999"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CREDENTIALS"
  );
  let status = await svc.getStatus("user-5");
  assert.equal(status.failedAttempts, 1);
  // Re-setup nullstiller:
  await svc.setupPin("user-5", "4444");
  status = await svc.getStatus("user-5");
  assert.equal(status.failedAttempts, 0);
  // Gammel PIN skal nå være ugyldig:
  await assert.rejects(
    () => svc.verifyPin("user-5", "3333"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CREDENTIALS"
  );
  // Ny PIN er gyldig:
  await svc.verifyPin("user-5", "4444");
});

test("REQ-130: vellykket verifyPin nullstiller failed_attempts-streak", async () => {
  const store = new Map<string, PinRow>();
  const svc = new UserPinService(makePool(store));
  await svc.setupPin("user-6", "1212");
  // To feilforsøk:
  await assert.rejects(() => svc.verifyPin("user-6", "0000"), DomainError);
  await assert.rejects(() => svc.verifyPin("user-6", "0000"), DomainError);
  let status = await svc.getStatus("user-6");
  assert.equal(status.failedAttempts, 2);
  // Riktig PIN nullstiller:
  await svc.verifyPin("user-6", "1212");
  status = await svc.getStatus("user-6");
  assert.equal(status.failedAttempts, 0);
  assert.equal(status.locked, false);
});
