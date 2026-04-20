/**
 * BIN-641: integrasjonstester for POST /api/admin/physical-tickets/:uniqueId/check-bingo.
 *
 * Dekker:
 *   - RBAC (ADMIN OK, SUPPORT/PLAYER blokkert, HALL_OPERATOR bundet til egen hall)
 *   - Input-validering (numbers må være 25 heltall, gameId påkrevd)
 *   - Ticket status-guards (VOIDED, UNSOLD, assigned_game_id-mismatch)
 *   - Mønster-gjenkjenning (Row 1..4 + Full House + miss)
 *   - gameId-oppslag (current game + historisk game)
 *   - Read-only: ingen audit-event genereres
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminPhysicalTicketCheckBingoRouter } from "../adminPhysicalTicketCheckBingo.js";
import type {
  PhysicalTicketService,
  PhysicalTicket,
} from "../../compliance/PhysicalTicketService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { RoomSnapshot, RoomSummary } from "../../game/types.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Users ────────────────────────────────────────────────────────────────

const adminUser: PublicAppUser = {
  id: "admin-1", email: "admin@test.no", displayName: "Admin",
  walletId: "w-admin", role: "ADMIN", hallId: null,
  kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", balance: 0,
};
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const operatorB: PublicAppUser = { ...adminUser, id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" };
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

// ── Fixtures ─────────────────────────────────────────────────────────────

/**
 * Bygg en 5×5-billett som er vinnende for et gitt mønster når drawn =
 * winningNumbers. Brukes for deterministic pattern-tests.
 *
 * Layout (row-major, 0-indexed):
 *   [0..4]    row 0  (top row)
 *   [5..9]    row 1
 *   [10..14]  row 2  (index 12 = free-centre = 0)
 *   [15..19]  row 3
 *   [20..24]  row 4  (bottom row)
 */
function makeBingo75Numbers(opts?: {
  row0?: [number, number, number, number, number];
  row1?: [number, number, number, number, number];
  row2?: [number, number, number, number, number];
  row3?: [number, number, number, number, number];
  row4?: [number, number, number, number, number];
}): number[] {
  // Default: unique numbers 1..25 med 0 i senter (index 12).
  const row0 = opts?.row0 ?? [1, 2, 3, 4, 5];
  const row1 = opts?.row1 ?? [6, 7, 8, 9, 10];
  const row2 = opts?.row2 ?? [11, 12, 0, 14, 15];
  const row3 = opts?.row3 ?? [16, 17, 18, 19, 20];
  const row4 = opts?.row4 ?? [21, 22, 23, 24, 25];
  return [...row0, ...row1, ...row2, ...row3, ...row4];
}

function makeTicket(overrides: Partial<PhysicalTicket> & { uniqueId: string; hallId: string }): PhysicalTicket {
  return {
    id: overrides.id ?? `t-${overrides.uniqueId}`,
    batchId: overrides.batchId ?? "batch-1",
    uniqueId: overrides.uniqueId,
    hallId: overrides.hallId,
    status: overrides.status ?? "SOLD",
    priceCents: overrides.priceCents ?? 5000,
    assignedGameId: "assignedGameId" in overrides ? overrides.assignedGameId! : "game-1",
    soldAt: overrides.soldAt ?? "2026-04-20T10:00:00Z",
    soldBy: overrides.soldBy ?? "agent-1",
    buyerUserId: overrides.buyerUserId ?? null,
    voidedAt: overrides.voidedAt ?? null,
    voidedBy: overrides.voidedBy ?? null,
    voidedReason: overrides.voidedReason ?? null,
    createdAt: overrides.createdAt ?? "2026-04-20T09:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T10:00:00Z",
  };
}

// ── Test harness ─────────────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

