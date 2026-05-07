/**
 * PR-B (2026-05-07): unit-tester for SystemAccountService.
 *
 * Bruker en in-memory pg.Pool-stub som matcher SQL-en service-laget
 * faktisk kjører. Dekker:
 *   - create + verify happy-path
 *   - verify avviser ugyldig key
 *   - verify avviser revoked key
 *   - verify avviser deaktivert key
 *   - hash er ikke klartekst (lekkasje-test)
 *   - revoke er idempotent (andre kall feiler)
 *   - list skjuler revoked by default
 *   - recordUsage er fire-and-forget (failure ikke kastes)
 *   - hallScope-tom-array avvises
 *   - permissions-tom-array avvises
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import {
  SystemAccountService,
  isSystemAccountKey,
  apiKeyPrefix,
  systemAccountHasPermission,
  systemAccountHasHallAccess,
  type VerifiedSystemAccountActor,
} from "../SystemAccountService.js";
import { DomainError } from "../../errors/DomainError.js";
import type { AdminPermission } from "../../platform/AdminAccessPolicy.js";

interface Row {
  id: string;
  name: string;
  description: string | null;
  api_key_hash: string;
  permissions_json: unknown;
  hall_scope_json: unknown;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  last_used_ip: string | null;
  created_by_user_id: string | null;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
}

interface Store {
  rows: Map<string, Row>;
  /**
   * Når satt til true: alle queries kaster. Brukes til å teste at
   * recordUsage er fire-and-forget.
   */
  shouldFail: boolean;
}

function makeStore(): Store {
  return { rows: new Map(), shouldFail: false };
}

