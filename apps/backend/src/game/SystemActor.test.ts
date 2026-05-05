/**
 * Unit-tests for SystemActor sentinel.
 *
 * Audit-ref: SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05.md §2.1, §2.6.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SYSTEM_ACTOR_ID, isSystemActor } from "./SystemActor.js";

test("SYSTEM_ACTOR_ID is the canonical sentinel string", () => {
  assert.equal(SYSTEM_ACTOR_ID, "__system_actor__");
});

test("isSystemActor matches the sentinel id exactly", () => {
  assert.equal(isSystemActor(SYSTEM_ACTOR_ID), true);
});

test("isSystemActor rejects real player UUIDs", () => {
  assert.equal(
    isSystemActor("ed4f8c6f-1234-4567-89ab-cdef01234567"),
    false,
  );
  assert.equal(isSystemActor("alice-id"), false);
  assert.equal(isSystemActor("the-host-id-42"), false);
});

test("isSystemActor rejects null + undefined + empty string", () => {
  assert.equal(isSystemActor(null), false);
  assert.equal(isSystemActor(undefined), false);
  assert.equal(isSystemActor(""), false);
});

test("isSystemActor is case-sensitive (no normalization)", () => {
  // System-actor er en eksakt sentinel, ikke en pattern. Klient som prøver
  // å spoofe med ulik casing skal IKKE matche.
  assert.equal(isSystemActor("__SYSTEM_ACTOR__"), false);
  assert.equal(isSystemActor("__System_Actor__"), false);
});

test("isSystemActor rejects strings that contain the sentinel substring", () => {
  // Defensiv: bare exact-match. Substring-match ville være en injeksjonsbug.
  assert.equal(isSystemActor("prefix-__system_actor__"), false);
  assert.equal(isSystemActor("__system_actor__-suffix"), false);
});
