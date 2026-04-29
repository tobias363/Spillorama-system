/**
 * FORHANDSKJOP-ORPHAN-FIX (PR 1) — defensive cleanup in `startGame`.
 *
 * STOP-SHIP bug confirmed in prod 2026-04-29 (Tobias-rapport, reservation
 * `cc909aed-…`, 60 kr locked from 10:36 til 10:56). When a player armed a
 * forhåndskjøp and disconnected before the round started,
 * `wallet_reservations` rows stayed at status='active' until the 30-min
 * TTL expired. Money locked, no buy-in, no audit trail.
 *
 * Root cause (see docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md):
 *   `BingoEngine.cleanupStaleWalletInIdleRooms` evicts disconnected players
 *   from `room.players` based purely on (walletId + !socketId + idle-room),
 *   without consulting `armedPlayerIdsByRoom` or
 *   `reservationIdByPlayerByRoom` (which live in RoomStateManager). On the
 *   next `onAutoStart` tick, `startGame`'s filter
 *   `armedSet ∩ room.players` silently drops the player —
 *   `commitReservation` is never called, and `disarmAllPlayers` then
 *   wipes the in-memory mapping, orphaning the DB row.
 *
 * This PR adds defense-in-depth in `startGame`:
 *
 *   1. After a successful buy-in loop, walk `input.reservationIdByPlayer`
 *      and release any reservation whose player is NOT in `eligiblePlayers`
 *      (covers the cleanup-race AND the low-funds drop in
 *      `filterEligiblePlayers`, AND any future similar silent-drop site).
 *
 *   2. In the partial-failure rollback `catch`, also release reservations
 *      of UNDEBITED-but-eligible players. `refundDebitedPlayers` covers
 *      those whose commit succeeded; this catches those whose commit
 *      hadn't started yet (loop threw before reaching them).
 *
 * Both bypass-gates match the existing buy-in conditional
 * (`entryFee > 0 && !isTestGame`) so test-games and free rounds aren't
 * touched.
 *
 * The architectural fix (cleanup-decision moves to socket layer with
 * armed/reservation awareness) ships in PR 2 and is tracked separately.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
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
    return {
      grid: FIXED_GRID.map((row) => [...row]),
    };
  }
}

/**
 * Wallet adapter that tracks `commitReservation` and `releaseReservation`
 * calls, delegating all other ops to `InMemoryWalletAdapter`. Each
 * reservation is just an opaque token — for these tests we only care
 * about which ids commit/release see, not actual wallet hold-bookkeeping
 * (the orphan-release behaviour is independent of how reservations
 * affect saldo).
 */
class TrackingWalletAdapter implements WalletAdapter {
  readonly inner = new InMemoryWalletAdapter();
  readonly commitCalls: Array<{ reservationId: string; toAccountId: string }> = [];
  readonly releaseCalls: Array<{ reservationId: string; amount?: number }> = [];

  // The sets/throw-on-commit knobs let individual tests opt into specific
  // failure modes (e.g. throw on a particular reservation to simulate a
  // mid-loop crash for the rollback test). When a reservation is in
  // `shouldThrowOnCommit`, BOTH `commitReservation` AND the fallback
  // `transfer` for that reservation's wallet throw — so the engine's
  // outer catch fires (otherwise the inner try/catch in startGame
  // recovers via the legacy transfer-path).
  shouldThrowOnCommit = new Set<string>();

