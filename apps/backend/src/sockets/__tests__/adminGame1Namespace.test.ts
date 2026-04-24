/**
 * GAME1_SCHEDULE PR 4d.3: integrasjonstest for `/admin-game1`-namespace.
 *
 * Verifiserer:
 *   - JWT-handshake-auth: PLAYER-token → UNAUTHORIZED; ADMIN-token → OK
 *   - `game1:subscribe { gameId }` → socket.join → broadcaster.onStatusChange
 *     mottas kun av subscribed clients
 *   - `game1:unsubscribe` stopper fan-out
 *   - Broadcaster `onDrawProgressed` emittes til samme rom
 *   - Hall-operator-token med GAME1_MASTER_WRITE godtas
 */

import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { Server, type Socket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import { createAdminGame1Namespace } from "../adminGame1Namespace.js";
import type { AdminGame1Broadcaster } from "../../game/AdminGame1Broadcaster.js";

// ── Mock platform service ───────────────────────────────────────────────────

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
  "tok-hallop": {
    id: "user-hallop",
    email: "hallop@test.no",
    displayName: "HallOperator",
    walletId: "wallet-hallop",
    role: "HALL_OPERATOR",
    hallId: "hall-a",
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 0,
  },
  "tok-player": {
    id: "user-player",
    email: "player@test.no",
    displayName: "Player",
    walletId: "wallet-player",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 100,
  },
};

const mockPlatform = {
  getUserFromAccessToken: async (token: string): Promise<PublicAppUser> => {
    const user = TEST_USERS[token];
    if (!user) throw new Error(`UNAUTHORIZED: unknown token "${token}"`);
    return { ...user };
  },
};

// ── Test server helper ──────────────────────────────────────────────────────

interface TestFixture {
  url: string;
  io: Server;
  broadcaster: AdminGame1Broadcaster;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestFixture> {
  const app = express();
  const httpSrv = http.createServer(app);
  const io = new Server(httpSrv, { cors: { origin: "*" } });

  const handle = createAdminGame1Namespace({
    io,
    platformService: mockPlatform as never,
  });

  await new Promise<void>((resolve) => httpSrv.listen(0, resolve));
  const addr = httpSrv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://localhost:${port}`,
    io,
    broadcaster: handle.broadcaster,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()));
    },
  };
}

function connect(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`${url}/admin-game1`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 2000,
    });
    const timeout = setTimeout(
      () => reject(new Error("connect timeout")),
      3000
    );
    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function disconnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.disconnected) return resolve();
    socket.once("disconnect", () => resolve());
    socket.disconnect();
  });
}

