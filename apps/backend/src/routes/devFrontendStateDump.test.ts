/**
 * Tester for devFrontendStateDump.ts (Tobias-direktiv 2026-05-14).
 *
 * Dekker:
 *   - POST validerer token (401/403/503)
 *   - POST krever gyldig dumpId
 *   - POST skriver dump som JSON-fil til riktig path
 *   - POST roterer ut eldste når > maxRetained
 *   - GET list returnerer dumps nyeste-først
 *   - GET single returnerer en spesifikk dump
 *   - GET single 404 ved ukjent dumpId
 *   - Path-traversal: ugyldig dumpId avvises
 *   - validateDumpId-helper: accept/reject
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createDevFrontendStateDumpRouter,
  __TEST_ONLY__,
} from "./devFrontendStateDump.js";
import type { Server } from "node:http";

const ORIGINAL_TOKEN = process.env.RESET_TEST_PLAYERS_TOKEN;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spillorama-statedump-test-"));
}

function cleanupTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

async function startApp(opts: {
  dumpsDir: string;
  maxDumpsRetained?: number;
}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(
    createDevFrontendStateDumpRouter({
      dumpsDir: opts.dumpsDir,
      maxDumpsRetained: opts.maxDumpsRetained,
    }),
  );
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Server didn't bind");
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

const validDumpBody = (
  dumpId = "test-dump-id-1",
): Record<string, unknown> => ({
  dumpId,
  timestamp: 1700000000000,
  timestampIso: "2023-11-14T22:13:20.000Z",
  gameSlug: "bingo",
  lobbyState: { activeHallId: "demo-hall-001", halls: [], games: [] },
  roomState: null,
  playerState: null,
  screenState: null,
  socketState: null,
  derivedState: {
    pricePerColor: { yellow: 5, white: 10 },
    autoMultiplikatorApplied: true,
    innsatsVsForhandskjop: {
      activeStakeKr: 5,
      pendingStakeKr: 0,
      summedKr: 5,
      classification: "active",
    },
    pricingSourcesComparison: {
      roomEntryFeeKr: 5,
      roomTicketTypesNames: ["yellow", "white"],
      lobbyTicketPricesKr: { yellow: 5, white: 10 },
      nextGameTicketPricesKr: null,
      consistency: "consistent",
    },
  },
  env: { href: "https://test/", userAgent: "test", viewport: { width: 1024, height: 768 } },
});

describe("devFrontendStateDump route", () => {
  let tmpDir: string;
  let app: { baseUrl: string; close: () => Promise<void> };

  before(() => {
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
    app = await startApp({ dumpsDir: tmpDir });
  });

  afterEach(async () => {
    try {
      await app.close();
    } catch {
      /* */
    }
    cleanupTmp(tmpDir);
  });

  it("POST: 401 uten token", async () => {
    const res = await fetch(`${app.baseUrl}/api/_dev/debug/frontend-state-dump`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validDumpBody()),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "TOKEN_REQUIRED");
  });

  it("POST: 403 med feil token", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dump?token=wrong`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validDumpBody()),
      },
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN");
  });

  it("POST: 503 når env-token er tom", async () => {
    const original = process.env.RESET_TEST_PLAYERS_TOKEN;
    process.env.RESET_TEST_PLAYERS_TOKEN = "";
    try {
      const res = await fetch(
        `${app.baseUrl}/api/_dev/debug/frontend-state-dump?token=anything`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validDumpBody()),
        },
      );
      assert.equal(res.status, 503);
    } finally {
      process.env.RESET_TEST_PLAYERS_TOKEN = original;
    }
  });

  it("POST: 400 ved manglende eller ugyldig dumpId", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dump?token=test-token-xyz`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: 123 }),
      },
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "INVALID_DUMP_ID");
  });

  it("POST: 400 ved path-traversal forsøk i dumpId", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dump?token=test-token-xyz`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dumpId: "../etc/passwd" }),
      },
    );
    assert.equal(res.status, 400);
  });

  it("POST: 200 skriver dump som JSON-fil + roundtripper GET", async () => {
    const dumpId = "valid-dump-001";
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dump?token=test-token-xyz`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validDumpBody(dumpId)),
      },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { dumpId: string; filePath: string; sizeBytes: number };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.dumpId, dumpId);
    assert.ok(body.data.sizeBytes > 0);
    // Filen finnes
    assert.ok(fs.existsSync(body.data.filePath));
    const content = fs.readFileSync(body.data.filePath, "utf8");
    const parsed = JSON.parse(content);
    assert.equal(parsed.dumpId, dumpId);

    // GET single skal returnere den
    const getRes = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dumps/${dumpId}?token=test-token-xyz`,
    );
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as { ok: boolean; data: { dumpId: string } };
    assert.equal(getBody.data.dumpId, dumpId);
  });

  it("GET list: returnerer nyeste først", async () => {
    // POST tre dumps med forskjellige IDer
    for (const id of ["aaa-1", "bbb-2", "ccc-3"]) {
      await fetch(
        `${app.baseUrl}/api/_dev/debug/frontend-state-dump?token=test-token-xyz`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validDumpBody(id)),
        },
      );
      // Pause kort for å sikre forskjellig timestamp
      await new Promise((r) => setTimeout(r, 5));
    }
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dumps?token=test-token-xyz`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: { dumps: Array<{ dumpId: string; timestamp: number }>; total: number };
    };
    assert.equal(body.data.total, 3);
    // Nyeste først — timestamps minker
    const ts = body.data.dumps.map((d) => d.timestamp);
    for (let i = 1; i < ts.length; i++) {
      assert.ok(ts[i - 1]! >= ts[i]!, "nyeste først");
    }
  });

  it("GET single: 404 ved ukjent dumpId", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dumps/nonexistent-id?token=test-token-xyz`,
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "DUMP_NOT_FOUND");
  });

  it("GET single: 400 ved ugyldig dumpId-format", async () => {
    const res = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dumps/has%20space?token=test-token-xyz`,
    );
    assert.equal(res.status, 400);
  });

  it("Rotering: maxDumpsRetained=2 → eldste fjernes", async () => {
    await app.close();
    app = await startApp({ dumpsDir: tmpDir, maxDumpsRetained: 2 });
    // POST 5 dumps
    for (let i = 1; i <= 5; i++) {
      await fetch(
        `${app.baseUrl}/api/_dev/debug/frontend-state-dump?token=test-token-xyz`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validDumpBody(`dump-${i}`)),
        },
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    // Etter rotering skal vi ha maks 2 igjen
    const list = await fetch(
      `${app.baseUrl}/api/_dev/debug/frontend-state-dumps?token=test-token-xyz`,
    );
    const body = (await list.json()) as { data: { total: number } };
    assert.ok(body.data.total <= 2, `rotering beholder maks 2 (har ${body.data.total})`);
  });
});

describe("validateDumpId-helper", () => {
  it("aksepterer gyldige IDer", () => {
    const { validateDumpId } = __TEST_ONLY__;
    assert.equal(validateDumpId("abc-123"), "abc-123");
    assert.equal(validateDumpId("a"), "a");
    // 64-tegn grense — bruk lowercase hex (testes med 32 chars UUID-form)
    assert.equal(
      validateDumpId("12345678-1234-1234-1234-123456789abc"),
      "12345678-1234-1234-1234-123456789abc",
    );
  });

  it("avviser ugyldige IDer", () => {
    const { validateDumpId } = __TEST_ONLY__;
    assert.equal(validateDumpId(null), null);
    assert.equal(validateDumpId(undefined), null);
    assert.equal(validateDumpId(""), null);
    assert.equal(validateDumpId(123), null);
    assert.equal(validateDumpId("../etc"), null);
    assert.equal(validateDumpId("has space"), null);
    assert.equal(validateDumpId("/abs/path"), null);
    assert.equal(validateDumpId("a".repeat(100)), null);
  });
});
