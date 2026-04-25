/**
 * GAP #29: integrasjonstester for /api/games/validate-view.
 *
 * Dekker:
 *   - HALL_BLOCKED, PLAYER_BLOCKED, ROOM_NOT_FOUND, GAME_NOT_JOINABLE,
 *     HALL_MISMATCH-failure-shapes
 *   - happy-path med roomCode → returnerer gameStatus
 *   - happy-path uten roomCode → bare hall-status-sjekk
 *   - INSUFFICIENT_BALANCE info-only-flagg
 *   - read-only (ingen audit-log skapt)
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createValidateGameViewRouter } from "../validateGameView.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { RoomSnapshot } from "@spillorama/shared-types";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(overrides: Partial<PublicAppUser> = {}): PublicAppUser {
  return {
    id: "user-alice",
    email: "alice@test.no",
    displayName: "Alice",
    walletId: "wallet-alice",
    role: "PLAYER",
    hallId: "hall-1",
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 1000,
    ...overrides,
  };
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

interface ServerOpts {
  user?: PublicAppUser;
  hallStatuses?: Array<{ hallId: string; isActive: boolean; reason: string | null }>;
  blockUser?: boolean;
  rooms?: Map<string, RoomSnapshot>;
  minEntryFee?: (slug: string) => number | null;
}

async function startServer(opts: ServerOpts = {}): Promise<Ctx> {
  const user = opts.user ?? makeUser();
  const hallStatuses = opts.hallStatuses ?? [];
  const rooms = opts.rooms ?? new Map<string, RoomSnapshot>();

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token !== "alice-token") throw new DomainError("UNAUTHORIZED", "bad token");
      return user;
    },
    async listPlayerHallStatus(_userId: string): Promise<
      Array<{
        hallId: string;
        isActive: boolean;
        reason: string | null;
        updatedBy: string | null;
        updatedAt: string;
        createdAt: string;
      }>
    > {
      return hallStatuses.map((s) => ({
        hallId: s.hallId,
        isActive: s.isActive,
        reason: s.reason,
        updatedBy: null,
        updatedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
      }));
    },
  } as unknown as PlatformService;

  const profileSettingsService = {
    async assertUserNotBlocked(_userId: string): Promise<void> {
      if (opts.blockUser) {
        throw new DomainError(
          "PLAYER_BLOCKED",
          "Spiller er blokkert til 2030-01-01T00:00:00Z."
        );
      }
    },
  };

  const engine = {
    getRoomSnapshot(roomCode: string): RoomSnapshot {
      const snap = rooms.get(roomCode.toUpperCase());
      if (!snap) {
        throw new DomainError("ROOM_NOT_FOUND", `Rom ${roomCode} finnes ikke.`);
      }
      return snap;
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    createValidateGameViewRouter({
      platformService,
      profileSettingsService,
      engine,
      getMinEntryFeeForGame: opts.minEntryFee ?? (() => 0),
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postJson(url: string, token: string | undefined, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function makeRoomSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ROOM1",
    hallId: "hall-1",
    hostPlayerId: "host-1",
    gameSlug: "bingo",
    createdAt: "2026-01-01T00:00:00Z",
    players: [],
    gameHistory: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("GAP #29: hallId mangler → INVALID_INPUT (400)", async () => {
  const ctx = await startServer();
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {});
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("GAP #29: ingen Authorization → UNAUTHORIZED (400)", async () => {
  const ctx = await startServer();
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, undefined, {
      hallId: "hall-1",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("GAP #29: HALL_BLOCKED når player.is_active=false i hallen", async () => {
  const ctx = await startServer({
    hallStatuses: [
      { hallId: "hall-1", isActive: false, reason: "Karantene etter mistanke om juks." },
    ],
  });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true); // wrapper-ok = HTTP-success
    assert.equal(res.json.data.ok, false);
    assert.equal(res.json.data.reason, "HALL_BLOCKED");
    assert.match(res.json.data.message, /sperret|juks/i);
  } finally {
    await ctx.close();
  }
});

test("GAP #29: PLAYER_BLOCKED når block-myself er aktiv", async () => {
  const ctx = await startServer({ blockUser: true });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, false);
    assert.equal(res.json.data.reason, "PLAYER_BLOCKED");
  } finally {
    await ctx.close();
  }
});

test("GAP #29: ROOM_NOT_FOUND når roomCode ikke finnes i engine", async () => {
  const ctx = await startServer({ rooms: new Map() });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
      roomCode: "GHOST",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, false);
    assert.equal(res.json.data.reason, "ROOM_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("GAP #29: HALL_MISMATCH når rommet tilhører annen hall", async () => {
  const rooms = new Map([["ROOM1", makeRoomSnapshot({ hallId: "hall-2" })]]);
  const ctx = await startServer({ rooms });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
      roomCode: "ROOM1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, false);
    assert.equal(res.json.data.reason, "HALL_MISMATCH");
  } finally {
    await ctx.close();
  }
});

test("GAP #29: GAME_NOT_JOINABLE når currentGame.status === ENDED", async () => {
  const rooms = new Map([
    [
      "ROOM1",
      makeRoomSnapshot({
        currentGame: {
          id: "g1",
          status: "ENDED",
          entryFee: 0,
          ticketsPerPlayer: 1,
          prizePool: 0,
          remainingPrizePool: 0,
          payoutPercent: 100,
          maxPayoutBudget: 0,
          remainingPayoutBudget: 0,
          drawBag: [],
          drawnNumbers: [],
          remainingNumbers: 0,
          claims: [],
          tickets: {},
          marks: {},
          startedAt: "2026-01-01T00:00:00Z",
        },
      }),
    ],
  ]);
  const ctx = await startServer({ rooms });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
      roomCode: "ROOM1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, false);
    assert.equal(res.json.data.reason, "GAME_NOT_JOINABLE");
  } finally {
    await ctx.close();
  }
});

test("GAP #29: happy-path med roomCode → ok=true + gameStatus", async () => {
  const rooms = new Map([
    [
      "ROOM1",
      makeRoomSnapshot({
        currentGame: {
          id: "g1",
          status: "RUNNING",
          entryFee: 100,
          ticketsPerPlayer: 1,
          prizePool: 0,
          remainingPrizePool: 0,
          payoutPercent: 100,
          maxPayoutBudget: 0,
          remainingPayoutBudget: 0,
          drawBag: [],
          drawnNumbers: [],
          remainingNumbers: 0,
          claims: [],
          tickets: {},
          marks: {},
          startedAt: "2026-01-01T00:00:00Z",
        },
      }),
    ],
  ]);
  const ctx = await startServer({ rooms });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
      roomCode: "ROOM1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, true);
    assert.equal(res.json.data.gameStatus, "RUNNING");
    assert.equal(res.json.data.hallId, "hall-1");
    assert.equal(res.json.data.roomCode, "ROOM1");
    assert.equal(res.json.data.gameSlug, "bingo");
    assert.equal(res.json.data.balance, 1000);
    assert.equal(res.json.data.insufficientBalance, false);
  } finally {
    await ctx.close();
  }
});

test("GAP #29: happy-path UTEN roomCode (kun hall-status-sjekk)", async () => {
  const ctx = await startServer();
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, true);
    assert.equal(res.json.data.roomCode, null);
    assert.equal(res.json.data.gameStatus, null);
  } finally {
    await ctx.close();
  }
});

test("GAP #29: gameStatus=NONE når rommet finnes men ingen aktiv runde", async () => {
  const rooms = new Map([["ROOM1", makeRoomSnapshot()]]); // ingen currentGame
  const ctx = await startServer({ rooms });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
      roomCode: "ROOM1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, true);
    assert.equal(res.json.data.gameStatus, "NONE");
  } finally {
    await ctx.close();
  }
});

test("GAP #29: insufficientBalance flagges når balance < min entry-fee (info-only)", async () => {
  const rooms = new Map([
    [
      "ROOM1",
      makeRoomSnapshot({
        currentGame: {
          id: "g1",
          status: "WAITING",
          entryFee: 100,
          ticketsPerPlayer: 1,
          prizePool: 0,
          remainingPrizePool: 0,
          payoutPercent: 100,
          maxPayoutBudget: 0,
          remainingPayoutBudget: 0,
          drawBag: [],
          drawnNumbers: [],
          remainingNumbers: 0,
          claims: [],
          tickets: {},
          marks: {},
          startedAt: "2026-01-01T00:00:00Z",
        },
      }),
    ],
  ]);
  const ctx = await startServer({
    user: makeUser({ balance: 5 }),
    rooms,
    minEntryFee: () => 100,
  });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
      roomCode: "ROOM1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, true);
    assert.equal(res.json.data.insufficientBalance, true);
    assert.equal(res.json.data.balance, 5);
  } finally {
    await ctx.close();
  }
});

test("GAP #29: roomCode er case-insensitive (ROOM1 == room1)", async () => {
  const rooms = new Map([["ROOM1", makeRoomSnapshot()]]);
  const ctx = await startServer({ rooms });
  try {
    const res = await postJson(`${ctx.baseUrl}/api/games/validate-view`, "alice-token", {
      hallId: "hall-1",
      roomCode: "room1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ok, true);
    assert.equal(res.json.data.roomCode, "ROOM1");
  } finally {
    await ctx.close();
  }
});
