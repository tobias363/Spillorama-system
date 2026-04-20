/**
 * BIN-629: unit tests for LoginHistoryService's pure DTO mapping + cursor
 * helpers. Route-layer integration is covered in
 * `routes/__tests__/adminPlayerActivity.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedAuditEvent } from "../compliance/AuditLogService.js";
import {
  buildLoginHistoryResponse,
  decodeLoginCursor,
  encodeLoginCursor,
} from "./LoginHistoryService.js";

function makeEvent(overrides: Partial<PersistedAuditEvent> & { id: string }): PersistedAuditEvent {
  return {
    id: overrides.id,
    actorId: overrides.actorId ?? "user-1",
    actorType: overrides.actorType ?? "USER",
    action: overrides.action ?? "auth.login",
    resource: overrides.resource ?? "session",
    resourceId: overrides.resourceId ?? null,
    details: overrides.details ?? {},
    ipAddress: overrides.ipAddress ?? "10.0.0.1",
    userAgent: overrides.userAgent ?? "TestAgent/1.0",
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00.000Z",
  };
}

test("BIN-629: maps auth.login row to success=true entry", () => {
  const resp = buildLoginHistoryResponse({
    userId: "user-1",
    events: [makeEvent({ id: "1", action: "auth.login" })],
    from: null,
    to: null,
    pageSize: 50,
    offset: 0,
  });
  assert.equal(resp.items.length, 1);
  assert.equal(resp.items[0]!.success, true);
  assert.equal(resp.items[0]!.failureReason, null);
  assert.equal(resp.items[0]!.ipAddress, "10.0.0.1");
  assert.equal(resp.items[0]!.userAgent, "TestAgent/1.0");
  assert.equal(resp.nextCursor, null);
});

test("BIN-629: maps auth.login.failed row to success=false with failureReason", () => {
  const resp = buildLoginHistoryResponse({
    userId: "user-1",
    events: [
      makeEvent({
        id: "2",
        action: "auth.login.failed",
        details: { failureReason: "INVALID_CREDENTIALS" },
      }),
    ],
    from: null,
    to: null,
    pageSize: 50,
    offset: 0,
  });
  assert.equal(resp.items[0]!.success, false);
  assert.equal(resp.items[0]!.failureReason, "INVALID_CREDENTIALS");
});

test("BIN-629: failed row without details.failureReason gives null", () => {
  const resp = buildLoginHistoryResponse({
    userId: "user-1",
    events: [makeEvent({ id: "3", action: "auth.login.failed", details: {} })],
    from: null,
    to: null,
    pageSize: 50,
    offset: 0,
  });
  assert.equal(resp.items[0]!.success, false);
  assert.equal(resp.items[0]!.failureReason, null);
});

test("BIN-629: pageSize + 1 over-fetch produces nextCursor + trims page", () => {
  const events = Array.from({ length: 4 }, (_, i) => makeEvent({ id: String(i + 1) }));
  const resp = buildLoginHistoryResponse({
    userId: "user-1",
    events, // 4 rows
    from: null,
    to: null,
    pageSize: 3, // we asked for 3; 4 means there's a next page
    offset: 0,
  });
  assert.equal(resp.items.length, 3);
  assert.equal(resp.nextCursor, encodeLoginCursor(3));
});

test("BIN-629: exactly pageSize rows → no nextCursor", () => {
  const events = Array.from({ length: 3 }, (_, i) => makeEvent({ id: String(i + 1) }));
  const resp = buildLoginHistoryResponse({
    userId: "user-1",
    events,
    from: null,
    to: null,
    pageSize: 3,
    offset: 0,
  });
  assert.equal(resp.items.length, 3);
  assert.equal(resp.nextCursor, null);
});

test("BIN-629: cursor round-trip and tampered cursor falls back to 0", () => {
  assert.equal(decodeLoginCursor(encodeLoginCursor(42)), 42);
  assert.equal(decodeLoginCursor("not-a-valid-cursor"), 0);
  assert.equal(decodeLoginCursor(encodeLoginCursor(-1)), 0);
});

test("BIN-629: echoes userId + from/to", () => {
  const resp = buildLoginHistoryResponse({
    userId: "user-xyz",
    events: [],
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-20T00:00:00.000Z",
    pageSize: 50,
    offset: 0,
  });
  assert.equal(resp.userId, "user-xyz");
  assert.equal(resp.from, "2026-04-01T00:00:00.000Z");
  assert.equal(resp.to, "2026-04-20T00:00:00.000Z");
  assert.equal(resp.items.length, 0);
  assert.equal(resp.nextCursor, null);
});
