/**
 * Tester for devBugReport.ts (Tobias-direktiv 2026-05-13).
 *
 * Dekker:
 *   - Token-gating (401/403/503)
 *   - POST genererer markdown-rapport på disk med riktig struktur
 *   - Rapport inneholder klient-state, pilot-monitor-tail, backend-log-tail,
 *     klient-events fra streamer-JSONL
 *   - Heuristikker plukker opp stuck plan-runs + popup.show-blocked
 *   - Manglende logfiler bryter ikke rapporten (ENOENT håndteres)
 *   - DB-feil embeds som "Query feilet" i rapporten i stedet for HTTP 500
 *
 * Strategi:
 *   - Stub Pool så vi slipper å starte Postgres for tester.
 *   - Stub fs så vi kontrollerer hvilke log-filer eksisterer.
 *   - Express live-server på 127.0.0.1:<random port>.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Server } from "node:http";
import { createDevBugReportRouter, __TEST_ONLY__ } from "./devBugReport.js";

const ORIGINAL_TOKEN = process.env["RESET_TEST_PLAYERS_TOKEN"];

interface FakePool {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
}

function makeFakePool(handler: (sql: string) => unknown[]): FakePool {
  return {
    query: async (sql: string) => ({ rows: handler(sql) }),
  };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spillorama-bug-report-"));
}

function cleanupTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

interface AppOpts {
  pool: FakePool;
  reportDir: string;
  pilotMonitorLogPath?: string;
  backendLogPath?: string;
  clientEventLogPath?: string;
  now?: () => number;
}

async function startApp(
  opts: AppOpts,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(
    createDevBugReportRouter(
      { pool: opts.pool as unknown as import("pg").Pool, schema: "public" },
      {
        reportDir: opts.reportDir,
        pilotMonitorLogPath: opts.pilotMonitorLogPath,
        backendLogPath: opts.backendLogPath,
        clientEventLogPath: opts.clientEventLogPath,
        now: opts.now,
        // Disable audit-db i tester (vi spawner ikke child_process her).
        auditDbScriptPath: null,
      },
    ),
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

describe("devBugReport router", () => {
  let tmpDir: string;
  let reportDir: string;

  beforeEach(() => {
    if (tmpDir) cleanupTmp(tmpDir);
    tmpDir = makeTmpDir();
    reportDir = path.join(tmpDir, "reports");
    process.env["RESET_TEST_PLAYERS_TOKEN"] = "test-token";
  });

  after(() => {
    if (tmpDir) cleanupTmp(tmpDir);
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env["RESET_TEST_PLAYERS_TOKEN"];
    } else {
      process.env["RESET_TEST_PLAYERS_TOKEN"] = ORIGINAL_TOKEN;
    }
  });

  describe("token-gating", () => {
    it("returnerer 503 hvis RESET_TEST_PLAYERS_TOKEN er ikke satt", async () => {
      delete process.env["RESET_TEST_PLAYERS_TOKEN"];
      const pool = makeFakePool(() => []);
      const { baseUrl, close } = await startApp({ pool, reportDir });
      try {
        const res = await fetch(`${baseUrl}/api/_dev/debug/bug-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 503);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "DEV_TOKEN_NOT_CONFIGURED");
      } finally {
        await close();
      }
    });

    it("returnerer 401 hvis token mangler", async () => {
      const pool = makeFakePool(() => []);
      const { baseUrl, close } = await startApp({ pool, reportDir });
      try {
        const res = await fetch(`${baseUrl}/api/_dev/debug/bug-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 401);
      } finally {
        await close();
      }
    });

    it("returnerer 403 hvis token er feil", async () => {
      const pool = makeFakePool(() => []);
      const { baseUrl, close } = await startApp({ pool, reportDir });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/bug-report?token=wrong`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        assert.equal(res.status, 403);
      } finally {
        await close();
      }
    });
  });

  describe("POST /api/_dev/debug/bug-report", () => {
    it("genererer markdown-rapport på disk med basic-info", async () => {
      const pool = makeFakePool(() => []);
      const { baseUrl, close } = await startApp({
        pool,
        reportDir,
        pilotMonitorLogPath: path.join(tmpDir, "no-such-pilot.log"),
        backendLogPath: path.join(tmpDir, "no-such-backend.log"),
        clientEventLogPath: path.join(tmpDir, "no-such-events.jsonl"),
        now: () => Date.parse("2026-05-13T12:00:00Z"),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/bug-report?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: "Buy-popup vises ikke",
              notes: "Jeg trykket Klar, men popup-en kom aldri.",
              currentScreen: "play",
              lastUserAction: "click:ready-button",
              url: "http://localhost:5174/admin/agent/cashinout",
              userAgent: "Mozilla/5.0 (Test)",
              sessionContext: { userId: "u1", hallId: "h1" },
              clientState: { roomCode: "R1", gameStatus: "WAITING" },
              lastEvents: [
                { id: "e1", type: "user.click", payload: {} },
              ],
            }),
          },
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          ok: boolean;
          data: { reportPath: string; fileName: string; sizeBytes: number };
        };
        assert.equal(body.ok, true);
        assert.ok(body.data.reportPath.includes(reportDir));
        assert.ok(body.data.fileName.startsWith("bug-report-2026-05-13"));
        assert.ok(body.data.sizeBytes > 100);

        // Les rapport-fila
        const md = fs.readFileSync(body.data.reportPath, "utf8");
        assert.ok(md.includes("# Bug-rapport — Buy-popup vises ikke"));
        assert.ok(md.includes("**Currentscreen:** play"));
        assert.ok(md.includes("click:ready-button"));
        assert.ok(md.includes("Mozilla/5.0 (Test)"));
        assert.ok(md.includes("\"userId\": \"u1\""));
        assert.ok(md.includes("USER_NOTES"));
      } finally {
        await close();
      }
    });

    it("inkluderer pilot-monitor-tail, backend-log-tail og klient-events", async () => {
      // Lag logfiler
      const pilotLog = path.join(tmpDir, "pilot-monitor.log");
      const backendLog = path.join(tmpDir, "backend.log");
      const clientEvents = path.join(tmpDir, "events.jsonl");

      fs.writeFileSync(
        pilotLog,
        "[P3] monitor.start ts=2026-05-13T12:00:00Z\n[P1] draw.stuck ts=2026-05-13T12:00:30Z\n",
      );
      fs.writeFileSync(
        backendLog,
        "[backend] starting...\n[backend] ERROR something happened\n",
      );
      fs.writeFileSync(
        clientEvents,
        JSON.stringify({
          id: "evt-1",
          type: "screen.mount",
          timestamp: Date.now(),
          payload: { screen: "play" },
          receivedAt: Date.now(),
        }) + "\n",
      );

      const pool = makeFakePool(() => []);
      const { baseUrl, close } = await startApp({
        pool,
        reportDir,
        pilotMonitorLogPath: pilotLog,
        backendLogPath: backendLog,
        clientEventLogPath: clientEvents,
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/bug-report?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Test" }),
          },
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          data: { reportPath: string };
        };
        const md = fs.readFileSync(body.data.reportPath, "utf8");
        assert.ok(md.includes("[P1] draw.stuck"));
        assert.ok(md.includes("[backend] ERROR something happened"));
        assert.ok(md.includes("\"screen\": \"play\""));
      } finally {
        await close();
      }
    });

    it("inkluderer DB-audit-seksjon når auditDbScriptPath peker på fungerende script", async () => {
      // Lag en mock audit-db.mjs som returnerer minimal JSON
      const mockScript = path.join(tmpDir, "mock-audit-db.mjs");
      fs.writeFileSync(
        mockScript,
        `#!/usr/bin/env node
const json = {
  timestamp: new Date().toISOString(),
  schema: "public",
  summary: {
    totalQueries: 3,
    totalFindings: 1,
    totalErrors: 0,
    okCount: 2,
    findingsByTier: { P1: 1, P2: 0, P3: 0 },
  },
  results: [
    {
      id: "stuck-thing",
      tier: "P1",
      rowCount: 1,
      ok: true,
      error: null,
      description: "Test finding",
      fixAdvice: "Fix it",
      rows: [{ id: "x1" }],
    },
  ],
};
process.stdout.write(JSON.stringify(json));
process.exit(1); // P1-funn → exit 1, men output er gyldig
`,
      );
      fs.chmodSync(mockScript, 0o755);

      const pool = makeFakePool(() => []);
      const app = express();
      app.use(express.json({ limit: "5mb" }));
      app.use(
        createDevBugReportRouter(
          { pool: pool as unknown as import("pg").Pool, schema: "public" },
          {
            reportDir,
            pilotMonitorLogPath: path.join(tmpDir, "no.log"),
            backendLogPath: path.join(tmpDir, "no.log"),
            clientEventLogPath: path.join(tmpDir, "no.jsonl"),
            auditDbScriptPath: mockScript,
            auditDbTimeoutMs: 5000,
          },
        ),
      );
      const server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        server.close();
        throw new Error("server.address() ikke object");
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/bug-report?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Audit-test" }),
          },
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as { data: { reportPath: string } };
        const md = fs.readFileSync(body.data.reportPath, "utf8");
        assert.ok(md.includes("## 🗄️ DB-audit (quick)"));
        assert.ok(md.includes("stuck-thing"));
        assert.ok(md.includes("P1×1"));
        assert.ok(md.includes("Fix it"));
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it("fail-soft når audit-db script ikke finnes", async () => {
      const pool = makeFakePool(() => []);
      const app = express();
      app.use(express.json({ limit: "5mb" }));
      app.use(
        createDevBugReportRouter(
          { pool: pool as unknown as import("pg").Pool, schema: "public" },
          {
            reportDir,
            pilotMonitorLogPath: path.join(tmpDir, "no.log"),
            backendLogPath: path.join(tmpDir, "no.log"),
            clientEventLogPath: path.join(tmpDir, "no.jsonl"),
            auditDbScriptPath: "/tmp/this-does-not-exist-xyz.mjs",
            auditDbTimeoutMs: 5000,
          },
        ),
      );
      const server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        server.close();
        throw new Error("server.address() ikke object");
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/bug-report?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Audit-missing" }),
          },
        );
        // Skal IKKE failes — fail-soft
        assert.equal(res.status, 200);
        const body = (await res.json()) as { data: { reportPath: string } };
        const md = fs.readFileSync(body.data.reportPath, "utf8");
        assert.ok(md.includes("DB-audit kjørte ikke"));
        assert.ok(md.includes("ikke funnet"));
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });

    it("returnerer rapport med Query feilet hvis DB-pool kaster", async () => {
      const pool: FakePool = {
        query: async () => {
          throw new Error("connection refused");
        },
      };
      const { baseUrl, close } = await startApp({
        pool,
        reportDir,
        pilotMonitorLogPath: path.join(tmpDir, "no.log"),
        backendLogPath: path.join(tmpDir, "no.log"),
        clientEventLogPath: path.join(tmpDir, "no.jsonl"),
      });
      try {
        const res = await fetch(
          `${baseUrl}/api/_dev/debug/bug-report?token=test-token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Test" }),
          },
        );
        assert.equal(res.status, 200);
        const body = (await res.json()) as { data: { reportPath: string } };
        const md = fs.readFileSync(body.data.reportPath, "utf8");
        assert.ok(md.includes("Query feilet: connection refused"));
      } finally {
        await close();
      }
    });
  });

  describe("deriveDiagnose heuristics", () => {
    it("flagger plan-run som er running uten current_scheduled_game_id", () => {
      const out = __TEST_ONLY__.deriveDiagnose({
        body: {},
        pilotAnomalies: [],
        clientEvents: [],
        planRuns: [
          {
            id: "run-1",
            status: "running",
            plan_id: "p1",
            master_hall_id: "h1",
            current_position: 1,
            current_scheduled_game_id: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        scheduledGames: [],
      });
      assert.ok(out.some((x) => x.includes("PLAN_RUN_STUCK")));
    });

    it("flagger scheduled-game stuck i ready_to_start > 5 min", () => {
      const out = __TEST_ONLY__.deriveDiagnose({
        body: {},
        pilotAnomalies: [],
        clientEvents: [],
        planRuns: [],
        scheduledGames: [
          {
            id: "game-1",
            status: "ready_to_start",
            master_hall_id: "h1",
            group_hall_id: null,
            catalog_entry_id: null,
            plan_run_id: null,
            plan_position: null,
            scheduled_start_time: new Date(Date.now() - 10 * 60 * 1000),
            actual_start_time: null,
            actual_end_time: null,
            pause_reason: null,
            room_code: null,
          },
        ],
      });
      assert.ok(out.some((x) => x.includes("GAME_STUCK_READY")));
    });

    it("flagger popup-blocked når screen.mount=play men ingen popup.show etterpå", () => {
      const tenSecAgo = Date.now() - 10_000;
      const out = __TEST_ONLY__.deriveDiagnose({
        body: {},
        pilotAnomalies: [],
        clientEvents: [
          {
            type: "screen.mount",
            timestamp: tenSecAgo,
            payload: { screen: "play" },
          },
        ],
        planRuns: [],
        scheduledGames: [],
      });
      assert.ok(out.some((x) => x.includes("POPUP_BLOCKED")));
    });

    it("flagger ikke popup-blocked når popup.show kommer etter screen.mount", () => {
      const tenSecAgo = Date.now() - 10_000;
      const out = __TEST_ONLY__.deriveDiagnose({
        body: {},
        pilotAnomalies: [],
        clientEvents: [
          {
            type: "screen.mount",
            timestamp: tenSecAgo,
            payload: { screen: "play" },
          },
          {
            type: "popup.show",
            timestamp: tenSecAgo + 1000,
            payload: { popup: "buy" },
          },
        ],
        planRuns: [],
        scheduledGames: [],
      });
      assert.ok(!out.some((x) => x.includes("POPUP_BLOCKED")));
    });

    it("returnerer 'Ingen åpenbare anomalier' når alt ser bra ut", () => {
      const out = __TEST_ONLY__.deriveDiagnose({
        body: {},
        pilotAnomalies: [],
        clientEvents: [],
        planRuns: [],
        scheduledGames: [],
      });
      assert.ok(out.some((x) => x.includes("Ingen åpenbare anomalier")));
    });
  });

  describe("tailFileLines", () => {
    it("returnerer tom array når fil mangler", () => {
      const lines = __TEST_ONLY__.tailFileLines("/tmp/no-such-file-xyz.log", 100);
      assert.deepEqual(lines, []);
    });

    it("returnerer siste N linjer", () => {
      const file = path.join(tmpDir, "x.log");
      fs.writeFileSync(file, "a\nb\nc\nd\ne\n");
      const lines = __TEST_ONLY__.tailFileLines(file, 3);
      assert.deepEqual(lines, ["c", "d", "e"]);
    });
  });

  describe("loadClientEvents", () => {
    it("returnerer tom array når fil mangler", () => {
      const ev = __TEST_ONLY__.loadClientEvents("/tmp/no-such.jsonl", 100);
      assert.deepEqual(ev, []);
    });

    it("hopper over ødelagte JSON-linjer", () => {
      const file = path.join(tmpDir, "events.jsonl");
      fs.writeFileSync(
        file,
        JSON.stringify({ id: "e1", type: "test" }) + "\nthis-is-not-json\n" +
          JSON.stringify({ id: "e2", type: "test" }) + "\n",
      );
      const ev = __TEST_ONLY__.loadClientEvents(file, 10);
      assert.equal(ev.length, 2);
      assert.equal(ev[0]["id"], "e1");
      assert.equal(ev[1]["id"], "e2");
    });
  });

  describe("isoOrDash", () => {
    it("returnerer '—' for null/undefined", () => {
      assert.equal(__TEST_ONLY__.isoOrDash(null), "—");
      assert.equal(__TEST_ONLY__.isoOrDash(undefined), "—");
    });

    it("returnerer ISO-string for Date", () => {
      const d = new Date("2026-05-13T12:00:00Z");
      assert.equal(__TEST_ONLY__.isoOrDash(d), "2026-05-13T12:00:00.000Z");
    });

    it("returnerer string for string", () => {
      assert.equal(__TEST_ONLY__.isoOrDash("2026-05-13"), "2026-05-13");
    });
  });
});
