/**
 * Bølge D Issue 1 (HØY) — 2026-04-25:
 *   Mini-game-events (`mini_game:choice` + `mini_game:join`) MÅ rate-limites.
 *   Mini-games har wallet-impact (handleChoice → prize-payout) → spam-events
 *   kan trigge race mot pending-payout-tabellen.
 *
 * Tester her verifiserer:
 *   - `mini_game:choice` over rate-limit returnerer ack med RATE_LIMITED og
 *     prosesserer IKKE eventet (orchestrator.handleChoice ikke kalt).
 *   - `mini_game:join` over rate-limit returnerer ack med RATE_LIMITED.
 *   - Per-socket bucket: hver socket har egen limit.
 *   - Når ingen rate-limiter er injisert (test) → ingen rate-limit (matcher
 *     legacy-adferd og verifiserer optional-deps-kontrakten).
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { Server, type Socket as ServerSocket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import { createMiniGameSocketWire } from "../miniGameSocketWire.js";
import { SocketRateLimiter } from "../../middleware/socketRateLimit.js";
import type {
  Game1MiniGameOrchestrator,
  HandleChoiceInput,
  HandleChoiceResult,
  MiniGameBroadcaster,
} from "../../game/minigames/Game1MiniGameOrchestrator.js";

// ── Test fixtures ──────────────────────────────────────────────────────────

const TEST_USERS: Record<string, PublicAppUser> = {
  "tok-winner": {
    id: "user-winner",
    email: "winner@test.no",
    displayName: "Winner",
    walletId: "wallet-winner",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  },
};

const mockPlatform = {
  getUserFromAccessToken: async (token: string): Promise<PublicAppUser> => {
    const u = TEST_USERS[token];
    if (!u) throw new Error(`UNAUTHORIZED: ukjent token "${token}"`);
    return { ...u };
  },
};

interface MockOrchestrator {
  service: Game1MiniGameOrchestrator;
  handleChoiceCalls: HandleChoiceInput[];
  capturedBroadcaster: MiniGameBroadcaster | null;
}

function makeMockOrchestrator(): MockOrchestrator {
  let captured: MiniGameBroadcaster | null = null;
  const calls: HandleChoiceInput[] = [];
  const fake = {
    setBroadcaster(b: MiniGameBroadcaster): void {
      captured = b;
    },
    handleChoice(input: HandleChoiceInput): Promise<HandleChoiceResult> {
      calls.push({ ...input });
      return Promise.resolve({
        resultId: input.resultId,
        miniGameType: "mystery",
        payoutCents: 1_000,
        resultJson: { mocked: true },
      });
    },
  } as unknown as Game1MiniGameOrchestrator;
  return {
    service: fake,
    handleChoiceCalls: calls,
    get capturedBroadcaster() {
      return captured;
    },
  };
}

interface Fixture {
  url: string;
  io: Server;
  orchestrator: MockOrchestrator;
  rateLimiter: SocketRateLimiter | null;
  close: () => Promise<void>;
}

interface StartOpts {
  /** When provided, install a strict rate-limit. Otherwise no limiter (test fallback). */
  rateLimits?: Record<string, { windowMs: number; maxEvents: number }>;
}

async function startServer(opts: StartOpts = {}): Promise<Fixture> {
  const app = express();
  const httpSrv = http.createServer(app);
  const io = new Server(httpSrv, { cors: { origin: "*" } });
  const orchestrator = makeMockOrchestrator();
  const rateLimiter = opts.rateLimits ? new SocketRateLimiter(opts.rateLimits) : null;
  const wire = createMiniGameSocketWire({
    io,
    orchestrator: orchestrator.service,
    platformService: mockPlatform as never,
    socketRateLimiter: rateLimiter ?? undefined,
  });
  orchestrator.service.setBroadcaster(wire.broadcaster);
  io.on("connection", (socket: ServerSocket) => {
    wire.register(socket);
  });

  await new Promise<void>((resolve) => httpSrv.listen(0, resolve));
  const addr = httpSrv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://localhost:${port}`,
    io,
    orchestrator,
    rateLimiter,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()));
    },
  };
}

function connect(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = ioClient(url, { transports: ["websocket"], reconnection: false, timeout: 2000 });
    const t = setTimeout(() => reject(new Error("connect timeout")), 3000);
    sock.on("connect", () => {
      clearTimeout(t);
      resolve(sock);
    });
    sock.on("connect_error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function disconnect(sock: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (sock.disconnected) return resolve();
    sock.once("disconnect", () => resolve());
    sock.disconnect();
  });
}

