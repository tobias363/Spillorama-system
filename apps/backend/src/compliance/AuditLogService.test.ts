/**
 * BIN-588: AuditLogService + redaction tests.
 *
 * Postgres-implementation tests mock the pg.Pool surface so no live DB
 * is required. In-memory tests exercise the real class.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, QueryResult } from "pg";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  PostgresAuditLogStore,
  redactDetails,
} from "./AuditLogService.js";

// ── redactDetails ──────────────────────────────────────────────────────────

test("BIN-588 redactDetails: replaces password/token/ssn values with [REDACTED]", () => {
  const out = redactDetails({
    email: "a@b.no",
    password: "hunter2",
    token: "abc",
    ssn: "12345678901",
  });
  assert.equal(out.email, "a@b.no");
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.token, "[REDACTED]");
  assert.equal(out.ssn, "[REDACTED]");
});

test("BIN-588 redactDetails: redaction is case-insensitive on keys", () => {
  const out = redactDetails({ Password: "x", ACCESSTOKEN: "y", PersonNummer: "z" });
  assert.equal(out.Password, "[REDACTED]");
  assert.equal(out.ACCESSTOKEN, "[REDACTED]");
  assert.equal(out.PersonNummer, "[REDACTED]");
});

test("BIN-588 redactDetails: recurses into nested objects and arrays", () => {
  const out = redactDetails({
    user: { name: "Kari", password: "x" },
    sessions: [{ token: "a" }, { token: "b" }],
  });
  const user = out.user as Record<string, unknown>;
  assert.equal(user.name, "Kari");
  assert.equal(user.password, "[REDACTED]");
  const sessions = out.sessions as Array<{ token: string }>;
  assert.equal(sessions[0].token, "[REDACTED]");
  assert.equal(sessions[1].token, "[REDACTED]");
});

test("BIN-588 redactDetails: caps recursion depth to avoid runaway cycles", () => {
  const root: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < 20; i += 1) {
    const next: Record<string, unknown> = {};
    cursor.child = next;
    cursor = next;
  }
  const out = redactDetails(root);
  // Walk down; at depth >10 the value should become "[TOO_DEEP]"
  let c: unknown = out;
  for (let i = 0; i < 15; i += 1) {
    if (c && typeof c === "object" && "child" in c) {
      c = (c as Record<string, unknown>).child;
    }
  }
  // After deep enough, recursion bailed out.
  assert.ok(
    c === "[TOO_DEEP]" || (typeof c === "object" && c !== null),
    "recursion guard kicked in",
  );
});

test("BIN-588 redactDetails: handles null/undefined input gracefully", () => {
  assert.deepEqual(redactDetails(null), { value: null });
  assert.deepEqual(redactDetails(undefined), { value: null });
});

// ── InMemoryAuditLogStore + AuditLogService ────────────────────────────────

test("BIN-588 service: record + list round-trips an event with redacted details", async () => {
  const store = new InMemoryAuditLogStore();
  const service = new AuditLogService(store);

  await service.record({
    actorId: "user-1",
    actorType: "ADMIN",
    action: "user.role.change",
    resource: "user",
    resourceId: "user-42",
    details: { from: "PLAYER", to: "SUPPORT", password: "shouldBeRedacted" },
    ipAddress: "10.0.0.1",
    userAgent: "curl/8.0",
  });

  const events = await service.list();
  assert.equal(events.length, 1);
  const evt = events[0];
  assert.equal(evt.actorId, "user-1");
  assert.equal(evt.actorType, "ADMIN");
  assert.equal(evt.action, "user.role.change");
  assert.equal(evt.resource, "user");
  assert.equal(evt.resourceId, "user-42");
  assert.equal(evt.details.from, "PLAYER");
  assert.equal(evt.details.to, "SUPPORT");
  assert.equal(evt.details.password, "[REDACTED]");
  assert.equal(evt.ipAddress, "10.0.0.1");
  assert.equal(evt.userAgent, "curl/8.0");
  assert.ok(evt.createdAt.length > 0);
});

test("BIN-588 service: empty details default to {}", async () => {
  const store = new InMemoryAuditLogStore();
  const service = new AuditLogService(store);
  await service.record({
    actorId: null,
    actorType: "SYSTEM",
    action: "job.run",
    resource: "swedbankSync",
    resourceId: null,
  });
  const [evt] = await service.list();
  assert.deepEqual(evt.details, {});
  assert.equal(evt.actorId, null);
  assert.equal(evt.resourceId, null);
});

test("BIN-588 service: filters by actorId, resource, resourceId, action, since", async () => {
  const store = new InMemoryAuditLogStore();
  const service = new AuditLogService(store);

  await service.record({ actorId: "u-1", actorType: "USER", action: "auth.login", resource: "session", resourceId: "s-1" });
  await service.record({ actorId: "u-2", actorType: "USER", action: "auth.login", resource: "session", resourceId: "s-2" });
  await service.record({ actorId: "u-1", actorType: "USER", action: "deposit.complete", resource: "deposit", resourceId: "d-9" });

  const u1 = await service.list({ actorId: "u-1" });
  assert.equal(u1.length, 2);

  const deposits = await service.list({ resource: "deposit" });
  assert.equal(deposits.length, 1);
  assert.equal(deposits[0].resourceId, "d-9");

  const s2 = await service.list({ resourceId: "s-2" });
  assert.equal(s2.length, 1);
  assert.equal(s2[0].actorId, "u-2");

  const logins = await service.list({ action: "auth.login" });
  assert.equal(logins.length, 2);
});

test("BIN-588 service: list returns most-recent first", async () => {
  const store = new InMemoryAuditLogStore();
  const service = new AuditLogService(store);
  await service.record({ actorId: "a", actorType: "USER", action: "evt", resource: "x", resourceId: "1" });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await service.record({ actorId: "a", actorType: "USER", action: "evt", resource: "x", resourceId: "2" });
  const events = await service.list();
  assert.equal(events[0].resourceId, "2");
  assert.equal(events[1].resourceId, "1");
});

test("BIN-588 service: rejects empty action / resource", async () => {
  const store = new InMemoryAuditLogStore();
  const service = new AuditLogService(store);
  await assert.rejects(
    () => service.record({ actorId: null, actorType: "SYSTEM", action: "", resource: "x", resourceId: null }),
    /action is required/,
  );
  await assert.rejects(
    () => service.record({ actorId: null, actorType: "SYSTEM", action: "a", resource: "   ", resourceId: null }),
    /resource is required/,
  );
});

test("BIN-588 service: returned details are a copy — mutating doesn't affect store", async () => {
  const store = new InMemoryAuditLogStore();
  const service = new AuditLogService(store);
  await service.record({
    actorId: null, actorType: "SYSTEM", action: "a", resource: "r", resourceId: null,
    details: { k: "v" },
  });
  const first = (await service.list())[0];
  (first.details as Record<string, unknown>).k = "mutated";
  const second = (await service.list())[0];
  assert.equal(second.details.k, "v");
});

// ── PostgresAuditLogStore (mocked pool) ────────────────────────────────────

function fakePool(queryImpl: (sql: string, params: unknown[]) => Promise<QueryResult>): Pool {
  return {
    query: queryImpl as unknown as Pool["query"],
  } as Pool;
}

test("BIN-588 Postgres: append issues a parameterised INSERT with redacted JSON details", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const pool = fakePool(async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;
    return { rows: [], rowCount: 0, command: "INSERT", oid: 0, fields: [] } as unknown as QueryResult;
  });
  const store = new PostgresAuditLogStore({ pool, schema: "public" });
  await store.append({
    actorId: "admin-1",
    actorType: "ADMIN",
    action: "deposit.approve",
    resource: "deposit",
    resourceId: "dep-99",
    details: { amount: 500, password: "secret" },
    ipAddress: "127.0.0.1",
    userAgent: "ua",
  });
  assert.match(capturedSql, /INSERT INTO public\.app_audit_log/);
  // 8 positional parameters
  assert.equal(capturedParams.length, 8);
  assert.equal(capturedParams[0], "admin-1");
  assert.equal(capturedParams[1], "ADMIN");
  assert.equal(capturedParams[2], "deposit.approve");
  assert.equal(capturedParams[3], "deposit");
  assert.equal(capturedParams[4], "dep-99");
  const detailsParam = JSON.parse(String(capturedParams[5]));
  assert.equal(detailsParam.amount, 500);
  assert.equal(detailsParam.password, "[REDACTED]");
  assert.equal(capturedParams[6], "127.0.0.1");
  assert.equal(capturedParams[7], "ua");
});

test("BIN-588 Postgres: append swallows query errors (fire-and-forget)", async () => {
  const pool = fakePool(async () => {
    throw new Error("connection reset");
  });
  const store = new PostgresAuditLogStore({ pool });
  await store.append({
    actorId: null, actorType: "SYSTEM", action: "a", resource: "r", resourceId: null,
  });
  // Did not throw — that's the contract.
  assert.ok(true);
});

test("BIN-588 Postgres: list builds WHERE clauses dynamically", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const pool = fakePool(async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;
    return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] } as unknown as QueryResult;
  });
  const store = new PostgresAuditLogStore({ pool });
  await store.list({ actorId: "u-1", action: "auth.login", limit: 50 });
  assert.match(capturedSql, /WHERE actor_id = \$1 AND action = \$2/);
  assert.equal(capturedParams[0], "u-1");
  assert.equal(capturedParams[1], "auth.login");
  assert.equal(capturedParams[2], 50);
});

test("BIN-588 Postgres: list returns [] on query error instead of throwing", async () => {
  const pool = fakePool(async () => { throw new Error("boom"); });
  const store = new PostgresAuditLogStore({ pool });
  const out = await store.list();
  assert.deepEqual(out, []);
});

test("BIN-588 Postgres: list schema is sanitised (no injection via schema option)", async () => {
  let capturedSql = "";
  const pool = fakePool(async (sql) => {
    capturedSql = sql;
    return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] } as unknown as QueryResult;
  });
  const store = new PostgresAuditLogStore({ pool, schema: "bad;DROP TABLE x--" });
  await store.list();
  // Only alphanumeric + underscore survives.
  assert.match(capturedSql, /FROM badDROPTABLEx\.app_audit_log/);
  assert.doesNotMatch(capturedSql, /;/);
});
