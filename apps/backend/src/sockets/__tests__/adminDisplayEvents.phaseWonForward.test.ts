/**
 * Task 1.7 (2026-04-24): tester for phase-won fan-out til
 * `hall:<hallId>:display`-rom på default namespace.
 *
 * Spec: docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md §6 Task 1.7.
 *
 * Design:
 *   - `adminGame1Namespace.onPhaseWon` emittes primært til `/admin-game1`-
 *     namespacets `game1:<id>`-rom (eksisterende adferd, urørt).
 *   - Task 1.7 speiler også eventet til `hall:<hallId>:display`-rom på
 *     default namespace slik at TV-klienter mottar banner-trigger.
 *
 * Testene sjekker:
 *   1. `emitPhaseWonToHallDisplays` fan-outer til rett rom-set.
 *   2. `emitHallStatusUpdateToHallDisplay` treffer rett rom.
 *   3. `adminGame1Namespace.onPhaseWon` speiler til display-rom når
 *      `participatingHallIdsPort` er satt.
 *   4. Fail-open: port som kaster → admin-UI får eventet uansett.
 *   5. Fan-out disabled når porten mangler (baseline-kompatibilitet).
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { PublicAppUser } from "../../platform/PlatformService.js";
import {
  emitPhaseWonToHallDisplays,
  emitHallStatusUpdateToHallDisplay,
} from "../adminDisplayEvents.js";
import {
  createAdminGame1Namespace,
  type ParticipatingHallIdsPort,
} from "../adminGame1Namespace.js";

// ── Fake io for unit-testing emit-helpers (pure fan-out, no socket) ────────

class FakeIo {
  readonly emits: Array<{ room: string; event: string; payload: unknown }> = [];
  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emits.push({ room, event, payload });
        return true;
      },
    };
  }
}

test("emitPhaseWonToHallDisplays fan-outer til hver hall:<id>:display", () => {
  const io = new FakeIo();
  const payload = {
    gameId: "g1",
    patternName: "1 Rad",
    phase: 1,
    winnerIds: ["u-1"],
    winnerCount: 1,
    drawIndex: 5,
    at: Date.now(),
  };
  emitPhaseWonToHallDisplays(
    io as unknown as Server,
    ["hall-a", "hall-b", "hall-c"],
    payload
  );
  assert.equal(io.emits.length, 3);
  assert.deepEqual(
    io.emits.map((e) => e.room),
    ["hall:hall-a:display", "hall:hall-b:display", "hall:hall-c:display"]
  );
  for (const e of io.emits) {
    assert.equal(e.event, "game1:phase-won");
    assert.deepEqual(e.payload, payload);
  }
});

test("emitPhaseWonToHallDisplays hopper over tomme hall-id-strenger", () => {
  const io = new FakeIo();
  emitPhaseWonToHallDisplays(
    io as unknown as Server,
    ["hall-a", "", "hall-c"],
    { foo: "bar" }
  );
  assert.equal(io.emits.length, 2);
  assert.ok(io.emits.every((e) => e.room !== "hall::display"));
});

test("emitPhaseWonToHallDisplays med tom hall-liste = no-op", () => {
  const io = new FakeIo();
  emitPhaseWonToHallDisplays(io as unknown as Server, [], { x: 1 });
  assert.equal(io.emits.length, 0);
});

test("emitHallStatusUpdateToHallDisplay emittes til hall:<id>:display", () => {
  const io = new FakeIo();
  const payload = { hallId: "hall-a", color: "green", playerCount: 12, at: 1000 };
  emitHallStatusUpdateToHallDisplay(io as unknown as Server, "hall-a", payload);
  assert.equal(io.emits.length, 1);
  assert.equal(io.emits[0]!.room, "hall:hall-a:display");
  assert.equal(io.emits[0]!.event, "game1:hall-status-update");
  assert.deepEqual(io.emits[0]!.payload, payload);
});

test("emitHallStatusUpdateToHallDisplay med tom hallId = no-op", () => {
  const io = new FakeIo();
  emitHallStatusUpdateToHallDisplay(io as unknown as Server, "", { x: 1 });
  assert.equal(io.emits.length, 0);
});

// ── Integration: adminGame1Namespace.onPhaseWon → display-rom fan-out ──────

const TEST_USER: PublicAppUser = {
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
};

const mockPlatform = {
  getUserFromAccessToken: async (token: string): Promise<PublicAppUser> => {
    if (token !== "tok-admin") throw new Error("UNAUTHORIZED");
    return { ...TEST_USER };
  },
};

async function startServer(
  port?: ParticipatingHallIdsPort
): Promise<{
  url: string;
  io: Server;
  handle: ReturnType<typeof createAdminGame1Namespace>;
  close: () => Promise<void>;
}> {
  const app = express();
  const httpSrv = http.createServer(app);
  const io = new Server(httpSrv, { cors: { origin: "*" } });

  const handle = createAdminGame1Namespace({
    io,
    platformService: mockPlatform as never,
    ...(port ? { participatingHallIdsPort: port } : {}),
  });

  await new Promise<void>((resolve) => httpSrv.listen(0, resolve));
  const addr = httpSrv.address();
  const portNum = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://localhost:${portNum}`,
    io,
    handle,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => httpSrv.close(() => resolve()));
    },
  };
}

function connectAdmin(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = ioClient(`${url}/admin-game1`, {
      auth: { token: "tok-admin" },
      transports: ["websocket"],
      reconnection: false,
      timeout: 2000,
    });
    const timer = setTimeout(() => reject(new Error("admin connect timeout")), 3000);
    sock.on("connect", () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Kobler en TV-klient (default namespace) direkte i et hall-display-rom.
 * I produksjon joiner TVen rommet via `admin-display:subscribe`-flyten; her
 * bruker vi server-side socket.join direkte for testisolasjon — forwarderen
 * bryr seg bare om at rommet finnes.
 */
