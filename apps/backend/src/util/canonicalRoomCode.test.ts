/**
 * Tests for canonical room-code mapping (Tobias 2026-04-27).
 *
 * Verifiserer at Spill 2/3 mapper til ÉN GLOBAL room-code uavhengig av hall,
 * mens Spill 1 mappes til ett rom per LINK (Group of Halls). Ukjente slugs
 * holder per-hall-isolasjon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getCanonicalRoomCode } from "./canonicalRoomCode.js";

test("bingo (Spill 1) + groupId → BINGO_<groupId>, hall-shared", () => {
  const r = getCanonicalRoomCode("bingo", "hall-A", "group-X");
  assert.equal(r.roomCode, "BINGO_group-X");
  assert.equal(r.effectiveHallId, null);
  assert.equal(r.isHallShared, true);
});

test("bingo + ulike haller i SAMME gruppe deler rom", () => {
  const a = getCanonicalRoomCode("bingo", "hall-A", "group-X");
  const b = getCanonicalRoomCode("bingo", "hall-B", "group-X");
  assert.equal(a.roomCode, b.roomCode); // samme rom-code
  assert.equal(a.effectiveHallId, null);
  assert.equal(b.effectiveHallId, null);
  assert.equal(a.isHallShared, true);
  assert.equal(b.isHallShared, true);
});

test("bingo i ulike grupper får ulike rom", () => {
  const a = getCanonicalRoomCode("bingo", "hall-A", "group-X");
  const b = getCanonicalRoomCode("bingo", "hall-B", "group-Y");
  assert.notEqual(a.roomCode, b.roomCode);
  assert.equal(a.roomCode, "BINGO_group-X");
  assert.equal(b.roomCode, "BINGO_group-Y");
});

test("bingo uten gruppe (groupId=null) faller tilbake til hallId", () => {
  const r = getCanonicalRoomCode("bingo", "hall-A", null);
  assert.equal(r.roomCode, "BINGO_hall-A");
  assert.equal(r.effectiveHallId, null);
  assert.equal(r.isHallShared, true);
});

test("bingo uten gruppe (groupId=undefined) faller tilbake til hallId", () => {
  const r = getCanonicalRoomCode("bingo", "hall-A");
  assert.equal(r.roomCode, "BINGO_hall-A");
  assert.equal(r.effectiveHallId, null);
  assert.equal(r.isHallShared, true);
});

test("bingo: ulike haller uten gruppe får ULIKE rom", () => {
  const a = getCanonicalRoomCode("bingo", "hall-A", null);
  const b = getCanonicalRoomCode("bingo", "hall-B", null);
  assert.notEqual(a.roomCode, b.roomCode);
  assert.equal(a.roomCode, "BINGO_hall-A");
  assert.equal(b.roomCode, "BINGO_hall-B");
});

test("rocket (Spill 2) → ROCKET shared, hallId og groupId ignoreres", () => {
  const a = getCanonicalRoomCode("rocket", "hall-A");
  const b = getCanonicalRoomCode("rocket", "hall-B", "group-X");
  assert.equal(a.roomCode, "ROCKET");
  assert.equal(b.roomCode, "ROCKET");
  assert.equal(a.effectiveHallId, null);
  assert.equal(b.effectiveHallId, null);
  assert.equal(a.isHallShared, true);
});

test("monsterbingo (Spill 3) → MONSTERBINGO shared, groupId ignoreres", () => {
  const r = getCanonicalRoomCode("monsterbingo", "hall-A", "group-X");
  assert.equal(r.roomCode, "MONSTERBINGO");
  assert.equal(r.effectiveHallId, null);
  assert.equal(r.isHallShared, true);
});

test("ukjent slug → uppercased per-hall (ikke shared, groupId ignoreres)", () => {
  const r = getCanonicalRoomCode("themebingo", "hall-A", "group-X");
  assert.equal(r.roomCode, "THEMEBINGO");
  assert.equal(r.effectiveHallId, "hall-A");
  assert.equal(r.isHallShared, false);
});

test("undefined slug defaulter til bingo (Spill 1) — bruker groupId hvis gitt", () => {
  const r = getCanonicalRoomCode(undefined, "hall-A", "group-X");
  assert.equal(r.roomCode, "BINGO_group-X");
  assert.equal(r.effectiveHallId, null);
  assert.equal(r.isHallShared, true);
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
