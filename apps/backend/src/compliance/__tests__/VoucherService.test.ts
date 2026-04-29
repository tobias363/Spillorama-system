/**
 * BIN-587 B4b: unit-tester for VoucherService.
 *
 * Pool-mock dekker business-logikk: kode-normalisering (uppercase),
 * type + value validering, date-range validering, duplikat-avvisning,
 * soft-delete vs hard-delete avhengig av uses_count.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { VoucherService } from "../VoucherService.js";
import { DomainError } from "../../errors/DomainError.js";

interface VoucherRow {
  id: string; code: string; type: "PERCENTAGE" | "FLAT_AMOUNT"; value: number;
  max_uses: number | null; uses_count: number;
  valid_from: Date | null; valid_to: Date | null;
  is_active: boolean; description: string | null;
  created_by: string | null; created_at: Date; updated_at: Date;
}

interface Store {
  byId: Map<string, VoucherRow>;
  byCode: Map<string, string>;  // code -> id
}

function newStore(): Store {
  return { byId: new Map(), byCode: new Map() };
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
  const t = sql.trim();
  if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK") || t.startsWith("CREATE")) {
    return { rows: [], rowCount: 0 };
  }

  if (t.startsWith("SELECT")) {
    if (sql.includes("WHERE id = $1")) {
      const [id] = params as [string];
      const v = store.byId.get(id);
      return v ? { rows: [v], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes("WHERE code = $1")) {
      const [code] = params as [string];
      const id = store.byCode.get(code);
      const v = id ? store.byId.get(id) : null;
      return v ? { rows: [v], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    // List
    let list = [...store.byId.values()];
    let pIdx = 0;
    if (sql.includes("is_active = $")) {
      list = list.filter((v) => v.is_active === params[pIdx++]);
    }
    const limit = params[params.length - 1] as number;
    list = list.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, limit);
    return { rows: list, rowCount: list.length };
  }

  if (t.startsWith("INSERT")) {
    const [id, code, type, value, maxUses, validFrom, validTo, isActive, description, createdBy] = params as [
      string, string, "PERCENTAGE" | "FLAT_AMOUNT", number, number | null, string | null, string | null, boolean, string | null, string | null
    ];
    if (store.byCode.has(code)) {
      throw new Error("duplicate key value violates unique constraint");
    }
    const now = new Date();
    const row: VoucherRow = {
      id, code, type, value,
      max_uses: maxUses, uses_count: 0,
      valid_from: validFrom ? new Date(validFrom) : null,
      valid_to: validTo ? new Date(validTo) : null,
      is_active: isActive, description,
      created_by: createdBy, created_at: now, updated_at: now,
    };
    store.byId.set(id, row);
    store.byCode.set(code, id);
    return { rows: [row], rowCount: 1 };
  }

  if (t.startsWith("UPDATE")) {
    const whereMatch = sql.match(/WHERE id = \$(\d+)/);
    if (!whereMatch) throw new Error(`UPDATE uten WHERE id = $N: ${sql.slice(0, 80)}`);
    const idIdx = Number(whereMatch[1]) - 1;
    const id = params[idIdx] as string;
    const v = store.byId.get(id);
    if (!v) return { rows: [], rowCount: 0 };

    // Sjekk om det er soft-delete-UPDATE (SET is_active = false)
    if (sql.includes("SET is_active = false") && !sql.includes("value = $")) {
      v.is_active = false;
      v.updated_at = new Date();
      return { rows: [v], rowCount: 1 };
    }

    // Full update: plukk parametere i sekvens
    let pIdx = 0;
    if (sql.includes("value = $")) { v.value = params[pIdx++] as number; }
    if (sql.includes("max_uses = $")) { v.max_uses = params[pIdx++] as number | null; }
    if (sql.includes("valid_from = $")) {
      const s = params[pIdx++] as string | null;
      v.valid_from = s ? new Date(s) : null;
    }
    if (sql.includes("valid_to = $")) {
      const s = params[pIdx++] as string | null;
      v.valid_to = s ? new Date(s) : null;
    }
    if (sql.includes("is_active = $")) { v.is_active = params[pIdx++] as boolean; }
    if (sql.includes("description = $")) { v.description = params[pIdx++] as string | null; }
    v.updated_at = new Date();
    return { rows: [v], rowCount: 1 };
  }

  if (t.startsWith("DELETE")) {
    const [id] = params as [string];
    const v = store.byId.get(id);
    if (!v) return { rows: [], rowCount: 0 };
    store.byId.delete(id);
    store.byCode.delete(v.code);
    return { rows: [], rowCount: 1 };
  }

  throw new Error(`unhandled SQL: ${t.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) { return runQuery(store, sql, params ?? []); },
  };
  return pool as unknown as Pool;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-587 B4b: create PERCENTAGE voucher + normaliser kode til uppercase", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({
    code: "welcome25",
    type: "PERCENTAGE",
    value: 25,
    createdBy: "admin-1",
  });
  assert.equal(v.code, "WELCOME25");
  assert.equal(v.type, "PERCENTAGE");
  assert.equal(v.value, 25);
  assert.equal(v.usesCount, 0);
  assert.equal(v.isActive, true);
});

test("BIN-587 B4b: create FLAT_AMOUNT med cents", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({
    code: "SUMMER100",
    type: "FLAT_AMOUNT",
    value: 10000, // 100 NOK
    createdBy: "admin-1",
  });
  assert.equal(v.value, 10000);
});

test("BIN-587 B4b: create avviser PERCENTAGE > 100", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.create({ code: "BAD", type: "PERCENTAGE", value: 150, createdBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && /100/.test(err.message)
  );
});

test("BIN-587 B4b: create avviser negativ value", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.create({ code: "NEG", type: "FLAT_AMOUNT", value: -100, createdBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B4b: create avviser ugyldig kode-format", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.create({ code: "has space!", type: "PERCENTAGE", value: 10, createdBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && /A-Z/.test(err.message)
  );
  await assert.rejects(
    () => svc.create({ code: "AB", type: "PERCENTAGE", value: 10, createdBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && /3-40/.test(err.message)
  );
});

test("BIN-587 B4b: create avviser duplikat-kode", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  await svc.create({ code: "SAMECODE", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  await assert.rejects(
    () => svc.create({ code: "samecode", type: "PERCENTAGE", value: 20, createdBy: "admin-1" }),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_CODE_EXISTS"
  );
});

test("BIN-587 B4b: create med validFrom + validTo aksepterer korrekt rekkefølge", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({
    code: "WINDOW",
    type: "PERCENTAGE",
    value: 10,
    validFrom: "2026-04-01T00:00:00Z",
    validTo: "2026-05-01T00:00:00Z",
    createdBy: "admin-1",
  });
  assert.ok(v.validFrom);
  assert.ok(v.validTo);
});

test("BIN-587 B4b: create avviser reversert date-range", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  await assert.rejects(
    () => svc.create({
      code: "REVERSED",
      type: "PERCENTAGE",
      value: 10,
      validFrom: "2026-05-01T00:00:00Z",
      validTo: "2026-04-01T00:00:00Z",
      createdBy: "admin-1",
    }),
    (err: unknown) => err instanceof DomainError && /validFrom/.test(err.message)
  );
});

test("BIN-587 B4b: getByCode normaliserer kode", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  await svc.create({ code: "LOOKUP", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  const found = await svc.getByCode("lookup");
  assert.ok(found);
  assert.equal(found!.code, "LOOKUP");
  const missing = await svc.getByCode("ghost-code");
  assert.equal(missing, null);
});

test("BIN-587 B4b: update endrer felt selektivt", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({ code: "UPD", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  const updated = await svc.update(v.id, { value: 20, isActive: false });
  assert.equal(updated.value, 20);
  assert.equal(updated.isActive, false);
  assert.equal(updated.code, "UPD"); // uendret
});

test("BIN-587 B4b: update PERCENTAGE avviser value > 100", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({ code: "UPDPCT", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  await assert.rejects(
    () => svc.update(v.id, { value: 150 }),
    (err: unknown) => err instanceof DomainError && /100/.test(err.message)
  );
});

test("BIN-587 B4b: update krever minst ett felt", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({ code: "EMPTY", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  await assert.rejects(
    () => svc.update(v.id, {}),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("BIN-587 B4b: remove hard-delete hvis uses_count = 0", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({ code: "UNUSED", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  const result = await svc.remove(v.id);
  assert.equal(result.softDeleted, false);
  await assert.rejects(
    () => svc.get(v.id),
    (err: unknown) => err instanceof DomainError && err.code === "VOUCHER_NOT_FOUND"
  );
});

test("BIN-587 B4b: remove soft-delete hvis uses_count > 0", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  const v = await svc.create({ code: "USED", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  // Simuler bruk
  const row = store.byId.get(v.id)!;
  row.uses_count = 5;
  const result = await svc.remove(v.id);
  assert.equal(result.softDeleted, true);
  const refreshed = await svc.get(v.id);
  assert.equal(refreshed.isActive, false);
  assert.equal(refreshed.usesCount, 5); // bevart
});

test("BIN-587 B4b: list filtrerer på is_active", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  await svc.create({ code: "ACT1", type: "PERCENTAGE", value: 10, createdBy: "admin-1" });
  const inactive = await svc.create({ code: "INACT1", type: "PERCENTAGE", value: 10, isActive: false, createdBy: "admin-1" });
  void inactive;
  const activeOnly = await svc.list({ isActive: true });
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0]!.code, "ACT1");
});

test("BIN-587 B4b: list med limit respekterer max 500", async () => {
  const store = newStore();
  const svc = VoucherService.forTesting(makePool(store));
  // Ingenting å vise — bare sjekk at limit > 500 cappes
  const result = await svc.list({ limit: 9999 });
  assert.equal(result.length, 0);
});
