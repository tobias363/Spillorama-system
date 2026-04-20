/**
 * BIN-651 unit-tester for red-flag players aggregate.
 *
 * Dekker:
 *   - Category-filter (slug-basert).
 *   - [from, to]-vindu på flaggedAt.
 *   - Dedup per user — nyeste flag vinner.
 *   - Manglende user hopp over (ingen krasj).
 *   - totalStakes-summering fra STAKE-ledger (ignorerer PRIZE/ORG).
 *   - lastActivity = nyeste ledger-event, fallback til flaggedAt.
 *   - Sortering nyeste flaggedAt først, userId-breaker.
 *   - Cursor-paginering (offset-basert).
 *   - Ugyldig category-id kaster.
 *   - Ugyldig vindu (from > to) kaster.
 *   - Canonical category-liste har 9 legacy-slugs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { AmlRedFlag } from "../../compliance/AmlService.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import {
  RED_FLAG_CATEGORIES,
  buildRedFlagPlayersReport,
  isValidRedFlagCategoryId,
  type RedFlagPlayerUserInfo,
} from "./RedFlagPlayersReport.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function flag(
  id: string,
  userId: string,
  ruleSlug: string,
  createdAt: string,
  overrides: Partial<AmlRedFlag> = {}
): AmlRedFlag {
  return {
    id,
    userId,
    ruleSlug,
    severity: "MEDIUM",
    status: "OPEN",
    reason: "test",
    transactionId: null,
    details: null,
    openedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewOutcome: null,
    reviewNote: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function user(id: string, name: string, email: string): RedFlagPlayerUserInfo {
  return { userId: id, displayName: name, email };
}

function usersMap(...users: RedFlagPlayerUserInfo[]): Map<string, RedFlagPlayerUserInfo> {
  const m = new Map<string, RedFlagPlayerUserInfo>();
  for (const u of users) m.set(u.userId, u);
  return m;
}

function stake(
  userId: string,
  amount: number,
  createdAt: string,
  hallId = "hall-1"
): ComplianceLedgerEntry {
  const ms = Date.parse(createdAt);
  return {
    id: `le-${userId}-${ms}`,
    createdAt,
    createdAtMs: ms,
    hallId,
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "STAKE",
    amount,
    currency: "NOK",
    walletId: userId,
    playerId: userId,
  };
}

function prize(
  userId: string,
  amount: number,
  createdAt: string,
  hallId = "hall-1"
): ComplianceLedgerEntry {
  return {
    ...stake(userId, amount, createdAt, hallId),
    eventType: "PRIZE",
  };
}

// ── Tests: category catalogue ─────────────────────────────────────────────

test("BIN-651: 9 legacy-kategorier er definert som kanoniske slugs", () => {
  assert.equal(RED_FLAG_CATEGORIES.length, 9);
  const legacyIds = RED_FLAG_CATEGORIES.map((c) => c.legacyId).sort((a, b) => a - b);
  assert.deepEqual(legacyIds, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Slug-er er unike og kebab-case.
  const slugs = new Set(RED_FLAG_CATEGORIES.map((c) => c.id));
  assert.equal(slugs.size, 9);
  for (const slug of slugs) {
    assert.match(slug, /^[a-z][a-z0-9-]*$/);
  }
});

test("BIN-651: isValidRedFlagCategoryId aksepterer kjente + avviser ukjente", () => {
  assert.equal(isValidRedFlagCategoryId("used-in-day"), true);
  assert.equal(isValidRedFlagCategoryId("lost-in-month"), true);
  assert.equal(isValidRedFlagCategoryId("not-bank-id-verified"), true);
  assert.equal(isValidRedFlagCategoryId(""), false);
  assert.equal(isValidRedFlagCategoryId("unknown"), false);
  assert.equal(isValidRedFlagCategoryId("USED-IN-DAY"), false);
});

// ── Tests: category filter ────────────────────────────────────────────────

test("BIN-651: category-filter returnerer kun flagg med matchende ruleSlug", () => {
  const flags = [
    flag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
    flag("f2", "u2", "lost-in-day", "2026-04-10T10:00:00.000Z"),
    flag("f3", "u3", "used-in-day", "2026-04-11T10:00:00.000Z"),
  ];
  const users = usersMap(
    user("u1", "Alice", "a@test.no"),
    user("u2", "Bob", "b@test.no"),
    user("u3", "Carol", "c@test.no")
  );
  const res = buildRedFlagPlayersReport({ flags, users, category: "used-in-day" });
  assert.equal(res.items.length, 2);
  assert.equal(res.totalCount, 2);
  assert.equal(res.category, "used-in-day");
  assert.ok(res.items.every((r) => r.categoryId === "used-in-day"));
});

test("BIN-651: uten category returneres alle kategorier", () => {
  const flags = [
    flag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
    flag("f2", "u2", "pep", "2026-04-10T10:00:00.000Z"),
  ];
  const users = usersMap(
    user("u1", "Alice", "a@test.no"),
    user("u2", "Bob", "b@test.no")
  );
  const res = buildRedFlagPlayersReport({ flags, users });
  assert.equal(res.items.length, 2);
  assert.equal(res.category, null);
});

test("BIN-651: ukjent category-slug → kaster", () => {
  assert.throws(
    () =>
      buildRedFlagPlayersReport({
        flags: [],
        users: new Map(),
        category: "not-a-real-slug",
      }),
    /Ukjent kategori-id/
  );
});

// ── Tests: date window ────────────────────────────────────────────────────

test("BIN-651: [from,to]-vindu filtrerer på flag.createdAt inkl. begge endepunkter", () => {
  const flags = [
    flag("f1", "u1", "used-in-day", "2026-04-10T00:00:00.000Z"),
    flag("f2", "u2", "used-in-day", "2026-04-15T12:00:00.000Z"),
    flag("f3", "u3", "used-in-day", "2026-04-20T23:59:59.000Z"),
  ];
  const users = usersMap(
    user("u1", "Alice", "a@test.no"),
    user("u2", "Bob", "b@test.no"),
    user("u3", "Carol", "c@test.no")
  );
  const res = buildRedFlagPlayersReport({
    flags,
    users,
    from: "2026-04-15T00:00:00.000Z",
    to: "2026-04-20T23:59:59.999Z",
  });
  assert.equal(res.items.length, 2);
  const ids = res.items.map((r) => r.userId).sort();
  assert.deepEqual(ids, ["u2", "u3"]);
});

test("BIN-651: from > to → kaster", () => {
  assert.throws(
    () =>
      buildRedFlagPlayersReport({
        flags: [],
        users: new Map(),
        from: "2026-05-01T00:00:00.000Z",
        to: "2026-04-01T00:00:00.000Z",
      }),
    /må være <= 'to'/
  );
});

// ── Tests: user dedup + missing user ──────────────────────────────────────

test("BIN-651: flere flagg per user → kun nyeste beholdes", () => {
  const flags = [
    flag("f-old", "u1", "used-in-day", "2026-04-01T10:00:00.000Z"),
    flag("f-new", "u1", "used-in-day", "2026-04-15T10:00:00.000Z"),
    flag("f-mid", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
  ];
  const users = usersMap(user("u1", "Alice", "a@test.no"));
  const res = buildRedFlagPlayersReport({ flags, users });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0]!.flaggedAt, "2026-04-15T10:00:00.000Z");
});

test("BIN-651: manglende user (hard-slettet) hoppes over i rad-listen", () => {
  const flags = [
    flag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z"),
    flag("f2", "u-gone", "used-in-day", "2026-04-11T10:00:00.000Z"),
  ];
  const users = usersMap(user("u1", "Alice", "a@test.no"));
  const res = buildRedFlagPlayersReport({ flags, users });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0]!.userId, "u1");
});

// ── Tests: stake aggregation + last activity ─────────────────────────────

test("BIN-651: totalStakes summer STAKE-entries, ignorerer PRIZE/ORG", () => {
  const flags = [flag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z")];
  const users = usersMap(user("u1", "Alice", "a@test.no"));
  const ledgerEntries = [
    stake("u1", 100, "2026-04-09T12:00:00.000Z"),
    stake("u1", 50.5, "2026-04-09T13:00:00.000Z"),
    prize("u1", 30, "2026-04-09T14:00:00.000Z"),
  ];
  const res = buildRedFlagPlayersReport({ flags, users, ledgerEntries });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0]!.totalStakes, 150.5);
});

test("BIN-651: lastActivity = nyeste ledger-event (uansett eventType)", () => {
  const flags = [flag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z")];
  const users = usersMap(user("u1", "Alice", "a@test.no"));
  const ledgerEntries = [
    stake("u1", 100, "2026-04-09T12:00:00.000Z"),
    prize("u1", 50, "2026-04-12T15:30:00.000Z"),
  ];
  const res = buildRedFlagPlayersReport({ flags, users, ledgerEntries });
  assert.equal(res.items[0]!.lastActivity, "2026-04-12T15:30:00.000Z");
});

test("BIN-651: uten ledger-entries → totalStakes=0, lastActivity=flaggedAt", () => {
  const flags = [flag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z")];
  const users = usersMap(user("u1", "Alice", "a@test.no"));
  const res = buildRedFlagPlayersReport({ flags, users });
  assert.equal(res.items[0]!.totalStakes, 0);
  assert.equal(res.items[0]!.lastActivity, "2026-04-10T10:00:00.000Z");
});

// ── Tests: sort order ─────────────────────────────────────────────────────

test("BIN-651: sortert nyeste flaggedAt først, userId som tiebreaker", () => {
  const flags = [
    flag("f1", "u3", "used-in-day", "2026-04-10T10:00:00.000Z"),
    flag("f2", "u1", "used-in-day", "2026-04-15T10:00:00.000Z"),
    flag("f3", "u2", "used-in-day", "2026-04-15T10:00:00.000Z"),
  ];
  const users = usersMap(
    user("u1", "A", "a@t.no"),
    user("u2", "B", "b@t.no"),
    user("u3", "C", "c@t.no")
  );
  const res = buildRedFlagPlayersReport({ flags, users });
  const order = res.items.map((r) => r.userId);
  assert.deepEqual(order, ["u1", "u2", "u3"]);
});

// ── Tests: pagination ─────────────────────────────────────────────────────

test("BIN-651: cursor-pagin — første side + nextCursor + andre side", () => {
  const flags: AmlRedFlag[] = [];
  const users = new Map<string, RedFlagPlayerUserInfo>();
  // 5 users med fallende timestamps (u1=nyest).
  for (let i = 1; i <= 5; i++) {
    const uid = `u${i}`;
    flags.push(
      flag(`f${i}`, uid, "used-in-day", `2026-04-${20 - i}T10:00:00.000Z`)
    );
    users.set(uid, { userId: uid, displayName: `User ${i}`, email: `${uid}@t.no` });
  }
  const first = buildRedFlagPlayersReport({ flags, users, pageSize: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.totalCount, 5);
  assert.ok(first.nextCursor, "nextCursor er satt når det finnes flere rader");
  assert.deepEqual(
    first.items.map((r) => r.userId),
    ["u1", "u2"]
  );

  const second = buildRedFlagPlayersReport({
    flags,
    users,
    pageSize: 2,
    cursor: first.nextCursor!,
  });
  assert.equal(second.items.length, 2);
  assert.deepEqual(
    second.items.map((r) => r.userId),
    ["u3", "u4"]
  );
  assert.ok(second.nextCursor);

  const third = buildRedFlagPlayersReport({
    flags,
    users,
    pageSize: 2,
    cursor: second.nextCursor!,
  });
  assert.equal(third.items.length, 1);
  assert.deepEqual(third.items.map((r) => r.userId), ["u5"]);
  assert.equal(third.nextCursor, null);
});

test("BIN-651: ugyldig cursor tolkes som offset 0 (graceful)", () => {
  const flags = [flag("f1", "u1", "used-in-day", "2026-04-10T10:00:00.000Z")];
  const users = usersMap(user("u1", "A", "a@t.no"));
  const res = buildRedFlagPlayersReport({
    flags,
    users,
    cursor: "not-a-real-cursor",
    pageSize: 10,
  });
  assert.equal(res.items.length, 1);
});

test("BIN-651: pageSize klemmes til [1, 500]", () => {
  const flags: AmlRedFlag[] = [];
  const users = new Map<string, RedFlagPlayerUserInfo>();
  for (let i = 1; i <= 3; i++) {
    const uid = `u${i}`;
    flags.push(flag(`f${i}`, uid, "used-in-day", `2026-04-${20 - i}T10:00:00.000Z`));
    users.set(uid, { userId: uid, displayName: `User ${i}`, email: `${uid}@t.no` });
  }
  const zero = buildRedFlagPlayersReport({ flags, users, pageSize: 0 });
  assert.equal(zero.items.length, 1); // klemt opp til 1
  const huge = buildRedFlagPlayersReport({ flags, users, pageSize: 10_000 });
  assert.equal(huge.items.length, 3); // klemt ned til 500, finnes bare 3
});
