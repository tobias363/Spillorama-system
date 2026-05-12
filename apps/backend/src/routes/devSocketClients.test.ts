/**
 * Tester for devSocketClients.ts (Tobias-direktiv 2026-05-12).
 *
 * Dekker:
 *   - Token-gating (401 uten token, 403 ved feil, 503 hvis env mangler)
 *   - 200 ved valid token, og tom sockets-array når ingen sockets
 *   - Sockets-listing inkluderer socketId, rooms (filtrert), transport,
 *     duration, walletId/playerId (hvis bound), ipHashed
 *   - totalConnected + authenticatedCount + transportCounts er korrekte
 *   - IP-hashing er stabil (samme IP → samme hash)
 *
 * Bruker mock Socket.IO Server med fake sockets-mappe.
 */

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createDevSocketClientsRouter } from "./devSocketClients.js";
import type { Server as SocketIOServer } from "socket.io";

const ORIGINAL_TOKEN = process.env.RESET_TEST_PLAYERS_TOKEN;

interface FakeSocket {
  id: string;
  rooms: Set<string>;
  data: {
    user?: { walletId?: string; id?: string };
    authenticated?: boolean;
  };
  handshake: {
    headers?: Record<string, string | undefined>;
    address?: string;
    issued?: number;
  };
  conn?: { transport?: { name?: string } };
}

function makeFakeIo(sockets: FakeSocket[]): SocketIOServer {
  const map = new Map<string, FakeSocket>(sockets.map((s) => [s.id, s]));
  return {
    sockets: {
      sockets: map,
    },
  } as unknown as SocketIOServer;
}

async function startApp(opts: { io: SocketIOServer }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json());
  app.use(createDevSocketClientsRouter({ io: opts.io }));
  return await new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        throw new Error("server.address() returnerte ikke object");
      }
      const port = addr.port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

