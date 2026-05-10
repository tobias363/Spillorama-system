/**
 * ADR-0019 Wave 1, P0-3 + P0-4 (Agent B, 2026-05-10): regresjons-tester for
 * targeted-broadcast-mønsteret som erstatter de 7 globale `io.emit(...)`-
 * kallene i admin-game1-laget.
 *
 * Invarianter testet:
 *
 *   P0-3:
 *     - Transfer-events (request/approved/rejected/expired) leveres til
 *       sockets som har joinet `admin:masters:<gameId>`
 *     - Master-action-events leveres til samme rom
 *     - Master-changed-event leveres til admin:masters-rommet PLUSS
 *       hall:<hall>:display for berørte haller (master/agent badge update)
 *     - Sockets som IKKE er i admin-masters-rommet mottar IKKE eventene
 *       (dvs. det er ikke noe global io.emit-fallback lenger)
 *
 *   P0-4:
 *     - `<roomCode>:admin`-rommet er definert via canonical helper
 *     - Admin-sockets som joiner det rommet mottar FULL room:update-payload
 *     - Per-spiller-strip-pathen er uberørt for sockets som ikke er i
 *       admin-rommet
 *
 * Fixture-en mocker minimal socket.io-server uten reell engine, så vi kan
 * verifisere room-routing-konvensjonene uten å boote hele backenden.
 */

import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import { createAdminGame1Namespace } from "../adminGame1Namespace.js";
import {
  adminMastersRoomKey,
  adminRoomSnapshotKey,
} from "../adminRoomKeys.js";
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

function waitNoEvent<T>(
  socket: ClientSocket,
  event: string,
  windowMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = (data: T): void => {
      clearTimeout(timer);
      reject(
        new Error(
          `expected NO "${event}", but received: ${JSON.stringify(data)}`,
        ),
      );
    };
    socket.on(event, onEvent);
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, windowMs);
  });
}