interface GameFixture {
  id: string;
  roomCode: string;
  hallId: string;
  drawnNumbers: number[];
  historic?: boolean; // hvis true, legges i gameHistory i stedet for currentGame
  gameStatus?: "WAITING" | "RUNNING" | "ENDED";
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  tickets: PhysicalTicket[];
  games: GameFixture[];
}): Promise<Ctx> {
  const ticketsByUid = new Map<string, PhysicalTicket>(opts.tickets.map((t) => [t.uniqueId, t]));

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const physicalTicketService = {
    async findByUniqueId(uniqueId: string) {
      return ticketsByUid.get(uniqueId) ?? null;
    },
  } as unknown as PhysicalTicketService;

  // Group games by room so vi mirror BingoEngine.listRoomSummaries/getRoomSnapshot.
  const roomMap = new Map<string, GameFixture[]>();
  for (const g of opts.games) {
    const arr = roomMap.get(g.roomCode) ?? [];
    arr.push(g);
    roomMap.set(g.roomCode, arr);
  }

  const engine = {
    listRoomSummaries(): RoomSummary[] {
      return [...roomMap.entries()].map(([code, games]) => ({
        code,
        hallId: games[0]!.hallId,
        hostPlayerId: "host-1",
        gameSlug: "bingo",
        playerCount: 0,
        createdAt: "2026-04-20T09:00:00Z",
        gameStatus: games.find((g) => !g.historic) ? "RUNNING" : "NONE",
      }));
    },
    getRoomSnapshot(roomCode: string): RoomSnapshot {
      const games = roomMap.get(roomCode) ?? [];
      const current = games.find((g) => !g.historic);
      const historic = games.filter((g) => g.historic);
      return {
        code: roomCode,
        hallId: games[0]?.hallId ?? "hall-a",
        hostPlayerId: "host-1",
        gameSlug: "bingo",
        createdAt: "2026-04-20T09:00:00Z",
        players: [],
        currentGame: current
          ? {
              id: current.id,
              status: current.gameStatus ?? "RUNNING",
              entryFee: 0,
              ticketsPerPlayer: 1,
              prizePool: 0,
              remainingPrizePool: 0,
              payoutPercent: 0,
              maxPayoutBudget: 0,
              remainingPayoutBudget: 0,
              drawBag: [],
              drawnNumbers: [...current.drawnNumbers],
              remainingNumbers: 0,
              claims: [],
              tickets: {},
              marks: {},
              startedAt: "2026-04-20T10:00:00Z",
            }
          : undefined,
        gameHistory: historic.map((h) => ({
          id: h.id,
          status: h.gameStatus ?? "ENDED",
          entryFee: 0,
          ticketsPerPlayer: 1,
          prizePool: 0,
          remainingPrizePool: 0,
          payoutPercent: 0,
          maxPayoutBudget: 0,
          remainingPayoutBudget: 0,
          drawBag: [],
          drawnNumbers: [...h.drawnNumbers],
          remainingNumbers: 0,
          claims: [],
          tickets: {},
          marks: {},
          startedAt: "2026-04-20T09:30:00Z",
          endedAt: "2026-04-20T09:59:00Z",
        })),
      };
    },
  } as unknown as BingoEngine;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminPhysicalTicketCheckBingoRouter({ platformService, physicalTicketService, engine })
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
async function post(baseUrl: string, path: string, token: string | undefined, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-641: ADMIN får Row 1 treff på horisontal topp-rad", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100001", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5, 42] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100001/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hasWon, true);
    assert.equal(res.json.data.winningPattern, "row_1");
    assert.deepEqual(res.json.data.matchedNumbers, [1, 2, 3, 4, 5]);
    assert.equal(res.json.data.payoutEligible, true);
    assert.equal(res.json.data.uniqueId, "100001");
    assert.equal(res.json.data.gameId, "game-1");
    assert.equal(res.json.data.drawnNumbersCount, 6);
  } finally {
    await ctx.close();
  }
});

test("BIN-641: Row 1 treff på vertikal kolonne (legacy-kompatibilitet)", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    // Kolonne 0 = numbers[0], [5], [10], [15], [20] = 1, 6, 11, 16, 21
    tickets: [makeTicket({ uniqueId: "100002", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 6, 11, 16, 21] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100002/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.winningPattern, "row_1");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: Row 2 treff på to rader", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100003", hallId: "hall-a", assignedGameId: "game-1" })],
    // Rad 0 + rad 1 = 1..10
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100003/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.winningPattern, "row_2");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: Full House når alle 24 tall trukket (senter er free)", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100004", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [
      {
        id: "game-1",
        roomCode: "ABC123",
        hallId: "hall-a",
        // Alle 24 tall unntatt senter-0
        drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
      },
    ],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100004/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.winningPattern, "full_house");
    assert.equal(res.json.data.matchedNumbers.length, 24);
  } finally {
    await ctx.close();
  }
});

test("BIN-641: ingen vinner returnerer hasWon=false + null-pattern", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100005", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 7, 15, 19, 25] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100005/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hasWon, false);
    assert.equal(res.json.data.winningPattern, null);
    assert.equal(res.json.data.payoutEligible, false);
    // Alle 5 tall matcher bongen, men ikke på et vinnende mønster.
    assert.equal(res.json.data.matchedNumbers.length, 5);
  } finally {
    await ctx.close();
  }
});

test("BIN-641: historisk game (i gameHistory) støttes — retro check", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100006", hallId: "hall-a", assignedGameId: "game-old" })],
    games: [
      { id: "game-old", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5], historic: true, gameStatus: "ENDED" },
    ],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100006/check-bingo", "admin-tok", {
      gameId: "game-old",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hasWon, true);
    assert.equal(res.json.data.gameStatus, "ENDED");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: velger høyeste tier (Row 2 slår Row 1 hvis begge matcher)", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100007", hallId: "hall-a", assignedGameId: "game-1" })],
    // Rad 0 + rad 1 matcher — både Row 1 og Row 2 kvalifiserer
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100007/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.winningPattern, "row_2");
  } finally {
    await ctx.close();
  }
});

// ── RBAC / hall-scope tests ──────────────────────────────────────────────

