/**
 * BingoEngine.preserveArmedOnReconnect.scenario.test.ts
 *
 * FORHANDSKJOP-ORPHAN-FIX (PR 2, 2026-04-29) — high-level scenario test.
 *
 * Reproduces the exact production race that orphaned 60 kr from 10:36 to
 * 10:56 on 2026-04-29 (Tobias-rapport, reservation `cc909aed-…`):
 *
 *   1. Player joins room, arms a forhåndskjøp, opens a wallet
 *      reservation in `RoomStateManager`.
 *   2. Player's socket disconnects (`detachSocket`). Game ends — room
 *      transitions to ENDED (idle).
 *   3. ANOTHER player triggers `room:create`/`room:join`, which calls
 *      `engine.cleanupStaleWalletInIdleRooms` with the new options-form.
 *      The closure body asks RoomStateManager: "does this player still
 *      have armed-state or a reservation?" — and the answer is YES.
 *   4. The cleanup helper SKIPS the eviction. Player remains in
 *      `room.players`.
 *   5. `onAutoStart` runs `startGame` with the player's armedPlayerIds
 *      and reservationIdByPlayer. The buy-in loop calls
 *      `commitReservation` on the wallet — NOT `releaseReservation`.
 *
 * Without PR 2, step 3 evicted the player → step 5's
 * `armedSet ∩ room.players` filter dropped them silently → PR 1's
 * defensive release still committed because the reservation was orphan,
 * BUT the player lost their ticket. PR 2 prevents the eviction in the
 * first place so the buy-in actually goes through.
 *
 * Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md §6 PR 2.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import { RoomStateManager } from "../../util/roomState.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../../adapters/BingoSystemAdapter.js";
import type {
  WalletAdapter,
  WalletReservation,
  WalletTransferResult,
  CommitReservationOptions,
} from "../../adapters/WalletAdapter.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import type { Ticket } from "../types.js";

// ── Test fixtures ──────────────────────────────────────────────────────

const FIXED_GRID = [
  [1, 2, 3, 4, 5],
  [13, 14, 15, 16, 17],
  [25, 26, 0, 27, 28],
  [37, 38, 39, 40, 41],
  [49, 50, 51, 52, 53],
];

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FIXED_GRID.map((row) => [...row]) };
  }
}

/**
 * Tracking wallet adapter (same shape as the PR 1 test fixture). Counts
 * `commitReservation` and `releaseReservation` calls so the scenario
 * test can verify which path the buy-in took.
 */
class TrackingWalletAdapter implements WalletAdapter {
  readonly inner = new InMemoryWalletAdapter();
  readonly commitCalls: Array<{ reservationId: string; toAccountId: string }> = [];
  readonly releaseCalls: Array<{ reservationId: string; amount?: number }> = [];
  readonly walletByReservation = new Map<string, string>();

  createAccount: WalletAdapter["createAccount"] = (input) => this.inner.createAccount(input);
  ensureAccount: WalletAdapter["ensureAccount"] = (id) => this.inner.ensureAccount(id);
  getAccount: WalletAdapter["getAccount"] = (id) => this.inner.getAccount(id);
  listAccounts: WalletAdapter["listAccounts"] = () => this.inner.listAccounts();
  getBalance: WalletAdapter["getBalance"] = (id) => this.inner.getBalance(id);
  getDepositBalance: WalletAdapter["getDepositBalance"] = (id) => this.inner.getDepositBalance(id);
  getWinningsBalance: WalletAdapter["getWinningsBalance"] = (id) => this.inner.getWinningsBalance(id);
  getBothBalances: WalletAdapter["getBothBalances"] = (id) => this.inner.getBothBalances(id);
  debit: WalletAdapter["debit"] = (id, amount, reason) => this.inner.debit(id, amount, reason);
  credit: WalletAdapter["credit"] = (id, amount, reason, options) => this.inner.credit(id, amount, reason, options);
  creditWithClient: WalletAdapter["creditWithClient"] = (id, amount, reason, options) =>
    this.inner.creditWithClient(id, amount, reason, options);
  topUp: WalletAdapter["topUp"] = (id, amount, reason) => this.inner.topUp(id, amount, reason);
  withdraw: WalletAdapter["withdraw"] = (id, amount, reason) => this.inner.withdraw(id, amount, reason);
  transfer: WalletAdapter["transfer"] = (a, b, c, d, e) => this.inner.transfer(a, b, c, d, e);
  listTransactions: WalletAdapter["listTransactions"] = (id, limit) => this.inner.listTransactions(id, limit);

  async commitReservation(
    reservationId: string,
    toAccountId: string,
    reason: string,
    options?: CommitReservationOptions,
  ): Promise<WalletTransferResult> {
    this.commitCalls.push({ reservationId, toAccountId });
    const fromAccountId = this.walletByReservation.get(reservationId);
    if (!fromAccountId) {
      throw new WalletError(
        "RESERVATION_NOT_FOUND",
        `no walletId mapped for reservationId=${reservationId}`,
      );
    }
    return this.inner.transfer(fromAccountId, toAccountId, 10, reason, options);
  }

