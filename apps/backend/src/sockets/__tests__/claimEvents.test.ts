/**
 * Bølge D coverage: socket-event `claim:submit`.
 *
 * Dekker:
 *   - Zod-validering: ugyldig type avvises med INVALID_INPUT
 *   - Zod-validering: manglende roomCode avvises med INVALID_INPUT
 *   - Zod-validering: feil claim type (annet enn LINE/BINGO) avvises
 *   - Happy path: BINGO-claim emitter pattern:won
 *   - Game 1 BINGO trigger activateMiniGame + minigame:activated emit
 *   - Game 5 (Spillorama) BINGO trigger activateJackpot + jackpot:activated emit
 *   - LINE-claim trigger ikke mini-game / jackpot
 *   - Claim som ikke finner pattern: ingen pattern:won
 *   - Invalid claim (claim.valid=false): ingen pattern:won emit
 *   - Engine.submitClaim kaster → ack failure
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { registerClaimEvents } from "../gameEvents/claimEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import type { ClaimRecord, RoomSnapshot } from "../../game/types.js";
import { DomainError } from "../../game/BingoEngine.js";

interface CapturedEmit {
  channel: "room" | "socket";
  room?: string;
  event: string;
  payload: unknown;
}

interface MockSocket extends EventEmitter {
  id: string;
  emittedEvents: CapturedEmit[];
}

function makeSocket(): MockSocket {
  const ee = new EventEmitter() as MockSocket;
  ee.id = "socket-1";
  ee.emittedEvents = [];
  const origEmit = ee.emit.bind(ee);
  // Wire-emits til socket (for minigame:activated / jackpot:activated)
  // skiller fra `socket.on(...)` event-listeners. Vi sporer kun
  // utgående emits ved å overstyre `emit` for spesifikke events.
  ee.emit = ((event: string, ...args: unknown[]) => {
    if (event === "minigame:activated" || event === "jackpot:activated") {
      ee.emittedEvents.push({ channel: "socket", event, payload: args[0] });
      return true;
    }
    return origEmit(event, ...args);
  }) as EventEmitter["emit"];
  return ee;
}

interface ClaimResult {
  valid: boolean;
  payoutAmount?: number;
  id: string;
}

interface CtxOptions {
  claim?: ClaimResult;
  submitClaimThrows?: Error;
  miniGame?: { type: string; prizeList: unknown[] } | null;
  jackpot?: { prizeList: unknown[]; totalSpins: number; playedSpins: number; spinHistory: unknown[] } | null;
  gameSlug?: string;
  patternResult?: {
    patternId: string;
    patternName: string;
    winnerId: string;
    wonAtDraw: number;
    payoutAmount: number;
    claimType: string;
    claimId: string;
    isWon: boolean;
  };
}

function makeCtx(opts: CtxOptions = {}): {
  ctx: SocketContext;
  socket: MockSocket;
  ioEmits: CapturedEmit[];
} {
  const socket = makeSocket();
  const ioEmits: CapturedEmit[] = [];

  const claim: ClaimResult = opts.claim ?? { valid: true, payoutAmount: 100, id: "claim-1" };
  const gameSlug = opts.gameSlug ?? "bingo";

  const engine = {
    async submitClaim(_input: { roomCode: string; playerId: string; type: string }) {
      if (opts.submitClaimThrows) throw opts.submitClaimThrows;
      return claim as ClaimRecord;
    },
    activateMiniGame(_roomCode: string, _playerId: string) {
      return opts.miniGame ?? null;
    },
    activateJackpot(_roomCode: string, _playerId: string) {
      return opts.jackpot ?? null;
    },
  };

  const deps = {
    emitRoomUpdate: async (_roomCode: string) => {
      const result = opts.patternResult ? [opts.patternResult] : [];
      return {
        roomCode: _roomCode,
        gameSlug,
        hallId: "hall-1",
        currentGame: {
          id: "game-1",
          patternResults: result,
        },
      } as unknown as RoomSnapshot;
    },
  } as unknown as GameEventsDeps;

  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          ioEmits.push({ channel: "room", room, event, payload });
        },
      };
    },
  } as unknown as Server;

  const ctx = {
    socket: socket as unknown as Socket,
    engine: engine as unknown as SocketContext["engine"],
    io,
    deps,
    ackSuccess<T>(cb: (r: { ok: boolean; data: T }) => void, data: T) {
      cb({ ok: true, data });
    },
    ackFailure<T>(cb: (r: { ok: boolean; error: { code: string; message: string } }) => void, err: unknown) {
      const pub = err instanceof DomainError
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) };
      cb({ ok: false, error: pub } as never);
    },
    rateLimited<P, R>(
      _name: string,
      handler: (payload: P, cb: (response: unknown) => void) => Promise<void>,
    ): (payload: P, cb: (response: unknown) => void) => void {
      return (payload, cb) => {
        handler(payload, cb).catch((err) => {
          cb({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err) } });
        });
      };
    },
    requireAuthenticatedPlayerAction: async (payload: { roomCode?: string; playerId?: string }) => ({
      roomCode: (payload?.roomCode ?? "ROOM1").toUpperCase(),
      playerId: payload?.playerId ?? "p1",
    }),
  } as unknown as SocketContext;

  return { ctx, socket, ioEmits };
}

function invokeClaim(socket: MockSocket, payload: Record<string, unknown>): Promise<{ response: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve) => {
    socket.emit("claim:submit", payload, (response: unknown) => {
      resolve({ response: response as { ok: boolean; data?: unknown; error?: { code: string; message: string } } });
    });
  });
}

// ── Zod-validering ────────────────────────────────────────────────────────

test("claim:submit — manglende roomCode → INVALID_INPUT", async () => {
  const { ctx, socket } = makeCtx();
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { type: "BINGO" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});

test("claim:submit — tom roomCode → INVALID_INPUT", async () => {
  const { ctx, socket } = makeCtx();
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { roomCode: "", type: "BINGO" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});

test("claim:submit — ugyldig type 'LOL' → INVALID_INPUT", async () => {
  const { ctx, socket } = makeCtx();
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { roomCode: "ROOM1", type: "LOL" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});

test("claim:submit — manglende type → INVALID_INPUT", async () => {
  const { ctx, socket } = makeCtx();
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { roomCode: "ROOM1" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});

test("claim:submit — feilmelding inkluderer feltnavn fra Zod-issue", async () => {
  const { ctx, socket } = makeCtx();
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { type: "BINGO" }); // mangler roomCode
  assert.equal(response.ok, false);
  assert.match(response.error?.message ?? "", /roomCode/i);
});

// ── Happy path: pattern:won emit ──────────────────────────────────────────

test("claim:submit — happy BINGO emitter pattern:won med winner-info", async () => {
  const { ctx, socket, ioEmits } = makeCtx({
    claim: { valid: true, payoutAmount: 500, id: "claim-1" },
    patternResult: {
      patternId: "p-bingo",
      patternName: "BINGO",
      winnerId: "p1",
      wonAtDraw: 35,
      payoutAmount: 500,
      claimType: "BINGO",
      claimId: "claim-1",
      isWon: true,
    },
  });
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  assert.equal(response.ok, true);

  const won = ioEmits.find((e) => e.event === "pattern:won");
  assert.ok(won, "pattern:won skal bli emitted til rommet");
  const payload = won!.payload as { patternId: string; payoutAmount: number; claimType: string };
  assert.equal(payload.patternId, "p-bingo");
  assert.equal(payload.payoutAmount, 500);
  assert.equal(payload.claimType, "BINGO");
});

test("claim:submit — invalid claim (valid=false): ingen pattern:won", async () => {
  const { ctx, socket, ioEmits } = makeCtx({
    claim: { valid: false, id: "claim-1" },
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  const won = ioEmits.find((e) => e.event === "pattern:won");
  assert.equal(won, undefined, "pattern:won skal ikke fire ved invalid claim");
});

test("claim:submit — patternResults har ingen match for claimId: ingen pattern:won", async () => {
  const { ctx, socket, ioEmits } = makeCtx({
    claim: { valid: true, id: "claim-1" },
    // Annen claimId i pattern-result
    patternResult: {
      patternId: "p1",
      patternName: "X",
      winnerId: "p1",
      wonAtDraw: 5,
      payoutAmount: 100,
      claimType: "BINGO",
      claimId: "annen-claim",
      isWon: true,
    },
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  const won = ioEmits.find((e) => e.event === "pattern:won");
  assert.equal(won, undefined, "pattern:won fires kun når claimId matcher");
});

// ── Game 1 mini-game aktivering ───────────────────────────────────────────

test("Game 1 BINGO + miniGame returnert: minigame:activated emittes til vinner-socket", async () => {
  const { ctx, socket } = makeCtx({
    claim: { valid: true, payoutAmount: 100, id: "claim-1" },
    gameSlug: "bingo",
    miniGame: { type: "WHEEL", prizeList: [10, 20, 50, 100] },
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });

  const activated = socket.emittedEvents.find((e) => e.event === "minigame:activated");
  assert.ok(activated, "minigame:activated skal emittes til socket");
  const payload = activated!.payload as { type: string; prizeList: unknown[]; playerId: string };
  assert.equal(payload.type, "WHEEL");
  assert.deepEqual(payload.prizeList, [10, 20, 50, 100]);
  assert.equal(payload.playerId, "p1");
});

test("Game 1 BINGO + miniGame=null: ingen minigame:activated emit", async () => {
  const { ctx, socket } = makeCtx({
    claim: { valid: true, id: "claim-1" },
    gameSlug: "bingo",
    miniGame: null,
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  const activated = socket.emittedEvents.find((e) => e.event === "minigame:activated");
  assert.equal(activated, undefined);
});

test("Game 1 LINE-claim: ingen minigame:activated (kun BINGO trigger)", async () => {
  const { ctx, socket } = makeCtx({
    claim: { valid: true, id: "claim-1" },
    gameSlug: "bingo",
    miniGame: { type: "WHEEL", prizeList: [] },
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "LINE" });
  const activated = socket.emittedEvents.find((e) => e.event === "minigame:activated");
  assert.equal(activated, undefined, "LINE-claim trigger ikke mini-game");
});

// ── Game 5 (Spillorama) jackpot aktivering ────────────────────────────────

test("Game 5 BINGO + jackpot returnert: jackpot:activated emittes til vinner-socket", async () => {
  const { ctx, socket } = makeCtx({
    claim: { valid: true, id: "claim-1" },
    gameSlug: "spillorama",
    jackpot: {
      prizeList: [100, 250, 500],
      totalSpins: 3,
      playedSpins: 0,
      spinHistory: [],
    },
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });

  const activated = socket.emittedEvents.find((e) => e.event === "jackpot:activated");
  assert.ok(activated, "jackpot:activated skal emittes til socket");
  const payload = activated!.payload as { totalSpins: number; playedSpins: number };
  assert.equal(payload.totalSpins, 3);
  assert.equal(payload.playedSpins, 0);
});

test("Game 5 BINGO + jackpot=null: ingen jackpot:activated", async () => {
  const { ctx, socket } = makeCtx({
    claim: { valid: true, id: "claim-1" },
    gameSlug: "spillorama",
    jackpot: null,
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  const activated = socket.emittedEvents.find((e) => e.event === "jackpot:activated");
  assert.equal(activated, undefined);
});

test("Annet gameSlug (game2 osv) — ingen mini-game eller jackpot trigger", async () => {
  const { ctx, socket } = makeCtx({
    claim: { valid: true, id: "claim-1" },
    gameSlug: "game2",
    miniGame: { type: "WHEEL", prizeList: [] },
    jackpot: { prizeList: [], totalSpins: 0, playedSpins: 0, spinHistory: [] },
  });
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  const minigame = socket.emittedEvents.find((e) => e.event === "minigame:activated");
  const jackpot = socket.emittedEvents.find((e) => e.event === "jackpot:activated");
  assert.equal(minigame, undefined, "game2 trigger ikke mini-game");
  assert.equal(jackpot, undefined, "game2 trigger ikke jackpot");
});

// ── Engine error path ─────────────────────────────────────────────────────

test("claim:submit — engine.submitClaim DomainError → ack failure med kode", async () => {
  const { ctx, socket } = makeCtx({
    submitClaimThrows: new DomainError("CLAIM_REJECTED", "Bingo-claim er ikke gyldig."),
  });
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "CLAIM_REJECTED");
});

test("claim:submit — engine.submitClaim generic Error → ack INTERNAL_ERROR", async () => {
  const { ctx, socket } = makeCtx({
    submitClaimThrows: new Error("Database utilgjengelig"),
  });
  registerClaimEvents(ctx);

  const { response } = await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INTERNAL_ERROR");
});

// ── Idempotency / state ───────────────────────────────────────────────────

test("claim:submit — to like claim:submit-kall trigger to engine.submitClaim-kall (idempotency er engine-ansvar)", async () => {
  let submitCalls = 0;
  const { ctx, socket } = makeCtx();
  // Override engine.submitClaim direkte
  (ctx.engine as { submitClaim: (input: unknown) => Promise<unknown> }).submitClaim = async () => {
    submitCalls++;
    return { valid: true, id: `claim-${submitCalls}` };
  };
  registerClaimEvents(ctx);

  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });
  await invokeClaim(socket, { roomCode: "ROOM1", type: "BINGO" });

  // Socket-laget videresender begge til engine; idempotency / dedup er
  // engine-laget sitt ansvar (BingoEngine sjekker at samme spiller ikke
  // dobbel-claimer på samme draw).
  assert.equal(submitCalls, 2);
});