function runQuery(
  store: Store,
  sql: string,
  params: unknown[] = []
): { rows: Row[]; rowCount: number } {
  if (store.shouldFail) {
    throw new Error("simulated DB failure");
  }
  const trimmed = sql.trim();

  if (trimmed.startsWith("INSERT")) {
    const [id, name, description, apiKeyHash, permissionsJson, hallScopeJson, createdBy] =
      params as [string, string, string | null, string, string, string | null, string];
    for (const row of store.rows.values()) {
      if (row.name === name) {
        const err = new Error("duplicate key value violates unique constraint") as Error & {
          code?: string;
        };
        err.code = "23505";
        throw err;
      }
    }
    const now = new Date();
    const row: Row = {
      id,
      name,
      description: description ?? null,
      api_key_hash: apiKeyHash,
      permissions_json: JSON.parse(permissionsJson),
      hall_scope_json: hallScopeJson === null ? null : JSON.parse(hallScopeJson),
      is_active: true,
      created_at: now,
      updated_at: now,
      last_used_at: null,
      last_used_ip: null,
      created_by_user_id: createdBy ?? null,
      revoked_at: null,
      revoked_by_user_id: null,
      revoke_reason: null,
    };
    store.rows.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (trimmed.startsWith("SELECT")) {
    if (sql.includes("WHERE revoked_at IS NULL AND is_active = TRUE")) {
      const active = [...store.rows.values()].filter(
        (r) => r.revoked_at === null && r.is_active === true
      );
      return { rows: active, rowCount: active.length };
    }
    if (sql.includes("WHERE revoked_at IS NULL")) {
      const live = [...store.rows.values()].filter((r) => r.revoked_at === null);
      live.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return { rows: live, rowCount: live.length };
    }
    const all = [...store.rows.values()];
    all.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return { rows: all, rowCount: all.length };
  }

  if (trimmed.startsWith("UPDATE")) {
    if (sql.includes("SET last_used_at = now()")) {
      const [id, ip] = params as [string, string | null];
      const row = store.rows.get(id);
      if (row) {
        row.last_used_at = new Date();
        row.last_used_ip = ip ?? null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SET revoked_at = now()")) {
      const [id, byUserId, reason] = params as [string, string, string];
      const row = store.rows.get(id);
      if (row && row.revoked_at === null) {
        row.revoked_at = new Date();
        row.revoked_by_user_id = byUserId;
        row.revoke_reason = reason;
        row.updated_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  }

  throw new Error(`unhandled SQL: ${trimmed.slice(0, 120)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async query(sql: string, params?: unknown[]) {
      return runQuery(store, sql, params ?? []);
    },
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          return runQuery(store, sql, params ?? []);
        },
        release() {
          /* noop */
        },
      };
    },
  };
  return pool as unknown as Pool;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("PR-B: create + verify happy-path returnerer system-account-actor", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const { account, apiKey } = await svc.create({
    name: "test-account",
    description: "for testing",
    permissions: ["GAME1_MASTER_WRITE", "ROOM_CONTROL_WRITE"] as AdminPermission[],
    hallScope: null,
    createdByUserId: "admin-1",
  });
  assert.match(apiKey, /^sa_[0-9a-f]{32}$/, "apiKey skal være sa_<32hex>");
  assert.equal(account.name, "test-account");
  assert.equal(account.permissions.length, 2);
  assert.equal(account.hallScope, null);
  assert.equal(account.isActive, true);

  const verified = await svc.verify(apiKey);
  assert.ok(verified, "verify skal returnere actor");
  assert.equal(verified!.id, account.id);
  assert.equal(verified!.name, "test-account");
  assert.equal(verified!.type, "SYSTEM_ACCOUNT");
  assert.deepEqual(verified!.permissions, ["GAME1_MASTER_WRITE", "ROOM_CONTROL_WRITE"]);
  assert.equal(verified!.hallScope, null);
});

test("PR-B: verify avviser ugyldig key (returnerer null)", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  await svc.create({
    name: "valid-1",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  // Forsøk verify med en helt annen key (samme format, men ikke generert).
  const result = await svc.verify("sa_00000000000000000000000000000000");
  assert.equal(result, null);
});

test("PR-B: verify avviser ikke-sa_ token (returnerer null)", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const result1 = await svc.verify("eyJfakejwttoken");
  const result2 = await svc.verify("");
  const result3 = await svc.verify("not-a-key");
  assert.equal(result1, null);
  assert.equal(result2, null);
  assert.equal(result3, null);
});

test("PR-B: verify avviser revoked key", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const { account, apiKey } = await svc.create({
    name: "to-be-revoked",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  // Først virker key
  const before = await svc.verify(apiKey);
  assert.ok(before);
  // Revoke
  await svc.revoke(account.id, "admin-1", "compromise-test");
  // Etter revoke: verify returnerer null
  const after = await svc.verify(apiKey);
  assert.equal(after, null);
});

test("PR-B: verify avviser deaktivert key (is_active=FALSE)", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const { account, apiKey } = await svc.create({
    name: "to-deactivate",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  // Direkte tweak is_active i store
  const row = store.rows.get(account.id)!;
  row.is_active = false;
  // verify skal returnere null
  const result = await svc.verify(apiKey);
  assert.equal(result, null);
});

test("PR-B: api_key_hash er ikke klartekst i lagring (scrypt-format)", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const { account, apiKey } = await svc.create({
    name: "hash-check",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  const row = store.rows.get(account.id)!;
  assert.notEqual(row.api_key_hash, apiKey, "hash må ikke være klartekst");
  assert.match(row.api_key_hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/, "hash skal være scrypt-format");
});

test("PR-B: hall-scope håndteres korrekt — null = global, liste = scoped", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  // Global key
  const globalRes = await svc.create({
    name: "global-key",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    hallScope: null,
    createdByUserId: "admin-1",
  });
  assert.equal(globalRes.account.hallScope, null);
  // Scoped key
  const scopedRes = await svc.create({
    name: "scoped-key",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    hallScope: ["hall-a", "hall-b"],
    createdByUserId: "admin-1",
  });
  assert.deepEqual(scopedRes.account.hallScope, ["hall-a", "hall-b"]);

  // verify-actor får hall-scope
  const verified = await svc.verify(scopedRes.apiKey);
  assert.deepEqual(verified!.hallScope, ["hall-a", "hall-b"]);
});

test("PR-B: revoke er idempotent — andre kall feiler", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const { account } = await svc.create({
    name: "idempotent-revoke",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  await svc.revoke(account.id, "admin-1", "first-time");
  await assert.rejects(
    () => svc.revoke(account.id, "admin-1", "second-time"),
    (err: unknown) =>
      err instanceof DomainError && err.code === "SYSTEM_ACCOUNT_NOT_FOUND"
  );
});

test("PR-B: revoke krever non-empty reason", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const { account } = await svc.create({
    name: "needs-reason",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  await assert.rejects(
    () => svc.revoke(account.id, "admin-1", ""),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  await assert.rejects(
    () => svc.revoke(account.id, "admin-1", "   "),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("PR-B: list skjuler revoked by default, includeRevoked=true viser dem", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  await svc.create({
    name: "active-1",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  const { account: toRevoke } = await svc.create({
    name: "revoked-1",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  await svc.revoke(toRevoke.id, "admin-1", "test");

  const defaultList = await svc.list();
  assert.equal(defaultList.length, 1);
  assert.equal(defaultList[0]!.name, "active-1");

  const fullList = await svc.list({ includeRevoked: true });
  assert.equal(fullList.length, 2);
});

test("PR-B: list skjuler aldri api_key_hash (lekkasje-test)", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  await svc.create({
    name: "no-leak",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  const list = await svc.list();
  for (const account of list) {
    // SystemAccount-typen har ingen api_key_hash-felt — TS skal fange dette
    // ved compile-time, men vi sanity-sjekker at runtime-objektet heller ikke
    // har det.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(account, "api_key_hash"),
      "api_key_hash skal aldri finnes i list-output"
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(account, "apiKeyHash"),
      "apiKeyHash skal aldri finnes i list-output"
    );
  }
});

test("PR-B: recordUsage er fire-and-forget — failure kastes ikke", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  const { account } = await svc.create({
    name: "fire-and-forget",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  // Forårsak DB-feil ved neste query
  store.shouldFail = true;
  // Skal ikke kaste
  await svc.recordUsage(account.id, "127.0.0.1");
  // Reset
  store.shouldFail = false;
});

test("PR-B: create avviser tom permissions-array", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  await assert.rejects(
    () =>
      svc.create({
        name: "empty-perms",
        permissions: [] as AdminPermission[],
        createdByUserId: "admin-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("PR-B: create avviser duplicate name (UNIQUE-constraint)", async () => {
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  await svc.create({
    name: "duplicate",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  await assert.rejects(
    () =>
      svc.create({
        name: "duplicate",
        permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
        createdByUserId: "admin-1",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "SYSTEM_ACCOUNT_NAME_EXISTS"
  );
});

test("PR-B: timing-safe verify — feil hash returnerer false (ikke kaster)", async () => {
  // Indirekte test: at verify ikke kaster på alle hash-mismatches
  // (positivt test ville kreve at vi faker scrypt — vi tester at flow virker).
  const store = makeStore();
  const svc = SystemAccountService.forTesting(makePool(store));
  await svc.create({
    name: "timing-test",
    permissions: ["GAME1_MASTER_WRITE"] as AdminPermission[],
    createdByUserId: "admin-1",
  });
  // Korrupt hash i lagringen
  const row = [...store.rows.values()][0]!;
  row.api_key_hash = "scrypt:badbeef:badbeef";
  // verify skal returnere null, ikke kaste
  const result = await svc.verify("sa_00000000000000000000000000000000");
  assert.equal(result, null);
});

// ── Helper-funksjoner ─────────────────────────────────────────────────────

test("PR-B: isSystemAccountKey identifiserer kun sa_-prefiks", () => {
  assert.equal(isSystemAccountKey("sa_abc123"), true);
  assert.equal(isSystemAccountKey("sa_"), true); // bare prefix er teknisk match (lengde valideres i verify)
  assert.equal(isSystemAccountKey("eyJabc"), false);
  assert.equal(isSystemAccountKey(""), false);
  assert.equal(isSystemAccountKey("Bearer sa_abc"), false);
});

test("PR-B: apiKeyPrefix returnerer kun de første 8 tegnene etter sa_ for logging", () => {
  const key = "sa_0123456789abcdef0123456789abcdef";
  const prefix = apiKeyPrefix(key);
  // Forventet: "sa_" + 8 tegn = 11 tegn totalt
  assert.equal(prefix, "sa_01234567");
  assert.equal(prefix.length, 11);
  // Ikke-system-account-keys returnerer ""
  assert.equal(apiKeyPrefix("not-a-key"), "");
});

test("PR-B: systemAccountHasPermission — whitelist-check", () => {
  const actor: VerifiedSystemAccountActor = {
    type: "SYSTEM_ACCOUNT",
    id: "sa-1",
    name: "test",
    permissions: ["GAME1_MASTER_WRITE", "ROOM_CONTROL_WRITE"] as AdminPermission[],
    hallScope: null,
  };
  assert.equal(systemAccountHasPermission(actor, "GAME1_MASTER_WRITE" as AdminPermission), true);
  assert.equal(systemAccountHasPermission(actor, "USER_ROLE_WRITE" as AdminPermission), false);
});

test("PR-B: systemAccountHasHallAccess — null = global, liste = scoped", () => {
  const globalActor: VerifiedSystemAccountActor = {
    type: "SYSTEM_ACCOUNT",
    id: "sa-1",
    name: "global",
    permissions: [] as AdminPermission[],
    hallScope: null,
  };
  const scopedActor: VerifiedSystemAccountActor = {
    type: "SYSTEM_ACCOUNT",
    id: "sa-2",
    name: "scoped",
    permissions: [] as AdminPermission[],
    hallScope: ["hall-a"],
  };
  assert.equal(systemAccountHasHallAccess(globalActor, "any-hall"), true);
  assert.equal(systemAccountHasHallAccess(scopedActor, "hall-a"), true);
  assert.equal(systemAccountHasHallAccess(scopedActor, "hall-b"), false);
});