  // Delegate every WalletAdapter method to the inner InMemory adapter.
  createAccount: WalletAdapter["createAccount"] = (input) =>
    this.inner.createAccount(input);
  ensureAccount: WalletAdapter["ensureAccount"] = (id) =>
    this.inner.ensureAccount(id);
  getAccount: WalletAdapter["getAccount"] = (id) => this.inner.getAccount(id);
  listAccounts: WalletAdapter["listAccounts"] = () => this.inner.listAccounts();
  getBalance: WalletAdapter["getBalance"] = (id) => this.inner.getBalance(id);
  getDepositBalance: WalletAdapter["getDepositBalance"] = (id) =>
    this.inner.getDepositBalance(id);
  getWinningsBalance: WalletAdapter["getWinningsBalance"] = (id) =>
    this.inner.getWinningsBalance(id);
  getBothBalances: WalletAdapter["getBothBalances"] = (id) =>
    this.inner.getBothBalances(id);
  debit: WalletAdapter["debit"] = (id, amount, reason) =>
    this.inner.debit(id, amount, reason);
  credit: WalletAdapter["credit"] = (id, amount, reason, options) =>
    this.inner.credit(id, amount, reason, options);
  creditWithClient: WalletAdapter["creditWithClient"] = (
    id,
    amount,
    reason,
    options,
  ) => this.inner.creditWithClient(id, amount, reason, options);
  topUp: WalletAdapter["topUp"] = (id, amount, reason) =>
    this.inner.topUp(id, amount, reason);
  withdraw: WalletAdapter["withdraw"] = (id, amount, reason) =>
    this.inner.withdraw(id, amount, reason);
  transfer: WalletAdapter["transfer"] = async (
    fromAccountId,
    toAccountId,
    amount,
    reason,
    options,
  ) => {
    // If this fromAccountId is on the throw-list, fail too — so the
    // engine's commit-fallback transfer doesn't silently rescue a
    // commit-failure.
    if (this.shouldThrowOnTransferFor.has(fromAccountId)) {
      throw new WalletError(
        "INSUFFICIENT_FUNDS",
        "test-injected transfer failure",
      );
    }
    return this.inner.transfer(fromAccountId, toAccountId, amount, reason, options);
  };

  /** Wallet ids whose transfer() must throw (used to defeat the
   *  commitReservation→transfer fallback in the rollback test). */
  shouldThrowOnTransferFor = new Set<string>();
  listTransactions: WalletAdapter["listTransactions"] = (id, limit) =>
    this.inner.listTransactions(id, limit);

  // Reservation API: minimal mock — a reservation is just an id.
  // commitReservation delegates to a transfer using the player's wallet
  // (we look it up by reservationId via the test-only `walletByReservation`
  // map). releaseReservation is a no-op that records the call.
  readonly walletByReservation = new Map<string, string>();

  async commitReservation(
    reservationId: string,
    toAccountId: string,
    reason: string,
    options?: CommitReservationOptions,
  ): Promise<WalletTransferResult> {
    this.commitCalls.push({ reservationId, toAccountId });
    if (this.shouldThrowOnCommit.has(reservationId)) {
      throw new WalletError("RESERVATION_NOT_FOUND", "test-injected commit failure");
    }
    const fromAccountId = this.walletByReservation.get(reservationId);
    if (!fromAccountId) {
      throw new WalletError(
        "RESERVATION_NOT_FOUND",
        `no walletId mapped for reservationId=${reservationId}`,
      );
    }
    // BIN-693 Option B semantics: commit is conceptually a transfer from
    // the reserved-wallet to the house. Use a small fixed amount so
    // saldo math doesn't get in the way of orphan-release behaviour.
    return this.inner.transfer(
      fromAccountId,
      toAccountId,
      10,
      reason,
      options,
    );
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

interface TestFixture {
  engine: BingoEngine;
  adapter: TrackingWalletAdapter;
  roomCode: string;
  hostPlayerId: string;
  hostWalletId: string;
  guestPlayerId: string;
  guestWalletId: string;
}

interface TestFixtureWithThird extends TestFixture {
  thirdPlayerId: string;
  thirdWalletId: string;
}

async function makeRoomWithTwoPlayers(): Promise<TestFixture> {
  const adapter = new TrackingWalletAdapter();
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), adapter);
  const hostWalletId = `wallet-host-${randomUUID()}`;
  const guestWalletId = `wallet-guest-${randomUUID()}`;
  const { roomCode, playerId: hostPlayerId } = await engine.createRoom({
    hallId: "hall-test",
    playerName: "Host",
    walletId: hostWalletId,
  });
  const { playerId: guestPlayerId } = await engine.joinRoom({
    roomCode,
    hallId: "hall-test",
    playerName: "Guest",
    walletId: guestWalletId,
  });
  return {
    engine,
    adapter,
    roomCode,
    hostPlayerId,
    hostWalletId,
    guestPlayerId,
    guestWalletId,
  };
}

