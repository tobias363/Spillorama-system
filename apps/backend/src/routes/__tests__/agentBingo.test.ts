/**
 * Agent-portal: Check-for-Bingo + Physical Cashout (P0 pilot-blokker).
 *
 * Dekker:
 *   - RBAC (AGENT med aktiv shift OK, HALL_OPERATOR OK, ADMIN OK,
 *     SUPPORT/PLAYER FORBIDDEN, AGENT uten shift SHIFT_NOT_ACTIVE)
 *   - Hall-scope håndheves for AGENT (shift.hallId) + HALL_OPERATOR (user.hallId)
 *   - Check-bingo: pattern-deteksjon (row_1, row_2, row_3, row_4, full_house)
 *   - Reward-all: bulk-utbetaling + audit-events
 *   - Pending-listing: kun stemplede vinnere, hall-scope
 *   - Per-ticket reward: convenience-endpoint
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentBingoRouter } from "../agentBingo.js";
import { AgentService } from "../../agent/AgentService.js";
import { AgentShiftService } from "../../agent/AgentShiftService.js";
import { InMemoryAgentStore } from "../../agent/AgentStore.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type {
  PhysicalTicket,
  PhysicalTicketService,
  RewardAllInput,
  RewardAllResult,
} from "../../compliance/PhysicalTicketService.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { RoomSnapshot, RoomSummary } from "../../game/types.js";
import type {
  PlatformService,
  PublicAppUser,
  AppUser,
  UserRole,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── Users ────────────────────────────────────────────────────────────────

function mkUser(overrides: Partial<PublicAppUser> & Pick<PublicAppUser, "id" | "role">): PublicAppUser {
  return {
    id: overrides.id,
    email: overrides.email ?? `${overrides.id}@test.no`,
    displayName: overrides.displayName ?? overrides.id,
    walletId: overrides.walletId ?? `w-${overrides.id}`,
    role: overrides.role,
    hallId: overrides.hallId ?? null,
    kycStatus: overrides.kycStatus ?? "VERIFIED",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
    balance: overrides.balance ?? 0,
  };
}

const adminUser = mkUser({ id: "admin-1", role: "ADMIN", displayName: "Admin" });
const hallOpA = mkUser({ id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" });
const hallOpB = mkUser({ id: "op-b", role: "HALL_OPERATOR", hallId: "hall-b" });
const supportUser = mkUser({ id: "sup-1", role: "SUPPORT" });
const playerUser = mkUser({ id: "pl-1", role: "PLAYER" });
const agentA = mkUser({ id: "ag-a", role: "AGENT" });

// ── Helpers ─────────────────────────────────────────────────────────────

function makeBingo75Numbers(opts?: {
  row0?: [number, number, number, number, number];
  row1?: [number, number, number, number, number];
  row2?: [number, number, number, number, number];
  row3?: [number, number, number, number, number];
  row4?: [number, number, number, number, number];
}): number[] {
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
    numbersJson: "numbersJson" in overrides ? overrides.numbersJson! : null,
    patternWon: "patternWon" in overrides ? overrides.patternWon! : null,
    wonAmountCents: "wonAmountCents" in overrides ? overrides.wonAmountCents! : null,
    evaluatedAt: "evaluatedAt" in overrides ? overrides.evaluatedAt! : null,
    isWinningDistributed: overrides.isWinningDistributed ?? false,
    winningDistributedAt: "winningDistributedAt" in overrides ? overrides.winningDistributedAt! : null,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────

interface GameFixture {
  id: string;
  roomCode: string;
  hallId: string;
  drawnNumbers: number[];
  historic?: boolean;
  gameStatus?: "WAITING" | "RUNNING" | "ENDED";
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
  tokens: Map<string, PublicAppUser>;
  tickets: Map<string, PhysicalTicket>;
  auditStore: InMemoryAuditLogStore;
  rewardCalls: RewardAllInput[];
  seedAgentShift(id: string, hallId: string, token?: string): Promise<{ token: string }>;
  seedAgentNoShift(id: string, hallId: string, token?: string): Promise<{ token: string }>;
  setTicket(t: PhysicalTicket): void;
  setUserToken(token: string, user: PublicAppUser): void;
}

async function startServer(opts: { games: GameFixture[] }): Promise<Ctx> {
  const agentStore = new InMemoryAgentStore();
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const tokens = new Map<string, PublicAppUser>();
  const usersById = new Map<string, AppUser>();
  const tickets = new Map<string, PhysicalTicket>();
  const rewardCalls: RewardAllInput[] = [];

  const stubPlatform = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = tokens.get(token);
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getUserById(userId: string): Promise<AppUser> {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
  };
  const platformService = stubPlatform as unknown as PlatformService;

  const agentService = new AgentService({
    platformService,
    agentStore,
  });
  const agentShiftService = new AgentShiftService({
    agentStore,
    agentService,
  });

  const physicalTicketService = {
    async findByUniqueId(uniqueId: string): Promise<PhysicalTicket | null> {
      return tickets.get(uniqueId) ?? null;
    },
    async stampWinData(input: {
      uniqueId: string;
      numbers: number[];
      patternWon: PhysicalTicket["patternWon"];
    }): Promise<PhysicalTicket> {
      const existing = tickets.get(input.uniqueId);
      if (!existing) throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "ikke funnet");
      if (existing.numbersJson !== null) return existing;
      const stamped: PhysicalTicket = {
        ...existing,
        numbersJson: [...input.numbers],
        patternWon: input.patternWon,
        evaluatedAt: "2026-04-20T10:05:00Z",
        updatedAt: "2026-04-20T10:05:00Z",
      };
      tickets.set(input.uniqueId, stamped);
      return stamped;
    },
    async listSoldTicketsForGame(gameId: string, filter: { hallId?: string; limit?: number }) {
      const out: PhysicalTicket[] = [];
      for (const t of tickets.values()) {
        if (t.status !== "SOLD") continue;
        if (t.assignedGameId !== gameId) continue;
        if (filter.hallId && t.hallId !== filter.hallId) continue;
        out.push(t);
      }
      return out.slice(0, filter.limit ?? 200);
    },
    async rewardAll(input: RewardAllInput): Promise<RewardAllResult> {
      rewardCalls.push(input);
      const details = input.rewards.map((r) => {
        const existing = tickets.get(r.uniqueId);
        if (!existing) {
          return {
            uniqueId: r.uniqueId,
            status: "ticket_not_found" as const,
          };
        }
        if (existing.patternWon === null) {
          return {
            uniqueId: r.uniqueId,
            status: "skipped_not_stamped" as const,
            hallId: existing.hallId,
          };
        }
        if (existing.isWinningDistributed) {
          return {
            uniqueId: r.uniqueId,
            status: "skipped_already_distributed" as const,
            hallId: existing.hallId,
          };
        }
        if (existing.assignedGameId !== input.gameId) {
          return {
            uniqueId: r.uniqueId,
            status: "skipped_wrong_game" as const,
            hallId: existing.hallId,
          };
        }
        // Mark as distributed.
        tickets.set(r.uniqueId, {
          ...existing,
          isWinningDistributed: true,
          winningDistributedAt: "2026-04-20T11:00:00Z",
          wonAmountCents: r.amountCents,
        });
        return {
          uniqueId: r.uniqueId,
          status: "rewarded" as const,
          amountCents: r.amountCents,
          cashoutId: `cash-${r.uniqueId}`,
          hallId: existing.hallId,
        };
      });
      const rewarded = details.filter((d) => d.status === "rewarded");
      return {
        rewardedCount: rewarded.length,
        totalPayoutCents: rewarded.reduce((s, d) => s + (d.amountCents ?? 0), 0),
        skippedCount: details.length - rewarded.length,
        details,
      };
    },
  } as unknown as PhysicalTicketService;

  // Group games by room to mirror BingoEngine API.
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
  app.use(createAgentBingoRouter({
    platformService,
    physicalTicketService,
    agentService,
    agentShiftService,
    auditLogService,
    engine,
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    tokens,
    tickets,
    auditStore,
    rewardCalls,
    async seedAgentShift(id, hallId, token = `tok-${id}`) {
      agentStore.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      const u: AppUser = {
        id,
        email: `${id}@x.no`,
        displayName: id,
        walletId: `w-${id}`,
        role: "AGENT" as UserRole,
        hallId: null,
        kycStatus: "VERIFIED",
        createdAt: "",
        updatedAt: "",
      };
      usersById.set(id, u);
      tokens.set(token, { ...u, balance: 0 });
      await agentStore.assignHall({ userId: id, hallId, isPrimary: true });
      await agentStore.insertShift({ userId: id, hallId });
      return { token };
    },
    async seedAgentNoShift(id, hallId, token = `tok-${id}`) {
      agentStore.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      const u: AppUser = {
        id,
        email: `${id}@x.no`,
        displayName: id,
        walletId: `w-${id}`,
        role: "AGENT" as UserRole,
        hallId: null,
        kycStatus: "VERIFIED",
        createdAt: "",
        updatedAt: "",
      };
      usersById.set(id, u);
      tokens.set(token, { ...u, balance: 0 });
      await agentStore.assignHall({ userId: id, hallId, isPrimary: true });
      return { token };
    },
    setTicket(t) {
      tickets.set(t.uniqueId, t);
    },
    setUserToken(token, user) {
      tokens.set(token, user);
    },
  };
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  return { status: res.status, json };
}

// ── Tests ───────────────────────────────────────────────────────────────

test("Agent med aktiv shift får row_1 treff", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a", assignedGameId: "game-1" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hasWon, true);
    assert.equal(res.json.data.winningPattern, "row_1");
    assert.deepEqual(res.json.data.winningPatterns, ["row_1"]);
    assert.equal(res.json.data.payoutEligible, true);
    assert.equal(res.json.data.uniqueId, "100001");
    assert.equal(res.json.data.drawnNumbersCount, 5);
    // Grid-index-posisjoner som er markert (0..4 + 12 free centre).
    assert.deepEqual(res.json.data.matchedCellIndexes, [0, 1, 2, 3, 4, 12]);
  } finally {
    await ctx.close();
  }
});

test("Full House treff returnerer alle 5 mønstre", async () => {
  const ctx = await startServer({
    games: [{
      id: "game-1", roomCode: "R1", hallId: "hall-a",
      drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
    }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a", assignedGameId: "game-1" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.winningPattern, "full_house");
    assert.deepEqual(res.json.data.winningPatterns.sort(), ["full_house", "row_1", "row_2", "row_3", "row_4"]);
  } finally {
    await ctx.close();
  }
});

test("Agent uten aktiv shift får SHIFT_NOT_ACTIVE", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentNoShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "SHIFT_NOT_ACTIVE");
  } finally {
    await ctx.close();
  }
});

test("Agent i hall-a kan ikke sjekke billett i hall-b", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-b", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-b", assignedGameId: "game-1" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    // apiFailure konvensjon: 400 + error.code for alle DomainError (samme som
    // adminPhysicalTicketCheckBingo).
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("HALL_OPERATOR uten hallId → FORBIDDEN", async () => {
  const ctx = await startServer({ games: [] });
  try {
    ctx.setUserToken("op-nohall", mkUser({ id: "op-x", role: "HALL_OPERATOR", hallId: null }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", "op-nohall", {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("HALL_OPERATOR i korrekt hall får lov", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    ctx.setUserToken("op-tok", hallOpA);
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a", assignedGameId: "game-1" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", "op-tok", {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hasWon, true);
  } finally {
    await ctx.close();
  }
});

test("ADMIN har globalt scope", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-b", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    ctx.setUserToken("admin-tok", adminUser);
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-b", assignedGameId: "game-1" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", "admin-tok", {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hasWon, true);
  } finally {
    await ctx.close();
  }
});

test("SUPPORT og PLAYER → FORBIDDEN", async () => {
  const ctx = await startServer({ games: [] });
  try {
    ctx.setUserToken("sup-tok", supportUser);
    ctx.setUserToken("pl-tok", playerUser);
    for (const tok of ["sup-tok", "pl-tok"]) {
      const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", tok, {
        uniqueId: "100001",
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

test("Manglende token → UNAUTHORIZED", async () => {
  const ctx = await startServer({ games: [] });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", undefined, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("VOIDED ticket → PHYSICAL_TICKET_VOIDED", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a", status: "VOIDED" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "PHYSICAL_TICKET_VOIDED");
  } finally {
    await ctx.close();
  }
});

test("numbers.length !== 25 → INVALID_INPUT", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a" }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: [1, 2, 3],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("Idempotens: re-sjekk returnerer cached patternWon", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a", assignedGameId: "game-1" }));
    await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    const res2 = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.json.data.alreadyEvaluated, true);
    assert.equal(res2.json.data.winningPattern, "row_1");
  } finally {
    await ctx.close();
  }
});

test("NUMBERS_MISMATCH hvis andre tall sendes etter stamp", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({ uniqueId: "100001", hallId: "hall-a", assignedGameId: "game-1" }));
    await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: makeBingo75Numbers(),
    });
    const other = makeBingo75Numbers({ row0: [50, 51, 52, 53, 54] });
    const res2 = await req(ctx.baseUrl, "POST", "/api/agent/bingo/check", token, {
      uniqueId: "100001",
      gameId: "game-1",
      numbers: other,
    });
    assert.equal(res2.status, 400);
    assert.equal(res2.json.error.code, "NUMBERS_MISMATCH");
  } finally {
    await ctx.close();
  }
});

test("GET /api/agent/physical/pending — lister stemplede vinnere i agentens hall", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({
      uniqueId: "100001",
      hallId: "hall-a",
      assignedGameId: "game-1",
      numbersJson: makeBingo75Numbers(),
      patternWon: "row_1",
      isWinningDistributed: false,
    }));
    ctx.setTicket(makeTicket({
      uniqueId: "100002",
      hallId: "hall-a",
      assignedGameId: "game-1",
      numbersJson: makeBingo75Numbers(),
      patternWon: "row_2",
      isWinningDistributed: true,
    }));
    // Billett fra annen hall skal ikke inkluderes.
    ctx.setTicket(makeTicket({
      uniqueId: "200001",
      hallId: "hall-b",
      assignedGameId: "game-1",
      numbersJson: makeBingo75Numbers(),
      patternWon: "row_1",
      isWinningDistributed: false,
    }));
    const res = await req(ctx.baseUrl, "GET", "/api/agent/physical/pending?gameId=game-1", token);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.pendingCount, 1);
    assert.equal(res.json.data.rewardedCount, 1);
    assert.equal(res.json.data.pending[0].uniqueId, "100001");
    assert.equal(res.json.data.rewarded[0].uniqueId, "100002");
  } finally {
    await ctx.close();
  }
});

test("POST /reward-all — bulk-utbetaling + audit-event", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({
      uniqueId: "100001",
      hallId: "hall-a",
      assignedGameId: "game-1",
      numbersJson: makeBingo75Numbers(),
      patternWon: "row_1",
    }));
    ctx.setTicket(makeTicket({
      uniqueId: "100002",
      hallId: "hall-a",
      assignedGameId: "game-1",
      numbersJson: makeBingo75Numbers(),
      patternWon: "row_2",
    }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/physical/reward-all", token, {
      gameId: "game-1",
      rewards: [
        { uniqueId: "100001", amountCents: 10000 },
        { uniqueId: "100002", amountCents: 15000 },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.rewardedCount, 2);
    assert.equal(res.json.data.totalPayoutCents, 25000);
    assert.equal(ctx.rewardCalls.length, 1);
    // Audit-flush er async; gi event-loopen en tick.
    await new Promise((r) => setTimeout(r, 20));
    const events = await ctx.auditStore.list({ limit: 100 });
    const bulkEvent = events.find((e) => e.action === "agent.physical_ticket.reward_all");
    assert.ok(bulkEvent, "bulk audit-event savnes");
    assert.equal(bulkEvent?.actorType, "AGENT");
  } finally {
    await ctx.close();
  }
});

test("POST /reward-all — agent fra annen hall avvises med FORBIDDEN", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-b", drawnNumbers: [1] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({
      uniqueId: "200001",
      hallId: "hall-b",
      assignedGameId: "game-1",
      numbersJson: makeBingo75Numbers(),
      patternWon: "row_1",
    }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/physical/reward-all", token, {
      gameId: "game-1",
      rewards: [{ uniqueId: "200001", amountCents: 10000 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /api/agent/physical/:uniqueId/reward — per-billett utbetaling", async () => {
  const ctx = await startServer({
    games: [{ id: "game-1", roomCode: "R1", hallId: "hall-a", drawnNumbers: [1, 2, 3, 4, 5] }],
  });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    ctx.setTicket(makeTicket({
      uniqueId: "100001",
      hallId: "hall-a",
      assignedGameId: "game-1",
      numbersJson: makeBingo75Numbers(),
      patternWon: "row_1",
    }));
    const res = await req(ctx.baseUrl, "POST", "/api/agent/physical/100001/reward", token, {
      gameId: "game-1",
      amountCents: 12000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.status, "rewarded");
    assert.equal(res.json.data.amountCents, 12000);
    assert.equal(ctx.rewardCalls.length, 1);
    assert.equal(ctx.rewardCalls[0]?.rewards[0]?.uniqueId, "100001");
  } finally {
    await ctx.close();
  }
});

test("POST /api/agent/physical/reward-all avviser duplikat uniqueId i payload", async () => {
  const ctx = await startServer({ games: [] });
  try {
    const { token } = await ctx.seedAgentShift("ag-1", "hall-a");
    const res = await req(ctx.baseUrl, "POST", "/api/agent/physical/reward-all", token, {
      gameId: "game-1",
      rewards: [
        { uniqueId: "100001", amountCents: 10000 },
        { uniqueId: "100001", amountCents: 20000 },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