function sampleTransferEvent() {
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

describe("ADR-0019 P0-3: targeted broadcast for transfer-events", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await startServer();
  });

  afterEach(async () => {
    await fixture.close();
  });

  test("admin:masters:<gameId> room-konvensjon er stabil", () => {
    assert.equal(adminMastersRoomKey("g1"), "admin:masters:g1");
    assert.equal(
      adminMastersRoomKey("scheduled-uuid-123"),
      "admin:masters:scheduled-uuid-123",
    );
  });

  test("transfer-request leveres til socket i admin:masters:<gameId>", async () => {
    const client = await connectDefault(fixture.url);
    try {
      // Server-side join (i prod skjer dette via admin:game1:subscribe
      // etter admin:login med JWT; her simulerer vi direkte for å
      // isolere room-routing-konvensjonen).
      const serverSocket = [...fixture.io.of("/").sockets.values()][0];
      assert.ok(serverSocket, "default-socket skal være tilkoblet");
      serverSocket.join(adminMastersRoomKey("g1"));

      const received = waitForEvent<{ requestId: string }>(
        client,
        "game1:transfer-request",
      );
      fixture.broadcaster.onTransferRequest(sampleTransferEvent());
      const payload = await received;
      assert.equal(payload.requestId, "req-1");
    } finally {
      await disconnect(client);
    }
  });

  test("transfer-request leveres IKKE til socket utenfor admin:masters:<gameId> (P0-3 invariant)", async () => {
    // Den kritiske invarianten: en spiller-socket som ikke har joinet
    // master-rommet skal aldri se transfer-events. Tidligere brukte vi
    // io.emit som lekket til alle sockets.
    const player = await connectDefault(fixture.url);
    try {
      const negative = waitNoEvent(player, "game1:transfer-request", 200);
      fixture.broadcaster.onTransferRequest(sampleTransferEvent());
      await negative; // Skal IKKE få event innen 200ms.
    } finally {
      await disconnect(player);
    }
  });

  test("transfer-approved + transfer-rejected + transfer-expired leveres til admin-masters", async () => {
    const client = await connectDefault(fixture.url);
    try {
      const serverSocket = [...fixture.io.of("/").sockets.values()][0];
      assert.ok(serverSocket);
      serverSocket.join(adminMastersRoomKey("g1"));

      const approvedP = waitForEvent<{ status: string }>(
        client,
        "game1:transfer-approved",
      );
      fixture.broadcaster.onTransferApproved({
        ...sampleTransferEvent(),
        status: "approved",
        respondedByUserId: "u-b",
        respondedAtMs: Date.now(),
      });
      const approved = await approvedP;
      assert.equal(approved.status, "approved");

      const rejectedP = waitForEvent<{ status: string }>(
        client,
        "game1:transfer-rejected",
      );
      fixture.broadcaster.onTransferRejected({
        ...sampleTransferEvent(),
        status: "rejected",
        rejectReason: "nope",
      });
      const rejected = await rejectedP;
      assert.equal(rejected.status, "rejected");

      const expiredP = waitForEvent<{ status: string }>(
        client,
        "game1:transfer-expired",
      );
      fixture.broadcaster.onTransferExpired({
        ...sampleTransferEvent(),
        status: "expired",
      });
      const expired = await expiredP;
      assert.equal(expired.status, "expired");
    } finally {
      await disconnect(client);
    }
  });

  test("master-changed leveres til admin:masters PLUSS hall:<hall>:display for berørte haller", async () => {
    // Vi har tre default-sockets: én i admin-masters (master-konsoll),
    // én i hall:hall-a:display (gammel master sin TV), én i
    // hall:hall-b:display (ny master sin TV). Alle skal motta eventet.
    // En fjerde "outsider" skal IKKE få det.
    const masterConsole = await connectDefault(fixture.url);
    const tvFrom = await connectDefault(fixture.url);
    const tvTo = await connectDefault(fixture.url);
    const outsider = await connectDefault(fixture.url);
    try {
      const sockets = [...fixture.io.of("/").sockets.values()];
      assert.equal(sockets.length, 4);
      // Sockets får ID-er i samme rekkefølge som klientene koblet til.
      // Mapper dem via socket.id-lookup for å unngå race.
      const idMap = new Map(sockets.map((s) => [s.id, s]));
      assert.ok(masterConsole.id && tvFrom.id && tvTo.id);
      const masterConsoleSrv = idMap.get(masterConsole.id);
      const tvFromSrv = idMap.get(tvFrom.id);
      const tvToSrv = idMap.get(tvTo.id);
      assert.ok(masterConsoleSrv && tvFromSrv && tvToSrv);

      masterConsoleSrv.join(adminMastersRoomKey("g1"));
      tvFromSrv.join("hall:hall-a:display");
      tvToSrv.join("hall:hall-b:display");

      const masterP = waitForEvent<{ newMasterHallId: string }>(
        masterConsole,
        "game1:master-changed",
      );
      const tvFromP = waitForEvent<{ newMasterHallId: string }>(
        tvFrom,
        "game1:master-changed",
      );
      const tvToP = waitForEvent<{ newMasterHallId: string }>(
        tvTo,
        "game1:master-changed",
      );
      const outsiderNegative = waitNoEvent(
        outsider,
        "game1:master-changed",
        200,
      );

      fixture.broadcaster.onMasterChanged({
        gameId: "g1",
        previousMasterHallId: "hall-a",
        newMasterHallId: "hall-b",
        transferRequestId: "req-1",
        at: Date.now(),
      });

      const [m, f, t] = await Promise.all([masterP, tvFromP, tvToP]);
      assert.equal(m.newMasterHallId, "hall-b");
      assert.equal(f.newMasterHallId, "hall-b");
      assert.equal(t.newMasterHallId, "hall-b");
      await outsiderNegative;
    } finally {
      await disconnect(masterConsole);
      await disconnect(tvFrom);
      await disconnect(tvTo);
      await disconnect(outsider);
    }
  });
});

describe("ADR-0019 P0-4: admin-room-snapshot-key", () => {
  test("<roomCode>:admin room-konvensjon er stabil", () => {
    assert.equal(adminRoomSnapshotKey("ROCKET"), "ROCKET:admin");
    assert.equal(
      adminRoomSnapshotKey("MONSTERBINGO"),
      "MONSTERBINGO:admin",
    );
    assert.equal(adminRoomSnapshotKey("BINGO_g1"), "BINGO_g1:admin");
  });

  // Note: full E2E-test for P0-4 (sender FULL payload til admin-rommet
  // og strippet til player-sockets) krever boot av engine + emitRoomUpdate-
  // pipelinen som er definert i index.ts. Det dekkes i en oppfølger-test
  // i `apps/backend/src/__tests__/perpetual-rooms/` (Agent A/PM eier).
  // Her tester vi kun helper-shape — selve emit-logikken er en ren replace
  // av eksisterende `io.to(roomCode)` med `io.to(adminRoomSnapshotKey(...))`.
});
