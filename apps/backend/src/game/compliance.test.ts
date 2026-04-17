import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { assertTicketsPerPlayerWithinHallLimit } from "./compliance.js";

test("hall ticket cap allows undefined requested value", () => {
  assert.doesNotThrow(() => assertTicketsPerPlayerWithinHallLimit(undefined, 5));
});

test("hall ticket cap allows value within configured max", () => {
  assert.doesNotThrow(() => assertTicketsPerPlayerWithinHallLimit(3, 3));
});

test("hall ticket cap rejects value above configured max", () => {
  assert.throws(
    () => assertTicketsPerPlayerWithinHallLimit(4, 3),
    (error: unknown) => error instanceof DomainError && error.code === "TICKETS_ABOVE_HALL_LIMIT"
  );
});

test("hall ticket cap rejects invalid hall max config", () => {
  assert.throws(
    () => assertTicketsPerPlayerWithinHallLimit(2, 31),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_HALL_CONFIG"
  );
});