  async releaseReservation(
    reservationId: string,
    amount?: number,
  ): Promise<WalletReservation> {
    this.releaseCalls.push({ reservationId, amount });
    const walletId = this.walletByReservation.get(reservationId) ?? "unknown";
    const now = new Date().toISOString();
    return {
      id: reservationId,
      walletId,
      amount: amount ?? 0,
      idempotencyKey: `test-${reservationId}`,
      status: "released",
      roomCode: "TEST",
      gameSessionId: null,
      createdAt: now,
      releasedAt: now,
      committedAt: null,
      expiresAt: now,
    };
  }
}

// ── The scenario ──────────────────────────────────────────────────────

test("scenario: armed+reserved disconnected player survives cleanup → reservation is COMMITTED at next startGame", async () => {
  const adapter = new TrackingWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), adapter);
  const roomState = new RoomStateManager();

  // Step 1: Two players in a room. Host opens, Guest joins. Guest will
  // be the disconnected-but-armed victim.
  const hostWalletId = `wallet-host-${randomUUID()}`;
  const guestWalletId = `wallet-guest-${randomUUID()}`;
  const hostSocketId = "socket-host";
  const guestSocketId = "socket-guest";

  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: hostWalletId,
    socketId: hostSocketId,
  });
  const { playerId: guestPlayerId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: guestWalletId,
    socketId: guestSocketId,
  });

  // Step 2: Guest arms a forhåndskjøp and gets a wallet reservation
  // recorded in RoomStateManager. (In production this is what bet:arm
  // does — armPlayer + setReservationId.)
  const guestReservation = `res-guest-${randomUUID()}`;
  adapter.walletByReservation.set(guestReservation, guestWalletId);
  roomState.armPlayer(roomCode, guestPlayerId, 1);
  roomState.setReservationId(roomCode, guestPlayerId, guestReservation);
  // Host also armed (so room has ≥ 2 eligible players).
  const hostReservation = `res-host-${randomUUID()}`;
  adapter.walletByReservation.set(hostReservation, hostWalletId);
  roomState.armPlayer(roomCode, hostPlayerId, 1);
  roomState.setReservationId(roomCode, hostPlayerId, hostReservation);

  // Step 3: Guest's socket disconnects. Player record stays — only
  // socketId becomes undefined. Room is still IDLE (no game started).
  engine.detachSocket(guestSocketId);

  // Step 4: ANOTHER player (or the same client reconnecting via a fresh
  // socket) triggers room:create/room:join, which calls cleanup with
  // the new options form + isPreserve sourced from RoomStateManager.
  // PR 2 wires this exact closure in roomEvents.ts:
  //   isPreserve: (code, pid) => deps.hasArmedOrReservation!(code, pid)
  // where deps.hasArmedOrReservation = roomState.hasArmedOrReservation(...).
  const cleaned = engine.cleanupStaleWalletInIdleRooms(guestWalletId, {
    isPreserve: (code, pid) => roomState.hasArmedOrReservation(code, pid),
  });
  assert.equal(cleaned, 0, "guest preserved — cleanup did not evict");

  // Sanity: guest record is STILL in room.players (the bug-fix
  // invariant).
  const snap = engine.getRoomSnapshot(roomCode);
  assert.ok(
    snap.players.some((p) => p.id === guestPlayerId),
    "guest still in room.players after cleanup",
  );

  // Step 5: onAutoStart → startGame. Pass armedPlayerIds and
  // reservationIdByPlayer just like the production scheduler does
  // (via getReservationIdsByPlayer = roomState.getAllReservationIds).
  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId, guestPlayerId],
    reservationIdByPlayer: {
      [hostPlayerId]: hostReservation,
      [guestPlayerId]: guestReservation,
    },
  });

  // Verification: BOTH reservations committed, NEITHER released. This
  // is the bug-fix root: pre-PR-2 the guest reservation would be
  // released as orphan (PR 1 fallback) instead of committed.
  const committedIds = adapter.commitCalls
    .map((c) => c.reservationId)
    .sort();
  assert.deepEqual(
    committedIds,
    [hostReservation, guestReservation].sort(),
    "BOTH reservations committed — guest's forhåndskjøp survives the round-start",
  );
  assert.equal(
    adapter.releaseCalls.length,
    0,
    "no releases — both armed players made it through to commit (no orphan path)",
  );
});

