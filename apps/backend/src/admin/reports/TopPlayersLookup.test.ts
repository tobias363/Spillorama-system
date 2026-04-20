/**
 * BIN-618: unit tests for `buildTopPlayers` aggregate builder.
 *
 * Dekker:
 *   - tom liste → tom response + count=0
 *   - balances → sortering descending
 *   - tie-break på id for determinisme
 *   - limit clamp (default 5, min 1, max 100)
 *   - avatar-lookup propageres
 *   - ukjente walletIds → balance=0 (fail-soft, slik at én manglende wallet
 *     ikke stopper hele dashboard-widgeten)
 *   - displayName fallback (tom displayName → email → id)
 *   - now-injeksjon for deterministisk timestamp
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildTopPlayers, clampLimit, TOP_PLAYERS_DEFAULT_LIMIT, TOP_PLAYERS_MAX_LIMIT } from "./TopPlayersLookup.js";
import type { AppUser } from "../../platform/PlatformService.js";

function makePlayer(id: string, opts?: Partial<AppUser>): AppUser {
  return {
    id,
    email: `${id}@test.no`,
    displayName: `Player ${id}`,
    walletId: `w-${id}`,
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...opts,
  };
}

const FIXED_NOW = () => new Date("2026-04-20T12:00:00.000Z");

test("BIN-618: tom liste → tom response + count=0", () => {
  const out = buildTopPlayers({ players: [], balances: new Map(), now: FIXED_NOW });
  assert.equal(out.count, 0);
  assert.deepEqual(out.players, []);
  assert.equal(out.limit, TOP_PLAYERS_DEFAULT_LIMIT);
  assert.equal(out.generatedAt, "2026-04-20T12:00:00.000Z");
});

test("BIN-618: sortering descending etter walletAmount", () => {
  const players = [makePlayer("a"), makePlayer("b"), makePlayer("c")];
  const balances = new Map([
    ["w-a", 100],
    ["w-b", 500],
    ["w-c", 250],
  ]);
  const out = buildTopPlayers({ players, balances, now: FIXED_NOW });
  assert.deepEqual(out.players.map((p) => p.id), ["b", "c", "a"]);
  assert.deepEqual(out.players.map((p) => p.walletAmount), [500, 250, 100]);
});

test("BIN-618: tie-break på id asc for determinisme", () => {
  const players = [makePlayer("z"), makePlayer("a"), makePlayer("m")];
  const balances = new Map([
    ["w-z", 100],
    ["w-a", 100],
    ["w-m", 100],
  ]);
  const out = buildTopPlayers({ players, balances, now: FIXED_NOW });
  assert.deepEqual(out.players.map((p) => p.id), ["a", "m", "z"]);
});

test("BIN-618: limit=3 → kun topp 3", () => {
  const players = ["a", "b", "c", "d", "e"].map((id) => makePlayer(id));
  const balances = new Map([
    ["w-a", 10],
    ["w-b", 50],
    ["w-c", 30],
    ["w-d", 40],
    ["w-e", 20],
  ]);
  const out = buildTopPlayers({ players, balances, limit: 3, now: FIXED_NOW });
  assert.equal(out.count, 3);
  assert.equal(out.limit, 3);
  assert.deepEqual(out.players.map((p) => p.id), ["b", "d", "c"]);
});

test("BIN-618: limit=0/negative/NaN → fall tilbake til default (5)", () => {
  assert.equal(clampLimit(0), TOP_PLAYERS_DEFAULT_LIMIT);
  assert.equal(clampLimit(-10), TOP_PLAYERS_DEFAULT_LIMIT);
  assert.equal(clampLimit("abc"), TOP_PLAYERS_DEFAULT_LIMIT);
  assert.equal(clampLimit(undefined), TOP_PLAYERS_DEFAULT_LIMIT);
  assert.equal(clampLimit(""), TOP_PLAYERS_DEFAULT_LIMIT);
});

test("BIN-618: limit over MAX clamps ned til 100", () => {
  assert.equal(clampLimit(9999), TOP_PLAYERS_MAX_LIMIT);
  assert.equal(clampLimit("5000"), TOP_PLAYERS_MAX_LIMIT);
});

test("BIN-618: avatar-map propagates til response", () => {
  const players = [makePlayer("a"), makePlayer("b")];
  const balances = new Map([
    ["w-a", 100],
    ["w-b", 50],
  ]);
  const avatars = new Map([
    ["a", "/img/a.png"],
  ]);
  const out = buildTopPlayers({ players, balances, avatars, now: FIXED_NOW });
  assert.equal(out.players[0]!.avatar, "/img/a.png");
  assert.equal(out.players[1]!.avatar, undefined);
});

test("BIN-618: ukjent walletId fail-softer til balance=0", () => {
  const players = [makePlayer("a"), makePlayer("ghost")];
  // "ghost" har ingen balance-oppføring — skal tolkes som 0, ikke kaste.
  const balances = new Map([["w-a", 42]]);
  const out = buildTopPlayers({ players, balances, now: FIXED_NOW });
  assert.equal(out.count, 2);
  assert.equal(out.players[0]!.id, "a");
  assert.equal(out.players[0]!.walletAmount, 42);
  assert.equal(out.players[1]!.id, "ghost");
  assert.equal(out.players[1]!.walletAmount, 0);
});

test("BIN-618: displayName → email → id fallback-kjede for username", () => {
  const players = [
    makePlayer("u1", { displayName: "Alice" }),
    makePlayer("u2", { displayName: "", email: "u2@test.no" }),
    makePlayer("u3", { displayName: "", email: "" }),
  ];
  const balances = new Map([
    ["w-u1", 300],
    ["w-u2", 200],
    ["w-u3", 100],
  ]);
  const out = buildTopPlayers({ players, balances, now: FIXED_NOW });
  assert.equal(out.players[0]!.username, "Alice");
  assert.equal(out.players[1]!.username, "u2@test.no");
  assert.equal(out.players[2]!.username, "u3");
});

test("BIN-618: walletAmount rundes til 2 desimaler (tåler float-drift)", () => {
  const players = [makePlayer("a")];
  const balances = new Map([["w-a", 123.456789]]);
  const out = buildTopPlayers({ players, balances, now: FIXED_NOW });
  assert.equal(out.players[0]!.walletAmount, 123.46);
});

test("BIN-618: NaN/Infinity balance → 0 (fail-soft)", () => {
  const players = [makePlayer("a"), makePlayer("b")];
  const balances = new Map([
    ["w-a", Number.NaN],
    ["w-b", Number.POSITIVE_INFINITY],
  ]);
  const out = buildTopPlayers({ players, balances, now: FIXED_NOW });
  // Both coerce to 0; tie-break on id asc.
  assert.deepEqual(out.players.map((p) => p.id), ["a", "b"]);
  assert.deepEqual(out.players.map((p) => p.walletAmount), [0, 0]);
});

test("BIN-618: generatedAt bruker injected now()", () => {
  const out = buildTopPlayers({
    players: [],
    balances: new Map(),
    now: () => new Date("2030-12-31T23:59:59.999Z"),
  });
  assert.equal(out.generatedAt, "2030-12-31T23:59:59.999Z");
});
