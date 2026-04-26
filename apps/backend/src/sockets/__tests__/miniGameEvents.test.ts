/**
 * Bølge D coverage: socket-event `jackpot:spin` (Game 5) + `minigame:play`
 * (Game 1).
 *
 * Dekker:
 *   - jackpot:spin — happy path videresender til engine.spinJackpot
 *   - jackpot:spin — engine kaster DomainError → ack failure
 *   - jackpot:spin — auth-feil bobbler opp som ack failure
 *   - minigame:play — happy path med selectedIndex
 *   - minigame:play — uten selectedIndex (random/wheel-mode) sender undefined
 *   - minigame:play — selectedIndex som ikke-number ignoreres (sendes undefined)
 *   - minigame:play — engine returnerer null → ack med null
 *   - minigame:play — engine kaster → ack failure
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Socket } from "socket.io";
import { registerMiniGameEvents } from "../gameEvents/miniGameEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import { DomainError } from "../../game/BingoEngine.js";

interface MockSocket extends EventEmitter {
  id: string;
}

function makeSocket(): MockSocket {
  const ee = new EventEmitter() as MockSocket;
  ee.id = "socket-1";
  return ee;
}

interface CtxOptions {
  spinJackpot?: (roomCode: string, playerId: string) => Promise<unknown>;
  playMiniGame?: (roomCode: string, playerId: string, selectedIndex?: number) => Promise<unknown>;
  authThrows?: boolean;
}

function makeCtx(opts: CtxOptions = {}): {
  ctx: SocketContext;
  socket: MockSocket;
  capturedSelectedIndex: { value: number | undefined; called: boolean };
} {
  const socket = makeSocket();
  const captured = { value: undefined as number | undefined, called: false };

  const engine = {
    async spinJackpot(roomCode: string, playerId: string) {
      if (opts.spinJackpot) return opts.spinJackpot(roomCode, playerId);
      return { roomCode, playerId, spunAt: "2026-04-25T00:00:00Z", prizeIndex: 0 };
    },
    async playMiniGame(roomCode: string, playerId: string, selectedIndex?: number) {
      captured.called = true;
      captured.value = selectedIndex;
      if (opts.playMiniGame) return opts.playMiniGame(roomCode, playerId, selectedIndex);
      return { roomCode, playerId, prizeIndex: selectedIndex ?? 0 };
    },
  };

  const deps = {} as unknown as GameEventsDeps;

  const ctx = {
    socket: socket as unknown as Socket,
    engine: engine as unknown as SocketContext["engine"],
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
    requireAuthenticatedPlayerAction: async (payload: { roomCode?: string; playerId?: string }) => {
      if (opts.authThrows) {
        throw new DomainError("FORBIDDEN", "Ikke tilgang.");
      }
      return {
        roomCode: (payload?.roomCode ?? "").toUpperCase(),
        playerId: payload?.playerId ?? "p1",
      };
    },
  } as unknown as SocketContext;

  return { ctx, socket, capturedSelectedIndex: captured };
}

function invoke(socket: MockSocket, event: string, payload: Record<string, unknown>): Promise<{ response: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response: unknown) => {
      resolve({ response: response as { ok: boolean; data?: unknown; error?: { code: string; message: string } } });
    });
  });
}

// ── jackpot:spin ──────────────────────────────────────────────────────────

test("jackpot:spin — happy path videresender til engine.spinJackpot", async () => {
  let spinCallArgs: { roomCode: string; playerId: string } | null = null;
  const spinJackpot = async (roomCode: string, playerId: string) => {
    spinCallArgs = { roomCode, playerId };
    return { prizeIndex: 3, prizeCents: 500 };
  };
  const { ctx, socket } = makeCtx({ spinJackpot });
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "jackpot:spin", { roomCode: "ROOM1" });
  assert.equal(response.ok, true);
  const data = response.data as { prizeIndex: number; prizeCents: number };
  assert.equal(data.prizeIndex, 3);
  assert.equal(data.prizeCents, 500);
  assert.deepEqual(spinCallArgs, { roomCode: "ROOM1", playerId: "p1" });
});

test("jackpot:spin — engine kaster DomainError → ack failure", async () => {
  const spinJackpot = async () => {
    throw new DomainError("JACKPOT_NOT_ACTIVE", "Jackpot er ikke aktiv for deg.");
  };
  const { ctx, socket } = makeCtx({ spinJackpot });
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "jackpot:spin", { roomCode: "ROOM1" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "JACKPOT_NOT_ACTIVE");
});

test("jackpot:spin — auth-feil bobbler opp som ack failure", async () => {
  const { ctx, socket } = makeCtx({ authThrows: true });
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "jackpot:spin", { roomCode: "ROOM1" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "FORBIDDEN");
});

test("jackpot:spin — generic Error fra engine bobbler som INTERNAL_ERROR", async () => {
  const spinJackpot = async () => {
    throw new Error("Uventet DB-feil");
  };
  const { ctx, socket } = makeCtx({ spinJackpot });
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "jackpot:spin", { roomCode: "ROOM1" });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INTERNAL_ERROR");
});

// ── minigame:play ─────────────────────────────────────────────────────────

test("minigame:play — happy path med selectedIndex sender index videre", async () => {
  const { ctx, socket, capturedSelectedIndex } = makeCtx();
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "minigame:play", {
    roomCode: "ROOM1",
    selectedIndex: 4,
  });
  assert.equal(response.ok, true);
  assert.equal(capturedSelectedIndex.called, true);
  assert.equal(capturedSelectedIndex.value, 4);
});

test("minigame:play — uten selectedIndex sender undefined (random-mode for wheel)", async () => {
  const { ctx, socket, capturedSelectedIndex } = makeCtx();
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "minigame:play", { roomCode: "ROOM1" });
  assert.equal(response.ok, true);
  assert.equal(capturedSelectedIndex.value, undefined);
});

test("minigame:play — selectedIndex som ikke-number ignoreres (sendes undefined)", async () => {
  const { ctx, socket, capturedSelectedIndex } = makeCtx();
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "minigame:play", {
    roomCode: "ROOM1",
    selectedIndex: "foo" as unknown as number,
  });
  assert.equal(response.ok, true);
  assert.equal(
    capturedSelectedIndex.value,
    undefined,
    "selectedIndex må være typeof number — ellers undefined",
  );
});

test("minigame:play — selectedIndex=0 (treasure-chest første kiste) videresender 0", async () => {
  const { ctx, socket, capturedSelectedIndex } = makeCtx();
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "minigame:play", {
    roomCode: "ROOM1",
    selectedIndex: 0,
  });
  assert.equal(response.ok, true);
  // KRITISK: 0 er et gyldig valg (kistes 0/1/2). Ikke truthy-check feil.
  assert.equal(capturedSelectedIndex.value, 0);
});

test("minigame:play — engine kaster DomainError → ack failure", async () => {
  const playMiniGame = async () => {
    throw new DomainError("MINIGAME_NOT_ACTIVE", "Mini-game er ikke aktivt.");
  };
  const { ctx, socket } = makeCtx({ playMiniGame });
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "minigame:play", { roomCode: "ROOM1", selectedIndex: 1 });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "MINIGAME_NOT_ACTIVE");
});

test("minigame:play — auth-feil bobbler opp som ack failure", async () => {
  const { ctx, socket } = makeCtx({ authThrows: true });
  registerMiniGameEvents(ctx);

  const { response } = await invoke(socket, "minigame:play", { roomCode: "ROOM1", selectedIndex: 1 });
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "FORBIDDEN");
});
