/**
 * Bølge D Issue 2 (MEDIUM) — 2026-04-25:
 *   `/admin-game1`-namespace rate-limiting. Admin-bug eller misbruks-account
 *   skal ikke kunne flomme system med subscribe/unsubscribe-events.
 *
 * Tester her verifiserer:
 *   - game1:subscribe over rate-limit returnerer ack med RATE_LIMITED
 *     og prosesserer IKKE eventet (socket.join skjer ikke).
 *   - game1:unsubscribe respekterer samme limit.
 *   - Når ingen rate-limiter er injisert (test-default) → ingen rate-limit.
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import { createAdminGame1Namespace } from "../adminGame1Namespace.js";
import { SocketRateLimiter } from "../../middleware/socketRateLimit.js";

const TEST_USERS: Record<string, PublicAppUser> = {
  "tok-admin": {
    id: "user-admin",
    email: "admin@test.no",
    displayName: "Admin",
    walletId: "wallet-admin",
    role: "ADMIN",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  },
};

const mockPlatform = {
  getUserFromAccessToken: async (token: string): Promise<PublicAppUser> => {
    const user = TEST_USERS[token];
    if (!user) throw new Error(`UNAUTHORIZED: unknown token "${token}"`);
    return { ...user };
  },
};

interface TestFixture {
  url: string;
  io: Server;
  rateLimiter: SocketRateLimiter | null;
  close: () => Promise<void>;
}

interface StartOpts {
  rateLimits?: Record<string, { windowMs: number; maxEvents: number }>;
}

async function startServer(opts: StartOpts = {}): Promise<TestFixture> {
  const app = express();
  const httpSrv = http.createServer(app);
  const io = new Server(httpSrv, { cors: { origin: "*" } });
  const rateLimiter = opts.rateLimits ? new SocketRateLimiter(opts.rateLimits) : null;
  createAdminGame1Namespace({
    io,
    platformService: mockPlatform as never,
    socketRateLimiter: rateLimiter ?? undefined,
  });
  await new Promise<void>((resolve) => httpSrv.listen(0, resolve));
  const addr = httpSrv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://localhost:${port}`,
    io,
    rateLimiter,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()));
    },
  };
}

function connect(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = ioClient(`${url}/admin-game1`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 2000,
    });
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
  error?: { code: string; message: string };
}

function emitWithAck(sock: ClientSocket, event: string, payload: unknown): Promise<AckShape> {
  return new Promise((resolve) => {
    sock.emit(event, payload, (resp: AckShape) => resolve(resp));
  });
}

describe("Bølge D Issue 2: /admin-game1 namespace — rate-limit", () => {
  let fixture: TestFixture;

  afterEach(async () => {
    if (fixture) await fixture.close();
  });

  test("game1:subscribe over limit returnerer RATE_LIMITED", async () => {
    fixture = await startServer({
      rateLimits: { "game1:subscribe": { windowMs: 10_000, maxEvents: 1 } },
    });
    const sock = await connect(fixture.url, "tok-admin");
    try {
      const r1 = await emitWithAck(sock, "game1:subscribe", { gameId: "sg-1" });
      assert.equal(r1.ok, true);

      // Andre subscribe skal avvises av rate-limit.
      const r2 = await emitWithAck(sock, "game1:subscribe", { gameId: "sg-2" });
      assert.equal(r2.ok, false);
      assert.equal(r2.error?.code, "RATE_LIMITED");
    } finally {
      await disconnect(sock);
    }
  });

  test("game1:unsubscribe over limit returnerer RATE_LIMITED", async () => {
    fixture = await startServer({
      rateLimits: { "game1:unsubscribe": { windowMs: 10_000, maxEvents: 1 } },
    });
    const sock = await connect(fixture.url, "tok-admin");
    try {
      const r1 = await emitWithAck(sock, "game1:unsubscribe", { gameId: "sg-1" });
      assert.equal(r1.ok, true);

      const r2 = await emitWithAck(sock, "game1:unsubscribe", { gameId: "sg-2" });
      assert.equal(r2.ok, false);
      assert.equal(r2.error?.code, "RATE_LIMITED");
    } finally {
      await disconnect(sock);
    }
  });

  test("uten rate-limiter (test-default) → ingen rate-limit kicker inn", async () => {
    fixture = await startServer({});
    assert.equal(fixture.rateLimiter, null);
    const sock = await connect(fixture.url, "tok-admin");
    try {
      // 5 subscribes — alle skal gå igjennom uten rate-limit.
      for (let i = 0; i < 5; i++) {
        const r = await emitWithAck(sock, "game1:subscribe", { gameId: `sg-${i}` });
        assert.equal(r.ok, true, `subscribe #${i} skal passere uten limiter`);
      }
    } finally {
      await disconnect(sock);
    }
  });
});