describe("devSocketClients router", () => {
  beforeEach(() => {
    process.env.RESET_TEST_PLAYERS_TOKEN = "test-token";
  });

  after(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
    } else {
      process.env.RESET_TEST_PLAYERS_TOKEN = ORIGINAL_TOKEN;
    }
  });

  describe("token-gating", () => {
    it("returnerer 503 hvis RESET_TEST_PLAYERS_TOKEN er ikke satt", async () => {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
      const { baseUrl, close } = await startApp({ io: makeFakeIo([]) });
      try {
        const res = await fetch(`${baseUrl}/api/_dev/socket-clients`);
        assert.equal(res.status, 503);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "DEV_TOKEN_NOT_CONFIGURED");
      } finally {
        await close();
      }
    });

    it("returnerer 401 hvis token mangler", async () => {
      const { baseUrl, close } = await startApp({ io: makeFakeIo([]) });
      try {
        const res = await fetch(`${baseUrl}/api/_dev/socket-clients`);
        assert.equal(res.status, 401);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "TOKEN_REQUIRED");
      } finally {
        await close();
      }
    });

    it("returnerer 403 hvis token er feil", async () => {
      const { baseUrl, close } = await startApp({ io: makeFakeIo([]) });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/socket-clients?token=wrong`,
        );
        assert.equal(res.status, 403);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "FORBIDDEN");
      } finally {
        await close();
      }
    });

    it("returnerer 200 ved valid token og tom sockets", async () => {
      const { baseUrl, close } = await startApp({ io: makeFakeIo([]) });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/socket-clients?token=test-token`,
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          ok: boolean;
          data: {
            totalConnected: number;
            authenticatedCount: number;
            sockets: unknown[];
          };
        };
        assert.equal(body.ok, true);
        assert.equal(body.data.totalConnected, 0);
        assert.equal(body.data.authenticatedCount, 0);
        assert.equal(body.data.sockets.length, 0);
      } finally {
        await close();
      }
    });
  });

  describe("sockets listing", () => {
    it("lister én authenticated socket med rooms og duration", async () => {
      const now = Date.now();
      const sock: FakeSocket = {
        id: "sock-1",
        rooms: new Set(["sock-1", "BINGO_R1"]),
        data: {
          user: { walletId: "w-123", id: "u-123" },
          authenticated: true,
        },
        handshake: {
          headers: {
            "user-agent": "Mozilla/5.0 Test",
            "x-forwarded-for": "1.2.3.4",
          },
          address: "127.0.0.1",
          issued: now - 5000,
        },
        conn: { transport: { name: "websocket" } },
      };
      const { baseUrl, close } = await startApp({ io: makeFakeIo([sock]) });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/socket-clients?token=test-token`,
        );
        const body = (await res.json()) as {
          data: {
            totalConnected: number;
            authenticatedCount: number;
            unauthenticatedCount: number;
            transportCounts: Record<string, number>;
            sockets: Array<{
              socketId: string;
              rooms: string[];
              walletId: string | null;
              playerId: string | null;
              userAgent: string | null;
              transport: string;
              durationMs: number | null;
              authenticated: boolean;
              ipHashed: string | null;
            }>;
          };
        };
        assert.equal(body.data.totalConnected, 1);
        assert.equal(body.data.authenticatedCount, 1);
        assert.equal(body.data.unauthenticatedCount, 0);
        assert.deepEqual(body.data.transportCounts, { websocket: 1 });

        const s = body.data.sockets[0];
        assert.equal(s.socketId, "sock-1");
        // socket.id ble filtrert ut, BINGO_R1 beholdes
        assert.deepEqual(s.rooms, ["BINGO_R1"]);
        assert.equal(s.walletId, "w-123");
        assert.equal(s.playerId, "u-123");
        assert.equal(s.userAgent, "Mozilla/5.0 Test");
        assert.equal(s.transport, "websocket");
        assert.equal(s.authenticated, true);
        // Duration skal være ~5000ms (klokke kan flytte seg litt)
        assert.ok(s.durationMs !== null);
        assert.ok(s.durationMs! >= 4900 && s.durationMs! <= 5200);
        // IP-hash er 8 hex-tegn (en-veg sha256)
        assert.ok(s.ipHashed);
        assert.equal(s.ipHashed!.length, 8);
        assert.ok(/^[0-9a-f]{8}$/.test(s.ipHashed!));
      } finally {
        await close();
      }
    });

    it("teller authenticated og unauthenticated separat", async () => {
      const sockets: FakeSocket[] = [
        {
          id: "auth-1",
          rooms: new Set(["auth-1"]),
          data: { user: { walletId: "w1", id: "p1" }, authenticated: true },
          handshake: { headers: {}, issued: Date.now() },
          conn: { transport: { name: "websocket" } },
        },
        {
          id: "auth-2",
          rooms: new Set(["auth-2"]),
          data: { user: { walletId: "w2", id: "p2" }, authenticated: true },
          handshake: { headers: {}, issued: Date.now() },
          conn: { transport: { name: "websocket" } },
        },
        {
          id: "anon-1",
          rooms: new Set(["anon-1"]),
          data: { authenticated: false },
          handshake: { headers: {}, issued: Date.now() },
          conn: { transport: { name: "polling" } },
        },
      ];
      const { baseUrl, close } = await startApp({ io: makeFakeIo(sockets) });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/socket-clients?token=test-token`,
        );
        const body = (await res.json()) as {
          data: {
            totalConnected: number;
            authenticatedCount: number;
            unauthenticatedCount: number;
            transportCounts: Record<string, number>;
          };
        };
        assert.equal(body.data.totalConnected, 3);
        assert.equal(body.data.authenticatedCount, 2);
        assert.equal(body.data.unauthenticatedCount, 1);
        assert.deepEqual(body.data.transportCounts, {
          websocket: 2,
          polling: 1,
        });
      } finally {
        await close();
      }
    });

    it("samme IP gir samme hash på tvers av sockets (stable)", async () => {
      const sockets: FakeSocket[] = [
        {
          id: "s1",
          rooms: new Set(["s1"]),
          data: { authenticated: false },
          handshake: {
            headers: { "x-forwarded-for": "10.0.0.1" },
            issued: Date.now(),
          },
          conn: { transport: { name: "websocket" } },
        },
        {
          id: "s2",
          rooms: new Set(["s2"]),
          data: { authenticated: false },
          handshake: {
            headers: { "x-forwarded-for": "10.0.0.1" },
            issued: Date.now(),
          },
          conn: { transport: { name: "websocket" } },
        },
      ];
      const { baseUrl, close } = await startApp({ io: makeFakeIo(sockets) });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/socket-clients?token=test-token`,
        );
        const body = (await res.json()) as {
          data: { sockets: Array<{ ipHashed: string | null }> };
        };
        assert.equal(body.data.sockets.length, 2);
        assert.equal(body.data.sockets[0].ipHashed, body.data.sockets[1].ipHashed);
      } finally {
        await close();
      }
    });

    it("returnerer null felter når data mangler", async () => {
      const sock: FakeSocket = {
        id: "naked-sock",
        rooms: new Set(["naked-sock"]),
        data: {},
        handshake: { headers: {} },
      };
      const { baseUrl, close } = await startApp({ io: makeFakeIo([sock]) });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/socket-clients?token=test-token`,
        );
        const body = (await res.json()) as {
          data: {
            sockets: Array<{
              walletId: string | null;
              playerId: string | null;
              userAgent: string | null;
              transport: string;
              durationMs: number | null;
              ipHashed: string | null;
              authenticated: boolean;
            }>;
          };
        };
        const s = body.data.sockets[0];
        assert.equal(s.walletId, null);
        assert.equal(s.playerId, null);
        assert.equal(s.userAgent, null);
        assert.equal(s.transport, "unknown");
        assert.equal(s.durationMs, null);
        assert.equal(s.ipHashed, null);
        assert.equal(s.authenticated, false);
      } finally {
        await close();
      }
    });
  });

  describe("response shape", () => {
    it("inkluderer checkedAt ISO + checkedAtMs", async () => {
      const { baseUrl, close } = await startApp({ io: makeFakeIo([]) });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/socket-clients?token=test-token`,
        );
        const body = (await res.json()) as {
          data: { checkedAt: string; checkedAtMs: number };
        };
        assert.ok(typeof body.data.checkedAt === "string");
        assert.ok(/\d{4}-\d{2}-\d{2}T/.test(body.data.checkedAt));
        assert.ok(typeof body.data.checkedAtMs === "number");
        assert.ok(body.data.checkedAtMs > 0);
      } finally {
        await close();
      }
    });
  });
});