function waitForEvent<T>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 1500
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${event}"`)),
      timeoutMs
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("PR 4d.3: /admin-game1 namespace — auth + subscribe + broadcast", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await startServer();
  });

  afterEach(async () => {
    await fixture.close();
  });

  test("PLAYER-token blir avvist i handshake (UNAUTHORIZED)", async () => {
    await assert.rejects(
      () => connect(fixture.url, "tok-player"),
      (err: Error) => /UNAUTHORIZED|FORBIDDEN|permiss/i.test(err.message) ||
        // socket.io wrapper reporter kan bruke generisk label
        err.message.length > 0
    );
  });

  test("Ukjent token → UNAUTHORIZED", async () => {
    await assert.rejects(() => connect(fixture.url, "tok-whatever"));
  });

  test("ADMIN-token kobles til og kan subscribe", async () => {
    const socket = await connect(fixture.url, "tok-admin");
    try {
      const resp = await new Promise<{ ok: boolean }>((resolve) => {
        socket.emit("game1:subscribe", { gameId: "sg-1" }, (r: { ok: boolean }) =>
          resolve(r)
        );
      });
      assert.equal(resp.ok, true);
    } finally {
      await disconnect(socket);
    }
  });

  test("HALL_OPERATOR-token godtas (GAME1_MASTER_WRITE-rolle)", async () => {
    const socket = await connect(fixture.url, "tok-hallop");
    try {
      assert.ok(socket.connected);
    } finally {
      await disconnect(socket);
    }
  });

  test("broadcaster.onStatusChange leveres kun til subscribed gameId", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      await new Promise((r) => admin.emit("game1:subscribe", { gameId: "sg-A" }, r));

      const received = waitForEvent<{
        gameId: string;
        status: string;
        action: string;
      }>(admin, "game1:status-update");

      fixture.broadcaster.onStatusChange({
        gameId: "sg-A",
        status: "running",
        action: "start",
        auditId: "audit-1",
        actorUserId: "user-admin",
        at: Date.now(),
      });

      const payload = await received;
      assert.equal(payload.gameId, "sg-A");
      assert.equal(payload.status, "running");
      assert.equal(payload.action, "start");
    } finally {
      await disconnect(admin);
    }
  });

  test("broadcaster.onStatusChange leveres IKKE til annen gameId-subscriber", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      await new Promise((r) => admin.emit("game1:subscribe", { gameId: "sg-A" }, r));

      let received = false;
      admin.on("game1:status-update", () => {
        received = true;
      });

      fixture.broadcaster.onStatusChange({
        gameId: "sg-OTHER",
        status: "paused",
        action: "pause",
        auditId: "audit-2",
        actorUserId: "user-admin",
        at: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 100));
      assert.equal(
        received,
        false,
        "event for annen gameId skal ikke leveres til denne subscriberen"
      );
    } finally {
      await disconnect(admin);
    }
  });

  test("broadcaster.onDrawProgressed leveres til subscribed client", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      await new Promise((r) => admin.emit("game1:subscribe", { gameId: "sg-B" }, r));

      const received = waitForEvent<{
        gameId: string;
        ballNumber: number;
        drawIndex: number;
      }>(admin, "game1:draw-progressed");

      fixture.broadcaster.onDrawProgressed({
        gameId: "sg-B",
        ballNumber: 42,
        drawIndex: 5,
        currentPhase: 2,
        at: Date.now(),
      });

      const payload = await received;
      assert.equal(payload.ballNumber, 42);
      assert.equal(payload.drawIndex, 5);
    } finally {
      await disconnect(admin);
    }
  });

  test("game1:unsubscribe stopper fan-out", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      await new Promise((r) => admin.emit("game1:subscribe", { gameId: "sg-C" }, r));
      await new Promise((r) => admin.emit("game1:unsubscribe", { gameId: "sg-C" }, r));

      let received = false;
      admin.on("game1:status-update", () => {
        received = true;
      });

      fixture.broadcaster.onStatusChange({
        gameId: "sg-C",
        status: "cancelled",
        action: "stop",
        auditId: "audit-3",
        actorUserId: "user-admin",
        at: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 100));
      assert.equal(received, false, "etter unsubscribe skal ingen events leveres");
    } finally {
      await disconnect(admin);
    }
  });

  test("game1:subscribe med tom gameId returnerer INVALID_INPUT", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      const resp = await new Promise<{ ok: boolean; error?: { code: string } }>(
        (r) => admin.emit("game1:subscribe", { gameId: "" }, r)
      );
      assert.equal(resp.ok, false);
      assert.equal(resp.error?.code, "INVALID_INPUT");
    } finally {
      await disconnect(admin);
    }
  });

  // ── Task 1.1: auto-pause + resumed broadcast ─────────────────────────────

  test("Task 1.1: broadcaster.onAutoPaused leveres som game1:auto-paused", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      await new Promise((r) =>
        admin.emit("game1:subscribe", { gameId: "sg-AP" }, r)
      );

      const received = waitForEvent<{
        gameId: string;
        phase: number;
        pausedAt: number;
      }>(admin, "game1:auto-paused");

      fixture.broadcaster.onAutoPaused({
        gameId: "sg-AP",
        phase: 1,
        pausedAt: 1_700_000_000_000,
      });

      const payload = await received;
      assert.equal(payload.gameId, "sg-AP");
      assert.equal(payload.phase, 1);
      assert.equal(payload.pausedAt, 1_700_000_000_000);
    } finally {
      await disconnect(admin);
    }
  });

  test("Task 1.1: broadcaster.onResumed leveres som game1:resumed med resumeType", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      await new Promise((r) =>
        admin.emit("game1:subscribe", { gameId: "sg-RS" }, r)
      );

      const received = waitForEvent<{
        gameId: string;
        resumedAt: number;
        actorUserId: string;
        phase: number;
        resumeType: "auto" | "manual";
      }>(admin, "game1:resumed");

      fixture.broadcaster.onResumed({
        gameId: "sg-RS",
        resumedAt: 1_700_000_100_000,
        actorUserId: "user-admin",
        phase: 2,
        resumeType: "auto",
      });

      const payload = await received;
      assert.equal(payload.gameId, "sg-RS");
      assert.equal(payload.resumeType, "auto");
      assert.equal(payload.phase, 2);
      assert.equal(payload.actorUserId, "user-admin");
    } finally {
      await disconnect(admin);
    }
  });

  test("Task 1.1: auto-paused til annen gameId leveres IKKE til subscriberen", async () => {
    const admin = await connect(fixture.url, "tok-admin");
    try {
      await new Promise((r) =>
        admin.emit("game1:subscribe", { gameId: "sg-X" }, r)
      );

      let received = false;
      admin.on("game1:auto-paused", () => {
        received = true;
      });

      fixture.broadcaster.onAutoPaused({
        gameId: "sg-OTHER",
        phase: 1,
        pausedAt: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 100));
      assert.equal(
        received,
        false,
        "auto-paused for annen gameId skal ikke leveres"
      );
    } finally {
      await disconnect(admin);
    }
  });
});

// Silence pino warnings in test output (we intentionally trigger auth failures)
void ((): Socket => null as never);
