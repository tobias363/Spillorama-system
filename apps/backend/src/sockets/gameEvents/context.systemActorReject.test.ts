/**
 * Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.1):
 *
 * Verifiserer at `requireAuthenticatedPlayerAction` (gate-funksjonen i
 * SocketContext) avviser klient-payload som forsøker å sende
 * `SYSTEM_ACTOR_ID` som `playerId`. Defense-in-depth — i praksis utleder
 * vi playerId fra wallet-token uansett, men en eksplisitt rejekt logges
 * også som SECURITY-warning så ops kan oppdage forsøk.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "pino";
import type { Server, Socket } from "socket.io";

import { buildSocketContext, type RegistryContext } from "./context.js";
import { SYSTEM_ACTOR_ID } from "../../game/SystemActor.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { GameEventsDeps } from "./deps.js";
import type { RoomActionPayload } from "./types.js";

// ── Test fixture ────────────────────────────────────────────────────────────

function makeFakeSocket(): Socket {
  return {
    id: "test-socket-id",
    data: {},
    on: () => undefined,
  } as unknown as Socket;
}

function makeFakeLogger(): { logger: Logger; warnLogs: Array<{ obj: unknown; msg: string }> } {
  const warnLogs: Array<{ obj: unknown; msg: string }> = [];
  const logger = {
    warn: (obj: unknown, msg: string) => warnLogs.push({ obj, msg }),
    error: () => {},
    debug: () => {},
    info: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
  } as unknown as Logger;
  return { logger, warnLogs };
}

function makeRegistryContext(logger: Logger, deps: GameEventsDeps): RegistryContext {
  // Stub RegistryContext med minimum krevd interface. Vi tester KUN
  // SYSTEM_ACTOR_ID-rejection-pathen som fyrer FØR getAuthenticatedSocketUser
  // og før platformService/engine-kallene.
  const fakeUser: PublicAppUser = {
    id: "user-x",
    email: "x@example.com",
    displayName: "X",
    role: "PLAYER",
    walletId: "wallet-x",
  } as unknown as PublicAppUser;
  return {
    deps,
    io: {} as Server,
    engine: {
      getRoomSnapshot: () => ({
        code: "ROOM-1",
        hallId: "h",
        hostPlayerId: "host-x",
        gameSlug: "rocket",
        createdAt: "2026-05-06",
        players: [
          { id: "real-player", walletId: "wallet-x", balance: 100 },
        ],
        gameHistory: [],
      }),
      assertWalletAllowedForGameplay: () => undefined,
    } as unknown as BingoEngine,
    platformService: {
      assertUserEligibleForGameplay: async () => undefined,
    } as unknown as PlatformService,
    logger,
    ackSuccess: () => undefined,
    ackFailure: () => undefined,
    appendChatMessage: () => undefined,
    setLuckyNumber: () => undefined,
    getAuthenticatedSocketUser: async () => fakeUser,
    assertUserCanActAsPlayer: () => undefined,
    assertUserCanAccessRoom: () => undefined,
  };
}

function makeFakeDeps(): GameEventsDeps {
  return {
    socketRateLimiter: {
      check: () => true,
      checkByKey: () => true,
    },
    enforceSingleRoomPerHall: false,
    getPrimaryRoomForHall: () => null,
    requireActiveHallIdFromInput: async () => "h",
  } as unknown as GameEventsDeps;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("requireAuthenticatedPlayerAction avviser SYSTEM_ACTOR_ID i payload.playerId", async () => {
  const { logger, warnLogs } = makeFakeLogger();
  const deps = makeFakeDeps();
  const base = makeRegistryContext(logger, deps);
  const ctx = buildSocketContext(makeFakeSocket(), base);

  const payload: RoomActionPayload = {
    accessToken: "tok",
    roomCode: "ROOM-1",
    playerId: SYSTEM_ACTOR_ID,
  };

  await assert.rejects(
    () => ctx.requireAuthenticatedPlayerAction(payload),
    (err: unknown) => {
      const e = err as { code?: string; message?: string };
      assert.equal(e.code, "FORBIDDEN");
      assert.match(e.message ?? "", /system/i);
      return true;
    },
  );

  // SECURITY-warning skal logges så ops ser forsøket.
  assert.equal(warnLogs.length, 1);
  assert.match(warnLogs[0]!.msg, /SYSTEM_ACTOR_ID/);
});

test("requireAuthenticatedPlayerAction tillater normal flow med ekte playerId", async () => {
  const { logger } = makeFakeLogger();
  const deps = makeFakeDeps();
  const base = makeRegistryContext(logger, deps);
  const ctx = buildSocketContext(makeFakeSocket(), base);

  const payload: RoomActionPayload = {
    accessToken: "tok",
    roomCode: "ROOM-1",
    playerId: "real-player",
  };

  // Skal returnere playerId fra wallet-token-resolution (real-player).
  const result = await ctx.requireAuthenticatedPlayerAction(payload);
  assert.equal(result.roomCode, "ROOM-1");
  assert.equal(result.playerId, "real-player");
});

test("requireAuthenticatedPlayerAction tillater payload uten playerId", async () => {
  const { logger } = makeFakeLogger();
  const deps = makeFakeDeps();
  const base = makeRegistryContext(logger, deps);
  const ctx = buildSocketContext(makeFakeSocket(), base);

  const payload: RoomActionPayload = {
    accessToken: "tok",
    roomCode: "ROOM-1",
    // playerId not set — server resolves from token
  };

  const result = await ctx.requireAuthenticatedPlayerAction(payload);
  assert.equal(result.playerId, "real-player");
});