/**
 * 3-player variant for tests that need to evict one player and still
 * have enough left over for the `minPlayersToStart >= 2` guard.
 */
async function makeRoomWithThreePlayers(): Promise<TestFixtureWithThird> {
  const fx = await makeRoomWithTwoPlayers();
  const thirdWalletId = `wallet-third-${randomUUID()}`;
  const { playerId: thirdPlayerId } = await fx.engine.joinRoom({
    roomCode: fx.roomCode,
    hallId: "hall-test",
    playerName: "Third",
    walletId: thirdWalletId,
  });
  return { ...fx, thirdPlayerId, thirdWalletId };
}

/** Helper: peek at engine internals to evict a player from `room.players`. */
function evictPlayerFromRoom(
  engine: BingoEngine,
  roomCode: string,
  playerId: string,
): void {
  const internalEngine = engine as unknown as {
    rooms: Map<string, { players: Map<string, unknown> }>;
  };
  const room = internalEngine.rooms.get(roomCode);
  if (!room) {
    throw new Error(`evictPlayerFromRoom: room ${roomCode} not found`);
  }
  room.players.delete(playerId);
}

// ── Tests ──────────────────────────────────────────────────────────────

test("orphan-release: armed player evicted from room.players → reservation released after buy-in loop", async () => {
  const fx = await makeRoomWithThreePlayers();
  // Host + Third stay. Guest is "armed" but evicted from room.players
  // (simulates the cleanupStaleWalletInIdleRooms race: guest disconnected,
  // room sat idle, cleanup ran, guest record gone). Reservation row is
  // still in the DB at status='active'.
  // Need 3 players so room.players still has ≥ minPlayersToStart=2
  // after eviction.
  const hostReservation = `res-host-${randomUUID()}`;
  const guestReservation = `res-guest-${randomUUID()}`;
  const thirdReservation = `res-third-${randomUUID()}`;
  fx.adapter.walletByReservation.set(hostReservation, fx.hostWalletId);
  fx.adapter.walletByReservation.set(guestReservation, fx.guestWalletId);
  fx.adapter.walletByReservation.set(thirdReservation, fx.thirdWalletId);

  evictPlayerFromRoom(fx.engine, fx.roomCode, fx.guestPlayerId);

  // armedPlayerIds includes host + guest + third. After eviction, the
  // engine's `armedSet ∩ room.players` filter drops guest silently —
  // which is the bug we're defending against.
  await fx.engine.startGame({
    roomCode: fx.roomCode,
    actorPlayerId: fx.hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [fx.hostPlayerId, fx.guestPlayerId, fx.thirdPlayerId],
    reservationIdByPlayer: {
      [fx.hostPlayerId]: hostReservation,
      [fx.guestPlayerId]: guestReservation,
      [fx.thirdPlayerId]: thirdReservation,
    },
  });

  // Host + Third buy-ins succeeded — their reservations were committed.
  const committedIds = fx.adapter.commitCalls
    .map((c) => c.reservationId)
    .sort();
  assert.deepEqual(
    committedIds,
    [hostReservation, thirdReservation].sort(),
    "host + third committed; guest reservation never reached commit",
  );

  // Guest's reservation must have been released (orphan path).
  assert.equal(
    fx.adapter.releaseCalls.length,
    1,
    "exactly one release call — for the orphaned guest reservation",
  );
  assert.equal(fx.adapter.releaseCalls[0].reservationId, guestReservation);
});

