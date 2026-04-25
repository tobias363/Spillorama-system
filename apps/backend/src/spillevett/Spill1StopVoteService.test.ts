/**
 * GAP #38: tests for Spill1StopVoteService.
 *
 * Coverage:
 *   - single-vote: doesn't reach threshold, audit fires, vote recorded.
 *   - threshold-reach: triggers stop + refund + audit.
 *   - refund-on-stop: each player's active reservation released via adapter.
 *   - idempotency: same playerId voting twice → recorded=false on second.
 *   - race-condition: simultaneous votes don't double-fire stopGame.
 *   - no running game: throws GAME_NOT_RUNNING.
 *   - player not in room: throws PLAYER_NOT_IN_ROOM.
 *   - threshold-percent env: respects custom threshold.
 *   - reservation-release-error: continues per row, doesn't crash.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Spill1StopVoteService } from "./Spill1StopVoteService.js";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { RoomSnapshot, Player } from "../game/types.js";
import type {
  AuditLogService,
  AuditLogInput,
} from "../compliance/AuditLogService.js";
import type {
  WalletAdapter,
  WalletReservation,
} from "../adapters/WalletAdapter.js";

// ── Fakes ───────────────────────────────────────────────────────────────────

interface FakeEngineState {
  players: Player[];
  game: { id: string; status: "WAITING" | "RUNNING" | "ENDED" } | null;
  endGameCalls: Array<{
    roomCode: string;
    actorPlayerId: string;
    reason?: string;
  }>;
  endGameThrows: Error | null;
}

function makeFakeEngine(state: FakeEngineState): BingoEngine {
  const snapshot = (): RoomSnapshot => ({
    code: "ROOM1",
    hallId: "hall-1",
    hostPlayerId: state.players[0]?.id ?? "p1",
    gameSlug: "spill-1",
    createdAt: new Date().toISOString(),
    players: [...state.players],
    currentGame: state.game
      ? ({
          id: state.game.id,
          status: state.game.status,
          // Minimal — service only reads id+status.
        } as unknown as RoomSnapshot["currentGame"])
      : undefined,
    gameHistory: [],
  });

  return {
    getRoomSnapshot: (code: string) => {
      if (code !== "ROOM1") {
        // Mimic engine.requireRoom throwing
        throw new Error(`Room ${code} not found`);
      }
      return snapshot();
    },
    endGame: async (input: {
      roomCode: string;
      actorPlayerId: string;
      reason?: string;
    }) => {
      state.endGameCalls.push(input);
      if (state.endGameThrows) {
        throw state.endGameThrows;
      }
      // Simulate game ending
      if (state.game) state.game.status = "ENDED";
    },
  } as unknown as BingoEngine;
}

interface FakeAuditCalls {
  records: AuditLogInput[];
}

function makeFakeAuditService(calls: FakeAuditCalls): AuditLogService {
  return {
    record: async (input: AuditLogInput) => {
      calls.records.push(input);
    },
  } as unknown as AuditLogService;
}

interface FakeReservation {
  id: string;
  released: boolean;
}

interface FakeWalletState {
  reservations: Map<string, FakeReservation>;
  releaseThrowsForId: Set<string>;
  releaseCalls: string[];
}

function makeFakeWalletAdapter(state: FakeWalletState): WalletAdapter {
  return {
    releaseReservation: async (reservationId: string, _amount?: number) => {
      state.releaseCalls.push(reservationId);
      if (state.releaseThrowsForId.has(reservationId)) {
        throw new Error(`forced release failure for ${reservationId}`);
      }
      const r = state.reservations.get(reservationId);
      if (!r) {
        throw new Error(`reservation ${reservationId} not found`);
      }
      r.released = true;
      return { id: r.id, status: "released" } as unknown as WalletReservation;
    },
  } as unknown as WalletAdapter;
}

function mkPlayer(id: string, walletId = `wallet-${id}`): Player {
  return {
    id,
    name: id,
    walletId,
    joinedAt: new Date().toISOString(),
  } as unknown as Player;
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("GAP #38 single-vote: 4-player room, first vote doesn't reach 50% threshold", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2"), mkPlayer("p3"), mkPlayer("p4")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };
  const audit: FakeAuditCalls = { records: [] };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    auditLogService: makeFakeAuditService(audit),
    thresholdPercent: 50,
  });

  const result = await service.castVote({
    roomCode: "ROOM1",
    playerId: "p1",
  });

  assert.equal(result.recorded, true);
  assert.equal(result.voteCount, 1);
  assert.equal(result.threshold, 2, "ceil(4*0.5)=2");
  assert.equal(result.playerCount, 4);
  assert.equal(result.thresholdReached, false);
  assert.equal(state.endGameCalls.length, 0, "endGame not called");
  assert.equal(audit.records.length, 1, "single vote audit");
  assert.equal(audit.records[0]!.action, "spillevett.stop_game.vote");
  assert.equal(audit.records[0]!.actorId, "p1");
  assert.equal(audit.records[0]!.resourceId, "ROOM1");
});

test("GAP #38 threshold-reach: 4-player, 2nd vote (50%) triggers stop + refund + threshold-audit", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2"), mkPlayer("p3"), mkPlayer("p4")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };
  const audit: FakeAuditCalls = { records: [] };

  const wallet: FakeWalletState = {
    reservations: new Map([
      ["res-p1", { id: "res-p1", released: false }],
      ["res-p2", { id: "res-p2", released: false }],
      ["res-p3", { id: "res-p3", released: false }],
      ["res-p4", { id: "res-p4", released: false }],
    ]),
    releaseThrowsForId: new Set(),
    releaseCalls: [],
  };
  const reservationByPlayer = new Map<string, string>([
    ["p1", "res-p1"],
    ["p2", "res-p2"],
    ["p3", "res-p3"],
    ["p4", "res-p4"],
  ]);
  const cleared = new Set<string>();

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    auditLogService: makeFakeAuditService(audit),
    walletAdapter: makeFakeWalletAdapter(wallet),
    getReservationId: (_code, pid) =>
      cleared.has(pid) ? null : reservationByPlayer.get(pid) ?? null,
    clearReservationId: (_code, pid) => {
      cleared.add(pid);
    },
    thresholdPercent: 50,
  });

  const r1 = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(r1.thresholdReached, false);

  const r2 = await service.castVote({ roomCode: "ROOM1", playerId: "p2" });
  assert.equal(r2.thresholdReached, true);
  assert.equal(r2.voteCount, 2);
  assert.equal(r2.threshold, 2);

  // engine.endGame called once with reason "spillevett_stop_vote".
  assert.equal(state.endGameCalls.length, 1);
  assert.equal(state.endGameCalls[0]!.reason, "spillevett_stop_vote");
  assert.equal(state.endGameCalls[0]!.actorPlayerId, "p2");

  // All 4 reservations released (not just voters' — entire room).
  assert.deepEqual(
    [...wallet.releaseCalls].sort(),
    ["res-p1", "res-p2", "res-p3", "res-p4"],
  );
  for (const r of wallet.reservations.values()) {
    assert.equal(r.released, true, `${r.id} should be released`);
  }
  assert.deepEqual([...cleared].sort(), ["p1", "p2", "p3", "p4"]);

  // Audit: 2 vote-records + 1 threshold-record.
  const voteRecords = audit.records.filter(
    (r) => r.action === "spillevett.stop_game.vote",
  );
  const thresholdRecords = audit.records.filter(
    (r) => r.action === "spillevett.stop_game.threshold_reached",
  );
  assert.equal(voteRecords.length, 2);
  assert.equal(thresholdRecords.length, 1);
  const tr = thresholdRecords[0]!;
  assert.equal(tr.actorId, "p2");
  assert.deepEqual(
    (tr.details as Record<string, unknown>).voterIds,
    ["p1", "p2"],
  );
  assert.equal(
    (tr.details as Record<string, unknown>).triggeringPlayerId,
    "p2",
  );
});

test("GAP #38 idempotency: same player voting twice → recorded=false on second", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2"), mkPlayer("p3"), mkPlayer("p4")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };
  const audit: FakeAuditCalls = { records: [] };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    auditLogService: makeFakeAuditService(audit),
    thresholdPercent: 50,
  });

  const r1 = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  const r2 = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });

  assert.equal(r1.recorded, true);
  assert.equal(r2.recorded, false, "second vote must not re-count");
  assert.equal(r2.voteCount, 1, "voteCount stays at 1");
  assert.equal(state.endGameCalls.length, 0, "no stop-game on dup vote");
  assert.equal(audit.records.length, 1, "no audit on dup vote");
});

test("GAP #38 race condition: 4 simultaneous votes in 4-player 50% room → endGame fires once", async () => {
  // Threshold = ceil(4*0.5) = 2 → after 2 simultaneous votes the game stops.
  // The remaining 2 simultaneous votes must NOT fire endGame again or
  // double-refund.
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2"), mkPlayer("p3"), mkPlayer("p4")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };
  const audit: FakeAuditCalls = { records: [] };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    auditLogService: makeFakeAuditService(audit),
    thresholdPercent: 50,
  });

  const results = await Promise.all([
    service.castVote({ roomCode: "ROOM1", playerId: "p1" }),
    service.castVote({ roomCode: "ROOM1", playerId: "p2" }),
    service.castVote({ roomCode: "ROOM1", playerId: "p3" }),
    service.castVote({ roomCode: "ROOM1", playerId: "p4" }),
  ]);

  // Exactly one threshold-reached.
  const reached = results.filter((r) => r.thresholdReached);
  assert.equal(reached.length, 1, "only one vote must report thresholdReached");

  // endGame called exactly once.
  assert.equal(
    state.endGameCalls.length,
    1,
    "endGame called once despite parallel votes",
  );

  // The first 2 votes both record successfully; later votes (3 and 4)
  // arrive AFTER the game has been ended, so they short-circuit on the
  // RUNNING-status re-check inside the lock and report `recorded: false`.
  const recordedCount = results.filter((r) => r.recorded).length;
  assert.equal(
    recordedCount,
    2,
    "exactly 2 votes counted (threshold=2); rest see ended-game",
  );

  const thresholdAudits = audit.records.filter(
    (r) => r.action === "spillevett.stop_game.threshold_reached",
  );
  assert.equal(thresholdAudits.length, 1, "exactly one threshold audit row");
});

test("GAP #38 no running game: throws GAME_NOT_RUNNING", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2")],
    game: null, // no current game
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 50,
  });

  await assert.rejects(
    () => service.castVote({ roomCode: "ROOM1", playerId: "p1" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "GAME_NOT_RUNNING");
      return true;
    },
  );
});

test("GAP #38 game waiting (not yet started): throws GAME_NOT_RUNNING", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2")],
    game: { id: "g1", status: "WAITING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 50,
  });

  await assert.rejects(
    () => service.castVote({ roomCode: "ROOM1", playerId: "p1" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "GAME_NOT_RUNNING");
      return true;
    },
  );
});

test("GAP #38 player not in room: throws PLAYER_NOT_IN_ROOM", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 50,
  });

  await assert.rejects(
    () => service.castVote({ roomCode: "ROOM1", playerId: "stranger" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "PLAYER_NOT_IN_ROOM");
      return true;
    },
  );
});

test("GAP #38 missing room: throws ROOM_NOT_FOUND", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 50,
  });

  await assert.rejects(
    () => service.castVote({ roomCode: "OTHER", playerId: "p1" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "ROOM_NOT_FOUND");
      return true;
    },
  );
});

test("GAP #38 single-player room: threshold = 1 (legacy parity, 50% of 1 = 1)", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };
  const audit: FakeAuditCalls = { records: [] };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    auditLogService: makeFakeAuditService(audit),
    thresholdPercent: 50,
  });

  // Single player, single vote → threshold reached immediately.
  const r = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(r.thresholdReached, true);
  assert.equal(r.threshold, 1);
  assert.equal(state.endGameCalls.length, 1);
});

test("GAP #38 high threshold (100%): all players must vote", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2"), mkPlayer("p3")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 100,
  });

  const r1 = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  const r2 = await service.castVote({ roomCode: "ROOM1", playerId: "p2" });
  assert.equal(r1.thresholdReached, false);
  assert.equal(r2.thresholdReached, false);
  assert.equal(state.endGameCalls.length, 0);

  const r3 = await service.castVote({ roomCode: "ROOM1", playerId: "p3" });
  assert.equal(r3.thresholdReached, true);
  assert.equal(r3.threshold, 3);
  assert.equal(state.endGameCalls.length, 1);
});

test("GAP #38 reservation release-error: continues, audit still records", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };
  const audit: FakeAuditCalls = { records: [] };

  const wallet: FakeWalletState = {
    reservations: new Map([
      ["res-p1", { id: "res-p1", released: false }],
      ["res-p2", { id: "res-p2", released: false }],
    ]),
    releaseThrowsForId: new Set(["res-p1"]), // force p1 release-failure
    releaseCalls: [],
  };
  const reservationByPlayer = new Map<string, string>([
    ["p1", "res-p1"],
    ["p2", "res-p2"],
  ]);
  const cleared = new Set<string>();

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    auditLogService: makeFakeAuditService(audit),
    walletAdapter: makeFakeWalletAdapter(wallet),
    getReservationId: (_code, pid) =>
      cleared.has(pid) ? null : reservationByPlayer.get(pid) ?? null,
    clearReservationId: (_code, pid) => {
      cleared.add(pid);
    },
    thresholdPercent: 50,
  });

  // 2 player room, threshold=1 → first vote stops.
  const r = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(r.thresholdReached, true);

  assert.equal(state.endGameCalls.length, 1);
  assert.equal(wallet.releaseCalls.length, 2);
  assert.equal(wallet.reservations.get("res-p1")!.released, false, "res-p1 still failed");
  assert.equal(wallet.reservations.get("res-p2")!.released, true, "res-p2 succeeded");
  assert.equal(cleared.has("p1"), false, "p1 not cleared (release failed)");
  assert.equal(cleared.has("p2"), true, "p2 cleared (release succeeded)");

  const thresholdAudit = audit.records.find(
    (r) => r.action === "spillevett.stop_game.threshold_reached",
  );
  assert.ok(thresholdAudit, "threshold audit still recorded");
});

test("GAP #38 setStopGameImpl: custom orchestrator overrides default refund flow", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 50,
  });

  const customCalls: Array<{
    roomCode: string;
    triggeringPlayerId: string;
    voteCount: number;
    threshold: number;
    playerIds: string[];
  }> = [];

  service.setStopGameImpl(async (input) => {
    customCalls.push(input);
  });

  await service.castVote({ roomCode: "ROOM1", playerId: "p1" });

  assert.equal(customCalls.length, 1, "custom impl called");
  assert.equal(
    state.endGameCalls.length,
    0,
    "engine.endGame NOT called (custom impl bypasses default)",
  );
  assert.equal(customCalls[0]!.triggeringPlayerId, "p1");
  assert.equal(customCalls[0]!.threshold, 1);
  assert.deepEqual(customCalls[0]!.playerIds, ["p1", "p2"]);
});

test("GAP #38 round reset: clearState clears voters for next round", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2"), mkPlayer("p3"), mkPlayer("p4")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 50,
  });

  await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(service._peekState("ROOM1")?.voters.length, 1);

  service.clearState("ROOM1");
  assert.equal(service._peekState("ROOM1"), null);

  // New round (different game id) → state auto-resets via getOrInitState.
  state.game = { id: "g2", status: "RUNNING" };
  await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(service._peekState("ROOM1")?.gameId, "g2");
  assert.deepEqual(service._peekState("ROOM1")?.voters, ["p1"]);
});

test("GAP #38 game-id change auto-resets vote state", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2"), mkPlayer("p3"), mkPlayer("p4")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 50,
  });

  await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(service._peekState("ROOM1")?.gameId, "g1");
  assert.equal(service._peekState("ROOM1")?.voters.length, 1);

  // Simulate new round
  state.game = { id: "g2", status: "RUNNING" };
  await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(service._peekState("ROOM1")?.gameId, "g2");
  assert.equal(
    service._peekState("ROOM1")?.voters.length,
    1,
    "new round starts with single voter, NOT 2",
  );
});

test("GAP #38 invalid threshold percent clamped at construction", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  // Out-of-range → clamped to [1, 100].
  const svcLow = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: -50,
  });
  assert.equal(svcLow.computeThreshold(10), 1, "negative percent clamped to 1%");

  const svcHigh = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 9999,
  });
  assert.equal(
    svcHigh.computeThreshold(10),
    10,
    "very high percent clamped to 100%",
  );
});

test("GAP #38 missing reservation deps: stop fires, refund warns, no crash", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  // walletAdapter present but no reservation lookup deps wired.
  const wallet: FakeWalletState = {
    reservations: new Map(),
    releaseThrowsForId: new Set(),
    releaseCalls: [],
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    walletAdapter: makeFakeWalletAdapter(wallet),
    thresholdPercent: 50,
  });

  const r = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(r.thresholdReached, true);
  assert.equal(state.endGameCalls.length, 1, "engine.endGame still fires");
  assert.equal(
    wallet.releaseCalls.length,
    0,
    "no release calls when deps missing",
  );
});

test("GAP #38 idempotent vote across reset: voter can re-vote in next round", async () => {
  const state: FakeEngineState = {
    players: [mkPlayer("p1"), mkPlayer("p2")],
    game: { id: "g1", status: "RUNNING" },
    endGameCalls: [],
    endGameThrows: null,
  };

  const service = new Spill1StopVoteService({
    engine: makeFakeEngine(state),
    thresholdPercent: 100, // require all voters
  });

  // Round 1: only p1 votes, threshold not reached.
  const r1 = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(r1.recorded, true);
  assert.equal(r1.thresholdReached, false);

  // Round ends naturally
  service.clearState("ROOM1");
  state.game = { id: "g2", status: "RUNNING" };

  // p1 votes again in round 2 → counted, not a duplicate.
  const r2 = await service.castVote({ roomCode: "ROOM1", playerId: "p1" });
  assert.equal(r2.recorded, true, "p1 vote in round 2 must be counted");
  assert.equal(r2.voteCount, 1, "round 2 starts at 0");
});
