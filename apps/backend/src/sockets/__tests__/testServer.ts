/**
 * Test server helper for Socket.IO integration tests.
 * Creates a minimal Express + Socket.IO server with in-memory adapters
 * and a mock PlatformService — no PostgreSQL required.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server, type Socket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { BingoEngine } from "../../game/BingoEngine.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import {
  type CreateWalletAccountInput,
  type WalletAccount,
  type WalletAdapter,
  type WalletTransaction,
  WalletError,
  type WalletTransferResult,
} from "../../adapters/WalletAdapter.js";
import type { Ticket, RoomSnapshot } from "../../game/types.js";
import type { PublicAppUser, HallDefinition } from "../../platform/PlatformService.js";
import { createGameEventHandlers, type GameEventsDeps } from "../gameEvents.js";
import { SocketRateLimiter } from "../../middleware/socketRateLimit.js";
import { RoomStateManager } from "../../util/roomState.js";
import {
  buildRoomUpdatePayload as buildRoomUpdatePayloadHelper,
  getPrimaryRoomForHall,
  findPlayerInRoomByWallet,
  type RoomUpdatePayload,
} from "../../util/roomHelpers.js";

// ── In-memory wallet adapter ─────────────────────────────────────────────────

class InMemoryWalletAdapter implements WalletAdapter {
  private readonly accounts = new Map<string, WalletAccount>();
  private readonly transactions: WalletTransaction[] = [];
  private txCounter = 0;

  async createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
    const accountId = input?.accountId?.trim() || `wallet-${randomUUID()}`;
    const initialBalance = Number(input?.initialBalance ?? 0);
    const allowExisting = Boolean(input?.allowExisting);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) throw new WalletError("INVALID_AMOUNT", "");
    const existing = this.accounts.get(accountId);
    if (existing) {
      if (!allowExisting) throw new WalletError("ACCOUNT_EXISTS", "");
      return { ...existing };
    }
    const now = new Date().toISOString();
    const account: WalletAccount = { id: accountId, balance: initialBalance, createdAt: now, updatedAt: now };
    this.accounts.set(accountId, account);
    return { ...account };
  }

  async ensureAccount(accountId: string): Promise<WalletAccount> {
    if (this.accounts.has(accountId)) return this.getAccount(accountId);
    return this.createAccount({ accountId, initialBalance: 1000, allowExisting: true });
  }

  async getAccount(accountId: string): Promise<WalletAccount> {
    const account = this.accounts.get(accountId.trim());
    if (!account) throw new WalletError("ACCOUNT_NOT_FOUND", "");
    return { ...account };
  }

  async listAccounts(): Promise<WalletAccount[]> { return [...this.accounts.values()]; }
  async getBalance(accountId: string): Promise<number> { return (await this.getAccount(accountId)).balance; }

  async debit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, -Math.abs(amount), "DEBIT", reason);
  }
  async credit(accountId: string, amount: number, reason: string): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, Math.abs(amount), "CREDIT", reason);
  }
  async topUp(accountId: string, amount: number, reason = ""): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, Math.abs(amount), "TOPUP", reason);
  }
  async withdraw(accountId: string, amount: number, reason = ""): Promise<WalletTransaction> {
    return this.adjustBalance(accountId, -Math.abs(amount), "WITHDRAWAL", reason);
  }
  async transfer(fromId: string, toId: string, amount: number, reason = ""): Promise<WalletTransferResult> {
    const fromTx = await this.adjustBalance(fromId, -Math.abs(amount), "TRANSFER_OUT", reason, toId);
    const toTx = await this.adjustBalance(toId, Math.abs(amount), "TRANSFER_IN", reason, fromId);
    return { fromTx, toTx };
  }
  async listTransactions(accountId: string, limit = 100): Promise<WalletTransaction[]> {
    return this.transactions.filter((tx) => tx.accountId === accountId.trim()).slice(-Math.max(0, limit));
  }

  private async adjustBalance(
    accountId: string, delta: number, type: WalletTransaction["type"], reason: string, relatedAccountId?: string,
  ): Promise<WalletTransaction> {
    const id = accountId.trim();
    if (!Number.isFinite(delta) || delta === 0) throw new WalletError("INVALID_AMOUNT", "");
    const account = await this.ensureAccount(id);
    const nextBalance = account.balance + delta;
    if (nextBalance < 0) throw new WalletError("INSUFFICIENT_FUNDS", "");
    const updated = { ...account, balance: nextBalance, updatedAt: new Date().toISOString() };
    this.accounts.set(id, updated);
    const tx: WalletTransaction = {
      id: `tx-${++this.txCounter}`, accountId: id, type, amount: Math.abs(delta),
      reason, createdAt: new Date().toISOString(), relatedAccountId,
    };
    this.transactions.push(tx);
    return { ...tx };
  }
}

// ── Fixed-ticket bingo adapter ───────────────────────────────────────────────

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53],
      ],
    };
  }
}

// ── Mock PlatformService ─────────────────────────────────────────────────────

const TEST_USERS: Record<string, PublicAppUser> = {
  "token-alice": {
    id: "user-alice", email: "alice@test.no", displayName: "Alice", walletId: "wallet-alice",
    role: "PLAYER", kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", balance: 1000,
  },
  "token-bob": {
    id: "user-bob", email: "bob@test.no", displayName: "Bob", walletId: "wallet-bob",
    role: "PLAYER", kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", balance: 1000,
  },
  "token-admin": {
    id: "user-admin", email: "admin@test.no", displayName: "Admin", walletId: "wallet-admin",
    role: "ADMIN", kycStatus: "VERIFIED", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", balance: 0,
  },
};

function createMockPlatformService() {
  return {
    getUserFromAccessToken: async (token: string): Promise<PublicAppUser> => {
      const user = TEST_USERS[token];
      if (!user) throw new Error(`UNAUTHORIZED: unknown test token "${token}"`);
      return { ...user };
    },
    assertUserEligibleForGameplay: (_user: PublicAppUser): void => { /* noop in dev */ },
    requireActiveHall: async (hallId: string): Promise<HallDefinition> => ({
      id: hallId, slug: hallId, name: `Test Hall ${hallId}`, region: "test", address: "Test",
      isActive: true, clientVariant: "unity" as const,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }),
    listHallGameConfigs: async () => [{
      hallId: "hall-test", gameSlug: "bingo", isEnabled: true, maxTicketsPerPlayer: 5,
    }],
  };
}