test("orphan-release: armed player below entryFee → reservation released (filterEligiblePlayers low-funds drop)", async () => {
  const fx = await makeRoomWithTwoPlayers();
  // Drain the guest's wallet so they fail filterEligiblePlayers.
  // InMemoryWalletAdapter ensures 1000 by default; withdraw down to 5.
  await fx.adapter.inner.withdraw(fx.guestWalletId, 995, "drain for test");

  const hostReservation = `res-host-${randomUUID()}`;
  const guestReservation = `res-guest-${randomUUID()}`;
  fx.adapter.walletByReservation.set(hostReservation, fx.hostWalletId);
  fx.adapter.walletByReservation.set(guestReservation, fx.guestWalletId);

  // Guest is still in room.players, but balance (5) < entryFee (10).
  await fx.engine.startGame({
    roomCode: fx.roomCode,
    actorPlayerId: fx.hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [fx.hostPlayerId, fx.guestPlayerId],
    reservationIdByPlayer: {
      [fx.hostPlayerId]: hostReservation,
      [fx.guestPlayerId]: guestReservation,
    },
  });

  // Host buy-in committed; guest dropped by filterEligiblePlayers.
  assert.equal(fx.adapter.commitCalls.length, 1, "only host commit");
  assert.equal(
    fx.adapter.releaseCalls.length,
    1,
    "guest reservation released (low-funds drop)",
  );
  assert.equal(fx.adapter.releaseCalls[0].reservationId, guestReservation);
});

test("happy path: eligible player's reservation IS committed, NOT released", async () => {
  const fx = await makeRoomWithTwoPlayers();
  const hostReservation = `res-host-${randomUUID()}`;
  fx.adapter.walletByReservation.set(hostReservation, fx.hostWalletId);

  await fx.engine.startGame({
    roomCode: fx.roomCode,
    actorPlayerId: fx.hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [fx.hostPlayerId], // only host armed
    reservationIdByPlayer: {
      [fx.hostPlayerId]: hostReservation,
    },
  });

  assert.equal(fx.adapter.commitCalls.length, 1);
  assert.equal(fx.adapter.commitCalls[0].reservationId, hostReservation);
  assert.equal(
    fx.adapter.releaseCalls.length,
    0,
    "no reservations to release — only-armed-player committed normally",
  );
});

test("partial-failure rollback: undebited eligible player's reservation released", async () => {
  // Need a 3rd player so we can have one in eligiblePlayers AFTER a
  // mid-loop throw (not yet processed when commit2 fails).
  const fx = await makeRoomWithThreePlayers();
  const r1 = `res-host-${randomUUID()}`;
  const r2 = `res-guest-${randomUUID()}`;
  const r3 = `res-third-${randomUUID()}`;
  fx.adapter.walletByReservation.set(r1, fx.hostWalletId);
  fx.adapter.walletByReservation.set(r2, fx.guestWalletId);
  fx.adapter.walletByReservation.set(r3, fx.thirdWalletId);

  // Make commit #2 (guest) throw, AND make the fallback transfer fail
  // too — otherwise the engine's `try { commit } catch { transfer }`
  // rescue would silently succeed and the outer catch never fires.
  // Player order is insertion order from room.players Map, which is
  // host → guest → third. Buy-in loop:
  //   - host: commit r1 → debitedPlayers=[host]
  //   - guest: commit r2 → THROWS, fallback transfer also THROWS → outer catch
  //     ↳ refundDebitedPlayers(host) — host refunded
  //     ↳ NEW: walk eligiblePlayers ∖ debitedPlayers, release their
  //       reservations. guest is in eligiblePlayers but not debited
  //       (commit + fallback both failed); third is in eligiblePlayers
  //       and not debited (loop never reached it).
  fx.adapter.shouldThrowOnCommit.add(r2);
  fx.adapter.shouldThrowOnTransferFor.add(fx.guestWalletId);

  await assert.rejects(
    () =>
      fx.engine.startGame({
        roomCode: fx.roomCode,
        actorPlayerId: fx.hostPlayerId,
        entryFee: 10,
        ticketsPerPlayer: 1,
        payoutPercent: 80,
        armedPlayerIds: [fx.hostPlayerId, fx.guestPlayerId, fx.thirdPlayerId],
        reservationIdByPlayer: {
          [fx.hostPlayerId]: r1,
          [fx.guestPlayerId]: r2,
          [fx.thirdPlayerId]: r3,
        },
      }),
    "startGame must rethrow after rollback",
  );

  // commit attempts for r1 and r2 (then throw on r2 — third never tried)
  assert.equal(fx.adapter.commitCalls.length, 2);
  assert.equal(fx.adapter.commitCalls[0].reservationId, r1);
  assert.equal(fx.adapter.commitCalls[1].reservationId, r2);

  // Rollback releases must include guest (r2 — undebited because its
  // commit threw) AND third (r3 — undebited because the loop hadn't
  // reached it yet). Host (r1) was debited and refunded by
  // refundDebitedPlayers — its reservation is already committed (we
  // can't "un-commit" it at the wallet level here; that's a separate
  // compensation path). So host MUST NOT be in releaseCalls.
  const releasedIds = fx.adapter.releaseCalls
    .map((c) => c.reservationId)
    .sort();
  assert.deepEqual(releasedIds, [r2, r3].sort(), "guest + third released");
  assert.ok(
    !releasedIds.includes(r1),
    "host reservation NOT released (already committed; refundDebitedPlayers handles compensation)",
  );
});