test("BIN-641: SUPPORT + PLAYER blokkert", async () => {
  const ctx = await startServer({
    users: { "sup-tok": supportUser, "pl-tok": playerUser },
    tickets: [makeTicket({ uniqueId: "100010", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    for (const token of ["sup-tok", "pl-tok"]) {
      const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100010/check-bingo", token, {
        gameId: "game-1",
        numbers: makeBingo75Numbers(),
      });
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, "FORBIDDEN");
    }
  } finally {
    await ctx.close();
  }
});

test("BIN-641: HALL_OPERATOR får sjekke egen halls billett", async () => {
  const ctx = await startServer({
    users: { "op-a-tok": operatorA },
    tickets: [makeTicket({ uniqueId: "100011", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100011/check-bingo", "op-a-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hasWon, true);
  } finally {
    await ctx.close();
  }
});

test("BIN-641: HALL_OPERATOR (hall-b) kan IKKE sjekke billett i hall-a", async () => {
  const ctx = await startServer({
    users: { "op-b-tok": operatorB },
    tickets: [makeTicket({ uniqueId: "100012", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100012/check-bingo", "op-b-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

// ── Status-guards ─────────────────────────────────────────────────────────

test("BIN-641: VOIDED billett avvises med PHYSICAL_TICKET_VOIDED", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100020", hallId: "hall-a", assignedGameId: "game-1", status: "VOIDED", voidedAt: "2026-04-20T11:00:00Z", voidedBy: "admin-1", voidedReason: "test" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100020/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_VOIDED");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: UNSOLD billett avvises med PHYSICAL_TICKET_NOT_SOLD", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100021", hallId: "hall-a", assignedGameId: "game-1", status: "UNSOLD", soldAt: null, soldBy: null })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100021/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_SOLD");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: ukjent uniqueId gir PHYSICAL_TICKET_NOT_FOUND", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/999999/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: gameId-mismatch mot ticket.assignedGameId avvises", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100030", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [
      { id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] },
      { id: "game-2", roomCode: "XYZ789", hallId: "hall-a", drawnNumbers: [10, 20, 30] },
    ],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100030/check-bingo", "admin-tok", {
      gameId: "game-2",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_WRONG_GAME");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: ticket uten assignedGameId gir PHYSICAL_TICKET_NOT_ASSIGNED", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100031", hallId: "hall-a", assignedGameId: null })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100031/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_NOT_ASSIGNED");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: ukjent gameId (ikke i engine) gir GAME_NOT_FOUND", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100040", hallId: "hall-a", assignedGameId: "game-ghost" })],
    games: [],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100040/check-bingo", "admin-tok", {
      gameId: "game-ghost",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── Input-validering ──────────────────────────────────────────────────────

test("BIN-641: numbers må være array med 25 heltall", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100050", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3] }],
  });
  try {
    // Ikke array
    const r1 = await post(ctx.baseUrl, "/api/admin/physical-tickets/100050/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: "1,2,3",
    });
    assert.equal(r1.status, 400);
    assert.equal(r1.json.error.code, "INVALID_INPUT");

    // Feil lengde
    const r2 = await post(ctx.baseUrl, "/api/admin/physical-tickets/100050/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: [1, 2, 3],
    });
    assert.equal(r2.status, 400);
    assert.equal(r2.json.error.code, "INVALID_INPUT");

    // Tall utenfor [0, 75]
    const invalidNums = makeBingo75Numbers();
    invalidNums[0] = 99;
    const r3 = await post(ctx.baseUrl, "/api/admin/physical-tickets/100050/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: invalidNums,
    });
    assert.equal(r3.status, 400);
    assert.equal(r3.json.error.code, "INVALID_INPUT");

    // Negativ
    const neg = makeBingo75Numbers();
    neg[1] = -1;
    const r4 = await post(ctx.baseUrl, "/api/admin/physical-tickets/100050/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: neg,
    });
    assert.equal(r4.status, 400);
    assert.equal(r4.json.error.code, "INVALID_INPUT");

    // Non-integer
    const frac = makeBingo75Numbers();
    frac[1] = 3.14;
    const r5 = await post(ctx.baseUrl, "/api/admin/physical-tickets/100050/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: frac,
    });
    assert.equal(r5.status, 400);
    assert.equal(r5.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: gameId er påkrevd", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100060", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100060/check-bingo", "admin-tok", {
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: ikke-objekt body avvises", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100061", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100061/check-bingo", "admin-tok", [1, 2, 3]);
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-641: matchedNumbers inkluderer ikke free-centre (0)", async () => {
  const ctx = await startServer({
    users: { "admin-tok": adminUser },
    tickets: [makeTicket({ uniqueId: "100070", hallId: "hall-a", assignedGameId: "game-1" })],
    games: [{ id: "game-1", roomCode: "ABC123", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const res = await post(ctx.baseUrl, "/api/admin/physical-tickets/100070/check-bingo", "admin-tok", {
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    // Bongen har 0 i senter — skal IKKE være i matchedNumbers.
    assert.equal(res.json.data.matchedNumbers.includes(0), false);
  } finally {
    await ctx.close();
  }
});