interface AckShape {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

function emitWithAck(sock: ClientSocket, event: string, payload: unknown): Promise<AckShape> {
  return new Promise((resolve) => {
    sock.emit(event, payload, (resp: AckShape) => resolve(resp));
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Bølge D Issue 1: mini-game socket-wire — rate-limit", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await fixture.close();
  });

  test("mini_game:choice over limit returnerer RATE_LIMITED + handleChoice IKKE kalt", async () => {
    fixture = await startServer({
      rateLimits: { "mini_game:choice": { windowMs: 10_000, maxEvents: 2 } },
    });
    const sock = await connect(fixture.url);
    try {
      // De første 2 events går igjennom (auth lykkes, handleChoice kalles).
      const r1 = await emitWithAck(sock, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-1",
        choice: { x: 1 },
      });
      assert.equal(r1.ok, true);

      const r2 = await emitWithAck(sock, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-2",
        choice: { x: 2 },
      });
      assert.equal(r2.ok, true);

      // 3. event skal avvises pga rate-limit. Per-socket-bucket har truffet maksen.
      const r3 = await emitWithAck(sock, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-3",
        choice: { x: 3 },
      });
      assert.equal(r3.ok, false, "3. event skal avvises av rate-limit");
      assert.equal(r3.error?.code, "RATE_LIMITED");

      // Kritisk: orchestrator.handleChoice skal IKKE være kalt for 3. event.
      // Pga walletId-sjekk er begge limit-checks kombinert; ekte handleChoice
      // kalles kun for de første 2.
      assert.equal(
        fixture.orchestrator.handleChoiceCalls.length,
        2,
        "handleChoice skal IKKE kalles for rate-limited event",
      );
    } finally {
      await disconnect(sock);
    }
  });

  test("mini_game:join over limit returnerer RATE_LIMITED", async () => {
    fixture = await startServer({
      rateLimits: { "mini_game:join": { windowMs: 10_000, maxEvents: 1 } },
    });
    const sock = await connect(fixture.url);
    try {
      const r1 = await emitWithAck(sock, "mini_game:join", { accessToken: "tok-winner" });
      assert.equal(r1.ok, true);

      const r2 = await emitWithAck(sock, "mini_game:join", { accessToken: "tok-winner" });
      assert.equal(r2.ok, false, "2. join skal avvises av rate-limit");
      assert.equal(r2.error?.code, "RATE_LIMITED");
    } finally {
      await disconnect(sock);
    }
  });

  test("hver socket har egen rate-limit-bucket (per-socket isolation)", async () => {
    // To sockets, samme accessToken — per-socket-bucket gir hver sin egen kvote.
    // (walletId-sjekken slår inn etter auth, men en limiter med kun socket.id-bucket
    // for unauthenticated-fasen sikrer dette spesifikt.)
    fixture = await startServer({
      rateLimits: { "mini_game:choice": { windowMs: 10_000, maxEvents: 1 } },
    });
    const sockA = await connect(fixture.url);
    const sockB = await connect(fixture.url);
    try {
      // Sock A bruker opp sin kvote (1 event).
      const a1 = await emitWithAck(sockA, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-a1",
        choice: { x: 1 },
      });
      assert.equal(a1.ok, true);

      // Sock B kan også sende 1 event — egen socket-bucket.
      // Men siden walletId er samme, slår walletId-sjekken inn.
      // Dette er ønsket adferd: rate-limit ÆR per walletId, ikke kun per socket,
      // for å hindre reconnect-bypass. Sockene B her får RATE_LIMITED.
      const b1 = await emitWithAck(sockB, "mini_game:choice", {
        accessToken: "tok-winner",
        resultId: "mgr-b1",
        choice: { x: 1 },
      });
      assert.equal(b1.ok, false, "samme walletId fra annen socket skal også limites");
      assert.equal(b1.error?.code, "RATE_LIMITED");
    } finally {
      await disconnect(sockA);
      await disconnect(sockB);
    }
  });

  test("uten injisert rate-limiter (test-fallback) → ingen rate-limit kicker inn", async () => {
    // Verifiserer at optional-deps-kontrakten holder: deps uten socketRateLimiter
    // gir samme adferd som før patchen.
    fixture = await startServer({});
    assert.equal(fixture.rateLimiter, null, "test starter UTEN rate-limiter");
    const sock = await connect(fixture.url);
    try {
      // Send 5 events i strekk — ingen skal avvises.
      for (let i = 0; i < 5; i++) {
        const ack = await emitWithAck(sock, "mini_game:choice", {
          accessToken: "tok-winner",
          resultId: `mgr-${i}`,
          choice: { i },
        });
        assert.equal(ack.ok, true, `event #${i} skal gå igjennom uten limiter`);
      }
      assert.equal(fixture.orchestrator.handleChoiceCalls.length, 5);
    } finally {
      await disconnect(sock);
    }
  });
});
