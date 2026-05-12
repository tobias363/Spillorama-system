/**
 * Tester for devDebugEventLog.ts (Tobias-direktiv 2026-05-12).
 *
 * Dekker:
 *   - POST /api/_dev/debug/events validerer token (401/403/503)
 *   - POST skriver events som JSON-lines til log-path
 *   - POST appends — kjøre to ganger gir to batcher i samme fil
 *   - POST avviser batches > MAX_EVENTS_PER_BATCH med 413
 *   - GET tail returnerer events med receivedAt > since
 *   - GET tail returnerer tom liste hvis fil ikke finnes (ENOENT)
 *   - Rotering: fil > maxBytes flytter til `.1`
 *   - Tail håndterer ødelagte linjer uten å krasje
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createDevDebugEventLogRouter,
  __TEST_ONLY__,
} from "./devDebugEventLog.js";
import type { Server } from "node:http";

const ORIGINAL_TOKEN = process.env.RESET_TEST_PLAYERS_TOKEN;

/**
 * Lag en disposable tmp-mappe per testkjøring for å unngå at parallelle
 * tester forstyrrer hverandre.
 */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spillorama-debug-events-"));
}

function cleanupTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort.
  }
}

/**
 * Lag en mini-Express-app rundt router-en for å teste over HTTP. Bruker
 * port 0 så OS velger fri port. Returnerer base-URL + close-funksjon.
 */