test("scenario: preserved player can still reconnect via attachPlayerSocket (room:resume contract intact)", async () => {
  // After PR 2 preserves a disconnected armed player, the player's
  // record is still in `room.players` with socketId=undefined. The
  // `room:resume` flow calls `engine.attachPlayerSocket` to re-bind
  // a fresh socket to that record. Verify this still works — i.e. PR 2
  // does not break the reconnect path.
  const adapter = new TrackingWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), adapter);
  const roomState = new RoomStateManager();

  const hostWalletId = `wallet-host-${randomUUID()}`;
  const guestWalletId = `wallet-guest-${randomUUID()}`;
  const { roomCode } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: hostWalletId,
    socketId: "s-host",
  });
  const { playerId: guestPlayerId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: guestWalletId,
    socketId: "s-guest-old",
  });

  // Arm + reserve.
  const guestReservation = `res-guest-${randomUUID()}`;
  adapter.walletByReservation.set(guestReservation, guestWalletId);
  roomState.armPlayer(roomCode, guestPlayerId, 1);
  roomState.setReservationId(roomCode, guestPlayerId, guestReservation);

  // Disconnect, then run cleanup with preserve.
  engine.detachSocket("s-guest-old");
  engine.cleanupStaleWalletInIdleRooms(guestWalletId, {
    isPreserve: (code, pid) => roomState.hasArmedOrReservation(code, pid),
  });

  // Player record is still there. attachPlayerSocket should succeed.
  engine.attachPlayerSocket(roomCode, guestPlayerId, "s-guest-new");

  // Verify the new socketId is bound (read via internal access pattern
  // used elsewhere in the test suite).
  const internalEngine = engine as unknown as {
    rooms: Map<string, { players: Map<string, { socketId?: string }> }>;
  };
  const player = internalEngine.rooms.get(roomCode)!.players.get(guestPlayerId);
  assert.equal(player?.socketId, "s-guest-new", "reconnect successfully re-bound socket");
});

test("scenario: without preserve callback, cleanup evicts → guest's reservation gets RELEASED instead of committed (regression-detector for PR 2)", async () => {
  // Inverse scenario: same setup but the cleanup is called WITHOUT the
  // isPreserve callback (the legacy 2-arg path). This documents the
  // pre-PR-2 buggy behaviour so any future regression that drops the
  // preserve wiring is caught here.
  const adapter = new TrackingWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), adapter);
  const roomState = new RoomStateManager();

  const hostWalletId = `wallet-host-${randomUUID()}`;
  const guestWalletId = `wallet-guest-${randomUUID()}`;
  const thirdWalletId = `wallet-third-${randomUUID()}`;

  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: hostWalletId,
    socketId: "s-host",
  });
  const { playerId: guestPlayerId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: guestWalletId,
    socketId: "s-guest",
  });
  // Third player so room has ≥ minPlayersToStart=2 even after guest
  // is evicted by cleanup.
  const { playerId: thirdPlayerId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Third",
    walletId: thirdWalletId,
    socketId: "s-third",
  });

  const hostReservation = `res-host-${randomUUID()}`;
  const guestReservation = `res-guest-${randomUUID()}`;
  const thirdReservation = `res-third-${randomUUID()}`;
  adapter.walletByReservation.set(hostReservation, hostWalletId);
  adapter.walletByReservation.set(guestReservation, guestWalletId);
  adapter.walletByReservation.set(thirdReservation, thirdWalletId);
  roomState.armPlayer(roomCode, hostPlayerId, 1);
  roomState.setReservationId(roomCode, hostPlayerId, hostReservation);
  roomState.armPlayer(roomCode, guestPlayerId, 1);
  roomState.setReservationId(roomCode, guestPlayerId, guestReservation);
  roomState.armPlayer(roomCode, thirdPlayerId, 1);
  roomState.setReservationId(roomCode, thirdPlayerId, thirdReservation);

  engine.detachSocket("s-guest");

  // BUGGY path: legacy 2-arg form, no preserve check.
  engine.cleanupStaleWalletInIdleRooms(guestWalletId);

  // Guest is now evicted from room.players.
  const snap = engine.getRoomSnapshot(roomCode);
  assert.ok(
    !snap.players.some((p) => p.id === guestPlayerId),
    "without preserve, guest IS evicted",
  );

  // startGame with all 3 armed; guest is in armedPlayerIds but NOT in
  // room.players, so `armedSet ∩ room.players` drops them. PR 1's
  // defensive code in startGame then RELEASES the orphan reservation.
  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId, guestPlayerId, thirdPlayerId],
    reservationIdByPlayer: {
      [hostPlayerId]: hostReservation,
      [guestPlayerId]: guestReservation,
      [thirdPlayerId]: thirdReservation,
    },
  });

  // Host + Third committed; guest's reservation was RELEASED (orphan
  // path, PR 1 fallback) instead of committed. This is the bug-fix
  // contract: without the preserve callback we lose the guest's
  // forhåndskjøp.
  const committedIds = adapter.commitCalls.map((c) => c.reservationId).sort();
  assert.deepEqual(
    committedIds,
    [hostReservation, thirdReservation].sort(),
    "without preserve: guest commit never happens",
  );
  // Whether PR 1 is also merged or not, the guest reservation must NOT
  // commit — that's the regression we're guarding against. (If PR 1 is
  // merged, releaseCalls.length === 1; if not, === 0. Both are
  // acceptable for this test's purpose, which is to assert NO commit.)
  assert.ok(
    !committedIds.includes(guestReservation),
    "guest reservation never reached commit",
  );
});