function connectDisplay(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const sock = ioClient(url, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 2000,
    });
    const timer = setTimeout(() => reject(new Error("display connect timeout")), 3000);
    sock.on("connect", () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.on("connect_error", (err) => {
      clearTimeout(timer);
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

function waitForEvent<T>(
  sock: ClientSocket,
  event: string,
  timeoutMs = 1500
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${event}"`)),
      timeoutMs
    );
    sock.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

test("Task 1.7: onPhaseWon speiles til hall:<id>:display-rom via porten", async () => {
  const port: ParticipatingHallIdsPort = {
    getParticipatingHallIds: async (gameId: string) => {
      assert.equal(gameId, "sg-phaseA");
      return ["hall-a", "hall-b"];
    },
  };
  const fixture = await startServer(port);
  try {
    // Server-side: place display-klient direkte i rommet (bypass
    // admin-display:subscribe så vi tester kun fan-outen).
    const display = await connectDisplay(fixture.url);
    try {
      // Join hall-a:display-rommet server-side.
      const serverSockets = await fixture.io.fetchSockets();
      for (const s of serverSockets) {
        if (s.id === display.id) {
          s.join("hall:hall-a:display");
        }
      }

      const eventPromise = waitForEvent<{ gameId: string; phase: number }>(
        display,
        "game1:phase-won"
      );
      fixture.handle.broadcaster.onPhaseWon({
        gameId: "sg-phaseA",
        patternName: "1 Rad",
        phase: 1,
        winnerIds: ["u-1"],
        winnerCount: 1,
        drawIndex: 5,
        at: 1000,
      });

      const ev = await eventPromise;
      assert.equal(ev.gameId, "sg-phaseA");
      assert.equal(ev.phase, 1);
    } finally {
      await disconnect(display);
    }
  } finally {
    await fixture.close();
  }
});

test("Task 1.7: onPhaseWon når porten kaster → admin-UI får eventet, display-fan-out feiler stille", async () => {
  const port: ParticipatingHallIdsPort = {
    getParticipatingHallIds: async () => {
      throw new Error("hall-status unavailable");
    },
  };
  const fixture = await startServer(port);
  try {
    const admin = await connectAdmin(fixture.url);
    try {
      await new Promise((r) => admin.emit("game1:subscribe", { gameId: "sg-1" }, r));
      const eventPromise = waitForEvent<{ gameId: string }>(admin, "game1:phase-won");
      fixture.handle.broadcaster.onPhaseWon({
        gameId: "sg-1",
        patternName: "Fullt Hus",
        phase: 5,
        winnerIds: ["u-1"],
        winnerCount: 1,
        drawIndex: 40,
        at: 2000,
      });
      const ev = await eventPromise;
      // Admin-UI får eventet selv når display-fan-out feiler.
      assert.equal(ev.gameId, "sg-1");
    } finally {
      await disconnect(admin);
    }
  } finally {
    await fixture.close();
  }
});

test("Task 1.7: ingen port satt → kun admin-namespace får phase-won (baseline-adferd bevart)", async () => {
  const fixture = await startServer(/* ingen port */);
  try {
    const admin = await connectAdmin(fixture.url);
    const display = await connectDisplay(fixture.url);
    try {
      await new Promise((r) => admin.emit("game1:subscribe", { gameId: "sg-1" }, r));
      const serverSockets = await fixture.io.fetchSockets();
      for (const s of serverSockets) {
        if (s.id === display.id) s.join("hall:hall-a:display");
      }

      let displayGotEvent = false;
      display.on("game1:phase-won", () => {
        displayGotEvent = true;
      });

      const adminPromise = waitForEvent<{ gameId: string }>(admin, "game1:phase-won");
      fixture.handle.broadcaster.onPhaseWon({
        gameId: "sg-1",
        patternName: "1 Rad",
        phase: 1,
        winnerIds: ["u-1"],
        winnerCount: 1,
        drawIndex: 3,
        at: 3000,
      });
      await adminPromise;

      // Gi event loop tid til å flushe evt. forsinket emit.
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(displayGotEvent, false, "display skal ikke få eventet uten port");
    } finally {
      await disconnect(admin);
      await disconnect(display);
    }
  } finally {
    await fixture.close();
  }
});

test("Task 1.7: onPhaseWon med tom port-resultat (0 haller) → kun admin-namespace får eventet", async () => {
  const port: ParticipatingHallIdsPort = {
    getParticipatingHallIds: async () => [],
  };
  const fixture = await startServer(port);
  try {
    const admin = await connectAdmin(fixture.url);
    const display = await connectDisplay(fixture.url);
    try {
      await new Promise((r) => admin.emit("game1:subscribe", { gameId: "sg-1" }, r));
      const serverSockets = await fixture.io.fetchSockets();
      for (const s of serverSockets) {
        if (s.id === display.id) s.join("hall:hall-a:display");
      }

      let displayGotEvent = false;
      display.on("game1:phase-won", () => {
        displayGotEvent = true;
      });

      const adminPromise = waitForEvent<{ gameId: string }>(admin, "game1:phase-won");
      fixture.handle.broadcaster.onPhaseWon({
        gameId: "sg-1",
        patternName: "1 Rad",
        phase: 1,
        winnerIds: ["u-1"],
        winnerCount: 1,
        drawIndex: 3,
        at: 3000,
      });
      await adminPromise;
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(displayGotEvent, false);
    } finally {
      await disconnect(admin);
      await disconnect(display);
    }
  } finally {
    await fixture.close();
  }
});
