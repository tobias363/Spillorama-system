import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "../../game/BingoEngine.js";
import {
  classifyDrawError,
  DrawErrorTracker,
} from "../DrawErrorClassifier.js";

describe("classifyDrawError", () => {
  // ── PERMANENT errors ──────────────────────────────────────

  it("classifies NO_MORE_NUMBERS as PERMANENT", () => {
    const result = classifyDrawError(
      new DomainError("NO_MORE_NUMBERS", "Maks antall trekk nådd."),
    );
    assert.equal(result.category, "PERMANENT");
    assert.equal(result.shouldRetry, false);
    assert.equal(result.logLevel, "info");
    assert.ok(result.reason.includes("NO_MORE_NUMBERS"));
  });

  it("classifies GAME_NOT_RUNNING as PERMANENT", () => {
    const result = classifyDrawError(
      new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde."),
    );
    assert.equal(result.category, "PERMANENT");
    assert.equal(result.shouldRetry, false);
  });

  it("classifies GAME_ALREADY_RUNNING as PERMANENT", () => {
    const result = classifyDrawError(
      new DomainError("GAME_ALREADY_RUNNING", "Spillet er allerede i gang."),
    );
    assert.equal(result.category, "PERMANENT");
  });

  it("classifies ROUND_START_TOO_SOON as PERMANENT", () => {
    const result = classifyDrawError(
      new DomainError("ROUND_START_TOO_SOON", "For tidlig."),
    );
    assert.equal(result.category, "PERMANENT");
    assert.equal(result.shouldRetry, false);
  });

  it("classifies NOT_ENOUGH_PLAYERS as PERMANENT", () => {
    const result = classifyDrawError(
      new DomainError("NOT_ENOUGH_PLAYERS", "Trenger flere spillere."),
    );
    assert.equal(result.category, "PERMANENT");
  });

  it("classifies PLAYER_ALREADY_IN_RUNNING_GAME as PERMANENT", () => {
    const result = classifyDrawError(
      new DomainError("PLAYER_ALREADY_IN_RUNNING_GAME", "Allerede med."),
    );
    assert.equal(result.category, "PERMANENT");
  });

  it("classifies ROOM_NOT_FOUND as PERMANENT", () => {
    const result = classifyDrawError(
      new DomainError("ROOM_NOT_FOUND", "Rommet finnes ikke."),
    );
    assert.equal(result.category, "PERMANENT");
    assert.equal(result.shouldRetry, false);
  });

  // ── TRANSIENT errors ──────────────────────────────────────

  it("classifies PLAYER_NOT_FOUND as TRANSIENT", () => {
    const result = classifyDrawError(
      new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke."),
    );
    assert.equal(result.category, "TRANSIENT");
    assert.equal(result.shouldRetry, true);
    assert.equal(result.logLevel, "warn");
  });

  it("classifies WALLET_ERROR as TRANSIENT", () => {
    const result = classifyDrawError(
      new DomainError("WALLET_ERROR", "Wallet unavailable."),
    );
    assert.equal(result.category, "TRANSIENT");
    assert.equal(result.shouldRetry, true);
  });

  it("classifies INSUFFICIENT_BALANCE as TRANSIENT", () => {
    const result = classifyDrawError(
      new DomainError("INSUFFICIENT_BALANCE", "Not enough funds."),
    );
    assert.equal(result.category, "TRANSIENT");
    assert.equal(result.shouldRetry, true);
  });

  // ── FATAL errors ──────────────────────────────────────────

  it("classifies unknown DomainError codes as FATAL", () => {
    const result = classifyDrawError(
      new DomainError("SOME_NEW_CODE", "Something unexpected."),
    );
    assert.equal(result.category, "FATAL");
    assert.equal(result.shouldRetry, false);
    assert.equal(result.logLevel, "error");
    assert.ok(result.reason.includes("Unknown DomainError.SOME_NEW_CODE"));
  });

  it("classifies generic Error as FATAL", () => {
    const result = classifyDrawError(new Error("null pointer"));
    assert.equal(result.category, "FATAL");
    assert.equal(result.shouldRetry, false);
    assert.equal(result.logLevel, "error");
    assert.ok(result.reason.includes("null pointer"));
  });

  it("classifies TypeError as FATAL", () => {
    const result = classifyDrawError(
      new TypeError("Cannot read properties of undefined"),
    );
    assert.equal(result.category, "FATAL");
    assert.equal(result.shouldRetry, false);
  });

  it("classifies non-Error values as FATAL", () => {
    const result = classifyDrawError("string error");
    assert.equal(result.category, "FATAL");
    assert.ok(result.reason.includes("string error"));

    const result2 = classifyDrawError(42);
    assert.equal(result2.category, "FATAL");

    const result3 = classifyDrawError(null);
    assert.equal(result3.category, "FATAL");
  });
});

describe("DrawErrorTracker", () => {
  it("tracks metrics per category", () => {
    const tracker = new DrawErrorTracker();

    tracker.record("R1", classifyDrawError(new DomainError("NO_MORE_NUMBERS", "")));
    tracker.record("R1", classifyDrawError(new DomainError("GAME_NOT_RUNNING", "")));
    tracker.record("R1", classifyDrawError(new Error("crash")));

    const m = tracker.metrics;
    assert.equal(m.permanent, 2);
    assert.equal(m.transient, 0);
    assert.equal(m.fatal, 1);
  });

  it("tracks metrics per room", () => {
    const tracker = new DrawErrorTracker();

    tracker.record("A", classifyDrawError(new DomainError("NO_MORE_NUMBERS", "")));
    tracker.record("A", classifyDrawError(new Error("boom")));
    tracker.record("B", classifyDrawError(new DomainError("WALLET_ERROR", "")));

    const m = tracker.metrics;
    const roomA = m.byRoom.get("A");
    assert.ok(roomA);
    assert.equal(roomA.permanent, 1);
    assert.equal(roomA.fatal, 1);
    assert.equal(roomA.transient, 0);

    const roomB = m.byRoom.get("B");
    assert.ok(roomB);
    assert.equal(roomB.transient, 1);
    assert.equal(roomB.permanent, 0);
  });

  it("toJSON returns serializable summary", () => {
    const tracker = new DrawErrorTracker();
    tracker.record("R1", classifyDrawError(new DomainError("NO_MORE_NUMBERS", "")));
    tracker.record("R1", classifyDrawError(new Error("x")));

    const json = tracker.toJSON();
    assert.deepEqual(json, { permanent: 1, transient: 0, fatal: 1 });
  });

  it("cleanup removes stale room metrics", () => {
    const tracker = new DrawErrorTracker();
    tracker.record("ACTIVE", classifyDrawError(new DomainError("NO_MORE_NUMBERS", "")));
    tracker.record("DEAD", classifyDrawError(new Error("x")));

    tracker.cleanup(new Set(["ACTIVE"]));

    const m = tracker.metrics;
    assert.ok(m.byRoom.has("ACTIVE"));
    assert.ok(!m.byRoom.has("DEAD"));
    // Global counters are cumulative — not affected by cleanup.
    assert.equal(m.permanent, 1);
    assert.equal(m.fatal, 1);
  });
});
