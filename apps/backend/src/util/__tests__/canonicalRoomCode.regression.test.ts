/**
 * canonicalRoomCode.regression.test.ts
 *
 * REGRESSION 2026-04-27 (test-engineer pilot validation): canonical room code
 * preserves hallId case but BingoEngine.getRoomSnapshot uppercases the lookup.
 * For production hall slugs (lowercase: "notodden", "harstad", "sortland",
 * "bodo"), the canonical room code becomes `BINGO_notodden` (mixed case).
 * Lookup via getRoomSnapshot uppercases to `BINGO_NOTODDEN` → ROOM_NOT_FOUND.
 *
 * BLAST RADIUS: this regression blocks `room:create` for ALL pilot halls.
 * The 4 confirmed pilot halls all use lowercase slugs.
 *
 * Root cause: PR #617 (canonical-room per Group-of-Halls) introduced
 * `getCanonicalRoomCode()` which composes `BINGO_<linkKey>` without
 * normalizing case. BingoEngine.createRoom stores `code = input.roomCode`
 * AS-IS at line 747, but every public lookup (getRoomSnapshot, joinRoom,
 * drawNextNumber, etc.) uppercases the input.
 *
 * Fix surface (NOT done in this PR — test-only):
 *   Option A: canonicalRoomCode.ts uppercases the linkKey:
 *     `roomCode: \`BINGO_\${linkKey.toUpperCase()}\``
 *   Option B: BingoEngine.createRoom normalizes input.roomCode to uppercase
 *     before storing.
 *
 * Tobias must decide which option applies — both are 1-line fixes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine, DomainError } from "../../game/BingoEngine.js";
import { InMemoryWalletAdapter } from "../../game/BingoEngine.test.js";
import { getCanonicalRoomCode } from "../canonicalRoomCode.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../../game/types.js";

class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12, 0, 13, 14],
        [15, 16, 17, 18, 19],
        [20, 21, 22, 23, 24],
      ],
    };
  }
}

const PILOT_HALL_SLUGS = ["notodden", "harstad", "sortland", "bodo"];

test("canonical room code: uppercase hallId works (control path)", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const upperHall = "NOTODDEN";
  const mapping = getCanonicalRoomCode("bingo", upperHall, null);
  const { roomCode } = await engine.createRoom({
    hallId: upperHall,
    playerName: "Alice",
    walletId: "w-alice",
    roomCode: mapping.roomCode,
    gameSlug: "bingo",
    effectiveHallId: mapping.effectiveHallId ?? undefined,
  });
  // Control: with uppercase hallId, getRoomSnapshot works.
  assert.doesNotThrow(() => engine.getRoomSnapshot(roomCode));
});

for (const slug of PILOT_HALL_SLUGS) {
  test(`REGRESSION 2026-04-27 (PILOT BLOCKER): pilot hall "${slug}" canonical room code MUST be retrievable`, async () => {
    const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
      minDrawIntervalMs: 0,
    });
    const mapping = getCanonicalRoomCode("bingo", slug, null);
    const { roomCode } = await engine.createRoom({
      hallId: slug,
      playerName: "Alice",
      walletId: `w-${slug}`,
      roomCode: mapping.roomCode,
      gameSlug: "bingo",
      effectiveHallId: mapping.effectiveHallId ?? undefined,
    });
    // BUG: getRoomSnapshot uppercases lookup (`BINGO_${slug.toUpperCase()}`)
    // but room is stored as `BINGO_${slug}` (mixed case) → ROOM_NOT_FOUND.
    assert.doesNotThrow(
      () => engine.getRoomSnapshot(roomCode),
      `getRoomSnapshot MUST work for pilot hall slug "${slug}" — currently broken`,
    );
  });
}

test("REGRESSION 2026-04-27 (PILOT BLOCKER): joinRoom for pilot hall fails with ROOM_NOT_FOUND", async () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const mapping = getCanonicalRoomCode("bingo", "notodden", null);
  await engine.createRoom({
    hallId: "notodden",
    playerName: "Alice",
    walletId: "w-alice",
    roomCode: mapping.roomCode,
    gameSlug: "bingo",
    effectiveHallId: mapping.effectiveHallId ?? undefined,
  });
  // Bob tries to join via the canonical room code.
  // joinRoom internally calls requireRoom (no uppercase) but
  // expectedRoomCode is `mapping.roomCode` which the test passes back.
  // joinRoom uppercases input.roomCode at line 774 → mismatch → ROOM_NOT_FOUND.
  await assert.rejects(
    engine.joinRoom({
      roomCode: mapping.roomCode,
      hallId: "notodden",
      playerName: "Bob",
      walletId: "w-bob",
    }),
    (err: unknown) => {
      // This is the bug — joinRoom should succeed but throws ROOM_NOT_FOUND
      // because the room was stored mixed-case but lookup uppercases.
      return err instanceof DomainError && err.code === "ROOM_NOT_FOUND";
    },
    "joinRoom currently fails for lowercase hall slugs (this rejects-test will start FAILING when bug is fixed — invert assertion to assert.doesNotReject)",
  );
});

test("getCanonicalRoomCode: case preservation contract — current behaviour documented", () => {
  // This test pins the CURRENT case behaviour of getCanonicalRoomCode so a
  // fix that uppercases the linkKey trips this test (signal: contract change).
  const m1 = getCanonicalRoomCode("bingo", "notodden", null);
  const m2 = getCanonicalRoomCode("bingo", "Mixed-Case-Hall", "group-A");
  // After the fix, these expectations should change to uppercase forms.
  assert.equal(m1.roomCode, "BINGO_notodden", "current: linkKey case preserved");
  assert.equal(m2.roomCode, "BINGO_group-A", "current: groupId case preserved");
  // Spill 2/3 already uppercase — proves the fix is feasible without breaking them.
  assert.equal(getCanonicalRoomCode("rocket", "any-hall").roomCode, "ROCKET");
  assert.equal(getCanonicalRoomCode("monsterbingo", "any-hall").roomCode, "MONSTERBINGO");
});
