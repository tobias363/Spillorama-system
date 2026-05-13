/**
 * Tester for devRrweb.ts (Tobias-direktiv 2026-05-13).
 *
 * Dekker:
 *   - POST validerer token (401/403/503)
 *   - POST krever gyldig sessionId
 *   - POST skriver events som JSONL til riktig fil
 *   - POST appends — to batcher gir to linjer i samme fil
 *   - POST avviser batches > MAX_EVENTS_PER_BATCH med 413
 *   - GET sessions returnerer liste med metadata
 *   - GET events returnerer unwrappede rrweb-events
 *   - GET events håndterer manglende fil med tom liste
 *   - Path-traversal: ugyldig sessionId avvises (".."/"../etc"/etc.)
 *   - Rotering: fil > maxBytes flytter til `.bak`
 *   - validateSessionId-helper: accept/reject-kontrakt
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createDevRrwebRouter,
  __TEST_ONLY__,
} from "./devRrweb.js";
import type { Server } from "node:http";

const ORIGINAL_TOKEN = process.env.RESET_TEST_PLAYERS_TOKEN;

/** Disposable tmp-mappe per test-kjøring. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spillorama-rrweb-test-"));
}

function cleanupTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/** Mini-Express app rundt routeren — port 0 så OS plukker fri port. */
async function startApp(opts: {
  sessionsDir: string;
  maxSessionBytes?: number;
}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(
    createDevRrwebRouter({
      sessionsDir: opts.sessionsDir,
      maxSessionBytes: opts.maxSessionBytes,
    }),
  );
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Server didn't bind to port");
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("devRrweb route", () => {
  let tmpDir: string;
  let app: { baseUrl: string; close: () => Promise<void> };

  before(() => {
    // Tester trenger gyldig token satt.
    process.env.RESET_TEST_PLAYERS_TOKEN = "test-token-xyz";
  });

  after(() => {
    if (ORIGINAL_TOKEN !== undefined) {
      process.env.RESET_TEST_PLAYERS_TOKEN = ORIGINAL_TOKEN;
    } else {
      delete process.env.RESET_TEST_PLAYERS_TOKEN;
    }
  });

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    app = await startApp({ sessionsDir: tmpDir });
  });

  // Cleanup etter hver test — annerledes mønster fordi node:test ikke
  // har `afterEach` direkte, så vi kjører manuell cleanup på slutten av
  // hvert test-case via en helper.
  async function teardown(): Promise<void> {
    await app.close();
    cleanupTmp(tmpDir);
  }

  it("validateSessionId aksepterer gyldige IDs", () => {
    assert.equal(__TEST_ONLY__.validateSessionId("123-abc"), "123-abc");
    assert.equal(
      __TEST_ONLY__.validateSessionId("1747000000000-x9k2vz"),
      "1747000000000-x9k2vz",
    );
    // Trims whitespace
    assert.equal(__TEST_ONLY__.validateSessionId("  abc-123  "), "abc-123");
  });

  it("validateSessionId avviser path-traversal", () => {
    assert.equal(__TEST_ONLY__.validateSessionId(".."), null);
    assert.equal(__TEST_ONLY__.validateSessionId("../etc/passwd"), null);
    assert.equal(__TEST_ONLY__.validateSessionId("foo/bar"), null);
    assert.equal(__TEST_ONLY__.validateSessionId("foo\\bar"), null);
    assert.equal(__TEST_ONLY__.validateSessionId(""), null);
    assert.equal(__TEST_ONLY__.validateSessionId("a".repeat(65)), null);
    assert.equal(__TEST_ONLY__.validateSessionId("CAPS"), null);
    assert.equal(__TEST_ONLY__.validateSessionId("_underscore"), null);
    assert.equal(__TEST_ONLY__.validateSessionId(123 as unknown), null);
    assert.equal(__TEST_ONLY__.validateSessionId(null as unknown), null);
  });

  it("POST avviser uten token (401)", async () => {
    const res = await fetch(`${app.baseUrl}/api/_dev/debug/rrweb-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "abc-123", events: [] }),
    });
    assert.equal(res.status, 401);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(json.error?.code, "TOKEN_REQUIRED");
    await teardown();
  });

  it("POST avviser ugyldig token (403)", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?token=wrong`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "abc-123", events: [] }),
      },
    );
    assert.equal(res.status, 403);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(json.error?.code, "FORBIDDEN");
    await teardown();
  });

  it("POST returnerer 503 hvis token-env mangler", async () => {
    const saved = process.env.RESET_TEST_PLAYERS_TOKEN;
    delete process.env.RESET_TEST_PLAYERS_TOKEN;
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?token=anything`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "abc-123", events: [] }),
      },
    );
    assert.equal(res.status, 503);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(json.error?.code, "DEV_TOKEN_NOT_CONFIGURED");
    if (saved !== undefined) process.env.RESET_TEST_PLAYERS_TOKEN = saved;
    await teardown();
  });

  it("POST avviser ugyldig sessionId (400)", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "../etc/passwd", events: [] }),
      },
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(json.error?.code, "INVALID_SESSION_ID");
    await teardown();
  });

  it("POST skriver events til riktig session-fil", async () => {
    const sessionId = "1700000000000-abc123";
    const events = [
      { type: 2, timestamp: 1700000000000, data: { initialOffset: { left: 0, top: 0 } } },
      { type: 3, timestamp: 1700000000001, data: { source: 2, type: 1, id: 10 } },
    ];
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, startedAt: 1700000000000, events }),
      },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data?: { received?: number; sessionId?: string } };
    assert.equal(body.data?.received, 2);
    assert.equal(body.data?.sessionId, sessionId);

    // Verify file written
    const filePath = __TEST_ONLY__.sessionFilePath(tmpDir, sessionId);
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.equal(first.event.type, 2);
    assert.ok(typeof first.receivedAt === "number");

    await teardown();
  });

  it("POST appender ved to batcher i samme session", async () => {
    const sessionId = "1700000000001-def456";
    const url = `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`;
    // Batch 1
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        events: [{ type: 2, timestamp: 1, data: {} }],
      }),
    });
    // Batch 2
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        events: [
          { type: 3, timestamp: 2, data: {} },
          { type: 3, timestamp: 3, data: {} },
        ],
      }),
    });

    const filePath = __TEST_ONLY__.sessionFilePath(tmpDir, sessionId);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 3);
    await teardown();
  });

  it("POST avviser batches > MAX_EVENTS_PER_BATCH med 413", async () => {
    const events = new Array(__TEST_ONLY__.MAX_EVENTS_PER_BATCH + 1).fill({
      type: 3,
      timestamp: 1,
      data: {},
    });
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "test-batch-large", events }),
      },
    );
    assert.equal(res.status, 413);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(json.error?.code, "BATCH_TOO_LARGE");
    await teardown();
  });

  it("GET sessions lister filer sortert nyeste først", async () => {
    // Skriv to sessioner med ulike timestamps i filnavn
    const s1 = "1700000000000-aaaaaa";
    const s2 = "1700000001000-bbbbbb";
    const url = `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: s1,
        events: [{ type: 2, timestamp: 1, data: {} }],
      }),
    });
    // Force forskjellig mtime — small delay
    await new Promise((r) => setTimeout(r, 50));
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: s2,
        events: [{ type: 2, timestamp: 2, data: {} }],
      }),
    });

    const listRes = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-sessions?token=test-token-xyz`,
    );
    assert.equal(listRes.status, 200);
    const json = (await listRes.json()) as {
      data?: { sessions?: Array<{ sessionId: string; fileSize: number }> };
    };
    const sessions = json.data?.sessions ?? [];
    assert.equal(sessions.length, 2);
    // Nyeste først
    assert.equal(sessions[0]!.sessionId, s2);
    assert.equal(sessions[1]!.sessionId, s1);
    assert.ok(sessions[0]!.fileSize > 0);
    await teardown();
  });

  it("GET events returnerer unwrappede rrweb-events", async () => {
    const sessionId = "1700000002000-ccc123";
    const url = `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        events: [
          { type: 2, timestamp: 100, data: { node: "root" } },
          { type: 3, timestamp: 200, data: { source: 1 } },
        ],
      }),
    });

    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?session=${sessionId}&token=test-token-xyz`,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      data?: { events?: Array<{ type: number; timestamp: number }> };
    };
    const events = json.data?.events ?? [];
    assert.equal(events.length, 2);
    assert.equal(events[0]!.type, 2);
    assert.equal(events[0]!.timestamp, 100);
    assert.equal(events[1]!.type, 3);
    assert.equal(events[1]!.timestamp, 200);
    await teardown();
  });

  it("GET events for ukjent session returnerer tom liste (ikke 404)", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?session=1700000003000-noex11&token=test-token-xyz`,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      data?: { events?: unknown[]; totalLines?: number };
    };
    assert.deepEqual(json.data?.events, []);
    assert.equal(json.data?.totalLines, 0);
    await teardown();
  });

  it("GET events avviser ugyldig session-query (400)", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?session=../bad&token=test-token-xyz`,
    );
    assert.equal(res.status, 400);
    const json = (await res.json()) as { error?: { code?: string } };
    assert.equal(json.error?.code, "INVALID_SESSION_ID");
    await teardown();
  });

  it("Rotering: fil > maxBytes flyttes til .bak", async () => {
    // Lag en app med liten max-size
    const tinyApp = await startApp({
      sessionsDir: tmpDir,
      maxSessionBytes: 100, // 100 bytes
    });
    const sessionId = "1700000004000-rotate";
    const url = `${tinyApp.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`;
    const filePath = __TEST_ONLY__.sessionFilePath(tmpDir, sessionId);

    // Skriv ett event som tar oss godt over 100 bytes
    const largeEvent = {
      type: 2,
      timestamp: 1,
      data: { padding: "x".repeat(200) },
    };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, events: [largeEvent] }),
    });
    // Sjekk at fila finnes
    assert.ok(fs.existsSync(filePath));

    // Skriv et nytt event — fila er nå > 100 bytes, så neste skriv skal
    // rotere til .bak før append.
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        events: [{ type: 3, timestamp: 2, data: {} }],
      }),
    });
    assert.ok(fs.existsSync(`${filePath}.bak`));
    assert.ok(fs.existsSync(filePath));
    // Ny fil skal kun ha det nye eventet (rotering frigjør den)
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event.type, 3);

    await tinyApp.close();
    await teardown();
  });

  it("Path-traversal-beskyttelse: ugyldig sessionId i POST/GET avvises", async () => {
    const url = `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`;
    // POST med "../"
    const postRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "../malicious",
        events: [{ type: 2, timestamp: 1, data: {} }],
      }),
    });
    assert.equal(postRes.status, 400);

    // GET med "../"
    const getRes = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?session=../malicious&token=test-token-xyz`,
    );
    assert.equal(getRes.status, 400);

    // Verifiser at ingen fil ble opprettet i tmpDir
    const entries = fs.readdirSync(tmpDir);
    assert.equal(entries.length, 0);

    await teardown();
  });

  it("Bug-marker (type=99) skrives og kan leses ut", async () => {
    const sessionId = "1700000005000-bug001";
    const url = `${app.baseUrl}/api/_dev/debug/rrweb-events?token=test-token-xyz`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        events: [
          { type: 2, timestamp: 100, data: { node: "root" } },
          {
            type: 99,
            timestamp: 150,
            data: { __bugMark: true, label: "popup-blocked", at: 150 },
          },
        ],
      }),
    });

    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/rrweb-events?session=${sessionId}&token=test-token-xyz`,
    );
    const json = (await res.json()) as {
      data?: { events?: Array<{ type: number; data?: { __bugMark?: boolean; label?: string } }> };
    };
    const events = json.data?.events ?? [];
    assert.equal(events.length, 2);
    assert.equal(events[1]!.type, 99);
    assert.equal(events[1]!.data?.__bugMark, true);
    assert.equal(events[1]!.data?.label, "popup-blocked");
    await teardown();
  });
});