// ── Test server ──────────────────────────────────────────────────────────────

/** Wrapper around Socket.IO client that auto-injects accessToken in every emit. */
export interface TestClient {
  socket: ClientSocket;
  token: string;
  emit: <T>(event: string, payload?: Record<string, unknown>) => Promise<T>;
  waitFor: <T>(event: string, timeoutMs?: number) => Promise<T>;
  disconnect: () => void;
}

export interface TestServer {
  url: string;
  engine: BingoEngine;
  io: Server;
  /** BIN-509: exposed so tests can seed variant config (replaceAmount, etc.). */
  roomState: RoomStateManager;
  walletAdapter: WalletAdapter;
  close: () => Promise<void>;
  connectClient: (token: string) => Promise<TestClient>;
}

const DEFAULT_BINGO_SETTINGS = {
  autoRoundStartEnabled: false,
  autoRoundStartIntervalMs: 30000,
  autoRoundMinPlayers: 1,
  autoRoundTicketsPerPlayer: 1,
  autoRoundEntryFee: 10,
  payoutPercent: 80,
  autoDrawEnabled: false,
  autoDrawIntervalMs: 2000,
};

export async function createTestServer(): Promise<TestServer> {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  const walletAdapter = new InMemoryWalletAdapter();
  // Deterministic draw bag: all 24 numbers from the FixedTicketBingoAdapter grid come
  // first, then the remaining balls in ascending order. Guarantees the integration
  // test can mark a full grid and claim BINGO well before the engine auto-ends the
  // round at maxDrawsPerRound.
  const FIXED_GRID_NUMBERS = [1,2,3,4,5, 13,14,15,16,17, 25,26,27,28, 37,38,39,40,41, 49,50,51,52,53];
  const deterministicDrawBag = (size: number): number[] => {
    const rest: number[] = [];
    for (let n = 1; n <= size; n += 1) {
      if (!FIXED_GRID_NUMBERS.includes(n)) rest.push(n);
    }
    return [...FIXED_GRID_NUMBERS.filter((n) => n <= size), ...rest];
  };
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), walletAdapter, {
    minDrawIntervalMs: 0,         // No delay between draws in tests
    minRoundIntervalMs: 0,        // No delay between rounds in tests
    maxDrawsPerRound: 75,         // Allow draining the full 75-ball bag (5×5 bingo)
    drawBagFactory: deterministicDrawBag,
  });
  const mockPlatform = createMockPlatformService();
  // Relaxed rate limits for integration tests — allow rapid draws
  const testRateLimits: Record<string, { windowMs: number; maxEvents: number }> = {
    "room:create":    { windowMs: 1000, maxEvents: 100 },
    "room:join":      { windowMs: 1000, maxEvents: 100 },
    "room:resume":    { windowMs: 1000, maxEvents: 100 },
    "game:start":     { windowMs: 1000, maxEvents: 100 },
    "game:end":       { windowMs: 1000, maxEvents: 100 },
    "draw:next":      { windowMs: 1000, maxEvents: 100 },
    "ticket:mark":    { windowMs: 1000, maxEvents: 100 },
    "claim:submit":   { windowMs: 1000, maxEvents: 100 },
    "room:state":     { windowMs: 1000, maxEvents: 100 },
    "bet:arm":        { windowMs: 1000, maxEvents: 100 },
  };
  const socketRateLimiter = new SocketRateLimiter(testRateLimits);
  const roomState = new RoomStateManager();

  // Simplified buildRoomUpdatePayload without DrawScheduler
  function buildRoomUpdatePayload(snapshot: RoomSnapshot): RoomUpdatePayload {
    const preRoundTickets: Record<string, Ticket[]> = {};
    const luckyNumbers = roomState.getLuckyNumbers(snapshot.code);
    return {
      ...snapshot,
      preRoundTickets,
      armedPlayerIds: roomState.getArmedPlayerIds(snapshot.code),
      playerStakes: {},
      luckyNumbers,
      scheduler: {
        enabled: false,
        millisUntilNextStart: null,
        autoDrawEnabled: false,
        canStartNow: false,
      },
      serverTimestamp: Date.now(),
    };
  }

  async function emitRoomUpdate(roomCode: string): Promise<RoomUpdatePayload> {
    const payload = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
    io.to(roomCode).emit("room:update", payload);
    return payload;
  }

  // Auth middleware — map test tokens to users
  io.use(async (socket, next) => {
    const token =
      (typeof socket.handshake.auth?.accessToken === "string" ? socket.handshake.auth.accessToken : "") ||
      (typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : "");
    if (token) {
      try {
        const user = await mockPlatform.getUserFromAccessToken(token);
        socket.data.user = user;
        socket.data.authenticated = true;
      } catch {
        return next(new Error("UNAUTHORIZED"));
      }
    }
    next();
  });

  const deps: GameEventsDeps = {
    engine,
    platformService: mockPlatform as unknown as GameEventsDeps["platformService"],
    io,
    socketRateLimiter,
    emitRoomUpdate,
    emitManyRoomUpdates: async (codes) => { for (const c of codes) await emitRoomUpdate(c); },
    buildRoomUpdatePayload,
    enforceSingleRoomPerHall: true,
    runtimeBingoSettings: DEFAULT_BINGO_SETTINGS,
    chatHistoryByRoom: roomState.chatHistoryByRoom,
    luckyNumbersByRoom: roomState.luckyNumbersByRoom,
    armedPlayerIdsByRoom: roomState.armedPlayerIdsByRoom,
    roomConfiguredEntryFeeByRoom: roomState.roomConfiguredEntryFeeByRoom,
    displayTicketCache: roomState.displayTicketCache,
    getPrimaryRoomForHall: (hallId) => getPrimaryRoomForHall(hallId, engine.listRoomSummaries()),
    findPlayerInRoomByWallet,
    getRoomConfiguredEntryFee: (code) => roomState.getRoomConfiguredEntryFee(code, DEFAULT_BINGO_SETTINGS.autoRoundEntryFee),
    getArmedPlayerIds: (code) => roomState.getArmedPlayerIds(code),
    getArmedPlayerTicketCounts: (code) => roomState.getArmedPlayerTicketCounts(code),
    getArmedPlayerSelections: (code) => roomState.getArmedPlayerSelections(code),
    armPlayer: (code, id, ticketCount, selections) => roomState.armPlayer(code, id, ticketCount, selections),
    disarmPlayer: (code, id) => roomState.disarmPlayer(code, id),
    disarmAllPlayers: (code) => roomState.disarmAllPlayers(code),
    clearDisplayTicketCache: (code) => roomState.clearDisplayTicketCache(code),
    replaceDisplayTicket: (code, id, ticketId, slug) => roomState.replaceDisplayTicket(code, id, ticketId, slug),
    resolveBingoHallGameConfigForRoom: async () => ({ hallId: "hall-test", maxTicketsPerPlayer: 5 }),
    requireActiveHallIdFromInput: async (input) => (typeof input === "string" ? input : "hall-test"),
    buildLeaderboard: () => [],
    getVariantConfig: (code) => roomState.getVariantConfig(code),
  };

  const registerGameEvents = createGameEventHandlers(deps);
  io.on("connection", (socket: Socket) => registerGameEvents(socket));

  // Start on random port
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://localhost:${port}`;

  const clients: ClientSocket[] = [];

  function makeTestClient(socket: ClientSocket, token: string): TestClient {
    return {
      socket,
      token,
      emit: <T>(event: string, payload: Record<string, unknown> = {}): Promise<T> => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timeout on emit "${event}"`)), 5000);
          socket.emit(event, { ...payload, accessToken: token }, (response: T) => {
            clearTimeout(timer);
            resolve(response);
          });
        });
      },
      waitFor: <T>(event: string, timeoutMs = 5000): Promise<T> => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
          socket.once(event, (data: T) => {
            clearTimeout(timer);
            resolve(data);
          });
        });
      },
      disconnect: () => socket.disconnect(),
    };
  }

  return {
    url,
    engine,
    io,
    roomState,
    walletAdapter,
    close: async () => {
      for (const c of clients) c.disconnect();
      io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      socketRateLimiter.stop();
    },
    connectClient: (token: string): Promise<TestClient> => {
      return new Promise((resolve, reject) => {
        const client = ioClient(url, {
          auth: { accessToken: token },
          transports: ["websocket"],
          reconnection: false,
        });
        clients.push(client);
        client.on("connect", () => resolve(makeTestClient(client, token)));
        client.on("connect_error", (err) => reject(err));
      });
    },
  };
}
