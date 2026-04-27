/**
 * Tests for canonical room-code mapping (Tobias 2026-04-27).
 *
 * Verifiserer at Spill 2/3 mapper til ÉN GLOBAL room-code uavhengig av hall,
 * mens Spill 1 og ukjente slugs holder per-hall-isolasjon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getCanonicalRoomCode } from "./canonicalRoomCode.js";

test("bingo (Spill 1) → BINGO1, per-hall", () => {
  const r = getCanonicalRoomCode("bingo", "hall-A");
  assert.equal(r.roomCode, "BINGO1");
  assert.equal(r.effectiveHallId, "hall-A");
  assert.equal(r.isHallShared, false);
});

test("bingo i ulike haller bevarer per-hall-effective-id", () => {
  const a = getCanonicalRoomCode("bingo", "hall-A");
  const b = getCanonicalRoomCode("bingo", "hall-B");
  assert.equal(a.roomCode, b.roomCode); // samme room-code …
  assert.notEqual(a.effectiveHallId, b.effectiveHallId); // … men ulik hall-binding
});

test("rocket (Spill 2) → ROCKET shared, hallId ignoreres", () => {
  const a = getCanonicalRoomCode("rocket", "hall-A");
  const b = getCanonicalRoomCode("rocket", "hall-B");
  assert.equal(a.roomCode, "ROCKET");
  assert.equal(b.roomCode, "ROCKET");
  assert.equal(a.effectiveHallId, null);
  assert.equal(a.isHallShared, true);
});

test("monsterbingo (Spill 3) → MONSTERBINGO shared", () => {
  const r = getCanonicalRoomCode("monsterbingo", "hall-A");
  assert.equal(r.roomCode, "MONSTERBINGO");
  assert.equal(r.effectiveHallId, null);
  assert.equal(r.isHallShared, true);
});

test("ukjent slug → uppercased per-hall (ikke shared)", () => {
  const r = getCanonicalRoomCode("themebingo", "hall-A");
  assert.equal(r.roomCode, "THEMEBINGO");
  assert.equal(r.effectiveHallId, "hall-A");
  assert.equal(r.isHallShared, false);
});

test("undefined slug defaulter til bingo (Spill 1)", () => {
  const r = getCanonicalRoomCode(undefined, "hall-A");
  assert.equal(r.roomCode, "BINGO1");
  assert.equal(r.effectiveHallId, "hall-A");
  assert.equal(r.isHallShared, false);
});

test("case-insensitivt: ROCKET / Rocket → samme global rom", () => {
  const upper = getCanonicalRoomCode("ROCKET", "hall-A");
  const mixed = getCanonicalRoomCode("Rocket", "hall-B");
  assert.equal(upper.roomCode, "ROCKET");
  assert.equal(mixed.roomCode, "ROCKET");
  assert.equal(upper.isHallShared, true);
  assert.equal(mixed.isHallShared, true);
});

test("whitespace trimmes på slug-input", () => {
  const r = getCanonicalRoomCode("  rocket  ", "hall-A");
  assert.equal(r.roomCode, "ROCKET");
  assert.equal(r.isHallShared, true);
});