async function startApp(opts: {
  logPath: string;
  maxLogBytes?: number;
  now?: () => number;
}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(
    createDevDebugEventLogRouter({
      logPath: opts.logPath,
      maxLogBytes: opts.maxLogBytes,
      now: opts.now,
    }),
  );
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

describe("devDebugEventLog router", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    if (tmpDir) cleanupTmp(tmpDir);
    tmpDir = makeTmpDir();
    logPath = path.join(tmpDir, "spillorama-debug-events.jsonl");
    process.env.RESET_TEST_PLAYERS_TOKEN = "test-token";
  });

  after(() => {
    if (tmpDir) cleanupTmp(tmpDir);
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
    } else {
      process.env.RESET_TEST_PLAYERS_TOKEN = ORIGINAL_TOKEN;
    }
  });

  describe("token-gating", () => {
    it("returnerer 503 hvis RESET_TEST_PLAYERS_TOKEN er ikke satt", async () => {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(`${baseUrl}/api/_dev/debug/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: [] }),
        });
        assert.equal(res.status, 503);
        const body = (await res.json()) as { ok: boolean; error: { code: string } };
        assert.equal(body.ok, false);
        assert.equal(body.error.code, "DEV_TOKEN_NOT_CONFIGURED");
      } finally {
        await close();
      }
    });

    it("returnerer 401 hvis token mangler i request", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(`${baseUrl}/api/_dev/debug/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: [] }),
        });
        assert.equal(res.status, 401);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "TOKEN_REQUIRED");
      } finally {
        await close();
      }
    });

    it("returnerer 403 hvis token er feil", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events?token=wrong`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: [] }),
          },
        );
        assert.equal(res.status, 403);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "FORBIDDEN");
      } finally {
        await close();
      }
    });
  });

  describe("POST /api/_dev/debug/events", () => {
    it("aksepterer batch med 2 events, skriver JSON-lines til fil", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              events: [
                { id: "evt-1", type: "user.click", payload: { x: 1 } },
                { id: "evt-2", type: "api.request", payload: { url: "/x" } },
              ],
              sessionContext: { userId: "u1" },
            }),
          },
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as { ok: boolean; data: { received: number } };
        assert.equal(body.ok, true);
        assert.equal(body.data.received, 2);

        const content = fs.readFileSync(logPath, "utf8");
        const lines = content.split("\n").filter((l) => l.length > 0);
        assert.equal(lines.length, 2);

        const first = JSON.parse(lines[0]) as Record<string, unknown>;
        assert.equal(first.id, "evt-1");
        assert.equal((first.sessionContext as { userId: string }).userId, "u1");
        assert.ok(typeof first.receivedAt === "number");
      } finally {
        await close();
      }
    });

    it("appender ved to POST-er i samme fil", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        await fetch(`${baseUrl}/api/_dev/debug/events?token=test-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: [{ id: "evt-1", type: "user.click" }],
          }),
        });
        await fetch(`${baseUrl}/api/_dev/debug/events?token=test-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: [{ id: "evt-2", type: "user.click" }],
          }),
        });

        const content = fs.readFileSync(logPath, "utf8");
        const lines = content.split("\n").filter((l) => l.length > 0);
        assert.equal(lines.length, 2);
      } finally {
        await close();
      }
    });

    it("avviser batch > MAX_EVENTS_PER_BATCH med 413", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const events = Array.from(
          { length: __TEST_ONLY__.MAX_EVENTS_PER_BATCH + 1 },
          (_, i) => ({ id: `evt-${i}`, type: "user.click" }),
        );
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events }),
          },
        );
        assert.equal(res.status, 413);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "BATCH_TOO_LARGE");
      } finally {
        await close();
      }
    });

    it("tom batch er OK (men skriver ingenting til fil)", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: [] }),
          },
        );
        assert.equal(res.status, 200);
        assert.equal(fs.existsSync(logPath), false);
      } finally {
        await close();
      }
    });

    it("merger inn receivedAt og sessionContext på hver event", async () => {
      const fixedNow = 1700000000000;
      const { baseUrl, close } = await startApp({
        logPath,
        now: () => fixedNow,
      });
      try {
        await fetch(`${baseUrl}/api/_dev/debug/events?token=test-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: [{ id: "evt-1", type: "user.click", payload: {} }],
            sessionContext: { hallId: "hall-1", roomCode: "R" },
          }),
        });
        const content = fs.readFileSync(logPath, "utf8");
        const line = JSON.parse(content.trim()) as Record<string, unknown>;
        assert.equal(line.receivedAt, fixedNow);
        const sc = line.sessionContext as { hallId: string };
        assert.equal(sc.hallId, "hall-1");
      } finally {
        await close();
      }
    });
  });

  describe("GET /api/_dev/debug/events/tail", () => {
    it("returnerer tom liste hvis fil ikke finnes", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events/tail?token=test-token&since=0`,
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          data: { events: unknown[]; lastReceivedAt: number | null };
        };
        assert.deepEqual(body.data.events, []);
        assert.equal(body.data.lastReceivedAt, null);
      } finally {
        await close();
      }
    });

    it("returnerer events med receivedAt > since", async () => {
      const { baseUrl, close } = await startApp({
        logPath,
        now: () => 1000,
      });
      try {
        // Skriv batch ved t=1000
        await fetch(`${baseUrl}/api/_dev/debug/events?token=test-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: [{ id: "evt-1", type: "user.click" }] }),
        });
        // GET tail med since=500 skal returnere event-1
        const r1 = await fetch(
          `${baseUrl}/api/_dev/debug/events/tail?token=test-token&since=500`,
        );
        const b1 = (await r1.json()) as {
          data: { events: Array<{ id: string }>; lastReceivedAt: number };
        };
        assert.equal(b1.data.events.length, 1);
        assert.equal(b1.data.events[0].id, "evt-1");
        assert.equal(b1.data.lastReceivedAt, 1000);

        // GET tail med since=1000 skal returnere ingenting (events må ha receivedAt > since)
        const r2 = await fetch(
          `${baseUrl}/api/_dev/debug/events/tail?token=test-token&since=1000`,
        );
        const b2 = (await r2.json()) as { data: { events: unknown[] } };
        assert.equal(b2.data.events.length, 0);
      } finally {
        await close();
      }
    });

    it("returnerer 400 ved invalid ?since", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events/tail?token=test-token&since=not-a-number`,
        );
        assert.equal(res.status, 400);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "INVALID_INPUT");
      } finally {
        await close();
      }
    });

    it("returnerer 400 ved negative ?since", async () => {
      const { baseUrl, close } = await startApp({ logPath });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events/tail?token=test-token&since=-1`,
        );
        assert.equal(res.status, 400);
      } finally {
        await close();
      }
    });

    it("default ?since=0 returnerer alle events", async () => {
      const { baseUrl, close } = await startApp({ logPath, now: () => 500 });
      try {
        await fetch(`${baseUrl}/api/_dev/debug/events?token=test-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: [
              { id: "evt-1", type: "user.click" },
              { id: "evt-2", type: "user.click" },
            ],
          }),
        });
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/events/tail?token=test-token`,
        );
        const body = (await res.json()) as { data: { events: Array<{ id: string }> } };
        assert.equal(body.data.events.length, 2);
      } finally {
        await close();
      }
    });
  });

  describe("rotering", () => {
    it("flytter fil til `.1` hvis size > maxBytes", () => {
      // Forhåndsskriv 1000 bytes til fil
      const dir = makeTmpDir();
      try {
        const p = path.join(dir, "events.jsonl");
        fs.writeFileSync(p, "x".repeat(1000));
        __TEST_ONLY__.rotateIfNeeded(p, 500);
        assert.equal(fs.existsSync(p), false);
        assert.equal(fs.existsSync(`${p}.1`), true);
      } finally {
        cleanupTmp(dir);
      }
    });

    it("er no-op hvis fil ikke finnes", () => {
      const dir = makeTmpDir();
      try {
        const p = path.join(dir, "ikke-eksisterende.jsonl");
        // Skal ikke kaste
        __TEST_ONLY__.rotateIfNeeded(p, 500);
        assert.equal(fs.existsSync(p), false);
      } finally {
        cleanupTmp(dir);
      }
    });

    it("er no-op hvis size < maxBytes", () => {
      const dir = makeTmpDir();
      try {
        const p = path.join(dir, "events.jsonl");
        fs.writeFileSync(p, "x".repeat(100));
        __TEST_ONLY__.rotateIfNeeded(p, 1000);
        assert.equal(fs.existsSync(p), true);
        assert.equal(fs.existsSync(`${p}.1`), false);
      } finally {
        cleanupTmp(dir);
      }
    });
  });

  describe("tailLog robusthet", () => {
    it("hopper over ødelagte JSON-linjer uten å krasje", () => {
      const dir = makeTmpDir();
      try {
        const p = path.join(dir, "events.jsonl");
        // Bland gyldig og ødelagt
        fs.writeFileSync(
          p,
          [
            JSON.stringify({ id: "evt-1", receivedAt: 100 }),
            "DETTE-ER-IKKE-JSON",
            JSON.stringify({ id: "evt-2", receivedAt: 200 }),
          ].join("\n"),
        );
        const result = __TEST_ONLY__.tailLog(p, 0);
        assert.equal(result.events.length, 2);
        assert.equal((result.events[0] as { id: string }).id, "evt-1");
        assert.equal((result.events[1] as { id: string }).id, "evt-2");
        assert.equal(result.lastReceivedAt, 200);
      } finally {
        cleanupTmp(dir);
      }
    });
  });
});
