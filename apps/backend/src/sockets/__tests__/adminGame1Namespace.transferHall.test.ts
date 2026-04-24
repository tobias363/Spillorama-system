/**
 * Task 1.6: integrasjonstester for transfer-hall-events i `/admin-game1`-
 * namespacet. Bruker samme test-fixture-mønster som adminGame1Namespace.test.ts.
 *
 * Verifiserer:
 *   - broadcaster.onTransferRequest leveres til admin-klient som har
 *     game1:subscribe-t på gameId
 *   - broadcaster.onTransferApproved + onMasterChanged emittes
 *   - broadcaster.onTransferExpired emittes
 *   - Default-namespace-mottakere (hall:<hallId>:display-rom) får events
 */

import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import { createAdminGame1Namespace } from "../adminGame1Namespace.js";
import type { AdminGame1Broadcaster } from "../../game/AdminGame1Broadcaster.js";

const TEST_USERS: Record<string, PublicAppUser> = {
  "tok-admin": {
    id: "user-admin",
    email: "admin@test.no",
    displayName: "Admin",
    walletId: "w",
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
    if (!user) throw new Error("UNAUTHORIZED");
    return { ...user };
  },
};

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

function connectAdmin(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`${url}/admin-game1`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 2000,
    });
    const timer = setTimeout(() => reject(new Error("connect timeout")), 3000);
    s.on("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Default-namespace-klient (ingen auth-handshake kreves der). Brukes for å
 * bekrefte at broadcaster emitter til hall:<hallId>:display-rom.
 */
function connectDefault(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(url, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 2000,
    });
    const timer = setTimeout(() => reject(new Error("connect timeout")), 3000);
    s.on("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.on("connect_error", (err) => {
      clearTimeout(timer);
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

function sampleEvent() {
  return {
    requestId: "req-1",
    gameId: "g1",
    fromHallId: "hall-a",
    toHallId: "hall-b",
    initiatedByUserId: "u-a",
    initiatedAtMs: Date.now(),
    validTillMs: Date.now() + 60_000,
    status: "pending" as const,
    respondedByUserId: null,
    respondedAtMs: null,
    rejectReason: null,
  };
}

describe("Task 1.6: /admin-game1 transfer-hall broadcast", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await startServer();
  });

  afterEach(async () => {
    await fixture.close();
  });

  test("onTransferRequest leveres til subscribed admin-klient", async () => {
    const admin = await connectAdmin(fixture.url, "tok-admin");
    try {
      await new Promise((r) =>
        admin.emit("game1:subscribe", { gameId: "g1" }, r)
      );
      const received = waitForEvent<{ requestId: string; toHallId: string }>(
        admin,
        "game1:transfer-request"
      );
      fixture.broadcaster.onTransferRequest(sampleEvent());
      const payload = await received;
      assert.equal(payload.requestId, "req-1");
      assert.equal(payload.toHallId, "hall-b");
    } finally {
      await disconnect(admin);
    }
  });

  test("onTransferRequest leveres også til default-namespace hall:<toHallId>:display", async () => {
    const defaultClient = await connectDefault(fixture.url);
    try {
      // Manuelt join hall-display-rom (i produksjon gjøres dette av
      // adminHallEvents-handshake; her simulerer vi via serverside).
      const firstSocket = [...fixture.io.of("/").sockets.values()][0];
      assert.ok(firstSocket, "default-socket skal være tilkoblet");
      firstSocket.join("hall:hall-b:display");

      const received = waitForEvent<{ requestId: string }>(
        defaultClient,
        "game1:transfer-request"
      );
      fixture.broadcaster.onTransferRequest(sampleEvent());
      const payload = await received;
      assert.equal(payload.requestId, "req-1");
    } finally {
      await disconnect(defaultClient);
    }
  });

  test("onTransferApproved + onMasterChanged emittes på samme gameId-rom", async () => {
    const admin = await connectAdmin(fixture.url, "tok-admin");
    try {
      await new Promise((r) =>
        admin.emit("game1:subscribe", { gameId: "g1" }, r)
      );
      const approvedPromise = waitForEvent<{ requestId: string; status: string }>(
        admin,
        "game1:transfer-approved"
      );
      const masterChangedPromise = waitForEvent<{
        gameId: string;
        newMasterHallId: string;
      }>(admin, "game1:master-changed");

      fixture.broadcaster.onTransferApproved({
        ...sampleEvent(),
        status: "approved",
        respondedByUserId: "u-b",
        respondedAtMs: Date.now(),
      });
      fixture.broadcaster.onMasterChanged({
        gameId: "g1",
        previousMasterHallId: "hall-a",
        newMasterHallId: "hall-b",
        transferRequestId: "req-1",
        at: Date.now(),
      });

      const [approved, masterChanged] = await Promise.all([
        approvedPromise,
        masterChangedPromise,
      ]);
      assert.equal(approved.status, "approved");
      assert.equal(masterChanged.newMasterHallId, "hall-b");
    } finally {
      await disconnect(admin);
    }
  });

  test("onTransferRejected emittes", async () => {
    const admin = await connectAdmin(fixture.url, "tok-admin");
    try {
      await new Promise((r) =>
        admin.emit("game1:subscribe", { gameId: "g1" }, r)
      );
      const received = waitForEvent<{ status: string }>(
        admin,
        "game1:transfer-rejected"
      );
      fixture.broadcaster.onTransferRejected({
        ...sampleEvent(),
        status: "rejected",
        rejectReason: "opptatt",
      });
      const payload = await received;
      assert.equal(payload.status, "rejected");
    } finally {
      await disconnect(admin);
    }
  });

  test("onTransferExpired emittes etter TTL-tick", async () => {
    const admin = await connectAdmin(fixture.url, "tok-admin");
    try {
      await new Promise((r) =>
        admin.emit("game1:subscribe", { gameId: "g1" }, r)
      );
      const received = waitForEvent<{ status: string }>(
        admin,
        "game1:transfer-expired"
      );
      fixture.broadcaster.onTransferExpired({
        ...sampleEvent(),
        status: "expired",
      });
      const payload = await received;
      assert.equal(payload.status, "expired");
    } finally {
      await disconnect(admin);
    }
  });
});