test("isTestGame=true: no orphan-release attempted (entire wallet path bypassed)", async () => {
  const fx = await makeRoomWithThreePlayers();
  // Even though we pass reservation ids, isTestGame should skip the
  // entire `if (entryFee > 0 && !isTestGame)` block including our
  // orphan-release. Verifies we kept the same gate as the buy-in loop.
  const hostReservation = `res-host-${randomUUID()}`;
  const guestReservation = `res-guest-${randomUUID()}`;
  const thirdReservation = `res-third-${randomUUID()}`;
  fx.adapter.walletByReservation.set(hostReservation, fx.hostWalletId);
  fx.adapter.walletByReservation.set(guestReservation, fx.guestWalletId);
  fx.adapter.walletByReservation.set(thirdReservation, fx.thirdWalletId);

  evictPlayerFromRoom(fx.engine, fx.roomCode, fx.guestPlayerId);

  await fx.engine.startGame({
    roomCode: fx.roomCode,
    actorPlayerId: fx.hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [fx.hostPlayerId, fx.guestPlayerId, fx.thirdPlayerId],
    reservationIdByPlayer: {
      [fx.hostPlayerId]: hostReservation,
      [fx.guestPlayerId]: guestReservation,
      [fx.thirdPlayerId]: thirdReservation,
    },
    isTestGame: true,
  });

  assert.equal(fx.adapter.commitCalls.length, 0, "no commits in test game");
  assert.equal(
    fx.adapter.releaseCalls.length,
    0,
    "no releases either — entire wallet path is bypassed",
  );
});

test("entryFee=0: no orphan-release attempted (free round, gate matches buy-in conditional)", async () => {
  const fx = await makeRoomWithThreePlayers();
  const hostReservation = `res-host-${randomUUID()}`;
  const guestReservation = `res-guest-${randomUUID()}`;
  const thirdReservation = `res-third-${randomUUID()}`;
  fx.adapter.walletByReservation.set(hostReservation, fx.hostWalletId);
  fx.adapter.walletByReservation.set(guestReservation, fx.guestWalletId);
  fx.adapter.walletByReservation.set(thirdReservation, fx.thirdWalletId);

  evictPlayerFromRoom(fx.engine, fx.roomCode, fx.guestPlayerId);

  // entryFee defaults to 0 if omitted, but we set it explicitly so the
  // intent is clear.
  await fx.engine.startGame({
    roomCode: fx.roomCode,
    actorPlayerId: fx.hostPlayerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [fx.hostPlayerId, fx.guestPlayerId, fx.thirdPlayerId],
    reservationIdByPlayer: {
      [fx.hostPlayerId]: hostReservation,
      [fx.guestPlayerId]: guestReservation,
      [fx.thirdPlayerId]: thirdReservation,
    },
  });

  assert.equal(
    fx.adapter.commitCalls.length,
    0,
    "no commits when entryFee=0",
  );
  assert.equal(
    fx.adapter.releaseCalls.length,
    0,
    "no releases — free round shouldn't touch reservations either",
  );
});
