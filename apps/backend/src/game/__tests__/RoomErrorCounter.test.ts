/**
 * Bølge K5 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.4 / CRIT-4):
 * Unit-tests for `RoomErrorCounter` — same-cause-fingerprint, count
 * progression, window-based reset, multi-room/multi-hook isolation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { RoomErrorCounter, fingerprintError } from "../RoomErrorCounter.js";

class Fake extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "Fake";
    this.code = code;
  }
}

test("K5 RoomErrorCounter: first track returns count=1, sameCause=false", () => {
  const c = new RoomErrorCounter();
  const r = c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"));
  assert.equal(r.count, 1);
  assert.equal(r.sameCause, false);
  assert.match(r.cause, /^X::boom$/);
});

test("K5 RoomErrorCounter: same cause within window increments", () => {
  const c = new RoomErrorCounter({ windowMs: 60_000 });
  const t = 1_000_000_000_000;
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t);
  const r2 = c.track(
    "ROOM-A",
    "evaluateActivePhase",
    new Fake("boom", "X"),
    t + 5_000,
  );
  assert.equal(r2.count, 2, "2nd same-cause increments");
  assert.equal(r2.sameCause, true);
  const r3 = c.track(
    "ROOM-A",
    "evaluateActivePhase",
    new Fake("boom", "X"),
    t + 10_000,
  );
  assert.equal(r3.count, 3);
  assert.equal(r3.sameCause, true);
});

test("K5 RoomErrorCounter: different cause resets counter", () => {
  const c = new RoomErrorCounter({ windowMs: 60_000 });
  const t = 1_000_000_000_000;
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t);
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t + 1_000);
  const r3 = c.track(
    "ROOM-A",
    "evaluateActivePhase",
    new Fake("different", "Y"),
    t + 2_000,
  );
  assert.equal(r3.count, 1, "different cause resets");
  assert.equal(r3.sameCause, false);
  // Different message but same code → still different cause
  const r4 = c.track(
    "ROOM-A",
    "evaluateActivePhase",
    new Fake("different-msg", "Y"),
    t + 3_000,
  );
  assert.equal(r4.count, 1, "different message resets even with same code");
});

test("K5 RoomErrorCounter: errors > windowMs apart reset counter", () => {
  const c = new RoomErrorCounter({ windowMs: 60_000 });
  const t = 1_000_000_000_000;
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t);
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t + 30_000);
  // 90s after last → outside window
  const r = c.track(
    "ROOM-A",
    "evaluateActivePhase",
    new Fake("boom", "X"),
    t + 90_000 + 30_000 + 100,
  );
  assert.equal(r.count, 1, "out-of-window should reset");
  assert.equal(r.sameCause, false);
});

test("K5 RoomErrorCounter: per-(room,hook) isolation", () => {
  const c = new RoomErrorCounter();
  const t = 1_000_000_000_000;
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t);
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t + 100);
  // Different room
  const rB = c.track(
    "ROOM-B",
    "evaluateActivePhase",
    new Fake("boom", "X"),
    t + 200,
  );
  assert.equal(rB.count, 1, "ROOM-B is independent");
  // Different hook same room
  const rH = c.track(
    "ROOM-A",
    "onDrawCompleted",
    new Fake("boom", "X"),
    t + 300,
  );
  assert.equal(rH.count, 1, "different hook is independent");
});

test("K5 RoomErrorCounter: reset(roomCode) clears all hooks for that room", () => {
  const c = new RoomErrorCounter();
  const t = 1_000_000_000_000;
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t);
  c.track("ROOM-A", "onDrawCompleted", new Fake("boom", "X"), t);
  c.track("ROOM-B", "evaluateActivePhase", new Fake("boom", "X"), t);
  c.reset("ROOM-A");
  assert.equal(c.getState("ROOM-A", "evaluateActivePhase"), undefined);
  assert.equal(c.getState("ROOM-A", "onDrawCompleted"), undefined);
  // ROOM-B untouched
  assert.notEqual(c.getState("ROOM-B", "evaluateActivePhase"), undefined);
});

test("K5 RoomErrorCounter: resetHook(room, hook) clears only that hook", () => {
  const c = new RoomErrorCounter();
  const t = 1_000_000_000_000;
  c.track("ROOM-A", "evaluateActivePhase", new Fake("boom", "X"), t);
  c.track("ROOM-A", "onDrawCompleted", new Fake("boom", "X"), t);
  c.resetHook("ROOM-A", "evaluateActivePhase");
  assert.equal(c.getState("ROOM-A", "evaluateActivePhase"), undefined);
  assert.notEqual(c.getState("ROOM-A", "onDrawCompleted"), undefined);
});

test("K5 fingerprintError: stable across same shape", () => {
  const a = fingerprintError(new Fake("hello", "CODE-1"));
  const b = fingerprintError(new Fake("hello", "CODE-1"));
  assert.equal(a, b);
});

test("K5 fingerprintError: handles non-Error inputs", () => {
  assert.match(fingerprintError("plain"), /^string::plain$/);
  assert.equal(fingerprintError(undefined), "unknown::");
  assert.equal(fingerprintError(null), "unknown::");
});

test("K5 fingerprintError: caps message length at 200 chars", () => {
  const longMsg = "x".repeat(500);
  const fp = fingerprintError(new Fake(longMsg, "Y"));
  // "Y::" + max 200 of msg → 203 chars
  assert.equal(fp.length, "Y::".length + 200);
});
